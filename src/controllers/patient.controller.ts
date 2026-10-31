import type { Request, Response } from 'express';
import { Patient } from '../models/Patient.js';
import { Admission } from '../models/Admission.js';
import { Medication } from '../models/Medication.js';
import { Vital } from '../models/Vital.js';
import { Appointment } from '../models/Appointment.js';
import { DischargePackage } from '../models/DischargePackage.js';
import { AuditLog } from '../models/AuditLog.js';
import { audit } from '../middleware/audit.js';
import { ID_PREFIX, nextId } from '../utils/idGenerator.js';
import { asyncHandler, notFound, paginate } from '../utils/helpers.js';

export const createPatient = asyncHandler(async (req: Request, res: Response) => {
  const { currentMedications, ...body } = req.body as Record<string, any>;

  const patient = await Patient.create({
    ...body,
    patientId: await nextId(Patient, 'patientId', ID_PREFIX.patient),
    status: body.status ?? 'registered',
  });

  // Home medications captured in the onboarding wizard are parked until the
  // patient is admitted, at which point they become the pre-admission list.
  if (currentMedications?.length) {
    await Medication.create({
      patientId: patient._id,
      admissionId: patient._id, // placeholder; re-pointed on admission
      listType: 'pre_admission',
      medications: currentMedications,
    }).catch(() => undefined);
  }

  await audit(req, {
    action: 'patient.registered',
    entity: 'patients',
    entityId: patient._id,
    patientId: patient._id,
    description: `Registered ${patient.demographics.firstName} ${patient.demographics.lastName} (${patient.patientId})`,
    after: { patientId: patient.patientId, status: patient.status },
  });

  res.status(201).json({ patient });
});

export const listPatients = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, skip } = paginate(req.query);
  const { status, q, ward, physician, from, to, sort } = req.query as Record<string, string>;

  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (q) {
    filter.$or = [
      { patientId: new RegExp(q, 'i') },
      { 'demographics.firstName': new RegExp(q, 'i') },
      { 'demographics.lastName': new RegExp(q, 'i') },
      { 'demographics.phone': new RegExp(q, 'i') },
    ];
  }
  if (from || to) {
    filter.createdAt = {
      ...(from ? { $gte: new Date(from) } : {}),
      ...(to ? { $lte: new Date(to) } : {}),
    };
  }

  // Patients may only see themselves.
  if (req.user?.role === 'patient') {
    filter._id = req.user.patientRef ?? null;
  }

  let patients = await Patient.find(filter)
    .sort(sort || '-createdAt')
    .lean();

  // Decorate with the active admission so the list can show ward + attending.
  const admissions = await Admission.find({
    patientId: { $in: patients.map((p) => p._id) },
    status: 'active',
  })
    .populate('careTeam.attendingPhysician', 'firstName lastName')
    .lean();

  const admissionByPatient = new Map(admissions.map((a) => [String(a.patientId), a]));

  let decorated = patients.map((p) => {
    const adm = admissionByPatient.get(String(p._id));
    const doc = adm?.careTeam?.attendingPhysician as any;
    return {
      ...p,
      activeAdmission: adm
        ? {
            _id: adm._id,
            admissionId: adm.admissionId,
            admittingDiagnosis: adm.admittingDiagnosis,
            admissionDate: adm.admissionDate,
            ward: adm.bed?.ward ?? '',
            room: adm.bed?.roomNumber ?? '',
            bed: adm.bed?.bedNumber ?? '',
            attendingPhysician: doc ? `Dr. ${doc.firstName} ${doc.lastName}` : '',
            attendingPhysicianId: doc ? String(doc._id) : null,
          }
        : null,
    };
  });

  if (ward) decorated = decorated.filter((p) => p.activeAdmission?.ward === ward);
  if (physician)
    decorated = decorated.filter((p) => p.activeAdmission?.attendingPhysicianId === physician);

  const total = decorated.length;
  res.json({
    patients: decorated.slice(skip, skip + limit),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

export const searchPatients = asyncHandler(async (req: Request, res: Response) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) return res.json({ patients: [] });

  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const patients = await Patient.find({
    $or: [
      { patientId: re },
      { 'demographics.firstName': re },
      { 'demographics.lastName': re },
      { 'demographics.phone': re },
    ],
  })
    .limit(20)
    .lean();

  res.json({ patients });
});

export const getPatient = asyncHandler(async (req: Request, res: Response) => {
  const patient = await Patient.findById(req.params.id).lean();
  if (!patient) throw notFound('Patient');

  const [admissions, vitals, appointments, packages] = await Promise.all([
    Admission.find({ patientId: patient._id })
      .sort('-admissionDate')
      .populate('careTeam.attendingPhysician', 'firstName lastName specialization')
      .populate('careTeam.nurses', 'firstName lastName')
      .populate('careTeam.pharmacist', 'firstName lastName')
      .populate('careTeam.careCoordinator', 'firstName lastName')
      .populate('clinicalNotes.author', 'firstName lastName role')
      .lean(),
    Vital.find({ patientId: patient._id }).sort('-timestamp').limit(200).lean(),
    Appointment.find({ patientId: patient._id })
      .sort('scheduledDate')
      .populate('doctorId', 'firstName lastName specialization')
      .lean(),
    DischargePackage.find({ patientId: patient._id }).sort('-initiatedAt').lean(),
  ]);

  const activeAdmission = admissions.find((a) => a.status === 'active') ?? null;
  const medications = activeAdmission
    ? await Medication.find({ admissionId: activeAdmission._id }).lean()
    : await Medication.find({ patientId: patient._id }).lean();

  res.json({
    patient,
    admissions,
    activeAdmission,
    vitals,
    appointments,
    medications,
    dischargePackages: packages,
  });
});

export const updatePatient = asyncHandler(async (req: Request, res: Response) => {
  const before = await Patient.findById(req.params.id).lean();
  if (!before) throw notFound('Patient');

  const patient = await Patient.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  }).lean();

  await audit(req, {
    action: 'patient.updated',
    entity: 'patients',
    entityId: before._id,
    patientId: before._id,
    description: `Updated record for ${before.patientId}`,
    before: { status: before.status },
    after: req.body,
  });

  res.json({ patient });
});

export const patientTimeline = asyncHandler(async (req: Request, res: Response) => {
  const patient = await Patient.findById(req.params.id).lean();
  if (!patient) throw notFound('Patient');

  const [admissions, vitals, appointments, packages, logs] = await Promise.all([
    Admission.find({ patientId: patient._id }).lean(),
    Vital.find({ patientId: patient._id }).sort('-timestamp').limit(100).lean(),
    Appointment.find({ patientId: patient._id }).lean(),
    DischargePackage.find({ patientId: patient._id }).lean(),
    AuditLog.find({ patientId: patient._id }).sort('-timestamp').limit(200).lean(),
  ]);

  type Entry = { at: Date; kind: string; title: string; detail: string; icon: string };
  const entries: Entry[] = [];

  entries.push({
    at: new Date(patient.createdAt as Date),
    kind: 'registration',
    title: 'Patient registered',
    detail: `${patient.patientId} created`,
    icon: 'user',
  });

  for (const a of admissions) {
    entries.push({
      at: new Date(a.admissionDate),
      kind: 'admission',
      title: `Admitted — ${a.admittingDiagnosis}`,
      detail: `${a.admissionId} · ${a.bed?.ward ?? ''} ${a.bed?.roomNumber ?? ''}`,
      icon: 'building',
    });
    if (a.actualDischargeDate) {
      entries.push({
        at: new Date(a.actualDischargeDate),
        kind: 'discharge',
        title: 'Discharged',
        detail: a.admissionId,
        icon: 'home',
      });
    }
    for (const n of a.clinicalNotes ?? []) {
      entries.push({
        at: new Date(n.createdAt as Date),
        kind: 'note',
        title: `${n.type} note`,
        detail: n.content.slice(0, 180),
        icon: 'document',
      });
    }
    for (const p of a.procedures ?? []) {
      entries.push({
        at: new Date(p.date as Date),
        kind: 'procedure',
        title: `Procedure — ${p.name}`,
        detail: p.notes ?? '',
        icon: 'scissors',
      });
    }
    for (const l of a.labResults ?? []) {
      if (!l.isAbnormal) continue;
      entries.push({
        at: new Date(l.resultDate as Date),
        kind: 'lab',
        title: `Abnormal lab — ${l.testName}`,
        detail: `${l.value} ${l.unit} (ref ${l.referenceRange})`,
        icon: 'beaker',
      });
    }
  }

  for (const v of vitals.slice(0, 20)) {
    entries.push({
      at: new Date(v.timestamp),
      kind: 'vitals',
      title: 'Vitals recorded',
      detail: `BP ${v.bloodPressureSystolic}/${v.bloodPressureDiastolic} · HR ${v.heartRate} · SpO₂ ${v.oxygenSaturation}%`,
      icon: 'heart',
    });
  }

  for (const a of appointments) {
    entries.push({
      at: new Date(a.scheduledDate),
      kind: 'appointment',
      title: `${a.type.replace('_', ' ')} — ${a.specialty || 'appointment'}`,
      detail: `${a.scheduledTime} · ${a.status}`,
      icon: 'calendar',
    });
  }

  for (const p of packages) {
    entries.push({
      at: new Date(p.initiatedAt),
      kind: 'discharge_package',
      title: `Discharge package ${p.packageId}`,
      detail: `status: ${p.status}`,
      icon: 'clipboard',
    });
  }

  entries.sort((a, b) => b.at.getTime() - a.at.getTime());

  res.json({ timeline: entries, auditEntries: logs.length });
});
