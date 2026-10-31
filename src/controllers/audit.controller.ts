import type { Request, Response } from 'express';
import { AuditLog } from '../models/AuditLog.js';
import { asyncHandler, paginate, toCsv } from '../utils/helpers.js';

function buildFilter(query: Record<string, any>) {
  const filter: Record<string, unknown> = {};
  if (query.userId) filter.userId = query.userId;
  if (query.patientId) filter.patientId = query.patientId;
  if (query.action) filter.action = new RegExp(String(query.action), 'i');
  if (query.entity) filter.entity = query.entity;
  if (query.q) filter['details.description'] = new RegExp(String(query.q), 'i');
  if (query.from || query.to) {
    filter.timestamp = {
      ...(query.from ? { $gte: new Date(query.from) } : {}),
      ...(query.to ? { $lte: new Date(query.to) } : {}),
    };
  }
  return filter;
}

const POPULATE = [
  { path: 'userId', select: 'firstName lastName role email' },
  { path: 'patientId', select: 'patientId demographics.firstName demographics.lastName' },
];

export const listAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = buildFilter(req.query);

  const [logs, total, actions] = await Promise.all([
    AuditLog.find(filter).sort('-timestamp').skip(skip).limit(limit).populate(POPULATE).lean(),
    AuditLog.countDocuments(filter),
    AuditLog.distinct('action'),
  ]);

  res.json({
    logs,
    actions: actions.sort(),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

export const patientAuditTrail = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = { patientId: req.params.patientId };

  const [logs, total] = await Promise.all([
    AuditLog.find(filter).sort('-timestamp').skip(skip).limit(limit).populate(POPULATE).lean(),
    AuditLog.countDocuments(filter),
  ]);

  res.json({ logs, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

export const exportAuditCsv = asyncHandler(async (req: Request, res: Response) => {
  const filter = buildFilter(req.query);
  const logs = await AuditLog.find(filter).sort('-timestamp').limit(10_000).populate(POPULATE).lean();

  const rows = logs.map((l: any) => ({
    timestamp: new Date(l.timestamp).toISOString(),
    user: l.userId ? `${l.userId.firstName} ${l.userId.lastName}` : 'system',
    role: l.userRole,
    action: l.action,
    entity: l.entity,
    entityId: l.entityId ? String(l.entityId) : '',
    patient: l.patientId?.patientId ?? '',
    description: l.details?.description ?? '',
    ipAddress: l.ipAddress ?? '',
  }));

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="safedischarge-audit-${new Date().toISOString().slice(0, 10)}.csv"`
  );
  res.send(toCsv(rows));
});
