import { Link, Navigate, useLocation } from 'react-router-dom';
import { APPLICANT_STATUS_TEXT } from '@fap/shared';
import { AuthShell } from '../components/AuthShell';
import { Badge } from '../components/ui';

/** P5: shown once, right after the account is created. */
export function RegistrationSuccessPage() {
  const state = useLocation().state as { applicationId?: string } | null;
  if (!state?.applicationId) return <Navigate to="/app" replace />;

  return (
    <AuthShell title="Your application has been submitted">
      <div className="rounded-md border border-green-200 bg-green-50 p-4 text-center">
        <p className="text-sm text-slate-600">Application ID</p>
        <p className="mt-1 text-2xl font-bold tracking-wide text-slate-900">{state.applicationId}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
        Current status: <Badge color="blue">{APPLICANT_STATUS_TEXT.pending_accounts.label}</Badge>
      </div>
      <p className="text-sm text-slate-600">
        We have emailed you a confirmation. Our Accounts team will now review your application, and we will email you at each stage.
      </p>
      <Link to="/app" className="btn-primary w-full">
        Go to My Dashboard
      </Link>
    </AuthShell>
  );
}
