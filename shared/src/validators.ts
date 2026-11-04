// Field rules from PRD §10.2. Used by both the registration form and the API.

export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const GST_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const MOBILE_REGEX = /^[6-9][0-9]{9}$/;

export const isValidPan = (pan: string) => PAN_REGEX.test(pan);
export const isValidGst = (gst: string) => GST_REGEX.test(gst);
export const isValidMobile = (mobile: string) => MOBILE_REGEX.test(mobile);

/** Characters 3–12 of a GSTIN are the holder's PAN. */
export const gstMatchesPan = (gst: string, pan: string) => gst.slice(2, 12) === pan;

/** Password strength rules shown on the Set Password screen (PRD P4). */
export const PASSWORD_RULES = [
  { test: (p: string) => p.length >= 8, label: 'At least 8 characters' },
  { test: (p: string) => /[A-Z]/.test(p), label: 'An uppercase letter' },
  { test: (p: string) => /[a-z]/.test(p), label: 'A lowercase letter' },
  { test: (p: string) => /[0-9]/.test(p), label: 'A number' },
  { test: (p: string) => /[^A-Za-z0-9]/.test(p), label: 'A special character' },
] as const;

export const isStrongPassword = (p: string) => PASSWORD_RULES.every((r) => r.test(p));
