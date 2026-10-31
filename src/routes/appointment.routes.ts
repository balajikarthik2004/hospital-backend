import { Router } from 'express';
import * as c from '../controllers/appointment.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission, scopePatientAccess } from '../middleware/rbac.js';
import { validate } from '../middleware/validate.js';
import { createAppointmentSchema, updateAppointmentSchema } from '../validators/index.js';

const router = Router();
router.use(requireAuth);

router.post(
  '/',
  requirePermission('appointment:schedule'),
  validate(createAppointmentSchema),
  c.createAppointment
);
router.get('/', c.listAppointments);
router.get('/workload', c.doctorWorkload);
router.get('/doctor/:doctorId/slots', c.doctorSlots);
router.get('/patient/:patientId', scopePatientAccess('patientId'), c.patientAppointments);
router.get('/:id', c.getAppointment);
router.put(
  '/:id',
  requirePermission('appointment:schedule'),
  validate(updateAppointmentSchema),
  c.updateAppointment
);
router.delete('/:id', requirePermission('appointment:schedule'), c.cancelAppointment);

export default router;
