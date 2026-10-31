import { Bed } from '../src/models/Bed.js';

/** 60 beds across 4 wards. */
const WARDS = [
  {
    ward: 'Cardiology 3B',
    rooms: 8,
    bedsPerRoom: 2,
    type: 'semi_private' as const,
    features: ['cardiac_monitor', 'oxygen', 'telemetry'],
  },
  {
    ward: 'General Medicine 2A',
    rooms: 10,
    bedsPerRoom: 2,
    type: 'general' as const,
    features: ['oxygen', 'suction'],
  },
  {
    ward: 'ICU 4',
    rooms: 12,
    bedsPerRoom: 1,
    type: 'icu' as const,
    features: ['ventilator', 'cardiac_monitor', 'oxygen', 'suction', 'dialysis_ready'],
  },
  {
    ward: 'Pediatrics 1C',
    rooms: 6,
    bedsPerRoom: 2,
    type: 'pediatric' as const,
    features: ['oxygen', 'pediatric_monitor', 'parent_bed'],
  },
];

export async function seedBeds() {
  // Loosely typed on purpose: these are plain seed literals that Mongoose casts.
  const docs: any[] = [];
  let roomCounter: Record<string, number> = {};

  for (const w of WARDS) {
    const prefix = w.ward.match(/\d/)?.[0] ?? '1';
    roomCounter[w.ward] = 0;
    for (let r = 1; r <= w.rooms; r++) {
      const roomNumber = `${prefix}${String(r).padStart(2, '0')}`;
      for (let b = 0; b < w.bedsPerRoom; b++) {
        const bedNumber = w.bedsPerRoom === 1 ? '1' : String.fromCharCode(65 + b);
        docs.push({
          ward: w.ward,
          roomNumber,
          bedNumber,
          type: w.type,
          // A few beds out of service so the ward map is not uniformly green.
          status: docs.length % 17 === 16 ? 'maintenance' : 'available',
          features: w.features,
          currentPatientId: null,
          currentAdmissionId: null,
        });
      }
    }
  }

  const beds = await Bed.insertMany(docs);
  return beds;
}
