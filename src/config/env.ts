import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(5000),
  MONGODB_URI: z.string().default('mongodb://localhost:27017/safedischarge'),
  /**
   * Refuse to start rather than fall back to the bundled local MongoDB when
   * MONGODB_URI is unreachable. Worth turning on anywhere the database is
   * real — a silent fallback there looks like missing data, not like a
   * connection problem.
   */
  DB_STRICT: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  JWT_SECRET: z.string().min(8).default('safedischarge-dev-secret-change-me'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5-5'),
  /**
   * The Python multi-agent service (Appointment, Medication, Discharge
   * Summary and General Hospital agents). It reads the same MongoDB this
   * backend writes, so it is a sibling service rather than a data source.
   * When it is down, /api/multi-agent reports it as offline and the clinical
   * workflow is unaffected.
   */
  MULTI_AGENT_SERVICE_URL: z.string().default('http://localhost:8001'),
  /** How long to wait on an agent turn. LLM calls are slow; booking is worth the wait. */
  MULTI_AGENT_TIMEOUT_MS: z.coerce.number().default(120_000),
  CLIENT_ORIGIN: z.string().default('*'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
