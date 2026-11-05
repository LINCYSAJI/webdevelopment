import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  AGREEMENT_RETENTION_YEARS,
  LEGAL_DOCUMENTS,
  changePasswordSchema,
  contactChangeStartSchema,
  dataDeletionRequestSchema,
  formatDateIST,
  formatDateTimeIST,
  toFieldErrors,
  type ContactKind,
  type DataDeletionRequestInput,
  type MyDataRequestView,
} from '@fap/shared';
import { changePassword } from '../../api/auth';
import { ApiError } from '../../api/client';
import { cancelAccountDeletion, confirmContactChange, getMyApplication, getMyDeletionRequest, requestAccountDeletion, startContactChange } from '../../api/franchise';
import { useAuth } from '../../auth/AuthContext';
import { Detail } from '../../components/ApplicationBits';
import { OtpBox } from '../../components/OtpBox';
import { PasswordRules } from '../../components/PasswordRules';
import { Alert, Field, Loading, PageHeader, SecondaryButton } from '../../components/ui';

/** F4: the signatory's details, Change Password, Change email / mobile with a code, and Delete my account. */
export function ProfilePage() {
  const { user } = useAuth();
  const [canChange, setCanChange] = useState<boolean | null>(null);

  useEffect(() => {
    getMyApplication()
      .then((a) => setCanChange(a.canChangeContactDetails))
      .catch(() => setCanChange(false));
  }, []);

  if (!user || canChange === null) return <Loading />;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="My Profile" description="You are the applicant / authorised signatory and the owner of this login." />

      <section className="card">
        <dl className="grid gap-4 sm:grid-cols-3">
          <Detail label="Name">{user.name}</Detail>
          <Detail label="Email ID">{user.email}</Detail>
          <Detail label="Mobile Number">{user.mobile ? `+91 ${user.mobile}` : '—'}</Detail>
        </dl>
      </section>

      <ChangePasswordCard />

      <section className="card">
        <h2 className="font-semibold text-slate-900">Change email or mobile</h2>
        {canChange ? (
          <>
            <p className="mb-4 mt-1 text-sm text-slate-600">We will send a code to the new email or mobile to confirm it belongs to you.</p>
            <div className="space-y-6">
              <ContactChange kind="email" />
              <ContactChange kind="mobile" />
            </div>
          </>
        ) : (
          <p className="mt-1 text-sm text-slate-600">
            Your application is currently under review, so your login email and mobile cannot be changed right now. You can change them once the review is
            complete or if changes are requested.
          </p>
        )}
      </section>

      <DeleteAccountCard />
    </div>
  );
}

function ChangePasswordCard() {
  const [form, setForm] = useState({ currentPassword: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    const parsed = changePasswordSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(toFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await changePassword(parsed.data);
      setForm({ currentPassword: '', password: '', confirmPassword: '' });
      setNotice({ tone: 'success', text: 'Your password has been changed. Any other devices have been logged out.' });
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, v[0]])));
      setNotice({ tone: 'error', text: err instanceof ApiError ? err.message : 'Something went wrong. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof typeof form, label: string, autoComplete: string) => (
    <Field label={label} required error={errors[key]}>
      {(a) => <input {...a} type="password" className="input" autoComplete={autoComplete} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />}
    </Field>
  );

  return (
    <form onSubmit={submit} className="card space-y-4" noValidate>
      <h2 className="font-semibold text-slate-900">Change Password</h2>
      {field('currentPassword', 'Current Password', 'current-password')}
      <div className="grid gap-4 sm:grid-cols-2">
        {field('password', 'New Password', 'new-password')}
        {field('confirmPassword', 'Confirm New Password', 'new-password')}
      </div>
      <PasswordRules password={form.password} />
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? 'Saving…' : 'Change Password'}
      </button>
    </form>
  );
}

function ContactChange({ kind }: { kind: ContactKind }) {
  const { setCurrentUser } = useAuth();
  const label = kind === 'email' ? 'email' : 'mobile number';
  const [value, setValue] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ sentTo: string; active: boolean; expiresAt: string | null; resendAvailableAt: string | null } | null>(null);

  const start = async () => {
    const parsed = contactChangeStartSchema.safeParse({ kind, value, currentPassword });
    if (!parsed.success) {
      setErrors(toFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setSent(await startContactChange(parsed.data));
  };

  const handleStart = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      await start();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, v[0]])));
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setSent(null);
    setValue('');
    setCurrentPassword('');
    setErrors({});
    setError(null);
  };

  if (sent) {
    return (
      <div className="space-y-2">
        <OtpBox
          title={`Confirm your new ${label}`}
          target={kind === 'mobile' ? `+91 ${sent.sentTo}` : sent.sentTo}
          verified={false}
          active={sent.active}
          expiresAt={sent.expiresAt}
          resendAvailableAt={sent.resendAvailableAt}
          onSend={start}
          onVerify={async (code) => {
            const user = await confirmContactChange(kind, code);
            setCurrentUser(user);
            reset();
            setDone(`Your ${label} has been changed. Use it the next time you log in.`);
          }}
        />
        <SecondaryButton type="button" onClick={reset}>
          Cancel
        </SecondaryButton>
      </div>
    );
  }

  return (
    <form onSubmit={handleStart} className="space-y-3 rounded-md border border-slate-200 p-4" noValidate>
      <h3 className="text-sm font-semibold text-slate-800">New {label}</h3>
      {done && <Alert tone="success">{done}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={kind === 'email' ? 'New Email ID' : 'New Mobile Number'} required error={errors.value}>
          {(a) =>
            kind === 'email' ? (
              <input {...a} type="email" inputMode="email" className="input" value={value} onChange={(e) => setValue(e.target.value.trim())} />
            ) : (
              <div className="flex">
                <span className="inline-flex items-center rounded-l-md border border-r-0 border-slate-300 bg-slate-100 px-3 text-sm text-slate-600">+91</span>
                <input {...a} inputMode="numeric" maxLength={10} className="input rounded-l-none" value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, '').slice(0, 10))} />
              </div>
            )
          }
        </Field>
        <Field label="Current Password" required error={errors.currentPassword}>
          {(a) => <input {...a} type="password" className="input" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />}
        </Field>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? 'Sending code…' : 'Send code'}
      </button>
    </form>
  );
}

/** "Delete my account": the applicant's right to erasure and to withdraw consent (DPDP Act s.12, s.6(4)). */
function DeleteAccountCard() {
  const [state, setState] = useState<{ request: MyDataRequestView | null; eraseBlockedReason: string | null } | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ reason: '', currentPassword: '', confirm: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getMyDeletionRequest()
      .then(setState)
      .catch(() => setError('Could not load your deletion request status. Please refresh the page.'));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = dataDeletionRequestSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(toFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const request = await requestAccountDeletion(form as DataDeletionRequestInput);
      setState((s) => ({ eraseBlockedReason: s?.eraseBlockedReason ?? null, request }));
      setOpen(false);
      setForm({ reason: '', currentPassword: '', confirm: false });
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, v[0]])));
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setError(null);
    setBusy(true);
    try {
      const request = await cancelAccountDeletion();
      setState((s) => ({ eraseBlockedReason: s?.eraseBlockedReason ?? null, request }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const request = state?.request ?? null;
  const pending = request?.status === 'pending';

  return (
    <section className="card space-y-3 border-red-200" aria-labelledby="delete-account-heading">
      <h2 id="delete-account-heading" className="font-semibold text-slate-900">
        Delete my account and personal data
      </h2>
      <p className="text-sm text-slate-600">
        You can ask us to close your account and erase your personal data at any time. This also withdraws your consent. See{' '}
        <Link to={`${LEGAL_DOCUMENTS.privacy.path}#your-rights`} className="font-medium text-brand underline">
          your rights in our Privacy Policy
        </Link>
        .
      </p>

      {error && <Alert tone="error">{error}</Alert>}
      {!state && !error && <Loading />}

      {state && pending && request && (
        <>
          <Alert tone="info">
            We received your request on {formatDateTimeIST(request.requestedAt)}. Our team will review it and reply by email, normally within 30 days. You
            can cancel it until it is processed.
          </Alert>
          <SecondaryButton type="button" onClick={() => void cancel()} disabled={busy}>
            {busy ? 'Cancelling…' : 'Cancel my request'}
          </SecondaryButton>
        </>
      )}

      {state && !pending && (
        <>
          {request?.status === 'declined' && (
            <Alert tone="warning">
              Your request of {formatDateIST(request.requestedAt)} was declined: {request.decisionNote}
            </Alert>
          )}
          {state.eraseBlockedReason && (
            <Alert tone="warning">
              Your franchise agreement has been approved. The law requires us to keep the signed agreement and the details in it for as long as the
              franchise relationship lasts and {AGREEMENT_RETENTION_YEARS} years after it ends. You can still send a request and we will reply explaining
              what we can erase.
            </Alert>
          )}

          {!open ? (
            <button type="button" className="btn-danger" onClick={() => setOpen(true)}>
              Delete my account…
            </button>
          ) : (
            <form onSubmit={submit} className="space-y-4 rounded-md border border-red-200 bg-red-50/40 p-4" noValidate>
              <div className="text-sm text-slate-700">
                <p className="font-medium text-slate-900">If we approve your request:</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  <li>your login is closed and you are logged out everywhere;</li>
                  <li>your application is withdrawn and can no longer be reviewed or approved;</li>
                  <li>your details, your contact persons’ details and all uploaded documents are erased;</li>
                  <li>we keep only what the law requires (a record of your consent, security logs, and any approved agreement).</li>
                </ul>
                <p className="mt-2">This cannot be undone. To apply again later, you would need to register afresh.</p>
              </div>
              <Field label="Reason (optional)" error={errors.reason}>
                {(a) => <textarea {...a} rows={3} maxLength={1000} className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />}
              </Field>
              <Field label="Current Password" required error={errors.currentPassword}>
                {(a) => (
                  <input
                    {...a}
                    type="password"
                    className="input"
                    autoComplete="current-password"
                    value={form.currentPassword}
                    onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
                  />
                )}
              </Field>
              <label className="flex items-start gap-3 text-sm text-slate-800">
                <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.checked })} />
                <span>I understand that my account will be closed and my personal data erased, and that this cannot be undone.</span>
              </label>
              {errors.confirm && <p className="text-sm text-red-700">{errors.confirm}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="submit" className="btn-danger" disabled={busy}>
                  {busy ? 'Sending…' : 'Request deletion'}
                </button>
                <SecondaryButton type="button" onClick={() => setOpen(false)}>
                  Keep my account
                </SecondaryButton>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
