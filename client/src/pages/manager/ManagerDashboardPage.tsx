import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ManagerDashboardView } from '@fap/shared';
import { getManagerDashboard } from '../../api/manager';
import { useAuth } from '../../auth/AuthContext';
import { ReviewTable } from '../../components/ReviewTable';
import { Alert, Loading } from '../../components/ui';

/** M1: summary cards and the oldest applications waiting for final approval. */
export function ManagerDashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<ManagerDashboardView | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    getManagerDashboard()
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error) return <Alert tone="error">The dashboard could not be loaded. Please refresh the page.</Alert>;
  if (!data) return <Loading />;

  const cards = [
    { label: 'Pending Approval', value: data.pendingApproval, hint: 'Waiting for your decision', to: '/app/manager/pending' },
    { label: 'Overdue', value: data.overdue, hint: 'Waiting more than the reminder period', to: '/app/manager/pending?overdue=1', alert: data.overdue > 0 },
    { label: 'Approved', value: data.approvedThisMonth, hint: 'This month', to: '/app/manager/approved' },
    { label: 'Rejected', value: data.rejectedThisMonth, hint: 'This month', to: '/app/manager/rejected' },
    { label: 'Not Yet Emailed', value: data.agreementsNotYetEmailed, hint: 'Agreements to send', to: '/app/manager/agreements', alert: data.agreementsNotYetEmailed > 0 },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Welcome, {user?.name}</h1>
        <p className="mt-1 text-sm text-slate-600">Give final approval and send the generated agreements to franchisees.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {cards.map((c) => (
          <Link key={c.label} to={c.to} className={`card block hover:border-brand ${c.alert ? 'border-amber-300 bg-amber-50' : ''}`}>
            <div className={`text-3xl font-bold ${c.alert ? 'text-amber-800' : 'text-slate-900'}`}>{c.value}</div>
            <div className="mt-1 text-sm font-medium text-slate-800">{c.label}</div>
            <div className="text-xs text-slate-500">{c.hint}</div>
          </Link>
        ))}
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Oldest waiting</h2>
          <Link to="/app/manager/pending" className="text-sm font-medium text-brand hover:underline">
            All pending approvals →
          </Link>
        </div>
        {data.oldest.length ? (
          <ReviewTable rows={data.oldest} variant="manager" linkTo={(r) => `/app/manager/applications/${r.id}`} />
        ) : (
          <div className="card text-sm text-slate-600">Nothing is waiting for final approval.</div>
        )}
      </section>
    </div>
  );
}
