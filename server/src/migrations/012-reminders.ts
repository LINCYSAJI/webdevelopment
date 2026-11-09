import type { Migration } from './index';

const migration: Migration = {
  id: '012-reminders',
  async up(db) {
    const reminders = db.collection('reminderlogs');
    // Each reminder for a stage visit is sent at most once.
    await reminders.createIndex({ dedupeKey: 1 }, { unique: true, name: 'dedupe_unique' });
    await reminders.createIndex({ registrationId: 1, stageEnteredAt: 1, at: 1 }, { name: 'registration_stage' });
    await reminders.createIndex({ at: -1 }, { name: 'at' });

    await db.collection('jobruns').createIndex({ job: 1, startedAt: -1 }, { name: 'job_started' });

    // Unclaimed uploads used to vanish the moment they expired, leaving their stored file behind.
    // Keep the row for 7 more days so the daily clean-up can remove the file first, then the row.
    // (Only the index's timing changes; no data is removed by this migration.)
    const exists = await db.listCollections({ name: 'pendinguploads' }).hasNext();
    if (exists) {
      await db.command({ collMod: 'pendinguploads', index: { name: 'expiry_ttl', expireAfterSeconds: 7 * 86_400 } });
    }
  },
};

export default migration;
