import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { env } from './env.js';

let memoryServer: { stop: (opts?: { doCleanup?: boolean }) => Promise<boolean> } | null = null;

const here = dirname(fileURLToPath(import.meta.url));
/** Where the in-memory fallback keeps its data files so seeds survive a restart. */
const FALLBACK_DB_PATH = resolve(here, '../../.mongodb-data');

/**
 * Connects to MONGODB_URI. If that server is unreachable (common on a fresh
 * dev machine with no local mongod) we transparently start a bundled MongoDB
 * against a local data directory, so the app is fully functional and seeded
 * data persists between `npm run seed` and `npm run dev`.
 */
export async function connectDB(): Promise<{ uri: string; inMemory: boolean }> {
  mongoose.set('strictQuery', true);

  const atlas = /mongodb\+srv:\/\//.test(env.MONGODB_URI);

  try {
    // 3s was too tight to be a fair test of Atlas. A first connection to a
    // shared-tier cluster has to do an SRV lookup, a TLS handshake and
    // sometimes wake the cluster, which routinely runs past three seconds on
    // a normal connection — so the old timeout could report "unreachable"
    // for a cluster that was merely slow, and silently fall through to a
    // different database. A local mongod still answers in milliseconds.
    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: atlas ? 15_000 : 3000,
    });
    console.log(`[db] connected to ${redact(env.MONGODB_URI)}`);
    return { uri: env.MONGODB_URI, inMemory: false };
  } catch (err) {
    const reason = (err as Error).message;

    // Falling back swaps the database out from under the application. That
    // is a reasonable convenience on a fresh machine with no mongod, and a
    // genuinely bad surprise when MONGODB_URI points at a real cluster that
    // happens to be unreachable: the app comes up looking healthy, serving
    // an empty local database, and the missing data reads as a bug in the
    // frontend. Set DB_STRICT=true to refuse to start instead.
    if (env.DB_STRICT) {
      throw new Error(
        `[db] cannot reach ${redact(env.MONGODB_URI)} — ${reason}\n` +
          '[db] DB_STRICT is set, so the bundled fallback was not started.'
      );
    }

    console.warn('');
    console.warn('  ┌──────────────────────────────────────────────────────────────┐');
    console.warn('  │  NOT CONNECTED TO YOUR CONFIGURED DATABASE                   │');
    console.warn('  └──────────────────────────────────────────────────────────────┘');
    console.warn(`  could not reach : ${redact(env.MONGODB_URI)}`);
    console.warn(`  reason          : ${reason}`);
    console.warn('  falling back to : bundled local MongoDB (separate, and empty');
    console.warn('                    until you run `npm run seed`)');
    if (/not.*whitelist|IP that isn't whitelisted|ECONNREFUSED|ETIMEDOUT/i.test(reason)) {
      console.warn('');
      console.warn('  This usually means this machine\'s IP is not on the cluster\'s');
      console.warn('  access list. In Atlas: Network Access → Add IP Address.');
    }
    console.warn('');
  }

  const mod = await import('mongodb-memory-server').catch(() => null);
  if (!mod) {
    throw new Error(
      'MongoDB is unreachable and the bundled fallback is not installed.\n' +
        'Either start MongoDB (or point MONGODB_URI at an Atlas cluster), or run:\n' +
        '  npm --prefix server install mongodb-memory-server'
    );
  }

  mkdirSync(FALLBACK_DB_PATH, { recursive: true });

  const server = await mod.MongoMemoryServer.create({
    instance: {
      dbName: 'safedischarge',
      dbPath: FALLBACK_DB_PATH,
      storageEngine: 'wiredTiger',
    },
  });

  memoryServer = server;
  const uri = server.getUri('safedischarge');
  await mongoose.connect(uri);
  console.log(`[db] bundled MongoDB ready (data in ${FALLBACK_DB_PATH})`);
  return { uri, inMemory: true };
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
  if (memoryServer) {
    // Keep the data directory so seeded data survives until the next seed run.
    await memoryServer.stop({ doCleanup: false });
    memoryServer = null;
  }
}

function redact(uri: string): string {
  return uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
}
