import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { STATUS_LABELS, decisionReasonSchema, describeChange, formatDateIST, formatDateTimeIST, type ReviewApplicationView } from '@fap/shared';
import { approveApplication, getApplicationForReview, pickUpApplication, rejectApplication, reviewDocumentUrl } from '../../api/accounts';
import { ApiError } from '../../api/client';
import { getApplicationForManager, managerApprove, managerDocumentUrl, managerReject } from '../../api/manager';
import { adminDocumentUrl, getRegistration, listUsers, reassignRegistration } from '../../api/admin';
import { SubmissionDetails } from '../../components/SubmissionDetails';
import { Alert, Badge, Loading, Modal, SecondaryButton } from '../../components/ui';
import { describeDuplicateField } from '../../lib/duplicates';

type Reviewer = 'accounts' | 'manager' | 'admin';

const adminOnly = () => Promise.reject(new Error('Admin cannot approve or reject applications.'));

/** What differs between the Accounts (PRD A3) and Manager (PRD M3) review screens. */
const REVIEWERS = {
  accounts: {
    back: { to: '/app/accounts/pending', label: 'Pending applications' },
    get: getApplicationForReview,
    pickUp: pickUpApplication,
    approve: async (id: string) => ({ application: await approveApplication(id), message: 'Approved. The application is now with the Manager for final approval.' }),
    reject: rejectApplication,
    docUrl: reviewDocumentUrl,
    approveText: 'The application moves to the Manager for final approval. The applicant, the Managers and Admin are emailed.',
  },
  manager: {
    back: { to: '/app/manager/pending', label: 'Pending approvals' },
    get: getApplicationForManager,
    pickUp: null,
    approve: async (id: string) => {
      const r = await managerApprove(id);
      const pdf =
        r.generation?.status === 'generated'
          ? 'The agreement PDF has been generated — open Generated Agreements to send it to the franchisee.'
          : 'The approval is saved, but the agreement PDF could not be generated. Use "Retry Generation" on Generated Agreements.';
      return { application: r.application, message: `Approved with reference number ${r.referenceNumber}. ${pdf}`, warn: r.generation?.status !== 'generated' };
    },
    reject: managerReject,
    docUrl: managerDocumentUrl,
    approveText:
      'This is the final approval. The agreement reference number is assigned and the agreement PDF is generated automatically. The applicant and Admin are emailed.',
  },
  // AD2: read-only for Admin; the only action is Reassign.
  admin: {
    back: { to: '/app/admin/registrations', label: 'Franchise registrations' },
    get: getRegistration,
    pickUp: null,
    approve: adminOnly,
    reject: adminOnly,
    docUrl: adminDocumentUrl,
    approveText: '',
  },
} as const;

/** A3 / M3 / AD2: everything a reviewer needs, with the actions this user may take. */
export function ApplicationReviewPage({ reviewer = 'accounts' }: { reviewer?: Reviewer }) {
  const cfg = REVIEWERS[reviewer];
  const { id = '' } = useParams();
  const [app, setApp] = useState<ReviewApplicationView | null>(null);
  const [version, setVersion] = useState<number | undefined>(undefined);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'approve' | 'reject' | 'pickup' | null>(null);
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);

  const load = useCallback(
    (v?: number) => {
      cfg
        .get(id, v)
        .then((a) => {
          setApp(a);
          setVersion(a.submission.version);
        })
        .catch((err) =>
          setLoadError(
            err instanceof ApiError && err.status === 410
              ? err.message
              : err instanceof ApiError && err.status === 404
                ? 'This application is not available to you.'
                : 'The application could not be loaded.',
          ),
        );
    },
    [id, cfg],
  );
  useEffect(() => load(), [load]);

  const act = async (kind: 'approve' | 'reject' | 'pickup', action: () => Promise<{ application: ReviewApplicationView; message: string; warn?: boolean }>) => {
    setBusy(kind);
    setNotice(null);
    try {
      const { application, message, warn } = await action();
      setApp(application);
      setVersion(application.submission.version);
      setDialog(null);
      setNotice({ tone: warn ? 'warning' : 'success', text: message });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setDialog(null);
      setNotice({ tone: 'error', text: err instanceof ApiError ? err.message : 'Something went wrong. Please try again.' });
      load(version);
    } finally {
      setBusy(null);
    }
  };

  const submitReject = () => {
    const parsed = decisionReasonSchema.safeParse({ reason });
    if (!parsed.success) {
      setReasonError(parsed.error.issues[0].message);
      return;
    }
    void act('reject', async () => ({
      application: await cfg.reject(id, parsed.data.reason),
      message: 'Rejected. The applicant has been emailed your reason and how to resubmit.',
    }));
  };

  if (loadError) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <Alert tone="error">{loadError}</Alert>
        <Link to={cfg.back.to} className="btn-primary">
          Back to {cfg.back.label.toLowerCase()}
        </Link>
      </div>
    );
  }
  if (!app) return <Loading />;

  const latest = app.versions[app.versions.length - 1];
  const viewingOld = app.submission.version !== latest;
  const { actions } = app;
  const waiting = app.status === 'pending_accounts' || app.status === 'pending_manager';
  const pickUp = cfg.pickUp;

  return (
    <div className="mx-auto max-w-7xl">
      <Link to={cfg.back.to} className="text-sm font-medium text-brand hover:underline">
        ← {cfg.back.label}
      </Link>

      {/* Header */}
      <div className="mb-4 mt-2 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900">{app.applicationId}</h1>
            <Badge color={waiting ? 'blue' : app.status.startsWith('rejected') ? 'red' : 'green'}>{STATUS_LABELS[app.status]}</Badge>
            {app.resubmissionCount > 0 && <Badge color="blue">Resubmitted ×{app.resubmissionCount}</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {app.submission.firmName} · submitted {formatDateIST(app.submittedAt)}
            {waiting && (
              <>
                {' '}· waiting{' '}
                <span className={app.overdue ? 'font-semibold text-red-700' : ''}>
                  {app.businessDaysWaiting} business day{app.businessDaysWaiting === 1 ? '' : 's'}
                </span>
              </>
            )}
          </p>
          {(reviewer === 'accounts' || (reviewer === 'admin' && app.status === 'pending_accounts')) && (
            <p className="text-sm text-slate-600">Assigned to: {app.assignedTo?.name ?? 'Unassigned'}</p>
          )}
          {app.agreementReferenceNo && (
            <p className="text-sm text-slate-600">
              Agreement reference: <strong className="text-slate-900">{app.agreementReferenceNo}</strong>
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {pickUp && actions.canPickUp && (
            <button
              className="btn-primary"
              disabled={busy !== null}
              onClick={() => void act('pickup', async () => ({ application: await pickUp(id), message: 'Picked up. This application is now assigned to you.' }))}
            >
              Pick Up
            </button>
          )}
          {(actions.canApprove || actions.approveBlockedReason) && (
            <button className="btn-primary" disabled={busy !== null || !actions.canApprove || viewingOld} title={actions.approveBlockedReason ?? undefined} onClick={() => setDialog('approve')}>
              Approve
            </button>
          )}
          {actions.canReject && (
            <button className="btn-danger" disabled={busy !== null || viewingOld} onClick={() => setDialog('reject')}>
              Reject
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div className="mb-4">
          <Alert tone={notice.tone}>
            {notice.text}
            {reviewer === 'manager' && app.status === 'approved' && (
              <>
                {' '}
                <Link to="/app/manager/agreements" className="font-medium underline">
                  Go to Generated Agreements
                </Link>
              </>
            )}
          </Alert>
        </div>
      )}

      {app.duplicate.open && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4" role="note">
          <h2 className="font-semibold text-amber-900">
            {app.duplicate.confirmed ? '⚠ Admin confirmed this is a duplicate' : '⚠ Possible duplicate — waiting for Admin review'}
          </h2>
          <ul className="mt-1 list-disc pl-5 text-sm text-amber-900">
            {app.duplicate.matches.map((m, i) => (
              <li key={i}>
                {describeDuplicateField(m.field)} <strong>{m.value}</strong> is also used in {m.matchedApplicationId ?? 'another registration'}
              </li>
            ))}
          </ul>
          {app.duplicate.confirmed ? (
            <p className="mt-2 text-sm text-amber-900">
              Admin's note ({formatDateTimeIST(app.duplicate.confirmed.at)}): <strong>{app.duplicate.confirmed.note}</strong>
              {reviewer !== 'admin' && ' Please reject the application using this note as the reason. Approve is not available.'}
            </p>
          ) : (
            actions.approveBlockedReason && <p className="mt-2 text-sm text-amber-900">{actions.approveBlockedReason}</p>
          )}
          {reviewer === 'admin' && !app.duplicate.confirmed && (
            <Link to="/app/admin/duplicates" className="mt-2 inline-block text-sm font-medium text-amber-900 underline">
              Open Duplicate Review
            </Link>
          )}
        </div>
      )}

      {reviewer === 'accounts' && app.status === 'pending_accounts' && app.assignedTo && !actions.canReject && (
        <div className="mb-4">
          <Alert tone="info">This application is assigned to {app.assignedTo.name}. You can view it, but only they can approve or reject it.</Alert>
        </div>
      )}

      {app.changes && app.changes.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h2 className="font-semibold text-amber-900">
            Changes since last review (v{app.submission.version - 1} → v{app.submission.version})
          </h2>
          <ul className="mt-1 list-disc pl-5 text-sm text-amber-900">
            {app.changes.map((c) => (
              <li key={c}>{describeChange(c)}</li>
            ))}
          </ul>
        </div>
      )}
      {app.changes && app.changes.length === 0 && (
        <div className="mb-4">
          <Alert tone="info">This resubmission has no changes compared with the previous version.</Alert>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          {app.versions.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="version" className="text-sm font-medium text-slate-700">
                Version
              </label>
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
          <SubmissionDetails submission={app.submission} urlFor={cfg.docUrl(app.id)} changes={app.changes} />
        </div>

        <aside className="space-y-5">
          {reviewer === 'admin' && actions.canReassign && <ReassignCard app={app} onDone={() => load(version)} />}

          {reviewer !== 'accounts' && (
            <section className="card">
              <h2 className="font-semibold text-slate-900">Accounts Decision</h2>
              {app.accountsDecision ? (
                <p className="mt-1 text-sm text-slate-700">
                  Approved by {app.accountsDecision.by} on {formatDateTimeIST(app.accountsDecision.at)}.
                </p>
              ) : (
                <p className="mt-1 text-sm text-slate-600">No Accounts approval recorded.</p>
              )}
            </section>
          )}

          {reviewer !== 'accounts' && app.generatedAgreement && (
            <section className="card">
              <h2 className="font-semibold text-slate-900">Agreement PDF</h2>
              <p className="mt-1 text-sm text-slate-700">
                {app.generatedAgreement.status === 'generated' && `Generated on ${formatDateTimeIST(app.generatedAgreement.generatedAt!)} (${app.generatedAgreement.pageCount} pages).`}
                {app.generatedAgreement.status === 'failed' && <span className="text-red-700">Generation failed.</span>}
                {app.generatedAgreement.status === 'pending' && 'Being generated…'}
              </p>
              <Link to={`/app/${reviewer}/agreements`} className="mt-2 inline-block text-sm font-medium text-brand hover:underline">
                Open Generated Agreements →
              </Link>
            </section>
          )}

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
          onClose={() => busy === null && setDialog(null)}
          footer={
            <>
              <SecondaryButton onClick={() => setDialog(null)} disabled={busy !== null}>
                Cancel
              </SecondaryButton>
              <button className="btn-primary" disabled={busy !== null} onClick={() => void act('approve', () => cfg.approve(id))}>
                {busy === 'approve' ? (reviewer === 'manager' ? 'Generating agreement PDF…' : 'Approving…') : 'Approve'}
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-700">{cfg.approveText}</p>
          {busy === 'approve' && reviewer === 'manager' && (
            <div className="mt-4" role="status">
              <div className="h-2 w-full overflow-hidden rounded bg-slate-200">
                <div className="h-2 w-1/2 animate-pulse rounded bg-brand" />
              </div>
              <p className="mt-2 text-xs text-slate-500">Assigning the reference number and generating the agreement PDF…</p>
            </div>
          )}
        </Modal>
      )}

      {dialog === 'reject' && (
        <Modal
          title={`Reject ${app.applicationId}?`}
          onClose={() => setDialog(null)}
          footer={
            <>
              <SecondaryButton onClick={() => setDialog(null)}>Cancel</SecondaryButton>
              <button className="btn-danger" disabled={busy !== null} onClick={submitReject}>
                {busy === 'reject' ? 'Rejecting…' : 'Reject'}
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

/** AD2: move a Pending Accounts application to another active Accounts user (logged; the new assignee is emailed). */
function ReassignCard({ app, onDone }: { app: ReviewApplicationView; onDone: () => void }) {
  const [users, setUsers] = useState<{ id: string; name: string }[] | null>(null);
  const [toUserId, setToUserId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    listUsers('accounts')
      .then((all) => setUsers(all.filter((u) => u.isActive && u.passwordSet).map((u) => ({ id: u.id, name: u.name }))))
      .catch(() => setUsers([]));
  }, []);

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await reassignRegistration(app.id, { toUserId: toUserId === 'unassigned' ? null : toUserId, note: note.trim() });
      setMessage({ tone: 'success', text: 'Reassigned. The new assignee has been emailed.' });
      setToUserId('');
      setNote('');
      onDone();
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof ApiError ? err.message : 'Something went wrong. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card space-y-3">
      <h2 className="font-semibold text-slate-900">Reassign Accounts reviewer</h2>
      {!users ? (
        <Loading />
      ) : (
        <>
          <div>
            <label htmlFor="reassign-to" className="label">
              Assign to
            </label>
            <select id="reassign-to" className="input" value={toUserId} onChange={(e) => setToUserId(e.target.value)}>
              <option value="">Choose…</option>
              {app.assignedTo && <option value="unassigned">Unassigned (back to the queue)</option>}
              {users
                .filter((u) => u.id !== app.assignedTo?.id)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label htmlFor="reassign-note" className="label">
              Note (optional)
            </label>
            <textarea id="reassign-note" rows={2} maxLength={500} className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {message && <Alert tone={message.tone}>{message.text}</Alert>}
          <button className="btn-primary" disabled={busy || !toUserId} onClick={() => void submit()}>
            {busy ? 'Reassigning…' : 'Reassign'}
          </button>
        </>
      )}
    </section>
  );
}
