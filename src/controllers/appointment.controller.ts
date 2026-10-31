import type { Request, Response } from 'express';
import { Appointment } from '../models/Appointment.js';
import { User } from '../models/User.js';
import { audit } from '../middleware/audit.js';
import { emit, emitToUser } from '../config/socket.js';
import { ID_PREFIX, nextId } from '../utils/idGenerator.js';
import { asyncHandler, badRequest, notFound, paginate } from '../utils/helpers.js';

const POPULATE = [
  { path: 'patientId', select: 'patientId demographics' },
  { path: 'doctorId', select: 'firstName lastName specialization department' },
];

/** Clinic hours used for slot generation. */
const DAY_START = 9 * 60;
const DAY_END = 17 * 60;
const SLOT_MINUTES = 30;

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const toHHMM = (mins: number) =>
  `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

export const createAppointment = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as Record<string, any>;

  const conflict = await findConflict(body.doctorId, body.scheduledDate, body.scheduledTime, body.duration ?? 30);
  if (conflict) {
    throw badRequest(
      `That doctor already has an appointment at ${conflict.scheduledTime} on that day (${conflict.appointmentId})`
    );
  }

  const appointment = await Appointment.create({
    ...body,
    appointmentId: await nextId(Appointment, 'appointmentId', ID_PREFIX.appointment),
    createdBy: req.user!.id,
  });

  await audit(req, {
    action: 'appointment.created',
    entity: 'appointments',
    entityId: appointment._id,
    patientId: appointment.patientId as never,
    description: `Scheduled ${appointment.type.replace('_', ' ')} on ${new Date(appointment.scheduledDate).toISOString().slice(0, 10)} at ${appointment.scheduledTime}`,
    after: { appointmentId: appointment.appointmentId, specialty: appointment.specialty },
  });

  const populated = await Appointment.findById(appointment._id).populate(POPULATE).lean();
  emit('appointment:created', { appointment: populated });
  emitToUser(String(appointment.doctorId), 'appointment:created', { appointment: populated });

  res.status(201).json({ appointment: populated });
});

async function findConflict(
  doctorId: string,
  date: Date | string,
  time: string,
  duration: number
) {
  const day = new Date(date);
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(day);
  end.setHours(23, 59, 59, 999);

  const sameDay = await Appointment.find({
    doctorId,
    scheduledDate: { $gte: start, $lte: end },
    status: { $in: ['scheduled', 'confirmed'] },
  }).lean();

  const newStart = toMinutes(time);
  const newEnd = newStart + duration;

  return (
    sameDay.find((a) => {
      const s = toMinutes(a.scheduledTime);
      return newStart < s + (a.duration ?? 30) && s < newEnd;
    }) ?? null
  );
}

export const listAppointments = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, skip } = paginate(req.query);
  const { status, type, doctorId, patientId, specialty, from, to } = req.query as Record<string, string>;

  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (type) filter.type = type;
  if (doctorId) filter.doctorId = doctorId;
  if (patientId) filter.patientId = patientId;
  if (specialty) filter.specialty = specialty;
  if (from || to) {
    filter.scheduledDate = {
      ...(from ? { $gte: new Date(from) } : {}),
      ...(to ? { $lte: new Date(to) } : {}),
    };
  }
  if (req.user?.role === 'patient') filter.patientId = req.user.patientRef ?? null;

  const [appointments, total] = await Promise.all([
    Appointment.find(filter).sort('scheduledDate scheduledTime').skip(skip).limit(limit).populate(POPULATE).lean(),
    Appointment.countDocuments(filter),
  ]);

  res.json({ appointments, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

export const getAppointment = asyncHandler(async (req: Request, res: Response) => {
  const appointment = await Appointment.findById(req.params.id).populate(POPULATE).lean();
  if (!appointment) throw notFound('Appointment');
  res.json({ appointment });
});

export const updateAppointment = asyncHandler(async (req: Request, res: Response) => {
  const before = await Appointment.findById(req.params.id).lean();
  if (!before) throw notFound('Appointment');

  const appointment = await Appointment.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  })
    .populate(POPULATE)
    .lean();

  await audit(req, {
    action: 'appointment.updated',
    entity: 'appointments',
    entityId: before._id,
    patientId: before.patientId as never,
    description: `Updated ${before.appointmentId}`,
    before: { status: before.status, scheduledDate: before.scheduledDate, scheduledTime: before.scheduledTime },
    after: req.body,
  });

  res.json({ appointment });
});

export const cancelAppointment = asyncHandler(async (req: Request, res: Response) => {
  const appointment = await Appointment.findByIdAndUpdate(
    req.params.id,
    { status: 'cancelled' },
    { new: true }
  ).lean();
  if (!appointment) throw notFound('Appointment');

  await audit(req, {
    action: 'appointment.cancelled',
    entity: 'appointments',
    entityId: appointment._id,
    patientId: appointment.patientId as never,
    description: `Cancelled ${appointment.appointmentId}`,
  });

  res.json({ appointment });
});

export const doctorSlots = asyncHandler(async (req: Request, res: Response) => {
  const date = req.query.date ? new Date(String(req.query.date)) : new Date();
  const duration = Number(req.query.duration) || SLOT_MINUTES;

  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  const booked = await Appointment.find({
    doctorId: req.params.doctorId,
    scheduledDate: { $gte: start, $lte: end },
    status: { $in: ['scheduled', 'confirmed'] },
  }).lean();

  const slots: { time: string; available: boolean; appointmentId?: string }[] = [];
  for (let m = DAY_START; m + duration <= DAY_END; m += SLOT_MINUTES) {
    const clash = booked.find((a) => {
      const s = toMinutes(a.scheduledTime);
      return m < s + (a.duration ?? 30) && s < m + duration;
    });
    slots.push({
      time: toHHMM(m),
      available: !clash,
      appointmentId: clash?.appointmentId,
    });
  }

  res.json({ date: start.toISOString().slice(0, 10), slots });
});

export const patientAppointments = asyncHandler(async (req: Request, res: Response) => {
  const appointments = await Appointment.find({ patientId: req.params.patientId })
    .sort('scheduledDate scheduledTime')
    .populate(POPULATE)
    .lean();
  res.json({ appointments });
});

export const doctorWorkload = asyncHandler(async (req: Request, res: Response) => {
  const doctors = await User.find({ role: 'physician', isActive: true })
    .select('firstName lastName specialization department')
    .lean();

  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 7);

  const appointments = await Appointment.find({
    scheduledDate: { $gte: from, $lte: to },
    status: { $in: ['scheduled', 'confirmed'] },
  }).lean();

  res.json({
    doctors: doctors.map((d) => {
      const mine = appointments.filter((a) => String(a.doctorId) === String(d._id));
      return {
        ...d,
        fullName: `Dr. ${d.firstName} ${d.lastName}`,
        weekAppointments: mine.length,
        weekMinutes: mine.reduce((s, a) => s + (a.duration ?? 30), 0),
        byDay: Array.from({ length: 7 }, (_, i) => {
          const day = new Date(from);
          day.setDate(day.getDate() + i);
          const key = day.toISOString().slice(0, 10);
          return {
            date: key,
            count: mine.filter(
              (a) => new Date(a.scheduledDate).toISOString().slice(0, 10) === key
            ).length,
          };
        }),
      };
    }),
  });
});
