import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { APPLICANT_STATUS_TEXT, formatDateIST, formatDateTimeIST, type ApplicationStatus, type MyApplicationView } from '@fap/shared';
import { getMyApplication } from '../../api/franchise';
import { useAuth } from '../../auth/AuthContext';
import { ApplicantStatusBadge } from '../../components/ApplicationBits';
import { Alert, Loading } from '../../components/ui';

const STEPS = ['Submitted', 'Accounts Review', 'Manager Review', 'Approved'] as const;

/** Which step is current, and whether it was rejected (PRD F1 progress tracker). */
function progress(status: ApplicationStatus): { current: number; rejected: boolean } {
  switch (status) {
    case 'pending_accounts':
      return { current: 1, rejected: false };
    case 'rejected_by_accounts':
      return { current: 1, rejected: true };
    case 'pending_manager':
      return { current: 2, rejected: false };
    case 'rejected_by_manager':
      return { current: 2, rejected: true };
    case 'approved':
      return { current: 4, rejected: false };
    default:
      return { current: 0, rejected: false };
  }
}

/** F1: the Franchise Partner's dashboard. */
export function FranchiseDashboardPage() {
  const { user } = useAuth();
  const [app, setApp] = useState<MyApplicationView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMyApplication()
      .then(setApp)
      .catch(() => setError('Your application could not be loaded. Please refresh the page.'));
  }, []);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!app) return <Loading />;

  const { current, rejected } = progress(app.status);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Welcome, {user?.name}</h1>
        <p className="mt-1 text-sm text-slate-600">Track your franchise application and see any action needed from you.</p>
      </div>

      {app.latestRejection && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4" role="alert">
          <h2 className="font-semibold text-red-900">Changes requested by {app.latestRejection.stage === 'Accounts' ? 'our Accounts team' : 'our Manager'}</h2>
          <p className="mt-1 whitespace-pre-line text-sm text-red-900">{app.latestRejection.reason}</p>
          <p className="mt-1 text-xs text-red-800">{formatDateTimeIST(app.latestRejection.at)}</p>
          <Link to="/app/my-application/resubmit" className="btn-primary mt-3">
            Edit &amp; Resubmit
          </Link>
        </div>
      )}

      {app.status === 'approved' && (
        <Alert tone="success">
          Your franchise agreement has been approved. Our Manager will email the agreement to <strong>{user?.email}</strong>.
        </Alert>
      )}

      <section className="card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Application {app.applicationId}</p>
            <div className="mt-2">
              <ApplicantStatusBadge status={app.status} />
            </div>
            <p className="mt-3 text-slate-800">{APPLICANT_STATUS_TEXT[app.status].explanation}</p>
          </div>
          <p className="text-sm text-slate-500">Submitted {formatDateIST(app.submittedAt)}</p>
        </div>

        <ol className="mt-6 grid grid-cols-4 gap-1" aria-label="Application progress">
          {STEPS.map((label, i) => {
            const done = i < current;
            const isCurrent = i === current;
            const bad = isCurrent && rejected;
            const tone = bad ? 'bg-red-600 text-white' : done ? 'bg-green-600 text-white' : isCurrent ? 'bg-brand text-white' : 'bg-slate-200 text-slate-600';
            return (
              <li key={label} className="flex flex-col items-center text-center" aria-current={isCurrent ? 'step' : undefined}>
                <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${tone}`}>{bad ? '!' : done ? '✓' : i + 1}</span>
                <span className={`mt-1 text-[11px] leading-tight sm:text-xs ${isCurrent ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>{label}</span>
                <span className="sr-only">{bad ? '(changes requested)' : done ? '(done)' : isCurrent ? '(current)' : ''}</span>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="card">
        <h2 className="font-semibold text-slate-900">Franchise agreement</h2>
        {app.agreement ? (
          <p className="mt-1 text-sm text-slate-700">
            You accepted <strong>Agreement Version {app.agreement.versionNumber}</strong> on {formatDateTimeIST(app.agreement.acceptedAt)}.
          </p>
        ) : (
          <p className="mt-1 text-sm text-slate-600">No agreement acceptance recorded.</p>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link to="/app/my-application" className="card block hover:border-brand">
          <span className="font-semibold text-slate-900">My Application →</span>
          <span className="mt-1 block text-sm text-slate-600">See everything you submitted and the history of your application.</span>
        </Link>
        <Link to="/app/profile" className="card block hover:border-brand">
          <span className="font-semibold text-slate-900">My Profile →</span>
          <span className="mt-1 block text-sm text-slate-600">Change your password, email or mobile number.</span>
        </Link>
      </div>
    </div>
  );
}
