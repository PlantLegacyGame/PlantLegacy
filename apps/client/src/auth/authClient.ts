/**
 * Client half of the account system.
 *
 * The server has had `/auth/signup|login|refresh|logout` all along; the client
 * never called them, so a player could not obtain an `accessToken` and the
 * account paths (including plant reclaim by account) were unreachable. This
 * module is deliberately tiny and fetch-injectable so it can be tested without a
 * server or a browser.
 */

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  displayName?: string;
}

export interface StoredSession {
  accessToken?: string;
  refreshToken?: string;
}

/** The subset of `fetch` this module needs, injectable for tests. */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

const AUTH_BASE = '/auth';

/** Human-readable text for the error codes the server returns. */
export function describeAuthError(code: string | null | undefined): string {
  switch (code) {
    case 'invalid_credentials':
      return 'Wrong username or password.';
    case 'account_locked':
      return 'Too many failed attempts. Try again later.';
    case 'rate_limited':
      return 'Too many attempts from this address. Try again in a minute.';
    case 'username_taken':
      return 'That username is already taken.';
    case 'username_invalid':
    case 'invalid_username':
      return 'Usernames allow letters, numbers, underscore and dash.';
    case 'password_invalid':
    case 'weak_password':
      return 'Password does not meet the requirements.';
    case 'invalid_display_name':
      return 'That display name is not allowed.';
    case 'request_too_large':
      return 'Request was too large.';
    case 'database_not_available':
      return 'Accounts are unavailable right now. Try again later.';
    default:
      return code ? code.replace(/_/g, ' ') : 'Something went wrong.';
  }
}

function readString(source: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function toSession(payload: Record<string, unknown>): AuthSession {
  const accessToken = readString(payload, 'accessToken', 'access_token');
  const refreshToken = readString(payload, 'refreshToken', 'refresh_token');
  if (!accessToken || !refreshToken) {
    throw new Error('auth_response_missing_tokens');
  }
  const account = payload.account;
  const displayName =
    account && typeof account === 'object'
      ? readString(account as Record<string, unknown>, 'displayName', 'display_name')
      : undefined;
  return { accessToken, refreshToken, displayName };
}

async function post(
  fetchImpl: FetchLike,
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(`${baseUrl}${AUTH_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  let payload: Record<string, unknown> = {};
  try {
    const parsed = await response.json();
    if (parsed && typeof parsed === 'object') payload = parsed as Record<string, unknown>;
  } catch {
    // A body-less error response is still an error; reported below.
  }

  if (!response.ok || payload.success === false) {
    throw new Error(describeAuthError(readString(payload, 'error', 'code', 'message')));
  }
  return payload;
}

export async function signUp(
  fetchImpl: FetchLike,
  baseUrl: string,
  input: { username: string; displayName: string; password: string },
): Promise<AuthSession> {
  return toSession(await post(fetchImpl, baseUrl, '/signup', { ...input }));
}

export async function signIn(
  fetchImpl: FetchLike,
  baseUrl: string,
  input: { username: string; password: string },
): Promise<AuthSession> {
  return toSession(await post(fetchImpl, baseUrl, '/login', { ...input }));
}

export async function refreshSession(
  fetchImpl: FetchLike,
  baseUrl: string,
  refreshToken: string,
): Promise<AuthSession> {
  return toSession(await post(fetchImpl, baseUrl, '/refresh', { refreshToken }));
}

/** Best effort: a failed logout must not block the client from forgetting the tokens. */
export async function signOut(
  fetchImpl: FetchLike,
  baseUrl: string,
  refreshToken: string,
): Promise<void> {
  try {
    await post(fetchImpl, baseUrl, '/logout', { refreshToken });
  } catch {
    // Ignored on purpose; the caller clears local tokens regardless.
  }
}

/** `exp` of a JWT in epoch milliseconds, or null when it cannot be read. */
export function accessTokenExpiresAt(token: string | undefined | null): number | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(payload)) as { exp?: unknown };
    return typeof decoded.exp === 'number' ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * A session that is safe to use for a HELLO: refreshed when the access token is
 * missing, expired, or within `skewMs` of expiring. Returns null when there is
 * nothing worth sending (no tokens, or a refresh that the server rejected).
 */
export async function ensureFreshSession(
  fetchImpl: FetchLike,
  baseUrl: string,
  stored: StoredSession | null,
  nowMs: number,
  skewMs = 60_000,
): Promise<AuthSession | null> {
  if (!stored?.accessToken && !stored?.refreshToken) return null;

  const expiresAt = accessTokenExpiresAt(stored.accessToken);
  const stillValid = expiresAt !== null && expiresAt - nowMs > skewMs;
  if (stillValid && stored.accessToken && stored.refreshToken) {
    return { accessToken: stored.accessToken, refreshToken: stored.refreshToken };
  }

  if (!stored.refreshToken) return null;
  try {
    return await refreshSession(fetchImpl, baseUrl, stored.refreshToken);
  } catch {
    // An expired refresh token means anonymous is the only option left.
    return null;
  }
}
