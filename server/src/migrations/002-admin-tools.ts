import type { Migration } from './index';

const migration: Migration = {
  id: '002-admin-tools',
  async up(db) {
    const agreements = db.collection('agreementversions');
    await agreements.createIndex({ versionNumber: 1 }, { unique: true, name: 'version_number_unique' });
    // Guarantees exactly one active agreement version at any time.
    await agreements.createIndex(
      { status: 1 },
      { unique: true, name: 'single_active', partialFilterExpression: { status: 'active' } },
    );

    const tokens = db.collection('passwordtokens');
    await tokens.createIndex({ tokenHash: 1 }, { unique: true, name: 'token_hash_unique' });
    await tokens.createIndex({ userId: 1 }, { name: 'user' });
    await tokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expiry_ttl' });

    await db.collection('holidays').createIndex({ date: 1 }, { unique: true, name: 'date_unique' });

    const notifications = db.collection('notificationlogs');
    await notifications.createIndex({ at: -1 }, { name: 'at_desc' });
    await notifications.createIndex({ recipient: 1, at: -1 }, { name: 'recipient_at' });

    await db.collection('dev_outbox').createIndex({ at: -1 }, { name: 'at_desc' });
  },
};

export default migration;
