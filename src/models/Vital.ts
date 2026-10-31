import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const vitalSchema = new Schema({
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
  admissionId: { type: Schema.Types.ObjectId, ref: 'Admission', required: true },
  recordedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  timestamp: { type: Date, default: Date.now },
  bloodPressureSystolic: { type: Number, required: true },
  bloodPressureDiastolic: { type: Number, required: true },
  heartRate: { type: Number, required: true },
  temperature: { type: Number, required: true },
  respiratoryRate: { type: Number, required: true },
  oxygenSaturation: { type: Number, required: true },
  painScore: { type: Number, min: 0, max: 10, default: 0 },
  weight: { type: Number, default: null },
  notes: { type: String, default: null },
});

vitalSchema.index({ patientId: 1, timestamp: -1 });
vitalSchema.index({ admissionId: 1, timestamp: -1 });

export type VitalDoc = InferSchemaType<typeof vitalSchema> & { _id: mongoose.Types.ObjectId };
export const Vital = mongoose.model('Vital', vitalSchema);
