import type { Migration } from './index';

const migration: Migration = {
  id: '006-otp-throttle',
  async up(db) {
    // Resend-limit rows are only needed for the one-hour window; remove them after two hours.
    await db.collection('otpthrottles').createIndex({ lastSentAt: 1 }, { expireAfterSeconds: 7200, name: 'last_sent_ttl' });
  },
};

export default migration;
