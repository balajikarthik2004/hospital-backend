import { Patient } from '../src/models/Patient.js';
import { nextId, ID_PREFIX } from '../src/utils/idGenerator.js';

/** Deterministic pseudo-random so every seed run produces the same demo. */
let seed = 42;
export function rand(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
export const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
export const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
export function resetRand(s = 42) {
  seed = s;
}

const dobFromAge = (years: number) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  d.setMonth(randInt(0, 11), randInt(1, 28));
  return d;
};

const CITIES = [
  ['Springfield', 'MA', '01103'],
  ['Riverton', 'NJ', '08077'],
  ['Fairview', 'OR', '97024'],
  ['Clayton', 'MO', '63105'],
  ['Kingsport', 'TN', '37660'],
  ['Brookhaven', 'GA', '30319'],
];

const INSURERS = [
  ['Meridian Health', 'PPO'],
  ['Northstar Mutual', 'HMO'],
  ['Civic Care', 'EPO'],
  ['Allied Benefit', 'PPO'],
  ['Unity Plan', 'Medicare Advantage'],
];

const PCPS = [
  ['Dr. Anil Kulkarni', 'Westside Family Practice'],
  ['Dr. Nisha Bhaskar', 'Harbour Primary Care'],
  ['Dr. Omar Siddiqui', 'Lakeview Medical Group'],
  ['Dr. Geeta Lohia', 'Cedar Street Clinic'],
];

function contactsFor(lastName: string) {
  const relationships = ['Spouse', 'Daughter', 'Son', 'Sibling', 'Neighbour', 'Partner'];
  const firstNames = ['Hema', 'Mani', 'Jaya', 'Prakash', 'Anbu', 'Dinesh', 'Kavitha', 'Nirmala'];
  const n = randInt(1, 2);
  return Array.from({ length: n }, () => ({
    name: `${pick(firstNames)} ${lastName}`,
    relationship: pick(relationships),
    phone: `555-0${randInt(700, 999)}`,
  }));
}

function addressFor() {
  const [city, state, zip] = pick(CITIES);
  return {
    street: `${randInt(10, 980)} ${pick(['Maple', 'Oak', 'Chestnut', 'Birch', 'Cedar', 'Pine'])} ${pick(['St', 'Ave', 'Lane', 'Road'])}`,
    city,
    state,
    zipCode: zip,
  };
}

function insuranceFor() {
  const [provider, coverageType] = pick(INSURERS);
  return {
    provider,
    policyNumber: `${provider.slice(0, 3).toUpperCase()}-${randInt(100000, 999999)}`,
    groupNumber: `GRP-${randInt(1000, 9999)}`,
    coverageType,
    isVerified: rand() > 0.2,
  };
}

function pcpFor() {
  const [name, clinic] = pick(PCPS);
  return { name, clinic, phone: `555-0${randInt(100, 699)}`, fax: `555-0${randInt(100, 699)}` };
}

/** The four scripted demo patients carry the seeded medication discrepancies. */
export interface DemoPatientSpec {
  key: 'A' | 'B' | 'C' | 'D';
  firstName: string;
  lastName: string;
  age: number;
  gender: 'male' | 'female' | 'other';
  literacyLevel: 'basic' | 'intermediate' | 'advanced';
  conditions: string[];
  allergies: { substance: string; reaction: string; severity: string }[];
  loginEmail: string;
}

export const DEMO_PATIENTS: DemoPatientSpec[] = [
  {
    key: 'A',
    firstName: 'Senthil',
    lastName: 'Kumar',
    age: 68,
    gender: 'male',
    literacyLevel: 'basic',
    conditions: ['Chronic heart failure (HFrEF)', 'Atrial fibrillation', 'Type 2 diabetes mellitus', 'Hypertension'],
    allergies: [],
    loginEmail: 'patient@safedischarge.demo',
  },
  {
    key: 'B',
    firstName: 'Kavitha',
    lastName: 'Raman',
    age: 45,
    gender: 'female',
    literacyLevel: 'intermediate',
    conditions: ['Asthma', 'Seasonal allergic rhinitis'],
    allergies: [
      { substance: 'Penicillin', reaction: 'Urticaria and facial swelling', severity: 'severe' },
    ],
    loginEmail: 'patient.raman@safedischarge.demo',
  },
  {
    key: 'C',
    firstName: 'Lakshmi',
    lastName: 'Sundaram',
    age: 72,
    gender: 'female',
    literacyLevel: 'basic',
    conditions: ['Osteoarthritis', 'Hyperlipidaemia', 'Osteoporosis'],
    allergies: [
      {
        substance: 'Sulfa',
        reaction: 'Stevens-Johnson syndrome requiring admission',
        severity: 'life-threatening',
      },
    ],
    loginEmail: 'patient.sundaram@safedischarge.demo',
  },
  {
    key: 'D',
    firstName: 'Arun',
    lastName: 'Selvam',
    age: 58,
    gender: 'male',
    literacyLevel: 'intermediate',
    conditions: [
      'Type 2 diabetes mellitus (insulin-dependent)',
      'Chronic heart failure',
      'Chronic kidney disease stage 3',
      'Hypertension',
    ],
    allergies: [{ substance: 'Codeine', reaction: 'Nausea and vomiting', severity: 'mild' }],
    loginEmail: 'patient.selvam@safedischarge.demo',
  },
];

const OTHER_PATIENTS: { firstName: string; lastName: string; age: number; gender: 'male' | 'female' | 'other'; conditions: string[] }[] = [
  { firstName: 'Divya', lastName: 'Murugan', age: 34, gender: 'female', conditions: ['Migraine'] },
  { firstName: 'Mani', lastName: 'Velu', age: 81, gender: 'male', conditions: ['COPD', 'Hypertension'] },
  { firstName: 'Priya', lastName: 'Raghavan', age: 29, gender: 'female', conditions: ['Iron deficiency anaemia'] },
  { firstName: 'Karthik', lastName: 'Mohan', age: 52, gender: 'male', conditions: ['Hypertension', 'Obesity'] },
  { firstName: 'Indhu', lastName: 'Saravanan', age: 77, gender: 'female', conditions: ['Atrial fibrillation', 'Osteoporosis'] },
  { firstName: 'Dinesh', lastName: 'Prabhu', age: 44, gender: 'male', conditions: ['Type 2 diabetes mellitus'] },
  { firstName: 'Yamuna', lastName: 'Shankar', age: 66, gender: 'female', conditions: ['Rheumatoid arthritis'] },
  { firstName: 'Fathima', lastName: 'Nazir', age: 38, gender: 'female', conditions: ['Hypothyroidism'] },
  { firstName: 'Bharath', lastName: 'Kannan', age: 59, gender: 'male', conditions: ['Coronary artery disease', 'Hyperlipidaemia'] },
  { firstName: 'Uma', lastName: 'Lakshmanan', age: 71, gender: 'female', conditions: ['Chronic kidney disease stage 3'] },
  { firstName: 'Sanjay', lastName: 'Anand', age: 23, gender: 'male', conditions: ['Asthma'] },
  { firstName: 'Bhavani', lastName: 'Pandian', age: 63, gender: 'female', conditions: ['Depression', 'Hypertension'] },
  { firstName: 'Nandha', lastName: 'Kumaran', age: 89, gender: 'male', conditions: ['Dementia', 'Atrial fibrillation'] },
  { firstName: 'Chitra', lastName: 'Balan', age: 47, gender: 'female', conditions: ['Gastro-oesophageal reflux'] },
  { firstName: 'Mohan', lastName: 'Devaraj', age: 31, gender: 'male', conditions: ['Crohn disease'] },
  { firstName: 'Vimala', lastName: 'Arumugam', age: 74, gender: 'female', conditions: ['Heart failure', 'Type 2 diabetes mellitus'] },
  { firstName: 'Jagan', lastName: 'Lingam', age: 56, gender: 'male', conditions: ['Alcohol-related liver disease'] },
  { firstName: 'Revathi', lastName: 'Vasanth', age: 41, gender: 'female', conditions: ['Systemic lupus erythematosus'] },
  { firstName: 'Tharun', lastName: 'Hari', age: 22, gender: 'male', conditions: ['Type 1 diabetes mellitus'] },
  { firstName: 'Anitha', lastName: 'Mani', age: 85, gender: 'female', conditions: ['Osteoarthritis', 'Hypertension'] },
  { firstName: 'Hameed', lastName: 'Basha', age: 49, gender: 'male', conditions: ['Chronic back pain'] },
  { firstName: 'Deepa', lastName: 'Ravi', age: 67, gender: 'female', conditions: ['COPD'] },
  { firstName: 'Ganesh', lastName: 'Thangaraj', age: 55, gender: 'male', conditions: ['Hyperlipidaemia'] },
  { firstName: 'Nasreen', lastName: 'Hussain', age: 36, gender: 'female', conditions: ['Pre-eclampsia (prior pregnancy)'] },
  { firstName: 'Vinoth', lastName: 'Raj', age: 62, gender: 'male', conditions: ['Prostate cancer (in remission)'] },
  { firstName: 'Rukmani', lastName: 'Palani', age: 79, gender: 'female', conditions: ['Stroke (prior)', 'Hypertension'] },
];

const RANDOM_ALLERGIES = [
  { substance: 'Peanuts', reaction: 'Anaphylaxis', severity: 'life-threatening' },
  { substance: 'Latex', reaction: 'Contact dermatitis', severity: 'mild' },
  { substance: 'NSAID', reaction: 'Gastric bleeding', severity: 'severe' },
  { substance: 'Iodine', reaction: 'Rash', severity: 'moderate' },
  { substance: 'Statin', reaction: 'Severe myalgia', severity: 'moderate' },
];

export async function seedPatients() {
  resetRand(42);
  // Loosely typed on purpose: these are plain seed literals that Mongoose casts.
  const docs: any[] = [];
  let counter = 0;
  const day = new Date();
  const stamp = `${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, '0')}${String(day.getDate()).padStart(2, '0')}`;
  const makeId = () => `${ID_PREFIX.patient}-${stamp}-${String(++counter).padStart(4, '0')}`;

  const build = (
    firstName: string,
    lastName: string,
    age: number,
    gender: 'male' | 'female' | 'other',
    conditions: string[],
    allergies: { substance: string; reaction: string; severity: string }[],
    literacyLevel: 'basic' | 'intermediate' | 'advanced',
    status: string
  ) => ({
    patientId: makeId(),
    demographics: {
      firstName,
      lastName,
      dateOfBirth: dobFromAge(age),
      gender,
      bloodType: pick(['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-']),
      address: addressFor(),
      phone: `555-0${randInt(100, 999)}`,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase().replace(/['\s]/g, '')}@example.test`,
      preferredLanguage: 'English',
      literacyLevel,
    },
    emergencyContacts: contactsFor(lastName),
    insurance: insuranceFor(),
    medicalHistory: {
      conditions,
      surgeries:
        rand() > 0.6
          ? [
              {
                name: pick(['Appendectomy', 'Cholecystectomy', 'Cataract extraction', 'Hernia repair']),
                date: new Date(Date.now() - randInt(400, 7000) * 86_400_000),
              },
            ]
          : [],
      allergies,
      familyHistory: rand() > 0.5 ? [pick(['Coronary artery disease', 'Type 2 diabetes mellitus', 'Breast cancer', 'Stroke'])] : [],
    },
    primaryCarePhysician: pcpFor(),
    communicationPreference: pick(['phone', 'email', 'sms', 'portal'] as const),
    status,
  });

  // The four scripted demo patients first — they get the active admissions.
  for (const d of DEMO_PATIENTS) {
    docs.push(
      build(d.firstName, d.lastName, d.age, d.gender, d.conditions, d.allergies, d.literacyLevel, 'admitted')
    );
  }

  // 26 more, mixed statuses.
  OTHER_PATIENTS.forEach((p, i) => {
    // 4 demo + 9 = 13 admitted, 2 in treatment → 15 active admissions;
    // 5 discharged (for the readmission metrics); the rest registered only.
    const status =
      i < 9 ? 'admitted' : i < 11 ? 'in_treatment' : i < 16 ? 'discharged' : 'registered';
    docs.push(
      build(
        p.firstName,
        p.lastName,
        p.age,
        p.gender,
        p.conditions,
        rand() > 0.65 ? [pick(RANDOM_ALLERGIES)] : [],
        pick(['basic', 'intermediate', 'advanced'] as const),
        status
      )
    );
  });

  const patients = await Patient.insertMany(docs);

  return {
    all: patients,
    demo: Object.fromEntries(
      DEMO_PATIENTS.map((d, i) => [d.key, patients[i]])
    ) as Record<'A' | 'B' | 'C' | 'D', (typeof patients)[number]>,
    byName: new Map(
      patients.map((p) => [`${p.demographics.firstName} ${p.demographics.lastName}`, p])
    ),
  };
}

export type SeededPatients = Awaited<ReturnType<typeof seedPatients>>;
