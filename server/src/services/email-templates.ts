import { EMAIL_TEMPLATE_BY_KEY, ROLE_LABELS, escapeHtml, fillEmailTemplate, type Role } from '@fap/shared';
import { EmailTemplate } from '../models/EmailTemplate';
import { getSettings } from '../models/Settings';

// Every email the portal sends (PRD §11). The wording comes from the editable templates
// (Admin › Email Templates); without an edit, the default wording in @fap/shared is used.
// The branded layout, the button and its link are always added here and cannot be edited.

export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

type Action = { label: string; url: string };

/** Wraps paragraphs in the organisation's branded layout. A line break inside a paragraph is kept. */
export async function layout(subject: string, paragraphs: string[], action?: Action): Promise<Rendered> {
  const s = await getSettings();
  const color = escapeHtml(s.primaryColor);
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
  const button = action
    ? `<p style="margin:22px 0"><a href="${escapeHtml(action.url)}" style="background:${color};color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block">${escapeHtml(action.label)}</a></p>
       <p style="margin:0 0 14px;font-size:12px;color:#64748b">If the button does not work, copy this link into your browser:<br>${escapeHtml(action.url)}</p>`
    : '';
  const support = s.supportEmail ? `Need help? Contact ${escapeHtml(s.supportEmail)}.` : '';

  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#1e293b">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:${color};color:#fff;padding:16px 20px;border-radius:8px 8px 0 0;font-weight:700">${escapeHtml(s.organisationName)} · ${escapeHtml(s.portalName)}</div>
    <div style="background:#fff;padding:24px 20px;border-radius:0 0 8px 8px;font-size:15px;line-height:1.5">${body}${button}</div>
    <p style="font-size:12px;color:#64748b;text-align:center;margin-top:16px">${support}</p>
  </div></body></html>`;

  const text = [...paragraphs, action ? `${action.label}: ${action.url}` : '', support].filter(Boolean).join('\n\n');
  return { subject, html, text };
}

/** The wording to use for a template: Admin's edit if there is one, otherwise the default. */
export async function templateWording(key: string): Promise<{ subject: string; body: string }> {
  const def = EMAIL_TEMPLATE_BY_KEY[key];
  if (!def) throw new Error(`Unknown email template: ${key}`);
  const custom = await EmailTemplate.findById(key);
  return custom ? { subject: custom.subject, body: custom.body } : { subject: def.subject, body: def.body };
}

/** Fills a template with values (plus the organisation and portal names) and lays it out. */
export async function renderTemplate(key: string, values: Record<string, string | null | undefined>, action?: Action, wording?: { subject: string; body: string }): Promise<Rendered> {
  const [{ subject, body }, s] = await Promise.all([wording ?? templateWording(key), getSettings()]);
  const all: Record<string, string> = { organisation_name: s.organisationName, portal_name: s.portalName };
  for (const [k, v] of Object.entries(values)) all[k] = v ?? '';
  const filled = fillEmailTemplate(subject, body, all);
  return layout(filled.subject, filled.paragraphs, action);
}

const open = (url: string): Action => ({ label: 'Open the portal', url });
const mine = (url: string): Action => ({ label: 'View my application', url });

// ---------- Users (N15) ----------

export function inviteEmail(name: string, role: Role, url: string, validHours: number) {
  return renderTemplate('user_invite', { recipient_name: name, role: ROLE_LABELS[role], valid_hours: String(validHours) }, { label: 'Set my password', url });
}

export function passwordResetEmail(name: string, url: string, validMinutes: number) {
  return renderTemplate('password_reset', { recipient_name: name, valid_minutes: String(validMinutes) }, { label: 'Reset my password', url });
}

// ---------- Registration and Franchise User emails (N1–N3) ----------

export function otpEmail(code: string, validMinutes: number, purpose: 'registration' | 'change_email') {
  return renderTemplate(purpose === 'registration' ? 'otp_registration' : 'otp_change_email', { code, valid_minutes: String(validMinutes) });
}

const app = (name: string, applicationId: string, firmName: string) => ({ recipient_name: name, application_id: applicationId, firm_name: firmName });

/** N2 to the applicant. */
export function applicationSubmittedEmail(name: string, applicationId: string, firmName: string, url: string) {
  return renderTemplate('application_submitted', { ...app(name, applicationId, firmName), signatory_name: name }, mine(url));
}

/** N2 to Accounts users. */
export function newApplicationForAccountsEmail(name: string, applicationId: string, firmName: string, url: string) {
  return renderTemplate('new_application_accounts', app(name, applicationId, firmName), open(url));
}

/** N2 to Admin. */
export function newRegistrationAdminEmail(name: string, applicationId: string, firmName: string, url: string) {
  return renderTemplate('new_registration_admin', app(name, applicationId, firmName), open(url));
}

/** N3 to Admin. */
export function duplicateFlagEmail(name: string, applicationId: string, firmName: string, fields: string[], url: string) {
  return renderTemplate('duplicate_flag', { ...app(name, applicationId, firmName), matched_fields: fields.join(', ') }, open(url));
}

/** Security notice to the old address when a login email or mobile changes. */
export function contactChangedEmail(name: string, what: 'email address' | 'mobile number', newValue: string) {
  return renderTemplate('contact_changed', { recipient_name: name, changed_item: what, new_value: newValue });
}

// ---------- Review workflow emails (N4–N7, N10) ----------

/** N4: an application was reassigned to this Accounts user. */
export function applicationAssignedEmail(name: string, applicationId: string, firmName: string, note: string, url: string) {
  return renderTemplate('application_assigned', { ...app(name, applicationId, firmName), admin_note: note }, { label: 'Open the application', url });
}

/** N5 to the applicant. */
export function accountsApprovedApplicantEmail(name: string, applicationId: string, url: string) {
  return renderTemplate('accounts_approved_applicant', { recipient_name: name, signatory_name: name, application_id: applicationId }, mine(url));
}

/** N5 to Managers and Admin. */
export function awaitingManagerEmail(name: string, applicationId: string, firmName: string, url: string, forAdmin: boolean) {
  return renderTemplate(forAdmin ? 'accounts_approved_admin' : 'awaiting_manager', app(name, applicationId, firmName), open(url));
}

const reviewer = (stage: 'Accounts' | 'Manager') => (stage === 'Accounts' ? 'Accounts team' : 'Manager');

/** N6 / N9 to the applicant: the rejection reason plus how to resubmit. */
export function correctionRequestedEmail(name: string, applicationId: string, stage: 'Accounts' | 'Manager', reason: string, url: string) {
  return renderTemplate(
    'correction_requested',
    { recipient_name: name, signatory_name: name, application_id: applicationId, reviewer: reviewer(stage), stage, reason },
    { label: 'Edit & Resubmit', url },
  );
}

/** N6 / N9 to Admin. */
export function rejectedAdminEmail(name: string, applicationId: string, firmName: string, stage: 'Accounts' | 'Manager', reason: string, url: string) {
  return renderTemplate('rejected_admin', { ...app(name, applicationId, firmName), stage, reason }, open(url));
}

/** N7 / N10 confirmation to the applicant. */
export function resubmittedApplicantEmail(name: string, applicationId: string, stage: 'Accounts' | 'Manager', url: string) {
  return renderTemplate('resubmitted_applicant', { recipient_name: name, signatory_name: name, application_id: applicationId, reviewer: reviewer(stage), stage }, mine(url));
}

/** N7 / N10 to reviewers and Admin. */
export function resubmittedStaffEmail(name: string, applicationId: string, firmName: string, stage: 'Accounts' | 'Manager', url: string) {
  return renderTemplate('resubmitted_staff', { ...app(name, applicationId, firmName), stage }, open(url));
}

// ---------- Manager decision and agreement emails (N8, N11, N12) ----------

/** N8 to the applicant. */
export function finalApprovalApplicantEmail(name: string, applicationId: string, referenceNumber: string, url: string) {
  return renderTemplate('final_approval_applicant', { recipient_name: name, signatory_name: name, application_id: applicationId, agreement_reference_no: referenceNumber }, mine(url));
}

/** N8 to Admin. */
export function finalApprovalAdminEmail(name: string, applicationId: string, firmName: string, referenceNumber: string, pdfReady: boolean, url: string) {
  return renderTemplate(pdfReady ? 'final_approval_admin' : 'final_approval_admin_pdf_pending', { ...app(name, applicationId, firmName), agreement_reference_no: referenceNumber }, open(url));
}

/** N12 to Managers and Admin. */
export function pdfGenerationFailedEmail(name: string, applicationId: string, referenceNumber: string, url: string) {
  return renderTemplate('pdf_generation_failed', { recipient_name: name, application_id: applicationId, agreement_reference_no: referenceNumber }, { label: 'Open Generated Agreements', url });
}

/** Default wording for the "Send to Franchisee" dialog (N11); the Manager can edit it before sending. */
export async function defaultAgreementEmailText(name: string, referenceNumber: string, organisationName: string, applicationId = '', firmName = '') {
  const { subject, body } = await templateWording('agreement_email');
  const filled = fillEmailTemplate(subject, body, {
    recipient_name: name,
    signatory_name: name,
    agreement_reference_no: referenceNumber,
    organisation_name: organisationName,
    application_id: applicationId,
    firm_name: firmName,
  });
  return { subject: filled.subject, message: filled.paragraphs.join('\n\n') };
}

/** N11: the Manager's message, in the branded layout, with the PDF attached. */
export function agreementEmail(subject: string, message: string) {
  return layout(subject, message.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean));
}

// ---------- Delete my account / data deletion (DPDP Act s.12) ----------

export function dataRequestReceivedEmail(name: string) {
  return renderTemplate('data_request_received', { recipient_name: name });
}

export function dataRequestAdminEmail(name: string, applicantName: string, applicationId: string | null, url: string) {
  return renderTemplate(
    'data_request_admin',
    { recipient_name: name, applicant_name: applicantName, application_id: applicationId ?? 'not yet issued' },
    { label: 'Open Data Deletion Requests', url },
  );
}

export function dataRequestDeclinedEmail(name: string, note: string) {
  return renderTemplate('data_request_declined', { recipient_name: name, reason: note });
}

export function dataErasedEmail(name: string) {
  return renderTemplate('data_erased', { recipient_name: name });
}

// ---------- Duplicate Review (PRD AD3) ----------

export function duplicateConfirmedEmail(name: string, applicationId: string, firmName: string, note: string, url: string) {
  return renderTemplate('duplicate_confirmed', { ...app(name, applicationId, firmName), note }, { label: 'Open the application', url });
}

// ---------- Reminders (N13, N14) ----------

/** One application in a reminder or escalation email. */
export interface ReminderLine {
  applicationId: string;
  firmName: string;
  stage: 'pending_accounts' | 'pending_manager';
  businessDaysWaiting: number;
}

const stageName = (stage: ReminderLine['stage']) => (stage === 'pending_accounts' ? 'Pending Accounts' : 'Pending Manager');
const reminderList = (lines: ReminderLine[]) =>
  lines
    .map((l) => `• ${l.applicationId} (${l.firmName}): ${stageName(l.stage)}, waiting ${l.businessDaysWaiting} business day${l.businessDaysWaiting === 1 ? '' : 's'}`)
    .join('\n');

/** N13 to Accounts / Manager users: applications waiting for them longer than the reminder period. */
export function pendingReminderEmail(name: string, lines: ReminderLine[], url: string) {
  return renderTemplate('pending_reminder', { recipient_name: name, applications: reminderList(lines) }, open(url));
}

/** N14 to Admin: applications waiting longer than the escalation period. */
export function escalationEmail(name: string, lines: ReminderLine[], escalationAfterDays: number, url: string) {
  return renderTemplate('overdue_escalation', { recipient_name: name, applications: reminderList(lines), escalation_days: String(escalationAfterDays) }, { label: 'Open Approval Tracking', url });
}
