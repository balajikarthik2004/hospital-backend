import mongoose, { Schema, type InferSchemaType } from 'mongoose';

export const BED_STATUSES = ['available', 'occupied', 'maintenance', 'reserved'] as const;
export const BED_TYPES = ['general', 'icu', 'semi_private', 'private', 'pediatric'] as const;

const bedSchema = new Schema({
  ward: { type: String, required: true },
  roomNumber: { type: String, required: true },
  bedNumber: { type: String, required: true },
  type: { type: String, enum: BED_TYPES, default: 'general' },
  status: { type: String, enum: BED_STATUSES, default: 'available' },
  currentPatientId: { type: Schema.Types.ObjectId, ref: 'Patient', default: null },
  currentAdmissionId: { type: Schema.Types.ObjectId, ref: 'Admission', default: null },
  features: [{ type: String }],
});

bedSchema.index({ ward: 1, status: 1 });
bedSchema.index({ ward: 1, roomNumber: 1, bedNumber: 1 }, { unique: true });

bedSchema.virtual('label').get(function (this: any) {
  return `${this.roomNumber}-${this.bedNumber}`;
});
bedSchema.set('toJSON', { virtuals: true });
bedSchema.set('toObject', { virtuals: true });

export type BedDoc = InferSchemaType<typeof bedSchema> & { _id: mongoose.Types.ObjectId };
export const Bed = mongoose.model('Bed', bedSchema);
