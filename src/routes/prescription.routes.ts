import { Router } from 'express';
import * as c from '../controllers/prescription.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import {
  acknowledgeFlagSchema,
  cancelPrescriptionSchema,
  createPrescriptionSchema,
  dispensePrescriptionSchema,
  prescriptionQuerySchema,
  updatePrescriptionSchema,
} from '../validators/index.js';

/**
 * Prescribing and dispensing.
 *
 * The permission split is the point of this file: `prescription:write` is a
 * doctor's, `prescription:dispense` is the pharmacy's, and neither role can
 * perform the other's step. A pharmacist who disagrees with a script cancels
 * it with a reason — they cannot quietly rewrite it.
 */
const router = Router();
router.use(requireAuth);

const canView = requirePermission('prescription:view');
const canWrite = requirePermission('prescription:write');
const canDispense = requirePermission('prescription:dispense');

/* ── Reading ────────────────────────────────────────────────────────────── */
router.get('/', canView, validate(prescriptionQuerySchema, 'query'), c.listPrescriptions);
router.get('/queue/summary', canView, c.queueSummary);
router.get('/:id', canView, c.getPrescription);

/* ── The doctor ─────────────────────────────────────────────────────────── */
router.post('/', canWrite, validate(createPrescriptionSchema), c.createPrescription);
router.patch('/:id', canWrite, validate(updatePrescriptionSchema), c.updatePrescription);
router.post('/:id/send', canWrite, c.sendToPharmacy);

/* ── The pharmacy counter ───────────────────────────────────────────────── */
router.post('/:id/verify', canDispense, c.verifyPrescription);
router.post('/:id/ready', canDispense, c.markReady);
router.post('/:id/flags/ack', canDispense, validate(acknowledgeFlagSchema), c.acknowledgeFlag);
router.post('/:id/dispense', canDispense, validate(dispensePrescriptionSchema), c.dispensePrescription);

/* ── Either side may stop it, with a reason ─────────────────────────────── */
router.post(
  '/:id/cancel',
  requirePermission('prescription:view'),
  validate(cancelPrescriptionSchema),
  c.cancelPrescription
);

/* ── The Medication Agent writes the patient's sheet ────────────────────── */
router.post('/:id/counselling', canView, c.generateCounselling);

export default router;
