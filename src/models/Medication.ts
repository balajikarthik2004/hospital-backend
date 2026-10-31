import mongoose, { Schema, type Types } from 'mongoose';

export const ROUTES = ['oral', 'IV', 'IM', 'SC', 'topical', 'inhaled', 'rectal'] as const;
export type Route = (typeof ROUTES)[number];

export const LIST_TYPES = ['pre_admission', 'inpatient', 'discharge'] as const;
export type ListType = (typeof LIST_TYPES)[number];

export interface IMedicationItem {
  _id?: Types.ObjectId;
  drugName: string;
  genericName: string;
  drugClass: string;
  dosage: string;
  frequency: string;
  route: Route;
  prescribedBy: Types.ObjectId | null;
  startDate: Date;
  endDate: Date | null;
  isActive: boolean;
  notes: string | null;
}

export interface IMedication {
  _id: Types.ObjectId;
  patientId: Types.ObjectId;
  admissionId: Types.ObjectId;
  listType: ListType;
  medications: IMedicationItem[];
  createdAt: Date;
  updatedAt: Date;
}

export const medicationItemSchema = new Schema<IMedicationItem>({
  drugName: { type: String, required: true },
  genericName: { type: String, default: '' },
  drugClass: { type: String, default: '' },
  dosage: { type: String, default: '' },
  frequency: { type: String, default: '' },
  route: { type: String, enum: ROUTES, default: 'oral' },
  prescribedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  startDate: { type: Date, default: Date.now },
  endDate: { type: Date, default: null },
  isActive: { type: Boolean, default: true },
  notes: { type: String, default: null },
});

const medicationSchema = new Schema<IMedication>(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    admissionId: { type: Schema.Types.ObjectId, ref: 'Admission', required: true },
    listType: { type: String, enum: LIST_TYPES, required: true },
    medications: [medicationItemSchema],
  },
  { timestamps: true }
);

medicationSchema.index({ admissionId: 1, listType: 1 }, { unique: true });
medicationSchema.index({ patientId: 1 });

export const Medication = mongoose.model<IMedication>('Medication', medicationSchema);
export type MedicationDoc = IMedication;
