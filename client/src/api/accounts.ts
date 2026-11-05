import type { AccountsDashboardView, Paginated, ReviewApplicationView, ReviewListQuery, ReviewListRow, ReviewedRow } from '@fap/shared';
import { api } from './client';

type AppResponse = { application: ReviewApplicationView };

export const getAccountsDashboard = () => api<{ dashboard: AccountsDashboardView }>('/accounts/dashboard').then((r) => r.dashboard);

export function listPendingApplications(query: ReviewListQuery) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '' && v !== false) params.set(k, String(v));
  return api<Paginated<ReviewListRow>>(`/accounts/applications?${params}`);
}

export const getApplicationForReview = (id: string, version?: number) =>
  api<AppResponse>(`/accounts/applications/${id}${version ? `?version=${version}` : ''}`).then((r) => r.application);

export const pickUpApplication = (id: string) => api<AppResponse>(`/accounts/applications/${id}/pick-up`, { method: 'POST' }).then((r) => r.application);
export const approveApplication = (id: string) => api<AppResponse>(`/accounts/applications/${id}/approve`, { method: 'POST' }).then((r) => r.application);
export const rejectApplication = (id: string, reason: string) =>
  api<AppResponse>(`/accounts/applications/${id}/reject`, { method: 'POST', json: { reason } }).then((r) => r.application);

export const listReviewedByMe = () => api<{ items: ReviewedRow[] }>('/accounts/reviewed').then((r) => r.items);

/** A document of an application under review (checked by the server on every request). */
export const reviewDocumentUrl = (applicationId: string) => (documentId: string) => `/api/accounts/applications/${applicationId}/documents/${documentId}`;
