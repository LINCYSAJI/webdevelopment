// Business vocabulary shared by the browser and the server (PRD §4, §6, §8).

export const ROLES = ['admin', 'accounts', 'manager', 'franchise_user'] as const;
export type Role = (typeof ROLES)[number];

export const INTERNAL_ROLES = ['admin', 'accounts', 'manager'] as const satisfies readonly Role[];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  accounts: 'Accounts',
  manager: 'Manager',
  franchise_user: 'Franchise Partner',
};

export const STATUSES = [
  'pending_verification',
  'pending_accounts',
  'rejected_by_accounts',
  'pending_manager',
  'rejected_by_manager',
  'approved',
  // The applicant asked for their data to be erased; the application is closed for good.
  'withdrawn',
] as const;
export type ApplicationStatus = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  pending_verification: 'Pending Verification',
  pending_accounts: 'Pending Accounts',
  rejected_by_accounts: 'Rejected by Accounts',
  pending_manager: 'Pending Manager',
  rejected_by_manager: 'Rejected by Manager',
  approved: 'Approved',
  withdrawn: 'Withdrawn (data erased)',
};

export const FIRM_TYPES = [
  'Sole Proprietorship',
  'Partnership Firm',
  'Limited Liability Partnership',
  'One Person Company',
  'Private Limited Company',
] as const;
export type FirmType = (typeof FIRM_TYPES)[number];

export const SIGNATORY_CAPACITIES = [
  'Owner / Proprietor',
  'Partner',
  'Director',
  'Authorised Representative',
] as const;
export type SignatoryCapacity = (typeof SIGNATORY_CAPACITIES)[number];
