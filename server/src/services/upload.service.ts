import { createHash, randomBytes } from 'node:crypto';
import {
  UPLOAD_MIME_TYPES,
  UPLOAD_TYPE_LABELS,
  uploadLimitMB,
  type UploadKind,
  type UploadedFileView,
} from '@fap/shared';
import { AppError } from '../lib/errors';
import { cleanFileName, sniffMimeType } from '../lib/files';
import { storage } from '../lib/storage';
import { getSettings } from '../models/Settings';
import { PendingUpload } from '../models/PendingUpload';

const UNCLAIMED_UPLOAD_HOURS = 24;

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' };

export const hashUploadToken = (token: string) => createHash('sha256').update(token).digest('hex');

const formatMB = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** Stores one file chosen on the registration page and returns a one-time token for it. */
export async function createUpload(kind: UploadKind, data: Buffer, rawFileName: string | undefined, ip?: string): Promise<UploadedFileView> {
  const settings = await getSettings();
  const limitMB = uploadLimitMB(kind, settings);
  if (!data.length) throw new AppError(400, 'The file is empty. Please choose another file.', 'empty');
  if (data.length > limitMB * 1024 * 1024) {
    throw new AppError(413, `This file is ${formatMB(data.length)}. The limit is ${limitMB} MB.`, 'too_large');
  }
  const mimeType = sniffMimeType(data);
  if (!mimeType || !UPLOAD_MIME_TYPES[kind].includes(mimeType)) {
    throw new AppError(400, `Only ${UPLOAD_TYPE_LABELS[kind]} files are allowed.`, 'wrong_type');
  }

  const ext = EXTENSIONS[mimeType];
  const month = new Date().toISOString().slice(0, 7);
  const storageKey = `registrations/${month}/${Date.now()}-${randomBytes(12).toString('hex')}.${ext}`;
  await storage.put(storageKey, data);

  const token = randomBytes(24).toString('hex');
  const fileName = cleanFileName(rawFileName, `upload.${ext}`);
  await PendingUpload.create({
    tokenHash: hashUploadToken(token),
    kind,
    storageKey,
    fileName,
    mimeType,
    size: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
    ip,
    expiresAt: new Date(Date.now() + UNCLAIMED_UPLOAD_HOURS * 3600_000),
  });
  return { token, kind, fileName, size: data.length, mimeType };
}
