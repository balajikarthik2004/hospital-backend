import mongoose, { Schema, type Types } from 'mongoose';
import { ROUTES, type Route } from './Medication.js';

/**
 * A prescription as it travels from the doctor to the hospital pharmacy.
 *
 * This is deliberately a separate collection from `Medication`. That one is a
 * *reconciliation list* — a snapshot of what a patient was on before, during
 * and after an admission, which the discharge agents compare. This one is an
 * *order with a lifecycle*: it is written, checked, prepared, handed over, and
 * each of those steps is attributable to a person at a time. Modelling a
 * dispensing queue as a snapshot list would lose exactly the information the
 * pharmacy needs.
 *
 * The status ladder is one-way apart from cancellation:
 *
 *   draft → sent_to_pharmacy → preparing → ready → dispensed
 *                     ↘            ↘         ↘
 *                        cancelled (with a reason, at any point before dispensed)
 *
 * Once dispensed, medicine has left the counter and the record is immutable.
 *
 * Typed with explicit interfaces rather than `InferSchemaType`, like the other
 * nested models here: inference marks every sub-document optional, which turns
 * `prescription.pharmacy.dispensedBy` into a null check at every call site.
 */

export const PRESCRIPTION_STATUSES = [
  'draft',
  'sent_to_pharmacy',
  'preparing',
  'ready',
  'dispensed',
  'cancelled',
] as const;
export type PrescriptionStatus = (typeof PRESCRIPTION_STATUSES)[number];

/** Statuses the pharmacy may still act on. */
export const PHARMACY_OPEN_STATUSES = ['sent_to_pharmacy', 'preparing', 'ready'] as const;

export const PRESCRIPTION_PRIORITIES = ['routine', 'urgent', 'stat'] as const;
export type PrescriptionPriority = (typeof PRESCRIPTION_PRIORITIES)[number];

export const PRESCRIPTION_FLAG_TYPES = [
  'interaction',
  'allergy_conflict',
  'duplication',
  'high_risk',
  'unclear_instruction',
] as const;
export type PrescriptionFlagType = (typeof PRESCRIPTION_FLAG_TYPES)[number];

export const FLAG_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type FlagSeverity = (typeof FLAG_SEVERITIES)[number];

export interface IPrescriptionItem {
  _id: Types.ObjectId;
  drugName: string;
  genericName: string;
  drugClass: string;
  dosage: string;
  frequency: string;
  route: Route;
  durationDays: number;
  quantity: number;
  instructions: string;
  substitutionAllowed: boolean;
  isDispensed: boolean;
  dispensedQuantity: number;
  substitutedWith: string | null;
  pharmacyNote: string | null;
}

export interface IPrescriptionFlag {
  flagId: string;
  type: PrescriptionFlagType;
  severity: FlagSeverity;
  drugA: string;
  drugB: string | null;
  description: string;
  recommendation: string;
  acknowledged: boolean;
  acknowledgedBy: Types.ObjectId | null;
  acknowledgedAt: Date | null;
  acknowledgementNote: string | null;
}

export interface IPrescription {
  _id: Types.ObjectId;
  prescriptionId: string;
  patientId: Types.ObjectId;
  admissionId: Types.ObjectId | null;
  prescribedBy: Types.ObjectId;
  prescribedAt: Date;
  status: PrescriptionStatus;
  priority: PrescriptionPriority;
  diagnosis: string;
  notes: string;
  items: IPrescriptionItem[];
  safety: {
    checkedAt: Date | null;
    passed: boolean;
    flags: IPrescriptionFlag[];
  };
  pharmacy: {
    verifiedBy: Types.ObjectId | null;
    verifiedAt: Date | null;
    readyAt: Date | null;
    dispensedBy: Types.ObjectId | null;
    dispensedAt: Date | null;
    collectedBy: string;
    notes: string;
  };
  counselling: {
    content: string;
    generatedAt: Date | null;
    generator: string;
  };
  sentToPharmacyAt: Date | null;
  cancelledBy: Types.ObjectId | null;
  cancelledAt: Date | null;
  cancelReason: string;
  createdAt: Date;
  updatedAt: Date;
}

const itemSchema = new Schema<IPrescriptionItem>({
  drugName: { type: String, required: true, trim: true },
  genericName: { type: String, default: '' },
  drugClass: { type: String, default: '' },
  dosage: { type: String, default: '' },
  frequency: { type: String, default: '' },
  route: { type: String, enum: ROUTES, default: 'oral' },
  /** How long the course runs. 0 means "ongoing / until review". */
  durationDays: { type: Number, default: 0, min: 0 },
  /** Units to hand over — tablets, vials, millilitres. */
  quantity: { type: Number, default: 0, min: 0 },
  instructions: { type: String, default: '' },
  /**
   * Whether the pharmacy may hand over an equivalent generic. The doctor
   * decides this, not the pharmacist, because some substitutions are
   * clinically meaningful (narrow therapeutic index drugs especially).
   */
  substitutionAllowed: { type: Boolean, default: true },

  /* ── Filled in by the pharmacy ───────────────────────────────────────── */
  isDispensed: { type: Boolean, default: false },
  dispensedQuantity: { type: Number, default: 0, min: 0 },
  /** Set only when the pharmacy handed over something other than drugName. */
  substitutedWith: { type: String, default: null },
  pharmacyNote: { type: String, default: null },
});

const flagSchema = new Schema<IPrescriptionFlag>(
  {
    flagId: { type: String, required: true },
    type: { type: String, enum: PRESCRIPTION_FLAG_TYPES, required: true },
    severity: { type: String, enum: FLAG_SEVERITIES, required: true },
    drugA: { type: String, required: true },
    drugB: { type: String, default: null },
    description: { type: String, required: true },
    recommendation: { type: String, default: '' },
    /**
     * A pharmacist must deal with every critical flag before dispensing —
     * accept it, or send the prescription back. Silence is not resolution.
     */
    acknowledged: { type: Boolean, default: false },
    acknowledgedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    acknowledgedAt: { type: Date, default: null },
    acknowledgementNote: { type: String, default: null },
  },
  { _id: false }
);

const prescriptionSchema = new Schema<IPrescription>(
  {
    prescriptionId: { type: String, required: true, unique: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    /** Null for an outpatient prescription — not every script follows an admission. */
    admissionId: { type: Schema.Types.ObjectId, ref: 'Admission', default: null },
    prescribedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    prescribedAt: { type: Date, default: Date.now },

    status: { type: String, enum: PRESCRIPTION_STATUSES, default: 'draft' },
    priority: { type: String, enum: PRESCRIPTION_PRIORITIES, default: 'routine' },
    diagnosis: { type: String, default: '' },
    notes: { type: String, default: '' },

    items: { type: [itemSchema], default: [] },

    /** Deterministic rules-based screening, re-run on every edit. */
    safety: {
      checkedAt: { type: Date, default: null },
      passed: { type: Boolean, default: true },
      flags: { type: [flagSchema], default: [] },
    },

    /** Who did what at the counter. */
    pharmacy: {
      verifiedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      verifiedAt: { type: Date, default: null },
      readyAt: { type: Date, default: null },
      dispensedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      dispensedAt: { type: Date, default: null },
      /** Who physically collected — the patient, or a named relative. */
      collectedBy: { type: String, default: '' },
      notes: { type: String, default: '' },
    },

    /**
     * The plain-language sheet the patient leaves with, written by the
     * Medication Agent from the prescribed items. Stored rather than
     * regenerated so the patient and the pharmacist have the same text.
     */
    counselling: {
      content: { type: String, default: '' },
      generatedAt: { type: Date, default: null },
      generator: { type: String, default: '' },
    },

    sentToPharmacyAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: '' },
  },
  { timestamps: true }
);

// The pharmacy queue reads by status and arrival order on every poll.
prescriptionSchema.index({ status: 1, sentToPharmacyAt: 1 });
prescriptionSchema.index({ patientId: 1, prescribedAt: -1 });
prescriptionSchema.index({ prescribedBy: 1, prescribedAt: -1 });

prescriptionSchema.virtual('itemCount').get(function (this: IPrescription) {
  return this.items?.length ?? 0;
});
prescriptionSchema.set('toJSON', { virtuals: true });
prescriptionSchema.set('toObject', { virtuals: true });

export const Prescription = mongoose.model<IPrescription>('Prescription', prescriptionSchema);
export type PrescriptionDoc = IPrescription;
