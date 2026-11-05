import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { STATUS_LABELS, decisionReasonSchema, describeChange, formatDateIST, formatDateTimeIST, type ReviewApplicationView } from '@fap/shared';
import { approveApplication, getApplicationForReview, pickUpApplication, rejectApplication, reviewDocumentUrl } from '../../api/accounts';
import { ApiError } from '../../api/client';
import { describeDuplicateField } from '../../lib/duplicates';
import { SubmissionDetails } from '../../components/SubmissionDetails';
import { Alert, Badge, Loading, Modal, SecondaryButton } from '../../components/ui';

/** A3: everything Accounts needs to review an application, with Pick Up / Approve / Reject. */
export function ApplicationReviewPage() {
  const { id = '' } = useParams();
  const [app, setApp] = useState<ReviewApplicationView | null>(null);
  const [version, setVersion] = useState<number | undefined>(undefined);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);

  const load = useCallback(
    (v?: number) => {
      getApplicationForReview(id, v)
        .then((a) => {
          setApp(a);
          setVersion(a.submission.version);
        })
        .catch((err) => setLoadError(err instanceof ApiError && err.status === 404 ? 'This application is not available to you.' : 'The application could not be loaded.'));
    },
    [id],
  );
  useEffect(() => load(), [load]);

  const act = async (action: () => Promise<ReviewApplicationView>, success: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const updated = await action();
      setApp(updated);
      setVersion(updated.submission.version);
      setDialog(null);
      setNotice({ tone: 'success', text: success });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setDialog(null);
      setNotice({ tone: 'error', text: err instanceof ApiError ? err.message : 'Something went wrong. Please try again.' });
      load(version);
    } finally {
      setBusy(false);
    }
  };

  const submitReject = () => {
    const parsed = decisionReasonSchema.safeParse({ reason });
    if (!parsed.success) {
      setReasonError(parsed.error.issues[0].message);
      return;
    }
    void act(() => rejectApplication(id, parsed.data.reason), 'Rejected. The applicant has been emailed your reason and how to resubmit.');
  };

  if (loadError) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <Alert tone="error">{loadError}</Alert>
        <Link to="/app/accounts/pending" className="btn-primary">Back to pending applications</Link>
      </div>
    );
  }
  if (!app) return <Loading />;

  const latest = app.versions[app.versions.length - 1];
  const viewingOld = app.submission.version !== latest;
  const { actions } = app;

  return (
    <div className="mx-auto max-w-7xl">
      <Link to="/app/accounts/pending" className="text-sm font-medium text-brand hover:underline">
        ← Pending applications
      </Link>

      {/* Header */}
      <div className="mb-4 mt-2 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900">{app.applicationId}</h1>
            <Badge color={app.status === 'pending_accounts' ? 'blue' : app.status.startsWith('rejected') ? 'red' : 'green'}>{STATUS_LABELS[app.status]}</Badge>
            {app.resubmissionCount > 0 && <Badge color="blue">Resubmitted ×{app.resubmissionCount}</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {app.submission.firmName} · submitted {formatDateIST(app.submittedAt)}
            {app.status === 'pending_accounts' && (
              <>
                {' '}· waiting <span className={app.overdue ? 'font-semibold text-red-700' : ''}>{app.businessDaysWaiting} business day{app.businessDaysWaiting === 1 ? '' : 's'}</span>
              </>
            )}
          </p>
          <p className="text-sm text-slate-600">Assigned to: {app.assignedTo?.name ?? 'Unassigned'}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {actions.canPickUp && (
            <button className="btn-primary" disabled={busy} onClick={() => void act(() => pickUpApplication(id), 'Picked up. This application is now assigned to you.')}>
              Pick Up
            </button>
          )}
          {(actions.canApprove || actions.approveBlockedReason) && (
            <button className="btn-primary" disabled={busy || !actions.canApprove || viewingOld} title={actions.approveBlockedReason ?? undefined} onClick={() => setDialog('approve')}>
              Approve
            </button>
          )}
          {actions.canReject && (
            <button className="btn-danger" disabled={busy || viewingOld} onClick={() => setDialog('reject')}>
              Reject
            </button>
          )}
        </div>
      </div>

      {notice && <div className="mb-4"><Alert tone={notice.tone}>{notice.text}</Alert></div>}

      {app.duplicate.open && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4" role="note">
          <h2 className="font-semibold text-amber-900">⚠ Possible duplicate — waiting for Admin review</h2>
          <ul className="mt-1 list-disc pl-5 text-sm text-amber-900">
            {app.duplicate.matches.map((m, i) => (
              <li key={i}>
                {describeDuplicateField(m.field)} <strong>{m.value}</strong> is also used in {m.matchedApplicationId ?? 'another registration'}
              </li>
            ))}
          </ul>
          {actions.approveBlockedReason && <p className="mt-2 text-sm text-amber-900">{actions.approveBlockedReason}</p>}
        </div>
      )}

      {app.status === 'pending_accounts' && app.assignedTo && !actions.canReject && (
        <div className="mb-4"><Alert tone="info">This application is assigned to {app.assignedTo.name}. You can view it, but only they can approve or reject it.</Alert></div>
      )}

      {app.changes && app.changes.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h2 className="font-semibold text-amber-900">Changes since last review (v{app.submission.version - 1} → v{app.submission.version})</h2>
          <ul className="mt-1 list-disc pl-5 text-sm text-amber-900">
            {app.changes.map((c) => (
              <li key={c}>{describeChange(c)}</li>
            ))}
          </ul>
        </div>
      )}
      {app.changes && app.changes.length === 0 && (
        <div className="mb-4"><Alert tone="info">This resubmission has no changes compared with the previous version.</Alert></div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          {app.versions.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="version" className="text-sm font-medium text-slate-700">Version</label>
              <select id="version" className="input w-auto" value={version} onChange={(e) => load(Number(e.target.value))}>
                {app.versions.map((v) => (
                  <option key={v} value={v}>
                    v{v}
                    {v === latest ? ' (latest)' : ''}
                  </option>
                ))}
              </select>
              {viewingOld && <span className="text-xs text-slate-500">Earlier version — decisions apply to the latest version only.</span>}
            </div>
          )}
          <SubmissionDetails submission={app.submission} urlFor={reviewDocumentUrl(app.id)} changes={app.changes} />
        </div>

        <aside className="space-y-5">
          <section className="card">
            <h2 className="font-semibold text-slate-900">Agreement Acceptance</h2>
            {app.agreement ? (
              <p className="mt-1 text-sm text-slate-700">
                Version {app.agreement.versionNumber} ({app.agreement.title}) accepted on {formatDateTimeIST(app.agreement.acceptedAt)}.
              </p>
            ) : (
              <p className="mt-1 text-sm text-slate-600">No acceptance recorded.</p>
            )}
          </section>

          <section className="card">
            <h2 className="mb-3 font-semibold text-slate-900">History</h2>
            <ol className="relative space-y-4 border-l border-slate-200 pl-4">
              {[...app.history].reverse().map((h, i) => (
                <li key={i}>
                  <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-brand" aria-hidden="true" />
                  <p className="text-sm font-medium text-slate-900">{h.title}</p>
                  <p className="text-xs text-slate-500">
                    {formatDateTimeIST(h.at)} · {h.by}
                    {h.submissionVersion ? ` · v${h.submissionVersion}` : ''}
                  </p>
                  {h.reason && <p className="mt-1 whitespace-pre-line rounded bg-slate-50 p-2 text-sm text-slate-700">{h.reason}</p>}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>

      {dialog === 'approve' && (
        <Modal
          title={`Approve ${app.applicationId}?`}
          onClose={() => setDialog(null)}
          footer={
            <>
              <SecondaryButton onClick={() => setDialog(null)}>Cancel</SecondaryButton>
              <button className="btn-primary" disabled={busy} onClick={() => void act(() => approveApplication(id), 'Approved. The application is now with the Manager for final approval.')}>
                {busy ? 'Approving…' : 'Approve'}
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-700">
            The application moves to the Manager for final approval. The applicant, the Managers and Admin are emailed.
          </p>
        </Modal>
      )}

      {dialog === 'reject' && (
        <Modal
          title={`Reject ${app.applicationId}?`}
          onClose={() => setDialog(null)}
          footer={
            <>
              <SecondaryButton onClick={() => setDialog(null)}>Cancel</SecondaryButton>
              <button className="btn-danger" disabled={busy} onClick={submitReject}>
                {busy ? 'Rejecting…' : 'Reject'}
              </button>
            </>
          }
        >
          <div className="space-y-2">
            <label htmlFor="reason" className="label">
              Reason <span className="text-red-600">*</span>
            </label>
            <textarea
              id="reason"
              className="input min-h-[120px]"
              maxLength={2000}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setReasonError(null);
              }}
              aria-invalid={!!reasonError}
              aria-describedby="reason-help"
            />
            <p id="reason-help" className={`text-xs ${reasonError ? 'text-red-700' : 'text-slate-500'}`}>
              {reasonError ?? 'At least 10 characters. The applicant sees this reason, so say exactly what to correct.'}
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
