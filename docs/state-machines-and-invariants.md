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
3. Fixes are tracked in the task records; the retired P0–P3 remediation plan is
   kept in [`history.md`](./history.md) for the record, not maintained.
4. When an item is fixed: change its status and add the fix location here. This
   file is the only current status source.
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

## SM-13 — Damage, uproot and tumble (T06)

**Location:** `apps/server/src/ops/damage/damagePipeline.ts`, with pure decisions
in `packages/shared/src/damage`.

**States:**

```
rooted -> uprooted -> tumbling -> uprooted (settled) -> rerooting -> rooted
                    |__________________________________________| -> dead (starvation)
```

Uproot causes are saturation, a height-scaled gust, a collapse under the root
plate, or accumulated structural damage; there is no random roll and no
root-vs-root source (ADR-051, ADR-052). Damage removes node biomass, so HP is
structural mass (ADR-055).

**Enforced today:** one uproot at a time per plant; every transform is
recomputed from a captured base pose; the reroot window stops settling but does
not kill directly; a failed reroot starves through the normal death path; drop
expiry is checked every tick; kill credit is the largest total inside
`kill_credit_window_s`; the snapshot is at **PLNT v4** — v2 added the mutation
list, v3 the uproot state (restored as settled), v4 each mutation's level and its
chosen level cards — and v1/v2 snapshots still load.

**Open:** the crawl substrate multiplier is fixed at 1.0 until T02 exposes one;
the client has no reroot control (C04) and only the Dev Panel steers it; drops
are world objects that no one can pick up until T51/T08A (ADR-056).

**Related:** INV-DM-01..05, INV-GR-01, INV-PR-01.

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
| INV-GR-08 | `0 <= totalEnergy <= computePlantCapacity(plant).energy`, and the same for stored water/minerals against their plant-derived capacities. | ENFORCED | Fixed 2026-11-12: `ops/plantCapacity.ts` derives capacity from the plant's own biomass and `clampPlantStorage` is applied after every mutation (growth spend, absorption, photosynthesis, item use, dev fill, save load). | Test: `plantCapacity` bounds + PlantWorld suites. |
| INV-GR-09 | Growth is legal for the parent/child type pair. | PARTIAL | Same-layer parents accept any target type; unknown types default to root/canopy. | Explicit transition table validated server-side. |
| INV-GR-10 | Germination is the only way out of `seed`. | FIXED (2026-11-08) | Seed is offered `lateral_root`/`stem` (`plantWorld.ts:223-250`); `canCrossLayer` allows `seed -> stem` (`:992-999`). | Require `isSeed === false` for non-radicle growth; gate options. |
| INV-GR-11 | Germinating a seed happens at most once. | PARTIAL | No check against `rootNodeId`/`isSeed` after load. | Guard in `handleGermination`. |
| INV-GR-12 | `maxNodesPerPlant` is never exceeded. | FIXED (2026-11-08) | Checked before germination, which adds ~3 nodes (`:780`). | Check after the planned node batch. |
| INV-GR-13 | A quoted growth cost equals the charged cost. | ENFORCED (2026-11-16) | `computeGrowthCostQuote` is the base for all three sites, and `growthChargeScale(plant, node, layer)` is the only place the extras are combined: soil resistance × mutation growth cost for energy, resistance ÷ growth speed for time. `buildGrowthOptions` quotes through `scaleGrowthQuote` (energy rounded **up**, so a card can only be pessimistic) and `tryGrow` charges through the same scale. Before this the menu quoted the bare cost while the charge multiplied it, so a root card said 6 and the server wanted 11. Test: "quotes the soil and mutation charge, so a card never offers growth that is refused". | Keep the scale in `PlantWorld`; the menu must never recompute a multiplier. |
| INV-GR-14 | Death deposits minerals exactly once. | FIXED (2026-11-10) | `killPlant` calls `eventBus.publishSync(PLANT_DEATH)` and queues death; `processPlantDeaths` drains queue and calls `resourceWorld.onPlantDeath` exactly once per death (`main.ts:125-147`, `plantWorld.ts:1262-1299`). | Keep single deposit path in `processPlantDeaths`. |
| INV-GR-15 | The spatial index matches the plant's node set. | PARTIAL | Add/remove paths paired; no reconciliation. | Dev assertion comparing index vs node sets. |
| INV-GR-16 | Broadcast node metadata equals server node metadata. | FIXED (2026-11-10) | Germination broadcasts inserted nodes verbatim with full stats (`plantWorld.ts:1239-1244`). | — |
| INV-GR-17 | `totalBiomass` tracks the biomass actually owned by the plant. | PARTIAL | Growth, germination, photosynthesis, damage, and shedding mutate it independently; no reconciliation. | Dev-mode assert against a derived value where node biomass is authoritative. |
| INV-GR-18 | A node's `y` is a height above the soil line under that node. | ENFORCED (2026-11-16) | `createPlant` puts a seed at `y = 0` wherever it is planted, growth places every node relative to its parent, and the client adds each node's own terrain relief (`planetTerrainY`) when it draws. Nothing may re-base a body onto `terrain.heightAt()`: `completeReroot` did, and rerooting onto a 16 m rise lifted the crown to `y = 16`. Test: `keeps the body on the ground when it reroots onto a rise`. | A move changes x and z only; a body keeps its shape relative to the ground. |
| INV-GR-19 | An organ in the growth menu can actually continue the body it belongs to. | ENFORCED (2026-11-16) | A `stem` offers `stem`, so a shoot stacks internodes; before this a plant with no `trunk`/`culm` unlock could not grow above one 35 cm segment and every body was a fan off a stump. Mutation-only tissues stay out of the base menu (`trunk`, `culm`, `rhizome`, `floating_leaf`). Test: `packages/shared/src/growth/nodeTypes.test.ts`. | Any new continuing organ needs a parent that offers it (E8, E11). |

## C. Time and simulation (`INV-TM`)

| ID | Invariant | Status | Evidence / failure | Fix |
|---|---|---|---|---|
| INV-TM-01 | One authoritative tick clock. | FIXED (2026-11-15) | One `TickClock` calls `World.onTick(tick, dt)` and every subsystem is stepped from that call. Near/dormant ticks are deliberate config sub-cadences banked inside `PlantWorld`, not independent clocks. Tests: `PlantWorld tier rates`. | Keep all new subsystems on the injected `dt`/`tick`; no wall-clock timers in simulation. |
| INV-TM-02 | Cooldowns and intent ticks use that clock. | PARTIAL | `growthCooldownUntil` uses `PlantWorld.tick`; intents are processed before the step. | Process intents after the tick increment, or use explicit ordering docs. |
| INV-TM-03 | `dt` matches the configured tick rate. | FIXED (2026-11-15) | `net_proto.tick_rate_hz` is the one rate: the clock, the wire and `PlantWorld`'s active tier all use it, and `World.setTickRate` updates the tier machine in the same call. `world.tick_rate_hz` and `world.active_tick_rate_hz` were deleted. | Keep one rate; a dev tick change must go through `setTickRate`. |
| INV-TM-04 | Tier rates come from config. | FIXED (2026-11-13) | Rates are stored and near/dormant tiers are scheduled by banking elapsed time, so each rate is exactly what config says. The old `dt * (active/near)` scale ran near plants at 4x upkeep and growth. | — |
| INV-TM-05 | Dormant catch-up uses elapsed wall time. | FIXED (2026-11-13) | The active/near path now writes `plant.lastTick` every step and a never-simulated plant records the mark instead of settling a phantom backlog. Catch-up also charges upkeep, advances growth already in flight, and credits photosynthesis for the skipped span, so an offline plant behaves like a live one except that it starts no new growth. The credit is bounded twice: `photosynthesisOverSpan` caps fixation at what the plant's stored water and minerals can pay for (so a multi-day span cannot multiply a per-second rate into an absurd number), and energy lands through `addPhotosynthesisEnergy`, which clamps to `computePlantCapacity`. Active plants are excluded from the tier hook because the online loop already credits them (no double-count), and a `lastTick` restored ahead of a fresh tick counter is re-anchored instead of exempting the plant. Tests: `finishes in-flight growth while dormant, and starts nothing new`, `feeds dormant plants with photosynthesis over the span they skipped`, `never photosynthesises an active plant through the hook`, `re-anchors a stale future lastTick instead of exempting the plant`, `bounds a very long catch-up by what the plant actually holds`, `fixes nothing for a zero, negative or non-finite span`. | Catch-up itself is still uncapped across a long server downtime. |
| INV-TM-06 | Roots never damage each other by contact. | REMOVED BY DESIGN (2026-11-13), clarified by ADR-051 | Root-overlap pressure damage, `offline_damage_multiplier` and the dormant damage multiplier were deleted: players may be symbiotic or grafted, so touching roots must not harm. Competition is resource theft from the shared tile, not HP. | Any future plant-vs-plant damage needs its own task and ADR. |
| INV-TM-07 | Photosynthesis fills energy. | FIXED (2026-11-09) | Only biomass is added (`main.ts:555`); `addPhotosynthesisEnergy` is never called. | Call it with the configured energy rate. |
| INV-TM-08 | Simulation time tracks wall time. | FIXED (2026-11-12) | The clock capped each callback's elapsed time at `max_frame_time_ms` and discarded the rest; with a ~114 ms tick against a fixed 50 ms step the server ran ~8.7 ticks/s and the day cycle stretched to 7 877–8 264 s against 3 600 configured. | Accumulator now adds real elapsed time (only a backlog beyond `max_frame_time_ms` is dropped), whole-grid soil passes run at 4 Hz, and the dirty-tile array is only built when a broadcast is actually due. Measured after: 20.0 ticks/s, day cycle 3 597 s. |
| INV-MU-01 | A held mutation is charged and visible. | ENFORCED (2026-11-16) | `PlantWorld.chargeMutationMaintenance` bills every held mutation in the active and dormant paths; `MUTATION_STATE` carries the same set to the owner. Upkeep never removes a mutation and never kills: the bill is paid out of energy, then biomass, and biomass stops at `upkeep_biomass_floor`, so an unpaid bill stalls the plant until it earns again. `mutation_upkeep` survives only as a legacy death cause in old saves. | Test: `holds an unpaid mutation bill at the floor instead of shedding or killing`. |
| INV-MU-03 | A size mutation is real tissue, and losing it is gradual. | ENFORCED (2026-11-16) | `syncMutationMass` fills parts to `quota × scale³` when the set grows; `absorbOversizeMass` drains the excess at `oversize_wilt_per_s` in both the active and dormant paths. Radii are derived from biomass only. | Tests: `keeps a shed size mutation's tissue and wilts it back gradually`, `levels a size mutation on the card the player picks, and grows the body`. |
| INV-MU-04 | Levels are server-dealt and player-chosen. | ENFORCED (2026-11-16) | `MUTATION_LEVEL` may only take a card from the deal the server laid out; cost, level cap and resources are checked in `checkLevelUp`. | `T04 mutation levels` tests. |
| INV-MU-05 | Every mutation has exactly one style record in `config/mutation_visuals.json`, keyed by its id, with a unique ordinal; a style that names no mutation is a startup error. | `loadVisuals` in `ops/mutations/config.ts`; tests "gives every mutation exactly one style", "ships a distinct style per mutation" |
| INV-MU-06 | A composed look never leaves its caps: tint inside `min_tint..max_tint`, variegation, glow, bark thickness, darkening and thorns at or below their ceilings, whatever the stack or the levels. | `composeFamily` in `client/renderers/plant/mutations.ts`; tests "stacked tints are clamped", "bark thickness ... stop at their ceilings", "a levelled mutation is visibly stronger, up to the caps" |
| INV-MU-07 | Appearance never changes simulation. A style paints; behaviour comes from `effects` (`vertical_bias`/`drooping_bias` are effects, not styles), so two mutations can never differ only by a shader. | `mutationEffects` in `ops/mutations/service.ts`; `applyMutationShapeBias` |
| INV-MU-02 | Mutation acquisition is server-only. | ENFORCED (2026-11-14) | `rollMutation` runs inside `tryGrow`; `MUTATION_SHED` can only remove, never add. | Keep the client free of acquisition paths. |
| INV-TM-09 | Broadcast rates honour config. | ENFORCED | `broadcastCadence.ts` banks elapsed ms against `net_proto.client_send_rate_hz` for STATE/KEYFRAME and the root readout; `net_proto.weather_send_rate_hz` (2 Hz) gates weather/day-night; keyframes ignore the state gate. `dev_log_network` reports sent/skipped counters. | `broadcastCadence.test.ts`; live check pending. |
| INV-TM-10 | `InterestManager` filters what each client receives. | PARTIAL (2026-11-13) | Growth events and new-plant payloads are now cell-filtered (`broadcastNear`); STATE/KEYFRAME totals and the whole-grid terrain update are still sent to everyone because they are world-wide data. | Filter remaining per-plant payloads if they grow. |
| INV-TER-01 | Client and server derive the same base surface. | HOLDS (2026-11-13) | Both call `terrainHeightAt` from `packages/shared/src/world/terrainField.ts` with the same seed/amplitude/octaves; only edits are streamed. | Keep the field free of THREE and platform randomness. |
| INV-TER-02 | Only edited chunks are stored. | HOLDS (2026-11-13) | `TerrainService` creates a chunk on the first edit; `terrain_chunks` has one row per active chunk and the base field is never serialised. | — |
| INV-TER-03 | A root tunnel removes its own volume, capped. | HOLDS (2026-11-13) | `recordRootTunnel` caps at `max_edit_volume_m3`, lowers the surface only within `surface_break_depth_m` + radius, and appends an edit. | — |
| INV-TER-04 | Unstable voids collapse and backfill. | HOLDS (2026-11-13) | `tick` runs at `collapse_cadence_hz`; stability rises with moisture and compaction, and a collapsed void lowers and loosens the soil. | — |
| INV-TER-05 | Soil strength changes root cost. | HOLDS (2026-11-13) | `PlantWorld` multiplies root energy and growth time by `growthResistanceAt`, clamped by `growth_resistance_min/max`. | Canopy growth is unaffected (it is in air). |
| INV-PHY-01 | Plant colliders match the drawn skeleton. | HOLDS (2026-11-13) | `planPlantColliders` derives capsules from parent→child segments and node radius; no biomass scaling is used. | — |
| INV-PHY-02 | Plant collider cost is bounded. | HOLDS (2026-11-13) | ≤192 colliders per plant, nearest 24 plants, chains merged beyond `collider_lod_distance_m`, rebuilds at 10 Hz only on a changed signature. | — |
| INV-PHY-03 | The server tick never runs Rapier. | HOLDS (2026-11-13) | Gameplay collision uses the shared analytic distance math; Rapier stays a client-side cosmetic layer. | — |

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
| INV-RS-13 | Canopy shading has a single source of truth. | ENFORCED (2026-11-14) | `getCanopyShadingAt` was removed with root attack; `ResourceWorld.updateLight` is the only shade path and reads `resources.canopy_shade_reduction`. | Keep the radius and strength in config. |
| INV-RS-14 | A root is visible exactly where the ground is open. | ENFORCED (2026-11-16) | The plant passes hide a fragment when the planet stands between the eye and it (`soilOccludes`). Above ground that test is a cylinder the size of the aperture, because the soil is cut in plan view — a sphere around the crown both hid deep roots that sat in the hole and exposed shallow ones outside it. Tests: `shaderSmoke`, `groundCutaway`. | Keep the aperture radius as the one source: `uRootSightApertureRadius` feeds the soil cut, the bowl mouth and the plant pass. |
| INV-RS-15 | A buried eye sees the cavity it opened. | ENFORCED (2026-11-16) | Two rules. The eye is told to the plant pass (`setCameraUnderSoil`) and the surface test is skipped, because dirt between a buried eye and a root is the medium the eye stands in. And a bubble of air (`root_sight.eye_window_radius_m`) is fused into the same envelope as the roots, so the soil skin is cut around the eye. Without both, a camera flown down into the pit saw a brown wall and no roots. | The window is added only when the cavity is already open, so a buried camera cannot excavate a hole the plant never dug. |

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
| INV-PR-06 | Load accepts only valid plants. | FIXED (2026-11-15) | `loadPlant` reconciles structural mass/upkeep, repairs segment drift, then runs `validatePlantGraph`; a corrupt snapshot throws and is skipped with a log (`plantWorld.test.ts`). | — |
| INV-PR-07 | Event log is append-only and complete. | FIXED (2026-11-15) | `PlantEventLog` records growth, damage, uproot, reroot and tier changes; written with every save, bounded by `event_log_compaction_threshold`, and seeded from `event_log` on boot. Deaths are appended to `world_events` before the plant row is deleted. | `plantEventLog.test.ts`, persistence tests. |
| INV-PR-08 | Migrations are ordered and unique. | PARTIAL | Version parsed as text split on `_`; no checksum. | Numeric version + applied table. |

## G. Accounts and security (`INV-AU`)

| ID | Invariant | Status | Evidence / failure | Fix |
|---|---|---|---|---|
| INV-AU-01 | Refresh tokens can be looked up by hash. | FIXED (2026-11-08) | Salted bcrypt on insert (`:228`, `:438`), re-hashed on lookup (`:379`, `:413`) → never matches. | Deterministic SHA-256 lookup hash, or opaque token id + bcrypt verify. |
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

## I. Light, weather feedback and damage cues (`INV-LT`)

| ID | Invariant | Status | Evidence / failure | Fix |
|---|---|---|---|---|
| INV-LT-01 | The scene lights have exactly one writer. | ENFORCED (2026-11-17) | `applyCelestialLighting` sets the sun, ambient and sky uniforms; `handleWeatherUpdate` no longer has a formula of its own. | Keep it that way: a second writer is a brightness step at the handover. |
| INV-LT-02 | Weather grades every light, not only the ambient. | ENFORCED (2026-11-17) | `WEATHER_UPDATE.lightMultiplier` grades the beam, the sky disk, the moonlight and the hemisphere fill (`celestial.test.ts`). | Any new light must take the same multiplier. |
| INV-LT-03 | Ambient follows the day curve continuously. | ENFORCED (2026-11-17) | `stepAmbientLighting` blends by `dayFactor`; dawn never dips below the night value. | No threshold switching. |
| INV-LT-04 | A damage cue is at most one pulse per second. | ENFORCED (2026-11-17) | `damageCueDue` refuses while a pulse runs and until the gap elapses; upkeep loss is coalesced to 2 Hz. | Data still updates on every message; only the animation is rate-limited. |
| INV-LT-05 | The client never invents a lightning strike. | ENFORCED (2026-11-17) | `ClientWeatherStateMachine` only fades a strike set by `triggerLightning`; the flow is `idle -> (WEATHER_STRIKE) -> flash -> idle`. | A bolt the server did not roll cannot be drawn. |
| INV-LT-06 | The sky grade is defined before any tile data. | ENFORCED (2026-11-17) | `localSkyBrightness` uses `dayFactor` until the first root readout, then the covered tiles. | No implicit full-daylight default. |

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

## I. Damage and uproot (`INV-DM`)

| ID | Invariant | Status | Evidence / failure | Fix |
|---|---|---|---|---|
| INV-DM-01 | A plant is in at most one uproot phase at a time. | ENFORCED | `uprootPlant` refuses when `plant.uproot` is already set; phase transitions happen in `updateUprootedPlant`. | Keep the guard on every new uproot trigger. |
| INV-DM-02 | Uproot always has a recorded cause. | ENFORCED | `UprootCause` is written into `PlantUprootState` and persisted from PLNT v3 (current snapshot: v4). | Keep the cause required in new triggers. |
| INV-DM-03 | Root contact never deals damage. | ENFORCED | `DamageSource` has weather/tool/herbivore/terrain only; no root-attack call site (ADR-051). | Reject any future plant-vs-plant source that is not a new task + ADR. |
| INV-DM-04 | A reroot places the plant on valid soil inside the window. | ENFORCED | `updateUprootedPlant` requires `windowRemainingS > 0`, a settled phase and `rerootSoilIsValid` before accumulating `settledSeconds`. | Keep the window and moisture check together. |
| INV-DM-05 | Every drop expires. | ENFORCED | `expireDrops` runs each tick against `expiresAtMs`; `DROP_EXPIRED` is broadcast. | Expiry must remain tick-driven, not client-driven. |

# Part 4 — Remediation plan (retired)

The phased plan and its progress log live in [`history.md`](./history.md) for the
record. Current status lives in the tables above: change an item there when its
enforcement changes.

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

**INV-RS-03 — Root Sight opens for a buried part, once, and yields to the key.**
A part that starts growing underground opens the view (`decideAutoOpenRootSight`)
when it is not already open or opening. The rule fires on the growth event, not
on a per-frame condition, so closing the view by hand stands until the next new
buried part. The cavity treats a part at 0% growth as soil-opening with a
25%-radius floor: growth and the opening start together.
