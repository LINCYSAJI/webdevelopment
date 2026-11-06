import type {
  AdminDashboardView,
  SmsEvent,
  SmsLogRow,
  SmsSettingsInput,
  SmsSettingsView,
  SmsStatusView,
  AgreementEmailLogView,
  DuplicateCaseRow,
  DuplicateComparisonView,
  GeneratedAgreementRow,
  RejectionRow,
  ReviewApplicationView,
  ReviewListRow,
  TrackingView,
  ReassignInput,
  AdminUserView,
  AgreementDraftInput,
  AgreementVersionView,
  AuditLogView,
  HolidayInput,
  HolidayView,
  InternalUserInput,
  ManagedRole,
  DataRequestRow,
  DataRequestStatus,
  MyDataRequestView,
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

// ---------- Reassigning Accounts reviewers (PRD AD2, AD8) ----------

export const moveAssignments = (fromUserId: string, input: ReassignInput) =>
  api<{ moved: number }>(`/admin/users/accounts/${fromUserId}/move-assignments`, { method: 'POST', json: input }).then((r) => r.moved);

export const reassignRegistration = (registrationId: string, input: ReassignInput) =>
  api<{ ok: true }>(`/admin/registrations/${registrationId}/reassign`, { method: 'POST', json: input });

// ---------- Data deletion requests (DPDP Act) ----------

export const listDataRequests = (params: { status?: DataRequestStatus; page: number }) => {
  const q = new URLSearchParams({ page: String(params.page) });
  if (params.status) q.set('status', params.status);
  return api<Paginated<DataRequestRow>>(`/admin/data-requests?${q}`);
};

export const eraseDataRequest = (id: string) => api<{ status: 'completed' }>(`/admin/data-requests/${id}/erase`, { method: 'POST' });

export const declineDataRequest = (id: string, note: string) =>
  api<{ request: MyDataRequestView }>(`/admin/data-requests/${id}/decline`, { method: 'POST', json: { note } });

// ---------- Admin oversight (PRD AD1–AD6) ----------

/** Query string from the address-bar filters, leaving out empty values. */
export const toQuery = (params: URLSearchParams | Record<string, string | undefined>) => {
  const q = new URLSearchParams();
  const entries = params instanceof URLSearchParams ? [...params.entries()] : Object.entries(params);
  for (const [k, v] of entries) if (v) q.set(k, v);
  return q.toString();
};

export const getAdminDashboard = () => api<{ dashboard: AdminDashboardView }>('/admin/dashboard').then((r) => r.dashboard);

export const listRegistrations = (params: URLSearchParams) => api<Paginated<ReviewListRow>>(`/admin/registrations?${toQuery(params)}`);
export const registrationsExportUrl = (params: URLSearchParams) => `/api/admin/registrations/export?${toQuery(params)}`;

export const getRegistration = (id: string, version?: number) =>
  api<{ application: ReviewApplicationView }>(`/admin/registrations/${id}${version ? `?version=${version}` : ''}`).then((r) => r.application);
export const adminDocumentUrl = (applicationId: string) => (documentId: string) => `/api/admin/registrations/${applicationId}/documents/${documentId}`;

export const getTracking = () => api<{ tracking: TrackingView }>('/admin/tracking').then((r) => r.tracking);

export const listApproved = (params: URLSearchParams) => api<Paginated<ReviewListRow>>(`/admin/approved?${toQuery(params)}`);
export const approvedExportUrl = (params: URLSearchParams) => `/api/admin/approved/export?${toQuery(params)}`;
export const listRejected = (params: URLSearchParams) => api<Paginated<RejectionRow>>(`/admin/rejected?${toQuery(params)}`);
export const rejectedExportUrl = (params: URLSearchParams) => `/api/admin/rejected/export?${toQuery(params)}`;

export const listAdminGeneratedAgreements = () => api<{ items: GeneratedAgreementRow[] }>('/admin/generated-agreements').then((r) => r.items);
export const getAdminAgreementEmailHistory = (id: string) =>
  api<{ items: AgreementEmailLogView[] }>(`/admin/generated-agreements/${id}/emails`).then((r) => r.items);

export const listDuplicateCases = () => api<{ items: DuplicateCaseRow[] }>('/admin/duplicates').then((r) => r.items);
export const getDuplicateComparison = (id: string) => api<{ comparison: DuplicateComparisonView }>(`/admin/duplicates/${id}`).then((r) => r.comparison);
export const decideDuplicate = (id: string, decision: 'not-duplicate' | 'confirm', note: string) =>
  api<{ status: string }>(`/admin/duplicates/${id}/${decision}`, { method: 'POST', json: { note } });

// ---------- SMS Notifications ----------

export const getSmsStatus = () => api<{ status: SmsStatusView }>('/admin/sms/status').then((r) => r.status);
export const getSmsSettings = () => api<{ settings: SmsSettingsView }>('/admin/sms/settings').then((r) => r.settings);
export const saveSmsSettings = (settings: SmsSettingsInput) =>
  api<{ settings: SmsSettingsView }>('/admin/sms/settings', { method: 'PUT', json: settings }).then((r) => r.settings);
export const sendTestSms = (mobile: string, event: SmsEvent) =>
  api<{ outcome: { ok: boolean; status: string; reason?: string } }>('/admin/sms/test', { method: 'POST', json: { mobile, event } }).then((r) => r.outcome);
export const listSmsLogs = (params: URLSearchParams) => api<Paginated<SmsLogRow>>(`/admin/sms/logs?${toQuery(params)}`);
export const refreshSmsDelivery = () =>
  api<{ checked: number; updated: number; error: string | null }>('/admin/sms/logs/refresh-delivery', { method: 'POST' });
