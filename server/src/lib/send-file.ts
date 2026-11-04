import type { Response } from 'express';
import type { Readable } from 'node:stream';

export interface StoredFile {
  stream: Readable;
  size: number;
  fileName: string;
  mimeType: string;
}

/**
 * Streams a private file to the browser after the caller has checked permissions, either shown
 * in the page or (download = true) saved as a file. Never cached by the browser or proxies.
 */
export function sendFile(res: Response, file: StoredFile, download = false) {
  const asciiName = file.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  res.setHeader('Content-Type', file.mimeType);
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
