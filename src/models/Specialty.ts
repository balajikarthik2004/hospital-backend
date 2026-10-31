import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * A clinical department, as the public site presents it.
 *
 * This exists as its own collection rather than being derived from
 * `User.department` because it is the thing an administrator maintains: the
 * dropdown a patient picks from, the blurb shown on the website, and the
 * symptom keywords that steer triage. Deriving it from staff records would
 * mean a department vanishing from the website the moment its last doctor
 * went on leave.
 */
const specialtySchema = new Schema(
  {
    /** Stable key used in URLs and on doctor records. */
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    /** One line, shown on the department card. */
    tagline: { type: String, default: '' },
    description: { type: String, default: '' },
    /** Heroicon name the client maps to a component. */
    icon: { type: String, default: 'HeartIcon' },

    /**
     * Lower-case keywords that point a described complaint at this
     * department. Maintained by an administrator, so triage can be tuned
     * without a deploy.
     */
    symptomKeywords: { type: [String], default: [] },
    /** Conditions listed on the department page. */
    commonConditions: { type: [String], default: [] },

    consultationFee: { type: Number, default: 500 },
    /** Where the department sits, for the "getting here" panel. */
    location: { type: String, default: '' },

    /** Hidden from the public site when false, without losing the record. */
    isActive: { type: Boolean, default: true },
    /** Lower sorts first on the website. */
    displayOrder: { type: Number, default: 100 },
  },
  { timestamps: true }
);

specialtySchema.index({ isActive: 1, displayOrder: 1 });

export type SpecialtyDoc = InferSchemaType<typeof specialtySchema> & {
  _id: mongoose.Types.ObjectId;
};
export const Specialty = mongoose.model('Specialty', specialtySchema);
