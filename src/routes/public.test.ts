import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { createApp } from '../app.js';
import { Patient } from '../models/Patient.js';
import { Specialty } from '../models/Specialty.js';
import { User, hashPassword } from '../models/User.js';

/**
 * These endpoints sit in front of no token at all, so they are tested as a
 * black box over real HTTP rather than by calling the controllers. What is
 * being checked is mostly what the API *refuses* to say: a lookup must not
 * reveal whether a patient ID exists, and a portal token must not open a
 * staff route.
 */

let mongo: MongoMemoryServer;
let server: Server;
let base: string;
let doctorId: string;

const DOB = new Date('1980-05-14T00:00:00.000Z');

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri('public_test'));

  await Specialty.create({
    slug: 'cardiology',
    name: 'Cardiology',
    symptomKeywords: ['chest pain', 'palpitations', 'breathless'],
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
  await Specialty.create({
    slug: 'general-medicine',
    name: 'General Medicine',
    symptomKeywords: ['fever'],
    isActive: true,
    displayOrder: 5,
  });

  const doctor = await User.create({
    email: 'dr.test@example.com',
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
      dateOfBirth: DOB,
      gender: 'male',
      phone: '9876543210',
    },
  });

  server = createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
}, 120_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mongoose.disconnect();
  await mongo.stop();
});

/** `Response.json()` is `any`-free but untyped; tests say what they expect. */
type Json = Record<string, any>;

const post = (path: string, body: unknown, token?: string) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

const get = (path: string, token?: string) =>
  fetch(`${base}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

const json = (res: Response): Promise<Json> => res.json() as Promise<Json>;

/** The next occurrence of a weekday the test doctor holds clinic on. */
function soon(): string {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('browsing without a token', () => {
  it('lists only active departments', async () => {
    const res = await get('/public/specialties');
    expect(res.status).toBe(200);
    const { specialties } = await json(res);
    expect(specialties.map((s: { slug: string }) => s.slug)).toContain('cardiology');
  });

  it('lists only bookable doctors', async () => {
    const { doctors } = await get('/public/doctors').then(json);
    expect(doctors).toHaveLength(1);
    expect(doctors[0].firstName).toBe('Ananya');
    // The card must never carry credentials.
    expect(doctors[0].passwordHash).toBeUndefined();
    expect(doctors[0].email).toBeUndefined();
  });
});

describe('triage', () => {
  it('routes a described complaint to the matching department', async () => {
    const res = await post('/public/triage', { complaint: 'chest pain and breathless' });
    const body = await json(res);
    expect(body.specialty).toBe('cardiology');
    expect(body.reason).toMatch(/Cardiology/);
    expect(body.doctors).toHaveLength(1);
  });

  it('falls back to general medicine when nothing matches', async () => {
    const body = await post('/public/triage', { complaint: 'qqq zzz' }).then(json);
    expect(body.specialty).toBe('general-medicine');
    expect(body.confidence).toBeLessThan(0.5);
  });

  it('flags an emergency instead of quietly booking a slot', async () => {
    const body = await post('/public/triage', {
      complaint: 'crushing chest pain going down my arm',
    }).then(json);
    expect(body.emergency).not.toBeNull();
    expect(body.emergency.advice).toMatch(/heart attack/i);
  });

  it('sends a child to paediatrics only when that department exists', async () => {
    // No paediatrics in this fixture, so it must fall through to keywords.
    const body = await post('/public/triage', { complaint: 'rash', age: 6 }).then(json);
    expect(body.specialty).toBe('dermatology');
  });
});

describe('booking', () => {
  it('creates a chart for a new patient and returns their ID', async () => {
    const res = await post('/public/appointments', {
      isNewPatient: true,
      firstName: 'Kavitha',
      lastName: 'Raman',
      dateOfBirth: '1992-03-09',
      gender: 'female',
      phone: '9123456780',
      doctorId,
      date: soon(),
      time: '10:00',
      complaint: 'palpitations at night',
    });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.patient.patientId).toMatch(/^PAT-/);
    expect(body.patient.isNew).toBe(true);
    expect(body.appointment.appointmentId).toMatch(/^APT-/);
  });

  it('refuses a slot that has already been taken', async () => {
    const res = await post('/public/appointments', {
      isNewPatient: true,
      firstName: 'Arun',
      lastName: 'Selvam',
      dateOfBirth: '1975-01-02',
      phone: '9000000001',
      doctorId,
      date: soon(),
      time: '10:00',
      complaint: 'chest pain',
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/just took that slot/i);
  });

  it('refuses a slot in the past', async () => {
    const res = await post('/public/appointments', {
      isNewPatient: true,
      firstName: 'Old',
      lastName: 'Booking',
      dateOfBirth: '1975-01-02',
      phone: '9000000002',
      doctorId,
      date: '2020-01-06',
      time: '10:00',
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/past/i);
  });

  it('does not create a second chart for a patient who books again', async () => {
    const before = await Patient.countDocuments({ 'demographics.phone': '9123456780' });
    await post('/public/appointments', {
      isNewPatient: true,
      firstName: 'Kavitha',
      lastName: 'Raman',
      dateOfBirth: '1992-03-09',
      phone: '9123456780',
      doctorId,
      date: soon(),
      time: '11:30',
      complaint: 'follow up',
    });
    const after = await Patient.countDocuments({ 'demographics.phone': '9123456780' });
    expect(after).toBe(before);
  });
});

describe('portal access', () => {
  it('accepts a patient ID with the right date of birth', async () => {
    const res = await post('/public/portal/login', {
      identifier: 'PAT-20240101-0001',
      dateOfBirth: '1980-05-14',
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.token).toBeTruthy();
    expect(body.patient.firstName).toBe('Senthil');
    // The portal shows a masked number, never the full one.
    expect(body.patient.phone).toMatch(/^•+3210$/);
  });

  it('accepts a phone number with the right date of birth', async () => {
    const res = await post('/public/portal/login', {
      identifier: '9876543210',
      dateOfBirth: '1980-05-14',
    });
    expect(res.status).toBe(200);
  });

  it('rejects a real ID with the wrong date of birth', async () => {
    const res = await post('/public/portal/login', {
      identifier: 'PAT-20240101-0001',
      dateOfBirth: '1990-01-01',
    });
    expect(res.status).toBe(400);
  });

  it('gives the same answer for a wrong ID as for a wrong date of birth', async () => {
    // Otherwise the endpoint is an oracle for walking patient IDs.
    const wrongId = await post('/public/portal/login', {
      identifier: 'PAT-99999999-9999',
      dateOfBirth: '1980-05-14',
    }).then(json);
    const wrongDob = await post('/public/portal/login', {
      identifier: 'PAT-20240101-0001',
      dateOfBirth: '1990-01-01',
    }).then(json);
    // Assert the text exists before comparing, or two undefineds pass happily.
    expect(typeof wrongId.error).toBe('string');
    expect(wrongId.error).toMatch(/could not match/i);
    expect(wrongId.error).toBe(wrongDob.error);
  });

  it('returns only the signed-in patient, and only their appointments', async () => {
    const { token } = await post('/public/portal/login', {
      identifier: 'PAT-20240101-0001',
      dateOfBirth: '1980-05-14',
    }).then(json);

    const body = await get('/public/portal/me', token).then(json);
    expect(body.patient.patientId).toBe('PAT-20240101-0001');
    expect(body.appointments).toHaveProperty('upcoming');
    // No chart content leaks through the portal view.
    expect(body.patient).not.toHaveProperty('allergies');
    expect(body.patient).not.toHaveProperty('medicalHistory');
  });

  it('refuses the portal without a token', async () => {
    expect((await get('/public/portal/me')).status).toBe(401);
  });
});

describe('token scope', () => {
  it('will not let a portal token through a staff route', async () => {
    const { token } = await post('/public/portal/login', {
      identifier: 'PAT-20240101-0001',
      dateOfBirth: '1980-05-14',
    }).then(json);

    // Same secret, same signature — only the scope differs.
    const res = await get('/patients', token);
    expect(res.status).toBe(401);
  });

  it('will not let a portal token reach the admin catalogue', async () => {
    const { token } = await post('/public/portal/login', {
      identifier: 'PAT-20240101-0001',
      dateOfBirth: '1980-05-14',
    }).then(json);

    const res = await get('/specialties', token);
    expect(res.status).toBe(401);
  });
});
