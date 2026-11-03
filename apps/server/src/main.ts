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
import { InterestManager } from './ops/interestManager.ts';
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
  type PlantCreatedPayload,
  type PlantSyncPayload,
  type PlayerInput,
  type RejectPayload,
  type ResourceQueryPayload,
  type StatePayload,
  validateMovement,
  type WelcomePayload,
} from './ops/net.ts';
import { PlantPersistence } from './ops/persistence/plantPersistence.ts';
import { PlantWorld } from './ops/plantWorld.ts';
import { loadResourcesConfig, type PlantForResource, ResourceWorld } from './ops/resourceWorld.ts';
import { loadWorldConfig } from './ops/world.ts';

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
  private resourceWorld: ResourceWorld;
  private interestManager: InterestManager;

  getPlayers(): Map<string, ConnectedPlayer> {
    return this.players;
  }

  getPlantWorld(): PlantWorld {
    return this.plantWorld;
  }

  sendTo(ws: WebSocket, type: number, payload: unknown): void {
    this.send(ws, type, payload);
  }

  constructor(
    config: ReturnType<typeof loadNetProtoConfig>,
    log: ReturnType<typeof createLogger>,
    plantWorld: PlantWorld,
    resourceWorld: ResourceWorld,
    interestManager: InterestManager,
  ) {
    this.config = config;
    this.log = log;
    this.plantWorld = plantWorld;
    this.resourceWorld = resourceWorld;
    this.interestManager = interestManager;
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

    // Register with interest manager
    this.interestManager.registerClient(playerId, cube.x, cube.z);

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

    // Send PLANT_SYNC with only active players' plants to the new player
    const activePlantIds = new Set<string>();
    for (const player of this.players.values()) {
      if (player.plantId) activePlantIds.add(player.plantId);
    }
    // Also include the new player's plant
    activePlantIds.add(plantId);

    const allPlants = this.plantWorld.getAllPlants();
    const activePlants = allPlants.filter((p) => activePlantIds.has(p.id));
    const syncPayload: PlantSyncPayload = {
      plants: activePlants.map((p) => ({
        id: p.id,
        ownerId: p.ownerId,
        rootNodeId: p.rootNodeId,
        totalBiomass: p.totalBiomass,
        totalUpkeep: p.totalUpkeep,
        nodes: Array.from(p.nodes.values()).map((n) => ({
          id: n.id,
          plantId: n.plantId,
          type: n.type,
          layer: n.layer,
          x: n.x,
          y: n.y,
          z: n.z,
          biomass: n.biomass,
          age: n.age,
          parentId: n.parentId,
          children: n.children,
          statModifiers: n.statModifiers,
          resourceDrawWater: n.resourceDrawWater,
          resourceDrawNutrients: n.resourceDrawNutrients,
          upkeepBiomassPerSecond: n.upkeepBiomassPerSecond,
          growthDirectionBias: n.growthDirectionBias,
          lastGrowthTick: n.lastGrowthTick,
        })),
      })),
    };
    this.send(ws, MESSAGE_TYPE.PLANT_SYNC, syncPayload);

    // Broadcast PLANT_CREATED to all other players
    const createdPayload: PlantCreatedPayload = {
      plant: {
        id: plant.id,
        ownerId: plant.ownerId,
        rootNodeId: plant.rootNodeId,
        totalBiomass: plant.totalBiomass,
        totalUpkeep: plant.totalUpkeep,
        nodes: Array.from(plant.nodes.values()).map((n) => ({
          id: n.id,
          plantId: n.plantId,
          type: n.type,
          layer: n.layer,
          x: n.x,
          y: n.y,
          z: n.z,
          biomass: n.biomass,
          age: n.age,
          parentId: n.parentId,
          children: n.children,
          statModifiers: n.statModifiers,
          resourceDrawWater: n.resourceDrawWater,
          resourceDrawNutrients: n.resourceDrawNutrients,
          upkeepBiomassPerSecond: n.upkeepBiomassPerSecond,
          growthDirectionBias: n.growthDirectionBias,
          lastGrowthTick: n.lastGrowthTick,
        })),
      },
    };
    this.broadcast(MESSAGE_TYPE.PLANT_CREATED, createdPayload);

    return { cubeId, plantId, welcome };
  }

  removePlayer(playerId: string): void {
    const player = this.players.get(playerId);
    if (player) {
      this.cubes.delete(player.cubeId);
      this.interestManager.unregisterClient(playerId);
      if (player.plantId) {
        const plant = this.plantWorld.getPlant(player.plantId);
        if (plant?.rootNodeId) {
          this.resourceWorld.onPlantDeath({
            id: plant.id,
            ownerId: plant.ownerId,
            worldId: plant.worldId,
            nodes: plant.nodes,
            totalBiomass: plant.totalBiomass,
            totalUpkeep: plant.totalUpkeep,
            rootNodeId: plant.rootNodeId,
          });
        }
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

    // Update interest manager with player positions
    for (const player of this.players.values()) {
      const cube = this.cubes.get(player.cubeId);
      if (cube) {
        this.interestManager.updateClientPosition(player.playerId, cube.x, cube.z);
      }
    }

    // Collect online plant IDs for tier management
    const onlinePlantIds = new Set<string>();
    for (const player of this.players.values()) {
      if (player.plantId) {
        onlinePlantIds.add(player.plantId);
      }
    }

    // Step plant world with tier support (T03)
    const dt = 1 / this.config.tickRateHz;
    const tierTiming = this.plantWorld.step(dt, onlinePlantIds);

    // Step resource world (T00A)
    const plantsForResource = new Map<string, PlantForResource>();
    for (const player of this.players.values()) {
      if (player.plantId) {
        const plant = this.plantWorld.getPlant(player.plantId);
        if (plant) {
          plantsForResource.set(plant.id, {
            id: plant.id,
            ownerId: plant.ownerId,
            worldId: plant.worldId,
            nodes: plant.nodes,
            totalBiomass: plant.totalBiomass,
            totalUpkeep: plant.totalUpkeep,
            rootNodeId: plant.rootNodeId ?? '',
          });
        }
      }
    }
    this.resourceWorld.step(dt, plantsForResource);

    // Apply photosynthesis biomass gain
    for (const plant of plantsForResource.values()) {
      const biomassGain = this.resourceWorld.calculatePhotosynthesis(plant);
      if (biomassGain > 0) {
        const realPlant = this.plantWorld.getPlant(plant.id);
        if (realPlant) {
          realPlant.totalBiomass += biomassGain * dt;
        }
      }
    }

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

    // Broadcast resource updates every tick (T00A)
    const resourceState = this.resourceWorld.getState();
    this.broadcast(MESSAGE_TYPE.RESOURCE_UPDATE, {
      tick: this.tick,
      tiles: resourceState.tiles,
      width: resourceState.width,
      height: resourceState.height,
      tileSize: resourceState.tileSize,
    });

    // Log tick budget periodically
    if (this.tick % 100 === 0) {
      const total = tierTiming.activeMs + tierTiming.nearMs + tierTiming.dormantMs;
      this.log.debug('tick budget', {
        tick: this.tick,
        activeMs: tierTiming.activeMs.toFixed(2),
        nearMs: tierTiming.nearMs.toFixed(2),
        dormantMs: tierTiming.dormantMs.toFixed(2),
        totalMs: total.toFixed(2),
        tierStats: this.plantWorld.getTierStats(),
      });
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

  getTileResources(
    tileX: number,
    tileZ: number,
  ): { light: number; moisture: number; minerals: number } | null {
    return this.resourceWorld.getTileResourcesAt(tileX, tileZ);
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

  // Initialize database and run migrations (T03)
  await database.initialize();

  const netProtoConfig = loadNetProtoConfig(configs);
  const growthConfig = loadGrowthConfig(configs);
  const worldConfig = loadWorldConfig(configs);

  // Plant growth world (T01) with T03 tier support
  const plantWorld = new PlantWorld(
    growthConfig,
    {
      minX: netProtoConfig.worldBounds.minX,
      maxX: netProtoConfig.worldBounds.maxX,
      minZ: netProtoConfig.worldBounds.minZ,
      maxZ: netProtoConfig.worldBounds.maxZ,
      minY: -100,
      maxY: 100,
    },
    {
      activeTickRateHz: worldConfig.activeTickRateHz,
      nearTickRateHz: worldConfig.nearTickRateHz,
      dormantStepIntervalSec: worldConfig.dormantStepIntervalSec,
      offlineDamageMultiplier: worldConfig.offlineDamageMultiplier,
      tickBudgetActiveShare: worldConfig.tickBudgetActiveShare,
      tickBudgetWarnThresholdMs: worldConfig.tickBudgetWarnThresholdMs,
    },
  );

  // Resource world (T00A)
  const resourcesConfig = loadResourcesConfig(configs);
  const resourceWorld = new ResourceWorld(resourcesConfig, {
    minX: netProtoConfig.worldBounds.minX,
    maxX: netProtoConfig.worldBounds.maxX,
    minZ: netProtoConfig.worldBounds.minZ,
    maxZ: netProtoConfig.worldBounds.maxZ,
  });

  // Persistence layer (T03)
  const worldId = 'world_0';
  let plantPersistence: PlantPersistence | null = null;
  if (database.pool) {
    plantPersistence = new PlantPersistence(database.pool, worldId);
    // Load existing plants
    const loadedPlants = await plantPersistence.loadAllPlants();
    for (const loaded of loadedPlants) {
      // Reconstruct Plant from snapshot
      const plant = {
        id: loaded.id,
        ownerId: loaded.ownerId,
        worldId: loaded.worldId,
        nodes: loaded.nodes,
        rootNodeId: loaded.rootNodeId,
        totalBiomass: loaded.totalBiomass,
        totalUpkeep: loaded.totalUpkeep,
        lastGrowthTick: loaded.lastGrowthTick,
        growthCooldownUntil: loaded.growthCooldownUntil,
        tier: loaded.tier,
        lastTick: loaded.lastTick,
      };
      plantWorld.loadPlant(plant);
    }
    log.info('loaded plants from database', { count: loadedPlants.length });
  }

  // Interest management (T03)
  const interestManager = new InterestManager(worldConfig);

  const world = new CubeWorld(netProtoConfig, log, plantWorld, resourceWorld, interestManager);

  // Periodic plant persistence (T03)
  let saveInterval: NodeJS.Timeout | null = null;
  if (plantPersistence) {
    const saveIntervalMs = 30000; // 30 seconds
    saveInterval = setInterval(async () => {
      try {
        const plants = plantWorld.getAllPlants();
        for (const plant of plants) {
          await plantPersistence.savePlant(plant);
        }
        log.debug('periodic plant save', { count: plants.length });
      } catch (error) {
        log.error('periodic plant save failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, saveIntervalMs);
    saveInterval.unref();
  }

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
          tube_ring_count: values.tube_ring_count?.value ?? 8,
          tube_length_segments: values.tube_length_segments?.value ?? 4,
          leaf_count_per_node: values.leaf_count_per_node?.value ?? 3,
          leaf_size: values.leaf_size?.value ?? 1.5,
          leaf_length_width_ratio: values.leaf_length_width_ratio?.value ?? 2.5,
          l0_distance: values.l0_distance?.value ?? 50.0,
          l1_distance: values.l1_distance?.value ?? 150.0,
          l2_distance: values.l2_distance?.value ?? 500.0,
          triangle_budget_l0: values.triangle_budget_l0?.value ?? 1500,
          triangle_budget_l1: values.triangle_budget_l1?.value ?? 800,
          wind_strength: values.wind_strength?.value ?? 0.3,
          wind_speed: values.wind_speed?.value ?? 1.0,
          health_tint_strength: values.health_tint_strength?.value ?? 0.5,
          mutation_visual_0_param: values.mutation_visual_0_param?.value ?? 1.0,
          mutation_visual_1_param: values.mutation_visual_1_param?.value ?? 1.5,
          mutation_visual_2_param: values.mutation_visual_2_param?.value ?? 0.3,
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
          tube_ring_count: 8,
          tube_length_segments: 4,
          leaf_count_per_node: 3,
          leaf_size: 1.5,
          leaf_length_width_ratio: 2.5,
          l0_distance: 50.0,
          l1_distance: 150.0,
          l2_distance: 500.0,
          triangle_budget_l0: 1500,
          triangle_budget_l1: 800,
          wind_strength: 0.3,
          wind_speed: 1.0,
          health_tint_strength: 0.5,
          mutation_visual_0_param: 1.0,
          mutation_visual_1_param: 1.5,
          mutation_visual_2_param: 0.3,
        });
        return;
      }
    }

    if (url.pathname === '/config/render') {
      // C01: Serve render config
      const fs = await import('node:fs/promises');
      const path = await import('node:path');

      try {
        const configDir = runtime.configDir;
        const renderPath = path.resolve(configDir, 'render.json');
        const raw = await fs.readFile(renderPath, 'utf8');
        const config = JSON.parse(raw);

        const values = config.values || {};
        const renderConfig = {
          target_fps: values.target_fps?.value ?? 60,
          fps_warning_threshold: values.fps_warning_threshold?.value ?? 0.85,
          resolution_floor: values.resolution_floor?.value ?? 0.25,
          max_pixel_ratio: values.max_pixel_ratio?.value ?? 2.0,
          camera_smoothing: values.camera_smoothing?.value ?? 0.05,
          camera_min_distance: values.camera_min_distance?.value ?? 10.0,
          camera_max_distance: values.camera_max_distance?.value ?? 200.0,
          camera_max_polar_angle: values.camera_max_polar_angle?.value ?? 1.52,
          idle_drop_timeout_ms: values.idle_drop_timeout_ms?.value ?? 30000,
          shadow_map_size: values.shadow_map_size?.value ?? 2048,
          debug_overlay_enabled: values.debug_overlay_enabled?.value ?? true,
          debug_overlay_key: values.debug_overlay_key?.value ?? '`',
          pause_on_hidden: values.pause_on_hidden?.value ?? true,
          quality_tiers: values.quality_tiers?.value ?? [
            {
              name: 'low',
              pixel_ratio: 1.0,
              shadow_map_size: 1024,
              max_triangles: 50000,
              antialiasing: false,
            },
            {
              name: 'medium',
              pixel_ratio: 1.5,
              shadow_map_size: 2048,
              max_triangles: 200000,
              antialiasing: true,
            },
            {
              name: 'high',
              pixel_ratio: 2.0,
              shadow_map_size: 2048,
              max_triangles: 500000,
              antialiasing: true,
            },
          ],
        };

        sendJson(response, 200, renderConfig);
        return;
      } catch {
        sendJson(response, 200, {
          target_fps: 60,
          fps_warning_threshold: 0.85,
          resolution_floor: 0.25,
          max_pixel_ratio: 2.0,
          camera_smoothing: 0.05,
          camera_min_distance: 10.0,
          camera_max_distance: 200.0,
          camera_max_polar_angle: 1.52,
          idle_drop_timeout_ms: 30000,
          shadow_map_size: 2048,
          debug_overlay_enabled: true,
          debug_overlay_key: '`',
          pause_on_hidden: true,
          quality_tiers: [
            {
              name: 'low',
              pixel_ratio: 1.0,
              shadow_map_size: 1024,
              max_triangles: 50000,
              antialiasing: false,
            },
            {
              name: 'medium',
              pixel_ratio: 1.5,
              shadow_map_size: 2048,
              max_triangles: 200000,
              antialiasing: true,
            },
            {
              name: 'high',
              pixel_ratio: 2.0,
              shadow_map_size: 2048,
              max_triangles: 500000,
              antialiasing: true,
            },
          ],
        });
        return;
      }
    }

    if (url.pathname === '/config/controls') {
      // C01: Serve controls config
      const fs = await import('node:fs/promises');
      const path = await import('node:path');

      try {
        const configDir = runtime.configDir;
        const controlsPath = path.resolve(configDir, 'controls.json');
        const raw = await fs.readFile(controlsPath, 'utf8');
        const config = JSON.parse(raw);

        const values = config.values || {};
        const bindingsArray = values.bindings_desktop?.value ?? [];
        const bindingsObj: Record<string, unknown> = {};
        for (const b of bindingsArray) {
          if (b.action) bindingsObj[b.action] = b;
        }
        const controlsConfig = {
          bindings: bindingsObj,
          touch_min_target_px: values.touch_min_target_px?.value ?? 44,
          hud_max_screen_fraction: values.hud_max_screen_fraction?.value ?? 0.2,
          root_sight_mode: values.root_sight_mode?.value ?? 'toggle',
          text_scale: values.text_scale?.value ?? 1.0,
          context_dock_fade_ms: values.context_dock_fade_ms?.value ?? 150,
        };

        sendJson(response, 200, controlsConfig);
        return;
      } catch {
        sendJson(response, 200, {
          bindings: {},
          touch_min_target_px: 44,
          hud_max_screen_fraction: 0.2,
          root_sight_mode: 'toggle',
          text_scale: 1.0,
          context_dock_fade_ms: 150,
        });
        return;
      }
    }

    if (url.pathname === '/config/ui') {
      // C01: Serve UI config
      const fs = await import('node:fs/promises');
      const path = await import('node:path');

      try {
        const configDir = runtime.configDir;
        const uiPath = path.resolve(configDir, 'ui.json');
        const raw = await fs.readFile(uiPath, 'utf8');
        const config = JSON.parse(raw);

        const values = config.values || {};
        const uiConfig = {
          text_scale: values.text_scale?.value ?? 1.0,
          layers: values.layers?.value ?? {
            world: 0,
            hud: 100,
            panel: 200,
            menu: 300,
            modal: 400,
            toast: 500,
            tooltip: 600,
            debug: 700,
          },
          theme: values.theme?.value ?? {},
          toast_duration_ms: values.toast_duration_ms?.value ?? 4000,
          toast_max_stack: values.toast_max_stack?.value ?? 5,
          hint_card_duration_ms: values.hint_card_duration_ms?.value ?? 10000,
          hint_card_max_lines: values.hint_card_max_lines?.value ?? 3,
          panel_default_width_px: values.panel_default_width_px?.value ?? 320,
          panel_animation_ms: values.panel_animation_ms?.value ?? 200,
          reduced_motion: values.reduced_motion?.value ?? false,
          safe_area_padding_px: values.safe_area_padding_px?.value ?? 8,
        };

        sendJson(response, 200, uiConfig);
        return;
      } catch {
        sendJson(response, 200, {
          text_scale: 1.0,
          layers: {
            world: 0,
            hud: 100,
            panel: 200,
            menu: 300,
            modal: 400,
            toast: 500,
            tooltip: 600,
            debug: 700,
          },
          theme: {},
          toast_duration_ms: 4000,
          toast_max_stack: 5,
          hint_card_duration_ms: 10000,
          hint_card_max_lines: 3,
          panel_default_width_px: 320,
          panel_animation_ms: 200,
          reduced_motion: false,
          safe_area_padding_px: 8,
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
          case MESSAGE_TYPE.RESOURCE_QUERY: {
            const query = payload as ResourceQueryPayload;
            if (typeof query.tileX === 'number' && typeof query.tileZ === 'number') {
              const resources = world.getTileResources(query.tileX, query.tileZ);
              if (resources) {
                const responseMsg = JSON.stringify({
                  type: MESSAGE_TYPE.RESOURCE_UPDATE,
                  payload: {
                    tick: world.getTick(),
                    tiles: [resources],
                    width: 1,
                    height: 1,
                    tileSize: 1,
                  },
                });
                ws.send(responseMsg);
              }
            }
            break;
          }
          case MESSAGE_TYPE.PLANT_SYNC_REQUEST: {
            // Send PLANT_SYNC with only active players' plants
            const activePlantIds = new Set<string>();
            for (const p of world.getPlayers().values()) {
              if (p.plantId) activePlantIds.add(p.plantId);
            }
            const allPlants = world.getPlantWorld().getAllPlants();
            const activePlants = allPlants.filter((p) => activePlantIds.has(p.id));
            const syncPayload: PlantSyncPayload = {
              plants: activePlants.map((p) => ({
                id: p.id,
                ownerId: p.ownerId,
                rootNodeId: p.rootNodeId,
                totalBiomass: p.totalBiomass,
                totalUpkeep: p.totalUpkeep,
                nodes: Array.from(p.nodes.values()).map((n) => ({
                  id: n.id,
                  plantId: n.plantId,
                  type: n.type,
                  layer: n.layer,
                  x: n.x,
                  y: n.y,
                  z: n.z,
                  biomass: n.biomass,
                  age: n.age,
                  parentId: n.parentId,
                  children: n.children,
                  statModifiers: n.statModifiers,
                  resourceDrawWater: n.resourceDrawWater,
                  resourceDrawNutrients: n.resourceDrawNutrients,
                  upkeepBiomassPerSecond: n.upkeepBiomassPerSecond,
                  growthDirectionBias: n.growthDirectionBias,
                  lastGrowthTick: n.lastGrowthTick,
                })),
              })),
            };
            world.sendTo(ws, MESSAGE_TYPE.PLANT_SYNC, syncPayload);
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
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutting down', { signal });

    world.stop();

    if (saveInterval) {
      clearInterval(saveInterval);
    }

    // Save all plants on shutdown
    if (plantPersistence) {
      const plants = plantWorld.getAllPlants();
      for (const plant of plants) {
        try {
          await plantPersistence.savePlant(plant);
        } catch (error) {
          log.error('shutdown plant save failed', {
            plantId: plant.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      log.info('saved plants on shutdown', { count: plants.length });
    }

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
