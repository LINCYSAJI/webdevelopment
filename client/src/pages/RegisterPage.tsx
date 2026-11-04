import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AGREEMENT_ACCEPTANCE_TEXT,
  FIRM_TYPES,
  SIGNATORY_CAPACITIES,
  registrationMergeValues,
  registrationSchema,
  renderAgreement,
  toFieldErrors,
  type DuplicateWarning,
  type FieldErrors,
  type PublicAgreementView,
  type RegistrationInput,
  type UploadLimits,
} from '@fap/shared';
import { ApiError } from '../api/client';
import { getRegistrationForm, submitRegistration } from '../api/public';
import { useBranding } from '../branding/BrandingContext';
import { BrandMark } from '../components/BrandMark';
import { FileUpload, type PickedFile } from '../components/FileUpload';
import { PdfViewer } from '../components/PdfViewer';
import { Alert, Field, Loading, Modal, SafeHtml, SecondaryButton } from '../components/ui';
import { PENDING_VERIFICATION_KEY } from '../lib/registrationSession';

// ---------- Form state ----------

interface ContactForm {
  key: string;
  name: string;
  email: string;
  mobile: string;
  idProof: PickedFile | null;
  photo: PickedFile | null;
}

interface FormState {
  franchiseModel: string;
  firmType: string;
  firmName: string;
  pan: string;
  gst: string;
  panFile: PickedFile | null;
  gstFile: PickedFile | null;
  rentalFile: PickedFile | null;
  signatory: { name: string; capacity: string; email: string; mobile: string; idProof: PickedFile | null; photo: PickedFile | null };
  contacts: ContactForm[];
  sameAsSignatory: boolean;
}

let keySeq = 0;
const newContact = (): ContactForm => ({ key: `c${++keySeq}`, name: '', email: '', mobile: '', idProof: null, photo: null });

const emptyForm = (): FormState => ({
  franchiseModel: '',
  firmType: '',
  firmName: '',
  pan: '',
  gst: '',
  panFile: null,
  gstFile: null,
  rentalFile: null,
  signatory: { name: '', capacity: '', email: '', mobile: '', idProof: null, photo: null },
  contacts: [newContact()],
  sameAsSignatory: false,
});

// Typed details are kept in this browser (not files) so a refresh doesn't lose them (PRD P2, Q3).
const DRAFT_KEY = 'fap.registration.draft.v1';

function saveDraft(form: FormState) {
  const { panFile: _p, gstFile: _g, rentalFile: _r, ...rest } = form;
  const draft = {
    ...rest,
    signatory: { ...form.signatory, idProof: null, photo: null },
    contacts: form.contacts.map((c) => ({ ...c, idProof: null, photo: null })),
  };
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* storage unavailable (private window): nothing to do */
  }
}

function loadDraft(): FormState | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<FormState>;
    const base = emptyForm();
    const contacts = Array.isArray(d.contacts) && d.contacts.length ? d.contacts.map((c) => ({ ...newContact(), name: c.name ?? '', email: c.email ?? '', mobile: c.mobile ?? '' })) : base.contacts;
    return {
      ...base,
      franchiseModel: d.franchiseModel ?? '',
      firmType: d.firmType ?? '',
      firmName: d.firmName ?? '',
      pan: d.pan ?? '',
      gst: d.gst ?? '',
      signatory: { ...base.signatory, ...(d.signatory ?? {}), idProof: null, photo: null },
      contacts,
      sameAsSignatory: !!d.sameAsSignatory,
    };
  } catch {
    return null;
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

/** Builds what is sent to the server. Contact 1 copies the signatory when "Same as" is ticked. */
function toPayload(form: FormState, agreementId: string, accepted: boolean, acknowledgeDuplicates: boolean): RegistrationInput {
  const s = form.signatory;
  return {
    franchiseModel: form.franchiseModel,
    firmType: form.firmType as RegistrationInput['firmType'],
    firmName: form.firmName,
    pan: form.pan,
    panFile: form.panFile?.token ?? '',
    gst: form.gst || null,
    gstFile: form.gst ? form.gstFile?.token ?? null : null,
    rentalFile: form.rentalFile?.token ?? null,
    signatory: {
      name: s.name,
      capacity: s.capacity as RegistrationInput['signatory']['capacity'],
      email: s.email,
      mobile: s.mobile,
      idProofFile: s.idProof?.token ?? '',
      photoFile: s.photo?.token ?? '',
    },
    contacts: form.contacts.map((c, i) =>
      i === 0 && form.sameAsSignatory
        ? { name: s.name, email: s.email, mobile: s.mobile, idProofFile: s.idProof?.token ?? '', photoFile: s.photo?.token ?? '' }
        : { name: c.name, email: c.email, mobile: c.mobile, idProofFile: c.idProof?.token ?? '', photoFile: c.photo?.token ?? '' },
    ),
    agreement: { agreementVersionId: agreementId, accepted: accepted as true },
    acknowledgeDuplicates,
  };
}

const SECTIONS = [
  { id: 'firm', title: 'Franchise Details', prefixes: ['franchiseModel', 'firmType', 'firmName'] },
  { id: 'documents', title: 'Official Documents', prefixes: ['pan', 'panFile', 'gst', 'gstFile', 'rentalFile'] },
  { id: 'signatory', title: 'Applicant / Signatory', prefixes: ['signatory'] },
  { id: 'contacts', title: 'Contact Persons', prefixes: ['contacts'] },
  { id: 'agreement', title: 'Agreement', prefixes: ['agreement'] },
] as const;

const sectionHasErrors = (errors: FieldErrors, prefixes: readonly string[]) =>
  Object.keys(errors).some((k) => prefixes.some((p) => k === p || k.startsWith(`${p}.`)));

/** "contacts.1.mobile" -> "Contact 2 mobile number" */
function fieldLabel(path: string) {
  const [first, second, third] = path.split('.');
  const what = (key: string) => (key === 'email' ? 'email' : 'mobile number');
  if (first === 'signatory') return `Applicant / Signatory ${what(second)}`;
  if (first === 'contacts') return `Contact ${Number(second) + 1} ${what(third)}`;
  return path;
}

const digitsOnly = (v: string) => v.replace(/\D/g, '').slice(0, 10);

// ---------- Page ----------

export function RegisterPage() {
  const { portalName, organisationName, supportEmail, supportPhone } = useBranding();
  const navigate = useNavigate();

  const [agreement, setAgreement] = useState<PublicAgreementView | null | undefined>(undefined);
  const [limits, setLimits] = useState<UploadLimits | null>(null);
  const [loadError, setLoadError] = useState(false);

  const [form, setForm] = useState<FormState>(() => loadDraft() ?? emptyForm());
  const [restored] = useState(() => loadDraft() !== null);
  const [accepted, setAccepted] = useState(false);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<DuplicateWarning[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadForm = useCallback(() => {
    getRegistrationForm()
      .then((r) => {
        setAgreement(r.agreement);
        setLimits(r.limits);
      })
      .catch(() => setLoadError(true));
  }, []);
  useEffect(loadForm, [loadForm]);

  // Autosave typed details (debounced).
  useEffect(() => {
    const t = window.setTimeout(() => saveDraft(form), 400);
    return () => window.clearTimeout(t);
  }, [form]);

  const payload = useMemo(() => toPayload(form, agreement?.id ?? '', accepted, false), [form, agreement, accepted]);
  const clientErrors = useMemo<FieldErrors>(() => {
    const r = registrationSchema.safeParse(payload);
    return r.success ? {} : toFieldErrors(r.error);
  }, [payload]);

  /** Message shown under a field: server problems first, then form rules once the field was visited. */
  const errorFor = (path: string) =>
    serverErrors[path] ?? (submitAttempted || touched.has(path) ? clientErrors[path] : undefined);

  const touch = (path: string) => setTouched((t) => (t.has(path) ? t : new Set(t).add(path)));
  const clearServerError = (path: string) =>
    setServerErrors((e) => {
      if (!(path in e)) return e;
      const { [path]: _removed, ...rest } = e;
      return rest;
    });

  const update = (path: string, change: (f: FormState) => FormState) => {
    setForm(change);
    clearServerError(path);
  };
  const setSignatory = (key: keyof FormState['signatory'], value: string | PickedFile | null) =>
    update(`signatory.${key === 'idProof' ? 'idProofFile' : key === 'photo' ? 'photoFile' : key}`, (f) => ({ ...f, signatory: { ...f.signatory, [key]: value } }));
  const setContact = (index: number, key: keyof ContactForm, value: string | PickedFile | null) =>
    update(`contacts.${index}.${key === 'idProof' ? 'idProofFile' : key === 'photo' ? 'photoFile' : key}`, (f) => ({
      ...f,
      contacts: f.contacts.map((c, i) => (i === index ? { ...c, [key]: value } : c)),
    }));

  const scrollToFirstError = (errors: FieldErrors) => {
    const el = Array.from(document.querySelectorAll<HTMLElement>('[data-field]')).find((n) => n.dataset.field! in errors);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.querySelector<HTMLElement>('input,select,button')?.focus({ preventScroll: true });
  };

  const submit = async (acknowledgeDuplicates: boolean) => {
    if (!agreement) return;
    setSubmitAttempted(true);
    setFormError(null);
    if (Object.keys(clientErrors).length) {
      setFormError('Please correct the highlighted fields.');
      scrollToFirstError(clientErrors);
      return;
    }
    setSubmitting(true);
    try {
      const result = await submitRegistration(toPayload(form, agreement.id, accepted, acknowledgeDuplicates));
      clearDraft();
      try {
        sessionStorage.setItem(PENDING_VERIFICATION_KEY, JSON.stringify(result));
      } catch {
        /* ignore */
      }
      navigate('/register/verify', { replace: true, state: result });
    } catch (err) {
      setWarnings(null);
      if (!(err instanceof ApiError)) {
        setFormError('Unable to reach the server. Please check your connection and try again.');
      } else if (err.code === 'duplicate_warning') {
        setWarnings((err.details.warnings as DuplicateWarning[]) ?? []);
      } else if (err.code === 'agreement_changed') {
        setAccepted(false);
        setFormError(err.message);
        loadForm();
        document.getElementById('agreement')?.scrollIntoView({ behavior: 'smooth' });
      } else if (err.fields) {
        const fields = Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, v[0]]));
        setServerErrors(fields);
        setFormError(err.message);
        scrollToFirstError(fields);
      } else {
        setFormError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit(false);
  };

  const startOver = () => {
    clearDraft();
    setForm(emptyForm());
    setAccepted(false);
    setTouched(new Set());
    setSubmitAttempted(false);
    setServerErrors({});
    setFormError(null);
    window.scrollTo({ top: 0 });
  };

  const support = [supportEmail, supportPhone].filter(Boolean).join(' / ');
  const shownErrors = submitAttempted ? { ...clientErrors, ...serverErrors } : serverErrors;

  // ---------- Small field helpers ----------

  const textInput = (
    path: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    opts: { required?: boolean; type?: string; maxLength?: number; inputMode?: 'text' | 'numeric' | 'email'; autoComplete?: string; hint?: string; disabled?: boolean; uppercase?: boolean; prefix?: string } = {},
  ) => (
    <div data-field={path}>
      <Field label={label} required={opts.required} error={errorFor(path)} hint={opts.hint}>
        {(a) => {
          const input = (
            <input
              {...a}
              type={opts.type ?? 'text'}
              className={`input ${opts.uppercase ? 'uppercase' : ''} ${opts.prefix ? 'rounded-l-none' : ''}`}
              value={value}
              maxLength={opts.maxLength}
              inputMode={opts.inputMode}
              autoComplete={opts.autoComplete ?? 'off'}
              disabled={opts.disabled}
              onChange={(e) => onChange(e.target.value)}
              onBlur={() => touch(path)}
            />
          );
          return opts.prefix ? (
            <div className="flex">
              <span className="inline-flex items-center rounded-l-md border border-r-0 border-slate-300 bg-slate-100 px-3 text-sm text-slate-600">
                {opts.prefix}
              </span>
              {input}
            </div>
          ) : (
            input
          );
        }}
      </Field>
    </div>
  );

  const selectInput = (path: string, label: string, value: string, options: readonly string[], onChange: (v: string) => void) => (
    <div data-field={path}>
      <Field label={label} required error={errorFor(path)}>
        {(a) => (
          <select {...a} className="input" value={value} onChange={(e) => onChange(e.target.value)} onBlur={() => touch(path)}>
            <option value="">Select…</option>
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        )}
      </Field>
    </div>
  );

  const fileInput = (path: string, label: string, kind: 'document' | 'photo' | 'rental', value: PickedFile | null, onChange: (f: PickedFile | null) => void, opts: { required?: boolean; disabled?: boolean } = {}) =>
    limits && (
      <FileUpload
        name={path}
        label={label}
        kind={kind}
        limits={limits}
        value={value}
        required={opts.required}
        disabled={opts.disabled}
        error={errorFor(path)}
        onChange={(f) => {
          onChange(f);
          touch(path);
        }}
      />
    );

  // ---------- Render ----------

  const s = form.signatory;
  const mergeValues = registrationMergeValues(
    { ...form, gst: form.gst || null, firmType: form.firmType, signatory: s },
    { organisationName },
  );

  return (
    <div className="min-h-screen px-4 py-6 sm:py-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-5 flex items-center gap-3">
          <Link to="/login" aria-label="Back to login">
            <BrandMark size={44} />
          </Link>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Franchise Registration</h1>
            <p className="truncate text-sm text-slate-600">{portalName}</p>
          </div>
        </header>

        {loadError ? (
          <Alert tone="error">The registration page could not be loaded. Please check your connection and refresh.</Alert>
        ) : agreement === undefined || !limits ? (
          <Loading />
        ) : agreement === null ? (
          <div className="card text-center">
            <h2 className="text-lg font-semibold text-slate-900">Registration is currently closed</h2>
            <p className="mt-2 text-sm text-slate-600">
              New franchise registrations are not being accepted at the moment. Please try again later
              {support ? ` or contact ${organisationName} at ${support}` : ''}.
            </p>
            <Link to="/login" className="btn-primary mt-5">
              Back to login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            {/* Progress indicator */}
            <nav aria-label="Form sections" className="sticky top-0 z-10 -mx-4 overflow-x-auto border-b border-slate-200 bg-slate-50/95 px-4 py-2 backdrop-blur">
              <ol className="flex min-w-max gap-2">
                {SECTIONS.map((sec, i) => {
                  const done = !sectionHasErrors(clientErrors, sec.prefixes);
                  const bad = sectionHasErrors(shownErrors, sec.prefixes);
                  return (
                    <li key={sec.id}>
                      <a
                        href={`#${sec.id}`}
                        className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                          bad ? 'border-red-300 bg-red-50 text-red-800' : done ? 'border-green-300 bg-green-50 text-green-800' : 'border-slate-300 bg-white text-slate-700'
                        }`}
                      >
                        <span aria-hidden="true">{bad ? '!' : done ? '✓' : i + 1}</span>
                        {sec.title}
                        <span className="sr-only">{bad ? ' (needs attention)' : done ? ' (complete)' : ''}</span>
                      </a>
                    </li>
                  );
                })}
              </ol>
            </nav>

            {restored && (
              <Alert tone="info">
                We restored the details you typed earlier on this device. <strong>Files are not kept</strong>, so please choose them again.{' '}
                <button type="button" className="font-medium underline" onClick={startOver}>
                  Start over
                </button>
              </Alert>
            )}
            <p className="text-sm text-slate-600">
              Fields marked <span className="text-red-600">*</span> are required. Your typed details are saved on this device as you go; files must be chosen
              again if you refresh the page.
            </p>

            {/* 1. Franchise Details */}
            <Section id="firm" number={1} title="Franchise Details">
              <div className="grid gap-4 sm:grid-cols-2">
                {textInput('franchiseModel', 'Franchise Model', form.franchiseModel, (v) => update('franchiseModel', (f) => ({ ...f, franchiseModel: v })), { required: true, maxLength: 100 })}
                {selectInput('firmType', 'Firm Type', form.firmType, FIRM_TYPES, (v) => update('firmType', (f) => ({ ...f, firmType: v })))}
                <div className="sm:col-span-2">
                  {textInput('firmName', 'Firm Name', form.firmName, (v) => update('firmName', (f) => ({ ...f, firmName: v })), { required: true, maxLength: 150, autoComplete: 'organization' })}
                </div>
              </div>
            </Section>

            {/* 2. Official Documents */}
            <Section id="documents" number={2} title="Official Documents">
              <div className="grid gap-4 sm:grid-cols-2">
                {textInput('pan', 'Official PAN Number', form.pan, (v) => update('pan', (f) => ({ ...f, pan: v.toUpperCase().replace(/[^A-Z0-9]/g, '') })), {
                  required: true,
                  maxLength: 10,
                  uppercase: true,
                  hint: '10 characters, like ABCDE1234F',
                })}
                {fileInput('panFile', 'Official PAN Image', 'document', form.panFile, (file) => update('panFile', (f) => ({ ...f, panFile: file })), { required: true })}
                {textInput('gst', 'GST Number', form.gst, (v) => update('gst', (f) => ({ ...f, gst: v.toUpperCase().replace(/[^A-Z0-9]/g, '') })), {
                  maxLength: 15,
                  uppercase: true,
                  hint: 'Optional. 15 characters; characters 3–12 must be your PAN',
                })}
                {form.gst ? (
                  fileInput('gstFile', 'GST Certificate', 'document', form.gstFile, (file) => update('gstFile', (f) => ({ ...f, gstFile: file })), { required: true })
                ) : (
                  <p className="self-center text-sm text-slate-500">The GST Certificate is needed only if you enter a GST number.</p>
                )}
                <div className="sm:col-span-2">
                  {fileInput('rentalFile', 'Rental Agreement (optional)', 'rental', form.rentalFile, (file) => update('rentalFile', (f) => ({ ...f, rentalFile: file })))}
                </div>
              </div>
            </Section>

            {/* 3. Applicant / Authorised Signatory */}
            <Section id="signatory" number={3} title="Applicant / Authorised Signatory" description="This person owns the portal login. Their email and mobile will be verified with a one-time code.">
              <div className="grid gap-4 sm:grid-cols-2">
                {textInput('signatory.name', 'Full Name', s.name, (v) => setSignatory('name', v), { required: true, maxLength: 100, autoComplete: 'name' })}
                {selectInput('signatory.capacity', 'Capacity / Designation', s.capacity, SIGNATORY_CAPACITIES, (v) => setSignatory('capacity', v))}
                {textInput('signatory.email', 'Email ID', s.email, (v) => setSignatory('email', v.trim()), { required: true, type: 'email', inputMode: 'email', autoComplete: 'email', maxLength: 254, hint: 'This will be your login email' })}
                {textInput('signatory.mobile', 'Mobile Number', s.mobile, (v) => setSignatory('mobile', digitsOnly(v)), { required: true, inputMode: 'numeric', autoComplete: 'tel-national', maxLength: 10, prefix: '+91', hint: 'This will be your login mobile' })}
                {fileInput('signatory.idProofFile', 'ID Proof', 'document', s.idProof, (file) => setSignatory('idProof', file), { required: true })}
                {fileInput('signatory.photoFile', 'Photograph', 'photo', s.photo, (file) => setSignatory('photo', file), { required: true })}
              </div>
            </Section>

            {/* 4. Contact Persons */}
            <Section id="contacts" number={4} title="Contact Persons" description="Add everyone we may contact about this franchise. Contact persons are not verified.">
              <div className="space-y-4">
                {form.contacts.map((c, i) => {
                  const same = i === 0 && form.sameAsSignatory;
                  const shown = same ? { ...c, name: s.name, email: s.email, mobile: s.mobile, idProof: s.idProof, photo: s.photo } : c;
                  return (
                    <fieldset key={c.key} className="rounded-md border border-slate-200 p-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <legend className="font-semibold text-slate-900">Contact {i + 1}</legend>
                        {i > 0 && (
                          <button
                            type="button"
                            className="text-sm font-medium text-red-700 hover:underline"
                            onClick={() => setForm((f) => ({ ...f, contacts: f.contacts.filter((_, j) => j !== i) }))}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      {i === 0 && (
                        <label className="mb-3 flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={form.sameAsSignatory}
                            onChange={(e) => setForm((f) => ({ ...f, sameAsSignatory: e.target.checked }))}
                          />
                          Same as Applicant / Authorised Signatory
                        </label>
                      )}
                      <div className="grid gap-4 sm:grid-cols-2">
                        {textInput(`contacts.${i}.name`, 'Name', shown.name, (v) => setContact(i, 'name', v), { required: true, maxLength: 100, disabled: same })}
                        {textInput(`contacts.${i}.mobile`, 'Mobile Number', shown.mobile, (v) => setContact(i, 'mobile', digitsOnly(v)), { required: true, inputMode: 'numeric', maxLength: 10, prefix: '+91', disabled: same })}
                        <div className="sm:col-span-2">
                          {textInput(`contacts.${i}.email`, 'Email ID', shown.email, (v) => setContact(i, 'email', v.trim()), { required: true, type: 'email', inputMode: 'email', maxLength: 254, disabled: same })}
                        </div>
                        {fileInput(`contacts.${i}.idProofFile`, 'ID Proof', 'document', shown.idProof, (file) => setContact(i, 'idProof', file), { required: true, disabled: same })}
                        {fileInput(`contacts.${i}.photoFile`, 'Photograph', 'photo', shown.photo, (file) => setContact(i, 'photo', file), { required: true, disabled: same })}
                      </div>
                    </fieldset>
                  );
                })}
                <SecondaryButton type="button" onClick={() => setForm((f) => ({ ...f, contacts: [...f.contacts, newContact()] }))}>
                  + Add New Contact
                </SecondaryButton>
              </div>
            </Section>

            {/* 5. Franchise Agreement */}
            <Section id="agreement" number={5} title="Franchise Agreement" aside={`Agreement Version ${agreement.versionNumber}`}>
              <p className="mb-3 text-sm text-slate-600">Please read the whole agreement before accepting it.</p>
              {agreement.format === 'pdf' && agreement.pdfUrl ? (
                <PdfViewer url={agreement.pdfUrl} heightClass="h-[65vh]" label={agreement.title} />
              ) : (
                <div className="h-[65vh] overflow-y-auto rounded-md border border-slate-300 bg-white p-4" tabIndex={0} role="document" aria-label={agreement.title}>
                  <h3 className="mb-4 text-center text-lg font-bold">{agreement.title}</h3>
                  <SafeHtml html={renderAgreement(agreement.content, mergeValues)} className="agreement-content" />
                </div>
              )}

              <label data-field="agreement.accepted" className="mt-5 flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5 shrink-0"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                  aria-required="true"
                />
                <span>
                  {AGREEMENT_ACCEPTANCE_TEXT} <span className="text-red-600" aria-hidden="true">*</span>
                </span>
              </label>
            </Section>

            {formError && <Alert tone="error">{formError}</Alert>}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Link to="/login" className="text-center text-sm font-medium text-brand hover:underline">
                Already registered? Log in
              </Link>
              <button type="submit" className="btn-primary w-full sm:w-auto sm:px-8" disabled={!accepted || submitting}>
                {submitting ? 'Submitting…' : 'Register'}
              </button>
            </div>
            {!accepted && <p className="text-right text-xs text-slate-500">Tick the agreement checkbox to enable Register.</p>}
          </form>
        )}
      </div>

      {warnings && (
        <Modal
          title="Some details are already in use"
          onClose={() => setWarnings(null)}
          footer={
            <>
              <SecondaryButton onClick={() => setWarnings(null)}>Go back and edit</SecondaryButton>
              <button className="btn-primary" disabled={submitting} onClick={() => void submit(true)}>
                {submitting ? 'Submitting…' : 'Continue with registration'}
              </button>
            </>
          }
        >
          <div className="space-y-3 text-sm text-slate-700">
            <p>The following details are already linked to another registration:</p>
            <ul className="list-disc space-y-1 pl-5">
              {warnings.map((w) => (
                <li key={w.field}>
                  <strong>{fieldLabel(w.field)}</strong>
                </li>
              ))}
            </ul>
            <p>You can still continue. Your application will be reviewed by our team before it is approved.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Section({ id, number, title, description, aside, children }: { id: string; number: number; title: string; description?: string; aside?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="card scroll-mt-16">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 id={`${id}-heading`} className="text-lg font-semibold text-slate-900">
          <span className="mr-2 text-slate-400">{number}.</span>
          {title}
        </h2>
        {aside && <span className="text-sm text-slate-600">{aside}</span>}
      </div>
      {description && <p className="-mt-2 mb-4 text-sm text-slate-600">{description}</p>}
      {children}
    </section>
  );
}
