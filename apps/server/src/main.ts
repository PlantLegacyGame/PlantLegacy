import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import process from 'node:process';
import { readNumber } from '@plant-legacy/shared/config';
import { validateMessage } from '@plant-legacy/shared/protocol/messageSchemas';
import {
  loadDayNightConfig,
  loadWeatherConfig,
  type WeatherStateName,
  WeatherSystem,
} from '@plant-legacy/weather';
import { WebSocket, WebSocketServer } from 'ws';
import { loadRuntimeConfig } from './core/config.ts';
import { SERVICE_VERSION } from './core/version.ts';
import { loadAccountsConfig } from './ops/accounts/config.ts';
import { createAccountsHandlers, createAuthMiddleware } from './ops/accounts/http.ts';
import { AccountsService } from './ops/accounts/service.ts';
import { stepCadence } from './ops/broadcastCadence.ts';
import {
  type ChatConfig,
  loadChatConfig,
  loadReportConfig,
  type ReportConfig,
} from './ops/chat.ts';
import { readFlatConfig } from './ops/configRoutes.ts';
import {
  type ConnectionRegistry,
  connectionRegistryClearHelloTimer,
  connectionRegistryGetConnectionCount,
  connectionRegistryInstallHandler,
  connectionRegistryRegister,
  connectionRegistryRemove,
  connectionRegistrySetPlant,
  connectionRegistryTransferPlant,
  createConnectionRegistry,
} from './ops/connectionRegistry.ts';
import { loadDamageConfig, loadTumblingConfig, loadUprootConfig } from './ops/damage/config.ts';
import { DamagePipeline } from './ops/damage/damagePipeline.ts';
import { DatabaseProbe } from './ops/db.ts';
import { devToolsAllowed, handleGetDevConfig, handlePostDevConfig } from './ops/dev.ts';
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
import { addItem, createInventory, type Inventory } from './ops/inventory.ts';
import { loadItemsConfig } from './ops/items.ts';
import { createLogger } from './ops/log.ts';
import { loadMutationsConfig } from './ops/mutations/config.ts';
import {
  type ErrorPayload,
  type HelloPayload,
  loadNetProtoConfig,
  MESSAGE_TYPE,
  nodeWireFields,
  type PlantSyncPayload,
  type PlayerInput,
  type RejectPayload,
  type ResourceQueryPayload,
  type SeasonUpdatePayload,
  type WelcomePayload,
} from './ops/net.ts';
import { type PlantEvent, PlantPersistence } from './ops/persistence/plantPersistence.ts';
import { TerrainPersistence } from './ops/persistence/terrainPersistence.ts';
import { clampPlantStorage, computePlantCapacity } from './ops/plantCapacity.ts';
import { PlantEventLog } from './ops/plantEventLog.ts';
import { canAdoptGuestPlant, isAnonymousOwner } from './ops/plantOwnership.ts';
import { selectVisiblePlants } from './ops/plantVisibility.ts';
import { PlantWorld } from './ops/plantWorld.ts';
import { createTokenBucket, tokenBucketAllow } from './ops/rateLimiter.ts';
import {
  createReconnectStateMachine,
  makeReclaimKey,
  type ReconnectStateMachine,
  reconnectStateMachineCancelPending,
  reconnectStateMachineOnDisconnect,
  reconnectStateMachineReclaimByAccount,
  reconnectStateMachineReclaimByPlantId,
} from './ops/reconnectStateMachine.ts';
import { loadResourcesConfig, ResourceWorld } from './ops/resourceWorld.ts';
import {
  createSeasonClock,
  restoreSeasonClock,
  type SeasonClock,
  type SeasonSnapshot,
  seasonClockAdvance,
  seasonSnapshot,
  seasonUpdatePayload,
} from './ops/seasonClock.ts';
import { TerrainService } from './ops/terrain.ts';
import { createTickClock, type TickClock, tickClockStart, tickClockStop } from './ops/tickClock.ts';
import { loadWorldConfig } from './ops/world.ts';

const STARTED_AT = Date.now();

/**
 * Dirty-tile broadcasts above this size are sent as a compact quantised grid.
 *
 * A weather/time-of-day change marks every tile dirty, and 65 536 tile objects
 * serialise to several megabytes of JSON (~21 MB/s at 20 Hz). The compact form
 * is a base64 buffer of three 0-255 channels per tile: ~262 KB, no per-tile
 * objects to parse on the client.
 */
const COMPACT_GRID_TILE_THRESHOLD = 2048;
const COMPACT_GRID_LIGHT_BASE = 80;

function encodeResourceGridBase64(
  width: number,
  height: number,
  tiles: Array<{ tileX: number; tileZ: number; light: number; moisture: number; minerals: number }>,
): string {
  const bytes = new Uint8Array(width * height * 3);
  for (const tile of tiles) {
    if (tile.tileX < 0 || tile.tileX >= width || tile.tileZ < 0 || tile.tileZ >= height) continue;
    const offset = (tile.tileZ * width + tile.tileX) * 3;
    bytes[offset] = Math.max(
      0,
      Math.min(255, Math.round((tile.light / COMPACT_GRID_LIGHT_BASE) * 255)),
    );
    bytes[offset + 1] = Math.max(0, Math.min(255, Math.round(tile.moisture)));
    bytes[offset + 2] = Math.max(0, Math.min(255, Math.round(tile.minerals)));
  }
  return Buffer.from(bytes).toString('base64');
}

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
  displayName: string;
  lastInputTick: number;
  pendingInputs: Map<number, PlayerInput>;
  inventory: Inventory;
  /** Players whose chat this player has muted. */
  blocked: Set<string>;
  /** Timestamps of recent chat messages, for the per-minute rate limit. */
  chatTimestamps: number[];
}

/**
 * Everything the per-tick root-resource update tells a player.
 *
 * Constant size, however large the plant: the averages cover every tile any of
 * the plant's parts occupy, and one sample tile keeps the dev readout anchored
 * to a real tile.
 */
interface RootResourceSnapshot {
  totalEnergy: number;
  totalBiomass: number;
  storedWater: number;
  storedMinerals: number;
  waterCapacity: number;
  mineralCapacity: number;
  coveredTileCount: number;
  tileAvgLight: number;
  tileAvgMoisture: number;
  tileAvgMinerals: number;
  /** Share of the local soil cavity filled with water, 0..1. */
  groundwaterFraction: number;
  coverageTileX: number;
  coverageTileZ: number;
  /** Slow-moving water-table field revision; the grid is resent when it changes. */
  waterTableRevision: number;
}

/**
 * Persist every plant, one row at a time.
 *
 * A failure is logged and skipped so one unreadable plant cannot stop the rest
 * from being written, and the caller learns how many actually landed. Shared by
 * the periodic save and the dev "force save" action.
 */
async function saveAllPlants(
  plantWorld: PlantWorld,
  plantPersistence: PlantPersistence,
  log: ReturnType<typeof createLogger>,
  context: string,
  eventLog?: PlantEventLog,
): Promise<{ saved: number; total: number }> {
  const plants = plantWorld.getAllPlants();
  let saved = 0;
  for (const plant of plants) {
    try {
      await plantPersistence.savePlant(plant, eventLog?.get(plant.id) ?? []);
      saved += 1;
    } catch (error) {
      log.error('plant save failed', {
        context,
        plantId: plant.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { saved, total: plants.length };
}

class World {
  private players = new Map<string, ConnectedPlayer>();
  // Last time a whole-grid (compact) resource broadcast went out. Weather and
  // daylight re-tint every tile at once; the client only needs that a couple of
  // times a second, and the skipped state is naturally resent by the next
  // whole-grid event because it dirties every tile again.
  private lastCompactGridBroadcastAt = 0;
  private static readonly COMPACT_GRID_MIN_INTERVAL_MS = 1000;
  /** Wire cadence accumulators (INV-TM-09). */
  private stateCadenceAccumulatorMs = 0;
  private weatherCadenceAccumulatorMs = 0;
  private stateMessagesSent = 0;
  private stateMessagesSkipped = 0;
  private weatherMessagesSent = 0;
  private weatherMessagesSkipped = 0;
  private rootMessagesSkipped = 0;
  /** Messages dropped because their socket was over the backlog limit. */
  private skippedSends = 0;
  /**
   * Per-plant secret handed to the owning client. A plant id is public (it is in
   * every broadcast), so it cannot authorise a reclaim on its own.
   */
  private readonly plantReconnectTokens = new Map<string, string>();
  /**
   * Stores captured at disconnect, keyed by plant id. Used to tell a returning
   * player what changed while they were away. In-memory on purpose: after a
   * restart there is no meaningful "before" to compare against, and inventing
   * one would be worse than reporting nothing.
   */
  /** Last death per owner, so a returning player learns what happened. */
  private readonly lostPlantReports = new Map<
    string,
    { cause: string; source?: string; plantId: string; at: number }
  >();
  /**
   * The same deaths keyed by plant id. An anonymous owner id is the id of a
   * connection that no longer exists, so a guest who comes back with a dead
   * plant's token has nothing stable to look the loss up by. The plant id is
   * that stable key.
   */
  private readonly lostPlantReportsByPlant = new Map<
    string,
    { cause: string; source?: string; at: number }
  >();
  private readonly awaySnapshots = new Map<
    string,
    {
      at: number;
      nodes: number;
      biomass: number;
      energy: number;
      water: number;
      minerals: number;
    }
  >();
  private readonly lastRootResourceUpdate = new Map<string, RootResourceSnapshot>();
  /** Per player: the water-table grid revision last sent to them. */
  private readonly lastWaterTableRevision = new Map<string, number>();
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
  private plantPersistence: PlantPersistence | null;
  private terrain: TerrainService | null;
  private maxFrameTimeMs: number;
  private persistenceEnabled: boolean;
  private seasonClock: SeasonClock;
  private seasonLengthDays: number;
  private lastCalamityAt: number | null = null;
  private onSeasonEnded: ((state: SeasonSnapshot) => void) | null = null;
  private damagePipeline: DamagePipeline | null = null;
  /** Bounded per-plant audit history, written with every save (INV-PR-07). */
  private readonly plantEventLog: PlantEventLog;
  private itemsConfig: ReturnType<typeof loadItemsConfig>;
  private chatConfig: ChatConfig;
  private reportConfig: ReportConfig;
  private recentReports = new Map<string, number[]>();
  private reports: Array<{
    reporterId: string;
    reporterName: string;
    targetPlayerId: string;
    targetPlayerName: string;
    reason: string;
    freeText: string;
    block: boolean;
    contextSnapshot: Array<{ playerName: string; message: string; timestamp: number }>;
    timestamp: number;
  }> = [];

  getPlayers(): Map<string, ConnectedPlayer> {
    return this.players;
  }

  getPlantWorld(): PlantWorld {
    return this.plantWorld;
  }

  getPlantEventLog(): PlantEventLog {
    return this.plantEventLog;
  }

  setDamagePipeline(pipeline: DamagePipeline): void {
    this.damagePipeline = pipeline;
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
      this.writeIfHealthy(player.ws, message, type);
    }
  }

  /**
   * Send to every player whose interest cells contain (x, z), plus the plant's
   * owner. Compliance with interest management matters most for the large
   * per-plant payloads: a growth event carries every node of the plant, and
   * broadcasting it to the whole world leaked every plant's geometry and cost
   * bandwidth for players who could not see it.
   */
  /**
   * Send every plant that is inside this player's interest cells right now.
   *
   * `PLANT_CREATED` is only broadcast at creation, so a plant that appeared while
   * a player was elsewhere never reached them and stayed invisible after they
   * moved into view. Repeating the payload is safe: the client upserts by plant id.
   */
  private announcePlantsInRange(player: ConnectedPlayer): void {
    // Iterate the world, not the player list. A plant whose owner has gone
    // offline (or was restored from a save) is still simulated, still occupies
    // tiles and can still be grown into - walking past an invisible one is a
    // blind spot, not a feature. Building this list from `players` hid every
    // offline plant for the whole session.
    const visible = selectVisiblePlants({
      plants: this.plantWorld.getAllPlants(),
      playerId: player.playerId,
      ownPlantId: player.plantId,
      isInRange: (playerId, x, z) => this.interestManager.isPositionInRange(playerId, x, z),
      includeOwn: false,
    });
    for (const plant of visible) {
      this.send(player.ws, MESSAGE_TYPE.PLANT_CREATED, this.plantCreatedPayload(plant));
    }
  }

  /**
   * T04: the mutation set, upkeep and adaptive pressure for one plant.
   * Public so the HELLO path can send it right after WELCOME.
   */
  getMutationStateFor(plantId: string) {
    return this.plantWorld.getMutationState(plantId, this.getTick());
  }

  /** Push MUTATION_STATE to the owner of a plant. */
  private sendMutationState(player: ConnectedPlayer): void {
    if (!player.plantId) return;
    const state = this.plantWorld.getMutationState(player.plantId, this.getTick());
    if (state) this.send(player.ws, MESSAGE_TYPE.MUTATION_STATE, state);
  }

  /** Full plant snapshot for PLANT_CREATED, mirroring the WELCOME node shape. */
  private plantCreatedPayload(plant: import('@plant-legacy/shared/growth').Plant) {
    return {
      plant: {
        id: plant.id,
        ownerId: plant.ownerId,
        rootNodeId: plant.rootNodeId,
        totalBiomass: plant.totalBiomass,
        totalEnergy: plant.totalEnergy,
        totalUpkeep: plant.totalUpkeep,
        nodes: Array.from(plant.nodes.values()).map((n) =>
          nodeWireFields(n, this.plantWorld.getNodeHealth(plant.id, n.id)),
        ),
      },
    };
  }

  private broadcastNear(type: number, payload: unknown, x: number, z: number, ownerId?: string) {
    const message = JSON.stringify({ type, payload });
    for (const player of this.players.values()) {
      if (
        player.playerId !== ownerId &&
        !this.interestManager.isPositionInRange(player.playerId, x, z)
      ) {
        continue;
      }
      this.writeIfHealthy(player.ws, message, type);
    }
  }

  /**
   * Refuse to queue into a socket that is already behind. Without this check a
   * slow client accumulates an unbounded ws buffer while the tick keeps
   * producing updates; dropping a tick message is safe because the next state
   * or keyframe supersedes it.
   */
  private writeIfHealthy(ws: WebSocket, message: string, type: number): boolean {
    if (ws.readyState !== WebSocket.OPEN) return false;
    if (ws.bufferedAmount > this.config.maxBufferedBytes) {
      this.skippedSends += 1;
      if (this.skippedSends % 100 === 1) {
        this.log.warn('skipping send: socket backlog above limit', {
          bufferedAmount: ws.bufferedAmount,
          maxBufferedBytes: this.config.maxBufferedBytes,
          type,
          skippedSends: this.skippedSends,
        });
      }
      return false;
    }
    ws.send(message);
    return true;
  }

  send(ws: WebSocket, type: number, payload: unknown): void {
    this.writeIfHealthy(ws, JSON.stringify({ type, payload }), type);
  }

  /**
   * Drain deaths queued by PlantWorld so each one is broadcast and deposited
   * exactly once. This covers simulation deaths (starvation, damage,
   * germination failure) as well as explicit removals.
   */
  /**
   * Announce growth that did not come through the intent queue (dev auto-growth).
   * Without this the client only learns about those nodes on a full sync, so a
   * seedling could sit at seed + radicle while the server had a whole plant.
   */
  processPlantGrowthEvents(): void {
    for (const result of this.plantWorld.drainGrowthResults()) {
      const plantId = result.newNode?.plantId ?? result.newNodes?.[0]?.plantId;
      if (!plantId) continue;
      const plant = this.plantWorld.getPlant(plantId);
      const growthPayload = {
        plantId,
        newNode: result.newNode,
        newNodes: result.newNodes,
        updatedParentNode: result.updatedParentNode,
        totalBiomass: plant?.totalBiomass ?? 0,
        totalEnergy: plant?.totalEnergy ?? 0,
        growthSeq: plant?.growthSeq ?? 0,
      };
      const nodes = result.newNodes ?? (result.newNode ? [result.newNode] : []);
      for (const node of nodes) {
        this.plantEventLog.append(plantId, {
          type: 'growth',
          tick: this.getTick(),
          data: {
            nodeId: node.id,
            nodeType: node.type,
            parentId: node.parentId,
            totalBiomass: plant?.totalBiomass ?? 0,
          },
        });
      }
      const anchor = nodes[0];
      if (anchor) {
        this.broadcastNear(MESSAGE_TYPE.GROWTH_EVENT, growthPayload, anchor.x, anchor.z);
      }
      for (const node of nodes) {
        this.interestManager.addEntityToCell(node.id, node.x, node.z);
      }
    }
  }

  processPlantDeaths(): void {
    const deaths = this.plantWorld.drainDeaths();
    for (const death of deaths) {
      reconnectStateMachineCancelPending(this.reconnectMachine, death.id, death.ownerId);
      this.plantReconnectTokens.delete(death.id);
      this.awaySnapshots.delete(death.id);
      // `removed` is administrative (persistence off), not something that
      // happened to the plant in the world, so it is not reported as a death.
      if (death.cause !== 'removed') {
        this.lostPlantReports.set(death.ownerId, {
          cause: death.cause,
          source: death.killedBy,
          plantId: death.id,
          at: Date.now(),
        });
        this.lostPlantReportsByPlant.set(death.id, {
          cause: death.cause,
          source: death.killedBy,
          at: Date.now(),
        });
        // Bounded: owners who never come back must not leak an entry each.
        if (this.lostPlantReports.size > 1000) {
          const oldest = this.lostPlantReports.keys().next().value;
          if (oldest !== undefined) this.lostPlantReports.delete(oldest);
        }
        if (this.lostPlantReportsByPlant.size > 1000) {
          const oldest = this.lostPlantReportsByPlant.keys().next().value;
          if (oldest !== undefined) this.lostPlantReportsByPlant.delete(oldest);
        }
      }
      try {
        // Pass the plant's real stores through: the zeroed fields here looked
        // deliberate but onPlantDeath never reads them, so the only effect was
        // to make the caller look like it was discarding resources.
        this.resourceWorld.onPlantDeath({
          ...death,
          rootNodeId: death.rootNodeId ?? '',
        });
      } catch (e) {
        this.log.error('resourceWorld.onPlantDeath failed', {
          plantId: death.id,
          error: String(e),
        });
      }
      for (const player of this.players.values()) {
        if (player.plantId === death.id) {
          player.plantId = null;
          this.lastRootResourceUpdate.delete(player.playerId);
        }
      }
      try {
        this.broadcast(MESSAGE_TYPE.PLANT_REMOVED, {
          plantId: death.id,
          cause: death.cause,
          source: death.killedBy,
        });
      } catch (e) {
        this.log.error('PLANT_REMOVED broadcast failed', { plantId: death.id, error: String(e) });
      }
      // T06: resolve kill credit and leave remains/dung where the plant fell.
      // `removed` is administrative (persistence off, dev removal) and is not a
      // death in the world, so it leaves nothing behind.
      if (death.cause !== 'removed') {
        this.damagePipeline?.onPlantDeath(death, this.getTick());
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
      // A dead plant must not come back from its snapshot on the next restart.
      // `removed` is administrative (persistence off, dev removal), not death.
      if (this.plantPersistence && death.cause !== 'removed') {
        const tick = this.getTick();
        // The per-plant row is about to be deleted, so the death itself goes to
        // the append-only world log. This is what makes the audit trail complete
        // across the plant's whole life.
        void this.plantPersistence
          .saveWorldEvent('plant_death', tick, {
            plantId: death.id,
            ownerId: death.ownerId,
            cause: death.cause,
            source: death.killedBy,
            totalBiomass: death.totalBiomass,
            nodeCount: death.nodes.size,
          })
          .catch((error: unknown) => {
            this.log.error('recording plant death event failed', {
              plantId: death.id,
              error: String(error),
            });
          });
        this.plantEventLog.delete(death.id);
        void this.plantPersistence.deletePlant(death.id).catch((error: unknown) => {
          this.log.error('deleting dead plant from persistence failed', {
            plantId: death.id,
            error: String(error),
          });
        });
      }
      this.log.info('plant died', {
        plantId: death.id,
        ownerId: death.ownerId,
        cause: death.cause,
      });
    }
  }

  /** T06: node positions for the uproot redraw. */
  private plantNodeTransforms(plantId: string): Array<{
    id: string;
    x: number;
    y: number;
    z: number;
    parentAttachX?: number;
    parentAttachY?: number;
    parentAttachZ?: number;
  }> {
    const plant = this.plantWorld.getPlant(plantId);
    if (!plant) return [];
    // The joints travel with the body. A node's position alone is not its whole
    // pose: each child also stores where it leaves its parent, and the crawl
    // rewrites both. Sending only the positions left the client drawing every
    // lateral root from the parent's pre-crawl spot, so an uprooted plant came
    // apart at the joints.
    return Array.from(plant.nodes.values()).map((node) => ({
      id: node.id,
      x: node.x,
      y: node.y,
      z: node.z,
      parentAttachX: node.parentAttachX,
      parentAttachY: node.parentAttachY,
      parentAttachZ: node.parentAttachZ,
    }));
  }

  /** T06: broadcast what the damage pipeline did this tick. */
  private processDamageEvents(): void {
    const events = this.damagePipeline?.drainEvents() ?? [];
    const tick = this.getTick();
    for (const event of events) {
      try {
        switch (event.kind) {
          case 'damage':
            this.plantEventLog.append(event.plantId, {
              type: 'damage',
              tick,
              data: {
                source: event.source,
                amount: event.amount,
                nodeId: event.nodeId,
                destroyedNodeIds: event.destroyedNodeIds,
                totalBiomass: event.totalBiomass,
              },
            });
            this.broadcast(MESSAGE_TYPE.PLANT_DAMAGE, {
              plantId: event.plantId,
              nodeId: event.nodeId,
              destroyedNodeIds: event.destroyedNodeIds,
              source: event.source,
              amount: event.amount,
              totalBiomass: event.totalBiomass,
              damageHp: event.damageHp,
              structuralThreshold: event.structuralThreshold,
            });
            break;
          case 'uproot':
            this.plantEventLog.append(event.plantId, {
              type: 'uproot',
              tick,
              data: {
                cause: event.cause,
                phase: event.phase,
                tiltRad: event.tiltRad,
                headingRad: event.headingRad,
              },
            });
            this.broadcast(MESSAGE_TYPE.PLANT_UPROOT, {
              plantId: event.plantId,
              phase: event.phase,
              cause: event.cause,
              x: event.x,
              y: event.y,
              z: event.z,
              tiltRad: event.tiltRad,
              headingRad: event.headingRad,
              windowRemainingS: event.windowRemainingS,
              nodes: this.plantNodeTransforms(event.plantId),
            });
            break;
          case 'reroot':
            this.plantEventLog.append(event.plantId, {
              type: 'reroot',
              tick,
              data: { x: event.x, y: event.y, z: event.z },
            });
            this.broadcast(MESSAGE_TYPE.PLANT_UPROOT, {
              plantId: event.plantId,
              phase: 'rooted',
              x: event.x,
              y: event.y,
              z: event.z,
              tiltRad: 0,
              headingRad: 0,
              windowRemainingS: 0,
              nodes: this.plantNodeTransforms(event.plantId),
            });
            break;
          case 'fauna':
            this.broadcast(MESSAGE_TYPE.FAUNA_EVENT, {
              phase: event.phase,
              x: event.x,
              z: event.z,
              radiusM: event.radiusM,
            });
            break;
          case 'drop':
            this.broadcast(MESSAGE_TYPE.DROP_SPAWN, event.drop);
            break;
          case 'drop_expired':
            this.broadcast(MESSAGE_TYPE.DROP_EXPIRED, { id: event.id });
            break;
          case 'kill_credit':
            this.broadcast(MESSAGE_TYPE.KILL_CREDIT, {
              plantId: event.plantId,
              credit: event.credit,
            });
            break;
        }
      } catch (error) {
        this.log.error('damage event broadcast failed', {
          kind: event.kind,
          error: String(error),
        });
      }
    }

    // Upkeep, thirst and hunger losses are damage too. They used to reach the
    // wire not at all: only the damage pipeline broadcast PLANT_DAMAGE, so a
    // wilting plant shrank in silence. One message per plant per tick, because
    // the losses themselves are already batched in PlantWorld.
    for (const shed of this.plantWorld.drainShedDamage()) {
      this.broadcast(MESSAGE_TYPE.PLANT_DAMAGE, {
        plantId: shed.plantId,
        nodeId: null,
        destroyedNodeIds: [],
        source: 'starvation',
        amount: Number(shed.amount.toFixed(3)),
        totalBiomass: Number(shed.totalBiomass.toFixed(3)),
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
    plantPersistence: PlantPersistence | null = null,
    maxFrameTimeMs = 100,
    itemsConfig: ReturnType<typeof loadItemsConfig>,
    chatConfig: ChatConfig,
    reportConfig: ReportConfig,
    seasonLengthDays = 36,
    terrain: TerrainService | null = null,
    eventLogCompactionThreshold = 10000,
    initialEvents: Map<string, PlantEvent[]> = new Map(),
  ) {
    this.config = config;
    this.log = log;
    this.plantWorld = plantWorld;
    this.resourceWorld = resourceWorld;
    this.weatherSystem = weatherSystem;
    this.interestManager = interestManager;
    this.plantPersistence = plantPersistence;
    this.terrain = terrain;
    this.maxFrameTimeMs = maxFrameTimeMs;
    this.persistenceEnabled = persistenceEnabled;
    this.plantEventLog = new PlantEventLog(eventLogCompactionThreshold);
    for (const [plantId, events] of initialEvents) {
      this.plantEventLog.seed(plantId, events);
    }
    this.itemsConfig = itemsConfig;
    this.chatConfig = chatConfig;
    this.reportConfig = reportConfig;
    // One clock per world: the season is world state, not per-plant state, so a
    // plant that dies and is replanted does not reset the calendar.
    this.seasonLengthDays = seasonLengthDays;
    this.seasonClock = createSeasonClock(seasonLengthDays, config.tickRateHz);
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

  setPersistenceEnabled(enabled: boolean): void {
    const previous = this.reconnectMachine;
    const pending = Array.from(previous.pendingRemovals.values());
    this.persistenceEnabled = enabled;
    // Recreate reconnect state machine with new setting
    this.reconnectMachine = createReconnectStateMachine(
      this.config.reconnectWindowMs ?? 300000,
      enabled,
    );

    // Replacing the machine used to orphan its pending entries: their timers kept
    // firing against the discarded map, and a reconnect looked in the new, empty
    // one, so a plant waiting for its owner could never be reclaimed. Re-arm each
    // entry in the new machine, or drop the plant now when persistence just went
    // off - that is what "no reconnect window" means.
    for (const entry of pending) {
      clearTimeout(entry.timeout);
      previous.pendingRemovals.delete(makeReclaimKey(entry.accountId, entry.plantId));
      const plant = this.plantWorld.getPlant(entry.plantId);
      if (!plant) continue;
      if (enabled) {
        reconnectStateMachineOnDisconnect(
          this.reconnectMachine,
          plant,
          entry.accountId,
          (plantId) => {
            this.plantWorld.removePlant(plantId);
            this.processPlantDeaths();
          },
          (msg, meta) => this.log.info(msg, meta),
        );
      } else {
        this.plantWorld.removePlant(entry.plantId);
        this.processPlantDeaths();
      }
    }
    if (pending.length > 0) {
      this.log.info('persistence toggle re-armed pending plants', {
        enabled,
        count: pending.length,
      });
    }
  }

  getPersistenceEnabled(): boolean {
    return this.persistenceEnabled;
  }

  getSeasonClock(): SeasonClock {
    return this.seasonClock;
  }

  /**
   * Adopt the saved calendar at boot. Remaining ticks are kept, so restarting
   * the server neither skips nor stretches a season.
   */
  restoreSeasonState(snapshot: SeasonSnapshot): void {
    this.seasonClock = restoreSeasonClock(this.seasonLengthDays, this.config.tickRateHz, snapshot);
    this.lastCalamityAt = snapshot.lastCalamityAt;
  }

  /** The calendar as persistence should store it. */
  getSeasonState(): SeasonSnapshot {
    return seasonSnapshot(this.seasonClock, this.getTick(), this.lastCalamityAt);
  }

  /**
   * Persistence lives outside the simulation, so a rollover hands its state to a
   * hook. A failed save must not stop the season from ending.
   */
  setSeasonEndedHook(hook: (state: SeasonSnapshot) => void): void {
    this.onSeasonEnded = hook;
  }

  /**
   * Current season state for a joining client. `calamity` is set only on the
   * update that announces a rollover, so a late joiner never sees one fired.
   */
  getSeasonUpdate(calamity = false): SeasonUpdatePayload {
    return seasonUpdatePayload(this.seasonClock, this.getTick(), this.config.tickRateHz, calamity);
  }

  /** Consume the death notice for a plant id, if it died in the world. */
  takeLostPlantReport(plantId: string): { cause: string; source?: string; at: number } | null {
    const report = this.lostPlantReportsByPlant.get(plantId);
    if (!report) return null;
    this.lostPlantReportsByPlant.delete(plantId);
    return report;
  }

  private updateSeason(tick: number): void {
    const advance = seasonClockAdvance(this.seasonClock, tick);
    // A dormant world can cross several boundaries while nobody watches; the
    // clock reports all of them at once rather than one per tick.
    if (advance.seasonsPassed === 0) return;
    this.seasonClock = advance.clock;
    this.endSeason(advance.seasonsPassed);
  }

  /**
   * The calamity: at a season boundary every plant still standing dies and the
   * next season starts from bare soil. It is the only death that is not the
   * player's fault, so the removal carries its cause for the loss screen.
   */
  private endSeason(seasonsPassed: number): void {
    let killed = 0;
    for (const plant of this.plantWorld.getAllPlants()) {
      if (this.plantWorld.killPlant(plant.id, 'calamity')) killed += 1;
    }
    this.processPlantDeaths();
    this.log.info('season ended', {
      season: this.seasonClock.season,
      seasonsPassed,
      killed,
    });
    this.broadcast(MESSAGE_TYPE.SEASON_UPDATE, this.getSeasonUpdate(true));
    this.lastCalamityAt = Date.now();
    try {
      this.onSeasonEnded?.(this.getSeasonState());
    } catch (error) {
      this.log.error('season-state save failed', { error: String(error) });
    }
  }

  /** Dev action: end the season now without waiting out its days. */
  forceSeasonEnd(tick: number): SeasonClock {
    this.seasonClock = {
      ...this.seasonClock,
      season: this.seasonClock.season + 1,
      startedTick: tick,
    };
    this.endSeason(1);
    return this.seasonClock;
  }

  /**
   * WELCOME payload for a player now attached to `plant`.
   *
   * Shared by joins and by the dev "Regenerate" action: a client adopts a plant
   * from WELCOME, so a replacement created only server-side leaves the removed
   * plant on screen until the page is reloaded.
   */
  buildWelcome(
    playerId: string,
    plant: import('@plant-legacy/shared/growth').Plant,
  ): WelcomePayload {
    const plantId = plant.id;
    const rootNodeId = plant.rootNodeId;
    const rootNode = rootNodeId != null ? plant.nodes.get(rootNodeId) : undefined;
    return {
      playerId,
      plantId,
      reconnectToken: this.issueReconnectToken(plantId),
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
      nodes: Array.from(plant.nodes.values()).map((n) =>
        nodeWireFields(n, this.plantWorld.getNodeHealth(plant.id, n.id)),
      ),
    };
  }

  /**
   * Wires a socket to `playerId` and `plantId` as an active, post-HELLO player.
   *
   * All three attach paths (join, account reclaim, anonymous reclaim) must do
   * the same four registry calls in the same order: register arms the HELLO
   * timer, so the plant has to be recorded and the timer cleared before the
   * message handler is installed. Getting the order wrong leaves the socket
   * closing at the timeout or silent after WELCOME.
   */
  private attachConnection(
    ws: WebSocket,
    playerId: string,
    plantId: string,
    accountId: string | undefined,
    timeoutMessage: string,
  ): void {
    connectionRegistryRegister(this.connectionRegistry, ws, playerId, accountId, (pid) => {
      this.log.warn(timeoutMessage, { playerId: pid });
      ws.close(4008, 'HELLO timeout');
    });
    connectionRegistrySetPlant(this.connectionRegistry, playerId, plantId);
    connectionRegistryClearHelloTimer(this.connectionRegistry, playerId);
    connectionRegistryInstallHandler(this.connectionRegistry, playerId, (data: Buffer) => {
      this.handlePostHelloMessage(playerId, data);
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
    const reusedPlant = existingPlants.length > 0;
    if (reusedPlant) {
      plant = existingPlants[0];
    } else {
      const spawn = this.findSpawnPosition();
      plant = this.plantWorld.createPlant(ownerId, 'world_0', spawn.x, spawn.z);
    }
    const plantId = plant.id;

    this.registerClientAtPlant(playerId, plant);

    this.attachConnection(ws, playerId, plantId, accountId, 'HELLO timeout, closing connection');

    const player: ConnectedPlayer = {
      ws,
      playerId,
      plantId,
      accountId,
      displayName: 'Player',
      lastInputTick: 0,
      pendingInputs: new Map(),
      inventory: createInventory(this.itemsConfig.inventorySlots),
      blocked: new Set<string>(),
      chatTimestamps: [],
    };
    // Give starting inventory
    for (const item of this.itemsConfig.startingInventory) {
      addItem(player.inventory, item.itemId, item.count, this.itemsConfig.itemDefinitions);
    }
    this.players.set(playerId, player);

    const welcome = this.buildWelcome(playerId, plant);
    const rootNode = plant.rootNodeId != null ? plant.nodes.get(plant.rootNodeId) : undefined;

    this.attachAwaySummary(welcome, plant);
    if (!reusedPlant && accountId) {
      // The account's last plant died while they were away; this new seed is a
      // replacement, not a continuation, and the player should be told.
      const loss = this.lostPlantReports.get(accountId);
      if (loss) {
        this.lostPlantReports.delete(accountId);
        welcome.previousPlantDied = {
          cause: loss.cause,
          source: loss.source,
          secondsAgo: Math.max(0, Math.round((Date.now() - loss.at) / 1000)),
        };
      }
    }
    this.log.info('player joined', {
      playerId,
      plantId,
      accountId: accountId ?? 'anonymous',
      totalPlayers: this.players.size,
    });

    // Broadcast new plant to all other connected players (multiplayer visibility)
    const plantCreatedPayload = this.plantCreatedPayload(plant);
    for (const otherPlayer of this.players.values()) {
      if (otherPlayer.playerId === playerId) continue;
      // Only players who can actually see the new plant need its full node set.
      if (
        !this.interestManager.isPositionInRange(
          otherPlayer.playerId,
          rootNode?.x ?? 0,
          rootNode?.z ?? 0,
        )
      ) {
        continue;
      }
      this.send(otherPlayer.ws, MESSAGE_TYPE.PLANT_CREATED, plantCreatedPayload);
    }

    // Register plant root node as entity in InterestManager
    if (rootNode) {
      this.interestManager.addEntityToCell(plantId, rootNode.x, rootNode.z);
    }

    return { plantId, welcome };
  }

  removePlayer(playerId: string): void {
    const disconnectedPlantId = this.players.get(playerId)?.plantId ?? null;

    if (disconnectedPlantId) {
      const plant = this.plantWorld.getPlant(disconnectedPlantId);
      if (plant) {
        this.awaySnapshots.set(disconnectedPlantId, {
          at: Date.now(),
          nodes: plant.nodes.size,
          biomass: plant.totalBiomass,
          energy: plant.totalEnergy,
          water: plant.storedWater ?? 0,
          minerals: plant.storedMinerals ?? 0,
        });
      }
    }

    connectionRegistryRemove(
      this.connectionRegistry,
      playerId,
      this.reconnectMachine,
      (plantId) => {
        // With persistence, the plant stays in the world after the reconnect
        // window. Removing it here is what made logging out a death sentence:
        // the plant was killed as `removed`, broadcast as PLANT_REMOVED to
        // everyone, and its tiles released, while the saved row survived - so a
        // restart resurrected a plant every client had watched die. Without
        // persistence there is nothing to return to, so removal is correct.
        if (this.persistenceEnabled) {
          this.log.info('reconnect window expired, plant stays in the world', { plantId });
          return;
        }
        this.plantWorld.removePlant(plantId);
        this.processPlantDeaths();
      },
      (msg, meta) => this.log.info(msg, meta),
    );

    // Persist at the one moment the periodic loop is least likely to cover: a
    // disconnect (or the crash right after it) would otherwise cost up to
    // `world.plant_save_interval_s` of growth. Only saved when the plant survived
    // the reconnect decision above.
    if (disconnectedPlantId && this.plantPersistence) {
      const disconnectedPlant = this.plantWorld.getPlant(disconnectedPlantId);
      if (disconnectedPlant) {
        this.plantPersistence
          .savePlant(disconnectedPlant, this.plantEventLog.get(disconnectedPlantId))
          .catch((error: unknown) => {
            this.log.error('plant save on disconnect failed', {
              plantId: disconnectedPlantId,
              error: String(error),
            });
          });
      }
    }

    this.interestManager.unregisterClient(playerId);
    this.players.delete(playerId);
    this.lastRootResourceUpdate.delete(playerId);
    // Otherwise every player who ever reported leaves a permanent entry behind.
    this.recentReports.delete(playerId);
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
      const oldPlayer = this.players.get(oldPlayerId);
      if (oldPlayer) {
        // The old tab used to lose its socket silently and reconnect as a guest,
        // which looked like a normal network drop.
        try {
          this.send(oldPlayer.ws, MESSAGE_TYPE.ERROR, {
            code: 'SESSION_REPLACED',
            message: 'This account signed in elsewhere.',
          });
          oldPlayer.ws.close(4002, 'Session replaced');
        } catch {
          // Socket already gone between lookup and send.
        }
      }
      connectionRegistryTransferPlant(this.connectionRegistry, oldPlayerId, newPlayerId);
      this.interestManager.unregisterClient(oldPlayerId);
      this.players.delete(oldPlayerId);
      this.lastRootResourceUpdate.delete(oldPlayerId);
      growthIntentStateMachineClear(this.growthIntentMachine, oldPlayerId);
      this.log.info('removed old player connection on reclaim', {
        oldPlayerId,
        newPlayerId,
        accountId,
      });
    }

    this.attachConnection(
      ws,
      newPlayerId,
      reclaimed.plantId,
      accountId,
      'HELLO timeout on reclaimed connection',
    );

    const plant = this.plantWorld.getPlant(reclaimed.plantId);
    if (!plant) return null;

    this.registerClientAtPlant(newPlayerId, plant);

    const player: ConnectedPlayer = {
      ws,
      playerId: newPlayerId,
      plantId: plant.id,
      accountId,
      displayName: 'Player',
      lastInputTick: 0,
      pendingInputs: new Map(),
      inventory: createInventory(this.itemsConfig.inventorySlots),
      blocked: new Set<string>(),
      chatTimestamps: [],
    };
    this.players.set(newPlayerId, player);

    const rootNodeId = plant.rootNodeId;
    const rootNode = rootNodeId != null ? plant.nodes.get(rootNodeId) : undefined;

    const welcome: WelcomePayload = {
      playerId: newPlayerId,
      plantId: plant.id,
      reconnectToken: this.issueReconnectToken(plant.id),
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
      nodes: Array.from(plant.nodes.values()).map((n) =>
        nodeWireFields(n, this.plantWorld.getNodeHealth(plant.id, n.id)),
      ),
    };

    this.attachAwaySummary(welcome, plant);
    this.log.info('player reconnected, plant reclaimed', {
      newPlayerId,
      oldPlantId: reclaimed.plantId,
      accountId,
      totalPlayers: this.players.size,
    });

    return { plantId: plant.id, welcome };
  }

  /** Rotates and returns the one-time reclaim secret for a plant. */
  private issueReconnectToken(plantId: string): string {
    const token = randomBytes(24).toString('hex');
    this.plantReconnectTokens.set(plantId, token);
    return token;
  }

  private isReconnectTokenValid(plantId: string, token: string | undefined): boolean {
    if (!token) return false;
    const expected = this.plantReconnectTokens.get(plantId);
    return expected !== undefined && expected === token;
  }

  private findPlayerByPlantId(plantId: string): string | null {
    for (const [playerId, player] of this.players.entries()) {
      if (player.plantId === plantId) return playerId;
    }
    return null;
  }

  /**
   * Attach the away report a returning player sees. Consumed once: a stale
   * report would otherwise reappear on every later reconnect.
   */
  private attachAwaySummary(
    welcome: WelcomePayload,
    plant: import('@plant-legacy/shared/growth').Plant,
  ): void {
    const snapshot = this.awaySnapshots.get(plant.id);
    if (!snapshot) return;
    this.awaySnapshots.delete(plant.id);
    welcome.away = {
      seconds: Math.max(0, Math.round((Date.now() - snapshot.at) / 1000)),
      nodesBefore: snapshot.nodes,
      nodesAfter: plant.nodes.size,
      biomass: plant.totalBiomass - snapshot.biomass,
      energy: plant.totalEnergy - snapshot.energy,
      water: (plant.storedWater ?? 0) - snapshot.water,
      minerals: (plant.storedMinerals ?? 0) - snapshot.minerals,
    };
  }

  /**
   * Hand a guest plant to the account that just signed in. Without this, signing
   * up created a second plant and abandoned the guest one, which contradicts
   * what the entry screen promises.
   */
  adoptGuestPlant(accountId: string, plantId: string, reconnectToken: string | undefined): boolean {
    const plant = this.plantWorld.getPlant(plantId);
    if (!plant) return false;
    const adoptable = canAdoptGuestPlant({
      plantOwnerId: plant.ownerId,
      tokenValid: this.isReconnectTokenValid(plantId, reconnectToken),
      ownerAttached: this.findPlayerByPlantId(plantId) !== null,
    });
    if (!adoptable) return false;
    const previousOwner = plant.ownerId;
    this.plantWorld.reassignOwner(plantId, accountId);
    this.log.info('guest plant adopted by account', {
      accountId,
      plantId,
      previousOwner,
    });
    return true;
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
    reconnectToken: string | undefined,
  ): { plantId: string; welcome: WelcomePayload } | null {
    // A plant id is public - it is in every broadcast - so it cannot authorise a
    // reclaim. Only the client that was handed this plant's secret may take it
    // back; otherwise any player could claim someone else's dropped plant.
    if (!this.isReconnectTokenValid(plantId, reconnectToken)) {
      this.log.warn('anonymous reclaim rejected: missing or invalid reconnect token', {
        plantId,
        newPlayerId,
      });
      return null;
    }

    const reclaimed = reconnectStateMachineReclaimByPlantId(
      this.reconnectMachine,
      plantId,
      (msg, meta) => this.log.info(msg, meta),
    );
    // The reconnect window now governs only the quick-reclaim bookkeeping. With
    // persistence the plant stays resident, so a guest may take their own plant
    // back long after the window, as long as they still hold its token and
    // nobody is tending it. Without this the guest silently started a second
    // plant and abandoned the first.
    const resident = this.plantWorld.getPlant(plantId);
    if (!reclaimed) {
      if (!resident || this.findPlayerByPlantId(plantId) !== null) return null;
      // The long-lived token must never pull an account plant back into the
      // anonymous pool, even though the client that adopted it still holds it.
      if (!isAnonymousOwner(resident.ownerId)) return null;
      this.plantWorld.reassignOwner(plantId, newPlayerId);
    }

    this.attachConnection(
      ws,
      newPlayerId,
      plantId,
      undefined,
      'HELLO timeout on reclaimed connection',
    );

    const plant = this.plantWorld.getPlant(plantId);
    if (!plant) return null;

    this.registerClientAtPlant(newPlayerId, plant);

    const player: ConnectedPlayer = {
      ws,
      playerId: newPlayerId,
      plantId: plant.id,
      accountId: undefined,
      displayName: 'Player',
      lastInputTick: 0,
      pendingInputs: new Map(),
      inventory: createInventory(this.itemsConfig.inventorySlots),
      blocked: new Set<string>(),
      chatTimestamps: [],
    };
    this.players.set(newPlayerId, player);

    const rootNodeId = plant.rootNodeId;
    const rootNode = rootNodeId != null ? plant.nodes.get(rootNodeId) : undefined;

    const welcome: WelcomePayload = {
      playerId: newPlayerId,
      plantId: plant.id,
      reconnectToken: this.issueReconnectToken(plant.id),
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
      nodes: Array.from(plant.nodes.values()).map((n) =>
        nodeWireFields(n, this.plantWorld.getNodeHealth(plant.id, n.id)),
      ),
    };

    this.attachAwaySummary(welcome, plant);
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
    // INPUT is stateless held-direction state and its tick comes from the client,
    // so the old append-only map was an unbounded queue: one tick's drain would
    // apply every entry, and a client that never advanced `tick` could grow it
    // without limit. Only the newest input carries information, so keep one.
    if (!Number.isFinite(input.tick) || input.tick <= player.lastInputTick) return;
    player.pendingInputs.clear();
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

  private sendInventorySync(player: ConnectedPlayer): void {
    const slots = player.inventory.slots.map((slot) =>
      slot ? { itemId: slot.itemId, count: slot.count } : { itemId: null, count: null },
    );
    this.send(player.ws, MESSAGE_TYPE.INVENTORY_SYNC, {
      slots,
      maxSlots: player.inventory.maxSlots,
      // The definitions travel with the slots. The client used to have only an
      // item id, so it drew "Starter Dung" from a table it invented and had no
      // description to show at all. Sending the server's own definition means
      // the panel can never describe an effect the server would not perform.
      definitions: Array.from(this.itemsConfig.itemDefinitions.values()).map((def) => ({
        id: def.id,
        name: def.name,
        description: def.description,
        category: def.category,
        stackLimit: def.stack_limit,
        use: def.use,
      })),
    });
  }

  private sendInventorySlotUpdate(player: ConnectedPlayer, slotIndex: number): void {
    if (slotIndex < 0 || slotIndex >= player.inventory.maxSlots) return;
    const slot = player.inventory.slots[slotIndex];
    this.send(player.ws, MESSAGE_TYPE.INVENTORY_SLOT_UPDATE, {
      slotIndex,
      itemId: slot?.itemId ?? null,
      count: slot?.count ?? null,
    });
  }

  private handleInventorySlotUse(player: ConnectedPlayer, slotIndex: number): void {
    if (slotIndex < 0 || slotIndex >= player.inventory.maxSlots) {
      this.log.warn('Invalid inventory slot index', { playerId: player.playerId, slotIndex });
      return;
    }

    const slot = player.inventory.slots[slotIndex];
    if (!slot) return;

    const itemDef = this.itemsConfig.itemDefinitions.get(slot.itemId);
    if (!itemDef) return;

    // One handler for every item. The definition owns what Use does; an item
    // that cannot be used yet says so out loud instead of the old silent no-op
    // (gene boosters and both seed types were clicked into a void).
    if (itemDef.use.kind !== 'resources') {
      this.send(player.ws, MESSAGE_TYPE.REJECT, {
        reason: 'item_not_usable',
        originalType: MESSAGE_TYPE.INVENTORY_SLOT_USE,
      });
      return;
    }

    if (!player.plantId) return;
    const plant = this.plantWorld.getPlant(player.plantId);
    if (!plant) return;

    const use = itemDef.use;
    if (use.water > 0) plant.storedWater += use.water;
    if (use.minerals > 0) plant.storedMinerals += use.minerals;
    if (use.energy > 0) plant.totalEnergy += use.energy;
    clampPlantStorage(plant, this.plantWorld.getConfig());

    // Enrich the soil under the root too: `dung_deposit` and
    // `fertilizer_deposit` were configured but never applied, because nothing
    // ever called these two methods.
    const rootNode = plant.rootNodeId != null ? plant.nodes.get(plant.rootNodeId) : undefined;
    if (rootNode) {
      if (itemDef.category === 'fertilizer') {
        this.resourceWorld.onFertilizerApplied(rootNode.x, rootNode.z);
      } else if (itemDef.category === 'dung') {
        this.resourceWorld.onDungApplied(rootNode.x, rootNode.z);
      }
    }

    // Remove one from inventory
    this.removeItemFromInventory(player, slotIndex, 1);
    this.sendInventorySlotUpdate(player, slotIndex);

    this.log.info('Item used', {
      playerId: player.playerId,
      itemId: slot.itemId,
      category: itemDef.category,
    });
  }

  private removeItemFromInventory(player: ConnectedPlayer, slotIndex: number, count: number): void {
    const slot = player.inventory.slots[slotIndex];
    if (!slot) return;

    slot.count -= count;
    if (slot.count <= 0) {
      player.inventory.slots[slotIndex] = null;
    }
  }

  private handleInventorySlotSwap(
    player: ConnectedPlayer,
    fromIndex: number,
    toIndex: number,
  ): void {
    if (fromIndex < 0 || fromIndex >= player.inventory.maxSlots) return;
    if (toIndex < 0 || toIndex >= player.inventory.maxSlots) return;

    const temp = player.inventory.slots[fromIndex];
    player.inventory.slots[fromIndex] = player.inventory.slots[toIndex];
    player.inventory.slots[toIndex] = temp;

    this.sendInventorySlotUpdate(player, fromIndex);
    this.sendInventorySlotUpdate(player, toIndex);
  }

  handlePostHelloMessage(playerId: string, data: Buffer): void {
    try {
      const message = JSON.parse(data.toString());
      const { type, payload } = message;

      // Validate message schema before processing
      const validation = validateMessage(type, payload);
      if (!validation.ok) {
        this.log.warn('PlantLegacy: skipping malformed client message', {
          playerId,
          type,
          issues: validation.issues,
          payloadKeys: Object.keys(payload || {}),
        });
        return;
      }

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
        case MESSAGE_TYPE.REROOT_INTENT: {
          const player = this.players.get(playerId);
          const intent = payload as { dirX?: number; dirZ?: number };
          if (!player?.plantId) break;
          if (typeof intent?.dirX !== 'number' || typeof intent?.dirZ !== 'number') break;
          this.damagePipeline?.requestReroot(player.plantId, intent.dirX, intent.dirZ);
          break;
        }
        case MESSAGE_TYPE.MUTATION_SHED: {
          const shed = payload as { plantId?: string; mutationId?: string };
          const player = this.players.get(playerId);
          if (
            player?.plantId &&
            typeof shed?.mutationId === 'string' &&
            shed.plantId === player.plantId
          ) {
            const result = this.plantWorld.shedMutation(
              player.plantId,
              shed.mutationId,
              this.getTick(),
            );
            if (result.ok) {
              this.sendMutationState(player);
            } else {
              this.send(player.ws, MESSAGE_TYPE.ERROR, {
                code: result.reason ?? 'shed_refused',
                message: 'Mutation was not shed',
              });
            }
          }
          break;
        }
        case MESSAGE_TYPE.MUTATION_LEVEL: {
          const level = payload as { plantId?: string; mutationId?: string; cardId?: string };
          const player = this.players.get(playerId);
          if (
            !player?.plantId ||
            typeof level?.mutationId !== 'string' ||
            level.plantId !== player.plantId
          ) {
            break;
          }
          // No card: deal the cards and let the panel show the choice. A card:
          // take it, but only from the deal the server itself laid out.
          if (typeof level.cardId === 'string') {
            const result = this.plantWorld.chooseMutationLevel(
              player.plantId,
              level.mutationId,
              level.cardId,
              this.getTick(),
            );
            if (result.ok) {
              this.sendMutationState(player);
            } else {
              this.send(player.ws, MESSAGE_TYPE.ERROR, {
                code: result.reason ?? 'level_refused',
                message: 'Mutation was not levelled',
              });
              // A refused choice still needs the panel back in sync: the deal may
              // have gone stale (level reached, cost no longer affordable).
              this.sendMutationState(player);
            }
          } else {
            const deal = this.plantWorld.offerMutationLevel(player.plantId, level.mutationId);
            if (!deal.ok) {
              this.send(player.ws, MESSAGE_TYPE.ERROR, {
                code: deal.reason ?? 'level_refused',
                message: 'No cards were dealt for that mutation',
              });
            }
            this.sendMutationState(player);
          }
          break;
        }
        case MESSAGE_TYPE.PING: {
          const player = this.players.get(playerId);
          if (player) this.handlePing(player.ws);
          break;
        }
        case MESSAGE_TYPE.RESOURCE_QUERY: {
          const query = payload as ResourceQueryPayload & { fullGrid?: boolean };
          let resources: { light: number; moisture: number; minerals: number } | null = null;
          let tileX: number | undefined;
          let tileZ: number | undefined;

          // Support full grid request for ground rendering
          if (query.fullGrid) {
            const player = this.players.get(playerId);
            if (player?.plantId) {
              const plant = this.plantWorld.getPlant(player.plantId);
              if (plant) {
                const gridWidth = this.resourceWorld.getWidth();
                const gridHeight = this.resourceWorld.getHeight();
                this.send(player.ws, MESSAGE_TYPE.RESOURCE_UPDATE, {
                  tick: this.getTick(),
                  gridBase64: encodeResourceGridBase64(
                    gridWidth,
                    gridHeight,
                    this.resourceWorld.getAllTiles(),
                  ),
                  width: this.resourceWorld.getWidth(),
                  height: this.resourceWorld.getHeight(),
                  tileSize: this.resourceWorld.getTileSize(),
                  totalEnergy: plant.totalEnergy,
                  totalBiomass: plant.totalBiomass,
                  storedWater: plant.storedWater,
                  storedMinerals: plant.storedMinerals,
                  waterCapacity:
                    this.plantWorld.getPlantCapacity(plant.id)?.water ??
                    computePlantCapacity(plant, this.plantWorld.getConfig()).water,
                  mineralCapacity:
                    this.plantWorld.getPlantCapacity(plant.id)?.minerals ??
                    computePlantCapacity(plant, this.plantWorld.getConfig()).minerals,
                  coveredTileCount: this.resourceWorld.getCoveredTileCount(plant),
                  fullGrid: true,
                });
              }
            }
            break;
          }

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
                  waterCapacity:
                    this.plantWorld.getPlantCapacity(plant.id)?.water ??
                    computePlantCapacity(plant, this.plantWorld.getConfig()).water,
                  mineralCapacity:
                    this.plantWorld.getPlantCapacity(plant.id)?.minerals ??
                    computePlantCapacity(plant, this.plantWorld.getConfig()).minerals,
                  coveredTileCount: this.resourceWorld.getCoveredTileCount(plant),
                });
              }
            }
          }
          break;
        }
        case MESSAGE_TYPE.PLANT_SYNC_REQUEST: {
          const player = this.players.get(playerId);
          // Interest range, not connectivity: filtering by connected players left
          // every saved or offline plant out of the world for anyone who joined
          // after its owner left, even when it stood right beside them.
          const syncPlants = player
            ? selectVisiblePlants({
                plants: this.plantWorld.getAllPlants(),
                playerId,
                ownPlantId: player.plantId,
                isInRange: (pid, x, z) => this.interestManager.isPositionInRange(pid, x, z),
              })
            : [];
          const syncPayload: PlantSyncPayload = {
            plants: syncPlants.map((p) => ({
              id: p.id,
              ownerId: p.ownerId,
              rootNodeId: p.rootNodeId,
              totalBiomass: p.totalBiomass,
              totalEnergy: p.totalEnergy,
              totalUpkeep: p.totalUpkeep,
              appearance: this.plantWorld.getPlantAppearance(p.id) ?? undefined,
              pigment: this.plantWorld.getPlantPigment(p.id) ?? undefined,
              // Display names, so a rival (or a gallery plant) can carry a tag
              // with the mutation it expresses.
              mutations: (
                this.plantWorld.getMutationState(p.id, this.getTick())?.mutations ?? []
              ).map((mutation) => mutation.name),
              nodes: Array.from(p.nodes.values()).map((n) => ({
                id: n.id,
                plantId: n.plantId,
                type: n.type,
                layer: n.layer,
                x: n.x,
                y: n.y,
                z: n.z,
                biomass: n.biomass,
                health: this.plantWorld.getNodeHealth(p.id, n.id),
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
                mutationFlags: n.mutationFlags ?? 0,
                targetX: n.targetX,
                targetY: n.targetY,
                targetZ: n.targetZ,
                parentAttachX: n.parentAttachX,
                parentAttachY: n.parentAttachY,
                parentAttachZ: n.parentAttachZ,
                attachFraction: n.attachFraction,
                growthTimeSeconds: n.growthTimeSeconds,
                growthStartTick: n.growthStartTick,
              })),
            })),
          };

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
        case MESSAGE_TYPE.DEV_ACTION: {
          // D01: Handle dev panel actions (local runs only)
          if (!devToolsAllowed()) {
            this.log.warn('Dev action rejected outside a local run', {
              type: (payload as Record<string, unknown>)?.type,
            });
            break;
          }
          const devAction = payload as { type: string; [key: string]: unknown };
          const player = this.players.get(playerId);
          if (player?.ws) {
            this.handleDevAction(playerId, player.ws, devAction);
          }
          break;
        }
        case MESSAGE_TYPE.CHAT_MESSAGE: {
          const chatPayload = payload as { message: string; mode?: string };
          const player = this.players.get(playerId);
          if (!player || !chatPayload?.message) break;

          const message = chatPayload.message.trim().slice(0, this.chatConfig.messageMaxChars);
          if (message.length === 0) break;

          if (!this.consumeChatBudget(player)) {
            this.send(player.ws, MESSAGE_TYPE.ERROR, {
              code: 'chat_rate_limit',
              message: 'Chat rate limit reached. Slow down.',
            });
            break;
          }

          const mode: 'world' | 'proximity' =
            chatPayload.mode === 'proximity' ? 'proximity' : 'world';

          const emoteMatch = message.match(/^\/emote\s+(\w+)$/i);
          if (emoteMatch) {
            const emoteId = emoteMatch[1].toLowerCase();
            if (this.chatConfig.emoteIds.includes(emoteId)) {
              this.deliverChat(playerId, mode, {
                playerId,
                playerName: player.displayName ?? 'Player',
                emoteId,
                timestamp: Date.now(),
                type: 'emote',
              });
              break;
            }
          }

          this.deliverChat(playerId, mode, {
            playerId,
            playerName: player.displayName ?? 'Player',
            message,
            timestamp: Date.now(),
          });
          break;
        }
        case MESSAGE_TYPE.BLOCK: {
          const blockPayload = payload as { targetPlayerId: string; blocked: boolean };
          const player = this.players.get(playerId);
          if (!player || !blockPayload?.targetPlayerId) break;
          if (blockPayload.targetPlayerId === playerId) break;
          if (blockPayload.blocked) {
            player.blocked.add(blockPayload.targetPlayerId);
          } else {
            player.blocked.delete(blockPayload.targetPlayerId);
          }
          break;
        }
        case MESSAGE_TYPE.REPORT: {
          const reportPayload = payload as {
            targetPlayerId: string;
            targetPlayerName?: string;
            reason: string;
            freeText?: string;
            block?: boolean;
            contextSnapshot?: Array<{ playerName: string; message: string; timestamp: number }>;
            timestamp: number;
          };
          const reporter = this.players.get(playerId);
          if (!reporter || !reportPayload?.targetPlayerId) break;

          // T05: rate limit reports per reporter (server-side enforcement)
          const now = Date.now();
          const reporterReports = this.recentReports.get(reporter.playerId) ?? [];
          const windowStart = now - 60000;
          const recent = reporterReports.filter((t) => t > windowStart);
          const reportRateLimit = this.reportConfig.reportRateLimitPerMin;
          if (recent.length >= reportRateLimit) {
            this.send(reporter.ws, MESSAGE_TYPE.ERROR, {
              code: 'report_rate_limit',
              message: 'Report rate limit reached. Try again later.',
            });
            break;
          }
          this.recentReports.set(reporter.playerId, [...recent, now]);

          // T05: store report with context snapshot. These two bounds are
          // configured but were never applied, so a single message could carry an
          // arbitrarily long free-text note and transcript.
          const freeText = String(reportPayload.freeText ?? '').slice(
            0,
            this.reportConfig.reportFreeTextMax,
          );
          const contextSnapshot = Array.isArray(reportPayload.contextSnapshot)
            ? reportPayload.contextSnapshot.slice(0, this.reportConfig.contextLineCount)
            : [];
          const reportRecord = {
            reporterId: reporter.playerId,
            reporterName: reporter.displayName ?? 'Player',
            targetPlayerId: reportPayload.targetPlayerId,
            targetPlayerName: reportPayload.targetPlayerName ?? 'Unknown',
            reason: reportPayload.reason,
            freeText,
            block: reportPayload.block ?? false,
            contextSnapshot,
            timestamp: now,
          };
          this.reports.push(reportRecord);
          // Nothing drains this list, so bound it and keep the newest reports.
          if (this.reports.length > this.reportConfig.maxStoredReports) {
            this.reports.splice(0, this.reports.length - this.reportConfig.maxStoredReports);
          }

          // T05: blocking is per reporter, so only this player stops seeing the target.
          if (reportPayload.block) {
            reporter.blocked.add(reportPayload.targetPlayerId);
          }

          // Plain confirmation - never tell reporter what action was taken
          this.send(reporter.ws, MESSAGE_TYPE.ERROR, {
            code: 'report_received',
            message: 'Report submitted',
          });
          break;
        }
        case MESSAGE_TYPE.TERRAIN_REGION_REQUEST: {
          const player = this.players.get(playerId);
          if (!player || !this.terrain) break;
          const request = payload as {
            worldX: number;
            worldZ: number;
            radiusM: number;
            revision?: number;
          };
          if (
            !Number.isFinite(request.worldX) ||
            !Number.isFinite(request.worldZ) ||
            !Number.isFinite(request.radiusM)
          ) {
            break;
          }
          // A client may ask for a region around any point it can reach; cap the
          // work and the payload so one request cannot pull the whole world.
          const radiusM = Math.max(4, Math.min(120, request.radiusM));
          const region = this.terrain.getRegion(request.worldX, request.worldZ, radiusM);
          this.send(player.ws, MESSAGE_TYPE.TERRAIN_REGION, {
            originX: region.originX,
            originZ: region.originZ,
            cellSizeM: region.cellSizeM,
            cols: region.cols,
            rows: region.rows,
            revision: region.revision,
            heightsBase64: Buffer.from(
              region.heights.buffer,
              region.heights.byteOffset,
              region.heights.byteLength,
            ).toString('base64'),
            materialBase64: Buffer.from(region.moisture).toString('base64'),
          });
          const edits = this.terrain
            .getEditsSince(Math.max(0, Number(request.revision ?? 0)))
            .filter(
              (edit) =>
                Math.hypot(edit.x - request.worldX, edit.z - request.worldZ) <= radiusM + 32,
            );
          this.send(player.ws, MESSAGE_TYPE.TERRAIN_EDITS, {
            revision: this.terrain.getLatestRevision(),
            edits,
          });
          break;
        }
        case MESSAGE_TYPE.INVENTORY_REQUEST: {
          const player = this.players.get(playerId);
          if (!player) break;
          this.sendInventorySync(player);
          break;
        }
        case MESSAGE_TYPE.INVENTORY_SLOT_USE: {
          const payload2 = payload as { slotIndex: number };
          const player2 = this.players.get(playerId);
          if (!player2) break;
          this.handleInventorySlotUse(player2, payload2.slotIndex);
          break;
        }
        case MESSAGE_TYPE.INVENTORY_SLOT_SWAP: {
          const payload2 = payload as { fromIndex: number; toIndex: number };
          const player2 = this.players.get(playerId);
          if (!player2) break;
          this.handleInventorySlotSwap(player2, payload2.fromIndex, payload2.toIndex);
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
    // Soil collapse and drying run slower than the tick and are gated inside.
    this.terrain?.tick(dt, tick);
    this.terrain?.dry(dt);

    for (const player of this.players.values()) {
      if (player.plantId) {
        const plant = this.plantWorld.getPlant(player.plantId);
        if (plant?.rootNodeId) {
          const rootNode = plant.nodes.get(plant.rootNodeId);
          if (rootNode) {
            // A cell crossing reveals plants that appeared while this player was
            // elsewhere; PLANT_CREATED is only sent when a plant is created.
            if (
              this.interestManager.updateClientPosition(player.playerId, rootNode.x, rootNode.z)
            ) {
              this.announcePlantsInRange(player);
            }
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

    // Root uptake first: capture is what makes photosynthesis possible.
    this.plantWorld.absorbResourcesFromTiles(dt, (x, z) =>
      this.resourceWorld.getTileResources(x, z),
    );

    this.plantWorld.step(dt, onlinePlantIds, tick);
    for (const transition of this.plantWorld.drainTierTransitions()) {
      this.plantEventLog.append(transition.plantId, {
        type: 'tier_change',
        tick,
        data: { from: transition.oldTier, to: transition.newTier },
      });
    }

    this.processPlantGrowthEvents();
    this.processPlantDeaths();

    const plantsForResource = new Map<string, import('./ops/resourceWorld.ts').PlantForResource>();
    for (const player of this.players.values()) {
      if (player.plantId) {
        const plant = this.plantWorld.getPlant(player.plantId);
        if (plant) {
          plantsForResource.set(plant.id, this.plantResourceView(plant));
        }
      }
    }
    this.weatherSystem.update(dt);
    const weatherBroadcast = this.weatherSystem.getBroadcast();

    // T06 runs after the weather has advanced so a gust and a lightning strike
    // use this tick's state, and before the resource pass so a plant that died
    // is no longer drawing water.
    this.damagePipeline?.tick(dt, tick);
    this.processDamageEvents();
    this.processPlantDeaths();
    this.processDamageEvents();
    // A plant killed by damage must not keep drawing water this tick.
    for (const plantId of plantsForResource.keys()) {
      if (!this.plantWorld.getPlant(plantId)) plantsForResource.delete(plantId);
    }

    this.resourceWorld.step(
      dt,
      plantsForResource,
      this.weatherSystem.getMoistureDepositPerSecond(),
      this.weatherSystem.getWeatherLightMultiplier(),
      this.weatherSystem.getTimeOfDay(),
    );

    for (const plant of plantsForResource.values()) {
      const realPlant = this.plantWorld.getPlant(plant.id);
      if (!realPlant) continue;
      this.applyPhotosynthesis(plant, realPlant, dt);
    }

    const isKeyframe = tick % this.config.keyframeIntervalTicks === 0;

    const plantStates: Array<{
      id: string;
      totalBiomass: number;
      totalEnergy: number;
      totalUpkeep: number;
      structure?: { damageHp: number; threshold: number };
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
          structure: this.damagePipeline?.getStructure(plant.id, plant.totalBiomass),
        });
      }
    }

    // Per-player, by interest cell. The payload is small but it went to every
    // connection 20 times a second, including players whose cells contain none of
    // these plants. The owner's own plant is always included so a client never
    // loses sight of itself.
    const plantPositions = new Map<string, { x: number; z: number }>();
    for (const state of plantStates) {
      const plant = this.plantWorld.getPlant(state.id);
      const root = plant?.rootNodeId ? plant.nodes.get(plant.rootNodeId) : undefined;
      if (root) plantPositions.set(state.id, { x: root.x, z: root.z });
    }
    const stateType = isKeyframe ? MESSAGE_TYPE.KEYFRAME : MESSAGE_TYPE.STATE;
    // Honour the configured wire rate. A keyframe is always sent on its own
    // interval even when the state cadence is slower, so a late joiner and a
    // reconnecting client still get a full snapshot.
    const stateStep = stepCadence(
      this.stateCadenceAccumulatorMs,
      dt * 1000,
      this.config.clientSendRateHz,
    );
    this.stateCadenceAccumulatorMs = stateStep.nextAccumulatorMs;
    const sendStateNow = isKeyframe || stateStep.due;
    const payloadFor = (playerId: string, ownPlantId: string | null) => ({
      tick,
      plants: plantStates.filter((state) => {
        if (state.id === ownPlantId) return true;
        const position = plantPositions.get(state.id);
        return position
          ? this.interestManager.isPositionInRange(playerId, position.x, position.z)
          : false;
      }),
      worldBounds: this.config.worldBounds,
      tileSize: this.resourceWorld.getTileSize(),
    });
    for (const player of this.players.values()) {
      if (!sendStateNow) {
        this.stateMessagesSkipped += 1;
        continue;
      }
      this.stateMessagesSent += 1;
      this.writeIfHealthy(
        player.ws,
        JSON.stringify({ type: stateType, payload: payloadFor(player.playerId, player.plantId) }),
        stateType,
      );
    }

    // Broadcast only dirty (changed) tiles - delta compression for bandwidth efficiency.
    // Count first: building the tile array for a whole-grid update allocates ~65k
    // objects and touches three maps, which at 20 Hz cost more than the broadcast.
    const gridWidth = this.resourceWorld.getWidth();
    const gridHeight = this.resourceWorld.getHeight();
    const nowMs = Date.now();
    const dirtyCount = this.resourceWorld.getDirtyTileCount();
    const isWholeGrid = dirtyCount > COMPACT_GRID_TILE_THRESHOLD;
    // Whole-grid updates (daylight / weather re-tinting every tile) are capped at
    // one per second; skipping one is harmless because the next event dirties
    // every tile again. Small deltas are never delayed.
    const wholeGridThrottled =
      isWholeGrid && nowMs - this.lastCompactGridBroadcastAt < World.COMPACT_GRID_MIN_INTERVAL_MS;
    if (dirtyCount > 0 && !wholeGridThrottled) {
      const dirtyTiles = this.resourceWorld.getDirtyTiles();
      if (isWholeGrid) {
        this.lastCompactGridBroadcastAt = nowMs;
        this.broadcast(MESSAGE_TYPE.RESOURCE_UPDATE, {
          tick,
          width: gridWidth,
          height: gridHeight,
          tileSize: this.resourceWorld.getTileSize(),
          delta: true,
          gridBase64: encodeResourceGridBase64(gridWidth, gridHeight, dirtyTiles),
        });
      } else {
        this.broadcast(MESSAGE_TYPE.RESOURCE_UPDATE, {
          tick,
          tiles: dirtyTiles,
          width: gridWidth,
          height: gridHeight,
          tileSize: this.resourceWorld.getTileSize(),
          delta: true,
        });
      }
    }

    for (const player of this.players.values()) {
      if (!player.plantId) continue;
      // The root readout rides the state cadence; it is the largest per-player
      // payload on the hot path and the client cannot use it faster than the
      // state it belongs to.
      if (!sendStateNow) {
        this.rootMessagesSkipped += 1;
        continue;
      }
      const plant = this.plantWorld.getPlant(player.plantId);
      if (!plant) continue;

      // Every tile any part of the plant overlaps, summarised. A node touching a
      // tile by even a sliver counts that tile in the average, whether it sits
      // below the soil or over it.
      const coverage = this.resourceWorld.getPlantTileCoverage(plant);
      if (coverage.count === 0) continue;

      const capacity =
        this.plantWorld.getPlantCapacity(plant.id) ??
        computePlantCapacity(plant, this.plantWorld.getConfig());
      const snapshot: RootResourceSnapshot = {
        totalEnergy: plant.totalEnergy,
        totalBiomass: plant.totalBiomass,
        storedWater: plant.storedWater,
        storedMinerals: plant.storedMinerals,
        waterCapacity: capacity.water,
        mineralCapacity: capacity.minerals,
        coveredTileCount: coverage.count,
        tileAvgLight: coverage.avgLight,
        tileAvgMoisture: coverage.avgMoisture,
        tileAvgMinerals: coverage.avgMinerals,
        groundwaterFraction:
          coverage.avgGroundwater / Math.max(1e-6, this.resourceWorld.getGroundwaterCapacity()),
        coverageTileX: coverage.sample?.tileX ?? 0,
        coverageTileZ: coverage.sample?.tileZ ?? 0,
        // The table moves on a slower clock than plant stores, so the grid is
        // rebuilt twice a second and the revision is what makes the snapshot
        // differ enough to be sent.
        waterTableRevision: Math.floor(tick / 10),
      };
      const rootNode = plant.rootNodeId ? plant.nodes.get(plant.rootNodeId) : undefined;
      const waterTable =
        snapshot.waterTableRevision !== this.lastWaterTableRevision.get(player.playerId) && rootNode
          ? this.buildWaterTableGrid(rootNode.x, rootNode.z)
          : undefined;
      if (waterTable) {
        this.lastWaterTableRevision.set(player.playerId, snapshot.waterTableRevision);
      }

      // Skip a repeat only. The comparison is exact, so a payload is dropped only
      // when the client already holds every one of these values; nothing is
      // quantised or suppressed. The cache is updated only after the write
      // succeeds, so a backpressure skip is retried on the next tick instead of
      // being remembered as delivered.
      if (this.rootResourcesUnchanged(player.playerId, snapshot)) continue;
      const sent = this.writeIfHealthy(
        player.ws,
        JSON.stringify({
          type: MESSAGE_TYPE.RESOURCE_UPDATE,
          payload: {
            tick,
            ...snapshot,
            waterTable,
            width: this.resourceWorld.getWidth(),
            height: this.resourceWorld.getHeight(),
            tileSize: this.resourceWorld.getTileSize(),
          },
        }),
        MESSAGE_TYPE.RESOURCE_UPDATE,
      );
      if (sent) this.lastRootResourceUpdate.set(player.playerId, snapshot);
    }

    const weatherStep = stepCadence(
      this.weatherCadenceAccumulatorMs,
      dt * 1000,
      this.config.weatherSendRateHz,
    );
    this.weatherCadenceAccumulatorMs = weatherStep.nextAccumulatorMs;
    if (weatherStep.due) {
      this.weatherMessagesSent += 1;
      this.broadcast(MESSAGE_TYPE.WEATHER_UPDATE, {
        tick,
        ...weatherBroadcast,
      });
    } else {
      this.weatherMessagesSkipped += 1;
    }

    this.updateSeason(tick);
  }

  /**
   * True when this player already holds exactly these root resources.
   *
   * The per-tick root update is the largest per-player message on the hot path
   * (one entry per distinct root tile, plus plant stores and capacities). It is
   * skipped only when every field is bit-identical to the payload last written,
   * so the client never loses a value - it just stops receiving the same one.
   */
  private rootResourcesUnchanged(playerId: string, next: RootResourceSnapshot): boolean {
    const prev = this.lastRootResourceUpdate.get(playerId);
    if (!prev) return false;
    return (
      prev.totalEnergy === next.totalEnergy &&
      prev.totalBiomass === next.totalBiomass &&
      prev.storedWater === next.storedWater &&
      prev.storedMinerals === next.storedMinerals &&
      prev.waterCapacity === next.waterCapacity &&
      prev.mineralCapacity === next.mineralCapacity &&
      prev.coveredTileCount === next.coveredTileCount &&
      prev.tileAvgLight === next.tileAvgLight &&
      prev.tileAvgMoisture === next.tileAvgMoisture &&
      prev.tileAvgMinerals === next.tileAvgMinerals &&
      prev.groundwaterFraction === next.groundwaterFraction &&
      prev.coverageTileX === next.coverageTileX &&
      prev.coverageTileZ === next.coverageTileZ &&
      prev.waterTableRevision === next.waterTableRevision
    );
  }

  /**
   * A coarse water-table height field around a point, for the client's water
   * surface. Forty-eight cells of two metres cover the play area at a cost of
   * one float per cell, updated twice a second — the same information the
   * simulation already holds, not a rendering guess.
   */
  private buildWaterTableGrid(
    centreX: number,
    centreZ: number,
  ): { originX: number; originZ: number; cellSizeM: number; cells: number; heightsBase64: string } {
    const cells = 48;
    const cellSizeM = 2;
    const originX = centreX - (cells / 2) * cellSizeM;
    const originZ = centreZ - (cells / 2) * cellSizeM;
    const heights = new Float32Array(cells * cells);
    for (let j = 0; j < cells; j += 1) {
      for (let i = 0; i < cells; i += 1) {
        heights[j * cells + i] = this.resourceWorld.getWaterTableHeightAt(
          originX + (i + 0.5) * cellSizeM,
          originZ + (j + 0.5) * cellSizeM,
        );
      }
    }
    return {
      originX,
      originZ,
      cellSizeM,
      cells,
      heightsBase64: Buffer.from(new Uint8Array(heights.buffer)).toString('base64'),
    };
  }

  /** Root position used for proximity chat range checks. */
  private plantPosition(player: ConnectedPlayer): { x: number; z: number } | null {
    if (!player.plantId) return null;
    const plant = this.plantWorld.getPlant(player.plantId);
    const root = plant?.rootNodeId ? plant.nodes.get(plant.rootNodeId) : undefined;
    return root ? { x: root.x, z: root.z } : null;
  }

  /** Per-minute chat budget from config/chat.json. */
  private consumeChatBudget(player: ConnectedPlayer): boolean {
    const now = Date.now();
    const windowStart = now - 60_000;
    player.chatTimestamps = player.chatTimestamps.filter((t) => t > windowStart);
    if (player.chatTimestamps.length >= this.chatConfig.worldRateMsgPerMin) return false;
    player.chatTimestamps.push(now);
    return true;
  }

  /**
   * Delivers chat to everyone in range who has not muted the sender. The sender
   * receives their own message too, so both tabs stay in sync.
   */
  private deliverChat(
    senderId: string,
    mode: 'world' | 'proximity',
    payload: Record<string, unknown>,
  ): void {
    const sender = this.players.get(senderId);
    if (!sender) return;
    const from = this.plantPosition(sender);

    for (const recipient of this.players.values()) {
      if (recipient.blocked.has(senderId)) continue;
      if (mode === 'proximity') {
        const to = this.plantPosition(recipient);
        if (!from || !to) continue;
        if (Math.hypot(to.x - from.x, to.z - from.z) > this.chatConfig.proximityRangePx) {
          continue;
        }
      }
      this.send(recipient.ws, MESSAGE_TYPE.CHAT_BROADCAST, payload);
    }
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

        // INPUT carries only the four held-direction booleans (max magnitude
        // sqrt(2)), so the old `velocity > maxVelocity` rejection compared 1.41
        // against a configured 5 and could never fire. The ack is the whole work:
        // camera movement is client-side and the server keeps no avatar position.
        void input;
        player.lastInputTick = inputTick;
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
            totalBiomass: plant?.totalBiomass ?? 0,
            totalEnergy: plant?.totalEnergy ?? 0,
            growthSeq: plant?.growthSeq ?? 0,
          };
          for (const node of result.newNodes ?? (result.newNode ? [result.newNode] : [])) {
            this.plantEventLog.append(intent.plantId, {
              type: 'growth',
              tick: currentTick,
              data: {
                nodeId: node.id,
                nodeType: node.type,
                parentId: node.parentId,
                totalBiomass: plant?.totalBiomass ?? 0,
              },
            });
          }
          // A growth that only updates the parent (germination finishing, for
          // instance) has no new node, and the old anchor check then broadcast
          // nothing, so the client never saw the update. Fall back to the parent.
          const anchor = result.newNode ?? result.newNodes?.[0] ?? result.updatedParentNode;
          if (anchor) {
            this.broadcastNear(MESSAGE_TYPE.GROWTH_EVENT, growthPayload, anchor.x, anchor.z);
          }
          // A growth is also a mutation roll (T04); the owner needs the new set
          // even when the roll failed, because upkeep and pressure changed.
          this.sendMutationState(player);

          // Register new nodes as entities in InterestManager
          if (result.newNode) {
            this.interestManager.addEntityToCell(
              result.newNode.id,
              result.newNode.x,
              result.newNode.z,
            );
            // Digging is a consequence of root growth (T25). A root segment
            // displaces its own volume; shallow runs lower the surface and open
            // a void that Root Sight and the client's cavity field can see.
            if (result.newNode.layer === 'root' && this.terrain) {
              const node = result.newNode;
              const length =
                Math.hypot(
                  node.x - (node.parentAttachX ?? node.x),
                  node.y - (node.parentAttachY ?? node.y),
                  node.z - (node.parentAttachZ ?? node.z),
                ) || 0.4;
              const edit = this.terrain.recordRootTunnel(
                intent.plantId,
                node.x,
                node.y,
                node.z,
                node.radius ?? 0.05,
                length,
                currentTick,
              );
              if (edit) {
                this.broadcastNear(
                  MESSAGE_TYPE.TERRAIN_EDITS,
                  { revision: this.terrain.getLatestRevision(), edits: [edit] },
                  node.x,
                  node.z,
                );
              }
            }
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

  /** D01: Handle dev panel actions from client (type 8 DEV_ACTION). */
  private handleDevAction(
    playerId: string,
    ws: WebSocket,
    action: { type: string; [key: string]: unknown },
  ): void {
    // Weather is world state, not plant state, so it is settled before the
    // plant lookup: a player with no plant still has a sky, and this control
    // used to answer "no_plant" and change nothing.
    if (action.type === 'dev_set_weather') {
      const allowed: WeatherStateName[] = [
        'clear',
        'rain',
        'thunderstorm_telegraph',
        'thunderstorm_active',
        'thunderstorm_aftermath',
      ];
      const state = String(action.state ?? '');
      if (!(allowed as string[]).includes(state)) {
        this.sendDevResponse(ws, action.type, { ok: false, error: 'unknown_weather_state' });
        return;
      }
      const requestedDuration = Number(action.duration_s ?? 180);
      const durationS =
        Number.isFinite(requestedDuration) && requestedDuration > 0 ? requestedDuration : 180;
      this.weatherSystem.forceState(state as WeatherStateName, durationS);
      // Announce at once: waiting for the next tick left the panel showing the
      // old sky until the next weather broadcast arrived.
      const forced = this.weatherSystem.getBroadcast();
      this.broadcast(MESSAGE_TYPE.WEATHER_UPDATE, { tick: this.getTick(), ...forced });
      this.sendDevResponse(ws, action.type, { ok: true, state, durationS });
      return;
    }

    const player = this.players.get(playerId);
    // World-scoped actions (resources, tiles, tick rate, simulation, logs,
    // saves) work whether or not the player currently has a plant. The old
    // early return made every one of them answer "no_plant" after a death, so
    // the panel looked broken exactly when it was needed most.
    const plant = player?.plantId ? this.plantWorld.getPlant(player.plantId) : undefined;

    const noPlant = (): void => {
      this.sendDevResponse(ws, action.type, { ok: false, error: 'no_plant' });
    };

    try {
      switch (action.type) {
        case 'dev_set_resources': {
          // Resource simulation rates
          if (action.photosynthesis_rate !== undefined) {
            this.resourceWorld.setPhotosynthesisRate(action.photosynthesis_rate as number);
          }
          if (action.diffusion_rate !== undefined) {
            this.resourceWorld.setDiffusionRate(action.diffusion_rate as number);
          }
          if (action.max_absorption_per_tick !== undefined) {
            this.resourceWorld.setMaxAbsorptionPerTick(action.max_absorption_per_tick as number);
          }
          if (action.rain_gain_per_s !== undefined) {
            this.resourceWorld.setRainGainPerS(action.rain_gain_per_s as number);
          }
          if (action.evaporation_per_s !== undefined) {
            this.resourceWorld.setEvaporationPerS(action.evaporation_per_s as number);
          }
          if (action.canopy_shade_reduction !== undefined) {
            this.resourceWorld.setCanopyShadeReduction(action.canopy_shade_reduction as number);
          }
          // Light/moisture/mineral curves would need config reload
          this.sendDevResponse(ws, action.type, { ok: true });
          break;
        }
        case 'dev_reset_resources': {
          this.resourceWorld.resetToDefaults();
          this.sendDevResponse(ws, action.type, { ok: true });
          break;
        }
        case 'dev_set_tile': {
          // Tile indices are what the store wants, but a caller that only knows
          // where it is standing (a script, the pad's world point) should not
          // have to invent the grid maths: world coordinates are converted here.
          let x = action.x as number;
          let z = action.z as number;
          if (
            (x === undefined || z === undefined) &&
            typeof action.worldX === 'number' &&
            typeof action.worldZ === 'number'
          ) {
            const tile = this.resourceWorld.getTileCoordinates(action.worldX, action.worldZ);
            x = tile.tileX;
            z = tile.tileZ;
          }
          if (x !== undefined && z !== undefined) {
            const resources: Record<string, number> = {};
            if (action.light !== undefined) resources.light = action.light as number;
            if (action.moisture !== undefined) resources.moisture = action.moisture as number;
            if (action.minerals !== undefined) resources.minerals = action.minerals as number;
            // The water table is a tile resource too; without it there was no way
            // to raise or drain the cavity pool and see the water surface move.
            if (action.groundwater !== undefined)
              resources.groundwater = action.groundwater as number;
            this.resourceWorld.setTileResources(x, z, resources);
          }
          this.sendDevResponse(ws, action.type, { ok: true });
          break;
        }
        case 'dev_set_growth': {
          if (!plant) {
            noPlant();
            break;
          }
          if (action.growth_cooldown !== undefined) {
            // Ticks, not milliseconds: tryGrow compares this field against the
            // tick counter, so a Date.now() value locked the plant out for good.
            plant.growthCooldownUntil =
              this.getTick() +
              Math.ceil((action.growth_cooldown as number) * this.plantWorld.getTickRateHz());
          }
          if (action.germination_min_moisture !== undefined) {
            this.plantWorld.getConfig().germinationMinMoisture =
              action.germination_min_moisture as number;
          }
          if (action.germination_min_light !== undefined) {
            this.plantWorld.getConfig().germinationMinLight =
              action.germination_min_light as number;
          }
          this.sendDevResponse(ws, action.type, { ok: true });
          break;
        }
        case 'dev_mutation_gallery': {
          if (!plant) {
            noPlant();
            break;
          }
          // Put the row in front of the player who asked for it, far enough
          // back that a mature body does not stand on their own plant.
          const crown = plant.rootNodeId ? plant.nodes.get(plant.rootNodeId) : undefined;
          const gallery = this.plantWorld.buildMutationGallery(plant.worldId, 8, 10, {
            x: crown?.x ?? 0,
            z: (crown?.z ?? 0) - 16,
          });
          this.sendDevResponse(ws, action.type, { ok: true, ...gallery });
          break;
        }
        case 'dev_grant_mutation': {
          if (!plant || !player?.plantId) {
            noPlant();
            break;
          }
          const mutationId = typeof action.mutationId === 'string' ? action.mutationId : '';
          const granted = this.plantWorld.grantMutation(player.plantId, mutationId, this.getTick());
          if (granted.ok) this.sendMutationState(player);
          this.sendDevResponse(ws, action.type, {
            ok: granted.ok,
            reason: granted.reason,
            mutationId,
          });
          break;
        }
        case 'dev_clear_mutations': {
          if (!plant || !player?.plantId) {
            noPlant();
            break;
          }
          const cleared = this.plantWorld.clearMutations(player.plantId, this.getTick());
          this.sendMutationState(player);
          this.sendDevResponse(ws, action.type, { ok: true, cleared });
          break;
        }
        case 'dev_fill_energy': {
          if (!plant) {
            noPlant();
            break;
          }
          plant.totalEnergy = computePlantCapacity(plant, this.plantWorld.getConfig()).energy;
          this.sendDevResponse(ws, action.type, { ok: true });
          break;
        }
        case 'dev_fill_biomass': {
          if (!plant) {
            noPlant();
            break;
          }
          const filled = this.plantWorld.fillPlantTissue(plant.id);
          this.sendDevResponse(ws, action.type, { ok: true, totalBiomass: filled });
          break;
        }
        case 'dev_set_time': {
          // The sun is server-authoritative: a client-side setTimeOfDay is
          // overwritten by the very next weather broadcast, which is why the
          // world sat at 04:00 while the renderer was told it was afternoon.
          // Moving the world clock here is the only way to get daylight on
          // demand for a screenshot.
          const fraction = Number(action.time_of_day);
          if (!Number.isFinite(fraction)) {
            this.sendDevResponse(ws, action.type, { ok: false, reason: 'bad_time' });
            break;
          }
          this.weatherSystem.setTimeOfDay(fraction);
          const moved = this.weatherSystem.getBroadcast();
          this.sendDevResponse(ws, action.type, {
            ok: true,
            timeOfDay: moved.timeOfDay,
            isDay: moved.isDay,
            sunIntensity: moved.sunIntensity,
          });
          break;
        }
        case 'dev_grow_roots': {
          // Root Sight only has something to excavate once the plant has pushed
          // roots down, and growing them by hand takes minutes of play. This
          // grows a chain of real root nodes through the same `tryGrow` the
          // player's growth menu uses, so the skeleton, tunnels and cavity the
          // screenshots show are the real thing.
          if (!plant || !player?.plantId) {
            noPlant();
            break;
          }
          const steps = Math.max(1, Math.min(24, Number(action.count) || 6));
          const grown: string[] = [];
          const rejected: string[] = [];
          for (let step = 0; step < steps; step += 1) {
            const live = this.plantWorld.getPlant(player.plantId);
            if (!live) {
              rejected.push('plant_gone');
              break;
            }
            live.growthCooldownUntil = this.getTick();
            live.totalEnergy = Math.max(live.totalEnergy, 400);
            live.storedWater = Math.max(live.storedWater, 40);
            live.storedMinerals = Math.max(live.storedMinerals, 40);
            const roots = Array.from(live.nodes.values()).filter(
              (node) => node.type === 'root' || node.type === 'radicle',
            );
            const crown = live.rootNodeId ? live.nodes.get(live.rootNodeId) : undefined;
            const parent = roots.length > 0 ? roots.sort((a, b) => a.y - b.y)[0] : crown;
            if (!parent) {
              rejected.push('no_parent');
              break;
            }
            const angle = step * 2.399;
            const result = this.plantWorld.tryGrow(
              {
                plantId: live.id,
                nodeId: parent.id,
                direction: { x: Math.cos(angle) * 0.5, y: -0.8, z: Math.sin(angle) * 0.5 },
                // A radicle is the only thing a seed may grow downwards, and
                // after it the root layer offers lateral roots (not `root`).
                nodeType: roots.length > 0 ? 'lateral_root' : 'radicle',
                tick: this.getTick(),
                attachFraction: 1,
              },
              this.getTick(),
            );
            if (!result.success) {
              rejected.push(result.reason ?? 'growth_failed');
              break;
            }
            if (result.newNode) grown.push(result.newNode.id);
            const after = this.plantWorld.getPlant(live.id);
            this.broadcastNear(
              MESSAGE_TYPE.GROWTH_EVENT,
              {
                plantId: live.id,
                newNode: result.newNode,
                newNodes: result.newNodes,
                updatedParentNode: result.updatedParentNode,
                totalBiomass: after?.totalBiomass ?? 0,
                totalEnergy: after?.totalEnergy ?? 0,
                growthSeq: after?.growthSeq ?? 0,
              },
              result.newNode?.x ?? live.nodes.get(live.rootNodeId ?? '')?.x ?? 0,
              result.newNode?.z ?? live.nodes.get(live.rootNodeId ?? '')?.z ?? 0,
            );
          }
          this.sendDevResponse(ws, action.type, { ok: true, grown, rejected });
          break;
        }
        case 'dev_fill_resources': {
          // Energy and biomass alone cannot buy growth: `canGrow` also gates on
          // the plant's own captured water and minerals, which only accumulate
          // by absorption over time. Without this action a dev-driven growth
          // chain stalls at the first post-establishment node and looks broken.
          if (!plant) {
            noPlant();
            break;
          }
          const capacity = computePlantCapacity(plant, this.plantWorld.getConfig());
          plant.storedWater = capacity.water;
          plant.storedMinerals = capacity.minerals;
          this.sendDevResponse(ws, action.type, {
            ok: true,
            water: capacity.water,
            minerals: capacity.minerals,
          });
          break;
        }
        case 'dev_grant_item': {
          // Every item in config/items.json should be readable in the panel, but
          // only three are in a starting pouch and there is no other grant path.
          // Without this action half the definitions could not be seen at all.
          if (!player) {
            noPlant();
            break;
          }
          const itemId = typeof action.itemId === 'string' ? action.itemId : '';
          const count =
            typeof action.count === 'number' && Number.isFinite(action.count)
              ? Math.floor(action.count)
              : 1;
          const added = addItem(player.inventory, itemId, count, this.itemsConfig.itemDefinitions);
          this.sendInventorySync(player);
          this.sendDevResponse(ws, action.type, { ok: added > 0, itemId, added });
          break;
        }
        case 'dev_kill_plant': {
          if (!plant || !player?.plantId) {
            noPlant();
            break;
          }
          this.plantWorld.killPlant(player.plantId, 'damage');
          // Settle the death now: the broadcast normally waits for the next tick,
          // so with the simulation paused the client never heard about it.
          this.processPlantDeaths();
          this.processDamageEvents();
          this.sendDevResponse(ws, action.type, { ok: true });
          break;
        }
        case 'dev_damage_plant': {
          if (!plant || !player?.plantId || !this.damagePipeline) {
            noPlant();
            break;
          }
          const amount =
            typeof action.amount === 'number'
              ? action.amount
              : this.damagePipeline.getConfig().damage.toolDamagePerHit;
          this.damagePipeline.applyDamage(player.plantId, amount, 'tool', this.getTick(), {
            playerId: player.playerId,
          });
          this.processDamageEvents();
          this.processPlantDeaths();
          this.processDamageEvents();
          this.sendDevResponse(ws, action.type, { ok: true, amount });
          break;
        }
        case 'dev_uproot_plant': {
          if (!plant || !player?.plantId || !this.damagePipeline) {
            noPlant();
            break;
          }
          const cause =
            action.cause === 'saturation' ||
            action.cause === 'gust' ||
            action.cause === 'collapse' ||
            action.cause === 'structural_damage'
              ? action.cause
              : 'gust';
          const uprooted = this.damagePipeline.forceUproot(player.plantId, cause, this.getTick());
          this.processDamageEvents();
          this.sendDevResponse(ws, action.type, { ok: uprooted, cause });
          break;
        }
        case 'dev_reroot': {
          if (!plant || !player?.plantId || !this.damagePipeline) {
            noPlant();
            break;
          }
          const dirX = typeof action.dirX === 'number' ? action.dirX : 1;
          const dirZ = typeof action.dirZ === 'number' ? action.dirZ : 0;
          const steered = this.damagePipeline.requestReroot(player.plantId, dirX, dirZ);
          this.sendDevResponse(ws, action.type, { ok: steered, dirX, dirZ });
          break;
        }
        case 'dev_herbivore_swarm': {
          if (!plant || !this.damagePipeline) {
            noPlant();
            break;
          }
          const root = plant.rootNodeId ? plant.nodes.get(plant.rootNodeId) : undefined;
          this.damagePipeline.forceSwarm(root?.x ?? 0, root?.z ?? 0, this.getTick());
          this.processDamageEvents();
          this.sendDevResponse(ws, action.type, { ok: true });
          break;
        }
        case 'dev_terrain_collapse': {
          if (!plant || !this.damagePipeline) {
            noPlant();
            break;
          }
          const root = plant.rootNodeId ? plant.nodes.get(plant.rootNodeId) : undefined;
          this.damagePipeline.forceCollapse(root?.x ?? 0, root?.z ?? 0, this.getTick());
          this.processDamageEvents();
          this.processPlantDeaths();
          this.processDamageEvents();
          this.sendDevResponse(ws, action.type, { ok: true });
          break;
        }
        case 'dev_end_season': {
          const clock = this.forceSeasonEnd(this.getTick());
          this.sendDevResponse(ws, action.type, { ok: true, season: clock.season });
          break;
        }
        case 'dev_regenerate_plant': {
          if (!plant || !player?.plantId) {
            noPlant();
            break;
          }
          // Keep the old plant's world id: a literal here would put the new plant
          // in a different world from every other plant and from persistence.
          const worldId = plant.worldId;
          this.plantWorld.removePlant(player.plantId);
          // Same owner identity and world as addPlayer, otherwise the plant is
          // invisible to reclaim/persistence and every anonymous player shares
          // the literal owner id 'anon'.
          const newPlant = this.plantWorld.createPlant(player.accountId ?? playerId, worldId, 0, 0);
          player.plantId = newPlant.id;
          connectionRegistrySetPlant(this.connectionRegistry, playerId, newPlant.id);
          this.registerClientAtPlant(playerId, newPlant);
          // WELCOME first: PLANT_REMOVED for the old plant must arrive after the
          // client has adopted the new one, or it reads as its own death.
          ws.send(
            JSON.stringify({
              type: MESSAGE_TYPE.WELCOME,
              payload: this.buildWelcome(playerId, newPlant),
            }),
          );
          this.processPlantDeaths();
          this.sendDevResponse(ws, action.type, { ok: true, newPlantId: newPlant.id });
          break;
        }
        case 'dev_set_tick_rate': {
          if (action.rate !== undefined) {
            this.setTickRate(action.rate as number);
          }
          this.sendDevResponse(ws, action.type, { ok: true });
          break;
        }
        case 'dev_pause_simulation': {
          this.pauseSimulation();
          this.sendDevResponse(ws, action.type, { ok: true });
          break;
        }
        case 'dev_resume_simulation': {
          this.resumeSimulation();
          this.sendDevResponse(ws, action.type, { ok: true });
          break;
        }
        case 'dev_step_simulation': {
          this.stepSimulationOnce();
          this.sendDevResponse(ws, action.type, { ok: true });
          break;
        }
        case 'dev_set_simulation': {
          if (action.cell_size !== undefined)
            this.interestManager.setCellSize(action.cell_size as number);
          if (action.interest_ring_radius !== undefined)
            this.interestManager.setRingRadius(action.interest_ring_radius as number);
          // These three used to call InterestManager no-ops, so the controls did
          // nothing. The active rate changes the single simulation/wire clock,
          // which also updates the plant tier rates; near/dormant only exist
          // inside PlantWorld.
          if (action.active_tick_rate_hz !== undefined) {
            const hz = Number(action.active_tick_rate_hz);
            if (Number.isFinite(hz) && hz > 0) {
              this.setTickRate(hz);
            }
          }
          if (action.near_tick_rate_hz !== undefined) {
            this.plantWorld.setTierRates({ nearTickRateHz: Number(action.near_tick_rate_hz) });
          }
          if (action.dormant_step_interval_sec !== undefined) {
            this.plantWorld.setTierRates({
              dormantStepIntervalSec: Number(action.dormant_step_interval_sec),
            });
          }
          this.sendDevResponse(ws, action.type, { ok: true });
          break;
        }
        case 'dev_force_save': {
          // This used to call a placeholder that saved nothing, and it ignored the
          // returned promise. Save for real, and report what actually landed.
          saveAllPlants(
            this.plantWorld,
            this.getPlantPersistence(),
            this.log,
            'dev_force_save',
            this.plantEventLog,
          )
            .then((result) => this.sendDevResponse(ws, action.type, { ok: true, ...result }))
            .catch((error: unknown) =>
              this.sendDevResponse(ws, action.type, { ok: false, error: String(error) }),
            );
          break;
        }
        case 'dev_clear_persistence': {
          this.getPlantPersistence()
            .clearAll()
            .then(() => this.sendDevResponse(ws, action.type, { ok: true }))
            .catch((error: unknown) =>
              this.sendDevResponse(ws, action.type, { ok: false, error: String(error) }),
            );
          break;
        }
        case 'dev_log_plants': {
          this.log.info('Dev: Plant dump', {
            plants: this.plantWorld
              .getAllPlants()
              .map((p) => ({ id: p.id, owner: p.ownerId, biomass: p.totalBiomass })),
          });
          this.sendDevResponse(ws, action.type, { ok: true });
          break;
        }
        case 'dev_log_resources': {
          this.log.info('Dev: Resource dump', { resources: this.resourceWorld.getAllTiles() });
          this.sendDevResponse(ws, action.type, { ok: true });
          break;
        }
        case 'dev_log_network': {
          this.log.info('Dev: Network stats', {
            players: this.players.size,
            connections: connectionRegistryGetConnectionCount(this.connectionRegistry),
            stateSent: this.stateMessagesSent,
            stateSkipped: this.stateMessagesSkipped,
            weatherSent: this.weatherMessagesSent,
            weatherSkipped: this.weatherMessagesSkipped,
            rootReadoutsSkipped: this.rootMessagesSkipped,
          });
          this.sendDevResponse(ws, action.type, {
            ok: true,
            stateSent: this.stateMessagesSent,
            stateSkipped: this.stateMessagesSkipped,
            weatherSent: this.weatherMessagesSent,
            weatherSkipped: this.weatherMessagesSkipped,
            rootReadoutsSkipped: this.rootMessagesSkipped,
          });
          break;
        }
        case 'dev_toggle_webgpu':
        case 'dev_reinit_renderer':
        case 'dev_dump_shaders': {
          // Client-side only actions, just acknowledge
          this.sendDevResponse(ws, action.type, { ok: true });
          break;
        }
        case 'dev_stress_test': {
          // Clamp: the count arrives from the client and an unbounded value would
          // create plants until the server runs out of memory.
          const requested = Number(action.count);
          const count = Number.isFinite(requested)
            ? Math.max(1, Math.min(500, Math.floor(requested)))
            : 100;
          for (let i = 0; i < count; i++) {
            this.plantWorld.createRandomPlant();
          }
          this.sendDevResponse(ws, action.type, { ok: true, created: count });
          break;
        }
        case 'dev_set_config': {
          const key = action.key as string;
          const value = action.value;
          if (!key || value === undefined) {
            this.sendDevResponse(ws, action.type, { ok: false, error: 'missing_key_or_value' });
            break;
          }
          // Exactly one response per request. The previous version sent a
          // success after the error branch too, so failures looked successful.
          this.sendDevResponse(ws, action.type, this.applyDevConfig(key, value));
          break;
        }
        default: {
          this.log.warn('Unknown dev action', { type: action.type });
          this.sendDevResponse(ws, action.type, { ok: false, error: 'unknown_action' });
        }
      }
    } catch (error) {
      this.log.error('Dev action failed', { type: action.type, error: String(error) });
      this.sendDevResponse(ws, action.type, { ok: false, error: 'internal_error' });
    }
  }

  /** Applies one dev config change and returns the single response payload. */
  applyDevConfig(key: string, value: unknown): Record<string, unknown> {
    try {
      switch (key) {
        case 'germination_gate':
          this.plantWorld.setGerminationGate(value as boolean);
          return { ok: true, key, value };
        case 'germination_failure_kills_seed':
          this.plantWorld.setGerminationFailureKillsSeed(value as boolean);
          return { ok: true, key, value };
        case 'persistence_enabled':
          this.setPersistenceEnabled(value as boolean);
          return { ok: true, key, value };
        case 'seed_size_class':
          // Camera framing is applied client-side from the same key.
          return { ok: true, key, value, note: 'client_side_only' };
        default:
          return { ok: false, error: `unknown_config_key: ${key}` };
      }
    } catch (error) {
      this.log.error('Failed to set config', { key, error: String(error) });
      return { ok: false, error: 'internal_error' };
    }
  }

  private sendDevResponse(
    ws: WebSocket,
    actionType: string,
    payload: Record<string, unknown>,
  ): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        type: MESSAGE_TYPE.DEV_RESPONSE,
        payload: { action: actionType, ...payload },
      }),
    );
  }

  start(): void {
    tickClockStart(this.tickClock);
    this.log.info('world simulation started', { tickRateHz: this.config.tickRateHz });
  }

  stop(): void {
    tickClockStop(this.tickClock);
  }

  /** The resource-facing view of a plant, carrying its current capacities. */
  private plantResourceView(
    plant: import('@plant-legacy/shared/growth').Plant,
  ): import('./ops/resourceWorld.ts').PlantForResource {
    const capacity = computePlantCapacity(plant, this.plantWorld.getConfig());
    return {
      id: plant.id,
      ownerId: plant.ownerId,
      worldId: plant.worldId,
      nodes: plant.nodes,
      totalBiomass: plant.totalBiomass,
      totalUpkeep: plant.totalUpkeep,
      rootNodeId: plant.rootNodeId ?? '',
      storedWater: plant.storedWater,
      storedMinerals: plant.storedMinerals,
      waterCapacity: capacity.water,
      mineralCapacity: capacity.minerals,
    };
  }

  /**
   * The single spend/credit path for photosynthesis, for every tier. The online
   * loop passes the view it already built for the same tick; the near/dormant
   * hook passes a fresh one. Both go through `photosynthesisOverSpan`, which
   * bounds the catch-up by the plant's own stores, and the energy is credited
   * through `addPhotosynthesisEnergy`, which clamps to the plant's capacity.
   */
  private applyPhotosynthesis(
    view: import('./ops/resourceWorld.ts').PlantForResource,
    plant: import('@plant-legacy/shared/growth').Plant,
    seconds: number,
  ): void {
    const result = this.resourceWorld.photosynthesisOverSpan(view, seconds);
    if (result.energyGain > 0) {
      this.plantWorld.addPhotosynthesisEnergy(plant.id, result.energyGain);
    }
    // Photosynthesis and transpiration spend the plant's own captured water
    // and minerals; structural biomass only ever comes from node growth.
    const waterSpent = result.waterCost + result.transpiration;
    if (waterSpent > 0) {
      plant.storedWater = Math.max(0, plant.storedWater - waterSpent);
    }
    if (result.mineralCost > 0) {
      plant.storedMinerals = Math.max(0, plant.storedMinerals - result.mineralCost);
    }
  }

  /**
   * Photosynthesis for one plant over `seconds` of simulated time.
   *
   * Sunlight is not a privilege of being logged in: the near and dormant tiers
   * call this for the time they integrate, so an unattended plant fixes carbon
   * by day exactly like one somebody is watching. Growth is the only thing that
   * needs a player - nothing here starts a new node.
   */
  photosynthesizePlant(plant: import('@plant-legacy/shared/growth').Plant, seconds: number): void {
    if (!(seconds > 0)) return;
    // T04: diet/metabolism mutations change how much energy a second of light
    // produces. Applied here, the one place photosynthesis is credited.
    const gain = this.plantWorld.getMutationEffects(plant).photosynthesisMultiplier;
    // T04 health: tissue that lost mass to drought or mineral shortage fixes
    // less carbon. Derived from the parts, so wilting needs no second stat.
    const health = this.plantWorld.getPhotosynthesisHealthMultiplier(plant);
    // T06 detached survival: a plant torn out of the soil still catches light,
    // but without root pressure it cannot fix carbon at the rooted rate. This is
    // the quality-of-life cost of living unrooted, not a second death timer.
    const detached = plant.uproot
      ? (this.damagePipeline?.getConfig().uproot.detachedPhotosynthesisMultiplier ?? 1)
      : 1;
    this.applyPhotosynthesis(
      this.plantResourceView(plant),
      plant,
      seconds * gain * health * detached,
    );
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

  /** D01: Dev action - set tick rate */
  setTickRate(hz: number): void {
    // A zero or negative rate would make the clock divide by zero; an absurd
    // rate would starve the event loop. This is a dev knob, not a gameplay one.
    if (!Number.isFinite(hz) || hz <= 0) return;
    hz = Math.min(240, Math.max(1, hz));
    const wasRunning = this.tickClock.running;
    const previousTick = this.tickClock.tick;
    // Stop the old clock first: replacing the object while its timer is live
    // leaves a second loop ticking the same world.
    tickClockStop(this.tickClock);
    this.config.tickRateHz = hz;
    // The active plant tier runs on the same clock as the wire. Keeping a
    // second rate here was how a dev tick-rate change left growth and damage
    // integrating at the old rate.
    this.plantWorld.setTierRates({ activeTickRateHz: hz });
    this.tickClock = createTickClock({
      tickRateHz: hz,
      maxFrameTimeMs: this.maxFrameTimeMs,
      onTick: (tick: number, dt: number) => this.onTick(tick, dt),
      onError: (error: Error) => this.log.error('tick error', { error: String(error) }),
    });
    // Keep monotonic tick numbers so clients do not see time run backwards.
    this.tickClock.tick = previousTick;
    if (wasRunning) tickClockStart(this.tickClock);
  }

  /** D01: Dev action - pause simulation */
  pauseSimulation(): void {
    tickClockStop(this.tickClock);
  }

  /** D01: Dev action - resume simulation */
  resumeSimulation(): void {
    tickClockStart(this.tickClock);
  }

  /** D01: Dev action - step simulation once */
  stepSimulationOnce(): void {
    // Advance the counter: stepping used to re-run the current tick number, so
    // everything keyed on ticks (growth cooldowns, intent drain, plant
    // lastTick) stood still and a single step appeared to do nothing.
    const tick = this.tickClock.tick + 1;
    this.tickClock.tick = tick;
    this.onTick(tick, 1 / this.config.tickRateHz);
  }

  /** D01: Dev action - get plant persistence instance */
  getPlantPersistence(): PlantPersistence {
    if (!this.plantPersistence) {
      throw new Error('Plant persistence not available (no database)');
    }
    return this.plantPersistence;
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
  const itemsConfig = loadItemsConfig(configs);
  const chatConfig = loadChatConfig(configs);
  const reportConfig = loadReportConfig(configs);

  // T25 sparse soil. The base surface is the shared field; only edits load.
  let terrainService: TerrainService | null = null;
  let terrainPersistence: TerrainPersistence | null = null;
  const terrainFlat = await readFlatConfig(runtime.configDir, 'terrain');
  if (terrainFlat) {
    const value = (key: string, fallback: number): number => {
      const raw = Number(terrainFlat[key]);
      return Number.isFinite(raw) ? raw : fallback;
    };
    terrainService = new TerrainService(
      {
        seed: Math.round(value('seed', 1337)),
        amplitudeM: value('surface_amplitude_m', 6),
        baseFrequency: value('surface_base_frequency', 0.045),
        octaves: Math.round(value('surface_octaves', 4)),
        lacunarity: value('surface_lacunarity', 2),
        gain: value('surface_gain', 0.5),
        ridgeStrength: value('ridge_strength', 0.35),
        patchRadiusM: value('patch_radius_m', 620),
        rimFadeFraction: value('rim_fade_fraction', 0.28),
        maxDepthM: value('max_depth_m', 12),
        soilDepthM: readNumber(configs, 'render', 'soil_depth_m'),
        // The river is cut into the shared field, so the server's ground and the
        // client's drawn ground are the same surface, channel included.
        riverEnabled: terrainFlat.river_enabled !== false,
        riverCenterZM: value('river_center_z_m', 0),
        riverWidthM: value('river_width_m', 7),
        riverDepthM: value('river_depth_m', 1.2),
        riverPathCellM: value('river_path_cell_m', 2),
        riverBankSlope: value('river_bank_slope', 0.9),
        riverBankApronM: value('river_bank_apron_m', 12),
        riverWaterDepthM: value('river_water_depth_m', 0.35),
        riverLengthM: value('river_length_m', 320),
      },
      {
        cellSizeM: value('cell_size_m', 0.5),
        chunkCells: Math.round(value('chunk_cells', 32)),
        surfaceBreakDepthM: value('surface_break_depth_m', 0.8),
        maxDepthM: value('max_depth_m', 12),
        maxEditVolumeM3: value('max_edit_volume_m3', 4),
        maxEditsPerTick: Math.round(value('max_edits_per_tick', 16)),
        collapseCadenceHz: value('collapse_cadence_hz', 2),
        displacementRingCells: Math.round(value('displacement_ring_cells', 3)),
        growthResistanceMin: value('growth_resistance_min', 0.4),
        growthResistanceMax: value('growth_resistance_max', 2.5),
        maxActiveChunks: Math.round(value('max_active_chunks', 64)),
        runoffFraction: value('runoff_fraction', 0.15),
        evaporationPerS: value('evaporation_per_s', 0.002),
        rainAbsorptionPerS: value('rain_absorption_per_s', 0.05),
      },
    );
  }

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
      activeTickRateHz: netProtoConfig.tickRateHz,
      nearTickRateHz: worldConfig.nearTickRateHz,
      dormantStepIntervalSec: worldConfig.dormantStepIntervalSec,
      tickBudgetActiveShare: worldConfig.tickBudgetActiveShare,
      tickBudgetWarnThresholdMs: worldConfig.tickBudgetWarnThresholdMs,
    },
    resourcesConfig,
  );

  // Resource world (T00A)
  // The plant radius is what makes the resource cells the planet's lat/lon
  // cells: their neighbours then wrap around the world instead of stopping at
  // the edge of the 256x256 patch. A radius of 0 is the old flat grid.
  //
  // The grid is centred on the play area instead of being pinned to the world's
  // validation corner. `net_proto.world_bounds` is ±1000 m of movement limits,
  // while the resource grid is only `grid_width * tile_size` metres across (256
  // m); anchoring it at minX/minZ put every tile at -1000..-744 and left the
  // plants at the origin with zero covered tiles. The server then skipped their
  // root update entirely, so the HUD, the dev tile inspector and the water
  // table froze on their first (or default) values while soil was sampled from
  // a clamped corner cell.
  const gridSpanX = resourcesConfig.gridWidth * resourcesConfig.tileSize;
  const gridSpanZ = resourcesConfig.gridHeight * resourcesConfig.tileSize;
  const gridCentreX = (netProtoConfig.worldBounds.minX + netProtoConfig.worldBounds.maxX) / 2;
  const gridCentreZ = (netProtoConfig.worldBounds.minZ + netProtoConfig.worldBounds.maxZ) / 2;
  const resourceWorld = new ResourceWorld(
    resourcesConfig,
    {
      minX: gridCentreX - gridSpanX / 2,
      maxX: gridCentreX + gridSpanX / 2,
      minZ: gridCentreZ - gridSpanZ / 2,
      maxZ: gridCentreZ + gridSpanZ / 2,
    },
    readNumber(configs, 'render', 'planet_radius_m'),
  );

  // Groundwater drains along the terrain the world is drawn from, so a storm
  // fills hollows and pools there instead of raising every tile equally.
  resourceWorld.setSurfaceHeightProvider((x, z) => terrainService?.heightAt(x, z) ?? 0);
  resourceWorld.setBaseHeightProvider((x, z) => terrainService?.baseHeightAt(x, z) ?? 0);

  // PlantWorld checks ambient tiles for germination/growth and debits them on
  // uptake, so tile supply and plant-owned stores stay one connected system.
  plantWorld.setResourceProvider((x, z) => resourceWorld.getTileResources(x, z));
  plantWorld.setResourceSink({
    takeResources: (x, z, water, minerals, allowGroundwater) =>
      resourceWorld.takeFromTile(x, z, water, minerals, allowGroundwater),
  });

  // Persistence layer (T03)
  const worldId = 'world_0';
  let plantPersistence: PlantPersistence | null = null;
  /** Loaded audit history, handed to the World once it exists. */
  const loadedPlantEvents = new Map<string, PlantEvent[]>();
  if (database.pool && terrainService) {
    terrainPersistence = new TerrainPersistence(database.pool, worldId);
    try {
      const loadedTerrain = await terrainPersistence.loadAll();
      if (loadedTerrain) {
        terrainService.load(loadedTerrain);
        log.info('loaded terrain edits from database', {
          chunks: loadedTerrain.chunks.length,
          edits: loadedTerrain.edits.length,
          voids: loadedTerrain.voids.length,
        });
      }
    } catch (error) {
      log.error('terrain load failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (database.pool) {
    plantPersistence = new PlantPersistence(database.pool, worldId, (error) => {
      log.error('skipping unreadable plant snapshot', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    // Load existing plants and their audit history (INV-PR-07).
    const loadedPlants = await plantPersistence.loadAllPlantsWithEvents();
    let skippedPlants = 0;
    for (const loadedEntry of loadedPlants) {
      const loaded = loadedEntry.snapshot;
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
        mutations: loaded.mutations,
        mutationPressure: loaded.mutationPressure,
        mutationShedCooldownUntil: loaded.mutationShedCooldownUntil,
        mutationSignature: loaded.mutationSignature,
        uproot: loaded.uproot,
      };
      // One unreadable snapshot must not stop the world from booting. A single
      // corrupt row used to throw out of module init, which is why the server
      // sometimes refused to start with no useful message.
      try {
        plantWorld.loadPlant(plant);
        loadedPlantEvents.set(plant.id, loadedEntry.events);
      } catch (error) {
        skippedPlants += 1;
        log.error('skipping unreadable plant snapshot', {
          plantId: plant.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    log.info('loaded plants from database', {
      count: loadedPlants.length - skippedPlants,
      skipped: skippedPlants,
    });
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
    const handlers = createAccountsHandlers(service, {
      trustProxy: runtime.trustProxy,
      maxBodyBytes: accountsConfig.requestBodyMaxBytes,
    });
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

  // T04 mutation rules. Acquisition lives in PlantWorld; the world supplies the
  // environment each growth happened in (tiles, weather, day/night).
  const mutationsConfig = loadMutationsConfig(configs);
  plantWorld.setMutations(mutationsConfig);
  plantWorld.setMutationEnvironmentProvider((x, z) => {
    const tile = resourceWorld.getTileResources(x, z);
    const broadcast = weatherSystem.getBroadcast();
    return {
      light: tile.light,
      moisture: tile.moisture,
      minerals: tile.minerals,
      weather: broadcast.weatherState,
      timeOfDay: broadcast.isDay ? 'day' : 'night',
    };
  });

  // T06 damage pipeline: one owner for weather, tool, scripted fauna and
  // terrain-collapse damage, uproot, tumbling, drops and kill credit.
  const uprootConfig = loadUprootConfig(configs);
  // T06 detached survival: whether a torn-free plant may keep growing. Read once
  // so the growth menu and the charge can never disagree (INV-GR-13).
  plantWorld.setDetachedGrowthEnabled(uprootConfig.detachedGrowthEnabled);
  const damagePipeline = new DamagePipeline({
    plantWorld,
    resourceWorld,
    terrain: terrainService,
    damage: loadDamageConfig(configs),
    uproot: uprootConfig,
    tumbling: loadTumblingConfig(configs),
    tickRateHz: netProtoConfig.tickRateHz,
    getWeatherState: () => weatherSystem.getWeatherState(),
    lightningFrequencyPerMinute: weatherConfig.lightningFrequencyPerMinute,
    lightningRadiusM: weatherConfig.lightningDamageRadius,
    log,
  });

  const world = new World(
    netProtoConfig,
    log,
    plantWorld,
    resourceWorld,
    weatherSystem,
    interestManager,
    worldConfig.reconnectWindowMin * 60 * 1000, // convert minutes to ms
    worldConfig.persistenceEnabled,
    plantPersistence,
    worldConfig.maxFrameTimeMs,
    itemsConfig,
    chatConfig,
    reportConfig,
    worldConfig.seasonLengthDays,
    terrainService,
    worldConfig.eventLogCompactionThreshold,
    loadedPlantEvents,
  );
  if (terrainService) {
    plantWorld.setGrowthResistanceProvider((x, y, z) => terrainService.growthResistanceAt(x, y, z));
  }
  world.setDamagePipeline(damagePipeline);

  // Near and dormant plants are stepped inside PlantWorld, not in the online
  // loop, so they need the same photosynthesis the online loop applies. Without
  // this an offline plant only ever paid upkeep and starved in broad daylight.
  plantWorld.setPhotosynthesis((plant, seconds) => world.photosynthesizePlant(plant, seconds));

  // The calendar is world state, so it is restored once per boot rather than per
  // plant, and stopped seasons do not resume from season 1 after a deploy.
  if (plantPersistence) {
    const persistence = plantPersistence;
    try {
      const savedSeason = await persistence.loadSeasonState();
      if (savedSeason) {
        world.restoreSeasonState(savedSeason);
        log.info('restored season', {
          season: savedSeason.season,
          remainingTicks: Math.round(savedSeason.remainingTicks),
        });
      }
    } catch (error) {
      // A database that predates the world_state table must not stop the world
      // from starting; it simply has no calendar to restore.
      log.warn('season state load failed; starting from season 1', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    world.setSeasonEndedHook((state) => {
      void persistence.saveSeasonState(state).catch((error: unknown) => {
        log.error('season-state save failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });
  }

  // Periodic plant persistence (T03). The cadence comes from
  // `world.plant_save_interval_s`; each plant saves independently so one bad row cannot skip
  // every plant after it, and an in-flight guard stops a slow pass from
  // overlapping the next one.
  let saveInterval: NodeJS.Timeout | null = null;
  if (plantPersistence) {
    // Its own tunable, not `snapshot_interval_ticks`: that key means the
    // full-state snapshot cadence (6000 ticks = 5 min) and would have made
    // saves ten times rarer than the 30 s they had been.
    const saveIntervalMs = Math.max(1000, worldConfig.plantSaveIntervalSec * 1000);
    let saveInFlight = false;
    saveInterval = setInterval(async () => {
      if (saveInFlight) {
        log.warn('periodic plant save still running; skipping this interval');
        return;
      }
      saveInFlight = true;
      try {
        const result = await saveAllPlants(
          plantWorld,
          plantPersistence,
          log,
          'periodic',
          world.getPlantEventLog(),
        );
        // The calendar is cheap and must survive a crash between rollovers, so
        // it rides the same cadence as the plants. A failure here must not take
        // the plant-save loop down with it.
        try {
          await plantPersistence.saveSeasonState(world.getSeasonState());
        } catch (error) {
          log.error('periodic season-state save failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
        if (terrainPersistence && terrainService) {
          await terrainPersistence.save(terrainService.snapshot()).catch((error: unknown) =>
            log.error('periodic terrain save failed', {
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
        log.debug('periodic plant save', { count: result.saved, total: result.total });
      } finally {
        saveInFlight = false;
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
          'WASD / Arrows: Pan camera  |  Left-drag: Orbit  |  Middle-drag: Pan  |  Scroll: Zoom',
          'Click node: Focus  |  G: Toggle Grow Mode  |  R: Root Sight  |  E: Emotes  |  I: Inventory',
          'You are a plant. Grow roots down, canopy up. Read light, water, minerals.',
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
          leaf_size: values.leaf_size?.value ?? 0.25,
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

        // Every entry in the file rides along. This route used to send only the
        // names it listed, and those names are mostly not the file's: the client
        // asks this payload for `l0_raymarch_steps`, `mesh_tube_radial_segments`
        // and the rest of the SDF/mesh tessellation, none of which were here, so
        // a whole tier of drawn detail ignored the config. The listed values stay
        // on top because some of them (the plan-wide spacing/limit names) have no
        // entry in this file yet.
        const flat: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(values)) {
          flat[key] = (entry as { value?: unknown }).value;
        }
        sendJson(response, 200, { ...flat, ...plantRendererConfig });
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
          leaf_size: 0.25,
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

    if (url.pathname === '/config/growth') {
      // Growth step distances, so the aim arrow can preview exactly one real
      // segment instead of an invented length.
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      try {
        const raw = await fs.readFile(path.resolve(runtime.configDir, 'growth.json'), 'utf8');
        const parsed = JSON.parse(raw) as { values?: Record<string, { value?: unknown }> };
        const values = (parsed.values ?? {}) as Record<
          string,
          {
            value?: {
              segment_length?: number;
              biomass_cost?: number;
              growth_time_seconds?: number;
            };
          }
        >;
        // Per-type step distances, so the aim preview is the segment that will
        // actually be grown (a cotyledon is 0.1 m, not a 0.95 m canopy step).
        // Costs and growth times ride along for Plant Lab's economy readout.
        const nodeLengths: Record<string, number> = {};
        const nodeCosts: Record<string, number> = {};
        const nodeGrowthSeconds: Record<string, number> = {};
        for (const [key, entry] of Object.entries(values)) {
          if (!key.endsWith('_node')) continue;
          const type = key.replace(/_node$/, '');
          const length = entry?.value?.segment_length;
          const cost = entry?.value?.biomass_cost;
          const seconds = entry?.value?.growth_time_seconds;
          if (typeof length === 'number') nodeLengths[type] = length;
          if (typeof cost === 'number') nodeCosts[type] = cost;
          if (typeof seconds === 'number') nodeGrowthSeconds[type] = seconds;
        }
        // Organism geometry rides along: the seed aspect, radius table and
        // branch attach fraction are the numbers the client needs to draw and
        // aim the same plant the server grows.
        const geometryNumber = (key: string, fallback: number): number => {
          const value = parsed.values?.[key]?.value;
          return typeof value === 'number' ? value : fallback;
        };
        sendJson(response, 200, {
          root_growth_speed: values.root_growth_speed?.value ?? 0.85,
          canopy_growth_speed: values.canopy_growth_speed?.value ?? 0.95,
          node_lengths: nodeLengths,
          node_costs: nodeCosts,
          node_growth_seconds: nodeGrowthSeconds,
          seed_body_height_ratio: geometryNumber('seed_body_height_ratio', 1.35),
          branch_attach_fraction: geometryNumber('branch_attach_fraction', 0.6),
          node_radius_profiles: parsed.values?.node_radius_profiles?.value ?? {},
        });
      } catch {
        sendJson(response, 200, {
          root_growth_speed: 0.85,
          canopy_growth_speed: 0.95,
          node_lengths: {},
          node_costs: {},
          node_growth_seconds: {},
          seed_body_height_ratio: 1.35,
          branch_attach_fraction: 0.6,
          node_radius_profiles: {},
        });
      }
      return;
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

    // Systems the client reads verbatim: day/night timing and tile ranges.
    // Anything else with a dedicated route below keeps its own handler.
    if (url.pathname === '/config/daynight' || url.pathname === '/config/resources') {
      const system = url.pathname.slice('/config/'.length);
      const flat = await readFlatConfig(runtime.configDir, system);
      sendJson(response, 200, flat ?? {});
      return;
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
        // Default bindings matching config/controls.json
        const defaultBindings: Record<string, unknown> = {
          camera_orbit: {
            action: 'camera_orbit',
            keys: [],
            mouse: 'left_drag',
            mode: 'hold',
            context: '',
          },
          camera_pan: {
            action: 'camera_pan',
            keys: [],
            mouse: 'right_drag',
            mode: 'hold',
            context: '',
          },
          camera_pan_forward: {
            action: 'camera_pan_forward',
            keys: ['KeyW', 'ArrowUp'],
            mouse: '',
            mode: 'hold',
            context: '',
          },
          camera_pan_backward: {
            action: 'camera_pan_backward',
            keys: ['KeyS', 'ArrowDown'],
            mouse: '',
            mode: 'hold',
            context: '',
          },
          camera_pan_left: {
            action: 'camera_pan_left',
            keys: ['KeyA', 'ArrowLeft'],
            mouse: '',
            mode: 'hold',
            context: '',
          },
          camera_pan_right: {
            action: 'camera_pan_right',
            keys: ['KeyD', 'ArrowRight'],
            mouse: '',
            mode: 'hold',
            context: '',
          },
          camera_zoom: {
            action: 'camera_zoom',
            keys: [],
            mouse: 'wheel',
            mode: 'hold',
            context: '',
          },
          camera_recenter: {
            action: 'camera_recenter',
            keys: ['Space'],
            mouse: 'double_click_ground',
            mode: 'press',
            context: '',
          },
          select_part: {
            action: 'select_part',
            keys: [],
            mouse: 'left_click',
            mode: 'press',
            context: '',
          },
          grow_mode_toggle: {
            action: 'grow_mode_toggle',
            keys: ['KeyG'],
            mouse: '',
            mode: 'toggle',
            context: '',
          },
          root_sight_toggle: {
            action: 'root_sight_toggle',
            keys: ['KeyR'],
            mouse: '',
            mode: 'toggle',
            context: '',
          },
          emote_wheel: {
            action: 'emote_wheel',
            keys: ['KeyE'],
            mouse: '',
            mode: 'press',
            context: '',
          },
          inventory_overview_toggle: {
            action: 'inventory_overview_toggle',
            keys: ['KeyI'],
            mouse: '',
            mode: 'toggle',
            context: '',
          },
          inventory_slot_1: {
            action: 'inventory_slot_1',
            keys: ['Digit1'],
            mouse: '',
            mode: 'press',
            context: '',
          },
          inventory_slot_2: {
            action: 'inventory_slot_2',
            keys: ['Digit2'],
            mouse: '',
            mode: 'press',
            context: '',
          },
          inventory_slot_3: {
            action: 'inventory_slot_3',
            keys: ['Digit3'],
            mouse: '',
            mode: 'press',
            context: '',
          },
          inventory_slot_4: {
            action: 'inventory_slot_4',
            keys: ['Digit4'],
            mouse: '',
            mode: 'press',
            context: '',
          },
          inventory_slot_5: {
            action: 'inventory_slot_5',
            keys: ['Digit5'],
            mouse: '',
            mode: 'press',
            context: '',
          },
          inventory_slot_6: {
            action: 'inventory_slot_6',
            keys: ['Digit6'],
            mouse: '',
            mode: 'press',
            context: '',
          },
          inventory_slot_7: {
            action: 'inventory_slot_7',
            keys: ['Digit7'],
            mouse: '',
            mode: 'press',
            context: '',
          },
          inventory_slot_8: {
            action: 'inventory_slot_8',
            keys: ['Digit8'],
            mouse: '',
            mode: 'press',
            context: '',
          },
          inventory_slot_9: {
            action: 'inventory_slot_9',
            keys: ['Digit9'],
            mouse: '',
            mode: 'press',
            context: '',
          },
          inventory_slot_10: {
            action: 'inventory_slot_10',
            keys: ['Digit0'],
            mouse: '',
            mode: 'press',
            context: '',
          },
          grow_cancel: {
            action: 'grow_cancel',
            keys: ['Escape'],
            mouse: 'right_click',
            mode: 'press',
            context: '',
          },
          dev_panel_toggle: {
            action: 'dev_panel_toggle',
            keys: ['Backquote'],
            mouse: '',
            mode: 'toggle',
            context: '',
          },
          debug_toggle: {
            action: 'debug_toggle',
            keys: ['ShiftLeft', 'ShiftRight'],
            mouse: '',
            mode: 'toggle',
            context: '',
          },
          hint_card_toggle: {
            action: 'hint_card_toggle',
            keys: ['KeyH'],
            mouse: '',
            mode: 'toggle',
            context: '',
          },
          plant_regenerate: {
            action: 'plant_regenerate',
            keys: ['KeyR'],
            mouse: '',
            mode: 'press',
            context: 'dev',
          },
        };
        sendJson(response, 200, {
          bindings: defaultBindings,
          touch_min_target_px: 44,
          hud_max_screen_fraction: 0.2,
          root_sight_mode: 'toggle',
          text_scale: 1.0,
          context_dock_fade_ms: 150,
        });
        return;
      }
    }

    if (
      url.pathname === '/config/chat' ||
      url.pathname === '/config/reports' ||
      url.pathname === '/config/network' ||
      url.pathname === '/config/terrain' ||
      url.pathname === '/config/physics' ||
      url.pathname === '/config/water' ||
      // T02: every root-sight tunable reaches the client. A hand-written
      // whitelist served seven of seventeen, so the cutaway radius, bubble
      // budget, burrow depth and rebuild rate silently ran on compiled-in
      // defaults while the file said otherwise.
      url.pathname === '/config/root_sight' ||
      // T04: the client paints mutations from the style table the config
      // validator owns, so appearance stays data (RULE_3).
      url.pathname === '/config/mutation_visuals' ||
      // AL-01/ADR-027: the client reads the dev-only size class and the six
      // benchmark poses from the same file the dev panel edits.
      url.pathname === '/config/dev'
    ) {
      // T05: Serve chat/report tunables so client-side limits mirror server
      // enforcement; the network file also carries the client ping thresholds.
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const configName = url.pathname.slice('/config/'.length);

      try {
        const raw = await fs.readFile(
          path.resolve(runtime.configDir, `${configName}.json`),
          'utf8',
        );
        const values = JSON.parse(raw).values ?? {};
        const flat: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(values)) {
          flat[key] = (entry as { value?: unknown }).value;
        }
        sendJson(response, 200, flat);
        return;
      } catch {
        sendJson(response, 200, {});
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

        // The route used to whitelist eleven of sixteen entries, so
        // `hud_update_interval_ms`, `damage_vignette_ms` and the three health
        // thresholds in the file never reached the client and it ran on
        // compiled-in defaults. Every entry rides along; the explicit fields
        // above still win because `layers` and `theme` are derived here.
        const flat: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(values)) {
          flat[key] = (entry as { value?: unknown }).value;
        }
        sendJson(response, 200, { ...flat, ...uiConfig });
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

    // D01: Dev config endpoints (non-production only)
    if (url.pathname === '/dev/config' && request.method === 'GET') {
      await handleGetDevConfig(request, response);
      return;
    }
    if (url.pathname === '/dev/config' && request.method === 'POST') {
      const applied = await handlePostDevConfig(request, response);
      // Push accepted switches into the live simulation, not just the config map.
      for (const change of applied ?? []) {
        world.applyDevConfig(change.key, change.value);
      }
      return;
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

  // A busy port is a startup condition, not a crash. Without this handler an
  // EADDRINUSE arrives as an uncaught exception, the supervisor reads it as a
  // crash and restarts into the same occupied port, forever. Exit with a code
  // the supervisors can tell apart from a crash (2 = port owned by someone else).
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      log.error('port already in use', { host: runtime.host, port: runtime.port });
      console.error(
        `server: port ${runtime.port} is already in use — another dev stack or a hand-started server owns it.`,
      );
      console.error('server: stop that process, then start again.');
      process.exit(2);
    }
    log.error('server error', { error: error.message, code: error.code ?? '' });
    process.exit(1);
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
    let helloTimeout: NodeJS.Timeout;
    let playerId: string | null = null;

    // One inbound budget per socket. Every type-specific limit (chat, reports,
    // growth intents) sits behind this, so a connection cannot flood unknown or
    // malformed messages and burn the tick budget from one socket.
    const inboundBudget = createTokenBucket(netProtoConfig.messageBurst, Date.now());
    let droppedMessages = 0;

    const cleanupConnection = () => {
      if (helloTimeout) {
        clearTimeout(helloTimeout);
      }
      if (playerId) {
        world.removePlayer(playerId);
      }
    };

    ws.on('message', (data: Buffer) => {
      if (
        !tokenBucketAllow(
          inboundBudget,
          Date.now(),
          netProtoConfig.maxMessagesPerSecond,
          netProtoConfig.messageBurst,
        )
      ) {
        droppedMessages += 1;
        if (droppedMessages === 1 || droppedMessages % 100 === 0) {
          log.warn('inbound message rate limit reached', {
            playerId,
            dropped: droppedMessages,
          });
        }
        return;
      }

      try {
        const message = JSON.parse(data.toString());
        const { type, payload } = message;

        if (type === MESSAGE_TYPE.HELLO && !helloReceived) {
          helloReceived = true;
          clearTimeout(helloTimeout);

          // Validate HELLO message schema
          const validation = validateMessage(type, payload);
          if (!validation.ok) {
            log.warn('PlantLegacy: skipping malformed HELLO message', {
              issues: validation.issues,
            });
            const error: ErrorPayload = {
              code: 'INVALID_MESSAGE',
              message: 'Invalid HELLO payload',
            };
            ws.send(JSON.stringify({ type: MESSAGE_TYPE.ERROR, payload: error }));
            ws.close(4000, 'Invalid HELLO');
            cleanupConnection();
            return;
          }

          handleHelloMessage(ws, payload).catch((err) => {
            log.error('handleHelloMessage failed', { error: String(err) });
            cleanupConnection();
          });
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
      cleanupConnection();
    });

    ws.on('error', (error: Error) => {
      log.error('websocket error', { error: error.message, playerId });
      cleanupConnection();
    });

    // Set a timeout for HELLO
    helloTimeout = setTimeout(() => {
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
      if (accountId) {
        // A guest who signs in keeps the plant they were growing, instead of the
        // account silently creating a second one.
        if (hello.plantId) {
          world.adoptGuestPlant(accountId, hello.plantId, hello.reconnectToken);
        }
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
            hello.reconnectToken,
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

      // A guest's owner id dies with the connection, so the plant id they asked
      // to reclaim is the only stable key for a loss. If that plant is gone and
      // it died, report it instead of handing over a replacement seed silently.
      const requestedPlantId = hello.plantId;
      if (requestedPlantId && welcome.plantId !== requestedPlantId && !welcome.previousPlantDied) {
        const loss = world.takeLostPlantReport(requestedPlantId);
        if (loss) {
          welcome.previousPlantDied = {
            cause: loss.cause,
            source: loss.source,
            secondsAgo: Math.max(0, Math.round((Date.now() - loss.at) / 1000)),
          };
        }
      }

      // Send welcome message with plant info
      const welcomeMsg = JSON.stringify({
        type: MESSAGE_TYPE.WELCOME,
        payload: { ...welcome, plantId: welcome.plantId },
      });
      ws.send(welcomeMsg);
      const mutationState = world.getMutationStateFor(welcome.plantId);
      if (mutationState) {
        ws.send(JSON.stringify({ type: MESSAGE_TYPE.MUTATION_STATE, payload: mutationState }));
      }
      ws.send(
        JSON.stringify({ type: MESSAGE_TYPE.SEASON_UPDATE, payload: world.getSeasonUpdate() }),
      );

      // Send full resource grid immediately so ground renders with correct
      // lighting. Sent as the compact quantised buffer (~262 KB) rather than
      // 65 536 tile objects (~4.2 MB).
      const rw = world.getResourceWorld();
      ws.send(
        JSON.stringify({
          type: MESSAGE_TYPE.RESOURCE_UPDATE,
          payload: {
            tick: world.getTick(),
            gridBase64: encodeResourceGridBase64(rw.getWidth(), rw.getHeight(), rw.getAllTiles()),
            width: rw.getWidth(),
            height: rw.getHeight(),
            tileSize: rw.getTileSize(),
            fullGrid: true,
          },
        }),
      );

      // ConnectionRegistry in World.addPlayer already installed the message handler
      // that routes to world.handlePostHelloMessage
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
          await plantPersistence.savePlant(plant, world.getPlantEventLog().get(plant.id));
        } catch (error) {
          log.error('shutdown plant save failed', {
            plantId: plant.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      log.info('saved plants on shutdown', { count: plants.length });
      if (terrainPersistence && terrainService) {
        await terrainPersistence.save(terrainService.snapshot()).catch((error: unknown) =>
          log.error('shutdown terrain save failed', {
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      await plantPersistence.saveSeasonState(world.getSeasonState()).catch((error: unknown) =>
        log.error('shutdown season-state save failed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
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

  process.on('uncaughtException', (error: unknown) => {
    log.error('uncaught exception', {
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
    shutdown('uncaught exception');
  });

  process.on('unhandledRejection', (reason: unknown) => {
    log.error('unhandled rejection', {
      reason: reason instanceof Error ? (reason.stack ?? reason.message) : String(reason),
    });
    shutdown('unhandled rejection');
  });

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
