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
