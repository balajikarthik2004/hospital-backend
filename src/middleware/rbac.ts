import type { Request, Response, NextFunction } from 'express';
import type { Role } from '../models/User.js';
import { HttpError } from '../utils/helpers.js';

/**
 * Permission matrix — a direct transcription of Section 5 of the build spec.
 * Keys are capability names used by `can()` / `requirePermission()`.
 */
export const PERMISSIONS = {
  'patient:view:own': ['patient'],
  'patient:view:any': ['nurse', 'physician', 'pharmacist', 'care_coordinator', 'admin'],
  'patient:register': ['nurse', 'physician', 'care_coordinator', 'admin'],
  'patient:admit': ['physician', 'admin'],
  'vitals:record': ['nurse', 'physician'],
  'notes:write': ['nurse', 'physician', 'pharmacist'],
  'medication:modify': ['physician', 'pharmacist'],
  'discharge:initiate': ['physician'],
  'discharge:review-medication': ['physician', 'pharmacist'],
  'discharge:approve-summary': ['physician'],
  'discharge:approve-instructions': ['nurse', 'physician'],
  'discharge:complete': ['physician', 'admin'],
  'appointment:schedule': ['patient', 'nurse', 'physician', 'care_coordinator'],
  'referral:manage': ['physician', 'care_coordinator'],
  'analytics:view': ['physician', 'pharmacist', 'care_coordinator', 'admin'],
  'audit:view': ['admin'],
  'users:manage': ['admin'],
  'beds:manage': ['admin'],
  'beds:view': ['nurse', 'physician', 'pharmacist', 'care_coordinator', 'admin'],
  /**
   * Maintaining what patients see on the public website: the department
   * dropdown, the triage keywords behind it, and which doctors are offered
   * for online booking. Administrator only — these settings decide what the
   * hospital tells the public, not what happens to one patient.
   */
  'catalogue:manage': ['admin'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly string[]).includes(role);
}

/** Express guard for a single capability. */
export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new HttpError(401, 'Authentication required'));
    if (!can(req.user.role, permission)) {
      return next(
        new HttpError(403, `Role "${req.user.role}" may not perform "${permission}"`)
      );
    }
    next();
  };
}

/** Express guard for an explicit role list. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new HttpError(401, 'Authentication required'));
    if (!roles.includes(req.user.role)) {
      return next(new HttpError(403, `Requires role: ${roles.join(' or ')}`));
    }
    next();
  };
}

/**
 * Patients may only read their own chart. Staff roles see everything.
 * Expects the patient's ObjectId at `req.params[param]`.
 */
export function scopePatientAccess(param = 'id') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new HttpError(401, 'Authentication required'));
    if (req.user.role !== 'patient') return next();
    if (req.user.patientRef && req.user.patientRef === req.params[param]) return next();
    next(new HttpError(403, 'Patients may only access their own record'));
  };
}

/** Full capability map for the signed-in role — consumed by the frontend. */
export function permissionsForRole(role: Role): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p));
}
