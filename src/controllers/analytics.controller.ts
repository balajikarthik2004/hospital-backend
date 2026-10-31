import type { Request, Response } from 'express';
import {
  agentPerformance,
  bedOccupancy,
  dischargeFunnel,
  dischargeVolume,
  kpiSummary,
  readmissionRate,
  staffWorkload,
} from '../services/analyticsService.js';
import { Admission } from '../models/Admission.js';
import { Bed } from '../models/Bed.js';
import { asyncHandler } from '../utils/helpers.js';

export const getKpis = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await kpiSummary());
});

export const getDischargeVolume = asyncHandler(async (req: Request, res: Response) => {
  const days = Math.min(180, Number(req.query.days) || 30);
  res.json({ series: await dischargeVolume(days) });
});

export const getAgentPerformance = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await agentPerformance());
});

export const getReadmissionRate = asyncHandler(async (req: Request, res: Response) => {
  const months = Math.min(24, Number(req.query.months) || 6);
  res.json(await readmissionRate(months));
});

export const getBedOccupancy = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ wards: await bedOccupancy() });
});

export const getFunnel = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ funnel: await dischargeFunnel() });
});

export const getWorkload = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ workload: await staffWorkload() });
});

/** Bed turnover per ward over the trailing 30 days. */
export const getBedTurnover = asyncHandler(async (_req: Request, res: Response) => {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [admissions, beds] = await Promise.all([
    Admission.find({ admissionDate: { $gte: since } }).lean(),
    Bed.find().lean(),
  ]);

  const wards = [...new Set(beds.map((b) => b.ward))];
  res.json({
    turnover: wards.map((ward) => {
      const wardBeds = beds.filter((b) => b.ward === ward).length;
      const wardAdmissions = admissions.filter((a) => a.bed?.ward === ward);
      const discharged = wardAdmissions.filter((a) => a.actualDischargeDate);
      const los = discharged.map(
        (a) =>
          (new Date(a.actualDischargeDate!).getTime() - new Date(a.admissionDate).getTime()) /
          86_400_000
      );
      return {
        ward,
        beds: wardBeds,
        admissions: wardAdmissions.length,
        discharges: discharged.length,
        turnoverPerBed: wardBeds ? Math.round((wardAdmissions.length / wardBeds) * 100) / 100 : 0,
        avgLengthOfStayDays: los.length
          ? Math.round((los.reduce((a, b) => a + b, 0) / los.length) * 10) / 10
          : 0,
      };
    }),
  });
});
