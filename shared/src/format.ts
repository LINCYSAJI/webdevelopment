// Dates are stored in UTC and always shown in IST as DD-MM-YYYY (PRD §15).

const IST = 'Asia/Kolkata';

function parts(value: Date | string, withTime: boolean) {
  const date = typeof value === 'string' ? new Date(value) : value;
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  });
  return Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
}

export function formatDateIST(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const p = parts(value, false);
  return `${p.day}-${p.month}-${p.year}`;
}

export function formatDateTimeIST(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const p = parts(value, true);
  return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute} IST`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
