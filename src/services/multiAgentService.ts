import { env } from '../config/env.js';
import { HttpError } from '../utils/helpers.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Client for the Python multi-agent service.

   Four independent specialist agents, each with its own endpoint and no
   orchestrator between them:

     Appointment        conversational booking, with real double-booking checks
     Medication         explains one verified medication record to a patient
     Discharge Summary  compiles a verified discharge package into a report
     General Hospital   departments, services, policies, emergency triage

   They read the same MongoDB this backend writes, so nothing here passes
   clinical data down to the agents — only identifiers and the caller's
   verified identity. That matters: it means the agent cannot be talked into
   reporting a record the database does not hold.

   Every call is identity-scoped. `X-Patient-Id` is how the service decides
   whose records may be read, so it is derived from the session here and is
   never taken from the client.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface MultiAgentHealth {
  online: boolean;
  status?: string;
  appName?: string;
  databaseConnected?: boolean;
  databaseError?: string | null;
  error?: string;
}

export interface AppointmentChatResult {
  session_id: string;
  response: string;
  status: 'success' | 'error' | 'rate_limited';
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

export interface DischargeSummaryResult {
  package_id: string;
  status: string;
  report: string;
  source_data?: Record<string, unknown> | null;
  patient_id?: string | null;
  error?: string | null;
}

export interface CounsellingResult {
  prescription_id: string;
  status: string;
  counselling: string;
  error?: string | null;
}

export interface HospitalAskResult {
  question: string;
  status: string;
  answer: string;
  sources: string[];
  session_id?: string | null;
  error?: string | null;
}

/** Short timeout for liveness; a health probe must never hold a request open. */
const HEALTH_TIMEOUT_MS = 2_000;

function serviceUrl(path: string): string {
  return `${env.MULTI_AGENT_SERVICE_URL.replace(/\/$/, '')}${path}`;
}

/**
 * Is the agent service up, and can it reach the database?
 *
 * Reports what the service says about itself rather than inferring health
 * from a socket connecting — a service that answers but cannot read MongoDB
 * is not healthy, and claiming otherwise hides the real fault.
 */
export async function multiAgentHealth(): Promise<MultiAgentHealth> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(serviceUrl('/api/v1/health'), { signal: controller.signal });
    if (!res.ok) return { online: false, error: `Service responded ${res.status}` };
    const body = (await res.json()) as {
      status?: string;
      app_name?: string;
      database_connected?: boolean;
      database_error?: string | null;
    };
    return {
      online: true,
      status: body.status,
      appName: body.app_name,
      databaseConnected: body.database_connected,
      databaseError: body.database_error ?? null,
    };
  } catch (err) {
    return { online: false, error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POSTs to the agent service and unwraps its reply.
 *
 * The service's own error detail is passed through rather than flattened to
 * "something went wrong": "Discharge package DIS-… not found" is actionable,
 * and the service already sanitizes anything sensitive out of it.
 */
async function post<T>(path: string, body: unknown, callerId: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.MULTI_AGENT_TIMEOUT_MS);

  try {
    const res = await fetch(serviceUrl(path), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // The service authorises reads against this. It is derived from the
        // verified session upstream, never from client input.
        'X-Patient-Id': callerId,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      let detail = `Agent service responded ${res.status}`;
      try {
        const payload = (await res.json()) as { detail?: string };
        if (payload?.detail) detail = payload.detail;
      } catch {
        /* the body was not JSON; the status line is all we have */
      }
      // 404 and 403 are real answers about a record, not service faults, so
      // they keep their status instead of becoming a 502.
      const status = res.status === 404 || res.status === 403 ? res.status : 502;
      throw new HttpError(status, detail);
    }

    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if ((err as Error).name === 'AbortError') {
      throw new HttpError(
        504,
        'The AI assistant took too long to respond. Please try again.'
      );
    }
    throw new HttpError(
      503,
      `The AI assistant is unavailable: ${(err as Error).message}`
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Conversational appointment booking. Creates real appointments. */
export async function appointmentChat(
  callerId: string,
  message: string,
  sessionId?: string | null
): Promise<AppointmentChatResult> {
  return post<AppointmentChatResult>(
    '/api/v1/appointments/chat',
    { message, session_id: sessionId ?? null },
    callerId
  );
}

/** Explains one verified medication record in patient-friendly language. */
export async function medicationDetails(
  callerId: string,
  medicationRecordId: string,
  sessionId?: string | null
): Promise<MedicationDetailResult> {
  return post<MedicationDetailResult>(
    '/api/v1/medications/details',
    { medication_record_id: medicationRecordId, session_id: sessionId ?? null },
    callerId
  );
}

/** Compiles a verified discharge package into a structured report. */
export async function dischargeSummary(
  callerId: string,
  packageId: string,
  sessionId?: string | null
): Promise<DischargeSummaryResult> {
  return post<DischargeSummaryResult>(
    '/api/v1/discharge-summaries/generate',
    { package_id: packageId, session_id: sessionId ?? null },
    callerId
  );
}

/**
 * Turns a dispensed prescription into the plain-language sheet the patient
 * takes home. The agent reads the prescription from the database by id — the
 * drugs and doses are never passed in, so it cannot counsel on something that
 * was not actually prescribed.
 */
export async function prescriptionCounselling(
  callerId: string,
  prescriptionId: string,
  sessionId?: string | null
): Promise<CounsellingResult> {
  return post<CounsellingResult>(
    '/api/v1/medications/counselling',
    { prescription_id: prescriptionId, session_id: sessionId ?? null },
    callerId
  );
}

/** Answers general hospital questions, with emergency triage screening. */
export async function hospitalAsk(
  callerId: string,
  question: string,
  sessionId?: string | null
): Promise<HospitalAskResult> {
  return post<HospitalAskResult>(
    '/api/v1/hospital/ask',
    { question, session_id: sessionId ?? null },
    callerId
  );
}

/** The agent roster the UI renders. Static: it describes the service's shape. */
export const MULTI_AGENTS = [
  {
    key: 'appointment',
    name: 'Appointment Agent',
    description:
      'Finds doctors by specialty, checks live slot availability and books appointments with double-booking protection.',
    endpoint: '/api/multi-agent/appointments/chat',
    color: '#0891B2',
    capabilities: [
      'list_specialties',
      'get_doctors_by_specialty',
      'get_doctor_details',
      'get_available_doctor_slots',
      'check_slot_availability',
      'get_appointment_details',
      'get_patient_appointments',
      'create_appointment',
      'cancel_appointment',
    ],
  },
  {
    key: 'medication',
    name: 'Medication Agent',
    description:
      'Retrieves a verified medication record and explains it in plain language, without inventing clinical advice.',
    endpoint: '/api/multi-agent/medications/explain',
    color: '#7C3AED',
    capabilities: [
      'get_medication_by_record_id',
      'list_medications_for_patient',
      'list_medications_for_admission',
      'get_prescription_by_id',
      'list_prescriptions_for_patient',
      'prescription_counselling',
    ],
  },
  {
    key: 'discharge_summary',
    name: 'Discharge Summary Agent',
    description:
      'Compiles a verified discharge package — admission, medications, procedures, labs, notes and vitals — into a structured report.',
    endpoint: '/api/multi-agent/discharge-summaries/generate',
    color: '#059669',
    capabilities: ['get_discharge_package_by_id', 'list_discharge_packages'],
  },
  {
    key: 'general_hospital',
    name: 'General Hospital Assistant',
    description:
      'Answers questions about departments, services, visiting hours and policies, and screens for emergencies.',
    endpoint: '/api/multi-agent/hospital/ask',
    color: '#D97706',
    capabilities: [
      'search_hospital_departments',
      'search_hospital_services',
      'get_hospital_information',
      'search_hospital_policies',
    ],
  },
] as const;
