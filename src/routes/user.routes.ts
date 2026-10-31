import { Router } from 'express';
import * as c from '../controllers/user.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { updateUserSchema } from '../validators/index.js';

const router = Router();
router.use(requireAuth);

// Every clinical role needs the doctor directory for scheduling and care teams.
router.get('/doctors', c.listDoctors);

router.get('/', requirePermission('users:manage'), c.listUsers);
router.get('/:id', requirePermission('users:manage'), c.getUser);
router.put('/:id', requirePermission('users:manage'), validate(updateUserSchema), c.updateUser);
router.delete('/:id', requirePermission('users:manage'), c.deactivateUser);

export default router;
