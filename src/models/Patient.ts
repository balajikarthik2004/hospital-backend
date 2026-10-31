import mongoose, { Schema, type Types } from 'mongoose';

export const PATIENT_STATUSES = [
  'registered',
  'admitted',
  'in_treatment',
  'discharge_pending',
  'discharged',
] as const;
export type PatientStatus = (typeof PATIENT_STATUSES)[number];

export interface IAllergy {
  substance: string;
  reaction: string;
  severity: 'mild' | 'moderate' | 'severe' | 'life-threatening';
}

export interface IPatient {
  _id: Types.ObjectId;
  patientId: string;
  demographics: {
    firstName: string;
    lastName: string;
    dateOfBirth: Date;
    gender: 'male' | 'female' | 'other';
    bloodType: string;
    address: { street: string; city: string; state: string; zipCode: string };
    phone: string;
    email: string;
    preferredLanguage: string;
    literacyLevel: 'basic' | 'intermediate' | 'advanced';
  };
  emergencyContacts: { name: string; relationship: string; phone: string }[];
  insurance: {
    provider: string;
    policyNumber: string;
    groupNumber: string;
    coverageType: string;
    isVerified: boolean;
  };
  medicalHistory: {
    conditions: string[];
    surgeries: { name: string; date: Date }[];
    allergies: IAllergy[];
    familyHistory: string[];
  };
  primaryCarePhysician: { name: string; clinic: string; phone: string; fax: string };
  communicationPreference: 'phone' | 'email' | 'sms' | 'portal';
  status: PatientStatus;
  /** How this chart came into being — see the schema for why it matters. */
  registrationSource: 'staff' | 'public_booking' | 'import';
  createdAt: Date;
  updatedAt: Date;
}

const allergySchema = new Schema<IAllergy>(
  {
    substance: { type: String, required: true },
    reaction: { type: String, default: '' },
    severity: {
      type: String,
      enum: ['mild', 'moderate', 'severe', 'life-threatening'],
      default: 'moderate',
    },
  },
  { _id: false }
);

const patientSchema = new Schema<IPatient>(
  {
    patientId: { type: String, required: true, unique: true },
    demographics: {
      firstName: { type: String, required: true },
      lastName: { type: String, required: true },
      dateOfBirth: { type: Date, required: true },
      gender: { type: String, enum: ['male', 'female', 'other'], required: true },
      bloodType: { type: String, default: 'O+' },
      address: {
        street: { type: String, default: '' },
        city: { type: String, default: '' },
        state: { type: String, default: '' },
        zipCode: { type: String, default: '' },
      },
      phone: { type: String, default: '' },
      email: { type: String, default: '' },
      preferredLanguage: { type: String, default: 'English' },
      literacyLevel: {
        type: String,
        enum: ['basic', 'intermediate', 'advanced'],
        default: 'intermediate',
      },
    },
    emergencyContacts: [
      new Schema(
        {
          name: { type: String, required: true },
          relationship: { type: String, default: '' },
          phone: { type: String, default: '' },
        },
        { _id: false }
      ),
    ],
    insurance: {
      provider: { type: String, default: '' },
      policyNumber: { type: String, default: '' },
      groupNumber: { type: String, default: '' },
      coverageType: { type: String, default: '' },
      isVerified: { type: Boolean, default: false },
    },
    medicalHistory: {
      conditions: [{ type: String }],
      surgeries: [new Schema({ name: String, date: Date }, { _id: false })],
      allergies: [allergySchema],
      familyHistory: [{ type: String }],
    },
    primaryCarePhysician: {
      name: { type: String, default: '' },
      clinic: { type: String, default: '' },
      phone: { type: String, default: '' },
      fax: { type: String, default: '' },
    },
    communicationPreference: {
      type: String,
      enum: ['phone', 'email', 'sms', 'portal'],
      default: 'phone',
    },
    status: { type: String, enum: PATIENT_STATUSES, default: 'registered' },
    /**
     * How this chart came into being. Reception needs to tell a patient who
     * registered themselves on the website from one a nurse keyed in, because
     * nobody has verified the self-registered details face to face yet.
     */
    registrationSource: {
      type: String,
      enum: ['staff', 'public_booking', 'import'],
      default: 'staff',
    },
  },
  { timestamps: true }
);

patientSchema.index({ status: 1 });
patientSchema.index({ 'demographics.lastName': 1, 'demographics.firstName': 1 });

patientSchema.virtual('fullName').get(function (this: IPatient) {
  return `${this.demographics.firstName} ${this.demographics.lastName}`;
});
patientSchema.virtual('age').get(function (this: IPatient) {
  const dob = this.demographics?.dateOfBirth;
  if (!dob) return null;
  return Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000));
});
patientSchema.set('toJSON', { virtuals: true });
patientSchema.set('toObject', { virtuals: true });

export const Patient = mongoose.model<IPatient>('Patient', patientSchema);
export type PatientDoc = IPatient;
