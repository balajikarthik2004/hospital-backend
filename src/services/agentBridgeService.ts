import { env } from '../config/env.js';
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

export type AgentEngine = 'python-langgraph' | 'python-asyncio' | 'builtin';

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

export interface AgentServiceHealth {
  online: boolean;
  /** What the service says it will use: "langgraph" or "asyncio-fallback". */
  engine?: string;
  llm?: { configured: boolean; model: string | null };
}

/**
 * Asks the Python service what it is, not just whether it answers. Reporting
 * "python-langgraph" purely because a socket accepted a connection was how the
 * UI ended up claiming an engine that was not actually running.
 */
export async function agentServiceHealth(): Promise<AgentServiceHealth> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${env.AGENT_SERVICE_URL}/health`, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) return { online: false };
    const body = (await res.json()) as { engine?: string; llm?: AgentServiceHealth['llm'] };
    return { online: true, engine: body.engine, llm: body.llm };
  } catch {
    return { online: false };
  }
}

/** Is the Python agent service reachable? */
export async function agentServiceHealthy(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${env.AGENT_SERVICE_URL}/health`, { signal: controller.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Runs the discharge DAG. Prefers the Python LangGraph service; falls back to
 * the equivalent built-in TypeScript orchestrator when it is not running.
 */
export async function orchestrateDischarge(
  ctx: AgentContext,
  onProgress: Progress = () => {}
): Promise<OrchestrationResult> {
  if (await agentServiceHealthy()) {
    try {
      return await runRemote(ctx, onProgress);
    } catch (err) {
      console.warn(
        `[agents] Python service failed (${(err as Error).message}); falling back to the built-in orchestrator`
      );
    }
  }
  return runLocal(ctx, onProgress);
}

async function runRemote(ctx: AgentContext, onProgress: Progress): Promise<OrchestrationResult> {
  onProgress('orchestrator', 'running');
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 180_000);

  try {
    const res = await fetch(`${env.AGENT_SERVICE_URL}/orchestrate/discharge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ctx),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`agent service responded ${res.status}`);
    const data = (await res.json()) as Omit<OrchestrationResult, 'engine'> & { engine?: string };
    for (const run of data.runs ?? []) onProgress(run.agent, run.status);
    onProgress('orchestrator', 'complete');
    // Trust what the service reports it ran, rather than assuming LangGraph.
    const engine: AgentEngine =
      data.engine === 'asyncio-fallback' ? 'python-asyncio' : 'python-langgraph';
    return { ...data, engine };
  } finally {
    clearTimeout(t);
  }
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
