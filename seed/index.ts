/**
 * CLI entry point: `npm run seed`.
 * Safe to re-run — it clears the collections it owns first.
 */
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { seedDatabase } from './seedDatabase.js';
import { DEMO_PASSWORD } from './users.seed.js';

async function run() {
  const { inMemory } = await connectDB();

  if (inMemory) {
    console.log('');
    console.log('  NOTE: no mongod was reachable, so this used the bundled local MongoDB.');
    console.log('  That instance belongs to this process, so the API server seeds itself');
    console.log('  on first start. Set MONGODB_URI to keep the data in your own MongoDB.');
    console.log('');
  }

  console.log('Seeding...');
  const stats = await seedDatabase((n, label) => console.log(`  ${n}. ${label}`));

  console.log('');
  console.log('Seed complete:');
  console.log(`  users               ${stats.users}`);
  console.log(`  patients            ${stats.patients}`);
  console.log(`  beds                ${stats.beds}`);
  console.log(`  admissions          ${stats.admissions} (${stats.activeAdmissions} active)`);
  console.log(`  medication lists    ${stats.medicationLists}`);
  console.log(`  vitals              ${stats.vitals}`);
  console.log(`  appointments        ${stats.appointments}`);
  console.log(`  discharge packages  ${stats.dischargePackages}`);
  console.log(`  audit entries       ${stats.auditEntries}`);
  console.log('');
  console.log('  Medication flags raised by the reconciliation agent:');
  for (const sev of ['critical', 'high', 'medium', 'low'] as const) {
    console.log(`    ${sev.padEnd(9)} ${stats.flags[sev]}`);
  }
  console.log('');
  console.log(`  All demo accounts use the password: ${DEMO_PASSWORD}`);
  console.log('    dr.sharma@safedischarge.demo      physician');
  console.log('    rx.patel@safedischarge.demo     pharmacist');
  console.log('    rn.iyer@safedischarge.demo   nurse');
  console.log('    admin@safedischarge.demo        admin');
  console.log('    cc.kulkarni@safedischarge.demo  care coordinator');
  console.log('    patient@safedischarge.demo      patient');
  console.log('');

  await disconnectDB();
  await mongoose.connection.close().catch(() => {});
  process.exit(0);
}

run().catch(async (err) => {
  console.error('Seed failed:', err);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
