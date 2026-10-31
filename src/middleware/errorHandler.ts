import type { Request, Response, NextFunction } from 'express';
import { HttpError } from '../utils/helpers.js';
import { isProd } from '../config/env.js';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` });
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details ?? undefined });
    return;
  }

  // Mongo duplicate key
  const anyErr = err as unknown as { code?: number; keyValue?: Record<string, unknown> };
  if (anyErr.code === 11000) {
    res.status(409).json({
      error: 'Duplicate value',
      details: anyErr.keyValue,
    });
    return;
  }

  if (err.name === 'ValidationError' || err.name === 'CastError') {
    res.status(400).json({ error: err.message });
    return;
  }

  console.error('[error]', err);
  res.status(500).json({
    error: 'Internal server error',
    details: isProd ? undefined : err.message,
  });
}
