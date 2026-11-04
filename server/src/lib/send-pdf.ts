import type { Response } from 'express';
import type { Readable } from 'node:stream';

/** Streams a stored PDF to the browser, either shown in the page or as a download. */
export function sendPdf(res: Response, file: { stream: Readable; size: number; fileName: string }, download: boolean) {
  const asciiName = file.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', String(file.size));
  res.setHeader(
    'Content-Disposition',
    `${download ? 'attachment' : 'inline'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
  );
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  file.stream.on('error', () => res.destroy());
  file.stream.pipe(res);
}
