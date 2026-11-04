import { Link } from 'react-router-dom';
import { ROLE_LABELS } from '@fap/shared';
import { useAuth } from '../auth/AuthContext';
import { NAVIGATION } from '../navigation';
import { FranchiseDashboardPage } from './franchise/FranchiseDashboardPage';

const ROLE_INTRO = {
  admin: 'You have full oversight of the portal: registrations, approvals, agreement content, users and settings.',
  accounts: 'You carry out the first-level review of new franchise applications.',
  manager: 'You give final approval and send the generated agreement to the franchisee.',
  franchise_user: 'Track your franchise application and see any action needed from you.',
} as const;

export function DashboardPage() {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role === 'franchise_user') return <FranchiseDashboardPage />;
  const screens = NAVIGATION[user.role].filter((i) => i.path !== '/app');

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Welcome, {user.name}</h1>
        <p className="mt-1 text-slate-600">
          {ROLE_LABELS[user.role]} dashboard. {ROLE_INTRO[user.role]}
        </p>
      </div>

      <div className="card">
        <h2 className="font-semibold text-slate-900">Your screens</h2>
        <p className="mt-1 text-sm text-slate-600">Summary cards for this dashboard arrive with the application screens.</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {screens.map((item) => (
            <li key={item.path}>
              <Link
                to={item.path}
                className="flex items-center justify-between rounded-md border border-slate-200 px-4 py-3 text-sm hover:border-brand hover:bg-slate-50"
              >
                <span className="font-medium text-slate-800">{item.label}</span>
                {item.step ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Step {item.step}</span>
                ) : (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">Ready</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
