import { Specialty } from '../models/Specialty.js';

/**
 * Points a described complaint at a department.
 *
 * Deliberately deterministic, for the same reason medication reconciliation
 * is: a patient is told *why* they are being sent to Cardiology, and that
 * sentence has to be reproducible. Keywords live on the Specialty record, so
 * an administrator retunes triage from the admin screen rather than a deploy.
 *
 * This suggests a department. It does not diagnose, and nothing downstream
 * treats it as a clinical decision — the patient can always override it, and
 * the doctor sees the raw complaint, not just the routing.
 */

/**
 * Complaints that must never be routed to an outpatient slot. Checked before
 * anything else: someone typing "crushing chest pain" into a booking form
 * needs an ambulance, not an appointment next Tuesday.
 */
const RED_FLAGS: { pattern: RegExp; advice: string }[] = [
  {
    pattern: /crushing chest|chest pain.*(arm|jaw|sweat)|heart attack|cardiac arrest/i,
    advice: 'Possible heart attack',
  },
  {
    pattern: /can.?t breathe|cannot breathe|not breathing|choking|gasping/i,
    advice: 'Severe breathing difficulty',
  },
  {
    pattern: /unconscious|unresponsive|fainted and|collapsed|seizure|fitting/i,
    advice: 'Loss of consciousness or seizure',
  },
  {
    pattern: /stroke|face drooping|slurred speech|sudden weakness.*(side|arm|leg)/i,
    advice: 'Possible stroke',
  },
  {
    pattern: /heavy bleeding|bleeding heavily|haemorrhag|hemorrhag|vomiting blood|coughing blood/i,
    advice: 'Uncontrolled bleeding',
  },
  {
    pattern: /suicid|kill myself|end my life|self harm/i,
    advice: 'Mental health crisis',
  },
  { pattern: /overdose|poisoned|swallowed.*(poison|bleach)/i, advice: 'Suspected poisoning' },
];

export interface TriageResult {
  /** Slug of the suggested department, or null when nothing matched. */
  specialty: string | null;
  specialtyName: string | null;
  /** Plain-language sentence shown to the patient. */
  reason: string;
  /** 0–1. Low means "we guessed", and the UI says so. */
  confidence: number;
  /** The keywords that actually fired, so the suggestion is inspectable. */
  matched: string[];
  /** Set when the complaint looks like an emergency. */
  emergency: { advice: string } | null;
  /** Runners-up, so the patient can pick a different department easily. */
  alternatives: { slug: string; name: string; score: number }[];
}

/** Age bands that override the keyword match entirely. */
const PAEDIATRIC_MAX_AGE = 16;

export function detectEmergency(text: string): { advice: string } | null {
  for (const flag of RED_FLAGS) {
    if (flag.pattern.test(text)) return { advice: flag.advice };
  }
  return null;
}

/**
 * @param complaint  Free text the patient typed.
 * @param selected   Symptom chips they ticked, if any.
 * @param age        Used only to route children to Paediatrics.
 */
export async function suggestSpecialty(
  complaint: string,
  selected: string[] = [],
  age?: number
): Promise<TriageResult> {
  const haystack = [complaint, ...selected].join(' ').toLowerCase();

  const emergency = detectEmergency(haystack);

  const specialties = await Specialty.find({ isActive: true })
    .sort('displayOrder')
    .lean();

  const empty: TriageResult = {
    specialty: null,
    specialtyName: null,
    reason: '',
    confidence: 0,
    matched: [],
    emergency,
    alternatives: [],
  };
  if (!specialties.length) return empty;

  // Children go to Paediatrics regardless of what the keywords say, unless
  // the department does not exist in this hospital.
  if (age !== undefined && age <= PAEDIATRIC_MAX_AGE) {
    const paeds = specialties.find(
      (s) => s.slug === 'paediatrics' || s.slug === 'pediatrics'
    );
    if (paeds) {
      return {
        specialty: paeds.slug,
        specialtyName: paeds.name,
        reason: `${paeds.name}, because the appointment is for someone aged ${age}.`,
        confidence: 0.9,
        matched: [`age ${age}`],
        emergency,
        alternatives: specialties
          .filter((s) => s.slug !== paeds.slug)
          .slice(0, 3)
          .map((s) => ({ slug: s.slug, name: s.name, score: 0 })),
      };
    }
  }

  const scored = specialties
    .map((s) => {
      const matched = (s.symptomKeywords ?? []).filter((kw) => {
        const k = kw.toLowerCase().trim();
        if (!k) return false;
        // Whole-word match, so "ear" does not fire on "hearing" or "clear".
        return new RegExp(`\\b${escapeRegex(k)}\\b`, 'i').test(haystack);
      });
      return { s, matched, score: matched.length };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    const general =
      specialties.find((s) => s.slug === 'general-medicine') ?? specialties[0];
    return {
      ...empty,
      specialty: general.slug,
      specialtyName: general.name,
      reason:
        `${general.name}, because what you described does not point clearly at ` +
        `one department. A general physician will see you first and refer you on if needed.`,
      confidence: 0.3,
      alternatives: specialties
        .filter((s) => s.slug !== general.slug)
        .slice(0, 3)
        .map((s) => ({ slug: s.slug, name: s.name, score: 0 })),
    };
  }

  const best = scored[0];
  // Confidence rises with the number of keywords that fired, and falls when
  // the runner-up scored nearly as well — an even split is a weak signal.
  const runnerUp = scored[1]?.score ?? 0;
  const separation = (best.score - runnerUp) / best.score;
  const confidence = Math.min(0.95, 0.45 + best.score * 0.12 + separation * 0.25);

  return {
    specialty: best.s.slug,
    specialtyName: best.s.name,
    reason: `${best.s.name}, because you mentioned ${listPhrase(best.matched)}.`,
    confidence: Number(confidence.toFixed(2)),
    matched: best.matched,
    emergency,
    alternatives: scored
      .slice(1, 4)
      .map((r) => ({ slug: r.s.slug, name: r.s.name, score: r.score })),
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function listPhrase(items: string[]): string {
  const unique = [...new Set(items.map((i) => i.toLowerCase()))];
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
}
