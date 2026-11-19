/**
 * One origin policy for both transports (INV-AU-12).
 *
 * The WebSocket handshake refused a disallowed origin while HTTP answered it and
 * merely withheld the CORS header, so the two boundaries disagreed: a state
 * changing `POST` was still executed, just without a readable response. Both
 * callers now ask this function, and HTTP turns a refusal into a 403.
 *
 * A request with no `Origin` is a non-browser client (curl, a bot, a health
 * probe) and is allowed: the header is a browser control, not authentication.
 */
export function isAllowedOrigin(
  origin: string | undefined,
  allowedOrigins: readonly string[],
  nodeEnv = 'local',
): boolean {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  // Local development serves the client from whatever Vite picked, including
  // ports not listed in the config, so loopback itself is the allowance.
  if (nodeEnv === 'local') {
    try {
      const url = new URL(origin);
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}
