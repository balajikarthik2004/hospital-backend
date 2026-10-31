import { Router } from 'express';
import * as c from '../controllers/bed.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { assignBedSchema, createBedSchema, updateBedSchema } from '../validators/index.js';

const router = Router();
router.use(requireAuth);

router.get('/', c.listBeds);
router.get('/available', c.availableBeds);
router.get('/ward/:ward', c.bedsByWard);
router.post('/', requirePermission('beds:manage'), validate(createBedSchema), c.createBed);
router.put('/:id', requirePermission('beds:manage'), validate(updateBedSchema), c.updateBed);
router.put('/:id/assign', requirePermission('patient:admit'), validate(assignBedSchema), c.assignBed);
router.put('/:id/release', requirePermission('patient:admit'), c.releaseBed);

export default router;
