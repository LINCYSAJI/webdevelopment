import type { Migration } from './index';

const migration: Migration = {
  id: '009-manager-agreements',
  async up(db) {
    // FRN/YYYY/NNNN is unique and never reused (PRD 10.5).
    await db.collection('registrations').createIndex(
      { agreementReferenceNo: 1 },
      { unique: true, name: 'agreement_reference_unique', partialFilterExpression: { agreementReferenceNo: { $type: 'string' } } },
    );
    const generated = db.collection('generatedagreements');
    await generated.createIndex({ registrationId: 1 }, { unique: true, name: 'registration_unique' });
    await generated.createIndex({ referenceNumber: 1 }, { unique: true, name: 'reference_unique' });
    await generated.createIndex({ status: 1, approvedAt: -1 }, { name: 'status_approved' });
    await db.collection('agreementemaillogs').createIndex({ generatedAgreementId: 1, at: -1 }, { name: 'agreement_at' });
  },
};

export default migration;
