import type { Branding, ChangePasswordInput, LoginInput, PublicUser, SetPasswordInput } from '@fap/shared';
import { api, refreshSession } from './client';

export const login = (input: LoginInput) =>
  api<{ user: PublicUser }>('/auth/login', { method: 'POST', json: input }).then((r) => r.user);

export const logout = () => api<{ ok: true }>('/auth/logout', { method: 'POST' });

/** Returns the signed-in user, or null if nobody is signed in. */
export async function getCurrentUser(): Promise<PublicUser | null> {
  try {
    return (await api<{ user: PublicUser }>('/auth/me')).user;
  } catch {
    if (await refreshSession()) {
      return (await api<{ user: PublicUser }>('/auth/me')).user;
    }
    return null;
  }
}

export const getBranding = () => api<{ branding: Branding }>('/public/branding').then((r) => r.branding);

export const forgotPassword = (identifier: string) =>
  api<{ ok: true }>('/auth/forgot-password', { method: 'POST', json: { identifier } });

export const describePasswordToken = (token: string) =>
  api<{ purpose: 'set_password' | 'reset_password'; name: string; email: string }>(
    `/auth/password-token/${encodeURIComponent(token)}`,
  );

export const setPassword = (input: SetPasswordInput) =>
  api<{ ok: true }>('/auth/set-password', { method: 'POST', json: input });

export interface DevEmail {
  id: string;
  channel: 'email' | 'sms';
  to: string;
  subject: string;
  html: string;
  event: string;
  at: string;
}

export const listDevOutbox = () => api<{ emails: DevEmail[] }>('/dev/outbox').then((r) => r.emails);

export const changePassword = (input: ChangePasswordInput) =>
  api<{ ok: true }>('/auth/change-password', { method: 'POST', json: input });
