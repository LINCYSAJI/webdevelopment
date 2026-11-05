import type { Migration } from './index';

const migration: Migration = {
  id: '007-review-workflow',
  async up(db) {
    // Accounts queues: unassigned / assigned to me, oldest first.
    await db.collection('registrations').createIndex({ status: 1, assignedTo: 1, stageEnteredAt: 1 }, { name: 'status_assignee_stage' });
    // "My reviewed applications" and "approved/rejected by me this month".
    await db.collection('registrationhistories').createIndex({ actorId: 1, event: 1, at: -1 }, { name: 'actor_event_at' });
    await db.collection('assignmenthistories').createIndex({ registrationId: 1, at: 1 }, { name: 'registration_at' });
  },
};

export default migration;
