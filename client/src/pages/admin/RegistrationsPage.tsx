import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { STATUSES, STATUS_LABELS, type AdminUserView, type Paginated, type ReviewListRow } from '@fap/shared';
import { approvedExportUrl, listApproved, listRegistrations, listUsers, registrationsExportUrl } from '../../api/admin';
import { ReviewFilters } from '../../components/ReviewFilters';
import { ReviewTable } from '../../components/ReviewTable';
import { Alert, Loading, PageHeader, Pagination } from '../../components/ui';
import { updateParams } from '../../lib/listParams';

const LISTS = {
  all: {
    title: 'Franchise Registrations',
    description: 'Every registration in every status, newest first. Open one to see all its details, documents and history.',
    load: listRegistrations,
    exportUrl: registrationsExportUrl,
  },
  approved: {
    title: 'Approved Applications',
    description: 'Final approvals, newest first, with the agreement reference and who approved at Accounts. Read-only.',
    load: listApproved,
    exportUrl: approvedExportUrl,
  },
} as const;

/** AD2 (all registrations) and AD5 (approved). Filters live in the address bar so a refresh keeps them. */
export function RegistrationsPage({ list }: { list: keyof typeof LISTS }) {
  const cfg = LISTS[list];
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<Paginated<ReviewListRow> | null>(null);
  const [error, setError] = useState(false);
  const [reviewers, setReviewers] = useState<AdminUserView[]>([]);

  const query = params.toString();
  const load = useCallback(() => {
    setData(null);
    setError(false);
    cfg
      .load(new URLSearchParams(query))
      .then(setData)
      .catch(() => setError(true));
  }, [cfg, query]);
  useEffect(load, [load]);

  useEffect(() => {
    if (list === 'all') listUsers('accounts').then(setReviewers).catch(() => setReviewers([]));
  }, [list]);

  const set = (changes: Record<string, string | null>) => setParams(updateParams(params, changes), { replace: true });

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={cfg.title}
        description={cfg.description}
        actions={
          <a href={cfg.exportUrl(params)} className="btn-primary whitespace-nowrap" download>
            Export to Excel (CSV)
          </a>
        }
      />

      {list === 'all' && (
        <div className="card mb-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="status" className="label">
              Status
            </label>
            <select id="status" className="input" value={params.get('status') ?? ''} onChange={(e) => set({ status: e.target.value || null })}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="assignee" className="label">
              Assigned reviewer
            </label>
            <select id="assignee" className="input" value={params.get('assignee') ?? ''} onChange={(e) => set({ assignee: e.target.value || null })}>
              <option value="">Anyone</option>
              <option value="unassigned">Unassigned (Pending Accounts)</option>
              {reviewers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                  {u.isActive ? '' : ' (inactive)'}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <ReviewFilters key={list} params={params} set={set} checks={list === 'all' ? ['overdue', 'flagged', 'resubmitted'] : ['resubmitted']} />

      {error && <Alert tone="error">The list could not be loaded. Please refresh the page.</Alert>}
      {!data ? (
        !error && <Loading />
      ) : data.items.length === 0 ? (
        <div className="card text-center text-sm text-slate-600">No applications match.</div>
      ) : (
        <>
          <p className="mb-2 text-sm text-slate-600">
            {data.total} application{data.total === 1 ? '' : 's'}
          </p>
          <ReviewTable rows={data.items} variant="admin" linkTo={(r) => `/app/admin/registrations/${r.id}`} />
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => set({ page: String(p) })} />
        </>
      )}
    </div>
  );
}
