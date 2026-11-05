import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ACCOUNTS_TABS, type AccountsTab, type Paginated, type ReviewListRow } from '@fap/shared';
import { listPendingApplications, pickUpApplication } from '../../api/accounts';
import { ApiError } from '../../api/client';
import { ReviewFilters } from '../../components/ReviewFilters';
import { updateParams } from '../../lib/listParams';
import { ReviewTable } from '../../components/ReviewTable';
import { Alert, Loading, PageHeader, Pagination } from '../../components/ui';

const TAB_LABELS: Record<AccountsTab, string> = {
  unassigned: 'Unassigned',
  mine: 'Assigned to Me',
  all: 'All Pending',
};

/** A2: the Accounts queues. Filters live in the address bar so a refresh keeps them. */
export function PendingApplicationsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (ACCOUNTS_TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as AccountsTab) : 'unassigned';
  const page = Math.max(1, Number(params.get('page')) || 1);

  const [data, setData] = useState<Paginated<ReviewListRow> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const query = params.toString();
  const load = useCallback(() => {
    setData(null);
    listPendingApplications({
      tab,
      page,
      search: params.get('search') ?? undefined,
      firmType: params.get('firmType') ?? undefined,
      from: params.get('from') ?? undefined,
      to: params.get('to') ?? undefined,
      overdue: params.get('overdue') === '1',
      flagged: params.get('flagged') === '1',
      resubmitted: params.get('resubmitted') === '1',
    })
      .then(setData)
      .catch(() => setError('The list could not be loaded. Please refresh the page.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  useEffect(load, [load]);

  const set = (changes: Record<string, string | null>) => setParams(updateParams(params, changes), { replace: true });

  const pickUp = async (row: ReviewListRow) => {
    setBusyId(row.id);
    setError(null);
    try {
      await pickUpApplication(row.id);
      navigate(`/app/accounts/applications/${row.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not pick up the application.');
      load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Pending Applications" description="Oldest first. Pick up an unassigned application to review it." />

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
        {ACCOUNTS_TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => set({ tab: t })}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${tab === t ? 'border-brand text-brand' : 'border-transparent text-slate-600'}`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
      {tab === 'all' && <p className="-mt-2 mb-3 text-xs text-slate-500">Applications assigned to other Accounts users are read-only for you.</p>}

      <ReviewFilters params={params} set={set} />

      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}

      {!data ? (
        <Loading />
      ) : data.items.length === 0 ? (
        <div className="card text-center text-sm text-slate-600">No applications match.</div>
      ) : (
        <>
          <ReviewTable
            rows={data.items}
            linkTo={(r) => `/app/accounts/applications/${r.id}`}
            action={
              tab === 'unassigned'
                ? (r) => (
                    <button className="btn-primary whitespace-nowrap px-3 py-1.5 text-xs" disabled={busyId !== null} onClick={() => void pickUp(r)}>
                      {busyId === r.id ? 'Picking up…' : 'Pick Up'}
                    </button>
                  )
                : undefined
            }
          />
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => set({ page: String(p) })} />
        </>
      )}
    </div>
  );
}
