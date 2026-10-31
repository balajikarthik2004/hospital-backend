import mongoose, { Schema, type Types } from 'mongoose';
import { medicationItemSchema, type IMedicationItem } from './Medication.js';

export const PACKAGE_STATUSES = [
  'initiated',
  'agents_processing',
  'pending_review',
  'in_review',
  'approved',
  'rejected',
  'completed',
] as const;
export type PackageStatus = (typeof PACKAGE_STATUSES)[number];

const SECTION_STATUSES = ['pending', 'generated', 'reviewed', 'approved', 'rejected'] as const;
export type SectionStatus = (typeof SECTION_STATUSES)[number];

export const FLAG_TYPES = [
  'omission',
  'duplication',
  'dose_mismatch',
  'interaction',
  'allergy_conflict',
  'unclear_instruction',
] as const;
export type FlagType = (typeof FLAG_TYPES)[number];

export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface IFlag {
  flagId: string;
  type: FlagType;
  severity: Severity;
  drugA: string;
  drugB: string | null;
  description: string;
  recommendation: string;
  confidence: number;
  resolution: 'pending' | 'accepted' | 'modified' | 'dismissed';
  resolvedBy: Types.ObjectId | null;
  resolvedAt: Date | null;
  resolvedNote: string | null;
}

export interface IRecommendation {
  _id?: Types.ObjectId;
  type:
    | 'pcp_visit'
    | 'specialist'
    | 'lab_work'
    | 'home_health'
    | 'physical_therapy'
    | 'dme'
    | 'other';
  description: string;
  timeframe: string;
  priority: 'required' | 'recommended' | 'optional';
  specialty: string;
  dueInDays: number;
  appointmentId: Types.ObjectId | null;
  isScheduled: boolean;
}

export interface IAgentRun {
  agent: string;
  status: 'queued' | 'running' | 'complete' | 'failed';
  startedAt?: Date;
  finishedAt?: Date;
  durationMs?: number;
  confidence?: number;
  error?: string;
}

export interface IApproval {
  role: 'physician' | 'pharmacist' | 'nurse';
  userId: Types.ObjectId;
  section: string;
  action: 'approved' | 'rejected' | 'edited';
  comments: string | null;
  signature: string;
  timestamp: Date;
}

export interface IDischargePackage {
  _id: Types.ObjectId;
  packageId: string;
  patientId: Types.ObjectId;
  admissionId: Types.ObjectId;
  initiatedBy: Types.ObjectId;
  initiatedAt: Date;
  status: PackageStatus;

  clinicalSummary: {
    status: SectionStatus;
    content: string;
    generatedAt: Date | null;
    reviewedBy: Types.ObjectId | null;
    reviewedAt: Date | null;
    edits: string | null;
    agentConfidence: number;
    generator: string;
  };

  medicationReconciliation: {
    status: SectionStatus;
    preAdmissionMeds: IMedicationItem[];
    inpatientMeds: IMedicationItem[];
    dischargeMeds: IMedicationItem[];
    flags: IFlag[];
    agentConfidence: number;
    reviewedBy: Types.ObjectId | null;
    reviewedAt: Date | null;
  };

  followUpPlan: {
    status: SectionStatus;
    recommendations: IRecommendation[];
    agentConfidence: number;
    reviewedBy: Types.ObjectId | null;
    reviewedAt: Date | null;
  };

  patientEducation: {
    status: SectionStatus;
    content: string;
    readingLevel: string;
    language: string;
    generatedAt: Date | null;
    reviewedBy: Types.ObjectId | null;
    reviewedAt: Date | null;
    agentConfidence: number;
    generator: string;
  };

  safetyValidation: {
    passed: boolean;
    checks: { name: string; passed: boolean; detail: string }[];
    validatedAt: Date | null;
  };

  agentRuns: IAgentRun[];
  approvals: IApproval[];
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const flagSchema = new Schema<IFlag>(
  {
    flagId: { type: String, required: true },
    type: { type: String, enum: FLAG_TYPES, required: true },
    severity: { type: String, enum: SEVERITIES, required: true },
    drugA: { type: String, required: true },
    drugB: { type: String, default: null },
    description: { type: String, required: true },
    recommendation: { type: String, required: true },
    confidence: { type: Number, default: 0.8 },
    resolution: {
      type: String,
      enum: ['pending', 'accepted', 'modified', 'dismissed'],
      default: 'pending',
    },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
    resolvedNote: { type: String, default: null },
  },
  { _id: false }
);

const recommendationSchema = new Schema<IRecommendation>({
  type: {
    type: String,
    enum: ['pcp_visit', 'specialist', 'lab_work', 'home_health', 'physical_therapy', 'dme', 'other'],
    required: true,
  },
  description: { type: String, required: true },
  timeframe: { type: String, default: '' },
  priority: {
    type: String,
    enum: ['required', 'recommended', 'optional'],
    default: 'recommended',
  },
  specialty: { type: String, default: '' },
  dueInDays: { type: Number, default: 7 },
  appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment', default: null },
  isScheduled: { type: Boolean, default: false },
});

const agentRunSchema = new Schema<IAgentRun>(
  {
    agent: String,
    status: { type: String, enum: ['queued', 'running', 'complete', 'failed'] },
    startedAt: Date,
    finishedAt: Date,
    durationMs: Number,
    confidence: Number,
    error: String,
  },
  { _id: false }
);

const approvalSchema = new Schema<IApproval>(
  {
    role: { type: String, enum: ['physician', 'pharmacist', 'nurse'], required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    section: { type: String, required: true },
    action: { type: String, enum: ['approved', 'rejected', 'edited'], required: true },
    comments: { type: String, default: null },
    signature: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

const dischargePackageSchema = new Schema<IDischargePackage>(
  {
    packageId: { type: String, required: true, unique: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    admissionId: { type: Schema.Types.ObjectId, ref: 'Admission', required: true, unique: true },
    initiatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    initiatedAt: { type: Date, default: Date.now },
    status: { type: String, enum: PACKAGE_STATUSES, default: 'initiated' },

    clinicalSummary: {
      status: { type: String, enum: SECTION_STATUSES, default: 'pending' },
      content: { type: String, default: '' },
      generatedAt: { type: Date, default: null },
      reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      reviewedAt: { type: Date, default: null },
      edits: { type: String, default: null },
      agentConfidence: { type: Number, default: 0 },
      generator: { type: String, default: 'pending' },
    },

    medicationReconciliation: {
      status: { type: String, enum: SECTION_STATUSES, default: 'pending' },
      preAdmissionMeds: [medicationItemSchema],
      inpatientMeds: [medicationItemSchema],
      dischargeMeds: [medicationItemSchema],
      flags: [flagSchema],
      agentConfidence: { type: Number, default: 0 },
      reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      reviewedAt: { type: Date, default: null },
    },

    followUpPlan: {
      status: { type: String, enum: SECTION_STATUSES, default: 'pending' },
      recommendations: [recommendationSchema],
      agentConfidence: { type: Number, default: 0 },
      reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      reviewedAt: { type: Date, default: null },
    },

    patientEducation: {
      status: { type: String, enum: SECTION_STATUSES, default: 'pending' },
      content: { type: String, default: '' },
      readingLevel: { type: String, default: 'intermediate' },
      language: { type: String, default: 'English' },
      generatedAt: { type: Date, default: null },
      reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      reviewedAt: { type: Date, default: null },
      agentConfidence: { type: Number, default: 0 },
      generator: { type: String, default: 'pending' },
    },

    safetyValidation: {
      passed: { type: Boolean, default: false },
      checks: [
        new Schema({ name: String, passed: Boolean, detail: String }, { _id: false }),
      ],
      validatedAt: { type: Date, default: null },
    },

    agentRuns: [agentRunSchema],
    approvals: [approvalSchema],
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

dischargePackageSchema.index({ patientId: 1 });
dischargePackageSchema.index({ status: 1 });

export const DischargePackage = mongoose.model<IDischargePackage>(
  'DischargePackage',
  dischargePackageSchema
);
export type DischargePackageDoc = IDischargePackage;
