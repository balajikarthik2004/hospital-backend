import type { Request, Response, NextFunction } from 'express';

/** Wraps an async route handler so rejected promises reach the error handler. */
export function asyncHandler<T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as T, res, next)).catch(next);
  };
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const forbidden = (msg = 'Insufficient permissions') => new HttpError(403, msg);

export function paginate(query: Record<string, unknown>) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 25));
  return { page, limit, skip: (page - 1) * limit };
}

export function age(dateOfBirth: Date | string): number {
  const diff = Date.now() - new Date(dateOfBirth).getTime();
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
}

export function daysBetween(a: Date | string, b: Date | string): number {
  return Math.round(
    (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000
  );
}

export function addDays(date: Date | string, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(',')),
  ].join('\n');
}
