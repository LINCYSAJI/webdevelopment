import type { Migration } from './index';

const migration: Migration = {
  id: '011-sms',
  async up(db) {
    const logs = db.collection('smslogs');
    // Each notification is sent at most once (a second attempt to create the same key fails).
    await logs.createIndex({ dedupeKey: 1 }, { unique: true, name: 'dedupe_unique', partialFilterExpression: { dedupeKey: { $type: 'string' } } });
    await logs.createIndex({ createdAt: -1 }, { name: 'created' });
    await logs.createIndex({ status: 1, createdAt: -1 }, { name: 'status_created' });
    await logs.createIndex({ submissionId: 1 }, { name: 'submission', partialFilterExpression: { submissionId: { $type: 'string' } } });
    await logs.createIndex({ registrationId: 1 }, { name: 'registration', partialFilterExpression: { registrationId: { $type: 'objectId' } } });
  },
};

export default migration;
