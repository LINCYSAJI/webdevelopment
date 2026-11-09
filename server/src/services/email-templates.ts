import { ROLE_LABELS, escapeHtml, type Role } from '@fap/shared';
import { getSettings } from '../models/Settings';

interface Rendered {
  subject: string;
  html: string;
  text: string;
}

/** Wraps email content in the organisation's branded layout. */
async function layout(subject: string, paragraphs: string[], action?: { label: string; url: string }): Promise<Rendered> {
  const s = await getSettings();
  const color = escapeHtml(s.primaryColor);
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px">${escapeHtml(p)}</p>`).join('');
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

export function inviteEmail(name: string, role: Role, url: string, validHours: number) {
  return layout(
    'Set your password for the Franchise Agreement Portal',
    [
      `Hello ${name},`,
      `An account has been created for you on the Franchise Agreement Portal with the ${ROLE_LABELS[role]} role.`,
      `Please set your password to get started. This link is valid for ${validHours} hours and can be used once.`,
    ],
    { label: 'Set my password', url },
  );
}

export function passwordResetEmail(name: string, url: string, validMinutes: number) {
  return layout(
    'Reset your Franchise Agreement Portal password',
    [
      `Hello ${name},`,
      'We received a request to reset your password.',
      `This link is valid for ${validMinutes} minutes and can be used once. If you did not ask for this, you can ignore this email; your password will not change.`,
    ],
    { label: 'Reset my password', url },
  );
}

// ---------- Registration and Franchise User emails (PRD §11) ----------

export function otpEmail(code: string, validMinutes: number, purpose: 'registration' | 'change_email') {
  return layout(`${code} is your verification code`, [
    purpose === 'registration'
      ? 'Use this code to verify your email address for your franchise registration:'
      : 'Use this code to confirm your new login email address:',
    code,
    `The code is valid for ${validMinutes} minutes. Do not share it with anyone. If you did not request it, you can ignore this email.`,
  ]);
}

/** N2 to the applicant. */
export function applicationSubmittedEmail(name: string, applicationId: string, firmName: string, url: string) {
  return layout(
    `Application submitted: ${applicationId}`,
    [
      `Hello ${name},`,
      `Thank you. Your franchise application for ${firmName} has been submitted successfully.`,
      `Your Application ID is ${applicationId}. Our Accounts team will now review it, and we will email you at each stage.`,
    ],
    { label: 'View my application', url },
  );
}

/** N2 to Accounts users. */
export function newApplicationForAccountsEmail(name: string, applicationId: string, firmName: string, url: string) {
  return layout(
    `New application waiting for verification: ${applicationId}`,
    [`Hello ${name},`, `A new franchise application (${applicationId}, ${firmName}) is waiting for verification in the Accounts queue.`],
    { label: 'Open the portal', url },
  );
}

/** N2 to Admin. */
export function newRegistrationAdminEmail(name: string, applicationId: string, firmName: string, url: string) {
  return layout(
    `New registration: ${applicationId}`,
    [`Hello ${name},`, `A new franchise registration (${applicationId}, ${firmName}) has been submitted and is with the Accounts team.`],
    { label: 'Open the portal', url },
  );
}

/** N3 to Admin. */
export function duplicateFlagEmail(name: string, applicationId: string, firmName: string, fields: string[], url: string) {
  return layout(
    `Possible duplicate needs review: ${applicationId}`,
    [
      `Hello ${name},`,
      `Application ${applicationId} (${firmName}) uses details already linked to another registration: ${fields.join(', ')}.`,
      'Accounts cannot approve it until you review the flag in Duplicate Review.',
    ],
    { label: 'Open the portal', url },
  );
}

/** Security notice to the old address when a login email or mobile changes. */
export function contactChangedEmail(name: string, what: 'email address' | 'mobile number', newValue: string) {
  return layout(`Your login ${what} was changed`, [
    `Hello ${name},`,
    `The login ${what} on your franchise portal account was changed to ${newValue}.`,
    'If you did not make this change, please contact us immediately.',
  ]);
}

// ---------- Review workflow emails (PRD §11, N4–N7, N10) ----------

/** N4: an application was reassigned to this Accounts user. */
export function applicationAssignedEmail(name: string, applicationId: string, firmName: string, note: string, url: string) {
  return layout(
    `Application assigned to you: ${applicationId}`,
    [`Hello ${name},`, `Application ${applicationId} (${firmName}) has been assigned to you for Accounts review.`, ...(note ? [`Note from Admin: ${note}`] : [])],
    { label: 'Open the application', url },
  );
}

/** N5 to the applicant. */
export function accountsApprovedApplicantEmail(name: string, applicationId: string, url: string) {
  return layout(
    `Accounts approved – now with our Manager: ${applicationId}`,
    [`Hello ${name},`, `Good news: our Accounts team has approved your application ${applicationId}.`, 'It is now with our Manager for final approval. We will email you again once a decision is made.'],
    { label: 'View my application', url },
  );
}

/** N5 to Managers and Admin. */
export function awaitingManagerEmail(name: string, applicationId: string, firmName: string, url: string, forAdmin: boolean) {
  return layout(
    forAdmin ? `Accounts approved: ${applicationId}` : `Application waiting for final approval: ${applicationId}`,
    [`Hello ${name},`, `Application ${applicationId} (${firmName}) has been approved by Accounts and is ${forAdmin ? 'now with the Manager' : 'waiting for your final approval'}.`],
    { label: 'Open the portal', url },
  );
}

/** N6 / N9 to the applicant: the rejection reason plus how to resubmit. */
export function correctionRequestedEmail(name: string, applicationId: string, stage: 'Accounts' | 'Manager', reason: string, url: string) {
  return layout(
    `Correction requested: ${applicationId}`,
    [
      `Hello ${name},`,
      `Our ${stage === 'Accounts' ? 'Accounts team' : 'Manager'} has reviewed your application ${applicationId} and asked for some changes:`,
      reason,
      'To resubmit: log in, open your dashboard, click "Edit & Resubmit", make the changes, tick the agreement checkbox again and press Resubmit.',
    ],
    { label: 'Edit & Resubmit', url },
  );
}

/** N6 / N9 to Admin. */
export function rejectedAdminEmail(name: string, applicationId: string, firmName: string, stage: 'Accounts' | 'Manager', reason: string, url: string) {
  return layout(`Rejected by ${stage}: ${applicationId}`, [`Hello ${name},`, `Application ${applicationId} (${firmName}) was rejected by ${stage}.`, `Reason: ${reason}`], {
    label: 'Open the portal',
    url,
  });
}

/** N7 / N10 confirmation to the applicant. */
export function resubmittedApplicantEmail(name: string, applicationId: string, stage: 'Accounts' | 'Manager', url: string) {
  return layout(
    `Application resubmitted: ${applicationId}`,
    [`Hello ${name},`, `Thank you. Your corrected application ${applicationId} has been resubmitted and is back with our ${stage === 'Accounts' ? 'Accounts team' : 'Manager'} for review.`],
    { label: 'View my application', url },
  );
}

/** N7 / N10 to reviewers and Admin. */
export function resubmittedStaffEmail(name: string, applicationId: string, firmName: string, stage: 'Accounts' | 'Manager', url: string) {
  return layout(
    `Application resubmitted: ${applicationId}`,
    [`Hello ${name},`, `Application ${applicationId} (${firmName}) has been corrected and resubmitted. It is waiting for ${stage} review.`],
    { label: 'Open the portal', url },
  );
}

// ---------- Manager decision and agreement emails (PRD §11, N8, N11, N12) ----------

/** N8 to the applicant. */
export function finalApprovalApplicantEmail(name: string, applicationId: string, referenceNumber: string, url: string) {
  return layout(
    `Application approved: ${applicationId}`,
    [
      `Hello ${name},`,
      `Congratulations! Your franchise application ${applicationId} has received final approval.`,
      `Your agreement has been generated with reference number ${referenceNumber}. Our Manager will email it to you shortly.`,
    ],
    { label: 'View my application', url },
  );
}

/** N8 to Admin. */
export function finalApprovalAdminEmail(name: string, applicationId: string, firmName: string, referenceNumber: string, pdfReady: boolean, url: string) {
  return layout(
    `Final approval${pdfReady ? ' + PDF generated' : ''}: ${applicationId}`,
    [
      `Hello ${name},`,
      `Application ${applicationId} (${firmName}) received final approval. Agreement reference: ${referenceNumber}.`,
      pdfReady ? 'The agreement PDF has been generated.' : 'The agreement PDF could not be generated yet; the Manager can retry it from Generated Agreements.',
    ],
    { label: 'Open the portal', url },
  );
}

/** N12 to Managers and Admin. */
export function pdfGenerationFailedEmail(name: string, applicationId: string, referenceNumber: string, url: string) {
  return layout(
    `Agreement PDF generation failed: ${referenceNumber}`,
    [
      `Hello ${name},`,
      `The approval of ${applicationId} stands, but its agreement PDF (${referenceNumber}) could not be generated.`,
      'A Manager can use "Retry Generation" on the Generated Agreements screen.',
    ],
    { label: 'Open Generated Agreements', url },
  );
}

/** Default wording for the "Send to Franchisee" dialog (N11); the Manager can edit it before sending. */
export function defaultAgreementEmailText(name: string, referenceNumber: string, organisationName: string) {
  return {
    subject: `Your Franchise Agreement – ${referenceNumber}`,
    message: [
      `Dear ${name},`,
      '',
      `Please find attached your franchise agreement (reference ${referenceNumber}) with ${organisationName}.`,
      'This is a computer-generated digital agreement and does not require any physical or digital signature.',
      '',
      'Please keep it for your records.',
      '',
      'Regards,',
      organisationName,
    ].join('\n'),
  };
}

/** N11: the Manager's message, in the branded layout, with the PDF attached. */
export function agreementEmail(subject: string, message: string) {
  return layout(subject, message.split(/\n{2,}/).map((p) => p.replace(/\n/g, ' ').trim()).filter(Boolean));
}

// ---------- Delete my account / data deletion (DPDP Act s.12) ----------

/** To the applicant: we received their request. */
export function dataRequestReceivedEmail(name: string) {
  return layout('We received your request to delete your account', [
    `Hello ${name},`,
    'We have received your request to delete your franchise portal account and erase your personal data.',
    'Our team will review it and reply by email, normally within 30 days. You can cancel the request from My Profile until it is processed.',
    'If you did not make this request, please log in and change your password, then cancel the request in My Profile.',
  ]);
}

/** To each Admin: a request is waiting. */
export function dataRequestAdminEmail(name: string, applicantName: string, applicationId: string | null, url: string) {
  return layout(
    'New data deletion request',
    [
      `Hello ${name},`,
      `${applicantName}${applicationId ? ` (application ${applicationId})` : ''} has asked for their account to be deleted and their personal data erased.`,
      'Please review it in Data Deletion Requests. The law expects a reply without undue delay.',
    ],
    { label: 'Open Data Deletion Requests', url },
  );
}

/** To the applicant: the request was declined, with the reason. */
export function dataRequestDeclinedEmail(name: string, note: string) {
  return layout('About your request to delete your account', [
    `Hello ${name},`,
    'We have reviewed your request to delete your account and erase your personal data, but we are unable to complete it at this time.',
    `Reason: ${note}`,
    'If you disagree, you can reply to our Grievance Officer (details in our Privacy Policy). If you are still not satisfied, you may complain to the Data Protection Board of India.',
  ]);
}

/** To the applicant's former email: the erasure is complete. */
export function dataErasedEmail(name: string) {
  return layout('Your account has been deleted', [
    `Hello ${name},`,
    'As you requested, your franchise portal account has been closed and your application withdrawn. Your personal data and uploaded documents have been erased.',
    'We keep only a minimal record that you consented and later asked for erasure, as the law requires, and our security logs for the period stated in our Privacy Policy.',
    'This is the last email you will receive from the portal.',
  ]);
}

// ---------- Duplicate Review (PRD AD3) ----------

/** To the reviewer(s): Admin confirmed a duplicate, so the application should be rejected with this note. */
export function duplicateConfirmedEmail(name: string, applicationId: string, firmName: string, note: string, url: string) {
  return layout(
    `Duplicate confirmed: please reject ${applicationId}`,
    [
      `Hello ${name},`,
      `Admin has reviewed application ${applicationId} (${firmName}) and confirmed it is a duplicate of another registration.`,
      `Please reject the application, using this note as the reason: ${note}`,
      'Approve stays unavailable for this application.',
    ],
    { label: 'Open the application', url },
  );
}

/** One application in a reminder or escalation email. */
export interface ReminderLine {
  applicationId: string;
  firmName: string;
  stage: 'pending_accounts' | 'pending_manager';
  businessDaysWaiting: number;
}

const stageName = (stage: ReminderLine['stage']) => (stage === 'pending_accounts' ? 'Pending Accounts' : 'Pending Manager');
const reminderLines = (lines: ReminderLine[]) =>
  lines.map((l) => `• ${l.applicationId} (${l.firmName}): ${stageName(l.stage)}, waiting ${l.businessDaysWaiting} business day${l.businessDaysWaiting === 1 ? '' : 's'}`);

/** N13 to Accounts / Manager users: applications waiting for them longer than the reminder period. */
export function pendingReminderEmail(name: string, lines: ReminderLine[], url: string) {
  const one = lines.length === 1;
  return layout(
    one ? `Reminder: ${lines[0].applicationId} is waiting for your review` : `Reminder: ${lines.length} applications are waiting for your review`,
    [
      `Hello ${name},`,
      one ? 'This application is still waiting for a decision:' : 'These applications are still waiting for a decision:',
      ...reminderLines(lines),
      'Please review them in the portal. This is an automatic reminder; it does not change anything in the application.',
    ],
    { label: 'Open the portal', url },
  );
}

/** N14 to Admin: applications waiting longer than the escalation period. */
export function escalationEmail(name: string, lines: ReminderLine[], escalationAfterDays: number, url: string) {
  const one = lines.length === 1;
  return layout(
    one ? `Overdue: ${lines[0].applicationId} has waited over ${escalationAfterDays} business days` : `Overdue: ${lines.length} applications have waited over ${escalationAfterDays} business days`,
    [
      `Hello ${name},`,
      `${one ? 'This application has' : 'These applications have'} been waiting for more than ${escalationAfterDays} business days:`,
      ...reminderLines(lines),
      'You can follow up or reassign Accounts reviews from Approval Tracking. This alert does not change anything in the application.',
    ],
    { label: 'Open Approval Tracking', url },
  );
}
