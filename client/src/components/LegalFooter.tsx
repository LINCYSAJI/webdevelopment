import { Link } from 'react-router-dom';
import { LEGAL_DOCUMENTS } from '@fap/shared';
import { useBranding } from '../branding/BrandingContext';

/** Site-wide footer with the Privacy Policy and Terms & Conditions links (shown on every page). */
export function LegalFooter({ className = '' }: { className?: string }) {
  const { organisationName, supportEmail, supportPhone } = useBranding();
  const support = [supportEmail, supportPhone].filter(Boolean).join(' · ');
  return (
    <footer className={`border-t border-slate-200 px-4 py-4 text-xs text-slate-500 ${className}`}>
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-2 text-center sm:flex-row sm:justify-between sm:text-left">
        <span>
          © {new Date().getFullYear()} {organisationName}
          {support && <span className="block sm:inline"><span className="hidden sm:inline"> · </span>{support}</span>}
        </span>
        <nav aria-label="Legal" className="flex gap-4">
          <Link to={LEGAL_DOCUMENTS.privacy.path} className="font-medium text-slate-600 hover:text-brand hover:underline">
            {LEGAL_DOCUMENTS.privacy.title}
          </Link>
          <Link to={LEGAL_DOCUMENTS.terms.path} className="font-medium text-slate-600 hover:text-brand hover:underline">
            {LEGAL_DOCUMENTS.terms.title}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
