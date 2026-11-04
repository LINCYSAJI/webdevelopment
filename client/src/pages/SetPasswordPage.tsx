import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { isStrongPassword } from '@fap/shared';
import { describePasswordToken, setPassword } from '../api/auth';
import { ApiError } from '../api/client';
import { AuthShell } from '../components/AuthShell';
import { PasswordRules } from '../components/PasswordRules';
import { Alert, Field, Loading } from '../components/ui';

type TokenInfo = Awaited<ReturnType<typeof describePasswordToken>>;

/** Used by both the new-user invitation link and the password reset link. */
export function SetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setLinkError('This link is incomplete. Please use the full link from your email.');
      return;
    }
    describePasswordToken(token)
      .then(setInfo)
      .catch((err) => setLinkError(err instanceof ApiError ? err.message : 'Unable to check this link.'));
  }, [token]);

  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit = isStrongPassword(password) && password === confirm && !submitting;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await setPassword({ token, password, confirmPassword: confirm });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reach the server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const title = info?.purpose === 'reset_password' ? 'Reset your password' : 'Set your password';

  return (
    <AuthShell title={title}>
      {linkError ? (
        <>
          <Alert tone="error">{linkError}</Alert>
          <Link to="/forgot-password" className="btn-primary w-full">
            Request a new link
          </Link>
        </>
      ) : !info ? (
        <Loading />
      ) : done ? (
        <>
          <Alert tone="success">Your password has been saved. You can now log in.</Alert>
          <Link to="/login" className="btn-primary w-full">
            Go to login
          </Link>
        </>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <p className="text-sm text-slate-600">
            Hello {info.name}. Choose a password for <strong>{info.email}</strong>.
          </p>
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="New password" required>
            {(p) => <input {...p} type="password" className="input" autoComplete="new-password" value={password} onChange={(e) => setPw(e.target.value)} />}
          </Field>
          <PasswordRules password={password} />
          <Field label="Confirm password" required error={mismatch ? 'Passwords do not match' : undefined}>
            {(p) => <input {...p} type="password" className="input" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
          </Field>
          <button type="submit" className="btn-primary w-full" disabled={!canSubmit}>
            {submitting ? 'Saving…' : 'Save password'}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
