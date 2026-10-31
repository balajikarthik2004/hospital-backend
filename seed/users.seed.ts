import { User, hashPassword, type Role } from '../src/models/User.js';

export const DEMO_PASSWORD = 'Demo@1234';

interface SeedUser {
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  department: string;
  specialization?: string | null;
  licenseNumber?: string | null;
  phone: string;
  /**
   * Only physicians carry this. `isBookable` is what puts a doctor on the
   * public website, so every department in specialties.seed has at least one
   * doctor here — a department with nobody bookable is a dead end in the
   * booking flow, and the seed should never demo a dead end.
   */
  doctorProfile?: {
    specialty: string;
    qualifications: string;
    yearsExperience: number;
    bio: string;
    languages: string[];
    consultationFee: number;
    availableDays: number[];
    clinicStart: string;
    clinicEnd: string;
    slotMinutes: number;
    isBookable: boolean;
  };
}

/** Saves repeating the common half of every doctor profile. */
function doctor(
  specialty: string,
  qualifications: string,
  yearsExperience: number,
  bio: string,
  opts: Partial<NonNullable<SeedUser['doctorProfile']>> = {}
): NonNullable<SeedUser['doctorProfile']> {
  return {
    specialty,
    qualifications,
    yearsExperience,
    bio,
    languages: ['English', 'Tamil'],
    consultationFee: 600,
    availableDays: [1, 2, 3, 4, 5],
    clinicStart: '09:00',
    clinicEnd: '17:00',
    slotMinutes: 30,
    isBookable: true,
    ...opts,
  };
}

/** 32 staff + patient logins. The first six are the documented demo accounts. */
export const USERS: SeedUser[] = [
  // ─── Physicians (4) ───
  {
    email: 'dr.sharma@safedischarge.demo',
    firstName: 'Ananya',
    lastName: 'Sharma',
    role: 'physician',
    department: 'Cardiology',
    specialization: 'Cardiology',
    licenseNumber: 'MD-884201',
    phone: '555-0101',
    doctorProfile: doctor(
      'cardiology',
      'MBBS, MD, DM (Cardiology)',
      18,
      'Interventional cardiologist with a special interest in heart failure and ' +
        'rhythm disorders. Runs the hospital\u2019s chest pain clinic.',
      { consultationFee: 800, languages: ['English', 'Tamil', 'Hindi'] }
    ),
  },
  {
    email: 'dr.verma@safedischarge.demo',
    firstName: 'Rohit',
    lastName: 'Verma',
    role: 'physician',
    department: 'General Medicine',
    specialization: 'General Medicine',
    licenseNumber: 'MD-884202',
    phone: '555-0102',
    doctorProfile: doctor(
      'general-medicine',
      'MBBS, MD (General Medicine)',
      14,
      'General physician managing diabetes, blood pressure and thyroid disease, ' +
        'and the first port of call for undifferentiated illness.',
      { consultationFee: 400, clinicEnd: '18:00' }
    ),
  },
  {
    email: 'dr.reddy@safedischarge.demo',
    firstName: 'Kavya',
    lastName: 'Reddy',
    role: 'physician',
    department: 'Orthopaedics',
    specialization: 'Orthopaedics',
    licenseNumber: 'MD-884203',
    phone: '555-0103',
    doctorProfile: doctor(
      'orthopaedics',
      'MBBS, MS (Orthopaedics)',
      12,
      'Joint replacement and sports injury surgeon, with a weekly spine clinic.',
      { consultationFee: 700 }
    ),
  },
  {
    email: 'dr.nair@safedischarge.demo',
    firstName: 'Arjun',
    lastName: 'Nair',
    role: 'physician',
    department: 'Pulmonology',
    specialization: 'Pulmonology',
    licenseNumber: 'MD-884204',
    phone: '555-0104',
    doctorProfile: doctor(
      'pulmonology',
      'MBBS, MD (Pulmonary Medicine)',
      11,
      'Asthma and COPD specialist, running the lung function lab and the ' +
        'smoking cessation clinic.',
      { consultationFee: 700 }
    ),
  },

  // ─── Outpatient consultants (7) — one per remaining department ───
  {
    email: 'dr.venkatesan@safedischarge.demo',
    firstName: 'Lakshmi',
    lastName: 'Venkatesan',
    role: 'physician',
    department: 'Paediatrics',
    specialization: 'Paediatrics',
    licenseNumber: 'MD-884205',
    phone: '555-0105',
    doctorProfile: doctor(
      'paediatrics',
      'MBBS, MD (Paediatrics)',
      16,
      'Paediatrician covering newborn checks through adolescence, and the ' +
        'hospital immunisation clinic.',
      { consultationFee: 600, clinicStart: '08:30', slotMinutes: 20 }
    ),
  },
  {
    email: 'dr.ramesh@safedischarge.demo',
    firstName: 'Divya',
    lastName: 'Ramesh',
    role: 'physician',
    department: 'Dermatology',
    specialization: 'Dermatology',
    licenseNumber: 'MD-884206',
    phone: '555-0106',
    doctorProfile: doctor(
      'dermatology',
      'MBBS, MD (Dermatology)',
      9,
      'Treats acne, eczema and hair loss, and runs the weekly patch testing clinic.',
      { consultationFee: 650, slotMinutes: 20 }
    ),
  },
  {
    email: 'dr.babu@safedischarge.demo',
    firstName: 'Suresh',
    lastName: 'Babu',
    role: 'physician',
    department: 'ENT',
    specialization: 'ENT',
    licenseNumber: 'MD-884207',
    phone: '555-0107',
    doctorProfile: doctor(
      'ent',
      'MBBS, MS (ENT)',
      13,
      'Ear, nose and throat surgeon with a particular interest in vertigo and ' +
        'hearing loss.',
      { consultationFee: 600 }
    ),
  },
  {
    email: 'dr.iyer@safedischarge.demo',
    firstName: 'Mahesh',
    lastName: 'Iyer',
    role: 'physician',
    department: 'Gastroenterology',
    specialization: 'Gastroenterology',
    licenseNumber: 'MD-884208',
    phone: '555-0108',
    doctorProfile: doctor(
      'gastroenterology',
      'MBBS, MD, DM (Gastroenterology)',
      15,
      'Endoscopist managing reflux, irritable bowel syndrome and liver disease.',
      { consultationFee: 750, availableDays: [1, 2, 4, 5] }
    ),
  },
  {
    email: 'dr.krishnan@safedischarge.demo',
    firstName: 'Priya',
    lastName: 'Krishnan',
    role: 'physician',
    department: 'Neurology',
    specialization: 'Neurology',
    licenseNumber: 'MD-884209',
    phone: '555-0109',
    doctorProfile: doctor(
      'neurology',
      'MBBS, MD, DM (Neurology)',
      17,
      'Neurologist specialising in headache and epilepsy, with an EEG service ' +
        'in the department.',
      { consultationFee: 850, availableDays: [2, 3, 4, 6], slotMinutes: 40 }
    ),
  },
  {
    email: 'dr.subramanian@safedischarge.demo',
    firstName: 'Vani',
    lastName: 'Subramanian',
    role: 'physician',
    department: 'Gynaecology',
    specialization: 'Gynaecology',
    licenseNumber: 'MD-884210',
    phone: '555-0110',
    doctorProfile: doctor(
      'gynaecology',
      'MBBS, MS (Obstetrics & Gynaecology)',
      14,
      'Obstetrician and gynaecologist running the antenatal clinic and a ' +
        'dedicated PCOS service.',
      { consultationFee: 700, clinicStart: '10:00', clinicEnd: '18:00' }
    ),
  },
  {
    email: 'dr.raman@safedischarge.demo',
    firstName: 'Karthik',
    lastName: 'Raman',
    role: 'physician',
    department: 'General Medicine',
    specialization: 'General Medicine',
    licenseNumber: 'MD-884211',
    phone: '555-0111',
    doctorProfile: doctor(
      'general-medicine',
      'MBBS, MD (General Medicine)',
      7,
      'General physician with an interest in diabetes and preventive health checks.',
      { consultationFee: 400, availableDays: [1, 2, 3, 4, 5, 6] }
    ),
  },

  // ─── Pharmacists (3) ───
  {
    email: 'rx.patel@safedischarge.demo',
    firstName: 'Riya',
    lastName: 'Patel',
    role: 'pharmacist',
    department: 'Pharmacy',
    specialization: 'Clinical Pharmacy',
    licenseNumber: 'RPH-55120',
    phone: '555-0201',
  },
  {
    email: 'rx.shah@safedischarge.demo',
    firstName: 'Vikram',
    lastName: 'Shah',
    role: 'pharmacist',
    department: 'Pharmacy',
    specialization: 'Anticoagulation',
    licenseNumber: 'RPH-55121',
    phone: '555-0202',
  },
  {
    email: 'rx.joshi@safedischarge.demo',
    firstName: 'Neha',
    lastName: 'Joshi',
    role: 'pharmacist',
    department: 'Pharmacy',
    specialization: 'Medication Safety',
    licenseNumber: 'RPH-55122',
    phone: '555-0203',
  },

  // ─── Nurses (8) ───
  {
    email: 'rn.iyer@safedischarge.demo',
    firstName: 'Meera',
    lastName: 'Iyer',
    role: 'nurse',
    department: 'Cardiology',
    licenseNumber: 'RN-21004',
    phone: '555-0301',
  },
  {
    email: 'rn.rao@safedischarge.demo',
    firstName: 'Kiran',
    lastName: 'Rao',
    role: 'nurse',
    department: 'Cardiology',
    licenseNumber: 'RN-21005',
    phone: '555-0302',
  },
  {
    email: 'rn.desai@safedischarge.demo',
    firstName: 'Pooja',
    lastName: 'Desai',
    role: 'nurse',
    department: 'General Medicine',
    licenseNumber: 'RN-21006',
    phone: '555-0303',
  },
  {
    email: 'rn.menon@safedischarge.demo',
    firstName: 'Sneha',
    lastName: "Menon",
    role: 'nurse',
    department: 'General Medicine',
    licenseNumber: 'RN-21007',
    phone: '555-0304',
  },
  {
    email: 'rn.kaur@safedischarge.demo',
    firstName: 'Simran',
    lastName: 'Kaur',
    role: 'nurse',
    department: 'ICU',
    licenseNumber: 'RN-21008',
    phone: '555-0305',
  },
  {
    email: 'rn.pillai@safedischarge.demo',
    firstName: 'Karthik',
    lastName: 'Pillai',
    role: 'nurse',
    department: 'ICU',
    licenseNumber: 'RN-21009',
    phone: '555-0306',
  },
  {
    email: 'rn.gupta@safedischarge.demo',
    firstName: 'Lakshmi',
    lastName: 'Gupta',
    role: 'nurse',
    department: 'Orthopedics',
    licenseNumber: 'RN-21010',
    phone: '555-0307',
  },
  {
    email: 'rn.bhatt@safedischarge.demo',
    firstName: 'Jatin',
    lastName: 'Bhatt',
    role: 'nurse',
    department: 'Pediatrics',
    licenseNumber: 'RN-21011',
    phone: '555-0308',
  },

  // ─── Admins (2) ───
  {
    email: 'admin@safedischarge.demo',
    firstName: 'Aditya',
    lastName: 'Malhotra',
    role: 'admin',
    department: 'Hospital Administration',
    phone: '555-0401',
  },
  {
    email: 'admin.ops@safedischarge.demo',
    firstName: 'Nisha',
    lastName: 'Agarwal',
    role: 'admin',
    department: 'Operations',
    phone: '555-0402',
  },

  // ─── Care coordinators (3) ───
  {
    email: 'cc.kulkarni@safedischarge.demo',
    firstName: 'Tarun',
    lastName: 'Kulkarni',
    role: 'care_coordinator',
    department: 'Care Transitions',
    phone: '555-0501',
  },
  {
    email: 'cc.chopra@safedischarge.demo',
    firstName: 'Isha',
    lastName: 'Chopra',
    role: 'care_coordinator',
    department: 'Care Transitions',
    phone: '555-0502',
  },
  {
    email: 'cc.saxena@safedischarge.demo',
    firstName: 'Ritu',
    lastName: 'Saxena',
    role: 'care_coordinator',
    department: 'Social Work',
    phone: '555-0503',
  },

  // ─── Patient portal logins (5) ───
  {
    email: 'patient@safedischarge.demo',
    firstName: 'Senthil',
    lastName: 'Kumar',
    role: 'patient',
    department: '',
    phone: '555-0601',
  },
  {
    email: 'patient.raman@safedischarge.demo',
    firstName: 'Kavitha',
    lastName: 'Raman',
    role: 'patient',
    department: '',
    phone: '555-0602',
  },
  {
    email: 'patient.sundaram@safedischarge.demo',
    firstName: 'Lakshmi',
    lastName: 'Sundaram',
    role: 'patient',
    department: '',
    phone: '555-0603',
  },
  {
    email: 'patient.selvam@safedischarge.demo',
    firstName: 'Arun',
    lastName: 'Selvam',
    role: 'patient',
    department: '',
    phone: '555-0604',
  },
  {
    email: 'patient.murugan@safedischarge.demo',
    firstName: 'Divya',
    lastName: 'Murugan',
    role: 'patient',
    department: '',
    phone: '555-0605',
  },
];

export async function seedUsers() {
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const docs = await User.insertMany(
    USERS.map((u) => ({
      ...u,
      passwordHash,
      isActive: true,
      lastLogin: null,
      avatar: null,
    }))
  );

  const byEmail = new Map(docs.map((d) => [d.email, d]));
  return {
    all: docs,
    byEmail,
    physicians: docs.filter((d) => d.role === 'physician'),
    pharmacists: docs.filter((d) => d.role === 'pharmacist'),
    nurses: docs.filter((d) => d.role === 'nurse'),
    coordinators: docs.filter((d) => d.role === 'care_coordinator'),
    admins: docs.filter((d) => d.role === 'admin'),
    patientLogins: docs.filter((d) => d.role === 'patient'),
  };
}

export type SeededUsers = Awaited<ReturnType<typeof seedUsers>>;
