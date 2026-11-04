import type { Migration } from './index';

const migration: Migration = {
  id: '001-users-sessions-audit',
  async up(db) {
    const users = db.collection('users');
    await users.createIndex({ email: 1 }, { unique: true, name: 'email_unique' });
    await users.createIndex(
      { mobile: 1 },
      { unique: true, name: 'mobile_unique', partialFilterExpression: { mobile: { $type: 'string' } } },
    );
    await users.createIndex(
      { username: 1 },
      { unique: true, name: 'username_unique', partialFilterExpression: { username: { $type: 'string' } } },
    );
    await users.createIndex({ role: 1, isActive: 1 }, { name: 'role_active' });

    const sessions = db.collection('sessions');
    await sessions.createIndex({ tokenHash: 1 }, { unique: true, name: 'token_hash_unique' });
    await sessions.createIndex({ userId: 1 }, { name: 'user' });
    // Expired sessions are removed automatically by MongoDB.
    await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expiry_ttl' });

    const auditLogs = db.collection('auditlogs');
    await auditLogs.createIndex({ at: -1 }, { name: 'at_desc' });
    await auditLogs.createIndex({ userId: 1, at: -1 }, { name: 'user_at' });
    await auditLogs.createIndex({ targetType: 1, targetId: 1 }, { name: 'target' });
  },
};

export default migration;
