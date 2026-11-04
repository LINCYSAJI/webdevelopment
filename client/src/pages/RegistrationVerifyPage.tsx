import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { completeRegistrationSchema, toFieldErrors, type OtpChannel, type RegistrationSubmitted, type VerificationStatus } from '@fap/shared';
import { ApiError } from '../api/client';
import { completeRegistration, getVerificationStatus, sendVerificationCode, verifyCode } from '../api/verification';
import { useAuth } from '../auth/AuthContext';
import { AuthShell } from '../components/AuthShell';
import { OtpBox } from '../components/OtpBox';
import { PasswordRules } from '../components/PasswordRules';
import { Alert, Field, Loading } from '../components/ui';
import { PENDING_VERIFICATION_KEY } from '../lib/registrationSession';

function readPending(state: unknown): RegistrationSubmitted | null {
  if (state && typeof state === 'object' && 'verificationToken' in state) return state as RegistrationSubmitted;
  try {
    const raw = sessionStorage.getItem(PENDING_VERIFICATION_KEY);
    return raw ? (JSON.parse(raw) as RegistrationSubmitted) : null;
  } catch {
    return null;
  }
}

function forgetPending() {
  try {
    sessionStorage.removeItem(PENDING_VERIFICATION_KEY);
  } catch {
    /* ignore */
  }
}

/** P3 (verify email and mobile) followed by P4 (set password), then account creation. */
export function RegistrationVerifyPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { setCurrentUser } = useAuth();
  const [pending] = useState(() => readPending(location.state));
  const token = pending?.verificationToken ?? '';

  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [fatal, setFatal] = useState<{ message: string; code: string } | null>(null);
  const autoSent = useRef(false);
  const [sendProblem, setSendProblem] = useState<string | null>(null);

  const handleFatal = (err: unknown) => {
    if (err instanceof ApiError && ['verification_not_found', 'already_verified', 'verification_expired'].includes(err.code)) {
      forgetPending();
      setFatal({ message: err.message, code: err.code });
      return true;
    }
    return false;
  };

  const load = useCallback(async () => {
    try {
      let current = await getVerificationStatus(token);
      setStatus(current);
      // Send both codes automatically the first time the page opens.
      if (!autoSent.current) {
        autoSent.current = true;
        const problems: string[] = [];
        for (const channel of ['email', 'sms'] as const) {
          const st = channel === 'email' ? current.email : current.sms;
          if (st.verified || st.active || st.resendAvailableAt) continue;
          try {
            // Keep the newest status, so a later failure never hides a code that was sent.
            current = await sendVerificationCode(token, channel);
            setStatus(current);
          } catch (err) {
            if (handleFatal(err)) return;
            const what = channel === 'email' ? 'email' : 'SMS';
            problems.push(`We couldn't send the ${what} code: ${err instanceof ApiError ? err.message : 'please check your connection.'}`);
          }
        }
        if (problems.length) setSendProblem(`${problems.join(' ')} Use "Send code" below to try again.`);
      }
    } catch (err) {
      if (!handleFatal(err)) setFatal({ message: 'The verification page could not be loaded. Please refresh.', code: 'error' });
    }
  }, [token]);

  useEffect(() => {
    if (token) void load();
  }, [token, load]);

  const send = (channel: OtpChannel) => async () => {
    setSendProblem(null);
    try {
      setStatus(await sendVerificationCode(token, channel));
    } catch (err) {
      if (!handleFatal(err)) throw err;
    }
  };
  const verify = (channel: OtpChannel) => async (code: string) => {
    try {
      setStatus(await verifyCode(token, channel, code));
    } catch (err) {
      if (err instanceof ApiError && err.code !== 'otp_incorrect') {
        // The code may now be unusable; refresh the timers and buttons.
        await getVerificationStatus(token).then(setStatus).catch(() => undefined);
      }
      if (!handleFatal(err)) throw err;
    }
  };

  if (!pending) {
    return (
      <AuthShell title="Verify your details">
        <p className="text-sm text-slate-600">There is no registration waiting for verification in this browser.</p>
        <Link to="/register" className="btn-primary w-full">
          Go to registration
        </Link>
        <Link to="/login" className="block text-center text-sm font-medium text-brand hover:underline">
          Already verified? Log in
        </Link>
      </AuthShell>
    );
  }

  if (fatal) {
    return (
      <AuthShell title="Verify your details">
        <Alert tone={fatal.code === 'already_verified' ? 'info' : 'error'}>{fatal.message}</Alert>
        <div className="flex flex-col gap-2">
          <Link to="/login" className="btn-primary w-full">
            Log in
          </Link>
          <Link to="/register" className="text-center text-sm font-medium text-brand hover:underline">
            Register again
          </Link>
        </div>
      </AuthShell>
    );
  }

  if (!status) {
    return (
      <AuthShell title="Verify your email and mobile">
        <Loading />
      </AuthShell>
    );
  }

  const bothVerified = status.email.verified && status.sms.verified;

  return (
    <AuthShell title={bothVerified ? 'Set your password' : 'Verify your email and mobile'}>
      {bothVerified ? (
        <SetPasswordForm
          token={token}
          onDone={(result) => {
            forgetPending();
            setCurrentUser(result.user);
            navigate('/register/success', { replace: true, state: { applicationId: result.applicationId } });
          }}
          onFatal={handleFatal}
        />
      ) : (
        <>
          <p className="text-sm text-slate-600">
            Your registration has been received. To submit it, enter the codes we sent to your email and mobile. Each code is valid for{' '}
            {status.otpExpiryMinutes} minutes.
          </p>
          {sendProblem && <Alert tone="warning">{sendProblem}</Alert>}
          <OtpBox title="Email verification" target={status.maskedEmail} {...status.email} onSend={send('email')} onVerify={verify('email')} />
          <OtpBox title="Mobile verification (SMS)" target={`+91 ${status.maskedMobile}`} {...status.sms} onSend={send('sms')} onVerify={verify('sms')} />
          {import.meta.env.DEV && (
            <p className="text-center text-xs text-slate-500">
              Development: codes appear in the{' '}
              <a href="/dev/mailbox" target="_blank" rel="noreferrer" className="underline">
                test mailbox
              </a>
              .
            </p>
          )}
        </>
      )}
    </AuthShell>
  );
}

function SetPasswordForm({
  token,
  onDone,
  onFatal,
}: {
  token: string;
  onDone(result: Awaited<ReturnType<typeof completeRegistration>>): void;
  onFatal(err: unknown): boolean;
}) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = completeRegistrationSchema.safeParse({ token, password, confirmPassword });
    if (!parsed.success) {
      setErrors(toFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      onDone(await completeRegistration(token, password, confirmPassword));
    } catch (err) {
      if (onFatal(err)) return;
      setError(err instanceof ApiError ? err.message : 'Unable to reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <Alert tone="success">✅ Email and mobile verified. Choose a password to create your account and submit your application.</Alert>
      <Field label="Password" required error={errors.password}>
        {(a) => <input {...a} type="password" className="input" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
      </Field>
      <PasswordRules password={password} />
      <Field label="Confirm Password" required error={errors.confirmPassword}>
        {(a) => <input {...a} type="password" className="input" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />}
      </Field>
      {error && <Alert tone="error">{error}</Alert>}
      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? 'Creating your account…' : 'Create Account'}
      </button>
    </form>
  );
}
