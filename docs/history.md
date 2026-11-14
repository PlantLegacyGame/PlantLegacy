# History

One chronological record of what changed, why, and what was wrong before. This
file is append-only and **not** part of the reference path: nothing here is
current state. For how the system works today read `CONTEXT.md`,
`docs/what-works-now.md` and the task records; for rulings read
`docs/decisions.md`.

It absorbed, unchanged, the dated audit sections that used to sit inside
`docs/what-works-now.md`, the v5.3.1/v5.3.2 revision notes and merge audit from
`DESIGN.md`, and the remediation plan and progress log from
`docs/state-machines-and-invariants.md`.

---

## Design revisions

**Revision note (v5.3.2, 2026-11-14).** No design rule or task scope changed. This revision corrects three internal contradictions found in review: the impostor representation and its VRAM row (Part 14.2.1), the billboard/atlas clause in C02, and the three competing LOD tier schemes, which now defer to one canonical table (Part 14.2.0). It also records that a season-end calamity is a burial under RULE_8, so T20's death pipeline and the rule agree. Decisions: `docs/decisions.md` ADR-041 to ADR-049.

**Revision note (v5.3.1).** v5.3.1 is v5.3 with the thirteen reviewed corrections applied: the checkpoint table is rebuilt so no gap exceeds four weeks; Gate 3 gets an explicit playtest week and corrected arithmetic; the T25/T26 and T14/T43 cut-list conflicts are resolved; the Root Sight shader is owned by T02 and merely reused by C03; H01 is decoupled from the real-money switch; every stale `A…` cross-reference is replaced with a real section or task reference; T15 no longer contradicts T51; the vocabulary rows for heirloom seeds and gene items match the built systems; the dependency matrix is completed (`C03`, `C05`, `C02b`, `T14`, `T20`, `T43`, `H01`); the duplicated Part 8.2 heading and its merge artifact are removed; RULE_16's checkpoint weeks match the checkpoint table (W67, not W65); and heirloom-seed planting is separated from T53 offspring seeds. Nothing else changes; where v5.3.1 and v5.3 conflict, **v5.3.1 wins**.


---

## v5.3.1 merge audit (DESIGN Appendix F.1–F.4)

## F.1 What v5.3.1 changes relative to v5.3

**Critical fixes (review #1–#6):**

1. **B3.2 checkpoint table replaced** so the maximum gap between checkpoints is four weeks. New checkpoints added at W26, W47, W51, W54, W56, W61, W70, W78. RULE_28 now holds and the final sign-off claim is true.
2. **Gate 3 arithmetic corrected.** W78 is an explicit Gate 3 playtest week; W79–80 are buffer and launch prep. Gate 3 arithmetic: 25 task-weeks + 1 playtest + 2 buffer = 28 weeks (W53–80). Gate 3 in B3.1 updated to match.
3. **T25/T26 cut-list conflict resolved.** Gate 3 cut list keeps the T25 core stub (root tunneling/voids and canopy light-blocking persistence) required by T26. Only optional T25 capabilities are cut.
4. **T14/T43 cut-list conflict resolved.** Gate 2 cut list keeps the T14 seller/listing data model and the `getSellerReputation` stub even if the T14 UI/auction/preview is cut. T43 cannot start without seller/listing identity; if T14 UI is deferred, T14 data model + stub must be scheduled at Gate 3 before T43.
5. **Root Sight shader ownership fixed.** T02 implements the Root Sight cutaway shader; C03 reuses/refines it. C03 dependency row now includes T00A.
6. **H01 dependency fixed.** H01 depends on all Gate 3 tasks *except* the real-money switch.

**Moderate fixes (review #7–#13):**

7. **Stale `A…` references replaced** with real Part/Task references throughout Parts 4–6, 11–18. The replacement map is in F.3.
8. **T15 stale text corrected.** T15 no longer defers extraction to post-MVP. T51 owns extraction/graft; T14 owns gene listing; T22 owns bloodline. T15 owns the gene schema, shared ID space, and mint-on-acquisition.
9. **Vocabulary rows corrected.** Heirloom seed row now states seed production (T06A) and death grant; gene item row now states T51 extraction and `mints_per_plant_mutation`.
10. **Dependency matrix completed.** Added: `C03 → C01, T07, T00A`; `C05 → C01, C04, T08A, T16, T06A, T20, T08C, T12`; `C02b → C02, T03, T04`; `T14 → T08A, T15, T13A, T06A (stubs: getSellerReputation, giftToGuild)`; `T20 → T06A, T07, T16, T13A`; `T43 → T08B, T16, T14 (T14 may be deferred; T14 seller/listing stub required if T14 UI is cut)`; `H01 → all Gate 3 tasks except real-money switch`.
11. **Duplicate Part 8.2 heading removed.** The "continued from cut-off" heading and the duplicated `No NPC vendors…` bullet are gone. Locked decisions form one continuous list.
12. **RULE_16 checkpoint weeks corrected.** "Weeks 13, 36 and 65 become checkpoints" is now "Weeks 13, 36 and 67 become checkpoints," matching the corrected checkpoint table (CP21 is W67).
13. **Heirloom-seed planting separated from T53.** T06A's planting bullet now names T22 (or a separate post-MVP seed-planting task). T53 covers offspring seeds from cross-pollination only.

## F.2 What v5.3.1 does *not* change

- The 80-week schedule, the 73 task-week total, the gate structure (24 / 52 / 80), and the task IDs.
- The RULE_1–RULE_31 list (only RULE_16's checkpoint weeks changed).
- The system specs' behavior; only references and dependency rows were corrected.
- The secrets policy (Part 9).
- All beta-bucket specs except T22 (planting bullet) and T53 (offspring-only clarification).

## F.3 `A…` reference replacement map

Applied globally to v5.3.1. After this patch, no standalone `A5.2`, `A8.1`, `A9.2`, `A11.4`, `A13-*`, etc. remain.

| Find | Replace with |
|---|---|
| `Part 13, A5.2` / `A5.2` | `Part 13.6` |
| `Part 13, A5.3` / `A5.3` | `Part 13.7` |
| `Part 13, A5.4` / `A5.4` | `Part 13.8` |
| `Part 13, A5.5` / `A5.5` | `Part 13.9` |
| `Part 13, A4.4` / `A4.4` | `Part 13.4` |
| `Part 14, A6.1–A6.3` / `A6.1–A6.3` | `Part 14.1.1–14.1.3` |
| `Part 5, A8.1` / `A8.1` | `Part 5, T06A` |
| `Part 5, A8.2–A8.3` / `A8.2–A8.3` | `Part 5, T51` |
| `A8.2` / `A8.3` | `Part 5, T51` |
| `A8.1-1` … `A8.1-6` | `Part 5, T06A` / `T06A planting bullet / T22` as appropriate |
| `Part 5, A9.2` / `A9.2` | `Part 5, T05 (report/block) and T40 (admin triage)` |
| `A11.4` | `Part 6.1 condition matrix` |
| `A13-1` | `Part 16 item 1` |
| `A13-2` | `Part 16 item 2` |
| `A13-3` | `Part 16 item 3` |
| `A13-4` | `Part 16 item 4` |
| `A13-5` | `Part 16 item 5` |
| `A13-6` | `Part 16 item 6` |
| `A13-7` | `Part 16 item 7` |
| `A13-8` | `Part 16 item 8` |

## F.4 Retained v5.3 content

Every v5.3 system spec is retained in v5.3.1, including: T00A consumption triggers; T01 root competition and canopy shading; T02 camera/substrate and now shader ownership; T03 event bus, A5.2 tiers (now Part 13.6), A5.3 interest (Part 13.7), A5.4 protocol (Part 13.8), A5.5 persistence (Part 13.9); T04 movement block; T05 dual chat + report/block; T06 damage pipeline, kill credit, dung, reroot crawl, fragment drops and remains; T07 day/night and weather phases; T08A inventory with flags, bundles, duplication audit, fragment and offspring seed categories; T08 session feedback; T08B account progress; T12 one archetype; T10 parasitism; T13 currency and P2W closure; T15 gene schema; T13A 3×3 boosters with thunderstorm column; T14 UI marketplace; T16 ledger; T17 naming; T06A heirloom; T20 deep time; T43 reputation; T44 guilds; T45 mail + Gift Bundles; T50 Starter Pack; T46 status/rank display only; T23–T26 frameworks; T40–T42 launch minimum; real-money switch.


---

## Status and audit log

## Audit corrections (2026-11-06, resolved 2026-11-09)

The full inventory of implicit state machines and unenforced invariants, with
stable ids and a phased remediation plan, is in
[`state-machines-and-invariants.md`](./state-machines-and-invariants.md).

This section records the findings from the 2026-11-06 audit and their
resolution. All four networking defects are fixed:

- **`RESOURCE_UPDATE` oversize — fixed.** The per-tick broadcast now sends only
  the player's local tile read directly from the resource grid, not `getState()`
  (which returns only dirty tiles). Initial `RESOURCE_QUERY` accepts
  `worldX`/`worldZ` and returns `tileX`/`tileZ`, the real `tileSize`, and the
  plant's energy/biomass.
- **Anonymous reconnect — fixed.** `removePlayer` keys anonymous plants by
  `anon_<plantId>` and `reclaimPlantById` looks up the same key, so a reconnect
  restores the existing plant instead of creating a new one.
- **Own plant sync — fixed.** The client applies its own plant from `PLANT_SYNC`,
  `WELCOME`/reclaim include the full node set, and germination is broadcast as
  `GROWTH_EVENT` with `newNodes` and `updatedParentNode`.
- **`PLANT_REMOVED` on disconnect — fixed.** Disconnect keeps the plant for the
  reconnect window. Removal is queued through the death pipeline and broadcast
  only when the window expires or the plant dies.

Still true from the earlier list:

- Root rendering uses WebGPU mesh tubes with Murray's law tapering; SDF
  raymarching is not used for roots.
- Per-tick `console.log` spam was removed.
- `dayNightCurve` indexing is clamped.
- The client resolves resource tiles by `tileX`/`tileZ`, not by array index.
- Seed biomass and node costs were retuned so growth is affordable.

## P0 blockers resolved (2026-11-09)

1. Plant sync and germination: own `PLANT_SYNC` is applied; germination
   broadcasts `newNodes` + `updatedParentNode`; `WELCOME`/reclaim include nodes.
2. Anonymous reclaim keying and delayed `PLANT_REMOVED` (ADR-021).
3. `RESOURCE_UPDATE` payload size and initial `RESOURCE_QUERY` (ADR-024).
4. Growth interaction correctness: two-step gene-gated growth, energy vs
   biomass, dt-scaled root damage, zero-biomass removal, `lateral_root`
   validation, real tile moisture (ADR-018, 019, 025).
   - Root overlap damage is multiplied by `dt` and is covered by a regression
     test that compares one 0.1 s step with two 0.05 s steps.
   - Every death cause now goes through one queue drained after
     `PlantWorld.step()`: minerals are deposited once, the owner is detached,
     and `PLANT_REMOVED` is broadcast once.
   - Germination sets `plant.rootNodeId` to the transformed seed, so energy
     upkeep, resource targeting and death deposits see a root.
   - Photosynthesis now applies both biomass and energy at their per-second
     config rates scaled by `dt`.
5. Cube avatar removed; WASD pans camera only (ADR-022).

## Audit corrections (2026-11-09, extended)

Additional fixes beyond the original P0 blockers:

- **Save format versioning & CRC32** — envelope with magic/version/length/crc32, growable buffer, float64 age, persisted event log, per-plant try/catch.
- **Seeded RNG for deterministic rendering** — `hash32`/`hash01`/`mulberry32` in shared math; PlantMeshBuilder uses node ID salts.
- **Auth hardening** — refresh rotation order, atomic rate limit upsert (migration 004), JWT secret required in prod, lockout extension, pool error logging.

`pnpm verify` is green: lint, typecheck, config validation (78 files), 57 shared
tests and 148 server tests (229 total).
**T05 Communication** is built: chat panel (`T` key) with proximity/world tabs,
send/broadcast flow end-to-end, rate-limited world chat, emote wheel (`E` key)
sending `/emote <id>`, and block/report controls on every chat message with
server-side report storage and rate limiting.
## Documentation audit (2026-11-12)

Stale documents were corrected against the code and a live server:

- `docs/protocol.md` now documents every message type through 30
  (`GROWTH_OPTIONS_*`, chat, block, report, inventory, dev), the two shapes that
  share `RESOURCE_UPDATE`, and states that server-side movement validation is
  not wired.
- `docs/tunables.md` counts were recomputed from `config/*.json`: 78 files, 23
  populated, 56 stubs, and seven file rows plus the `render`/`resources`
  headings were wrong.
- Password hashing is Argon2id (`@node-rs/argon2`); `bcryptjs` only verifies
  legacy rows. `CONTEXT.md`, `DEVELOPER_REFERENCE.md` and this file said bcrypt.
- `docs/tasks/T03P.md` claimed live velocity/bounds rejection; the rejection
  logic exists but `validateMovement` has no call sites. Movement is camera-only.

Still open and verified live: broadcast throttling is not applied (`STATE`
~18/s, `WEATHER_UPDATE` ~20/s, `RESOURCE_UPDATE` 20–40/s), interest-cell filtering now covers growth events and plant creation, but `STATE`/`KEYFRAME` still reach everyone (INV-TM-10), and a rejected germination destroys the
seed with no respawn.

## Hardening pass (2026-11-13)

- **Per-connection message budget.** `net_proto.max_messages_per_second` (120) and
  `message_burst` (240) cap every inbound message on a socket; the chat, report
  and growth limits sit behind it. `apps/server/src/ops/rateLimiter.ts` plus tests.
- **Dev tooling is local-only.** `/dev/config` and `DEV_ACTION` now require
  `NODE_ENV=local` (unset counts as local). Previously any non-production
  environment, `staging` included, could mutate the running world.
- **Plant saved on disconnect**, not only every `plant_save_interval_s`, so a crash
  right after someone leaves cannot cost that window.
- **Offline plants behave like live ones.** Dormant catch-up charges upkeep,
  advances growth already in flight, and credits photosynthesis for the skipped
  span, bounded by stored water/minerals and clamped to plant capacity. Active
  plants are excluded from the tier hook, so nothing is credited twice.
- **No growth event is dropped** when a growth only replaces the parent
  (germination), and the dead `damageDealt` wire field is gone.
- **Offline plants are visible to online players.** `PLANT_SYNC` and the
  cell-crossing `PLANT_CREATED` re-announcement used to be built from the
  connected-player list, so a plant whose owner had disconnected (or that was
  restored from a save) was simulated, blocked tiles and could be grown into
  while being invisible to everyone. Both now select plants from the world by
  interest range (`ops/plantVisibility.ts`, 6 tests); connectivity is no longer
  part of the visibility rule.
- **`STATE`/`KEYFRAME` are per player**, carrying only their own plant plus
  plants inside their interest cells, and a cell crossing re-announces newly
  visible plants.
- **Entry screen rebuilt on the HUD palette.** The title/sign-in/sign-up/
  plant-lost screens mount in the UI shell's `modal` layer (400) instead of a
  `z-index: 1000` div, so toasts (500) and the debug overlay (700) stay above it
  and the HUD stays below. Card, inputs, buttons and errors use the loam/bark/
  leaf/ember tokens with Nunito display type, and it is readable at 375 px with
  no horizontal overflow.
- **The keyboard belongs to the entry screen while it is up**: the camera and
  grow-mode producers ignore keys until the world is ready, so typing a password
  cannot pan the camera.
- **Logout exists.** A signed-in player gets an account chip in the HUD with
  Sign out, which revokes the refresh session through `/auth/logout`, clears the
  stored tokens and closes the socket without the auto-reconnect re-adding them
  as a guest.
- **Losing a plant no longer signs the player out.** `PLANT_REMOVED` and
  "Plant a new seed" used to call `clearReconnectData()` and wipe the account
  tokens too, silently demoting a signed-in player to guest; they now clear only
  the plant identity.
- **Logging out is no longer a death sentence.** With persistence enabled, a
  disconnect used to schedule `removePlant` at the end of the reconnect window;
  that is `killPlant(..., 'removed')`, so the plant was broadcast as
  `PLANT_REMOVED` to every player and its tiles were released while the saved
  row survived. The window now governs only reclaim bookkeeping: the plant stays
  resident, keeps simulating at dormant tier, stays visible, and its owner can
  reclaim it later. Without persistence the old immediate removal still applies.
  Note `world.persistence_enabled` defaults to `false`, so local play still
  removes plants on disconnect.
- **Dead plants are deleted from persistence** (all causes except the
  administrative `removed`). Nothing deleted rows before, so a starvation death
  was reloaded from its last snapshot on the next restart as a living plant.
- **Guest plants follow the account.** If a signed-in HELLO carries the guest
  plant's id and a valid reconnect token, the plant is reassigned to the account
  instead of a second plant being created and the first abandoned. Account-owned
  plants are never adoptable, and neither is a plant someone is currently
  tending (`ops/plantOwnership.ts`, 5 tests).
- **Away report on return.** The server keeps a disconnect snapshot (stores and
  node count) and a reclaim or reuse returns an `away` block on WELCOME; the
  client shows a terse "Away 6 h 12 m" panel with node and store deltas. The
  snapshot is in-memory, so a restart reports nothing rather than a fabricated
  baseline.
- **Away upkeep is settled income-first.** A dormant plant is credited with the
  sunlight of the span it skipped *before* it pays upkeep for that span, so a
  plant at zero energy no longer loses structure (or dies) while the sun over
  the same span would have covered the cost. Covered by a dormant-tier test.
- **Dev actions tell the truth.** Dev responses are read as the server sends
  them (`ok`/`error`), so a successful action says applied instead of failed;
  toggles move when clicked; Regenerate sends a fresh WELCOME so the client
  adopts the new seed immediately; Kill Plant and Regenerate settle the death
  at once, so they work with the simulation paused; tick-rate changes are
  clamped to a sane range.
- **Dying while away is reported.** A real death records a per-owner notice;
  a returning account whose plant is gone now gets `previousPlantDied` on
  WELCOME and a panel naming the cause and how long ago, instead of a silent
  replacement seed. `removed` (persistence off) is administrative and is never
  reported as a death. Deaths are also keyed by plant id, so a guest who comes
  back with a dead plant's token learns what happened even though their owner id
  died with the old connection.
- **The calendar survives a restart.** `world_state` holds one row per world
  (season, ticks left, last calamity time), written on every rollover, on the
  periodic save cadence and on shutdown, and restored at boot so a deploy cannot
  reset the season or skip one. Remaining ticks are stored rather than an
  absolute tick, because the counter restarts at zero each boot; a corrupt
  remainder is clamped (over-length becomes a full season, nothing left ends
  now). The migration is `005_create_world_state_table.sql`.
- **Seasons end, and the end is an event.** The world runs a tick-based season
  clock (`world.season_length_days`, 36 by default) and sends the season plus
  its remaining seconds on join and on every rollover; the HUD counts down
  locally in days and hours. When a season ends the calamity kills every plant
  still standing (`cause: "calamity"`), each removal reaches its owner's loss
  screen with that cause, and the next season starts from bare soil. The dev
  panel's Simulation tab can end a season immediately to exercise the path.
- **Sign out says what it means.** The account chip is two-step — "The world
  keeps running" with Sign out / Stay — and a second session on the same account
  now sends `SESSION_REPLACED` to the older tab instead of letting it reconnect
  silently as a guest.

## Planet world, stage 1 (2026-11-13)

- **The ground is the whole planet, not a cap and not a plane.** `render.json`
  `planet_radius_m` (100000, i.e. a 100 km world) is both the radius and the
  only ground geometry: one sphere, so there is no rim to walk off, no seam
  between a local cap and the body under it, and no second layer to see through
  the sky. The physics floor is the same sphere (Rapier ball collider), so the
  player can traverse the entire body. `0` restores the flat plane and its box
  collider. `renderers/environment/planetSurface.ts` holds the surface math
  (drop, surface point/normal, body sphere) with 9 tests.
- **Plants sit on the surface.** Server nodes keep their flat simulation
  coordinates; `surfacePosition()` drops each by the sphere's sag at its
  horizontal distance, so a plant away from the pole is not left floating over
  the curved ground.
- **Planet body and terrain are one mesh.** The soil material is applied to the
  sphere itself, so the same tiles wrap the whole globe and there is nothing
  sitting under the ground to show through a cut.
- **The flat grey sheet under the dirt is gone.** Two separate causes: the sun's
  shadow map had no bias, so the soil self-shadowed at low sun angles
  (`shadow_bias`, `shadow_normal_bias`); and the WebGPU layer stamped its own
  500 m ground plane at `y = 0` over the terrain, which hid the curvature and
  hung a slab below it wherever the ground fell away. The WebGPU ground plane is
  removed; the soil shader owns the cutaway.

- **Ground grain is tunable and much softer.** `soil_grain_strength` (0.02) and
  `soil_mineral_strength` (0.05) replace the hardcoded 0.08 per-pixel hash and
  0.12 tile mineral tint. At the old values the dirt read as speckle; the Root
  Sight dome's smooth soil tone is the target.
- **Planet view is a settings action.** Dev panel → Camera → Orbit Planet
  orbits the whole body, and Local View returns to the observer camera. It has
  no key binding by request. Orbit distance, near plane, far plane and orbit
  limits derive from `planet_radius_m` times the `planet_view_*_multiplier`
  tunables, so any planet size frames correctly; fog is off and plant framing
  and camera collision are suspended while it is on. The planet body uses the
  ground's soil shader, so it is lit and tiled rather than a flat silhouette.
- **The tile grid wraps the sphere.** The soil shader converts each fragment to
  arc-length surface coordinates around the planet's pole
  (`uPlanetCenter`/`uPlanetRadius`/`uPlanetEnabled`) before sampling the resource
  grid, so tiles stay square and evenly spaced instead of compressing toward the
  rim. The grid texture repeats, which carries the tiles past the cap and around
  the rest of the body.
- **Root Sight keeps its soil.** The cutaway is a window into the ground, drawn
  by the soil shader that owns the surface: opening, interior wall and rim come
  from one surface, so nothing floats against the sky.
- **Gravity and up on the sphere.** `planetUp()` and `planetGravity()` return the
  surface normal and its opposite (toward the centre), with tests.

- **The camera's up follows the surface normal.** Each frame the local view
  computes the normal at the orbit target (`target.y + planet_radius_m`) and
  makes it `camera.up`; planet view uses world up. OrbitControls takes
  `object.up` as its orbit axis when it is constructed and keeps that frame for
  the life of the instance. Rather than writing to its private cached frame,
  `applyCameraUp()` replaces the controls with a fresh instance through the
  public constructor whenever the normal has moved more than 1.1 degrees
  (`CONTROL_UP_EPSILON`), carrying the target and every user-facing setting
  across. The threshold is far below a visible tilt, so this only happens when
  the play area is much larger than the current clearing. At 100 km the tilt is
  0.34 degrees across the whole clearing, so the effect is small today but the
  frame is right for larger play areas. Verified live: orbit preserves distance,
  pan translates target and camera together, and a target 3 km out reports
  `controlsRebuilt: true` with `camera.up` equal to the normal there.
- **The ground is procedural soil, not a textured sheet.** `ground.ts` synthesises
  the dirt from world-space value noise: metre-scale clods, several-metre damp
  patches, fine grit, small buried grit stones, and a noise-gradient bump on the
  surface normal so clods catch the light. There are no image textures anywhere
  in the material, so it cannot tile, stretch or need attribution. Detail is
  sampled in world metres rather than planet arc-length coordinates — at 100 km
  radius the arc coordinate reaches ~157 km, and float precision there aliased
  the noise into a near-black surface.
- **Soil has a physical model** (`packages/shared/src/world/soilPhysics.ts`):
  bulk density from moisture and compaction, porosity and void ratio, suction
  cohesion that peaks when damp and collapses when saturated, angle of repose
  that shallows with water, Terzaghi cavity-span stability, cavity collapse and
  loose-fill settlement. All pure functions with 9 unit tests in the shared
  suite. The world does not consume this model yet — the ground shader uses the
  existing moisture/light/mineral fields for colour, not density or voidage.
- **Root Sight is an organic multi-node envelope, and the earth domes are gone.**
  The radial rings were the soil dome drawn under the terrain (the WebGL
  `soilDome` hemisphere while the WebGPU layer is unavailable, and the WebGPU
  bowl when it is), not the planet: the domes are single-colour or banded
  spheres whose geometry rings showed as concentric circles. Both are removed,
  along with the unused WebGPU `ground.wgsl` that still carried the old bubble
  cutaway. The soil shader marks the near half of each fused node bubble
  (`uRootSightCamera`, `uRootSightNodes[64]`, `uRootSightNodeCount`) and marches
  the void from the eye: entry at the cut, exit on the far side, shaded as the
  bubble's interior wall. Because the wall is a world position it shifts with the
  camera, so the opening reads as a bowl with parallax from oblique and
  underground angles instead of a dark patch painted on the surface. There is no
  cavity mesh and no dirt backdrop; the earlier camera-centred sphere
  (`environment/dirtBackdrop.ts`) and the ray-marched wall mesh
  (`environment/rootSightCavity.ts`) have both been deleted, so no second
  surface can show through the sky.
- **Spherical tile addressing exists.** `packages/shared/src/world/sphericalGrid.ts`
  (`@plant-legacy/shared/world`) divides the planet into equal-angle latitude
  rings whose cell count follows each ring's circumference, and answers
  `cellForSurfacePoint`, `cellToSurface`, `cellKey`/`parseCellKey` and
  `neighbours`. Neighbours are true: east and west wrap around the planet, north
  and south clamp at the poles, and ring changes keep the same longitude. Ten
  tests cover round-trips, wraparound, pole clamping, neighbour symmetry and
  cell spacing. The module does not allocate a planet-wide grid: at 100 km and
  1 m cells that would be about 1.3e11 cells.
- **The resource field runs on those cells.** `apps/server/src/ops/tileAddressing.ts`
  chooses flat addressing (a cell per lattice tile, the old topology) or
  spherical addressing when `render.json` `planet_radius_m` is positive;
  `ResourceWorld` stores one record per cell and asks the addressing for
  neighbours. On the 100 km planet that means diffusion crosses the pole ring and
  connects tiles the flat array treated as diagonal. The 256x256 lattice remains
  as a sampling view, so `getAllTiles`, the compact grid buffer and the soil
  texture are unchanged. Verified by tests that diffuse between two pole cells
  the flat grid keeps apart, and by all 179 server tests passing in both modes.
  Construction of the spherical field for the production bounds takes ~200 ms at
  boot; a 4 Hz soil step measured ~108 ms in a standalone script.

Still flat in the simulation: physics treats the play area as a plane at the
pole, and plant nodes stay in the pole-local coordinate frame (the client
reprojects them). Persistence has no idea about cells. Spherical physics and
local gravity need server-side work. The local far plane is 2500 m so the sky
dome (930 m) is not clipped into a faceted wall above the horizon.

## T25: shared terrain, colliders and physical dirt (2026-11-13)

- **One ground field.** `packages/shared/src/world/terrainField.ts` is a seeded
  integer-hash fBm shared by the server and every client renderer. The client
  draws an inner detail patch and a 620 m outer patch as children of the planet
  body, and Rapier collides with the exact drawn vertices of both.
- **One cavity field.** `cavityField.ts` clusters underground nodes (own plant
  first, rival budget 24, ≤64 bubbles) and is the single answer for the soil
  cut, plant occlusion and the camera's underground limit. The WebGPU frame
  still carries one covering sphere rather than a bubble array; that is a
  deliberate conservative bound (documented in `docs/tasks/T25.md`).
- **Plant colliders.** One fixed body per plant, capsule per drawn segment,
  seed ball, leaf boxes, group masks and a 24-plant/192-collider budget. The
  same planning function backs the server's analytic collision, so the client
  never invents geometry the simulation disagrees with.
- **Physical dirt.** Sparse 32×32 chunks store height delta, moisture,
  compaction and voids. Root growth digs its own tunnel, lowers shallow
  ground, spreads a displacement ring, compacts the wall and leaves a void
  that collapses when dry and loose. Growth resistance raises root energy and
  time in compact/deep soil. Chunks, append-only edits and voids persist in
  PostgreSQL (`006_create_terrain_tables.sql`) and reload at boot.
- **Protocol 32–34.** `TERRAIN_REGION_REQUEST`, `TERRAIN_REGION` and
  `TERRAIN_EDITS`. Tunnels are replayed on request and broadcast near the new
  root, so a reconnecting Root Sight still sees them.

Not yet: height deltas are not written into a chunk texture on the client, so
the lit ground does not yet show a surface sink; debris bodies, rain-on-leaf
droop and the dev collider overlay are also pending.


---

## State-machine remediation and progress

The remediation phases below were the audit's working plan. They are kept for
the record; current invariant status lives in
`docs/state-machines-and-invariants.md`.

### Part 4 — Remediation plan

Phases are ordered by risk × blast radius. Do not start a phase until the
previous phase is green in `pnpm verify`.

### Phase 0 — Stop the bleeding (single-file fixes)

| Item | Change | Acceptance |
|---|---|---|
| P0.1 | Weather durations read from config; remove zero-duration shadowing; clear/rain last their configured range. | New unit test asserts a clear state survives `dt < min` and advances after `max`. |
| P0.2 | Refresh token: store a deterministic SHA-256 lookup hash (or opaque id); keep bcrypt for passwords. | Login → logout revokes; refresh rotates and old token is rejected. |
| P0.3 | Remove the aggregate upkeep subtraction (keep per-node subtraction) **or** make `totalUpkeep` a derived cache and use only one. | Upkeep per tick equals the sum of node upkeeps; test asserts the rate. |
| P0.4 | Client HELLO sends `accessToken` and stored anonymous `plantId`; server reclaim paths use one key builder. | Reload with persistence enabled reclaims the same plant. |
| P0.5 | Photosynthesis calls `addPhotosynthesisEnergy(plantId, rate * dt * leafFactor)`. | Energy rises in light, falls in darkness; config drives the rate. |
| P0.6 | `RESOURCE_QUERY` schema: pick tile or world coords and convert in one place. | HUD reads the correct tile after one query. |
| P0.7 | Germination returns/broadcasts inserted nodes and energy. | Client renders the root crown without a manual resync. |
| P0.8 | `savePlant` writes `tier` and `lastTick`; `loadPlant` validates `rootNodeId`. | Reload a saved plant and compare totals/tier. |

### Phase 1 — Formalize the machines

1. Wire `reconnectStateMachine` and `growthIntentStateMachine` into `World`;
   delete the duplicate closures.
2. Introduce `killPlant(id, cause)` and route every death path through it.
3. Introduce `ConnectionRegistry` (one message handler, one HELLO, one close
   path, old-socket transfer on reclaim).
4. Introduce `PlantMirror` on the client with `growthSeq` gap detection and
   `PLANT_SYNC` recovery.
5. Replace the weather visual booleans with an explicit transition state.

### Phase 2 — Boundary validation and tests

1. `validatePlantGraph(plant)` — root, reciprocity, node ids, plantIds, totals,
   bounds; call after load and in dev every N ticks.
2. Protocol schemas at `onmessage` (server and client); reject malformed
   messages with `ERROR` instead of dropping them.
3. Config validators for cross-field rules (weather durations, condition
   mapping, resource maxima, tier rates).
4. Property tests: random plant graphs round-trip save/load; totals conserved;
   no node without a parent; tile values in range after N ticks.

### Phase 3 — Consolidation and performance

1. One tick clock; fixed-step accumulator; throttle broadcasts by config.
2. Wire or delete `InterestManager` entity cells.
3. Move every remaining hardcoded tunable to config (INV-CFG-01).
4. Fix diffusion, double deposits, and texture of read-only accessors.

---

### Progress log

| Date | Item | Change |
|---|---|---|
| 2026-11-08 | — | Initial audit written. |
| 2026-11-08 | DEF-01 / INV-RS-04 / INV-RS-05 | Weather durations, light multipliers, and moisture rates now read from `WeatherConfig`. Clear/rain no longer have zero duration. Forecast is the preselected `machine.nextState`. Tests added in `apps/server/src/ops/weather.test.ts`. |
| 2026-11-08 | DEF-03 / INV-GR-06 | Upkeep recomputes the node-sum `totalUpkeep` and subtracts it once per tick (active and dormant). Test added in `apps/server/src/ops/plantWorld.test.ts`. |
| 2026-11-08 | DEF-09 / DEF-12 / DEF-16 | Persistence writes the real tier/`lastTick`; session limit no longer revokes one too many; tile writes and initial tiles clamp to per-resource maxima. |
| 2026-11-08 | DEF-10 / INV-RS-03 | Diffusion accumulates all four neighbours and lerps toward their mean. Test added in `apps/server/src/ops/resourceWorld.test.ts`. |
| 2026-11-08 | DEF-02 / INV-AU-01 / INV-AU-11 | Refresh token uses deterministic SHA-256 lookup hash alongside bcrypt password hash. Login → logout revokes; refresh rotates and old token is rejected. |
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
| 2026-11-12 | Tick clock keeps wall time | Server was running ~8.7 of 20 configured ticks/s because the fixed-step clock threw away elapsed time beyond `max_frame_time_ms`; day/night cycle measured 7 877–8 264 s instead of 3 600. Clock now accumulates real elapsed time (backlog still capped to avoid a spiral), `ResourceWorld` runs moisture/minerals/diffusion on a 4 Hz accumulator with full elapsed dt, and `main.ts` counts dirty tiles before building the ~65k-entry broadcast array. Measured after: 20.0 ticks/s, cycle 3 597 s. Also moved the growth panel to the bottom-left column so it no longer covers or hides the chat box, and raised soil moisture (base 40→150, evaporation 0.1→0.025/s, rain 0.5→1.5/s) so ordinary dirt is damp instead of cracked-dry. |
| 2026-11-12 | Documentation audit | Corrected `docs/protocol.md` (message types 7–30, both `RESOURCE_UPDATE` shapes, movement not server-validated), `docs/tunables.md` (counts recomputed from `config/`: 77 files, 21 populated, 56 stubs), Argon2id vs bcrypt in `CONTEXT.md`/`what-works-now.md`/`DEVELOPER_REFERENCE.md`/`ATTRIBUTION.md` (`docs/data-model.md` was already correct), T03P movement claim, and the 75→77 config count in living docs. Verified live: INV-TM-09 still unenforced, INV-TM-10/INV-NET-14 still unwired, INV-AU-12 still PARTIAL. |

---

