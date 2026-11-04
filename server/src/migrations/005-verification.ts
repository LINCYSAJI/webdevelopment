import type { Migration } from './index';

const migration: Migration = {
  id: '005-verification',
  async up(db) {
    const otps = db.collection('otps');
    await otps.createIndex({ subjectKey: 1, purpose: 1, channel: 1, createdAt: -1 }, { name: 'subject_latest' });
    // Expired codes are removed automatically (PRD §12 allows deleting expired OTPs).
    await otps.createIndex({ deleteAt: 1 }, { expireAfterSeconds: 0, name: 'delete_ttl' });

    await db.collection('registrationhistories').createIndex({ registrationId: 1, at: 1 }, { name: 'registration_at' });
    await db.collection('registrations').createIndex({ status: 1, stageEnteredAt: 1 }, { name: 'status_stage_entered' });
  },
};

export default migration;
