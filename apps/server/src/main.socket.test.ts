import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MESSAGE_TYPE, PROTOCOL_VERSION } from '@plant-legacy/shared/protocol';
import { WebSocket } from 'ws';

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(here, '..');
const configDir = resolve(here, '../../../config');

interface WireMessage {
  type: number;
  payload: Record<string, unknown>;
}

interface Inbox {
  waitFor(match: (message: WireMessage) => boolean, timeoutMs?: number): Promise<WireMessage>;
  waitForClose(timeoutMs?: number): Promise<{ code: number; reason: string }>;
}

interface SocketClient {
  ws: WebSocket;
  inbox: Inbox;
}

interface RunningServer {
  url: string;
  stop(): Promise<void>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function createInbox(ws: WebSocket): Inbox {
  const messages: WireMessage[] = [];
  const waiters: Array<{
    match: (message: WireMessage) => boolean;
    resolve: (message: WireMessage) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];
  let closed: { code: number; reason: string } | null = null;
  const closeWaiters: Array<{
    resolve: (close: { code: number; reason: string }) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  ws.on('error', () => {
    // A close-frame or handshake error is observed through the close/inbox waiters.
  });

  ws.on('message', (data: Buffer) => {
    let message: WireMessage;
    try {
      message = JSON.parse(data.toString()) as WireMessage;
    } catch {
      return;
    }
    const index = waiters.findIndex((waiter) => waiter.match(message));
    if (index >= 0) {
      const [waiter] = waiters.splice(index, 1);
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      }
      return;
    }
    messages.push(message);
  });

  ws.on('close', (code: number, reason: Buffer) => {
    closed = { code, reason: reason.toString() };
    while (closeWaiters.length > 0) {
      const waiter = closeWaiters.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve(closed);
      }
    }
  });

  return {
    waitFor(match, timeoutMs = 2500) {
      const index = messages.findIndex(match);
      if (index >= 0) {
        const [message] = messages.splice(index, 1);
        if (message) return Promise.resolve(message);
      }
      return new Promise<WireMessage>((resolveWait, rejectWait) => {
        const waiter = {
          match,
          resolve: resolveWait,
          reject: rejectWait,
          timer: setTimeout(() => {
            const at = waiters.indexOf(waiter);
            if (at >= 0) waiters.splice(at, 1);
            rejectWait(new Error('timed out waiting for a socket message'));
          }, timeoutMs),
        };
        waiters.push(waiter);
      });
    },
    waitForClose(timeoutMs = 2500) {
      if (closed) return Promise.resolve(closed);
      return new Promise((resolveWait, rejectWait) => {
        const waiter = {
          resolve: resolveWait,
          reject: rejectWait,
          timer: setTimeout(() => {
            const at = closeWaiters.indexOf(waiter);
            if (at >= 0) closeWaiters.splice(at, 1);
            rejectWait(new Error('timed out waiting for the socket to close'));
          }, timeoutMs),
        };
        closeWaiters.push(waiter);
      });
    },
  };
}

async function connect(url: string): Promise<SocketClient> {
  const ws = new WebSocket(url, { handshakeTimeout: 2_000 });
  const inbox = createInbox(ws);
  await new Promise<void>((resolveOpen, rejectOpen) => {
    ws.once('open', () => resolveOpen());
    ws.once('error', rejectOpen);
  });
  return { ws, inbox };
}

function send(ws: WebSocket, type: number, payload: unknown): void {
  ws.send(JSON.stringify({ type, payload }));
}

async function hello(url: string): Promise<SocketClient> {
  const client = await connect(url);
  send(client.ws, MESSAGE_TYPE.HELLO, { clientVersion: PROTOCOL_VERSION });
  await client.inbox.waitFor((message) => message.type === MESSAGE_TYPE.WELCOME);
  return client;
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    probe.once('error', rejectListen);
    probe.listen(0, '127.0.0.1', () => resolveListen());
  });
  const address = probe.address();
  await new Promise<void>((resolveClose, rejectClose) => {
    probe.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
  if (!address || typeof address === 'string') throw new Error('no probe port');
  return address.port;
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = once(child, 'exit');
  if (child.exitCode !== null) return;
  child.kill();
  await Promise.race([exited, delay(2_000)]);
  if (child.exitCode === null) {
    const killed = once(child, 'exit');
    child.kill('SIGKILL');
    await Promise.race([killed, delay(2_000)]);
  }
}

async function startServer(configDirectory = configDir): Promise<RunningServer> {
  const port = await freePort();
  const child: ChildProcess = spawn(process.execPath, ['src/main.ts'], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      CONFIG_DIR: configDirectory,
      NODE_ENV: 'local',
      LOG_LEVEL: 'error',
      DATABASE_URL: '',
      READINESS_REQUIRES_DB: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  const spawnError: { current: Error | null } = { current: null };
  child.once('error', (error) => {
    spawnError.current = error;
  });
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (spawnError.current) {
      await stopChild(child);
      throw new Error(`server failed to spawn: ${spawnError.current.message}\n${output}`);
    }
    if (child.exitCode !== null) {
      await stopChild(child);
      throw new Error(`server exited before readiness:\n${output}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) {
        return {
          url: `ws://127.0.0.1:${port}`,
          stop: () => stopChild(child),
        };
      }
    } catch {
      // The listener is not up yet.
    }
    await delay(50);
  }

  await stopChild(child);
  throw new Error(`server did not become ready:\n${output}`);
}

describe('socket admission, reply and action caps', () => {
  let defaultServer: RunningServer | null = null;

  after(async () => {
    await defaultServer?.stop();
  });

  it('cooldowns all expensive replies and refuses the ninth action', async () => {
    defaultServer = await startServer();
    const client = await hello(defaultServer.url);

    // The HELLO reply already carries one whole-grid snapshot; consume it
    // before testing the request-driven copy.
    await client.inbox.waitFor(
      (message) =>
        message.type === MESSAGE_TYPE.RESOURCE_UPDATE && message.payload.fullGrid === true,
      5000,
    );
    send(client.ws, MESSAGE_TYPE.RESOURCE_QUERY, { fullGrid: true });
    await client.inbox.waitFor(
      (message) =>
        message.type === MESSAGE_TYPE.RESOURCE_UPDATE && message.payload.fullGrid === true,
      5000,
    );
    send(client.ws, MESSAGE_TYPE.RESOURCE_QUERY, { fullGrid: true });
    await assert.rejects(
      client.inbox.waitFor(
        (message) =>
          message.type === MESSAGE_TYPE.RESOURCE_UPDATE && message.payload.fullGrid === true,
        350,
      ),
      /timed out/,
      'the second full-grid request inside 5 s must be dropped',
    );

    send(client.ws, MESSAGE_TYPE.TERRAIN_REGION_REQUEST, {
      worldX: 0,
      worldZ: 0,
      radiusM: 4,
    });
    await client.inbox.waitFor((message) => message.type === MESSAGE_TYPE.TERRAIN_REGION);
    send(client.ws, MESSAGE_TYPE.TERRAIN_REGION_REQUEST, {
      worldX: 0,
      worldZ: 0,
      radiusM: 4,
    });
    await assert.rejects(
      client.inbox.waitFor((message) => message.type === MESSAGE_TYPE.TERRAIN_REGION, 350),
      /timed out/,
      'the second terrain-region request inside 2 s must be dropped',
    );

    send(client.ws, MESSAGE_TYPE.PLANT_SYNC_REQUEST, {});
    await client.inbox.waitFor((message) => message.type === MESSAGE_TYPE.PLANT_SYNC);

    send(client.ws, MESSAGE_TYPE.PLANT_SYNC_REQUEST, {});
    await assert.rejects(
      client.inbox.waitFor((message) => message.type === MESSAGE_TYPE.PLANT_SYNC, 350),
      /timed out/,
      'the second plant sync inside 2 s must be dropped',
    );

    for (let i = 0; i < 9; i += 1) {
      send(client.ws, MESSAGE_TYPE.SHOP_PURCHASE, { itemId: 'not-in-the-catalogue' });
    }
    for (let i = 0; i < 8; i += 1) {
      const rejection = await client.inbox.waitFor(
        (message) => message.type === MESSAGE_TYPE.REJECT,
      );
      assert.equal(rejection.payload.originalType, MESSAGE_TYPE.SHOP_PURCHASE);
      assert.equal(rejection.payload.reason, 'unknown_item');
    }
    const refusal = await client.inbox.waitFor(
      (message) =>
        message.type === MESSAGE_TYPE.ERROR && message.payload.code === 'action_rate_limit',
    );
    assert.equal(refusal.payload.code, 'action_rate_limit');

    client.ws.close();
    await client.inbox.waitForClose();
    // The server releases the address slot in its close handler; let that run
    // before the next test opens the full address allowance.
    await delay(100);
  });

  it('sends SERVER_FULL then closes 1013 when the address socket cap is reached', async () => {
    if (!defaultServer) defaultServer = await startServer();
    const server = defaultServer;
    const admitted = await Promise.all(Array.from({ length: 32 }, () => connect(server.url)));

    const rejected = new WebSocket(server.url, { handshakeTimeout: 2_000 });
    const rejectedInbox = createInbox(rejected);
    const error = await rejectedInbox.waitFor(
      (message) => message.type === MESSAGE_TYPE.ERROR && message.payload.code === 'SERVER_FULL',
    );
    assert.equal(error.payload.code, 'SERVER_FULL');
    const close = await rejectedInbox.waitForClose();
    assert.equal(close.code, 1013);

    for (const client of admitted) client.ws.close();
    await Promise.all(admitted.map((client) => client.inbox.waitForClose()));

    // Closing all 32 sockets must release their address slots. A fresh HELLO
    // is admitted only if the count was actually decremented, and WELCOME
    // proves the socket survived admission rather than being closed after open.
    const replacement = await hello(server.url);
    replacement.ws.close();
    await replacement.inbox.waitForClose();
  });

  it('serves spawn options and accepts a paid coordinate with its archetype', async () => {
    if (!defaultServer) defaultServer = await startServer();
    const httpUrl = defaultServer.url.replace(/^ws:/, 'http:');
    const optionsResponse = await fetch(`${httpUrl}/spawn/options`);
    assert.equal(optionsResponse.status, 200);
    const options = (await optionsResponse.json()) as {
      archetypes: Array<{ id: string }>;
      namedAreas: Array<{ id: string; cost: number }>;
      exactCoordinateCost: number;
      playRadiusM: number;
      balance: number;
      enabled: boolean;
    };
    assert.equal(options.enabled, true);
    assert.equal(options.archetypes.length, 4);
    assert.ok(options.namedAreas.length >= 4);
    assert.equal(options.playRadiusM, 620);
    assert.equal(options.exactCoordinateCost, 40);
    assert.equal(options.balance, 120);

    const client = await connect(defaultServer.url);
    send(client.ws, MESSAGE_TYPE.HELLO, {
      clientVersion: PROTOCOL_VERSION,
      spawn: {
        archetypeId: 'deeproot',
        latitudeDeg: 89.95,
        longitudeDeg: 45,
      },
    });
    const welcome = await client.inbox.waitFor((message) => message.type === MESSAGE_TYPE.WELCOME);
    const archetype = welcome.payload.archetype as { id?: string; waterCapacity?: number };
    const spawn = welcome.payload.spawn as {
      label?: string;
      latitudeDeg?: number;
      areaId?: unknown;
    };
    assert.equal(archetype.id, 'deeproot');
    assert.ok((archetype.waterCapacity ?? 0) > 1, 'the archetype multipliers were not applied');
    assert.equal(typeof spawn.label, 'string');
    assert.ok(Math.abs((spawn.latitudeDeg ?? 0) - 89.95) < 0.01);
    assert.equal(spawn.areaId, null);
    client.ws.close();
    await client.inbox.waitForClose();
  });

  it('refuses a paid coordinate outside the playable disk and closes', async () => {
    if (!defaultServer) defaultServer = await startServer();
    const client = await connect(defaultServer.url);
    send(client.ws, MESSAGE_TYPE.HELLO, {
      clientVersion: PROTOCOL_VERSION,
      spawn: { latitudeDeg: 80, longitudeDeg: 0 },
    });
    const error = await client.inbox.waitFor(
      (message) => message.type === MESSAGE_TYPE.ERROR && message.payload.code === 'SPAWN_REFUSED',
    );
    assert.match(String(error.payload.message), /outside_play_area/);
    const close = await client.inbox.waitForClose();
    assert.equal(close.code, 4003);
    await delay(100);
  });

  it('refuses a paid spawn the starting purse cannot cover', async () => {
    const tempConfig = await mkdtemp(join(tmpdir(), 'plant-legacy-spawn-'));
    try {
      await cp(configDir, tempConfig, { recursive: true });
      const sporesPath = join(tempConfig, 'spores.json');
      const spores = JSON.parse(await readFile(sporesPath, 'utf8')) as {
        values: { starting_balance: { value: number } };
      };
      spores.values.starting_balance.value = 10;
      await writeFile(sporesPath, `${JSON.stringify(spores, null, 2)}\n`);

      const poor = await startServer(tempConfig);
      try {
        const client = await connect(poor.url);
        send(client.ws, MESSAGE_TYPE.HELLO, {
          clientVersion: PROTOCOL_VERSION,
          spawn: { latitudeDeg: 89.95, longitudeDeg: -45 },
        });
        const error = await client.inbox.waitFor(
          (message) =>
            message.type === MESSAGE_TYPE.ERROR && message.payload.code === 'SPAWN_REFUSED',
        );
        assert.match(String(error.payload.message), /insufficient_spores/);
        const close = await client.inbox.waitForClose();
        assert.equal(close.code, 4003);
      } finally {
        await poor.stop();
      }
    } finally {
      await rm(tempConfig, { recursive: true, force: true });
    }
  });

  it('enforces max_players_per_world with SERVER_FULL and 1013', async () => {
    const tempConfig = await mkdtemp(join(tmpdir(), 'plant-legacy-socket-'));
    try {
      await cp(configDir, tempConfig, { recursive: true });
      const worldPath = join(tempConfig, 'world.json');
      const world = JSON.parse(await readFile(worldPath, 'utf8')) as {
        values: { max_players_per_world: { value: number } };
      };
      world.values.max_players_per_world.value = 10;
      await writeFile(worldPath, `${JSON.stringify(world, null, 2)}\n`);

      const capped = await startServer(tempConfig);
      try {
        const admitted = [await hello(capped.url)];
        for (let i = 1; i < 10; i += 1) admitted.push(await hello(capped.url));

        const rejected = await connect(capped.url);
        send(rejected.ws, MESSAGE_TYPE.HELLO, { clientVersion: PROTOCOL_VERSION });
        const error = await rejected.inbox.waitFor(
          (message) =>
            message.type === MESSAGE_TYPE.ERROR && message.payload.code === 'SERVER_FULL',
        );
        assert.equal(error.payload.code, 'SERVER_FULL');
        const close = await rejected.inbox.waitForClose();
        assert.equal(close.code, 1013);
        for (const client of admitted) client.ws.close();
        await Promise.all(admitted.map((client) => client.inbox.waitForClose()));

        // Closing every player must free the world-cap slots. WELCOME proves
        // the replacement HELLO was admitted by player capacity, not just by
        // the socket address cap.
        const replacement = await hello(capped.url);
        replacement.ws.close();
        await replacement.inbox.waitForClose();
      } finally {
        await capped.stop();
      }
    } finally {
      await rm(tempConfig, { recursive: true, force: true });
    }
  });
});
