import { useState } from 'react';
import { APPLICANT_STATUS_TEXT, type ApplicationDocumentView, type ApplicationStatus } from '@fap/shared';
import { myDocumentUrl } from '../api/franchise';
import { PdfViewer } from './PdfViewer';
import { Badge, Modal } from './ui';

const STATUS_COLOR: Record<ApplicationStatus, 'green' | 'gray' | 'amber' | 'red' | 'blue'> = {
  pending_verification: 'gray',
  pending_accounts: 'blue',
  pending_manager: 'blue',
  rejected_by_accounts: 'red',
  rejected_by_manager: 'red',
  approved: 'green',
};

/** Status badge using the wording shown to applicants. */
export function ApplicantStatusBadge({ status }: { status: ApplicationStatus }) {
  return <Badge color={STATUS_COLOR[status]}>{APPLICANT_STATUS_TEXT[status].label}</Badge>;
}

const DOC_LABELS: Record<ApplicationDocumentView['type'], string> = {
  pan: 'PAN',
  gst: 'GST Certificate',
  rental: 'Rental Agreement',
  id_proof: 'ID Proof',
  photo: 'Photograph',
};

/** A document name that opens in a viewer; files are fetched only after the server's ownership check. */
export function DocumentLink({ doc, label }: { doc: ApplicationDocumentView | null; label?: string }) {
  const [open, setOpen] = useState(false);
  if (!doc) return <span className="text-sm text-slate-500">Not provided</span>;
  const url = myDocumentUrl(doc.id);
  const isImage = doc.mimeType.startsWith('image/');

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex min-w-0 items-center gap-2 text-left text-sm font-medium text-brand hover:underline">
        {isImage ? (
          <img src={url} alt="" className="h-10 w-10 shrink-0 rounded border border-slate-200 object-cover" />
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-slate-200 bg-red-50 text-[10px] font-bold text-red-700">PDF</span>
        )}
        <span className="truncate">{label ?? doc.fileName}</span>
      </button>
      {open && (
        <Modal title={`${DOC_LABELS[doc.type]}: ${doc.fileName}`} onClose={() => setOpen(false)} wide>
          {isImage ? (
            <img src={url} alt={DOC_LABELS[doc.type]} className="mx-auto max-h-[70vh] max-w-full rounded" />
          ) : (
            <PdfViewer url={url} heightClass="h-[65vh]" label={doc.fileName} />
          )}
        </Modal>
      )}
    </>
  );
}

/** Label / value pair for read-only detail views. */
export function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-slate-900">{children}</dd>
    </div>
  );
}
