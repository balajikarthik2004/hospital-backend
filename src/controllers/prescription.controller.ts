import type { Request, Response } from 'express';
import { Medication } from '../models/Medication.js';
import { Patient } from '../models/Patient.js';
import {
  PHARMACY_OPEN_STATUSES,
  Prescription,
  type PrescriptionStatus,
} from '../models/Prescription.js';
import { audit } from '../middleware/audit.js';
import { emit, emitToRole } from '../config/socket.js';
import { asyncHandler, badRequest, forbidden, notFound, paginate } from '../utils/helpers.js';
import { drugClassOf } from '../services/clinicalRules.js';
import {
  outstandingBlockingFlags,
  screenPrescription,
} from '../services/prescriptionSafety.js';
import { prescriptionCounselling } from '../services/multiAgentService.js';
import { ID_PREFIX, nextId } from '../utils/idGenerator.js';

/* ═══════════════════════════════════════════════════════════════════════════
   The prescription's journey from the consulting room to the counter.

     doctor writes  →  safety screen  →  sends to pharmacy
                                              ↓
                       pharmacist verifies  →  prepares  →  ready
                                                              ↓
                                            hands over, records who collected

   Three rules hold throughout:

   1. **The status ladder is enforced here, not in the UI.** Every transition
      checks the status it is coming from. A stale browser tab pressing
      "Dispense" twice must not dispense twice.

   2. **Critical and high flags block dispensing until a pharmacist signs
      them off.** Not until they are *seen* — until a named person records
      that they accepted the risk. That signature is the point of the flag.

   3. **The screen re-runs on every edit.** A prescription that was safe
      before an item was added is not evidence that it is safe now.
   ═══════════════════════════════════════════════════════════════════════════ */

const POPULATE = [
  { path: 'patientId', select: 'patientId demographics.firstName demographics.lastName demographics.dateOfBirth medicalHistory.allergies' },
  { path: 'prescribedBy', select: 'firstName lastName role department' },
  { path: 'pharmacy.verifiedBy', select: 'firstName lastName' },
  { path: 'pharmacy.dispensedBy', select: 'firstName lastName' },
];

/** Everything the patient is currently taking, for cross-checking a new script. */
async function currentMedicationsFor(patientId: unknown): Promise<{ drugName: string }[]> {
  const lists = await Medication.find({ patientId }).select('medications').lean();
  const fromLists = lists.flatMap((list) =>
    (list.medications ?? [])
      .filter((m) => m.isActive)
      .map((m) => ({ drugName: m.drugName }))
  );

  // Anything already dispensed and not yet superseded counts too — it is in
  // the patient's hands even if nobody has updated the reconciliation list.
  const dispensed = await Prescription.find({ patientId, status: 'dispensed' })
    .select('items.drugName')
    .sort({ 'pharmacy.dispensedAt': -1 })
    .limit(5)
    .lean();
  const fromDispensed = dispensed.flatMap((p) =>
    (p.items ?? []).map((i) => ({ drugName: i.drugName }))
  );

  return [...fromLists, ...fromDispensed];
}

/** Runs the screen against the patient's allergies and current medicines. */
async function screenFor(patientId: unknown, items: { drugName: string; dosage?: string; frequency?: string }[]) {
  const patient = await Patient.findById(patientId)
    .select('medicalHistory.allergies')
    .lean();
  const allergies = (patient?.medicalHistory?.allergies ?? []).map((a) => ({
    substance: a.substance,
    severity: a.severity,
  }));
  const currentMedications = await currentMedicationsFor(patientId);
  return screenPrescription({ items, allergies, currentMedications });
}

/** Fills in the drug class so the pharmacy screen can group by it. */
function withDrugClass<T extends { drugName: string; drugClass?: string }>(items: T[]): T[] {
  return items.map((item) => ({
    ...item,
    drugClass: item.drugClass?.trim() || drugClassOf(item.drugName) || '',
  }));
}

async function loadPrescription(id: string) {
  const query = id.match(/^[0-9a-fA-F]{24}$/)
    ? Prescription.findById(id)
    : Prescription.findOne({ prescriptionId: id });
  const prescription = await query.populate(POPULATE);
  if (!prescription) throw notFound('Prescription');
  return prescription;
}

/** A prescription must be in one of these states for the action to make sense. */
function requireStatus(
  current: PrescriptionStatus,
  allowed: PrescriptionStatus[],
  action: string
) {
  if (!allowed.includes(current)) {
    throw badRequest(
      `This prescription is ${current.replace(/_/g, ' ')}, so it cannot be ${action}.`
    );
  }
}

/* ── Writing a prescription ─────────────────────────────────────────────── */

/** POST /api/prescriptions — a doctor writes one. Starts as a draft. */
export const createPrescription = asyncHandler(async (req: Request, res: Response) => {
  const { patientId, admissionId, diagnosis, notes, priority, items } = req.body;

  const patient = await Patient.findById(patientId).select('patientId demographics').lean();
  if (!patient) throw notFound('Patient');

  const enriched = withDrugClass(items);
  const safety = await screenFor(patientId, enriched);

  const prescription = await Prescription.create({
    prescriptionId: await nextId(Prescription, 'prescriptionId', ID_PREFIX.prescription),
    patientId,
    admissionId: admissionId ?? null,
    prescribedBy: req.user!.id,
    diagnosis,
    notes,
    priority,
    items: enriched,
    safety,
    status: 'draft',
  });

  await audit(req, {
    action: 'prescription.created',
    entity: 'Prescription',
    entityId: prescription._id,
    patientId: patient._id,
    description:
      `Wrote ${prescription.prescriptionId} with ${enriched.length} item(s) for ` +
      `${patient.demographics.firstName} ${patient.demographics.lastName}` +
      (safety.flags.length ? ` — ${safety.flags.length} safety flag(s)` : ''),
  });

  res.status(201).json({ prescription: await loadPrescription(String(prescription._id)) });
});

/** PATCH /api/prescriptions/:id — edit, while it is still a draft. */
export const updatePrescription = asyncHandler(async (req: Request, res: Response) => {
  const prescription = await loadPrescription(req.params.id);
  requireStatus(prescription.status as PrescriptionStatus, ['draft'], 'edited');

  if (String(prescription.prescribedBy?._id ?? prescription.prescribedBy) !== req.user!.id) {
    throw forbidden('Only the prescriber may edit this prescription');
  }

  if (req.body.items) {
    prescription.items = withDrugClass(req.body.items) as never;
    // The old screen described a different prescription. Re-run it.
    prescription.safety = (await screenFor(
      prescription.patientId,
      prescription.items as never
    )) as never;
  }
  if (req.body.diagnosis !== undefined) prescription.diagnosis = req.body.diagnosis;
  if (req.body.notes !== undefined) prescription.notes = req.body.notes;
  if (req.body.priority !== undefined) prescription.priority = req.body.priority;

  await prescription.save();

  await audit(req, {
    action: 'prescription.updated',
    entity: 'Prescription',
    entityId: prescription._id,
    patientId: prescription.patientId as never,
    description: `Edited ${prescription.prescriptionId}; safety re-screened`,
  });

  res.json({ prescription: await loadPrescription(String(prescription._id)) });
});

/** POST /api/prescriptions/:id/send — hand it to the pharmacy. */
export const sendToPharmacy = asyncHandler(async (req: Request, res: Response) => {
  const prescription = await loadPrescription(req.params.id);
  requireStatus(prescription.status as PrescriptionStatus, ['draft'], 'sent to the pharmacy');

  if (!prescription.items?.length) throw badRequest('Add at least one medicine first');

  // Re-screen on the way out. The patient's allergies or current medicines
  // may have changed since the draft was written.
  prescription.safety = (await screenFor(
    prescription.patientId,
    prescription.items as never
  )) as never;

  const unclear = prescription.safety.flags.filter((f) => f.type === 'unclear_instruction');
  if (unclear.length) {
    throw badRequest(
      `Complete the dose and frequency first: ${unclear.map((f) => f.drugA).join(', ')}`
    );
  }

  prescription.status = 'sent_to_pharmacy';
  prescription.sentToPharmacyAt = new Date();
  await prescription.save();

  const full = await loadPrescription(String(prescription._id));

  // The pharmacy screen is a queue someone is watching, so push rather than
  // make them poll.
  emitToRole('pharmacist', 'prescription:new', { prescription: full });
  emitToRole('admin', 'prescription:new', { prescription: full });

  await audit(req, {
    action: 'prescription.sent',
    entity: 'Prescription',
    entityId: prescription._id,
    patientId: prescription.patientId as never,
    description: `Sent ${prescription.prescriptionId} to the pharmacy (${prescription.priority})`,
  });

  res.json({ prescription: full });
});

/* ── Reading ────────────────────────────────────────────────────────────── */

/** GET /api/prescriptions — the pharmacy queue, or a patient's history. */
export const listPrescriptions = asyncHandler(async (req: Request, res: Response) => {
  const { status, patientId, scope, search } = req.query as Record<string, string | undefined>;
  const { page, limit, skip } = paginate(req.query as Record<string, unknown>);

  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (patientId) filter.patientId = patientId;
  if (scope === 'queue') filter.status = { $in: PHARMACY_OPEN_STATUSES };
  if (scope === 'mine') filter.prescribedBy = req.user!.id;

  if (search?.trim()) {
    const matching = await Patient.find({
      $or: [
        { patientId: { $regex: search.trim(), $options: 'i' } },
        { 'demographics.firstName': { $regex: search.trim(), $options: 'i' } },
        { 'demographics.lastName': { $regex: search.trim(), $options: 'i' } },
      ],
    })
      .select('_id')
      .lean();
    filter.$or = [
      { prescriptionId: { $regex: search.trim(), $options: 'i' } },
      { patientId: { $in: matching.map((m) => m._id) } },
    ];
  }

  const [prescriptions, total] = await Promise.all([
    Prescription.find(filter)
      .populate(POPULATE)
      // Urgency first, then oldest-waiting, which is the order a counter works in.
      .sort({ priority: 1, sentToPharmacyAt: 1, prescribedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Prescription.countDocuments(filter),
  ]);

  res.json({ prescriptions, total, page, limit });
});

/** GET /api/prescriptions/queue/summary — the counts above the queue. */
export const queueSummary = asyncHandler(async (_req: Request, res: Response) => {
  const rows = await Prescription.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const counts = Object.fromEntries(rows.map((r) => [r._id, r.count]));

  const urgent = await Prescription.countDocuments({
    status: { $in: PHARMACY_OPEN_STATUSES },
    priority: { $in: ['urgent', 'stat'] },
  });

  res.json({
    counts: {
      draft: counts.draft ?? 0,
      sent_to_pharmacy: counts.sent_to_pharmacy ?? 0,
      preparing: counts.preparing ?? 0,
      ready: counts.ready ?? 0,
      dispensed: counts.dispensed ?? 0,
      cancelled: counts.cancelled ?? 0,
    },
    waiting:
      (counts.sent_to_pharmacy ?? 0) + (counts.preparing ?? 0) + (counts.ready ?? 0),
    urgent,
  });
});

/** GET /api/prescriptions/:id */
export const getPrescription = asyncHandler(async (req: Request, res: Response) => {
  res.json({ prescription: await loadPrescription(req.params.id) });
});

/* ── The pharmacy counter ───────────────────────────────────────────────── */

/** POST /api/prescriptions/:id/verify — pharmacist accepts it and starts work. */
export const verifyPrescription = asyncHandler(async (req: Request, res: Response) => {
  const prescription = await loadPrescription(req.params.id);
  requireStatus(prescription.status as PrescriptionStatus, ['sent_to_pharmacy'], 'verified');

  prescription.status = 'preparing';
  prescription.pharmacy.verifiedBy = req.user!.id as never;
  prescription.pharmacy.verifiedAt = new Date();
  await prescription.save();

  const full = await loadPrescription(String(prescription._id));
  emit('prescription:status-changed', {
    prescriptionId: prescription.prescriptionId,
    status: 'preparing',
  });

  await audit(req, {
    action: 'prescription.verified',
    entity: 'Prescription',
    entityId: prescription._id,
    patientId: prescription.patientId as never,
    description: `Pharmacy verified ${prescription.prescriptionId} and began preparing it`,
  });

  res.json({ prescription: full });
});

/** POST /api/prescriptions/:id/ready — prepared and waiting for collection. */
export const markReady = asyncHandler(async (req: Request, res: Response) => {
  const prescription = await loadPrescription(req.params.id);
  requireStatus(prescription.status as PrescriptionStatus, ['preparing'], 'marked ready');

  prescription.status = 'ready';
  prescription.pharmacy.readyAt = new Date();
  await prescription.save();

  const full = await loadPrescription(String(prescription._id));
  emit('prescription:status-changed', {
    prescriptionId: prescription.prescriptionId,
    status: 'ready',
  });

  await audit(req, {
    action: 'prescription.ready',
    entity: 'Prescription',
    entityId: prescription._id,
    patientId: prescription.patientId as never,
    description: `${prescription.prescriptionId} is ready for collection`,
  });

  res.json({ prescription: full });
});

/** POST /api/prescriptions/:id/flags/ack — sign off a safety flag. */
export const acknowledgeFlag = asyncHandler(async (req: Request, res: Response) => {
  const prescription = await loadPrescription(req.params.id);
  requireStatus(
    prescription.status as PrescriptionStatus,
    ['sent_to_pharmacy', 'preparing', 'ready'],
    'annotated'
  );

  const flag = prescription.safety.flags.find((f) => f.flagId === req.body.flagId);
  if (!flag) throw notFound('Safety flag');

  flag.acknowledged = true;
  flag.acknowledgedBy = req.user!.id as never;
  flag.acknowledgedAt = new Date();
  flag.acknowledgementNote = req.body.note || null;
  prescription.markModified('safety.flags');
  await prescription.save();

  await audit(req, {
    action: 'prescription.flag-acknowledged',
    entity: 'Prescription',
    entityId: prescription._id,
    patientId: prescription.patientId as never,
    description:
      `Accepted ${flag.severity} ${flag.type} flag on ${prescription.prescriptionId} ` +
      `(${flag.drugA}${flag.drugB ? ` + ${flag.drugB}` : ''})` +
      (req.body.note ? `: ${req.body.note}` : ''),
  });

  res.json({ prescription: await loadPrescription(String(prescription._id)) });
});

/** POST /api/prescriptions/:id/dispense — medicine crosses the counter. */
export const dispensePrescription = asyncHandler(async (req: Request, res: Response) => {
  const prescription = await loadPrescription(req.params.id);
  requireStatus(
    prescription.status as PrescriptionStatus,
    ['ready', 'preparing'],
    'dispensed'
  );

  // The flag has to be signed off by a person, not merely displayed.
  const blocking = outstandingBlockingFlags(prescription.safety.flags as never);
  if (blocking > 0) {
    throw badRequest(
      `${blocking} critical or high safety flag(s) must be reviewed and accepted before ` +
        'these medicines can be handed over.'
    );
  }

  const perItem = new Map(
    (req.body.items ?? []).map((i: { itemId: string }) => [String(i.itemId), i])
  );

  for (const item of prescription.items) {
    const update = perItem.get(String(item._id)) as
      | { dispensedQuantity?: number; substitutedWith?: string | null; pharmacyNote?: string | null }
      | undefined;

    item.isDispensed = true;
    item.dispensedQuantity = update?.dispensedQuantity ?? item.quantity ?? 0;

    if (update?.substitutedWith) {
      if (!item.substitutionAllowed) {
        throw badRequest(
          `The prescriber did not permit substitution for ${item.drugName}. ` +
            'Contact them before handing over an alternative.'
        );
      }
      item.substitutedWith = update.substitutedWith;
    }
    if (update?.pharmacyNote !== undefined) item.pharmacyNote = update.pharmacyNote;
  }

  prescription.status = 'dispensed';
  prescription.pharmacy.dispensedBy = req.user!.id as never;
  prescription.pharmacy.dispensedAt = new Date();
  prescription.pharmacy.collectedBy = req.body.collectedBy;
  if (req.body.notes) prescription.pharmacy.notes = req.body.notes;
  prescription.markModified('items');
  await prescription.save();

  const full = await loadPrescription(String(prescription._id));

  emit('prescription:dispensed', {
    prescriptionId: prescription.prescriptionId,
    patientId: String(prescription.patientId),
  });

  const substitutions = prescription.items.filter((i) => i.substitutedWith);
  await audit(req, {
    action: 'prescription.dispensed',
    entity: 'Prescription',
    entityId: prescription._id,
    patientId: prescription.patientId as never,
    description:
      `Dispensed ${prescription.prescriptionId} (${prescription.items.length} item(s)) to ` +
      `${req.body.collectedBy}` +
      (substitutions.length
        ? ` — substituted: ${substitutions.map((i) => `${i.drugName} → ${i.substitutedWith}`).join(', ')}`
        : ''),
  });

  res.json({ prescription: full });
});

/** POST /api/prescriptions/:id/cancel */
export const cancelPrescription = asyncHandler(async (req: Request, res: Response) => {
  const prescription = await loadPrescription(req.params.id);
  if (prescription.status === 'dispensed') {
    throw badRequest('These medicines have already been handed over and cannot be cancelled');
  }
  if (prescription.status === 'cancelled') {
    throw badRequest('This prescription is already cancelled');
  }

  prescription.status = 'cancelled';
  prescription.cancelledBy = req.user!.id as never;
  prescription.cancelledAt = new Date();
  prescription.cancelReason = req.body.reason;
  await prescription.save();

  emit('prescription:status-changed', {
    prescriptionId: prescription.prescriptionId,
    status: 'cancelled',
  });

  await audit(req, {
    action: 'prescription.cancelled',
    entity: 'Prescription',
    entityId: prescription._id,
    patientId: prescription.patientId as never,
    description: `Cancelled ${prescription.prescriptionId}: ${req.body.reason}`,
  });

  res.json({ prescription: await loadPrescription(String(prescription._id)) });
});

/* ── The Medication Agent at the counter ────────────────────────────────── */

/**
 * POST /api/prescriptions/:id/counselling
 *
 * Asks the Medication Agent to turn the dispensed items into the plain-language
 * sheet the patient takes home. This is the one place a model is involved in
 * the dispensing flow, and deliberately the only one: it is phrasing, not a
 * clinical decision. The drugs, doses and the safety screen are all decided by
 * the prescriber and the deterministic rules before this runs.
 *
 * The result is stored so the pharmacist and the patient read the same words.
 */
export const generateCounselling = asyncHandler(async (req: Request, res: Response) => {
  const prescription = await loadPrescription(req.params.id);
  requireStatus(
    prescription.status as PrescriptionStatus,
    ['sent_to_pharmacy', 'preparing', 'ready', 'dispensed'],
    'counselled on'
  );

  const patient = prescription.patientId as unknown as { patientId?: string } | null;
  if (!patient?.patientId) throw notFound('Patient');

  const result = await prescriptionCounselling(
    patient.patientId,
    prescription.prescriptionId
  );

  prescription.counselling = {
    content: result.counselling,
    generatedAt: new Date(),
    generator: 'medication_agent',
  } as never;
  await prescription.save();

  await audit(req, {
    action: 'prescription.counselling-generated',
    entity: 'Prescription',
    entityId: prescription._id,
    patientId: prescription.patientId as never,
    description: `Medication agent wrote the counselling sheet for ${prescription.prescriptionId}`,
  });

  res.json({
    prescriptionId: prescription.prescriptionId,
    counselling: result.counselling,
    status: result.status,
  });
});
