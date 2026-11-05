import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ManagerList, Paginated, ReviewListRow } from '@fap/shared';
import { listManagerApplications } from '../../api/manager';
import { ReviewFilters } from '../../components/ReviewFilters';
import { ReviewTable } from '../../components/ReviewTable';
import { Alert, Loading, PageHeader, Pagination } from '../../components/ui';
import { updateParams } from '../../lib/listParams';

const TEXT: Record<ManagerList, { title: string; description: string }> = {
  pending: { title: 'Pending Approvals', description: 'Approved by Accounts and waiting for your final decision. Oldest first.' },
  approved: { title: 'Approved', description: 'Final approvals, newest first. Read-only.' },
  rejected: { title: 'Rejected', description: 'Applications you sent back for correction, newest first. Read-only.' },
};

/** M2 (Pending Approvals) and M4 (Approved / Rejected). */
export function ManagerListPage({ list }: { list: ManagerList }) {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [data, setData] = useState<Paginated<ReviewListRow> | null>(null);
  const [error, setError] = useState(false);

  const query = params.toString();
  const load = useCallback(() => {
    setData(null);
    listManagerApplications(list, {
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
      .catch(() => setError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, query]);
  useEffect(load, [load]);

  const set = (changes: Record<string, string | null>) => setParams(updateParams(params, changes), { replace: true });

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={TEXT[list].title} description={TEXT[list].description} />
      <ReviewFilters key={list} params={params} set={set} checks={list === 'pending' ? ['overdue', 'flagged', 'resubmitted'] : ['resubmitted']} />
      {error && <Alert tone="error">The list could not be loaded. Please refresh the page.</Alert>}
      {!data ? (
        !error && <Loading />
      ) : data.items.length === 0 ? (
        <div className="card text-center text-sm text-slate-600">No applications match.</div>
      ) : (
        <>
          <ReviewTable rows={data.items} variant="manager" linkTo={(r) => `/app/manager/applications/${r.id}`} />
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => set({ page: String(p) })} />
        </>
      )}
    </div>
  );
}
