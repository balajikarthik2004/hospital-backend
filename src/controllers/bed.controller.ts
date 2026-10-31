import type { Request, Response } from 'express';
import { Bed } from '../models/Bed.js';
import { Admission } from '../models/Admission.js';
import { audit } from '../middleware/audit.js';
import { emit } from '../config/socket.js';
import { asyncHandler, badRequest, notFound } from '../utils/helpers.js';

const POPULATE = [
  { path: 'currentPatientId', select: 'patientId demographics status' },
  { path: 'currentAdmissionId', select: 'admissionId admittingDiagnosis admissionDate' },
];

export const listBeds = asyncHandler(async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = {};
  if (req.query.ward) filter.ward = req.query.ward;
  if (req.query.status) filter.status = req.query.status;

  const beds = await Bed.find(filter).sort('ward roomNumber bedNumber').populate(POPULATE).lean();
  const wards = [...new Set((await Bed.find().select('ward').lean()).map((b) => b.ward))];

  res.json({
    beds,
    wards,
    summary: {
      total: beds.length,
      available: beds.filter((b) => b.status === 'available').length,
      occupied: beds.filter((b) => b.status === 'occupied').length,
      maintenance: beds.filter((b) => b.status === 'maintenance').length,
      reserved: beds.filter((b) => b.status === 'reserved').length,
    },
  });
});

export const availableBeds = asyncHandler(async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = { status: 'available' };
  if (req.query.ward) filter.ward = req.query.ward;
  const beds = await Bed.find(filter).sort('ward roomNumber bedNumber').lean();
  res.json({ beds });
});

export const bedsByWard = asyncHandler(async (req: Request, res: Response) => {
  const beds = await Bed.find({ ward: req.params.ward })
    .sort('roomNumber bedNumber')
    .populate(POPULATE)
    .lean();
  res.json({ beds });
});

export const createBed = asyncHandler(async (req: Request, res: Response) => {
  const bed = await Bed.create(req.body);
  await audit(req, {
    action: 'bed.created',
    entity: 'beds',
    entityId: bed._id,
    description: `Created bed ${bed.ward} ${bed.roomNumber}-${bed.bedNumber}`,
  });
  res.status(201).json({ bed });
});

export const assignBed = asyncHandler(async (req: Request, res: Response) => {
  const bed = await Bed.findById(req.params.id);
  if (!bed) throw notFound('Bed');
  if (bed.status === 'occupied') throw badRequest('That bed is already occupied');
  if (bed.status === 'maintenance') throw badRequest('That bed is out of service');

  const { patientId, admissionId } = req.body as { patientId: string; admissionId?: string };

  bed.status = 'occupied';
  bed.currentPatientId = patientId as never;
  bed.currentAdmissionId = (admissionId ?? null) as never;
  await bed.save();

  if (admissionId) {
    await Admission.findByIdAndUpdate(admissionId, {
      bed: { ward: bed.ward, roomNumber: bed.roomNumber, bedNumber: bed.bedNumber },
    });
  }

  await audit(req, {
    action: 'bed.assigned',
    entity: 'beds',
    entityId: bed._id,
    patientId,
    description: `Assigned ${bed.ward} ${bed.roomNumber}-${bed.bedNumber}`,
    after: { status: 'occupied' },
  });

  emit('bed:status-changed', { bedId: bed._id, status: 'occupied', ward: bed.ward });
  res.json({ bed: await Bed.findById(bed._id).populate(POPULATE).lean() });
});

export const releaseBed = asyncHandler(async (req: Request, res: Response) => {
  const bed = await Bed.findById(req.params.id);
  if (!bed) throw notFound('Bed');

  const previousPatient = bed.currentPatientId;
  bed.status = 'available';
  bed.currentPatientId = null;
  bed.currentAdmissionId = null;
  await bed.save();

  await audit(req, {
    action: 'bed.released',
    entity: 'beds',
    entityId: bed._id,
    patientId: previousPatient as never,
    description: `Released ${bed.ward} ${bed.roomNumber}-${bed.bedNumber}`,
    after: { status: 'available' },
  });

  emit('bed:status-changed', { bedId: bed._id, status: 'available', ward: bed.ward });
  res.json({ bed });
});

export const updateBed = asyncHandler(async (req: Request, res: Response) => {
  const bed = await Bed.findByIdAndUpdate(req.params.id, req.body, { new: true }).lean();
  if (!bed) throw notFound('Bed');

  await audit(req, {
    action: 'bed.updated',
    entity: 'beds',
    entityId: bed._id,
    description: `Updated ${bed.ward} ${bed.roomNumber}-${bed.bedNumber}`,
    after: req.body,
  });

  emit('bed:status-changed', { bedId: bed._id, status: bed.status, ward: bed.ward });
  res.json({ bed });
});
