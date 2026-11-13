# What works now

Honest list. No feature promises (T42, RULE_13). Updated at every gate.

## Working

- Monorepo, CI, config validator with the rarity ban, Docker image and compose
  stack, `/health` and `/ready`.
- One-command local start (`pnpm dev`) and a strict verify chain (`pnpm verify`).
- **T03P networking gate:** two tabs, one server, server-authoritative
  plant state over WebSocket + JSON at 20 Hz. WASD/arrows pan the camera.
  Server validates growth intents (energy, biomass, gene gates, bounds) and
  broadcasts `GROWTH_EVENT` on success.
- **C01 client foundation:** Vite 8 + Three.js r187 scene, orbit/zoom/pan
  camera (`OrbitControls`), WebSocket connection, responsive canvas, lighting
  and shadows. **Input abstraction** with named actions and producers
  (keyboard/mouse), bindings loaded from `/config/controls` (rebindable).
  **UI shell** with layered DOM overlay (hud/panel/menu/modal/toast/tooltip/debug),
  theme tokens as CSS variables, global text-scale (80–150%), toast notifications.
  **Quality controller** with hardware-tier detection and dynamic pixel-ratio
  scaling to hold target FPS. **Debug overlay** (`\`` key) shows fps, frame ms,
  triangles, draw calls, memory, network KB/s. **Pause on hidden tab**.
  Config served via `/config/render`, `/config/controls`, `/config/ui`.
- **Client entry flow (2026-11-13):** title screen with Sign in / Create
  account / Play as guest, and a reload-free "Plant a new seed" screen after a
  plant dies. The client now calls `/auth/signup`, `/auth/login` and
  `/auth/refresh`; until this it had no auth UI and never obtained an
  `accessToken`, so accounts were unreachable from the game even though the
  server supported them. An expired access token is refreshed before `HELLO`
  (the server answers a bad token with `AUTH_FAILED` rather than falling back to
  guest), and a refused refresh drops the dead session. Sign-in needs the
  Postgres-backed account service; without a database the form reports
  "Accounts are unavailable right now." Covered by
  `apps/client/src/ui/EntryFlowStateMachine.test.ts` and
  `apps/client/src/auth/authClient.test.ts`.
- **T00A onboarding:** dismissible three-line hint card and tooltips on the
  light / water / minerals readout, loaded from `/config/onboarding`.
- **Growth economy (2026-11-12):** roots capture water and minerals from the tile they occupy (`absorbResourcesFromTiles` + `ResourceWorld.takeFromTile`, so ambient supply is finite and actually debited); photosynthesis converts *light level* plus the plant's own stored water and minerals into energy, and is now the only income channel — it no longer creates structural biomass, so sprouting a radicle can never inflate the seed. Cotyledons count as photosynthetic organs. Respiration burns energy day and night (a lone ungerminated seed is the only exemption), water loss drops to `night_transpiration_multiplier` at night, and a plant only loses structural mass when it has no energy left. Growth after establishment additionally requires stored water/minerals. Storage capacity is derived from the plant's own biomass, never a global cap. Covered by `apps/server/src/ops/growthEconomy.test.ts` (establishment → capture → stem, no biomass from light, night drawdown).
- **T01 growth & C02 plant renderer:** server-authoritative typed-node growth with root competition, canopy shading, root attack. **C02 procedural plant renderer** renders plants as unified organic living bodies via Raymarched Signed Distance Fields (SDF) with polynomial smooth minimum (`smin`) primitive fusion, continuous 3D triplanar noise, vertex wind sway, Inigo Quilez ambient occlusion (AO), and local bounding volumes. Features botanical Murray's law allometric tapering (sturdy base trunk tapering into delicate twigs aloft), paper-thin elliptic lancet foliage (eliminating hockey-puck disc thickness), smooth branch collar fillets without joint lumpiness, and real-time 0.9s growth emergence animations for seed split, shoot elongation, and leaf unfurling. Full geometric bounding box frustum culling guarantees branches extending from bases behind the camera remain fully visible.




- **T00A:** tile resource model (light/moisture/minerals), onboarding hint card
  and tooltips.
- **T03 multiplayer world:** plants persist across disconnect (binary snapshot +
  event log in Postgres). Offline simulation tiers (Active/Near/Dormant) with
  catch-up integration. Interest management with spatial cells and entity caps.
  Event bus for decoupled game events. Tick-budget metrics logged per tick.
  **Reconnect window (5 min), PLANT_SYNC on join, PLANT_CREATED/PLANT_REMOVED
  broadcasts and PLANT_SYNC_REQUEST on tab visibility are implemented.
  Authenticated and anonymous reclaim restore the full node set, and
  `PLANT_REMOVED` fires only when the reconnect window expires or the plant
  actually dies.**
- **Versioned plant persistence (2026-11-09):** `serializePlant` uses a growable buffer with envelope (`PLNT` magic, u16 version, u32 length, u32 CRC32). `age` stored as float64. `event_log` column now persists `PlantEvent[]` per save. Periodic save loop has per-plant try/catch. 13 new tests cover round-trip (1/10/100/2000 nodes), UUID ids, corruption detection, fractional age.
- **T08C accounts and sessions:** sign-up, login, logout, token refresh;
  Argon2id password hashing (legacy bcrypt hashes still verify and are rehashed on
  next login); JWT access (15 min) + refresh (30 days) tokens with
  rotation; IP rate limits and account lockout after failed attempts; WebSocket
  auth via HELLO accessToken; plant ownerId = accountId for persistence.
  **Auth hardening (2026-11-09):** refresh token rotation inserts new session before revoking old; rate limiting uses atomic upsert with unique constraint (migration `004`); JWT secret required in production; lockout extends on failed attempts during lockout; pool errors logged not swallowed.
- **Seeded deterministic RNG (2026-11-09):** `hash32`, `hash01`, `mulberry32` in `@plant-legacy/shared/math`. PlantMeshBuilder uses `hash01(nodeId, salt)` for leaf normals and branch curvature — deterministic appearance per node, no `Math.random()`.
- **T07 Weather & Day/Night:** 5-state weather state machine (`clear`, `rain`, `thunderstorm_telegraph`, `thunderstorm_active`, `thunderstorm_aftermath`) with Markov transition probabilities, day/night diurnal orbital cycle (1800s day, 0.66 day fraction, dynamic solar elevation and intensity), server tick integration modifying `ResourceWorld` moisture deposition and canopy light reception in real time, client `WEATHER_UPDATE` broadcast handling adjusting directional sun and ambient lighting dynamically. Fully driven by `config/weather.json` and `config/daynight.json`.
- **C03 Environment Rendering:** dynamic sky dome with zenith/horizon exponential gradient responding to diurnal time and weather condition; sun and moon celestial arcs in orbital opposition; atmospheric distance fog dynamically density-graded with horizon weather colors; lightweight instanced particle rain (1500 points, phone budget friendly, zero-cost when dry); thunderstorm lightning flashes with randomized multi-frame strobe and light spike; pre-storm sulfur telegraph cast and clearing aftermath; terrain ground mesh with dynamic soil moisture darkening and mineral tinting, refining and preserving the T02 Root Sight cutaway. Driven by `config/render.json`.
- **C02b WebGPU renderer v1:** optional WebGPU path enabled from
  `config/render.json` when `navigator.gpu` is available, with automatic WebGL2
  fallback and device-loss recovery. Plants upload into GPU storage buffers;
  a compute pass performs per-plant frustum culling and distance-based 4-tier LOD
  with hysteresis and tier dwell time. Tiers 0/1 draw a merged tapered-tube mesh
  with leaf cards, tiers 2–4 draw camera-facing billboards. Separate frame/plant/
  render buffers, WGSL shaders loaded through Vite `?raw`, sun direction, growth
  (the WebGPU ground pass still carves its Root Sight window with a hard discard;
  the WebGL ground below it now fades to a translucent bubble plus a soil dome),
  easing, and Root Sight highlight. Renders on a transparent overlay canvas
  while WebGL keeps drawing the C03 environment. Debug readback is exposed via
  `window.__plantLegacy.webgpuRenderer.readRenderData()`.
  **Root rendering:** simple mesh tubes (4 radial segments, configurable via
  `root_sides`) with Murray's law tapering and gravitropic curvature — no SDF
  raymarching issues, no seed visual conflict.   **Mutation signatures (2026-11-13):** the three documented visual signatures
  (bioluminescent, thickened bark, variegated foliage) render from a per-node
  mutation mask the server may send; the signature strengths are tunables. **Planet
  occlusion:** the cull pass tests each plant against the planet body, so a
  plant behind the horizon or on the far side of the globe is not drawn. Plant
  depth is still separate from the WebGL environment depth (separate canvases),
  so local relief would not occlude a plant; nothing tall exists yet.
- **T02 Root Sight & Subterranean Visualization:** two-mode camera with subterranean elevation tilting (`maxPolarAngle = 177°`), organic root-envelope ground cutaways evaluated across all subterranean elements via multi-node `smin` with smooth dithered edges and soil rim darkening, preserving natural botanical bark and root colors without neon tints. Automatic activation when selecting root options or focusing on subterranean nodes.
- **T01 Directed Growth & Gene Clamping:** silky-smooth growth direction drawing with exponential damping (`0.35` factor) and camera-facing plane projection. Legible HUD displays gene geotropism cone (`minY`/`maxY`), maximum reach boundary ring, glowing trajectory vector, directional arrowhead, concentric ghost bud preview, and floating real-time constraint badge. Immediate preview upon option click, with server-side `clampGrowthDirectionByGene` guaranteeing full botanical rule compliance.
- **Camera Framing & Smooth Zoom:** clicking any player node smoothly recenters and frames the node at an appropriate zoom level; `-` and `+` keys smoothly zoom in and out with acceleration/damping; browser page zoom gestures (`Ctrl` + `+`/`-`/`0`/Wheel/pinch) are intercepted to protect UI layout.
- Staging client on GitHub Pages, with the API served from the local compose
  stack through a tunnel.

## Not built yet

Economy, mutation, inventory slot selection. Touch input not implemented (desktop only).

**V5.4 extension program (approved 2026-11-09, not built):** reactive fauna, material
simulation, volumetric terrain, parametric terrain features, streamed world
objects, ecological succession, and cloud-native orchestration. See
[`v5.4-extension-plan.md`](./v5.4-extension-plan.md). Nothing in that list
exists in code.

The C02b WebGPU renderer is a v1 slice with impostor baking, VRAM pooling, GPU
skinning, texture arrays, tier cross-fade, mutation signatures and a planet-body
occlusion test. It still does not share depth with the WebGL environment pass,
which no browser exposes across the two canvases.

The renderer has no interpolation between server ticks. Interest management filters `GROWTH_EVENT` and `PLANT_CREATED`; `STATE` and `KEYFRAME` still go to every connected player. Binary protocol not on wire.

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

`pnpm verify` is green: lint, typecheck, config validation (77 files), 57 shared
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
- `docs/tunables.md` counts were recomputed from `config/*.json`: 77 files, 21
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

## Next

Per the audited priority order (ADR-023): P0 blockers and C02b gaps resolved;
T05 Communication complete. Next is visual/onboarding polish, then the remaining
C02b gaps: L2/L3 plant mutations and shared depth between the WebGPU plant pass
and the WebGL environment pass. Config-driven broadcast throttling is still open
(INV-TM-09). Interest filtering now covers growth events, plant creation,
`PLANT_SYNC`, `STATE` and `KEYFRAME` (INV-TM-10). Known gaps: a dormant plant's
in-flight growth completes without a `GROWTH_EVENT`, so observers see the old
shape until their next sync, and offline plants have no visual "dormant" cue
yet - they look identical to an online player's plant.

## Explicitly not promised

Dates beyond the gate weeks in DESIGN.md, features not in the plan, and any
outcome the players have not built themselves.
