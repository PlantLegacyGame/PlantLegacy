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
line per purse change.
Client sends `HELLO { clientVersion: 5, accessToken?: string, plantId?: string, displayName?: string }` on connect.
Server rejects with `ERROR { code: "VERSION_MISMATCH", ... }` if mismatch.

## Message Types

### Client → Server

| Type | Name | Payload | Description |
|------|------|---------|-------------|
| 1 | `HELLO` | `{ clientVersion: number, accessToken?: string, plantId?: string, reconnectToken?: string, displayName?: string }` | First message after connect; version handshake, optional auth for reclaim, and the menu nickname. `displayName` is sanitized and capped by `ui.display_name_max_length`; a malformed or absent value leaves the player as `Player` |
| 2 | `INPUT` | `{ input: PlayerInput }` | Player camera/input for a tick |
| 3 | `PING` | `{}` | Keepalive / latency measurement |
| 4 | `GROWTH_INTENT` | `{ plantId: string, nodeId: string, direction: {x,y,z}, nodeType: string, isAttack: boolean, tick: number }` | Request to grow a node |
| 5 | `RESOURCE_QUERY` | `{ worldX?: number, worldZ?: number, tileX?: number, tileZ?: number }` | Query local resource tile |
| 6 | `PLANT_SYNC_REQUEST` | `{ plantId: string }` | Request full plant sync |
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
| 19 | `PLANT_CREATED` | `{ plantId: string, ownerId: string, rootNode: ... }` | New plant in world |
| 20 | `PLANT_REMOVED` | `{ plantId: string, cause?: string }` | Plant removed (death, reconnect expiry or administrative removal). `cause` is optional so an older server's removal still validates; the client uses it to name the loss |
| 21 | `WEATHER_UPDATE` | `WeatherUpdatePayload` | Weather/day-night state, including the world clock's `timePaused`/`timeScale` so every client and dev panel shows the server's clock mode |
| 22 | `GROWTH_OPTIONS_RESULT` | `GrowthOptionsResultPayload` | Legal options, costs and plain reasons for a node |
| 23 | `CHAT_BROADCAST` | `ChatBroadcastPayload` | Chat or emote from another player |
| 27 | `INVENTORY_SYNC` | `{ slots: Array<{ itemId: string \| null, count: number \| null }>, maxSlots: number, definitions: Array<{ id, name, description, category, stackLimit, use }>, sporeBalance: number }` | Full inventory plus the definitions behind it, and the player's spore balance. The panel's name, prose, "Use:" line and the purse are the server's own text and numbers, never invented by the client |
| 28 | `INVENTORY_SLOT_UPDATE` | `{ slotIndex: number, itemId: string \| null, count: number \| null }` | One slot changed |
| 31 | `SEASON_UPDATE` | `{ season: number, remainingSeconds: number, lengthTicks: number, calamity: boolean }` | Current season, seconds left before the rollover, and whether the next rollover is the calamity. Sent on join, on every rollover and when the calamity runs; the client counts down locally |
| 33 | `TERRAIN_REGION` | `{ originX, originZ, cellSizeM, cols, rows, revision, heightsBase64, materialBase64 }` | Height deltas (Float32) and moisture (Uint8) for the requested region (T25) |
| 34 | `TERRAIN_EDITS` | `{ revision: number, edits: TerrainEdit[] }` | Root tunnels/voids since the client's revision; also broadcast near a new root (T25) |
| 35 | `MUTATION_STATE` | `MutationStatePayload` | The plant's mutation set with upkeep, level/cost per mutation, the adaptive-pressure readout, the shed cooldown and any open level-up card deal. Sent on join and after every growth, shed or level (T04) |
| 38 | `PLANT_DAMAGE` | `PlantDamagePayload` | A plant lost tissue to weather, a tool, a herbivore swarm or a collapse, including any parts destroyed and the structural damage left against the uproot threshold (T06, C04) |
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

| Value | Quantization | Precision |
|-------|--------------|-----------|
| Position (x, z) | 1/64 unit | ~0.0156 units |
| Rotation | 16 bits | ~0.000096 rad (~0.0055°) |

Applied server-side before broadcast. Client receives already-quantized values.

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
  plantId: string;     // "plant_<playerId>" (or reclaimed plantId)
  tick: number;        // server tick at join
  nodes: Array<{
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
  }>;
  totalBiomass: number;
  totalEnergy: number;
  storedWater: number;
  storedMinerals: number;
  rootNodeId: string | null;
  growthCooldownUntil: number;
  tier: 'active' | 'near' | 'dormant';
}

interface StatePayload {
  tick: number;
  plants: Array<{
    id: string;
    totalBiomass: number;
    totalEnergy: number;
    totalUpkeep: number;
    /** Damage taken and the ceiling that tears the plant free (C04 HUD). */
    structure?: { damageHp: number; threshold: number };
  }>;
}

interface KeyframePayload {
  tick: number;
  plants: Array<{
    id: string;
    totalBiomass: number;
    totalEnergy: number;
    totalUpkeep: number;
    structure?: { damageHp: number; threshold: number };
  }>;
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
  newNode?: { ... };          // single node (regular growth)
  newNodes?: Array<{ ... }>;  // multiple nodes (germination)
  updatedParentNode?: { ... }; // parent with updated children/biomass
  totalBiomass: number;
  totalEnergy: number;
  reason?: string;
  plantDied?: boolean;
}

// Two shapes share this message type:
//  - the dirty-tile broadcast: `tiles` only, each entry carrying tileX/tileZ
//  - the per-tick payload for the player's own tile: `tiles[0]` plus the plant
//    totals and root-tile count below (ADR-024)
interface ResourceUpdatePayload {
  tick: number;
  tiles: Array<{
    tileX: number;
    tileZ: number;
    light: number;
    moisture: number;
    minerals: number;
  }>;
  width: number;
  height: number;
  tileSize: number;
  totalEnergy: number;
  totalBiomass: number;
  storedWater: number;
  storedMinerals: number;
  rootTileCount: number;
}

interface PlantSyncPayload {
  plantId: string;
  ownerId: string;
  nodes: Array<{ ... }>;
  totalBiomass: number;
  totalEnergy: number;
  totalUpkeep: number;
  storedWater: number;
  storedMinerals: number;
  rootNodeId: string | null;
  growthCooldownUntil: number;
  tier: 'active' | 'near' | 'dormant';
}

interface WeatherUpdatePayload {
  tick: number;
  /** 1-based in-game day; one day is one real hour by default. */
  dayNumber: number;
  isDay: boolean;
  weatherState: 'clear' | 'rain' | 'thunderstorm_telegraph' | 'thunderstorm_active' | 'thunderstorm_aftermath';
  timeOfDay: number;        // 0–1
  sunElevation: number;     // radians
  sunIntensity: number;     // directional light intensity
  ambientIntensity: number;
  lightMultiplier: number;
  moistureDepositRate: number;
}

interface GrowthOptionsResultPayload {
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
  }>;
  conditions?: {
    light: number;
    moisture: number;
    minLight: number;
    minMoisture: number;
    ok: boolean;
  };
  error?: string;
}

interface ChatBroadcastPayload {
  playerId: string;
  playerName: string;
  message?: string;
  emoteId?: string;
  type?: 'emote';
  timestamp: number;
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

## Reconnection & Reclaim

- **Authenticated:** Client sends `HELLO { accessToken }`. Server verifies JWT, finds `accountId`, reclaims plant by `accountId` if within reconnect window (5 min, config `reconnect_window_min`). Reconnect key: `accountId`.
- **Anonymous:** Client sends `HELLO { plantId }` (stored locally). Server reclaims by `anon_<plantId>`. Reconnect key: `anon_<plantId>`.
- Plant is **not removed** until reconnect window expires. `PLANT_REMOVED` only fires on window expiry or actual death.
- On reclaim: `WELCOME` includes full node set. Client applies it as its own plant.

## Config (`config/net_proto.json`)

All tunables in extended-1 format:

| Key | Type | Default | Range |
|-----|------|---------|-------|
| `protocol_version` | integer | 3 | [1, 255] |
| `max_message_size_bytes` | integer | 16384 | [1024, 1048576] |
| `tick_rate_hz` | integer | 20 | [10, 60] |
| `position_quantization` | integer | 64 | [16, 256] |
| `angle_quantization_bits` | integer | 16 | [8, 32] |
| `keyframe_interval_ticks` | integer | 10 | [1, 60] |
| `world_bounds` | object | ±1000 | — |
| `client_send_rate_hz` | integer | 20 | [5, 60] |
| `weather_send_rate_hz` | integer | 2 | [1, 20] |

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

**Next:** T03 implements binary framing, delta compression, and client prediction (C01).