import { Medication } from '../src/models/Medication.js';
import { drugClassOf } from '../src/services/clinicalRules.js';
import type { SeededAdmissions } from './admissions.seed.js';
import type { SeededUsers } from './users.seed.js';
import { pick, rand } from './patients.seed.js';

type Route = 'oral' | 'IV' | 'IM' | 'SC' | 'topical' | 'inhaled' | 'rectal';

interface Med {
  drugName: string;
  genericName?: string;
  dosage: string;
  frequency: string;
  route?: Route;
  notes?: string | null;
}

const med = (
  drugName: string,
  dosage: string,
  frequency: string,
  route: Route = 'oral',
  notes: string | null = null
): Med => ({ drugName, genericName: drugName.toLowerCase(), dosage, frequency, route, notes });

/**
 * The four scripted scenarios from Section 10 of the spec. Each list is written
 * so the deterministic reconciliation rules will find exactly the intended
 * discrepancies — nothing is hard-coded as a "flag"; the agent derives them.
 */
const DEMO_MEDS: Record<
  'A' | 'B' | 'C' | 'D',
  { pre_admission: Med[]; inpatient: Med[]; discharge: Med[] }
> = {
  // Patient A — Heart failure, 68.
  // Expected findings: Warfarin + Aspirin interaction (critical),
  // Metformin omission (high), Lisinopril 10 → 20 mg dose change.
  A: {
    pre_admission: [
      med('Lisinopril', '10 mg', 'once daily'),
      med('Metoprolol succinate', '50 mg', 'once daily'),
      med('Furosemide', '40 mg', 'once daily'),
      med('Warfarin', '5 mg', 'once daily in the evening', 'oral', 'Target INR 2.0-3.0 for atrial fibrillation'),
      med('Metformin', '1000 mg', 'twice daily with food'),
      med('Atorvastatin', '40 mg', 'once daily at night'),
    ],
    inpatient: [
      med('Furosemide', '40 mg', 'twice daily', 'IV'),
      med('Metoprolol succinate', '50 mg', 'once daily'),
      med('Warfarin', '5 mg', 'once daily in the evening'),
      med('Atorvastatin', '40 mg', 'once daily at night'),
      med('Potassium chloride', '20 mEq', 'twice daily', 'oral', 'For hypokalaemia during diuresis'),
      med('Enoxaparin', '40 mg', 'once daily', 'SC', 'VTE prophylaxis while INR subtherapeutic'),
    ],
    discharge: [
      med('Lisinopril', '20 mg', 'once daily'),
      med('Metoprolol succinate', '50 mg', 'once daily'),
      med('Furosemide', '40 mg', 'once daily'),
      med('Warfarin', '5 mg', 'once daily in the evening'),
      med('Aspirin', '81 mg', 'once daily'),
      med('Atorvastatin', '40 mg', 'once daily at night'),
    ],
  },

  // Patient B — Pneumonia, 45.
  // Expected findings: duplicate antibiotic therapy (same class twice),
  // Albuterol not continued (omission).
  B: {
    pre_admission: [
      med('Albuterol', '90 mcg', 'two puffs as needed', 'inhaled', 'Rescue inhaler for asthma'),
      med('Fluticasone', '110 mcg', 'two puffs twice daily', 'inhaled'),
      med('Cetirizine', '10 mg', 'once daily'),
    ],
    inpatient: [
      med('Levofloxacin', '750 mg', 'once daily', 'IV'),
      med('Fluticasone', '110 mcg', 'two puffs twice daily', 'inhaled'),
      med('Albuterol', '2.5 mg', 'every 6 hours as needed for wheeze', 'inhaled'),
      med('Acetaminophen', '650 mg', 'every 6 hours as needed for fever'),
    ],
    discharge: [
      med('Levofloxacin', '750 mg', 'once daily', 'oral', 'Complete a further 4 days'),
      med('Ciprofloxacin', '500 mg', 'twice daily', 'oral', 'Added on the ward round'),
      med('Fluticasone', '110 mcg', 'two puffs twice daily', 'inhaled'),
      med('Cetirizine', '10 mg', 'once daily'),
      med('Acetaminophen', '650 mg', 'as needed', 'oral'),
    ],
  },

  // Patient C — Hip replacement, 72, documented sulfa allergy.
  // Expected findings: allergy conflict (Bactrim with a sulfa allergy — critical),
  // opioid not tapered and no bowel regimen, home statin omitted.
  C: {
    pre_admission: [
      med('Atorvastatin', '20 mg', 'once daily at night'),
      med('Alendronate', '70 mg', 'once weekly on Monday'),
      med('Calcium carbonate', '600 mg', 'twice daily'),
      med('Acetaminophen', '500 mg', 'as needed for joint pain'),
    ],
    inpatient: [
      med('Oxycodone', '5 mg', 'every 4 hours as needed for pain'),
      med('Acetaminophen', '1000 mg', 'every 6 hours'),
      med('Enoxaparin', '40 mg', 'once daily', 'SC'),
      med('Docusate', '100 mg', 'twice daily'),
      med('Calcium carbonate', '600 mg', 'twice daily'),
    ],
    discharge: [
      med('Oxycodone', '10 mg', 'every 4 hours as needed', 'oral', 'Taper as tolerated'),
      med('Acetaminophen', '1000 mg', 'every 6 hours'),
      med('Enoxaparin', '40 mg', 'once daily', 'SC', 'Continue for 14 days'),
      med('Bactrim', '800/160 mg', 'twice daily', 'oral', 'For post-operative urinary tract infection'),
      med('Alendronate', '70 mg', 'once weekly on Monday'),
      med('Calcium carbonate', '600 mg', 'twice daily'),
    ],
  },

  // Patient D — Diabetes + CHF, 58.
  // Expected findings: insulin dose mismatch (20 → 42 units), three
  // antihypertensives, potassium supplement dropped while on a loop diuretic,
  // and a lisinopril + spironolactone interaction.
  D: {
    pre_admission: [
      med('Insulin glargine', '20 units', 'once daily at bedtime', 'SC'),
      med('Insulin lispro', '6 units', 'three times daily with meals', 'SC'),
      med('Metformin', '500 mg', 'twice daily'),
      med('Lisinopril', '20 mg', 'once daily'),
      med('Furosemide', '40 mg', 'once daily'),
      med('Potassium chloride', '20 mEq', 'once daily'),
      med('Atorvastatin', '40 mg', 'once daily at night'),
    ],
    inpatient: [
      med('Insulin glargine', '42 units', 'once daily at bedtime', 'SC'),
      med('Insulin lispro', '8 units', 'three times daily with meals', 'SC'),
      med('Furosemide', '40 mg', 'once daily', 'IV'),
      med('Lisinopril', '20 mg', 'once daily'),
      med('Atorvastatin', '40 mg', 'once daily at night'),
    ],
    discharge: [
      med('Insulin glargine', '42 units', 'once daily at bedtime', 'SC'),
      med('Insulin lispro', '8 units', 'three times daily with meals', 'SC'),
      med('Lisinopril', '20 mg', 'once daily'),
      med('Spironolactone', '25 mg', 'once daily'),
      med('Metoprolol succinate', '25 mg', 'once daily'),
      med('Amlodipine', '5 mg', 'once daily'),
      med('Furosemide', '40 mg', 'once daily'),
      med('Atorvastatin', '40 mg', 'once daily at night'),
    ],
  },
};

const COMMON_HOME_MEDS: Med[] = [
  med('Lisinopril', '10 mg', 'once daily'),
  med('Atorvastatin', '20 mg', 'once daily at night'),
  med('Metformin', '500 mg', 'twice daily'),
  med('Omeprazole', '20 mg', 'once daily'),
  med('Levothyroxine', '75 mcg', 'once daily before breakfast'),
  med('Amlodipine', '5 mg', 'once daily'),
  med('Sertraline', '50 mg', 'once daily'),
  med('Gabapentin', '300 mg', 'three times daily'),
  med('Aspirin', '81 mg', 'once daily'),
  med('Metoprolol succinate', '25 mg', 'once daily'),
];

const COMMON_INPATIENT_MEDS: Med[] = [
  med('Enoxaparin', '40 mg', 'once daily', 'SC'),
  med('Acetaminophen', '650 mg', 'every 6 hours as needed'),
  med('Pantoprazole', '40 mg', 'once daily', 'IV'),
  med('Ondansetron', '4 mg', 'every 8 hours as needed', 'IV'),
  med('Ceftriaxone', '1 g', 'once daily', 'IV'),
];

function withClass(meds: Med[], prescriber: unknown) {
  return meds.map((m) => ({
    ...m,
    drugClass: drugClassOf(m.drugName),
    prescribedBy: prescriber,
    startDate: new Date(Date.now() - 7 * 86_400_000),
    endDate: null,
    isActive: true,
  }));
}

export async function seedMedications(users: SeededUsers, admissions: SeededAdmissions) {
  // Loosely typed on purpose: these are plain seed literals that Mongoose casts.
  const docs: any[] = [];

  // Scripted demo lists
  (['A', 'B', 'C', 'D'] as const).forEach((key) => {
    const admission = admissions.demo[key];
    const prescriber = admission.careTeam.attendingPhysician;
    for (const listType of ['pre_admission', 'inpatient', 'discharge'] as const) {
      docs.push({
        patientId: admission.patientId,
        admissionId: admission._id,
        listType,
        medications: withClass(DEMO_MEDS[key][listType], prescriber),
      });
    }
  });

  // Every other admission gets a plausible three-list set.
  const demoIds = new Set(Object.values(admissions.demo).map((a) => String(a._id)));
  for (const admission of admissions.all) {
    if (demoIds.has(String(admission._id))) continue;
    const prescriber = admission.careTeam.attendingPhysician;

    const home = COMMON_HOME_MEDS.filter(() => rand() > 0.55).slice(0, 4);
    if (!home.length) home.push(pick(COMMON_HOME_MEDS));

    const inpatient = [...home.slice(0, 2), pick(COMMON_INPATIENT_MEDS)];
    // Keep most, drop one occasionally so the agent has something to find.
    const discharge = rand() > 0.5 ? home : home.slice(0, Math.max(1, home.length - 1));

    for (const [listType, meds] of [
      ['pre_admission', home],
      ['inpatient', inpatient],
      ['discharge', admission.status === 'discharged' ? discharge : discharge],
    ] as const) {
      docs.push({
        patientId: admission.patientId,
        admissionId: admission._id,
        listType,
        medications: withClass(meds, prescriber),
      });
    }
  }

  return Medication.insertMany(docs);
}
