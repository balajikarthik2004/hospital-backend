import { Admission } from '../src/models/Admission.js';
import { Bed } from '../src/models/Bed.js';
import { ID_PREFIX } from '../src/utils/idGenerator.js';
import { pick, rand, randInt } from './patients.seed.js';
import type { SeededPatients } from './patients.seed.js';
import type { SeededUsers } from './users.seed.js';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);

interface DemoAdmission {
  key: 'A' | 'B' | 'C' | 'D';
  diagnosis: string;
  codes: string[];
  ward: string;
  daysIn: number;
  physicianEmail: string;
  fallRisk: 'low' | 'moderate' | 'high';
  pressureInjuryRisk: 'low' | 'moderate' | 'high';
  infectionFlags: string[];
  notes: { type: string; content: string; dayOffset: number }[];
  labs: { testName: string; value: string; unit: string; referenceRange: string; isAbnormal: boolean }[];
  procedures: { name: string; dayOffset: number; notes: string }[];
}

/** Richly documented admissions so the Clinical Summary Agent has real material. */
const DEMO_ADMISSIONS: DemoAdmission[] = [
  {
    key: 'A',
    diagnosis: 'Acute decompensated heart failure',
    codes: ['I50.23', 'I48.91', 'E11.9'],
    ward: 'Cardiology 3B',
    daysIn: 4,
    physicianEmail: 'dr.sharma@safedischarge.demo',
    fallRisk: 'moderate',
    pressureInjuryRisk: 'low',
    infectionFlags: [],
    notes: [
      {
        type: 'assessment',
        dayOffset: 4,
        content:
          'Presented to the emergency department with four days of worsening exertional dyspnoea, orthopnoea requiring three pillows, and a 6 kg weight gain. On examination: bibasal crackles to mid-zones, raised JVP at 9 cm, pitting oedema to mid-shin bilaterally. In atrial fibrillation at 112 bpm. Chest radiograph shows pulmonary venous congestion and small bilateral effusions. NT-proBNP markedly elevated. Impression: acute decompensated HFrEF, likely precipitated by dietary sodium indiscretion and suboptimal diuretic adherence.',
      },
      {
        type: 'progress',
        dayOffset: 3,
        content:
          'Commenced on intravenous diuresis. Net negative 2.1 L over the first 24 hours. Symptomatically improved; now comfortable on two pillows. Rate control adequate following beta-blocker uptitration. Renal function stable. Potassium 3.4 — repleted.',
      },
      {
        type: 'nursing',
        dayOffset: 2,
        content:
          'Daily weight down a further 1.4 kg. Patient ambulating to the bathroom independently with a steadying hand. Reports much easier breathing. Strict fluid balance maintained. Education on daily weights commenced; patient able to teach back the 3 lb rule with prompting.',
      },
      {
        type: 'consultation',
        dayOffset: 2,
        content:
          'Cardiology review: euvolaemic target nearly reached. Transition to oral diuretic planned. Echocardiogram confirms LVEF 32%, moderate mitral regurgitation, dilated left atrium. Guideline-directed medical therapy to be optimised as an outpatient. Anticoagulation for atrial fibrillation to continue.',
      },
      {
        type: 'progress',
        dayOffset: 1,
        content:
          'Transitioned to oral diuretic yesterday and has maintained weight overnight. Ambulated the ward corridor without desaturation. Appears euvolaemic: JVP 5 cm, trace ankle oedema only, chest clear. Suitable for discharge planning.',
      },
    ],
    labs: [
      { testName: 'NT-proBNP', value: '4820', unit: 'pg/mL', referenceRange: '<300', isAbnormal: true },
      { testName: 'Creatinine', value: '1.4', unit: 'mg/dL', referenceRange: '0.7-1.3', isAbnormal: true },
      { testName: 'Potassium', value: '3.4', unit: 'mmol/L', referenceRange: '3.5-5.1', isAbnormal: true },
      { testName: 'Sodium', value: '134', unit: 'mmol/L', referenceRange: '136-145', isAbnormal: true },
      { testName: 'Haemoglobin', value: '12.8', unit: 'g/dL', referenceRange: '13.5-17.5', isAbnormal: true },
      { testName: 'INR', value: '2.4', unit: '', referenceRange: '2.0-3.0 (on warfarin)', isAbnormal: false },
      { testName: 'HbA1c', value: '7.6', unit: '%', referenceRange: '<7.0', isAbnormal: true },
    ],
    procedures: [
      {
        name: 'Transthoracic echocardiogram',
        dayOffset: 2,
        notes: 'LVEF 32%, moderate mitral regurgitation, dilated left atrium, no pericardial effusion.',
      },
    ],
  },
  {
    key: 'B',
    diagnosis: 'Community-acquired pneumonia, right lower lobe',
    codes: ['J18.1', 'J45.909'],
    ward: 'General Medicine 2A',
    daysIn: 3,
    physicianEmail: 'dr.nair@safedischarge.demo',
    fallRisk: 'low',
    pressureInjuryRisk: 'low',
    infectionFlags: ['droplet_precautions'],
    notes: [
      {
        type: 'assessment',
        dayOffset: 3,
        content:
          'Three days of productive cough with rust-coloured sputum, fever to 39.1 °C, and right-sided pleuritic chest pain. Examination: bronchial breathing and crackles at the right base, respiratory rate 26, saturations 91% on room air. Chest radiograph confirms right lower lobe consolidation. CURB-65 score 1. Known penicillin allergy with urticaria and facial swelling — beta-lactams avoided.',
      },
      {
        type: 'progress',
        dayOffset: 2,
        content:
          'Afebrile for 18 hours on non-beta-lactam cover. Oxygen requirement weaned to room air with saturations 95%. Cough remains productive but less frequent. Inflammatory markers falling.',
      },
      {
        type: 'nursing',
        dayOffset: 1,
        content:
          'Independent with all activities of daily living. Tolerating a full diet. Completed incentive spirometry teaching and demonstrates good technique. Asking when she can return to work.',
      },
      {
        type: 'progress',
        dayOffset: 1,
        content:
          'Clinically much improved. Saturations 96% on room air at rest and 94% after walking the corridor. Suitable to complete the antibiotic course at home. Asthma stable throughout; no rescue inhaler use in 24 hours.',
      },
    ],
    labs: [
      { testName: 'White cell count', value: '15.8', unit: '10⁹/L', referenceRange: '4.0-11.0', isAbnormal: true },
      { testName: 'C-reactive protein', value: '142', unit: 'mg/L', referenceRange: '<5', isAbnormal: true },
      { testName: 'Procalcitonin', value: '1.8', unit: 'ng/mL', referenceRange: '<0.5', isAbnormal: true },
      { testName: 'Creatinine', value: '0.8', unit: 'mg/dL', referenceRange: '0.6-1.1', isAbnormal: false },
      { testName: 'Blood culture', value: 'No growth at 48 hours', unit: '', referenceRange: 'No growth', isAbnormal: false },
    ],
    procedures: [
      { name: 'Chest radiograph (PA and lateral)', dayOffset: 3, notes: 'Right lower lobe consolidation, no effusion.' },
    ],
  },
  {
    key: 'C',
    diagnosis: 'Elective total hip arthroplasty, right',
    codes: ['Z96.641', 'M16.11'],
    ward: 'General Medicine 2A',
    daysIn: 3,
    physicianEmail: 'dr.reddy@safedischarge.demo',
    fallRisk: 'high',
    pressureInjuryRisk: 'moderate',
    infectionFlags: [],
    notes: [
      {
        type: 'procedure',
        dayOffset: 3,
        content:
          'Right total hip arthroplasty performed via a posterior approach under spinal anaesthesia. Uncemented acetabular and femoral components. Estimated blood loss 350 mL. No intraoperative complications. Documented sulfa allergy with prior Stevens-Johnson syndrome — flagged to theatre and pharmacy.',
      },
      {
        type: 'nursing',
        dayOffset: 2,
        content:
          'First postoperative day. Mobilised to the edge of the bed and took four steps with a frame and two assistants. Wound dressing dry and intact. Pain controlled with the current regimen; reports 4/10 on movement. Hip precautions reinforced.',
      },
      {
        type: 'progress',
        dayOffset: 2,
        content:
          'Haemoglobin drop from 12.6 to 9.8 as expected postoperatively; haemodynamically stable, not symptomatic, no transfusion required. Continue venous thromboembolism prophylaxis.',
      },
      {
        type: 'consultation',
        dayOffset: 1,
        content:
          'Physiotherapy: mobilising 25 metres with a frame, supervision only. Able to manage three practice steps. Safe for discharge home with a walker provided a family member is present for the first 48 hours. Outpatient physiotherapy recommended three times weekly.',
      },
      {
        type: 'progress',
        dayOffset: 0,
        content:
          'Wound clean and dry with no erythema. Afebrile. Mobilising well. Fit for discharge once the home environment is confirmed and equipment is delivered.',
      },
    ],
    labs: [
      { testName: 'Haemoglobin', value: '9.8', unit: 'g/dL', referenceRange: '12.0-15.5', isAbnormal: true },
      { testName: 'White cell count', value: '10.2', unit: '10⁹/L', referenceRange: '4.0-11.0', isAbnormal: false },
      { testName: 'Creatinine', value: '0.9', unit: 'mg/dL', referenceRange: '0.6-1.1', isAbnormal: false },
      { testName: 'C-reactive protein', value: '68', unit: 'mg/L', referenceRange: '<5', isAbnormal: true },
    ],
    procedures: [
      {
        name: 'Total hip arthroplasty, right (posterior approach)',
        dayOffset: 3,
        notes: 'Uncemented components. Estimated blood loss 350 mL. No complications.',
      },
    ],
  },
  {
    key: 'D',
    diagnosis: 'Diabetic ketoacidosis with acute heart failure exacerbation',
    codes: ['E11.10', 'I50.9', 'N18.3'],
    ward: 'ICU 4',
    daysIn: 5,
    physicianEmail: 'dr.verma@safedischarge.demo',
    fallRisk: 'moderate',
    pressureInjuryRisk: 'moderate',
    infectionFlags: [],
    notes: [
      {
        type: 'assessment',
        dayOffset: 5,
        content:
          'Admitted via the emergency department with blood glucose 486 mg/dL, ketones 4.8 mmol/L, venous pH 7.21 and bicarbonate 12. Concurrent volume overload with bibasal crackles and peripheral oedema. Precipitant appears to be a missed insulin dose during an intercurrent viral illness. Admitted to intensive care for a variable-rate insulin infusion and careful fluid balance given the known heart failure and stage 3 chronic kidney disease.',
      },
      {
        type: 'progress',
        dayOffset: 4,
        content:
          'Ketoacidosis resolved within 16 hours. Transitioned from the insulin infusion to a subcutaneous regimen. Fluid balance managed cautiously; a single intravenous diuretic dose given for pulmonary congestion. Creatinine peaked at 1.9 and is now improving.',
      },
      {
        type: 'consultation',
        dayOffset: 3,
        content:
          'Endocrinology: the home insulin regimen appears inadequate and adherence has been inconsistent. Recommend an increased basal dose with structured outpatient titration and a review of the sick-day plan.',
      },
      {
        type: 'progress',
        dayOffset: 2,
        content:
          'Stepped down from intensive care to the ward. Glucose profile improving on the revised regimen, ranging 130 to 190. Euvolaemic clinically. Blood pressure running 148/88 on current therapy.',
      },
      {
        type: 'nursing',
        dayOffset: 1,
        content:
          'Blood glucose monitoring four times daily, all readings between 124 and 178. Patient demonstrated correct injection technique and has been given a written sick-day plan. Expresses anxiety about managing the new regimen at home.',
      },
    ],
    labs: [
      { testName: 'Glucose', value: '486', unit: 'mg/dL', referenceRange: '70-140', isAbnormal: true },
      { testName: 'Beta-hydroxybutyrate', value: '4.8', unit: 'mmol/L', referenceRange: '<0.6', isAbnormal: true },
      { testName: 'Bicarbonate', value: '12', unit: 'mmol/L', referenceRange: '22-29', isAbnormal: true },
      { testName: 'Creatinine', value: '1.9', unit: 'mg/dL', referenceRange: '0.7-1.3', isAbnormal: true },
      { testName: 'Potassium', value: '3.2', unit: 'mmol/L', referenceRange: '3.5-5.1', isAbnormal: true },
      { testName: 'HbA1c', value: '10.4', unit: '%', referenceRange: '<7.0', isAbnormal: true },
      { testName: 'NT-proBNP', value: '2980', unit: 'pg/mL', referenceRange: '<300', isAbnormal: true },
      { testName: 'eGFR', value: '46', unit: 'mL/min/1.73m²', referenceRange: '>60', isAbnormal: true },
    ],
    procedures: [],
  },
];

const OTHER_DIAGNOSES: { dx: string; codes: string[]; ward: string }[] = [
  { dx: 'COPD exacerbation', codes: ['J44.1'], ward: 'General Medicine 2A' },
  { dx: 'Urinary tract infection with sepsis', codes: ['A41.51', 'N39.0'], ward: 'General Medicine 2A' },
  { dx: 'Cellulitis of the left lower leg', codes: ['L03.116'], ward: 'General Medicine 2A' },
  { dx: 'Non-ST-elevation myocardial infarction', codes: ['I21.4'], ward: 'Cardiology 3B' },
  { dx: 'Atrial fibrillation with rapid ventricular response', codes: ['I48.91'], ward: 'Cardiology 3B' },
  { dx: 'Upper gastrointestinal haemorrhage', codes: ['K92.2'], ward: 'General Medicine 2A' },
  { dx: 'Acute kidney injury on chronic kidney disease', codes: ['N17.9', 'N18.3'], ward: 'ICU 4' },
  { dx: 'Community-acquired pneumonia', codes: ['J18.9'], ward: 'General Medicine 2A' },
  { dx: 'Acute exacerbation of asthma', codes: ['J45.901'], ward: 'Pediatrics 1C' },
  { dx: 'Hyperglycaemia and dehydration', codes: ['E11.65'], ward: 'General Medicine 2A' },
  { dx: 'Syncope under investigation', codes: ['R55'], ward: 'Cardiology 3B' },
  { dx: 'Acute diverticulitis', codes: ['K57.32'], ward: 'General Medicine 2A' },
  { dx: 'Pyelonephritis', codes: ['N10'], ward: 'General Medicine 2A' },
  { dx: 'Transient ischaemic attack', codes: ['G45.9'], ward: 'ICU 4' },
  { dx: 'Decompensated liver disease', codes: ['K70.30'], ward: 'General Medicine 2A' },
  { dx: 'Elective knee arthroplasty', codes: ['Z96.651', 'M17.11'], ward: 'General Medicine 2A' },
];

const GENERIC_NOTES = [
  'Admitted via the emergency department. Initial assessment and treatment commenced in line with the standard pathway for this presentation.',
  'Overnight progress satisfactory. Observations stable and the patient reports symptomatic improvement.',
  'Reviewed on the consultant round. Treatment plan continued without change. Discharge planning to begin once clinically stable.',
  'Nursing observations within acceptable limits. Patient independent with activities of daily living and tolerating diet.',
];

export async function seedAdmissions(users: SeededUsers, patients: SeededPatients) {
  // Loosely typed on purpose: these are plain seed literals that Mongoose casts.
  const docs: any[] = [];
  const day = new Date();
  const stamp = `${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, '0')}${String(day.getDate()).padStart(2, '0')}`;
  let counter = 0;
  const makeId = () => `${ID_PREFIX.admission}-${stamp}-${String(++counter).padStart(4, '0')}`;

  const physicianByEmail = new Map(users.physicians.map((p) => [p.email, p]));
  const nursesByDept = (dept: string) =>
    users.nurses.filter((n) => n.department.toLowerCase().includes(dept.toLowerCase()));

  // ─── 1. The four scripted demo admissions ───
  for (const d of DEMO_ADMISSIONS) {
    const patient = patients.demo[d.key];
    const physician = physicianByEmail.get(d.physicianEmail) ?? users.physicians[0];
    const wardNurses = nursesByDept(d.ward.split(' ')[0]);
    const nurses = (wardNurses.length ? wardNurses : users.nurses).slice(0, 2);

    docs.push({
      admissionId: makeId(),
      patientId: patient._id,
      admittingDiagnosis: d.diagnosis,
      diagnosisCodes: d.codes,
      admissionDate: daysAgo(d.daysIn),
      expectedDischargeDate: daysAgo(-1),
      actualDischargeDate: null,
      bed: { ward: d.ward, roomNumber: '', bedNumber: '' },
      careTeam: {
        attendingPhysician: physician._id,
        nurses: nurses.map((n) => n._id),
        specialists: [],
        pharmacist: users.pharmacists[0]._id,
        careCoordinator: users.coordinators[0]._id,
      },
      riskAssessment: {
        fallRisk: d.fallRisk,
        pressureInjuryRisk: d.pressureInjuryRisk,
        infectionFlags: d.infectionFlags,
      },
      status: 'active',
      clinicalNotes: d.notes.map((n) => ({
        author: n.type === 'nursing' ? nurses[0]._id : physician._id,
        type: n.type,
        content: n.content,
        createdAt: daysAgo(n.dayOffset),
      })),
      labResults: d.labs.map((l, i) => ({
        ...l,
        orderedBy: physician._id,
        resultDate: daysAgo(Math.max(0, d.daysIn - Math.floor(i / 3))),
      })),
      procedures: d.procedures.map((p) => ({
        name: p.name,
        date: daysAgo(p.dayOffset),
        performedBy: physician._id,
        notes: p.notes,
      })),
    });
  }

  // ─── 2. Eleven more active admissions ───
  const otherAdmitted = patients.all.filter(
    (p) => p.status === 'admitted' || p.status === 'in_treatment'
  );
  const extraActive = otherAdmitted.filter(
    (p) => !Object.values(patients.demo).some((d) => String(d._id) === String(p._id))
  );

  extraActive.forEach((patient, i) => {
    const spec = OTHER_DIAGNOSES[i % OTHER_DIAGNOSES.length];
    const physician = users.physicians[i % users.physicians.length];
    const daysIn = randInt(1, 8);

    docs.push({
      admissionId: makeId(),
      patientId: patient._id,
      admittingDiagnosis: spec.dx,
      diagnosisCodes: spec.codes,
      admissionDate: daysAgo(daysIn),
      expectedDischargeDate: daysAgo(-randInt(1, 4)),
      actualDischargeDate: null,
      bed: { ward: spec.ward, roomNumber: '', bedNumber: '' },
      careTeam: {
        attendingPhysician: physician._id,
        nurses: [users.nurses[i % users.nurses.length]._id],
        specialists: [],
        pharmacist: users.pharmacists[i % users.pharmacists.length]._id,
        careCoordinator: users.coordinators[i % users.coordinators.length]._id,
      },
      riskAssessment: {
        fallRisk: pick(['low', 'moderate', 'high'] as const),
        pressureInjuryRisk: pick(['low', 'moderate'] as const),
        infectionFlags: rand() > 0.8 ? ['contact_precautions'] : [],
      },
      status: 'active',
      clinicalNotes: Array.from({ length: randInt(2, 4) }, (_, k) => ({
        author: physician._id,
        type: pick(['progress', 'assessment', 'nursing'] as const),
        content: GENERIC_NOTES[k % GENERIC_NOTES.length],
        createdAt: daysAgo(Math.max(0, daysIn - k)),
      })),
      labResults: [
        {
          testName: 'Haemoglobin',
          value: String(randInt(95, 155) / 10),
          unit: 'g/dL',
          referenceRange: '12.0-17.5',
          isAbnormal: rand() > 0.6,
          orderedBy: physician._id,
          resultDate: daysAgo(daysIn),
        },
        {
          testName: 'White cell count',
          value: String(randInt(40, 180) / 10),
          unit: '10⁹/L',
          referenceRange: '4.0-11.0',
          isAbnormal: rand() > 0.5,
          orderedBy: physician._id,
          resultDate: daysAgo(daysIn),
        },
        {
          testName: 'Creatinine',
          value: String(randInt(60, 210) / 100),
          unit: 'mg/dL',
          referenceRange: '0.6-1.3',
          isAbnormal: rand() > 0.7,
          orderedBy: physician._id,
          resultDate: daysAgo(Math.max(0, daysIn - 1)),
        },
      ],
      procedures: [],
    });
  });

  // ─── 3. Five completed admissions, for readmission and volume metrics ───
  const dischargedPatients = patients.all.filter((p) => p.status === 'discharged');
  dischargedPatients.forEach((patient, i) => {
    const spec = OTHER_DIAGNOSES[(i + 5) % OTHER_DIAGNOSES.length];
    const physician = users.physicians[i % users.physicians.length];
    const admittedDaysAgo = randInt(25, 70);
    const los = randInt(2, 7);

    docs.push({
      admissionId: makeId(),
      patientId: patient._id,
      admittingDiagnosis: spec.dx,
      diagnosisCodes: spec.codes,
      admissionDate: daysAgo(admittedDaysAgo),
      expectedDischargeDate: daysAgo(admittedDaysAgo - los),
      actualDischargeDate: daysAgo(admittedDaysAgo - los),
      bed: { ward: spec.ward, roomNumber: '', bedNumber: '' },
      careTeam: {
        attendingPhysician: physician._id,
        nurses: [users.nurses[i % users.nurses.length]._id],
        specialists: [],
        pharmacist: users.pharmacists[0]._id,
        careCoordinator: users.coordinators[0]._id,
      },
      riskAssessment: { fallRisk: 'low', pressureInjuryRisk: 'low', infectionFlags: [] },
      status: 'discharged',
      clinicalNotes: [
        {
          author: physician._id,
          type: 'progress',
          content: GENERIC_NOTES[0],
          createdAt: daysAgo(admittedDaysAgo),
        },
        {
          author: physician._id,
          type: 'progress',
          content: 'Clinically well and fit for discharge. Follow-up arranged with primary care.',
          createdAt: daysAgo(admittedDaysAgo - los),
        },
      ],
      labResults: [],
      procedures: [],
    });
  });

  const admissions = await Admission.insertMany(docs);

  // ─── Assign real beds to the active admissions ───
  for (const admission of admissions) {
    if (admission.status !== 'active') continue;
    const bed = await Bed.findOne({ ward: admission.bed.ward, status: 'available' }).sort(
      'roomNumber bedNumber'
    );
    if (!bed) continue;

    bed.status = 'occupied';
    bed.currentPatientId = admission.patientId;
    bed.currentAdmissionId = admission._id;
    await bed.save();

    admission.bed.roomNumber = bed.roomNumber;
    admission.bed.bedNumber = bed.bedNumber;
    await admission.save();
  }

  const active = admissions.filter((a) => a.status === 'active');
  return {
    all: admissions,
    active,
    discharged: admissions.filter((a) => a.status === 'discharged'),
    demo: {
      A: admissions[0],
      B: admissions[1],
      C: admissions[2],
      D: admissions[3],
    },
  };
}

export type SeededAdmissions = Awaited<ReturnType<typeof seedAdmissions>>;
