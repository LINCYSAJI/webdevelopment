import { Link } from 'react-router-dom';
import { AGREEMENT_RETENTION_YEARS, LEGAL_DOCUMENTS } from '@fap/shared';
import { useLegalContacts } from '../../lib/legalContacts';
import { Bullets, LegalPageLayout, LegalSection } from './LegalPageLayout';

/**
 * Privacy Policy, written as the notice required by the Digital Personal Data Protection Act,
 * 2023 (s.5) and the DPDP Rules, 2025, and the IT (Reasonable Security Practices) Rules, 2011.
 * Business details (name, address, Grievance Officer) come from Admin > Settings.
 */
export function PrivacyPolicyPage() {
  const c = useLegalContacts();
  const doc = LEGAL_DOCUMENTS.privacy;
  const officerContact = c.officerEmail ? <a href={`mailto:${c.officerEmail}`} className="font-medium text-brand underline">{c.officerEmail}</a> : c.missing;

  return (
    <LegalPageLayout title={doc.title} version={doc.version} effectiveDate={doc.effectiveDate}>
      <p>
        This Privacy Policy explains how <strong>{c.org}</strong> (“we”, “us”, “our”) collects, uses, shares, stores and erases your personal data when you
        use the {c.portal} (the “Portal”) to apply for a franchise. It is our notice to you under the Digital Personal Data Protection Act, 2023 (the “DPDP
        Act”) and the Digital Personal Data Protection Rules, 2025. Please read it with our <Link to={LEGAL_DOCUMENTS.terms.path} className="font-medium text-brand underline">Terms &amp; Conditions</Link>.
      </p>

      <LegalSection number={1} title="Who is responsible for your data">
        <p>
          {c.org} is the <strong>Data Fiduciary</strong> for the personal data processed through the Portal. Registered address: {c.address}.
        </p>
      </LegalSection>

      <LegalSection number={2} title="Personal data we collect">
        <p>We collect only what we need to assess and manage your franchise application:</p>
        <Bullets
          items={[
            <><strong>Applicant / authorised signatory:</strong> name, capacity (owner, partner, director or representative), email address, mobile number, a copy of an identity proof and a photograph.</>,
            <><strong>Business details:</strong> franchise model, firm type, firm name, PAN, GSTIN (if any), and copies of the PAN card, GST certificate and rental agreement. For a sole proprietor, the PAN is personal data.</>,
            <><strong>Contact persons:</strong> name, email address, mobile number, identity proof and photograph of each contact person you add.</>,
            <><strong>Account and verification:</strong> your password (stored only as a one-way encrypted hash, never readable by anyone), one-time codes sent to your email and mobile (stored only in protected form), and the dates you verified them.</>,
            <><strong>Agreement records:</strong> the agreement version you accepted, the date and time, your IP address and browser type, the consent you gave to this policy, and, if approved, the generated agreement and the history of it being emailed to you.</>,
            <><strong>Technical and security data:</strong> login times, IP address, browser type and an audit record of important actions on your application.</>,
          ]}
        />
        <p>
          We do not collect bank, card or payment details, and we do not use advertising or tracking cookies. The Portal uses only essential cookies that keep
          you securely logged in.
        </p>
      </LegalSection>

      <LegalSection number={3} title="Why we use your data">
        <Bullets
          items={[
            'To verify that the email address and mobile number belong to you, and to create and secure your account.',
            'To review your application through our Accounts team and Manager, including checking documents and asking you for corrections.',
            'To detect duplicate, false or fraudulent applications (for example, the same PAN, GSTIN, email or mobile used in more than one application).',
            'To prepare your personalised franchise agreement on approval and send it to you.',
            'To keep you informed by email and SMS about the progress of your application.',
            'To keep the Portal secure, investigate misuse and maintain an audit trail.',
            'To meet our obligations under Indian law, and to establish or defend legal claims.',
          ]}
        />
        <p>We do not sell your personal data and we do not use it for marketing.</p>
      </LegalSection>

      <LegalSection number={4} title="The basis on which we process your data">
        <p>
          We process your personal data on the basis of the <strong>consent</strong> you give by ticking the consent box when you submit your application
          (DPDP Act, section 6). Where the law permits, we also process data without fresh consent for legitimate uses, such as complying with a law, a court
          order, or a request from a government authority (DPDP Act, section 7).
        </p>
      </LegalSection>

      <LegalSection number={5} title="Data about your contact persons">
        <p>
          When you add contact persons, you confirm that you have told them you are sharing their details with us for your application and that they agree.
          They have the same rights described in this policy and may contact our Grievance Officer directly.
        </p>
      </LegalSection>

      <LegalSection number={6} title="Who can see your data">
        <Bullets
          items={[
            <><strong>Our authorised staff only:</strong> the Accounts team and Managers who review applications, and Administrators who manage the Portal, each seeing only what their role requires. Only Managers can open your generated agreement.</>,
            <><strong>Service providers (Data Processors)</strong> who act only on our instructions under written contracts: cloud hosting and database, secure private file storage, email delivery, and SMS delivery through telecom operators registered under the TRAI DLT framework.</>,
            <><strong>Authorities</strong> such as courts, regulators or law-enforcement agencies, when Indian law requires us to share data.</>,
          ]}
        />
      </LegalSection>

      <LegalSection number={7} title="Where your data is stored">
        <p>
          Your data is stored on secure cloud servers. If any of it is processed outside India, it will only be in countries to which transfer is not
          restricted by the Central Government under section 16 of the DPDP Act.
        </p>
      </LegalSection>

      <LegalSection number={8} title="How we protect your data">
        <Bullets
          items={[
            'All traffic to the Portal is encrypted (HTTPS).',
            'Uploaded documents are kept in private storage and are opened only after a permission check, never through a public link.',
            'Passwords are stored as one-way hashes; repeated wrong passwords temporarily lock the account.',
            'Access is limited by role, and important actions are written to a permanent audit log.',
          ]}
        />
        <p>
          If a personal data breach occurs, we will inform you and the Data Protection Board of India as required by the DPDP Act and Rules, describing what
          happened, the likely impact, and the steps we are taking and that you can take.
        </p>
      </LegalSection>

      <LegalSection number={9} title="How long we keep your data">
        <Bullets
          items={[
            <><strong>Registrations never verified:</strong> deleted automatically after the verification period ends.</>,
            <><strong>Applications not approved:</strong> kept while your account is open so you can correct and resubmit. If you ask us to delete your account, we erase them as described in section 10.</>,
            <><strong>Approved franchise agreements:</strong> the agreement and the details and documents it relies on are kept for as long as the franchise relationship lasts and for {AGREEMENT_RETENTION_YEARS} years after it ends, as required by tax and company law and for legal claims.</>,
            <><strong>Security and audit logs:</strong> kept for at least one year, as required by the DPDP Rules.</>,
            <><strong>Proof of consent:</strong> a record that you gave consent (and later withdrew it, if you did) is kept as evidence, without your documents.</>,
          ]}
        />
      </LegalSection>

      <LegalSection id="your-rights" number={10} title="Your rights">
        <p>Under the DPDP Act (sections 11 to 14) you have the right to:</p>
        <Bullets
          items={[
            <><strong>Access:</strong> see a summary of the personal data we hold about you and how it is used. Your details, documents and history are shown in <em>My Application</em>; you may also ask the Grievance Officer.</>,
            <><strong>Correction and updating:</strong> change your email or mobile in <em>My Profile</em>, and correct application details when changes are requested. For anything else, contact the Grievance Officer.</>,
            <><strong>Erasure and withdrawal of consent:</strong> use <em>Delete my account</em> in <em>My Profile</em> (or contact the Grievance Officer). Withdrawing consent is as easy as giving it. We will close your account, withdraw your application, erase your details and delete your uploaded documents, unless the law requires us to keep them (for example, an approved agreement, see section 9). Withdrawal does not affect processing already done, and we can no longer consider your application afterwards.</>,
            <><strong>Grievance redressal:</strong> complain to our Grievance Officer (section 12) and receive a reply.</>,
            <><strong>Nomination:</strong> nominate another person to exercise these rights for you in the event of your death or incapacity, by writing to the Grievance Officer.</>,
          ]}
        />
        <p>We will reply to requests and grievances as soon as possible, and in any case within 90 days.</p>
      </LegalSection>

      <LegalSection number={11} title="Your duties">
        <p>
          Under section 15 of the DPDP Act you must give accurate and genuine information, must not impersonate anyone, and must not file false or frivolous
          complaints.
        </p>
      </LegalSection>

      <LegalSection id="grievance-officer" number={12} title="Grievance Officer and contact">
        <p>For questions, requests or complaints about your personal data, please contact:</p>
        <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
          <div className="font-medium text-slate-900">{c.officerName}</div>
          <div>{c.org}</div>
          <div>{c.address}</div>
          <div>Email: {officerContact}</div>
          {c.supportPhone && <div>Phone: {c.supportPhone}</div>}
        </div>
        <p>
          If you are not satisfied with our response, you may complain to the <strong>Data Protection Board of India</strong> under the DPDP Act, after first
          contacting us.
        </p>
      </LegalSection>

      <LegalSection number={13} title="Children">
        <p>The Portal is only for adults (18 years or older) who can enter into a contract. We do not knowingly collect personal data of children.</p>
      </LegalSection>

      <LegalSection number={14} title="Changes to this policy">
        <p>
          When we change this policy, we will publish the new version here with a new version number and date. If the change affects how we use your data, we
          will tell you by email and, where the law requires, ask for your consent again.
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
