import { useEffect, useState } from 'react';
import { ROLE_LABELS, formatDateTimeIST, type AuditLogView, type Paginated } from '@fap/shared';
import * as adminApi from '../../api/admin';
import { Alert, Loading, PageHeader, Pagination, SecondaryButton } from '../../components/ui';

/** "agreement_draft_created" -> "Agreement draft created" */
const humanise = (action: string) => action.charAt(0).toUpperCase() + action.slice(1).replace(/_/g, ' ');

function describeDetails(details: Record<string, unknown> | null): string {
  if (!details) return '';
  return Object.entries(details)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}

const EMPTY_FILTERS = { action: '', from: '', to: '', search: '' };

export function AuditLogPage() {
  const [actions, setActions] = useState<string[]>([]);
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<AuditLogView> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi.listAuditActions().then(setActions).catch(() => undefined);
  }, []);

  useEffect(() => {
    setData(null);
    adminApi
      .listAuditLogs({ page, ...filters })
      .then(setData)
      .catch(() => setError('Could not load the audit log.'));
  }, [page, filters]);

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setFilters(draft);
  };

  const reset = () => {
    setDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Audit Log" description="A permanent, read-only record of important actions. Entries can never be edited or deleted." />

      <form onSubmit={apply} className="card mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
        <div>
          <label className="label" htmlFor="f-action">Action</label>
          <select id="f-action" className="input" value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })}>
            <option value="">All actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>{humanise(a)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-from">From</label>
          <input id="f-from" type="date" className="input" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="f-to">To</label>
          <input id="f-to" type="date" className="input" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="f-search">User, record ID or IP</label>
          <input id="f-search" className="input" value={draft.search} onChange={(e) => setDraft({ ...draft, search: e.target.value })} />
        </div>
        <div className="flex gap-2">
          <button type="submit" className="btn-primary flex-1">Apply</button>
          <SecondaryButton onClick={reset}>Reset</SecondaryButton>
        </div>
      </form>

      {error && <Alert tone="error">{error}</Alert>}
      {!data && !error && <Loading />}
      {data && data.items.length === 0 && <div className="card text-center text-sm text-slate-600">No entries match these filters.</div>}

      {data && data.items.length > 0 && (
        <>
          <div className="card hidden overflow-x-auto p-0 lg:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Date and time</th>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Record</th>
                  <th className="px-4 py-3">Details</th>
                  <th className="px-4 py-3">IP address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 align-top">
                {data.items.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap px-4 py-3">{formatDateTimeIST(e.at)}</td>
                    <td className="px-4 py-3">
                      {e.user ? (
                        <>
                          <div className="font-medium">{e.user.name}</div>
                          <div className="text-xs text-slate-500">{e.role ? ROLE_LABELS[e.role] : ''}</div>
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{humanise(e.action)}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {e.targetType ? `${e.targetType}${e.targetId ? ` · ${e.targetId}` : ''}` : '—'}
                    </td>
                    <td className="max-w-md break-words px-4 py-3 text-xs text-slate-600">{describeDetails(e.details)}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{e.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-3 lg:hidden">
            {data.items.map((e) => (
              <li key={e.id} className="card space-y-1 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-semibold">{humanise(e.action)}</span>
                  <span className="text-xs text-slate-500">{formatDateTimeIST(e.at)}</span>
                </div>
                <div className="text-slate-600">{e.user ? `${e.user.name} (${e.role ? ROLE_LABELS[e.role] : ''})` : 'No user'}</div>
                {e.details && <div className="break-words text-xs text-slate-500">{describeDetails(e.details)}</div>}
              </li>
            ))}
          </ul>

          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
