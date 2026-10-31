import type { Request, Response } from 'express';
import { Appointment } from '../models/Appointment.js';
import { Specialty } from '../models/Specialty.js';
import { User } from '../models/User.js';
import { audit } from '../middleware/audit.js';
import { asyncHandler, badRequest, notFound } from '../utils/helpers.js';

/* ═══════════════════════════════════════════════════════════════════════════
   What an administrator maintains: the departments patients choose from, the
   keywords that route a complaint to one, and which doctors the public site
   is allowed to offer.
   ═══════════════════════════════════════════════════════════════════════════ */

/** GET /api/specialties — every department, including the hidden ones. */
export const listSpecialties = asyncHandler(async (_req: Request, res: Response) => {
  const specialties = await Specialty.find().sort('displayOrder name').lean();

  // Doctor counts, so an administrator can see at a glance that a department
  // is live on the website with nobody bookable in it.
  const counts = await User.aggregate<{ _id: string; total: number; bookable: number }>([
    { $match: { role: 'physician', isActive: true } },
    {
      $group: {
        _id: '$doctorProfile.specialty',
        total: { $sum: 1 },
        bookable: { $sum: { $cond: ['$doctorProfile.isBookable', 1, 0] } },
      },
    },
  ]);
  const bySlug = new Map(counts.map((c) => [c._id, c]));

  res.json({
    specialties: specialties.map((s) => ({
      ...s,
      doctorCount: bySlug.get(s.slug)?.total ?? 0,
      bookableCount: bySlug.get(s.slug)?.bookable ?? 0,
    })),
  });
});

export const createSpecialty = asyncHandler(async (req: Request, res: Response) => {
  const existing = await Specialty.findOne({ slug: req.body.slug });
  if (existing) throw badRequest(`A department with the key "${req.body.slug}" already exists`);

  const specialty = await Specialty.create(req.body);
  await audit(req, {
    action: 'specialty.create',
    entity: 'Specialty',
    entityId: specialty._id,
    after: specialty.toObject(),
    description: `Created the ${specialty.name} department`,
  });
  res.status(201).json({ specialty });
});

export const updateSpecialty = asyncHandler(async (req: Request, res: Response) => {
  const before = await Specialty.findById(req.params.id).lean();
  if (!before) throw notFound('Department');

  const specialty = await Specialty.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

  await audit(req, {
    action: 'specialty.update',
    entity: 'Specialty',
    entityId: req.params.id,
    before,
    after: specialty?.toObject(),
    description: `Updated the ${specialty?.name} department`,
  });
  res.json({ specialty });
});

/**
 * DELETE /api/specialties/:id
 *
 * Refuses while doctors or appointments still point at the department.
 * Deleting it anyway would orphan both and silently break triage, so the
 * caller is told what is in the way and offered the honest alternative:
 * deactivate it, which hides it from the website and keeps the history.
 */
export const deleteSpecialty = asyncHandler(async (req: Request, res: Response) => {
  const specialty = await Specialty.findById(req.params.id);
  if (!specialty) throw notFound('Department');

  const [doctors, appointments] = await Promise.all([
    User.countDocuments({ 'doctorProfile.specialty': specialty.slug }),
    Appointment.countDocuments({ specialty: specialty.slug }),
  ]);

  if (doctors || appointments) {
    throw badRequest(
      `${specialty.name} still has ${doctors} doctor(s) and ${appointments} appointment(s) ` +
        `attached. Deactivate it instead — it will disappear from the website and keep its history.`,
      { doctors, appointments, suggestion: 'deactivate' }
    );
  }

  await specialty.deleteOne();
  await audit(req, {
    action: 'specialty.delete',
    entity: 'Specialty',
    entityId: req.params.id,
    before: specialty.toObject(),
    description: `Deleted the ${specialty.name} department`,
  });
  res.json({ deleted: true });
});

/** GET /api/specialties/doctors — every physician with their public profile. */
export const listDoctorProfiles = asyncHandler(async (_req: Request, res: Response) => {
  const doctors = await User.find({ role: 'physician' })
    .select('firstName lastName email department specialization isActive doctorProfile')
    .sort('firstName')
    .lean();
  res.json({ doctors });
});

/** PUT /api/specialties/doctors/:id — edit what the website shows and offers. */
export const updateDoctorProfile = asyncHandler(async (req: Request, res: Response) => {
  const doctor = await User.findOne({ _id: req.params.id, role: 'physician' });
  if (!doctor) throw notFound('Doctor');

  // A doctor cannot be offered to the public in a department that does not
  // exist, or one that is hidden — the booking flow would show an empty list.
  if (req.body.isBookable) {
    const slug = req.body.specialty ?? doctor.doctorProfile?.specialty;
    if (!slug) throw badRequest('Give the doctor a department before making them bookable');
    const specialty = await Specialty.findOne({ slug });
    if (!specialty) throw badRequest(`No department has the key "${slug}"`);
    if (!specialty.isActive) {
      throw badRequest(
        `${specialty.name} is deactivated, so patients cannot reach it. ` +
          `Reactivate the department first.`
      );
    }
  }

  if (req.body.clinicStart && req.body.clinicEnd && req.body.clinicEnd <= req.body.clinicStart) {
    throw badRequest('Clinic must end after it starts');
  }

  const before = doctor.toObject().doctorProfile;
  doctor.doctorProfile = { ...(doctor.doctorProfile ?? {}), ...req.body };
  await doctor.save();

  await audit(req, {
    action: 'doctor.profile.update',
    entity: 'User',
    entityId: doctor._id,
    before,
    after: doctor.toObject().doctorProfile,
    description: `Updated the public profile for ${doctor.firstName} ${doctor.lastName}`,
  });

  res.json({ doctor: { _id: doctor._id, doctorProfile: doctor.doctorProfile } });
});
