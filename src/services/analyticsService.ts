import { Admission } from '../models/Admission.js';
import { Bed } from '../models/Bed.js';
import { DischargePackage } from '../models/DischargePackage.js';
import { Appointment } from '../models/Appointment.js';
import { Patient } from '../models/Patient.js';

const DAY = 86_400_000;

export async function kpiSummary() {
  const [beds, activeAdmissions, packages, patients, appointments] = await Promise.all([
    Bed.find().lean(),
    Admission.countDocuments({ status: 'active' }),
    DischargePackage.find().lean(),
    Patient.countDocuments(),
    Appointment.find().lean(),
  ]);

  const occupied = beds.filter((b) => b.status === 'occupied').length;
  const bedOccupancy = beds.length ? Math.round((occupied / beds.length) * 1000) / 10 : 0;

  const completed = packages.filter((p) => p.completedAt);
  const prepTimes = completed.map(
    (p) => (new Date(p.completedAt!).getTime() - new Date(p.initiatedAt).getTime()) / 3_600_000
  );
  const avgPrepHours = prepTimes.length
    ? Math.round((prepTimes.reduce((a, b) => a + b, 0) / prepTimes.length) * 10) / 10
    : 0;

  const allFlags = packages.flatMap((p) => p.medicationReconciliation?.flags ?? []);
  const resolved = allFlags.filter((f) => f.resolution !== 'pending');
  const dismissed = resolved.filter((f) => f.resolution === 'dismissed');

  const readmission = await readmissionRate();

  const futureAppts = appointments.filter(
    (a) => new Date(a.scheduledDate).getTime() > Date.now() - 90 * DAY
  );
  const kept = futureAppts.filter((a) => a.status === 'completed' || a.status === 'confirmed');
  const complianceRate = futureAppts.length
    ? Math.round((kept.length / futureAppts.length) * 1000) / 10
    : 0;

  return {
    bedOccupancyPct: bedOccupancy,
    bedsTotal: beds.length,
    bedsOccupied: occupied,
    bedsAvailable: beds.filter((b) => b.status === 'available').length,
    activeAdmissions,
    totalPatients: patients,
    dischargePackages: packages.length,
    packagesPendingReview: packages.filter((p) =>
      ['pending_review', 'in_review'].includes(p.status)
    ).length,
    packagesCompleted: completed.length,
    avgPrepHours,
    /** Manual baseline from the pilot: ~3.2 h of clinician time per discharge. */
    baselinePrepHours: 3.2,
    timeSavedPct: avgPrepHours
      ? Math.max(0, Math.round((1 - avgPrepHours / 3.2) * 1000) / 10)
      : 0,
    flagsRaised: allFlags.length,
    flagsCritical: allFlags.filter((f) => f.severity === 'critical').length,
    flagsResolved: resolved.length,
    falsePositiveRatePct: resolved.length
      ? Math.round((dismissed.length / resolved.length) * 1000) / 10
      : 0,
    readmissionRatePct: readmission.overallPct,
    followUpComplianceRatePct: complianceRate,
  };
}

export async function dischargeVolume(days = 30) {
  const since = new Date(Date.now() - days * DAY);
  const admissions = await Admission.find({
    $or: [{ admissionDate: { $gte: since } }, { actualDischargeDate: { $gte: since } }],
  }).lean();
  const packages = await DischargePackage.find({ initiatedAt: { $gte: since } }).lean();

  const buckets = new Map<string, { date: string; admissions: number; discharges: number; aiPackages: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY).toISOString().slice(0, 10);
    buckets.set(d, { date: d, admissions: 0, discharges: 0, aiPackages: 0 });
  }
  const bump = (date: Date | null | undefined, key: 'admissions' | 'discharges' | 'aiPackages') => {
    if (!date) return;
    const k = new Date(date).toISOString().slice(0, 10);
    const b = buckets.get(k);
    if (b) b[key] += 1;
  };

  admissions.forEach((a) => {
    bump(a.admissionDate, 'admissions');
    bump(a.actualDischargeDate, 'discharges');
  });
  packages.forEach((p) => bump(p.initiatedAt, 'aiPackages'));

  return [...buckets.values()];
}

export async function agentPerformance() {
  const packages = await DischargePackage.find().lean();

  const sections = [
    { key: 'clinicalSummary', agent: 'Clinical Summary', color: '#0891B2' },
    { key: 'medicationReconciliation', agent: 'Medication Reconciliation', color: '#7C3AED' },
    { key: 'followUpPlan', agent: 'Follow-Up Planning', color: '#059669' },
    { key: 'patientEducation', agent: 'Patient Education', color: '#D97706' },
  ] as const;

  const perAgent = sections.map(({ key, agent, color }) => {
    const withSection = packages.filter((p: any) => p[key]?.status && p[key].status !== 'pending');
    const approvals = packages.flatMap((p: any) =>
      (p.approvals ?? []).filter((a: any) => a.section === key)
    );
    const approved = approvals.filter((a) => a.action === 'approved').length;
    const edited = approvals.filter((a) => a.action === 'edited').length;
    const rejected = approvals.filter((a) => a.action === 'rejected').length;
    const total = approved + edited + rejected;

    const confidences = withSection
      .map((p: any) => p[key]?.agentConfidence ?? 0)
      .filter((c: number) => c > 0);

    const runs = packages.flatMap((p: any) =>
      (p.agentRuns ?? []).filter((r: any) => r.agent === agentKeyFor(key))
    );
    const durations = runs.map((r: any) => r.durationMs ?? 0).filter(Boolean);

    return {
      agent,
      color,
      runs: withSection.length,
      avgConfidence: avg(confidences),
      acceptedPct: total ? pct(approved / total) : 0,
      editedPct: total ? pct(edited / total) : 0,
      rejectedPct: total ? pct(rejected / total) : 0,
      overridePct: total ? pct((edited + rejected) / total) : 0,
      avgDurationMs: Math.round(avg(durations) * 1000),
    };
  });

  const allFlags = packages.flatMap((p: any) => p.medicationReconciliation?.flags ?? []);
  const severityDistribution = (['critical', 'high', 'medium', 'low'] as const).map((severity) => ({
    severity,
    total: allFlags.filter((f: any) => f.severity === severity).length,
    accepted: allFlags.filter((f: any) => f.severity === severity && f.resolution === 'accepted').length,
    modified: allFlags.filter((f: any) => f.severity === severity && f.resolution === 'modified').length,
    dismissed: allFlags.filter((f: any) => f.severity === severity && f.resolution === 'dismissed').length,
    pending: allFlags.filter((f: any) => f.severity === severity && f.resolution === 'pending').length,
  }));

  const typeDistribution = Object.entries(
    allFlags.reduce((acc: Record<string, number>, f: any) => {
      acc[f.type] = (acc[f.type] ?? 0) + 1;
      return acc;
    }, {})
  ).map(([type, count]) => ({ type, count: count as number }));

  const completionTimes = packages
    .filter((p) => p.completedAt)
    .map((p) =>
      Math.round((new Date(p.completedAt!).getTime() - new Date(p.initiatedAt).getTime()) / 3_600_000)
    );

  const histogram = [
    { bucket: '0-2 h', count: completionTimes.filter((h) => h < 2).length },
    { bucket: '2-4 h', count: completionTimes.filter((h) => h >= 2 && h < 4).length },
    { bucket: '4-8 h', count: completionTimes.filter((h) => h >= 4 && h < 8).length },
    { bucket: '8-24 h', count: completionTimes.filter((h) => h >= 8 && h < 24).length },
    { bucket: '24 h+', count: completionTimes.filter((h) => h >= 24).length },
  ];

  const resolved = allFlags.filter((f: any) => f.resolution !== 'pending');
  const dismissed = resolved.filter((f: any) => f.resolution === 'dismissed');

  return {
    perAgent,
    severityDistribution,
    typeDistribution,
    completionHistogram: histogram,
    detectionRatePct: packages.length
      ? pct(packages.filter((p: any) => (p.medicationReconciliation?.flags ?? []).length > 0).length / packages.length)
      : 0,
    falsePositiveRatePct: resolved.length ? pct(dismissed.length / resolved.length) : 0,
  };
}

function agentKeyFor(section: string): string {
  return (
    {
      clinicalSummary: 'clinical_summary',
      medicationReconciliation: 'med_reconciliation',
      followUpPlan: 'follow_up_planning',
      patientEducation: 'patient_education',
    } as Record<string, string>
  )[section] ?? section;
}

export async function readmissionRate(months = 6) {
  const admissions = await Admission.find({ status: 'discharged' })
    .sort({ actualDischargeDate: 1 })
    .lean();

  const byPatient = new Map<string, Date[]>();
  for (const a of admissions) {
    if (!a.actualDischargeDate) continue;
    const key = String(a.patientId);
    byPatient.set(key, [...(byPatient.get(key) ?? []), new Date(a.actualDischargeDate)]);
  }

  const allAdmissions = await Admission.find().sort({ admissionDate: 1 }).lean();
  let readmits = 0;
  let eligible = 0;
  const monthly = new Map<string, { month: string; discharges: number; readmissions: number }>();

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = d.toISOString().slice(0, 7);
    monthly.set(key, { month: key, discharges: 0, readmissions: 0 });
  }

  for (const discharged of admissions) {
    if (!discharged.actualDischargeDate) continue;
    eligible += 1;
    const monthKey = new Date(discharged.actualDischargeDate).toISOString().slice(0, 7);
    const bucket = monthly.get(monthKey);
    if (bucket) bucket.discharges += 1;

    const next = allAdmissions.find(
      (a) =>
        String(a.patientId) === String(discharged.patientId) &&
        new Date(a.admissionDate) > new Date(discharged.actualDischargeDate!) &&
        new Date(a.admissionDate).getTime() - new Date(discharged.actualDischargeDate!).getTime() <=
          30 * DAY
    );
    if (next) {
      readmits += 1;
      if (bucket) bucket.readmissions += 1;
    }
  }

  return {
    overallPct: eligible ? pct(readmits / eligible) : 0,
    eligibleDischarges: eligible,
    readmissions: readmits,
    trend: [...monthly.values()].map((m) => ({
      ...m,
      ratePct: m.discharges ? pct(m.readmissions / m.discharges) : 0,
    })),
  };
}

export async function bedOccupancy() {
  const beds = await Bed.find().lean();
  const wards = [...new Set(beds.map((b) => b.ward))];
  return wards.map((ward) => {
    const inWard = beds.filter((b) => b.ward === ward);
    const occupied = inWard.filter((b) => b.status === 'occupied').length;
    return {
      ward,
      total: inWard.length,
      occupied,
      available: inWard.filter((b) => b.status === 'available').length,
      maintenance: inWard.filter((b) => b.status === 'maintenance').length,
      reserved: inWard.filter((b) => b.status === 'reserved').length,
      occupancyPct: inWard.length ? pct(occupied / inWard.length) : 0,
    };
  });
}

export async function dischargeFunnel() {
  const packages = await DischargePackage.find().lean();
  const count = (...statuses: string[]) =>
    packages.filter((p) => statuses.includes(p.status)).length;

  return [
    { stage: 'Initiated', count: packages.length },
    {
      stage: 'Agents processed',
      count: count('agents_processing', 'pending_review', 'in_review', 'approved', 'completed'),
    },
    { stage: 'In review', count: count('pending_review', 'in_review', 'approved', 'completed') },
    { stage: 'Approved', count: count('approved', 'completed') },
    { stage: 'Completed', count: count('completed') },
  ];
}

export async function staffWorkload() {
  const admissions = await Admission.find({ status: 'active' })
    .populate('careTeam.attendingPhysician', 'firstName lastName role')
    .lean();

  const map = new Map<string, { name: string; patients: number }>();
  for (const a of admissions) {
    const doc = a.careTeam?.attendingPhysician as any;
    if (!doc?._id) continue;
    const key = String(doc._id);
    const entry = map.get(key) ?? { name: `Dr. ${doc.firstName} ${doc.lastName}`, patients: 0 };
    entry.patients += 1;
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => b.patients - a.patients);
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x: number) => Math.round(x * 1000) / 10;
