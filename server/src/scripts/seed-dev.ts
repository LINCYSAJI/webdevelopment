/**
 * Development only: creates one Admin, one Accounts and one Manager login for testing.
 * Existing users are left untouched. Never run this against the production database.
 */
import mongoose from 'mongoose';
import type { Role } from '@fap/shared';
import { config } from '../config';
import { connectDb } from '../db';
import { runMigrations } from '../migrations/runner';
import { User } from '../models/User';
import { hashPassword } from '../services/auth.service';
import { audit } from '../services/audit.service';

if (config.isProduction) {
  console.error('seed:dev must not be run in production.');
  process.exit(1);
}

const DEV_PASSWORD = 'Portal@2026';
const devUsers: { name: string; email: string; username: string; role: Role }[] = [
  { name: 'Portal Admin', email: 'admin@portal.local', username: 'admin', role: 'admin' },
  { name: 'Asha (Accounts)', email: 'accounts@portal.local', username: 'accounts', role: 'accounts' },
  { name: 'Mohan (Manager)', email: 'manager@portal.local', username: 'manager', role: 'manager' },
];

await connectDb(3);
await runMigrations(mongoose.connection.db!);

for (const u of devUsers) {
  if (await User.exists({ email: u.email })) {
    console.log(`Exists:  ${u.email}`);
    continue;
  }
  const user = await User.create({ ...u, passwordHash: await hashPassword(DEV_PASSWORD) });
  await audit({ action: 'user_created', targetType: 'user', targetId: user._id.toString(), details: { role: u.role, source: 'seed:dev' } });
  console.log(`Created: ${u.email} (${u.role})`);
}

console.log(`\nDevelopment password for these users: ${DEV_PASSWORD}`);
await mongoose.disconnect();
