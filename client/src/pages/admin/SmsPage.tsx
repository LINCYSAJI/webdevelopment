import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  DLT_VARIABLE,
  SMS_EVENTS,
  SMS_EVENT_INFO,
  SMS_VARIABLE_LABELS,
  checkSmsFormat,
  formatDateTimeIST,
  renderSms,
  smsSettingsSchema,
  smsTestSchema,
  toFieldErrors,
  type Paginated,
  type SmsEvent,
  type SmsLogRow,
  type SmsSettingsView,
  type SmsStatusView,
} from '@fap/shared';
import { getSmsSettings, getSmsStatus, listSmsLogs, refreshSmsDelivery, saveSmsSettings, sendTestSms } from '../../api/admin';
import { ApiError } from '../../api/client';
import { useBranding } from '../../branding/BrandingContext';
import { Alert, Badge, Loading, PageHeader, Pagination, SecondaryButton } from '../../components/ui';
import { updateParams } from '../../lib/listParams';

const SAMPLE = (organisation: string) => ({ otp: '123456', minutes: '10', name: 'Priya Sharma', applicationId: 'APP-2026-0001', referenceNo: 'FRN/2026/0001', organisation });

/** Admin: SMS gateway status, on/off switch, DLT templates, test SMS, history and error log. */
export function SmsPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="SMS Notifications"
        description="Text messages to applicants' registered mobile numbers, sent through the Networkz Systems gateway with DLT-registered templates. Gateway credentials are kept on the server and never shown here."
      />
      <StatusCard />
      <SettingsForm />
      <TestCard />
      <History />
    </div>
  );
}

// ---------- Gateway status ----------

function StatusCard() {
  const [s, setS] = useState<SmsStatusView | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    getSmsStatus()
      .then(setS)
      .catch(() => setError(true));
  }, []);
  if (error) return <Alert tone="error">The gateway status could not be loaded.</Alert>;
  if (!s) return <Loading />;
  const ready = s.live && s.missing.length === 0;
  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-900">Gateway configuration</h2>
        {s.live ? (
          ready ? <Badge color="green">Networkz gateway configured</Badge> : <Badge color="red">Networkz gateway: settings missing</Badge>
        ) : (
          <Badge color="amber">Development test mailbox (no real SMS)</Badge>
        )}
      </div>
      {s.live && s.missing.length > 0 && (
        <Alert tone="error">
          Add these to the server's environment settings, then restart the server: <strong>{s.missing.join(', ')}</strong>
        </Alert>
      )}
      {!s.live && <Alert tone="info">Messages appear in the test mailbox. Set SMS_PROVIDER=networkz on the server to send real SMS.</Alert>}
      <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Item label="Sender ID">{s.senderId ?? '—'}</Item>
        <Item label="DLT entity ID">{s.entityId ?? '—'}</Item>
        <Item label="Route">{s.route ?? '—'}</Item>
        <Item label="Wallet balance">
          {!s.wallet ? '—' : s.wallet.ok ? `${s.wallet.balance} ${s.wallet.currency}` : <span className="text-red-700">Could not check: {s.wallet.error}</span>}
        </Item>
        <Item label="Delivery updates">{s.webhookEnabled ? 'Webhook connected' : s.live ? 'Checked on request' : '—'}</Item>
        <Item label="Sent (24 h)">{s.last24h.sent}</Item>
        <Item label="Failed (24 h)">
          <span className={s.last24h.failed ? 'font-semibold text-red-700' : ''}>{s.last24h.failed}</span>
        </Item>
        <Item label="Skipped (24 h)">{s.last24h.skipped}</Item>
      </dl>
    </section>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-slate-900">{children}</dd>
    </div>
  );
}

// ---------- On/off and templates ----------

function SettingsForm() {
  const { organisationName } = useBranding();
  const [form, setForm] = useState<SmsSettingsView | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<SmsEvent | null>(null);

  useEffect(() => {
    getSmsSettings()
      .then(setForm)
      .catch(() => setNotice({ tone: 'error', text: 'SMS settings could not be loaded.' }));
  }, []);
  if (!form) return notice ? <Alert tone="error">{notice.text}</Alert> : <Loading />;

  const setT = (e: SmsEvent, patch: Partial<SmsSettingsView['templates'][SmsEvent]>) =>
    setForm((f) => f && { ...f, templates: { ...f.templates, [e]: { ...f.templates[e], ...patch } } });

  const save = async () => {
    setNotice(null);
    const parsed = smsSettingsSchema.safeParse(form);
    if (!parsed.success) {
      const errs = toFieldErrors(parsed.error);
      setErrors(errs);
      const first = SMS_EVENTS.find((e) => Object.keys(errs).some((k) => k.startsWith(`templates.${e}.`)));
      if (first) setOpen(first);
      setNotice({ tone: 'error', text: 'Please correct the highlighted template.' });
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      setForm(await saveSmsSettings(parsed.data));
      setNotice({ tone: 'success', text: 'SMS settings saved.' });
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, v[0]])));
      setNotice({ tone: 'error', text: err instanceof ApiError ? err.message : 'Could not save.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Notifications</h2>
          <p className="mt-1 text-sm text-slate-600">
            The verification code (OTP) is always sent, because applicants need it to register. The switch controls all other messages.
          </p>
        </div>
        <label className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800">
          <input id="sms-enabled" type="checkbox" className="h-5 w-5" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          Send SMS notifications
        </label>
      </div>

      <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
        Each message must use a template approved on the DLT portal. Copy the approved wording exactly, with <code>{DLT_VARIABLE}</code> where values go. Then write the
        message format with the same wording, putting a value such as <code>{'{applicationId}'}</code> in place of each <code>{DLT_VARIABLE}</code>. Messages without a
        complete template are not sent.
      </div>

      <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
        {SMS_EVENTS.map((e) => {
          const t = form.templates[e];
          const info = SMS_EVENT_INFO[e];
          const complete = !!(t.templateId && t.dltText.trim() && t.format.trim());
          const problem = t.dltText.trim() && t.format.trim() ? checkSmsFormat(t.dltText, t.format, info.variables) : null;
          const hasError = Object.keys(errors).some((k) => k.startsWith(`templates.${e}.`));
          const expanded = open === e;
          return (
            <li key={e}>
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={info.required || t.enabled}
                    disabled={info.required}
                    onChange={(ev) => setT(e, { enabled: ev.target.checked })}
                    aria-label={`Send: ${info.label}`}
                  />
                </label>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900">{info.label}</div>
                  <div className="text-xs text-slate-500">{info.when}</div>
                </div>
                {info.required && <Badge color="blue">Always on</Badge>}
                {problem || hasError ? <Badge color="red">Check template</Badge> : complete ? <Badge color="green">Template ready</Badge> : <Badge color="amber">Template needed</Badge>}
                <SecondaryButton className="px-3 py-1.5 text-xs" onClick={() => setOpen(expanded ? null : e)} aria-expanded={expanded}>
                  {expanded ? 'Close' : 'Edit template'}
                </SecondaryButton>
              </div>
              {expanded && (
                <div className="grid gap-4 border-t border-slate-100 bg-slate-50 px-4 py-4 lg:grid-cols-2">
                  <div className="space-y-3">
                    <div>
                      <label htmlFor={`tid-${e}`} className="label">
                        DLT template ID
                      </label>
                      <input id={`tid-${e}`} className="input font-mono" inputMode="numeric" value={t.templateId} onChange={(ev) => setT(e, { templateId: ev.target.value.replace(/\D/g, '') })} />
                      {errors[`templates.${e}.templateId`] && <p className="mt-1 text-xs text-red-700">{errors[`templates.${e}.templateId`]}</p>}
                    </div>
                    <div>
                      <label htmlFor={`dlt-${e}`} className="label">
                        Approved DLT wording
                      </label>
                      <textarea id={`dlt-${e}`} rows={4} className="input font-mono text-sm" value={t.dltText} onChange={(ev) => setT(e, { dltText: ev.target.value })} placeholder={`Exactly as approved, e.g. … application ${DLT_VARIABLE} …`} />
                      {errors[`templates.${e}.dltText`] && <p className="mt-1 text-xs text-red-700">{errors[`templates.${e}.dltText`]}</p>}
                    </div>
                    <div>
                      <label htmlFor={`fmt-${e}`} className="label">
                        Message format
                      </label>
                      <textarea id={`fmt-${e}`} rows={4} className="input font-mono text-sm" value={t.format} onChange={(ev) => setT(e, { format: ev.target.value })} />
                      <p className="mt-1 text-xs text-slate-500">
                        Values for this message:{' '}
                        {info.variables.map((v) => (
                          <code key={v} className="mr-2" title={SMS_VARIABLE_LABELS[v]}>
                            {`{${v}}`}
                          </code>
                        ))}
                      </p>
                      {(errors[`templates.${e}.format`] || problem) && <p className="mt-1 text-xs text-red-700">{errors[`templates.${e}.format`] ?? problem}</p>}
                    </div>
                  </div>
                  <div>
                    <div className="label">Preview with sample values</div>
                    <div className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-800">
                      {t.format.trim() ? renderSms(t.format, SAMPLE(organisationName)) : <span className="text-slate-400">Enter a message format to see a preview.</span>}
                    </div>
                    {t.format.trim() && <p className="mt-1 text-xs text-slate-500">{renderSms(t.format, SAMPLE(organisationName)).length} characters</p>}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <button className="btn-primary" disabled={saving} onClick={() => void save()}>
        {saving ? 'Saving…' : 'Save SMS settings'}
      </button>
    </section>
  );
}

// ---------- Test SMS ----------

function TestCard() {
  const [mobile, setMobile] = useState('');
  const [event, setEvent] = useState<SmsEvent>('otp');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'error' | 'warning'; text: string } | null>(null);

  const send = async () => {
    setResult(null);
    const parsed = smsTestSchema.safeParse({ mobile, event });
    if (!parsed.success) {
      setResult({ tone: 'error', text: parsed.error.issues[0].message });
      return;
    }
    setBusy(true);
    try {
      const o = await sendTestSms(parsed.data.mobile, parsed.data.event);
      setResult(
        o.ok
          ? { tone: 'success', text: 'Test SMS accepted by the gateway. Check the phone, and the history below for delivery.' }
          : { tone: o.status === 'skipped' ? 'warning' : 'error', text: `Not sent: ${o.reason ?? 'unknown reason'}` },
      );
    } catch (err) {
      setResult({ tone: 'error', text: err instanceof ApiError ? err.message : 'Could not send the test.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card space-y-3">
      <h2 className="font-semibold text-slate-900">Send a test SMS</h2>
      <p className="text-sm text-slate-600">Uses the chosen message's DLT template with sample values. Each test is charged by the gateway like any SMS.</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <label htmlFor="test-mobile" className="label">
            Mobile number
          </label>
          <div className="flex">
            <span className="inline-flex items-center rounded-l-md border border-r-0 border-slate-300 bg-slate-100 px-3 text-sm text-slate-600">+91</span>
            <input id="test-mobile" className="input rounded-l-none" inputMode="numeric" maxLength={10} value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))} />
          </div>
        </div>
        <div>
          <label htmlFor="test-event" className="label">
            Message
          </label>
          <select id="test-event" className="input" value={event} onChange={(e) => setEvent(e.target.value as SmsEvent)}>
            {SMS_EVENTS.map((e) => (
              <option key={e} value={e}>
                {SMS_EVENT_INFO[e].label}
              </option>
            ))}
          </select>
        </div>
        <button className="btn-primary" disabled={busy} onClick={() => void send()}>
          {busy ? 'Sending…' : 'Send test'}
        </button>
      </div>
      {result && <Alert tone={result.tone}>{result.text}</Alert>}
    </section>
  );
}

// ---------- History and error log ----------

const STATUS_BADGE: Record<SmsLogRow['status'], { color: 'green' | 'red' | 'amber' | 'gray'; label: string }> = {
  sent: { color: 'green', label: 'Sent' },
  failed: { color: 'red', label: 'Failed' },
  skipped: { color: 'gray', label: 'Skipped' },
  sending: { color: 'amber', label: 'Sending' },
};
const DELIVERY_BADGE = { delivered: 'green', pending: 'amber', failed: 'red', rejected: 'red' } as const;

function History() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<Paginated<SmsLogRow> | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const status = params.get('status') ?? '';

  const query = params.toString();
  const load = useCallback(() => {
    setData(null);
    listSmsLogs(new URLSearchParams(query))
      .then(setData)
      .catch(() => setError(true));
  }, [query]);
  useEffect(load, [load]);
  const set = (changes: Record<string, string | null>) => setParams(updateParams(params, changes), { replace: true });

  const refresh = async () => {
    setRefreshing(true);
    setNotice(null);
    try {
      const r = await refreshSmsDelivery();
      setNotice(r.error ? `Delivery check: ${r.error}` : `Checked ${r.checked} message(s); ${r.updated} updated.`);
      load();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Could not check delivery.');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-900">History and error log</h2>
        <SecondaryButton onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? 'Checking…' : 'Refresh delivery status'}
        </SecondaryButton>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
        {[
          ['', 'All'],
          ['sent', 'Sent'],
          ['failed', 'Failed (error log)'],
          ['skipped', 'Skipped'],
        ].map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={status === k}
            onClick={() => set({ status: k || null })}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${status === k ? 'border-brand text-brand' : 'border-transparent text-slate-600'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="log-event" className="label">
            Message
          </label>
          <select id="log-event" className="input" value={params.get('event') ?? ''} onChange={(e) => set({ event: e.target.value || null })}>
            <option value="">All messages</option>
            {SMS_EVENTS.map((e) => (
              <option key={e} value={e}>
                {SMS_EVENT_INFO[e].label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="log-search" className="label">
            Application ID or mobile (last 4+ digits)
          </label>
          <input id="log-search" className="input" defaultValue={params.get('search') ?? ''} onBlur={(e) => set({ search: e.target.value.trim() || null })} />
        </div>
      </div>
      {notice && <Alert tone="info">{notice}</Alert>}
      {error && <Alert tone="error">The history could not be loaded.</Alert>}
      {!data ? (
        !error && <Loading />
      ) : data.items.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-600">No SMS records here yet.</p>
      ) : (
        <>
          <ul className="divide-y divide-slate-100">
            {data.items.map((r) => (
              <li key={r.id} className="space-y-1 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge color={STATUS_BADGE[r.status].color}>{STATUS_BADGE[r.status].label}</Badge>
                  {r.delivery && <Badge color={DELIVERY_BADGE[r.delivery.status]}>Delivery: {r.delivery.status}</Badge>}
                  {r.test && <Badge color="blue">Test</Badge>}
                  <span className="font-medium text-slate-900">{r.event === 'test' ? 'Test' : SMS_EVENT_INFO[r.event as SmsEvent]?.label ?? r.event}</span>
                  <span className="text-slate-500">· +91 {r.recipient}</span>
                  {r.applicationId && <span className="text-slate-500">· {r.applicationId}</span>}
                  <span className="ml-auto text-xs text-slate-500">{formatDateTimeIST(r.at)}</span>
                </div>
                {r.text && <p className="whitespace-pre-wrap break-words rounded bg-slate-50 p-2 text-slate-700">{r.text}</p>}
                <p className="text-xs text-slate-500">
                  {r.provider === 'networkz' ? 'Networkz' : 'Test mailbox'}
                  {r.templateId ? ` · template ${r.templateId}` : ''}
                  {r.attempts ? ` · ${r.attempts} attempt${r.attempts === 1 ? '' : 's'}` : ''}
                  {r.submissionId ? ` · submission ${r.submissionId}` : ''}
                  {r.delivery?.description ? ` · ${r.delivery.description}` : ''}
                </p>
                {r.error && (
                  <p className="text-xs text-red-700">
                    {r.status === 'skipped' ? 'Reason' : 'Error'}: {r.error}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => set({ page: String(p) })} />
        </>
      )}
    </section>
  );
}
