/** Error returned by the API, with a message that is safe to show the user. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
    public fields?: Record<string, string[]>,
    /** The full error object from the server, for extra data such as duplicate warnings. */
    public details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;

/** Asks the server for a fresh login token. Concurrent callers share one request. */
function refreshSession(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function api<T>(path: string, options: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = options;
  const init: RequestInit = {
    credentials: 'include',
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  };

  let res = await fetch(`/api${path}`, init);
  if (res.status === 401 && !path.startsWith('/auth/') && (await refreshSession())) {
    res = await fetch(`/api${path}`, init);
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = body?.error ?? {};
    throw new ApiError(res.status, e.message ?? 'Something went wrong. Please try again.', e.code ?? 'error', e.fields, e);
  }
  return body as T;
}

export { refreshSession };
