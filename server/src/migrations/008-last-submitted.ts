import type { Migration } from './index';

const migration: Migration = {
  id: '008-last-submitted',
  async up(db) {
    // "Submitted / Resubmitted On" (PRD A2): existing applications were last submitted when first submitted.
    await db
      .collection('registrations')
      .updateMany({ lastSubmittedAt: { $exists: false } }, [{ $set: { lastSubmittedAt: '$submittedAt' } }]);
  },
};

export default migration;
