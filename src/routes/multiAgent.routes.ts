import { Router } from 'express';
import * as c from '../controllers/multiAgent.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { rateLimit } from '../middleware/rateLimit.js';

/**
 * The four independent specialist agents, for signed-in staff.
 *
 * The limits are shaped by what each call costs rather than by how it looks.
 * A discharge summary sends an entire episode to an LLM and is the most
 * expensive thing here; the health probe is cheap and the UI polls it.
 *
 * The public, unauthenticated doors to the appointment and hospital agents
 * live in `public.routes.ts`, where the rate limits are tighter still.
 */
const router = Router();

const status = rateLimit({ windowMs: 60_000, max: 60 });
const chat = rateLimit({ windowMs: 60_000, max: 20 });
const generate = rateLimit({ windowMs: 60_000, max: 10 });

router.get('/health', status, c.health);

router.use(requireAuth);

const clinical = requireRole('physician', 'pharmacist', 'nurse', 'admin', 'care_coordinator');

/* ── Appointment Agent ──────────────────────────────────────────────────── */
router.post('/appointments/chat', chat, c.appointmentTurn);

/* ── Medication Agent ───────────────────────────────────────────────────── */
router.get('/medications/:patientId', status, c.listExplainableMedications);
router.post('/medications/explain', chat, c.explainMedication);

/* ── Discharge Summary Agent ────────────────────────────────────────────── */
router.get('/discharge-summaries', status, clinical, c.listSummarisablePackages);
router.post('/discharge-summaries/generate', generate, clinical, c.generateDischargeSummary);

/* ── General Hospital Assistant ─────────────────────────────────────────── */
router.post('/hospital/ask', chat, c.askHospital);

export default router;
