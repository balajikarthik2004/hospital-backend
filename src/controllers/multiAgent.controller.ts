import type { Request, Response } from 'express';
import { Patient } from '../models/Patient.js';
import { Medication } from '../models/Medication.js';
import { DischargePackage } from '../models/DischargePackage.js';
import { audit } from '../middleware/audit.js';
import { asyncHandler, badRequest, forbidden, notFound } from '../utils/helpers.js';
import { env } from '../config/env.js';
import {
  MULTI_AGENTS,
  appointmentChat,
  dischargeSummary,
  hospitalAsk,
  medicationDetails,
  multiAgentHealth,
} from '../services/multiAgentService.js';

/* ═══════════════════════════════════════════════════════════════════════════
   The four independent specialist agents, exposed to the application.

   Two rules hold across this file:

   1. **Identity is derived, never accepted.** The agent service authorises
      record access against the `X-Patient-Id` it is sent. If a client could
      choose that value, the whole authorisation model would be decorative.
      Every handler here resolves the caller from the session instead.

   2. **Writes and record reads are audited.** An agent booking an
      appointment or opening a chart is an action by the hospital, and the
      audit trail has to show it happened and who asked for it.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The identity the agent service should authorise against.
 *
 * A patient (portal or `role: patient`) is scoped to their own chart. Staff
 * are passed a role-prefixed token, which the agent service treats as a
 * clinician rather than matching it against a patient id — that is why the
 * `PAT` prefix matters and why a staff token must never start with one.
 */
function callerIdentity(req: Request): string {
  const portalPatientId = (req as Request & { portalPatientId?: string }).portalPatientId;
  if (portalPatientId) return portalPatientId;

  const user = req.user;
  if (!user) return 'guest_visitor';
  if (user.role === 'patient' && user.patientRef) return String(user.patientRef);
  return `staff:${user.role}:${user.id}`;
}

/** Resolves the caller to a patient chart, when they are one. */
async function callerPatient(req: Request) {
  const portalPatientId = (req as Request & { portalPatientId?: string }).portalPatientId;
  const ref = portalPatientId ?? (req.user?.role === 'patient' ? req.user.patientRef : null);
  if (!ref) return null;
  return Patient.findById(ref).lean();
}

function isStaff(req: Request): boolean {
  return Boolean(req.user && req.user.role !== 'patient');
}

/**
 * The patient-scoped identity the agent service needs for a chart read.
 *
 * Staff get the owning patient's id, because they are entitled to the record
 * and the agent authorises on it. Patients get their own, which is the same
 * check expressed from the other side.
 */
async function identityForPatientRecord(
  req: Request,
  ownerPatientId: unknown
): Promise<string> {
  if (isStaff(req)) {
    const owner = await Patient.findById(ownerPatientId).select('patientId').lean();
    if (!owner) throw notFound('Patient');
    return owner.patientId;
  }

  const patient = await callerPatient(req);
  if (!patient) throw forbidden('No patient record is linked to this session');
  if (String(patient._id) !== String(ownerPatientId)) {
    throw forbidden('You may only access your own records');
  }
  return patient.patientId;
}

/* ── Status ─────────────────────────────────────────────────────────────── */

/** GET /api/multi-agent/health — is the agent service up, and what does it offer? */
export const health = asyncHandler(async (_req: Request, res: Response) => {
  const service = await multiAgentHealth();
  res.json({
    online: service.online,
    service: {
      url: env.MULTI_AGENT_SERVICE_URL,
      status: service.status ?? null,
      name: service.appName ?? null,
      // The agents read this backend's MongoDB, so a database fault here is
      // the same fault the rest of the application would see.
      databaseConnected: service.databaseConnected ?? null,
      databaseError: service.databaseError ?? null,
      error: service.error ?? null,
    },
    agents: MULTI_AGENTS,
  });
});

/* ── Appointment Agent ──────────────────────────────────────────────────── */

/** POST /api/multi-agent/appointments/chat */
export const appointmentTurn = asyncHandler(async (req: Request, res: Response) => {
  const message = String(req.body?.message ?? '').trim();
  if (!message) throw badRequest('Please type a message for the appointment assistant');

  // Booking needs a patient to book for. Staff must name one.
  let identity: string;
  if (isStaff(req)) {
    const onBehalfOf = String(req.body?.patientId ?? '').trim();
    if (!onBehalfOf) {
      throw badRequest(
        'Choose which patient this booking is for before using the appointment assistant'
      );
    }
    const patient = await Patient.findOne({
      $or: [{ patientId: onBehalfOf }, ...(onBehalfOf.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: onBehalfOf }] : [])],
    })
      .select('patientId')
      .lean();
    if (!patient) throw notFound('Patient');
    identity = patient.patientId;
  } else {
    const patient = await callerPatient(req);
    if (!patient) throw forbidden('No patient record is linked to this session');
    identity = patient.patientId;
  }

  const result = await appointmentChat(identity, message, req.body?.sessionId ?? null);

  // The agent writes real appointments, so record that a turn ran against
  // this chart. The reply text itself is not stored: it can carry clinical
  // detail and the appointment record is the durable artefact.
  await audit(req, {
    action: 'agent.appointment.chat',
    entity: 'Appointment',
    description: `Appointment assistant turn for ${identity} (status ${result.status})`,
  });

  res.json({
    sessionId: result.session_id,
    reply: result.response,
    status: result.status,
    patientId: identity,
  });
});

/* ── Medication Agent ───────────────────────────────────────────────────── */

/** GET /api/multi-agent/medications/:patientId — the records that can be explained. */
export const listExplainableMedications = asyncHandler(
  async (req: Request, res: Response) => {
    const requested = String(req.params.patientId ?? '').trim();

    let patient;
    if (isStaff(req)) {
      patient = await Patient.findOne({
        $or: [
          { patientId: requested },
          ...(requested.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: requested }] : []),
        ],
      })
        .select('patientId demographics.firstName demographics.lastName')
        .lean();
      if (!patient) throw notFound('Patient');
    } else {
      patient = await callerPatient(req);
      if (!patient) throw forbidden('No patient record is linked to this session');
      if (patient.patientId !== requested && String(patient._id) !== requested) {
        throw forbidden('You may only view your own medications');
      }
    }

    const lists = await Medication.find({ patientId: patient._id }).lean();

    // Each embedded item's own _id is the identifier the agent explains by.
    const records = lists.flatMap((list) =>
      (list.medications ?? []).map((item) => ({
        medicationRecordId: String(item._id),
        drugName: item.drugName,
        genericName: item.genericName,
        drugClass: item.drugClass,
        dosage: item.dosage,
        frequency: item.frequency,
        route: item.route,
        listType: list.listType,
        isActive: item.isActive,
      }))
    );

    res.json({
      patientId: patient.patientId,
      count: records.length,
      records,
    });
  }
);

/** POST /api/multi-agent/medications/explain */
export const explainMedication = asyncHandler(async (req: Request, res: Response) => {
  const recordId = String(req.body?.medicationRecordId ?? '').trim();
  if (!recordId) throw badRequest('A medication record must be chosen');

  // Resolve the owning chart before calling out, so authorisation is decided
  // here rather than inferred from whatever the agent happens to return.
  const owner = await Medication.findOne({ 'medications._id': recordId })
    .select('patientId')
    .lean();
  if (!owner) throw notFound('Medication record');

  const identity = await identityForPatientRecord(req, owner.patientId);
  const result = await medicationDetails(identity, recordId, req.body?.sessionId ?? null);

  await audit(req, {
    action: 'agent.medication.explain',
    entity: 'Medication',
    entityId: recordId,
    patientId: owner.patientId as never,
    description: `Medication agent explained record ${recordId}`,
  });

  res.json({
    medicationRecordId: result.medication_record_id,
    status: result.status,
    record: result.record,
    explanation: result.explanation,
  });
});

/* ── Discharge Summary Agent ────────────────────────────────────────────── */

/** GET /api/multi-agent/discharge-summaries — packages a report can be built from. */
export const listSummarisablePackages = asyncHandler(
  async (req: Request, res: Response) => {
    if (!isStaff(req)) throw forbidden('Discharge packages are staff-only');

    const packages = await DischargePackage.find({})
      .select('packageId status patientId admissionId initiatedAt completedAt')
      .populate('patientId', 'patientId demographics.firstName demographics.lastName')
      .populate('admissionId', 'admissionId admittingDiagnosis')
      .sort({ initiatedAt: -1 })
      .limit(100)
      .lean();

    res.json({
      count: packages.length,
      packages: packages.map((pkg) => {
        const patient = pkg.patientId as unknown as {
          patientId?: string;
          demographics?: { firstName?: string; lastName?: string };
        } | null;
        const admission = pkg.admissionId as unknown as {
          admissionId?: string;
          admittingDiagnosis?: string;
        } | null;
        return {
          packageId: pkg.packageId,
          status: pkg.status,
          patientId: patient?.patientId ?? null,
          patientName: patient?.demographics
            ? `${patient.demographics.firstName ?? ''} ${patient.demographics.lastName ?? ''}`.trim()
            : null,
          admissionId: admission?.admissionId ?? null,
          admittingDiagnosis: admission?.admittingDiagnosis ?? null,
          initiatedAt: pkg.initiatedAt,
          completedAt: pkg.completedAt,
        };
      }),
    });
  }
);

/** POST /api/multi-agent/discharge-summaries/generate */
export const generateDischargeSummary = asyncHandler(
  async (req: Request, res: Response) => {
    const packageId = String(req.body?.packageId ?? '').trim();
    if (!packageId) throw badRequest('A discharge package must be chosen');

    const pkg = await DischargePackage.findOne({ packageId })
      .select('packageId patientId')
      .lean();
    if (!pkg) throw notFound('Discharge package');

    const identity = await identityForPatientRecord(req, pkg.patientId);
    const result = await dischargeSummary(identity, packageId, req.body?.sessionId ?? null);

    await audit(req, {
      action: 'agent.discharge-summary.generate',
      entity: 'DischargePackage',
      entityId: pkg._id,
      patientId: pkg.patientId as never,
      description: `Discharge summary agent compiled a report for ${packageId}`,
    });

    res.json({
      packageId: result.package_id,
      status: result.status,
      report: result.report,
      sourceData: result.source_data ?? null,
    });
  }
);

/* ── General Hospital Agent ─────────────────────────────────────────────── */

/** POST /api/multi-agent/hospital/ask — open to guests as well as signed-in users. */
export const askHospital = asyncHandler(async (req: Request, res: Response) => {
  const question = String(req.body?.question ?? '').trim();
  if (!question) throw badRequest('Please type a question');

  const result = await hospitalAsk(
    callerIdentity(req),
    question,
    req.body?.sessionId ?? null
  );

  res.json({
    question: result.question,
    status: result.status,
    answer: result.answer,
    sources: result.sources ?? [],
    sessionId: result.session_id ?? null,
    // The service flags acute symptoms before the model sees them, so the
    // client can render an emergency banner rather than a chat bubble.
    isEmergency: result.status === 'emergency_alert',
  });
});
