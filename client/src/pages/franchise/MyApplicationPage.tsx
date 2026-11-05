import { useEffect, useState } from 'react';
import { formatDateIST, formatDateTimeIST, type MyApplicationView, type SubmissionView } from '@fap/shared';
import { getMyApplication, getMySubmission } from '../../api/franchise';
import { ApplicantStatusBadge } from '../../components/ApplicationBits';
import { SubmissionDetails } from '../../components/SubmissionDetails';
import { Alert, Loading, PageHeader } from '../../components/ui';

/** F2: read-only view of the application, with earlier versions and the history timeline. */
export function MyApplicationPage() {
  const [app, setApp] = useState<MyApplicationView | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [shown, setShown] = useState<SubmissionView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMyApplication()
      .then((a) => {
        setApp(a);
        setVersion(a.currentVersion);
        setShown(a.current);
      })
      .catch(() => setError('Your application could not be loaded. Please refresh the page.'));
  }, []);

  const pickVersion = (v: number) => {
    setVersion(v);
    if (app && v === app.currentVersion) {
      setShown(app.current);
      return;
    }
    setShown(null);
    getMySubmission(v)
      .then(setShown)
      .catch(() => setError('That version could not be loaded.'));
  };

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!app) return <Loading />;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="My Application"
        description={`Application ${app.applicationId} · submitted ${formatDateIST(app.submittedAt)}`}
        actions={<ApplicantStatusBadge status={app.status} />}
      />

      {app.versions.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label htmlFor="version" className="text-sm font-medium text-slate-700">
            Version
          </label>
          <select id="version" className="input w-auto" value={version ?? ''} onChange={(e) => pickVersion(Number(e.target.value))}>
            {app.versions.map((v) => (
              <option key={v} value={v}>
                v{v}
                {v === app.currentVersion ? ' (latest)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {!shown ? (
            <Loading />
          ) : (
            <>
              {version !== app.currentVersion && <Alert tone="info">You are viewing version {version}, an earlier submission.</Alert>}

              <SubmissionDetails submission={shown} />
            </>
          )}
        </div>

        <aside className="space-y-5">
          <section className="card">
            <h2 className="font-semibold text-slate-900">Franchise Agreement</h2>
            {app.agreement ? (
              <p className="mt-1 text-sm text-slate-700">
                Version {app.agreement.versionNumber} accepted on {formatDateTimeIST(app.agreement.acceptedAt)}.
              </p>
            ) : (
              <p className="mt-1 text-sm text-slate-600">No acceptance recorded.</p>
            )}
          </section>

          <section className="card">
            <h2 className="mb-3 font-semibold text-slate-900">History</h2>
            <ol className="relative space-y-4 border-l border-slate-200 pl-4">
              {[...app.history].reverse().map((h, i) => (
                <li key={i}>
                  <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-brand" aria-hidden="true" />
                  <p className="text-sm font-medium text-slate-900">{h.title}</p>
                  <p className="text-xs text-slate-500">
                    {formatDateTimeIST(h.at)} · {h.by}
                    {h.submissionVersion ? ` · v${h.submissionVersion}` : ''}
                  </p>
                  {h.reason && <p className="mt-1 whitespace-pre-line rounded bg-slate-50 p-2 text-sm text-slate-700">{h.reason}</p>}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}
