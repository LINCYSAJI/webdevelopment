import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatDateIST } from '@fap/shared';
import { useBranding } from '../../branding/BrandingContext';
import { BrandMark } from '../../components/BrandMark';
import { LegalFooter } from '../../components/LegalFooter';

/** Public, readable layout for the Privacy Policy and Terms & Conditions. */
export function LegalPageLayout({ title, version, effectiveDate, children }: { title: string; version: string; effectiveDate: string; children: ReactNode }) {
  const { portalName } = useBranding();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <Link to="/login" aria-label="Back to the portal">
            <BrandMark size={36} />
          </Link>
          <span className="truncate font-semibold text-slate-900">{portalName}</span>
        </div>
      </header>
      <main className="flex-1 px-4 py-6 sm:py-10">
        <article className="legal-content mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-5 sm:p-8">
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            Version {version} · Effective from {formatDateIST(`${effectiveDate}T00:00:00+05:30`)}
          </p>
          <div className="mt-6 space-y-6 text-sm leading-relaxed text-slate-700">{children}</div>
        </article>
      </main>
      <LegalFooter />
    </div>
  );
}

export function LegalSection({ id, number, title, children }: { id?: string; number: number; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4 space-y-2">
      <h2 className="text-base font-semibold text-slate-900">
        {number}. {title}
      </h2>
      {children}
    </section>
  );
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
