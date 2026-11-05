import { getAdminAgreementEmailHistory, listAdminGeneratedAgreements } from '../../api/admin';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { formatDateIST, formatDateTimeIST, sendAgreementSchema, toFieldErrors, type AgreementEmailLogView, type GeneratedAgreementRow } from '@fap/shared';
import { ApiError } from '../../api/client';
import {
  agreementPdfUrl,
  getAgreementEmailDraft,
  getAgreementEmailHistory,
  listGeneratedAgreements,
  retryAgreementGeneration,
  sendAgreement,
} from '../../api/manager';
import { PdfViewer } from '../../components/PdfViewer';
import { Alert, Badge, Field, Loading, Modal, PageHeader, SecondaryButton } from '../../components/ui';

type Dialog = { kind: 'view' | 'send' | 'history'; row: GeneratedAgreementRow } | null;

/**
 * M5: every generated agreement, with View, Download, Send / Resend, Email History and Retry.
 * AD6 (viewer="admin"): the same list with Email History only — Admin never opens the PDF (open question Q1 default).
 */
export function GeneratedAgreementsPage({ viewer = 'manager' }: { viewer?: 'manager' | 'admin' }) {
  const isAdmin = viewer === 'admin';
  const [rows, setRows] = useState<GeneratedAgreementRow[] | null>(null);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(() => {
    (isAdmin ? listAdminGeneratedAgreements() : listGeneratedAgreements())
      .then(setRows)
      .catch(() => setError(true));
  }, [isAdmin]);
  useEffect(load, [load]);

  const retry = async (row: GeneratedAgreementRow) => {
    setRetrying(row.id);
    setNotice(null);
    try {
      const result = await retryAgreementGeneration(row.id);
      setNotice(
        result.status === 'generated'
          ? { tone: 'success', text: `The agreement PDF for ${row.referenceNumber} has been generated.` }
          : { tone: 'error', text: `Generation failed again: ${result.error ?? 'unknown error'}. Admin has been alerted.` },
      );
      load();
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof ApiError ? err.message : 'Could not retry generation.' });
    } finally {
      setRetrying(null);
    }
  };

  if (error) return <Alert tone="error">The list could not be loaded. Please refresh the page.</Alert>;
  if (!rows) return <Loading />;

  const q = search.trim().toLowerCase();
  const visible = rows.filter((r) => !q || [r.referenceNumber, r.applicationId, r.firmName, r.recipient].some((v) => v.toLowerCase().includes(q)));

  const emailStatus = (r: GeneratedAgreementRow) =>
    r.lastEmailStatus === 'sent' ? (
      <Badge color="green">Sent</Badge>
    ) : r.lastEmailStatus === 'failed' ? (
      <Badge color="red">Failed</Badge>
    ) : (
      <Badge color="amber">Not sent</Badge>
    );

  const historyButton = (r: GeneratedAgreementRow) => (
    <SecondaryButton className="px-3 py-1.5 text-xs" onClick={() => setDialog({ kind: 'history', row: r })}>
      Email History
    </SecondaryButton>
  );

  const actions = (r: GeneratedAgreementRow) =>
    isAdmin ? (
      <div className="flex flex-wrap items-center gap-2">
        {r.status === 'failed' && <Badge color="red">Generation Failed</Badge>}
        {r.status === 'pending' && <Badge color="gray">Generating…</Badge>}
        {historyButton(r)}
      </div>
    ) : r.status === 'generated' ? (
      <div className="flex flex-wrap gap-2">
        <SecondaryButton className="px-3 py-1.5 text-xs" onClick={() => setDialog({ kind: 'view', row: r })}>
          View
        </SecondaryButton>
        <a href={`${agreementPdfUrl(r.id)}?download=1`} className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
          Download
        </a>
        <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => setDialog({ kind: 'send', row: r })}>
          {r.timesSent > 0 ? 'Resend' : 'Send to Franchisee'}
        </button>
        {historyButton(r)}
      </div>
    ) : r.status === 'failed' ? (
      <div className="flex flex-wrap items-center gap-2">
        <Badge color="red">Generation Failed</Badge>
        <button className="btn-primary px-3 py-1.5 text-xs" disabled={retrying !== null} onClick={() => void retry(r)}>
          {retrying === r.id ? 'Generating…' : 'Retry Generation'}
        </button>
      </div>
    ) : (
      <Badge color="gray">Generating…</Badge>
    );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Generated Agreements"
        description={
          isAdmin
            ? 'Agreement records and their email history. Only Managers can open, download or send the PDFs.'
            : 'Agreement PDFs created on final approval. Only Managers can view, download or send them.'
        }
      />
      {notice && <div className="mb-4"><Alert tone={notice.tone}>{notice.text}</Alert></div>}

      <div className="mb-4 max-w-md">
        <label htmlFor="agreement-search" className="label">Search</label>
        <input id="agreement-search" className="input" placeholder="Reference, Application ID, firm or email" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {visible.length === 0 ? (
        <div className="card text-center text-sm text-slate-600">No generated agreements yet. They appear here after final approval.</div>
      ) : (
        <>
          <div className="card hidden overflow-x-auto p-0 xl:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Reference No.</th>
                  <th className="px-3 py-2">Firm</th>
                  <th className="px-3 py-2">Approved On</th>
                  <th className="px-3 py-2">PDF Generated</th>
                  <th className="px-3 py-2">Last Emailed</th>
                  <th className="px-3 py-2">Email Status</th>
                  <th className="px-3 py-2">Sent</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-3 py-2 font-medium text-slate-900">
                      {r.referenceNumber}
                      <Link to={isAdmin ? `/app/admin/registrations/${r.registrationId}` : `/app/manager/applications/${r.registrationId}`} className="block text-xs font-normal text-brand hover:underline">
                        {r.applicationId}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{r.firmName}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDateIST(r.approvedAt)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.generatedAt ? formatDateIST(r.generatedAt) : '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.lastEmailedAt ? formatDateTimeIST(r.lastEmailedAt) : '—'}</td>
                    <td className="px-3 py-2">{emailStatus(r)}</td>
                    <td className="px-3 py-2">{r.timesSent}</td>
                    <td className="px-3 py-2">{actions(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-3 xl:hidden">
            {visible.map((r) => (
              <li key={r.id} className="card space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-900">{r.referenceNumber}</div>
                    <div className="text-sm text-slate-700">{r.firmName}</div>
                    <Link to={isAdmin ? `/app/admin/registrations/${r.registrationId}` : `/app/manager/applications/${r.registrationId}`} className="text-xs text-brand hover:underline">
                      {r.applicationId}
                    </Link>
                  </div>
                  {emailStatus(r)}
                </div>
                <div className="text-xs text-slate-600">
                  Approved {formatDateIST(r.approvedAt)} · PDF {r.generatedAt ? formatDateIST(r.generatedAt) : '—'} · sent {r.timesSent}×
                  {r.lastEmailedAt ? ` · last ${formatDateTimeIST(r.lastEmailedAt)}` : ''}
                </div>
                {actions(r)}
              </li>
            ))}
          </ul>
        </>
      )}

      {dialog?.kind === 'view' && (
        <Modal title={`Agreement ${dialog.row.referenceNumber}`} onClose={() => setDialog(null)} wide>
          <PdfViewer url={agreementPdfUrl(dialog.row.id)} heightClass="h-[70vh]" label={`Agreement ${dialog.row.referenceNumber}`} />
        </Modal>
      )}
      {dialog?.kind === 'send' && (
        <SendDialog
          row={dialog.row}
          onClose={() => setDialog(null)}
          onSent={(text) => {
            setDialog(null);
            setNotice({ tone: 'success', text });
            load();
          }}
          onFailed={() => load()}
        />
      )}
      {dialog?.kind === 'history' && (
        <HistoryDialog row={dialog.row} load={isAdmin ? getAdminAgreementEmailHistory : getAgreementEmailHistory} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

/** "Send to Franchisee / Resend" (PRD M5): fixed recipient, editable subject and message, PDF attached. */
function SendDialog({ row, onClose, onSent, onFailed }: { row: GeneratedAgreementRow; onClose: () => void; onSent: (text: string) => void; onFailed: () => void }) {
  const [draft, setDraft] = useState<{ recipient: string; subject: string; message: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getAgreementEmailDraft(row.id)
      .then(setDraft)
      .catch(() => setError('The email could not be prepared. Please try again.'));
  }, [row.id]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    const parsed = sendAgreementSchema.safeParse(draft);
    if (!parsed.success) {
      setErrors(toFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setError(null);
    setBusy(true);
    try {
      const result = await sendAgreement(row.id, parsed.data);
      onSent(`Agreement ${row.referenceNumber} emailed to ${result.recipient}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The email could not be sent. Please try again.');
      onFailed();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`${row.timesSent > 0 ? 'Resend' : 'Send'} agreement ${row.referenceNumber}`}
      onClose={onClose}
      wide
      footer={
        <>
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <button className="btn-primary" type="submit" form="send-agreement" disabled={busy || !draft}>
            {busy ? 'Sending…' : 'Send'}
          </button>
        </>
      }
    >
      {!draft ? (
        error ? <Alert tone="error">{error}</Alert> : <Loading />
      ) : (
        <form id="send-agreement" onSubmit={submit} className="space-y-4">
          <div>
            <span className="label">To</span>
            <p className="rounded-md border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-700">{draft.recipient}</p>
            <p className="mt-1 text-xs text-slate-500">The signatory's registered email. It cannot be changed here.</p>
          </div>
          <Field label="Subject" required error={errors.subject}>
            {(a) => <input {...a} className="input" maxLength={200} value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />}
          </Field>
          <Field label="Message" required error={errors.message}>
            {(a) => <textarea {...a} className="input min-h-[200px]" maxLength={5000} value={draft.message} onChange={(e) => setDraft({ ...draft, message: e.target.value })} />}
          </Field>
          <p className="text-sm text-slate-600">
            📎 Attached: <strong>Franchise-Agreement-{row.referenceNumber.replace(/\//g, '-')}.pdf</strong>
          </p>
          {error && <Alert tone="error">{error}</Alert>}
        </form>
      )}
    </Modal>
  );
}

function HistoryDialog({ row, load, onClose }: { row: GeneratedAgreementRow; load: (id: string) => Promise<AgreementEmailLogView[]>; onClose: () => void }) {
  const [items, setItems] = useState<AgreementEmailLogView[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    load(row.id)
      .then(setItems)
      .catch(() => setError(true));
  }, [row.id, load]);

  return (
    <Modal title={`Email history: ${row.referenceNumber}`} onClose={onClose} wide>
      {error ? (
        <Alert tone="error">The history could not be loaded.</Alert>
      ) : !items ? (
        <Loading />
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-600">This agreement has not been emailed yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((h, i) => (
            <li key={i} className="py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-slate-900">{formatDateTimeIST(h.at)}</span>
                <Badge color={h.status === 'sent' ? 'green' : 'red'}>{h.status === 'sent' ? 'Sent' : 'Failed'}</Badge>
              </div>
              <div className="text-slate-700">
                To {h.recipient} · by {h.sentBy}
              </div>
              <div className="text-xs text-slate-500">Subject: {h.subject}</div>
              {h.error && <div className="mt-1 text-xs text-red-700">Error: {h.error}</div>}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
