import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useBranding } from '../branding/BrandingContext';
import { ApiError } from '../api/client';
import { BrandMark } from '../components/BrandMark';

export function LoginPage() {
  const { user, login } = useAuth();
  const { portalName, organisationName } = useBranding();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/app';

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to={from} replace />;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login({ identifier, password });
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reach the server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandMark size={56} />
          <h1 className="mt-4 text-2xl font-bold text-slate-900">{portalName}</h1>
          <p className="mt-1 text-sm text-slate-600">
            Register as a franchise partner, accept your agreement online and track your approval with{' '}
            {organisationName}.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4" noValidate>
          <h2 className="text-lg font-semibold text-slate-900">Log in</h2>

          {error && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="identifier" className="label">
              Email, mobile number or username
            </label>
            <input
              id="identifier"
              className="input"
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="label">
              Password
            </label>
            <input
              id="password"
              type="password"
              className="input"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <div className="flex items-center justify-end">
            <Link to="/forgot-password" className="text-sm font-medium text-brand hover:underline">
              Forgot password?
            </Link>
          </div>

          <button type="submit" className="btn-primary w-full" disabled={submitting || !identifier || !password}>
            {submitting ? 'Logging in…' : 'Log in'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          New franchise partner?{' '}
          <Link to="/register" className="font-semibold text-brand hover:underline">
            Register as a Franchise Partner
          </Link>
        </p>
        {import.meta.env.DEV && (
          <p className="mt-3 text-center text-xs text-slate-500">
            Development:{' '}
            <Link to="/dev/mailbox" className="underline">
              open the test mailbox
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
