import type {
  AgreementEmailLogView,
  GeneratedAgreementRow,
  GeneratedAgreementSummary,
  ManagerDashboardView,
  ManagerList,
  Paginated,
  ReviewApplicationView,
  ReviewListQuery,
  ReviewListRow,
  SendAgreementInput,
} from '@fap/shared';
import { api } from './client';

type AppResponse = { application: ReviewApplicationView };

export const getManagerDashboard = () => api<{ dashboard: ManagerDashboardView }>('/manager/dashboard').then((r) => r.dashboard);

export function listManagerApplications(list: ManagerList, query: Omit<ReviewListQuery, 'tab'>) {
  const params = new URLSearchParams({ list });
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '' && v !== false) params.set(k, String(v));
  return api<Paginated<ReviewListRow>>(`/manager/applications?${params}`);
}

export const getApplicationForManager = (id: string, version?: number) =>
  api<AppResponse>(`/manager/applications/${id}${version ? `?version=${version}` : ''}`).then((r) => r.application);

export const managerApprove = (id: string) =>
  api<AppResponse & { referenceNumber: string; generation: GeneratedAgreementSummary | null }>(`/manager/applications/${id}/approve`, { method: 'POST' });

export const managerReject = (id: string, reason: string) =>
  api<AppResponse>(`/manager/applications/${id}/reject`, { method: 'POST', json: { reason } }).then((r) => r.application);

export const managerDocumentUrl = (applicationId: string) => (documentId: string) => `/api/manager/applications/${applicationId}/documents/${documentId}`;

// ---------- Generated agreements (M5) ----------

export const listGeneratedAgreements = () => api<{ items: GeneratedAgreementRow[] }>('/manager/agreements').then((r) => r.items);

/** View in the browser; add ?download=1 to download (the only download point in the portal). */
export const agreementPdfUrl = (id: string) => `/api/manager/agreements/${id}/pdf`;

export const getAgreementEmailDraft = (id: string) =>
  api<{ draft: { recipient: string; subject: string; message: string } }>(`/manager/agreements/${id}/email-draft`).then((r) => r.draft);

export const sendAgreement = (id: string, input: SendAgreementInput) =>
  api<{ recipient: string; at: string }>(`/manager/agreements/${id}/send`, { method: 'POST', json: input });

export const getAgreementEmailHistory = (id: string) =>
  api<{ items: AgreementEmailLogView[] }>(`/manager/agreements/${id}/emails`).then((r) => r.items);

export const retryAgreementGeneration = (id: string) =>
  api<{ generation: GeneratedAgreementSummary }>(`/manager/agreements/${id}/retry`, { method: 'POST' }).then((r) => r.generation);
