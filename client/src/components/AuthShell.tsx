import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useBranding } from '../branding/BrandingContext';
import { BrandMark } from './BrandMark';
import { LegalFooter } from './LegalFooter';

/** Centred, branded card used by the public account pages. */
export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  const { portalName } = useBranding();
  return (
    <div className="flex min-h-screen flex-col">
    <div className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link to="/login" className="mb-6 flex flex-col items-center text-center">
          <BrandMark size={48} />
          <span className="mt-3 text-lg font-bold text-slate-900">{portalName}</span>
        </Link>
        <div className="card space-y-4">
          <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
          {children}
        </div>
      </div>
    </div>
    <LegalFooter />
    </div>
  );
}
