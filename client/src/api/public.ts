import type {
  PublicAgreementView,
  RegistrationInput,
  RegistrationSubmitted,
  UploadKind,
  UploadLimits,
  UploadedFileView,
} from '@fap/shared';
import { api } from './client';

/** The agreement currently shown on the registration page, or null when registration is closed. */
export const getActiveAgreement = () =>
  api<{ agreement: PublicAgreementView | null }>('/public/agreement').then((r) => r.agreement);

/** The active agreement plus the file size limits from Settings. */
export const getRegistrationForm = () =>
  api<{ agreement: PublicAgreementView | null; limits: UploadLimits }>('/public/registration-form');

/** Uploads one file straight away when the applicant picks it; returns a one-time token. */
export const uploadRegistrationFile = (kind: UploadKind, file: File) =>
  api<{ upload: UploadedFileView }>(`/public/uploads/${kind}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
    body: file,
  }).then((r) => r.upload);

export const submitRegistration = (input: RegistrationInput) =>
  api<RegistrationSubmitted>('/public/registrations', { method: 'POST', json: input });
