/** Reads and updates list filters kept in the address bar (so a refresh keeps them). */
export function updateParams(params: URLSearchParams, changes: Record<string, string | null>) {
  const next = new URLSearchParams(params);
  for (const [k, v] of Object.entries(changes)) {
    if (v) next.set(k, v);
    else next.delete(k);
  }
  if (!('page' in changes)) next.delete('page');
  return next;
}
