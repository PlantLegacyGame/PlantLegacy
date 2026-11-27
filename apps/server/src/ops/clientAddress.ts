import type { IncomingMessage } from 'node:http';

/**
 * The address a rate limit or connection cap should be keyed by.
 *
 * `X-Forwarded-For` is client-controlled unless a trusted proxy overwrites it,
 * so it is only read when the deployment opts in. The first hop is the caller;
 * proxies append the addresses they saw after it. An empty header falls back to
 * the socket so a malformed forward cannot create an "unknown" shared bucket.
 */
export function clientAddress(
  remoteAddress: string | undefined,
  forwardedFor: string | string[] | undefined,
  trustProxy: boolean,
): string {
  if (trustProxy && forwardedFor) {
    const raw = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    const first = raw?.split(',')[0]?.trim();
    if (first) return first;
  }
  return remoteAddress || 'unknown';
}

export function clientAddressFromRequest(request: IncomingMessage, trustProxy: boolean): string {
  return clientAddress(
    request.socket.remoteAddress,
    request.headers['x-forwarded-for'],
    trustProxy,
  );
}
