import type { Request } from 'express';
import type { Types } from 'mongoose';
import { AuditLog } from '../models/AuditLog.js';

export interface AuditInput {
  action: string;
  entity: string;
  entityId?: Types.ObjectId | string | null;
  patientId?: Types.ObjectId | string | null;
  description?: string;
  before?: unknown;
  after?: unknown;
}

/**
 * Writes an audit entry. Never throws — an audit failure must not break a
 * clinical action, but it is logged loudly to the console.
 */
export async function audit(req: Request | null, input: AuditInput): Promise<void> {
  try {
    await AuditLog.create({
      timestamp: new Date(),
      userId: req?.user?.id ?? null,
      userRole: req?.user?.role ?? 'system',
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      patientId: input.patientId ?? null,
      details: {
        before: input.before ?? null,
        after: input.after ?? null,
        description: input.description ?? '',
      },
      ipAddress: req?.ip ?? '',
      userAgent: req?.headers?.['user-agent'] ?? '',
    });
  } catch (err) {
    console.error('[audit] failed to write entry:', (err as Error).message);
  }
}

/** Audit entry attributed to an AI agent rather than a user. */
export async function auditAgent(input: AuditInput & { agent: string }): Promise<void> {
  await audit(null, {
    ...input,
    action: input.action,
    description: `[agent:${input.agent}] ${input.description ?? ''}`.trim(),
  });
}
