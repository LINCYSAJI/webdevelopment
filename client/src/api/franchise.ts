import type { ContactChangeStartInput, ContactKind, MyApplicationView, PublicUser, SubmissionView } from '@fap/shared';
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
