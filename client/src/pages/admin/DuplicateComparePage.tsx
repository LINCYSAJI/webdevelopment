import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { STATUS_LABELS, duplicateDecisionSchema, formatDateTimeIST, type DuplicateComparisonView } from '@fap/shared';
import { adminDocumentUrl, decideDuplicate, getDuplicateComparison } from '../../api/admin';
import { ApiError } from '../../api/client';
import { SubmissionDetails } from '../../components/SubmissionDetails';
import { Alert, Badge, Loading, Modal, SecondaryButton } from '../../components/ui';
import { describeDuplicateField } from '../../lib/duplicates';

type Decision = 'not-duplicate' | 'confirm';

const DECISIONS: Record<Decision, { title: string; button: string; help: string; done: string }> = {
  'not-duplicate': {
    title: 'Mark as Not a Duplicate',
    button: 'Mark as Not a Duplicate',
    help: 'The flag is cleared and Accounts can approve the application. Explain why the shared details are acceptable.',
    done: 'Marked as not a duplicate. Accounts can now approve the application.',
  },
  confirm: {
    title: 'Confirm Duplicate',
    button: 'Confirm Duplicate',
    help: 'Approve stays blocked, and the reviewer is emailed to reject the application with your note as the reason. You do not reject it yourself.',
    done: 'Duplicate confirmed. The reviewer has been asked to reject the application with your note.',
  },
};

/** AD3: the flagged application and the matching registration(s), side by side, with the two decisions. */
export function DuplicateComparePage() {
  const { id = '' } = useParams();
  const [data, setData] = useState<DuplicateComparisonView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Decision | null>(null);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(() => {
    getDuplicateComparison(id)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'The comparison could not be loaded.'));
  }, [id]);
  useEffect(load, [load]);

  const decide = async () => {
    if (!dialog) return;
    const parsed = duplicateDecisionSchema.safeParse({ note });
    if (!parsed.success) {
      setNoteError(parsed.error.issues[0].message);
      return;
    }
    setBusy(true);
    try {
      await decideDuplicate(id, dialog, parsed.data.note);
      setNotice({ tone: 'success', text: DECISIONS[dialog].done });
      setDialog(null);
      setNote('');
      load();
    } catch (err) {
      setDialog(null);
      setNotice({ tone: 'error', text: err instanceof ApiError ? err.message : 'Something went wrong. Please try again.' });
      load();
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <Alert tone="error">{error}</Alert>
        <Link to="/app/admin/duplicates" className="btn-primary">
          Back to Duplicate Review
        </Link>
      </div>
    );
  }
  if (!data) return <Loading />;

  const open = data.status === 'open';

  return (
    <div className="mx-auto max-w-7xl">
      <Link to="/app/admin/duplicates" className="text-sm font-medium text-brand hover:underline">
        ← Duplicate Review
      </Link>
      <div className="mb-4 mt-2 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Possible duplicate: {data.application.applicationId}</h1>
          <p className="mt-1 text-sm text-slate-600">Flagged {formatDateTimeIST(data.raisedAt)}</p>
        </div>
        {open && (
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" onClick={() => setDialog('not-duplicate')}>
              Mark as Not a Duplicate
            </button>
            <button className="btn-danger" onClick={() => setDialog('confirm')}>
              Confirm Duplicate
            </button>
          </div>
        )}
      </div>

      {notice && (
        <div className="mb-4">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}
      {!open && !notice && (
        <div className="mb-4">
          <Alert tone="info">
            Already decided: {data.status === 'not_duplicate' ? 'not a duplicate' : 'confirmed duplicate'}
            {data.note ? ` — ${data.note}` : ''}
          </Alert>
        </div>
      )}

      <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
        <h2 className="font-semibold text-amber-900">Matching details</h2>
        <ul className="mt-1 list-disc pl-5 text-sm text-amber-900">
          {data.matches.map((m, i) => (
            <li key={i}>
              {describeDuplicateField(m.field)} <strong className="break-all">{m.value}</strong> is also used in {m.matchedApplicationId ?? 'another registration'}
              {m.matchedFirmName ? ` (${m.matchedFirmName})` : ''}
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Column title={`This application: ${data.application.applicationId}`} status={STATUS_LABELS[data.application.status]} link={`/app/admin/registrations/${data.application.id}`}>
          <SubmissionDetails submission={data.application.submission} urlFor={adminDocumentUrl(data.application.id)} />
        </Column>
        {data.others.map((o) =>
          'erased' in o ? (
            <div key={o.id} className="card text-sm text-slate-600">
              The matching registration was withdrawn and its personal data erased at the applicant's request.
            </div>
          ) : (
            <Column key={o.id} title={`Matching: ${o.applicationId || 'unverified registration'}`} status={STATUS_LABELS[o.status]} link={`/app/admin/registrations/${o.id}`}>
              <SubmissionDetails submission={o.submission} urlFor={adminDocumentUrl(o.id)} />
            </Column>
          ),
        )}
      </div>

      {dialog && (
        <Modal
          title={DECISIONS[dialog].title}
          onClose={() => !busy && setDialog(null)}
          footer={
            <>
              <SecondaryButton onClick={() => setDialog(null)} disabled={busy}>
                Cancel
              </SecondaryButton>
              <button className={dialog === 'confirm' ? 'btn-danger' : 'btn-primary'} disabled={busy} onClick={() => void decide()}>
                {busy ? 'Saving…' : DECISIONS[dialog].button}
              </button>
            </>
          }
        >
          <div className="space-y-2">
            <p className="text-sm text-slate-700">{DECISIONS[dialog].help}</p>
            <label htmlFor="note" className="label">
              Note <span className="text-red-600">*</span>
            </label>
            <textarea
              id="note"
              className="input min-h-[110px]"
              maxLength={2000}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setNoteError(null);
              }}
              aria-invalid={!!noteError}
            />
            <p className={`text-xs ${noteError ? 'text-red-700' : 'text-slate-500'}`}>{noteError ?? 'At least 10 characters. Recorded in the history and the audit log.'}</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Column({ title, status, link, children }: { title: string; status: string; link: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <Badge color="gray">{status}</Badge>
        <Link to={link} className="text-sm font-medium text-brand hover:underline">
          Open
        </Link>
      </div>
      {children}
    </section>
  );
}
