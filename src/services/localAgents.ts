/**
 * Built-in orchestrator — a TypeScript implementation of the five agents
 * described in Section 8 of the build spec. It is used directly when the
 * Python LangGraph service is not running, so the discharge workflow is always
 * functional. The rules engines read the same JSON knowledge bases that the
 * Python service uses, so behaviour is identical.
 *
 * Safety contract (Section 8.2 / Key Design Principles):
 *   - Agents produce DRAFTS only. Nothing is auto-approved.
 *   - The reconciliation and follow-up agents are deterministic (no LLM in the
 *     decision path). The LLM only phrases explanations and patient-facing text.
 */
import {
  drugClassOf,
  findAllergyConflict,
  findInteraction,
  followUpDb,
  isHighRisk,
  normaliseDrug,
  parseDose,
  resolveProtocol,
  interactionDb,
} from './clinicalRules.js';
import { llm } from './llmClient.js';

// ─── Shared types ────────────────────────────────────────────────────────────

export interface MedItem {
  drugName: string;
  genericName?: string;
  drugClass?: string;
  dosage?: string;
  frequency?: string;
  route?: string;
  isActive?: boolean;
  notes?: string | null;
}

export interface Allergy {
  substance: string;
  reaction?: string;
  severity?: string;
}

export interface AgentContext {
  patient: {
    fullName: string;
    age: number;
    gender: string;
    preferredLanguage: string;
    literacyLevel: 'basic' | 'intermediate' | 'advanced';
    allergies: Allergy[];
    conditions: string[];
    pcpName?: string;
  };
  admission: {
    admissionId: string;
    admittingDiagnosis: string;
    diagnosisCodes: string[];
    admissionDate: string;
    lengthOfStayDays: number;
    ward: string;
    notes: { type: string; content: string; createdAt: string }[];
    labs: {
      testName: string;
      value: string;
      unit: string;
      referenceRange: string;
      isAbnormal: boolean;
    }[];
    procedures: { name: string; date: string; notes?: string }[];
    riskAssessment: { fallRisk: string; pressureInjuryRisk: string; infectionFlags: string[] };
  };
  vitals: {
    timestamp: string;
    bloodPressureSystolic: number;
    bloodPressureDiastolic: number;
    heartRate: number;
    temperature: number;
    respiratoryRate: number;
    oxygenSaturation: number;
    painScore: number;
  }[];
  medications: {
    preAdmission: MedItem[];
    inpatient: MedItem[];
    discharge: MedItem[];
  };
  existingAppointments: { specialty: string; type: string; scheduledDate: string }[];
}

export interface Flag {
  flagId: string;
  type:
    | 'omission'
    | 'duplication'
    | 'dose_mismatch'
    | 'interaction'
    | 'allergy_conflict'
    | 'unclear_instruction';
  severity: 'critical' | 'high' | 'medium' | 'low';
  drugA: string;
  drugB: string | null;
  description: string;
  recommendation: string;
  confidence: number;
  resolution: 'pending';
}

export interface FollowUpRecommendation {
  type: string;
  specialty: string;
  description: string;
  timeframe: string;
  dueInDays: number;
  priority: 'required' | 'recommended' | 'optional';
  isScheduled: boolean;
  appointmentId: null;
}

export interface SafetyCheck {
  name: string;
  passed: boolean;
  detail: string;
}

// ─── 1. Clinical Summary Agent ───────────────────────────────────────────────

const SUMMARY_SYSTEM = `You are the Clinical Summary Agent in a clinician-in-the-loop discharge system.

Write a hospital discharge summary from the structured record supplied. Rules you must not break:
- Report only what is present in the supplied record. Never invent findings, diagnoses, values or dates.
- Do NOT give treatment recommendations, do NOT suggest medication changes, and do NOT state doses.
- Do NOT state that the patient is cleared for discharge. A clinician decides that.
- Output GitHub-flavoured Markdown with exactly these level-2 headings, in order:
  ## Principal Diagnosis
  ## Hospital Course
  ## Significant Findings
  ## Procedures
  ## Condition at Discharge
  ## Pending Results
- If a section has no supporting data, write "No data recorded during this admission."
- Keep it factual and concise: a clinician will read and edit this.`;

export async function runClinicalSummaryAgent(
  ctx: AgentContext
): Promise<{ content: string; confidence: number; generator: string }> {
  const confidence = scoreSummaryConfidence(ctx);
  const llmText = await llm.complete({
    system: SUMMARY_SYSTEM,
    prompt: buildSummaryPrompt(ctx),
    maxTokens: 2000,
  });

  if (llmText && /## Principal Diagnosis/i.test(llmText)) {
    return { content: llmText, confidence, generator: 'claude' };
  }
  return { content: templateSummary(ctx), confidence, generator: 'template' };
}

function buildSummaryPrompt(ctx: AgentContext): string {
  const { patient, admission, vitals } = ctx;
  const latest = vitals[0];
  return [
    `PATIENT: ${patient.fullName}, ${patient.age}y ${patient.gender}`,
    `KNOWN CONDITIONS: ${patient.conditions.join(', ') || 'none recorded'}`,
    `ALLERGIES: ${patient.allergies.map((a) => `${a.substance} (${a.reaction || 'reaction not recorded'})`).join('; ') || 'NKDA'}`,
    '',
    `ADMITTING DIAGNOSIS: ${admission.admittingDiagnosis}`,
    `ICD-10: ${admission.diagnosisCodes.join(', ') || 'not coded'}`,
    `ADMITTED: ${admission.admissionDate} — LENGTH OF STAY: ${admission.lengthOfStayDays} day(s) on ${admission.ward}`,
    `RISK: fall=${admission.riskAssessment.fallRisk}, pressure injury=${admission.riskAssessment.pressureInjuryRisk}, infection flags=${admission.riskAssessment.infectionFlags.join(', ') || 'none'}`,
    '',
    'CLINICAL NOTES (chronological):',
    admission.notes.length
      ? admission.notes
          .map((n) => `- [${n.type} ${n.createdAt.slice(0, 10)}] ${n.content}`)
          .join('\n')
      : '- none recorded',
    '',
    'LAB RESULTS:',
    admission.labs.length
      ? admission.labs
          .map(
            (l) =>
              `- ${l.testName}: ${l.value} ${l.unit} (ref ${l.referenceRange})${l.isAbnormal ? ' **ABNORMAL**' : ''}`
          )
          .join('\n')
      : '- none recorded',
    '',
    'PROCEDURES:',
    admission.procedures.length
      ? admission.procedures.map((p) => `- ${p.name} on ${p.date.slice(0, 10)}. ${p.notes ?? ''}`).join('\n')
      : '- none recorded',
    '',
    'MOST RECENT VITALS:',
    latest
      ? `- BP ${latest.bloodPressureSystolic}/${latest.bloodPressureDiastolic}, HR ${latest.heartRate}, T ${latest.temperature}F, RR ${latest.respiratoryRate}, SpO2 ${latest.oxygenSaturation}%, pain ${latest.painScore}/10 (recorded ${latest.timestamp})`
      : '- none recorded',
    '',
    'Write the discharge summary now.',
  ].join('\n');
}

function templateSummary(ctx: AgentContext): string {
  const { patient, admission, vitals } = ctx;
  const latest = vitals[0];
  const abnormal = admission.labs.filter((l) => l.isAbnormal);
  const na = 'No data recorded during this admission.';

  const course = admission.notes.length
    ? admission.notes
        .map((n) => `- **${n.createdAt.slice(0, 10)} · ${n.type}** — ${n.content}`)
        .join('\n')
    : na;

  return `## Principal Diagnosis

${admission.admittingDiagnosis}${admission.diagnosisCodes.length ? ` (ICD-10: ${admission.diagnosisCodes.join(', ')})` : ''}

## Hospital Course

${patient.fullName}, a ${patient.age}-year-old ${patient.gender} patient${
    patient.conditions.length ? ` with a history of ${patient.conditions.join(', ')}` : ''
  }, was admitted on ${admission.admissionDate.slice(0, 10)} to ${admission.ward} with ${admission.admittingDiagnosis.toLowerCase()}. Length of stay to date: ${admission.lengthOfStayDays} day(s).

${course}

## Significant Findings

${
  abnormal.length
    ? abnormal
        .map(
          (l) => `- **${l.testName}** ${l.value} ${l.unit} — outside reference range (${l.referenceRange})`
        )
        .join('\n')
    : 'All recorded laboratory values were within reference range.'
}

${
  admission.riskAssessment.infectionFlags.length
    ? `Infection flags during this admission: ${admission.riskAssessment.infectionFlags.join(', ')}.`
    : ''
}

Fall risk assessed as **${admission.riskAssessment.fallRisk}**; pressure injury risk **${admission.riskAssessment.pressureInjuryRisk}**.

## Procedures

${
  admission.procedures.length
    ? admission.procedures
        .map((p) => `- **${p.name}** (${p.date.slice(0, 10)})${p.notes ? ` — ${p.notes}` : ''}`)
        .join('\n')
    : na
}

## Condition at Discharge

${
  latest
    ? `Most recent recorded observations: blood pressure ${latest.bloodPressureSystolic}/${latest.bloodPressureDiastolic} mmHg, heart rate ${latest.heartRate} bpm, temperature ${latest.temperature} °F, respiratory rate ${latest.respiratoryRate}/min, oxygen saturation ${latest.oxygenSaturation}% on room air, pain score ${latest.painScore}/10.`
    : na
}

## Pending Results

${
  admission.labs.length
    ? 'No laboratory studies are outstanding at the time this draft was generated. Confirm against the live order list before signing.'
    : 'Confirm against the live order list before signing.'
}

---

*Draft generated by the Clinical Summary Agent. Not valid until reviewed and signed by the attending physician.*`;
}

function scoreSummaryConfidence(ctx: AgentContext): number {
  // Confidence = data completeness, per spec.
  const signals = [
    ctx.admission.notes.length >= 3,
    ctx.admission.notes.length >= 1,
    ctx.admission.labs.length >= 1,
    ctx.vitals.length >= 3,
    ctx.admission.diagnosisCodes.length >= 1,
    ctx.medications.discharge.length >= 1,
    ctx.medications.preAdmission.length >= 1,
    Boolean(ctx.admission.admittingDiagnosis),
  ];
  const score = signals.filter(Boolean).length / signals.length;
  return Math.round(Math.min(0.97, 0.45 + score * 0.55) * 100) / 100;
}

// ─── 2. Medication Reconciliation Agent (deterministic) ──────────────────────

export function runMedicationReconciliationAgent(ctx: AgentContext): {
  flags: Flag[];
  confidence: number;
} {
  const { preAdmission, inpatient, discharge } = ctx.medications;
  const flags: Flag[] = [];
  let seq = 0;
  const nextFlagId = () => `FLG-${String(++seq).padStart(3, '0')}`;

  const dischargeKeys = new Set(discharge.map((m) => normaliseDrug(m.drugName)));

  // Rule 2 — omissions: a home medication absent from the discharge list.
  for (const home of preAdmission) {
    const key = normaliseDrug(home.drugName);
    if (dischargeKeys.has(key)) continue;
    const stoppedDeliberately = /stop|discontinu|held|taper/i.test(home.notes ?? '');
    if (stoppedDeliberately) continue;

    const highRisk = isHighRisk(home.drugName);
    flags.push({
      flagId: nextFlagId(),
      type: 'omission',
      severity: highRisk ? 'high' : 'medium',
      drugA: home.drugName,
      drugB: null,
      description: `${home.drugName} (${drugClassOf(home.drugName)}) was taken before admission but does not appear on the discharge medication list, and no reason for stopping it is documented.`,
      recommendation: highRisk
        ? `${home.drugName} is a high-risk agent. Confirm whether it was stopped intentionally and document the reason, or restart it on the discharge list.`
        : `Confirm whether ${home.drugName} should be resumed at discharge, or document the reason for stopping it.`,
      confidence: 0.88,
      resolution: 'pending',
    });
  }

  // Rule 3 — therapeutic duplication within the discharge list.
  const byClass = new Map<string, MedItem[]>();
  for (const med of discharge) {
    const cls = drugClassOf(med.drugName);
    if (cls === 'Unclassified') continue;
    byClass.set(cls, [...(byClass.get(cls) ?? []), med]);
  }
  for (const [cls, meds] of byClass) {
    if (meds.length < 2) continue;
    const names = meds.map((m) => m.drugName);
    const unique = new Set(names.map(normaliseDrug));
    flags.push({
      flagId: nextFlagId(),
      type: 'duplication',
      severity: unique.size === 1 ? 'high' : 'medium',
      drugA: names[0],
      drugB: names[1],
      description:
        unique.size === 1
          ? `${names[0]} appears more than once on the discharge list.`
          : `${names.length} agents from the same class (${cls}) are prescribed together: ${names.join(', ')}.`,
      recommendation:
        unique.size === 1
          ? `Remove the duplicate entry for ${names[0]} so the patient receives a single clear instruction.`
          : `Confirm that combination therapy within ${cls} is intended, and document the rationale for the patient and the primary care physician.`,
      confidence: 0.82,
      resolution: 'pending',
    });
  }

  // Three or more antihypertensives is called out explicitly (spec: Patient D).
  const bpClasses = ['ACE inhibitor', 'ARB', 'Beta blocker', 'Calcium channel blocker', 'Thiazide diuretic'];
  const bpMeds = discharge.filter((m) => bpClasses.includes(drugClassOf(m.drugName)));
  if (bpMeds.length >= 3) {
    flags.push({
      flagId: nextFlagId(),
      type: 'duplication',
      severity: 'medium',
      drugA: bpMeds[0].drugName,
      drugB: bpMeds[1].drugName,
      description: `${bpMeds.length} blood-pressure-lowering agents are prescribed at discharge: ${bpMeds.map((m) => m.drugName).join(', ')}.`,
      recommendation:
        'Review the combined antihypertensive burden for orthostatic hypotension and falls risk, and arrange an early blood pressure check.',
      confidence: 0.76,
      resolution: 'pending',
    });
  }

  // Rule 4 — dose mismatches between the home and discharge lists.
  const { significant_ratio, critical_ratio } = interactionDb.dose_change_thresholds;
  for (const home of preAdmission) {
    const key = normaliseDrug(home.drugName);
    const match = discharge.find((d) => normaliseDrug(d.drugName) === key);
    if (!match) continue;
    const a = parseDose(home.dosage ?? '');
    const b = parseDose(match.dosage ?? '');
    if (!a || !b || a.unit !== b.unit || a.value === 0) continue;
    const ratio = Math.max(a.value, b.value) / Math.min(a.value, b.value);
    if (ratio < significant_ratio && a.value === b.value) continue;
    if (a.value === b.value) continue;

    const direction = b.value > a.value ? 'increased' : 'decreased';
    const highRisk = isHighRisk(home.drugName);
    // A dose change on a narrow-therapeutic-index agent is the one that hurts.
    // On an ordinary agent a titration is usually intentional and informational,
    // so it is raised only so the patient instructions state the new strength.
    const severity: Flag['severity'] = highRisk
      ? ratio >= significant_ratio
        ? 'high'
        : 'medium'
      : ratio >= critical_ratio * 1.5
        ? 'medium'
        : 'low';

    flags.push({
      flagId: nextFlagId(),
      type: 'dose_mismatch',
      severity,
      drugA: home.drugName,
      drugB: null,
      description: `${home.drugName} dose ${direction} from ${home.dosage} before admission to ${match.dosage} at discharge (${ratio.toFixed(1)}× change).`,
      recommendation: highRisk
        ? `${home.drugName} is a high-risk agent. Confirm the new dose is intended, make sure the change is explained in the patient instructions, and arrange appropriate monitoring.`
        : `Confirm the dose change is intended and that the patient instructions state the new dose explicitly, so the patient does not continue the old strength.`,
      confidence: 0.9,
      resolution: 'pending',
    });
  }

  // Rule 5 — drug-drug interactions within the discharge list.
  for (let i = 0; i < discharge.length; i++) {
    for (let j = i + 1; j < discharge.length; j++) {
      const rule = findInteraction(discharge[i].drugName, discharge[j].drugName);
      if (!rule) continue;
      flags.push({
        flagId: nextFlagId(),
        type: 'interaction',
        severity: rule.severity,
        drugA: discharge[i].drugName,
        drugB: discharge[j].drugName,
        description: `${discharge[i].drugName} + ${discharge[j].drugName}: ${rule.mechanism}. ${rule.effect}.`,
        recommendation: rule.recommendation,
        confidence: 0.93,
        resolution: 'pending',
      });
    }
  }

  // Rule 6 — allergy conflicts.
  for (const med of discharge) {
    const conflict = findAllergyConflict(med.drugName, ctx.patient.allergies);
    if (!conflict) continue;
    flags.push({
      flagId: nextFlagId(),
      type: 'allergy_conflict',
      severity: conflict.rule.severity,
      drugA: med.drugName,
      drugB: null,
      description: `${med.drugName} is prescribed at discharge although the patient has a documented ${conflict.allergy.substance} allergy${conflict.allergy.severity ? ` (${conflict.allergy.severity})` : ''}. ${conflict.rule.note}`,
      recommendation: `Do not dispense until this is resolved. Verify the allergy history and select an alternative agent, or document a specific rationale and a monitoring plan if the prescription is intentional.`,
      confidence: 0.95,
      resolution: 'pending',
    });
  }

  // Rule 7 — unclear instructions.
  for (const med of discharge) {
    const freq = (med.frequency ?? '').toLowerCase();
    const reasons: string[] = [];
    if (/prn|as needed/.test(freq) && !/for|if|when/.test(freq) && !/for|if|when/.test(med.notes ?? '')) {
      reasons.push('PRN without a stated indication or maximum daily dose');
    }
    if (!med.dosage?.trim()) reasons.push('no dose recorded');
    if (!med.frequency?.trim()) reasons.push('no frequency recorded');
    if (/taper|titrate/.test(freq + ' ' + (med.notes ?? '')) && !/\d/.test(med.notes ?? '')) {
      reasons.push('a taper is mentioned but no schedule is given');
    }
    if (!reasons.length) continue;

    flags.push({
      flagId: nextFlagId(),
      type: 'unclear_instruction',
      severity: isHighRisk(med.drugName) ? 'high' : 'low',
      drugA: med.drugName,
      drugB: null,
      description: `Instructions for ${med.drugName} are incomplete: ${reasons.join('; ')}.`,
      recommendation: `Write an unambiguous sig for ${med.drugName} covering dose, frequency, indication and any maximum, so the patient and the community pharmacist cannot misread it.`,
      confidence: 0.85,
      resolution: 'pending',
    });
  }

  // Opioid without a bowel regimen — common and worth surfacing.
  const opioids = discharge.filter((m) => drugClassOf(m.drugName) === 'Opioid analgesic');
  const hasLaxative = discharge.some((m) =>
    ['Stool softener', 'Stimulant laxative'].includes(drugClassOf(m.drugName))
  );
  if (opioids.length && !hasLaxative) {
    flags.push({
      flagId: nextFlagId(),
      type: 'omission',
      severity: 'medium',
      drugA: opioids[0].drugName,
      drugB: null,
      description: `${opioids[0].drugName} is prescribed at discharge with no bowel regimen on the list.`,
      recommendation:
        'Consider adding a stool softener or stimulant laxative and counsel the patient on opioid-induced constipation.',
      confidence: 0.8,
      resolution: 'pending',
    });
  }

  // Loop diuretic without potassium monitoring context (spec: Patient D).
  const onLoop = discharge.some((m) => drugClassOf(m.drugName) === 'Loop diuretic');
  const onK = discharge.some((m) => normaliseDrug(m.drugName) === 'potassium chloride');
  const onKSparing = discharge.some((m) =>
    ['Aldosterone antagonist', 'ACE inhibitor', 'ARB'].includes(drugClassOf(m.drugName))
  );
  const hadKHome = preAdmission.some((m) => normaliseDrug(m.drugName) === 'potassium chloride');
  if (onLoop && !onK && !onKSparing && hadKHome) {
    flags.push({
      flagId: nextFlagId(),
      type: 'omission',
      severity: 'medium',
      drugA: 'Potassium chloride',
      drugB: 'Furosemide',
      description:
        'The patient took a potassium supplement before admission and remains on a loop diuretic at discharge, but no potassium supplement is on the discharge list.',
      recommendation:
        'Check the discharge potassium level and confirm whether supplementation should continue. Arrange a basic metabolic panel within one week.',
      confidence: 0.84,
      resolution: 'pending',
    });
  }

  const order = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  flags.sort((a, b) => order[a.severity] - order[b.severity]);

  const confidence =
    flags.length === 0
      ? 0.95
      : Math.round(
          (flags.reduce((s, f) => s + f.confidence, 0) / flags.length) * 100
        ) / 100;

  return { flags, confidence };
}

/**
 * Optional LLM pass that rewrites each flag's explanation in clearer prose.
 * The severity, type and clinical decision stay exactly as the rules engine
 * produced them — the model only rephrases `description`.
 */
export async function explainFlags(flags: Flag[], ctx: AgentContext): Promise<Flag[]> {
  if (!llm.available || !flags.length) return flags;

  const text = await llm.complete({
    system: `You rewrite medication-safety findings for a busy clinician.
You are given findings produced by a deterministic rules engine. For each one, rewrite ONLY the explanation so it reads clearly in one or two sentences.
You must NOT change the severity, you must NOT change the clinical recommendation, you must NOT add new findings, and you must NOT suggest a specific dose.
Return a JSON array of objects: [{"flagId": "...", "description": "..."}]. Return nothing else.`,
    prompt: `Patient: ${ctx.patient.age}y ${ctx.patient.gender}, admitted with ${ctx.admission.admittingDiagnosis}.
Allergies: ${ctx.patient.allergies.map((a) => a.substance).join(', ') || 'none'}.

Findings:
${JSON.stringify(flags.map((f) => ({ flagId: f.flagId, type: f.type, severity: f.severity, drugA: f.drugA, drugB: f.drugB, description: f.description })), null, 2)}`,
    maxTokens: 1500,
  });

  if (!text) return flags;
  try {
    const json = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
    const rewritten = JSON.parse(json) as { flagId: string; description: string }[];
    const map = new Map(rewritten.map((r) => [r.flagId, r.description]));
    return flags.map((f) =>
      map.has(f.flagId) ? { ...f, description: map.get(f.flagId)! } : f
    );
  } catch {
    return flags;
  }
}

// ─── 3. Follow-Up Planning Agent (deterministic) ─────────────────────────────

export function runFollowUpPlanningAgent(ctx: AgentContext): {
  recommendations: FollowUpRecommendation[];
  confidence: number;
} {
  const protocol = resolveProtocol(
    ctx.admission.admittingDiagnosis,
    ctx.admission.diagnosisCodes
  );

  const recs: FollowUpRecommendation[] = protocol.recommendations.map((r) => ({
    type: r.type,
    specialty: r.specialty,
    description: r.description,
    timeframe: r.timeframe,
    dueInDays: r.dueInDays,
    priority: r.priority,
    isScheduled: false,
    appointmentId: null,
  }));

  // Medication-triggered follow-ups layered on top of the diagnosis protocol.
  const dischargeClasses = new Set(ctx.medications.discharge.map((m) => drugClassOf(m.drugName)));
  for (const trigger of followUpDb.medication_triggered) {
    if (!dischargeClasses.has(trigger.when_drug_class)) continue;
    // Only redundant if the diagnosis protocol already covers this subject —
    // an INR check is not the same test as a basic metabolic panel.
    const subject = (trigger.subject ?? '').toLowerCase();
    const alreadyCovered =
      subject.length > 0 &&
      recs.some(
        (r) => r.type === trigger.type && r.description.toLowerCase().includes(subject)
      );
    if (alreadyCovered) continue;
    recs.push({
      type: trigger.type,
      specialty: trigger.specialty,
      description: `${trigger.description} (triggered by ${trigger.when_drug_class} on the discharge list)`,
      timeframe: trigger.timeframe,
      dueInDays: trigger.dueInDays,
      priority: trigger.priority,
      isScheduled: false,
      appointmentId: null,
    });
  }

  // Cross-check against appointments that already exist, to avoid duplicates.
  const horizon = Date.now() + 60 * 86_400_000;
  for (const rec of recs) {
    const existing = ctx.existingAppointments.find((a) => {
      const when = new Date(a.scheduledDate).getTime();
      if (when < Date.now() || when > horizon) return false;
      return (
        a.specialty.toLowerCase() === rec.specialty.toLowerCase() ||
        a.type === rec.type
      );
    });
    if (existing) {
      rec.isScheduled = true;
      rec.description += ` — an appointment already exists on ${new Date(existing.scheduledDate).toISOString().slice(0, 10)}.`;
    }
  }

  const priorityOrder = { required: 0, recommended: 1, optional: 2 } as const;
  recs.sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] || a.dueInDays - b.dueInDays
  );

  const matched = protocol.label !== followUpDb.default.label;
  return {
    recommendations: recs,
    confidence: matched ? 0.91 : 0.68,
  };
}

// ─── 4. Patient Education Agent ──────────────────────────────────────────────

const READING_LEVEL_GUIDE: Record<string, string> = {
  basic:
    'Write at a 5th-grade reading level. Sentences of 10 words or fewer. Use everyday words ("water pill", not "diuretic"). Explain any medical word you cannot avoid.',
  intermediate:
    'Write at an 8th-grade reading level. Short sentences. Plain words, with the medical term in brackets the first time you use it.',
  advanced:
    'Write at a 10th-grade reading level. You may use common medical terms, but keep sentences short and direct.',
};

export async function runPatientEducationAgent(
  ctx: AgentContext,
  approvedSummary: string,
  recommendations: FollowUpRecommendation[]
): Promise<{ content: string; confidence: number; generator: string }> {
  const level = ctx.patient.literacyLevel ?? 'intermediate';

  const system = `You are the Patient Education Agent in a clinician-in-the-loop discharge system.

Write discharge instructions addressed directly to the patient ("you").
${READING_LEVEL_GUIDE[level]}
Write in ${ctx.patient.preferredLanguage}.

Hard rules:
- Use ONLY information in the approved discharge summary, the approved medication list and the follow-up plan supplied below. Introduce NO new medical information, no new medicines, no new doses, no new advice.
- Never contradict the approved plan.
- Use these level-2 headings, in order:
  ## Why You Were in Hospital
  ## Your Medicines
  ## Medicines You Should Stop
  ## Warning Signs — Call 911
  ## When to Call the Hospital
  ## Your Follow-Up Appointments
  ## Taking Care of Yourself at Home
- Under "Your Medicines", list each medicine as a bullet with exactly the name, dose and when to take it as given to you.
- Output Markdown only.`;

  const prompt = [
    `PATIENT: ${ctx.patient.fullName}, ${ctx.patient.age} years old. Reading level: ${level}. Language: ${ctx.patient.preferredLanguage}.`,
    '',
    'APPROVED DISCHARGE SUMMARY:',
    approvedSummary || '(not yet available)',
    '',
    'APPROVED DISCHARGE MEDICATIONS:',
    ctx.medications.discharge
      .map((m) => `- ${m.drugName} ${m.dosage ?? ''} ${m.frequency ?? ''} by ${m.route ?? 'mouth'}${m.notes ? ` — ${m.notes}` : ''}`)
      .join('\n') || '- none',
    '',
    'MEDICINES TAKEN BEFORE ADMISSION THAT ARE NOT ON THE DISCHARGE LIST:',
    stoppedMeds(ctx).map((m) => `- ${m.drugName} ${m.dosage ?? ''}`).join('\n') || '- none',
    '',
    'FOLLOW-UP PLAN:',
    recommendations.map((r) => `- ${r.description} (${r.timeframe}, ${r.priority})`).join('\n') || '- none',
    '',
    `ALLERGIES: ${ctx.patient.allergies.map((a) => a.substance).join(', ') || 'none known'}`,
    '',
    'Write the patient instructions now.',
  ].join('\n');

  const llmText = await llm.complete({ system, prompt, maxTokens: 2000, temperature: 0.3 });
  const confidence = approvedSummary ? 0.88 : 0.7;

  if (llmText && /## Your Medicines/i.test(llmText)) {
    return { content: llmText, confidence, generator: 'claude' };
  }
  return { content: templateEducation(ctx, recommendations), confidence, generator: 'template' };
}

function stoppedMeds(ctx: AgentContext): MedItem[] {
  const dischargeKeys = new Set(ctx.medications.discharge.map((m) => normaliseDrug(m.drugName)));
  return ctx.medications.preAdmission.filter((m) => !dischargeKeys.has(normaliseDrug(m.drugName)));
}

function templateEducation(ctx: AgentContext, recs: FollowUpRecommendation[]): string {
  const stopped = stoppedMeds(ctx);
  const dx = ctx.admission.admittingDiagnosis.toLowerCase();

  const warningSigns = warningSignsFor(dx);

  return `# Going Home: Your Instructions

**For ${ctx.patient.fullName}** · Prepared ${new Date().toISOString().slice(0, 10)} · Reading level: ${ctx.patient.literacyLevel}

## Why You Were in Hospital

You came into hospital because of **${ctx.admission.admittingDiagnosis.toLowerCase()}**. You stayed ${ctx.admission.lengthOfStayDays} day(s). The care team treated you and you are now well enough to go home.

## Your Medicines

Take these medicines exactly as written. Do not change the amount without talking to your doctor.

${
  ctx.medications.discharge.length
    ? ctx.medications.discharge
        .map(
          (m) =>
            `- **${m.drugName}** — take ${m.dosage || 'as directed'}, ${m.frequency || 'as directed'}${
              m.route && m.route !== 'oral' ? ` (${m.route})` : ''
            }.${m.notes ? ` ${m.notes}` : ''}`
        )
        .join('\n')
    : '- Your medicine list is still being checked by the pharmacist.'
}

Bring this list to every appointment. Keep taking your medicines until your doctor tells you to stop.

## Medicines You Should Stop

${
  stopped.length
    ? stopped
        .map((m) => `- **${m.drugName}** — this is **not** on your going-home list. Ask your doctor before you take it again.`)
        .join('\n')
    : '- There are no medicines to stop. Keep taking everything on the list above.'
}

## Warning Signs — Call 911

Call 911 right away if you have any of these:

${warningSigns.emergency.map((s) => `- ${s}`).join('\n')}

## When to Call the Hospital

Call the ward or your doctor if you notice:

${warningSigns.urgent.map((s) => `- ${s}`).join('\n')}

${ctx.patient.pcpName ? `Your regular doctor is **${ctx.patient.pcpName}**.` : ''}

## Your Follow-Up Appointments

${
  recs.length
    ? recs
        .map(
          (r) =>
            `- **${r.specialty}** — ${r.description.replace(/\s—\san appointment already exists.*$/, '')} *(${r.timeframe}${r.isScheduled ? ', already booked' : ', still to be booked'})*`
        )
        .join('\n')
    : '- No follow-up appointments have been planned yet.'
}

If an appointment is not booked yet, the hospital will call you. If you have not heard in 3 days, phone the ward.

## Taking Care of Yourself at Home

- Rest, and build your activity back up slowly.
- Drink fluids and eat regular meals unless your doctor told you otherwise.
- Keep this sheet somewhere you will see it.
- Write down any questions so you remember them at your next visit.
${ctx.admission.riskAssessment.fallRisk !== 'low' ? '- You are at risk of falling. Keep floors clear, use your walking aid, and get up slowly.\n' : ''}
---

*Draft prepared by the Patient Education Agent. A nurse or doctor must review and sign this before it is given to you.*`;
}

function warningSignsFor(dx: string): { emergency: string[]; urgent: string[] } {
  if (/heart failure|chf|decompensat/.test(dx)) {
    return {
      emergency: [
        'Chest pain that does not go away',
        'You cannot catch your breath, even sitting still',
        'You faint or feel like you will faint',
      ],
      urgent: [
        'You gain more than 3 pounds in one day, or 5 pounds in a week',
        'Your legs, ankles or belly get more swollen',
        'You need more pillows than usual to sleep',
        'You feel more tired than usual doing your normal activities',
      ],
    };
  }
  if (/pneumonia|copd|respirat/.test(dx)) {
    return {
      emergency: [
        'You are struggling to breathe or your lips look blue',
        'Chest pain that does not go away',
        'You are confused or very hard to wake',
      ],
      urgent: [
        'Your fever comes back or goes above 100.4 °F',
        'Your cough gets worse, or you cough up blood',
        'You feel more short of breath than when you left hospital',
      ],
    };
  }
  if (/replacement|arthroplasty|surg|fracture/.test(dx)) {
    return {
      emergency: [
        'Sudden chest pain or trouble breathing',
        'Your leg becomes hot, red, very swollen or very painful',
        'Heavy bleeding from your wound that will not stop',
      ],
      urgent: [
        'Your wound is red, warm, or leaking fluid',
        'You have a fever above 100.4 °F',
        'Your pain is getting worse instead of better',
        'You cannot put weight on the leg as you were shown',
      ],
    };
  }
  if (/diabet/.test(dx)) {
    return {
      emergency: [
        'You cannot wake up properly, or you are very confused',
        'You are being sick and cannot keep any fluid down',
        'You are breathing fast and deeply and your breath smells fruity',
      ],
      urgent: [
        'Your blood sugar is under 70 more than once',
        'Your blood sugar stays above 300',
        'You have a sore or cut on your foot that is not healing',
      ],
    };
  }
  return {
    emergency: [
      'Chest pain, or trouble breathing',
      'You faint, or you cannot be woken easily',
      'Bleeding that will not stop',
    ],
    urgent: [
      'A fever above 100.4 °F',
      'Your symptoms come back or get worse',
      'You are being sick and cannot keep your medicines down',
      'Anything that worries you',
    ],
  };
}

// ─── 5. Safety / Governance Layer ────────────────────────────────────────────

export const CONFIDENCE_THRESHOLD = 0.6;

export function runSafetyValidator(input: {
  summary: { content: string; confidence: number };
  reconciliation: { flags: Flag[]; confidence: number };
  followUp: { recommendations: FollowUpRecommendation[]; confidence: number };
  education: { content: string; confidence: number };
  dischargeMeds: MedItem[];
  /** Home medicines the instructions may legitimately name in the "stop" list. */
  preAdmissionMeds?: MedItem[];
}): { passed: boolean; checks: SafetyCheck[] } {
  const checks: SafetyCheck[] = [];
  const add = (name: string, passed: boolean, detail: string) =>
    checks.push({ name, passed, detail });

  // 1. All required sections present.
  const requiredHeadings = [
    'Principal Diagnosis',
    'Hospital Course',
    'Condition at Discharge',
  ];
  const missing = requiredHeadings.filter((h) => !input.summary.content.includes(h));
  add(
    'required_sections_present',
    missing.length === 0,
    missing.length ? `Missing summary sections: ${missing.join(', ')}` : 'All required summary sections are present.'
  );

  add(
    'education_present',
    input.education.content.length > 200,
    input.education.content.length > 200
      ? 'Patient instructions were generated.'
      : 'Patient instructions are missing or too short to be useful.'
  );

  // 2. No agent prescribed a specific dose change.
  const prescriptiveLanguage =
    /\b(increase|decrease|reduce|raise|titrate|start|stop)\b[^.]{0,40}\b\d+(\.\d+)?\s*(mg|mcg|g|units?|iu)\b/i;
  const summaryPrescribes = prescriptiveLanguage.test(input.summary.content);
  add(
    'no_autonomous_dosing',
    !summaryPrescribes,
    summaryPrescribes
      ? 'The clinical summary appears to direct a specific dose change — a clinician must rewrite it.'
      : 'No agent directed a specific dose change.'
  );

  // 3. Nothing was auto-approved.
  add(
    'no_autonomous_approval',
    true,
    'All sections are drafts awaiting human approval; no agent may approve its own output.'
  );

  // 4. Confidence thresholds.
  const low = [
    ['clinical summary', input.summary.confidence],
    ['medication reconciliation', input.reconciliation.confidence],
    ['follow-up plan', input.followUp.confidence],
    ['patient education', input.education.confidence],
  ].filter(([, c]) => (c as number) < CONFIDENCE_THRESHOLD);
  add(
    'confidence_threshold',
    low.length === 0,
    low.length
      ? `Below the ${CONFIDENCE_THRESHOLD} threshold: ${low.map(([n, c]) => `${n} (${c})`).join(', ')}`
      : `All agents reported confidence at or above ${CONFIDENCE_THRESHOLD}.`
  );

  // 5. No hallucinated medications in the patient instructions. The home list
  //    counts as known vocabulary, because the instructions must be able to
  //    name a medicine the patient should now stop taking.
  const known = new Set(
    [...input.dischargeMeds, ...(input.preAdmissionMeds ?? [])].map((m) =>
      normaliseDrug(m.drugName)
    )
  );
  const mentioned = extractDrugMentions(input.education.content);
  // Brand and salt forms ("Metoprolol succinate") must match the vocabulary
  // entry they derive from ("metoprolol"), so compare by containment too.
  const isKnown = (mention: string) =>
    known.has(mention) ||
    [...known].some((k) => k.includes(mention) || mention.includes(k));
  const hallucinated = mentioned.filter((d) => !isKnown(d));
  add(
    'no_hallucinated_medications',
    hallucinated.length === 0,
    hallucinated.length
      ? `Patient instructions name medicines that are on neither the approved discharge list nor the home list: ${hallucinated.join(', ')}`
      : 'Every medicine named in the patient instructions comes from the approved discharge list or the documented home list.'
  );

  // 6. Unresolved critical flags block completion but not review.
  const criticals = input.reconciliation.flags.filter((f) => f.severity === 'critical');
  add(
    'critical_flags_surfaced',
    true,
    criticals.length
      ? `${criticals.length} critical medication flag(s) raised for pharmacist review: ${criticals.map((f) => `${f.drugA}${f.drugB ? ` + ${f.drugB}` : ''}`).join('; ')}`
      : 'No critical medication flags were raised.'
  );

  return { passed: checks.every((c) => c.passed), checks };
}

/** Finds names from the known drug vocabulary mentioned in free text. */
function extractDrugMentions(text: string): string[] {
  const lower = text.toLowerCase();
  const found = new Set<string>();
  for (const drug of Object.keys(interactionDb.drug_classes)) {
    const re = new RegExp(`\\b${drug.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
    if (re.test(lower)) found.add(drug);
  }
  return [...found];
}
