import { Appointment } from '../src/models/Appointment.js';
import { ID_PREFIX } from '../src/utils/idGenerator.js';
import { pick, rand, randInt } from './patients.seed.js';
import type { SeededPatients } from './patients.seed.js';
import type { SeededUsers } from './users.seed.js';

const SPECIALTIES = [
  'Cardiology',
  'Internal Medicine',
  'Pulmonology',
  'Orthopedics',
  'Endocrinology',
  'Laboratory',
];

const LOCATIONS = [
  'Outpatient Clinic, Level 2',
  'Cardiology Clinic, Level 3',
  'Phlebotomy, Level 1',
  'Telehealth',
  'Rehabilitation Suite, Level 1',
];

const REASONS = [
  'Post-discharge review',
  'Medication review and titration',
  'Wound check',
  'Repeat bloods',
  'Symptom review',
  'Routine follow-up',
];

const TIMES = ['09:00', '09:30', '10:00', '10:30', '11:00', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00'];

export async function seedAppointments(users: SeededUsers, patients: SeededPatients) {
  // Loosely typed on purpose: these are plain seed literals that Mongoose casts.
  const docs: any[] = [];
  const day = new Date();
  const stamp = `${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, '0')}${String(day.getDate()).padStart(2, '0')}`;
  let counter = 0;
  const makeId = () => `${ID_PREFIX.appointment}-${stamp}-${String(++counter).padStart(4, '0')}`;

  /** Avoids double-booking a doctor in the same slot. */
  const taken = new Set<string>();
  function freeSlot(doctorId: string, date: Date): string | null {
    const dayKey = date.toISOString().slice(0, 10);
    for (const t of TIMES) {
      const key = `${doctorId}|${dayKey}|${t}`;
      if (!taken.has(key)) {
        taken.add(key);
        return t;
      }
    }
    return null;
  }

  const makeAppointment = (
    patientId: unknown,
    doctorId: string,
    dayOffset: number,
    status: string,
    type: string,
    specialty: string
  ) => {
    const date = new Date();
    date.setDate(date.getDate() + dayOffset);
    date.setHours(0, 0, 0, 0);
    const time = freeSlot(doctorId, date);
    if (!time) return;

    docs.push({
      appointmentId: makeId(),
      patientId,
      doctorId,
      admissionId: null,
      type,
      specialty,
      scheduledDate: date,
      scheduledTime: time,
      duration: pick([20, 30, 30, 45]),
      location: pick(LOCATIONS),
      status,
      reason: pick(REASONS),
      notes: null,
      insuranceVerified: rand() > 0.3,
      reminderSent: dayOffset < 2 && dayOffset >= 0,
      createdBy: doctorId,
    });
  };

  const doctors = users.physicians;
  const all = patients.all;

  // 12 past appointments (mostly completed, a few no-shows)
  for (let i = 0; i < 12; i++) {
    const patient = all[randInt(0, all.length - 1)];
    const doctor = doctors[i % doctors.length];
    makeAppointment(
      patient._id,
      String(doctor._id),
      -randInt(1, 45),
      rand() > 0.2 ? 'completed' : 'no_show',
      pick(['follow_up', 'specialist', 'lab_only']),
      pick(SPECIALTIES)
    );
  }

  // 6 today
  for (let i = 0; i < 6; i++) {
    const patient = all[randInt(0, all.length - 1)];
    const doctor = doctors[i % doctors.length];
    makeAppointment(
      patient._id,
      String(doctor._id),
      0,
      rand() > 0.4 ? 'confirmed' : 'scheduled',
      pick(['follow_up', 'specialist', 'telehealth']),
      pick(SPECIALTIES)
    );
  }

  // 22 upcoming
  for (let i = 0; i < 22; i++) {
    const patient = all[randInt(0, all.length - 1)];
    const doctor = doctors[i % doctors.length];
    makeAppointment(
      patient._id,
      String(doctor._id),
      randInt(1, 28),
      rand() > 0.35 ? 'scheduled' : 'confirmed',
      pick(['follow_up', 'specialist', 'lab_only', 'telehealth']),
      pick(SPECIALTIES)
    );
  }

  // Patient A already has a cardiology follow-up booked, so the follow-up agent
  // can demonstrate its duplicate cross-check.
  const cardiologist = doctors.find((d) => d.specialization === 'Cardiology') ?? doctors[0];
  makeAppointment(patients.demo.A._id, String(cardiologist._id), 6, 'scheduled', 'specialist', 'Cardiology');

  return Appointment.insertMany(docs);
}
