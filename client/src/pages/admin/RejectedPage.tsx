import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { STATUS_LABELS, formatDateIST, type Paginated, type RejectionRow } from '@fap/shared';
import { listRejected, rejectedExportUrl } from '../../api/admin';
import { Alert, Badge, Loading, PageHeader, Pagination } from '../../components/ui';
import { updateParams } from '../../lib/listParams';

/** AD5: every rejection, with the stage, reason, reviewer and whether the applicant resubmitted. */
export function RejectedPage() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<Paginated<RejectionRow> | null>(null);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState(params.get('search') ?? '');

  const query = params.toString();
  const load = useCallback(() => {
    setData(null);
    setError(false);
    listRejected(new URLSearchParams(query))
      .then(setData)
      .catch(() => setError(true));
  }, [query]);
  useEffect(load, [load]);

  const set = (changes: Record<string, string | null>) => setParams(updateParams(params, changes), { replace: true });

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Rejected Applications"
        description="Every rejection decision, newest first. An application rejected twice appears twice. Read-only."
        actions={
          <a href={rejectedExportUrl(params)} className="btn-primary whitespace-nowrap" download>
            Export to Excel (CSV)
          </a>
        }
      />

      <form
        className="card mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]"
        onSubmit={(e) => {
          e.preventDefault();
          set({ search: search.trim() || null });
        }}
      >
        <div>
          <label htmlFor="search" className="label">
            Search
          </label>
          <input
            id="search"
            className="input"
            placeholder="Application ID, firm, PAN, GST, name, email or mobile"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => set({ search: search.trim() || null })}
          />
        </div>
        <div>
          <label htmlFor="stage" className="label">
            Stage
          </label>
          <select id="stage" className="input" value={params.get('stage') ?? ''} onChange={(e) => set({ stage: e.target.value || null })}>
            <option value="">Both</option>
            <option value="accounts">Accounts</option>
            <option value="manager">Manager</option>
          </select>
        </div>
        <div>
          <label htmlFor="resubmitted" className="label">
            Resubmitted since
          </label>
          <select id="resubmitted" className="input" value={params.get('resubmitted') ?? ''} onChange={(e) => set({ resubmitted: e.target.value || null })}>
            <option value="">Either</option>
            <option value="yes">Yes</option>
            <option value="no">No (waiting for the applicant)</option>
          </select>
        </div>
        <div>
          <label htmlFor="from" className="label">
            Rejected from
          </label>
          <input id="from" type="date" className="input" value={params.get('from') ?? ''} onChange={(e) => set({ from: e.target.value || null })} />
        </div>
        <div>
          <label htmlFor="to" className="label">
            Rejected to
          </label>
          <input id="to" type="date" className="input" value={params.get('to') ?? ''} onChange={(e) => set({ to: e.target.value || null })} />
        </div>
      </form>

      {error && <Alert tone="error">The list could not be loaded. Please refresh the page.</Alert>}
      {!data ? (
        !error && <Loading />
      ) : data.items.length === 0 ? (
        <div className="card text-center text-sm text-slate-600">No rejections match.</div>
      ) : (
        <>
          <ul className="space-y-3">
            {data.items.map((r, i) => (
              <li key={`${r.id}-${r.rejectedAt}-${i}`} className="card space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <Link to={`/app/admin/registrations/${r.id}`} className="font-semibold text-brand hover:underline">
                      {r.applicationId}
                    </Link>
                    <div className="text-sm font-medium text-slate-900">{r.firmName}</div>
                    <div className="text-xs text-slate-500">Now: {STATUS_LABELS[r.currentStatus]}</div>
                  </div>
                  <div className="flex flex-wrap gap-1 sm:justify-end">
                    <Badge color="red">Rejected by {r.stage === 'accounts' ? 'Accounts' : 'Manager'}</Badge>
                    {r.resubmitted ? <Badge color="blue">Resubmitted since</Badge> : <Badge color="amber">Waiting for applicant</Badge>}
                  </div>
                </div>
                <p className="whitespace-pre-line rounded bg-slate-50 p-2 text-sm text-slate-700">{r.reason}</p>
                <p className="text-xs text-slate-500">
                  {r.reviewer} · {formatDateIST(r.rejectedAt)}
                </p>
              </li>
            ))}
          </ul>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => set({ page: String(p) })} />
        </>
      )}
    </div>
  );
}
