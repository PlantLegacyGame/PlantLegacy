/**
 * "Server unreachable" notice with a retry loop.
 *
 * The client cannot boot without the backend: every subsystem's config comes
 * from `/config/*` through the dev proxy and the game arrives over `/ws`. When
 * the server was down the boot simply never finished, so the page sat there
 * white with no explanation and the first visible symptom was "the game is
 * broken". This gate probes `/health` before the boot starts, keeps the screen
 * legible while it fails, and lets the boot continue the moment the server
 * answers — no reload, so a recovering backend cannot turn into a reload loop.
 */

/** Health probe timeout: a hung socket must not stall the retry loop. */
const PROBE_TIMEOUT_MS = 4000;

export interface ServerWaitOptions {
  /** Server origin the client talks to (`http://localhost:8080` in dev). */
  origin: string;
  /** Wait between probes, milliseconds. */
  retryMs?: number;
  /** Called after each failed probe, for logging and diagnostics. */
  onAttempt?: (attempt: number, reason: string) => void;
}

const OVERLAY_ID = 'server-unreachable';

function ensureOverlay(): HTMLDivElement {
  const existing = document.getElementById(OVERLAY_ID);
  if (existing instanceof HTMLDivElement) return existing;

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.setAttribute('role', 'alert');
  overlay.setAttribute('aria-live', 'assertive');
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483600',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'gap:14px',
    'padding:32px',
    'text-align:center',
    'background:#0d110b',
    'color:#d7e7c8',
    "font-family:'Segoe UI',system-ui,sans-serif",
  ].join(';');

  const title = document.createElement('div');
  title.textContent = 'Server unreachable';
  title.style.cssText = 'font-size:26px;font-weight:600;letter-spacing:0.01em';

  const detail = document.createElement('div');
  detail.dataset.role = 'detail';
  detail.style.cssText = 'font-size:15px;opacity:0.78;max-width:46ch;line-height:1.5';

  const attempt = document.createElement('div');
  attempt.dataset.role = 'attempt';
  attempt.style.cssText = 'font-size:13px;opacity:0.55;font-family:ui-monospace,monospace';

  overlay.append(title, detail, attempt);
  document.body.appendChild(overlay);
  return overlay;
}

/** The client talks to the proxy in dev, so `origin` is empty there. */
function describeOrigin(origin: string): string {
  const resolved = origin || window.location.origin;
  return resolved || 'the game server';
}

function setOverlayText(origin: string, attempt: number, reason: string): void {
  const overlay = ensureOverlay();
  const detail = overlay.querySelector('[data-role="detail"]');
  const counter = overlay.querySelector('[data-role="attempt"]');
  if (detail) {
    detail.textContent =
      `The game needs its backend at ${describeOrigin(origin)}. The world is safe — the ` +
      'server is either starting or stopped. This screen retries by itself and the ' +
      'game opens as soon as it answers.';
  }
  if (counter) counter.textContent = `attempt ${attempt} · ${reason}`;
}

/** Remove the notice, if it is on screen. */
export function hideServerUnreachable(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}

/** True when the health endpoint answers 2xx within the probe timeout. */
async function probeHealth(origin: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${origin}/health`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, reason: `health returned ${response.status}` };
    return { ok: true };
  } catch (error) {
    const reason =
      error instanceof DOMException && error.name === 'AbortError'
        ? 'health timed out'
        : 'connection refused';
    return { ok: false, reason };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Block until the backend answers, showing the notice while it does not.
 *
 * Resolves once `/health` succeeds; the caller then boots as normal. Never
 * rejects: there is no useful fallback state for "no server", only waiting.
 */
export async function waitForServer(options: ServerWaitOptions): Promise<void> {
  const { origin, retryMs = 3000, onAttempt } = options;
  let attempt = 0;
  for (;;) {
    const health = await probeHealth(origin);
    if (health.ok) {
      hideServerUnreachable();
      return;
    }
    attempt += 1;
    onAttempt?.(attempt, health.reason);
    setOverlayText(origin, attempt, health.reason);
    await new Promise((resolve) => setTimeout(resolve, retryMs));
  }
}
