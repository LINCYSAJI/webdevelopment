import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  DATA_REQUEST_STATUSES,
  DATA_REQUEST_STATUS_LABELS,
  STATUS_LABELS,
  formatDateTimeIST,
  type DataRequestRow,
  type DataRequestStatus,
  type Paginated,
} from '@fap/shared';
import { declineDataRequest, eraseDataRequest, listDataRequests } from '../../api/admin';
import { ApiError } from '../../api/client';
import { Alert, Badge, Loading, Modal, PageHeader, Pagination, SecondaryButton } from '../../components/ui';
import { updateParams } from '../../lib/listParams';

const STATUS_COLOR: Record<DataRequestStatus, 'amber' | 'green' | 'red' | 'gray'> = {
  pending: 'amber',
  completed: 'green',
  declined: 'red',
  cancelled: 'gray',
};

/** Admin: "Delete my account" requests from applicants (DPDP Act s.12). */
export function DataRequestsPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('status');
  const status = raw === 'all' ? undefined : ((DATA_REQUEST_STATUSES as readonly string[]).includes(raw ?? '') ? (raw as DataRequestStatus) : 'pending');
  const page = Math.max(1, Number(params.get('page')) || 1);

  const [data, setData] = useState<Paginated<DataRequestRow> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [erasing, setErasing] = useState<DataRequestRow | null>(null);
  const [declining, setDeclining] = useState<DataRequestRow | null>(null);

  const query = params.toString();
  const load = useCallback(() => {
    setData(null);
    listDataRequests({ status, page })
      .then(setData)
      .catch(() => setError('The list could not be loaded. Please refresh the page.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  useEffect(load, [load]);

  const set = (changes: Record<string, string | null>) => setParams(updateParams(params, changes), { replace: true });
  const done = (text: string) => {
    setErasing(null);
    setDeclining(null);
    setNotice(text);
    load();
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Data Deletion Requests"
        description="Applicants asking for their account to be closed and personal data erased (Digital Personal Data Protection Act, 2023). Reply without undue delay, and within 90 days at the latest."
      />

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
        {[...DATA_REQUEST_STATUSES, 'all' as const].map((s) => {
          const active = s === 'all' ? status === undefined : status === s;
          return (
            <button
              key={s}
              role="tab"
              aria-selected={active}
              onClick={() => set({ status: s === 'pending' ? null : s, page: null })}
              className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${active ? 'border-brand text-brand' : 'border-transparent text-slate-600'}`}
            >
              {s === 'all' ? 'All' : DATA_REQUEST_STATUS_LABELS[s]}
            </button>
          );
        })}
      </div>

      {notice && (
        <div className="mb-4">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}
      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {!data ? (
        !error && <Loading />
      ) : data.items.length === 0 ? (
        <div className="card text-center text-sm text-slate-600">No requests here.</div>
      ) : (
        <>
          <div className="space-y-3">
            {data.items.map((r) => (
              <article key={r.id} className="card space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900">{r.userName}</div>
                    <div className="break-all text-sm text-slate-600">{r.userEmail}</div>
                    <div className="mt-1 text-sm text-slate-600">
                      {r.applicationId ?? 'No application ID yet'}
                      {r.firmName ? ` · ${r.firmName}` : ''}
                      {r.applicationStatus ? ` · ${STATUS_LABELS[r.applicationStatus]}` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 text-left sm:text-right">
                    <Badge color={STATUS_COLOR[r.status]}>{DATA_REQUEST_STATUS_LABELS[r.status]}</Badge>
                    <div className="mt-1 text-xs text-slate-500">Requested {formatDateTimeIST(r.requestedAt)}</div>
                  </div>
                </div>

                {r.reason && (
                  <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                    <span className="font-medium">Reason given: </span>
                    {r.reason}
                  </p>
                )}

                {r.status !== 'pending' && r.decidedAt && (
                  <p className="text-sm text-slate-600">
                    {DATA_REQUEST_STATUS_LABELS[r.status]} on {formatDateTimeIST(r.decidedAt)}
                    {r.decidedByName && r.status !== 'cancelled' ? ` by ${r.decidedByName}` : ''}
                    {r.decisionNote ? `: ${r.decisionNote}` : ''}
                  </p>
                )}

                {r.status === 'pending' && (
                  <>
                    {r.eraseBlockedReason && <Alert tone="warning">{r.eraseBlockedReason}</Alert>}
                    <div className="flex flex-wrap gap-2">
                      <button className="btn-danger" disabled={!!r.eraseBlockedReason} onClick={() => setErasing(r)}>
                        Erase data…
                      </button>
                      <SecondaryButton onClick={() => setDeclining(r)}>Decline…</SecondaryButton>
                    </div>
                  </>
                )}
              </article>
            ))}
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => set({ page: String(p) })} />
        </>
      )}

      {erasing && <EraseDialog row={erasing} onClose={() => setErasing(null)} onDone={() => done(`${erasing.userName}'s account was closed and the personal data erased.`)} />}
      {declining && <DeclineDialog row={declining} onClose={() => setDeclining(null)} onDone={() => done('The request was declined and the applicant was emailed the reason.')} />}
    </div>
  );
}

function EraseDialog({ row, onClose, onDone }: { row: DataRequestRow; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const erase = async () => {
    setBusy(true);
    setError(null);
    try {
      await eraseDataRequest(row.id);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Erase personal data?"
      onClose={onClose}
      footer={
        <>
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <button className="btn-danger" disabled={busy} onClick={() => void erase()}>
            {busy ? 'Erasing…' : 'Erase permanently'}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-slate-700">
        <p>
          For <strong>{row.userName}</strong>
          {row.applicationId ? ` (${row.applicationId})` : ''}, this will:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>close the login and log the applicant out everywhere;</li>
          <li>withdraw the application, so it leaves every review queue;</li>
          <li>erase the firm, PAN, GST, signatory and contact details in the application and all its earlier versions;</li>
          <li>permanently delete every uploaded document;</li>
          <li>free the PAN and GST so they can register again in future.</li>
        </ul>
        <p>The audit log and the consent record are kept, without the documents. The applicant receives a final confirmation email.</p>
        <p className="font-medium text-red-700">This cannot be undone.</p>
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
}

function DeclineDialog({ row, onClose, onDone }: { row: DataRequestRow; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState(row.eraseBlockedReason ? 'Your franchise agreement has been approved, and the law requires us to keep it and the details in it.' : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decline = async () => {
    if (note.trim().length < 10) {
      setError('Explain the reason in at least 10 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await declineDataRequest(row.id, note.trim());
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Decline the request"
      onClose={onClose}
      footer={
        <>
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <button className="btn-primary" disabled={busy} onClick={() => void decline()}>
            {busy ? 'Sending…' : 'Decline and email reason'}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-slate-700">
        <p>Only decline when the law allows you to keep the data. The applicant will be emailed this reason and told how to complain.</p>
        <label htmlFor="decline-note" className="label">
          Reason <span className="text-red-600">*</span>
        </label>
        <textarea id="decline-note" rows={4} maxLength={2000} className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
}
