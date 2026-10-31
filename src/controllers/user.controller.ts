import type { Request, Response } from 'express';
import { User } from '../models/User.js';
import { Admission } from '../models/Admission.js';
import { audit } from '../middleware/audit.js';
import { publicUser } from './auth.controller.js';
import { asyncHandler, notFound } from '../utils/helpers.js';

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = {};
  if (req.query.role) filter.role = req.query.role;
  if (req.query.active !== undefined) filter.isActive = req.query.active === 'true';
  if (req.query.q) {
    const re = new RegExp(String(req.query.q), 'i');
    filter.$or = [{ firstName: re }, { lastName: re }, { email: re }, { department: re }];
  }

  const users = await User.find(filter).sort('lastName firstName').lean();
  res.json({ users: users.map(publicUser) });
});

/** Doctors with their specialisations — used by the scheduling module. */
export const listDoctors = asyncHandler(async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = { role: 'physician', isActive: true };
  if (req.query.specialty) filter.specialization = new RegExp(String(req.query.specialty), 'i');

  const doctors = await User.find(filter).sort('lastName').lean();
  const activeCounts = await Admission.aggregate([
    { $match: { status: 'active' } },
    { $group: { _id: '$careTeam.attendingPhysician', count: { $sum: 1 } } },
  ]);
  const counts = new Map(activeCounts.map((c) => [String(c._id), c.count as number]));

  res.json({
    doctors: doctors.map((d) => ({
      ...publicUser(d),
      activePatients: counts.get(String(d._id)) ?? 0,
    })),
    specialties: [...new Set(doctors.map((d) => d.specialization).filter(Boolean))].sort(),
  });
});

export const getUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.params.id).lean();
  if (!user) throw notFound('User');
  res.json({ user: publicUser(user) });
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const before = await User.findById(req.params.id).lean();
  if (!before) throw notFound('User');

  const user = await User.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  }).lean();

  await audit(req, {
    action: 'user.updated',
    entity: 'users',
    entityId: before._id,
    description: `Updated ${before.email}`,
    before: { role: before.role, isActive: before.isActive },
    after: req.body,
  });

  res.json({ user: publicUser(user) });
});

export const deactivateUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { isActive: false },
    { new: true }
  ).lean();
  if (!user) throw notFound('User');

  await audit(req, {
    action: 'user.deactivated',
    entity: 'users',
    entityId: user._id,
    description: `Deactivated ${user.email}`,
  });

  res.json({ user: publicUser(user) });
});
