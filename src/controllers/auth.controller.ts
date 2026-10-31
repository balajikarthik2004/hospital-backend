import type { Request, Response } from 'express';
import { User, hashPassword, verifyPassword } from '../models/User.js';
import { signToken, type AuthUser } from '../middleware/auth.js';
import { permissionsForRole } from '../middleware/rbac.js';
import { audit } from '../middleware/audit.js';
import { HttpError, asyncHandler } from '../utils/helpers.js';

function toAuthUser(doc: any): AuthUser {
  return {
    id: String(doc._id),
    email: doc.email,
    role: doc.role,
    firstName: doc.firstName,
    lastName: doc.lastName,
    patientRef: doc.patientRef ? String(doc.patientRef) : null,
  };
}

function publicUser(doc: any) {
  return {
    id: String(doc._id),
    email: doc.email,
    firstName: doc.firstName,
    lastName: doc.lastName,
    fullName: `${doc.firstName} ${doc.lastName}`,
    role: doc.role,
    department: doc.department,
    specialization: doc.specialization,
    licenseNumber: doc.licenseNumber,
    phone: doc.phone,
    avatar: doc.avatar,
    patientRef: doc.patientRef ? String(doc.patientRef) : null,
    isActive: doc.isActive,
    lastLogin: doc.lastLogin,
    permissions: permissionsForRole(doc.role),
  };
}

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body as { email: string; password: string };
  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');

  if (!user || !user.isActive) throw new HttpError(401, 'Invalid email or password');
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw new HttpError(401, 'Invalid email or password');

  user.lastLogin = new Date();
  await user.save();

  const authUser = toAuthUser(user);
  await audit({ ...req, user: authUser } as Request, {
    action: 'auth.login',
    entity: 'users',
    entityId: user._id,
    description: `${user.email} signed in as ${user.role}`,
  });

  res.json({ token: signToken(authUser), user: publicUser(user) });
});

export const register = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as Record<string, any>;
  const exists = await User.findOne({ email: body.email.toLowerCase() });
  if (exists) throw new HttpError(409, 'A user with that email already exists');

  const user = await User.create({
    ...body,
    email: body.email.toLowerCase(),
    passwordHash: await hashPassword(body.password),
  });

  await audit(req, {
    action: 'user.created',
    entity: 'users',
    entityId: user._id,
    description: `Created ${user.role} account for ${user.email}`,
    after: { email: user.email, role: user.role },
  });

  res.status(201).json({ user: publicUser(user) });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.user!.id);
  if (!user) throw new HttpError(404, 'User not found');
  res.json({ user: publicUser(user) });
});

export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const before = await User.findById(req.user!.id).lean();
  const user = await User.findByIdAndUpdate(req.user!.id, req.body, { new: true });
  if (!user) throw new HttpError(404, 'User not found');

  await audit(req, {
    action: 'user.profile-updated',
    entity: 'users',
    entityId: user._id,
    description: 'Updated own profile',
    before: { firstName: before?.firstName, lastName: before?.lastName, phone: before?.phone },
    after: req.body,
  });

  res.json({ user: publicUser(user) });
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body as {
    currentPassword: string;
    newPassword: string;
  };
  const user = await User.findById(req.user!.id).select('+passwordHash');
  if (!user) throw new HttpError(404, 'User not found');

  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) throw new HttpError(400, 'Current password is incorrect');

  user.passwordHash = await hashPassword(newPassword);
  await user.save();

  await audit(req, {
    action: 'user.password-changed',
    entity: 'users',
    entityId: user._id,
    description: 'Changed own password',
  });

  res.json({ ok: true });
});

export { publicUser };
