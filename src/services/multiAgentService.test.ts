import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MULTI_AGENTS,
  appointmentChat,
  dischargeSummary,
  hospitalAsk,
  medicationDetails,
  multiAgentHealth,
} from './multiAgentService.js';
import { HttpError } from '../utils/helpers.js';

/**
 * The client is tested against a stubbed `fetch` rather than a live service,
 * because what matters here is the contract at the boundary: that the
 * caller's identity is actually sent, that the service's own error text
 * survives, and that a "not found" stays a 404 instead of being reported as
 * a broken agent service.
 */

const originalFetch = globalThis.fetch;
let calls: { url: string; init: RequestInit }[] = [];

function stubFetch(responder: (url: string) => { status?: number; body: unknown }) {
  globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    const { status = 200, body } = responder(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

/* ── Health ─────────────────────────────────────────────────────────────── */

describe('multiAgentHealth', () => {
  it('reports what the service says about itself', async () => {
    stubFetch(() => ({
      body: {
        status: 'healthy',
        app_name: 'Hospital Multi-Agent System',
        database_connected: true,
        database_error: null,
      },
    }));

    const health = await multiAgentHealth();
    expect(health.online).toBe(true);
    expect(health.status).toBe('healthy');
    expect(health.databaseConnected).toBe(true);
  });

  it('does not claim health when the service cannot reach its database', async () => {
    stubFetch(() => ({
      body: {
        status: 'degraded',
        app_name: 'Hospital Multi-Agent System',
        database_connected: false,
        database_error: 'connection refused',
      },
    }));

    const health = await multiAgentHealth();
    expect(health.online).toBe(true);
    expect(health.databaseConnected).toBe(false);
    expect(health.databaseError).toBe('connection refused');
  });

  it('reports offline when the service is unreachable', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    const health = await multiAgentHealth();
    expect(health.online).toBe(false);
    expect(health.error).toContain('ECONNREFUSED');
  });

  it('reports offline on a non-2xx status', async () => {
    stubFetch(() => ({ status: 500, body: {} }));
    const health = await multiAgentHealth();
    expect(health.online).toBe(false);
    expect(health.error).toContain('500');
  });
});

/* ── Identity propagation ───────────────────────────────────────────────── */

describe('caller identity', () => {
  it('sends the caller identity the agent service authorises against', async () => {
    stubFetch(() => ({ body: { session_id: 's1', response: 'hi', status: 'success' } }));

    await appointmentChat('PAT-20260101-0001', 'hello');

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['X-Patient-Id']).toBe('PAT-20260101-0001');
  });

  it('sends a staff identity unchanged, so it is not mistaken for a patient', async () => {
    stubFetch(() => ({ body: { question: 'q', status: 'success', answer: 'a', sources: [] } }));

    await hospitalAsk('staff:physician:abc123', 'What are the visiting hours?');

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['X-Patient-Id']).toBe('staff:physician:abc123');
    expect(headers['X-Patient-Id'].startsWith('PAT')).toBe(false);
  });
});

/* ── Request shaping ────────────────────────────────────────────────────── */

describe('request shaping', () => {
  it('posts the appointment message and session to the right endpoint', async () => {
    stubFetch(() => ({ body: { session_id: 's9', response: 'ok', status: 'success' } }));

    await appointmentChat('PAT-1', 'Book me in', 's9');

    expect(calls[0].url).toContain('/api/v1/appointments/chat');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      message: 'Book me in',
      session_id: 's9',
    });
  });

  it('posts the medication record id', async () => {
    stubFetch(() => ({
      body: {
        medication_record_id: 'abc',
        status: 'success',
        record: {},
        explanation: 'text',
      },
    }));

    await medicationDetails('PAT-1', 'abc');

    expect(calls[0].url).toContain('/api/v1/medications/details');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      medication_record_id: 'abc',
      session_id: null,
    });
  });

  it('posts the discharge package id', async () => {
    stubFetch(() => ({
      body: { package_id: 'DIS-1', status: 'success', report: '# Report' },
    }));

    const result = await dischargeSummary('staff:physician:1', 'DIS-1');

    expect(calls[0].url).toContain('/api/v1/discharge-summaries/generate');
    expect(result.report).toBe('# Report');
  });

  it('posts the hospital question', async () => {
    stubFetch(() => ({
      body: { question: 'q', status: 'success', answer: 'a', sources: ['MongoDB'] },
    }));

    const result = await hospitalAsk('guest_visitor', 'Where is cardiology?');

    expect(calls[0].url).toContain('/api/v1/hospital/ask');
    expect(result.sources).toEqual(['MongoDB']);
  });
});

/* ── Error translation ──────────────────────────────────────────────────── */

describe('error translation', () => {
  it('keeps a 404 as a 404, because it is an answer about a record', async () => {
    stubFetch(() => ({
      status: 404,
      body: { detail: "Discharge package 'DIS-9' not found." },
    }));

    await expect(dischargeSummary('staff:physician:1', 'DIS-9')).rejects.toMatchObject({
      status: 404,
      message: "Discharge package 'DIS-9' not found.",
    });
  });

  it('keeps a 403 as a 403, so a refusal is not reported as an outage', async () => {
    stubFetch(() => ({
      status: 403,
      body: { detail: 'Access denied to this medication record.' },
    }));

    await expect(medicationDetails('PAT-2', 'abc')).rejects.toMatchObject({
      status: 403,
    });
  });

  it('reports a genuine service fault as a 502', async () => {
    stubFetch(() => ({ status: 500, body: { detail: 'boom' } }));

    await expect(hospitalAsk('guest_visitor', 'hi')).rejects.toMatchObject({
      status: 502,
      message: 'boom',
    });
  });

  it('reports an unreachable service as a 503', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    const error = await hospitalAsk('guest_visitor', 'hi').catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(503);
    expect(error.message).toContain('unavailable');
  });

  it('reports a timeout as a 504 with wording a patient can act on', async () => {
    globalThis.fetch = vi.fn(async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }) as unknown as typeof fetch;

    const error = await appointmentChat('PAT-1', 'hello').catch((e) => e);
    expect(error.status).toBe(504);
    expect(error.message).toContain('took too long');
  });

  it('falls back to the status line when the error body is not JSON', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 503,
        json: async () => {
          throw new Error('not json');
        },
      } as unknown as Response;
    }) as unknown as typeof fetch;

    await expect(hospitalAsk('guest_visitor', 'hi')).rejects.toMatchObject({
      status: 502,
      message: 'Agent service responded 503',
    });
  });
});

/* ── The published roster ───────────────────────────────────────────────── */

describe('agent roster', () => {
  it('describes all four independent agents', () => {
    expect(MULTI_AGENTS).toHaveLength(4);
    expect(MULTI_AGENTS.map((a) => a.key)).toEqual([
      'appointment',
      'medication',
      'discharge_summary',
      'general_hospital',
    ]);
  });

  it('gives every agent an endpoint and at least one capability', () => {
    for (const agent of MULTI_AGENTS) {
      expect(agent.endpoint).toMatch(/^\/api\/multi-agent\//);
      expect(agent.capabilities.length).toBeGreaterThan(0);
      expect(agent.name).toBeTruthy();
    }
  });
});
