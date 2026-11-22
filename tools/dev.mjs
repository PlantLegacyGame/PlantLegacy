/**
 * One-command local stack (O01 + C01).
 *
 * `pnpm dev` from a fresh clone:
 *   1. installs workspace dependencies if `node_modules` is missing;
 *   2. checks the dev ports are free, then starts the server (watch mode) and
 *      the Vite dev server together;
 *   3. auto-restarts any process that crashes — but only while its port is
 *      genuinely free.
 *
 * Ports are never stolen. This used to kill whatever listened on 8080/4173
 * before starting, so a second `pnpm dev` (or a server started by hand) and the
 * supervisor would keep killing each other's children: each restart dropped
 * every socket, the watch loop paused after repeated fast failures, and the
 * browser was left on a blank page with no server behind it. A busy port is now
 * reported once, with the fix, and the supervisor exits instead of looping.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const CLIENT_PORT = 4173;

// PORT=0 is treated as unset by the server (it cannot bind a zero port for a
// fixed client URL), so the port the server will actually use is what matters.
const SERVER_PORT = process.env.PORT && process.env.PORT !== '0' ? Number(process.env.PORT) : 8080;

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

/** True when something is already listening on `port`. */
function isPortInUse(port) {
  return new Promise((resolvePort) => {
    const probe = net.createServer();
    probe.once('error', (error) => {
      probe.removeAllListeners();
      resolvePort(error.code === 'EADDRINUSE');
    });
    probe.once('listening', () => {
      probe.removeAllListeners();
      probe.close(() => resolvePort(false));
    });
    probe.listen({ port, host: '0.0.0.0', exclusive: true });
  });
}

/**
 * Refuse to start on top of another stack. Killing the other process was the
 * old behaviour and the reason two supervisors could fight over a port forever.
 */
/**
 * HTTP status of a local URL, or null when nothing answers.
 *
 * Used to tell "a stack is already up" from "something unrelated owns the
 * port". A busy port used to be reported as an error even when the thing on it
 * was this very project, already running.
 */
async function probeHttp(url, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.status;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** True when both ports are answering as this project's own stack. */
async function stackAlreadyServing() {
  const [server, client] = await Promise.all([
    probeHttp(`http://127.0.0.1:${SERVER_PORT}/health`),
    probeHttp(`http://localhost:${CLIENT_PORT}/`),
  ]);
  return server === 200 && client !== null && client < 500;
}

async function requireFreePort(port, what) {
  if (!(await isPortInUse(port))) return true;
  console.error(`dev: port ${port} is already in use — ${what}.`);
  console.error('dev: another dev stack (or a hand-started server) is most likely still running.');
  console.error('dev: stop it first (Ctrl+C in its terminal), then run pnpm dev again.');
  console.error('dev: nothing was started.');
  return false;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

/**
 * Wait (bounded) for a port to be released.
 *
 * A killed child's socket can outlive its exit by a moment on Windows, so a
 * restart that checked once and found the port busy would report "another stack
 * owns it" and give up on the stack's own port. Returns true when it is free.
 */
async function waitForPortFree(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!(await isPortInUse(port))) return true;
    if (Date.now() >= deadline) return false;
    await delay(150);
  }
}

function openBrowser(url) {
  if (process.platform === 'win32') {
    spawn('start', ['', url], { stdio: 'ignore', shell: true });
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { stdio: 'ignore' });
  } else {
    spawn('xdg-open', [url], { stdio: 'ignore' });
  }
}

function startServer() {
  console.log('dev: starting server...');
  serverProcess = spawn('pnpm --filter @plant-legacy/server dev', {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  });
  serverProcess.on('exit', async (code, signal) => {
    if (restarting) return;
    console.error(`dev: server exited (code ${code ?? 'null'}, signal ${signal ?? 'none'})`);
    // A clean exit is the server deciding to stop (that is how it reports a port
    // it cannot bind); restarting it would just repeat the same exit.
    if (code === 0 && !signal) {
      console.error('dev: server stopped cleanly; not restarting it.');
      return;
    }
    // A crash is worth restarting; a port held by someone else is not, and
    // retrying into it is what produced the silent restart loop.
    if (!(await waitForPortFree(SERVER_PORT, 2000))) {
      console.error(`dev: port ${SERVER_PORT} is held by another process; not restarting.`);
      console.error('dev: stop that process, then run pnpm dev again.');
      process.exit(1);
    }
    console.error('dev: restarting server in 3s...');
    setTimeout(startServer, 3000);
  });
}

function startClient() {
  console.log('dev: starting client...');
  clientProcess = spawn('pnpm --filter @plant-legacy/client dev', {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    // The Vite proxy has to follow a non-default server port. `PORT` cannot carry
    // it: the client's own preview server reads that for its own port.
    env: { ...process.env, PL_SERVER_PORT: String(SERVER_PORT) },
  });
  clientProcess.on('exit', async (code, signal) => {
    if (restarting) return;
    console.error(`dev: client exited (code ${code ?? 'null'}, signal ${signal ?? 'none'})`);
    if (code === 0 && !signal) {
      console.error('dev: client stopped cleanly; not restarting it.');
      return;
    }
    if (!(await waitForPortFree(CLIENT_PORT, 2000))) {
      console.error(`dev: port ${CLIENT_PORT} is held by another process; not restarting.`);
      console.error('dev: stop that process, then run pnpm dev again.');
      process.exit(1);
    }
    console.error('dev: restarting client in 3s...');
    setTimeout(startClient, 3000);
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

// A stack that is already serving is not a conflict: it is the stack the user
// wants. Reusing it keeps `pnpm dev` idempotent instead of telling someone to go
// hunt for a terminal they may not have. Only a port held by something that is
// not this project's health endpoints is an error.
if ((await isPortInUse(SERVER_PORT)) || (await isPortInUse(CLIENT_PORT))) {
  if (await stackAlreadyServing()) {
    console.log(`dev: already serving - server on ${SERVER_PORT}, client on ${CLIENT_PORT}.`);
    console.log('dev: reusing the running stack; nothing new was started.');
    console.log('dev: restart it from its own terminal if it needs new env or config.');
    process.exit(0);
  }
}
if (!(await requireFreePort(SERVER_PORT, `the game server needs it`))) process.exit(1);
if (!(await requireFreePort(CLIENT_PORT, `the Vite dev server needs it`))) process.exit(1);

startServer();
startClient();

// Wait a bit for servers to start, then open browser
setTimeout(() => {
  openBrowser(`http://localhost:4173/PlantLegacy/`);
}, 3000);

console.log(`dev: server on http://127.0.0.1:${SERVER_PORT}, client on http://localhost:4173`);
