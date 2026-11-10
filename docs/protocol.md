# Protocol

**Status:** implemented by T03P (Gate 0) and T03 (full protocol with persistence, offline tiers, interest management, event bus). Transport is WebSocket + JSON at 20 Hz. Server-authoritative state with client-side camera.
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

`PROTOCOL_VERSION = 1` — bumped on any breaking wire change.
Client sends `HELLO { clientVersion: 1, accessToken?: string, plantId?: string }` on connect.
Server rejects with `ERROR { code: "VERSION_MISMATCH", ... }` if mismatch.

## Message Types

### Client → Server

| Type | Name | Payload | Description |
|------|------|---------|-------------|
| 1 | `HELLO` | `{ clientVersion: number, accessToken?: string, plantId?: string }` | First message after connect; version handshake + optional auth for reclaim |
| 2 | `INPUT` | `{ input: PlayerInput }` | Player camera/input for a tick |
| 3 | `PING` | `{}` | Keepalive / latency measurement |
| 4 | `GROWTH_INTENT` | `{ plantId: string, nodeId: string, direction: {x,y,z}, nodeType: string, isAttack: boolean, tick: number }` | Request to grow a node |
| 5 | `RESOURCE_QUERY` | `{ worldX?: number, worldZ?: number, tileX?: number, tileZ?: number }` | Query local resource tile |
| 6 | `PLANT_SYNC_REQUEST` | `{ plantId: string }` | Request full plant sync |

### Server → Client

| Type | Name | Payload | Description |
|------|------|---------|-------------|
| 10 | `WELCOME` | `WelcomePayload` | Sent once on connect; assigns playerId, plantId, initial world state, full node set |
| 11 | `STATE` | `StatePayload` | Per-tick delta state (plants changed this tick) |
| 12 | `KEYFRAME` | `KeyframePayload` | Full state snapshot (every `keyframeIntervalTicks`) |
| 13 | `REJECT` | `RejectPayload` | Input rejected; reason + original type |
| 14 | `PONG` | `{}` | Response to `PING` |
| 15 | `ERROR` | `ErrorPayload` | Fatal error (version mismatch, etc.); connection closes |
| 16 | `GROWTH_EVENT` | `GrowthEventPayload` | Broadcast when a growth intent succeeds |
| 17 | `RESOURCE_UPDATE` | `ResourceUpdatePayload` | Local resource tile update (player's tile only) |
| 18 | `PLANT_SYNC` | `PlantSyncPayload` | Full plant state for reclaim/desync recovery |
| 19 | `PLANT_CREATED` | `{ plantId: string, ownerId: string, rootNode: ... }` | New plant in world |
| 20 | `PLANT_REMOVED` | `{ plantId: string }` | Plant removed (death or reconnect expiry) |
| 21 | `WEATHER_UPDATE` | `WeatherUpdatePayload` | Weather/day-night state |

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

The client handles camera panning locally using WASD/Arrow keys. The server does not validate camera movement - it only receives `INPUT` messages for potential future use but processes growth intents instead.

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
    totalUpkeep: number;
    tier: 'active' | 'near' | 'dormant';
  }>;
}

interface KeyframePayload {
  tick: number;
  plants: Array<{
    id: string;
    totalBiomass: number;
    totalUpkeep: number;
    tier: 'active' | 'near' | 'dormant';
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
  weatherState: 'clear' | 'rain' | 'thunderstorm_telegraph' | 'thunderstorm_active' | 'thunderstorm_aftermath';
  timeOfDay: number;        // 0–1
  sunElevation: number;     // radians
  sunIntensity: number;     // directional light intensity
  ambientIntensity: number;
  lightMultiplier: number;
  moistureDepositRate: number;
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
  |<-- WEATHER_UPDATE -----------| (every tick)
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
| `protocol_version` | integer | 1 | [1, 255] |
| `max_message_size_bytes` | integer | 16384 | [1024, 1048576] |
| `tick_rate_hz` | integer | 20 | [10, 60] |
| `position_quantization` | integer | 64 | [16, 256] |
| `angle_quantization_bits` | integer | 16 | [8, 32] |
| `keyframe_interval_ticks` | integer | 10 | [1, 60] |
| `max_velocity_units_per_tick` | number | 0.5 | [0.1, 10.0] |
| `world_bounds` | object | ±1000 | — |
| `client_send_rate_hz` | integer | 20 | [5, 60] |

## Acceptance (T03P + T03)

- [x] Two browser tabs connect to same server
- [x] Each tab gets unique plant with unique plantId
- [x] WASD/Arrow keys pan camera (client-side)
- [x] Click on plant nodes to select for growth
- [x] Server validates growth intents (energy, biomass, gene gates, bounds)
- [x] Server broadcasts `GROWTH_EVENT` on successful growth
- [x] `KEYFRAME` every 10 ticks, `STATE` otherwise (plant updates)
- [x] `RESOURCE_QUERY` / `RESOURCE_UPDATE` with coordinate addressing (ADR-024)
- [x] Authenticated + anonymous reclaim via HELLO (ADR-021)
- [x] `PLANT_SYNC` / `PLANT_SYNC_REQUEST` for desync recovery
- [x] Reconnect window (5 min) with delayed `PLANT_REMOVED` (ADR-021)
- [x] Protocol documented here

---

**Next:** T03 implements binary framing, delta compression, and client prediction (C01).