import { Router } from 'express';
import mongoose from 'mongoose';
import { asyncHandler } from '../lib/errors';

/**
 * Development only: the test mailbox. Mounted only when NODE_ENV is not production,
 * because it shows every email (including password links) to anyone who can open it.
 */
export const devRouter = Router();

devRouter.get(
  '/outbox',
  asyncHandler(async (_req, res) => {
    const emails = await mongoose.connection
      .db!.collection('dev_outbox')
      .find({})
      .sort({ at: -1 })
      .limit(50)
      .toArray();
    res.json({
      emails: emails.map((e) => ({ id: e._id.toString(), channel: e.channel ?? 'email', to: e.to, subject: e.subject, html: e.html, event: e.event, at: e.at })),
    });
  }),
);
