import { Router } from 'express';
import * as c from '../controllers/dashboard.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);
router.get('/', c.getDashboard);

export default router;
