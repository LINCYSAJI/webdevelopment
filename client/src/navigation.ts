import type { Role } from '@fap/shared';

export interface NavItem {
  label: string;
  path: string;
  /** Build step in which this screen arrives; shown on the placeholder page until then. */
  step?: number;
}

// Menus from PRD §7.2–7.5. "Dashboard" is common to all roles and built now.
export const NAVIGATION: Record<Role, NavItem[]> = {
  franchise_user: [
    { label: 'Dashboard', path: '/app' },
    { label: 'My Application', path: '/app/my-application' },
    { label: 'My Profile', path: '/app/profile' },
  ],
  accounts: [
    { label: 'Dashboard', path: '/app' },
    { label: 'Pending Applications', path: '/app/accounts/pending' },
    { label: 'My Reviewed Applications', path: '/app/accounts/reviewed' },
  ],
  manager: [
    { label: 'Dashboard', path: '/app' },
    { label: 'Pending Approvals', path: '/app/manager/pending' },
    { label: 'Approved', path: '/app/manager/approved' },
    { label: 'Rejected', path: '/app/manager/rejected' },
    { label: 'Generated Agreements', path: '/app/manager/agreements' },
  ],
  admin: [
    { label: 'Dashboard', path: '/app' },
    { label: 'Franchise Registrations', path: '/app/admin/registrations' },
    { label: 'Duplicate Review', path: '/app/admin/duplicates' },
    { label: 'Approval Tracking', path: '/app/admin/tracking' },
    { label: 'Approved Applications', path: '/app/admin/approved' },
    { label: 'Rejected Applications', path: '/app/admin/rejected' },
    { label: 'Generated Agreements', path: '/app/admin/agreements' },
    { label: 'Agreement Content', path: '/app/admin/agreement-content' },
    { label: 'Accounts Users', path: '/app/admin/accounts-users' },
    { label: 'Manager Users', path: '/app/admin/manager-users' },
    { label: 'Audit Log', path: '/app/admin/audit-log' },
    { label: 'Data Deletion Requests', path: '/app/admin/data-requests' },
    { label: 'Email Templates', path: '/app/admin/email-templates' },
    { label: 'SMS Notifications', path: '/app/admin/sms' },
    { label: 'Settings', path: '/app/admin/settings' },
  ],
};
