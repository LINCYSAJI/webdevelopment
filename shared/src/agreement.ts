import { escapeHtml } from './format';

// Merge fields Admin can insert into the agreement text (PRD §10.4).
export const MERGE_FIELDS = [
  { key: 'firm_name', label: 'Firm Name', sample: 'Sunrise Retail Pvt Ltd' },
  { key: 'firm_type', label: 'Firm Type', sample: 'Private Limited Company' },
  { key: 'franchise_model', label: 'Franchise Model', sample: 'Express Store' },
  { key: 'pan_number', label: 'PAN Number', sample: 'ABCDE1234F' },
  { key: 'gst_number', label: 'GST Number', sample: '29ABCDE1234F1Z5' },
  { key: 'signatory_name', label: 'Signatory Name', sample: 'Priya Sharma' },
  { key: 'signatory_capacity', label: 'Signatory Capacity', sample: 'Director' },
  { key: 'signatory_email', label: 'Signatory Email', sample: 'priya@sunriseretail.in' },
  { key: 'signatory_mobile', label: 'Signatory Mobile', sample: '9876543210' },
  { key: 'acceptance_date', label: 'Acceptance Date', sample: '04-11-2026' },
  { key: 'agreement_reference_no', label: 'Agreement Reference No.', sample: 'FRN/2026/0001' },
  { key: 'approval_date', label: 'Approval Date', sample: '10-11-2026' },
  { key: 'organisation_name', label: 'Organisation Name', sample: 'Your Organisation' },
] as const;

export type MergeFieldKey = (typeof MERGE_FIELDS)[number]['key'];
export type MergeValues = Partial<Record<MergeFieldKey, string | null | undefined>>;

const LABELS = Object.fromEntries(MERGE_FIELDS.map((f) => [f.key, f.label])) as Record<MergeFieldKey, string>;

export const SAMPLE_MERGE_VALUES = Object.fromEntries(
  MERGE_FIELDS.map((f) => [f.key, f.sample]),
) as Record<MergeFieldKey, string>;

const MERGE_TOKEN = /\{\{\s*([a-z_]+)\s*\}\}/g;

/**
 * Fills merge fields in sanitised agreement HTML. Values are HTML-escaped.
 * Missing values become a highlighted "[Firm Name]" placeholder.
 */
export function renderAgreement(html: string, values: MergeValues): string {
  return html.replace(MERGE_TOKEN, (token, key: string) => {
    if (!(key in LABELS)) return token;
    const value = values[key as MergeFieldKey];
    if (value && value.trim()) return escapeHtml(value.trim());
    return `<mark class="merge-missing">[${escapeHtml(LABELS[key as MergeFieldKey])}]</mark>`;
  });
}

/** Merge tokens used in the text that are not on the allowed list. */
export function unknownMergeFields(html: string): string[] {
  const unknown = new Set<string>();
  for (const [, key] of html.matchAll(MERGE_TOKEN)) {
    if (!(key in LABELS)) unknown.add(key);
  }
  return [...unknown];
}
