import type { Response } from 'express';

/**
 * CSV that opens cleanly in Excel: UTF-8 with a byte-order mark, CRLF line ends, every cell quoted.
 * Cells that start with = + - @ (or a tab / carriage return) are prefixed with an apostrophe so a
 * spreadsheet never runs them as formulas ("CSV injection").
 */
export function toCsv(header: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const cell = (v: string | number | boolean | null | undefined) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function sendCsv(res: Response, fileName: string, csv: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/[^\w.-]/g, '_')}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(csv);
}
