/**
 * Builds the full synthetic demo dataset. Assumes a live Mongoose connection.
 *
 * Called two ways:
 *   - `npm run seed` (seed/index.ts) — explicit, from the CLI
 *   - automatically by the API server when it starts against an empty database
 *
 * All data is fictional. No real patient information is used anywhere.
 */
import { AuditLog } from '../src/models/AuditLog.js';
import { Admission } from '../src/models/Admission.js';
import { Appointment } from '../src/models/Appointment.js';
import { Bed } from '../src/models/Bed.js';
import { DischargePackage } from '../src/models/DischargePackage.js';
import { Medication } from '../src/models/Medication.js';
import { Patient } from '../src/models/Patient.js';
import { Specialty } from '../src/models/Specialty.js';
import { User } from '../src/models/User.js';
import { Vital } from '../src/models/Vital.js';

import { seedSpecialties } from './specialties.seed.js';
import { seedUsers } from './users.seed.js';
import { seedPatients } from './patients.seed.js';
import { seedBeds } from './beds.seed.js';
import { seedAdmissions } from './admissions.seed.js';
import { seedMedications } from './medications.seed.js';
import { seedVitals } from './vitals.seed.js';
import { seedAppointments } from './appointments.seed.js';
import { seedDischargePackages } from './dischargePackages.seed.js';
import { seedAuditLogs } from './auditLogs.seed.js';

export interface SeedStats {
  specialties: number;
  users: number;
  patients: number;
  beds: number;
  admissions: number;
  activeAdmissions: number;
  medicationLists: number;
  vitals: number;
  appointments: number;
  dischargePackages: number;
  auditEntries: number;
  flags: Record<'critical' | 'high' | 'medium' | 'low', number>;
}

export async function seedDatabase(
  onStep: (n: number, label: string) => void = () => {}
): Promise<SeedStats> {
  await Promise.all([
    User.deleteMany({}),
    Patient.deleteMany({}),
    Admission.deleteMany({}),
    Medication.deleteMany({}),
    Vital.deleteMany({}),
    Appointment.deleteMany({}),
    Bed.deleteMany({}),
    DischargePackage.deleteMany({}),
    AuditLog.deleteMany({}),
    Specialty.deleteMany({}),
  ]);

  // Departments come first: doctor profiles reference them by slug, and the
  // public website is a dead end without them.
  onStep(1, 'specialties');
  const specialties = await seedSpecialties();

  onStep(2, 'users');
  const users = await seedUsers();

  onStep(3, 'patients');
  const patients = await seedPatients();

  // Link the patient-portal logins to their charts.
  const demoKeys = ['A', 'B', 'C', 'D'] as const;
  for (let i = 0; i < demoKeys.length; i++) {
    const login = users.patientLogins[i];
    if (!login) continue;
    login.patientRef = patients.demo[demoKeys[i]]._id;
    await login.save();
  }
  // The fifth portal login belongs to a ward patient rather than one of the
  // four scripted demos. Look it up by the login's own name instead of a
  // literal: hard-coding the name silently broke this link every time the
  // seed data was renamed, leaving that account with no chart to show.
  const fifth = users.patientLogins[4];
  if (fifth) {
    const match = patients.byName.get(`${fifth.firstName} ${fifth.lastName}`);
    if (match) {
      fifth.patientRef = match._id;
      await fifth.save();
    } else {
      console.warn(
        `[seed] no patient record named "${fifth.firstName} ${fifth.lastName}" — ` +
          `${fifth.email} will have no chart`
      );
    }
  }

  onStep(4, 'beds');
  const beds = await seedBeds();

  onStep(5, 'admissions');
  const admissions = await seedAdmissions(users, patients);

  onStep(6, 'medication lists (including the scripted discrepancies)');
  const medications = await seedMedications(users, admissions);

  onStep(7, 'vitals');
  const vitalCount = await seedVitals(users, admissions);

  onStep(8, 'appointments');
  await seedAppointments(users, patients);

  onStep(9, 'discharge packages — running the real agent pipeline');
  const packages = await seedDischargePackages(users, admissions);

  onStep(10, 'audit log history');
  await seedAuditLogs(users, patients, admissions);

  const flagTotals = await DischargePackage.aggregate<{ _id: string; count: number }>([
    { $unwind: '$medicationReconciliation.flags' },
    { $group: { _id: '$medicationReconciliation.flags.severity', count: { $sum: 1 } } },
  ]);
  const flagCount = (sev: string) => flagTotals.find((f) => f._id === sev)?.count ?? 0;

  return {
    specialties: specialties.specialties.length,
    users: users.all.length,
    patients: patients.all.length,
    beds: beds.length,
    admissions: admissions.all.length,
    activeAdmissions: admissions.active.length,
    medicationLists: medications.length,
    vitals: vitalCount,
    appointments: await Appointment.estimatedDocumentCount(),
    dischargePackages: packages.length,
    auditEntries: await AuditLog.estimatedDocumentCount(),
    flags: {
      critical: flagCount('critical'),
      high: flagCount('high'),
      medium: flagCount('medium'),
      low: flagCount('low'),
    },
  };
}
