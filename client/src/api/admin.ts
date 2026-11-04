import type {
  AdminUserView,
  AgreementDraftInput,
  AgreementVersionView,
  AuditLogView,
  HolidayInput,
  HolidayView,
  InternalUserInput,
  ManagedRole,
  Paginated,
  SettingsInput,
  SettingsView,
} from '@fap/shared';
import { api } from './client';

// ---------- Users ----------

export const listUsers = (role: ManagedRole) =>
  api<{ users: AdminUserView[] }>(`/admin/users/${role}`).then((r) => r.users);

export const createUser = (role: ManagedRole, input: InternalUserInput) =>
  api<{ user: AdminUserView; emailSent: boolean }>(`/admin/users/${role}`, { method: 'POST', json: input });

export const updateUser = (role: ManagedRole, id: string, input: InternalUserInput) =>
  api<{ user: AdminUserView }>(`/admin/users/${role}/${id}`, { method: 'PUT', json: input }).then((r) => r.user);

export const setUserActive = (role: ManagedRole, id: string, active: boolean) =>
  api<{ user: AdminUserView }>(`/admin/users/${role}/${id}/${active ? 'reactivate' : 'deactivate'}`, {
    method: 'POST',
  }).then((r) => r.user);

export const sendPasswordLink = (role: ManagedRole, id: string) =>
  api<{ emailSent: boolean }>(`/admin/users/${role}/${id}/password-link`, { method: 'POST' }).then((r) => r.emailSent);

// ---------- Settings ----------

export const getSettings = () => api<{ settings: SettingsView }>('/admin/settings').then((r) => r.settings);

export const saveSettings = (input: SettingsInput) =>
  api<{ settings: SettingsView }>('/admin/settings', { method: 'PUT', json: input }).then((r) => r.settings);

export const listHolidays = () => api<{ holidays: HolidayView[] }>('/admin/holidays').then((r) => r.holidays);

export const addHoliday = (input: HolidayInput) =>
  api<{ holiday: HolidayView }>('/admin/holidays', { method: 'POST', json: input }).then((r) => r.holiday);

export const removeHoliday = (id: string) => api<{ ok: true }>(`/admin/holidays/${id}`, { method: 'DELETE' });

// ---------- Audit log ----------

export interface AuditFilters {
  page: number;
  action?: string;
  from?: string;
  to?: string;
  search?: string;
}

export function listAuditLogs(filters: AuditFilters) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, String(v));
  return api<Paginated<AuditLogView>>(`/admin/audit-logs?${params}`);
}

export const listAuditActions = () =>
  api<{ actions: string[] }>('/admin/audit-logs/actions').then((r) => r.actions);

// ---------- Agreement versions ----------

type VersionResponse = { version: AgreementVersionView };

export const listAgreements = () =>
  api<{ versions: AgreementVersionView[] }>('/admin/agreements').then((r) => r.versions);

export const getAgreement = (id: string) => api<VersionResponse>(`/admin/agreements/${id}`).then((r) => r.version);

export const createAgreement = (input: AgreementDraftInput) =>
  api<VersionResponse>('/admin/agreements', { method: 'POST', json: input }).then((r) => r.version);

export const updateAgreement = (id: string, input: AgreementDraftInput) =>
  api<VersionResponse>(`/admin/agreements/${id}`, { method: 'PUT', json: input }).then((r) => r.version);

/** Uploads the agreement PDF to a PDF draft (replacing any earlier upload on that draft). */
export const uploadAgreementPdf = (id: string, file: File) =>
  api<VersionResponse>(`/admin/agreements/${id}/pdf`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent(file.name) },
    body: file,
  }).then((r) => r.version);

/** Address used to view (or, with ?download=1, download) a version's PDF. Admin only. */
export const agreementPdfUrl = (id: string) => `/api/admin/agreements/${id}/pdf`;

export const duplicateAgreement = (id: string) =>
  api<VersionResponse>(`/admin/agreements/${id}/duplicate`, { method: 'POST' }).then((r) => r.version);

export const activateAgreement = (id: string) =>
  api<VersionResponse>(`/admin/agreements/${id}/activate`, { method: 'POST' }).then((r) => r.version);

export const deactivateAgreement = (id: string) =>
  api<VersionResponse>(`/admin/agreements/${id}/deactivate`, { method: 'POST' }).then((r) => r.version);
