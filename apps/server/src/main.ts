import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import process from 'node:process';
import type { GrowthIntent } from '@plant-legacy/shared/growth';
import { WebSocket, WebSocketServer } from 'ws';
import { loadRuntimeConfig } from './core/config.ts';
import { SERVICE_VERSION } from './core/version.ts';
import { DatabaseProbe } from './ops/db.ts';
import { loadGrowthConfig } from './ops/growth.ts';
import { buildHealthReport, isReady } from './ops/health.ts';
import { createLogger } from './ops/log.ts';
import {
  type CubeState,
  createCube,
  type ErrorPayload,
  type HelloPayload,
  type InputPayload,
  type KeyframePayload,
  loadNetProtoConfig,
  MESSAGE_TYPE,
  type PlayerInput,
  type RejectPayload,
  type StatePayload,
  validateMovement,
  type WelcomePayload,
} from './ops/net.ts';
import { PlantWorld } from './ops/plantWorld.ts';

const STARTED_AT = Date.now();
const CUBE_COLORS = [
  0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff, 0xff8800, 0x8800ff,
];

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  response.end(payload);
}

function applyCors(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigins: readonly string[],
): void {
  const origin = request.headers.origin;
  if (typeof origin === 'string' && allowedOrigins.includes(origin)) {
    response.setHeader('access-control-allow-origin', origin);
    response.setHeader('vary', 'origin');
  }
}

interface ConnectedPlayer {
  ws: WebSocket;
  playerId: string;
  cubeId: string;
  plantId: string | null;
  lastInputTick: number;
  pendingInputs: Map<number, PlayerInput>;
  pendingGrowthIntents: Map<number, import('@plant-legacy/shared/growth').GrowthIntent>;
}

class CubeWorld {
  private cubes = new Map<string, CubeState>();
  private players = new Map<string, ConnectedPlayer>();
  private tick = 0;
  private config: ReturnType<typeof loadNetProtoConfig>;
  private log: ReturnType<typeof createLogger>;
  private tickInterval: NodeJS.Timeout | null = null;
  private plantWorld: PlantWorld;

  constructor(
    config: ReturnType<typeof loadNetProtoConfig>,
    log: ReturnType<typeof createLogger>,
    plantWorld: PlantWorld,
  ) {
    this.config = config;
    this.log = log;
    this.plantWorld = plantWorld;
  }

  addPlayer(
    ws: WebSocket,
    playerId: string,
  ): { cubeId: string; plantId: string; welcome: WelcomePayload } {
    const cubeId = `cube_${playerId}`;
    const colorIndex = this.cubes.size % CUBE_COLORS.length;
    const cube = createCube(cubeId, CUBE_COLORS[colorIndex]);

    // Position cubes in a circle
    const angle = (this.cubes.size / Math.max(1, this.players.size + 1)) * 2 * Math.PI;
    cube.x = Math.sin(angle) * 5;
    cube.z = Math.cos(angle) * 5;

    this.cubes.set(cubeId, cube);

    // Create a plant for this player
    const plant = this.plantWorld.createPlant(playerId, 'world_0', cube.x, cube.z);
    const plantId = plant.id;

    const player: ConnectedPlayer = {
      ws,
      playerId,
      cubeId,
      plantId,
      lastInputTick: 0,
      pendingInputs: new Map(),
      pendingGrowthIntents: new Map(),
    };
    this.players.set(playerId, player);

    const rootNodeId = plant.rootNodeId;
    const rootNode = rootNodeId != null ? plant.nodes.get(rootNodeId) : undefined;

    const welcome: WelcomePayload = {
      playerId,
      cubeId,
      plantId,
      tick: this.tick,
      cubes: Array.from(this.cubes.values()),
      rootNode: rootNode
        ? {
            id: rootNode.id,
            x: rootNode.x,
            y: rootNode.y,
            z: rootNode.z,
            type: 'root',
            biomass: rootNode.biomass,
          }
        : { id: rootNodeId ?? '', x: 0, y: 0, z: 0, type: 'root', biomass: 0 },
      totalBiomass: plant.totalBiomass,
    };

    this.log.info('player joined', { playerId, cubeId, plantId, totalPlayers: this.players.size });
    return { cubeId, plantId, welcome };
  }

  removePlayer(playerId: string): void {
    const player = this.players.get(playerId);
    if (player) {
      this.cubes.delete(player.cubeId);
      if (player.plantId) {
        this.plantWorld.removePlant(player.plantId);
      }
      this.players.delete(playerId);
      this.log.info('player left', {
        playerId,
        cubeId: player.cubeId,
        plantId: player.plantId,
        totalPlayers: this.players.size,
      });
    }
  }

  handleInput(playerId: string, input: PlayerInput): void {
    const player = this.players.get(playerId);
    if (!player) return;

    // Store input for processing on next tick
    player.pendingInputs.set(input.tick, input);
  }

  handleGrowthIntent(
    playerId: string,
    intent: import('@plant-legacy/shared/growth').GrowthIntent,
  ): void {
    const player = this.players.get(playerId);
    if (!player) return;
    player.pendingGrowthIntents.set(intent.tick, intent);
  }

  handlePing(ws: WebSocket): void {
    this.send(ws, MESSAGE_TYPE.PONG, {});
  }

  private send(ws: WebSocket, type: number, payload: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({ type, payload });
      ws.send(message);
    }
  }

  private broadcast(type: number, payload: unknown): void {
    const message = JSON.stringify({ type, payload });
    for (const player of this.players.values()) {
      if (player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(message);
      }
    }
  }

  private processInputs(): void {
    for (const [_playerId, player] of this.players.entries()) {
      const cube = this.cubes.get(player.cubeId);
      if (!cube) continue;

      // Process pending inputs in order
      const sortedTicks = Array.from(player.pendingInputs.keys()).sort((a, b) => a - b);

      for (const inputTick of sortedTicks) {
        if (inputTick <= player.lastInputTick) {
          player.pendingInputs.delete(inputTick);
          continue;
        }

        const input = player.pendingInputs.get(inputTick);
        if (!input) {
          player.pendingInputs.delete(inputTick);
          continue;
        }
        player.pendingInputs.delete(inputTick);

        const result = validateMovement(cube, input, this.config, this.tick);

        if (result.valid) {
          cube.x = result.newX;
          cube.z = result.newZ;
          cube.rotation = result.newRotation;
          cube.lastInputTick = inputTick;
          player.lastInputTick = inputTick;
        } else {
          // Send rejection for invalid movement
          const reject: RejectPayload = {
            reason: result.reason || 'invalid_movement',
            originalType: MESSAGE_TYPE.INPUT,
          };
          this.send(player.ws, MESSAGE_TYPE.REJECT, reject);

          // Resend current state to correct client
          const state: StatePayload = {
            tick: this.tick,
            cubes: Array.from(this.cubes.values()),
          };
          this.send(player.ws, MESSAGE_TYPE.STATE, state);
        }
      }
    }
  }

  step(): void {
    this.tick++;
    this.processInputs();
    this.processGrowthIntents();

    // Step plant world
    const dt = 1 / this.config.tickRateHz;
    this.plantWorld.step(dt);

    // Send state updates
    const isKeyframe = this.tick % this.config.keyframeIntervalTicks === 0;

    if (isKeyframe) {
      const keyframe: KeyframePayload = {
        tick: this.tick,
        cubes: Array.from(this.cubes.values()),
      };
      this.broadcast(MESSAGE_TYPE.KEYFRAME, keyframe);
    } else {
      const state: StatePayload = {
        tick: this.tick,
        cubes: Array.from(this.cubes.values()),
      };
      this.broadcast(MESSAGE_TYPE.STATE, state);
    }
  }

  private processGrowthIntents(): void {
    for (const [_playerId, player] of this.players.entries()) {
      if (!player.plantId) continue;
      const sortedTicks = Array.from(player.pendingGrowthIntents.keys()).sort((a, b) => a - b);

      for (const intentTick of sortedTicks) {
        const intent = player.pendingGrowthIntents.get(intentTick);
        if (!intent) {
          player.pendingGrowthIntents.delete(intentTick);
          continue;
        }
        player.pendingGrowthIntents.delete(intentTick);

        // Verify this is the player's plant
        if (intent.plantId !== player.plantId) continue;

        const result = this.plantWorld.tryGrow(intent);

        if (result.success && result.newNode) {
          // Broadcast growth event to all players
          const plant = this.plantWorld.getPlant(intent.plantId);
          const growthPayload = {
            plantId: intent.plantId,
            newNode: result.newNode,
            damageDealt: result.damageDealt,
            totalBiomass: plant?.totalBiomass ?? 0,
          };
          this.broadcast(MESSAGE_TYPE.GROWTH_EVENT, growthPayload);
        }
      }
    }
  }

  start(): void {
    const intervalMs = 1000 / this.config.tickRateHz;
    this.tickInterval = setInterval(() => this.step(), intervalMs);
    this.log.info('world simulation started', { tickRateHz: this.config.tickRateHz });
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  getTick(): number {
    return this.tick;
  }

  getCubes(): CubeState[] {
    return Array.from(this.cubes.values());
  }

  getPlayerCount(): number {
    return this.players.size;
  }
}

async function main(): Promise<void> {
  const { runtime, configs, configFileCount } = await loadRuntimeConfig();
  const log = createLogger(runtime.logLevel);
  const database = new DatabaseProbe(runtime.databaseUrl, {
    max: runtime.dbPoolMax,
    connectTimeoutMs: runtime.dbConnectTimeoutMs,
    idleTimeoutMs: runtime.dbIdleTimeoutMs,
  });

  const netProtoConfig = loadNetProtoConfig(configs);
  const growthConfig = loadGrowthConfig(configs);

  // Plant growth world (T01)
  const plantWorld = new PlantWorld(growthConfig, {
    minX: netProtoConfig.worldBounds.minX,
    maxX: netProtoConfig.worldBounds.maxX,
    minZ: netProtoConfig.worldBounds.minZ,
    maxZ: netProtoConfig.worldBounds.maxZ,
    minY: -100,
    maxY: 100,
  });

  const world = new CubeWorld(netProtoConfig, log, plantWorld);

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    applyCors(request, response, runtime.corsOrigins);
    const method = request.method ?? 'GET';

    if (method === 'OPTIONS') {
      response.writeHead(204, {
        'access-control-allow-methods': 'GET, HEAD, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '600',
      });
      response.end();
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(response, 405, { error: 'method_not_allowed' });
      return;
    }

    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    if (url.pathname === runtime.healthPath || url.pathname === runtime.readinessPath) {
      const report = buildHealthReport({
        version: SERVICE_VERSION,
        uptimeSeconds: (Date.now() - STARTED_AT) / 1000,
        database: await database.ping(),
        configFiles: configFileCount,
      });

      if (url.pathname === runtime.healthPath) {
        sendJson(response, 200, report);
        return;
      }

      const ready = isReady(report, runtime.readinessRequiresDb);
      sendJson(response, ready ? 200 : 503, { ready, ...report });
      return;
    }

    if (url.pathname === '/') {
      sendJson(response, 200, {
        name: 'plant-legacy-server',
        version: SERVICE_VERSION,
        world: 'cube-prototype',
        note: 'T03P Networking Gate - Two-tab server-authoritative cubes',
      });
      return;
    }

    if (url.pathname === '/config/onboarding') {
      // T00A: Serve onboarding config
      const fs = await import('node:fs/promises');
      const path = await import('node:path');

      try {
        const configDir = runtime.configDir;
        const onboardingPath = path.resolve(configDir, 'onboarding.json');
        const raw = await fs.readFile(onboardingPath, 'utf8');
        const config = JSON.parse(raw);

        // Extract values from extended-1 format
        const values = config.values || {};
        const hintCardLines = values.hint_card_lines?.value || [
          'WASD / Arrows: Move  |  Mouse: Orbit camera  |  Scroll: Zoom',
          'You are a plant. Grow roots down, canopy up. Read light, water, minerals.',
          'Other players are other plants. Compete, ally, or parasitize. The world simulates offline.',
        ];
        const showHintCardDurationMs = values.show_hint_card_duration_ms?.value || 10000;
        const resourceTooltips = values.resource_tooltips?.value || {
          light: 'Light: canopy exposure. Higher = faster photosynthesis.',
          water: 'Water: root access to moisture. Depletes near other roots.',
          minerals: 'Minerals: root access to nutrients. Concentrated in soil layers.',
        };

        sendJson(response, 200, {
          hint_card_lines: hintCardLines,
          show_hint_card_duration_ms: showHintCardDurationMs,
          resource_tooltips: resourceTooltips,
        });
        return;
      } catch {
        // Fallback to defaults
        sendJson(response, 200, {
          hint_card_lines: [
            'WASD / Arrows: Move  |  Mouse: Orbit camera  |  Scroll: Zoom',
            'You are a plant. Grow roots down, canopy up. Read light, water, minerals.',
            'Other players are other plants. Compete, ally, or parasitize. The world simulates offline.',
          ],
          show_hint_card_duration_ms: 10000,
          resource_tooltips: {
            light: 'Light: canopy exposure. Higher = faster photosynthesis.',
            water: 'Water: root access to moisture. Depletes near other roots.',
            minerals: 'Minerals: root access to nutrients. Concentrated in soil layers.',
          },
        });
        return;
      }
    }

    if (url.pathname === '/config/plant_renderer') {
      // T01: Serve plant renderer config
      const fs = await import('node:fs/promises');
      const path = await import('node:path');

      try {
        const configDir = runtime.configDir;
        const plantRendererPath = path.resolve(configDir, 'plant_renderer.json');
        const raw = await fs.readFile(plantRendererPath, 'utf8');
        const config = JSON.parse(raw);

        // Extract values from extended-1 format
        const values = config.values || {};
        const plantRendererConfig = {
          max_nodes_per_plant: values.max_nodes_per_plant?.value ?? 1000,
          root_max_depth: values.root_max_depth?.value ?? 50.0,
          canopy_max_height: values.canopy_max_height?.value ?? 50.0,
          node_spacing_min: values.node_spacing_min?.value ?? 0.5,
          node_spacing_max: values.node_spacing_max?.value ?? 2.0,
          branch_probability: values.branch_probability?.value ?? 0.15,
          root_sight_enabled: values.root_sight_enabled?.value ?? true,
          root_sight_opacity: values.root_sight_opacity?.value ?? 0.6,
          canopy_sight_enabled: values.canopy_sight_enabled?.value ?? true,
          photosynthesis_visualization: values.photosynthesis_visualization?.value ?? true,
          water_flow_visualization: values.water_flow_visualization?.value ?? true,
          nutrient_flow_visualization: values.nutrient_flow_visualization?.value ?? true,
          shader_quality: values.shader_quality?.value ?? 'high',
          max_gpu_buffers: values.max_gpu_buffers?.value ?? 8,
          compute_shader_workgroup_size: values.compute_shader_workgroup_size?.value ?? 64,
        };

        sendJson(response, 200, plantRendererConfig);
        return;
      } catch {
        // Fallback to defaults
        sendJson(response, 200, {
          max_nodes_per_plant: 1000,
          root_max_depth: 50.0,
          canopy_max_height: 50.0,
          node_spacing_min: 0.5,
          node_spacing_max: 2.0,
          branch_probability: 0.15,
          root_sight_enabled: true,
          root_sight_opacity: 0.6,
          canopy_sight_enabled: true,
          photosynthesis_visualization: true,
          water_flow_visualization: true,
          nutrient_flow_visualization: true,
          shader_quality: 'high',
          max_gpu_buffers: 8,
          compute_shader_workgroup_size: 64,
        });
        return;
      }
    }

    sendJson(response, 404, { error: 'not_found' });
  };

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      log.error('request failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      if (!response.headersSent) sendJson(response, 500, { error: 'internal_error' });
      else response.end();
    });
  });

  // WebSocket server
  const wss = new WebSocketServer({ server, maxPayload: netProtoConfig.maxMessageSizeBytes });

  wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
    const origin = request.headers.origin;
    if (origin && !runtime.corsOrigins.includes(origin)) {
      log.warn('websocket connection rejected: origin not allowed', { origin });
      ws.close(4001, 'Origin not allowed');
      return;
    }

    const playerId = `player_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const { welcome } = world.addPlayer(ws, playerId);

    // Send welcome message with plant info
    const welcomeMsg = JSON.stringify({
      type: MESSAGE_TYPE.WELCOME,
      payload: { ...welcome, plantId: welcome.plantId },
    });
    ws.send(welcomeMsg);

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        const { type, payload } = message;

        switch (type) {
          case MESSAGE_TYPE.INPUT: {
            const inputPayload = payload as InputPayload;
            if (inputPayload.input && typeof inputPayload.input.tick === 'number') {
              world.handleInput(playerId, inputPayload.input);
            }
            break;
          }
          case MESSAGE_TYPE.GROWTH_INTENT: {
            const growthIntent = payload as { intent: GrowthIntent };
            if (growthIntent?.intent && typeof growthIntent.intent.tick === 'number') {
              world.handleGrowthIntent(playerId, growthIntent.intent);
            }
            break;
          }
          case MESSAGE_TYPE.PING: {
            world.handlePing(ws);
            break;
          }
          case MESSAGE_TYPE.HELLO: {
            // Client version check
            const hello = payload as HelloPayload;
            if (hello.clientVersion !== netProtoConfig.protocolVersion) {
              const error: ErrorPayload = {
                code: 'VERSION_MISMATCH',
                message: `Protocol version mismatch: server=${netProtoConfig.protocolVersion}, client=${hello.clientVersion}`,
              };
              const errorMsg = JSON.stringify({ type: MESSAGE_TYPE.ERROR, payload: error });
              ws.send(errorMsg);
              ws.close(4002, 'Version mismatch');
            }
            break;
          }
          default:
            log.warn('unknown message type', { type, playerId });
        }
      } catch (error) {
        log.error('websocket message parse error', {
          error: error instanceof Error ? error.message : String(error),
          playerId,
        });
      }
    });

    ws.on('close', () => {
      world.removePlayer(playerId);
    });

    ws.on('error', (error: Error) => {
      log.error('websocket error', { error: error.message, playerId });
    });
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutting down', { signal });

    world.stop();

    const forceExit = setTimeout(() => {
      log.error('shutdown timed out', { graceMs: runtime.shutdownGraceMs });
      process.exit(1);
    }, runtime.shutdownGraceMs);
    forceExit.unref();

    wss.close(() => {
      server.close(() => {
        database
          .close()
          .catch(() => undefined)
          .finally(() => process.exit(0));
      });
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  server.listen(runtime.port, runtime.host, () => {
    log.info('listening', {
      host: runtime.host,
      port: runtime.port,
      env: runtime.nodeEnv,
      database: database.configured ? 'configured' : 'skipped',
      version: SERVICE_VERSION,
    });

    world.start();
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
