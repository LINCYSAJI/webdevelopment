import type { Migration } from './index';

const migration: Migration = {
  id: '004-registrations',
  async up(db) {
    const registrations = db.collection('registrations');
    // One registration per PAN, and per GST when given. Only set once verified (see Registration model).
    await registrations.createIndex(
      { panLock: 1 },
      { unique: true, name: 'pan_unique', partialFilterExpression: { panLock: { $type: 'string' } } },
    );
    await registrations.createIndex(
      { gstLock: 1 },
      { unique: true, name: 'gst_unique', partialFilterExpression: { gstLock: { $type: 'string' } } },
    );
    await registrations.createIndex(
      { applicationId: 1 },
      { unique: true, name: 'application_id_unique', partialFilterExpression: { applicationId: { $type: 'string' } } },
    );
    await registrations.createIndex(
      { 'verification.tokenHash': 1 },
      { unique: true, name: 'verification_token_unique', partialFilterExpression: { 'verification.tokenHash': { $type: 'string' } } },
    );
    await registrations.createIndex({ status: 1, submittedAt: -1 }, { name: 'status_submitted' });
    await registrations.createIndex({ pan: 1 }, { name: 'pan' });
    await registrations.createIndex({ 'signatory.email': 1 }, { name: 'signatory_email' });
    await registrations.createIndex({ 'signatory.mobile': 1 }, { name: 'signatory_mobile' });
    await registrations.createIndex({ 'contacts.email': 1 }, { name: 'contact_email' });
    await registrations.createIndex({ 'contacts.mobile': 1 }, { name: 'contact_mobile' });
    await registrations.createIndex({ userId: 1 }, { name: 'user', partialFilterExpression: { userId: { $type: 'objectId' } } });

    await db.collection('documents').createIndex({ registrationId: 1, submissionVersion: 1 }, { name: 'registration_version' });
    await db
      .collection('submissionversions')
      .createIndex({ registrationId: 1, version: 1 }, { unique: true, name: 'registration_version_unique' });
    await db.collection('duplicateflags').createIndex({ registrationId: 1 }, { name: 'registration' });
    await db.collection('duplicateflags').createIndex({ status: 1, createdAt: -1 }, { name: 'status_created' });

    const uploads = db.collection('pendinguploads');
    await uploads.createIndex({ tokenHash: 1 }, { unique: true, name: 'token_hash_unique' });
    // Unclaimed uploads disappear after their expiry time; claimed ones are kept.
    await uploads.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'expiry_ttl', partialFilterExpression: { claimedBy: null } },
    );
  },
};

export default migration;
