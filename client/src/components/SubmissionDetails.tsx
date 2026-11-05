import type { SubmissionView } from '@fap/shared';
import { Detail, DocumentLink } from './ApplicationBits';

interface SubmissionDetailsProps {
  submission: SubmissionView;
  /** Address of a document (differs between the applicant's and the reviewers' screens). */
  urlFor?: (documentId: string) => string;
  /** Paths changed since the previous version (PRD A3 "Changes since last review"). */
  changes?: string[] | null;
}

/** Read-only view of every section of one submission. */
export function SubmissionDetails({ submission: s, urlFor, changes }: SubmissionDetailsProps) {
  const changed = (path: string) => !!changes?.includes(path);
  const contactAdded = (i: number) => !!changes?.includes(`contacts.${i}`);

  return (
    <div className="space-y-5">
      <section className="card">
        <h2 className="mb-4 font-semibold text-slate-900">Franchise Details</h2>
        <dl className="grid gap-4 sm:grid-cols-3">
          <Detail label="Franchise Model" changed={changed('franchiseModel')}>{s.franchiseModel}</Detail>
          <Detail label="Firm Type" changed={changed('firmType')}>{s.firmType}</Detail>
          <Detail label="Firm Name" changed={changed('firmName')}>{s.firmName}</Detail>
        </dl>
      </section>

      <section className="card">
        <h2 className="mb-4 font-semibold text-slate-900">Official Documents</h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Detail label="PAN Number" changed={changed('pan')}>{s.pan}</Detail>
          <Detail label="PAN Image" changed={changed('panDocument')}>
            <DocumentLink doc={s.panDocument} urlFor={urlFor} />
          </Detail>
          <Detail label="GST Number" changed={changed('gst')}>{s.gst ?? 'Not provided'}</Detail>
          <Detail label="GST Certificate" changed={changed('gstDocument')}>
            <DocumentLink doc={s.gstDocument} urlFor={urlFor} />
          </Detail>
          <Detail label="Rental Agreement" changed={changed('rentalDocument')}>
            <DocumentLink doc={s.rentalDocument} urlFor={urlFor} />
          </Detail>
        </dl>
      </section>

      <section className="card">
        <h2 className="mb-4 font-semibold text-slate-900">Applicant / Authorised Signatory</h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Detail label="Full Name" changed={changed('signatory.name')}>{s.signatory.name}</Detail>
          <Detail label="Capacity / Designation" changed={changed('signatory.capacity')}>{s.signatory.capacity}</Detail>
          <Detail label="Email ID" changed={changed('signatory.email')}>{s.signatory.email}</Detail>
          <Detail label="Mobile Number" changed={changed('signatory.mobile')}>+91 {s.signatory.mobile}</Detail>
          <Detail label="ID Proof" changed={changed('signatory.idProof')}>
            <DocumentLink doc={s.signatory.idProof} urlFor={urlFor} />
          </Detail>
          <Detail label="Photograph" changed={changed('signatory.photo')}>
            <DocumentLink doc={s.signatory.photo} urlFor={urlFor} />
          </Detail>
        </dl>
      </section>

      <section className="card">
        <h2 className="mb-4 font-semibold text-slate-900">Contact Persons ({s.contacts.length})</h2>
        <div className="space-y-4">
          {s.contacts.map((c, i) => (
            <div key={i} className={`rounded-md border p-4 ${contactAdded(i) ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}>
              <h3 className="mb-3 text-sm font-semibold text-slate-800">
                Contact {i + 1}
                {contactAdded(i) && <span className="ml-1 font-normal text-amber-800">· new</span>}
              </h3>
              <dl className="grid gap-4 sm:grid-cols-3">
                <Detail label="Name" changed={changed(`contacts.${i}.name`)}>{c.name}</Detail>
                <Detail label="Mobile Number" changed={changed(`contacts.${i}.mobile`)}>+91 {c.mobile}</Detail>
                <Detail label="Email ID" changed={changed(`contacts.${i}.email`)}>{c.email}</Detail>
                <Detail label="ID Proof" changed={changed(`contacts.${i}.idProof`)}>
                  <DocumentLink doc={c.idProof} urlFor={urlFor} />
                </Detail>
                <Detail label="Photograph" changed={changed(`contacts.${i}.photo`)}>
                  <DocumentLink doc={c.photo} urlFor={urlFor} />
                </Detail>
              </dl>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
