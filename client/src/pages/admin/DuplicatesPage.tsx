import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { STATUS_LABELS, formatDateIST, type DuplicateCaseRow } from '@fap/shared';
import { listDuplicateCases } from '../../api/admin';
import { Alert, Badge, Loading, PageHeader } from '../../components/ui';
import { describeDuplicateField } from '../../lib/duplicates';

/** AD3: applications with an open possible-duplicate flag, oldest first. */
export function DuplicatesPage() {
  const [rows, setRows] = useState<DuplicateCaseRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    listDuplicateCases()
      .then(setRows)
      .catch(() => setError(true));
  }, []);

  if (error) return <Alert tone="error">The list could not be loaded. Please refresh the page.</Alert>;
  if (!rows) return <Loading />;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Duplicate Review"
        description="Applications whose email or mobile is also used in another registration. Accounts cannot approve them until you decide."
      />
      {rows.length === 0 ? (
        <div className="card text-center text-sm text-slate-600">No open duplicate cases.</div>
      ) : (
        <ul className="space-y-3">
          {rows.map((c) => (
            <li key={c.flagId} className="card space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <Link to={`/app/admin/registrations/${c.registration.id}`} className="font-semibold text-brand hover:underline">
                    {c.registration.applicationId}
                  </Link>
                  <div className="text-sm font-medium text-slate-900">{c.registration.firmName}</div>
                  <div className="text-xs text-slate-500">
                    {c.registration.signatoryName} · {STATUS_LABELS[c.registration.status]}
                    {c.registration.status === 'pending_accounts' ? ` · ${c.registration.assignedTo ?? 'Unassigned'}` : ''} · flagged {formatDateIST(c.raisedAt)}
                  </div>
                </div>
                <Badge color="amber">⚠ Possible duplicate</Badge>
              </div>
              <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                {c.matches.map((m, i) => (
                  <li key={i}>
                    {describeDuplicateField(m.field)} <strong className="break-all">{m.value}</strong> is also used in{' '}
                    <Link to={`/app/admin/registrations/${m.matchedRegistrationId}`} className="font-medium text-brand hover:underline">
                      {m.matchedApplicationId ?? 'an unverified registration'}
                    </Link>
                    {m.matchedFirmName ? ` (${m.matchedFirmName})` : ''}
                  </li>
                ))}
              </ul>
              <Link to={`/app/admin/duplicates/${c.flagId}`} className="btn-primary">
                Compare and decide
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
