import { createServer } from 'node:http';
import { createApp } from './app.js';
import { connectDB, disconnectDB } from './config/db.js';
import { initSocket } from './config/socket.js';
import { env } from './config/env.js';
import { agentServiceHealthy } from './services/agentBridgeService.js';
import { llm } from './services/llmClient.js';
import { User } from './models/User.js';

async function main() {
  const { inMemory } = await connectDB();

  // An empty database is useless for a demo, so fill it on first start.
  let userCount = await User.estimatedDocumentCount().catch(() => 0);
  if (userCount === 0) {
    console.log('[seed] empty database detected — seeding the demo dataset');
    const { seedDatabase } = await import('../seed/seedDatabase.js');
    const stats = await seedDatabase((n, label) => console.log(`[seed]   ${n}. ${label}`));
    userCount = stats.users;
    console.log(
      `[seed] done — ${stats.patients} patients, ${stats.admissions} admissions, ` +
        `${stats.dischargePackages} discharge packages, ` +
        `${stats.flags.critical} critical medication flag(s)`
    );
  }

  const app = createApp();
  const httpServer = createServer(app);
  initSocket(httpServer);

  httpServer.listen(env.PORT, () => {
    console.log('');
    console.log('  SafeDischarge API');
    console.log(`  http://localhost:${env.PORT}/api`);
    console.log('');
  });

  const pythonOnline = await agentServiceHealthy();

  console.log(
    `  database        ${inMemory ? 'bundled local MongoDB (no mongod found)' : 'MongoDB'}`
  );
  console.log(
    `  agent engine    ${pythonOnline ? 'Python LangGraph service' : 'built-in TypeScript orchestrator'}`
  );
  console.log(
    `  LLM             ${llm.available ? `${env.ANTHROPIC_MODEL} via Anthropic API` : 'not configured — deterministic templates'}`
  );
  console.log(`  users           ${userCount}`);
  console.log('');
  console.log('  Sign in at http://localhost:5173 — dr.chen@safedischarge.demo / Demo@1234');
  console.log('');

  const shutdown = async (signal: string) => {
    console.log(`\n[server] ${signal} received, shutting down`);
    httpServer.close();
    await disconnectDB();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
