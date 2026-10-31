import mongoose from 'mongoose';
import { Admission } from '../models/Admission.js';
import { Appointment } from '../models/Appointment.js';
import { DischargePackage } from '../models/DischargePackage.js';
import { Medication } from '../models/Medication.js';
import { Patient } from '../models/Patient.js';
import { Vital } from '../models/Vital.js';
import { auditAgent } from '../middleware/audit.js';
import { emit, emitToRole, emitToUser } from '../config/socket.js';
import { age } from '../utils/helpers.js';
import { orchestrateDischarge } from './agentBridgeService.js';
import type { AgentContext, MedItem } from './localAgents.js';

/** Assembles everything the agents need from the database. */
export async function buildAgentContext(admissionId: string): Promise<AgentContext> {
  const admission = await Admission.findById(admissionId).lean();
  if (!admission) throw new Error('Admission not found');

  const [patient, medLists, vitals, appointments] = await Promise.all([
    Patient.findById(admission.patientId).lean(),
    Medication.find({ admissionId: admission._id }).lean(),
    Vital.find({ admissionId: admission._id }).sort({ timestamp: -1 }).limit(40).lean(),
    Appointment.find({
      patientId: admission.patientId,
      status: { $in: ['scheduled', 'confirmed'] },
    }).lean(),
  ]);
  if (!patient) throw new Error('Patient not found');

  const byType = (t: string): MedItem[] =>
    (medLists.find((m) => m.listType === t)?.medications ?? []).map((m: any) => ({
      drugName: m.drugName,
      genericName: m.genericName,
      drugClass: m.drugClass,
      dosage: m.dosage,
      frequency: m.frequency,
      route: m.route,
      isActive: m.isActive,
      notes: m.notes,
    }));

  const losDays = Math.max(
    1,
    Math.round((Date.now() - new Date(admission.admissionDate).getTime()) / 86_400_000)
  );

  return {
    patient: {
      fullName: `${patient.demographics.firstName} ${patient.demographics.lastName}`,
      age: age(patient.demographics.dateOfBirth),
      gender: patient.demographics.gender,
      preferredLanguage: patient.demographics.preferredLanguage || 'English',
      literacyLevel: (patient.demographics.literacyLevel ?? 'intermediate') as
        | 'basic'
        | 'intermediate'
        | 'advanced',
      allergies: (patient.medicalHistory?.allergies ?? []).map((a: any) => ({
        substance: a.substance,
        reaction: a.reaction,
        severity: a.severity,
      })),
      conditions: patient.medicalHistory?.conditions ?? [],
      pcpName: patient.primaryCarePhysician?.name,
    },
    admission: {
      admissionId: admission.admissionId,
      admittingDiagnosis: admission.admittingDiagnosis,
      diagnosisCodes: admission.diagnosisCodes ?? [],
      admissionDate: new Date(admission.admissionDate).toISOString(),
      lengthOfStayDays: losDays,
      ward: admission.bed?.ward ?? 'unknown ward',
      notes: (admission.clinicalNotes ?? []).map((n: any) => ({
        type: n.type,
        content: n.content,
        createdAt: new Date(n.createdAt).toISOString(),
      })),
      labs: (admission.labResults ?? []).map((l: any) => ({
        testName: l.testName,
        value: l.value,
        unit: l.unit,
        referenceRange: l.referenceRange,
        isAbnormal: l.isAbnormal,
      })),
      procedures: (admission.procedures ?? []).map((p: any) => ({
        name: p.name,
        date: new Date(p.date).toISOString(),
        notes: p.notes,
      })),
      riskAssessment: {
        fallRisk: admission.riskAssessment?.fallRisk ?? 'low',
        pressureInjuryRisk: admission.riskAssessment?.pressureInjuryRisk ?? 'low',
        infectionFlags: admission.riskAssessment?.infectionFlags ?? [],
      },
    },
    vitals: vitals.map((v: any) => ({
      timestamp: new Date(v.timestamp).toISOString(),
      bloodPressureSystolic: v.bloodPressureSystolic,
      bloodPressureDiastolic: v.bloodPressureDiastolic,
      heartRate: v.heartRate,
      temperature: v.temperature,
      respiratoryRate: v.respiratoryRate,
      oxygenSaturation: v.oxygenSaturation,
      painScore: v.painScore,
    })),
    medications: {
      preAdmission: byType('pre_admission'),
      inpatient: byType('inpatient'),
      discharge: byType('discharge'),
    },
    existingAppointments: appointments.map((a: any) => ({
      specialty: a.specialty ?? '',
      type: a.type,
      scheduledDate: new Date(a.scheduledDate).toISOString(),
    })),
  };
}

/**
 * Runs the agent DAG for a package and writes the results back. Designed to be
 * called without awaiting (fire-and-forget) from the initiate endpoint, with
 * progress streamed over Socket.IO.
 */
export async function processPackage(packageId: mongoose.Types.ObjectId | string): Promise<void> {
  const pkg = await DischargePackage.findById(packageId);
  if (!pkg) return;

  const room = `discharge:${pkg._id.toString()}`;
  const started = Date.now();

  const AGENT_LIST = [
    'clinical_summary',
    'med_reconciliation',
    'follow_up_planning',
    'patient_education',
    'safety_validator',
  ];

  try {
    pkg.status = 'agents_processing';
    pkg.agentRuns = AGENT_LIST.map((agent) => ({
      agent,
      status: 'queued' as const,
      startedAt: new Date(),
      finishedAt: undefined,
      durationMs: 0,
      confidence: 0,
    })) as never;
    await pkg.save();
    emit('discharge:status-update', { packageId: pkg._id, status: pkg.status }, room);
    emit('discharge:status-update', { packageId: pkg._id, status: pkg.status });

    const ctx = await buildAgentContext(String(pkg.admissionId));

    const result = await orchestrateDischarge(ctx, (agent, status) => {
      emit(
        'discharge:status-update',
        { packageId: pkg._id, agent, agentStatus: status, status: 'agents_processing' },
        room
      );
    });

    pkg.clinicalSummary.status = 'generated';
    pkg.clinicalSummary.content = result.clinicalSummary.content;
    pkg.clinicalSummary.agentConfidence = result.clinicalSummary.confidence;
    pkg.clinicalSummary.generatedAt = new Date();
    pkg.clinicalSummary.generator = result.clinicalSummary.generator;

    pkg.medicationReconciliation.status = 'generated';
    pkg.medicationReconciliation.preAdmissionMeds = ctx.medications.preAdmission as never;
    pkg.medicationReconciliation.inpatientMeds = ctx.medications.inpatient as never;
    pkg.medicationReconciliation.dischargeMeds = ctx.medications.discharge as never;
    pkg.medicationReconciliation.flags = result.medicationReconciliation.flags as never;
    pkg.medicationReconciliation.agentConfidence = result.medicationReconciliation.confidence;

    pkg.followUpPlan.status = 'generated';
    pkg.followUpPlan.recommendations = result.followUpPlan.recommendations as never;
    pkg.followUpPlan.agentConfidence = result.followUpPlan.confidence;

    pkg.patientEducation.status = 'generated';
    pkg.patientEducation.content = result.patientEducation.content;
    pkg.patientEducation.readingLevel = ctx.patient.literacyLevel;
    pkg.patientEducation.language = ctx.patient.preferredLanguage;
    pkg.patientEducation.agentConfidence = result.patientEducation.confidence;
    pkg.patientEducation.generatedAt = new Date();
    pkg.patientEducation.generator = result.patientEducation.generator;

    pkg.safetyValidation = {
      passed: result.safety.passed,
      checks: result.safety.checks,
      validatedAt: new Date(),
    } as never;

    pkg.agentRuns = result.runs as never;
    pkg.status = 'pending_review';
    await pkg.save();

    await auditAgent({
      agent: `orchestrator:${result.engine}`,
      action: 'agents.completed',
      entity: 'discharge_packages',
      entityId: pkg._id,
      patientId: pkg.patientId as never,
      description: `Agent DAG completed in ${Date.now() - started}ms. ${result.medicationReconciliation.flags.length} medication flag(s). Safety validation ${result.safety.passed ? 'passed' : 'FAILED'}.`,
      after: { flags: result.medicationReconciliation.flags.length, safety: result.safety.passed },
    });

    emit('discharge:status-update', { packageId: pkg._id, status: pkg.status }, room);
    emit('discharge:status-update', { packageId: pkg._id, status: pkg.status });

    // Critical medication alerts go straight to the attending physician.
    const criticals = result.medicationReconciliation.flags.filter(
      (f) => f.severity === 'critical'
    );
    if (criticals.length) {
      const admission = await Admission.findById(pkg.admissionId).lean();
      const payload = {
        packageId: pkg._id,
        patientId: pkg.patientId,
        count: criticals.length,
        flags: criticals.map((f) => ({
          drugA: f.drugA,
          drugB: f.drugB,
          description: f.description,
        })),
      };
      emitToRole('pharmacist', 'alert:critical-medication', payload);
      if (admission?.careTeam?.attendingPhysician) {
        emitToUser(
          String(admission.careTeam.attendingPhysician),
          'alert:critical-medication',
          payload
        );
      }
    }
  } catch (err) {
    console.error('[discharge] agent processing failed:', err);
    pkg.status = 'initiated';
    pkg.agentRuns = [
      ...(pkg.agentRuns ?? []),
      {
        agent: 'orchestrator',
        status: 'failed',
        startedAt: new Date(started),
        finishedAt: new Date(),
        durationMs: Date.now() - started,
        confidence: 0,
        error: (err as Error).message,
      },
    ] as never;
    await pkg.save().catch(() => {});
    await auditAgent({
      agent: 'orchestrator',
      action: 'agents.failed',
      entity: 'discharge_packages',
      entityId: pkg._id,
      patientId: pkg.patientId as never,
      description: `Agent processing failed: ${(err as Error).message}`,
    });
    emit(
      'discharge:status-update',
      { packageId: pkg._id, status: 'initiated', error: (err as Error).message },
      room
    );
  }
}

/** Approval rules — which role may sign off which section (Section 5). */
export const SECTION_APPROVERS: Record<string, string[]> = {
  clinicalSummary: ['physician'],
  medicationReconciliation: ['physician', 'pharmacist'],
  followUpPlan: ['physician', 'care_coordinator'],
  patientEducation: ['nurse', 'physician'],
};

export const REVIEWABLE_SECTIONS = Object.keys(SECTION_APPROVERS);

/** Human-readable names, because blockers are shown to clinicians verbatim. */
const SECTION_LABEL: Record<string, string> = {
  clinicalSummary: 'clinical summary',
  medicationReconciliation: 'medication reconciliation',
  followUpPlan: 'follow-up plan',
  patientEducation: 'patient instructions',
};

const STATUS_REASON: Record<string, string> = {
  pending: 'has not been drafted yet',
  generated: 'is still waiting for a signature',
  reviewed: 'was edited but not signed',
  rejected: 'was rejected and needs another pass',
};

const ROLE_LABEL: Record<string, string> = {
  physician: 'physician',
  pharmacist: 'pharmacist',
  nurse: 'nurse',
  care_coordinator: 'care coordinator',
};

const listRoles = (roles: string[]): string =>
  roles.map((r) => ROLE_LABEL[r] ?? r.replace('_', ' ')).join(' or ');

/** A package may complete only when every section is approved and no critical flag is open. */
export function completionBlockers(pkg: any): string[] {
  const blockers: string[] = [];

  for (const section of REVIEWABLE_SECTIONS) {
    const status = pkg[section]?.status;
    if (status === 'approved') continue;
    const name = SECTION_LABEL[section] ?? section;
    const reason = STATUS_REASON[status] ?? `is ${status}`;
    blockers.push(
      `The ${name} ${reason} — ${listRoles(SECTION_APPROVERS[section] ?? [])} must sign it.`
    );
  }

  const openCritical = (pkg.medicationReconciliation?.flags ?? []).filter(
    (f: any) => f.severity === 'critical' && f.resolution === 'pending'
  );
  if (openCritical.length) {
    blockers.push(
      openCritical.length === 1
        ? 'A critical medication flag is still unresolved.'
        : `${openCritical.length} critical medication flags are still unresolved.`
    );
  }

  const requiredRoles = ['physician', 'pharmacist'];
  const signed = new Set(
    (pkg.approvals ?? []).filter((a: any) => a.action === 'approved').map((a: any) => a.role)
  );
  for (const role of requiredRoles) {
    if (!signed.has(role)) {
      blockers.push(`No ${ROLE_LABEL[role]} has signed anything on this package yet.`);
    }
  }

  return blockers;
}
