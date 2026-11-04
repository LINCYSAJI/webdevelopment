import type { mongo } from 'mongoose';
import { migrations } from './index';

/**
 * Applies each migration once, in order, and records it in `_migrations`.
 * Migrations only ever add or reshape; they never drop data (CLAUDE.md rule 1).
 */
export async function runMigrations(db: mongo.Db): Promise<void> {
  const applied = db.collection<{ _id: string; appliedAt: Date }>('_migrations');
  for (const migration of migrations) {
    if (await applied.findOne({ _id: migration.id })) continue;
    console.log(`Applying migration ${migration.id}...`);
    await migration.up(db);
    await applied.insertOne({ _id: migration.id, appliedAt: new Date() });
  }
}
