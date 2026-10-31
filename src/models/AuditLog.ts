import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const auditLogSchema = new Schema({
  timestamp: { type: Date, default: Date.now },
  userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  userRole: { type: String, default: 'system' },
  action: { type: String, required: true },
  entity: { type: String, required: true },
  entityId: { type: Schema.Types.ObjectId, default: null },
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', default: null },
  details: {
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    description: { type: String, default: '' },
  },
  ipAddress: { type: String, default: '' },
  userAgent: { type: String, default: '' },
});

auditLogSchema.index({ timestamp: -1 });
auditLogSchema.index({ patientId: 1, timestamp: -1 });
auditLogSchema.index({ userId: 1 });

export type AuditLogDoc = InferSchemaType<typeof auditLogSchema> & {
  _id: mongoose.Types.ObjectId;
};
export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
