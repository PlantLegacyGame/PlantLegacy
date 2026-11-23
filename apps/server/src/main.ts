import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import process from 'node:process';
import { readNumber } from '@plant-legacy/shared/config';
import { validateDisplayName } from '@plant-legacy/shared/displayName';
import type { Plant } from '@plant-legacy/shared/growth';
import { validateMessage } from '@plant-legacy/shared/protocol/messageSchemas';
import { loadTerrainFieldParams } from '@plant-legacy/shared/world/terrainFieldConfig';
import {
  loadClimateConfig,
  loadDayNightConfig,
  loadWeatherConfig,
  WeatherSystem,
} from '@plant-legacy/weather';
import { WebSocket, WebSocketServer } from 'ws';
import { loadRuntimeConfig } from './core/config.ts';
import { SERVICE_VERSION } from './core/version.ts';
import {
  type DamageCommandPorts,
  handleDamageCommand,
  type PlantTarget,
} from './dev/damageCommands.ts';
import { handlePlantCommand, type PlantCommandPorts } from './dev/plantCommands.ts';
import { handleWorldCommand, type WorldCommandPorts } from './dev/worldCommands.ts';
import { handleConfigRequest } from './http/configRoutes.ts';
import { loadAccountsConfig } from './ops/accounts/config.ts';
import { createAccountsHandlers, createAuthMiddleware } from './ops/accounts/http.ts';
import { AccountsService } from './ops/accounts/service.ts';
import {
  type ChatConfig,
  loadChatConfig,
  loadReportConfig,
  type ReportConfig,
} from './ops/chat.ts';
import { consumeChatBudget, resolveChatIntent } from './ops/chatService.ts';
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
import { handleGetDevConfig, handlePostDevConfig } from './ops/dev.ts';
import { resolveDevAccess } from './ops/devAccess.ts';
import { resolveDevWeatherCommand } from './ops/devCommands.ts';
import { pickupDrop } from './ops/dropPickup.ts';
import { eventBus, GAME_EVENTS } from './ops/eventBus.ts';
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
import {
  type InventoryPlayer,
  type InventoryPorts,
  sendInventorySync,
  swapInventorySlots,
  useInventorySlot,
} from './ops/inventoryHandlers.ts';
import { grantItemUnderLock } from './ops/itemGrant.ts';
import { loadItemsConfig } from './ops/items.ts';
import { awardLabel, sendLedgerEntry } from './ops/ledger.ts';
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
import { isAllowedOrigin } from './ops/originPolicy.ts';
import { type PlantEvent, PlantPersistence } from './ops/persistence/plantPersistence.ts';
import {
  type PersistedPlayerState,
  PlayerStateStore,
  toInventory,
  toPersistedState,
} from './ops/persistence/playerStatePersistence.ts';
import { TerrainPersistence } from './ops/persistence/terrainPersistence.ts';
import { computePlantCapacity } from './ops/plantCapacity.ts';
import { PlantEventLog } from './ops/plantEventLog.ts';
import { plantOwnerName } from './ops/plantOwnerName.ts';
import { canAdoptGuestPlant, isAnonymousOwner } from './ops/plantOwnership.ts';
import { selectVisiblePlants } from './ops/plantVisibility.ts';
import { PlantWorld } from './ops/plantWorld.ts';
import { awardSporesStored, mutatePlayerState } from './ops/playerStateMutations.ts';
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
  seasonRemainingSeconds,
  seasonSnapshot,
  seasonUpdatePayload,
} from './ops/seasonClock.ts';
import { loadShopConfig, purchaseShopItem, type ShopConfig, type ShopPorts } from './ops/shop.ts';
import { purchaseUnderLock } from './ops/shopPurchase.ts';
import { type HeartbeatSocket, heartbeatTick } from './ops/socketHeartbeat.ts';
import { loadSporeConfig, type SporeConfig } from './ops/spores.ts';
import { TerrainService } from './ops/terrain.ts';
import { createTickClock, type TickClock, tickClockStart, tickClockStop } from './ops/tickClock.ts';
import {
  type TickBudgetWarning,
  TickMetrics,
  type TickMetricsSnapshot,
} from './ops/tickMetrics.ts';
import { buildWelcomePayload } from './ops/welcomePayload.ts';
import { loadWorldConfig } from './ops/world.ts';
import { broadcastResourceDeltas, type ResourceBroadcastPorts } from './tick/resourceBroadcast.ts';
import {
  broadcastRootReadouts,
  type RootReadoutPorts,
  type RootResourceSnapshot,
} from './tick/rootReadout.ts';
import {
  accumulateShedDamage,
  drainQueuedShedDamage,
  type ShedDamage,
  shedFlushIntervalTicks,
} from './tick/shedDamage.ts';
import { handleSimulationCommand, type SimulationCommandPorts } from './tick/simulationCommands.ts';
import {
  broadcastPlantStates,
  type PlantStateSnapshot,
  type StateBroadcastPorts,
} from './tick/stateBroadcast.ts';
import { WaterTableGridBuilder } from './tick/waterTableGrid.ts';
import { broadcastWeather } from './tick/weatherBroadcast.ts';

const STARTED_AT = Date.now();

/**
 * Dirty-tile broadcasts above this size are sent as a compact quantised grid.
 *
 * A weather/time-of-day change marks every tile dirty, and 65 536 tile objects
 * serialise to several megabytes of JSON (~21 MB/s at 20 Hz). The compact form
 * is a base64 buffer of three 0-255 channels per tile: ~262 KB, no per-tile
 * objects to parse on the client.
 */
/** How often live sockets are pinged, and how long a missed pong is tolerated. */
const SOCKET_HEARTBEAT_MS = 25_000;

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
  /** The purse, in spores. Earned and spent through `ops/shop.ts`. */
  spores: number;
  /** Players whose chat this player has muted. */
  blocked: Set<string>;
  /** Timestamps of recent chat messages, for the per-minute rate limit. */
  chatTimestamps: number[];
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
  // daylight re-tint every tile at once, and the skipped state is naturally
  // resent by the next whole-grid event because it dirties every tile again.
  private lastCompactGridBroadcastAt = 0;
  /**
   * Whole-grid payloads are 192 KB each, and the client parses, decodes and
   * uploads every one of them: at 1 Hz that measured 14-36 dropped frames per
   * 4 s, at 2.5 s it measured 3-8 on the same scene. A tint a player cannot see
   * at 400 ms cannot be seen at 2.5 s either.
   */
  private static readonly COMPACT_GRID_MIN_INTERVAL_MS = 2500;
  /** Wire cadence accumulators (INV-TM-09). */
  private stateCadenceAccumulatorMs = 0;
  private weatherCadenceAccumulatorMs = 0;
  private stateMessagesSent = 0;
  private stateMessagesSkipped = 0;
  private weatherMessagesSent = 0;
  private weatherMessagesSkipped = 0;
  private rootMessagesSent = 0;
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
  /** Deployment environment; the dev-access gate reads this, not process.env. */
  private readonly runtimeEnvironment: string;
  private readonly devAllowedEnvironments: string[];
  private readonly devAdminAccounts: string[];
  /** Per-tier tick timings and budget warnings; read by the metrics route. */
  private readonly tickMetrics: TickMetrics;
  private budgetSubscription: { unsubscribe(): void } | null = null;
  private itemsConfig: ReturnType<typeof loadItemsConfig>;
  private sporeConfig: SporeConfig;
  private shopConfig: ShopConfig;
  private playerStateStore: PlayerStateStore | null;
  /** Loaded before a HELLO creates or reclaims a player, keyed by account id. */
  private readonly restoredPlayerStates = new Map<string, PersistedPlayerState>();
  /** Accounts whose row could not be read; do not overwrite it this session. */
  private readonly playerStateUnavailable = new Set<string>();
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

  /** Every connection, and how many took it: a refusal lands in `skippedSends`. */
  broadcast(type: number, payload: unknown): number {
    const message = JSON.stringify({ type, payload });
    let delivered = 0;
    for (const player of this.players.values()) {
      if (this.writeIfHealthy(player.ws, message, type)) delivered += 1;
    }
    return delivered;
  }

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

  /**
   * A plant's owner as other players read them.
   *
   * Name tags carried `ownerId.slice(0, 6)`, which a player cannot read: for a
   * guest it is a random id prefix, for an account an opaque id. The display
   * name is the player's own sanitised one; a plant whose owner is not connected
   * has no name to send, so the field stays optional and the client falls back
   * to the id rather than inventing one.
   */
  private ownerNameFor(ownerId: string): string | undefined {
    return plantOwnerName(this.players, ownerId);
  }

  /** Full plant snapshot for PLANT_CREATED, mirroring the WELCOME node shape. */
  private plantCreatedPayload(plant: import('@plant-legacy/shared/growth').Plant) {
    return {
      plant: {
        id: plant.id,
        ownerId: plant.ownerId,
        ownerName: this.ownerNameFor(plant.ownerId),
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

  /**
   * Send to every player whose interest cells contain (x, z), plus the plant's
   * owner. Compliance with interest management matters most for the large
   * per-plant payloads: a growth event carries every node of the plant, and
   * broadcasting it to the whole world leaked every plant's geometry and cost
   * bandwidth for players who could not see it.
   */
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

  /** Upkeep tissue loss waiting for the next broadcast slot. */
  private readonly queuedShedDamage = new Map<string, ShedDamage>();
  private lastShedFlushTick = 0;

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
            // The player credited with the kill is paid in spores, and the
            // balance reaches them on the next INVENTORY_SYNC.
            if (event.credit.kind === 'player' && event.credit.playerId) {
              const killer = this.players.get(event.credit.playerId);
              if (killer) {
                this.awardSporesLocked(killer, this.sporeConfig.earnKill, 'kill_credit');
              }
            }
            break;
          case 'strike':
            this.broadcast(MESSAGE_TYPE.WEATHER_STRIKE, {
              tick,
              x: event.x,
              z: event.z,
              radiusM: event.radiusM,
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
    // wilting plant shrank in silence. The losses are already batched per plant
    // in PlantWorld, but they arrive every tick; queue them and flush on the
    // damage pipeline's own cadence, so a wilting plant cannot pulse the
    // client's damage cue every tick.
    for (const shed of this.plantWorld.drainShedDamage()) {
      accumulateShedDamage(this.queuedShedDamage, shed);
    }
    if (tick - this.lastShedFlushTick >= shedFlushIntervalTicks(this.config.tickRateHz)) {
      this.lastShedFlushTick = tick;
      for (const shed of drainQueuedShedDamage(this.queuedShedDamage)) {
        this.broadcast(MESSAGE_TYPE.PLANT_DAMAGE, {
          plantId: shed.plantId,
          nodeId: null,
          destroyedNodeIds: [],
          source: 'starvation',
          amount: shed.amount,
          totalBiomass: shed.totalBiomass,
        });
      }
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
    metricsWindowTicks = 300,
    tickBudgetWarnThresholdMs = 40,
    runtimeEnvironment = 'local',
    devAllowedEnvironments: string[] = ['local'],
    devAdminAccounts: string[] = [],
    // The purse and the catalogue. Appended rather than inserted so every existing
    // positional caller keeps its arguments.
    sporeConfig: SporeConfig = {
      startingBalance: 0,
      earnDung: 0,
      earnMutation: 0,
      earnFragment: 0,
      earnKill: 0,
      maxBalance: 0,
    },
    shopConfig: ShopConfig = { enabled: false, currencyName: '', items: [] },
    playerStateStore: PlayerStateStore | null = null,
  ) {
    this.config = config;
    this.log = log;
    this.plantWorld = plantWorld;
    this.resourceWorld = resourceWorld;
    this.weatherSystem = weatherSystem;
    this.interestManager = interestManager;
    this.plantPersistence = plantPersistence;
    this.terrain = terrain;
    // The wind climbs real terrain: the climate's orographic lift reads the same
    // height field the ground is built from, so a ridge wrings rain out on its
    // windward side instead of raining the same amount on both.
    this.weatherSystem.setTerrainSampler((x, z) => this.terrain?.heightAt(x, z) ?? 0);
    this.maxFrameTimeMs = maxFrameTimeMs;
    this.persistenceEnabled = persistenceEnabled;
    this.plantEventLog = new PlantEventLog(eventLogCompactionThreshold);
    for (const [plantId, events] of initialEvents) {
      this.plantEventLog.seed(plantId, events);
    }
    this.itemsConfig = itemsConfig;
    this.sporeConfig = sporeConfig;
    this.shopConfig = shopConfig;
    this.playerStateStore = playerStateStore;
    this.chatConfig = chatConfig;
    this.reportConfig = reportConfig;
    // One clock per world: the season is world state, not per-plant state, so a
    // plant that dies and is replanted does not reset the calendar.
    this.seasonLengthDays = seasonLengthDays;
    this.seasonClock = createSeasonClock(seasonLengthDays, config.tickRateHz);
    this.reconnectMachine = createReconnectStateMachine(reconnectWindowMs, persistenceEnabled);
    this.tickMetrics = new TickMetrics(metricsWindowTicks, tickBudgetWarnThresholdMs);
    this.runtimeEnvironment = runtimeEnvironment;
    this.devAllowedEnvironments = devAllowedEnvironments;
    this.devAdminAccounts = devAdminAccounts;
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
    return buildWelcomePayload({
      playerId,
      plant,
      reconnectToken: this.issueReconnectToken(plant.id),
      tick: this.getTick(),
      nodeHealth: (nodeId) => this.plantWorld.getNodeHealth(plant.id, nodeId),
    });
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

  /**
   * Load an account's pouch and purse before its player object is built.
   *
   * A failure is not fatal: the player can still grow. It does set a flag that
   * suppresses writes for this session, because saving the starting kit over a
   * readable row during a transient database outage would be worse than
   * losing this session's changes.
   */
  async restorePlayerState(accountId: string): Promise<void> {
    if (!this.playerStateStore) return;
    try {
      const state = await this.playerStateStore.load(accountId);
      if (state) this.restoredPlayerStates.set(accountId, state);
      this.playerStateUnavailable.delete(accountId);
    } catch (error) {
      this.playerStateUnavailable.add(accountId);
      this.log.error('player state load failed; this session will not overwrite it', {
        accountId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Build the live player object, using the restored pouch when there is one. */
  private createConnectedPlayer(
    ws: WebSocket,
    playerId: string,
    plantId: string,
    accountId: string | undefined,
    giveStartingKit = true,
  ): ConnectedPlayer {
    const restored = accountId ? this.restoredPlayerStates.get(accountId) : undefined;
    if (accountId) this.restoredPlayerStates.delete(accountId);

    const inventory = createInventory(this.itemsConfig.inventorySlots);
    // A guest reclaim has no saved row. Giving it the starting kit again would
    // let a reconnect farm starter items and spores; the old behaviour was an
    // empty pouch, so keep that and start the purse at zero.
    let spores = giveStartingKit ? this.sporeConfig.startingBalance : 0;
    if (restored) {
      const loaded = toInventory(restored, {
        itemDefinitions: this.itemsConfig.itemDefinitions,
        maxSlots: this.itemsConfig.inventorySlots,
        onRepair: (message, meta) => this.log.warn(message, { accountId, ...meta }),
      });
      inventory.slots = loaded.slots;
      spores = restored.spores;
    } else if (giveStartingKit) {
      for (const item of this.itemsConfig.startingInventory) {
        addItem(inventory, item.itemId, item.count, this.itemsConfig.itemDefinitions);
      }
    }

    const player: ConnectedPlayer = {
      ws,
      playerId,
      plantId,
      accountId,
      displayName: 'Player',
      lastInputTick: 0,
      pendingInputs: new Map(),
      inventory,
      spores,
      blocked: new Set<string>(),
      chatTimestamps: [],
    };
    // Do not write the starting kit here. A connect-time save races the first
    // purchase: it can capture the starting purse, lose the row lock because the
    // row does not exist yet, and then overwrite the purchase with stale state.
    // The row is created by the first mutation, or by the shutdown flush.
    return player;
  }

  /**
   * Write the restart copy of a player's pouch and purse.
   *
   * Fire-and-forget at the call site, because a shop click must not wait on a
   * database round trip. The write is one upsert and the live object remains
   * authoritative until the next load.
   */
  persistPlayerState(player: Pick<ConnectedPlayer, 'accountId' | 'inventory' | 'spores'>): void {
    if (!this.playerStateStore || !player.accountId) return;
    if (this.playerStateUnavailable.has(player.accountId)) return;
    const accountId = player.accountId;
    void this.playerStateStore
      .save(accountId, toPersistedState(player.inventory, player.spores))
      .catch((error: unknown) => {
        this.log.error('player state save failed', {
          accountId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  /** Flush every live account pouch and purse on a graceful shutdown. */
  async saveAllPlayerStates(): Promise<number> {
    if (!this.playerStateStore) return 0;
    let saved = 0;
    for (const player of this.players.values()) {
      if (!player.accountId || this.playerStateUnavailable.has(player.accountId)) continue;
      try {
        await this.playerStateStore.save(
          player.accountId,
          toPersistedState(player.inventory, player.spores),
        );
        saved += 1;
      } catch (error) {
        this.log.error('shutdown player state save failed', {
          accountId: player.accountId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return saved;
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

    const player = this.createConnectedPlayer(ws, playerId, plantId, accountId);
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
    const leavingPlayer = this.players.get(playerId);
    const disconnectedPlantId = leavingPlayer?.plantId ?? null;
    if (leavingPlayer) this.persistPlayerState(leavingPlayer);

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
      if (oldPlayer) {
        // Carry the live pouch, not the row loaded before the reclaim: the old
        // session may have changed it after that read. The save is still sent
        // so the row catches up even if the new player object fails to build.
        this.restoredPlayerStates.set(
          accountId,
          toPersistedState(oldPlayer.inventory, oldPlayer.spores),
        );
        this.persistPlayerState(oldPlayer);
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

    const player = this.createConnectedPlayer(ws, newPlayerId, plant.id, accountId);
    this.players.set(newPlayerId, player);

    const welcome = this.buildWelcome(newPlayerId, plant);

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

    const player = this.createConnectedPlayer(ws, newPlayerId, plant.id, undefined, false);
    this.players.set(newPlayerId, player);

    const welcome = this.buildWelcome(newPlayerId, plant);

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
    // Straight out, not through `writeIfHealthy`. Every other message may be
    // dropped when the socket is behind, because the next state supersedes it.
    // A health probe may not: dropping the pong makes a congested link look like
    // a dead one, and the client then reports the stall as a round trip.
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: MESSAGE_TYPE.PONG, payload: {} }));
  }

  /**
   * The inventory handlers' view of this world.
   *
   * Built per command rather than stored once: inventory actions arrive at click
   * rate, not frame rate, and a held object would pin the systems a config or
   * world reload can replace.
   */
  private inventoryPorts(): InventoryPorts {
    return {
      itemsConfig: this.itemsConfig,
      sporeConfig: this.sporeConfig,
      send: (ws, type, payload) => this.send(ws, type, payload),
      getPlant: (plantId) => this.plantWorld.getPlant(plantId),
      growthConfig: () => this.plantWorld.getConfig(),
      depositFertilizer: (worldX, worldZ) => this.resourceWorld.onFertilizerApplied(worldX, worldZ),
      depositDung: (worldX, worldZ) => this.resourceWorld.onDungApplied(worldX, worldZ),
      log: this.log,
      persist: (player) => {
        const live = this.players.get(player.playerId);
        if (live) this.persistPlayerState(live);
      },
      mutateState: (player, apply) => this.mutateInventoryState(player, apply),
    };
  }

  /**
   * Buy an item under the stored-state lock.
   *
   * The live object is still the fast path for guests and for a session whose
   * row could not be read. An account with a row reads the pouch and purse
   * inside the row lock, applies the purchase there, and only then copies the
   * committed result back onto the live player. Two purchases in flight cannot
   * both spend the same spores.
   */
  private purchaseShopItem(player: ConnectedPlayer, itemId: string): void {
    const accountId = player.accountId;
    const store = this.playerStateStore;
    if (!store || !accountId || this.playerStateUnavailable.has(accountId)) {
      purchaseShopItem(this.shopPorts(), player, itemId);
      return;
    }

    const reject = (reason: string): void => {
      if (this.players.get(player.playerId) !== player) return;
      this.send(player.ws, MESSAGE_TYPE.REJECT, {
        reason,
        originalType: MESSAGE_TYPE.SHOP_PURCHASE,
      });
    };

    void purchaseUnderLock(
      {
        store,
        accountId,
        unavailable: false,
        initial: toPersistedState(player.inventory, player.spores),
        itemsConfig: this.itemsConfig,
        shopConfig: this.shopConfig,
        sporeConfig: this.sporeConfig,
        itemId,
        onRepair: (message, meta) => this.log.warn(message, { accountId, ...meta }),
      },
      (state) => {
        if (this.players.get(player.playerId) === player) this.adoptPlayerState(player, state);
      },
    )
      .then((plan) => {
        if (!plan) return;
        if (this.players.get(player.playerId) !== player) return;
        if (!plan.ok) {
          reject(plan.reason);
          return;
        }
        sendInventorySync(this.inventoryPorts(), player);
        const entry = this.shopConfig.items.find((item) => item.id === itemId);
        this.log.info('Shop purchase', {
          playerId: player.playerId,
          itemId,
          price: entry?.price ?? 0,
          balance: player.spores,
        });
      })
      .catch((error: unknown) => {
        this.log.error('shop purchase failed', {
          accountId,
          itemId,
          error: error instanceof Error ? error.message : String(error),
        });
        reject('persistence_failed');
      });
  }

  /**
   * Award spores under the stored-state lock.
   *
   * A payout and a purchase must not read the same balance: the award is applied
   * to the row read inside `SELECT ... FOR UPDATE`, and the live purse follows
   * the committed value. Guests and a failed store keep the live path.
   */
  private awardSporesLocked(
    player: ConnectedPlayer,
    amount: number,
    reason: string,
    kind: 'award' | 'drop' = 'award',
  ): void {
    if (!(amount > 0)) return;
    const accountId = player.accountId ?? null;
    let earned = 0;
    void awardSporesStored(
      {
        store: this.playerStateStore,
        accountId,
        unavailable: accountId ? this.playerStateUnavailable.has(accountId) : false,
        initial: toPersistedState(player.inventory, player.spores),
        amount,
        maxBalance: this.sporeConfig.maxBalance,
      },
      (state, paid) => {
        if (this.players.get(player.playerId) !== player) return;
        earned = paid;
        this.adoptPlayerState(player, state);
      },
    )
      .then((balance) => {
        if (balance === null) return;
        if (this.players.get(player.playerId) !== player) return;
        sendInventorySync(this.inventoryPorts(), player);
        // The purse moved and the player did not spend it: the ledger says what
        // paid (a kill, a drop) and the balance the row committed.
        sendLedgerEntry(this.inventoryPorts(), player, {
          kind,
          label: awardLabel(reason),
          itemId: null,
          count: 0,
          amount: earned,
          balance,
        });
        this.log.info('Spores earned', {
          playerId: player.playerId,
          amount: earned,
          reason,
          balance,
        });
      })
      .catch((error: unknown) => {
        this.log.error('spore award failed', {
          accountId,
          reason,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  /**
   * Apply one pouch/purse change under the stored-state lock, then copy the
   * committed state back onto the live player.
   *
   * `mutate` reads the row inside `SELECT ... FOR UPDATE`, so two clicks cannot
   * spend the same item, and the plant's resource gain is applied by the handler
   * only after this resolves. A guest, a session with no store, or a row that
   * could not be read falls back to the live object - the documented copy for
   * those cases - and the same plan runs either way.
   */
  private mutateInventoryState<T>(
    invPlayer: InventoryPlayer,
    apply: (current: PersistedPlayerState) => { next?: PersistedPlayerState; result: T } | null,
  ): Promise<T | null> {
    const player = this.players.get(invPlayer.playerId);
    const accountId = player?.accountId ?? null;
    return mutatePlayerState<T>(
      {
        store: this.playerStateStore,
        accountId,
        unavailable: accountId ? this.playerStateUnavailable.has(accountId) : false,
        initial: toPersistedState(invPlayer.inventory, invPlayer.spores),
      },
      apply,
      (state) => {
        if (player) this.adoptPlayerState(player, state);
      },
    );
  }

  /** Replace the live pouch and purse with the state the store committed. */
  private adoptPlayerState(player: ConnectedPlayer, state: PersistedPlayerState): void {
    player.inventory.slots = toInventory(state, {
      itemDefinitions: this.itemsConfig.itemDefinitions,
      maxSlots: this.itemsConfig.inventorySlots,
      onRepair: (message: string, meta?: Record<string, unknown>) => this.log.warn(message, meta),
    }).slots;
    player.spores = state.spores;
  }

  /** The shop handlers' view, including the write-back after a payout. */
  private shopPorts(): ShopPorts {
    return {
      itemsConfig: this.itemsConfig,
      shopConfig: this.shopConfig,
      sporeConfig: this.sporeConfig,
      send: (ws, type, payload) => this.send(ws, type, payload),
      log: this.log,
      persist: (player) => {
        const live = this.players.get(player.playerId);
        if (live) this.persistPlayerState(live);
      },
    };
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
              // A mutation level is a mutation gained, and the config pays for it.
              // `earn_mutation` was declared and never paid before this, so the
              // HUD only ever showed dung and kill earnings.
              this.awardSporesLocked(player, this.sporeConfig.earnMutation, 'mutation_level');
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
                // The client now holds the whole grid, so per-tick deltas may
                // start: without this the grid never published a change at all.
                this.resourceWorld.markFullGridSent();
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
              ownerName: this.ownerNameFor(p.ownerId),
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
          // D01: dev tools are for this deployment's developers, not for whoever
          // connected. The environment check alone was not enough - a public
          // server that left `NODE_ENV` unset reported `local` - so a non-local
          // run also requires an admin account or an allowlisted one.
          const devPlayer = this.players.get(playerId);
          const devSocket = devPlayer?.ws as (WebSocket & { accountRole?: string }) | undefined;
          const devAccess = resolveDevAccess({
            environment: this.runtimeEnvironment,
            allowedEnvironments: this.devAllowedEnvironments,
            adminAccounts: this.devAdminAccounts,
            accountId: devPlayer?.accountId,
            role: devSocket?.accountRole,
          });
          if (!devAccess.allowed) {
            this.log.warn('Dev action rejected', {
              type: (payload as Record<string, unknown>)?.type,
              reason: devAccess.reason,
            });
            if (devPlayer?.ws) {
              this.sendDevResponse(
                devPlayer.ws,
                String((payload as Record<string, unknown>)?.type ?? 'unknown'),
                { ok: false, error: `dev_access_denied:${devAccess.reason}` },
              );
            }
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

          const intent = resolveChatIntent(chatPayload, this.chatConfig);
          if (!intent) break;

          const budget = consumeChatBudget(
            player.chatTimestamps,
            Date.now(),
            this.chatConfig.worldRateMsgPerMin,
          );
          player.chatTimestamps = budget.timestamps;
          if (!budget.allowed) {
            this.send(player.ws, MESSAGE_TYPE.ERROR, {
              code: 'chat_rate_limit',
              message: 'Chat rate limit reached. Slow down.',
            });
            break;
          }

          const from = {
            playerId,
            playerName: player.displayName ?? 'Player',
            timestamp: Date.now(),
          };
          if (intent.emoteId) {
            this.deliverChat(playerId, intent.mode, {
              ...from,
              emoteId: intent.emoteId,
              type: 'emote',
            });
            break;
          }
          this.deliverChat(playerId, intent.mode, { ...from, message: intent.text });
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
          sendInventorySync(this.inventoryPorts(), player);
          break;
        }
        case MESSAGE_TYPE.SHOP_PURCHASE: {
          const request = payload as { itemId: string };
          const buyer = this.players.get(playerId);
          if (!buyer) break;
          this.purchaseShopItem(buyer, String(request.itemId ?? ''));
          break;
        }
        case MESSAGE_TYPE.DROP_COLLECT: {
          const request = payload as { id: string };
          const collector = this.players.get(playerId);
          if (!collector || !this.damagePipeline) break;
          // The decision lives in `ops/dropPickup.ts`: a live drop pays once and
          // is removed, an unknown or already-spent id pays nothing.
          const pickup = pickupDrop(this.damagePipeline, this.sporeConfig, collector, request?.id);
          if (!pickup.ok || !pickup.kind) break;
          this.awardSporesLocked(collector, pickup.amount, `drop_${pickup.kind}`, 'drop');
          break;
        }
        case MESSAGE_TYPE.INVENTORY_SLOT_USE: {
          const payload2 = payload as { slotIndex: number };
          const player2 = this.players.get(playerId);
          if (!player2) break;
          void useInventorySlot(this.inventoryPorts(), player2, payload2.slotIndex).catch(
            (error: unknown) => {
              this.log.error('item use failed', {
                playerId,
                error: error instanceof Error ? error.message : String(error),
              });
            },
          );
          break;
        }
        case MESSAGE_TYPE.INVENTORY_SLOT_SWAP: {
          const payload2 = payload as { fromIndex: number; toIndex: number };
          const player2 = this.players.get(playerId);
          if (!player2) break;
          void swapInventorySlots(
            this.inventoryPorts(),
            player2,
            payload2.fromIndex,
            payload2.toIndex,
          ).catch((error: unknown) => {
            this.log.error('slot swap failed', {
              playerId,
              error: error instanceof Error ? error.message : String(error),
            });
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
    // Soil collapse and drying run slower than the tick and are gated inside.
    this.terrain?.tick(dt, tick);
    this.terrain?.dry(dt);

    for (const player of this.players.values()) {
      if (player.plantId) {
        const plant = this.plantWorld.getPlant(player.plantId);
        if (plant?.rootNodeId) {
          const rootNode = plant.nodes.get(plant.rootNodeId);
          if (rootNode) {
            // One slice of this player's water-table field (see
            // WaterTableGridBuilder): the whole 48x48 field in one call was the
            // last ~100 ms stall in the loop.
            this.advanceWaterTableGrid(player.playerId, rootNode.x, rootNode.z);
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
    // A player who left keeps no field: the builder holds a live Float32Array
    // plus its base64, and nothing else will ever read it.
    for (const playerId of this.waterTableBuilders.keys()) {
      if (!this.players.has(playerId)) this.waterTableBuilders.delete(playerId);
    }

    // Root uptake first: capture is what makes photosynthesis possible.
    this.plantWorld.absorbResourcesFromTiles(dt, (x, z) =>
      this.resourceWorld.getTileResources(x, z),
    );

    // The per-tier timings are the only signal that tells an overloaded tick from
    // a healthy one, so they are recorded rather than discarded.
    this.tickMetrics.record(this.plantWorld.step(dt, onlinePlantIds, tick));
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
    let weatherAnchor: { x: number; z: number } | null = null;
    for (const player of this.players.values()) {
      if (player.plantId) {
        const plant = this.plantWorld.getPlant(player.plantId);
        if (plant) {
          plantsForResource.set(plant.id, this.plantResourceView(plant));
          // The climate is read where a plant actually is: its ridge has its
          // own cloud, windward slope and rain shadow. The first connected plant
          // is the world's weather station.
          if (!weatherAnchor && plant.rootNodeId != null) {
            const root = plant.nodes.get(plant.rootNodeId);
            if (root) weatherAnchor = { x: root.x, z: root.z };
          }
        }
      }
    }
    if (weatherAnchor) this.weatherSystem.setClimateAnchor(weatherAnchor.x, weatherAnchor.z);
    // Seasons run the year: the field's temperature swing follows the clock, so
    // winter brings snow to ground that rains in summer.
    const seasonLengthS = Math.max(1, this.seasonClock.lengthTicks / this.config.tickRateHz);
    const seasonRemaining = seasonRemainingSeconds(this.seasonClock, tick, this.config.tickRateHz);
    this.weatherSystem.setSeasonPhase(
      ((((this.seasonClock.season - 1 + (1 - seasonRemaining / seasonLengthS)) % 4) + 4) % 4) / 4,
    );
    const previousWeatherState = this.weatherSystem.getWeatherState();
    this.weatherSystem.update(dt);
    const weatherBroadcast = this.weatherSystem.getBroadcast();
    // Weather used to leave no trace: after a day there was no way to say how
    // much of it was wet, or whether the field ever crossed its threshold. One
    // line per transition is the whole record, and it is cheap enough to keep.
    if (weatherBroadcast.weatherState !== previousWeatherState) {
      const sample = this.weatherSystem.getClimateSample();
      this.log.info('weather changed', {
        from: previousWeatherState,
        to: weatherBroadcast.weatherState,
        tick,
        day: weatherBroadcast.dayNumber,
        timeOfDay: Number(weatherBroadcast.timeOfDay.toFixed(4)),
        season: this.seasonClock.season,
        temperatureC: sample ? Number(sample.temperatureC.toFixed(1)) : null,
        humidity: sample ? Number(sample.humidity.toFixed(3)) : null,
        cloud: sample ? Number(sample.cloud.toFixed(3)) : null,
        precipitation: sample ? Number(sample.precipitation.toFixed(3)) : null,
      });
    }

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

    const plantStates: PlantStateSnapshot[] = [];
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
    const plantPositions = new Map<string, { x: number; z: number }>();
    for (const state of plantStates) {
      const plant = this.plantWorld.getPlant(state.id);
      const root = plant?.rootNodeId ? plant.nodes.get(plant.rootNodeId) : undefined;
      if (root) plantPositions.set(state.id, { x: root.x, z: root.z });
    }

    // Per-player, by interest cell, on the configured wire cadence: every one of
    // those rules lives in tick/stateBroadcast.ts.
    const stateBroadcast = broadcastPlantStates(this.stateBroadcastPorts(), {
      tick,
      dt,
      keyframeIntervalTicks: this.config.keyframeIntervalTicks,
      clientSendRateHz: this.config.clientSendRateHz,
      worldBounds: this.config.worldBounds,
      tileSize: this.resourceWorld.getTileSize(),
      accumulatorMs: this.stateCadenceAccumulatorMs,
      players: Array.from(this.players.values(), (player) => ({
        playerId: player.playerId,
        plantId: player.plantId,
      })),
      states: plantStates,
      positions: plantPositions,
    });
    this.stateCadenceAccumulatorMs = stateBroadcast.nextAccumulatorMs;
    this.stateMessagesSent += stateBroadcast.sent;
    this.stateMessagesSkipped += stateBroadcast.skipped;
    // The root readout rides the same cadence as the state it belongs to.
    const sendStateNow = stateBroadcast.due;

    // Broadcast only dirty (changed) tiles - delta compression for bandwidth efficiency.
    // Count first: building the tile array for a whole-grid update allocates ~65k
    // objects and touches three maps, which at 20 Hz cost more than the broadcast.
    // Whole-grid updates (daylight / weather re-tinting every tile) are capped at
    // one per second; skipping one is harmless because the next event dirties
    // every tile again. Small deltas are never delayed.
    const gridBroadcast = broadcastResourceDeltas(
      this.resourceBroadcastPorts(),
      {
        tick,
        wholeGridThreshold: COMPACT_GRID_TILE_THRESHOLD,
        minIntervalMs: World.COMPACT_GRID_MIN_INTERVAL_MS,
      },
      { lastWholeGridAt: this.lastCompactGridBroadcastAt },
    );
    this.lastCompactGridBroadcastAt = gridBroadcast.lastWholeGridAt;

    const rootReadout = broadcastRootReadouts(this.rootReadoutPorts(), {
      tick,
      sendNow: sendStateNow,
      players: Array.from(this.players.values(), (player) => ({
        playerId: player.playerId,
        plantId: player.plantId,
      })),
    });
    this.rootMessagesSent += rootReadout.sent;
    this.rootMessagesSkipped += rootReadout.skipped;

    const weatherStep = broadcastWeather(
      { broadcast: (payload) => this.broadcast(MESSAGE_TYPE.WEATHER_UPDATE, payload) },
      {
        tick,
        dt,
        sendRateHz: this.config.weatherSendRateHz,
        accumulatorMs: this.weatherCadenceAccumulatorMs,
        weather: weatherBroadcast,
      },
    );
    this.weatherCadenceAccumulatorMs = weatherStep.nextAccumulatorMs;
    this.weatherMessagesSent += weatherStep.sent;
    this.weatherMessagesSkipped += weatherStep.skipped;

    this.updateSeason(tick);
  }

  /** The state fanout's view: write through the health gate, and interest cells. */
  private stateBroadcastPorts(): StateBroadcastPorts {
    return {
      send: (playerId, message, messageType) => {
        const player = this.players.get(playerId);
        return player ? this.writeIfHealthy(player.ws, message, messageType) : false;
      },
      isInRange: (playerId, x, z) => this.interestManager.isPositionInRange(playerId, x, z),
    };
  }

  /** The tile-delta fanout's view of the grid. */
  private resourceBroadcastPorts(): ResourceBroadcastPorts {
    return {
      dirtyTileCount: () => this.resourceWorld.getDirtyTileCount(),
      dirtyTiles: () => this.resourceWorld.getDirtyTiles(),
      grid: () => ({
        width: this.resourceWorld.getWidth(),
        height: this.resourceWorld.getHeight(),
        tileSize: this.resourceWorld.getTileSize(),
      }),
      encodeWholeGrid: (tiles) =>
        encodeResourceGridBase64(
          this.resourceWorld.getWidth(),
          this.resourceWorld.getHeight(),
          tiles as Parameters<typeof encodeResourceGridBase64>[2],
        ),
      broadcast: (payload) => this.broadcast(MESSAGE_TYPE.RESOURCE_UPDATE, payload),
      now: () => Date.now(),
    };
  }

  /** The root readout's view: one plant, its tiles, its caches, its wire. */
  private rootReadoutPorts(): RootReadoutPorts {
    return {
      plant: (playerId) => {
        const player = this.players.get(playerId);
        const plant = player?.plantId ? this.plantWorld.getPlant(player.plantId) : undefined;
        if (!plant) return null;
        const root = plant.rootNodeId ? plant.nodes.get(plant.rootNodeId) : undefined;
        return {
          id: plant.id,
          totalEnergy: plant.totalEnergy,
          totalBiomass: plant.totalBiomass,
          storedWater: plant.storedWater,
          storedMinerals: plant.storedMinerals,
          rootPosition: root ? { x: root.x, z: root.z } : null,
        };
      },
      coverage: (plantId) => {
        const plant = this.plantWorld.getPlant(plantId);
        const coverage = plant ? this.resourceWorld.getPlantTileCoverage(plant) : null;
        return coverage
          ? { ...coverage, sample: coverage.sample ?? null }
          : {
              count: 0,
              avgLight: 0,
              avgMoisture: 0,
              avgMinerals: 0,
              avgGroundwater: 0,
              sample: null,
            };
      },
      capacity: (plantId) => {
        const plant = this.plantWorld.getPlant(plantId);
        const capacity =
          this.plantWorld.getPlantCapacity(plantId) ??
          (plant
            ? computePlantCapacity(plant, this.plantWorld.getConfig())
            : { water: 0, minerals: 0 });
        return { water: capacity.water, minerals: capacity.minerals };
      },
      groundwaterCapacity: () => this.resourceWorld.getGroundwaterCapacity(),
      waterTable: (playerId) => this.waterTableBuilders.get(playerId)?.grid ?? undefined,
      waterTableRevisionSent: (playerId) => this.lastWaterTableRevision.get(playerId),
      rememberWaterTableRevision: (playerId, revision) =>
        this.lastWaterTableRevision.set(playerId, revision),
      unchanged: (playerId, snapshot) => this.rootResourcesUnchanged(playerId, snapshot),
      send: (playerId, message) => {
        const player = this.players.get(playerId);
        return player
          ? this.writeIfHealthy(player.ws, message, MESSAGE_TYPE.RESOURCE_UPDATE)
          : false;
      },
      remember: (playerId, snapshot) => this.lastRootResourceUpdate.set(playerId, snapshot),
      grid: () => ({
        width: this.resourceWorld.getWidth(),
        height: this.resourceWorld.getHeight(),
        tileSize: this.resourceWorld.getTileSize(),
      }),
    };
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
  /**
   * The water-table field each player's readout draws, one slice per tick.
   *
   * The 48x48 field used to be sampled whole from the readout, twice a second,
   * for 2,304 five-tap terrain evaluations in a single call: ~100 ms of stopped
   * event loop each time, which showed up outside as a ping climbing to 150 ms
   * on loopback. It is the same work, spread over twenty calls a second, and the
   * readout picks up whichever field finished last.
   */
  private waterTableBuilders = new Map<string, WaterTableGridBuilder>();

  private advanceWaterTableGrid(playerId: string, x: number, z: number): void {
    let builder = this.waterTableBuilders.get(playerId);
    if (!builder) {
      builder = new WaterTableGridBuilder((sx, sz) =>
        this.resourceWorld.getWaterTableHeightAt(sx, sz),
      );
      this.waterTableBuilders.set(playerId, builder);
    }
    builder.advance(x, z);
  }

  /** Root position used for proximity chat range checks. */
  private plantPosition(player: ConnectedPlayer): { x: number; z: number } | null {
    if (!player.plantId) return null;
    const plant = this.plantWorld.getPlant(player.plantId);
    const root = plant?.rootNodeId ? plant.nodes.get(plant.rootNodeId) : undefined;
    return root ? { x: root.x, z: root.z } : null;
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
      const resolved = resolveDevWeatherCommand(action);
      if (!resolved.ok) {
        this.sendDevResponse(ws, action.type, { ok: false, error: resolved.error });
        return;
      }
      const { state, durationS } = resolved.command;
      this.weatherSystem.forceState(state, durationS);
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

    try {
      // Clock, save, log and config commands: tick/simulationCommands.ts.
      if (handleSimulationCommand(this.simulationCommandPorts(ws), action)) return;
      // World and clock state, then injuries: dev/worldCommands.ts and
      // dev/damageCommands.ts.
      if (handleWorldCommand(this.worldCommandPorts(ws), action)) return;
      const crown = plant?.rootNodeId ? plant.nodes.get(plant.rootNodeId) : undefined;
      const damageTarget: PlantTarget | undefined =
        plant && player?.plantId && this.damagePipeline
          ? {
              plantId: player.plantId,
              playerId: player.playerId,
              root: crown ? { x: crown.x, z: crown.z } : null,
            }
          : undefined;
      if (handleDamageCommand(this.damageCommandPorts(ws, damageTarget), action, damageTarget)) {
        return;
      }
      // The plant's own fields, items, season and regeneration.
      if (
        handlePlantCommand(this.plantCommandPorts(ws, playerId, player, plant), action, {
          hasPlant: Boolean(plant),
          hasPlayer: Boolean(player),
        })
      ) {
        return;
      }
      // Every family has passed, so the action is one nobody implements.
      this.log.warn('Unknown dev action', { type: action.type });
      this.sendDevResponse(ws, action.type, { ok: false, error: 'unknown_action' });
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

  /**
   * The clock/save/log dev commands' view of this world. Rebuilt per action
   * because the answer goes back on the socket that asked.
   */
  private simulationCommandPorts(ws: WebSocket): SimulationCommandPorts {
    return {
      setTickRate: (hz) => this.setTickRate(hz),
      pauseSimulation: () => this.pauseSimulation(),
      resumeSimulation: () => this.resumeSimulation(),
      stepSimulationOnce: () => this.stepSimulationOnce(),
      setInterestCellSize: (size) => this.interestManager.setCellSize(size),
      setInterestRingRadius: (radius) => this.interestManager.setRingRadius(radius),
      setTierRates: (rates) => this.plantWorld.setTierRates(rates),
      savePlants: async () => {
        const result = await saveAllPlants(
          this.plantWorld,
          this.getPlantPersistence(),
          this.log,
          'dev_force_save',
          this.plantEventLog,
        );
        return { ...result };
      },
      clearPersistence: () => this.getPlantPersistence().clearAll(),
      createRandomPlants: (count) => {
        for (let i = 0; i < count; i++) this.plantWorld.createRandomPlant();
      },
      applyConfig: (key, value) => this.applyDevConfig(key, value),
      plantSummaries: () =>
        this.plantWorld
          .getAllPlants()
          .map((p) => ({ id: p.id, owner: p.ownerId, biomass: p.totalBiomass })),
      resourceTiles: () => this.resourceWorld.getAllTiles(),
      networkStats: () => ({
        players: this.players.size,
        connections: connectionRegistryGetConnectionCount(this.connectionRegistry),
        stateSent: this.stateMessagesSent,
        stateSkipped: this.stateMessagesSkipped,
        weatherSent: this.weatherMessagesSent,
        weatherSkipped: this.weatherMessagesSkipped,
        rootReadoutsSent: this.rootMessagesSent,
        rootReadoutsSkipped: this.rootMessagesSkipped,
        // Messages a socket refused at the write gate: closed, or over
        // `maxBufferedBytes`. Every `*Sent` above excludes these, so a backlog
        // shows up here instead of hiding inside a delivery count.
        skippedSends: this.skippedSends,
      }),
      respond: (actionType, payload) => this.sendDevResponse(ws, actionType, payload),
      logInfo: (message, meta) => this.log.info(message, meta),
    };
  }

  /** The resource, tile and clock dev commands' view of this world. */
  private worldCommandPorts(ws: WebSocket): WorldCommandPorts {
    return {
      applyResourceRates: (patch) => {
        const world = this.resourceWorld;
        if (patch.photosynthesisRate !== undefined) {
          world.setPhotosynthesisRate(patch.photosynthesisRate);
        }
        if (patch.diffusionRate !== undefined) world.setDiffusionRate(patch.diffusionRate);
        if (patch.maxAbsorptionPerTick !== undefined) {
          world.setMaxAbsorptionPerTick(patch.maxAbsorptionPerTick);
        }
        if (patch.rainGainPerS !== undefined) world.setRainGainPerS(patch.rainGainPerS);
        if (patch.evaporationPerS !== undefined) world.setEvaporationPerS(patch.evaporationPerS);
        if (patch.canopyShadeReduction !== undefined) {
          world.setCanopyShadeReduction(patch.canopyShadeReduction);
        }
      },
      resetResourceRates: () => this.resourceWorld.resetToDefaults(),
      tileCoordinates: (worldX, worldZ) => this.resourceWorld.getTileCoordinates(worldX, worldZ),
      setTileResources: (tileX, tileZ, resources) =>
        this.resourceWorld.setTileResources(tileX, tileZ, resources),
      setTimeOfDay: (fraction) => this.weatherSystem.setTimeOfDay(fraction),
      setTimePaused: (paused) => this.weatherSystem.setTimePaused(paused),
      setTimeScale: (scale) => this.weatherSystem.setTimeScale(scale),
      weatherBroadcast: () => {
        const forced = this.weatherSystem.getBroadcast();
        return {
          timeOfDay: forced.timeOfDay,
          isDay: forced.isDay,
          sunIntensity: forced.sunIntensity,
          timePaused: forced.timePaused,
          timeScale: forced.timeScale,
        };
      },
      // The clock is world state: push it to everyone at once so a dev change is
      // not something only the calling panel sees.
      broadcastWeather: () => {
        this.broadcast(MESSAGE_TYPE.WEATHER_UPDATE, {
          tick: this.getTick(),
          ...this.weatherSystem.getBroadcast(),
        });
      },
      respond: (actionType, payload) => this.sendDevResponse(ws, actionType, payload),
    };
  }

  /** The injury dev commands, closed over the plant and pipeline they act on. */
  private damageCommandPorts(ws: WebSocket, target: PlantTarget | undefined): DamageCommandPorts {
    const pipeline = this.damagePipeline;
    return {
      defaultToolDamage: () => pipeline?.getConfig().damage.toolDamagePerHit ?? 0,
      spawnDrop: (kind, x, y, z) => {
        if (!pipeline) return null;
        const drop = pipeline.spawnWorldDrop(kind, x, y, z, target?.plantId ?? null);
        return drop ? { id: drop.id } : null;
      },
      applyToolDamage: (amount) => {
        if (!pipeline || !target) return;
        pipeline.applyDamage(target.plantId, amount, 'tool', this.getTick(), {
          playerId: target.playerId,
        });
      },
      killPlant: () => {
        if (target) this.plantWorld.killPlant(target.plantId, 'damage');
      },
      forceUproot: (cause) =>
        pipeline && target ? pipeline.forceUproot(target.plantId, cause, this.getTick()) : false,
      requestReroot: (dirX, dirZ) =>
        pipeline && target ? pipeline.requestReroot(target.plantId, dirX, dirZ) : false,
      forceSwarm: (x, z) => pipeline?.forceSwarm(x, z, this.getTick()),
      forceCollapse: (x, z) => pipeline?.forceCollapse(x, z, this.getTick()),
      processDamageEvents: () => this.processDamageEvents(),
      processPlantDeaths: () => this.processPlantDeaths(),
      respond: (actionType, payload) => this.sendDevResponse(ws, actionType, payload),
    };
  }

  /** The plant-field dev commands, closed over the plant they write to. */
  private plantCommandPorts(
    ws: WebSocket,
    playerId: string,
    player: ConnectedPlayer | undefined,
    plant: Plant | undefined,
  ): PlantCommandPorts {
    // The plant can be replaced mid-action (regenerate), so every root step
    // looks it up again instead of reusing the handle resolved for the request.
    let regenerated: Plant | undefined;
    const live = () => (player?.plantId ? this.plantWorld.getPlant(player.plantId) : undefined);
    return {
      setGrowthCooldown: (seconds) => {
        if (!plant) return;
        plant.growthCooldownUntil =
          this.getTick() + Math.ceil(seconds * this.plantWorld.getTickRateHz());
      },
      setGerminationMins: (patch) => {
        const config = this.plantWorld.getConfig();
        if (patch.moisture !== undefined) config.germinationMinMoisture = patch.moisture;
        if (patch.light !== undefined) config.germinationMinLight = patch.light;
      },
      crownPosition: () => {
        const crown = plant?.rootNodeId ? plant.nodes.get(plant.rootNodeId) : undefined;
        return crown ? { x: crown.x, z: crown.z } : null;
      },
      mutationGallery: (center) =>
        this.plantWorld.buildMutationGallery(plant?.worldId ?? '', 8, 10, center),
      grantMutation: (mutationId) =>
        this.plantWorld.grantMutation(player?.plantId ?? '', mutationId, this.getTick()),
      clearMutations: () => this.plantWorld.clearMutations(player?.plantId ?? '', this.getTick()),
      syncMutationState: () => {
        if (player) this.sendMutationState(player);
      },
      fillEnergy: () => {
        if (!plant) return;
        plant.totalEnergy = computePlantCapacity(plant, this.plantWorld.getConfig()).energy;
      },
      fillTissue: () => (plant ? this.plantWorld.fillPlantTissue(plant.id) : 0),
      fillStoredResources: () => {
        if (!plant) return { water: 0, minerals: 0 };
        const capacity = computePlantCapacity(plant, this.plantWorld.getConfig());
        plant.storedWater = capacity.water;
        plant.storedMinerals = capacity.minerals;
        return { water: capacity.water, minerals: capacity.minerals };
      },
      grantItem: (itemId, count) => {
        if (!player) return Promise.reject(new Error('no_player'));
        // The answer is what the row committed, not what the live pouch would
        // take, so a failed grant reaches the panel as a failure. The sync runs
        // first, so the panel adopts the committed pouch along with the answer.
        return grantItemUnderLock(
          {
            store: this.playerStateStore,
            accountId: player.accountId ?? null,
            unavailable: player.accountId
              ? this.playerStateUnavailable.has(player.accountId)
              : false,
            initial: toPersistedState(player.inventory, player.spores),
            itemsConfig: this.itemsConfig,
            itemId,
            count,
            onRepair: (message, meta) => this.log.warn(message, meta),
          },
          (state) => {
            if (this.players.get(player.playerId) === player) this.adoptPlayerState(player, state);
          },
        )
          .then((added) => {
            if (this.players.get(player.playerId) === player) {
              sendInventorySync(this.inventoryPorts(), player);
              // A dev grant is an award of items, not of spores: the line names
              // the item and the count and leaves the balance where it was.
              if (added > 0) {
                sendLedgerEntry(this.inventoryPorts(), player, {
                  kind: 'award',
                  // The item's own name, so the line says what was granted rather
                  // than only that a dev granted something.
                  label: `${awardLabel('dev_grant')}: ${this.itemsConfig.itemDefinitions.get(itemId)?.name ?? 'item'}`,
                  itemId,
                  count: added,
                  amount: 0,
                  balance: player.spores,
                });
              }
            }
            return added;
          })
          .catch((error: unknown) => {
            this.log.error('dev item grant failed', {
              itemId,
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          });
      },
      endSeason: () => ({ season: this.forceSeasonEnd(this.getTick()).season }),
      prepareRootGrowth: () => {
        const current = live();
        if (!current) return false;
        current.growthCooldownUntil = this.getTick();
        current.totalEnergy = Math.max(current.totalEnergy, 400);
        current.storedWater = Math.max(current.storedWater, 40);
        current.storedMinerals = Math.max(current.storedMinerals, 40);
        return true;
      },
      rootParent: () => {
        const current = live();
        if (!current) return null;
        const roots = Array.from(current.nodes.values()).filter(
          (node) => node.type === 'root' || node.type === 'radicle',
        );
        const crown = current.rootNodeId ? current.nodes.get(current.rootNodeId) : undefined;
        const parent = roots.length > 0 ? roots.sort((a, b) => a.y - b.y)[0] : crown;
        return parent ? { id: parent.id, hasRoots: roots.length > 0 } : null;
      },
      growRoot: (parentId, angle, nodeType) => {
        const current = live();
        if (!current) return { ok: false, reason: 'plant_gone' };
        const result = this.plantWorld.tryGrow(
          {
            plantId: current.id,
            nodeId: parentId,
            direction: { x: Math.cos(angle) * 0.5, y: -0.8, z: Math.sin(angle) * 0.5 },
            nodeType,
            tick: this.getTick(),
            attachFraction: 1,
          },
          this.getTick(),
        );
        if (!result.success) return { ok: false, reason: result.reason ?? 'growth_failed' };
        const after = this.plantWorld.getPlant(current.id);
        const anchor = current.nodes.get(current.rootNodeId ?? '');
        return {
          ok: true,
          growth: {
            payload: {
              plantId: current.id,
              newNode: result.newNode,
              newNodes: result.newNodes,
              updatedParentNode: result.updatedParentNode,
              totalBiomass: after?.totalBiomass ?? 0,
              totalEnergy: after?.totalEnergy ?? 0,
              growthSeq: after?.growthSeq ?? 0,
            },
            x: result.newNode?.x ?? anchor?.x ?? 0,
            z: result.newNode?.z ?? anchor?.z ?? 0,
            newNodeId: result.newNode?.id,
          },
        };
      },
      broadcastGrowth: (growth) =>
        this.broadcastNear(MESSAGE_TYPE.GROWTH_EVENT, growth.payload, growth.x, growth.z),
      regenerate: () => {
        if (!plant || !player?.plantId) return null;
        // Keep the old plant's world id: a literal here would put the new plant in
        // a different world from every other plant and from persistence.
        const worldId = plant.worldId;
        this.plantWorld.removePlant(player.plantId);
        // Same owner identity and world as addPlayer, otherwise the plant is
        // invisible to reclaim/persistence and every anonymous player shares the
        // literal owner id 'anon'.
        regenerated = this.plantWorld.createPlant(player.accountId ?? playerId, worldId, 0, 0);
        player.plantId = regenerated.id;
        connectionRegistrySetPlant(this.connectionRegistry, playerId, regenerated.id);
        this.registerClientAtPlant(playerId, regenerated);
        return regenerated.id;
      },
      sendWelcome: () => {
        if (!regenerated) return;
        ws.send(
          JSON.stringify({
            type: MESSAGE_TYPE.WELCOME,
            payload: this.buildWelcome(playerId, regenerated),
          }),
        );
      },
      settleDeaths: () => this.processPlantDeaths(),
      respond: (actionType, payload) => this.sendDevResponse(ws, actionType, payload),
    };
  }

  start(): void {
    // The warning had no subscriber, so an overloaded server looked identical to a
    // healthy one. The window counts both branches of checkTickBudget.
    this.budgetSubscription = eventBus.subscribe<TickBudgetWarning>(
      GAME_EVENTS.TICK_BUDGET_WARNING,
      (warning) => this.tickMetrics.recordWarning(warning),
    );
    tickClockStart(this.tickClock);
    this.log.info('world simulation started', { tickRateHz: this.config.tickRateHz });
  }

  stop(): void {
    this.budgetSubscription?.unsubscribe();
    this.budgetSubscription = null;
    tickClockStop(this.tickClock);
  }

  /** The tick timing window, served by the metrics route and asserted in tests. */
  getMetrics(): TickMetricsSnapshot {
    return this.tickMetrics.snapshot();
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

  /**
   * The world clock, as the game itself runs it. The title screen is outside the
   * game loop, so it asks for this instead of keeping a second day.
   */
  getWorldTime(): {
    timeOfDay: number;
    isDay: boolean;
    paused: boolean;
    scale: number;
    weather: string;
  } {
    const broadcast = this.weatherSystem.getBroadcast();
    return {
      timeOfDay: broadcast.timeOfDay,
      isDay: broadcast.isDay,
      paused: broadcast.timePaused,
      scale: broadcast.timeScale,
      // The title draws the world's sky, so it needs the world's weather rather
      // than one invented from the hour: standing in a storm while the menu shows
      // clear is two skies disagreeing in front of the player.
      weather: broadcast.weatherState,
    };
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
  if (configs.has('terrain')) {
    // The field's tunables come from the loader the climate day tool also uses.
    // The two mapped this file separately, and both fell back to numbers it had
    // outgrown (6 m of relief, a 7 m river), so a renamed key would have built
    // two different planets without saying so.
    terrainService = new TerrainService(loadTerrainFieldParams(configs), {
      cellSizeM: readNumber(configs, 'terrain', 'cell_size_m'),
      chunkCells: Math.round(readNumber(configs, 'terrain', 'chunk_cells')),
      surfaceBreakDepthM: readNumber(configs, 'terrain', 'surface_break_depth_m'),
      maxDepthM: readNumber(configs, 'terrain', 'max_depth_m'),
      maxEditVolumeM3: readNumber(configs, 'terrain', 'max_edit_volume_m3'),
      maxEditsPerTick: Math.round(readNumber(configs, 'terrain', 'max_edits_per_tick')),
      collapseCadenceHz: Math.round(readNumber(configs, 'terrain', 'collapse_cadence_hz')),
      displacementRingCells: Math.round(readNumber(configs, 'terrain', 'displacement_ring_cells')),
      growthResistanceMin: readNumber(configs, 'terrain', 'growth_resistance_min'),
      growthResistanceMax: readNumber(configs, 'terrain', 'growth_resistance_max'),
      maxActiveChunks: Math.round(readNumber(configs, 'terrain', 'max_active_chunks')),
      runoffFraction: readNumber(configs, 'terrain', 'runoff_fraction'),
      evaporationPerS: readNumber(configs, 'terrain', 'evaporation_per_s'),
      rainAbsorptionPerS: readNumber(configs, 'terrain', 'rain_absorption_per_s'),
    });
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
  // The field replaces the global Markov chain: the chain still runs the storm's
  // phases and durations, but which weather happens is sampled from the world.
  const weatherSystem = new WeatherSystem(
    weatherConfig,
    dayNightConfig,
    loadClimateConfig(configs),
  );

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

  const sporeConfig = loadSporeConfig(configs);
  const shopConfig = loadShopConfig(configs);
  const playerStateStore = database.pool
    ? new PlayerStateStore(database.pool, {
        itemDefinitions: itemsConfig.itemDefinitions,
        maxSlots: itemsConfig.inventorySlots,
        maxSpores: sporeConfig.maxBalance,
        onRepair: (message, meta) => log.warn(message, meta),
      })
    : null;

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
    runtime.metricsWindowTicks,
    worldConfig.tickBudgetWarnThresholdMs,
    runtime.nodeEnv,
    runtime.devAllowedEnvironments,
    runtime.devAdminAccounts,
    sporeConfig,
    shopConfig,
    playerStateStore,
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

    // INV-AU-12: the WebSocket refused a disallowed origin while HTTP executed
    // the request and only omitted the CORS header. Same policy, same answer.
    const requestOrigin = request.headers.origin;
    if (
      typeof requestOrigin === 'string' &&
      !isAllowedOrigin(requestOrigin, runtime.corsOrigins, runtime.nodeEnv)
    ) {
      log.warn('refused request from disallowed origin', {
        origin: requestOrigin,
        path: request.url,
      });
      sendJson(response, 403, { error: 'origin_not_allowed' });
      return;
    }

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

    // The title screen runs before a connection, so it reads the clock over HTTP
    // rather than inventing one. Read-only and cheap: no player data.
    if (url.pathname === '/world/time' && request.method === 'GET') {
      sendJson(response, 200, world.getWorldTime());
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

    if (url.pathname.startsWith('/config/')) {
      const configRoute = await handleConfigRequest(url, runtime.configDir);
      if (configRoute) {
        sendJson(response, configRoute.status, configRoute.body);
        return;
      }
    }

    // D01: Dev config endpoints (non-production only)
    if (runtime.metricsPath && url.pathname === runtime.metricsPath) {
      sendJson(response, 200, world.getMetrics());
      return;
    }

    if (url.pathname === '/dev/config' && request.method === 'GET') {
      await handleGetDevConfig(request, response, runtime.nodeEnv, runtime.devAllowedEnvironments);
      return;
    }
    if (url.pathname === '/dev/config' && request.method === 'POST') {
      const applied = await handlePostDevConfig(
        request,
        response,
        runtime.nodeEnv,
        runtime.devAllowedEnvironments,
      );
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

  // Sockets that die without closing stay in `wss.clients` and keep being
  // broadcast to, so their backlog grows until every send to them is skipped.
  // Ping them and terminate whatever misses a pong.
  const heartbeat = setInterval(() => {
    for (const dead of heartbeatTick(wss.clients as unknown as HeartbeatSocket[])) {
      log.warn('terminating unresponsive socket', { reason: 'missed heartbeat' });
      dead.terminate();
    }
  }, SOCKET_HEARTBEAT_MS);
  heartbeat.unref();

  wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
    const live = ws as WebSocket & { isAlive?: boolean };
    live.isAlive = true;
    ws.on('pong', () => {
      live.isAlive = true;
    });
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

      // Load the restart copy before a player object exists. A brand-new
      // account has no row; an existing one gets its pouch and purse back.
      if (accountId) await world.restorePlayerState(accountId);

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

      // The menu's nickname travels on HELLO. Other players already saw 'Player'
      // for everyone, including signed-in accounts, because nothing carried the
      // name over the socket. Sanitized and capped by the same validator the
      // client form uses, so a hand-written client cannot put markup in chat.
      if (typeof hello.displayName === 'string') {
        const name = validateDisplayName(hello.displayName, runtime.displayNameMaxLength);
        const player = world.getPlayer(playerId);
        if (name.ok && player) player.displayName = name.value;
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

    // Save all player pouches and purses on shutdown, before the process ends.
    await world.saveAllPlayerStates().then((count) => {
      if (count > 0) log.info('saved player states on shutdown', { count });
    });

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
