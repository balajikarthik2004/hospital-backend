import { Router } from 'express';
import * as c from '../controllers/medication.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { medicationListSchema, updateMedicationListSchema } from '../validators/index.js';

const router = Router();
router.use(requireAuth);

router.post(
  '/',
  requirePermission('medication:modify'),
  validate(medicationListSchema),
  c.upsertMedicationList
);
router.get('/:admissionId', c.getMedicationsForAdmission);
router.put(
  '/:id',
  requirePermission('medication:modify'),
  validate(updateMedicationListSchema),
  c.updateMedicationList
);

export default router;
