import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import process from 'node:process';
import { WebSocket, WebSocketServer } from 'ws';
import { loadRuntimeConfig } from './core/config.ts';
import { SERVICE_VERSION } from './core/version.ts';
import { loadAccountsConfig } from './ops/accounts/config.ts';
import { createAccountsHandlers, createAuthMiddleware } from './ops/accounts/http.ts';
import { AccountsService } from './ops/accounts/service.ts';
import {
  type ConnectionRegistry,
  connectionRegistryClearHelloTimer,
  connectionRegistryInstallHandler,
  connectionRegistryRegister,
  connectionRegistryRemove,
  connectionRegistrySetPlant,
  connectionRegistryTransferPlant,
  createConnectionRegistry,
} from './ops/connectionRegistry.ts';
import { DatabaseProbe } from './ops/db.ts';
import { loadGrowthConfig } from './ops/growth.ts';
import {
  createGrowthIntentStateMachine,
  type GrowthIntentStateMachine,
  growthIntentStateMachineClear,
  growthIntentStateMachineDrain,
  growthIntentStateMachineEnqueue,
} from './ops/growthIntentStateMachine.ts';
import { buildHealthReport, isReady } from './ops/health.ts';
import { InterestManager } from './ops/interestManager.ts';
import { createLogger } from './ops/log.ts';
import {
  type ErrorPayload,
  type HelloPayload,
  type KeyframePayload,
  loadNetProtoConfig,
  MESSAGE_TYPE,
  type PlantSyncPayload,
  type PlayerInput,
  type RejectPayload,
  type ResourceQueryPayload,
  type StatePayload,
  type WelcomePayload,
} from './ops/net.ts';
import { PlantPersistence } from './ops/persistence/plantPersistence.ts';
import { PlantWorld } from './ops/plantWorld.ts';
import {
  createReconnectStateMachine,
  type ReconnectStateMachine,
  reconnectStateMachineCancelPending,
  reconnectStateMachineReclaimByAccount,
  reconnectStateMachineReclaimByPlantId,
} from './ops/reconnectStateMachine.ts';
import { loadResourcesConfig, ResourceWorld } from './ops/resourceWorld.ts';
import { createTickClock, type TickClock, tickClockStart, tickClockStop } from './ops/tickClock.ts';
import { loadDayNightConfig, loadWeatherConfig, WeatherSystem } from './ops/weather.ts';
import { loadWorldConfig } from './ops/world.ts';

const STARTED_AT = Date.now();

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  response.end(payload);
}

function isAllowedOrigin(
  origin: string | undefined,
  allowedOrigins: readonly string[],
  nodeEnv = 'local',
): boolean {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (nodeEnv === 'local') {
    try {
      const u = new URL(origin);
      if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}

function applyCors(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigins: readonly string[],
  nodeEnv = 'local',
): void {
  const origin = request.headers.origin;
  if (typeof origin === 'string' && isAllowedOrigin(origin, allowedOrigins, nodeEnv)) {
    response.setHeader('access-control-allow-origin', origin);
    response.setHeader('vary', 'origin');
  }
}

interface ConnectedPlayer {
  ws: WebSocket;
  playerId: string;
  plantId: string | null;
  accountId: string | undefined;
  lastInputTick: number;
  pendingInputs: Map<number, PlayerInput>;
}

class World {
  private players = new Map<string, ConnectedPlayer>();
  private config: ReturnType<typeof loadNetProtoConfig>;
  private log: ReturnType<typeof createLogger>;
  private plantWorld: PlantWorld;
  private resourceWorld: ResourceWorld;
  private weatherSystem: WeatherSystem;
  private interestManager: InterestManager;
  private reconnectMachine: ReconnectStateMachine;
  private growthIntentMachine: GrowthIntentStateMachine;
  private connectionRegistry: ConnectionRegistry;
  private tickClock: TickClock;

  getPlayers(): Map<string, ConnectedPlayer> {
    return this.players;
  }

  getPlantWorld(): PlantWorld {
    return this.plantWorld;
  }

  getResourceWorld(): ResourceWorld {
    return this.resourceWorld;
  }

  getPlayer(playerId: string): ConnectedPlayer | undefined {
    return this.players.get(playerId);
  }

  getInterestManager(): InterestManager {
    return this.interestManager;
  }

  broadcast(type: number, payload: unknown): void {
    const message = JSON.stringify({ type, payload });
    for (const player of this.players.values()) {
      if (player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(message);
      }
    }
  }

  send(ws: WebSocket, type: number, payload: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload }));
    }
  }

  /**
   * Drain deaths queued by PlantWorld so each one is broadcast and deposited
   * exactly once. This covers simulation deaths (starvation, damage,
   * germination failure) as well as explicit removals.
   */
  processPlantDeaths(): void {
    const deaths = this.plantWorld.drainDeaths();
    for (const death of deaths) {
      reconnectStateMachineCancelPending(this.reconnectMachine, death.id, death.ownerId);
      try {
        this.resourceWorld.onPlantDeath({ ...death, rootNodeId: death.rootNodeId ?? '' });
      } catch (e) {
        this.log.error('resourceWorld.onPlantDeath failed', {
          plantId: death.id,
          error: String(e),
        });
      }
      for (const player of this.players.values()) {
        if (player.plantId === death.id) player.plantId = null;
      }
      try {
        this.broadcast(MESSAGE_TYPE.PLANT_REMOVED, { plantId: death.id });
      } catch (e) {
        this.log.error('PLANT_REMOVED broadcast failed', { plantId: death.id, error: String(e) });
      }
      // Remove plant entities from InterestManager
      if (death.rootNodeId) {
        const rootNode = death.nodes.get(death.rootNodeId);
        if (rootNode) {
          this.interestManager.removeEntityFromCell(death.id, rootNode.x, rootNode.z);
        }
      }
      // Also remove any other nodes that were tracked
      for (const node of death.nodes.values()) {
        if (node.id !== death.rootNodeId) {
          this.interestManager.removeEntityFromCell(node.id, node.x, node.z);
        }
      }
      this.log.info('plant died', {
        plantId: death.id,
        ownerId: death.ownerId,
        cause: death.cause,
      });
    }
  }

  constructor(
    config: ReturnType<typeof loadNetProtoConfig>,
    log: ReturnType<typeof createLogger>,
    plantWorld: PlantWorld,
    resourceWorld: ResourceWorld,
    weatherSystem: WeatherSystem,
    interestManager: InterestManager,
    reconnectWindowMs: number,
    persistenceEnabled: boolean,
    maxFrameTimeMs = 100,
  ) {
    this.config = config;
    this.log = log;
    this.plantWorld = plantWorld;
    this.resourceWorld = resourceWorld;
    this.weatherSystem = weatherSystem;
    this.interestManager = interestManager;
    this.reconnectMachine = createReconnectStateMachine(reconnectWindowMs, persistenceEnabled);
    this.growthIntentMachine = createGrowthIntentStateMachine(100);
    this.connectionRegistry = createConnectionRegistry(config.helloTimeoutMs);
    this.tickClock = createTickClock({
      tickRateHz: config.tickRateHz,
      maxFrameTimeMs,
      onTick: (tick: number, dt: number) => this.onTick(tick, dt),
      onError: (error: Error) => this.log.error('tick error', { error: String(error) }),
    });
  }

  addPlayer(
    ws: WebSocket,
    playerId: string,
    accountId?: string,
  ): { plantId: string; welcome: WelcomePayload } {
    const ownerId = accountId ?? playerId;
    let plant: import('@plant-legacy/shared/growth').Plant;

    // INV-ID-01: One active plant per owner/account. If this owner already has an active plant, reuse it.
    const existingPlants = this.plantWorld.getPlantsByOwner(ownerId);
    if (existingPlants.length > 0) {
      plant = existingPlants[0];
    } else {
      const spawn = this.findSpawnPosition();
      plant = this.plantWorld.createPlant(ownerId, 'world_0', spawn.x, spawn.z);
    }
    const plantId = plant.id;

    this.registerClientAtPlant(playerId, plant);

    connectionRegistryRegister(this.connectionRegistry, ws, playerId, accountId, (pid) => {
      this.log.warn('HELLO timeout, closing connection', { playerId: pid });
      ws.close(4008, 'HELLO timeout');
    });
    connectionRegistrySetPlant(this.connectionRegistry, playerId, plantId);
    connectionRegistryClearHelloTimer(this.connectionRegistry, playerId);
    connectionRegistryInstallHandler(this.connectionRegistry, playerId, (data: Buffer) => {
      this.handlePostHelloMessage(playerId, data);
    });

    const player: ConnectedPlayer = {
      ws,
      playerId,
      plantId,
      accountId,
      lastInputTick: 0,
      pendingInputs: new Map(),
    };
    this.players.set(playerId, player);

    const rootNodeId = plant.rootNodeId;
    const rootNode = rootNodeId != null ? plant.nodes.get(rootNodeId) : undefined;

    const welcome: WelcomePayload = {
      playerId,
      plantId,
      tick: this.getTick(),
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
      totalEnergy: plant.totalEnergy,
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
        growthProgress: n.growthProgress ?? 1.0,
        isSeed: n.isSeed ?? false,
      })),
    };

    this.log.info('player joined', {
      playerId,
      plantId,
      accountId: accountId ?? 'anonymous',
      totalPlayers: this.players.size,
    });

    // Broadcast new plant to all other connected players (multiplayer visibility)
    const plantCreatedPayload = {
      plant: {
        id: plant.id,
        ownerId: plant.ownerId,
        rootNodeId: plant.rootNodeId,
        totalBiomass: plant.totalBiomass,
        totalEnergy: plant.totalEnergy,
        totalUpkeep: plant.totalUpkeep,
        nodes: welcome.nodes ?? [],
      },
    };
    for (const otherPlayer of this.players.values()) {
      if (otherPlayer.playerId !== playerId) {
        this.send(otherPlayer.ws, MESSAGE_TYPE.PLANT_CREATED, plantCreatedPayload);
      }
    }

    // Register plant root node as entity in InterestManager
    if (rootNode) {
      this.interestManager.addEntityToCell(plantId, rootNode.x, rootNode.z);
    }

    return { plantId, welcome };
  }

  removePlayer(playerId: string): void {
    connectionRegistryRemove(
      this.connectionRegistry,
      playerId,
      this.reconnectMachine,
      (plantId) => {
        this.plantWorld.removePlant(plantId);
        this.processPlantDeaths();
      },
      (msg, meta) => this.log.info(msg, meta),
    );

    this.interestManager.unregisterClient(playerId);
    this.players.delete(playerId);
    growthIntentStateMachineClear(this.growthIntentMachine, playerId);
    this.log.info('player left', {
      playerId,
      totalPlayers: this.players.size,
    });
  }

  reclaimPlant(
    accountId: string,
    newPlayerId: string,
    ws: WebSocket,
  ): { plantId: string; welcome: WelcomePayload } | null {
    const reclaimed = reconnectStateMachineReclaimByAccount(
      this.reconnectMachine,
      accountId,
      (msg, meta) => this.log.info(msg, meta),
    );
    if (!reclaimed) return null;

    const oldPlayerId = this.findPlayerByAccountId(accountId);
    if (oldPlayerId) {
      connectionRegistryTransferPlant(this.connectionRegistry, oldPlayerId, newPlayerId);
      this.interestManager.unregisterClient(oldPlayerId);
      this.players.delete(oldPlayerId);
      growthIntentStateMachineClear(this.growthIntentMachine, oldPlayerId);
      this.log.info('removed old player connection on reclaim', {
        oldPlayerId,
        newPlayerId,
        accountId,
      });
    }

    connectionRegistryRegister(this.connectionRegistry, ws, newPlayerId, accountId, (pid) => {
      this.log.warn('HELLO timeout on reclaimed connection', { playerId: pid });
      ws.close(4008, 'HELLO timeout');
    });
    connectionRegistrySetPlant(this.connectionRegistry, newPlayerId, reclaimed.plantId);
    connectionRegistryClearHelloTimer(this.connectionRegistry, newPlayerId);
    connectionRegistryInstallHandler(this.connectionRegistry, newPlayerId, (data: Buffer) => {
      this.handlePostHelloMessage(newPlayerId, data);
    });

    const plant = this.plantWorld.getPlant(reclaimed.plantId);
    if (!plant) return null;

    this.registerClientAtPlant(newPlayerId, plant);

    const player: ConnectedPlayer = {
      ws,
      playerId: newPlayerId,
      plantId: plant.id,
      accountId,
      lastInputTick: 0,
      pendingInputs: new Map(),
    };
    this.players.set(newPlayerId, player);

    const rootNodeId = plant.rootNodeId;
    const rootNode = rootNodeId != null ? plant.nodes.get(rootNodeId) : undefined;

    const welcome: WelcomePayload = {
      playerId: newPlayerId,
      plantId: plant.id,
      tick: this.getTick(),
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
      totalEnergy: plant.totalEnergy,
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
        growthProgress: n.growthProgress ?? 1.0,
        isSeed: n.isSeed ?? false,
      })),
    };

    this.log.info('player reconnected, plant reclaimed', {
      newPlayerId,
      oldPlantId: reclaimed.plantId,
      accountId,
      totalPlayers: this.players.size,
    });

    return { plantId: plant.id, welcome };
  }

  private findPlayerByAccountId(accountId: string): string | null {
    for (const [playerId, player] of this.players.entries()) {
      if (player.accountId === accountId) return playerId;
    }
    return null;
  }

  reclaimPlantById(
    plantId: string,
    newPlayerId: string,
    ws: WebSocket,
  ): { plantId: string; welcome: WelcomePayload } | null {
    const reclaimed = reconnectStateMachineReclaimByPlantId(
      this.reconnectMachine,
      plantId,
      (msg, meta) => this.log.info(msg, meta),
    );
    if (!reclaimed) return null;

    connectionRegistryRegister(this.connectionRegistry, ws, newPlayerId, undefined, (pid) => {
      this.log.warn('HELLO timeout on reclaimed connection', { playerId: pid });
      ws.close(4008, 'HELLO timeout');
    });
    connectionRegistrySetPlant(this.connectionRegistry, newPlayerId, reclaimed.plantId);
    connectionRegistryClearHelloTimer(this.connectionRegistry, newPlayerId);
    connectionRegistryInstallHandler(this.connectionRegistry, newPlayerId, (data: Buffer) => {
      this.handlePostHelloMessage(newPlayerId, data);
    });

    const plant = this.plantWorld.getPlant(plantId);
    if (!plant) return null;

    this.registerClientAtPlant(newPlayerId, plant);

    const player: ConnectedPlayer = {
      ws,
      playerId: newPlayerId,
      plantId: plant.id,
      accountId: undefined,
      lastInputTick: 0,
      pendingInputs: new Map(),
    };
    this.players.set(newPlayerId, player);

    const rootNodeId = plant.rootNodeId;
    const rootNode = rootNodeId != null ? plant.nodes.get(rootNodeId) : undefined;

    const welcome: WelcomePayload = {
      playerId: newPlayerId,
      plantId: plant.id,
      tick: this.getTick(),
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
      totalEnergy: plant.totalEnergy,
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
        growthProgress: n.growthProgress ?? 1.0,
        isSeed: n.isSeed ?? false,
      })),
    };

    this.log.info('anonymous player reconnected, plant reclaimed', {
      newPlayerId,
      plantId,
      totalPlayers: this.players.size,
    });

    return { plantId: plant.id, welcome };
  }

  handleInput(playerId: string, input: PlayerInput): void {
    const player = this.players.get(playerId);
    if (!player) return;
    player.pendingInputs.set(input.tick, input);
  }

  handleGrowthIntent(
    playerId: string,
    intent: import('@plant-legacy/shared/growth').GrowthIntent,
  ): void {
    const player = this.players.get(playerId);
    if (!player) return;

    // INV-ID-02: Verify plant belongs to this player before queueing intent
    if (!intent.plantId || intent.plantId !== player.plantId) {
      this.log.warn('growth intent rejected: plant ownership mismatch', {
        playerId,
        playerPlantId: player.plantId,
        intentPlantId: intent.plantId,
      });
      const reject: RejectPayload = {
        reason: 'plant_mismatch',
        originalType: MESSAGE_TYPE.GROWTH_INTENT,
      };
      this.send(player.ws, MESSAGE_TYPE.REJECT, reject);
      return;
    }

    const enqueueResult = growthIntentStateMachineEnqueue(
      this.growthIntentMachine,
      playerId,
      intent,
      this.getTick(),
    );

    if (!enqueueResult.success) {
      this.log.warn('growth intent queue full', { playerId, reason: enqueueResult.reason });
      const reject: RejectPayload = {
        reason: enqueueResult.reason || 'intent_queue_full',
        originalType: MESSAGE_TYPE.GROWTH_INTENT,
      };
      this.send(player.ws, MESSAGE_TYPE.REJECT, reject);
    }
  }

  handlePing(ws: WebSocket): void {
    this.send(ws, MESSAGE_TYPE.PONG, {});
  }

  handlePostHelloMessage(playerId: string, data: Buffer): void {
    try {
      const message = JSON.parse(data.toString());
      const { type, payload } = message;

      switch (type) {
        case MESSAGE_TYPE.INPUT: {
          const inputPayload = payload as { input: PlayerInput };
          if (inputPayload.input && typeof inputPayload.input.tick === 'number') {
            this.handleInput(playerId, inputPayload.input);
          }
          break;
        }
        case MESSAGE_TYPE.GROWTH_INTENT: {
          const growthIntent = payload as {
            intent: import('@plant-legacy/shared/growth').GrowthIntent;
          };
          if (growthIntent?.intent && typeof growthIntent.intent.tick === 'number') {
            this.handleGrowthIntent(playerId, growthIntent.intent);
          }
          break;
        }
        case MESSAGE_TYPE.PING: {
          const player = this.players.get(playerId);
          if (player) this.handlePing(player.ws);
          break;
        }
        case MESSAGE_TYPE.RESOURCE_QUERY: {
          const query = payload as ResourceQueryPayload;
          let resources: { light: number; moisture: number; minerals: number } | null = null;
          let tileX: number | undefined;
          let tileZ: number | undefined;

          if (typeof query.tileX === 'number' && typeof query.tileZ === 'number') {
            tileX = query.tileX;
            tileZ = query.tileZ;
            resources = this.getTileResources(query.tileX, query.tileZ);
          } else if (typeof query.worldX === 'number' && typeof query.worldZ === 'number') {
            const coords = this.resourceWorld.getTileCoordinates(query.worldX, query.worldZ);
            tileX = coords.tileX;
            tileZ = coords.tileZ;
            resources = this.resourceWorld.getTileResourcesAt(tileX, tileZ);
          }

          if (resources && tileX !== undefined && tileZ !== undefined) {
            const player = this.players.get(playerId);
            if (player?.plantId) {
              const plant = this.plantWorld.getPlant(player.plantId);
              if (plant) {
                this.send(player.ws, MESSAGE_TYPE.RESOURCE_UPDATE, {
                  tick: this.getTick(),
                  tiles: [{ tileX, tileZ, ...resources }],
                  width: this.resourceWorld.getWidth(),
                  height: this.resourceWorld.getHeight(),
                  tileSize: this.resourceWorld.getTileSize(),
                  totalEnergy: plant.totalEnergy,
                  totalBiomass: plant.totalBiomass,
                  storedWater: plant.storedWater,
                  storedMinerals: plant.storedMinerals,
                  rootTileCount: this.resourceWorld.getRootTileCount(
                    plant as unknown as import('./ops/resourceWorld.ts').PlantForResource,
                  ),
                });
              }
            }
          }
          break;
        }
        case MESSAGE_TYPE.PLANT_SYNC_REQUEST: {
          const activePlantIds = new Set<string>();
          for (const p of this.players.values()) {
            if (p.plantId) activePlantIds.add(p.plantId);
          }
          const allPlants = this.plantWorld.getAllPlants();
          const syncPlants = allPlants.filter((p) => activePlantIds.has(p.id));
          const syncPayload: PlantSyncPayload = {
            plants: syncPlants.map((p) => ({
              id: p.id,
              ownerId: p.ownerId,
              rootNodeId: p.rootNodeId,
              totalBiomass: p.totalBiomass,
              totalEnergy: p.totalEnergy,
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
                growthProgress: n.growthProgress ?? 1.0,
                isSeed: n.isSeed ?? false,
              })),
            })),
          };
          const player = this.players.get(playerId);
          if (player) this.send(player.ws, MESSAGE_TYPE.PLANT_SYNC, syncPayload);
          break;
        }
        case MESSAGE_TYPE.GROWTH_OPTIONS_REQUEST: {
          const req = payload as { plantId?: string; nodeId?: string };
          const player = this.players.get(playerId);
          if (!player) break;

          // INV-ID-02: Verify plant belongs to this player
          if (!req.plantId || req.plantId !== player.plantId) {
            this.send(player.ws, MESSAGE_TYPE.GROWTH_OPTIONS_RESULT, {
              nodeId: req.nodeId ?? '',
              nodeType: 'seed',
              isSeed: true,
              energy: 0,
              biomass: 0,
              options: [],
              error: 'plant_mismatch',
            });
            break;
          }

          if (!req.nodeId) {
            this.send(player.ws, MESSAGE_TYPE.GROWTH_OPTIONS_RESULT, {
              nodeId: '',
              nodeType: 'seed',
              isSeed: true,
              energy: 0,
              biomass: 0,
              options: [],
              error: 'node_not_found',
            });
            break;
          }

          const optionsResult = this.plantWorld.getGrowthOptions(req.plantId, req.nodeId);
          if (!optionsResult) {
            this.send(player.ws, MESSAGE_TYPE.GROWTH_OPTIONS_RESULT, {
              nodeId: req.nodeId,
              nodeType: 'seed',
              isSeed: true,
              energy: 0,
              biomass: 0,
              options: [],
              error: 'node_not_found',
            });
            break;
          }

          this.send(player.ws, MESSAGE_TYPE.GROWTH_OPTIONS_RESULT, {
            nodeId: optionsResult.nodeId,
            nodeType: optionsResult.nodeType,
            isSeed: optionsResult.isSeed,
            energy: optionsResult.energy,
            biomass: optionsResult.biomass,
            options: optionsResult.options,
            conditions: optionsResult.conditions,
          });
          break;
        }
        default: {
          this.log.warn('Unknown message type after HELLO', { type, playerId });
        }
      }
    } catch (e) {
      this.log.error('Error processing post-HELLO message', { playerId, error: String(e) });
    }
  }

  private onTick(tick: number, dt: number): void {
    this.processInputs();
    this.processGrowthIntents(tick);

    for (const player of this.players.values()) {
      if (player.plantId) {
        const plant = this.plantWorld.getPlant(player.plantId);
        if (plant?.rootNodeId) {
          const rootNode = plant.nodes.get(plant.rootNodeId);
          if (rootNode) {
            this.interestManager.updateClientPosition(player.playerId, rootNode.x, rootNode.z);
          }
        }
      }
    }

    const onlinePlantIds = new Set<string>();
    for (const player of this.players.values()) {
      if (player.plantId) {
        onlinePlantIds.add(player.plantId);
      }
    }

    this.plantWorld.step(dt, onlinePlantIds, tick);

    this.processPlantDeaths();

    const plantsForResource = new Map<string, import('./ops/resourceWorld.ts').PlantForResource>();
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
    this.weatherSystem.update(dt);
    const weatherBroadcast = this.weatherSystem.getBroadcast();

    this.resourceWorld.step(
      dt,
      plantsForResource,
      this.weatherSystem.getMoistureDepositPerSecond(),
      this.weatherSystem.getWeatherLightMultiplier(),
      this.weatherSystem.getTimeOfDay(),
    );

    for (const plant of plantsForResource.values()) {
      const result = this.resourceWorld.calculatePhotosynthesis(plant);
      if (result.biomassGain > 0) {
        const realPlant = this.plantWorld.getPlant(plant.id);
        if (realPlant) {
          realPlant.totalBiomass += result.biomassGain * dt;
        }
      }
      if (result.energyGain > 0) {
        this.plantWorld.addPhotosynthesisEnergy(plant.id, result.energyGain * dt);
      }
    }

    const isKeyframe = tick % this.config.keyframeIntervalTicks === 0;

    const plantStates: Array<{
      id: string;
      totalBiomass: number;
      totalEnergy: number;
      totalUpkeep: number;
    }> = [];
    for (const player of this.players.values()) {
      if (!player.plantId) continue;
      const plant = this.plantWorld.getPlant(player.plantId);
      if (plant) {
        plantStates.push({
          id: plant.id,
          totalBiomass: plant.totalBiomass,
          totalEnergy: plant.totalEnergy,
          totalUpkeep: plant.totalUpkeep,
        });
      }
    }

    if (isKeyframe) {
      const keyframePayload: KeyframePayload = {
        tick,
        plants: plantStates,
        worldBounds: this.config.worldBounds,
        tileSize: this.resourceWorld.getTileSize(),
      };
      this.broadcast(MESSAGE_TYPE.KEYFRAME, keyframePayload);
    } else {
      const statePayload: StatePayload = {
        tick,
        plants: plantStates,
        worldBounds: this.config.worldBounds,
        tileSize: this.resourceWorld.getTileSize(),
      };
      this.broadcast(MESSAGE_TYPE.STATE, statePayload);
    }

    for (const player of this.players.values()) {
      if (!player.plantId) continue;
      const plant = this.plantWorld.getPlant(player.plantId);
      if (!plant) continue;

      const rootTiles = this.resourceWorld.getRootTilesForPlant(
        plant as unknown as import('./ops/resourceWorld.ts').PlantForResource,
      );
      if (rootTiles.length === 0) continue;

      this.send(player.ws, MESSAGE_TYPE.RESOURCE_UPDATE, {
        tick,
        tiles: rootTiles,
        width: this.resourceWorld.getWidth(),
        height: this.resourceWorld.getHeight(),
        tileSize: this.resourceWorld.getTileSize(),
        totalEnergy: plant.totalEnergy,
        totalBiomass: plant.totalBiomass,
        storedWater: plant.storedWater,
        storedMinerals: plant.storedMinerals,
        rootTileCount: rootTiles.length,
      });
    }

    this.broadcast(MESSAGE_TYPE.WEATHER_UPDATE, {
      tick,
      ...weatherBroadcast,
    });
  }

  private processInputs(): void {
    for (const [_playerId, player] of this.players.entries()) {
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

        const maxVelocity = this.config.maxVelocityUnitsPerTick;
        let moveX = 0;
        let moveZ = 0;
        if (input.moveForward) moveZ -= 1;
        if (input.moveBackward) moveZ += 1;
        if (input.moveLeft) moveX -= 1;
        if (input.moveRight) moveX += 1;
        const velocity = Math.sqrt(moveX * moveX + moveZ * moveZ);

        if (velocity > maxVelocity) {
          const reject: RejectPayload = {
            reason: 'exceeds_max_velocity',
            originalType: MESSAGE_TYPE.INPUT,
          };
          this.send(player.ws, MESSAGE_TYPE.REJECT, reject);
        } else {
          player.lastInputTick = inputTick;
        }
      }
    }
  }

  private processGrowthIntents(currentTick: number): void {
    for (const [playerId, player] of this.players.entries()) {
      if (!player.plantId) continue;

      const readyIntents = growthIntentStateMachineDrain(
        this.growthIntentMachine,
        playerId,
        currentTick,
      );

      for (const queued of readyIntents) {
        const intent = queued.intent;

        if (intent.plantId !== player.plantId) continue;

        const result = this.plantWorld.tryGrow(intent, currentTick);

        if (result.success && (result.newNode || result.newNodes || result.updatedParentNode)) {
          const plant = this.plantWorld.getPlant(intent.plantId);
          const growthPayload = {
            plantId: intent.plantId,
            newNode: result.newNode,
            newNodes: result.newNodes,
            updatedParentNode: result.updatedParentNode,
            damageDealt: result.damageDealt,
            totalBiomass: plant?.totalBiomass ?? 0,
            totalEnergy: plant?.totalEnergy ?? 0,
            growthSeq: plant?.growthSeq ?? 0,
          };
          this.broadcast(MESSAGE_TYPE.GROWTH_EVENT, growthPayload);

          // Register new nodes as entities in InterestManager
          if (result.newNode) {
            this.interestManager.addEntityToCell(
              result.newNode.id,
              result.newNode.x,
              result.newNode.z,
            );
          }
          if (result.newNodes) {
            for (const node of result.newNodes) {
              this.interestManager.addEntityToCell(node.id, node.x, node.z);
            }
          }
          // Note: updatedParentNode (seed crown in germination) already tracked as plantId
        } else if (!result.success) {
          this.log.info('growth intent rejected', {
            playerId: player.playerId,
            plantId: intent.plantId,
            nodeId: intent.nodeId,
            reason: result.reason,
            tick: currentTick,
          });
          const reject: RejectPayload = {
            reason: result.reason || 'growth_failed',
            originalType: MESSAGE_TYPE.GROWTH_INTENT,
          };
          this.send(player.ws, MESSAGE_TYPE.REJECT, reject);
        }
      }
    }
  }

  private findSpawnPosition(): { x: number; z: number } {
    const existing = this.plantWorld.getAllPlants();
    if (existing.length === 0) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 2 + Math.random() * 3;
      return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
    }
    for (let i = 0; i < 256; i++) {
      const angle = i * 2.399963229728653;
      const radius = i === 0 ? 0 : Math.min(64, 3 * Math.sqrt(i));
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const clear = existing.every((plant) => {
        const root = plant.rootNodeId ? plant.nodes.get(plant.rootNodeId) : undefined;
        if (!root) return true;
        return Math.hypot(root.x - x, root.z - z) >= 5.0;
      });
      if (clear) return { x, z };
    }
    let best = { x: 0, z: 0, minDist: 0 };
    for (let i = 0; i < 360; i += 15) {
      const angle = (i * Math.PI) / 180;
      const radius = 10;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const minDist = Math.min(
        ...existing.map((plant) => {
          const root = plant.rootNodeId ? plant.nodes.get(plant.rootNodeId) : undefined;
          return root ? Math.hypot(root.x - x, root.z - z) : Infinity;
        }),
      );
      if (minDist > best.minDist) {
        best = { x, z, minDist };
      }
    }
    return { x: best.x, z: best.z };
  }

  private registerClientAtPlant(
    playerId: string,
    plant: import('@plant-legacy/shared/growth').Plant,
  ): void {
    if (plant.rootNodeId) {
      const rootNode = plant.nodes.get(plant.rootNodeId);
      if (rootNode) {
        this.interestManager.registerClient(playerId, rootNode.x, rootNode.z);
      }
    }
  }

  start(): void {
    tickClockStart(this.tickClock);
    this.log.info('world simulation started', { tickRateHz: this.config.tickRateHz });
  }

  stop(): void {
    tickClockStop(this.tickClock);
  }

  getTick(): number {
    return this.tickClock.tick;
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
  const resourcesConfig = loadResourcesConfig(configs);

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
    resourcesConfig,
  );

  // Resource world (T00A)
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
        totalEnergy: loaded.totalEnergy ?? 0,
        totalUpkeep: loaded.totalUpkeep,
        storedWater: loaded.storedWater ?? 0,
        storedMinerals: loaded.storedMinerals ?? 0,
        lastGrowthTick: loaded.lastGrowthTick,
        growthCooldownUntil: loaded.growthCooldownUntil,
        tier: loaded.tier,
        lastTick: loaded.lastTick,
        growthSeq: loaded.growthSeq ?? 0,
      };
      plantWorld.loadPlant(plant);
    }
    log.info('loaded plants from database', { count: loadedPlants.length });
  }

  // Interest management (T03)
  const interestManager = new InterestManager(worldConfig);

  // Accounts service (T08C)
  const accountsConfig = loadAccountsConfig(configs);
  let accountsService: AccountsService | null = null;
  let handleSignup: ReturnType<typeof createAccountsHandlers>['handleSignup'];
  let handleLogin: ReturnType<typeof createAccountsHandlers>['handleLogin'];
  let handleRefresh: ReturnType<typeof createAccountsHandlers>['handleRefresh'];
  let handleLogout: ReturnType<typeof createAccountsHandlers>['handleLogout'];
  let handleChangeDisplayName: ReturnType<typeof createAccountsHandlers>['handleChangeDisplayName'];
  let authMiddleware: ReturnType<typeof createAuthMiddleware>;

  if (database.pool) {
    const service = new AccountsService(database.pool, accountsConfig);
    accountsService = service;
    const handlers = createAccountsHandlers(service);
    handleSignup = handlers.handleSignup;
    handleLogin = handlers.handleLogin;
    handleRefresh = handlers.handleRefresh;
    handleLogout = handlers.handleLogout;
    handleChangeDisplayName = handlers.handleChangeDisplayName;
    authMiddleware = createAuthMiddleware(service);
  } else {
    // No database - provide no-op handlers that return service unavailable
    const noDbHandler = async (_req: IncomingMessage, res: ServerResponse) => {
      sendJson(res, 503, { error: 'database_not_available' });
    };
    handleSignup = noDbHandler;
    handleLogin = noDbHandler;
    handleRefresh = noDbHandler;
    handleLogout = noDbHandler;
    handleChangeDisplayName = noDbHandler;
    authMiddleware = async (_req: IncomingMessage, res: ServerResponse) => {
      sendJson(res, 503, { error: 'database_not_available' });
    };
  }

  // Weather system (T07)
  const weatherConfig = loadWeatherConfig(configs);
  const dayNightConfig = loadDayNightConfig(configs);
  const weatherSystem = new WeatherSystem(weatherConfig, dayNightConfig);

  const world = new World(
    netProtoConfig,
    log,
    plantWorld,
    resourceWorld,
    weatherSystem,
    interestManager,
    worldConfig.reconnectWindowMin * 60 * 1000, // convert minutes to ms
    worldConfig.persistenceEnabled,
    worldConfig.maxFrameTimeMs,
  );

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
    applyCors(request, response, runtime.corsOrigins, runtime.nodeEnv);
    const method = request.method ?? 'GET';

    if (method === 'OPTIONS') {
      response.writeHead(204, {
        'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
        'access-control-allow-headers': 'content-type, authorization',
        'access-control-max-age': '600',
      });
      response.end();
      return;
    }

    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    // T08C: Accounts endpoints (allow POST)
    if (url.pathname === '/auth/signup') {
      if (method === 'POST') {
        await handleSignup(request, response);
        return;
      }
      sendJson(response, 405, { error: 'method_not_allowed' });
      return;
    }

    if (url.pathname === '/auth/login') {
      if (method === 'POST') {
        await handleLogin(request, response);
        return;
      }
      sendJson(response, 405, { error: 'method_not_allowed' });
      return;
    }

    if (url.pathname === '/auth/refresh') {
      if (method === 'POST') {
        await handleRefresh(request, response);
        return;
      }
      sendJson(response, 405, { error: 'method_not_allowed' });
      return;
    }

    if (url.pathname === '/auth/logout') {
      if (method === 'POST') {
        await handleLogout(request, response);
        return;
      }
      sendJson(response, 405, { error: 'method_not_allowed' });
      return;
    }

    if (url.pathname === '/auth/me/display-name') {
      if (method === 'POST') {
        await authMiddleware(request, response, async () => {
          const accountId = (request as IncomingMessage & { accountId?: string }).accountId;
          if (!accountId) {
            sendJson(response, 401, { error: 'unauthorized' });
            return;
          }
          await handleChangeDisplayName(request, response, accountId);
        });
        return;
      }
      sendJson(response, 405, { error: 'method_not_allowed' });
      return;
    }

    // Health and readiness
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
        world: 'plant-organism',
        note: 'Plant Legacy - Multiplayer plant organism simulation',
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
          canopy_sight_enabled: values.canopy_sight_enabled?.value ?? true,
          photosynthesis_visualization: values.photosynthesis_visualization?.value ?? true,
          water_flow_visualization: values.water_flow_visualization?.value ?? true,
          nutrient_flow_visualization: values.nutrient_flow_visualization?.value ?? true,
          shader_quality: values.shader_quality?.value ?? 'high',
          max_gpu_buffers: values.max_gpu_buffers?.value ?? 8,
          compute_shader_workgroup_size: values.compute_shader_workgroup_size?.value ?? 64,
          tube_ring_count: values.tube_ring_count?.value ?? 8,
          tube_length_segments: values.tube_length_segments?.value ?? 8,
          leaf_count_per_node: values.leaf_count_per_node?.value ?? 1,
          leaf_size: values.leaf_size?.value ?? 1.2,
          leaf_length_width_ratio: values.leaf_length_width_ratio?.value ?? 2.5,
          petiole_length: values.petiole_length?.value ?? 0.25,
          petiole_thickness: values.petiole_thickness?.value ?? 0.015,
          l0_distance: values.l0_distance?.value ?? 50.0,
          l1_distance: values.l1_distance?.value ?? 150.0,
          l2_distance: values.l2_distance?.value ?? 500.0,
          triangle_budget_l0: values.triangle_budget_l0?.value ?? 1500,
          triangle_budget_l1: values.triangle_budget_l1?.value ?? 800,
          wind_strength: values.wind_strength?.value ?? 0.3,
          wind_speed: values.wind_speed?.value ?? 1.0,
          health_tint_strength: values.health_tint_strength?.value ?? 0.5,
          mutation_visual_0_param: values.mutation_visual_0_param?.value ?? 0.0,
          mutation_visual_1_param: values.mutation_visual_1_param?.value ?? 1.5,
          mutation_visual_2_param: values.mutation_visual_2_param?.value ?? 0.3,
          smin_blend_radius: values.smin_blend_radius?.value ?? 0.25,
          max_raymarch_steps: values.max_raymarch_steps?.value ?? 32,
          raymarch_hit_epsilon: values.raymarch_hit_epsilon?.value ?? 0.005,
          bounding_box_padding: values.bounding_box_padding?.value ?? 1.2,
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
          canopy_sight_enabled: true,
          photosynthesis_visualization: true,
          water_flow_visualization: true,
          nutrient_flow_visualization: true,
          shader_quality: 'high',
          max_gpu_buffers: 8,
          compute_shader_workgroup_size: 64,
          tube_ring_count: 8,
          tube_length_segments: 8,
          leaf_count_per_node: 1,
          leaf_size: 1.2,
          leaf_length_width_ratio: 2.5,
          petiole_length: 0.25,
          petiole_thickness: 0.015,
          l0_distance: 50.0,
          l1_distance: 150.0,
          l2_distance: 500.0,
          triangle_budget_l0: 1500,
          triangle_budget_l1: 800,
          wind_strength: 0.3,
          wind_speed: 1.0,
          health_tint_strength: 0.5,
          mutation_visual_0_param: 0.0,
          mutation_visual_1_param: 1.5,
          mutation_visual_2_param: 0.3,
          smin_blend_radius: 0.25,
          max_raymarch_steps: 32,
          raymarch_hit_epsilon: 0.005,
          bounding_box_padding: 1.2,
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
        const renderConfig: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(values)) {
          renderConfig[key] =
            (entry as { value?: unknown })?.value !== undefined
              ? (entry as { value: unknown }).value
              : entry;
        }

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

    if (url.pathname === '/config/root_sight') {
      // T02: Serve Root Sight config
      const fs = await import('node:fs/promises');
      const path = await import('node:path');

      try {
        const configDir = runtime.configDir;
        const rootSightPath = path.resolve(configDir, 'root_sight.json');
        const raw = await fs.readFile(rootSightPath, 'utf8');
        const config = JSON.parse(raw);

        const values = config.values || {};
        const rootSightConfig = {
          cutaway_radius: values.cutaway_radius?.value ?? 50,
          transition_ms: values.transition_ms?.value ?? 500,
          soil_opacity: values.soil_opacity?.value ?? 0.3,
          own_root_highlight_color: values.own_root_highlight_color?.value ?? '#4CAF50',
          rival_root_highlight_color: values.rival_root_highlight_color?.value ?? '#FF5722',
          substrate_multiplier: values.substrate_multiplier?.value ?? 0.5,
          camera_target: values.camera_target?.value ?? 'own_plant',
        };

        sendJson(response, 200, rootSightConfig);
        return;
      } catch {
        sendJson(response, 200, {
          cutaway_radius: 50,
          transition_ms: 500,
          soil_opacity: 0.3,
          own_root_highlight_color: '#4CAF50',
          rival_root_highlight_color: '#FF5722',
          substrate_multiplier: 0.5,
          camera_target: 'own_plant',
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
    if (origin && !isAllowedOrigin(origin, runtime.corsOrigins, runtime.nodeEnv)) {
      log.warn('websocket connection rejected: origin not allowed', { origin });
      ws.close(4001, 'Origin not allowed');
      return;
    }

    // Wait for HELLO with auth before creating player
    let helloReceived = false;

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        const { type, payload } = message;

        if (type === MESSAGE_TYPE.HELLO && !helloReceived) {
          helloReceived = true;
          handleHelloMessage(ws, payload);
          return;
        }

        // Ignore other messages until HELLO is processed
      } catch (error) {
        log.error('websocket message parse error', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    ws.on('close', () => {
      // Clean up if HELLO was never received
    });

    ws.on('error', (error: Error) => {
      log.error('websocket error', { error: error.message });
    });

    // Set a timeout for HELLO
    const helloTimeout = setTimeout(() => {
      if (!helloReceived) {
        log.warn('websocket closed: hello timeout');
        ws.close(4008, 'Hello timeout');
      }
    }, 10000);
    helloTimeout.unref();

    async function handleHelloMessage(ws: WebSocket, payload: unknown) {
      const hello = payload as HelloPayload;

      if (hello.clientVersion !== netProtoConfig.protocolVersion) {
        const error: ErrorPayload = {
          code: 'VERSION_MISMATCH',
          message: `Protocol version mismatch: server=${netProtoConfig.protocolVersion}, client=${hello.clientVersion}`,
        };
        const errorMsg = JSON.stringify({ type: MESSAGE_TYPE.ERROR, payload: error });
        ws.send(errorMsg);
        ws.close(4002, 'Version mismatch');
        return;
      }

      // Verify access token if provided (T08C)
      let accountId: string | null = null;
      let accountRole: string | null = null;
      if (hello.accessToken && accountsService) {
        const authResult = await accountsService.verifyAccessToken(hello.accessToken);
        if ('error' in authResult) {
          const error: ErrorPayload = {
            code: 'AUTH_FAILED',
            message: authResult.error,
          };
          const errorMsg = JSON.stringify({ type: MESSAGE_TYPE.ERROR, payload: error });
          ws.send(errorMsg);
          ws.close(4001, 'Authentication failed');
          return;
        }
        accountId = authResult.accountId;
        accountRole = authResult.role;
      }

      // Store account info on the WebSocket
      (ws as WebSocket & { accountId?: string; accountRole?: string }).accountId =
        accountId ?? undefined;
      (ws as WebSocket & { accountId?: string; accountRole?: string }).accountRole =
        accountRole ?? undefined;

      // Check if this account has a plant pending reclaim (reconnect window)
      let welcome: WelcomePayload;
      let playerId: string;
      if (accountId) {
        const reclaimed = world.reclaimPlant(
          accountId,
          `player_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          ws,
        );
        if (reclaimed) {
          welcome = reclaimed.welcome;
          playerId = reclaimed.welcome.playerId;
        } else {
          // No plant to reclaim, create new
          playerId = `player_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const added = world.addPlayer(ws, playerId, accountId);
          welcome = added.welcome;
        }
      } else {
        // Anonymous player - check for plantId to reclaim
        if (hello.plantId) {
          const reclaimed = world.reclaimPlantById(
            hello.plantId,
            `player_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            ws,
          );
          if (reclaimed) {
            welcome = reclaimed.welcome;
            playerId = reclaimed.welcome.playerId;
          } else {
            // No plant to reclaim, create new
            playerId = `player_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const added = world.addPlayer(ws, playerId, undefined);
            welcome = added.welcome;
          }
        } else {
          // No plantId, create new anonymous player
          playerId = `player_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const added = world.addPlayer(ws, playerId, undefined);
          welcome = added.welcome;
        }
      }

      // Send welcome message with plant info
      const welcomeMsg = JSON.stringify({
        type: MESSAGE_TYPE.WELCOME,
        payload: { ...welcome, plantId: welcome.plantId },
      });
      ws.send(welcomeMsg);

      // ConnectionRegistry in World.addPlayer already installed the message handler
      // that routes to world.handlePostHelloMessage

      ws.on('close', () => {
        world.removePlayer(playerId);
      });

      ws.on('error', (error: Error) => {
        log.error('websocket error', { error: error.message, playerId });
      });
    }
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
