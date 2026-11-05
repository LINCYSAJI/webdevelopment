import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { APPLICANT_STATUS_TEXT, formatDateTimeIST, type ApplicationStatus } from '@fap/shared';
import { ApiError } from '../../api/client';
import { getResubmitForm, myDocumentUrl, resubmitApplication, uploadResubmissionFile, type ResubmitForm } from '../../api/franchise';
import { RegistrationForm } from '../../components/RegistrationForm';
import { Alert, Loading, PageHeader } from '../../components/ui';
import { formFromSubmission } from '../../lib/registrationForm';

/** F3: the registration form pre-filled with the last submission, with the reason pinned on top. */
export function ResubmitPage() {
  const [form, setForm] = useState<ResubmitForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ApplicationStatus | null>(null);

  useEffect(() => {
    getResubmitForm()
      .then(setForm)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'The form could not be loaded. Please refresh the page.'));
  }, []);

  if (done) {
    return (
      <div className="mx-auto max-w-xl">
        <div className="card space-y-4 text-center">
          <h1 className="text-xl font-bold text-slate-900">Your application has been resubmitted</h1>
          <p className="text-sm text-slate-700">{APPLICANT_STATUS_TEXT[done].explanation}</p>
          <p className="text-sm text-slate-600">We have emailed you a confirmation and will let you know when a decision is made.</p>
          <Link to="/app" className="btn-primary">
            Back to my dashboard
          </Link>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <Alert tone="info">{error}</Alert>
        <Link to="/app" className="btn-primary">
          Back to my dashboard
        </Link>
      </div>
    );
  }
  if (!form) return <Loading />;

  const rejection = form.latestRejection;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Edit & Resubmit" description="Correct your application and send it back for review. There is no limit on resubmissions." />
      <RegistrationForm
        mode="resubmit"
        agreement={form.agreement}
        limits={form.limits}
        initialForm={formFromSubmission(form.submission, myDocumentUrl)}
        upload={uploadResubmissionFile}
        submitLabel="Resubmit"
        intro={
          rejection && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4" role="note">
              <h2 className="font-semibold text-red-900">
                Changes requested by {rejection.stage === 'Accounts' ? 'our Accounts team' : 'our Manager'} on {formatDateTimeIST(rejection.at)}
              </h2>
              <p className="mt-1 whitespace-pre-line text-sm text-red-900">{rejection.reason}</p>
            </div>
          )
        }
        footerLink={
          <Link to="/app" className="font-medium text-brand hover:underline">
            Cancel
          </Link>
        }
        onSubmit={async (payload) => {
          const result = await resubmitApplication(payload);
          setDone(result.status);
          window.scrollTo({ top: 0 });
        }}
      />
    </div>
  );
}
