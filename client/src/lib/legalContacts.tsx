import { useBranding } from '../branding/BrandingContext';

/** Contact details from Settings; shows "not yet published" rather than inventing them. */
export function useLegalContacts() {
  const b = useBranding();
  const missing = <em className="text-slate-500">(to be published)</em>;
  return {
    org: b.organisationName,
    portal: b.portalName,
    address: b.registeredAddress ?? missing,
    officerName: b.grievanceOfficerName ?? 'Grievance Officer',
    officerEmail: b.grievanceOfficerEmail ?? b.supportEmail,
    supportEmail: b.supportEmail,
    supportPhone: b.supportPhone,
    missing,
  };
}
