import type { Branding, ChangePasswordInput, LoginInput, PublicUser, SetPasswordInput } from '@fap/shared';
import { api, refreshSession } from './client';

export const login = (input: LoginInput) =>
  api<{ user: PublicUser }>('/auth/login', { method: 'POST', json: input }).then((r) => r.user);

export const logout = () => api<{ ok: true }>('/auth/logout', { method: 'POST' });

/** Returns the signed-in user, or null if nobody is signed in. */
export async function getCurrentUser(): Promise<PublicUser | null> {
  type Session = { user: PublicUser | null; canRefresh?: boolean };
  try {
    const session = await api<Session>('/auth/session');
    if (session.user) return session.user;
    // Only try to renew when a stored session exists, so logged-out visitors see no failed requests.
    if (session.canRefresh && (await refreshSession())) return (await api<Session>('/auth/session')).user;
    return null;
  } catch {
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
