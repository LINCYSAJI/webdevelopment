import { Link } from 'react-router-dom';
import { LEGAL_DOCUMENTS } from '@fap/shared';
import { useLegalContacts } from '../../lib/legalContacts';
import { Bullets, LegalPageLayout, LegalSection } from './LegalPageLayout';

/**
 * Terms & Conditions for using the Portal (Indian Contract Act 1872, IT Act 2000).
 * They govern the website only; the franchise relationship is governed by the franchise agreement.
 */
export function TermsPage() {
  const c = useLegalContacts();
  const doc = LEGAL_DOCUMENTS.terms;
  const privacy = (
    <Link to={LEGAL_DOCUMENTS.privacy.path} className="font-medium text-brand underline">
      Privacy Policy
    </Link>
  );

  return (
    <LegalPageLayout title={doc.title} version={doc.version} effectiveDate={doc.effectiveDate}>
      <p>
        These Terms &amp; Conditions (“Terms”) govern your use of the {c.portal} (the “Portal”), operated by <strong>{c.org}</strong> (“we”, “us”, “our”),
        registered address {c.address}. By registering or using the Portal you agree to these Terms and to our {privacy}. If you do not agree, please do
        not use the Portal.
      </p>

      <LegalSection number={1} title="Who may use the Portal">
        <Bullets
          items={[
            'You must be at least 18 years old and competent to enter into a contract under the Indian Contract Act, 1872.',
            'If you apply for a firm, LLP or company, you confirm that you are authorised to act and accept the franchise agreement on its behalf.',
            'The Portal is for prospective franchise partners of our business. Our staff accounts are created only by us.',
          ]}
        />
      </LegalSection>

      <LegalSection number={2} title="Your account">
        <Bullets
          items={[
            'Each applicant has one account, linked to the verified email address and mobile number of the authorised signatory.',
            'Keep your password confidential. You are responsible for everything done through your account.',
            'Tell us immediately if you suspect someone else has used your account.',
          ]}
        />
      </LegalSection>

      <LegalSection number={3} title="Information and documents you provide">
        <Bullets
          items={[
            'All details and documents you submit must be true, complete, current and your own (or provided with the owner’s permission).',
            'You confirm that every contact person you add knows you are sharing their details with us and agrees.',
            'Submitting false or forged information or documents may lead to rejection, closure of your account, termination of any agreement and legal action.',
          ]}
        />
      </LegalSection>

      <LegalSection number={4} title="How applications are decided">
        <Bullets
          items={[
            'Submitting an application is not an acceptance. Each application is reviewed by our Accounts team and then by a Manager.',
            'We may approve, reject, or ask you to correct and resubmit an application at our discretion. We do not guarantee approval.',
            'Applications with possible duplicate details may be held until we have checked them.',
            'On final approval, a franchise agreement with a unique reference number is generated and emailed to you.',
          ]}
        />
      </LegalSection>

      <LegalSection number={5} title="Electronic agreement">
        <Bullets
          items={[
            'You accept the franchise agreement electronically by ticking the acceptance box and submitting your application. Under section 10A of the Information Technology Act, 2000, this electronic acceptance is valid and binding.',
            'The generated agreement is a computer-generated digital agreement and does not require any physical or digital signature.',
            'We keep a permanent record of the agreement version you accepted and when. Your application stays on that version even if we later publish a newer one.',
            'Your franchise relationship is governed by the franchise agreement. If these Terms conflict with it, the franchise agreement prevails.',
          ]}
        />
      </LegalSection>

      <LegalSection number={6} title="No payments through the Portal">
        <p>
          The Portal does not ask for or collect any fee or payment. If anyone asks you to pay through or in the name of the Portal, do not pay and contact us.
        </p>
      </LegalSection>

      <LegalSection number={7} title="Acceptable use">
        <p>You must not:</p>
        <Bullets
          items={[
            'try to access another person’s account, application or documents, or any part of the Portal you are not permitted to use;',
            'upload viruses or harmful files, or interfere with the Portal’s security or operation;',
            'use automated tools to copy data from the Portal or overload it;',
            'use the Portal for any unlawful purpose or in breach of the Information Technology Act, 2000.',
          ]}
        />
      </LegalSection>

      <LegalSection number={8} title="Your personal data">
        <p>
          We handle your personal data as described in our {privacy}, in line with the Digital Personal Data Protection Act, 2023. You can ask for your
          account to be deleted from <em>My Profile</em> at any time.
        </p>
      </LegalSection>

      <LegalSection number={9} title="Intellectual property">
        <p>
          The Portal, its content, our name, logo and the franchise agreement templates belong to us or our licensors. You may use them only to apply for and
          manage your franchise.
        </p>
      </LegalSection>

      <LegalSection number={10} title="Availability and liability">
        <Bullets
          items={[
            'We aim to keep the Portal available and secure, but it may sometimes be unavailable for maintenance or reasons beyond our control.',
            'To the extent permitted by law, we are not liable for indirect or consequential loss arising from use of, or inability to use, the Portal.',
            'Nothing in these Terms limits any liability that cannot be limited under Indian law.',
          ]}
        />
      </LegalSection>

      <LegalSection number={11} title="Indemnity">
        <p>
          You agree to compensate us for loss caused by false information you submit, your misuse of the Portal, or your breach of these Terms.
        </p>
      </LegalSection>

      <LegalSection number={12} title="Suspension and closure">
        <p>
          We may suspend or close an account that breaches these Terms or the law. You may close your account at any time by requesting deletion from{' '}
          <em>My Profile</em>; records that the law requires us to keep are retained as described in the {privacy}.
        </p>
      </LegalSection>

      <LegalSection number={13} title="Governing law and disputes">
        <p>
          These Terms are governed by the laws of India. Subject to any dispute-resolution clause in your franchise agreement, the courts having jurisdiction
          over our registered office have exclusive jurisdiction.
        </p>
      </LegalSection>

      <LegalSection number={14} title="Changes to these Terms">
        <p>
          We may update these Terms. The new version will be published here with its version number and date, and will apply from that date. If we make an
          important change, we will tell you by email.
        </p>
      </LegalSection>

      <LegalSection number={15} title="Contact and grievances">
        <p>
          Questions about these Terms or complaints can be sent to {c.officerName}
          {c.officerEmail ? (
            <>
              {' '}at{' '}
              <a href={`mailto:${c.officerEmail}`} className="font-medium text-brand underline">
                {c.officerEmail}
              </a>
            </>
          ) : null}
          {c.supportPhone ? `, phone ${c.supportPhone}` : ''}. We reply as soon as possible, and in any case within 90 days.
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
