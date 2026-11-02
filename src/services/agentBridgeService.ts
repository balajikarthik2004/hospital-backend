import {
  explainFlags,
  runClinicalSummaryAgent,
  runFollowUpPlanningAgent,
  runMedicationReconciliationAgent,
  runPatientEducationAgent,
  runSafetyValidator,
  type AgentContext,
  type Flag,
  type FollowUpRecommendation,
  type SafetyCheck,
} from './localAgents.js';

/** The discharge DAG runs in-process. There is no remote engine. */
export type AgentEngine = 'builtin';

export interface OrchestrationResult {
  engine: AgentEngine;
  clinicalSummary: { content: string; confidence: number; generator: string };
  medicationReconciliation: { flags: Flag[]; confidence: number };
  followUpPlan: { recommendations: FollowUpRecommendation[]; confidence: number };
  patientEducation: { content: string; confidence: number; generator: string };
  safety: { passed: boolean; checks: SafetyCheck[] };
  runs: AgentRun[];
}

export interface AgentRun {
  agent: string;
  status: 'complete' | 'failed';
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  confidence: number;
  error?: string;
}

type Progress = (agent: string, status: 'running' | 'complete' | 'failed', extra?: unknown) => void;

/**
 * Runs the discharge DAG in-process.
 *
 * This used to try a Python sidecar first and fall back here. The sidecar is
 * gone, and with it the remote path, the health probes and the engine
 * negotiation — the built-in orchestrator below already ran the identical
 * DAG every time the sidecar was unavailable, so this is the same pipeline
 * clinicians were already getting, now as the only path.
 */
export async function orchestrateDischarge(
  ctx: AgentContext,
  onProgress: Progress = () => {}
): Promise<OrchestrationResult> {
  return runLocal(ctx, onProgress);
}

/**
 * The DAG from Section 8.1, executed in-process:
 *   clinical_summary  ─┐
 *   med_reconciliation ┴─► follow_up_planning ─► patient_education ─► safety
 * The first two have no dependency on each other and run concurrently.
 */
async function runLocal(ctx: AgentContext, onProgress: Progress): Promise<OrchestrationResult> {
  const runs: AgentRun[] = [];

  const track = async <T extends { confidence: number }>(
    agent: string,
    fn: () => Promise<T> | T
  ): Promise<T> => {
    const startedAt = new Date();
    onProgress(agent, 'running');
    try {
      const result = await fn();
      const finishedAt = new Date();
      runs.push({
        agent,
        status: 'complete',
        startedAt,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        confidence: result.confidence,
      });
      onProgress(agent, 'complete', result);
      return result;
    } catch (err) {
      const finishedAt = new Date();
      runs.push({
        agent,
        status: 'failed',
        startedAt,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        confidence: 0,
        error: (err as Error).message,
      });
      onProgress(agent, 'failed', err);
      throw err;
    }
  };

  // Parallel branch 1 + 2
  const [clinicalSummary, medicationReconciliation] = await Promise.all([
    track('clinical_summary', () => runClinicalSummaryAgent(ctx)),
    track('med_reconciliation', async () => {
      const result = runMedicationReconciliationAgent(ctx);
      return { ...result, flags: await explainFlags(result.flags, ctx) };
    }),
  ]);

  // Joins both branches
  const followUpPlan = await track('follow_up_planning', () => runFollowUpPlanningAgent(ctx));

  // Needs the summary and the reconciled medication list
  const patientEducation = await track('patient_education', () =>
    runPatientEducationAgent(ctx, clinicalSummary.content, followUpPlan.recommendations)
  );

  const safetyStart = new Date();
  onProgress('safety_validator', 'running');
  const safety = runSafetyValidator({
    summary: clinicalSummary,
    reconciliation: medicationReconciliation,
    followUp: followUpPlan,
    education: patientEducation,
    dischargeMeds: ctx.medications.discharge,
    preAdmissionMeds: ctx.medications.preAdmission,
  });
  const safetyEnd = new Date();
  runs.push({
    agent: 'safety_validator',
    status: 'complete',
    startedAt: safetyStart,
    finishedAt: safetyEnd,
    durationMs: safetyEnd.getTime() - safetyStart.getTime(),
    confidence: safety.passed ? 1 : 0,
  });
  onProgress('safety_validator', 'complete', safety);

  return {
    engine: 'builtin',
    clinicalSummary,
    medicationReconciliation,
    followUpPlan,
    patientEducation,
    safety,
    runs,
  };
}
