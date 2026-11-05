import type { ClientSession, Types } from 'mongoose';
import { LEGAL_CONSENT_TEXT, LEGAL_DOCUMENTS } from '@fap/shared';
import { ConsentRecord } from '../models/ConsentRecord';

/**
 * Saves proof that the applicant accepted the current Terms & Conditions and Privacy Policy
 * (DPDP Act s.6). Call it inside the submission's transaction so it is saved with it or not at all.
 */
export async function recordConsent(
  input: { registrationId: Types.ObjectId; userId?: Types.ObjectId | null; submissionVersion: number; acceptedAt: Date; ip?: string; userAgent?: string },
  session: ClientSession,
) {
  await ConsentRecord.create(
    [
      {
        ...input,
        userId: input.userId ?? null,
        termsVersion: LEGAL_DOCUMENTS.terms.version,
        privacyVersion: LEGAL_DOCUMENTS.privacy.version,
        text: LEGAL_CONSENT_TEXT,
      },
    ],
    { session },
  );
}
