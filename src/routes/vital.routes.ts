import { Router } from 'express';
import * as c from '../controllers/vital.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission, scopePatientAccess } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { createVitalSchema } from '../validators/index.js';

const router = Router();
router.use(requireAuth);

router.post('/', requirePermission('vitals:record'), validate(createVitalSchema), c.recordVital);
router.get('/:patientId', scopePatientAccess('patientId'), c.getVitals);
router.get('/:patientId/latest', scopePatientAccess('patientId'), c.latestVital);

export default router;
