import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  AGREEMENT_ACCEPTANCE_TEXT,
  LEGAL_DOCUMENTS,
  FIRM_TYPES,
  SIGNATORY_CAPACITIES,
  registrationMergeValues,
  registrationSchema,
  renderAgreement,
  resubmissionSchema,
  toFieldErrors,
  type DuplicateWarning,
  type FieldErrors,
  type PublicAgreementView,
  type RegistrationInput,
  type UploadKind,
  type UploadLimits,
  type UploadedFileView,
} from '@fap/shared';
import { ApiError } from '../api/client';
import { useBranding } from '../branding/BrandingContext';
import {
  SECTIONS,
  digitsOnly,
  emptyForm,
  fieldLabel,
  newContact,
  sectionHasErrors,
  toPayload,
  type ContactForm,
  type FormState,
} from '../lib/registrationForm';
import { FileUpload, type PickedFile } from './FileUpload';
import { PdfViewer } from './PdfViewer';
import { Alert, Field, Modal, SafeHtml, SecondaryButton } from './ui';

interface RegistrationFormProps {
  /** "register": new application (PRD P2). "resubmit": Edit & Resubmit (PRD F3). */
  mode: 'register' | 'resubmit';
  agreement: PublicAgreementView;
  limits: UploadLimits;
  initialForm: FormState;
  /** Shown above the form (e.g. the rejection reason). */
  intro?: ReactNode;
  /** Shown just above the Register / Resubmit button (e.g. "Already registered? Log in"). */
  footerLink?: ReactNode;
  submitLabel: string;
  /** How a chosen file is uploaded (public for Register, logged-in for Resubmit). */
  upload: (kind: UploadKind, file: File) => Promise<UploadedFileView>;
  /** Sends the form; throw the ApiError to show problems on the form. */
  onSubmit: (payload: RegistrationInput) => Promise<void>;
  /** Called on every change (used for the browser autosave on Register). */
  onFormChange?: (form: FormState) => void;
  /** Called when the server says the agreement changed (reload it). */
  onAgreementChanged?: () => void;
  /** "We restored your details" notice with a Start over link (Register only). */
  restored?: boolean;
  onStartOver?: () => void;
}

/** The five-section franchise registration form (PRD §8), shared by Register and Edit & Resubmit. */
export function RegistrationForm(props: RegistrationFormProps) {
  const { agreement, limits, mode } = props;
  const resubmit = mode === 'resubmit';
  const schema = resubmit ? resubmissionSchema : registrationSchema;
  const { organisationName } = useBranding();

  const [form, setForm] = useState<FormState>(props.initialForm);
  const [accepted, setAccepted] = useState(false);
  const [consented, setConsented] = useState(false);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<DuplicateWarning[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { onFormChange } = props;
  useEffect(() => {
    if (!onFormChange) return;
    const t = window.setTimeout(() => onFormChange(form), 400);
    return () => window.clearTimeout(t);
  }, [form, onFormChange]);

  const payload = useMemo(() => toPayload(form, agreement.id, accepted, consented, false), [form, agreement, accepted, consented]);
  const clientErrors = useMemo<FieldErrors>(() => {
    const r = schema.safeParse(payload);
    return r.success ? {} : toFieldErrors(r.error);
  }, [payload, schema]);

  /** Message shown under a field: server problems first, then form rules once the field was visited. */
  const errorFor = (path: string) => serverErrors[path] ?? (submitAttempted || touched.has(path) ? clientErrors[path] : undefined);

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
    setSubmitAttempted(true);
    setFormError(null);
    if (Object.keys(clientErrors).length) {
      setFormError('Please correct the highlighted fields.');
      scrollToFirstError(clientErrors);
      return;
    }
    setSubmitting(true);
    try {
      await props.onSubmit(toPayload(form, agreement.id, accepted, consented, acknowledgeDuplicates));
    } catch (err) {
      setWarnings(null);
      if (!(err instanceof ApiError)) {
        setFormError('Unable to reach the server. Please check your connection and try again.');
      } else if (err.code === 'duplicate_warning') {
        setWarnings((err.details.warnings as DuplicateWarning[]) ?? []);
      } else if (err.code === 'agreement_changed') {
        setAccepted(false);
        setFormError(err.message);
        props.onAgreementChanged?.();
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
    props.onStartOver?.();
    setForm(emptyForm());
    setAccepted(false);
    setConsented(false);
    setTouched(new Set());
    setSubmitAttempted(false);
    setServerErrors({});
    setFormError(null);
    window.scrollTo({ top: 0 });
  };

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
              className={`input ${opts.uppercase ? 'uppercase' : ''} ${opts.prefix ? 'rounded-l-none' : ''} ${opts.disabled ? 'bg-slate-100 text-slate-600' : ''}`}
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
              <span className="inline-flex items-center rounded-l-md border border-r-0 border-slate-300 bg-slate-100 px-3 text-sm text-slate-600">{opts.prefix}</span>
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

  const fileInput = (
    path: string,
    label: string,
    kind: UploadKind,
    value: PickedFile | null,
    onChange: (f: PickedFile | null) => void,
    opts: { required?: boolean; disabled?: boolean } = {},
  ) => (
    <FileUpload
      name={path}
      label={label}
      kind={kind}
      limits={limits}
      value={value}
      required={opts.required}
      disabled={opts.disabled}
      error={errorFor(path)}
      upload={props.upload}
      onChange={(f) => {
        onChange(f);
        touch(path);
      }}
    />
  );

  // ---------- Render ----------

  const s = form.signatory;
  const mergeValues = registrationMergeValues({ ...form, gst: form.gst || null, firmType: form.firmType, signatory: s }, { organisationName });

  return (
    <>
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

        {props.intro}

        {props.restored && (
          <Alert tone="info">
            We restored the details you typed earlier on this device. <strong>Files are not kept</strong>, so please choose them again.{' '}
            <button type="button" className="font-medium underline" onClick={startOver}>
              Start over
            </button>
          </Alert>
        )}
        <p className="text-sm text-slate-600">
          Fields marked <span className="text-red-600">*</span> are required.{' '}
          {resubmit
            ? 'Your previous details and documents are filled in; change only what needs correcting. Use "Replace" to upload a new file.'
            : 'Your typed details are saved on this device as you go; files must be chosen again if you refresh the page.'}
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
        <Section
          id="signatory"
          number={3}
          title="Applicant / Authorised Signatory"
          description={
            resubmit
              ? 'Your login email and mobile cannot be changed here. To change them, use My Profile.'
              : 'This person owns the portal login. Their email and mobile will be verified with a one-time code.'
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {textInput('signatory.name', 'Full Name', s.name, (v) => setSignatory('name', v), { required: true, maxLength: 100, autoComplete: 'name' })}
            {selectInput('signatory.capacity', 'Capacity / Designation', s.capacity, SIGNATORY_CAPACITIES, (v) => setSignatory('capacity', v))}
            {textInput('signatory.email', 'Email ID', s.email, (v) => setSignatory('email', v.trim()), {
              required: true,
              type: 'email',
              inputMode: 'email',
              autoComplete: 'email',
              maxLength: 254,
              disabled: resubmit,
              hint: resubmit ? 'Your login email' : 'This will be your login email',
            })}
            {textInput('signatory.mobile', 'Mobile Number', s.mobile, (v) => setSignatory('mobile', digitsOnly(v)), {
              required: true,
              inputMode: 'numeric',
              autoComplete: 'tel-national',
              maxLength: 10,
              prefix: '+91',
              disabled: resubmit,
              hint: resubmit ? 'Your login mobile' : 'This will be your login mobile',
            })}
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
                      <button type="button" className="text-sm font-medium text-red-700 hover:underline" onClick={() => setForm((f) => ({ ...f, contacts: f.contacts.filter((_, j) => j !== i) }))}>
                        Remove
                      </button>
                    )}
                  </div>
                  {i === 0 && (
                    <label className="mb-3 flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" className="h-4 w-4" checked={form.sameAsSignatory} onChange={(e) => setForm((f) => ({ ...f, sameAsSignatory: e.target.checked }))} />
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
          <p className="mb-3 text-sm text-slate-600">
            {resubmit ? 'This is the same agreement version you accepted originally. Please read it and accept it again.' : 'Please read the whole agreement before accepting it.'}
          </p>
          {agreement.format === 'pdf' && agreement.pdfUrl ? (
            <PdfViewer url={agreement.pdfUrl} heightClass="h-[65vh]" label={agreement.title} />
          ) : (
            <div className="h-[65vh] overflow-y-auto rounded-md border border-slate-300 bg-white p-4" tabIndex={0} role="document" aria-label={agreement.title}>
              <h3 className="mb-4 text-center text-lg font-bold">{agreement.title}</h3>
              <SafeHtml html={renderAgreement(agreement.content, mergeValues)} className="agreement-content" />
            </div>
          )}

          <label data-field="agreement.accepted" className="mt-5 flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} aria-required="true" />
            <span>
              {AGREEMENT_ACCEPTANCE_TEXT} <span className="text-red-600" aria-hidden="true">*</span>
            </span>
          </label>

          <label data-field="legalConsent" className="mt-3 flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={consented} onChange={(e) => setConsented(e.target.checked)} aria-required="true" />
            <span>
              I have read and agree to the{' '}
              <a href={LEGAL_DOCUMENTS.terms.path} target="_blank" rel="noopener noreferrer" className="font-medium text-brand underline">
                Terms &amp; Conditions
              </a>{' '}
              and the{' '}
              <a href={LEGAL_DOCUMENTS.privacy.path} target="_blank" rel="noopener noreferrer" className="font-medium text-brand underline">
                Privacy Policy
              </a>
              . I consent to my personal data, and that of the contact persons I have named (who know I am sharing it), being processed for the purposes described in the Privacy Policy.{' '}
              <span className="text-red-600" aria-hidden="true">*</span>
            </span>
          </label>
          {shownErrors.legalConsent && <p className="mt-1 text-sm text-red-700">{shownErrors.legalConsent}</p>}
        </Section>

        {formError && <Alert tone="error">{formError}</Alert>}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-center text-sm sm:text-left">{props.footerLink}</div>
          <button type="submit" className="btn-primary w-full sm:w-auto sm:px-8" disabled={!accepted || !consented || submitting}>
            {submitting ? 'Submitting…' : props.submitLabel}
          </button>
        </div>
        {(!accepted || !consented) && <p className="text-right text-xs text-slate-500">Tick both checkboxes to enable {props.submitLabel}.</p>}
      </form>

      {warnings && (
        <Modal
          title="Some details are already in use"
          onClose={() => setWarnings(null)}
          footer={
            <>
              <SecondaryButton onClick={() => setWarnings(null)}>Go back and edit</SecondaryButton>
              <button className="btn-primary" disabled={submitting} onClick={() => void submit(true)}>
                {submitting ? 'Submitting…' : `Continue with ${resubmit ? 'resubmission' : 'registration'}`}
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
    </>
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
