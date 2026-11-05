import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AdminDashboardView } from '@fap/shared';
import { getAdminDashboard } from '../../api/admin';
import { useAuth } from '../../auth/AuthContext';
import { ReviewTable } from '../../components/ReviewTable';
import { Alert, Loading } from '../../components/ui';

const monthLabel = (key: string, withYear = false) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });

/** AD1: summary cards, registrations per month, average days per stage, and the overdue alerts. */
export function AdminDashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<AdminDashboardView | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    getAdminDashboard()
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error) return <Alert tone="error">The dashboard could not be loaded. Please refresh the page.</Alert>;
  if (!data) return <Loading />;

  const cards: { label: string; value: number; hint?: string; to: string; alert?: boolean }[] = [
    { label: 'Total Registrations', value: data.totalRegistrations, to: '/app/admin/registrations' },
    { label: 'Pending Verification', value: data.pendingVerification, hint: 'Email / mobile not yet verified', to: '/app/admin/registrations?status=pending_verification' },
    { label: 'Pending Accounts', value: data.pendingAccounts, to: '/app/admin/registrations?status=pending_accounts' },
    { label: 'Pending Manager', value: data.pendingManager, to: '/app/admin/registrations?status=pending_manager' },
    { label: 'Approved', value: data.approved, to: '/app/admin/approved' },
    { label: 'Rejected by Accounts', value: data.rejectedByAccounts, hint: 'Waiting for resubmission', to: '/app/admin/rejected?stage=accounts' },
    { label: 'Rejected by Manager', value: data.rejectedByManager, hint: 'Waiting for resubmission', to: '/app/admin/rejected?stage=manager' },
    { label: 'Duplicate Cases Open', value: data.duplicateCasesOpen, to: '/app/admin/duplicates', alert: data.duplicateCasesOpen > 0 },
    { label: 'Overdue', value: data.overdue, hint: `Waiting over ${data.escalationAfterDays} business days`, to: '/app/admin/tracking', alert: data.overdue > 0 },
    { label: 'Accounts Users', value: data.accountsUsers, hint: 'Active', to: '/app/admin/accounts-users' },
    { label: 'Manager Users', value: data.managerUsers, hint: 'Active', to: '/app/admin/manager-users' },
    { label: 'Agreement PDFs', value: data.generatedAgreements, hint: 'Generated', to: '/app/admin/agreements' },
    { label: 'Not Yet Emailed', value: data.agreementsNotYetEmailed, hint: 'Agreements the Manager has not sent', to: '/app/admin/agreements', alert: data.agreementsNotYetEmailed > 0 },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Welcome, {user?.name}</h1>
        <p className="mt-1 text-sm text-slate-600">Oversight of every registration, approval and agreement.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {cards.map((c) => (
          <Link key={c.label} to={c.to} className={`card block hover:border-brand ${c.alert ? 'border-amber-300 bg-amber-50' : ''}`}>
            <div className={`text-3xl font-bold ${c.alert ? 'text-amber-800' : 'text-slate-900'}`}>{c.value}</div>
            <div className="mt-1 text-sm font-medium text-slate-800">{c.label}</div>
            {c.hint && <div className="text-xs text-slate-500">{c.hint}</div>}
          </Link>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <RegistrationsChart data={data.registrationsPerMonth} />

        <section className="card">
          <h2 className="font-semibold text-slate-900">Average time at each stage</h2>
          <p className="mt-1 text-xs text-slate-500">Business days, from arriving at the stage to the decision.</p>
          <dl className="mt-4 space-y-4">
            {data.averageStageDays.map((s) => (
              <div key={s.stage}>
                <dt className="text-sm text-slate-600">{s.stage === 'accounts' ? 'Accounts review' : 'Manager approval'}</dt>
                <dd className="text-3xl font-bold text-slate-900">
                  {s.averageDays === null ? '—' : s.averageDays}
                  <span className="ml-1 text-sm font-normal text-slate-500">{s.averageDays === null ? 'no decisions yet' : `days · ${s.samples} decision${s.samples === 1 ? '' : 's'}`}</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Alerts: waiting more than {data.escalationAfterDays} business days</h2>
          <Link to="/app/admin/tracking" className="text-sm font-medium text-brand hover:underline">
            Approval tracking →
          </Link>
        </div>
        {data.alerts.length ? (
          <ReviewTable rows={data.alerts} variant="admin" linkTo={(r) => `/app/admin/registrations/${r.id}`} />
        ) : (
          <div className="card text-sm text-slate-600">Nothing is waiting longer than {data.escalationAfterDays} business days.</div>
        )}
      </section>
    </div>
  );
}

/** Single-series bar chart (one hue, no legend), with a hover tooltip and a table view. */
function RegistrationsChart({ data }: { data: AdminDashboardView['registrationsPerMonth'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const max = Math.max(1, ...data.map((d) => d.count));
  // A rounded, readable top for the scale (1, 2, 5, 10, 20, 50 …).
  const step = [1, 2, 5].map((m) => m * 10 ** Math.floor(Math.log10(max))).find((s) => s >= max / 4) ?? 10 ** Math.ceil(Math.log10(max));
  const top = Math.ceil(max / step) * step;
  const total = data.reduce((n, d) => n + d.count, 0);

  return (
    <section className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-semibold text-slate-900">Registrations per month</h2>
          <p className="text-xs text-slate-500">Applications that completed verification · last 12 months · {total} in total</p>
        </div>
        <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => setAsTable((t) => !t)} aria-pressed={asTable}>
          {asTable ? 'Show chart' : 'Show as table'}
        </button>
      </div>

      {asTable ? (
        <table className="mt-4 w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-1">Month</th>
              <th className="py-1 text-right">Registrations</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((d) => (
              <tr key={d.month}>
                <td className="py-1">{monthLabel(d.month, true)}</td>
                <td className="py-1 text-right tabular-nums">{d.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative mt-4" role="img" aria-label={`Registrations per month: ${data.map((d) => `${monthLabel(d.month, true)} ${d.count}`).join(', ')}`}>
          <div className="flex">
            {/* Scale */}
            <div className="flex h-44 w-7 shrink-0 flex-col justify-between pr-1 text-right text-[10px] tabular-nums text-slate-400" aria-hidden="true">
              <span>{top}</span>
              <span>{top / 2}</span>
              <span>0</span>
            </div>
            {/* Plot */}
            <div className="relative h-44 flex-1 border-b border-slate-300">
              <div className="absolute inset-x-0 top-0 border-t border-dashed border-slate-200" aria-hidden="true" />
              <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-slate-200" aria-hidden="true" />
              <div className="absolute inset-0 flex items-end gap-0.5">
                {data.map((d, i) => (
                  <div
                    key={d.month}
                    className="flex h-full flex-1 cursor-default items-end justify-center"
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    tabIndex={0}
                    aria-label={`${monthLabel(d.month, true)}: ${d.count}`}
                  >
                    <div
                      className={`w-full max-w-[28px] rounded-t bg-brand transition-opacity ${hover !== null && hover !== i ? 'opacity-50' : ''}`}
                      style={{ height: d.count ? `${(d.count / top) * 100}%` : 0, minHeight: d.count ? 2 : 0 }}
                    />
                  </div>
                ))}
              </div>
              {hover !== null && (
                <div
                  className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-1 text-xs shadow"
                  style={{ left: `${((hover + 0.5) / data.length) * 100}%` }}
                >
                  <span className="text-slate-500">{monthLabel(data[hover].month, true)}</span>{' '}
                  <span className="font-semibold text-slate-900">{data[hover].count}</span>
                </div>
              )}
            </div>
          </div>
          <div className="ml-7 mt-1 flex gap-0.5 text-center text-[10px] text-slate-500" aria-hidden="true">
            {data.map((d, i) => (
              // Every month on wide screens; every other month on phones.
              <span key={d.month} className={`flex-1 ${i % 2 === 1 && i !== data.length - 1 ? 'invisible sm:visible' : ''}`}>
                {monthLabel(d.month)}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
