import { describe, expect, it } from 'vitest';
import {
  drugClassOf,
  findAllergyConflict,
  findInteraction,
  isHighRisk,
  normaliseDrug,
  parseDose,
  resolveProtocol,
} from './clinicalRules.js';
import {
  runFollowUpPlanningAgent,
  runMedicationReconciliationAgent,
  runSafetyValidator,
  type AgentContext,
  type MedItem,
} from './localAgents.js';

const med = (drugName: string, dosage = '', frequency = 'once daily', notes?: string): MedItem => ({
  drugName,
  dosage,
  frequency,
  route: 'oral',
  notes: notes ?? null,
});

function context(overrides: {
  pre?: MedItem[];
  discharge?: MedItem[];
  allergies?: { substance: string; severity?: string }[];
  diagnosis?: string;
  codes?: string[];
}): AgentContext {
  return {
    patient: {
      fullName: 'Test Patient',
      age: 68,
      gender: 'male',
      preferredLanguage: 'English',
      literacyLevel: 'basic',
      allergies: overrides.allergies ?? [],
      conditions: [],
    },
    admission: {
      admissionId: 'ADM-TEST-0001',
      admittingDiagnosis: overrides.diagnosis ?? 'Acute decompensated heart failure',
      diagnosisCodes: overrides.codes ?? ['I50.23'],
      admissionDate: new Date(Date.now() - 4 * 86_400_000).toISOString(),
      lengthOfStayDays: 4,
      ward: 'Cardiology 3B',
      notes: [],
      labs: [],
      procedures: [],
      riskAssessment: { fallRisk: 'low', pressureInjuryRisk: 'low', infectionFlags: [] },
    },
    vitals: [],
    medications: {
      preAdmission: overrides.pre ?? [],
      inpatient: [],
      discharge: overrides.discharge ?? [],
    },
    existingAppointments: [],
  };
}

describe('drug name normalisation', () => {
  it.each([
    ['Warfarin 5 mg tablet', 'warfarin'],
    ['Bactrim', 'trimethoprim-sulfamethoxazole'],
    ['Coumadin', 'warfarin'],
    ['  LISINOPRIL  ', 'lisinopril'],
    ['Lasix 40mg', 'furosemide'],
  ])('normalises %s to %s', (input, expected) => {
    expect(normaliseDrug(input)).toBe(expected);
  });

  it('classifies salt forms', () => {
    expect(drugClassOf('Metoprolol succinate')).toBe('Beta blocker');
    expect(drugClassOf('Insulin glargine')).toBe('Long-acting insulin');
  });

  it('knows which classes are high risk', () => {
    expect(isHighRisk('Warfarin')).toBe(true);
    expect(isHighRisk('Metformin')).toBe(true);
    expect(isHighRisk('Acetaminophen')).toBe(false);
  });

  it('parses doses', () => {
    expect(parseDose('20 mg')).toEqual({ value: 20, unit: 'mg' });
    expect(parseDose('42 units')).toEqual({ value: 42, unit: 'unit' });
    expect(parseDose('as directed')).toBeNull();
  });
});

describe('knowledge base lookups', () => {
  it('finds an interaction regardless of argument order', () => {
    const a = findInteraction('Warfarin', 'Aspirin');
    const b = findInteraction('Aspirin', 'Warfarin');
    expect(a).not.toBeNull();
    expect(a).toEqual(b);
    expect(a?.severity).toBe('critical');
  });

  it('matches a sulfa allergy against Bactrim', () => {
    const hit = findAllergyConflict('Bactrim', [{ substance: 'Sulfa', severity: 'severe' }]);
    expect(hit?.rule.severity).toBe('critical');
  });

  it('resolves a protocol by ICD code, then by keyword, then falls back', () => {
    expect(resolveProtocol('anything', ['I50.23']).label).toBe('Heart failure');
    expect(resolveProtocol('Community-acquired pneumonia', []).label).toBe('Pneumonia');
    expect(resolveProtocol('Something unmapped', []).label).toBe('General medical admission');
  });
});

describe('medication reconciliation agent', () => {
  it('finds the three scripted findings for the heart failure patient', () => {
    const { flags } = runMedicationReconciliationAgent(
      context({
        pre: [med('Lisinopril', '10 mg'), med('Warfarin', '5 mg'), med('Metformin', '1000 mg')],
        discharge: [med('Lisinopril', '20 mg'), med('Warfarin', '5 mg'), med('Aspirin', '81 mg')],
      })
    );

    const interaction = flags.find((f) => f.type === 'interaction');
    expect(interaction?.severity).toBe('critical');
    expect([interaction?.drugA, interaction?.drugB].sort()).toEqual(['Aspirin', 'Warfarin']);

    const omission = flags.find((f) => f.type === 'omission');
    expect(omission?.drugA).toBe('Metformin');
    expect(omission?.severity).toBe('high');

    const dose = flags.find((f) => f.type === 'dose_mismatch');
    expect(dose?.drugA).toBe('Lisinopril');
    expect(dose?.severity).toBe('low');
  });

  it('blocks Bactrim against a documented sulfa allergy', () => {
    const { flags } = runMedicationReconciliationAgent(
      context({
        discharge: [med('Bactrim', '800/160 mg', 'twice daily')],
        allergies: [{ substance: 'Sulfa', severity: 'life-threatening' }],
      })
    );
    const allergy = flags.find((f) => f.type === 'allergy_conflict');
    expect(allergy?.severity).toBe('critical');
    expect(allergy?.recommendation.toLowerCase()).toContain('do not dispense');
  });

  it('flags duplicate therapy within a drug class', () => {
    const { flags } = runMedicationReconciliationAgent(
      context({
        discharge: [med('Levofloxacin', '750 mg'), med('Ciprofloxacin', '500 mg')],
      })
    );
    const dup = flags.find((f) => f.type === 'duplication');
    expect(dup).toBeDefined();
    expect(dup?.description).toContain('Fluoroquinolone');
  });

  it('calls out three or more antihypertensives', () => {
    const { flags } = runMedicationReconciliationAgent(
      context({
        discharge: [
          med('Lisinopril', '20 mg'),
          med('Metoprolol succinate', '25 mg'),
          med('Amlodipine', '5 mg'),
        ],
      })
    );
    expect(flags.some((f) => f.description.includes('blood-pressure-lowering agents'))).toBe(true);
  });

  it('treats an insulin dose change as high severity', () => {
    const { flags } = runMedicationReconciliationAgent(
      context({
        pre: [med('Insulin glargine', '20 units', 'at bedtime')],
        discharge: [med('Insulin glargine', '42 units', 'at bedtime')],
      })
    );
    const dose = flags.find((f) => f.type === 'dose_mismatch');
    expect(dose?.severity).toBe('high');
  });

  it('raises nothing when the lists match', () => {
    const meds = [med('Atorvastatin', '20 mg'), med('Levothyroxine', '75 mcg')];
    const result = runMedicationReconciliationAgent(
      context({ pre: meds, discharge: [...meds] })
    );
    expect(result.flags).toHaveLength(0);
    expect(result.confidence).toBe(0.95);
  });

  it('respects a documented reason for stopping a medicine', () => {
    const { flags } = runMedicationReconciliationAgent(
      context({
        pre: [med('Ibuprofen', '400 mg', 'as needed', 'Stopped due to GI bleeding risk')],
        discharge: [med('Acetaminophen', '650 mg', 'every 6 hours as needed for pain')],
      })
    );
    expect(flags.filter((f) => f.type === 'omission')).toHaveLength(0);
  });

  it('flags a PRN with no indication', () => {
    const { flags } = runMedicationReconciliationAgent(
      context({ discharge: [med('Acetaminophen', '650 mg', 'PRN')] })
    );
    expect(flags.some((f) => f.type === 'unclear_instruction')).toBe(true);
  });

  it('orders findings most severe first', () => {
    const { flags } = runMedicationReconciliationAgent(
      context({
        pre: [med('Metformin', '1000 mg')],
        discharge: [med('Warfarin', '5 mg'), med('Aspirin', '81 mg')],
      })
    );
    const rank = ['critical', 'high', 'medium', 'low'];
    const indices = flags.map((f) => rank.indexOf(f.severity));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });
});

describe('follow-up planning agent', () => {
  it('applies the heart failure protocol', () => {
    const { recommendations, confidence } = runFollowUpPlanningAgent(
      context({ codes: ['I50.23'] })
    );
    const cardiology = recommendations.find((r) => r.specialty === 'Cardiology');
    expect(cardiology?.dueInDays).toBe(7);
    expect(cardiology?.priority).toBe('required');
    expect(confidence).toBeGreaterThan(0.8);
  });

  it('adds an INR check for a patient going home on warfarin', () => {
    const { recommendations } = runFollowUpPlanningAgent(
      context({ codes: ['I50.23'], discharge: [med('Warfarin', '5 mg')] })
    );
    expect(recommendations.some((r) => r.description.includes('INR'))).toBe(true);
  });

  it('does not duplicate a check the diagnosis protocol already covers', () => {
    const { recommendations } = runFollowUpPlanningAgent(
      context({ codes: ['I50.23'], discharge: [med('Furosemide', '40 mg')] })
    );
    // The heart failure protocol already orders a BMP for potassium.
    const potassiumChecks = recommendations.filter((r) =>
      r.description.toLowerCase().includes('potassium')
    );
    expect(potassiumChecks).toHaveLength(1);
  });

  it('marks a recommendation as already scheduled when an appointment exists', () => {
    const ctx = context({ codes: ['I50.23'] });
    ctx.existingAppointments = [
      {
        specialty: 'Cardiology',
        type: 'specialist',
        scheduledDate: new Date(Date.now() + 6 * 86_400_000).toISOString(),
      },
    ];
    const { recommendations } = runFollowUpPlanningAgent(ctx);
    expect(recommendations.find((r) => r.specialty === 'Cardiology')?.isScheduled).toBe(true);
  });

  it('falls back to the general protocol with lower confidence', () => {
    const { confidence } = runFollowUpPlanningAgent(
      context({ diagnosis: 'Something unmapped', codes: [] })
    );
    expect(confidence).toBeLessThan(0.7);
  });
});

describe('safety validator', () => {
  const baseline = {
    summary: {
      content: '## Principal Diagnosis\nHeart failure\n## Hospital Course\nTreated.\n## Condition at Discharge\nStable.',
      confidence: 0.9,
    },
    reconciliation: { flags: [], confidence: 0.9 },
    followUp: { recommendations: [], confidence: 0.9 },
    education: { content: 'x'.repeat(250), confidence: 0.9 },
    dischargeMeds: [med('Warfarin', '5 mg')],
    preAdmissionMeds: [med('Metformin', '1000 mg')],
  };

  it('passes a clean package', () => {
    const result = runSafetyValidator(baseline);
    expect(result.passed).toBe(true);
    expect(result.checks).toHaveLength(7);
  });

  it('fails when a summary section is missing', () => {
    const result = runSafetyValidator({
      ...baseline,
      summary: { content: '## Principal Diagnosis\nOnly this.', confidence: 0.9 },
    });
    expect(result.checks.find((c) => c.name === 'required_sections_present')?.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('fails when an agent directs a dose change', () => {
    const result = runSafetyValidator({
      ...baseline,
      summary: {
        content: `${baseline.summary.content}\nIncrease the lisinopril to 20 mg daily.`,
        confidence: 0.9,
      },
    });
    expect(result.checks.find((c) => c.name === 'no_autonomous_dosing')?.passed).toBe(false);
  });

  it('fails when confidence is below the threshold', () => {
    const result = runSafetyValidator({
      ...baseline,
      education: { ...baseline.education, confidence: 0.4 },
    });
    expect(result.checks.find((c) => c.name === 'confidence_threshold')?.passed).toBe(false);
  });

  it('catches a medicine that is on neither list', () => {
    const result = runSafetyValidator({
      ...baseline,
      education: { content: `${'x'.repeat(250)} Take your oxycodone every morning.`, confidence: 0.9 },
    });
    expect(result.checks.find((c) => c.name === 'no_hallucinated_medications')?.passed).toBe(false);
  });

  it('allows the instructions to name a medicine the patient should stop', () => {
    const result = runSafetyValidator({
      ...baseline,
      education: {
        content: `${'x'.repeat(250)} Do not restart your Metformin until your doctor says so.`,
        confidence: 0.9,
      },
    });
    expect(result.checks.find((c) => c.name === 'no_hallucinated_medications')?.passed).toBe(true);
  });

  it('never lets an agent approve its own output', () => {
    const check = runSafetyValidator(baseline).checks.find(
      (c) => c.name === 'no_autonomous_approval'
    );
    expect(check?.passed).toBe(true);
  });
});
