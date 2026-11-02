import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { env, isProd } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

import authRoutes from './routes/auth.routes.js';
import patientRoutes from './routes/patient.routes.js';
import admissionRoutes from './routes/admission.routes.js';
import vitalRoutes from './routes/vital.routes.js';
import medicationRoutes from './routes/medication.routes.js';
import prescriptionRoutes from './routes/prescription.routes.js';
import appointmentRoutes from './routes/appointment.routes.js';
import bedRoutes from './routes/bed.routes.js';
import dischargeRoutes from './routes/discharge.routes.js';
import agentRoutes from './routes/agent.routes.js';
import assistantRoutes from './routes/assistant.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import auditRoutes from './routes/audit.routes.js';
import userRoutes from './routes/user.routes.js';
import specialtyRoutes from './routes/specialty.routes.js';
import publicRoutes from './routes/public.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', true);
  app.use(cors({ origin: env.CLIENT_ORIGIN === '*' ? true : env.CLIENT_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  if (!isProd) app.use(morgan('dev'));

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'safedischarge-api',
      version: '1.0.0',
      time: new Date().toISOString(),
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/patients', patientRoutes);
  app.use('/api/admissions', admissionRoutes);
  app.use('/api/vitals', vitalRoutes);
  app.use('/api/medications', medicationRoutes);
  // Prescribing and the in-house pharmacy counter.
  app.use('/api/prescriptions', prescriptionRoutes);
  app.use('/api/appointments', appointmentRoutes);
  app.use('/api/beds', bedRoutes);
  app.use('/api/discharge', dischargeRoutes);
  app.use('/api/agents', agentRoutes);
  // The four independent specialist agents (MultiAgents/), for staff.
  app.use('/api/assistant', assistantRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/specialties', specialtyRoutes);
  // Unauthenticated: the hospital website, booking and the patient portal.
  app.use('/api/public', publicRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
