import { z } from 'zod';
import { ROLES } from '../models/User.js';
import { PATIENT_STATUSES } from '../models/Patient.js';
import { APPOINTMENT_STATUSES, APPOINTMENT_TYPES } from '../models/Appointment.js';
import { LIST_TYPES, ROUTES } from '../models/Medication.js';
import { BED_STATUSES, BED_TYPES } from '../models/Bed.js';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Expected a MongoDB ObjectId');

// ─── Auth ────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  role: z.enum(ROLES),
  department: z.string().optional().default(''),
  specialization: z.string().nullable().optional(),
  licenseNumber: z.string().nullable().optional(),
  phone: z.string().optional().default(''),
  patientRef: objectId.nullable().optional(),
});

export const updateProfileSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phone: z.string().optional(),
  department: z.string().optional(),
  specialization: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

// ─── Patients ────────────────────────────────────────────────────────────────

export const allergySchema = z.object({
  substance: z.string().min(1),
  reaction: z.string().optional().default(''),
  severity: z.enum(['mild', 'moderate', 'severe', 'life-threatening']).default('moderate'),
});

export const createPatientSchema = z.object({
  demographics: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    dateOfBirth: z.coerce.date(),
    gender: z.enum(['male', 'female', 'other']),
    bloodType: z.string().optional().default('O+'),
    address: z
      .object({
        street: z.string().optional().default(''),
        city: z.string().optional().default(''),
        state: z.string().optional().default(''),
        zipCode: z.string().optional().default(''),
      })
      .optional()
      .default({}),
    phone: z.string().optional().default(''),
    email: z.string().email().or(z.literal('')).optional().default(''),
    preferredLanguage: z.string().optional().default('English'),
    literacyLevel: z.enum(['basic', 'intermediate', 'advanced']).optional().default('intermediate'),
  }),
  emergencyContacts: z
    .array(
      z.object({
        name: z.string().min(1),
        relationship: z.string().optional().default(''),
        phone: z.string().optional().default(''),
      })
    )
    .max(3)
    .optional()
    .default([]),
  insurance: z
    .object({
      provider: z.string().optional().default(''),
      policyNumber: z.string().optional().default(''),
      groupNumber: z.string().optional().default(''),
      coverageType: z.string().optional().default(''),
      isVerified: z.boolean().optional().default(false),
    })
    .optional()
    .default({}),
  medicalHistory: z
    .object({
      conditions: z.array(z.string()).optional().default([]),
      surgeries: z
        .array(z.object({ name: z.string(), date: z.coerce.date().optional() }))
        .optional()
        .default([]),
      allergies: z.array(allergySchema).optional().default([]),
      familyHistory: z.array(z.string()).optional().default([]),
    })
    .optional()
    .default({}),
  primaryCarePhysician: z
    .object({
      name: z.string().optional().default(''),
      clinic: z.string().optional().default(''),
      phone: z.string().optional().default(''),
      fax: z.string().optional().default(''),
    })
    .optional()
    .default({}),
  communicationPreference: z.enum(['phone', 'email', 'sms', 'portal']).optional().default('phone'),
  /** Optional home medication list captured during onboarding (wizard step 5). */
  currentMedications: z
    .array(
      z.object({
        drugName: z.string().min(1),
        genericName: z.string().optional().default(''),
        dosage: z.string().optional().default(''),
        frequency: z.string().optional().default(''),
        route: z.enum(ROUTES).optional().default('oral'),
        notes: z.string().nullable().optional(),
      })
    )
    .optional()
    .default([]),
  status: z.enum(PATIENT_STATUSES).optional(),
});

export const updatePatientSchema = createPatientSchema.partial();

export const patientQuerySchema = z.object({
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  status: z.enum(PATIENT_STATUSES).optional(),
  ward: z.string().optional(),
  physician: objectId.optional(),
  q: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sort: z.string().optional(),
});

// ─── Admissions ──────────────────────────────────────────────────────────────

export const createAdmissionSchema = z.object({
  patientId: objectId,
  admittingDiagnosis: z.string().min(1),
  diagnosisCodes: z.array(z.string()).optional().default([]),
  admissionDate: z.coerce.date().optional(),
  expectedDischargeDate: z.coerce.date().nullable().optional(),
  bedId: objectId.optional(),
  bed: z
    .object({
      ward: z.string().optional().default(''),
      roomNumber: z.string().optional().default(''),
      bedNumber: z.string().optional().default(''),
    })
    .optional(),
  careTeam: z.object({
    attendingPhysician: objectId,
    nurses: z.array(objectId).optional().default([]),
    specialists: z.array(objectId).optional().default([]),
    pharmacist: objectId.nullable().optional(),
    careCoordinator: objectId.nullable().optional(),
  }),
  riskAssessment: z
    .object({
      fallRisk: z.enum(['low', 'moderate', 'high']).optional().default('low'),
      pressureInjuryRisk: z.enum(['low', 'moderate', 'high']).optional().default('low'),
      infectionFlags: z.array(z.string()).optional().default([]),
    })
    .optional()
    .default({}),
});

export const updateAdmissionSchema = z.object({
  admittingDiagnosis: z.string().optional(),
  diagnosisCodes: z.array(z.string()).optional(),
  expectedDischargeDate: z.coerce.date().nullable().optional(),
  status: z.enum(['active', 'discharged', 'transferred']).optional(),
  riskAssessment: z
    .object({
      fallRisk: z.enum(['low', 'moderate', 'high']).optional(),
      pressureInjuryRisk: z.enum(['low', 'moderate', 'high']).optional(),
      infectionFlags: z.array(z.string()).optional(),
    })
    .optional(),
  careTeam: z
    .object({
      attendingPhysician: objectId.optional(),
      nurses: z.array(objectId).optional(),
      specialists: z.array(objectId).optional(),
      pharmacist: objectId.nullable().optional(),
      careCoordinator: objectId.nullable().optional(),
    })
    .optional(),
});

export const addNoteSchema = z.object({
  type: z.enum(['progress', 'assessment', 'consultation', 'procedure', 'nursing']),
  content: z.string().min(1),
});

export const addLabSchema = z.object({
  testName: z.string().min(1),
  value: z.string().min(1),
  unit: z.string().optional().default(''),
  referenceRange: z.string().optional().default(''),
  isAbnormal: z.boolean().optional().default(false),
  resultDate: z.coerce.date().optional(),
});

// ─── Vitals ──────────────────────────────────────────────────────────────────

export const createVitalSchema = z.object({
  patientId: objectId,
  admissionId: objectId,
  timestamp: z.coerce.date().optional(),
  bloodPressureSystolic: z.coerce.number().min(40).max(300),
  bloodPressureDiastolic: z.coerce.number().min(20).max(200),
  heartRate: z.coerce.number().min(20).max(250),
  temperature: z.coerce.number().min(80).max(115),
  respiratoryRate: z.coerce.number().min(4).max(60),
  oxygenSaturation: z.coerce.number().min(50).max(100),
  painScore: z.coerce.number().min(0).max(10).optional().default(0),
  weight: z.coerce.number().nullable().optional(),
  notes: z.string().nullable().optional(),
});

// ─── Medications ─────────────────────────────────────────────────────────────

export const medicationItemInput = z.object({
  drugName: z.string().min(1),
  genericName: z.string().optional().default(''),
  drugClass: z.string().optional().default(''),
  dosage: z.string().optional().default(''),
  frequency: z.string().optional().default(''),
  route: z.enum(ROUTES).optional().default('oral'),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().nullable().optional(),
  isActive: z.boolean().optional().default(true),
  notes: z.string().nullable().optional(),
});

export const medicationListSchema = z.object({
  patientId: objectId,
  admissionId: objectId,
  listType: z.enum(LIST_TYPES),
  medications: z.array(medicationItemInput),
});

export const updateMedicationListSchema = z.object({
  medications: z.array(medicationItemInput),
});

// ─── Appointments ────────────────────────────────────────────────────────────

export const createAppointmentSchema = z.object({
  patientId: objectId,
  doctorId: objectId,
  admissionId: objectId.nullable().optional(),
  type: z.enum(APPOINTMENT_TYPES).optional().default('follow_up'),
  specialty: z.string().optional().default(''),
  scheduledDate: z.coerce.date(),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/, 'Expected HH:MM'),
  duration: z.coerce.number().min(5).max(480).optional().default(30),
  location: z.string().optional().default(''),
  reason: z.string().optional().default(''),
  notes: z.string().nullable().optional(),
  insuranceVerified: z.boolean().optional().default(false),
});

export const updateAppointmentSchema = createAppointmentSchema
  .partial()
  .extend({ status: z.enum(APPOINTMENT_STATUSES).optional() });

// ─── Beds ────────────────────────────────────────────────────────────────────

export const createBedSchema = z.object({
  ward: z.string().min(1),
  roomNumber: z.string().min(1),
  bedNumber: z.string().min(1),
  type: z.enum(BED_TYPES).optional().default('general'),
  status: z.enum(BED_STATUSES).optional().default('available'),
  features: z.array(z.string()).optional().default([]),
});

export const assignBedSchema = z.object({
  patientId: objectId,
  admissionId: objectId.nullable().optional(),
});

export const updateBedSchema = z.object({
  status: z.enum(BED_STATUSES).optional(),
  type: z.enum(BED_TYPES).optional(),
  features: z.array(z.string()).optional(),
});

// ─── Discharge ───────────────────────────────────────────────────────────────

export const initiateDischargeSchema = z.object({
  admissionId: objectId,
});

export const reviewSectionSchema = z.object({
  section: z.enum([
    'clinicalSummary',
    'medicationReconciliation',
    'followUpPlan',
    'patientEducation',
  ]),
  action: z.enum(['approved', 'rejected', 'edited']),
  comments: z.string().nullable().optional(),
  /** Replacement markdown when action = "edited" (summary / education only). */
  content: z.string().optional(),
  signature: z.string().min(2, 'Type your name to sign'),
});

export const resolveFlagSchema = z.object({
  flagId: z.string().min(1),
  resolution: z.enum(['accepted', 'modified', 'dismissed']),
  note: z.string().optional(),
});

export const scheduleFollowUpSchema = z.object({
  recommendationId: z.string().min(1),
  doctorId: objectId,
  scheduledDate: z.coerce.date(),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/),
  location: z.string().optional().default(''),
});

// ─── Users ───────────────────────────────────────────────────────────────────

export const updateUserSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  role: z.enum(ROLES).optional(),
  department: z.string().optional(),
  specialization: z.string().nullable().optional(),
  licenseNumber: z.string().nullable().optional(),
  phone: z.string().optional(),
  isActive: z.boolean().optional(),
});

// ─── Audit ───────────────────────────────────────────────────────────────────

export const auditQuerySchema = z.object({
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  userId: objectId.optional(),
  patientId: objectId.optional(),
  action: z.string().optional(),
  entity: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

// ─── Public website: triage, booking and the patient portal ─────────────────

export const triageSchema = z.object({
  complaint: z.string().max(2000).optional().default(''),
  symptoms: z.array(z.string().max(80)).max(20).optional().default([]),
  age: z.coerce.number().int().min(0).max(130).optional(),
});

/**
 * One schema for both halves of the booking form. The branch is validated in
 * the controller rather than with a discriminated union, so the patient gets
 * one plain sentence back ("Name, date of birth and phone number are
 * required") instead of a field map for a branch they never filled in.
 */
export const publicBookingSchema = z.object({
  isNewPatient: z.boolean(),

  // Returning patient
  identifier: z.string().max(60).optional(),

  // New patient
  firstName: z.string().min(1).max(60).optional(),
  lastName: z.string().min(1).max(60).optional(),
  gender: z.enum(['male', 'female', 'other']).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().max(120).optional().or(z.literal('')),

  // Both
  dateOfBirth: z.coerce.date().optional(),

  // The booking itself
  doctorId: objectId,
  date: z.coerce.date(),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Expected HH:MM'),
  complaint: z.string().max(2000).optional().default(''),
  symptoms: z.array(z.string().max(80)).max(20).optional().default([]),
  triage: z
    .object({
      specialty: z.string().max(60).optional(),
      reason: z.string().max(400).optional(),
      confidence: z.coerce.number().min(0).max(1).optional(),
      matched: z.array(z.string().max(80)).max(20).optional(),
      overridden: z.boolean().optional(),
    })
    .optional(),
});

export const portalLoginSchema = z.object({
  identifier: z.string().min(3).max(60),
  dateOfBirth: z.coerce.date(),
});

// ─── Specialties (administrator-maintained) ─────────────────────────────────

export const createSpecialtySchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'Lower-case letters, numbers and hyphens only'),
  name: z.string().min(2).max(80),
  tagline: z.string().max(160).optional().default(''),
  description: z.string().max(2000).optional().default(''),
  icon: z.string().max(60).optional().default('HeartIcon'),
  symptomKeywords: z.array(z.string().min(2).max(60)).max(80).optional().default([]),
  commonConditions: z.array(z.string().max(120)).max(40).optional().default([]),
  consultationFee: z.coerce.number().min(0).max(100000).optional().default(500),
  location: z.string().max(160).optional().default(''),
  isActive: z.boolean().optional().default(true),
  displayOrder: z.coerce.number().int().min(0).max(999).optional().default(100),
});

export const updateSpecialtySchema = createSpecialtySchema.partial().omit({ slug: true });

export const doctorProfileSchema = z.object({
  specialty: z.string().max(60).optional().default(''),
  qualifications: z.string().max(200).optional().default(''),
  yearsExperience: z.coerce.number().int().min(0).max(70).optional().default(0),
  bio: z.string().max(1200).optional().default(''),
  languages: z.array(z.string().max(40)).max(10).optional().default([]),
  consultationFee: z.coerce.number().min(0).max(100000).optional().default(0),
  availableDays: z.array(z.coerce.number().int().min(0).max(6)).max(7).optional(),
  clinicStart: z.string().regex(/^\d{2}:\d{2}$/, 'Expected HH:MM').optional(),
  clinicEnd: z.string().regex(/^\d{2}:\d{2}$/, 'Expected HH:MM').optional(),
  slotMinutes: z.coerce.number().int().min(5).max(120).optional().default(25),
  bufferMinutes: z.coerce.number().int().min(0).max(60).optional().default(5),
  isBookable: z.boolean().optional().default(false),
});
