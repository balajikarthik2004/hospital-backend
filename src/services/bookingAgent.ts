import type { Request } from 'express';
import { Specialty } from '../models/Specialty.js';
import { User } from '../models/User.js';
import { suggestSpecialty } from './triageService.js';
import {
  createPublicBooking,
  findPatientByIdentifier,
  freeSlots,
  isoDate,
  upcomingClinicDays,
  LOOKUP_FAILED,
} from './bookingService.js';

/* ═══════════════════════════════════════════════════════════════════════════
   The booking assistant.

   A deterministic state machine, not a chat model pretending to be one. Three
   reasons it is built this way:

   1. It books real appointments against real charts. A model that improvises
      a slot, a department or a date of birth is not a feature.
   2. It must work with no API key at all, like every other agent here.
   3. Every question it asks is one the form already asks, so the two front
      doors stay answerable by the same validation.

   Free text is still free text — the complaint is passed to triage verbatim,
   and names and numbers are parsed, not guessed. The conversation is driven
   entirely server-side: the client renders what it is told and sends back a
   message or a choice. Nothing about the flow is decided in the browser.
   ═══════════════════════════════════════════════════════════════════════════ */

export type AgentStep =
  | 'greeting'
  | 'who'
  | 'identify'
  | 'identifyDob'
  | 'name'
  | 'dob'
  | 'phone'
  | 'symptoms'
  | 'department'
  | 'doctor'
  | 'date'
  | 'slot'
  | 'confirm'
  | 'done'
  | 'emergency';

export interface AgentState {
  step: AgentStep;
  isNew?: boolean;
  identifier?: string;
  dateOfBirth?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  complaint?: string;
  specialty?: string;
  specialtyName?: string;
  triageReason?: string;
  triageConfidence?: number;
  triageMatched?: string[];
  overrode?: boolean;
  doctorId?: string;
  doctorName?: string;
  date?: string;
  time?: string;
  /** Set once booked, so a repeated submit cannot double-book. */
  appointmentId?: string;
  patientId?: string;
}

export interface AgentOption {
  label: string;
  value: string;
  /** Rendered differently — used for "something else" style escapes. */
  subtle?: boolean;
}

export interface AgentReply {
  state: AgentState;
  /** What the assistant says. Several bubbles read better than one wall. */
  say: string[];
  options?: AgentOption[];
  input?: { type: 'text' | 'tel' | 'date'; placeholder: string } | null;
  /** Rendered as a highlighted card at the end of the conversation. */
  booking?: {
    appointmentId: string;
    patientId: string;
    isNew: boolean;
    doctorName: string;
    department: string;
    date: string;
    time: string;
  };
  emergency?: { advice: string };
}

const HELP_LINE = '+91 44 4000 1200';

export function greeting(): AgentReply {
  return {
    state: { step: 'who' },
    say: [
      'Hello — I can book you an appointment in about a minute.',
      'Have you been to Aarogya before?',
    ],
    options: [
      { label: 'I am a new patient', value: 'new' },
      { label: 'I have been here before', value: 'returning' },
    ],
    input: null,
  };
}

/**
 * Advances the conversation by one turn.
 *
 * @param state  Where the conversation had got to. Client-held, server-owned:
 *               it is re-validated at every step and the booking is re-checked
 *               against the database, so a tampered state cannot book a slot
 *               that is taken or a patient that does not exist.
 */
export async function respond(
  state: AgentState,
  message: string,
  req: Request | null = null
): Promise<AgentReply> {
  const text = String(message ?? '').trim();

  // Available from anywhere, including the two terminal states.
  if (text === 'restart') return greeting();

  switch (state.step) {
    case 'who':
      return who(state, text);
    case 'identify':
      return identify(state, text);
    case 'identifyDob':
      return identifyDob(state, text);
    case 'name':
      return name(state, text);
    case 'dob':
      return dob(state, text);
    case 'phone':
      return phone(state, text);
    case 'symptoms':
      return symptoms(state, text);
    case 'department':
      return department(state, text);
    case 'doctor':
      return doctor(state, text);
    case 'date':
      return date(state, text);
    case 'slot':
      return slot(state, text);
    case 'confirm':
      return confirm(state, text, req);

    // A finished conversation must not quietly restart. Someone who closes
    // the widget and reopens it should still be told their reference rather
    // than being walked through booking a second appointment by accident.
    case 'done':
      return {
        state,
        say: [
          state.appointmentId
            ? `You are already booked — your reference is ${state.appointmentId}.`
            : 'That booking is already complete.',
          'Would you like to book another appointment?',
        ],
        options: [{ label: 'Book another', value: 'restart' }],
        input: null,
      };

    // Likewise an emergency: repeat the advice rather than resuming booking.
    case 'emergency':
      return {
        state,
        say: [
          'Please call 108 now, or go straight to Casualty — it is open 24 hours.',
          `If you would rather speak to someone here, call ${HELP_LINE}.`,
        ],
        options: [{ label: 'Start a new booking', value: 'restart', subtle: true }],
        input: null,
      };

    default:
      return greeting();
  }
}

/* ── Who ─────────────────────────────────────────────────────────────── */

function who(state: AgentState, text: string): AgentReply {
  const returning = /return|been|before|existing|old|yes/i.test(text) || text === 'returning';
  const isNew = text === 'new' || (!returning && /new|first/i.test(text));

  if (!isNew && !returning) {
    return {
      state,
      say: ['Sorry — have you visited the hospital before, or is this your first time?'],
      options: [
        { label: 'I am a new patient', value: 'new' },
        { label: 'I have been here before', value: 'returning' },
      ],
      input: null,
    };
  }

  if (returning) {
    return {
      state: { ...state, isNew: false, step: 'identify' },
      say: ['Welcome back. What is your patient ID, or the mobile number we have for you?'],
      input: { type: 'text', placeholder: 'PAT-… or 98765 43210' },
    };
  }

  return {
    state: { ...state, isNew: true, step: 'name' },
    say: ['Happy to help. What is your full name?'],
    input: { type: 'text', placeholder: 'Senthil Kumar' },
  };
}

/* ── Returning patient ───────────────────────────────────────────────── */

function identify(state: AgentState, text: string): AgentReply {
  if (text.length < 3) {
    return {
      state,
      say: ['That does not look right. Your patient ID or mobile number, please.'],
      input: { type: 'text', placeholder: 'PAT-… or 98765 43210' },
    };
  }
  return {
    state: { ...state, identifier: text, step: 'identifyDob' },
    say: [
      'Thank you. And your date of birth?',
      'I ask so that nobody else can open your record with just a phone number.',
    ],
    input: { type: 'date', placeholder: 'YYYY-MM-DD' },
  };
}

async function identifyDob(state: AgentState, text: string): Promise<AgentReply> {
  const parsed = parseDate(text);
  if (!parsed) {
    return {
      state,
      say: ['I could not read that date. Please pick your date of birth.'],
      input: { type: 'date', placeholder: 'YYYY-MM-DD' },
    };
  }

  const patient = await findPatientByIdentifier(state.identifier, parsed);
  if (!patient) {
    // Same message whichever half was wrong — see bookingService.
    return {
      state: { ...state, step: 'identify' },
      say: [
        LOOKUP_FAILED,
        'Shall we try again, or would you rather register as a new patient?',
      ],
      options: [
        { label: 'Try again', value: 'retry' },
        { label: 'Register as new', value: 'new' },
      ],
      input: { type: 'text', placeholder: 'PAT-… or 98765 43210' },
    };
  }

  return {
    state: {
      ...state,
      dateOfBirth: parsed,
      firstName: patient.demographics.firstName,
      step: 'symptoms',
    },
    say: [
      `Found you, ${patient.demographics.firstName}.`,
      'What is troubling you? Describe it in your own words — the doctor will see exactly what you write.',
    ],
    input: { type: 'text', placeholder: 'A dull ache in my lower back for three weeks…' },
  };
}

/* ── New patient ─────────────────────────────────────────────────────── */

function name(state: AgentState, text: string): AgentReply {
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return {
      state,
      say: ['Could I have both your first and last name?'],
      input: { type: 'text', placeholder: 'Senthil Kumar' },
    };
  }
  return {
    state: {
      ...state,
      firstName: parts[0],
      lastName: parts.slice(1).join(' '),
      step: 'dob',
    },
    say: [`Thank you, ${parts[0]}. What is your date of birth?`],
    input: { type: 'date', placeholder: 'YYYY-MM-DD' },
  };
}

function dob(state: AgentState, text: string): AgentReply {
  const parsed = parseDate(text);
  if (!parsed) {
    return {
      state,
      say: ['I could not read that date. Please pick your date of birth.'],
      input: { type: 'date', placeholder: 'YYYY-MM-DD' },
    };
  }
  if (new Date(parsed).getTime() > Date.now()) {
    return {
      state,
      say: ['That date is in the future. Please pick your date of birth.'],
      input: { type: 'date', placeholder: 'YYYY-MM-DD' },
    };
  }
  return {
    state: { ...state, dateOfBirth: parsed, step: 'phone' },
    say: ['And a mobile number, so we can send you a reminder?'],
    input: { type: 'tel', placeholder: '98765 43210' },
  };
}

function phone(state: AgentState, text: string): AgentReply {
  const digits = text.replace(/\D/g, '');
  if (digits.length < 10) {
    return {
      state,
      say: ['That number looks short. Could you type the full mobile number?'],
      input: { type: 'tel', placeholder: '98765 43210' },
    };
  }
  return {
    state: { ...state, phone: text, step: 'symptoms' },
    say: [
      'Thank you. Now, what is troubling you?',
      'Describe it in your own words — the doctor will see exactly what you write.',
    ],
    input: { type: 'text', placeholder: 'A dull ache in my lower back for three weeks…' },
  };
}

/* ── Symptoms and triage ─────────────────────────────────────────────── */

async function symptoms(state: AgentState, text: string): Promise<AgentReply> {
  if (text.length < 3) {
    return {
      state,
      say: ['Tell me a little more — even a few words helps me find the right department.'],
      input: { type: 'text', placeholder: 'Chest pain when I climb stairs' },
    };
  }

  const age = state.dateOfBirth ? yearsSince(state.dateOfBirth) : undefined;
  const result = await suggestSpecialty(text, [], age);

  // An emergency ends the conversation. Offering a slot next Tuesday to
  // someone describing a heart attack would be the worst thing this could do.
  if (result.emergency) {
    return {
      state: { ...state, complaint: text, step: 'emergency' },
      say: [
        `What you have described may be an emergency — ${result.emergency.advice.toLowerCase()}.`,
        'Please do not wait for an appointment. Call 108 for an ambulance now, or come straight to Casualty, which is open 24 hours.',
        `If you think I have misread you, call us on ${HELP_LINE} and a person will help.`,
      ],
      emergency: result.emergency,
      input: null,
    };
  }

  if (!result.specialty) {
    const all = await activeSpecialties();
    if (!all.length) return noDepartments(state);
    return {
      state: { ...state, complaint: text, step: 'department' },
      say: ['Which department would you like to see?'],
      options: all.map((s) => ({ label: s.name, value: s.slug })),
      input: null,
    };
  }

  return {
    state: {
      ...state,
      complaint: text,
      specialty: result.specialty,
      specialtyName: result.specialtyName ?? undefined,
      triageReason: result.reason,
      triageConfidence: result.confidence,
      triageMatched: result.matched,
      step: 'department',
    },
    say: [
      `I would suggest ${result.specialtyName}.`,
      result.reason,
      'Shall I find you a doctor there?',
    ],
    options: [
      { label: `Yes, ${result.specialtyName}`, value: 'yes' },
      { label: 'Choose a different department', value: 'change', subtle: true },
    ],
    input: null,
  };
}

async function department(state: AgentState, text: string): Promise<AgentReply> {
  const all = await activeSpecialties();
  if (!all.length) return noDepartments(state);

  if (text === 'change' || /different|another|change|no\b/i.test(text)) {
    return {
      state,
      say: ['Of course. Which department would you like?'],
      options: all.map((s) => ({ label: s.name, value: s.slug })),
      input: null,
    };
  }

  // Either "yes" to the suggestion, or an explicit slug from the list.
  const chosen =
    text === 'yes' || /^y(es)?$/i.test(text)
      ? state.specialty
      : (all.find((s) => s.slug === text) ?? all.find((s) => eqName(s.name, text)))?.slug;

  if (!chosen) {
    return {
      state,
      say: ['Sorry, which department was that?'],
      options: all.map((s) => ({ label: s.name, value: s.slug })),
      input: null,
    };
  }

  const picked = all.find((s) => s.slug === chosen);
  const overrode = chosen !== state.specialty;

  const doctors = await bookableDoctors(chosen);
  if (!doctors.length) {
    return {
      state: { ...state, step: 'department' },
      say: [
        `Nobody in ${picked?.name} is taking online bookings at the moment.`,
        `Please pick another department, or call us on ${HELP_LINE} and we will arrange it.`,
      ],
      options: all
        .filter((s) => s.slug !== chosen)
        .map((s) => ({ label: s.name, value: s.slug })),
      input: null,
    };
  }

  return {
    state: {
      ...state,
      specialty: chosen,
      specialtyName: picked?.name,
      overrode: state.overrode || overrode,
      step: 'doctor',
    },
    say: [`Here is who is available in ${picked?.name}. Who would you like to see?`],
    options: doctors.map((d) => ({
      label: `Dr ${d.firstName} ${d.lastName}${
        d.doctorProfile?.yearsExperience
          ? ` · ${d.doctorProfile.yearsExperience} yrs`
          : ''
      }`,
      value: String(d._id),
    })),
    input: null,
  };
}

/* ── Doctor, date, slot ──────────────────────────────────────────────── */

async function doctor(state: AgentState, text: string): Promise<AgentReply> {
  const doctors = await bookableDoctors(state.specialty ?? '');
  const picked =
    doctors.find((d) => String(d._id) === text) ??
    doctors.find((d) => eqName(`${d.firstName} ${d.lastName}`, text.replace(/^dr\.?\s*/i, '')));

  if (!picked) {
    return {
      state,
      say: ['Sorry, which doctor was that?'],
      options: doctors.map((d) => ({
        label: `Dr ${d.firstName} ${d.lastName}`,
        value: String(d._id),
      })),
      input: null,
    };
  }

  const days = picked.doctorProfile?.availableDays ?? [1, 2, 3, 4, 5];
  const next = upcomingClinicDays(days, 3);

  return {
    state: {
      ...state,
      doctorId: String(picked._id),
      doctorName: `Dr ${picked.firstName} ${picked.lastName}`,
      step: 'date',
    },
    say: [`Dr ${picked.lastName} it is. Which day suits you?`],
    options: [
      ...next.map((d) => ({ label: friendlyDate(d), value: isoDate(d) })),
      { label: 'Another date', value: 'other', subtle: true },
    ],
    input: null,
  };
}

async function date(state: AgentState, text: string): Promise<AgentReply> {
  if (text === 'other') {
    return {
      state,
      say: ['Which date would you like?'],
      input: { type: 'date', placeholder: 'YYYY-MM-DD' },
    };
  }

  const parsed = parseDate(text);
  if (!parsed) {
    return {
      state,
      say: ['I could not read that date — please pick one.'],
      input: { type: 'date', placeholder: 'YYYY-MM-DD' },
    };
  }

  const when = new Date(parsed);
  if (when.getTime() < new Date().setHours(0, 0, 0, 0)) {
    return {
      state,
      say: ['That date has passed. Please pick a day from today onwards.'],
      input: { type: 'date', placeholder: 'YYYY-MM-DD' },
    };
  }

  const { slots, reason } = await freeSlots(state.doctorId ?? '', when);
  const free = slots.filter((s) => s.available);

  if (reason || !free.length) {
    const days = (await User.findById(state.doctorId).lean())?.doctorProfile?.availableDays ?? [];
    const next = upcomingClinicDays(days, 3);
    return {
      state,
      say: [
        reason ?? 'Every slot that day is taken.',
        'Here are the next days with space.',
      ],
      options: [
        ...next.map((d) => ({ label: friendlyDate(d), value: isoDate(d) })),
        { label: 'Another date', value: 'other', subtle: true },
      ],
      input: null,
    };
  }

  return {
    state: { ...state, date: parsed, step: 'slot' },
    say: [`${free.length} slot${free.length === 1 ? '' : 's'} free. What time works?`],
    options: free.slice(0, 12).map((s) => ({ label: s.time, value: s.time })),
    input: null,
  };
}

async function slot(state: AgentState, text: string): Promise<AgentReply> {
  if (!/^\d{2}:\d{2}$/.test(text)) {
    return {
      state,
      say: ['Please pick one of the times.'],
      options: (await freeSlots(state.doctorId ?? '', new Date(state.date ?? '')))
        .slots.filter((s) => s.available)
        .slice(0, 12)
        .map((s) => ({ label: s.time, value: s.time })),
      input: null,
    };
  }

  const when = new Date(state.date ?? '');
  return {
    state: { ...state, time: text, step: 'confirm' },
    say: [
      'Here is what I have:',
      [
        `${state.doctorName}, ${state.specialtyName}`,
        `${friendlyDate(when)} at ${text}`,
        state.isNew
          ? `${state.firstName} ${state.lastName ?? ''} · ${state.phone}`
          : `Patient ${state.identifier}`,
      ].join('\n'),
      'Shall I book it?',
    ],
    options: [
      { label: 'Yes, book it', value: 'confirm' },
      { label: 'Start over', value: 'restart', subtle: true },
    ],
    input: null,
  };
}

async function confirm(
  state: AgentState,
  text: string,
  req: Request | null
): Promise<AgentReply> {
  if (text === 'restart' || /start over|cancel|no\b/i.test(text)) return greeting();

  // Guard against a double submit replaying the same confirmed state.
  if (state.appointmentId) {
    return {
      state: { ...state, step: 'done' },
      say: [`That is already booked — your reference is ${state.appointmentId}.`],
      input: null,
    };
  }

  try {
    const result = await createPublicBooking(
      {
        isNewPatient: Boolean(state.isNew),
        identifier: state.identifier,
        dateOfBirth: state.dateOfBirth,
        firstName: state.firstName,
        lastName: state.lastName,
        phone: state.phone,
        doctorId: state.doctorId ?? '',
        date: state.date ?? '',
        time: state.time ?? '',
        complaint: state.complaint,
        triage: {
          specialty: state.specialty,
          reason: state.triageReason,
          confidence: state.triageConfidence,
          matched: state.triageMatched,
          overridden: state.overrode,
        },
      },
      req
    );

    const say = [
      'Booked.',
      `${result.doctor.name} · ${friendlyDate(new Date(result.appointment.scheduledDate))} at ${result.appointment.scheduledTime}`,
    ];
    if (result.patient.isNew) {
      say.push(
        `Your patient ID is ${result.patient.patientId}. Please write it down — you will need it, with your date of birth, to sign in to the portal.`
      );
    }
    say.push('Please arrive 15 minutes early, and bring any previous reports.');

    return {
      state: {
        ...state,
        step: 'done',
        appointmentId: result.appointment.appointmentId,
        patientId: result.patient.patientId,
      },
      say,
      booking: {
        appointmentId: result.appointment.appointmentId,
        patientId: result.patient.patientId,
        isNew: result.patient.isNew,
        doctorName: result.doctor.name,
        department: result.doctor.department,
        date: isoDate(new Date(result.appointment.scheduledDate)),
        time: result.appointment.scheduledTime,
      },
      input: null,
    };
  } catch (err) {
    const msg = (err as Error).message;
    // Nearly always "someone just took that slot", so go back a step rather
    // than dead-ending the conversation.
    return {
      state: { ...state, step: 'date', time: undefined },
      say: [msg, 'Shall we pick another time?'],
      options: [{ label: 'Choose another day', value: 'other' }],
      input: null,
    };
  }
}

/* ── helpers ─────────────────────────────────────────────────────────── */

async function activeSpecialties() {
  return Specialty.find({ isActive: true }).sort('displayOrder name').select('slug name').lean();
}

/**
 * What to say when there are no bookable departments at all.
 *
 * Without this the assistant asked "Which department would you like to see?"
 * and then offered an empty option list with no text input — no way forward
 * and no way out, on a screen that had already taken the visitor's name, date
 * of birth and phone number. An unseeded or misconfigured database is our
 * problem, so it ends in the phone number rather than in a shrug.
 */
function noDepartments(state: AgentState): AgentReply {
  return {
    state: { ...state, step: 'done' },
    say: [
      'I am sorry — I cannot see the clinic list at the moment, so I am not able to finish the booking.',
      `Please call us on ${HELP_LINE} and someone will book it for you straight away.`,
      'If this is urgent, call 108 or come to Casualty, which is open 24 hours.',
    ],
    options: [{ label: 'Try again', value: 'restart', subtle: true }],
    input: null,
  };
}

async function bookableDoctors(specialty: string) {
  if (!specialty) return [];
  return User.find({
    role: 'physician',
    isActive: true,
    'doctorProfile.isBookable': true,
    'doctorProfile.specialty': specialty,
  })
    .select('firstName lastName doctorProfile')
    .sort('firstName')
    .limit(8)
    .lean();
}

const eqName = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/** Accepts an <input type=date> value, or a typed dd/mm/yyyy. */
function parseDate(text: string): string | null {
  const t = text.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;

  const dmy = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    return Number.isNaN(new Date(iso).getTime()) ? null : iso;
  }

  const parsed = new Date(t);
  return Number.isNaN(parsed.getTime()) ? null : isoDate(parsed);
}

function yearsSince(iso: string): number {
  const then = new Date(iso).getTime();
  return Math.floor((Date.now() - then) / (365.25 * 24 * 3600 * 1000));
}

function friendlyDate(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}
