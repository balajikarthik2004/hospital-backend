import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import bcrypt from 'bcryptjs';

export const ROLES = [
  'physician',
  'pharmacist',
  'nurse',
  'admin',
  'care_coordinator',
  'patient',
] as const;
export type Role = (typeof ROLES)[number];

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    role: { type: String, enum: ROLES, required: true },
    department: { type: String, default: '' },
    specialization: { type: String, default: null },
    licenseNumber: { type: String, default: null },
    phone: { type: String, default: '' },
    avatar: { type: String, default: null },
    /** For role=patient: links the login to a patient chart. */
    patientRef: { type: Schema.Types.ObjectId, ref: 'Patient', default: null },
    isActive: { type: Boolean, default: true },
    lastLogin: { type: Date, default: null },

    /**
     * Everything the public website needs to show about a doctor, and
     * everything the booking flow needs to offer them.
     *
     * Kept on the user rather than in its own collection because it is one
     * optional face of an existing person: the same record signs discharge
     * summaries. `isBookable` is what decides whether a doctor appears on the
     * public site at all, so a physician can keep their login and full
     * clinical access while being invisible to patients.
     */
    doctorProfile: {
      /** Specialty slug. Matches Specialty.slug. */
      specialty: { type: String, default: '' },
      qualifications: { type: String, default: '' },
      yearsExperience: { type: Number, default: 0 },
      /** Shown on the doctor card. Two or three sentences. */
      bio: { type: String, default: '' },
      languages: { type: [String], default: [] },
      consultationFee: { type: Number, default: 0 },
      /** 0 = Sunday, matching Date.getDay(). */
      availableDays: { type: [Number], default: [1, 2, 3, 4, 5] },
      /** Clinic hours, 24h "HH:MM". */
      clinicStart: { type: String, default: '09:00' },
      clinicEnd: { type: String, default: '17:00' },
      slotMinutes: { type: Number, default: 30 },
      isBookable: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

userSchema.virtual('fullName').get(function (this: { firstName: string; lastName: string }) {
  return `${this.firstName} ${this.lastName}`;
});

userSchema.set('toJSON', { virtuals: true });
userSchema.set('toObject', { virtuals: true });

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: mongoose.Types.ObjectId };
export const User = mongoose.model('User', userSchema);
