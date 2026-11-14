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
  with leaf cards, tiers 2–4 draw camera-facing billboards (as shipped; ADR-042 makes
  L2 an ellipsoid and the atlas L3-only — see the reconciliation note below).
  Separate frame/plant/
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
- **T05 communication:** chat panel (`T`) with proximity and world tabs,
  data-driven emote wheel (`E`), and block/report on every chat message with a
  server-side context snapshot and rate limits. Record: `docs/tasks/T05.md`.
- **T25 terrain:** one seeded field shared by client and server, an inner detail
  patch plus a 620 m outer patch colliding against the exact drawn vertices,
  per-plant capsule colliders, and sparse 32×32 soil chunks (height delta,
  moisture, compaction, voids) persisted in Postgres with protocol 32–34.
  Height deltas are not yet written into a client chunk texture, so the lit
  ground does not sink; debris bodies and the dev collider overlay are pending.
  Full detail in `history.md`.
- Staging client on GitHub Pages, with the API served from the local compose
  stack through a tunnel.

## Not built yet

Economy, mutation, inventory slot selection. Touch input not implemented (desktop only).

**Inventory caveat.** An inventory does exist in code — item definitions in
`config/items.json`, a stacking model in `ops/inventory.ts`, and protocol 24–28 —
but it is **in-memory**: no Postgres table, no row-locked transactions, and
`item_flags.json` is still a stub. DESIGN T08A forbids in-memory inventories, so
treat it as scaffolding, not as the economy, until T08A is completed. Details and
the full deviation list: [`docs/tasks/T08A.md`](./tasks/T08A.md).

**V5.4 extension program (approved 2026-11-09, not built):** reactive fauna, material
simulation, volumetric terrain, parametric terrain features, streamed world
objects, ecological succession, and cloud-native orchestration. See
[`PlantLegacy-Abyssal-Integration-Plan.md`](./PlantLegacy-Abyssal-Integration-Plan.md) §0.3. Nothing in that list
exists in code.

The C02b WebGPU renderer is a v1 slice with impostor baking, VRAM pooling, GPU
skinning, texture arrays, tier cross-fade, mutation signatures and a planet-body
occlusion test. It still does not share depth with the WebGL environment pass,
which no browser exposes across the two canvases.

The renderer has no interpolation between server ticks. Interest management filters `GROWTH_EVENT` and `PLANT_CREATED`; `STATE` and `KEYFRAME` still go to every connected player. Binary protocol not on wire.

## Next

Per the audited priority order (ADR-023), amended by ADR-048: T05 Communication is
complete. Next is the client measurement pass — AL-01 (benchmark, six fixed poses,
GPU timing, zero-alloc audit), then AL-03 (GPU-band quality controller), which
replaces the CPU-fps-based `QualityController`. Shared depth between the WebGPU
plant pass and the WebGL environment pass is **deferred, not a C02b blocker**:
ADR-041 gates it on volumetric terrain (T56), the first geometry tall enough to
occlude a plant. Plant appearance follows ADR-042 (ellipsoid L2, colour-only
atlas L3). Config-driven broadcast throttling is still open
(INV-TM-09). Interest filtering now covers growth events, plant creation,
`PLANT_SYNC`, `STATE` and `KEYFRAME` (INV-TM-10). Known gaps: a dormant plant's
in-flight growth completes without a `GROWTH_EVENT`, so observers see the old
shape until their next sync, and offline plants have no visual "dormant" cue
yet - they look identical to an online player's plant.

## Documentation reconciliation (2026-11-14)

The Abyssal integration plan was reviewed against this file and `DESIGN.md`. Nine
decisions are recorded as ADR-041 to ADR-049 in
[`decisions.md`](./decisions.md). What they change about the state described above:

- **Known divergence: the season-end calamity.** The shipped tick kills every
  plant and the next season starts from bare soil. RULE_8 (clarified 2026-11-09)
  and ADR-044 make a calamity a *burial*: dead biomass must become an
  organic-matter soil field, and terrain edits and voids persist. Planet state
  does persist today (T25 chunks, edits, voids); the bodies do not. The fix is
  owed in the existing death queue, not in the rule.
- **The billboard path becomes L3-only.** Plant L2 (12–80 px) is specified as an
  ellipsoid SDF (C02, ADR-042); the shipped camera-facing billboards now cover
  L3 (2–12 px) only and carry colour, not lighting.
- **Shared depth is deferred, not abandoned.** C02's transparent canvas stands
  (ADR-041). Unification is now the gate for shipping caves, arches and sea —
  the point where local occlusion first matters.
- **The config count is 78 files**, owned by [`tunables.md`](./tunables.md). Any
  surviving count of 77 is stale.
- The renderer/terrain/water/fauna programme is
  [`PlantLegacy-Abyssal-Integration-Plan.md`](./PlantLegacy-Abyssal-Integration-Plan.md);
  the AG mechanisms behind it are [`abyssal-mechanisms.md`](./abyssal-mechanisms.md).

## Explicitly not promised

Dates beyond the gate weeks in DESIGN.md, features not in the plan, and any
outcome the players have not built themselves.
