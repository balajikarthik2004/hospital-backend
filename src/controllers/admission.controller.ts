import type { Request, Response } from 'express';
import { Admission } from '../models/Admission.js';
import { Patient } from '../models/Patient.js';
import { Bed } from '../models/Bed.js';
import { Medication } from '../models/Medication.js';
import { audit } from '../middleware/audit.js';
import { emit } from '../config/socket.js';
import { ID_PREFIX, nextId } from '../utils/idGenerator.js';
import { asyncHandler, badRequest, notFound, paginate } from '../utils/helpers.js';

const POPULATE = [
  { path: 'patientId', select: 'patientId demographics status medicalHistory' },
  { path: 'careTeam.attendingPhysician', select: 'firstName lastName specialization role' },
  { path: 'careTeam.nurses', select: 'firstName lastName role' },
  { path: 'careTeam.specialists', select: 'firstName lastName specialization role' },
  { path: 'careTeam.pharmacist', select: 'firstName lastName role' },
  { path: 'careTeam.careCoordinator', select: 'firstName lastName role' },
  { path: 'clinicalNotes.author', select: 'firstName lastName role' },
];

export const createAdmission = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as Record<string, any>;

  const patient = await Patient.findById(body.patientId);
  if (!patient) throw notFound('Patient');
  if (patient.status === 'admitted' || patient.status === 'in_treatment') {
    throw badRequest('That patient already has an active admission');
  }

  let bedInfo = body.bed ?? { ward: '', roomNumber: '', bedNumber: '' };
  let bedDoc = null;

  if (body.bedId) {
    bedDoc = await Bed.findById(body.bedId);
    if (!bedDoc) throw notFound('Bed');
    if (bedDoc.status !== 'available' && bedDoc.status !== 'reserved') {
      throw badRequest(`Bed ${bedDoc.roomNumber}-${bedDoc.bedNumber} is ${bedDoc.status}`);
    }
    bedInfo = { ward: bedDoc.ward, roomNumber: bedDoc.roomNumber, bedNumber: bedDoc.bedNumber };
  }

  const admission = await Admission.create({
    ...body,
    admissionId: await nextId(Admission, 'admissionId', ID_PREFIX.admission),
    bed: bedInfo,
    admissionDate: body.admissionDate ?? new Date(),
    status: 'active',
  });

  if (bedDoc) {
    bedDoc.status = 'occupied';
    bedDoc.currentPatientId = patient._id;
    bedDoc.currentAdmissionId = admission._id;
    await bedDoc.save();
    emit('bed:status-changed', { bedId: bedDoc._id, status: 'occupied', ward: bedDoc.ward });
  }

  patient.status = 'admitted';
  await patient.save();

  // Re-point any home medication list captured at registration.
  await Medication.updateMany(
    { patientId: patient._id, listType: 'pre_admission', admissionId: patient._id },
    { $set: { admissionId: admission._id } }
  );

  // Make sure all three list types exist so the reconciliation view has rows.
  for (const listType of ['pre_admission', 'inpatient', 'discharge'] as const) {
    await Medication.updateOne(
      { admissionId: admission._id, listType },
      { $setOnInsert: { patientId: patient._id, admissionId: admission._id, listType, medications: [] } },
      { upsert: true }
    ).catch(() => undefined);
  }

  await audit(req, {
    action: 'admission.created',
    entity: 'admissions',
    entityId: admission._id,
    patientId: patient._id,
    description: `Admitted ${patient.patientId} — ${admission.admittingDiagnosis} (${admission.admissionId})`,
    after: { admissionId: admission.admissionId, bed: bedInfo },
  });

  const populated = await Admission.findById(admission._id).populate(POPULATE).lean();
  res.status(201).json({ admission: populated });
});

export const listAdmissions = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, skip } = paginate(req.query);
  const { status, ward, physician, from, to } = req.query as Record<string, string>;

  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (ward) filter['bed.ward'] = ward;
  if (physician) filter['careTeam.attendingPhysician'] = physician;
  if (from || to) {
    filter.admissionDate = {
      ...(from ? { $gte: new Date(from) } : {}),
      ...(to ? { $lte: new Date(to) } : {}),
    };
  }

  const [admissions, total] = await Promise.all([
    Admission.find(filter).sort('-admissionDate').skip(skip).limit(limit).populate(POPULATE).lean(),
    Admission.countDocuments(filter),
  ]);

  res.json({
    admissions,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

export const activeAdmissions = asyncHandler(async (_req: Request, res: Response) => {
  const admissions = await Admission.find({ status: 'active' })
    .sort('-admissionDate')
    .populate(POPULATE)
    .lean();
  res.json({ admissions });
});

export const getAdmission = asyncHandler(async (req: Request, res: Response) => {
  const admission = await Admission.findById(req.params.id).populate(POPULATE).lean();
  if (!admission) throw notFound('Admission');
  const medications = await Medication.find({ admissionId: admission._id }).lean();
  res.json({ admission, medications });
});

export const updateAdmission = asyncHandler(async (req: Request, res: Response) => {
  const before = await Admission.findById(req.params.id).lean();
  if (!before) throw notFound('Admission');

  const admission = await Admission.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  })
    .populate(POPULATE)
    .lean();

  await audit(req, {
    action: 'admission.updated',
    entity: 'admissions',
    entityId: before._id,
    patientId: before.patientId as never,
    description: `Updated admission ${before.admissionId}`,
    before: { status: before.status, expectedDischargeDate: before.expectedDischargeDate },
    after: req.body,
  });

  res.json({ admission });
});

export const addNote = asyncHandler(async (req: Request, res: Response) => {
  const admission = await Admission.findById(req.params.id);
  if (!admission) throw notFound('Admission');

  admission.clinicalNotes.push({
    author: req.user!.id,
    type: req.body.type,
    content: req.body.content,
    createdAt: new Date(),
  } as never);
  await admission.save();

  await audit(req, {
    action: 'note.created',
    entity: 'admissions',
    entityId: admission._id,
    patientId: admission.patientId as never,
    description: `Added a ${req.body.type} note to ${admission.admissionId}`,
    after: { type: req.body.type, length: String(req.body.content).length },
  });

  const populated = await Admission.findById(admission._id).populate(POPULATE).lean();
  res.status(201).json({ admission: populated });
});

export const addLabResult = asyncHandler(async (req: Request, res: Response) => {
  const admission = await Admission.findById(req.params.id);
  if (!admission) throw notFound('Admission');

  admission.labResults.push({
    ...req.body,
    orderedBy: req.user!.id,
    resultDate: req.body.resultDate ?? new Date(),
  } as never);
  await admission.save();

  await audit(req, {
    action: 'lab.recorded',
    entity: 'admissions',
    entityId: admission._id,
    patientId: admission.patientId as never,
    description: `Recorded ${req.body.testName} = ${req.body.value} ${req.body.unit ?? ''}`.trim(),
  });

  res.status(201).json({ admission: await Admission.findById(admission._id).populate(POPULATE).lean() });
});
