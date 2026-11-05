import { useAuth } from '../auth/AuthContext';
import { AccountsDashboardPage } from './accounts/AccountsDashboardPage';
import { AdminDashboardPage } from './admin/AdminDashboardPage';
import { FranchiseDashboardPage } from './franchise/FranchiseDashboardPage';
import { ManagerDashboardPage } from './manager/ManagerDashboardPage';

/** The home screen: each role has its own dashboard (PRD F1, A1, M1, AD1). */
export function DashboardPage() {
  const { user } = useAuth();
  if (!user) return null;
  switch (user.role) {
    case 'franchise_user':
      return <FranchiseDashboardPage />;
    case 'accounts':
      return <AccountsDashboardPage />;
    case 'manager':
      return <ManagerDashboardPage />;
    case 'admin':
      return <AdminDashboardPage />;
  }
}
