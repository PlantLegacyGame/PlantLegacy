# Protocol

**Status:** implemented by T03P (Gate 0) and T03 (full protocol with persistence, offline tiers, interest management, event bus). T05 adds chat, emotes, blocking and reports; inventory sync/use/swap and the dev panel are wired server-side. T13/C05 add the spore purse and shop (`SHOP_PURCHASE`, `DROP_COLLECT`, `sporeBalance` in `INVENTORY_SYNC`). Transport is WebSocket + JSON at 20 Hz. Server-authoritative state with client-side camera.
**Source of truth:** DESIGN.md Part 13.8.

---

## Framing

**WebSocket + JSON** — T03P chose WebSocket over raw UDP/TCP for:
- Browser compatibility (no raw sockets)
- Built-in framing, compression, reconnection
- Works through proxies/CDNs

Message format:
```json
{
  "type": <number>,
  "payload": <object>
}
```

## Protocol Version

`PROTOCOL_VERSION = 5` — bumped on any breaking wire change. v2 adds
`MUTATION_STATE` (35) and `MUTATION_SHED` (36); v3 adds `MUTATION_LEVEL` (45) and
carries each mutation's level, level cost and any open card deal in
`MUTATION_STATE`; v4 adds `SHOP_PURCHASE` (46), `DROP_COLLECT` (47) and the
server-owned `sporeBalance` in `INVENTORY_SYNC`; v5 adds `LEDGER_ENTRY` (48), one
line per purse change, and `RESPAWN` (49), a client request for a fresh seed on
the socket it already holds. `RESPAWN` needs no version bump of its own: an older
client simply never sends it.
Client sends `HELLO { clientVersion: 5, accessToken?: string, plantId?: string, displayName?: string }` on connect.
Server rejects with `ERROR { code: "VERSION_MISMATCH", ... }` if mismatch.

## Message Types

### Client → Server

| Type | Name | Payload | Description |
|------|------|---------|-------------|
| 1 | `HELLO` | `{ clientVersion: number, accessToken?: string, plantId?: string, reconnectToken?: string, displayName?: string }` | First message after connect; version handshake, optional auth for reclaim, and the menu nickname. `displayName` is sanitized and capped by `ui.display_name_max_length`; a malformed or absent value leaves the player as `Player` |
| 2 | `INPUT` | `{ input: PlayerInput }` | Player camera/input for a tick |
| 3 | `PING` | `{}` | Keepalive / latency measurement |
| 4 | `GROWTH_INTENT` | `{ intent: GrowthIntent }` where `GrowthIntent = { plantId: string, nodeId: string, direction: {x,y,z}, nodeType: string, tick: number, growthMode?: 'apical' \| 'lateral', attachFraction?: number }` | Request to grow a node. Wrapped in `intent` like `INPUT` wraps its input; `attachFraction` (0.05–1) overrides where the new part leaves its parent; there is no `isAttack` field — the root attack was removed and the schema never had one. Source of truth: `packages/shared/src/growth/types.ts` |
| 5 | `RESOURCE_QUERY` | `{ worldX?: number, worldZ?: number, tileX?: number, tileZ?: number }` | Query local resource tile |
| 6 | `PLANT_SYNC_REQUEST` | `{}` | Request the full graph of the sender's own plant. Empty payload: the server reads the plant from the connection, so there is no id to get wrong |
| 7 | `GROWTH_OPTIONS_REQUEST` | `{ plantId: string, nodeId: string }` | Ask the server for the legal growth options at a node (ADR-028) |
| 8 | `DEV_ACTION` | `{ type: string, ... }` | Dev-panel action; dev builds only (`?dev=1`) |
| 9 | `CHAT_MESSAGE` | `{ message: string, mode?: 'world' \| 'proximity' }` | Chat line, or `/emote <id>` (T05) |
| 24 | `INVENTORY_REQUEST` | `{}` | Request a full inventory sync |
| 25 | `INVENTORY_SLOT_USE` | `{ slotIndex: number }` | Use the item in a slot |
| 26 | `INVENTORY_SLOT_SWAP` | `{ fromIndex: number, toIndex: number }` | Swap two inventory slots |
| 29 | `REPORT` | `ReportPayload` | File a player/message report (rate-limited, T05) |
| 30 | `BLOCK` | `{ targetPlayerId: string, blocked: boolean }` | Mute or unmute a player's chat (T05) |
| 32 | `TERRAIN_REGION_REQUEST` | `{ worldX: number, worldZ: number, radiusM: number, revision?: number }` | Ask for sparse soil chunks around a point; radius is capped at 120 m (T25) |
| 36 | `MUTATION_SHED` | `{ plantId: string, mutationId: string }` | Client asks to shed one mutation; the server refuses during cooldown (T04) |
| 37 | `REROOT_INTENT` | `{ dirX: number, dirZ: number }` | Steer an uprooted plant's crawl in world XZ; zero stops it. Ignored unless the plant is uprooted (T06) |
| 45 | `MUTATION_LEVEL` | `{ plantId: string, mutationId: string, cardId?: string }` | Client raises a held mutation. Without `cardId` the server deals that mutation's cards; with one it takes that card, spends the stored resources and applies the level. A card the server did not deal is refused (T04) |
| 46 | `SHOP_PURCHASE` | `{ itemId: string }` | Client asks to buy one shop item with spores. The price, the balance check and the inventory grant are the server's; the client only names the item. The reply is `INVENTORY_SYNC` (with the new balance) or `REJECT` |
| 49 | `RESPAWN` | `{}` | Ask for a fresh seed after the plant died, without reconnecting. The server refuses while the player still owns a live plant (`REJECT { reason: 'plant_alive' }`) and otherwise creates one at a free spawn, registers the socket at it, broadcasts `PLANT_CREATED` to nearby players and answers with a normal `WELCOME` |
| 47 | `DROP_COLLECT` | `{ id: string }` | Client asks to pick up a drop it was shown. The server owns the drop, its expiry and the reward: dung and fragments pay spores, the drop is removed, and `DROP_EXPIRED` tells every client that holds it. An id the server does not know is ignored, so a stale marker cannot mint a reward |

### Server → Client

| Type | Name | Payload | Description |
|------|------|---------|-------------|
| 10 | `WELCOME` | `WelcomePayload` | Sent once on connect; assigns playerId, plantId, initial world state, full node set. Optional `away` block (deltas over the offline span: `seconds`, `nodesBefore`, `nodesAfter`, `biomass`, `energy`, `water`, `minerals`) and `previousPlantDied` (`{ cause, secondsAgo }`) |
| 11 | `STATE` | `StatePayload` | Plant state, sent per player at `client_send_rate_hz` and filtered to the player's interest cells (the owner's own plant is always included) |
| 12 | `KEYFRAME` | `KeyframePayload` | Full state snapshot (every `keyframeIntervalTicks`); ignores the state cadence gate so a late joiner or reconnect always gets a full snapshot |
| 13 | `REJECT` | `RejectPayload` | Input rejected; reason + original type |
| 14 | `PONG` | `{}` | Response to `PING` |
| 15 | `ERROR` | `ErrorPayload` | Fatal error; the connection closes. Codes include `VERSION_MISMATCH`, `AUTH_FAILED` (bad or expired token; no guest fallback) and `SESSION_REPLACED` (same account opened in another tab) |
| 16 | `GROWTH_EVENT` | `GrowthEventPayload` | Broadcast when a growth intent succeeds |
| 17 | `RESOURCE_UPDATE` | `ResourceUpdatePayload` | Local resource tile update (player's tile only) |
| 18 | `PLANT_SYNC` | `PlantSyncPayload` | Full plant state for reclaim/desync recovery |
| 19 | `PLANT_CREATED` | `PlantCreatedPayload` | A new plant in the world: `{ plant: { id, ownerId, ownerName, rootNodeId, totalBiomass, totalEnergy, totalUpkeep, appearance?, pigment?, nodes } }`. `appearance` and `pigment` let a rival draw its own petals, leaf scale and mutation colours; `nodes` is the list `nodeWireFields` builds. The runtime payload also carries `ownerName`, which `PlantSyncPayload` types and `PlantCreatedPayload` does not (E22) |
| 20 | `PLANT_REMOVED` | `{ plantId: string, cause?: string, source?: string, biomass?: number, nodeCount?: number }` | Plant removed (death, reconnect expiry or administrative removal). `cause` and `source` are optional so an older server's removal still validates; the client uses them to name the loss. `biomass` and `nodeCount` come from the death record rather than the client's last mirror packet, so the death card reports what actually died |
| 21 | `WEATHER_UPDATE` | `WeatherUpdatePayload` | Weather/day-night state, including the world clock's `timePaused`/`timeScale` so every client and dev panel shows the server's clock mode |
| 22 | `GROWTH_OPTIONS_RESULT` | `GrowthOptionsResultPayload` | Legal options, costs and plain reasons for a node |
| 23 | `CHAT_BROADCAST` | `ChatBroadcastPayload` | Chat or emote from another player |
| 27 | `INVENTORY_SYNC` | `{ slots: Array<{ itemId: string \| null, count: number \| null }>, maxSlots: number, definitions: Array<{ id, name, description, category, stackLimit, use }>, sporeBalance: number }` | Full inventory plus the definitions behind it, and the player's spore balance. The panel's name, prose, "Use:" line and the purse are the server's own text and numbers, never invented by the client |
| 28 | `INVENTORY_SLOT_UPDATE` | `{ slotIndex: number, itemId: string \| null, count: number \| null }` | One slot changed |
| 31 | `SEASON_UPDATE` | `{ season: number, remainingSeconds: number, lengthTicks: number, calamity: boolean }` | Current season, seconds left before the rollover, and whether the next rollover is the calamity. Sent on join, on every rollover and when the calamity runs; the client counts down locally |
| 33 | `TERRAIN_REGION` | `{ originX, originZ, cellSizeM, cols, rows, revision, heightsBase64, materialBase64 }` | Height deltas (Float32) and moisture (Uint8) for the requested region (T25) |
| 34 | `TERRAIN_EDITS` | `{ revision: number, edits: TerrainEdit[] }` | Root tunnels/voids since the client's revision; also broadcast near a new root (T25) |
| 35 | `MUTATION_STATE` | `MutationStatePayload` | The plant's mutation set with upkeep, level/cost per mutation, the adaptive-pressure readout, the shed cooldown and any open level-up card deal. Sent on join and after every growth, shed or level (T04) |
| 38 | `PLANT_DAMAGE` | `PlantDamagePayload` | A plant lost tissue, including any parts destroyed and the structural damage left against the uproot threshold (T06, C04). Four sources come from the damage pipeline — `weather`, `tool`, `herbivore`, `terrain`. A fifth, `starvation`, comes from the upkeep path (`plantWorld.drainShedDamage` → `tick/shedDamage.ts`): it names no node (`nodeId: null`, empty `destroyedNodeIds`), carries the plant's loss summed since the last flush, and is sent twice a second rather than every tick so a wilting plant does not pulse the damage cue at 20 Hz. `starvation` is a member of the shared `DamageSource` union and the client's damage cue names it "its own upkeep" (E18) |
| 39 | `PLANT_UPROOT` | `PlantUprootPayload` | Uproot phase, root position, lean and the reroot window left. Phase `rooted` announces a successful reroot (T06) |
| 40 | `DROP_SPAWN` | `DropSpawnPayload` | A fragment, remains pile or dung appeared in the world with its expiry time (T06) |
| 41 | `DROP_EXPIRED` | `{ id: string }` | A drop decayed and should be removed (T06) |
| 42 | `FAUNA_EVENT` | `FaunaEventPayload` | A scripted herbivore swarm started browsing or moved on. Swarms are events, not pathfinding agents (T06) |
| 43 | `KILL_CREDIT` | `KillCreditPayload` | Who is credited for a plant's death: the player or plant with the most damage inside `kill_credit_window_s` (T06) |
| 44 | `WEATHER_STRIKE` | `{ tick: number, x: number, z: number, radiusM: number }` | One lightning bolt: where it landed and the radius it damages. The server owns the timing, so the sky flash and the damage are the same strike |
| 48 | `LEDGER_ENTRY` | `{ kind: 'purchase' \| 'use' \| 'award' \| 'drop', label: string, itemId: string \| null, count: number, amount: number, balance: number }` | Why the purse moved: the reason, what moved, the spores spent or earned, and the balance the database committed. Sent once per change alongside `INVENTORY_SYNC`, so the inventory panel can explain a balance instead of showing a number that jumped. `label` is player-facing text from the server's own item table, never an id |
| 99 | `DEV_RESPONSE` | `{ ... }` | Dev-panel response (dev builds only) |

Type `10` is `WELCOME`: `REPORT` was moved to `29` after it collided with the
`WELCOME` schema and every report was silently dropped. The authoritative list
is `MESSAGE_TYPE` in `apps/server/src/ops/net.ts`; the client keeps its own copy
(INV-NET-16). Payloads are validated against
`packages/shared/src/protocol/messageSchemas.ts` at both boundaries.

## Quantization

**The wire is unquantized.** Every position and angle is sent as a full JSON
number. There is no fixed-point path and no precision to budget against.

This section used to carry a precision table (1/64 unit, 16-bit rotation) that
nothing implemented: `quantizePosition`/`quantizeAngle` in `ops/net.ts` and a
second hardcoded pair in `packages/shared/src/math` had no production caller,
while `config/net_proto.json` carried two keys that were read into
`NetProtoConfig` and never used (E24). A client author budgeting bandwidth
against a table the server does not apply is worse than no table, so the helpers
and the two keys are gone and the page says what is true.

Quantizing is a real option if bandwidth ever justifies it, and the shape is
already known — 1/64 m is ~1.6 cm, well under the smallest node radius, and 16
bits of angle is ~0.0055°. It is a wire change (a client and server must agree on
the scale before either sends a number), so it belongs with a protocol version
bump and a measured pressure to make it, not with a table describing intent.

## Tick Rate

- **Server tick rate:** 20 Hz (50 ms/tick) — configurable via `net_proto.tick_rate_hz`
- **Client send rate:** 20 Hz — client sends `INPUT` at most once per tick
- **Keyframe interval:** 10 ticks (0.5 s) — full state sync

## Camera Pan (Client-Side)

The client handles camera panning locally using WASD/arrow keys. `INPUT` frames
are accepted; the only thing the server does with them is advance
`lastInputTick` (ack-only heartbeat), because there is no server-side avatar
position. `validateMovement` - which checked velocity and world bounds but had
**no call sites** - was deleted, so `docs` and code agree that movement is not
server-validated. `REJECT` is used for growth intents, not for movement. Plant
growth bounds are enforced separately inside `PlantWorld`.

## Payload Schemas

Shapes as they go over the wire. The authoritative definitions are
`apps/server/src/ops/net.ts` (messages), `apps/server/src/tick/stateBroadcast.ts`
(the per-plant snapshot), `packages/weather/src/weatherStateMachine.ts` (weather)
and `packages/shared/src/growth/types.ts` (growth). Where a type there lags what
the sender writes, this page follows the sender and says so.

```ts
interface PlayerInput {
  moveForward: boolean;
  moveBackward: boolean;
  moveLeft: boolean;
  moveRight: boolean;
  tick: number;        // client's local tick counter
}

interface WelcomePayload {
  playerId: string;    // "player_<timestamp>_<random>"
  plantId: string;     // "plant_<playerId>" (or the reclaimed plantId)
  reconnectToken: string;  // authorises reclaiming this plant after a disconnect
  tick: number;        // server tick at join
  rootNode: { id: string; x: number; y: number; z: number; type: string; biomass: number };
  totalBiomass: number;
  totalEnergy: number;
  nodes?: Array<{
    id: string;
    plantId: string;
    type: string;
    layer: string;
    x: number;
    y: number;
    z: number;
    biomass: number;
    /** 0..1 tissue health against this part's own quota; shrinks its radius. */
    health?: number;
    age: number;
    parentId: string | null;
    children: string[];
    statModifiers: Record<string, number>;
    resourceDrawWater: number;
    resourceDrawNutrients: number;
    upkeepBiomassPerSecond: number;
    growthDirectionBias: string;
    lastGrowthTick: number;
    growthProgress: number;
    isSeed: boolean;
    mutationFlags?: number;
    targetX?: number; targetY?: number; targetZ?: number;
    parentAttachX?: number; parentAttachY?: number; parentAttachZ?: number;
    attachFraction?: number;
  }>;
  /** After-minus-before over the offline span, on a reconnect or reclaim. */
  away?: {
    seconds: number;
    nodesBefore: number;
    nodesAfter: number;
    biomass: number;
    energy: number;
    water: number;
    minerals: number;
  };
  /** The player's previous plant died while they were away and this is the seed. */
  previousPlantDied?: { cause: string; source?: string; secondsAgo: number };
}

interface PlantStateSnapshot {
  id: string;
  totalBiomass: number;
  totalEnergy: number;
  totalUpkeep: number;
  /** Damage taken and the ceiling that tears the plant free (C04 HUD). */
  structure?: { damageHp: number; threshold: number };
}

// STATE and KEYFRAME carry the same per-plant list; KEYFRAME ignores the
// cadence gate so a late joiner or a reconnect always gets a full snapshot.
interface StatePayload {
  tick: number;
  plants: PlantStateSnapshot[];
  worldBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  tileSize: number;
}

interface RejectPayload {
  reason: string;
  originalType: number;
}

interface ErrorPayload {
  code: string;
  message: string;
}

interface GrowthEventPayload {
  plantId: string;
  /** Normal single-node growth. */
  newNode?: GrowthEventNode;
  /** Multi-node germination (radicle + cotyledons). */
  newNodes?: GrowthEventNode[];
  /** Replaced node (germination: the seed becomes the root). */
  updatedParentNode?: GrowthEventNode;
  totalBiomass?: number;
  totalEnergy?: number;
  growthSeq?: number;
}

interface ResourceUpdatePayload {
  tick: number;
  /** One queried tile, or the whole grid when `fullGrid` is set. */
  tiles?: Array<{
    tileX?: number;
    tileZ?: number;
    light: number;
    moisture: number;
    minerals: number;
  }>;
  /** The whole grid in one base64 block, sent on the first answer. */
  gridBase64?: string;
  fullGrid?: boolean;
  width: number;
  height: number;
  tileSize: number;
  totalEnergy: number;
  totalBiomass: number;
  storedWater: number;
  storedMinerals: number;
  waterCapacity: number;
  mineralCapacity: number;
  /** Tiles whose tile overlaps one of the plant's roots (`coveredTileCount`). */
  coveredTileCount: number;
}

interface PlantSyncPayload {
  plants: Array<{
    id: string;
    ownerId: string;
    /** The owner's display name, when they are here to have one. */
    ownerName?: string;
    rootNodeId: string | null;
    totalBiomass: number;
    totalEnergy: number;
    totalUpkeep: number;
    /** T04 look parameters, so a rival draws its own petals and scales. */
    appearance?: { petalCount: number; leafScale: number; seedScale: number };
    /** Dominant mutation's pigment, so a rival draws its own colours. */
    pigment?: {
      visualSignature: number;
      visualParams: [number, number, number];
      visualTarget: 'foliage' | 'woody' | 'seed' | 'bloom' | 'whole' | 'bark';
    };
    /** Display names of the mutations this plant expresses. */
    mutations: string[];
    nodes: Array<{ /* the node shape WELCOME uses */ }>;
  }>;
}

/** The weather system's broadcast, with `tick` added by the server; the return
 *  type of `weatherStateMachineGetBroadcast` in `packages/weather`. */
interface WeatherUpdatePayload {
  tick: number;
  /** 1-based in-game day; the world starts at 06:00 and a day is one real hour. */
  dayNumber: number;
  timeOfDay: number;      // 0 = midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset
  timePaused: boolean;
  timeScale: number;
  isDay: boolean;
  sunIntensity: number;
  lightMultiplier: number;
  weatherState: 'clear' | 'rain' | 'snow' | 'thunderstorm_telegraph' | 'thunderstorm_active' | 'thunderstorm_aftermath';
  /** Icon token from the authored condition table, never `weatherState` itself. */
  conditionToken: string;
  stateTimeRemainingS: number;
  forecast: { nextWeatherState: string; timeUntilNextStateS: number };
}

interface GrowthOptionsResult {
  nodeId: string;
  nodeType: string;
  isSeed: boolean;
  energy: number;
  biomass: number;
  options: Array<{
    type: string;
    label: string;
    energyCost: number;
    biomassGain: number;
    expectedSeconds: number;
    available: boolean;
    reason?: string;
    risk?: string;
    waterCost?: number;
    nutrientCost?: number;
    mineralCost?: number;
  }>;
  conditions?: {
    light: number;
    moisture: number;
    minLight: number;
    minMoisture: number;
    ok: boolean;
  };
  /** Set on a refusal (`plant_mismatch`, `node_not_found`); not on success. */
  error?: string;
}

/** Built inline in `deliverChat`; the sender receives their own message too. */
interface ChatBroadcastPayload {
  playerId: string;
  playerName: string;
  message?: string;
  emoteId?: string;
  type?: 'emote';
  timestamp: number;
  /** Sender's plant position, so proximity can be drawn without a second lookup. */
  x?: number;
  z?: number;
}

interface ReportPayload {
  targetPlayerId: string;
  targetPlayerName?: string;
  reason: string;
  freeText?: string;
  block?: boolean;
  contextSnapshot?: Array<{ playerName: string; message: string; timestamp: number }>;
  timestamp: number;
}
```

## Connection Flow

```
Client                          Server
  |                               |
  |--- WebSocket connect ------->|
  |                               |
  |--- HELLO {version:1, accessToken?, plantId?} -->|
  |                               | verify token, reclaim or create plant
  |<-- WELCOME ------------------| (full node set for own plant)
  |                               |
  |--- INPUT {tick:1} ---------->| (camera pan, client-side)
  |                               |
  |<-- STATE {tick:1} -----------| (plant updates)
  |                               |
  |--- GROWTH_INTENT {tick:2} -->|
  |                               | validate: energy, genes, bounds, direction
  |<-- GROWTH_EVENT -------------| (new node(s), updated parent, totals)
  |                               |
  |--- RESOURCE_QUERY ---------->|
  |<-- RESOURCE_UPDATE ----------| (local tile with tileX/tileZ)
  |                               |
  |--- PING --------------------->|
  |<-- PONG ----------------------|
  |                               |
  |<-- WEATHER_UPDATE -----------| (at `weather_send_rate_hz`, default 2 Hz — not every tick)
  |                               |
  |--- PLANT_SYNC_REQUEST ------>| (on desync / tab visible)
  |<-- PLANT_SYNC ---------------| (full plant state)
```

## Connection Health and Abuse Limits

The inbound, payload and backlog checks are per **socket** and run before the
message type is even read. Admission is per **address**, and the reply, action
and block limits are per **player**. The type-specific limits above (chat,
reports, growth intents) sit behind them, so a connection cannot spend its way
around a rate limit by sending messages that are malformed or unknown.

| Limit | Key | Where | What happens when it fires |
|---|---|---|---|
| Inbound budget | `message_burst` 240, refilled at `max_messages_per_second` | `ops/rateLimiter.ts`, one bucket per socket | The message is dropped and counted; the first drop and every 100th log `inbound message rate limit reached`. Nothing else is told, so a flooding client cannot use the refusal as a probe. |
| Per-address admission | `max_connections_per_ip` 32 | `main.ts`, before HELLO | The socket receives `ERROR { code: "SERVER_FULL", message: "Too many connections from this address. Try again later." }`, then closes with code `1013` and `Too many connections from this address`. Origin-rejected sockets are not counted. Closing an admitted socket releases its slot, so a fresh connection is admitted afterward. A trusted proxy must set `ops.trust_proxy` for `X-Forwarded-For` to be read. |
| World capacity | `world.max_players_per_world` 10000 | `World.addPlayer` | A new player gets `ERROR { code: "SERVER_FULL" }` and close `1013`; a reconnect that reclaims within the window is still admitted. Closing a player releases one capacity slot, so a fresh HELLO is admitted afterward. |
| Expensive replies | `full_grid_min_interval_ms` 5000, `plant_sync_min_interval_ms` 2000, `terrain_region_min_interval_ms` 2000 | `ops/replyBudget.ts` + `main.ts`, one budget per player | The request is dropped without a reply. These are tiny requests with 30 KB-262 KB answers, so silence is cheaper than an error probe. |
| State-change budget | `action_rate_per_second` 4, `action_burst` 8 | `ops/rateLimiter.ts`, one bucket per player | `SHOP_PURCHASE`, `INVENTORY_SLOT_USE`, `INVENTORY_SLOT_SWAP`, `DROP_COLLECT`, `MUTATION_SHED` and `MUTATION_LEVEL` answer `action_rate_limit` before touching the store. |
| Block list | `chat.block_list_max` 512 | `ops/blockList.ts` | A new unique id at the cap is ignored and `BLOCK` answers `block_list_full`; re-blocking an existing id is idempotent. `REPORT { block: true }` records `block: false` when the cap refuses the add. |
| Payload size | `max_message_size_bytes` 16384 | the WebSocket server's `maxPayload` | The socket is closed by `ws`, before any handler sees the frame. |
| Socket backlog | `max_buffered_bytes` 4194304 | `writeIfHealthy` in `main.ts` | The send is **refused, not queued**, and counted separately from sends made. |
| HELLO deadline | `hello_timeout_ms` 5000 | `ops/connectionRegistry.ts` | The connection is closed; a socket that connects and says nothing never becomes a player. |
| Liveness | — | `ops/socketHeartbeat.ts`, swept every 25 s | Each sweep terminates the sockets that missed the previous ping and pings the rest, so a dead peer is noticed within two intervals (≤50 s) and logged as `terminating unresponsive socket`. |

Every limit in this table is backed by config. The heartbeat and HELLO deadline
are read from `socket_heartbeat_ms` and `hello_timeout_ms`; the world cap lives
in `config/world.json` and the block cap in `config/chat.json`.

Two of these exist because the failure they prevent was invisible:

- **The bucket, not a per-type cap.** Every existing limit was per message
  *type*, which left a connection free to send any number of malformed or
  unknown messages per second, bounded only by the payload cap — the cheapest
  way to burn the tick budget from one socket.
- **The heartbeat.** A tab that dies without closing its socket (a crash, a
  killed process, a closed lid) stays in `wss.clients` and keeps being broadcast
  to. Nothing notices: the peer stops reading, the kernel stops acknowledging,
  `bufferedAmount` grows, and every send to it is refused forever. The dev log
  that motivated the sweep showed a 4.4 MB backlog at the 4 MB ceiling and
  ~30,000 skipped sends per tick.

The reconnect window has **two config names**, and only one is live:
`net_proto.reconnect_window_ms` (300000) is read by the reconnect state machine;
`world.reconnect_window_min` (5) is a second spelling no code reads. See
`docs/tunables.md` "One key name, two files".

## Reconnection & Reclaim

- **Authenticated:** Client sends `HELLO { accessToken }`. Server verifies JWT, finds `accountId`, reclaims plant by `accountId` if within reconnect window (5 min, config `reconnect_window_min`). Reconnect key: `accountId`.
- **Anonymous:** Client sends `HELLO { plantId }` (stored locally). Server reclaims by `anon_<plantId>`. Reconnect key: `anon_<plantId>`.
- Plant is **not removed** until reconnect window expires. `PLANT_REMOVED` only fires on window expiry or actual death.
- On reclaim: `WELCOME` includes full node set. Client applies it as its own plant.

## Config (`config/net_proto.json`)

All tunables in extended-1 format:

| Key | Type | Default | Range |
|-----|------|---------|-------|
| `protocol_version` | integer | 5 | [1, 255] |
| `max_message_size_bytes` | integer | 16384 | [1024, 1048576] |
| `max_buffered_bytes` | integer | 4194304 | [65536, 67108864] |
| `max_messages_per_second` | integer | 120 | [1, 1000] |
| `message_burst` | integer | 240 | [1, 5000] |
| `max_connections_per_ip` | integer | 32 | [1, 256] |
| `full_grid_min_interval_ms` | integer | 5000 | [500, 60000] |
| `plant_sync_min_interval_ms` | integer | 2000 | [250, 60000] |
| `terrain_region_min_interval_ms` | integer | 2000 | [250, 60000] |
| `action_rate_per_second` | integer | 4 | [1, 30] |
| `action_burst` | integer | 8 | [1, 60] |
| `tick_rate_hz` | integer | 20 | [10, 60] |
| `keyframe_interval_ticks` | integer | 10 | [1, 60] |
| `world_bounds` | object | ±1000 | — |
| `client_send_rate_hz` | integer | 20 | [5, 60] |
| `weather_send_rate_hz` | integer | 2 | [1, 20] |
| `hello_timeout_ms` | integer | 5000 | [1000, 30000] |
| `socket_heartbeat_ms` | integer | 25000 | [1000, 120000] |
| `reconnect_window_ms` | integer | 300000 | [30000, 86400000] |

Every key in the file is listed; a table that lists a *subset* of a file has to
say so in its heading (docs-check rule 2e), because the subset that goes missing
is never the uninteresting one — the five absent here were the abuse limits.

## Acceptance (T03P + T03)

- [x] Two browser tabs connect to same server
- [x] Each tab gets unique plant with unique plantId
- [x] WASD/Arrow keys pan camera (client-side)
- [x] Click on plant nodes to select for growth
- [x] Server validates growth intents (energy, biomass, gene gates, bounds)
- [x] Server broadcasts `GROWTH_EVENT` on successful growth
- [x] `KEYFRAME` every 10 ticks, `STATE` otherwise (plant updates), both rate-gated by `client_send_rate_hz` and interest-filtered per player (`broadcastCadence.ts`, `tick/stateBroadcast.ts`)
- [x] `RESOURCE_QUERY` / `RESOURCE_UPDATE` with coordinate addressing (ADR-024)
- [x] Authenticated + anonymous reclaim via HELLO (ADR-021)
- [x] `PLANT_SYNC` / `PLANT_SYNC_REQUEST` for desync recovery
- [x] Reconnect window (5 min) with delayed `PLANT_REMOVED` (ADR-021)
- [x] `GROWTH_OPTIONS_REQUEST` / `GROWTH_OPTIONS_RESULT` documented (ADR-028)
- [x] T05 chat, block and report messages documented
- [x] Inventory sync/use/swap messages documented
- [x] Protocol documented here

---

**Not built:** binary framing and delta compression. T03 delivered the message set,
interest management, the tick loop and persistence, but the wire is still JSON in
both directions — `packages/shared/src/protocol/` has the version constant and the
message map and no encoder, and every send is `JSON.stringify`. `world_plants`
stores a binary `snapshot` column, which is storage, not transport. Client
prediction is C01 work and is also absent: movement is client-authoritative and
ack-only (T03P).