/**
 * The staff-facing side of the four independent specialist agents.
 *
 * Every handler here does the same three things in the same order: establish
 * what the signed-in clinician is allowed to touch, mint the agent identity
 * from that (never from the request body), and forward. The agents read the
 * same database this backend writes, so there is nothing to copy across —
 * only an identity to get right.
 */

import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Patient } from '../models/Patient.js';
import { Medication } from '../models/Medication.js';
import { DischargePackage } from '../models/DischargePackage.js';
import { Admission } from '../models/Admission.js';
import { audit } from '../middleware/audit.js';
import { HttpError, asyncHandler, badRequest, notFound } from '../utils/helpers.js';
import {
  AgentServiceError,
  appointmentChat,
  askHospital,
  dischargeSummaryReport,
  medicationDetails,
  multiAgentHealth,
  patientIdentity,
  prescriptionCounselling,
  staffIdentity,
  type AgentIdentity,
} from '../services/multiAgentService.js';

/** The signed-in clinician, as the agents see them. */
function callerIdentity(req: Request): AgentIdentity {
  if (!req.user) throw badRequest('Authentication required');
  return staffIdentity(req.user);
}

/**
 * Resolves the patient a clinician has asked to act for and returns the
 * agent identity scoped to them.
 *
 * This is the one place a staff session is allowed to become a patient
 * identity. It is safe because the patient is looked up here, by ObjectId,
 * after `requireAuth` and the route's role guard — the browser supplies which
 * patient, never who the caller is.
 */
async function identityForPatient(req: Request, patientId: unknown): Promise<AgentIdentity> {
  if (!patientId) return callerIdentity(req);
  const id = String(patientId);
  if (!Types.ObjectId.isValid(id)) throw badRequest('Expected a patient ObjectId');

  const patient = await Patient.findById(id).select('patientId').lean();
  if (!patient) throw notFound('Patient');
  return patientIdentity(patient.patientId);
}

/**
 * Turns a transport failure into the status the client should see, so a
 * service that is simply not running reads as 503 rather than as a 500 the
 * clinician might take for a problem with the patient's record.
 */
function rethrow(err: unknown): never {
  if (err instanceof AgentServiceError) throw new HttpError(err.status, err.message);
  throw err;
}

/* ── Health ───────────────────────────────────────────────────────────────── */

/** GET /api/assistant/health — is the agent service up, and on what. */
export const health = asyncHandler(async (_req: Request, res: Response) => {
  const service = await multiAgentHealth();
  res.json({
    ...service,
    agents: [
      {
        key: 'general_hospital',
        name: 'General Hospital Assistant',
        blurb:
          'Departments, services, visiting hours and policies, answered from the database. Screens for emergencies first.',
        color: '#0891B2',
        scope: 'Open to everyone',
      },
      {
        key: 'appointment',
        name: 'Appointment Agent',
        blurb:
          'Finds doctors and live slots and books them, with the same double-booking guard as the scheduling screen.',
        color: '#7C3AED',
        scope: 'Acts for one patient',
      },
      {
        key: 'medication',
        name: 'Medication Agent',
        blurb:
          'Explains one medication record — what it is, its strength, route and instructions — in plain language.',
        color: '#D97706',
        scope: 'Acts for one patient',
      },
      {
        key: 'discharge_summary',
        name: 'Discharge Summary Agent',
        blurb:
          'Compiles a structured report from the admission, medications, labs, notes and vitals, and lists what is missing.',
        color: '#059669',
        scope: 'Clinical staff',
      },
    ],
  });
});

/* ── General hospital assistant ───────────────────────────────────────────── */

/** POST /api/assistant/hospital/ask */
export const askHospitalQuestion = asyncHandler(async (req: Request, res: Response) => {
  const { question, sessionId } = req.body;
  try {
    const result = await askHospital(callerIdentity(req), question, sessionId);
    res.json(result);
  } catch (err) {
    rethrow(err);
  }
});

/* ── Appointment agent ────────────────────────────────────────────────────── */

/**
 * POST /api/assistant/appointments/chat
 *
 * `patientId` is optional. With it, the conversation is scoped to that
 * patient and the agent's own identity binding applies, so it can only read
 * and book for them. Without it the clinician is asking in general terms —
 * about a doctor's availability, say — and no chart is in scope at all.
 */
export const appointmentTurn = asyncHandler(async (req: Request, res: Response) => {
  const { message, sessionId, patientId } = req.body;
  const identity = await identityForPatient(req, patientId);

  try {
    const result = await appointmentChat(identity, message, sessionId);

    // Booking is a real clinical action, so the turn that performs it has to
    // be attributable. The agent writes the appointment itself, so this is
    // the only record that a person asked for it.
    if (patientId) {
      await audit(req, {
        action: 'assistant.appointment-turn',
        entity: 'Patient',
        entityId: String(patientId),
        patientId: String(patientId),
        description: `Appointment assistant turn as ${identity}: "${String(message).slice(0, 140)}"`,
      });
    }

    res.json(result);
  } catch (err) {
    rethrow(err);
  }
});

/* ── Medication agent ─────────────────────────────────────────────────────── */

/** POST /api/assistant/medications/explain */
export const explainMedication = asyncHandler(async (req: Request, res: Response) => {
  const { medicationRecordId, sessionId } = req.body;
  try {
    const result = await medicationDetails(callerIdentity(req), medicationRecordId, sessionId);
    res.json(result);
  } catch (err) {
    rethrow(err);
  }
});

/** POST /api/assistant/medications/counselling */
export const counselPrescription = asyncHandler(async (req: Request, res: Response) => {
  const { prescriptionId, sessionId } = req.body;
  try {
    const result = await prescriptionCounselling(callerIdentity(req), prescriptionId, sessionId);
    res.json(result);
  } catch (err) {
    rethrow(err);
  }
});

/* ── Discharge summary agent ──────────────────────────────────────────────── */

/** POST /api/assistant/discharge/summary */
export const dischargeSummary = asyncHandler(async (req: Request, res: Response) => {
  const { packageId, sessionId } = req.body;
  try {
    const result = await dischargeSummaryReport(callerIdentity(req), packageId, sessionId);

    await audit(req, {
      action: 'assistant.discharge-summary',
      entity: 'DischargePackage',
      description: `Compiled the discharge summary report for ${packageId}`,
    });

    res.json(result);
  } catch (err) {
    rethrow(err);
  }
});

/* ── What the agents can be pointed at ────────────────────────────────────── */

/**
 * GET /api/assistant/patients/:id/context
 *
 * The identifiers the medication and discharge agents accept, for one
 * patient. The medication agent works on an *embedded item's* ObjectId, which
 * nothing else in the API exposes, so the picker would otherwise have no way
 * to offer a real one.
 */
export const patientContext = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!Types.ObjectId.isValid(id)) throw badRequest('Expected a patient ObjectId');

  const patient = await Patient.findById(id)
    .select('patientId demographics.firstName demographics.lastName')
    .lean();
  if (!patient) throw notFound('Patient');

  const [lists, packages, admissions] = await Promise.all([
    Medication.find({ patientId: patient._id }).select('listType medications').lean(),
    DischargePackage.find({ patientId: patient._id })
      .select('packageId status initiatedAt')
      .sort('-initiatedAt')
      .limit(20)
      .lean(),
    Admission.find({ patientId: patient._id })
      .select('admissionId admissionDate admittingDiagnosis status')
      .sort('-admissionDate')
      .limit(20)
      .lean(),
  ]);

  const LIST_LABEL: Record<string, string> = {
    pre_admission: 'Pre-admission',
    inpatient: 'Inpatient',
    discharge: 'Discharge',
  };

  const medications = lists.flatMap((list) =>
    (list.medications ?? []).map((item) => ({
      // What the agent calls `medication_record_id`.
      medicationRecordId: String(item._id),
      drugName: item.drugName,
      dosage: item.dosage,
      frequency: item.frequency,
      route: item.route,
      isActive: item.isActive,
      listType: list.listType,
      listLabel: LIST_LABEL[list.listType] ?? list.listType,
    }))
  );

  res.json({
    patient: {
      _id: String(patient._id),
      patientId: patient.patientId,
      name: `${patient.demographics.firstName} ${patient.demographics.lastName}`,
    },
    medications,
    dischargePackages: packages.map((p) => ({
      _id: String(p._id),
      packageId: p.packageId,
      status: p.status,
      initiatedAt: p.initiatedAt,
    })),
    admissions: admissions.map((a) => ({
      _id: String(a._id),
      admissionId: a.admissionId,
      admissionDate: a.admissionDate,
      admittingDiagnosis: a.admittingDiagnosis,
      status: a.status,
    })),
  });
});
