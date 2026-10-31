import type { Request, Response } from 'express';
import { Admission } from '../models/Admission.js';
import { Appointment } from '../models/Appointment.js';
import { Bed } from '../models/Bed.js';
import { DischargePackage } from '../models/DischargePackage.js';
import { Patient } from '../models/Patient.js';
import { Vital } from '../models/Vital.js';
import { asyncHandler } from '../utils/helpers.js';
import {
  bedOccupancy,
  dischargeFunnel,
  dischargeVolume,
  kpiSummary,
  agentPerformance,
  staffWorkload,
} from '../services/analyticsService.js';

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
const endOfToday = () => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
};

/** GET /api/dashboard — the payload is shaped by the caller's role. */
export const getDashboard = asyncHandler(async (req: Request, res: Response) => {
  const role = req.user!.role;
  const userId = req.user!.id;

  switch (role) {
    case 'physician':
      return res.json({ role, ...(await physicianDashboard(userId)) });
    case 'nurse':
      return res.json({ role, ...(await nurseDashboard(userId)) });
    case 'pharmacist':
      return res.json({ role, ...(await pharmacistDashboard()) });
    case 'care_coordinator':
      return res.json({ role, ...(await coordinatorDashboard()) });
    case 'patient':
      return res.json({ role, ...(await patientDashboard(req.user!.patientRef ?? '')) });
    default:
      return res.json({ role, ...(await adminDashboard()) });
  }
});

async function physicianDashboard(userId: string) {
  const [admissions, packages, appointments, volume] = await Promise.all([
    Admission.find({ 'careTeam.attendingPhysician': userId, status: 'active' })
      .populate('patientId', 'patientId demographics status')
      .sort('-admissionDate')
      .lean(),
    DischargePackage.find({ status: { $in: ['pending_review', 'in_review', 'agents_processing'] } })
      .populate('patientId', 'patientId demographics')
      .populate('admissionId', 'admissionId admittingDiagnosis')
      .sort('-initiatedAt')
      .lean(),
    Appointment.find({
      doctorId: userId,
      scheduledDate: { $gte: startOfToday() },
      status: { $in: ['scheduled', 'confirmed'] },
    })
      .populate('patientId', 'patientId demographics')
      .sort('scheduledDate scheduledTime')
      .limit(10)
      .lean(),
    dischargeVolume(14),
  ]);

  const myPatientIds = admissions.map((a) => String(a.patientId?._id ?? a.patientId));
  const myPackages = packages.filter((p) =>
    myPatientIds.includes(String((p.patientId as any)?._id ?? p.patientId))
  );

  const criticalAlerts = packages.flatMap((p) =>
    (p.medicationReconciliation?.flags ?? [])
      .filter((f: any) => f.severity === 'critical' && f.resolution === 'pending')
      .map((f: any) => ({
        packageId: p._id,
        packageRef: p.packageId,
        patient: (p.patientId as any)?.demographics
          ? `${(p.patientId as any).demographics.firstName} ${(p.patientId as any).demographics.lastName}`
          : 'Unknown',
        drugA: f.drugA,
        drugB: f.drugB,
        description: f.description,
      }))
  );

  return {
    activePatients: admissions,
    pendingReviews: myPackages.length,
    allPendingReviews: packages.length,
    pendingPackages: packages.slice(0, 8),
    criticalAlerts,
    upcomingAppointments: appointments,
    admissionsDischargesSeries: volume,
  };
}

async function nurseDashboard(userId: string) {
  const admissions = await Admission.find({ status: 'active' })
    .populate('patientId', 'patientId demographics status')
    .lean();

  const myAdmissions = admissions.filter((a) =>
    (a.careTeam?.nurses ?? []).some((n) => String(n) === userId)
  );
  const scope = myAdmissions.length ? myAdmissions : admissions;

  const latestVitals = await Vital.aggregate([
    { $match: { admissionId: { $in: scope.map((a) => a._id) } } },
    { $sort: { timestamp: -1 } },
    { $group: { _id: '$admissionId', timestamp: { $first: '$timestamp' } } },
  ]);
  const lastByAdmission = new Map(latestVitals.map((v) => [String(v._id), v.timestamp as Date]));

  const FOUR_HOURS = 4 * 3600 * 1000;
  const vitalsDue = scope
    .map((a) => {
      const last = lastByAdmission.get(String(a._id));
      const overdueMs = last ? Date.now() - new Date(last).getTime() : Infinity;
      return {
        admissionId: a._id,
        patient: a.patientId,
        ward: a.bed?.ward ?? '',
        room: `${a.bed?.roomNumber ?? ''}-${a.bed?.bedNumber ?? ''}`,
        lastRecorded: last ?? null,
        hoursSince: last ? Math.round((overdueMs / 3600_000) * 10) / 10 : null,
        overdue: overdueMs > FOUR_HOURS,
      };
    })
    .sort((a, b) => (b.hoursSince ?? 999) - (a.hoursSince ?? 999));

  const wards = [...new Set(scope.map((a) => a.bed?.ward).filter(Boolean))] as string[];
  const beds = await Bed.find(wards.length ? { ward: { $in: wards } } : {})
    .populate('currentPatientId', 'patientId demographics')
    .sort('ward roomNumber bedNumber')
    .lean();

  const educationReviews = await DischargePackage.find({
    'patientEducation.status': 'generated',
    status: { $in: ['pending_review', 'in_review'] },
  })
    .populate('patientId', 'patientId demographics')
    .lean();

  const todaysAdmissions = await Admission.find({
    admissionDate: { $gte: startOfToday(), $lte: endOfToday() },
  })
    .populate('patientId', 'patientId demographics')
    .lean();

  return {
    vitalsDue,
    vitalsOverdueCount: vitalsDue.filter((v) => v.overdue).length,
    wardBeds: beds,
    wards,
    pendingEducationReviews: educationReviews,
    todaysAdmissions,
    myPatientCount: scope.length,
  };
}

async function pharmacistDashboard() {
  const packages = await DischargePackage.find({
    status: { $in: ['pending_review', 'in_review', 'agents_processing'] },
  })
    .populate('patientId', 'patientId demographics')
    .populate('admissionId', 'admissionId admittingDiagnosis')
    .sort('-initiatedAt')
    .lean();

  const flags = packages.flatMap((p) =>
    (p.medicationReconciliation?.flags ?? []).map((f: any) => ({
      ...f,
      packageId: p._id,
      packageRef: p.packageId,
      patient: (p.patientId as any)?.demographics
        ? `${(p.patientId as any).demographics.firstName} ${(p.patientId as any).demographics.lastName}`
        : 'Unknown',
    }))
  );

  const order = { critical: 0, high: 1, medium: 2, low: 3 } as Record<string, number>;

  return {
    queue: packages.filter((p) => p.medicationReconciliation?.status === 'generated'),
    openFlags: flags
      .filter((f) => f.resolution === 'pending')
      .sort((a, b) => order[a.severity] - order[b.severity]),
    flagCounts: {
      critical: flags.filter((f) => f.severity === 'critical' && f.resolution === 'pending').length,
      high: flags.filter((f) => f.severity === 'high' && f.resolution === 'pending').length,
      medium: flags.filter((f) => f.severity === 'medium' && f.resolution === 'pending').length,
      low: flags.filter((f) => f.severity === 'low' && f.resolution === 'pending').length,
    },
    resolvedToday: flags.filter(
      (f) => f.resolvedAt && new Date(f.resolvedAt) >= startOfToday()
    ).length,
  };
}

async function coordinatorDashboard() {
  const packages = await DischargePackage.find({
    status: { $in: ['pending_review', 'in_review', 'approved'] },
  })
    .populate('patientId', 'patientId demographics')
    .lean();

  const unscheduled = packages.flatMap((p) =>
    (p.followUpPlan?.recommendations ?? [])
      .filter((r: any) => !r.isScheduled)
      .map((r: any) => ({
        packageId: p._id,
        packageRef: p.packageId,
        recommendationId: r._id,
        patient: (p.patientId as any)?.demographics
          ? `${(p.patientId as any).demographics.firstName} ${(p.patientId as any).demographics.lastName}`
          : 'Unknown',
        patientId: (p.patientId as any)?._id,
        type: r.type,
        specialty: r.specialty,
        description: r.description,
        timeframe: r.timeframe,
        priority: r.priority,
        dueInDays: r.dueInDays,
      }))
  );

  const upcoming = await Appointment.find({
    scheduledDate: { $gte: startOfToday() },
    status: { $in: ['scheduled', 'confirmed'] },
  })
    .populate('patientId', 'patientId demographics')
    .populate('doctorId', 'firstName lastName specialization')
    .sort('scheduledDate scheduledTime')
    .limit(20)
    .lean();

  const priorityRank: Record<string, number> = { required: 0, recommended: 1, optional: 2 };

  return {
    unscheduledFollowUps: unscheduled.sort(
      (a, b) => (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9)
    ),
    requiredUnscheduled: unscheduled.filter((r) => r.priority === 'required').length,
    upcomingAppointments: upcoming,
    activePackages: packages.length,
  };
}

async function adminDashboard() {
  const [kpis, funnel, occupancy, agents, workload, volume] = await Promise.all([
    kpiSummary(),
    dischargeFunnel(),
    bedOccupancy(),
    agentPerformance(),
    staffWorkload(),
    dischargeVolume(30),
  ]);

  return {
    kpis,
    funnel,
    wardOccupancy: occupancy,
    agentPerformance: agents.perAgent,
    staffWorkload: workload,
    volumeSeries: volume,
  };
}

async function patientDashboard(patientRef: string) {
  if (!patientRef) return { patient: null, appointments: [], dischargePackage: null };

  const [patient, appointments, pkg, admission] = await Promise.all([
    Patient.findById(patientRef).lean(),
    Appointment.find({ patientId: patientRef, scheduledDate: { $gte: startOfToday() } })
      .populate('doctorId', 'firstName lastName specialization')
      .sort('scheduledDate scheduledTime')
      .lean(),
    DischargePackage.findOne({ patientId: patientRef }).sort('-initiatedAt').lean(),
    Admission.findOne({ patientId: patientRef, status: 'active' })
      .populate('careTeam.attendingPhysician', 'firstName lastName specialization')
      .lean(),
  ]);

  return {
    patient,
    admission,
    appointments,
    // Patients only ever see approved instructions.
    instructions:
      pkg?.patientEducation?.status === 'approved' ? pkg.patientEducation.content : null,
    dischargeStatus: pkg?.status ?? null,
  };
}
