import type { Migration } from './index';

const migration: Migration = {
  id: '010-privacy',
  async up(db) {
    // Consent records (Terms & Conditions / Privacy Policy) per application.
    await db.collection('consentrecords').createIndex({ registrationId: 1, acceptedAt: -1 }, { name: 'registration_accepted' });

    // "Delete my account" requests: at most one pending request per user.
    const requests = db.collection('datarequests');
    await requests.createIndex(
      { userId: 1 },
      { unique: true, name: 'one_pending_per_user', partialFilterExpression: { status: 'pending' } },
    );
    await requests.createIndex({ status: 1, requestedAt: 1 }, { name: 'status_requested' });
    await requests.createIndex({ userId: 1, requestedAt: -1 }, { name: 'user_requested' });
  },
};

export default migration;
