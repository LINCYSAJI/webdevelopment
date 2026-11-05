import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AccountsDashboardView } from '@fap/shared';
import { getAccountsDashboard } from '../../api/accounts';
import { useAuth } from '../../auth/AuthContext';
import { ReviewTable } from '../../components/ReviewTable';
import { Alert, Loading } from '../../components/ui';

/** A1: summary cards and the oldest applications waiting for this Accounts user. */
export function AccountsDashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<AccountsDashboardView | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    getAccountsDashboard()
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error) return <Alert tone="error">The dashboard could not be loaded. Please refresh the page.</Alert>;
  if (!data) return <Loading />;

  const cards = [
    { label: 'Unassigned', value: data.unassigned, hint: 'Waiting to be picked up', to: '/app/accounts/pending?tab=unassigned' },
    { label: 'Assigned to Me', value: data.assignedToMe, hint: 'Waiting for your decision', to: '/app/accounts/pending?tab=mine' },
    { label: 'Approved by Me', value: data.approvedByMeThisMonth, hint: 'This month', to: '/app/accounts/reviewed' },
    { label: 'Rejected by Me', value: data.rejectedByMeThisMonth, hint: 'This month', to: '/app/accounts/reviewed' },
    { label: 'Overdue', value: data.overdue, hint: 'Waiting more than the reminder period', to: '/app/accounts/pending?tab=all&overdue=1', alert: data.overdue > 0 },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Welcome, {user?.name}</h1>
        <p className="mt-1 text-sm text-slate-600">Accounts review: pick up new applications and approve or reject them.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {cards.map((c) => (
          <Link key={c.label} to={c.to} className={`card block hover:border-brand ${c.alert ? 'border-red-300 bg-red-50' : ''}`}>
            <div className={`text-3xl font-bold ${c.alert ? 'text-red-700' : 'text-slate-900'}`}>{c.value}</div>
            <div className="mt-1 text-sm font-medium text-slate-800">{c.label}</div>
            <div className="text-xs text-slate-500">{c.hint}</div>
          </Link>
        ))}
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Oldest waiting</h2>
          <Link to="/app/accounts/pending" className="text-sm font-medium text-brand hover:underline">
            All pending applications →
          </Link>
        </div>
        {data.oldest.length ? (
          <ReviewTable rows={data.oldest} linkTo={(r) => `/app/accounts/applications/${r.id}`} />
        ) : (
          <div className="card text-sm text-slate-600">Nothing is waiting for you right now.</div>
        )}
      </section>
    </div>
  );
}
