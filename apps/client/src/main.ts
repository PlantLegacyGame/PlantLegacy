/**
 * Phase 0 client shell.
 *
 * Proves the static deploy reaches the server. No rendering, no game state, no
 * client-side authority of any kind (RULE_27). C01 replaces this file.
 */

interface HealthPayload {
  status: string;
  version: string;
  uptime_s: number;
  checks: {
    config: string;
    config_files: number;
    database: string;
  };
}

const serverOrigin =
  document.querySelector('meta[name="server-origin"]')?.getAttribute('content') ?? '';

const statusElement = document.getElementById('status');
const detailElement = document.getElementById('detail');

function setStatus(text: string, state: 'pending' | 'ok' | 'down'): void {
  if (!statusElement) return;
  statusElement.textContent = text;
  statusElement.dataset.state = state;
}

function setDetail(text: string): void {
  if (detailElement) detailElement.textContent = text;
}

async function probe(): Promise<void> {
  setStatus('Checking server…', 'pending');
  setDetail('');

  try {
    const response = await fetch(`${serverOrigin}/health`, { cache: 'no-store' });
    const payload = (await response.json()) as HealthPayload;

    setStatus(`Server ${payload.status}`, payload.status === 'ok' ? 'ok' : 'down');
    setDetail(
      [
        `version:  ${payload.version}`,
        `uptime:   ${payload.uptime_s}s`,
        `database: ${payload.checks.database}`,
        `configs:  ${payload.checks.config_files} file(s)`,
      ].join('\n'),
    );
  } catch (error) {
    setStatus('Server unreachable', 'down');
    setDetail(error instanceof Error ? error.message : String(error));
  }
}

void probe();
