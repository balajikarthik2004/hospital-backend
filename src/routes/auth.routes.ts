import { Router } from 'express';
import * as c from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from '../validators/index.js';

const router = Router();

router.post('/login', validate(loginSchema), c.login);
router.post(
  '/register',
  requireAuth,
  requirePermission('users:manage'),
  validate(registerSchema),
  c.register
);
router.get('/me', requireAuth, c.me);
router.put('/profile', requireAuth, validate(updateProfileSchema), c.updateProfile);
router.put('/change-password', requireAuth, validate(changePasswordSchema), c.changePassword);

export default router;
