import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDateTimeIST } from '@fap/shared';
import { listDevOutbox, type DevEmail } from '../api/auth';
import { Alert, Loading, SecondaryButton } from '../components/ui';

/**
 * Development only. Shows emails the portal "sent" while no real email service is connected,
 * so links such as "Set my password" can be tested. Not available in production.
 */
export function DevMailboxPage() {
  const [emails, setEmails] = useState<DevEmail[] | null>(null);
  const [selected, setSelected] = useState<DevEmail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listDevOutbox()
      .then((list) => {
        setEmails(list);
        setSelected((cur) => cur ?? list[0] ?? null);
      })
      .catch(() => setError('The test mailbox is not available.'));
  }, []);

  useEffect(load, [load]);

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Test mailbox</h1>
          <p className="text-sm text-slate-600">
            Development only: emails and SMS appear here until real email and SMS services are connected (build step 9).
          </p>
        </div>
        <div className="flex gap-2">
          <SecondaryButton onClick={load}>Refresh</SecondaryButton>
          <Link to="/login" className="btn-primary">
            Back to portal
          </Link>
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {!emails && !error && <Loading />}
      {emails && emails.length === 0 && <Alert>No emails yet.</Alert>}

      {emails && emails.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <ul className="card divide-y divide-slate-100 p-0">
            {emails.map((e) => (
              <li key={e.id}>
                <button
                  onClick={() => setSelected(e)}
                  className={`w-full px-4 py-3 text-left hover:bg-slate-50 ${selected?.id === e.id ? 'bg-slate-100' : ''}`}
                >
                  <div className="truncate text-sm font-medium text-slate-900">
                    {e.channel === 'sms' && <span className="mr-1 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-800">SMS</span>}
                    {e.subject}
                  </div>
                  <div className="truncate text-xs text-slate-500">To: {e.to}</div>
                  <div className="text-xs text-slate-400">{formatDateTimeIST(e.at)}</div>
                </button>
              </li>
            ))}
          </ul>
          {selected && (
            <div className="card p-0">
              <div className="border-b border-slate-200 px-4 py-3 text-sm">
                <div className="font-semibold text-slate-900">{selected.subject}</div>
                <div className="text-slate-600">To: {selected.to}</div>
              </div>
              {/* Sandboxed so email content cannot run scripts; links open in the main window. */}
              <iframe
                title="Email preview"
                srcDoc={`<base target="_top">${selected.html}`}
                sandbox="allow-top-navigation-by-user-activation allow-popups"
                className="h-[560px] w-full rounded-b-lg"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
