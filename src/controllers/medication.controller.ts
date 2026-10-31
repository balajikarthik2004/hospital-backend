import type { Request, Response } from 'express';
import { Medication } from '../models/Medication.js';
import { audit } from '../middleware/audit.js';
import { drugClassOf } from '../services/clinicalRules.js';
import { asyncHandler, notFound } from '../utils/helpers.js';

/** Fills in the drug class from the knowledge base when not supplied. */
function enrich(meds: any[]) {
  return meds.map((m) => ({ ...m, drugClass: m.drugClass || drugClassOf(m.drugName) }));
}

export const upsertMedicationList = asyncHandler(async (req: Request, res: Response) => {
  const { patientId, admissionId, listType, medications } = req.body as Record<string, any>;

  const before = await Medication.findOne({ admissionId, listType }).lean();

  const list = await Medication.findOneAndUpdate(
    { admissionId, listType },
    { patientId, admissionId, listType, medications: enrich(medications) },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  await audit(req, {
    action: before ? 'medication.list-updated' : 'medication.list-created',
    entity: 'medications',
    entityId: list!._id,
    patientId,
    description: `${before ? 'Updated' : 'Created'} the ${listType.replace('_', '-')} medication list (${medications.length} item(s))`,
    before: { count: before?.medications?.length ?? 0 },
    after: { count: medications.length },
  });

  res.status(before ? 200 : 201).json({ medicationList: list });
});

export const getMedicationsForAdmission = asyncHandler(async (req: Request, res: Response) => {
  const lists = await Medication.find({ admissionId: req.params.admissionId }).lean();

  const byType = (t: string) => lists.find((l) => l.listType === t)?.medications ?? [];
  res.json({
    lists,
    preAdmission: byType('pre_admission'),
    inpatient: byType('inpatient'),
    discharge: byType('discharge'),
  });
});

export const updateMedicationList = asyncHandler(async (req: Request, res: Response) => {
  const before = await Medication.findById(req.params.id).lean();
  if (!before) throw notFound('Medication list');

  const list = await Medication.findByIdAndUpdate(
    req.params.id,
    { medications: enrich(req.body.medications) },
    { new: true, runValidators: true }
  ).lean();

  await audit(req, {
    action: 'medication.list-updated',
    entity: 'medications',
    entityId: before._id,
    patientId: before.patientId as never,
    description: `Updated the ${before.listType.replace('_', '-')} medication list`,
    before: { count: before.medications.length },
    after: { count: req.body.medications.length },
  });

  res.json({ medicationList: list });
});
