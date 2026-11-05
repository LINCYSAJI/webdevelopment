import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { STATUS_LABELS, formatDateTimeIST, type ReviewedRow } from '@fap/shared';
import { listReviewedByMe } from '../../api/accounts';
import { Alert, Badge, Loading, PageHeader } from '../../components/ui';

/** A4: everything this Accounts user approved or rejected (read-only). */
export function ReviewedApplicationsPage() {
  const [rows, setRows] = useState<ReviewedRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    listReviewedByMe()
      .then(setRows)
      .catch(() => setError(true));
  }, []);

  if (error) return <Alert tone="error">The list could not be loaded. Please refresh the page.</Alert>;
  if (!rows) return <Loading />;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="My Reviewed Applications" description="Applications you approved or rejected, newest first. These are read-only." />
      {rows.length === 0 ? (
        <div className="card text-center text-sm text-slate-600">You have not reviewed any applications yet.</div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r, i) => (
            <li key={`${r.id}-${i}`} className="card flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <Link to={`/app/accounts/applications/${r.id}`} className="font-semibold text-brand hover:underline">
                  {r.applicationId}
                </Link>
                <div className="truncate text-sm text-slate-800">{r.firmName}</div>
                {r.reason && <p className="mt-1 line-clamp-2 text-sm text-slate-600">Reason: {r.reason}</p>}
              </div>
              <div className="flex flex-col items-start gap-1 text-sm sm:items-end">
                <Badge color={r.decision === 'approved' ? 'green' : 'red'}>{r.decision === 'approved' ? 'You approved' : 'You rejected'}</Badge>
                <span className="text-xs text-slate-500">{formatDateTimeIST(r.decidedAt)}</span>
                <span className="text-xs text-slate-600">Now: {STATUS_LABELS[r.currentStatus]}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
