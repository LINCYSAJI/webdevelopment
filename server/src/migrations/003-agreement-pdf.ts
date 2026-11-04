import type { Migration } from './index';

const migration: Migration = {
  id: '003-agreement-pdf',
  async up(db) {
    // Versions created before PDF upload existed are typed (text) agreements. Nothing else changes.
    await db
      .collection('agreementversions')
      .updateMany({ format: { $exists: false } }, { $set: { format: 'text', pdf: null } });

    const acceptances = db.collection('agreementacceptances');
    await acceptances.createIndex({ registrationId: 1, acceptedAt: -1 }, { name: 'registration_acceptedat' });
    await acceptances.createIndex({ agreementVersionId: 1 }, { name: 'agreement_version' });
  },
};

export default migration;
