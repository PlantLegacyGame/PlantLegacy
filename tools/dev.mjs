/**
 * One-command local stack (O01 + C01).
 *
 * `pnpm dev` from a fresh clone:
 *   1. installs workspace dependencies if `node_modules` is missing;
 *   2. starts the server (watch mode) and the Vite dev server together.
 *
 * No extra dependency and no orchestration framework: two child processes and
 * Ctrl+C. Vite dev server proxies `/health`, `/ready`, and `/ws` to the server.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));

function run(command, label) {
  const result = spawnSync(command, { cwd: root, stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.error(`dev: ${label} failed (exit ${result.status ?? 'unknown'})`);
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(join(root, 'node_modules'))) {
  console.log('dev: node_modules missing, running pnpm install');
  run('pnpm install', 'install');
}

const children = [
  spawn('pnpm --filter @plant-legacy/server dev', {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  }),
  spawn('pnpm --filter @plant-legacy/client dev', {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  }),
];

function killTree(child) {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`dev: ${signal}, stopping`);
  for (const child of children) killTree(child);
  process.exit(0);
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

for (const child of children) {
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(`dev: a child exited (code ${code ?? 'null'}, signal ${signal ?? 'none'})`);
    stop('child exit');
  });
}

console.log(
  `dev: server on http://127.0.0.1:${process.env.PORT ?? '8080'}, client on http://127.0.0.1:${process.env.CLIENT_PORT ?? '4173'}`,
);
