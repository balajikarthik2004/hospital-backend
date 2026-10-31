import { mkdirSync, readFileSync } from 'node:fs';
import { getServers, setServers } from 'node:dns';
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

  const connect = () =>
    // 3s was too tight to be a fair test of Atlas. A first connection to a
    // shared-tier cluster has to do an SRV lookup, a TLS handshake and
    // sometimes wake the cluster, which routinely runs past three seconds on
    // a normal connection — so the old timeout could report "unreachable"
    // for a cluster that was merely slow, and silently fall through to a
    // different database. A local mongod still answers in milliseconds.
    mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: atlas ? 15_000 : 3000,
    });

  try {
    await connect();
    console.log(`[db] connected to ${redact(env.MONGODB_URI)}`);
    return { uri: env.MONGODB_URI, inMemory: false };
  } catch (err) {
    let reason = (err as Error).message;

    /* A `mongodb+srv://` URI is resolved by asking DNS for an SRV record,
       and plenty of office and VPN resolvers answer ordinary A queries
       while refusing SRV outright — which surfaces here as
       "querySrv ECONNREFUSED" and makes a perfectly healthy cluster look
       unreachable. (The giveaway is that `nslookup -type=SRV` on the same
       machine succeeds: the system resolver is fine, the one Node was
       handed is not.)

       So: on that specific failure, ask a public resolver instead and try
       once more. This is narrow on purpose — it runs only for an SRV error,
       only once, and changes nothing when DNS was never the problem. */
    if (/querySrv|ESERVFAIL|ECONNREFUSED/i.test(reason) && atlas) {
      try {
        const current = getServers();
        const publicDns = ['1.1.1.1', '8.8.8.8'];
        if (!publicDns.some((s) => current.includes(s))) {
          console.warn(
            `[db] SRV lookup failed via the system resolver (${current.join(', ') || 'default'}) — ` +
              `retrying through ${publicDns.join(' / ')}`
          );
          setServers([...publicDns, ...current]);
          await connect();
          console.log(`[db] connected to ${redact(env.MONGODB_URI)} (public DNS)`);
          return { uri: env.MONGODB_URI, inMemory: false };
        }
      } catch (retryErr) {
        reason = (retryErr as Error).message;
      }
    }

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
  assertDataDirFree();

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

/**
 * Refuse to start a second mongod on a data directory another one already
 * owns.
 *
 * Two copies of `npm run dev` is the normal way to hit this, and the failure
 * it produces unaided is genuinely baffling: mongod starts, finds the lock
 * held, logs its shutdown over several lines, and mongodb-memory-server's
 * log reader — which parses each chunk as one JSON object — dies on the
 * second line with "Unexpected non-whitespace character after JSON". The
 * stack is entirely inside node_modules and says nothing about locks, so the
 * obvious reading is a corrupt database. It is not; it is just already open.
 */
function assertDataDirFree(): void {
  const lockFile = resolve(FALLBACK_DB_PATH, 'mongod.lock');
  let pid: number;
  try {
    // An empty lock file is what a clean shutdown leaves behind.
    const raw = readFileSync(lockFile, 'utf8').trim();
    if (!raw) return;
    pid = Number(raw);
    if (!Number.isInteger(pid) || pid <= 0) return;
  } catch {
    return; // No lock file at all: nothing is holding the directory.
  }

  try {
    // Signal 0 tests for the process without touching it. It throws ESRCH
    // when nothing is there, which means the lock is stale and mongod will
    // clear it itself.
    process.kill(pid, 0);
  } catch {
    return;
  }

  throw new Error(
    `[db] ${FALLBACK_DB_PATH} is already in use by mongod (pid ${pid}).\n` +
      '[db] Another copy of the server is almost certainly still running — ' +
      'two cannot share the bundled database.\n' +
      '[db] Stop the other one and start again, or point MONGODB_URI at a ' +
      'reachable MongoDB so neither needs the fallback.'
  );
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
