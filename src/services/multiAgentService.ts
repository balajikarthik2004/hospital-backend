/**
 * Bridge to the independent specialist agents in `MultiAgents/`.
 *
 * That service owns four agents — appointment, medication, discharge summary
 * and general hospital assistant — and reads the same MongoDB this backend
 * writes, so nothing is copied across and nothing can drift. This file is the
 * only place that knows its URL or its wire shapes.
 *
 * Two things matter here and are deliberate:
 *
 * 1. **Identity is minted here, never accepted from the client.** The agents
 *    scope patient data by the `X-Patient-Id` header. If a browser could set
 *    it, any signed-in visitor could read any chart. So the header is always
 *    derived from the verified session: a patient's own `patientId` for portal
 *    sessions, `staff:<role>:<id>` for clinicians, `guest_visitor` otherwise.
 *    `identity_guard.py` on the other side then binds tool arguments to it.
 *
 * 2. **Being offline is a normal state, not an error.** The agents are an
 *    assistive layer over the clinical record. When the service is down the
 *    caller is told so plainly and the rest of the application is untouched.
 */

import { env } from '../config/env.js';
import type { Role } from '../models/User.js';

/* ── Identity ─────────────────────────────────────────────────────────────── */

/** A verified caller, in the form the Python side understands. */
export type AgentIdentity = string;

/** A patient acting on their own record. `patientId` is `PAT-YYYYMMDD-NNNN`. */
export function patientIdentity(patientId: string): AgentIdentity {
  return patientId.trim();
}

/**
 * A clinician. Deliberately *not* a `PAT…` string: `is_patient_identity` on
 * the Python side refuses to substitute this into a patient argument, so a
 * clinician asking about a named patient keeps that patient's id — which this
 * backend has already resolved and authorised — instead of silently becoming
 * the subject of the query.
 */
export function staffIdentity(user: { id: string; role: Role }): AgentIdentity {
  return `staff:${user.role}:${user.id}`;
}

export const GUEST_IDENTITY: AgentIdentity = 'guest_visitor';

/* ── Wire shapes (mirror MultiAgents/schemas) ─────────────────────────────── */

export interface MultiAgentHealth {
  online: boolean;
  url: string;
  status?: string;
  appName?: string;
  databaseConnected?: boolean;
  databaseError?: string | null;
  engine?: string;
  llmConfigured?: boolean;
  model?: string | null;
  /** Why it is unusable, when `online` is false. */
  error?: string;
}

export interface AppointmentChatResult {
  session_id: string;
  response: string;
  status: string;
  error?: string | null;
}

export interface MedicationDetailResult {
  medication_record_id: string;
  status: string;
  record: Record<string, unknown> | null;
  explanation: string;
  patient_id?: string | null;
  error?: string | null;
}

export interface CounsellingResult {
  prescription_id: string;
  status: string;
  counselling: string;
  error?: string | null;
}

export interface DischargeSummaryResult {
  package_id: string;
  status: string;
  report: string;
  source_data: Record<string, unknown> | null;
  missing_information: string[];
  patient_id?: string | null;
  error?: string | null;
}

export interface HospitalAnswerResult {
  question: string;
  status: string;
  answer: string;
  sources: string[];
  session_id?: string | null;
  error?: string | null;
}

/* ── Transport ────────────────────────────────────────────────────────────── */

/** Raised when the agent service itself refuses or cannot be reached. */
export class AgentServiceError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'AgentServiceError';
  }
}

async function request<T>(
  path: string,
  body: unknown,
  identity: AgentIdentity,
  timeoutMs = env.MULTI_AGENT_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${env.MULTI_AGENT_SERVICE_URL}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // The one source of identity. See the note at the top of the file.
        'X-Patient-Id': identity,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError';
    throw new AgentServiceError(
      503,
      aborted
        ? 'The assistant took too long to answer. Please try again in a moment.'
        : 'The assistant service is not running. Start it with `npm run dev:multiagents`.'
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    /* a non-JSON body is reported through the status below */
  }

  if (!res.ok) {
    // FastAPI puts the reason in `detail`; pass it through so a 403 on someone
    // else's record reads as that rather than as a generic failure.
    const detail = (payload as { detail?: unknown } | null)?.detail;
    const message =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((d) => (d as { msg?: string }).msg ?? String(d)).join('; ')
          : `The assistant service responded ${res.status}`;
    throw new AgentServiceError(res.status === 422 ? 400 : res.status, message);
  }

  return payload as T;
}

/* ── Health ───────────────────────────────────────────────────────────────── */

/**
 * Asks the service what it is, not merely whether a socket opened. A service
 * that is up but has no Groq key answers from verified database context only,
 * and the UI should be able to say so.
 */
export async function multiAgentHealth(): Promise<MultiAgentHealth> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(`${env.MULTI_AGENT_SERVICE_URL}/api/v1/health`, {
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        online: false,
        url: env.MULTI_AGENT_SERVICE_URL,
        error: `Responded ${res.status}`,
      };
    }
    const body = (await res.json()) as {
      status?: string;
      app_name?: string;
      database_connected?: boolean;
      database_error?: string | null;
      engine?: string;
      llm_configured?: boolean;
      model?: string | null;
    };
    return {
      online: true,
      url: env.MULTI_AGENT_SERVICE_URL,
      status: body.status,
      appName: body.app_name,
      databaseConnected: body.database_connected,
      databaseError: body.database_error ?? null,
      engine: body.engine,
      llmConfigured: body.llm_configured,
      model: body.model ?? null,
    };
  } catch (err) {
    return {
      online: false,
      url: env.MULTI_AGENT_SERVICE_URL,
      error:
        (err as Error).name === 'AbortError'
          ? 'No response within 2 seconds'
          : 'Not reachable',
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ── The four agents ──────────────────────────────────────────────────────── */

/** One turn of the appointment conversation, as the given patient. */
export function appointmentChat(
  identity: AgentIdentity,
  message: string,
  sessionId?: string | null
): Promise<AppointmentChatResult> {
  return request<AppointmentChatResult>(
    '/api/v1/appointments/chat',
    { message, session_id: sessionId ?? null },
    identity
  );
}

/** Explains one medication record in patient-friendly language. */
export function medicationDetails(
  identity: AgentIdentity,
  medicationRecordId: string,
  sessionId?: string | null
): Promise<MedicationDetailResult> {
  return request<MedicationDetailResult>(
    '/api/v1/medications/details',
    { medication_record_id: medicationRecordId, session_id: sessionId ?? null },
    identity
  );
}

/** Writes the take-home counselling sheet for one prescription. */
export function prescriptionCounselling(
  identity: AgentIdentity,
  prescriptionId: string,
  sessionId?: string | null
): Promise<CounsellingResult> {
  return request<CounsellingResult>(
    '/api/v1/medications/counselling',
    { prescription_id: prescriptionId, session_id: sessionId ?? null },
    identity
  );
}

/** Compiles the structured discharge summary report for one package. */
export function dischargeSummaryReport(
  identity: AgentIdentity,
  packageId: string,
  sessionId?: string | null
): Promise<DischargeSummaryResult> {
  return request<DischargeSummaryResult>(
    '/api/v1/discharge-summaries/generate',
    { package_id: packageId, session_id: sessionId ?? null },
    identity
  );
}

/** Answers a non-clinical hospital question. Open to guests. */
export function askHospital(
  identity: AgentIdentity,
  question: string,
  sessionId?: string | null
): Promise<HospitalAnswerResult> {
  return request<HospitalAnswerResult>(
    '/api/v1/hospital/ask',
    { question, session_id: sessionId ?? null },
    identity
  );
}
