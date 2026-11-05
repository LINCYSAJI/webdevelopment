import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDateIST, type TrackingView } from '@fap/shared';
import { getTracking } from '../../api/admin';
import { ReviewTable } from '../../components/ReviewTable';
import { Alert, Loading, PageHeader } from '../../components/ui';

const MORE_LINK: Record<string, string> = {
  pending_accounts: '/app/admin/registrations?status=pending_accounts',
  pending_manager: '/app/admin/registrations?status=pending_manager',
  approved: '/app/admin/approved',
  rejected: '/app/admin/rejected',
};

/** AD4: the approval pipeline, and everything overdue. */
export function TrackingPage() {
  const [data, setData] = useState<TrackingView | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    getTracking()
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error) return <Alert tone="error">Approval tracking could not be loaded. Please refresh the page.</Alert>;
  if (!data) return <Loading />;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Approval Tracking" description="Where every application is in the approval pipeline. Waiting times are in business days." />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.columns.map((col) => (
          <section key={col.key} className="card flex flex-col">
            <div className="flex items-baseline justify-between">
              <h2 className="font-semibold text-slate-900">{col.label}</h2>
              <span className="text-2xl font-bold text-slate-900">{col.count}</span>
            </div>
            {(col.key === 'approved' || col.key === 'rejected') && col.count > col.rows.length && <p className="text-xs text-slate-500">Latest {col.rows.length} shown</p>}
            <ul className="mt-3 flex-1 divide-y divide-slate-100 text-sm">
              {col.rows.length === 0 && <li className="py-2 text-slate-500">None</li>}
              {col.rows.map((r) => (
                <li key={r.id} className="py-2">
                  <Link to={`/app/admin/registrations/${r.id}`} className="font-medium text-brand hover:underline">
                    {r.applicationId}
                  </Link>
                  <div className="truncate text-slate-700">{r.firmName}</div>
                  <div className="text-xs text-slate-500">
                    {col.key === 'pending_accounts' || col.key === 'pending_manager' ? (
                      <span className={r.overdue ? 'font-semibold text-red-700' : ''}>
                        Waiting {r.businessDaysWaiting} day{r.businessDaysWaiting === 1 ? '' : 's'}
                        {col.key === 'pending_accounts' ? ` · ${r.assignedTo?.name ?? 'Unassigned'}` : ''}
                      </span>
                    ) : col.key === 'approved' ? (
                      r.agreementReferenceNo
                    ) : (
                      `Submitted ${formatDateIST(r.submittedAt)}`
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <Link to={MORE_LINK[col.key]} className="mt-3 text-sm font-medium text-brand hover:underline">
              Open list →
            </Link>
          </section>
        ))}
      </div>

      <section>
        <h2 className="mb-1 font-semibold text-slate-900">Overdue</h2>
        <p className="mb-3 text-sm text-slate-600">
          Waiting more than {data.reminderFirstAfterDays} business days, longest first. Automatic reminder emails, and the dates they were sent, start with the reminder job (build step 8).
        </p>
        {data.overdue.length ? (
          <ReviewTable rows={data.overdue} variant="admin" linkTo={(r) => `/app/admin/registrations/${r.id}`} />
        ) : (
          <div className="card text-sm text-slate-600">Nothing is overdue.</div>
        )}
      </section>
    </div>
  );
}
