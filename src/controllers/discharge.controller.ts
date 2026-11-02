import type { Request, Response } from 'express';
import { DischargePackage } from '../models/DischargePackage.js';
import { Admission } from '../models/Admission.js';
import { Patient } from '../models/Patient.js';
import { Appointment } from '../models/Appointment.js';
import { Bed } from '../models/Bed.js';
import { audit } from '../middleware/audit.js';
import { emit } from '../config/socket.js';
import { ID_PREFIX, nextId } from '../utils/idGenerator.js';
import { asyncHandler, badRequest, forbidden, notFound, paginate, addDays } from '../utils/helpers.js';
import {
  SECTION_APPROVERS,
  completionBlockers,
  processPackage,
} from '../services/dischargeService.js';

const POPULATE = [
  { path: 'patientId', select: 'patientId demographics status medicalHistory' },
  { path: 'admissionId', select: 'admissionId admittingDiagnosis admissionDate bed diagnosisCodes' },
  { path: 'initiatedBy', select: 'firstName lastName role' },
  { path: 'approvals.userId', select: 'firstName lastName role' },
  { path: 'clinicalSummary.reviewedBy', select: 'firstName lastName role' },
  { path: 'medicationReconciliation.reviewedBy', select: 'firstName lastName role' },
  { path: 'followUpPlan.reviewedBy', select: 'firstName lastName role' },
  { path: 'patientEducation.reviewedBy', select: 'firstName lastName role' },
];

export const initiateDischarge = asyncHandler(async (req: Request, res: Response) => {
  const { admissionId } = req.body as { admissionId: string };

  const admission = await Admission.findById(admissionId);
  if (!admission) throw notFound('Admission');
  if (admission.status !== 'active') throw badRequest('That admission is not active');

  const existing = await DischargePackage.findOne({ admissionId });
  if (existing) {
    throw badRequest(
      `A discharge package already exists for this admission (${existing.packageId})`
    );
  }

  const pkg = await DischargePackage.create({
    packageId: await nextId(DischargePackage, 'packageId', ID_PREFIX.discharge),
    patientId: admission.patientId,
    admissionId: admission._id,
    initiatedBy: req.user!.id,
    initiatedAt: new Date(),
    status: 'initiated',
  });

  await Patient.findByIdAndUpdate(admission.patientId, { status: 'discharge_pending' });

  await audit(req, {
    action: 'discharge.initiated',
    entity: 'discharge_packages',
    entityId: pkg._id,
    patientId: admission.patientId as never,
    description: `Initiated discharge package ${pkg.packageId} for ${admission.admissionId}`,
    after: { packageId: pkg.packageId },
  });

  emit('discharge:status-update', { packageId: pkg._id, status: 'initiated' });

  // Agents run in the background; the client follows progress over Socket.IO.
  void processPackage(pkg._id);

  const populated = await DischargePackage.findById(pkg._id).populate(POPULATE).lean();
  res.status(201).json({ dischargePackage: populated });
});

export const listPackages = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, skip } = paginate(req.query);
  const { status, physician, from, to } = req.query as Record<string, string>;

  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (physician) filter.initiatedBy = physician;
  if (from || to) {
    filter.initiatedAt = {
      ...(from ? { $gte: new Date(from) } : {}),
      ...(to ? { $lte: new Date(to) } : {}),
    };
  }
  if (req.user?.role === 'patient') filter.patientId = req.user.patientRef ?? null;

  const [packages, total] = await Promise.all([
    DischargePackage.find(filter).sort('-initiatedAt').skip(skip).limit(limit).populate(POPULATE).lean(),
    DischargePackage.countDocuments(filter),
  ]);

  res.json({
    dischargePackages: packages.map(summarise),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

function summarise(p: any) {
  const flags = p.medicationReconciliation?.flags ?? [];
  return {
    ...p,
    flagSummary: {
      total: flags.length,
      critical: flags.filter((f: any) => f.severity === 'critical').length,
      high: flags.filter((f: any) => f.severity === 'high').length,
      medium: flags.filter((f: any) => f.severity === 'medium').length,
      low: flags.filter((f: any) => f.severity === 'low').length,
      unresolved: flags.filter((f: any) => f.resolution === 'pending').length,
    },
    blockers: completionBlockers(p),
  };
}

export const getPackage = asyncHandler(async (req: Request, res: Response) => {
  const pkg = await DischargePackage.findById(req.params.id).populate(POPULATE).lean();
  if (!pkg) throw notFound('Discharge package');
  res.json({ dischargePackage: summarise(pkg), sectionApprovers: SECTION_APPROVERS });
});

export const packageStatus = asyncHandler(async (req: Request, res: Response) => {
  const pkg = await DischargePackage.findById(req.params.id)
    .select('packageId status agentRuns safetyValidation clinicalSummary.status medicationReconciliation.status followUpPlan.status patientEducation.status')
    .lean();
  if (!pkg) throw notFound('Discharge package');

  res.json({
    packageId: pkg.packageId,
    status: pkg.status,
    agentRuns: pkg.agentRuns ?? [],
    safetyValidation: pkg.safetyValidation,
    sections: {
      clinicalSummary: pkg.clinicalSummary?.status,
      medicationReconciliation: pkg.medicationReconciliation?.status,
      followUpPlan: pkg.followUpPlan?.status,
      patientEducation: pkg.patientEducation?.status,
    },
    // The discharge DAG runs in this process, so it is online whenever the
    // API is. There is no sidecar left to probe.
    agentServiceOnline: true,
  });
});

export const rerunAgents = asyncHandler(async (req: Request, res: Response) => {
  const pkg = await DischargePackage.findById(req.params.id);
  if (!pkg) throw notFound('Discharge package');
  if (pkg.status === 'completed') throw badRequest('That discharge is already complete');

  await audit(req, {
    action: 'discharge.agents-rerun',
    entity: 'discharge_packages',
    entityId: pkg._id,
    patientId: pkg.patientId as never,
    description: `Re-ran the agent pipeline for ${pkg.packageId}`,
  });

  void processPackage(pkg._id);
  res.json({ ok: true, status: 'agents_processing' });
});

export const reviewSection = asyncHandler(async (req: Request, res: Response) => {
  const { section, action, comments, content, signature } = req.body as Record<string, any>;

  const pkg = await DischargePackage.findById(req.params.id);
  if (!pkg) throw notFound('Discharge package');
  if (pkg.status === 'completed') throw badRequest('That discharge is already complete');

  const allowed = SECTION_APPROVERS[section] ?? [];
  if (!allowed.includes(req.user!.role)) {
    throw forbidden(
      `${section} may only be reviewed by: ${allowed.join(', ')} (you are ${req.user!.role})`
    );
  }

  const target = (pkg as any)[section];
  if (target.status === 'pending') {
    throw badRequest('That section has not been generated yet');
  }

  const before = { status: target.status, content: target.content };

  if (action === 'edited') {
    if (!['clinicalSummary', 'patientEducation'].includes(section)) {
      throw badRequest('Only the clinical summary and patient education sections accept edits here');
    }
    if (!content?.trim()) throw badRequest('Provide the edited content');
    if (section === 'clinicalSummary') target.edits = target.content;
    target.content = content;
    target.status = 'reviewed';
  } else {
    target.status = action === 'approved' ? 'approved' : 'rejected';
  }

  target.reviewedBy = req.user!.id;
  target.reviewedAt = new Date();

  pkg.approvals.push({
    role: req.user!.role,
    userId: req.user!.id,
    section,
    action,
    comments: comments ?? null,
    signature,
    timestamp: new Date(),
  } as never);

  // Roll the package status up from its sections.
  const sections = Object.keys(SECTION_APPROVERS);
  const statuses = sections.map((s) => (pkg as any)[s].status);
  if (statuses.some((s) => s === 'rejected')) pkg.status = 'rejected';
  else if (statuses.every((s) => s === 'approved')) pkg.status = 'approved';
  else pkg.status = 'in_review';

  await pkg.save();

  await audit(req, {
    action: `discharge.section-${action}`,
    entity: 'discharge_packages',
    entityId: pkg._id,
    patientId: pkg.patientId as never,
    description: `${req.user!.role} ${action} "${section}" on ${pkg.packageId}${comments ? ` — ${comments}` : ''}`,
    before,
    after: { status: target.status, signature },
  });

  const room = `discharge:${pkg._id.toString()}`;
  emit('discharge:approved', { packageId: pkg._id, section, action, by: req.user }, room);
  emit('discharge:status-update', { packageId: pkg._id, status: pkg.status }, room);
  emit('discharge:status-update', { packageId: pkg._id, status: pkg.status });

  const populated = await DischargePackage.findById(pkg._id).populate(POPULATE).lean();
  res.json({ dischargePackage: summarise(populated) });
});

export const resolveFlag = asyncHandler(async (req: Request, res: Response) => {
  const { flagId, resolution, note } = req.body as Record<string, any>;

  const pkg = await DischargePackage.findById(req.params.id);
  if (!pkg) throw notFound('Discharge package');

  const flag = (pkg.medicationReconciliation.flags as any[]).find((f) => f.flagId === flagId);
  if (!flag) throw notFound(`Flag ${flagId}`);
  if (resolution === 'dismissed' && !note?.trim()) {
    throw badRequest('A reason is required when dismissing a flag');
  }

  const before = { resolution: flag.resolution, resolvedNote: flag.resolvedNote };

  flag.resolution = resolution;
  flag.resolvedBy = req.user!.id;
  flag.resolvedAt = new Date();
  flag.resolvedNote = note ?? null;

  pkg.markModified('medicationReconciliation.flags');
  await pkg.save();

  await audit(req, {
    action: 'discharge.flag-resolved',
    entity: 'discharge_packages',
    entityId: pkg._id,
    patientId: pkg.patientId as never,
    description: `${req.user!.role} ${resolution} the ${flag.severity} ${flag.type} flag on ${flag.drugA}${flag.drugB ? ` + ${flag.drugB}` : ''}${note ? ` — ${note}` : ''}`,
    before,
    after: { resolution, note: note ?? null },
  });

  const room = `discharge:${pkg._id.toString()}`;
  emit('discharge:flag-resolved', { packageId: pkg._id, flagId, resolution, by: req.user }, room);

  const populated = await DischargePackage.findById(pkg._id).populate(POPULATE).lean();
  res.json({ dischargePackage: summarise(populated) });
});

export const scheduleFollowUp = asyncHandler(async (req: Request, res: Response) => {
  const { recommendationId, doctorId, scheduledDate, scheduledTime, location } = req.body as Record<string, any>;

  const pkg = await DischargePackage.findById(req.params.id);
  if (!pkg) throw notFound('Discharge package');

  const rec = (pkg.followUpPlan.recommendations as any[]).find(
    (r) => String(r._id) === String(recommendationId)
  );
  if (!rec) throw notFound('Recommendation');
  if (rec.isScheduled) throw badRequest('That recommendation is already scheduled');

  const appointment = await Appointment.create({
    appointmentId: await nextId(Appointment, 'appointmentId', ID_PREFIX.appointment),
    patientId: pkg.patientId,
    doctorId,
    admissionId: pkg.admissionId,
    type:
      rec.type === 'lab_work' ? 'lab_only' : rec.type === 'specialist' ? 'specialist' : 'follow_up',
    specialty: rec.specialty || '',
    scheduledDate,
    scheduledTime,
    duration: 30,
    location: location || '',
    reason: rec.description,
    status: 'scheduled',
    createdBy: req.user!.id,
  });

  rec.isScheduled = true;
  rec.appointmentId = appointment._id;
  pkg.markModified('followUpPlan.recommendations');
  await pkg.save();

  await audit(req, {
    action: 'discharge.follow-up-scheduled',
    entity: 'discharge_packages',
    entityId: pkg._id,
    patientId: pkg.patientId as never,
    description: `Scheduled follow-up "${rec.description}" as ${appointment.appointmentId}`,
    after: { appointmentId: appointment.appointmentId },
  });

  emit('appointment:created', { appointment });

  const populated = await DischargePackage.findById(pkg._id).populate(POPULATE).lean();
  res.status(201).json({ dischargePackage: summarise(populated), appointment });
});

/** Schedules every unscheduled recommendation against the attending physician. */
export const scheduleAllFollowUps = asyncHandler(async (req: Request, res: Response) => {
  const pkg = await DischargePackage.findById(req.params.id);
  if (!pkg) throw notFound('Discharge package');

  const admission = await Admission.findById(pkg.admissionId).lean();
  const defaultDoctor = admission?.careTeam?.attendingPhysician;
  if (!defaultDoctor) throw badRequest('No attending physician on the admission to schedule against');

  const created: unknown[] = [];
  for (const rec of pkg.followUpPlan.recommendations as any[]) {
    if (rec.isScheduled) continue;
    const date = addDays(new Date(), rec.dueInDays ?? 7);
    const appointment = await Appointment.create({
      appointmentId: await nextId(Appointment, 'appointmentId', ID_PREFIX.appointment),
      patientId: pkg.patientId,
      doctorId: defaultDoctor,
      admissionId: pkg.admissionId,
      type:
        rec.type === 'lab_work' ? 'lab_only' : rec.type === 'specialist' ? 'specialist' : 'follow_up',
      specialty: rec.specialty || '',
      scheduledDate: date,
      scheduledTime: '10:00',
      duration: 30,
      location: rec.specialty ? `${rec.specialty} Clinic` : 'Outpatient Clinic',
      reason: rec.description,
      status: 'scheduled',
      createdBy: req.user!.id,
    });
    rec.isScheduled = true;
    rec.appointmentId = appointment._id;
    created.push(appointment);
  }

  pkg.markModified('followUpPlan.recommendations');
  await pkg.save();

  await audit(req, {
    action: 'discharge.follow-ups-scheduled',
    entity: 'discharge_packages',
    entityId: pkg._id,
    patientId: pkg.patientId as never,
    description: `Scheduled ${created.length} follow-up appointment(s) in bulk`,
  });

  const populated = await DischargePackage.findById(pkg._id).populate(POPULATE).lean();
  res.json({ dischargePackage: summarise(populated), created: created.length });
});

export const completeDischarge = asyncHandler(async (req: Request, res: Response) => {
  const pkg = await DischargePackage.findById(req.params.id);
  if (!pkg) throw notFound('Discharge package');
  if (pkg.status === 'completed') throw badRequest('That discharge is already complete');

  const blockers = completionBlockers(pkg.toObject());
  if (blockers.length) {
    throw badRequest('This discharge cannot be completed yet', blockers);
  }

  pkg.status = 'completed';
  pkg.completedAt = new Date();
  await pkg.save();

  const admission = await Admission.findByIdAndUpdate(
    pkg.admissionId,
    { status: 'discharged', actualDischargeDate: new Date() },
    { new: true }
  );
  await Patient.findByIdAndUpdate(pkg.patientId, { status: 'discharged' });

  // Free the bed.
  const bed = await Bed.findOne({ currentAdmissionId: pkg.admissionId });
  if (bed) {
    bed.status = 'available';
    bed.currentPatientId = null;
    bed.currentAdmissionId = null;
    await bed.save();
    emit('bed:status-changed', { bedId: bed._id, status: 'available', ward: bed.ward });
  }

  await audit(req, {
    action: 'discharge.completed',
    entity: 'discharge_packages',
    entityId: pkg._id,
    patientId: pkg.patientId as never,
    description: `Completed discharge ${pkg.packageId} for admission ${admission?.admissionId ?? ''}`,
    after: { completedAt: pkg.completedAt },
  });

  emit('discharge:completed', { packageId: pkg._id, patientId: pkg.patientId });
  emit('discharge:status-update', { packageId: pkg._id, status: 'completed' });

  const populated = await DischargePackage.findById(pkg._id).populate(POPULATE).lean();
  res.json({ dischargePackage: summarise(populated) });
});
