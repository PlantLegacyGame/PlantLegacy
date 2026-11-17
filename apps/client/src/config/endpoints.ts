/**
 * Where the client talks to the server.
 *
 * Lifted out of `main.ts` because it is pure environment probing: no scene, no
 * socket, no UI. Anything that needs an origin - the socket, the config fetches,
 * the reconnect payload - reads it from here instead of re-deriving it, which is
 * how the dev proxy rules came to be written out more than once.
 */

const serverOrigin =
  document.querySelector('meta[name="server-origin"]')?.getAttribute('content') ?? '';

// Use the meta tag if present (production/staging deployment sets it). In local
// dev the Vite server proxies /config, /ws, /health -> :8080, so we use the same
// origin as the page (empty string = relative URLs) rather than pointing
// directly at :8080, which breaks when the browser is on a different port or the
// server hasn't started yet.
export const isLocalDev =
  !serverOrigin &&
  (location.hostname === '127.0.0.1' || location.hostname === 'localhost') &&
  location.port !== '8080'; // already on the game server port - no proxy needed

export const httpOrigin = serverOrigin || (isLocalDev ? '' : location.origin);

// WebSocket: in local dev, go through the Vite proxy (/ws path on same port).
// The proxy config in vite.config.ts forwards ws://localhost:4173/ws ->
// ws://127.0.0.1:8080/ws.
const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
export const wsOrigin = serverOrigin
  ? serverOrigin.replace(/^http/, 'ws')
  : isLocalDev
    ? `${wsProtocol}//${location.hostname}:${location.port}`
    : `${wsProtocol}//${location.host}`;

// D01: Dev mode gate - only enable dev features with ?dev=1 query param.
export const isDevMode = new URLSearchParams(location.search).has('dev');
