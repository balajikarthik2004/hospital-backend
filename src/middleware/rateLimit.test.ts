import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { rateLimit } from './rateLimit.js';

/**
 * The route tests bypass the limiter — they share one IP and would throttle
 * themselves. It is therefore tested directly here, with NODE_ENV forced away
 * from 'test' so the production path actually runs.
 */

function run(
  mw: ReturnType<typeof rateLimit>,
  ip = '1.2.3.4'
): { status: number | null; error: string | null } {
  const req = { ip } as Request;
  const headers: Record<string, string> = {};
  const res = { setHeader: (k: string, v: string) => (headers[k] = v) } as unknown as Response;

  let captured: { status: number; message: string } | undefined;
  mw(req, res, ((err?: unknown) => {
    if (err) {
      const e = err as { status: number; message: string };
      captured = { status: e.status, message: e.message };
    }
  }) as never);

  if (!captured) return { status: null, error: null };
  return { status: captured.status, error: captured.message };
}

/** Runs `fn` with NODE_ENV set to something other than 'test'. */
function inProduction<T>(fn: () => T): T {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    return fn();
  } finally {
    process.env.NODE_ENV = previous;
  }
}

describe('rateLimit', () => {
  it('allows requests up to the limit and refuses the next one', () => {
    inProduction(() => {
      const mw = rateLimit({ windowMs: 60_000, max: 3 });
      expect(run(mw).status).toBeNull();
      expect(run(mw).status).toBeNull();
      expect(run(mw).status).toBeNull();

      const blocked = run(mw);
      expect(blocked.status).toBe(429);
      expect(blocked.error).toMatch(/too many requests/i);
    });
  });

  it('counts each caller separately', () => {
    inProduction(() => {
      const mw = rateLimit({ windowMs: 60_000, max: 1 });
      expect(run(mw, '10.0.0.1').status).toBeNull();
      expect(run(mw, '10.0.0.1').status).toBe(429);
      // A different caller must be unaffected by the first one's spending.
      expect(run(mw, '10.0.0.2').status).toBeNull();
    });
  });

  it('lets a caller back in once the window has passed', () => {
    vi.useFakeTimers();
    try {
      inProduction(() => {
        const mw = rateLimit({ windowMs: 1_000, max: 1 });
        expect(run(mw).status).toBeNull();
        expect(run(mw).status).toBe(429);

        vi.advanceTimersByTime(1_100);
        expect(run(mw).status).toBeNull();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('carries the caller-supplied message', () => {
    inProduction(() => {
      const mw = rateLimit({ windowMs: 60_000, max: 1, message: 'Please call the hospital.' });
      run(mw);
      expect(run(mw).error).toBe('Please call the hospital.');
    });
  });

  it('steps aside entirely under test, so suites do not throttle themselves', () => {
    const mw = rateLimit({ windowMs: 60_000, max: 1 });
    for (let i = 0; i < 50; i += 1) expect(run(mw).status).toBeNull();
  });
});
