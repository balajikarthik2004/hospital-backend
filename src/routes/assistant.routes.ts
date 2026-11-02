import { Router } from 'express';
import * as c from '../controllers/assistant.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import {
  assistantAppointmentSchema,
  assistantCounsellingSchema,
  assistantDischargeSchema,
  assistantMedicationSchema,
  assistantQuestionSchema,
} from '../validators/index.js';

/**
 * The four independent specialist agents, for signed-in staff.
 *
 * An agent turn costs a model call and can take tens of seconds, so these are
 * limited per user rather than per IP — a whole ward behind one NAT address
 * should not share a bucket.
 */
const router = Router();
router.use(requireAuth);

const perUser = rateLimit({
  windowMs: 60_000,
  max: 20,
  key: (req) => req.user?.id ?? req.ip ?? 'anonymous',
  message: 'That is a lot of questions at once. Please wait a moment before asking again.',
});

/** Anyone with a clinical role may read a chart, so all of them may ask. */
const clinical = requireRole('physician', 'pharmacist', 'nurse', 'care_coordinator', 'admin');

router.get('/health', c.health);

// Open to every signed-in role: it answers from the hospital's own public
// information and holds no patient data.
router.post('/hospital/ask', perUser, validate(assistantQuestionSchema), c.askHospitalQuestion);

router.post(
  '/appointments/chat',
  clinical,
  perUser,
  validate(assistantAppointmentSchema),
  c.appointmentTurn
);
router.post(
  '/medications/explain',
  clinical,
  perUser,
  validate(assistantMedicationSchema),
  c.explainMedication
);
router.post(
  '/medications/counselling',
  clinical,
  perUser,
  validate(assistantCounsellingSchema),
  c.counselPrescription
);
router.post(
  '/discharge/summary',
  clinical,
  perUser,
  validate(assistantDischargeSchema),
  c.dischargeSummary
);

router.get('/patients/:id/context', clinical, c.patientContext);

export default router;
