import { Router } from 'express';
import * as c from '../controllers/admission.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import {
  addLabSchema,
  addNoteSchema,
  createAdmissionSchema,
  updateAdmissionSchema,
} from '../validators/index.js';

const router = Router();
router.use(requireAuth);

router.post('/', requirePermission('patient:admit'), validate(createAdmissionSchema), c.createAdmission);
router.get('/', c.listAdmissions);
router.get('/active', c.activeAdmissions);
router.get('/:id', c.getAdmission);
router.put('/:id', requirePermission('patient:admit'), validate(updateAdmissionSchema), c.updateAdmission);
router.post('/:id/notes', requirePermission('notes:write'), validate(addNoteSchema), c.addNote);
router.post('/:id/labs', requirePermission('notes:write'), validate(addLabSchema), c.addLabResult);

export default router;
