import type {
  ApplicationStatus,
  ContactChangeStartInput,
  ContactKind,
  MyApplicationView,
  PublicAgreementView,
  PublicUser,
  RegistrationInput,
  SubmissionView,
  UploadKind,
  UploadLimits,
  UploadedFileView,
} from '@fap/shared';
import { api } from './client';

export const getMyApplication = () => api<{ application: MyApplicationView }>('/franchise/application').then((r) => r.application);

export const getMySubmission = (version: number) =>
  api<{ submission: SubmissionView }>(`/franchise/application/versions/${version}`).then((r) => r.submission);

/** Address of one of the user's own documents (checked by the server on every request). */
export const myDocumentUrl = (id: string) => `/api/franchise/documents/${id}`;

export const startContactChange = (input: ContactChangeStartInput) =>
  api<{ sentTo: string; active: boolean; expiresAt: string | null; resendAvailableAt: string | null }>('/franchise/profile/contact-change', { method: 'POST', json: input });

export const confirmContactChange = (kind: ContactKind, code: string) =>
  api<{ user: PublicUser }>('/franchise/profile/contact-change/confirm', { method: 'POST', json: { kind, code } }).then((r) => r.user);

// ---------- Edit & Resubmit ----------

export interface ResubmitForm {
  latestRejection: { stage: 'Accounts' | 'Manager'; reason: string; at: string } | null;
  submission: SubmissionView;
  agreement: PublicAgreementView;
  limits: UploadLimits;
}

export const getResubmitForm = () => api<{ form: ResubmitForm }>('/franchise/application/resubmit-form').then((r) => r.form);

export const resubmitApplication = (input: RegistrationInput) =>
  api<{ status: ApplicationStatus; version: number }>('/franchise/application/resubmit', { method: 'POST', json: input });

/** Replacement file chosen on Edit & Resubmit. */
export const uploadResubmissionFile = (kind: UploadKind, file: File) =>
  api<{ upload: UploadedFileView }>(`/franchise/uploads/${kind}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
    body: file,
  }).then((r) => r.upload);
