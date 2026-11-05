import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { PublicAgreementView, RegistrationInput, UploadLimits } from '@fap/shared';
import { getRegistrationForm, submitRegistration, uploadRegistrationFile } from '../api/public';
import { useBranding } from '../branding/BrandingContext';
import { BrandMark } from '../components/BrandMark';
import { LegalFooter } from '../components/LegalFooter';
import { RegistrationForm } from '../components/RegistrationForm';
import { Alert, Loading } from '../components/ui';
import { clearDraft, emptyForm, loadDraft, saveDraft } from '../lib/registrationForm';
import { PENDING_VERIFICATION_KEY } from '../lib/registrationSession';

/** Public Franchise Registration page (PRD P2). */
export function RegisterPage() {
  const { portalName, organisationName, supportEmail, supportPhone } = useBranding();
  const navigate = useNavigate();

  const [agreement, setAgreement] = useState<PublicAgreementView | null | undefined>(undefined);
  const [limits, setLimits] = useState<UploadLimits | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [draft] = useState(() => loadDraft());
  const [formKey, setFormKey] = useState(0);

  const loadForm = useCallback(() => {
    getRegistrationForm()
      .then((r) => {
        setAgreement(r.agreement);
        setLimits(r.limits);
      })
      .catch(() => setLoadError(true));
  }, []);
  useEffect(loadForm, [loadForm]);

  const handleSubmit = async (payload: RegistrationInput) => {
    const result = await submitRegistration(payload);
    clearDraft();
    try {
      sessionStorage.setItem(PENDING_VERIFICATION_KEY, JSON.stringify(result));
    } catch {
      /* ignore */
    }
    navigate('/register/verify', { replace: true, state: result });
  };

  const support = [supportEmail, supportPhone].filter(Boolean).join(' / ');

  return (
    <div className="flex min-h-screen flex-col">
    <div className="flex-1 px-4 py-6 sm:py-8">
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
          <RegistrationForm
            key={formKey}
            mode="register"
            agreement={agreement}
            limits={limits}
            initialForm={formKey === 0 ? draft ?? emptyForm() : emptyForm()}
            restored={formKey === 0 && draft !== null}
            onStartOver={() => {
              clearDraft();
              setFormKey((k) => k + 1);
            }}
            onFormChange={saveDraft}
            onAgreementChanged={loadForm}
            upload={uploadRegistrationFile}
            onSubmit={handleSubmit}
            submitLabel="Register"
            footerLink={
              <Link to="/login" className="font-medium text-brand hover:underline">
                Already registered? Log in
              </Link>
            }
          />
        )}
      </div>
    </div>
    <LegalFooter />
    </div>
  );
}
