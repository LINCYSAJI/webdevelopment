/**
 * Creates an Admin login and emails them a one-time set-password link (docs/GO-LIVE.md, step 4).
 * There is no public way to create an Admin (CLAUDE.md rule 5); this is how the first one is made.
 * No password is ever typed or shown here. Refuses if the email or username is already in use.
 *
 *   npm run create-admin -w server -- --name "Your Name" --email you@company.in --username admin
 */
import mongoose from 'mongoose';
import { internalUserSchema } from '@fap/shared';
import { connectDb } from '../db';
import { runMigrations } from '../migrations/runner';
import { User } from '../models/User';
import { audit } from '../services/audit.service';
import { sendInvite } from '../services/password.service';

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? '') : '';
}

const parsed = internalUserSchema.safeParse({ name: arg('name'), email: arg('email'), username: arg('username'), mobile: arg('mobile') });
if (!parsed.success) {
  console.error('Usage: npm run create-admin -w server -- --name "Your Name" --email you@company.in --username admin [--mobile 9876543210]');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}
const data = parsed.data;

await connectDb(3);
await runMigrations(mongoose.connection.db!);

if (await User.exists({ $or: [{ email: data.email }, { username: data.username }] })) {
  console.error('A user with this email or username already exists. Nothing was changed.');
  await mongoose.disconnect();
  process.exit(1);
}

const user = await User.create({ name: data.name, email: data.email, username: data.username, mobile: data.mobile ?? undefined, role: 'admin' });
await audit({ action: 'user_created', targetType: 'user', targetId: user._id.toString(), details: { role: 'admin', source: 'create-admin script' } });
const sent = await sendInvite(user);
console.log(`Admin created: ${data.email}`);
console.log(sent ? 'A set-password link has been emailed to them (valid for a limited time).' : 'The set-password email could NOT be sent. Fix the email settings, then use "Forgot password" on the login page.');
await mongoose.disconnect();
