import type { Request, Response } from 'express';
import { DischargePackage } from '../models/DischargePackage.js';
import { auditAgent } from '../middleware/audit.js';
import { emit } from '../config/socket.js';
import { asyncHandler, badRequest, notFound } from '../utils/helpers.js';
import { buildAgentContext } from '../services/dischargeService.js';
import { agentServiceHealth } from '../services/agentBridgeService.js';
import {
  explainFlags,
  runClinicalSummaryAgent,
  runFollowUpPlanningAgent,
  runMedicationReconciliationAgent,
  runPatientEducationAgent,
  runSafetyValidator,
} from '../services/localAgents.js';
import { llm } from '../services/llmClient.js';
import { env } from '../config/env.js';

async function loadPackage(packageId: string) {
  const pkg = await DischargePackage.findById(packageId);
  if (!pkg) throw notFound('Discharge package');
  if (pkg.status === 'completed') throw badRequest('That discharge is already complete');
  return pkg;
}

function room(id: unknown) {
  return `discharge:${String(id)}`;
}

/** POST /api/agents/clinical-summary */
export const triggerClinicalSummary = asyncHandler(async (req: Request, res: Response) => {
  const pkg = await loadPackage(req.body.packageId);
  const ctx = await buildAgentContext(String(pkg.admissionId));

  emit('discharge:status-update', { packageId: pkg._id, agent: 'clinical_summary', agentStatus: 'running' }, room(pkg._id));
  const result = await runClinicalSummaryAgent(ctx);

  pkg.clinicalSummary.status = 'generated';
  pkg.clinicalSummary.content = result.content;
  pkg.clinicalSummary.agentConfidence = result.confidence;
  pkg.clinicalSummary.generatedAt = new Date();
  pkg.clinicalSummary.generator = result.generator;
  await pkg.save();

  await auditAgent({
    agent: 'clinical_summary',
    action: 'agent.generated',
    entity: 'discharge_packages',
    entityId: pkg._id,
    patientId: pkg.patientId as never,
    description: `Generated the clinical summary (confidence ${result.confidence}, generator ${result.generator})`,
  });

  emit('discharge:status-update', { packageId: pkg._id, agent: 'clinical_summary', agentStatus: 'complete' }, room(pkg._id));
  res.json({ clinicalSummary: pkg.clinicalSummary });
});

/** POST /api/agents/med-reconciliation */
export const triggerMedReconciliation = asyncHandler(async (req: Request, res: Response) => {
  const pkg = await loadPackage(req.body.packageId);
  const ctx = await buildAgentContext(String(pkg.admissionId));

  emit('discharge:status-update', { packageId: pkg._id, agent: 'med_reconciliation', agentStatus: 'running' }, room(pkg._id));
  const result = runMedicationReconciliationAgent(ctx);
  const flags = await explainFlags(result.flags, ctx);

  pkg.medicationReconciliation.status = 'generated';
  pkg.medicationReconciliation.preAdmissionMeds = ctx.medications.preAdmission as never;
  pkg.medicationReconciliation.inpatientMeds = ctx.medications.inpatient as never;
  pkg.medicationReconciliation.dischargeMeds = ctx.medications.discharge as never;
  pkg.medicationReconciliation.flags = flags as never;
  pkg.medicationReconciliation.agentConfidence = result.confidence;
  await pkg.save();

  await auditAgent({
    agent: 'med_reconciliation',
    action: 'agent.generated',
    entity: 'discharge_packages',
    entityId: pkg._id,
    patientId: pkg.patientId as never,
    description: `Reconciled medications and raised ${flags.length} flag(s)`,
  });

  emit('discharge:status-update', { packageId: pkg._id, agent: 'med_reconciliation', agentStatus: 'complete' }, room(pkg._id));
  res.json({ medicationReconciliation: pkg.medicationReconciliation });
});

/** POST /api/agents/follow-up-plan */
export const triggerFollowUpPlan = asyncHandler(async (req: Request, res: Response) => {
  const pkg = await loadPackage(req.body.packageId);
  const ctx = await buildAgentContext(String(pkg.admissionId));

  emit('discharge:status-update', { packageId: pkg._id, agent: 'follow_up_planning', agentStatus: 'running' }, room(pkg._id));
  const result = runFollowUpPlanningAgent(ctx);

  pkg.followUpPlan.status = 'generated';
  pkg.followUpPlan.recommendations = result.recommendations as never;
  pkg.followUpPlan.agentConfidence = result.confidence;
  await pkg.save();

  await auditAgent({
    agent: 'follow_up_planning',
    action: 'agent.generated',
    entity: 'discharge_packages',
    entityId: pkg._id,
    patientId: pkg.patientId as never,
    description: `Produced ${result.recommendations.length} follow-up recommendation(s)`,
  });

  emit('discharge:status-update', { packageId: pkg._id, agent: 'follow_up_planning', agentStatus: 'complete' }, room(pkg._id));
  res.json({ followUpPlan: pkg.followUpPlan });
});

/** POST /api/agents/patient-education */
export const triggerPatientEducation = asyncHandler(async (req: Request, res: Response) => {
  const pkg = await loadPackage(req.body.packageId);
  const ctx = await buildAgentContext(String(pkg.admissionId));

  emit('discharge:status-update', { packageId: pkg._id, agent: 'patient_education', agentStatus: 'running' }, room(pkg._id));
  const result = await runPatientEducationAgent(
    ctx,
    pkg.clinicalSummary.content,
    (pkg.followUpPlan.recommendations ?? []) as never
  );

  pkg.patientEducation.status = 'generated';
  pkg.patientEducation.content = result.content;
  pkg.patientEducation.agentConfidence = result.confidence;
  pkg.patientEducation.readingLevel = ctx.patient.literacyLevel;
  pkg.patientEducation.language = ctx.patient.preferredLanguage;
  pkg.patientEducation.generatedAt = new Date();
  pkg.patientEducation.generator = result.generator;
  await pkg.save();

  await auditAgent({
    agent: 'patient_education',
    action: 'agent.generated',
    entity: 'discharge_packages',
    entityId: pkg._id,
    patientId: pkg.patientId as never,
    description: `Generated patient instructions at ${ctx.patient.literacyLevel} reading level`,
  });

  emit('discharge:status-update', { packageId: pkg._id, agent: 'patient_education', agentStatus: 'complete' }, room(pkg._id));
  res.json({ patientEducation: pkg.patientEducation });
});

/** POST /api/agents/safety-check */
export const triggerSafetyCheck = asyncHandler(async (req: Request, res: Response) => {
  const pkg = await loadPackage(req.body.packageId);
  const ctx = await buildAgentContext(String(pkg.admissionId));

  const safety = runSafetyValidator({
    summary: {
      content: pkg.clinicalSummary.content,
      confidence: pkg.clinicalSummary.agentConfidence,
    },
    reconciliation: {
      flags: (pkg.medicationReconciliation.flags ?? []) as never,
      confidence: pkg.medicationReconciliation.agentConfidence,
    },
    followUp: {
      recommendations: (pkg.followUpPlan.recommendations ?? []) as never,
      confidence: pkg.followUpPlan.agentConfidence,
    },
    education: {
      content: pkg.patientEducation.content,
      confidence: pkg.patientEducation.agentConfidence,
    },
    dischargeMeds: ctx.medications.discharge,
    preAdmissionMeds: ctx.medications.preAdmission,
  });

  pkg.safetyValidation = { ...safety, validatedAt: new Date() } as never;
  if (safety.passed && pkg.status === 'agents_processing') pkg.status = 'pending_review';
  await pkg.save();

  await auditAgent({
    agent: 'safety_validator',
    action: 'agent.safety-check',
    entity: 'discharge_packages',
    entityId: pkg._id,
    patientId: pkg.patientId as never,
    description: `Safety validation ${safety.passed ? 'passed' : 'FAILED'}: ${safety.checks.filter((c) => !c.passed).map((c) => c.name).join(', ') || 'all checks passed'}`,
  });

  res.json({ safetyValidation: pkg.safetyValidation });
});

/** GET /api/agents/status/:packageId */
export const agentStatus = asyncHandler(async (req: Request, res: Response) => {
  const pkg = await DischargePackage.findById(req.params.packageId)
    .select('packageId status agentRuns safetyValidation')
    .lean();
  if (!pkg) throw notFound('Discharge package');

  res.json({
    packageId: pkg.packageId,
    status: pkg.status,
    agentRuns: pkg.agentRuns ?? [],
    safetyValidation: pkg.safetyValidation,
  });
});

/** GET /api/agents/health — which engine is actually driving the agents. */
export const agentHealth = asyncHandler(async (_req: Request, res: Response) => {
  const python = await agentServiceHealth();
  const engine = !python.online
    ? 'builtin'
    : python.engine === 'asyncio-fallback'
      ? 'python-asyncio'
      : 'python-langgraph';
  res.json({
    engine,
    pythonService: {
      url: env.AGENT_SERVICE_URL,
      online: python.online,
      // What the service reports it is running, so a LangGraph install that
      // silently failed to import shows up here instead of being claimed.
      engine: python.engine ?? null,
    },
    llm: {
      configured: llm.available,
      model: llm.available ? env.ANTHROPIC_MODEL : null,
      note: llm.available
        ? 'Claude generates the clinical summary and patient instructions.'
        : 'No ANTHROPIC_API_KEY set — summary and education fall back to deterministic templates. Reconciliation and follow-up planning are rules-based either way.',
    },
    agents: [
      { name: 'Clinical Summary', key: 'clinical_summary', type: llm.available ? 'llm' : 'template', color: '#0891B2' },
      { name: 'Medication Reconciliation', key: 'med_reconciliation', type: 'rules', color: '#7C3AED' },
      { name: 'Follow-Up Planning', key: 'follow_up_planning', type: 'rules', color: '#059669' },
      { name: 'Patient Education', key: 'patient_education', type: llm.available ? 'llm' : 'template', color: '#D97706' },
      { name: 'Safety / Governance', key: 'safety_validator', type: 'rules', color: '#6366F1' },
    ],
  });
});
