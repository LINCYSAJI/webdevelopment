/** For a unique-index clash (MongoDB error 11000), the field that clashed; otherwise null. */
export function duplicateKeyField(err: unknown): string | null {
  const e = err as { code?: number; keyPattern?: Record<string, unknown> } | null;
  if (e?.code !== 11000) return null;
  return Object.keys(e.keyPattern ?? {})[0] ?? 'value';
}
