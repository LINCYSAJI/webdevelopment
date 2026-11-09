import mongoose from 'mongoose';
import { storage } from '../lib/storage';
import { AgreementAcceptance } from '../models/AgreementAcceptance';
import { ConsentRecord } from '../models/ConsentRecord';
import { DuplicateFlag } from '../models/DuplicateFlag';
import { Otp } from '../models/Otp';
import { PendingUpload } from '../models/PendingUpload';
import { Registration } from '../models/Registration';
import { RegistrationDocument } from '../models/RegistrationDocument';
import { RegistrationHistory } from '../models/RegistrationHistory';
import { getSettings } from '../models/Settings';
import { SubmissionVersion } from '../models/SubmissionVersion';
import { audit } from './audit.service';

/**
 * Scheduled clean-ups run by the daily check (PRD §6 "Pending Verification", A13, Privacy Policy
 * "Registrations never verified: deleted automatically").
 *
 * This is the second, and only other, permitted exception to "permanent records and stored files
 * are never deleted" (CLAUDE.md rule 9), besides the DPDP erasure in data-request.service.ts:
 * a registration that never completed verification never became an account or an application,
 * so the PRD requires it to be deleted with its files after the retention period in Settings.
 * The audit log and notification logs are kept (security logs, Privacy Policy).
 */

const BATCH = 200;

export interface CleanupResult {
  unverifiedRemoved: number;
  uploadsRemoved: number;
  problems: string[];
}

async function removeFiles(keys: string[], what: string, problems: string[]) {
  const results = await Promise.allSettled([...new Set(keys)].map((k) => storage.remove(k)));
  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed) problems.push(`${failed} stored file(s) of ${what} could not be deleted`);
}

/** Deletes registrations left in Pending Verification for longer than the retention period. */
export async function purgeUnverifiedRegistrations(now = new Date()): Promise<{ removed: number; problems: string[] }> {
  const settings = await getSettings();
  const cutoff = new Date(now.getTime() - settings.pendingVerificationRetentionDays * 86_400_000);
  const expired = await Registration.find({ status: 'pending_verification', userId: null, submittedAt: { $lt: cutoff } }, { _id: 1 }).limit(BATCH);
  const problems: string[] = [];
  let removed = 0;

  for (const { _id: registrationId } of expired) {
    const files = (await RegistrationDocument.find({ registrationId }, { storageKey: 1 })).map((d) => d.storageKey);
    let deleted = false;
    await mongoose.connection.transaction(async (session) => {
      // Conditional: if the applicant completed verification a moment ago, nothing is deleted.
      const res = await Registration.deleteOne({ _id: registrationId, status: 'pending_verification', userId: null }, { session });
      deleted = res.deletedCount === 1;
      if (!deleted) return;
      // These collections are permanent everywhere else, so their guards are bypassed ONLY here
      // and in the DPDP erasure.
      const filter = { registrationId };
      await SubmissionVersion.collection.deleteMany(filter, { session });
      await RegistrationDocument.collection.deleteMany(filter, { session });
      await AgreementAcceptance.collection.deleteMany(filter, { session });
      await ConsentRecord.collection.deleteMany(filter, { session });
      await RegistrationHistory.collection.deleteMany(filter, { session });
      await DuplicateFlag.collection.deleteMany(filter, { session });
      await PendingUpload.collection.deleteMany({ claimedBy: registrationId }, { session });
      await Otp.collection.deleteMany({ subjectKey: `reg:${registrationId}` }, { session });
      await audit(
        { action: 'unverified_registration_removed', targetType: 'registration', targetId: registrationId.toString(), details: { retentionDays: settings.pendingVerificationRetentionDays, files: files.length } },
        session,
      );
    });
    if (!deleted) continue;
    removed++;
    await removeFiles(files, `unverified registration ${registrationId}`, problems);
  }
  return { removed, problems };
}

/** Deletes files uploaded on the registration page that were never submitted (expired after 24 hours). */
export async function removeExpiredUploads(now = new Date()): Promise<{ removed: number; problems: string[] }> {
  const expired = await PendingUpload.find({ claimedBy: null, expiresAt: { $lt: now } }, { storageKey: 1 }).limit(BATCH * 5);
  const problems: string[] = [];
  let removed = 0;
  for (const upload of expired) {
    // Expired uploads can no longer be claimed, so the conditional delete cannot race a submission.
    const res = await PendingUpload.deleteOne({ _id: upload._id, claimedBy: null });
    if (res.deletedCount !== 1) continue;
    removed++;
    await removeFiles([upload.storageKey], 'an unused upload', problems);
  }
  return { removed, problems };
}

export async function runCleanups(now = new Date()): Promise<CleanupResult> {
  const [registrations, uploads] = [await purgeUnverifiedRegistrations(now), await removeExpiredUploads(now)];
  return { unverifiedRemoved: registrations.removed, uploadsRemoved: uploads.removed, problems: [...registrations.problems, ...uploads.problems] };
}
