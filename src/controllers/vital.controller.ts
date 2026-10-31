import type { Request, Response } from 'express';
import { Vital } from '../models/Vital.js';
import { audit } from '../middleware/audit.js';
import { emit } from '../config/socket.js';
import { asyncHandler, notFound } from '../utils/helpers.js';

/** Flags a reading that should prompt a clinician to look. */
export function vitalAlerts(v: {
  bloodPressureSystolic: number;
  bloodPressureDiastolic: number;
  heartRate: number;
  temperature: number;
  respiratoryRate: number;
  oxygenSaturation: number;
}): string[] {
  const alerts: string[] = [];
  if (v.oxygenSaturation < 92) alerts.push(`SpO₂ ${v.oxygenSaturation}% is below 92%`);
  if (v.bloodPressureSystolic >= 180 || v.bloodPressureDiastolic >= 110)
    alerts.push(`BP ${v.bloodPressureSystolic}/${v.bloodPressureDiastolic} is in the hypertensive range`);
  if (v.bloodPressureSystolic < 90) alerts.push(`Systolic BP ${v.bloodPressureSystolic} is low`);
  if (v.heartRate > 120) alerts.push(`Heart rate ${v.heartRate} is tachycardic`);
  if (v.heartRate < 50) alerts.push(`Heart rate ${v.heartRate} is bradycardic`);
  if (v.temperature >= 100.4) alerts.push(`Temperature ${v.temperature} °F indicates fever`);
  if (v.temperature <= 95) alerts.push(`Temperature ${v.temperature} °F is hypothermic`);
  if (v.respiratoryRate > 24) alerts.push(`Respiratory rate ${v.respiratoryRate} is elevated`);
  return alerts;
}

export const recordVital = asyncHandler(async (req: Request, res: Response) => {
  const vital = await Vital.create({
    ...req.body,
    recordedBy: req.user!.id,
    timestamp: req.body.timestamp ?? new Date(),
  });

  const alerts = vitalAlerts(vital as never);

  await audit(req, {
    action: 'vitals.recorded',
    entity: 'vitals',
    entityId: vital._id,
    patientId: vital.patientId as never,
    description: `BP ${vital.bloodPressureSystolic}/${vital.bloodPressureDiastolic}, HR ${vital.heartRate}, T ${vital.temperature}°F, SpO₂ ${vital.oxygenSaturation}%${alerts.length ? ` — ${alerts.length} alert(s)` : ''}`,
    after: { alerts },
  });

  const payload = { vital, alerts };
  emit('vitals:recorded', payload, `patient:${String(vital.patientId)}`);
  emit('vitals:recorded', payload);

  res.status(201).json(payload);
});

export const getVitals = asyncHandler(async (req: Request, res: Response) => {
  const limit = Math.min(500, Number(req.query.limit) || 100);
  const vitals = await Vital.find({ patientId: req.params.patientId })
    .sort('-timestamp')
    .limit(limit)
    .populate('recordedBy', 'firstName lastName role')
    .lean();
  res.json({ vitals: vitals.map((v) => ({ ...v, alerts: vitalAlerts(v as never) })) });
});

export const latestVital = asyncHandler(async (req: Request, res: Response) => {
  const vital = await Vital.findOne({ patientId: req.params.patientId })
    .sort('-timestamp')
    .populate('recordedBy', 'firstName lastName role')
    .lean();
  if (!vital) throw notFound('Vitals for this patient');
  res.json({ vital, alerts: vitalAlerts(vital as never) });
});
