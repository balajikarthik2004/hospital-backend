import type { Request, Response, NextFunction } from 'express';
import { HttpError } from '../utils/helpers.js';

/**
 * A small fixed-window limiter for the unauthenticated endpoints.
 *
 * The public booking and portal-lookup routes have no token in front of them,
 * so without this the portal lookup is an oracle: a script could walk phone
 * numbers and dates of birth until a chart opened. In-process and per-pod,
 * which is the honest limit of it — behind more than one instance this wants
 * Redis, and a reverse proxy should be limiting too.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

export function rateLimit(options: {
  windowMs: number;
  max: number;
  /** Shown to the caller when they run out. */
  message?: string;
  /** Defaults to the client IP. */
  key?: (req: Request) => string;
}) {
  const { windowMs, max, message = 'Too many requests. Please try again shortly.' } = options;
  const buckets = new Map<string, Bucket>();

  // Stale buckets would otherwise accumulate one entry per IP, forever.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }, windowMs);
  // Never hold the process open just to tidy a Map.
  sweep.unref?.();

  return (req: Request, res: Response, next: NextFunction): void => {
    // Route tests exercise behaviour, not throttling, and every request in a
    // suite shares one IP. The limiter has its own unit test instead.
    if (process.env.NODE_ENV === 'test') return next();

    const key = options.key?.(req) ?? req.ip ?? 'unknown';
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      res.setHeader('X-RateLimit-Remaining', String(max - 1));
      return next();
    }

    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return next(new HttpError(429, message));
    }

    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    next();
  };
}
