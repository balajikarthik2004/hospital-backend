import { Router } from 'express';
import * as c from '../controllers/analytics.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';

const router = Router();
router.use(requireAuth, requirePermission('analytics:view'));

router.get('/kpis', c.getKpis);
router.get('/discharge-volume', c.getDischargeVolume);
router.get('/agent-performance', c.getAgentPerformance);
router.get('/readmission-rate', c.getReadmissionRate);
router.get('/bed-occupancy', c.getBedOccupancy);
router.get('/funnel', c.getFunnel);
router.get('/workload', c.getWorkload);
router.get('/bed-turnover', c.getBedTurnover);

export default router;
