import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '../api/auth';
import { ApiError } from '../api/client';
import { AuthShell } from '../components/AuthShell';
import { Alert, Field } from '../components/ui';

export function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await forgotPassword(identifier);
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reach the server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title="Forgot your password?">
      {sent ? (
        <>
          <Alert tone="success">
            If an account exists for these details, we've sent password reset instructions to its registered email
            address. The link is valid for 60 minutes.
          </Alert>
          <Link to="/login" className="btn-primary w-full">
            Back to login
          </Link>
        </>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <p className="text-sm text-slate-600">
            Enter the email, mobile number or username you log in with. We'll email you a link to set a new password.
          </p>
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Email, mobile number or username" required>
            {(p) => (
              <input {...p} className="input" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
            )}
          </Field>
          <button type="submit" className="btn-primary w-full" disabled={submitting || !identifier.trim()}>
            {submitting ? 'Sending…' : 'Send reset link'}
          </button>
          <p className="text-center text-sm">
            <Link to="/login" className="font-medium text-brand hover:underline">
              Back to login
            </Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
