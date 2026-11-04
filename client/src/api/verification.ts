import type { OtpChannel, PublicUser, RegistrationCompleted, VerificationStatus } from '@fap/shared';
import { api } from './client';

// The verification token comes from Register and is sent in the request body only.

export const getVerificationStatus = (token: string) =>
  api<{ status: VerificationStatus }>('/public/verification/status', { method: 'POST', json: { token } }).then((r) => r.status);

export const sendVerificationCode = (token: string, channel: OtpChannel) =>
  api<{ status: VerificationStatus }>('/public/verification/send', { method: 'POST', json: { token, channel } }).then((r) => r.status);

export const verifyCode = (token: string, channel: OtpChannel, code: string) =>
  api<{ status: VerificationStatus }>('/public/verification/verify', { method: 'POST', json: { token, channel, code } }).then((r) => r.status);

export const completeRegistration = (token: string, password: string, confirmPassword: string) =>
  api<RegistrationCompleted & { user: PublicUser }>('/public/verification/complete', {
    method: 'POST',
    json: { token, password, confirmPassword },
  });
