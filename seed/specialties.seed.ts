import { Specialty } from '../src/models/Specialty.js';

/**
 * The departments the public website offers.
 *
 * `symptomKeywords` is what triage actually matches on, so these are written
 * the way a patient types, not the way a clinician would: "breathless", not
 * "dyspnoea". Keywords are matched whole-word, so short ones are safe to
 * include — "ear" will not fire on "hearing".
 */
export const SPECIALTIES = [
  {
    slug: 'general-medicine',
    name: 'General Medicine',
    tagline: 'The first stop when you are not sure where to start.',
    description:
      'General physicians assess undifferentiated illness, manage long-term conditions ' +
      'such as diabetes and blood pressure, and refer on to a specialist when needed.',
    icon: 'StethoscopeIcon',
    displayOrder: 10,
    consultationFee: 400,
    location: 'Ground floor, Block A',
    symptomKeywords: [
      'fever', 'tired', 'tiredness', 'fatigue', 'weakness', 'weight loss',
      'infection', 'flu', 'cold', 'body ache', 'check up', 'checkup',
      'diabetes', 'sugar', 'blood pressure', 'bp', 'thyroid', 'giddiness',
    ],
    commonConditions: ['Diabetes', 'Hypertension', 'Thyroid disorders', 'Seasonal infections'],
  },
  {
    slug: 'cardiology',
    name: 'Cardiology',
    tagline: 'Heart and circulation.',
    description:
      'Investigation and treatment of chest pain, rhythm problems, heart failure and ' +
      'high blood pressure, with ECG, echo and treadmill testing on site.',
    icon: 'HeartIcon',
    displayOrder: 20,
    consultationFee: 800,
    location: 'Second floor, Block B',
    symptomKeywords: [
      'chest pain', 'chest tightness', 'palpitation', 'palpitations',
      'breathless', 'breathlessness', 'heart', 'cholesterol',
      'swollen ankles', 'swelling in legs', 'fainting', 'irregular heartbeat',
    ],
    commonConditions: ['Coronary artery disease', 'Atrial fibrillation', 'Heart failure'],
  },
  {
    slug: 'orthopaedics',
    name: 'Orthopaedics',
    tagline: 'Bones, joints and movement.',
    description:
      'Fractures, sports injuries, arthritis and spine problems, with physiotherapy ' +
      'and joint replacement surgery.',
    icon: 'BoneIcon',
    displayOrder: 30,
    consultationFee: 700,
    location: 'First floor, Block C',
    symptomKeywords: [
      'back pain', 'knee pain', 'joint pain', 'shoulder pain', 'neck pain',
      'fracture', 'broken', 'sprain', 'swelling', 'arthritis', 'injury',
      'cannot walk', 'limping', 'hip pain', 'slipped disc',
    ],
    commonConditions: ['Osteoarthritis', 'Fractures', 'Slipped disc', 'Frozen shoulder'],
  },
  {
    slug: 'paediatrics',
    name: 'Paediatrics',
    tagline: 'Care for children, from newborn to sixteen.',
    description:
      'Routine growth and immunisation, childhood illness, and a separate paediatric ' +
      'emergency area so children are never waiting with adults.',
    icon: 'BabyIcon',
    displayOrder: 40,
    consultationFee: 600,
    location: 'Ground floor, Block C',
    symptomKeywords: [
      'child', 'baby', 'infant', 'toddler', 'newborn', 'vaccination',
      'immunisation', 'immunization', 'growth', 'not eating', 'colic',
    ],
    commonConditions: ['Childhood asthma', 'Growth concerns', 'Routine immunisation'],
  },
  {
    slug: 'dermatology',
    name: 'Dermatology',
    tagline: 'Skin, hair and nails.',
    description:
      'Rashes, acne, hair loss, pigmentation and skin allergy, including minor ' +
      'procedures and patch testing.',
    icon: 'SparklesIcon',
    displayOrder: 50,
    consultationFee: 650,
    location: 'Second floor, Block A',
    symptomKeywords: [
      'rash', 'itching', 'itchy', 'skin', 'acne', 'pimples', 'hair fall',
      'hair loss', 'dandruff', 'eczema', 'psoriasis', 'boils', 'pigmentation',
      'nail', 'fungal',
    ],
    commonConditions: ['Eczema', 'Acne', 'Fungal infection', 'Hair loss'],
  },
  {
    slug: 'ent',
    name: 'ENT',
    tagline: 'Ear, nose and throat.',
    description:
      'Hearing loss, sinus problems, tonsillitis, vertigo and voice complaints, with ' +
      'audiometry and endoscopy in the department.',
    icon: 'EarIcon',
    displayOrder: 60,
    consultationFee: 600,
    location: 'First floor, Block A',
    symptomKeywords: [
      'ear', 'ear pain', 'hearing', 'deaf', 'sinus', 'blocked nose',
      'runny nose', 'sore throat', 'throat', 'tonsil', 'voice', 'hoarse',
      'vertigo', 'snoring', 'nose bleed',
    ],
    commonConditions: ['Sinusitis', 'Tonsillitis', 'Vertigo', 'Hearing loss'],
  },
  {
    slug: 'gastroenterology',
    name: 'Gastroenterology',
    tagline: 'Digestion, liver and gut.',
    description:
      'Abdominal pain, reflux, bowel problems and liver disease, with endoscopy and ' +
      'colonoscopy performed on site.',
    icon: 'BeakerIcon',
    displayOrder: 70,
    consultationFee: 750,
    location: 'Third floor, Block B',
    symptomKeywords: [
      'stomach pain', 'abdominal pain', 'acidity', 'reflux', 'heartburn',
      'vomiting', 'nausea', 'diarrhoea', 'diarrhea', 'constipation',
      'loose motion', 'bloating', 'jaundice', 'liver', 'gas', 'indigestion',
    ],
    commonConditions: ['Acid reflux', 'Irritable bowel syndrome', 'Fatty liver', 'Gastritis'],
  },
  {
    slug: 'pulmonology',
    name: 'Pulmonology',
    tagline: 'Lungs and breathing.',
    description:
      'Asthma, COPD, persistent cough and sleep apnoea, with lung function testing ' +
      'and a dedicated smoking cessation clinic.',
    icon: 'CloudIcon',
    displayOrder: 80,
    consultationFee: 700,
    location: 'Third floor, Block A',
    symptomKeywords: [
      'cough', 'coughing', 'wheezing', 'wheeze', 'asthma', 'copd',
      'shortness of breath', 'phlegm', 'chest congestion', 'smoking',
      'sleep apnoea', 'sleep apnea', 'tb', 'tuberculosis',
    ],
    commonConditions: ['Asthma', 'COPD', 'Sleep apnoea', 'Chronic cough'],
  },
  {
    slug: 'neurology',
    name: 'Neurology',
    tagline: 'Brain, spine and nerves.',
    description:
      'Headache, epilepsy, stroke follow-up, tremor and nerve pain, with EEG and ' +
      'nerve conduction studies.',
    icon: 'BoltIcon',
    displayOrder: 90,
    consultationFee: 850,
    location: 'Fourth floor, Block B',
    symptomKeywords: [
      'headache', 'migraine', 'dizziness', 'numbness', 'tingling', 'tremor',
      'shaking', 'memory', 'forgetful', 'epilepsy', 'nerve pain',
      'weakness in hand', 'weakness in leg',
    ],
    commonConditions: ['Migraine', 'Epilepsy', 'Parkinson disease', 'Neuropathy'],
  },
  {
    slug: 'gynaecology',
    name: 'Gynaecology',
    tagline: "Women's health and pregnancy.",
    description:
      'Antenatal care, menstrual and fertility concerns, menopause and routine ' +
      'screening, with a dedicated day-care theatre.',
    icon: 'HeartIcon',
    displayOrder: 100,
    consultationFee: 700,
    location: 'Second floor, Block C',
    symptomKeywords: [
      'pregnancy', 'pregnant', 'periods', 'period pain', 'menstrual',
      'irregular periods', 'menopause', 'fertility', 'pcod', 'pcos',
      'white discharge', 'antenatal',
    ],
    commonConditions: ['PCOS', 'Antenatal care', 'Menopause', 'Fibroids'],
  },
] as const;

export async function seedSpecialties() {
  const created = await Specialty.insertMany(SPECIALTIES.map((s) => ({ ...s })));
  return { specialties: created, bySlug: new Map(created.map((s) => [s.slug, s])) };
}

export type SeededSpecialties = Awaited<ReturnType<typeof seedSpecialties>>;
