import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ROLES, type Role } from '@fap/shared';
import { AppLayout } from './components/AppLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { NAVIGATION } from './navigation';
import { AgreementEditorPage } from './pages/admin/AgreementEditorPage';
import { AgreementListPage } from './pages/admin/AgreementListPage';
import { AuditLogPage } from './pages/admin/AuditLogPage';
import { SettingsPage } from './pages/admin/SettingsPage';
import { UsersPage } from './pages/admin/UsersPage';
import { ComingSoonPage } from './pages/ComingSoonPage';
import { DashboardPage } from './pages/DashboardPage';
import { DevMailboxPage } from './pages/DevMailboxPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { RegistrationSuccessPage } from './pages/RegistrationSuccessPage';
import { RegistrationVerifyPage } from './pages/RegistrationVerifyPage';
import { ApplicationReviewPage } from './pages/accounts/ApplicationReviewPage';
import { PendingApplicationsPage } from './pages/accounts/PendingApplicationsPage';
import { ReviewedApplicationsPage } from './pages/accounts/ReviewedApplicationsPage';
import { MyApplicationPage } from './pages/franchise/MyApplicationPage';
import { GeneratedAgreementsPage } from './pages/manager/GeneratedAgreementsPage';
import { ManagerListPage } from './pages/manager/ManagerListPage';
import { ResubmitPage } from './pages/franchise/ResubmitPage';
import { ProfilePage } from './pages/franchise/ProfilePage';
import { SetPasswordPage } from './pages/SetPasswordPage';

// Every screen not yet built, with the role allowed to open it.
const plannedScreens = ROLES.flatMap((role) =>
  NAVIGATION[role].filter((item) => item.step).map((item) => ({ ...item, role })),
);

const only = (role: Role, element: ReactNode) => <ProtectedRoute roles={[role]}>{element}</ProtectedRoute>;

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/register/verify" element={<RegistrationVerifyPage />} />
      <Route path="/register/success" element={<ProtectedRoute roles={['franchise_user']}><RegistrationSuccessPage /></ProtectedRoute>} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/set-password" element={<SetPasswordPage />} />
      {import.meta.env.DEV && <Route path="/dev/mailbox" element={<DevMailboxPage />} />}

      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />

        <Route path="my-application" element={only('franchise_user', <MyApplicationPage />)} />
        <Route path="my-application/resubmit" element={only('franchise_user', <ResubmitPage />)} />
        <Route path="profile" element={only('franchise_user', <ProfilePage />)} />

        <Route path="accounts/pending" element={only('accounts', <PendingApplicationsPage />)} />
        <Route path="accounts/reviewed" element={only('accounts', <ReviewedApplicationsPage />)} />
        <Route path="accounts/applications/:id" element={only('accounts', <ApplicationReviewPage key="accounts" reviewer="accounts" />)} />

        <Route path="manager/pending" element={only('manager', <ManagerListPage key="pending" list="pending" />)} />
        <Route path="manager/approved" element={only('manager', <ManagerListPage key="approved" list="approved" />)} />
        <Route path="manager/rejected" element={only('manager', <ManagerListPage key="rejected" list="rejected" />)} />
        <Route path="manager/applications/:id" element={only('manager', <ApplicationReviewPage key="manager" reviewer="manager" />)} />
        <Route path="manager/agreements" element={only('manager', <GeneratedAgreementsPage />)} />

        <Route path="admin/agreement-content" element={only('admin', <AgreementListPage />)} />
        <Route path="admin/agreement-content/:id" element={only('admin', <AgreementEditorPage />)} />
        <Route path="admin/accounts-users" element={only('admin', <UsersPage key="accounts" role="accounts" />)} />
        <Route path="admin/manager-users" element={only('admin', <UsersPage key="manager" role="manager" />)} />
        <Route path="admin/audit-log" element={only('admin', <AuditLogPage />)} />
        <Route path="admin/settings" element={only('admin', <SettingsPage />)} />

        {plannedScreens.map((s) => (
          <Route
            key={s.path}
            path={s.path.replace('/app/', '')}
            element={only(s.role, <ComingSoonPage title={s.label} step={s.step} />)}
          />
        ))}
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Route>

      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
