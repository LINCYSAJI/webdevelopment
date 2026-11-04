import { useId, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { useNow } from '../lib/useNow';

const secondsUntil = (iso: string | null, now: number) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000)) : 0);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

interface OtpBoxProps {
  title: string;
  /** Masked destination, e.g. "li***@gmail.com". */
  target: string;
  verified: boolean;
  /** A code has been sent and is still valid. */
  active: boolean;
  expiresAt: string | null;
  resendAvailableAt: string | null;
  onSend(): Promise<void>;
  onVerify(code: string): Promise<void>;
}

/** One verification code: enter it, Verify, or Resend after the cooldown (PRD P3). */
export function OtpBox({ title, target, verified, active, expiresAt, resendAvailableAt, onSend, onVerify }: OtpBoxProps) {
  const id = useId();
  const now = useNow();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const expiresIn = secondsUntil(expiresAt, now);
  const resendIn = secondsUntil(resendAvailableAt, now);

  const run = async (kind: 'send' | 'verify', action: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    setInfo(null);
    try {
      await action();
      if (kind === 'send') {
        setCode('');
        setInfo('A new code has been sent.');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const handleVerify = (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code.');
      return;
    }
    void run('verify', () => onVerify(code));
  };

  if (verified) {
    return (
      <div className="flex items-center justify-between rounded-md border border-green-200 bg-green-50 p-4">
        <div>
          <p className="font-medium text-slate-900">{title}</p>
          <p className="text-sm text-slate-600">{target}</p>
        </div>
        <span className="text-sm font-semibold text-green-700">✅ Verified</span>
      </div>
    );
  }

  return (
    <form onSubmit={handleVerify} className="rounded-md border border-slate-200 p-4" noValidate>
      <label htmlFor={id} className="block font-medium text-slate-900">
        {title}
      </label>
      <p className="mb-3 text-sm text-slate-600">
        {active ? (
          <>
            Enter the 6-digit code sent to <strong>{target}</strong>.
            {expiresIn > 0 && <span className="block text-xs text-slate-500">Code expires in {mmss(expiresIn)}</span>}
          </>
        ) : (
          <>
            We'll send a code to <strong>{target}</strong>.
          </>
        )}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={id}
          className="input text-center text-lg tracking-[0.4em] sm:max-w-[12rem]"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="••••••"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          disabled={!active || busy !== null}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <button type="submit" className="btn-primary" disabled={!active || busy !== null || code.length !== 6}>
          {busy === 'verify' ? 'Checking…' : 'Verify'}
        </button>
        <button
          type="button"
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          disabled={busy !== null || resendIn > 0}
          onClick={() => void run('send', onSend)}
        >
          {busy === 'send' ? 'Sending…' : resendIn > 0 ? `Resend in ${resendIn}s` : active ? 'Resend code' : 'Send code'}
        </button>
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      {info && !error && <p className="mt-2 text-sm text-green-700">{info}</p>}
    </form>
  );
}
