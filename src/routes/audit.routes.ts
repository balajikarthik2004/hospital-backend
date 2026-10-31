import { Router } from 'express';
import * as c from '../controllers/audit.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';

const router = Router();
router.use(requireAuth, requirePermission('audit:view'));

router.get('/', c.listAuditLogs);
router.get('/export', c.exportAuditCsv);
router.get('/patient/:patientId', c.patientAuditTrail);

export default router;
