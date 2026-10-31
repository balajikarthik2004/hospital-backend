import { Vital } from '../src/models/Vital.js';
import { rand, randInt } from './patients.seed.js';
import type { SeededAdmissions } from './admissions.seed.js';
import type { SeededUsers } from './users.seed.js';

/** Small random walk around a baseline, clamped to a plausible range. */
function walk(current: number, drift: number, min: number, max: number): number {
  const next = current + (rand() - 0.5) * drift * 2;
  return Math.round(Math.min(max, Math.max(min, next)) * 10) / 10;
}

interface Baseline {
  sys: number;
  dia: number;
  hr: number;
  temp: number;
  rr: number;
  spo2: number;
  pain: number;
}

const BASELINES: Record<string, Baseline> = {
  default: { sys: 126, dia: 76, hr: 78, temp: 98.4, rr: 16, spo2: 97, pain: 2 },
  heart: { sys: 142, dia: 88, hr: 104, temp: 98.2, rr: 22, spo2: 93, pain: 3 },
  pneumonia: { sys: 118, dia: 72, hr: 98, temp: 100.8, rr: 24, spo2: 91, pain: 4 },
  surgical: { sys: 132, dia: 80, hr: 88, temp: 99.1, rr: 18, spo2: 95, pain: 6 },
  icu: { sys: 148, dia: 90, hr: 110, temp: 98.8, rr: 24, spo2: 94, pain: 3 },
};

function baselineFor(diagnosis: string): Baseline {
  const dx = diagnosis.toLowerCase();
  if (/heart failure|atrial fibrillation|myocardial/.test(dx)) return { ...BASELINES.heart };
  if (/pneumonia|copd|asthma|respiratory/.test(dx)) return { ...BASELINES.pneumonia };
  if (/arthroplasty|surgery|replacement/.test(dx)) return { ...BASELINES.surgical };
  if (/ketoacidosis|sepsis|kidney injury|ischaemic/.test(dx)) return { ...BASELINES.icu };
  return { ...BASELINES.default };
}

export async function seedVitals(users: SeededUsers, admissions: SeededAdmissions) {
  // Loosely typed on purpose: these are plain seed literals that Mongoose casts.
  const docs: any[] = [];

  for (const admission of admissions.all) {
    const start = new Date(admission.admissionDate).getTime();
    const end = admission.actualDischargeDate
      ? new Date(admission.actualDischargeDate).getTime()
      : Date.now();
    const hours = Math.max(6, Math.round((end - start) / 3_600_000));

    const b = baselineFor(admission.admittingDiagnosis);
    const nurse = users.nurses[randInt(0, users.nurses.length - 1)];

    // Recorded every 4-6 hours, trending towards recovery over the stay.
    let elapsed = 0;
    let step = 0;
    while (elapsed < hours) {
      const progress = elapsed / hours; // 0 at admission → 1 now
      const recovery = (x: number, target: number) => x + (target - x) * progress * 0.75;

      b.sys = walk(recovery(b.sys, 124), 6, 88, 196);
      b.dia = walk(recovery(b.dia, 74), 4, 52, 112);
      b.hr = walk(recovery(b.hr, 76), 6, 48, 142);
      b.temp = walk(recovery(b.temp, 98.4), 0.4, 96.6, 103.2);
      b.rr = walk(recovery(b.rr, 16), 2, 10, 34);
      b.spo2 = walk(recovery(b.spo2, 97), 1.5, 86, 100);
      b.pain = Math.max(0, Math.min(10, Math.round(recovery(b.pain, 1))));

      docs.push({
        patientId: admission.patientId,
        admissionId: admission._id,
        recordedBy: nurse._id,
        timestamp: new Date(start + elapsed * 3_600_000),
        bloodPressureSystolic: Math.round(b.sys),
        bloodPressureDiastolic: Math.round(b.dia),
        heartRate: Math.round(b.hr),
        temperature: Math.round(b.temp * 10) / 10,
        respiratoryRate: Math.round(b.rr),
        oxygenSaturation: Math.round(b.spo2),
        painScore: b.pain,
        weight: step % 6 === 0 ? Math.round((randInt(560, 1020) / 10) * 10) / 10 : null,
        notes: null,
      });

      elapsed += randInt(3, 4);
      step += 1;
    }
  }

  await Vital.insertMany(docs);
  return docs.length;
}
