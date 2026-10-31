import { Router } from 'express';
import { z } from 'zod';
import * as c from '../controllers/agent.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';

const router = Router();
router.use(requireAuth);

const triggerSchema = z.object({
  packageId: z.string().regex(/^[0-9a-fA-F]{24}$/),
});

const clinicalRoles = requireRole('physician', 'pharmacist', 'nurse', 'admin');

router.get('/health', c.agentHealth);
router.get('/status/:packageId', c.agentStatus);
router.post('/clinical-summary', clinicalRoles, validate(triggerSchema), c.triggerClinicalSummary);
router.post('/med-reconciliation', clinicalRoles, validate(triggerSchema), c.triggerMedReconciliation);
router.post('/follow-up-plan', clinicalRoles, validate(triggerSchema), c.triggerFollowUpPlan);
router.post('/patient-education', clinicalRoles, validate(triggerSchema), c.triggerPatientEducation);
router.post('/safety-check', clinicalRoles, validate(triggerSchema), c.triggerSafetyCheck);

export default router;
