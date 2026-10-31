import { Router } from 'express';
import * as c from '../controllers/discharge.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import {
  initiateDischargeSchema,
  resolveFlagSchema,
  reviewSectionSchema,
  scheduleFollowUpSchema,
} from '../validators/index.js';

const router = Router();
router.use(requireAuth);

router.post(
  '/initiate',
  requirePermission('discharge:initiate'),
  validate(initiateDischargeSchema),
  c.initiateDischarge
);
router.get('/', c.listPackages);
router.get('/:id', c.getPackage);
router.get('/:id/status', c.packageStatus);

router.put('/:id/review', validate(reviewSectionSchema), c.reviewSection);
router.put(
  '/:id/resolve-flag',
  requirePermission('discharge:review-medication'),
  validate(resolveFlagSchema),
  c.resolveFlag
);
router.post(
  '/:id/schedule-follow-up',
  requirePermission('appointment:schedule'),
  validate(scheduleFollowUpSchema),
  c.scheduleFollowUp
);
router.post(
  '/:id/schedule-all-follow-ups',
  requirePermission('appointment:schedule'),
  c.scheduleAllFollowUps
);
router.post('/:id/rerun-agents', requirePermission('discharge:initiate'), c.rerunAgents);
router.put('/:id/complete', requirePermission('discharge:complete'), c.completeDischarge);

export default router;
