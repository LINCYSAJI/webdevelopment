import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDateTimeIST, type EmailPreview, type EmailTemplateView } from '@fap/shared';
import { listEmailTemplates, previewEmailTemplate, resetEmailTemplate, saveEmailTemplate } from '../../api/admin';
import { ApiError } from '../../api/client';
import { Alert, Badge, Loading, Modal, PageHeader, SecondaryButton } from '../../components/ui';

type Errors = { subject?: string; body?: string };

const fieldError = (err: ApiError, key: string): string | undefined => {
  const v = (err.fields as Record<string, string | string[]> | undefined)?.[key];
  return Array.isArray(v) ? v[0] : v;
};

/** Edit form for one template, with merge-field chips, preview and reset. */
function TemplateEditor({ template, onSaved }: { template: EmailTemplateView; onSaved: (t: EmailTemplateView) => void }) {
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const changed = subject !== template.subject || body !== template.body;

  useEffect(() => {
    setSubject(template.subject);
    setBody(template.body);
    setErrors({});
    setMessage(null);
  }, [template]);

  function insertField(key: string) {
    const el = bodyRef.current;
    const token = `{{${key}}}`;
    if (!el) return setBody((b) => b + token);
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    setErrors({});
    try {
      await action();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors({ subject: fieldError(err, 'subject'), body: fieldError(err, 'body') });
        setMessage({ tone: 'error', text: err.message });
      } else setMessage({ tone: 'error', text: 'Something went wrong. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      onSaved(await saveEmailTemplate(template.key, { subject, body }));
      setMessage({ tone: 'success', text: 'Saved. The next email of this kind uses the new wording.' });
    });
  const reset = () =>
    run(async () => {
      onSaved(await resetEmailTemplate(template.key));
      setMessage({ tone: 'success', text: 'Back to the default wording.' });
    });
  const showPreview = () => run(async () => setPreview(await previewEmailTemplate(template.key, { subject, body })));

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="tpl-subject" className="label">
          Subject
        </label>
        <input id="tpl-subject" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} aria-invalid={!!errors.subject} maxLength={200} />
        {errors.subject && <p className="mt-1 text-xs text-red-700">{errors.subject}</p>}
      </div>
      <div>
        <label htmlFor="tpl-body" className="label">
          Email text
        </label>
        <textarea id="tpl-body" ref={bodyRef} rows={12} className="input text-sm" value={body} onChange={(e) => setBody(e.target.value)} aria-invalid={!!errors.body} maxLength={5000} />
        <p className="mt-1 text-xs text-slate-500">Leave a blank line between paragraphs. A paragraph whose fields are all empty (for example an optional note) is left out.</p>
        {errors.body && <p className="mt-1 text-xs text-red-700">{errors.body}</p>}
      </div>
      <div>
        <div className="label">Merge fields (click to insert)</div>
        <div className="flex flex-wrap gap-2">
          {template.fields.map((f) => (
            <button key={f.key} type="button" onClick={() => insertField(f.key)} className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50" title={`Example: ${f.sample}`}>
              {f.label} <span className="font-mono text-slate-500">{`{{${f.key}}}`}</span>
              {template.required.includes(f.key) && <span className="text-red-600"> *</span>}
            </button>
          ))}
        </div>
        {template.required.length > 0 && <p className="mt-1 text-xs text-slate-500">* must stay in this email.</p>}
      </div>
      <p className="text-xs text-slate-500">The organisation header, the button and its link are added automatically and cannot be changed here.</p>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={save} disabled={busy || !changed}>
          Save
        </button>
        <SecondaryButton onClick={showPreview} disabled={busy}>
          Preview
        </SecondaryButton>
        {template.customised && (
          <SecondaryButton onClick={reset} disabled={busy}>
            Reset to default
          </SecondaryButton>
        )}
      </div>
      {preview && (
        <Modal title="Preview with example values" onClose={() => setPreview(null)} wide>
          <p className="mb-2 text-sm">
            <span className="text-slate-500">Subject: </span>
            <span className="font-medium text-slate-900">{preview.subject}</span>
          </p>
          <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-[60vh] w-full rounded border border-slate-200 bg-white" />
        </Modal>
      )}
    </div>
  );
}

/** Admin › Email Templates: the wording of every email the portal sends (PRD §11, §14). */
export function EmailTemplatesPage() {
  const [templates, setTemplates] = useState<EmailTemplateView[] | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string>('');

  useEffect(() => {
    listEmailTemplates()
      .then((t) => {
        setTemplates(t);
        setSelected((s) => s || t[0]?.key || '');
      })
      .catch(() => setError(true));
  }, []);

  const current = useMemo(() => templates?.find((t) => t.key === selected) ?? null, [templates, selected]);

  if (error) return <Alert tone="error">Email templates could not be loaded. Please refresh the page.</Alert>;
  if (!templates || !current) return <Loading />;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Email Templates" description="The wording of every email the portal sends. Changes apply to the next email; emails already sent are not affected." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div>
          <label htmlFor="tpl-select" className="label lg:sr-only">
            Email
          </label>
          <select id="tpl-select" className="input lg:hidden" value={selected} onChange={(e) => setSelected(e.target.value)}>
            {templates.map((t) => (
              <option key={t.key} value={t.key}>
                {t.code} · {t.label}
                {t.customised ? ' (edited)' : ''}
              </option>
            ))}
          </select>
          <ul className="hidden max-h-[75vh] space-y-1 overflow-y-auto lg:block">
            {templates.map((t) => (
              <li key={t.key}>
                <button
                  type="button"
                  onClick={() => setSelected(t.key)}
                  aria-current={t.key === selected ? 'true' : undefined}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm ${t.key === selected ? 'bg-brand text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                >
                  <span className="font-mono text-xs opacity-80">{t.code}</span> {t.label}
                  {t.customised && <span className="ml-1 text-xs opacity-80">(edited)</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <section className="card min-w-0 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="font-semibold text-slate-900">
                {current.code} · {current.label}
              </h2>
              <p className="text-sm text-slate-600">Sent to: {current.recipients}</p>
            </div>
            {current.customised ? <Badge color="blue">Edited</Badge> : <Badge>Default wording</Badge>}
          </div>
          {current.customised && current.updatedAt && (
            <p className="text-xs text-slate-500">
              Last changed {formatDateTimeIST(current.updatedAt)}
              {current.updatedBy ? ` by ${current.updatedBy}` : ''}
            </p>
          )}
          <TemplateEditor template={current} onSaved={(t) => setTemplates((all) => all!.map((x) => (x.key === t.key ? t : x)))} />
        </section>
      </div>
    </div>
  );
}
