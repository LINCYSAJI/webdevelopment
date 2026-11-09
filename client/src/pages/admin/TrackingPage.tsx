import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDateIST, formatDateTimeIST, type DailyCheckRunView, type TrackingView } from '@fap/shared';
import { getTracking, runDailyCheckNow } from '../../api/admin';
import { ApiError } from '../../api/client';
import { ReviewTable } from '../../components/ReviewTable';
import { Alert, Badge, Loading, PageHeader, SecondaryButton } from '../../components/ui';

const MORE_LINK: Record<string, string> = {
  pending_accounts: '/app/admin/registrations?status=pending_accounts',
  pending_manager: '/app/admin/registrations?status=pending_manager',
  approved: '/app/admin/approved',
  rejected: '/app/admin/rejected',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One line describing what a daily check did. */
function describeRun(run: DailyCheckRunView): string {
  if (run.status === 'running') return 'Running now…';
  if (run.status === 'failed' || !run.summary) return 'The check could not finish. It will try again at the next run.';
  const s = run.summary;
  const parts = [
    s.businessDay ? `${plural(s.reminders, 'reminder')} and ${plural(s.escalations, 'Admin alert')} sent (${plural(s.emailsSent, 'email')})` : 'Not a business day, so no reminders',
    `${plural(s.unverifiedRemoved, 'unverified registration')} removed`,
    `${plural(s.uploadsRemoved, 'unused upload')} removed`,
  ];
  return parts.join(' · ');
}

/** PRD 10.8: when the daily check runs, what it did last time, and a Run now button. */
function DailyCheckCard({ data, onRan }: { data: TrackingView; onRan: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const last = data.dailyCheck.lastRun;

  async function runNow() {
    setBusy(true);
    setMessage(null);
    try {
      const run = await runDailyCheckNow();
      setMessage({ tone: run.status === 'finished' ? 'success' : 'error', text: `Check finished: ${describeRun(run)}.` });
      onRan();
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof ApiError ? err.message : 'The check could not be run. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-slate-900">Daily automatic check</h2>
          <p className="text-sm text-slate-600">
            Every day at {data.dailyCheck.runTime} (India time). On business days it reminds reviewers after {plural(data.reminderFirstAfterDays, 'business day')}, then
            every {plural(data.reminderRepeatEveryDays, 'business day')}, and alerts Admin after {plural(data.escalationAfterDays, 'business day')}. It also removes
            registrations that were never verified and unused uploads. It never changes an application’s status.
          </p>
        </div>
        <SecondaryButton onClick={runNow} disabled={busy}>
          {busy ? 'Running…' : 'Run the check now'}
        </SecondaryButton>
      </div>
      <div className="text-sm">
        <span className="text-slate-500">Last run: </span>
        {last ? (
          <>
            <span className="font-medium text-slate-900">{formatDateTimeIST(last.startedAt)}</span>
            {last.trigger === 'admin' && <span className="text-slate-500"> (run by Admin)</span>}
            {last.status === 'failed' && (
              <span className="ml-2">
                <Badge color="red">Failed</Badge>
              </span>
            )}
            <div className="text-slate-700">{describeRun(last)}</div>
            {!!last.summary?.problems.length && <div className="text-amber-800">Needs attention: {last.summary.problems.join('; ')}</div>}
          </>
        ) : (
          <span className="text-slate-700">Not run yet.</span>
        )}
      </div>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
    </section>
  );
}

/** AD4: the approval pipeline, everything overdue, and the reminders sent. */
export function TrackingPage() {
  const [data, setData] = useState<TrackingView | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    getTracking()
      .then(setData)
      .catch(() => setError(true));
  }, []);
  useEffect(load, [load]);

  if (error) return <Alert tone="error">Approval tracking could not be loaded. Please refresh the page.</Alert>;
  if (!data) return <Loading />;

  const withReminders = data.overdue.filter((r) => r.reminders.length);

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

      <DailyCheckCard data={data} onRan={load} />

      <section>
        <h2 className="mb-1 font-semibold text-slate-900">Overdue</h2>
        <p className="mb-3 text-sm text-slate-600">Waiting more than {plural(data.reminderFirstAfterDays, 'business day')}, longest first.</p>
        {data.overdue.length ? (
          <ReviewTable rows={data.overdue} variant="admin" linkTo={(r) => `/app/admin/registrations/${r.id}`} />
        ) : (
          <div className="card text-sm text-slate-600">Nothing is overdue.</div>
        )}
      </section>

      {data.overdue.length > 0 && (
        <section>
          <h2 className="mb-1 font-semibold text-slate-900">Reminders sent</h2>
          <p className="mb-3 text-sm text-slate-600">Automatic reminders and Admin alerts for the overdue applications, since they reached their current stage.</p>
          {withReminders.length ? (
            <ul className="space-y-3">
              {withReminders.map((r) => (
                <li key={r.id} className="card">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link to={`/app/admin/registrations/${r.id}`} className="font-medium text-brand hover:underline">
                      {r.applicationId}
                    </Link>
                    <span className="text-sm text-slate-600">
                      {r.firmName} · waiting {plural(r.businessDaysWaiting, 'day')}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-1 text-sm">
                    {r.reminders.map((m, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-2">
                        <Badge color={m.kind === 'escalation' ? 'red' : 'amber'}>{m.kind === 'escalation' ? 'Admin alert' : 'Reminder'}</Badge>
                        <span className="text-slate-700">{formatDateTimeIST(m.at)}</span>
                        <span className="min-w-0 break-words text-slate-500">to {m.to}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            <div className="card text-sm text-slate-600">No reminders sent yet. They go out with the next daily check.</div>
          )}
        </section>
      )}
    </div>
  );
}
