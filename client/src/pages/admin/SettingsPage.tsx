import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  LOGO_MAX_BYTES,
  formatDateIST,
  holidaySchema,
  settingsSchema,
  type HolidayView,
  type SettingsInput,
  type SettingsView,
} from '@fap/shared';
import * as adminApi from '../../api/admin';
import { ApiError } from '../../api/client';
import { useBranding } from '../../branding/BrandingContext';
import { Alert, Field, Loading, PageHeader, SecondaryButton } from '../../components/ui';

type FormState = Record<keyof SettingsView, string>;

const toForm = (s: SettingsView): FormState =>
  Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v === null ? '' : String(v)])) as FormState;

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="card">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function SettingsPage() {
  const branding = useBranding();
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    adminApi
      .getSettings()
      .then((s) => setForm(toForm(s)))
      .catch(() => setNotice({ tone: 'error', text: 'Could not load settings.' }));
  }, []);

  if (!form) return notice ? <Alert tone="error">{notice.text}</Alert> : <Loading />;

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => f && { ...f, [key]: e.target.value });

  const input = (key: keyof FormState, label: string, opts: { type?: string; hint?: string; suffix?: string } = {}) => (
    <Field label={label} required={!['supportEmail', 'supportPhone'].includes(key)} error={errors[key]} hint={opts.hint}>
      {(p) => (
        <div className="flex items-center gap-2">
          <input {...p} type={opts.type ?? 'text'} className="input" value={form[key]} onChange={set(key)} />
          {opts.suffix && <span className="shrink-0 text-sm text-slate-500">{opts.suffix}</span>}
        </div>
      )}
    </Field>
  );

  const onLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setErrors((x) => ({ ...x, logoUrl: 'Logo must be a PNG, JPG or WebP image' }));
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setErrors((x) => ({ ...x, logoUrl: 'Logo must be 300 KB or smaller' }));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setForm((f) => f && { ...f, logoUrl: String(reader.result) });
      setErrors(({ logoUrl: _removed, ...rest }) => rest);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    const payload: SettingsInput = { ...form, logoUrl: form.logoUrl || null } as unknown as SettingsInput;
    const parsed = settingsSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      setNotice({ tone: 'error', text: 'Please correct the highlighted fields.' });
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const saved = await adminApi.saveSettings(payload);
      setForm(toForm(saved));
      await branding.reload();
      setNotice({ tone: 'success', text: 'Settings saved.' });
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof ApiError ? err.message : 'Could not save settings.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Settings" description="Changes apply immediately and are recorded in the audit log." />

      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
        <Section title="Branding" description="Shown on every screen, in emails and on the agreement PDF.">
          {input('organisationName', 'Organisation name')}
          {input('portalName', 'Portal name')}
          <div className="sm:col-span-2">
            <span className="label">Logo</span>
            <div className="flex flex-wrap items-center gap-3">
              {form.logoUrl ? (
                <img src={form.logoUrl} alt="Current logo" className="h-12 w-auto rounded border border-slate-200 bg-white p-1" />
              ) : (
                <span className="text-sm text-slate-500">No logo yet (the organisation's initials are shown).</span>
              )}
              <label className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Upload logo
                <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={onLogo} />
              </label>
              {form.logoUrl && (
                <SecondaryButton className="px-3 py-2" onClick={() => setForm((f) => f && { ...f, logoUrl: '' })}>
                  Remove
                </SecondaryButton>
              )}
            </div>
            <p className={`mt-1 text-xs ${errors.logoUrl ? 'text-red-700' : 'text-slate-500'}`}>
              {errors.logoUrl ?? 'PNG, JPG or WebP, up to 300 KB. A wide logo about 60 px tall works best.'}
            </p>
          </div>
          {(['primaryColor', 'secondaryColor'] as const).map((key) => (
            <Field key={key} label={key === 'primaryColor' ? 'Primary colour' : 'Secondary colour'} required error={errors[key]}>
              {(p) => (
                <div className="flex items-center gap-2">
                  <input type="color" aria-label={`${key} picker`} className="h-10 w-12 cursor-pointer rounded border border-slate-300" value={/^#[0-9a-f]{6}$/i.test(form[key]) ? form[key] : '#000000'} onChange={set(key)} />
                  <input {...p} className="input" value={form[key]} onChange={set(key)} />
                </div>
              )}
            </Field>
          ))}
          {input('supportEmail', 'Support email', { type: 'email', hint: 'Shown in emails and error messages.' })}
          {input('supportPhone', 'Support phone')}
        </Section>

        <Section title="Agreement">
          {input('agreementRefPrefix', 'Agreement reference prefix', { hint: 'Reference numbers look like FRN/2026/0001.' })}
        </Section>

        <Section title="Email and mobile verification" description="One-time codes (OTPs) sent during registration.">
          {input('otpExpiryMinutes', 'Code expires after', { type: 'number', suffix: 'minutes' })}
          {input('otpResendCooldownSeconds', 'Wait before resending', { type: 'number', suffix: 'seconds' })}
          {input('otpMaxAttempts', 'Wrong attempts allowed', { type: 'number' })}
          {input('pendingVerificationRetentionDays', 'Delete unverified registrations after', { type: 'number', suffix: 'days' })}
        </Section>

        <Section title="Reminders" description="Counted in business days (Monday–Friday, excluding the holidays below). Reminders never approve or reject.">
          {input('reminderFirstAfterDays', 'First reminder after', { type: 'number', suffix: 'business days' })}
          {input('reminderRepeatEveryDays', 'Repeat reminder every', { type: 'number', suffix: 'business days' })}
          {input('escalationAfterDays', 'Alert Admin after', { type: 'number', suffix: 'business days' })}
          {input('reminderRunTime', 'Daily reminder time (IST)', { type: 'time' })}
        </Section>

        <Section title="File uploads" description="Maximum size of each uploaded file.">
          {input('maxDocumentSizeMB', 'Documents (PAN, GST, ID proof)', { type: 'number', suffix: 'MB' })}
          {input('maxPhotoSizeMB', 'Photographs', { type: 'number', suffix: 'MB' })}
          {input('maxRentalSizeMB', 'Rental agreement', { type: 'number', suffix: 'MB' })}
        </Section>

        <Section title="Security">
          {input('sessionTimeoutMinutes', 'Log out after inactivity of', { type: 'number', suffix: 'minutes' })}
        </Section>

        {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
        <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-slate-50/95 px-4 py-3 sm:mx-0 sm:rounded-lg sm:border">
          <button type="submit" className="btn-primary w-full sm:w-auto" disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>

      <div className="mt-6">
        <HolidaysCard />
      </div>
    </div>
  );
}

function HolidaysCard() {
  const [holidays, setHolidays] = useState<HolidayView[] | null>(null);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = () => adminApi.listHolidays().then(setHolidays).catch(() => setError('Could not load holidays.'));
  useEffect(() => {
    void load();
  }, []);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = holidaySchema.safeParse({ date, name });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    try {
      await adminApi.addHoliday(parsed.data);
      setDate('');
      setName('');
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add holiday.');
    }
  };

  const remove = async (h: HolidayView) => {
    if (!window.confirm(`Remove ${h.name} (${formatDateIST(h.date)}) from the holiday list?`)) return;
    try {
      await adminApi.removeHoliday(h.id);
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove holiday.');
    }
  };

  return (
    <section className="card">
      <h2 className="font-semibold text-slate-900">Public holidays</h2>
      <p className="mt-1 text-sm text-slate-600">These days are skipped when counting business days for reminders.</p>

      <form onSubmit={add} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div>
          <label className="label" htmlFor="holiday-date">Date</label>
          <input id="holiday-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="flex-1">
          <label className="label" htmlFor="holiday-name">Holiday name</label>
          <input id="holiday-name" className="input" placeholder="e.g. Diwali" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <button type="submit" className="btn-primary">Add holiday</button>
      </form>
      {error && <div className="mt-3"><Alert tone="error">{error}</Alert></div>}

      {!holidays ? (
        <Loading />
      ) : holidays.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No holidays added yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100 rounded-md border border-slate-200">
          {holidays.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>
                <span className="font-medium">{formatDateIST(h.date)}</span> · {h.name}
              </span>
              <button className="text-xs font-medium text-red-700 hover:underline" onClick={() => remove(h)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
