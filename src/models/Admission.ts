import mongoose, { Schema, type Types } from 'mongoose';

export type NoteType = 'progress' | 'assessment' | 'consultation' | 'procedure' | 'nursing';
export type RiskLevel = 'low' | 'moderate' | 'high';

export interface IClinicalNote {
  _id?: Types.ObjectId;
  author: Types.ObjectId;
  type: NoteType;
  content: string;
  createdAt: Date;
}

export interface ILabResult {
  _id?: Types.ObjectId;
  testName: string;
  value: string;
  unit: string;
  referenceRange: string;
  isAbnormal: boolean;
  orderedBy: Types.ObjectId | null;
  resultDate: Date;
}

export interface IProcedure {
  _id?: Types.ObjectId;
  name: string;
  date: Date;
  performedBy: Types.ObjectId | null;
  notes: string;
}

export interface IAdmission {
  _id: Types.ObjectId;
  admissionId: string;
  patientId: Types.ObjectId;
  admittingDiagnosis: string;
  diagnosisCodes: string[];
  admissionDate: Date;
  expectedDischargeDate: Date | null;
  actualDischargeDate: Date | null;
  bed: { ward: string; roomNumber: string; bedNumber: string };
  careTeam: {
    attendingPhysician: Types.ObjectId;
    nurses: Types.ObjectId[];
    specialists: Types.ObjectId[];
    pharmacist: Types.ObjectId | null;
    careCoordinator: Types.ObjectId | null;
  };
  riskAssessment: {
    fallRisk: RiskLevel;
    pressureInjuryRisk: RiskLevel;
    infectionFlags: string[];
  };
  status: 'active' | 'discharged' | 'transferred';
  clinicalNotes: IClinicalNote[];
  labResults: ILabResult[];
  procedures: IProcedure[];
  createdAt: Date;
  updatedAt: Date;
}

const clinicalNoteSchema = new Schema<IClinicalNote>({
  author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: {
    type: String,
    enum: ['progress', 'assessment', 'consultation', 'procedure', 'nursing'],
    default: 'progress',
  },
  content: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const labResultSchema = new Schema<ILabResult>({
  testName: { type: String, required: true },
  value: { type: String, required: true },
  unit: { type: String, default: '' },
  referenceRange: { type: String, default: '' },
  isAbnormal: { type: Boolean, default: false },
  orderedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  resultDate: { type: Date, default: Date.now },
});

const procedureSchema = new Schema<IProcedure>({
  name: { type: String, required: true },
  date: { type: Date, default: Date.now },
  performedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  notes: { type: String, default: '' },
});

const admissionSchema = new Schema<IAdmission>(
  {
    admissionId: { type: String, required: true, unique: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    admittingDiagnosis: { type: String, required: true },
    diagnosisCodes: [{ type: String }],
    admissionDate: { type: Date, default: Date.now },
    expectedDischargeDate: { type: Date, default: null },
    actualDischargeDate: { type: Date, default: null },
    bed: {
      ward: { type: String, default: '' },
      roomNumber: { type: String, default: '' },
      bedNumber: { type: String, default: '' },
    },
    careTeam: {
      attendingPhysician: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      nurses: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      specialists: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      pharmacist: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      careCoordinator: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    },
    riskAssessment: {
      fallRisk: { type: String, enum: ['low', 'moderate', 'high'], default: 'low' },
      pressureInjuryRisk: { type: String, enum: ['low', 'moderate', 'high'], default: 'low' },
      infectionFlags: [{ type: String }],
    },
    status: { type: String, enum: ['active', 'discharged', 'transferred'], default: 'active' },
    clinicalNotes: [clinicalNoteSchema],
    labResults: [labResultSchema],
    procedures: [procedureSchema],
  },
  { timestamps: true }
);

admissionSchema.index({ patientId: 1, status: 1 });
admissionSchema.index({ 'careTeam.attendingPhysician': 1 });

admissionSchema.virtual('lengthOfStayDays').get(function (this: IAdmission) {
  const end = this.actualDischargeDate ? new Date(this.actualDischargeDate) : new Date();
  return Math.max(
    1,
    Math.round((end.getTime() - new Date(this.admissionDate).getTime()) / 86_400_000)
  );
});
admissionSchema.set('toJSON', { virtuals: true });
admissionSchema.set('toObject', { virtuals: true });

export const Admission = mongoose.model<IAdmission>('Admission', admissionSchema);
export type AdmissionDoc = IAdmission;
