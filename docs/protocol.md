# Protocol

**Status:** decided by T03P (Gate 0, week 2). Implemented by T03.
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
Client sends `HELLO { clientVersion: 1 }` on connect.
Server rejects with `ERROR { code: "VERSION_MISMATCH", ... }` if mismatch.

## Message Types

### Client → Server

| Type | Name | Payload | Description |
|------|------|---------|-------------|
| 1 | `HELLO` | `{ clientVersion: number }` | First message after connect; version handshake |
| 2 | `INPUT` | `{ input: PlayerInput }` | Player movement input for a tick |
| 3 | `PING` | `{}` | Keepalive / latency measurement |

### Server → Client

| Type | Name | Payload | Description |
|------|------|---------|-------------|
| 10 | `WELCOME` | `WelcomePayload` | Sent once on connect; assigns playerId, cubeId, initial world state |
| 11 | `STATE` | `StatePayload` | Per-tick delta state (cubes changed this tick) |
| 12 | `KEYFRAME` | `KeyframePayload` | Full state snapshot (every `keyframeIntervalTicks`) |
| 13 | `REJECT` | `RejectPayload` | Input rejected; reason + original type |
| 14 | `PONG` | `{}` | Response to `PING` |
| 15 | `ERROR` | `ErrorPayload` | Fatal error (version mismatch, etc.); connection closes |

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

## Movement Validation (Server-Authoritative)

All movement validated on server before state update:

1. **Velocity limit:** `maxVelocityUnitsPerTick` (default 0.5 units/tick)
2. **World bounds:** `worldBounds` (default ±1000 on X/Z)
3. **Diagonal normalization:** √2 correction applied
4. **Rotation smoothing:** Max π rad/s turn rate

Invalid input → `REJECT` with reason (`velocity_exceeded`, `out_of_bounds`) + current authoritative state.

## Payload Schemas

```ts
interface PlayerInput {
  moveForward: boolean;
  moveBackward: boolean;
  moveLeft: boolean;
  moveRight: boolean;
  tick: number;        // client's local tick counter
}

interface CubeState {
  id: string;          // e.g., "cube_player_123"
  x: number;           // quantized position
  z: number;
  rotation: number;    // quantized radians
  color: number;       // 0xRRGGBB
  lastInputTick: number;
}

interface WelcomePayload {
  playerId: string;    // "player_<timestamp>_<random>"
  cubeId: string;      // "cube_<playerId>"
  tick: number;        // server tick at join
  cubes: CubeState[];  // all current cubes
}

interface StatePayload {
  tick: number;
  cubes: CubeState[];  // only cubes with changes this tick
}

interface KeyframePayload {
  tick: number;
  cubes: CubeState[];  // ALL cubes
}

interface RejectPayload {
  reason: string;      // "velocity_exceeded: 0.612 > 0.500" or "out_of_bounds"
  originalType: number;
}

interface ErrorPayload {
  code: string;        // "VERSION_MISMATCH"
  message: string;
}
```

## Connection Flow

```
Client                          Server
  |                               |
  |--- WebSocket connect ------->|
  |                               |
  |<-- WELCOME ------------------|
  |                               |
  |--- HELLO {version:1} ------->|
  |                               |
  |--- INPUT {tick:1} ---------->|
  |                               | validate movement
  |<-- STATE {tick:1} -----------|
  |                               |
  |--- INPUT {tick:2} ---------->|
  |                               | invalid (too fast)
  |<-- REJECT {reason:"..."} ----|
  |<-- STATE {tick:2} -----------| (authoritative correction)
  |                               |
  |--- PING --------------------->|
  |<-- PONG ----------------------|
```

## Reconnection

- Client auto-reconnects on close (3 s delay)
- Full `WELCOME` on reconnect — no delta sync
- Player gets new `playerId` / `cubeId` (ephemeral prototype)

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

## Acceptance (T03P)

- [x] Two browser tabs connect to same server
- [x] Each tab gets unique cube with unique color
- [x] WASD/Arrow keys move cube
- [x] Server rejects movement exceeding `max_velocity_units_per_tick`
- [x] Server rejects movement outside `world_bounds`
- [x] Rejected input → `REJECT` + authoritative state correction visible in both tabs
- [x] `KEYFRAME` every 10 ticks, `STATE` otherwise
- [x] Protocol documented here

---

**Next:** T03 implements the full protocol with binary framing, delta compression, and client prediction (C01).