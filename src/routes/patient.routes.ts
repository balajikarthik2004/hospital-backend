import { Router } from 'express';
import * as c from '../controllers/patient.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission, scopePatientAccess } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { createPatientSchema, updatePatientSchema } from '../validators/index.js';

const router = Router();
router.use(requireAuth);

router.post('/', requirePermission('patient:register'), validate(createPatientSchema), c.createPatient);
router.get('/', c.listPatients);
router.get('/search', c.searchPatients);
router.get('/:id', scopePatientAccess('id'), c.getPatient);
router.get('/:id/timeline', scopePatientAccess('id'), c.patientTimeline);
router.put('/:id', requirePermission('patient:register'), validate(updatePatientSchema), c.updatePatient);

export default router;
