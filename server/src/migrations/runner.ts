import { randomUUID } from 'node:crypto';
import type { mongo } from 'mongoose';
import { duplicateKeyField } from '../lib/mongo-errors';
import { migrations } from './index';

const LOCK_ID = 'migrations';
/** A lock older than this is assumed to belong to a server that crashed mid-migration. */
const LOCK_TTL_MS = 10 * 60_000;
const WAIT_STEP_MS = 1000;
const MAX_WAIT_MS = 15 * 60_000;

type LockDoc = { _id: string; owner: string | null; lockedUntil: Date | null };

/**
 * Takes the migration lock, waiting while another server instance holds it. Only one instance
 * runs migrations at a time; the others wait and then find everything already applied.
 */
async function acquireLock(db: mongo.Db, owner: string) {
  const locks = db.collection<LockDoc>('_migration_lock');
  const deadline = Date.now() + MAX_WAIT_MS;
  for (;;) {
    const now = new Date();
    try {
      // Free (never taken, released, or expired): take it. Held: the upsert's insert hits the
      // unique _id and fails, which means "someone else is migrating".
      await locks.findOneAndUpdate(
        { _id: LOCK_ID, $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }] },
        { $set: { owner, lockedUntil: new Date(now.getTime() + LOCK_TTL_MS) } },
        { upsert: true },
      );
      return;
    } catch (err) {
      if (!duplicateKeyField(err)) throw err;
    }
    if (Date.now() > deadline) throw new Error('Timed out waiting for another server to finish database migrations.');
    await new Promise((r) => setTimeout(r, WAIT_STEP_MS));
  }
}

async function releaseLock(db: mongo.Db, owner: string) {
  await db.collection<LockDoc>('_migration_lock').updateOne({ _id: LOCK_ID, owner }, { $set: { owner: null, lockedUntil: null } });
}

/**
 * Applies each migration once, in order, and records it in `_migrations`.
 * Migrations only ever add or reshape; they never drop data (CLAUDE.md rule 1).
 * Safe to call from several server instances starting at the same time.
 */
export async function runMigrations(db: mongo.Db): Promise<void> {
  const applied = db.collection<{ _id: string; appliedAt: Date }>('_migrations');
  const owner = randomUUID();
  await acquireLock(db, owner);
  try {
    for (const migration of migrations) {
      if (await applied.findOne({ _id: migration.id })) continue;
      console.log(`Applying migration ${migration.id}...`);
      await migration.up(db);
      await applied.insertOne({ _id: migration.id, appliedAt: new Date() });
    }
  } finally {
    await releaseLock(db, owner);
  }
}
