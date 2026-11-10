/**
 * One-command local stack (O01 + C01).
 *
 * `pnpm dev` from a fresh clone:
 *   1. installs workspace dependencies if `node_modules` is missing;
 *   2. starts the server (watch mode) and the Vite dev server together.
 *   3. auto-restarts any process that crashes.
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

let serverProcess = null;
let clientProcess = null;
let restarting = false;

function startServer() {
  console.log('dev: starting server...');
  serverProcess = spawn('pnpm --filter @plant-legacy/server dev', {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  });
  serverProcess.on('exit', (code, signal) => {
    if (restarting) return;
    console.error(
      `dev: server exited (code ${code ?? 'null'}, signal ${signal ?? 'none'}), restarting in 2s...`,
    );
    setTimeout(startServer, 2000);
  });
}

function startClient() {
  console.log('dev: starting client...');
  clientProcess = spawn('pnpm --filter @plant-legacy/client dev', {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  });
  clientProcess.on('exit', (code, signal) => {
    if (restarting) return;
    console.error(
      `dev: client exited (code ${code ?? 'null'}, signal ${signal ?? 'none'}), restarting in 2s...`,
    );
    setTimeout(startClient, 2000);
  });
}

function killTree(child) {
  if (child?.pid === undefined) return;
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
  restarting = true;
  console.log(`dev: ${signal}, stopping`);
  killTree(serverProcess);
  killTree(clientProcess);
  process.exit(0);
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

startServer();
startClient();

console.log(
  `dev: server on http://127.0.0.1:${process.env.PORT ?? '8080'}, client on http://localhost:4173`,
);
