import { Router } from 'express';
import * as c from '../controllers/public.controller.js';
import { requirePortal } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import {
  portalLoginSchema,
  publicBookingSchema,
  triageSchema,
} from '../validators/index.js';

/**
 * Everything reachable without a token.
 *
 * Limits are deliberately tightest on the two endpoints that reveal whether a
 * person exists — portal login and booking as a returning patient. Reading the
 * department list is cheap and public by nature, so it is barely limited.
 */
const router = Router();

const browse = rateLimit({ windowMs: 60_000, max: 120 });
const compute = rateLimit({ windowMs: 60_000, max: 30 });
/**
 * Booking and portal sign-in get their own buckets. Sharing one meant a
 * family booking several appointments could lock themselves out of the
 * portal, which is a support call caused entirely by our own plumbing.
 */
const tooManyAttempts =
  'Too many attempts. For your security this has been paused for 15 minutes — ' +
  'please call the hospital on +91 44 4000 1200 if you need help.';

const booking = rateLimit({ windowMs: 15 * 60_000, max: 12, message: tooManyAttempts });
const signIn = rateLimit({ windowMs: 15 * 60_000, max: 10, message: tooManyAttempts });

/* ── Browsing the hospital ─────────────────────────────────────────────── */
router.get('/hospital', browse, c.hospitalInfo);
router.get('/specialties', browse, c.listSpecialties);
router.get('/doctors', browse, c.listDoctors);
router.get('/doctors/:id/slots', browse, c.doctorSlots);

/* ── Working out who to see ────────────────────────────────────────────── */
router.post('/triage', compute, validate(triageSchema), c.triage);
router.post('/emergency-check', compute, c.emergencyCheck);

/* ── The booking assistant ─────────────────────────────────────────────── */
// Conversational, but it creates real appointments, so it is limited like the
// booking form rather than like a chat toy.
router.get('/agent', browse, c.agentGreeting);
router.post('/agent', booking, c.agentTurn);

/* ── The hospital assistant ────────────────────────────────────────────── */
// An agent turn costs a model call, so it is limited more tightly than
// browsing but more generously than anything that writes a record.
const asking = rateLimit({ windowMs: 60_000, max: 10 });
router.post('/assistant/ask', asking, c.assistantAsk);

/* ── Booking and the portal ────────────────────────────────────────────── */
router.post('/appointments', booking, validate(publicBookingSchema), c.bookAppointment);
router.post('/portal/login', signIn, validate(portalLoginSchema), c.portalLogin);
router.get('/portal/me', requirePortal, c.portalMe);

/* ── The agents, acting for the signed-in patient ──────────────────────── */
// Scoped by the portal token alone: there is no patient id on the wire, so
// there is nothing for a caller to change.
router.post('/portal/assistant/appointments', requirePortal, booking, c.portalAppointmentTurn);
router.get('/portal/assistant/medications', requirePortal, browse, c.portalMedications);
router.post('/portal/assistant/medications', requirePortal, asking, c.portalExplainMedication);

export default router;
