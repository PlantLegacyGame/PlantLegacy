/**
 * Content-aware dev watcher for the game server (`pnpm dev:server`).
 *
 * `node --watch-path` reacts to raw filesystem notifications. On Windows those
 * fire for attribute/access activity from other processes (antivirus, search
 * indexing, `tsc` and biome reading the tree), so the server restarted with no
 * source edit: every WebSocket dropped, every plant respawned, and clients
 * re-framed their cameras. This watcher polls mtime+size and restarts only when
 * a watched file actually changed, and it ignores `*.test.ts` edits, which a
 * directory-level `--watch-path` cannot.
 *
 * Guards:
 * - a missing watched root is a startup error, not an empty tree (an empty tree
 *   would look like "every file was deleted" and restart the server);
 * - a root that disappears at runtime stops deletion detection for that root;
 * - a server that keeps crashing on startup backs off and eventually stops,
 *   instead of restarting forever;
 * - one restart at a time, so a burst of saves cannot stack restarts.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = join(repoRoot, 'apps/server');
const watchedRoots = [
  join(repoRoot, 'apps/server/src'),
  join(repoRoot, 'packages/shared/src'),
  // The server imports the weather package directly, so edits there need a restart too.
  join(repoRoot, 'packages/weather/src'),
];
const extensions = new Set(['.ts', '.sql']);
const pollMs = 400;
const debounceMs = 250;
const fastFailureMs = 5000;
const maxConsecutiveFailures = 5;

// Fail fast and clearly: a typo/moved directory must not silently watch nothing.
const missingRoots = watchedRoots.filter((root) => !existsSync(root));
if (missingRoots.length > 0) {
  console.error(
    `[watch] cannot start: watched path missing:\n  ${missingRoots.join('\n  ')}\n[watch] fix the path or remove it from watchedRoots.`,
  );
  process.exit(1);
}

function collect(dir, into, rootAvailable) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collect(full, into, rootAvailable);
      continue;
    }
    if (entry.name.endsWith('.test.ts')) continue;
    const dot = entry.name.lastIndexOf('.');
    if (dot < 0 || !extensions.has(entry.name.slice(dot))) continue;
    try {
      const stat = statSync(full);
      into.set(full, `${stat.mtimeMs}:${stat.size}`);
    } catch {
      // File vanished between readdir and stat; the next poll reconciles it.
    }
  }
  rootAvailable.add(dir);
}

function snapshot() {
  const files = new Map();
  const reachable = new Set();
  for (const root of watchedRoots) {
    let readable = true;
    try {
      readdirSync(root);
    } catch {
      readable = false;
    }
    if (readable) collect(root, files, reachable);
  }
  return { files, unreachable: watchedRoots.filter((root) => !reachable.has(root)) };
}

const initial = snapshot();
const current = initial.files;
const warnedRoots = new Set();
let child = null;
let stopping = false;
let restartTimer = null;
let restartInFlight = false;
let consecutiveFailures = 0;
let paused = false;
let startedAt = 0;

function startServer() {
  startedAt = Date.now();
  child = spawn(process.execPath, ['src/main.ts'], { cwd: serverDir, stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    child = null;
    if (Date.now() - startedAt < fastFailureMs) consecutiveFailures += 1;
    else consecutiveFailures = 0;

    if (consecutiveFailures >= maxConsecutiveFailures) {
      paused = true;
      console.error(
        `[watch] server failed ${consecutiveFailures} times in a row; auto-restart paused.\n[watch] fix the error, then save a watched file or restart pnpm dev.`,
      );
      return;
    }
    const delay = Math.min(1000 * 2 ** Math.max(0, consecutiveFailures - 1), 30000);
    console.error(
      `[watch] server exited (code ${code ?? 'null'}, signal ${signal ?? 'none'}); restarting in ${delay}ms`,
    );
    setTimeout(() => {
      if (!stopping && !paused) startServer();
    }, delay);
  });
}

function killChild(done) {
  const running = child;
  child = null;
  if (!running?.pid) {
    done();
    return;
  }
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    done();
  };
  running.removeAllListeners('exit');
  running.once('exit', finish);
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(running.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    running.kill('SIGTERM');
  }
  setTimeout(finish, 3000);
}

function restart(reason) {
  if (stopping || restartInFlight) return;
  restartInFlight = true;
  if (paused) {
    paused = false;
    consecutiveFailures = 0;
    console.log('[watch] change detected after a crash loop; trying again');
  }
  console.log(`[watch] restarting server: ${reason}`);
  killChild(() => {
    restartInFlight = false;
    if (!stopping && !paused) startServer();
  });
}

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[watch] ${signal}, stopping`);
  killChild(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

startServer();
console.log(
  '[watch] watching apps/server/src, packages/shared/src and packages/weather/src for real changes',
);

setInterval(() => {
  const next = snapshot();
  for (const root of next.unreachable) {
    if (warnedRoots.has(root)) continue;
    warnedRoots.add(root);
    console.warn(`[watch] watched path unreachable, ignoring its deletions: ${root}`);
  }
  for (const root of [...warnedRoots]) {
    if (!next.unreachable.includes(root)) {
      warnedRoots.delete(root);
      console.log(`[watch] watched path reachable again: ${root}`);
    }
  }

  const changed = [];
  for (const [file, signature] of next.files) {
    if (current.get(file) !== signature) changed.push(file);
  }
  // Only treat a file as deleted when every root is readable; otherwise a
  // transiently unavailable folder would look like a mass deletion.
  if (next.unreachable.length === 0) {
    for (const file of current.keys()) {
      if (!next.files.has(file)) changed.push(file);
    }
  }
  if (changed.length === 0) return;
  current.clear();
  for (const [file, signature] of next.files) current.set(file, signature);
  if (restartTimer || restartInFlight) return;
  const first = changed[0].slice(repoRoot.length + 1);
  const suffix = changed.length > 1 ? ` (+${changed.length - 1} more)` : '';
  restartTimer = setTimeout(() => {
    restartTimer = null;
    restart(`${first}${suffix}`);
  }, debounceMs);
}, pollMs);
