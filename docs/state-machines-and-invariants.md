# State machines and invariants

Static analysis of PlantLegacy's implicit state machines and the invariants the
app relies on but does not enforce.

- **Status:** living document. Update the status columns and the progress log as
  items are fixed.
- **Scope:** `apps/server`, `apps/client`, `packages/shared`, `config/`, and the
  persistence/account layers.
- **Method:** source reading only (no runtime probing). Line numbers are from the
  audit on 2026-11-08 and will drift; the function names are the durable
  reference.
- **Related:** `DESIGN.md` (source of truth), `docs/decisions.md` (ADR-018
  through ADR-029), `docs/what-works-now.md` (audit corrections), `CONTEXT.md`
  §6 (locked decisions) and §7 (invariants enforced today).

## How to use this document

1. Every item has a stable id: `SM-nn` for a state machine, `INV-XX-nn` for an
   invariant, `DEF-nn` for a confirmed defect.
2. Status vocabulary:
   - `ENFORCED` — a single guard/config check makes it true today.
   - `PARTIAL` — true on the happy path, but at least one bypass exists.
   - `UNENFORCED` — nothing checks it; it holds only by convention.
   - `BROKEN` — verified contradiction in the current code.
3. Fixes are grouped into phases (P0–P3) at the end. Work top-down; do not start
   a later phase while an earlier phase has `BROKEN` items.
4. When an item is fixed: change its status, add the fix location, and append a
   line to the progress log.
5. Rules that follow from this audit:
   - Every implicit machine in Part 1 should become either an explicit module or
     a documented set of fields with a single writer.
   - Every `UNENFORCED` invariant needs a boundary validator (load, protocol
     message, config read) or a dev-mode assertion.
   - Never add a new implicit machine to hide an old one.

---

# Part 1 — Implicit state machines

## SM-01 — Player connection, authentication, and plant reclaim

**Location:** `apps/server/src/main.ts` — `addPlayer`, `removePlayer`,
`reclaimPlant`, `reclaimPlantById`, `handleHelloMessage`, `World` class.

**States (implied):**

```
awaiting_hello -> authenticating -> joining -> connected
                                            -> disconnected_pending -> reclaimed | removed
```

**Encoded as:** `helloReceived` boolean, `players: Map`, `pendingRemovals: Map`,
`setTimeout`, and `ConnectionRegistry` for socket lifecycle.

**Why implicit:** The original `apps/server/src/ops/reconnectStateMachine.ts` implemented
`disconnect -> pending -> reclaim | expire` with explicit pending entries and expiry.
It was never imported and has been deleted. The `World` class implements it with
closures in `pendingRemovals` Map. A `ConnectionRegistry` class was added to manage
socket lifecycle (one message handler, HELLO timeout, clean post-HELLO routing).

**Missing guards (still open):**
- Reclaim timers hold only `plantId`/`accountId`; no generation token protects a newer
  pending entry from an old timer.
- Reclaim never re-broadcasts `PLANT_CREATED`/`PLANT_SYNC`. Since removal is delayed
  until the reconnect window expires, a reclaim inside the window leaves other
  clients' view intact; only an expired plant is removed.

**Fixed 2026-11-08/09:**
- HELLO timeout is cleared after success; initial message handler removes itself;
  post-HELLO handler installed atomically.
- `removePlayer` keys pending removal by `accountId` (undefined for anonymous),
  `reclaimPlantById` uses `anon_<plantId>` — keys now match consistently.
- Account reclaim removes the old player entry AND closes the old socket
  (via `ConnectionRegistry` old-socket transfer).
- Anonymous reclaim is keyed consistently (`anon_<plantId>`).
- Client HELLO sends `accessToken` (auth) or `plantId` (anonymous) for reclaim.

**Formalize as:** revive a `ReconnectStateMachine` module and make it the only writer
of `pendingRemovals`; keep the socket lifecycle in `ConnectionRegistry`
(`awaiting_hello | active | closing`).

**Related:** INV-ID-01..12, INV-NET-01..05.

## SM-02 — Growth intent pipeline

**Location:** `main.ts` — `handleGrowthIntent`, `processGrowthIntents`;
`World.step`.

**States:** `queued -> sorted -> validated -> grown | rejected | overwritten`.

**Encoded as:** `pendingGrowthIntents: Map<tick, GrowthIntent>` per player.

**Why implicit:** The original `ops/growthIntentStateMachine.ts` implemented dedupe, pending,
processing, processed/rejected, and stale cleanup. It was never imported and has been
deleted. The `World` class implements it with a per-player Map.

**Missing guards:**
- Two intents with the same tick overwrite each other.
- The map is unbounded; there is no per-player rate limit.
- Client ticks start at 0 per page load and are unrelated to server ticks.
- Intents are processed before `PlantWorld.step`, so cooldown/tick comparisons use
  the previous tick.

**Formalize as:** revive a `GrowthIntentStateMachine` module, key by
`(playerId, intentId)` rather than tick, and cap the queue.

**Related:** INV-TM-01, INV-TM-02, INV-NET-06.

## SM-03 — Plant lifecycle and death

**Location:** `apps/server/src/ops/plantWorld.ts` — `tryGrow`,
`handleGermination`, `processPlantUpkeep`, `processDormantPlant`,
`applyDamageToPlant`, `removePlant`.

**States:**

```
seed -> germinating -> germinated | failed_conditions | failed_energy | seed_destroyed
     -> growing -> mature -> dead/removed
```

Germination itself is explicit (`seedGerminationStateMachine`). The surrounding
lifecycle and every death transition are implicit.

**Resolved 2026-11-09:**
- All four `totalBiomass <= 0` sites and `removePlant` now call `killPlant`,
  which queues a `PlantDeathRecord` with a `cause`.
- `World.step` drains the queue after `PlantWorld.step()` and runs
  `handlePlantDeath`: mineral deposit, owner detach and one `PLANT_REMOVED`.
- Reconnect expiry uses the same path, so starvation, damage, failed
  germination and disconnect removal are handled identically.
- Photosynthesis skips plants that died earlier in the tick because the death
  drain runs before the resource/photosynthesis step.
- A plant at zero biomass can no longer receive photosynthesis in the same tick.

**Still open:** a pending reclaim timer is not explicitly cancelled by
`killPlant`, and stale `Plant` references can survive in callers that captured
them before the step.

**Formalize as:** a single `killPlant(plantId, cause)` transition that owns
resource deposits, spatial-index removal, pending timers, intents, and broadcast.
No gameplay code calls `removePlant` directly.

**Related:** INV-GR-04..08, INV-GR-11, INV-RS-06.

## SM-04 — Persistence snapshot lifecycle

**Location:** `apps/server/src/ops/persistence/plantPersistence.ts`.

**States:** `live -> serializing -> saved -> loaded -> rehydrated -> simulated`.

**Why implicit:** The schema was a byte layout with no version header. The state
transition was "write bytes" and "trust bytes on read".

**Fixed 2026-11-09:**
- Versioned envelope with magic bytes (`PLNT`), u16 version, u32 payload length,
  u32 CRC32 checksum.
- Growable buffer handles arbitrary node counts (no fixed-size estimate).
- `age` stored as float64 (not BigInt) to support fractional ages.
- `event_log` column now persists `PlantEvent[]` per save (was always `'[]'`).
- Periodic save loop has per-plant try/catch (one bad plant doesn't stop others).
- 13 tests cover round-trip (1/10/100/2000 nodes), UUID ids, corruption detection,
  fractional age.

**Formalize as:** a `validateLoadedPlant` step before insertion into `PlantWorld`
(validatePlantGraph is called on load but more checks needed).

**Related:** INV-PR-01..07.

## SM-05 — Weather and day/night clock

**Location:** `apps/server/src/ops/weatherStateMachine.ts`,
`main.ts:538`, `resourceWorld.step`.

**States:** `clear ↔ rain → thunderstorm_telegraph → thunderstorm_active →
thunderstorm_aftermath → clear`, crossed with day/night (`timeOfDay`).

**Why implicit:** the weather machine is explicit, but its authority was split:
durations were partly hardcoded, partly read from config under the wrong keys,
and day/night was a separate scalar advanced by the same update.

**Fixed 2026-11-08/09:**
- `clear` and `rain` no longer have zero duration; durations come from
  `WeatherConfig` (snake_case keys in `weather.json`).
- The weather graph owns transitions only. Durations, light multipliers, and
  moisture rates come from `WeatherConfig`; the next state is preselected at
  state entry and stored in `machine.nextState`, so the broadcast forecast is
  the same value the transition uses.
- Day/night cycle is integrated; server broadcasts `WEATHER_UPDATE` every tick
  with `timeOfDay`, `sunElevation`, `lightMultiplier`, `moistureDepositRate`.

**Formalize as:** a single `weather.json` duration table with no code defaults,
one sampling function used by both `advance` and `forecast`, and a
`timeOfDay` that belongs to the same clock object.

**Related:** INV-RS-08..12, INV-TM-08.

## SM-06 — Client session and connection lifecycle

**Location:** `apps/client/src/main.ts` — `connect`, `onopen`, `onclose`,
`onmessage`, `sendHello`.

**States:** `disconnected -> connecting -> hello_sent -> welcome -> plant_ready |
plant_dead | no_plant -> reconnecting`.

**Encoded as:** module-level `ws`, `connecting`, `plantReady`, `plantId`,
`cameraFramed`, `welcome`, `accessToken`, and retry timers.

**Fixed 2026-11-09:**
- HELLO now sends `{ clientVersion: 1, accessToken?, plantId? }` — accessToken
  for authenticated reclaim, plantId for anonymous reclaim.
- Reconnect data (accessToken, plantId) is persisted locally (dev switch per ADR-029).
- On WELCOME, plantId is stored for anonymous reconnect.

**Still open:**
- `welcome` is not invalidated on close, `cameraFramed` is not reset on a new welcome.
- Retry timer does not check `connecting`.

**Formalize as:** one `ClientSession` object with a discriminant
(`disconnected | connecting | awaiting_welcome | ready | failed`), owning `ws`,
`plantId`, `welcome`, `accessToken`, retry state, and the visual camera-framed flag.

**Related:** INV-NET-01..05, INV-NET-10.

## SM-07 — Client plant mirror and sync

**Location:** `client/src/main.ts` — `WELCOME`, `PLANT_SYNC`, `PLANT_CREATED`,
`GROWTH_EVENT`, `PLANT_REMOVED`.

**States:** `empty -> seeded_from_welcome -> incremental -> resynced | desynced`.

**Why implicit:** the client treats `plantNodes` as a cache but never tracks
whether it is authoritative. `GROWTH_EVENT` now applies all new nodes, the
replaced parent, and energy/biomass totals, but normal growth still does not
update the parent's `children` list on the client.

**Confirmed consequences:**
- ~~Germination emits no `GROWTH_EVENT` (DEF-08), so the client keeps the seed.~~
  Fixed 2026-11-09: germination broadcasts `newNodes` + `updatedParentNode`.
- If `plantId` is `null` after `PLANT_REMOVED`, an incoming `PLANT_SYNC` for the
  own plant is treated as another player's and never rebuilt.

**Formalize as:** a `PlantMirror` with `version`/`lastTick`, applying diffs only
when the parent version matches, and requesting `PLANT_SYNC` on mismatch. A
server-generated `growthSeq` per plant makes gaps detectable.

**Related:** INV-NET-07..11.

## SM-08 — Client environment and weather visuals

**Location:** `client/src/renderers/EnvironmentRenderer.ts`.

**States:** `clear | rain | telegraph | active | aftermath` × `day | dusk |
night`, plus lightning `idle -> flash -> idle`.

**Encoded as:** `currentWeatherState`, `isRaining`, `lightningActive`,
`lightningTimer`, and target/current colour fields.

**Why implicit:** `applyWeatherState` only sets targets; `update` lerps toward
them. But `isRaining` and `currentWeatherState` switch instantly, so rain
particles and lightning react before sky/fog finish blending. There is no
transition state or timer.

**Also:** client `timeOfDay` advances with a hardcoded `dt / 1800`
(`EnvironmentRenderer.ts:497`); the default matches `daynight.cycle_length_s`
today but will drift when that config changes.

**Formalize as:** a `WeatherVisualState` with `transitionElapsedS` and
`transitionDurationS`, and a `timeOfDay` that is set from the server broadcast
and only extrapolated locally between broadcasts.

**Related:** INV-RS-09, INV-RS-10, INV-NET-12.

## SM-09 — Quality, LOD, and animation state

**Locations:** `client/src/render/QualityController.ts`,
`renderers/webgpu/WebGPURenderer.ts`, `renderers/PlantRenderer.ts`,
`apps/server/src/ops/interestManager.ts`.

- `QualityController`: implicit `tier` state (`activeTierIndex`,
  `currentPixelRatio`), adjusted once per second with no hysteresis → oscillation.
- `WebGPURenderer`: per-plant `tier`/dwell lives in the compute shader; CPU
  `uploadPlantData` rewrites plant data every frame and does not reconcile GPU
  state.
- `PlantRenderer`: per-node emergence is `nowMs - spawnTime < 1200` — an implicit
  `spawning -> grown` state with a hardcoded duration.
- `InterestManager`: `addEntityToCell` / `getEntitiesForClient` exist but are
  never called from `World`; only `updateClientPosition` runs. Interest filtering
  is therefore not implemented.

**Formalize as:** explicit hysteresis thresholds in config, a single owner for
per-plant LOD, and either wire interest filtering or delete the entity-cell API.

**Related:** INV-RS-13, INV-TM-06, INV-NET-13, INV-CFG-01.

## SM-10 — Input context (hybrid)

**Location:** `client/src/input/InputBus.ts`, `inputActionStateMachine.ts`.

The per-action machine is explicit, but `activeContext`, `modalOpen`,
`textInputActive`, and `cameraPanState` are separate booleans. A keyup swallowed
while a modal is open can leave an action latched. Context switches do not emit
release events.

**Formalize as:** one `InputContext` state with an `onExit` that releases all held
actions.

## SM-11 — Dev panel

**Location:** `client/src/ui/DevPanel.ts` and dev commands in `main.ts`.

`visible | activeTab | search | minimized | drag` are implicit. Many controls send
`type: 99` (`DEV_RESPONSE`) commands for which the server has no `case 99`; the
panel shows state that has no effect. Treat as `BROKEN` until D01 lands.

## SM-12 — Growth selection UI (hybrid)

**Location:** `client/src/main.ts` + `growthSelectionStateMachine.ts`.

Explicit states `hidden | loading | options_visible`, but `conditions.light` and
`conditions.moisture` are mutated in place, stale responses are filtered only by
`nodeId`, and a failed send can leave the machine in `loading` forever.

**Formalize as:** include the request id in the result and add a send timeout that
returns the machine to `hidden` or `options_visible` with an error.

---

# Part 2 — Invariant catalog

Status legend: `ENFORCED`, `PARTIAL`, `UNENFORCED`, `BROKEN`.

## A. Identity, ownership, and connection (`INV-ID`)

| ID | Invariant | Status | Evidence / failure | Fix |
|---|---|---|---|---|
| INV-ID-01 | One active plant per owner/account. | ENFORCED (2026-11-10) | `World.addPlayer` checks `getPlantsByOwner(ownerId)` and reuses existing active plant instead of spawning duplicates (`main.ts:244`). | Keep reclaim/reuse check in `addPlayer`. |
| INV-ID-02 | A player's `plantId` belongs to that player. | ENFORCED (2026-11-10) | Verified in `GROWTH_OPTIONS_REQUEST` (`main.ts:709`) and `handleGrowthIntent` (`main.ts:573`); immediate `plant_mismatch` rejection. | Keep ownership guards on all player plant intent handlers. |
| INV-ID-03 | `accountId` means an authenticated account. | FIXED (2026-11-10) | `addPlayer` now passes `accountId` through unchanged (undefined for anonymous); plant `ownerId` is separate (`main.ts:229`). | Keep `accountId` undefined for anonymous; use `ownerId` for plant ownership. |
| INV-ID-04 | One live connection per account/plant. | PARTIAL | Account reclaim removes old player entry but old socket close path unclear; by-id reclaim does not explicitly close old socket. | Close old socket and remove old player on both reclaim paths. |
| INV-ID-05 | Reclaim is cancelled atomically by reconnect. | PARTIAL | `clearTimeout` used but timers capture `plantId` with no generation token (`main.ts:400-401`). | Store a generation/epoch; expire only if it still matches. |
| INV-ID-06 | Reconnect restores visibility to other clients. | FIXED (2026-11-10) | When persistence enabled, plant stays for reconnect window; `PLANT_REMOVED` broadcasts only on window expiry or actual death. When disabled, immediate removal is correct per ADR-029. | Keep this behavior; ensure docs match. |
| INV-ID-07 | Anonymous reclaim is keyed consistently. | FIXED (2026-11-10) | `removePlayer` and `reclaimPlantById` both use `anon_<plantId>`; `accountId` stays undefined for anonymous (`main.ts:388`, `533`). | Keep one key builder. |
| INV-ID-08 | Plants spawn at distinct, valid positions. | FIXED (2026-11-10) | `findSpawnPosition` uses golden-angle spiral with 5-unit clearance and fallback scan (`main.ts:145-196`). | Test spawn collision under concurrent joins. |
| INV-ID-09 | `plantWorld.createPlant` receives non-empty `ownerId`/`worldId`. | UNENFORCED | No guard in `createPlant`. | Validate before insert. |
| INV-ID-10 | Pending inputs and intents are bounded. | UNENFORCED | `pendingInputs` is never read or cleared; `pendingGrowthIntents` is unbounded. | Cap queues; drop oldest; add per-player rate limit. |
| INV-ID-11 | A HELLO arrives once, before any other message. | FIXED (2026-11-08) | Second HELLO ignored; pre-HELLO non-HELLO messages silently dropped. | Close with a protocol error; reject duplicates. |
| INV-ID-12 | One message handler per socket. | FIXED (2026-11-08) | Two handlers remain attached after HELLO (`main.ts:1330`, `1456`). | Register once; dispatch on connection state. |

## B. Plant graph integrity (`INV-GR`)

| ID | Invariant | Status | Evidence / failure | Fix |
|---|---|---|---|---|
| INV-GR-01 | `rootNodeId` points to a real node. | PARTIAL | `?? ''`, `!`, and `?? seedNode.id` fallbacks; loaded plants are not validated. | Validate on load and before every use; fail closed. |
| INV-GR-02 | Every node's `parentId`/`children` are reciprocal. | UNENFORCED | Client `GROWTH_EVENT` does not update parent children; load does not verify. | Validator + a single `linkNode`/`unlinkNode` pair. |
| INV-GR-03 | A node sits at parent + direction × speed. | UNENFORCED | Not revalidated on load; zero/NaN direction creates a coincident node. | Reject zero/non-finite direction; validate on load. |
| INV-GR-04 | `node.plantId === plant.id`. | UNENFORCED | `loadPlant` does not check. | Set on load from the owning plant; assert in dev. |
| INV-GR-05 | Node ids are globally unique. | UNENFORCED | `findPlantByNodeId` returns the first match; no duplicate check. | Assert uniqueness at insert; regenerate collisions. |
| INV-GR-06 | `totalUpkeep` equals the sum of node upkeeps. | ENFORCED | Fixed 2026-11-08: `processPlantUpkeep`/`processDormantPlant` recompute the sum and subtract it once. | Test: `spends upkeep once per tick, equal to the node sum`. |
| INV-GR-07 | `totalBiomass > 0` iff the plant is alive. | PARTIAL | Multiple death checks; stale references can still mutate. | Single `killPlant` transition; guard all mutators. |
| INV-GR-08 | `0 <= totalEnergy <= maxEnergyPerPlant`. | PARTIAL | Several independent mutators; no shared clamp. | Central `spendEnergy`/`addEnergy` helpers with asserts. |
| INV-GR-09 | Growth is legal for the parent/child type pair. | PARTIAL | Same-layer parents accept any target type; unknown types default to root/canopy. | Explicit transition table validated server-side. |
| INV-GR-10 | Germination is the only way out of `seed`. | FIXED (2026-11-08) | Seed is offered `lateral_root`/`stem` (`plantWorld.ts:223-250`); `canCrossLayer` allows `seed -> stem` (`:992-999`). | Require `isSeed === false` for non-radicle growth; gate options. |
| INV-GR-11 | Germinating a seed happens at most once. | PARTIAL | No check against `rootNodeId`/`isSeed` after load. | Guard in `handleGermination`. |
| INV-GR-12 | `maxNodesPerPlant` is never exceeded. | FIXED (2026-11-08) | Checked before germination, which adds ~3 nodes (`:780`). | Check after the planned node batch. |
| INV-GR-13 | A quoted growth cost equals the charged cost. | ENFORCED (2026-11-10) | Single source of truth `computeGrowthCostQuote` used across `getGrowthOptions` quotes, `tryGrow` deductions, and `step()` resource consumption. Tested in `plantWorld.test.ts`. | Maintain shared cost computation helper. |
| INV-GR-14 | Death deposits minerals exactly once. | FIXED (2026-11-10) | `killPlant` calls `eventBus.publishSync(PLANT_DEATH)` and queues death; `processPlantDeaths` drains queue and calls `resourceWorld.onPlantDeath` exactly once per death (`main.ts:125-147`, `plantWorld.ts:1262-1299`). | Keep single deposit path in `processPlantDeaths`. |
| INV-GR-15 | The spatial index matches the plant's node set. | PARTIAL | Add/remove paths paired; no reconciliation. | Dev assertion comparing index vs node sets. |
| INV-GR-16 | Broadcast node metadata equals server node metadata. | FIXED (2026-11-10) | Germination broadcasts inserted nodes verbatim with full stats (`plantWorld.ts:1239-1244`). | — |
| INV-GR-17 | `totalBiomass` tracks the biomass actually owned by the plant. | PARTIAL | Growth, germination, photosynthesis, damage, and shedding mutate it independently; no reconciliation. | Dev-mode assert against a derived value where node biomass is authoritative. |

## C. Time and simulation (`INV-TM`)

| ID | Invariant | Status | Evidence / failure | Fix |
|---|---|---|---|---|
| INV-TM-01 | One authoritative tick clock. | BROKEN | `World.tick`, `PlantWorld.tick`, `ResourceWorld.tick` advance independently. | Pass one tick/dt into every subsystem; derive all timers from it. |
| INV-TM-02 | Cooldowns and intent ticks use that clock. | PARTIAL | `growthCooldownUntil` uses `PlantWorld.tick`; intents are processed before the step. | Process intents after the tick increment, or use explicit ordering docs. |
| INV-TM-03 | `dt` matches the configured tick rate. | BROKEN | `World` uses `net_proto.tickRateHz`; `PlantWorld` uses `activeTickRateHz` (default 20). | Derive `activeTickRateHz` from the same config. |
| INV-TM-04 | Tier rates come from config. | BROKEN | `nearTickRateHz`/`dormantStepIntervalSec` are accepted but never stored (`plantWorld.ts:102-113`). | Store and use them; delete hardcoded tier configs. |
| INV-TM-05 | Dormant catch-up uses elapsed wall time. | BROKEN | Uses tick delta with a mis-saved `lastTick`; reload can cause huge starvation (`:635`). | Persist `lastTick` correctly; clamp catch-up. |
| INV-TM-06 | Offline damage applies to dormant plants. | PARTIAL | `offlineDamageMultiplier` used only for `near` (`:740`). | Apply a configured factor to dormant too. |
| INV-TM-07 | Photosynthesis fills energy. | FIXED (2026-11-09) | Only biomass is added (`main.ts:555`); `addPhotosynthesisEnergy` is never called. | Call it with the configured energy rate. |
| INV-TM-08 | Simulation time tracks wall time. | PARTIAL | Per-callback tick count; `setInterval` drift not compensated. | Fixed-step accumulator. |
| INV-TM-09 | Broadcast rates honour config. | UNENFORCED | `clientSendRateHz` unused; STATE/KEYFRAME/RESOURCE/WEATHER every tick. | Throttle per config. |
| INV-TM-10 | `InterestManager` filters what each client receives. | PARTIAL (2026-11-09) | Entity-cell APIs are never called; every client receives everything. | Wire entity registration + filter broadcasts by cell. |

## D. Resources and weather (`INV-RS`)

| ID | Invariant | Status | Evidence / failure | Fix |
|---|---|---|---|---|
| INV-RS-01 | Tile values stay within `[0, max*]`. | ENFORCED | Fixed 2026-11-08: constructors and `setTileResources` clamp to per-resource maxima. | Keep maxima in the clamp helper. |
| INV-RS-02 | Tile indices are always valid. | PARTIAL | `updateLight/Moisture/Minerals` use raw `worldToTileX/Z` with no clamp. | Clamp or skip out-of-bounds nodes once at the boundary. |
| INV-RS-03 | Diffusion averages neighbours and conserves mass. | ENFORCED | Fixed 2026-11-08: `diffuseResources` accumulates all neighbours and lerps toward their mean. | Test: `diffuses toward the mean of all neighbours`. |
| INV-RS-04 | Weather durations come from config. | ENFORCED | Fixed 2026-11-08: graph owns transitions, `WeatherConfig` owns durations. | Keep it this way; no duration literals. |
| INV-RS-05 | Forecast equals the sampled next state. | ENFORCED | Fixed 2026-11-08: `machine.nextState` is preselected and reused by `advance`. | Preserve the single-sample rule. |
| INV-RS-06 | Every weather state maps to a client condition. | PARTIAL | `conditionMapping[state] ?? 'sun'` silently falls back. | Validate all five states at config load. |
| INV-RS-07 | Client and server agree on day/night. | BROKEN | Different sun curves and switch points; client has its own hardcoded clock. | Server broadcast is authoritative; client extrapolates only between broadcasts. |
| INV-RS-08 | Rain is authoritative from weather. | PARTIAL | `ResourceWorld.setRaining` is dead; moisture uses the weather rate. | Delete `setRaining` or wire it. |
| INV-RS-09 | Reads do not mutate. | BROKEN | `ResourceWorld.getState` calls `getDirtyTiles`, flipping `hasBroadcast`. | Separate `peekState` from `consumeDirty`. |
| INV-RS-10 | Dirty thresholds come from config. | UNENFORCED | Hardcoded 0.05/0.1. | Read from `resources.json`. |
| INV-RS-11 | Death deposit happens exactly once per death. | FIXED (2026-11-10) | Same as INV-GR-14; `killPlant` queues death, `processPlantDeaths` calls `onPlantDeath` once (`main.ts:125-147`). | Keep single deposit path. |
| INV-RS-12 | Consumption triggers reflect consumed items. | BROKEN | `checkConsumptionTriggers` returns config booleans as if they were world state (`resourceWorld.ts`). | Track actual consumption events. |
| INV-RS-13 | Canopy shading has a single source of truth. | PARTIAL | `getCanopyShadingAt` and `updateLight` duplicate a hardcoded radius-4 model. | One shared shade function. |

## E. Protocol and client mirror (`INV-NET`)

| ID | Invariant | Status | Evidence / failure | Fix |
|---|---|---|---|---|
| INV-NET-01 | HELLO carries the identity needed for reclaim. | FIXED (2026-11-09) | Client sends only `clientVersion` (`client main.ts:1627-1630`). | Send `accessToken` and/or stored `plantId`; persist anonymous id locally (dev switch per ADR-029). |
| INV-NET-02 | `RESOURCE_QUERY` coordinates are consistent. | FIXED (2026-11-09) | Server accepts `worldX`/`worldZ` and converts with `getTileCoordinates`; tile coords still work. | Add a schema. |
| INV-NET-03 | `RESOURCE_UPDATE.tiles[0]` is the queried tile. | FIXED (2026-11-09) | Per-tick update reads the player's local tile directly from the grid and includes `tileX`/`tileZ` (ADR-024). | Keep the client coordinate lookup. |
| INV-NET-04 | `WELCOME` contains the full plant. | FIXED (2026-11-09) | `addPlayer` and both reclaim paths populate `nodes`. | Keep nodes in every welcome path. |
| INV-NET-05 | `GROWTH_EVENT` fully describes growth. | FIXED (2026-11-09) | Emits `newNode` or `newNodes` + `updatedParentNode`, `totalBiomass` and `totalEnergy`; germination is included. | — |
| INV-NET-06 | Every accepted intent is processed. | FIXED (2026-11-10) | `growthIntentStateMachine` queues intents in FIFO order per player; same-tick intents no longer overwrite (`ops/growthIntentStateMachine.ts`). | Queue by intent id. |
| INV-NET-07 | `PLANT_SYNC` covers every plant the client should see. | PARTIAL | Only connected players' plants; offline plants vanish. | Include interested/reclaimed plants. |
| INV-NET-08 | Client validates payloads. | UNENFORCED | Everything is `as`-cast. | Schema guards at `onmessage`. |
| INV-NET-09 | Client updates the full graph, not just the new node. | FIXED (2026-11-10) | `GROWTH_EVENT` links new nodes into parent's `children` array for own and other plants (`apps/client/src/main.ts:2861-2949`). | Apply links or request sync. |
| INV-NET-10 | `plantReady`/`plantId`/`welcome` are consistent. | PARTIAL | `welcome` not cleared on close; `cameraFramed` not reset. | Own them in one session object. |
| INV-NET-11 | Own-plant sync works when `plantId` is null. | FIXED (2026-11-10) | `PLANT_SYNC` matches by `ownerId === playerId` or `welcome.plantId` and sets `plantId` / `plantReady` (`apps/client/src/main.ts:3128-3135`). | Rebuild by owner/player id, not `plantId` alone. |
| INV-NET-12 | Client `timeOfDay` matches the server. | PARTIAL | Hardcoded 1800s local advance. | Use broadcast interval + config. |
| INV-NET-13 | Message type constants are shared. | PARTIAL | Client duplicates `MESSAGE_TYPE`; `DEV_RESPONSE = 99` has no server case. | Import from `net.ts`; add dev dispatch or remove. |
| INV-NET-14 | Server broadcasts respect interest cells. | PARTIAL (2026-11-09) | Same as INV-TM-10. | Wire interest filtering. |
| INV-NET-15 | Client renders server text safely. | UNENFORCED | `innerHTML` with `label/reason/risk`. | `textContent`/DOM nodes. |
| INV-NET-16 | `PROTOCOL_VERSION` has one source. | PARTIAL | Shared constant vs config vs hardcoded client `1`. | Import the shared constant everywhere. |

## F. Persistence (`INV-PR`)

| ID | Invariant | Status | Evidence / failure | Fix |
|---|---|---|---|---|
| INV-PR-01 | Snapshot format is versioned and validated. | FIXED (2026-11-09) | No magic/version/checksum; `nodeCount`, lengths and enum bytes trusted. | Versioned envelope + validator. |
| INV-PR-02 | Serialized buffer is large enough. | FIXED (2026-11-09) | Fixed-size estimate ignores variable strings/children (`:81`). | Measure first, then write. |
| INV-PR-03 | Persisted tier reflects state. | ENFORCED | Fixed 2026-11-08: `savePlant` writes `plant.tier ?? 'dormant'`. | Keep the fallback for legacy rows. |
| INV-PR-04 | `last_tick` reflects simulation time. | ENFORCED | Fixed 2026-11-08: `savePlant` writes `plant.lastTick ?? plant.lastGrowthTick`. | Validate on load. |
| INV-PR-05 | Saves are atomic under concurrency. | PARTIAL | Periodic + shutdown save race; no row lock/version. | Serialize saves or use a version column. |
| INV-PR-06 | Load accepts only valid plants. | PARTIAL | `validatePlantGraph` called on load but `totalUpkeep` not recomputed. | `validateLoadedPlant` before insertion. |
| INV-PR-07 | Event log is append-only and complete. | BROKEN | Always `'[]'`; `world_events` never written. | Implement or mark the feature not built. |
| INV-PR-08 | Migrations are ordered and unique. | PARTIAL | Version parsed as text split on `_`; no checksum. | Numeric version + applied table. |

## G. Accounts and security (`INV-AU`)

| ID | Invariant | Status | Evidence / failure | Fix |
|---|---|---|---|---|
| INV-AU-01 | Refresh tokens can be looked up by hash. | FIXED (2026-11-08) | Salted argon2 on insert (`:228`, `:438`), re-hashed on lookup (`:379`, `:413`) → never matches. | Deterministic SHA-256 lookup hash, or opaque token id + argon2 verify. |
| INV-AU-02 | Session limit is `max`. | ENFORCED | Fixed 2026-11-08: revoke only `length - max` when `length > max`. | Add an integration test when the accounts test suite exists. |
| INV-AU-03 | Access tokens belong to live, unlocked accounts. | PARTIAL | Signature/exp/iss/aud only (`:470-484`). | Check account + session state. |
| INV-AU-04 | Rate limits are atomic. | FIXED (2026-11-09) | `DELETE → SELECT → INSERT/UPDATE` with no lock/unique constraint (`:129-168`). | `INSERT … ON CONFLICT DO UPDATE` + row lock. |
| INV-AU-05 | Lockout resets after expiry. | PARTIAL | Failed count is not reset when the lock expires. | Reset on successful login / expiry check. |
| INV-AU-06 | Display-name constraints hold at signup. | ENFORCED (2026-11-10) | `createAccount` and `changeDisplayName` both call shared `validateDisplayName` method (length and control characters). Tested in `service.test.ts`. | Maintain shared display name validator. |
| INV-AU-07 | JWT secret is always configured. | FIXED (2026-11-09) | Falls back to `'dev-secret-change-in-production'` (`:566-568`). | Fail startup outside `local`. |
| INV-AU-08 | Client IP is trustworthy. | UNENFORCED | Trusts `x-forwarded-for` unconditionally. | Configure trusted proxies. |
| INV-AU-09 | Accounts are actually used by the game loop. | FIXED (2026-11-09) | Client never sends a token, so every player is anonymous. | Send the access token in HELLO. |
| INV-AU-10 | Usernames are uniquely identified consistently. | PARTIAL | Case-sensitive duplicate check only. | Normalize + DB unique index on `lower(username)`. |
| INV-AU-11 | Logout revokes the presented session. | FIXED (2026-11-08) | Same cause as INV-AU-01; invalid token still returns success. | Verify the token belongs to a session; return an error otherwise. |
| INV-AU-12 | CORS and WS origin checks agree. | PARTIAL | HTTP still processes disallowed origins; WS closes. | Reject at the HTTP boundary too. |

## H. Config discipline (`INV-CFG`)

| ID | Invariant | Status | Evidence / failure | Fix |
|---|---|---|---|---|
| INV-CFG-01 | Every tunable comes from `config/*.json` (RULE_3). | PARTIAL | `cellSize = 10`, cotyledon count/threshold, tier rates, LOD radii, 1800s client cycle, growth `expectedSeconds`, dirty thresholds, shade radius, dev ranges, inline `/config/*` defaults. (Weather durations fixed 2026-11-08.) | Move to config; delete inline defaults or mark them dev-only. |
| INV-CFG-02 | Config fallbacks cannot drift from files. | PARTIAL | Inline defaults duplicate file values (`main.ts` `/config/*` routes). | Load from file only; fail if missing. |
| INV-CFG-03 | `PROTOCOL_VERSION` is shared. | PARTIAL | See INV-NET-16. | Import shared constant. |

---

# Part 3 — Confirmed defects (priority order)

`DEF-nn` are verified contradictions, not hypotheses. Fix these before adding
features.

| DEF-01 | `clear`/`rain` had zero duration, so weather advanced every tick. | FIXED (2026-11-08) | `weatherStateMachine.ts` | INV-RS-04, INV-RS-05 |
| DEF-02 | Refresh-token lookup never matches (salted hash re-hash). Logout is a no-op; refresh always fails. | FIXED (2026-11-08) | `accounts/service.ts` | INV-AU-01, INV-AU-11 |
| DEF-03 | Plant upkeep subtracts the aggregate **and** every node, roughly doubling drain. | FIXED (2026-11-08) | `plantWorld.ts` upkeep paths | INV-GR-06 |
| DEF-04 | Client never sends identity in HELLO; every reload creates a new plant at the origin. | FIXED (2026-11-08) | `client/src/main.ts` | INV-NET-01, INV-ID-01 |
| DEF-05 | Photosynthesis adds biomass but never energy; `addPhotosynthesisEnergy` is dead. | FIXED (2026-11-09) | `main.ts`; `plantWorld.ts` | INV-TM-07 |
| DEF-06 | Every `RESOURCE_QUERY` is ignored: client sends world coords, server expects tile coords. | FIXED (2026-11-09) | `main.ts` (client + server) | INV-NET-02 |
| DEF-07 | Anonymous reclaim key mismatch makes `reclaimPlantById` unreachable. | FIXED (2026-11-08) | `main.ts` | INV-ID-07 |
| DEF-08 | Germination succeeds with no `GROWTH_EVENT`; the client stays on the seed. | FIXED (2026-11-09) | `plantWorld.ts`; `main.ts` | INV-NET-05 |
| DEF-09 | `savePlant` writes tier `'dormant'` and `last_tick = lastGrowthTick`. | FIXED (2026-11-08) | `plantPersistence.ts` | INV-PR-03/04 |
| DEF-10 | Diffusion only lerps toward the last neighbour. | FIXED (2026-11-08) | `resourceWorld.ts` | INV-RS-03 |
| DEF-11 | `InterestManager` entity filtering is never wired. | PARTIAL (2026-11-09) | `main.ts`; `interestManager.ts` | INV-TM-10 |
| DEF-12 | `enforceSessionLimit` revokes one session too many. | FIXED (2026-11-08) | `accounts/service.ts` | INV-AU-02 |
| DEF-13 | HELLO timeout is never cleared; second message handler persists. | FIXED (2026-11-08) | `main.ts` | INV-ID-11/12 |
| DEF-14 | `maxNodesPerPlant` is checked before germination adds nodes. | FIXED (2026-11-08) | `plantWorld.ts` | INV-GR-12 |
| DEF-15 | Seed can grow `stem`/`lateral_root` without germinating. | FIXED (2026-11-08) | `plantWorld.ts` | INV-GR-10 |
| DEF-16 | `setTileResources` ignores per-resource maxima. | FIXED (2026-11-08) | `resourceWorld.ts` | INV-RS-01 |

---

# Part 4 — Remediation plan

Phases are ordered by risk × blast radius. Do not start a phase until the
previous phase is green in `pnpm verify`.

## Phase 0 — Stop the bleeding (single-file fixes)

| Item | Change | Acceptance |
|---|---|---|
| P0.1 | Weather durations read from config; remove zero-duration shadowing; clear/rain last their configured range. | New unit test asserts a clear state survives `dt < min` and advances after `max`. |
| P0.2 | Refresh token: store a deterministic SHA-256 lookup hash (or opaque id); keep argon2 for passwords. | Login → logout revokes; refresh rotates and old token is rejected. |
| P0.3 | Remove the aggregate upkeep subtraction (keep per-node subtraction) **or** make `totalUpkeep` a derived cache and use only one. | Upkeep per tick equals the sum of node upkeeps; test asserts the rate. |
| P0.4 | Client HELLO sends `accessToken` and stored anonymous `plantId`; server reclaim paths use one key builder. | Reload with persistence enabled reclaims the same plant. |
| P0.5 | Photosynthesis calls `addPhotosynthesisEnergy(plantId, rate * dt * leafFactor)`. | Energy rises in light, falls in darkness; config drives the rate. |
| P0.6 | `RESOURCE_QUERY` schema: pick tile or world coords and convert in one place. | HUD reads the correct tile after one query. |
| P0.7 | Germination returns/broadcasts inserted nodes and energy. | Client renders the root crown without a manual resync. |
| P0.8 | `savePlant` writes `tier` and `lastTick`; `loadPlant` validates `rootNodeId`. | Reload a saved plant and compare totals/tier. |

## Phase 1 — Formalize the machines

1. Wire `reconnectStateMachine` and `growthIntentStateMachine` into `World`;
   delete the duplicate closures.
2. Introduce `killPlant(id, cause)` and route every death path through it.
3. Introduce `ConnectionRegistry` (one message handler, one HELLO, one close
   path, old-socket transfer on reclaim).
4. Introduce `PlantMirror` on the client with `growthSeq` gap detection and
   `PLANT_SYNC` recovery.
5. Replace the weather visual booleans with an explicit transition state.

## Phase 2 — Boundary validation and tests

1. `validatePlantGraph(plant)` — root, reciprocity, node ids, plantIds, totals,
   bounds; call after load and in dev every N ticks.
2. Protocol schemas at `onmessage` (server and client); reject malformed
   messages with `ERROR` instead of dropping them.
3. Config validators for cross-field rules (weather durations, condition
   mapping, resource maxima, tier rates).
4. Property tests: random plant graphs round-trip save/load; totals conserved;
   no node without a parent; tile values in range after N ticks.

## Phase 3 — Consolidation and performance

1. One tick clock; fixed-step accumulator; throttle broadcasts by config.
2. Wire or delete `InterestManager` entity cells.
3. Move every remaining hardcoded tunable to config (INV-CFG-01).
4. Fix diffusion, double deposits, and texture of read-only accessors.

---

# Progress log

| Date | Item | Change |
|---|---|---|
| 2026-11-08 | — | Initial audit written. |
| 2026-11-08 | DEF-01 / INV-RS-04 / INV-RS-05 | Weather durations, light multipliers, and moisture rates now read from `WeatherConfig`. Clear/rain no longer have zero duration. Forecast is the preselected `machine.nextState`. Tests added in `apps/server/src/ops/weather.test.ts`. |
| 2026-11-08 | DEF-03 / INV-GR-06 | Upkeep recomputes the node-sum `totalUpkeep` and subtracts it once per tick (active and dormant). Test added in `apps/server/src/ops/plantWorld.test.ts`. |
| 2026-11-08 | DEF-09 / DEF-12 / DEF-16 | Persistence writes the real tier/`lastTick`; session limit no longer revokes one too many; tile writes and initial tiles clamp to per-resource maxima. |
| 2026-11-08 | DEF-10 / INV-RS-03 | Diffusion accumulates all four neighbours and lerps toward their mean. Test added in `apps/server/src/ops/resourceWorld.test.ts`. |
| 2026-11-08 | DEF-02 / INV-AU-01 / INV-AU-11 | Refresh token uses deterministic SHA-256 lookup hash alongside argon2 password hash. Login → logout revokes; refresh rotates and old token is rejected. |
| 2026-11-08 | DEF-04 / DEF-07 / INV-ID-01 / INV-ID-07 / INV-NET-01 | Client HELLO sends `accessToken` and stored anonymous `plantId`; server uses single `makeReclaimKey` builder; reload with persistence enabled reclaims the same plant. |
| 2026-11-09 | DEF-05 / INV-TM-07 | Photosynthesis applies both biomass and energy at their per-second config rates scaled by `dt`; `addPhotosynthesisEnergy` is now used. |
| 2026-11-09 | DEF-06 / INV-NET-02 / INV-NET-03 | `RESOURCE_QUERY` accepts `worldX`/`worldZ` (tile coords still work); the per-tick `RESOURCE_UPDATE` reads the player's local tile directly instead of indexing the dirty-tile array as a grid. |
| 2026-11-09 | DEF-08 / INV-NET-04 / INV-NET-05 | Germination returns/broadcasts all inserted nodes (`newNodes`), the replaced seed/root (`updatedParentNode`), `totalBiomass` and `totalEnergy`; the client applies every node and replaces the seed. |
| 2026-11-09 | DEF-11 / INV-TM-10 | Corrected: only client registration and position updates are wired. Entity-cell population and per-client STATE/KEYFRAME/GROWTH_EVENT filtering are still not applied. |
| 2026-11-08 | DEF-13 / INV-ID-11 / INV-ID-12 | HELLO timeout cleared on success; initial message handler removes itself; post-HELLO handler installed atomically. |
| 2026-11-08 | DEF-14 / INV-GR-12 | `maxNodesPerPlant` checked against projected node count (germination +3, regular +1). |
| 2026-11-08 | DEF-15 / INV-GR-10 | `canCrossLayer` no longer allows `seed→stem`; `getGrowthOptions` only offers `radicle` for seed nodes. |
| 2026-11-09 | Phase 1.1 / SM-01 | Corrected: `reconnectStateMachine` is **not** wired into `World`; the inline `pendingRemovals` Map is still authoritative. `ConnectionRegistry` handles socket lifecycle. Deferred. |
| 2026-11-09 | Phase 1.2 / SM-02 | Corrected: `growthIntentStateMachine` is **not** wired into `World`; `pendingGrowthIntents` is still processed inline. Deferred. |
| 2026-11-09 | Phase 1.3 / SM-03 | `killPlant(id, cause)` queues a `PlantDeathRecord`; `World` drains the queue after `PlantWorld.step()` and handles mineral deposit, owner detach and a single `PLANT_REMOVED` broadcast. |
| 2026-11-09 | ADR-025 / INV-GR-06 / INV-GR-17 | Root overlap damage is multiplied by `dt`; germination sets `plant.rootNodeId` to the transformed seed. Regression tests compare one 0.1 s step with two 0.05 s steps and assert exactly one death record. |
| 2026-11-09 | SM-04 | Versioned snapshot envelope (`PLNT` magic, u16 version, u32 length, u32 CRC32), growable buffer, float64 age, persisted `event_log`, per-plant try/catch in save loop. 13 new tests. |
| 2026-11-09 | Auth hardening | Refresh rotation inserts new session before revoking old; atomic rate-limit upsert with unique constraint (migration 004); JWT secret required in prod; lockout extends on failed attempts during lockout; pool errors logged. |
| 2026-11-10 | Phase 1 fixes (P0/P1) | Fixed spawn collision (`findSpawnPosition` with 5-unit clearance + fallback), root overlap damage only from active-tier plants, `GROWTH_OPTIONS_RESULT` error response now schema-valid, `processPlantDeaths` wraps resource/broadcast in try-catch. Persistence now single-sourced from `world.json` (default false per ADR-029). Camera `minDistance=1` for ADR-027. Console spam reduced via `console.debug`. Invariant table statuses corrected (INV-ID-03/06/07/08, INV-GR-14/16, INV-RS-11). Dev watch paths narrowed to exclude tests/SQL. |
| 2026-11-10 | Phase 1 formalization & wiring | Wired `reconnectStateMachine`, `growthIntentStateMachine`, `ConnectionRegistry`, and `TickClock` into `World`. Fixed `main.ts` constructor `worldConfig` scope bug and added `addPhotosynthesisEnergy` call on ticks. Fixed same-tick intent overwrites (`growthIntentStateMachine` FIFO queue, INV-NET-06). Added client parent-child linking on `GROWTH_EVENT` (INV-NET-09) and null-`plantId` sync matching (INV-NET-11). Added full unit test suites for `growthIntentStateMachine`, `reconnectStateMachine`, `tickClock`, and `connectionRegistry` (119 server tests passing). Verified `pnpm verify` clean. |
| 2026-11-10 | Invariant hardening (INV-GR-13, INV-ID-01, INV-ID-02, INV-AU-06) | Introduced shared `computeGrowthCostQuote` helper function guaranteeing 1:1 match between `getGrowthOptions` quotes and `tryGrow`/`step` charges (INV-GR-13). Reused existing plants in `World.addPlayer` to enforce one active plant per owner (INV-ID-01). Added immediate ownership rejection in `handleGrowthIntent` (INV-ID-02). Unified display-name sanitization across signup and profile change (INV-AU-06). 181 tests passing. |

---

# Appendix — Audit shortcuts

```sh
pnpm verify                 # lint + typecheck + config:validate + test
pnpm test                  # server + shared
rg "pendingRemovals|reclaimPlant|accountId" apps/server/src/main.ts
rg "totalUpkeep|addPhotosynthesisEnergy" apps/server/src/ops/plantWorld.ts
rg "as [A-Z]" apps/server/src/main.ts apps/client/src/main.ts   # trust boundaries
rg "durationMinS|durationFixedS" apps/server/src/ops/weatherStateMachine.ts
rg "setTileResources|maxLight|maxMoisture" apps/server/src/ops/resourceWorld.ts
```
