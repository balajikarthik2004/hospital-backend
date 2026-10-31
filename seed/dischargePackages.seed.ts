import { DischargePackage } from '../src/models/DischargePackage.js';
import { Patient } from '../src/models/Patient.js';
import { Appointment } from '../src/models/Appointment.js';
import { ID_PREFIX } from '../src/utils/idGenerator.js';
import { processPackage } from '../src/services/dischargeService.js';
import type { SeededAdmissions } from './admissions.seed.js';
import type { SeededUsers } from './users.seed.js';

const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);

/**
 * Eight packages spread across the workflow, all produced by actually running
 * the agent pipeline — the seeded flags are whatever the rules engine really
 * finds, not canned text.
 */
const PLAN: {
  index: number;
  target: 'pending_review' | 'in_review' | 'approved' | 'completed' | 'agents_only';
  initiatedHoursAgo: number;
}[] = [
  { index: 0, target: 'pending_review', initiatedHoursAgo: 2 }, // Patient A — the showcase package
  { index: 1, target: 'in_review', initiatedHoursAgo: 5 }, // Patient B
  { index: 2, target: 'pending_review', initiatedHoursAgo: 1 }, // Patient C — critical allergy flag
  { index: 3, target: 'in_review', initiatedHoursAgo: 8 }, // Patient D
  { index: 4, target: 'approved', initiatedHoursAgo: 26 },
  { index: 5, target: 'completed', initiatedHoursAgo: 52 },
  { index: 6, target: 'completed', initiatedHoursAgo: 76 },
  { index: 7, target: 'pending_review', initiatedHoursAgo: 3 },
];

export async function seedDischargePackages(
  users: SeededUsers,
  admissions: SeededAdmissions
) {
  const day = new Date();
  const stamp = `${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, '0')}${String(day.getDate()).padStart(2, '0')}`;
  let counter = 0;
  const makeId = () => `${ID_PREFIX.discharge}-${stamp}-${String(++counter).padStart(4, '0')}`;

  const physician = users.physicians[0];
  const pharmacist = users.pharmacists[0];
  const nurse = users.nurses[0];

  const created: unknown[] = [];

  for (const step of PLAN) {
    const admission = admissions.active[step.index];
    if (!admission) continue;

    const pkg = await DischargePackage.create({
      packageId: makeId(),
      patientId: admission.patientId,
      admissionId: admission._id,
      initiatedBy: admission.careTeam.attendingPhysician ?? physician._id,
      initiatedAt: hoursAgo(step.initiatedHoursAgo),
      status: 'initiated',
    });

    await Patient.findByIdAndUpdate(admission.patientId, { status: 'discharge_pending' });

    // Run the real agent DAG.
    await processPackage(pkg._id);

    const fresh = await DischargePackage.findById(pkg._id);
    if (!fresh) continue;

    if (step.target === 'pending_review' || step.target === 'agents_only') {
      created.push(fresh);
      continue;
    }

    // ─── Partially reviewed ───
    const signAt = hoursAgo(step.initiatedHoursAgo - 1);

    const approve = (section: string, user: any, role: string, at: Date) => {
      const target = (fresh as any)[section];
      target.status = 'approved';
      target.reviewedBy = user._id;
      target.reviewedAt = at;
      fresh.approvals.push({
        role,
        userId: user._id,
        section,
        action: 'approved',
        comments: null,
        signature: `${user.firstName} ${user.lastName}`,
        timestamp: at,
      } as never);
    };

    if (step.target === 'in_review') {
      approve('clinicalSummary', physician, 'physician', signAt);
      fresh.status = 'in_review';
      await fresh.save();
      created.push(fresh);
      continue;
    }

    // approved / completed — resolve every flag first, as a pharmacist must.
    for (const flag of fresh.medicationReconciliation.flags as any[]) {
      flag.resolution = flag.severity === 'low' ? 'dismissed' : 'accepted';
      flag.resolvedBy = pharmacist._id;
      flag.resolvedAt = signAt;
      flag.resolvedNote =
        flag.severity === 'low'
          ? 'Reviewed with the prescriber; the change is intentional and documented.'
          : 'Recommendation accepted and the discharge prescription amended.';
    }
    fresh.markModified('medicationReconciliation.flags');

    approve('clinicalSummary', physician, 'physician', signAt);
    approve('medicationReconciliation', pharmacist, 'pharmacist', signAt);
    approve('followUpPlan', physician, 'physician', signAt);
    approve('patientEducation', nurse, 'nurse', signAt);
    fresh.status = 'approved';

    // Book the follow-ups so the compliance metric has something to measure.
    for (const rec of fresh.followUpPlan.recommendations as any[]) {
      if (rec.isScheduled) continue;
      const date = new Date();
      date.setDate(date.getDate() + (rec.dueInDays ?? 7));
      const appointment = await Appointment.create({
        appointmentId: `${ID_PREFIX.appointment}-${stamp}-9${String(++counter).padStart(3, '0')}`,
        patientId: fresh.patientId,
        doctorId: admission.careTeam.attendingPhysician ?? physician._id,
        admissionId: fresh.admissionId,
        type: rec.type === 'lab_work' ? 'lab_only' : rec.type === 'specialist' ? 'specialist' : 'follow_up',
        specialty: rec.specialty ?? '',
        scheduledDate: date,
        scheduledTime: '11:00',
        duration: 30,
        location: rec.specialty ? `${rec.specialty} Clinic` : 'Outpatient Clinic',
        reason: rec.description,
        status: 'scheduled',
        createdBy: physician._id,
      });
      rec.isScheduled = true;
      rec.appointmentId = appointment._id;
    }
    fresh.markModified('followUpPlan.recommendations');

    if (step.target === 'completed') {
      fresh.status = 'completed';
      fresh.completedAt = hoursAgo(Math.max(0, step.initiatedHoursAgo - 4));
    }

    await fresh.save();
    created.push(fresh);
  }

  return created;
}
