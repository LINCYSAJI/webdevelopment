// File helpers shared by every upload and download (PRD 8.6).

/** Works out the real file type from its first bytes, ignoring the file name. */
export function sniffMimeType(data: Buffer): string | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data.subarray(0, 1024).indexOf('%PDF-') !== -1) return 'application/pdf';
  return null;
}

/**
 * Keeps a readable file name without path parts or characters that cause trouble.
 * With `extension`, makes sure the name ends with it (e.g. ".pdf").
 */
export function cleanFileName(raw: string | undefined, fallback: string, extension?: string): string {
  const base = (raw ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  let name = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').trim().slice(0, 150) || fallback;
  if (extension && !name.toLowerCase().endsWith(extension.toLowerCase())) name += extension;
  return name;
}
