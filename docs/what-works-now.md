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
- **T00A onboarding:** dismissible three-line hint card and tooltips on the
  light / water / minerals readout, loaded from `/config/onboarding`.
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
  argon2id password hashing; JWT access (15 min) + refresh (30 days) tokens with
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
  easing, and Root Sight highlight. Renders on a transparent overlay canvas
  while WebGL keeps drawing the C03 environment. Debug readback is exposed via
  `window.__plantLegacy.webgpuRenderer.readRenderData()`.
  **Root rendering:** simple mesh tubes (4 radial segments, configurable via
  `root_sides`) with Murray's law tapering and gravitropic curvature — no SDF
  raymarching issues, no seed visual conflict. **Not yet built:** impostor
  baking, VRAM pool allocation, GPU skinning, texture arrays, cross-fade between
  tiers, and L2/L3 plant mutations. Plant depth is also separate from the WebGL
  environment depth, so plants can draw over terrain.
- **T02 Root Sight & Subterranean Visualization:** two-mode camera with subterranean elevation tilting (`maxPolarAngle = 177°`), organic root-envelope ground cutaways evaluated across all subterranean elements via multi-node `smin` with smooth dithered edges and soil rim darkening, preserving natural botanical bark and root colors without neon tints. Automatic activation when selecting root options or focusing on subterranean nodes.
- **T01 Directed Growth & Gene Clamping:** silky-smooth growth direction drawing with exponential damping (`0.35` factor) and camera-facing plane projection. Legible HUD displays gene geotropism cone (`minY`/`maxY`), maximum reach boundary ring, glowing trajectory vector, directional arrowhead, concentric ghost bud preview, and floating real-time constraint badge. Immediate preview upon option click, with server-side `clampGrowthDirectionByGene` guaranteeing full botanical rule compliance.
- **Camera Framing & Smooth Zoom:** clicking any player node smoothly recenters and frames the node at an appropriate zoom level; `-` and `+` keys smoothly zoom in and out with acceleration/damping; browser page zoom gestures (`Ctrl` + `+`/`-`/`0`/Wheel/pinch) are intercepted to protect UI layout.
- Staging client on GitHub Pages, with the API served from the local compose
  stack through a tunnel.

## Not built yet

Chat, economy, mutation, inventory. Touch input not implemented (desktop only).

**V5.4 extension program (approved 2026-11-09, not built):** reactive fauna, material
simulation, volumetric terrain, parametric terrain features, streamed world
objects, ecological succession, and cloud-native orchestration. See
[`v5.4-extension-plan.md`](./v5.4-extension-plan.md). Nothing in that list
exists in code.

The C02b WebGPU renderer is a v1 slice: it has no impostor baking, VRAM pooling,
GPU skinning, texture arrays, tier cross-fade, or L2/L3 mutation support, and its
plant pass does not share depth with the WebGL environment pass.

The renderer has no interpolation between server ticks. Interest management
not yet filtering STATE/KEYFRAME broadcasts. Binary protocol not on wire.

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

`pnpm verify` is green: lint, typecheck, config validation (75 files), 51 shared
tests and 51 server tests (102 total).
## Next

Per the audited priority order (ADR-023): P0 blockers are resolved; next are the
C02b gaps → **T05** (Chat, Emotes, Report/Block) → visual/onboarding polish. T05
depends on T03 + T08C and does not start until the C02b gaps are done.

## Explicitly not promised

Dates beyond the gate weeks in DESIGN.md, features not in the plan, and any
outcome the players have not built themselves.
