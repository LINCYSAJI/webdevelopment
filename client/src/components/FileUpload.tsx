import { useId, useRef, useState, type ChangeEvent } from 'react';
import {
  UPLOAD_MIME_TYPES,
  UPLOAD_TYPE_LABELS,
  uploadLimitMB,
  type UploadKind,
  type UploadLimits,
  type UploadedFileView,
} from '@fap/shared';
import { ApiError } from '../api/client';
import { uploadRegistrationFile } from '../api/public';

/** An uploaded file plus a local preview (images only). */
export interface PickedFile extends UploadedFileView {
  previewUrl: string | null;
}

const ACCEPT: Record<UploadKind, string> = {
  document: 'image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf',
  photo: 'image/jpeg,image/png,.jpg,.jpeg,.png',
  rental: 'image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf',
};

const EXTENSION_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf' };

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

interface FileUploadProps {
  label: string;
  kind: UploadKind;
  limits: UploadLimits;
  value: PickedFile | null;
  onChange: (file: PickedFile | null) => void;
  required?: boolean;
  /** Validation message from the form. */
  error?: string;
  disabled?: boolean;
  /** Field path, used to scroll to the first error. */
  name?: string;
  /** Where the file is sent; defaults to the public registration upload. */
  upload?: (kind: UploadKind, file: File) => Promise<UploadedFileView>;
}

/** Uploads a file as soon as it is chosen, then shows a preview with Replace / Remove. */
export function FileUpload({ label, kind, limits, value, onChange, required, error, disabled, name, upload = uploadRegistrationFile }: FileUploadProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const limitMB = uploadLimitMB(kind, limits);
  const shownError = localError ?? error;

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLocalError(null);

    // Quick checks in the browser; the server checks the real file content again.
    const type = file.type || EXTENSION_TYPES[file.name.split('.').pop()?.toLowerCase() ?? ''] || '';
    if (!UPLOAD_MIME_TYPES[kind].includes(type)) {
      setLocalError(`Only ${UPLOAD_TYPE_LABELS[kind]} files are allowed.`);
      return;
    }
    if (file.size > limitMB * 1024 * 1024) {
      setLocalError(`This file is ${formatSize(file.size)}. The limit is ${limitMB} MB.`);
      return;
    }

    setUploading(true);
    try {
      const uploaded = await upload(kind, file);
      const previewUrl = uploaded.mimeType.startsWith('image/') ? URL.createObjectURL(file) : null;
      onChange({ ...uploaded, previewUrl });
    } catch (err) {
      setLocalError(err instanceof ApiError ? err.message : 'The upload failed. Please check your connection and try again.');
    } finally {
      setUploading(false);
    }
  };

  const describedBy = shownError ? `${id}-error` : `${id}-hint`;

  return (
    <div data-field={name}>
      <span id={`${id}-label`} className="label">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </span>
      <input
        ref={input}
        id={id}
        type="file"
        accept={ACCEPT[kind]}
        className="sr-only"
        onChange={handleFile}
        disabled={disabled || uploading}
        aria-labelledby={`${id}-label`}
        aria-describedby={describedBy}
        aria-invalid={!!shownError}
      />
      <div
        className={`flex flex-col gap-3 rounded-md border border-dashed p-3 sm:flex-row sm:items-center ${
          shownError ? 'border-red-400 bg-red-50/40' : 'border-slate-300 bg-white'
        }`}
      >
        {value ? (
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {value.previewUrl ? (
              <img src={value.previewUrl} alt="" className="h-12 w-12 shrink-0 rounded border border-slate-200 object-cover" />
            ) : (
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded border border-slate-200 bg-red-50 text-xs font-bold text-red-700">
                {value.mimeType === 'application/pdf' ? 'PDF' : 'FILE'}
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-800" title={value.fileName}>
                {value.fileName}
              </p>
              <p className="text-xs text-green-700">✓ Uploaded · {formatSize(value.size)}</p>
            </div>
          </div>
        ) : (
          <p className="flex-1 text-sm text-slate-500">{uploading ? 'Uploading…' : 'No file chosen'}</p>
        )}
        {!disabled && (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              onClick={() => input.current?.click()}
              disabled={uploading}
            >
              {uploading ? 'Uploading…' : value ? 'Replace' : 'Choose file'}
            </button>
            {value && (
              <button
                type="button"
                className="rounded-md px-2 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
                onClick={() => {
                  setLocalError(null);
                  onChange(null);
                }}
              >
                Remove
              </button>
            )}
          </div>
        )}
      </div>
      {shownError ? (
        <p id={`${id}-error`} className="mt-1 text-xs text-red-700">
          {shownError}
        </p>
      ) : (
        <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">
          {UPLOAD_TYPE_LABELS[kind]}, up to {limitMB} MB
        </p>
      )}
    </div>
  );
}
