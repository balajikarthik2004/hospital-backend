import mongoose, { Schema, type InferSchemaType } from 'mongoose';

export const APPOINTMENT_TYPES = [
  'follow_up',
  'specialist',
  'lab_only',
  'telehealth',
  'pre_admission',
] as const;

export const APPOINTMENT_STATUSES = [
  'scheduled',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
] as const;

const appointmentSchema = new Schema(
  {
    appointmentId: { type: String, required: true, unique: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    doctorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    admissionId: { type: Schema.Types.ObjectId, ref: 'Admission', default: null },
    type: { type: String, enum: APPOINTMENT_TYPES, default: 'follow_up' },
    specialty: { type: String, default: '' },
    scheduledDate: { type: Date, required: true },
    scheduledTime: { type: String, required: true },
    duration: { type: Number, default: 30 },
    location: { type: String, default: '' },
    status: { type: String, enum: APPOINTMENT_STATUSES, default: 'scheduled' },
    reason: { type: String, default: '' },
    notes: { type: String, default: null },
    insuranceVerified: { type: Boolean, default: false },
    reminderSent: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    /**
     * 'public' means a patient booked this themselves on the website, with no
     * member of staff involved. Reception needs to be able to tell those
     * apart at a glance — they are the ones nobody has spoken to yet.
     */
    source: { type: String, enum: ['staff', 'public'], default: 'staff' },
    /** The complaint in the patient's own words, kept verbatim. */
    complaint: { type: String, default: '' },
    /**
     * What triage suggested and why. Stored rather than recomputed so the
     * doctor can see the routing the patient was given, even after an
     * administrator has since retuned the keywords.
     */
    triage: {
      specialty: { type: String, default: '' },
      reason: { type: String, default: '' },
      confidence: { type: Number, default: 0 },
      matched: { type: [String], default: [] },
      /** True when the patient overrode the suggested department. */
      overridden: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

appointmentSchema.index({ patientId: 1, scheduledDate: 1 });
appointmentSchema.index({ doctorId: 1, scheduledDate: 1 });

export type AppointmentDoc = InferSchemaType<typeof appointmentSchema> & {
  _id: mongoose.Types.ObjectId;
};
export const Appointment = mongoose.model('Appointment', appointmentSchema);
