#!/usr/bin/env node
/**
 * Repeatable proof that the write gate's drop counter works.
 *
 * `pnpm --filter @plant-legacy/server probe:drop`
 *
 * A client that stops reading its socket (TCP backpressure) plus a flood of
 * full-grid queries pushes that socket's unsent backlog past
 * `net_proto.max_buffered_bytes`. The server must then stop counting writes to
 * it as `sent` and must report them in `dev_log_network`'s `skippedSends`
 * instead. A second, healthy client is the observer that asks for the numbers,
 * and it also proves the stall is per-socket rather than global.
 *
 * The script starts and stops its own server on PROBE_PORT (default 8099) so it
 * can be run on a clean checkout without disturbing a dev server.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A dev shell often exports PORT for the hand-started server; the probe picks
// its own port so it never points at that one.
const port = Number(process.env.PROBE_PORT ?? 8099);
const url = `ws://127.0.0.1:${port}`;
const health = `http://127.0.0.1:${port}/health`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function startServer() {
  const child = spawn(process.execPath, ['src/main.ts'], {
    cwd: serverRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (chunk) => {
    log += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    log += String(chunk);
  });
  return { child, log: () => log };
}

async function waitForHealth(child) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`server exited with code ${child.exitCode}`);
    try {
      const response = await fetch(health);
      if (response.ok) return;
    } catch {
      /* not listening yet */
    }
    await sleep(250);
  }
  throw new Error('server never answered /health');
}

function connect() {
  const ws = new WebSocket(url);
  const queue = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    const waiter = waiters.shift();
    if (waiter) waiter(msg);
    else queue.push(msg);
  });
  const next = () =>
    new Promise((resolve, reject) => {
      if (queue.length) return resolve(queue.shift());
      const timer = setTimeout(() => reject(new Error('message timeout')), 5000);
      waiters.push((msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  const opened = new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return {
    ws,
    open: () => opened,
    // The server replies WELCOME (10) to HELLO (1); anything else is skipped.
    hello: async () => {
      await opened;
      ws.send(JSON.stringify({ type: 1, payload: { clientVersion: 3 } }));
      let msg = await next();
      while (msg.type !== 10) msg = await next();
    },
    dev: (type, payload = {}) =>
      new Promise((resolve) => {
        const onMessage = (raw) => {
          const msg = JSON.parse(String(raw));
          if (msg.type === 99) {
            ws.off('message', onMessage);
            resolve(msg.payload);
          }
        };
        ws.on('message', onMessage);
        ws.send(JSON.stringify({ type: 8, payload: { type, ...payload } }));
        setTimeout(() => {
          ws.off('message', onMessage);
          resolve(null);
        }, 4000);
      }),
  };
}

const sample = async (observer) => {
  const net = await observer.dev('dev_log_network');
  if (!net) throw new Error('dev_log_network did not answer');
  return {
    stateSent: net.stateSent ?? 0,
    rootSent: net.rootReadoutsSent ?? 0,
    skippedSends: net.skippedSends ?? 0,
  };
};

const server = startServer();
let stalled;
let observer;
let failures = 0;

try {
  await waitForHealth(server.child);
  stalled = connect();
  observer = connect();
  await stalled.hello();
  await observer.hello();

  const baselineStart = await sample(observer);
  await sleep(2000);
  const baselineEnd = await sample(observer);
  const baseline = {
    stateSent: baselineEnd.stateSent - baselineStart.stateSent,
    skippedSends: baselineEnd.skippedSends - baselineStart.skippedSends,
  };
  console.log(
    `baseline (2 healthy clients, 2 s):  state +${baseline.stateSent}  skippedSends +${baseline.skippedSends}`,
  );

  // Stop reading: the server's unsent backlog for this socket starts to grow.
  stalled.ws._socket.pause();
  // Ask for the whole resource grid on repeat. Each reply is the largest message
  // the server can produce, so the backlog crosses the limit quickly without a
  // slow network in the way.
  const flood = setInterval(() => {
    if (stalled.ws.readyState === WebSocket.OPEN) {
      stalled.ws.send(JSON.stringify({ type: 5, payload: { fullGrid: true } }));
    }
  }, 25);

  const stallStart = await sample(observer);
  await sleep(6000);
  const stallEnd = await sample(observer);
  const stall = {
    stateSent: stallEnd.stateSent - stallStart.stateSent,
    rootSent: stallEnd.rootSent - stallStart.rootSent,
    skippedSends: stallEnd.skippedSends - stallStart.skippedSends,
  };
  console.log(
    `stalled client, 6 s:                state +${stall.stateSent}  root +${stall.rootSent}  skippedSends +${stall.skippedSends}`,
  );
  clearInterval(flood);

  stalled.ws._socket.resume();
  // Megabytes are still queued when the client starts reading again; let them
  // drain first, or the tail of the stall lands inside the recovery window.
  await sleep(3000);
  const recoveryStart = await sample(observer);
  await sleep(2000);
  const recoveryEnd = await sample(observer);
  const recovery = {
    stateSent: recoveryEnd.stateSent - recoveryStart.stateSent,
    skippedSends: recoveryEnd.skippedSends - recoveryStart.skippedSends,
  };
  console.log(
    `after the client caught up, 2 s:    state +${recovery.stateSent}  skippedSends +${recovery.skippedSends}`,
  );

  // Baseline is 2 s of two clients at 20 Hz, i.e. ~40 deliveries per second. Six
  // seconds of the healthy client alone is 120, so twice the baseline (160) is
  // the ceiling a socket that still received half its messages would cross.
  const checks = [
    ['baseline reports no drops', baseline.skippedSends === 0],
    ['the stalled socket produced drops', stall.skippedSends > 50],
    ['the stalled socket stopped being counted as sent', stall.stateSent < baseline.stateSent * 2],
    ['the healthy client kept receiving', stall.stateSent > 0],
    ['drops stop once the client reads again', recovery.skippedSends * 10 <= stall.skippedSends],
    ['delivery returns to the healthy rate', recovery.stateSent > 0],
  ];
  for (const [label, ok] of checks) {
    if (!ok) failures += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  }
  if (stall.skippedSends === 0) {
    console.log('--- server log ---');
    console.log(server.log().slice(-2000));
  }
} catch (error) {
  failures += 1;
  console.log(`FAIL probe error: ${error instanceof Error ? error.message : String(error)}`);
  console.log('--- server log ---');
  console.log(server.log().slice(-2000));
} finally {
  stalled?.ws.terminate();
  observer?.ws.terminate();
  server.child.kill();
}

console.log(failures === 0 ? 'PROBE PASS' : `PROBE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
