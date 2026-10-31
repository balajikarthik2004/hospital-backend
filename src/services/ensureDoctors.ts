import { User, hashPassword } from '../models/User.js';

export const REQUESTED_DOCTORS = [
  {
    email: 'dr.chandupriya@safedischarge.demo',
    firstName: 'Naraginti Chandu',
    lastName: 'Priya',
    role: 'physician' as const,
    department: 'Gynaecology',
    specialization: 'Obstetrics & Gynaecology',
    licenseNumber: 'MD-884220',
    phone: '555-0120',
    doctorProfile: {
      specialty: 'gynaecology',
      qualifications: 'MBBS, MS (Obstetrics & Gynaecology)',
      yearsExperience: 12,
      bio: 'Obstetrician and gynaecologist specializing in women’s health, maternity care, and wellness.',
      languages: ['English', 'Telugu', 'Tamil'],
      consultationFee: 700,
      availableDays: [1, 2, 3, 4, 5, 6],
      clinicStart: '10:00',
      clinicEnd: '17:00',
      slotMinutes: 25,
      bufferMinutes: 5,
      isBookable: true,
    },
  },
  {
    email: 'dr.balaji@safedischarge.demo',
    firstName: 'Balaji',
    lastName: 'Krishnan',
    role: 'physician' as const,
    department: 'Neurology',
    specialization: 'Neurology',
    licenseNumber: 'MD-884221',
    phone: '555-0121',
    doctorProfile: {
      specialty: 'neurology',
      qualifications: 'MBBS, MD, DM (Neurology)',
      yearsExperience: 15,
      bio: 'Consultant neurologist specializing in stroke prevention, headache disorders, and neuro-care.',
      languages: ['English', 'Tamil'],
      consultationFee: 850,
      availableDays: [1, 2, 3, 4, 5, 6],
      clinicStart: '10:00',
      clinicEnd: '17:00',
      slotMinutes: 25,
      bufferMinutes: 5,
      isBookable: true,
    },
  },
  {
    email: 'dr.sainanthan@safedischarge.demo',
    firstName: 'Sainanthan',
    lastName: '',
    role: 'physician' as const,
    department: 'Cardiology',
    specialization: 'Cardiology',
    licenseNumber: 'MD-884222',
    phone: '555-0122',
    doctorProfile: {
      specialty: 'cardiology',
      qualifications: 'MBBS, MD, DM (Cardiology)',
      yearsExperience: 16,
      bio: 'Senior interventional cardiologist available for comprehensive cardiac care and evening/night clinics.',
      languages: ['English', 'Tamil', 'Hindi'],
      consultationFee: 800,
      availableDays: [1, 2, 3, 4, 5, 6, 0],
      clinicStart: '17:00',
      clinicEnd: '03:00',
      slotMinutes: 25,
      bufferMinutes: 5,
      isBookable: true,
    },
  },
];

export async function ensureDoctors(): Promise<void> {
  const passwordHash = await hashPassword('Demo@1234');

  for (const doc of REQUESTED_DOCTORS) {
    const existing = await User.findOne({
      $or: [
        { email: doc.email },
        { firstName: doc.firstName, ...(doc.lastName ? { lastName: doc.lastName } : {}) },
      ],
      role: 'physician',
    });

    if (existing) {
      existing.department = doc.department;
      existing.specialization = doc.specialization;
      existing.doctorProfile = {
        ...existing.doctorProfile,
        ...doc.doctorProfile,
      };
      existing.isActive = true;
      await existing.save();
    } else {
      await User.create({
        ...doc,
        passwordHash,
        isActive: true,
      });
    }
  }
}

