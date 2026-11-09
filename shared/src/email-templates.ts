import { z } from 'zod';

// Editable email templates (PRD §11 "Email templates (subject and body) can be edited by Admin in
// Settings and can use the same merge fields as the agreement", §14).
//
// - Merge fields are written {{snake_case}}, as in typed agreements.
// - The body is plain text: paragraphs are separated by a blank line. A paragraph that is left
//   empty after its fields are filled in (for example an optional note) is left out.
// - The branded header, the button and its link are added by the portal and cannot be edited, so a
//   template can never point an email at the wrong address.
// - `required` fields must stay in the subject or body (for example the code in an OTP email).

export interface EmailField {
  key: string;
  label: string;
  sample: string;
}

const F = {
  recipient_name: { key: 'recipient_name', label: 'Recipient name', sample: 'Priya Sharma' },
  organisation_name: { key: 'organisation_name', label: 'Organisation name', sample: 'Your Organisation' },
  portal_name: { key: 'portal_name', label: 'Portal name', sample: 'Franchise Agreement Portal' },
  application_id: { key: 'application_id', label: 'Application ID', sample: 'APP-2026-0001' },
  firm_name: { key: 'firm_name', label: 'Firm Name', sample: 'Sunrise Retail Pvt Ltd' },
  signatory_name: { key: 'signatory_name', label: 'Signatory Name', sample: 'Priya Sharma' },
  agreement_reference_no: { key: 'agreement_reference_no', label: 'Agreement Reference No.', sample: 'FRN/2026/0001' },
  code: { key: 'code', label: 'Verification code', sample: '482913' },
  valid_minutes: { key: 'valid_minutes', label: 'Minutes the code or link is valid', sample: '10' },
  valid_hours: { key: 'valid_hours', label: 'Hours the link is valid', sample: '72' },
  role: { key: 'role', label: 'Role', sample: 'Accounts' },
  matched_fields: { key: 'matched_fields', label: 'Matching details', sample: 'Contact 1 Email' },
  changed_item: { key: 'changed_item', label: 'What changed', sample: 'email address' },
  new_value: { key: 'new_value', label: 'New value', sample: 'priya.new@example.com' },
  admin_note: { key: 'admin_note', label: 'Note from Admin (may be empty)', sample: 'Please prioritise this one.' },
  note: { key: 'note', label: 'Note', sample: 'The same firm registered earlier as APP-2026-0007.' },
  reviewer: { key: 'reviewer', label: 'Reviewer ("Accounts team" or "Manager")', sample: 'Accounts team' },
  stage: { key: 'stage', label: 'Stage ("Accounts" or "Manager")', sample: 'Accounts' },
  reason: { key: 'reason', label: 'Reason', sample: 'The GST certificate is not readable. Please upload a clearer copy.' },
  applicant_name: { key: 'applicant_name', label: 'Applicant name', sample: 'Priya Sharma' },
  applications: { key: 'applications', label: 'List of applications', sample: '• APP-2026-0001 (Sunrise Retail Pvt Ltd): Pending Accounts, waiting 3 business days' },
  escalation_days: { key: 'escalation_days', label: 'Admin escalation period (business days)', sample: '5' },
} satisfies Record<string, EmailField>;
type FieldKey = keyof typeof F;

export interface EmailTemplateDef {
  key: string;
  /** PRD §11 notification number, or a short group name. */
  code: string;
  label: string;
  recipients: string;
  fields: EmailField[];
  /** Fields that must stay in the subject or body. */
  required: string[];
  subject: string;
  body: string;
}

const def = (
  key: string,
  code: string,
  label: string,
  recipients: string,
  fields: FieldKey[],
  required: FieldKey[],
  subject: string,
  body: string[],
): EmailTemplateDef => ({
  key,
  code,
  label,
  recipients,
  fields: (['recipient_name', 'organisation_name', 'portal_name', ...fields] as FieldKey[]).filter((k, i, all) => all.indexOf(k) === i).map((k) => F[k]),
  required,
  subject,
  body: body.join('\n\n'),
});

const APP: FieldKey[] = ['application_id', 'firm_name', 'signatory_name'];

export const EMAIL_TEMPLATES: EmailTemplateDef[] = [
  def('otp_registration', 'N1', 'Email verification code (registration)', 'Applicant', ['code', 'valid_minutes'], ['code'], '{{code}} is your verification code', [
    'Use this code to verify your email address for your franchise registration:',
    '{{code}}',
    'The code is valid for {{valid_minutes}} minutes. Do not share it with anyone. If you did not request it, you can ignore this email.',
  ]),
  def('otp_change_email', 'N1', 'Email verification code (new login email)', 'Franchise user', ['code', 'valid_minutes'], ['code'], '{{code}} is your verification code', [
    'Use this code to confirm your new login email address:',
    '{{code}}',
    'The code is valid for {{valid_minutes}} minutes. Do not share it with anyone. If you did not request it, you can ignore this email.',
  ]),
  def('application_submitted', 'N2', 'Application submitted', 'Applicant', APP, ['application_id'], 'Application submitted: {{application_id}}', [
    'Hello {{recipient_name}},',
    'Thank you. Your franchise application for {{firm_name}} has been submitted successfully.',
    'Your Application ID is {{application_id}}. Our Accounts team will now review it, and we will email you at each stage.',
  ]),
  def('new_application_accounts', 'N2', 'New application waiting for verification', 'All Accounts users', APP, ['application_id'], 'New application waiting for verification: {{application_id}}', [
    'Hello {{recipient_name}},',
    'A new franchise application ({{application_id}}, {{firm_name}}) is waiting for verification in the Accounts queue.',
  ]),
  def('new_registration_admin', 'N2', 'New registration', 'Admin', APP, ['application_id'], 'New registration: {{application_id}}', [
    'Hello {{recipient_name}},',
    'A new franchise registration ({{application_id}}, {{firm_name}}) has been submitted and is with the Accounts team.',
  ]),
  def('duplicate_flag', 'N3', 'Possible duplicate needs review', 'Admin', [...APP, 'matched_fields'], ['application_id'], 'Possible duplicate needs review: {{application_id}}', [
    'Hello {{recipient_name}},',
    'Application {{application_id}} ({{firm_name}}) uses details already linked to another registration: {{matched_fields}}.',
    'Accounts cannot approve it until you review the flag in Duplicate Review.',
  ]),
  def('application_assigned', 'N4', 'Application assigned to you', 'Accounts user (new assignee)', [...APP, 'admin_note'], ['application_id'], 'Application assigned to you: {{application_id}}', [
    'Hello {{recipient_name}},',
    'Application {{application_id}} ({{firm_name}}) has been assigned to you for Accounts review.',
    'Note from Admin: {{admin_note}}',
  ]),
  def('accounts_approved_applicant', 'N5', 'Accounts approved', 'Applicant', APP, ['application_id'], 'Accounts approved – now with our Manager: {{application_id}}', [
    'Hello {{recipient_name}},',
    'Good news: our Accounts team has approved your application {{application_id}}.',
    'It is now with our Manager for final approval. We will email you again once a decision is made.',
  ]),
  def('awaiting_manager', 'N5', 'Application waiting for final approval', 'All Managers', APP, ['application_id'], 'Application waiting for final approval: {{application_id}}', [
    'Hello {{recipient_name}},',
    'Application {{application_id}} ({{firm_name}}) has been approved by Accounts and is waiting for your final approval.',
  ]),
  def('accounts_approved_admin', 'N5', 'Accounts approved (Admin copy)', 'Admin', APP, ['application_id'], 'Accounts approved: {{application_id}}', [
    'Hello {{recipient_name}},',
    'Application {{application_id}} ({{firm_name}}) has been approved by Accounts and is now with the Manager.',
  ]),
  def('correction_requested', 'N6 / N9', 'Correction requested (rejection)', 'Applicant', [...APP, 'reviewer', 'reason'], ['reason'], 'Correction requested: {{application_id}}', [
    'Hello {{recipient_name}},',
    'Our {{reviewer}} has reviewed your application {{application_id}} and asked for some changes:',
    '{{reason}}',
    'To resubmit: log in, open your dashboard, click "Edit & Resubmit", make the changes, tick the agreement checkbox again and press Resubmit.',
  ]),
  def('rejected_admin', 'N6 / N9', 'Rejected (Admin copy)', 'Admin', [...APP, 'stage', 'reason'], ['reason'], 'Rejected by {{stage}}: {{application_id}}', [
    'Hello {{recipient_name}},',
    'Application {{application_id}} ({{firm_name}}) was rejected by {{stage}}.',
    'Reason: {{reason}}',
  ]),
  def('resubmitted_applicant', 'N7 / N10', 'Resubmission confirmation', 'Applicant', [...APP, 'reviewer'], ['application_id'], 'Application resubmitted: {{application_id}}', [
    'Hello {{recipient_name}},',
    'Thank you. Your corrected application {{application_id}} has been resubmitted and is back with our {{reviewer}} for review.',
  ]),
  def('resubmitted_staff', 'N7 / N10', 'Application resubmitted', 'Reviewer(s) and Admin', [...APP, 'stage'], ['application_id'], 'Application resubmitted: {{application_id}}', [
    'Hello {{recipient_name}},',
    'Application {{application_id}} ({{firm_name}}) has been corrected and resubmitted. It is waiting for {{stage}} review.',
  ]),
  def('final_approval_applicant', 'N8', 'Application approved', 'Applicant', [...APP, 'agreement_reference_no'], ['application_id'], 'Application approved: {{application_id}}', [
    'Hello {{recipient_name}},',
    'Congratulations! Your franchise application {{application_id}} has received final approval.',
    'Your agreement has been generated with reference number {{agreement_reference_no}}. Our Manager will email it to you shortly.',
  ]),
  def('final_approval_admin', 'N8', 'Final approval + PDF generated', 'Admin', [...APP, 'agreement_reference_no'], ['application_id'], 'Final approval + PDF generated: {{application_id}}', [
    'Hello {{recipient_name}},',
    'Application {{application_id}} ({{firm_name}}) received final approval. Agreement reference: {{agreement_reference_no}}.',
    'The agreement PDF has been generated.',
  ]),
  def('final_approval_admin_pdf_pending', 'N8', 'Final approval (PDF not generated yet)', 'Admin', [...APP, 'agreement_reference_no'], ['application_id'], 'Final approval: {{application_id}}', [
    'Hello {{recipient_name}},',
    'Application {{application_id}} ({{firm_name}}) received final approval. Agreement reference: {{agreement_reference_no}}.',
    'The agreement PDF could not be generated yet; the Manager can retry it from Generated Agreements.',
  ]),
  def('agreement_email', 'N11', 'Agreement email (default wording in the Send dialog)', 'Applicant (sent by the Manager)', [...APP, 'agreement_reference_no'], ['agreement_reference_no'], 'Your Franchise Agreement – {{agreement_reference_no}}', [
    'Dear {{signatory_name}},',
    'Please find attached your franchise agreement (reference {{agreement_reference_no}}) with {{organisation_name}}.\nThis is a computer-generated digital agreement and does not require any physical or digital signature.',
    'Please keep it for your records.',
    'Regards,\n{{organisation_name}}',
  ]),
  def('pdf_generation_failed', 'N12', 'PDF generation failed', 'Managers and Admin', [...APP, 'agreement_reference_no'], ['agreement_reference_no'], 'Agreement PDF generation failed: {{agreement_reference_no}}', [
    'Hello {{recipient_name}},',
    'The approval of {{application_id}} stands, but its agreement PDF ({{agreement_reference_no}}) could not be generated.',
    'A Manager can use "Retry Generation" on the Generated Agreements screen.',
  ]),
  def('pending_reminder', 'N13', 'Pending reminder', 'Assigned Accounts user (or all), Managers', ['applications'], ['applications'], 'Reminder: applications are waiting for your review', [
    'Hello {{recipient_name}},',
    'These applications are still waiting for a decision:',
    '{{applications}}',
    'Please review them in the portal. This is an automatic reminder; it does not change anything in the application.',
  ]),
  def('overdue_escalation', 'N14', 'Overdue escalation', 'Admin', ['applications', 'escalation_days'], ['applications'], 'Overdue: applications have waited over {{escalation_days}} business days', [
    'Hello {{recipient_name}},',
    'These applications have been waiting for more than {{escalation_days}} business days:',
    '{{applications}}',
    'You can follow up or reassign Accounts reviews from Approval Tracking. This alert does not change anything in the application.',
  ]),
  def('user_invite', 'N15', 'Set your password (new user)', 'New Accounts / Manager / Admin user', ['role', 'valid_hours'], [], 'Set your password for the {{portal_name}}', [
    'Hello {{recipient_name}},',
    'An account has been created for you on the {{portal_name}} with the {{role}} role.',
    'Please set your password to get started. This link is valid for {{valid_hours}} hours and can be used once.',
  ]),
  def('password_reset', 'N15', 'Reset your password', 'Any user', ['valid_minutes'], [], 'Reset your {{portal_name}} password', [
    'Hello {{recipient_name}},',
    'We received a request to reset your password.',
    'This link is valid for {{valid_minutes}} minutes and can be used once. If you did not ask for this, you can ignore this email; your password will not change.',
  ]),
  def('contact_changed', 'Security', 'Login email or mobile changed', 'Franchise user (old address)', ['changed_item', 'new_value'], [], 'Your login {{changed_item}} was changed', [
    'Hello {{recipient_name}},',
    'The login {{changed_item}} on your franchise portal account was changed to {{new_value}}.',
    'If you did not make this change, please contact us immediately.',
  ]),
  def('duplicate_confirmed', 'Duplicates', 'Duplicate confirmed: please reject', 'Reviewer(s)', [...APP, 'note'], ['note'], 'Duplicate confirmed: please reject {{application_id}}', [
    'Hello {{recipient_name}},',
    'Admin has reviewed application {{application_id}} ({{firm_name}}) and confirmed it is a duplicate of another registration.',
    'Please reject the application, using this note as the reason: {{note}}',
    'Approve stays unavailable for this application.',
  ]),
  def('data_request_received', 'Privacy', 'Deletion request received', 'Applicant', [], [], 'We received your request to delete your account', [
    'Hello {{recipient_name}},',
    'We have received your request to delete your franchise portal account and erase your personal data.',
    'Our team will review it and reply by email, normally within 30 days. You can cancel the request from My Profile until it is processed.',
    'If you did not make this request, please log in and change your password, then cancel the request in My Profile.',
  ]),
  def('data_request_admin', 'Privacy', 'New data deletion request', 'Admin', ['applicant_name', 'application_id'], [], 'New data deletion request', [
    'Hello {{recipient_name}},',
    '{{applicant_name}} (application {{application_id}}) has asked for their account to be deleted and their personal data erased.',
    'Please review it in Data Deletion Requests. The law expects a reply without undue delay.',
  ]),
  def('data_request_declined', 'Privacy', 'Deletion request declined', 'Applicant', ['reason'], ['reason'], 'About your request to delete your account', [
    'Hello {{recipient_name}},',
    'We have reviewed your request to delete your account and erase your personal data, but we are unable to complete it at this time.',
    'Reason: {{reason}}',
    'If you disagree, you can reply to our Grievance Officer (details in our Privacy Policy). If you are still not satisfied, you may complain to the Data Protection Board of India.',
  ]),
  def('data_erased', 'Privacy', 'Account deleted', 'Former applicant', [], [], 'Your account has been deleted', [
    'Hello {{recipient_name}},',
    'As you requested, your franchise portal account has been closed and your application withdrawn. Your personal data and uploaded documents have been erased.',
    'We keep only a minimal record that you consented and later asked for erasure, as the law requires, and our security logs for the period stated in our Privacy Policy.',
    'This is the last email you will receive from the portal.',
  ]),
];

export const EMAIL_TEMPLATE_BY_KEY: Record<string, EmailTemplateDef> = Object.fromEntries(EMAIL_TEMPLATES.map((t) => [t.key, t]));

const FIELD_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Fills in {{fields}}; leaves out paragraphs that end up empty. Values are inserted as plain text. */
export function fillEmailTemplate(subject: string, body: string, values: Record<string, string>) {
  const fill = (text: string) => text.replace(FIELD_PATTERN, (_, k: string) => values[k] ?? '');
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => {
      const hadFields = FIELD_PATTERN.test(p);
      FIELD_PATTERN.lastIndex = 0;
      const filled = fill(p).trim();
      // A paragraph whose fields were all empty (e.g. "Note from Admin: " with no note) is dropped.
      const onlyLabelLeft = hadFields && [...p.matchAll(FIELD_PATTERN)].every((m) => !values[m[1]]);
      return onlyLabelLeft ? '' : filled;
    })
    .filter(Boolean);
  return { subject: fill(subject).replace(/\s+/g, ' ').trim(), paragraphs };
}

/** Problems with an edited template: unknown fields, or a required field removed. */
export function checkEmailTemplate(t: EmailTemplateDef, subject: string, body: string): { subject?: string; body?: string } {
  const errors: { subject?: string; body?: string } = {};
  const allowed = new Set(t.fields.map((f) => f.key));
  for (const [where, text] of [['subject', subject], ['body', body]] as const) {
    const unknown = [...text.matchAll(FIELD_PATTERN)].map((m) => m[1]).filter((k) => !allowed.has(k));
    if (unknown.length) errors[where] = `Unknown field${unknown.length > 1 ? 's' : ''}: ${[...new Set(unknown)].map((k) => `{{${k}}}`).join(', ')}`;
  }
  const used = new Set([...`${subject}\n${body}`.matchAll(FIELD_PATTERN)].map((m) => m[1]));
  const missing = t.required.filter((k) => !used.has(k));
  if (missing.length && !errors.body) errors.body = `Keep ${missing.map((k) => `{{${k}}}`).join(', ')} in this email`;
  return errors;
}

export const emailTemplateUpdateSchema = z.object({
  subject: z.string().trim().min(3, 'Enter a subject').max(200, 'The subject must be at most 200 characters'),
  body: z.string().trim().min(10, 'Enter the email text').max(5000, 'The text must be at most 5000 characters'),
});
export type EmailTemplateUpdate = z.infer<typeof emailTemplateUpdateSchema>;

export interface EmailTemplateView extends EmailTemplateDef {
  /** The default wording (to show what Reset brings back). */
  defaultSubject: string;
  defaultBody: string;
  customised: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface EmailPreview {
  subject: string;
  html: string;
}
