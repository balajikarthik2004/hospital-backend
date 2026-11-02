import {
  drugClassOf,
  findAllergyConflict,
  findInteraction,
  isHighRisk,
  normaliseDrug,
} from './clinicalRules.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Screening a prescription before it reaches the counter.

   This runs the same deterministic rules the discharge reconciliation agent
   uses — the same JSON knowledge base, the same interaction and allergy
   tables. No model is in this path. A pharmacist deciding whether to hand
   over warfarin and aspirin together needs an answer that is identical every
   time and explainable from a rule, not a plausible sentence.

   Screening is against three things at once:
     1. the new items against each other,
     2. the new items against the patient's documented allergies,
     3. the new items against what the patient is already taking.

   The third is the one most easily missed, and the one that actually causes
   harm: the dangerous pair is usually one drug from today's script and one
   the patient has been on for a year.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface PrescriptionItemInput {
  drugName: string;
  genericName?: string;
  dosage?: string;
  frequency?: string;
  route?: string;
}

export interface SafetyFlag {
  flagId: string;
  type: 'interaction' | 'allergy_conflict' | 'duplication' | 'high_risk' | 'unclear_instruction';
  severity: 'critical' | 'high' | 'medium' | 'low';
  drugA: string;
  drugB: string | null;
  description: string;
  recommendation: string;
  acknowledged: boolean;
}

export interface SafetyResult {
  checkedAt: Date;
  /** False when anything critical or high is outstanding. */
  passed: boolean;
  flags: SafetyFlag[];
}

export interface ScreenInput {
  items: PrescriptionItemInput[];
  allergies?: { substance: string; severity?: string }[];
  /** What the patient is already on, from their active medication lists. */
  currentMedications?: { drugName: string }[];
}

const SEVERITY_RANK: Record<SafetyFlag['severity'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** Anything at or above this level blocks a clean pass. */
const BLOCKING: SafetyFlag['severity'][] = ['critical', 'high'];

function flag(
  seq: number,
  partial: Omit<SafetyFlag, 'flagId' | 'acknowledged'>
): SafetyFlag {
  return { flagId: `RXF${String(seq).padStart(3, '0')}`, acknowledged: false, ...partial };
}

export function screenPrescription(input: ScreenInput): SafetyResult {
  const items = (input.items ?? []).filter((i) => i?.drugName?.trim());
  const allergies = input.allergies ?? [];
  const current = (input.currentMedications ?? []).filter((m) => m?.drugName?.trim());

  const flags: SafetyFlag[] = [];
  let seq = 0;

  /* ── 1. Allergy conflicts ───────────────────────────────────────────── */
  for (const item of items) {
    const conflict = findAllergyConflict(item.drugName, allergies);
    if (conflict) {
      flags.push(
        flag(++seq, {
          type: 'allergy_conflict',
          severity: (conflict.rule.severity as SafetyFlag['severity']) ?? 'critical',
          drugA: item.drugName,
          drugB: null,
          description:
            `${item.drugName} conflicts with the patient's documented allergy to ` +
            `${conflict.allergy.substance}. ${conflict.rule.note}`,
          recommendation:
            'Do not dispense. Contact the prescriber for an alternative agent.',
        })
      );
    }
  }

  /* ── 2. Interactions within this prescription ───────────────────────── */
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const rule = findInteraction(items[i].drugName, items[j].drugName);
      if (rule) {
        flags.push(
          flag(++seq, {
            type: 'interaction',
            severity: rule.severity as SafetyFlag['severity'],
            drugA: items[i].drugName,
            drugB: items[j].drugName,
            description: `${rule.mechanism} ${rule.effect}`.trim(),
            recommendation: rule.recommendation,
          })
        );
      }
    }
  }

  /* ── 3. Interactions with what the patient already takes ────────────── */
  const seenCrossPairs = new Set<string>();
  for (const item of items) {
    for (const existing of current) {
      // Prescribing the same drug the patient is already on is a duplication,
      // not an interaction — handled below.
      if (normaliseDrug(item.drugName) === normaliseDrug(existing.drugName)) continue;

      const key = [normaliseDrug(item.drugName), normaliseDrug(existing.drugName)]
        .sort()
        .join('|');
      if (seenCrossPairs.has(key)) continue;

      const rule = findInteraction(item.drugName, existing.drugName);
      if (rule) {
        seenCrossPairs.add(key);
        flags.push(
          flag(++seq, {
            type: 'interaction',
            severity: rule.severity as SafetyFlag['severity'],
            drugA: item.drugName,
            drugB: existing.drugName,
            description:
              `${item.drugName} interacts with ${existing.drugName}, which the patient ` +
              `is already taking. ${rule.mechanism} ${rule.effect}`.trim(),
            recommendation: rule.recommendation,
          })
        );
      }
    }
  }

  /* ── 4. Duplication ─────────────────────────────────────────────────── */
  const byName = new Map<string, string[]>();
  for (const item of items) {
    const key = normaliseDrug(item.drugName);
    byName.set(key, [...(byName.get(key) ?? []), item.drugName]);
  }
  for (const [, names] of byName) {
    if (names.length > 1) {
      flags.push(
        flag(++seq, {
          type: 'duplication',
          severity: 'medium',
          drugA: names[0],
          drugB: null,
          description: `${names[0]} appears ${names.length} times on this prescription.`,
          recommendation: 'Confirm the intended total daily dose with the prescriber.',
        })
      );
    }
  }

  for (const item of items) {
    const alreadyOn = current.find(
      (m) => normaliseDrug(m.drugName) === normaliseDrug(item.drugName)
    );
    if (alreadyOn) {
      flags.push(
        flag(++seq, {
          type: 'duplication',
          severity: 'high',
          drugA: item.drugName,
          drugB: null,
          description:
            `The patient is already recorded as taking ${item.drugName}. Dispensing ` +
            'this could double their dose.',
          recommendation:
            'Confirm whether this replaces the existing order or is in addition to it.',
        })
      );
    }
  }

  /* ── 5. Unclear or missing instructions ─────────────────────────────── */
  for (const item of items) {
    const missing: string[] = [];
    if (!item.dosage?.trim()) missing.push('dose');
    if (!item.frequency?.trim()) missing.push('frequency');
    if (missing.length) {
      flags.push(
        flag(++seq, {
          type: 'unclear_instruction',
          severity: 'high',
          drugA: item.drugName,
          drugB: null,
          description: `${item.drugName} has no ${missing.join(' and ')} recorded.`,
          recommendation: 'A prescription cannot be dispensed without a dose and frequency.',
        })
      );
    }
  }

  /* ── 6. High-risk agents worth a second look ────────────────────────── */
  for (const item of items) {
    if (isHighRisk(item.drugName)) {
      // Only raise this when nothing more specific already named the drug;
      // a pharmacist reading "warfarin is high risk" under a critical
      // interaction flag learns nothing and starts skimming.
      const alreadyFlagged = flags.some(
        (f) =>
          normaliseDrug(f.drugA) === normaliseDrug(item.drugName) ||
          (f.drugB && normaliseDrug(f.drugB) === normaliseDrug(item.drugName))
      );
      if (alreadyFlagged) continue;

      flags.push(
        flag(++seq, {
          type: 'high_risk',
          severity: 'medium',
          drugA: item.drugName,
          drugB: null,
          description:
            `${item.drugName} (${drugClassOf(item.drugName) || 'high-risk agent'}) ` +
            'requires counselling and monitoring.',
          recommendation: 'Counsel the patient on monitoring and warning signs at handover.',
        })
      );
    }
  }

  flags.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  return {
    checkedAt: new Date(),
    passed: !flags.some((f) => BLOCKING.includes(f.severity)),
    flags,
  };
}

/** Critical and high flags that nobody has signed off yet. */
export function outstandingBlockingFlags(
  flags: { severity: string; acknowledged?: boolean }[]
): number {
  return flags.filter((f) => BLOCKING.includes(f.severity as SafetyFlag['severity']) && !f.acknowledged)
    .length;
}
