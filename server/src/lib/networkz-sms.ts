import { createHash } from 'node:crypto';

/**
 * Client for the Networkz Systems SMS gateway, written to its official documentation
 * (message.networkzsystems.com › Developers › Documentation, SMS API v1.0):
 *
 * - Base URLs: {base}/api/sms/v1.0/{request} and {base}/api/account/v1.0/{request}.
 * - Every request carries `accessToken`, `expire` (Unix seconds) and `authSignature`:
 *     TimeKey            = MD5(RequestFor + "<service>@rits-v1.0" + expire)   service: "sms" | "account"
 *     TimeAccessTokenKey = MD5(ACCESS_TOKEN + TimeKey)
 *     SIGNATURE          = MD5(TimeAccessTokenKey + ACCESS_TOKEN_KEY)
 *   GET puts them in the query string; POST in the (form-urlencoded) body.
 * - Responses are JSON: { status: "success" | "failed", data, message, httpStatusCode, ... }.
 *
 * Credentials are passed in by the caller from environment variables and are never logged.
 */

export interface NetworkzCredentials {
  baseUrl: string;
  accessToken: string;
  accessTokenKey: string;
}

type Service = 'sms' | 'account';

const md5 = (s: string) => createHash('md5').update(s).digest('hex');

/** The documented MD5 signature chain. Exported for tests. */
export function networkzSignature(requestFor: string, service: Service, expire: number, accessToken: string, accessTokenKey: string): string {
  const timeKey = md5(`${requestFor}${service}@rits-v1.0${expire}`);
  const timeAccessTokenKey = md5(`${accessToken}${timeKey}`);
  return md5(`${timeAccessTokenKey}${accessTokenKey}`);
}

/** A failed gateway call, with whether trying again could help. */
export class NetworkzError extends Error {
  constructor(
    message: string,
    public httpStatus: number | null,
    public retryable: boolean,
  ) {
    super(message);
  }
}

/** Documented error codes, in plain words for the Admin error log. */
const ERROR_MEANING: Record<number, string> = {
  400: 'Bad request (a parameter is missing or wrong)',
  401: 'Authorisation failed (check the access token and its key)',
  402: 'Insufficient balance: recharge the SMS wallet',
  403: 'This SMS template or sender ID is blocked for all routes',
  405: 'Method not allowed',
  408: 'Request expired (check the server clock)',
  409: 'Message text problem: invalid or Unicode characters, or it does not match the DLT template',
  412: 'Unable to send SMS: contact the Networkz administrator',
  413: 'Sending limit reached',
  500: 'Gateway internal error',
};

interface GatewayReply {
  status?: string;
  message?: string;
  httpStatusCode?: number;
  data?: Record<string, unknown>;
}

const TIMEOUT_MS = 15_000;
/** Signatures are valid for 5 minutes, which tolerates small clock differences. */
const EXPIRE_SECONDS = 300;

async function call(creds: NetworkzCredentials, service: Service, requestFor: string, method: 'GET' | 'POST', params: Record<string, string>): Promise<GatewayReply> {
  const expire = Math.floor(Date.now() / 1000) + EXPIRE_SECONDS;
  const auth = {
    accessToken: creds.accessToken,
    expire: String(expire),
    authSignature: networkzSignature(requestFor, service, expire, creds.accessToken, creds.accessTokenKey),
  };
  const url = new URL(`${creds.baseUrl.replace(/\/+$/, '')}/api/${service}/v1.0/${requestFor}`);
  const body = new URLSearchParams({ ...auth, ...params });
  if (method === 'GET') url.search = body.toString();

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { accept: 'application/json', ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: method === 'POST' ? body.toString() : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    throw new NetworkzError(timedOut ? 'The SMS gateway did not answer in time' : `Could not reach the SMS gateway (${err instanceof Error ? err.message : 'network error'})`, null, true);
  }

  let reply: GatewayReply = {};
  const text = await res.text();
  try {
    reply = JSON.parse(text) as GatewayReply;
  } catch {
    throw new NetworkzError(`Unexpected reply from the SMS gateway (HTTP ${res.status})`, res.status, res.status >= 500);
  }
  const status = reply.httpStatusCode ?? res.status;
  if (reply.status !== 'success' || status >= 400) {
    const meaning = ERROR_MEANING[status];
    const detail = reply.message ? `${reply.message}${meaning ? ` — ${meaning}` : ''}` : meaning ?? 'Request failed';
    // Expired requests, server errors and rate limits can succeed on a fresh attempt.
    throw new NetworkzError(`${status}: ${detail}`, status, status >= 500 || status === 408);
  }
  return reply;
}

export interface SendResult {
  submissionId: string | null;
  messageIds: string[];
}

/** POST send-sms: one message to one 10-digit Indian number, with its DLT entity and template IDs. */
export async function sendNetworkzSms(
  creds: NetworkzCredentials,
  msg: { to: string; text: string; senderId: string; entityId: string; templateId: string; route: string; templateMatching?: boolean; webhookId?: string },
): Promise<SendResult> {
  const reply = await call(creds, 'sms', 'send-sms', 'POST', {
    route: msg.route,
    smsHeader: msg.senderId,
    messageContent: msg.text,
    recipients: msg.to,
    contentType: 'text',
    entityId: msg.entityId,
    templateId: msg.templateId,
    removeDuplicateNumbers: '1',
    ...(msg.templateMatching ? { templateMatching: '1' } : {}),
    ...(msg.webhookId ? { webHookId: msg.webhookId } : {}),
  });
  const data = reply.data ?? {};
  return {
    submissionId: typeof data.submissionId === 'string' ? data.submissionId : null,
    messageIds: Array.isArray(data.messageIds) ? data.messageIds.map(String) : [],
  };
}

export interface DeliveryReport {
  submissionId: string;
  messageId: string;
  phoneNumber: string;
  /** "DELIVERED", "PENDING", "REJECTED" or "FAILED". */
  dlr: string;
  statusCode: string | null;
  statusDescription: string | null;
}

/** GET get-delivery-report for one submission (reports are kept for 30 days). */
export async function getNetworkzDeliveryReport(creds: NetworkzCredentials, submissionId: string): Promise<DeliveryReport[]> {
  const reply = await call(creds, 'sms', 'get-delivery-report', 'GET', { submissionId, perPage: '100' });
  const reports = Array.isArray(reply.data?.reports) ? (reply.data!.reports as Record<string, unknown>[]) : [];
  return reports.map((r) => ({
    submissionId: String(r.submissionId ?? ''),
    messageId: String(r.messageId ?? ''),
    phoneNumber: String(r.phoneNumber ?? ''),
    dlr: String(r.DLR ?? '').toUpperCase(),
    statusCode: r.statusCode != null ? String(r.statusCode) : null,
    statusDescription: r.statusDescription != null ? String(r.statusDescription) : null,
  }));
}

/** GET account get-wallet-balance. */
export async function getNetworkzWalletBalance(creds: NetworkzCredentials): Promise<{ balance: string; currency: string }> {
  const reply = await call(creds, 'account', 'get-wallet-balance', 'GET', {});
  return { balance: String(reply.data?.walletBalance ?? ''), currency: String(reply.data?.currency ?? '') };
}
