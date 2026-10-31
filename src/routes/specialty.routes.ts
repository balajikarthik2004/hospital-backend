import { Router } from 'express';
import * as c from '../controllers/specialty.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import {
  createSpecialtySchema,
  doctorProfileSchema,
  updateSpecialtySchema,
} from '../validators/index.js';

/**
 * Department and doctor-profile maintenance.
 *
 * Reading is open to any signed-in member of staff — a nurse booking on a
 * patient's behalf needs the same dropdown the website uses. Writing is
 * `catalogue:manage`, which only an administrator holds.
 */
const router = Router();
router.use(requireAuth);

router.get('/', c.listSpecialties);
router.get('/doctors', c.listDoctorProfiles);

router.post(
  '/',
  requirePermission('catalogue:manage'),
  validate(createSpecialtySchema),
  c.createSpecialty
);
router.put(
  '/:id',
  requirePermission('catalogue:manage'),
  validate(updateSpecialtySchema),
  c.updateSpecialty
);
router.delete('/:id', requirePermission('catalogue:manage'), c.deleteSpecialty);

router.put(
  '/doctors/:id',
  requirePermission('catalogue:manage'),
  validate(doctorProfileSchema),
  c.updateDoctorProfile
);

export default router;
