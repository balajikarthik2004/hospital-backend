import { AuditLog } from '../src/models/AuditLog.js';
import { pick, rand, randInt } from './patients.seed.js';
import type { SeededAdmissions } from './admissions.seed.js';
import type { SeededPatients } from './patients.seed.js';
import type { SeededUsers } from './users.seed.js';

/**
 * Backfills historical audit entries so the audit module has depth. The
 * pipeline itself already writes genuine entries for everything it does; this
 * adds the routine clinical activity that would have preceded it.
 */
export async function seedAuditLogs(
  users: SeededUsers,
  patients: SeededPatients,
  admissions: SeededAdmissions
) {
  // Loosely typed on purpose: these are plain seed literals that Mongoose casts.
  const docs: any[] = [];

  const ACTIONS: { action: string; entity: string; describe: (p: string) => string; roles: string[] }[] = [
    { action: 'patient.viewed', entity: 'patients', describe: (p) => `Opened the chart for ${p}`, roles: ['physician', 'nurse', 'pharmacist', 'care_coordinator'] },
    { action: 'vitals.recorded', entity: 'vitals', describe: (p) => `Recorded observations for ${p}`, roles: ['nurse'] },
    { action: 'note.created', entity: 'admissions', describe: (p) => `Added a progress note for ${p}`, roles: ['physician', 'nurse'] },
    { action: 'medication.list-updated', entity: 'medications', describe: (p) => `Updated the inpatient medication list for ${p}`, roles: ['physician', 'pharmacist'] },
    { action: 'lab.recorded', entity: 'admissions', describe: (p) => `Filed a laboratory result for ${p}`, roles: ['physician'] },
    { action: 'appointment.created', entity: 'appointments', describe: (p) => `Booked a follow-up appointment for ${p}`, roles: ['care_coordinator', 'nurse'] },
    { action: 'patient.updated', entity: 'patients', describe: (p) => `Corrected demographic details for ${p}`, roles: ['nurse', 'care_coordinator'] },
    { action: 'bed.assigned', entity: 'beds', describe: (p) => `Assigned a bed for ${p}`, roles: ['physician', 'admin'] },
    { action: 'auth.login', entity: 'users', describe: () => 'Signed in', roles: ['physician', 'nurse', 'pharmacist', 'admin', 'care_coordinator'] },
  ];

  const staff = users.all.filter((u) => u.role !== 'patient');

  for (let i = 0; i < 200; i++) {
    const spec = pick(ACTIONS);
    const candidates = staff.filter((u) => spec.roles.includes(u.role));
    const actor = candidates.length ? pick(candidates) : pick(staff);
    const admission = pick(admissions.all);
    const patient = patients.all.find((p) => String(p._id) === String(admission.patientId));
    const label = patient
      ? `${patient.demographics.firstName} ${patient.demographics.lastName} (${patient.patientId})`
      : 'a patient';

    const hoursBack = randInt(1, 24 * 21);

    docs.push({
      timestamp: new Date(Date.now() - hoursBack * 3_600_000),
      userId: actor._id,
      userRole: actor.role,
      action: spec.action,
      entity: spec.entity,
      entityId: spec.entity === 'users' ? actor._id : admission._id,
      patientId: spec.entity === 'users' ? null : admission.patientId,
      details: {
        before: null,
        after: null,
        description: spec.describe(label),
      },
      ipAddress: `10.0.${randInt(1, 12)}.${randInt(2, 254)}`,
      userAgent:
        rand() > 0.5
          ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SafeDischarge/1.0'
          : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) SafeDischarge/1.0',
    });
  }

  await AuditLog.insertMany(docs);
  return docs.length;
}
