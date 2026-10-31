import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { Appointment } from '../models/Appointment.js';
import { Patient } from '../models/Patient.js';
import { Specialty } from '../models/Specialty.js';
import { User, hashPassword } from '../models/User.js';
import { greeting, respond, type AgentState } from './bookingAgent.js';
import { isoDate, upcomingClinicDays } from './bookingService.js';

/**
 * The assistant books real appointments, so it is tested as a conversation
 * that ends in a row in the database — not just as a sequence of strings.
 */

let mongo: MongoMemoryServer;
let doctorId: string;
const DOB = '1980-05-14';

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri('agent_test'));

  await Specialty.create({
    slug: 'cardiology',
    name: 'Cardiology',
    symptomKeywords: ['chest pain', 'breathless', 'palpitations'],
    isActive: true,
    displayOrder: 10,
  });
  await Specialty.create({
    slug: 'dermatology',
    name: 'Dermatology',
    symptomKeywords: ['rash', 'itching'],
    isActive: true,
    displayOrder: 20,
  });

  const doctor = await User.create({
    email: 'dr.agent@example.com',
    passwordHash: await hashPassword('Demo@1234'),
    firstName: 'Ananya',
    lastName: 'Sharma',
    role: 'physician',
    department: 'Cardiology',
    doctorProfile: {
      specialty: 'cardiology',
      availableDays: [0, 1, 2, 3, 4, 5, 6],
      clinicStart: '09:00',
      clinicEnd: '17:00',
      slotMinutes: 30,
      isBookable: true,
    },
  });
  doctorId = String(doctor._id);

  await Patient.create({
    patientId: 'PAT-20240101-0001',
    demographics: {
      firstName: 'Senthil',
      lastName: 'Kumar',
      dateOfBirth: new Date(DOB),
      gender: 'male',
      phone: '9876543210',
    },
  });
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

const say = (r: { say: string[] }) => r.say.join(' ');

/** Walks a new patient all the way to the confirm step. */
async function walkToConfirm(complaint = 'chest pain when I climb stairs') {
  let r = greeting();
  r = await respond(r.state, 'new');
  r = await respond(r.state, 'Kavitha Raman');
  r = await respond(r.state, '1992-03-09');
  r = await respond(r.state, '9123456780');
  r = await respond(r.state, complaint);
  expect(r.state.specialty).toBe('cardiology');

  r = await respond(r.state, 'yes'); // accept the department
  r = await respond(r.state, doctorId);
  const day = isoDate(upcomingClinicDays([0, 1, 2, 3, 4, 5, 6], 1)[0]);
  r = await respond(r.state, day);
  expect(r.state.step).toBe('slot');

  const time = r.options?.[0]?.value as string;
  r = await respond(r.state, time);
  expect(r.state.step).toBe('confirm');
  return { reply: r, time, day };
}

describe('the conversation', () => {
  it('opens by asking whether the visitor has been before', () => {
    const r = greeting();
    expect(r.state.step).toBe('who');
    expect(r.options?.map((o) => o.value)).toEqual(['new', 'returning']);
  });

  it('asks a new patient for name, date of birth and phone, in that order', async () => {
    let r = await respond(greeting().state, 'new');
    expect(r.state.step).toBe('name');

    r = await respond(r.state, 'Kavitha Raman');
    expect(r.state.firstName).toBe('Kavitha');
    expect(r.state.lastName).toBe('Raman');
    expect(r.state.step).toBe('dob');

    r = await respond(r.state, '1992-03-09');
    expect(r.state.step).toBe('phone');

    r = await respond(r.state, '9123456780');
    expect(r.state.step).toBe('symptoms');
  });

  it('asks again rather than guessing when a name has only one word', async () => {
    let r = await respond(greeting().state, 'new');
    r = await respond(r.state, 'Kavitha');
    expect(r.state.step).toBe('name');
    expect(say(r)).toMatch(/first and last name/i);
  });

  it('rejects a date of birth in the future', async () => {
    let r = await respond(greeting().state, 'new');
    r = await respond(r.state, 'Test Person');
    r = await respond(r.state, '2090-01-01');
    expect(r.state.step).toBe('dob');
    expect(say(r)).toMatch(/future/i);
  });

  it('rejects a phone number that is too short', async () => {
    let r = await respond(greeting().state, 'new');
    r = await respond(r.state, 'Test Person');
    r = await respond(r.state, '1990-01-01');
    r = await respond(r.state, '12345');
    expect(r.state.step).toBe('phone');
  });
});

describe('triage inside the conversation', () => {
  it('suggests a department and explains why', async () => {
    let r = await respond(greeting().state, 'new');
    r = await respond(r.state, 'Kavitha Raman');
    r = await respond(r.state, '1992-03-09');
    r = await respond(r.state, '9123456780');
    r = await respond(r.state, 'chest pain and breathless');

    expect(r.state.specialty).toBe('cardiology');
    expect(say(r)).toMatch(/Cardiology/);
    expect(say(r)).toMatch(/because you mentioned/i);
  });

  it('stops the booking entirely when the complaint sounds like an emergency', async () => {
    let r = await respond(greeting().state, 'new');
    r = await respond(r.state, 'Test Person');
    r = await respond(r.state, '1970-01-01');
    r = await respond(r.state, '9000000000');
    r = await respond(r.state, 'crushing chest pain going down my arm, sweating');

    expect(r.state.step).toBe('emergency');
    expect(r.emergency?.advice).toMatch(/heart attack/i);
    expect(say(r)).toMatch(/108/);
    // It must not offer a slot or carry on.
    expect(r.options ?? []).toHaveLength(0);
  });

  it('lets the visitor override the suggested department', async () => {
    let r = await respond(greeting().state, 'new');
    r = await respond(r.state, 'Test Person');
    r = await respond(r.state, '1970-01-01');
    r = await respond(r.state, '9000000000');
    r = await respond(r.state, 'chest pain');
    expect(r.state.specialty).toBe('cardiology');

    r = await respond(r.state, 'change');
    expect(r.options?.some((o) => o.value === 'dermatology')).toBe(true);

    r = await respond(r.state, 'dermatology');
    expect(r.state.specialty).toBe('dermatology');
    expect(r.state.overrode).toBe(true);
  });

  it('says so plainly when a department has nobody bookable', async () => {
    let r = await respond(greeting().state, 'new');
    r = await respond(r.state, 'Test Person');
    r = await respond(r.state, '1970-01-01');
    r = await respond(r.state, '9000000000');
    r = await respond(r.state, 'rash and itching');
    r = await respond(r.state, 'yes');

    expect(say(r)).toMatch(/not taking online bookings|nobody in/i);
    expect(say(r)).toMatch(/\+91 44 4000 1200/);
  });
});

describe('returning patients', () => {
  it('finds a patient from ID and date of birth', async () => {
    let r = await respond(greeting().state, 'returning');
    r = await respond(r.state, 'PAT-20240101-0001');
    r = await respond(r.state, DOB);

    expect(r.state.step).toBe('symptoms');
    expect(say(r)).toMatch(/Senthil/);
  });

  it('gives nothing away when the date of birth is wrong', async () => {
    let r = await respond(greeting().state, 'returning');
    r = await respond(r.state, 'PAT-20240101-0001');
    const wrongDob = await respond(r.state, '1999-09-09');

    let r2 = await respond(greeting().state, 'returning');
    r2 = await respond(r2.state, 'PAT-00000000-0000');
    const wrongId = await respond(r2.state, DOB);

    expect(wrongDob.say[0]).toBe(wrongId.say[0]);
    expect(wrongDob.say[0]).toMatch(/could not match/i);
  });
});

describe('booking', () => {
  it('creates a real appointment and returns a reference', async () => {
    const { reply } = await walkToConfirm();
    const r = await respond(reply.state, 'confirm');

    expect(r.state.step).toBe('done');
    expect(r.booking?.appointmentId).toMatch(/^APT-/);
    expect(r.booking?.patientId).toMatch(/^PAT-/);

    const saved = await Appointment.findOne({ appointmentId: r.booking!.appointmentId });
    expect(saved).not.toBeNull();
    expect(saved!.source).toBe('public');
    // The complaint reaches the chart in the patient's own words.
    expect(saved!.complaint).toMatch(/climb stairs/);
  });

  it('does not book twice if the same confirmed state is sent again', async () => {
    const { reply } = await walkToConfirm('palpitations at night');
    const first = await respond(reply.state, 'confirm');
    const before = await Appointment.countDocuments({});

    const again = await respond(first.state, 'confirm');
    const after = await Appointment.countDocuments({});

    expect(after).toBe(before);
    expect(say(again)).toMatch(/already booked/i);
  });

  it('offers another day rather than dead-ending when the slot has gone', async () => {
    const { reply, time, day } = await walkToConfirm('breathless walking uphill');

    // Someone else takes the slot between the summary and the confirm.
    const other = await walkToConfirm('chest pain again');
    await respond(other.reply.state, 'confirm');

    const clash = await respond(
      { ...reply.state, date: other.day, time: other.time } as AgentState,
      'confirm'
    );
    expect(clash.state.step).toBe('date');
    expect(say(clash)).toMatch(/took that slot|pick another/i);
    expect(day).toBeTruthy();
    expect(time).toBeTruthy();
  });

  it('starts over on request without booking anything', async () => {
    const { reply } = await walkToConfirm('chest tightness');
    const before = await Appointment.countDocuments({});
    const r = await respond(reply.state, 'restart');
    expect(r.state.step).toBe('who');
    expect(await Appointment.countDocuments({})).toBe(before);
  });
});
