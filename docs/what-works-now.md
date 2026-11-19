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
- **Title screen (2026-11-18):** a 2D cutout scene with four parallax layers
  that drag and follow the pointer, an interactive mascot plant above the
  logotype, a nickname box with generated defaults, Play / Settings / Shop, and
  an avatar in the top right for signing in. `H` hides the menu and leaves the
  scene. Sign-in and the "Plant a new seed" card open over the scene.
  `GET /world/time` serves the world clock to it, so the menu and the game share
  one hour. `apps/client/src/ui/MainMenu.ts` owns the DOM; `title/TitleScene.ts`,
  `title/TitlePlant.ts`, `title/parallax.ts`, `title/plantMotion.ts` and
  `title/plantName.ts` hold the behaviour. The old entry card is gone. The client now calls `/auth/signup`, `/auth/login` and
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
- **T04 mutation (2026-11-14, partial):** data-driven mutations in `config/mutations.json` (27 definitions across colour, diet/metabolism, size, growth rate, unlocked node types and movement; three kinds of trigger), acquired on a completed growth event with configurable chance, weighted by adaptive pressure over eight growth categories, gated by tile light/moisture/minerals, weather and day/night. Maintenance drains energy, then biomass, and biomass stops at `upkeep_biomass_floor`: an unpaid bill stalls the plant but never sheds a mutation and never kills it, so the only way one leaves is the owner shedding it (biomass penalty, cooldown); pressure decays with a configured half-life A size mutation is **real tissue**, not a shader scale: it holds `m³` the mass and is drawn `m×` as wide from that mass, so shedding one leaves the plant over-built and it wilts back to its regular size over minutes (`oversize_decay` wilt/leak rates), never in a single frame. Mutations also have levels: the player spends stored energy and biomass and picks one card per level from that mutation's own effect pool (`MUTATION_LEVEL`), upkeep climbing with each level, with levels and chosen cards persisted in PLNT v4. `mutation_acquired`/`mutation_shed` fire on the event bus; PLNT snapshots are v2 (v1 still loads); protocol v2 adds `MUTATION_STATE`/`MUTATION_SHED`. The client shows the set, its upkeep and the pressure readout with a shed control. Appearance is data: `config/mutation_visuals.json` carries one style per mutation (organ family, pattern, tint and strength, variegation, glow, bark thickness and darkening, thorns) and the client paints from it. Every held mutation is composed into one look per organ family — foliage, woody, seed, bloom — plus a whole-plant look for the billboard tiers, so a plant shows a bark mutation on its trunk and a lamina mutation on its leaves at the same time instead of a single strongest signature. Tints multiply and clamp, variegation and darkening stack as `1 - product(1 - v)`, glow adds, and bark thickness and thorns have ceilings; levels amplify a style so a levelled mutation looks stronger. Geometry follows the name: `thickened_bark`-family styles thicken tubes, `spined_epidermis` draws real thorns, `columnar_habit` and `drooping_fronds` bend growth direction before the gene clamp. The WebGL SDF fallback still paints one organism and maps the composed foliage look onto its three mutation uniforms. Record: `docs/tasks/T04.md`. A dev-only **mutation gallery** (`dev_mutation_gallery`, Plant → Mutation Gallery in the Dev Panel) builds one plant per mutation on an eight-column grid in front of the asking player, ten metres apart. Each showcase plant is granted its mutation *first* and then grown to a mature 20–34 node body — roots, a five-internode column, leaves, branches, and the organs that mutation talks about (a `trunk` or `culm` column for those unlocks, thorns for `spined_epidermis`, a rhizome with tuber and stolon, pneumatophores, blooms) — and its tissue is filled to the mutated quota, so a size mutation stands in the row at full size instead of being outgrown. Any organ the growth rules refuse is reported back in `rejected` rather than silently thinning the plant. Rival plants carry a name tag above the canopy with the mutation they express.
- **Water as a medium (2026-11-16):** water is no longer only a surface you look *at*. `renderers/environment/underwater.ts` answers "how much water is over the eye?" from the water field's own surfaces (`waterSurfacesAt`), and the renderer applies the consequences: a fog that pulls in to metres and takes the water's colour, a dimmed sun (Beer–Lambert `exp(-depth · k)` on the beam), and a water shader that shades its **underside** as Snell's window — a bright, rippling opening straight overhead, dim self-reflection beyond ~48.6°. A damp ankle is still air: immersion starts at 6 cm over the eye. The sheets themselves end radially (`sheet_edge_fade`), because a square grid seen from a high camera drew the water as a square.
- **A planet-wide sea (2026-11-17):** the world has an ocean, not just local water. `renderers/environment/ocean.ts` builds one dome over the whole play area whose height is the planet's own curvature (`y = sea_level_m − r² / (2·planet_radius_m)`), so a single mesh covers every direction: no sheet edge, no LOD seam, and no reachable place without water. Its coastline is not authored — the terrain is drawn at the same radius, so a shore is wherever the ground rises through it — and it draws with the same water material in **ocean mode** (`uOceanMode`), where the shader measures the column down to the ground grid (pale shelves, dark basins) instead of a per-cell depth, skips the "water above the ground" discard that would delete it, and softens its last 25 cm at the shore instead of cutting a polygon edge. `sea_level_m` (6 m above the play area's tangent plane, so the 5.6–20.8 m plateau stays dry and the basins flood) and `ocean_enabled` live in `config/water.json`; the sea is appended to `waterSurfacesAt`, so a step into it is water over the eye rather than clear air. The first attempt was a sphere of `planet_radius + sea_level` with 80 rings — its polar cap is a chord, so 900 m out the water lay ~17 m *below* the terrain that should have been under it and the ground covered the sea everywhere; the analytic dome has no such sag. The horizon is the camera's far plane, so the water fades out at 2.2–2.48 km rather than ending in cut geometry.

  The sea also carries its **own bed height field** (`buildBedTexture`, 640² samples over ±900 m). The water field's grids stop at 180 m and 560 m, which left the shore players actually look at — the plateau rim 600 m out — with no depth sample at all, so every fragment there fell back to one constant column and the whole ocean shaded as a single flat grey band. With the bed, the shader has a shallow-to-deep gradient all the way out. Its **wave field** is three octaves in ocean mode (`seaNormal`: a long swell, a wind chop, a fine ripple) whose slope is carried into the sky reflection, so the surface bands like moving water and the sun writes a broad glitter path (`sea_wave_strength` 1.2, `sea_wave_scale_m` 5.5); a **foam line** sits wherever the water is shallower than `sea_foam_width_m` (0.9 m), which is what ties the sea's edge to the ground rather than to the dome's outline. The sea's material is transparent and **`depthWrite` is false** (`TRANSPARENT` single layer, side chosen from where the eye is), so the ocean can never occlude the rain, the plant or the bed under it; the shallow shelf shows the ground through the water, and rain streaks draw over the sea.
- **Water as environment (2026-11-15):** water is no longer a Root Sight ornament and it is not fitted to anything. Two fields, both from the simulation:
  - **Rain puddles.** Rain adds depth to a shallow-water sheet; the mass-conserving solver in `packages/shared/src/world/surfaceWater.ts` runs it downhill into hollows, where it soaks in and evaporates. Puddles therefore appear on the ground whether or not Root Sight is open.
  - **The water table.** `ResourceWorld.getWaterTableHeightAt` reads the per-tile groundwater the server already simulates (saturation puts the table at the *regional* ground level — the undug terrain averaged over `groundwater_table_smoothing_m` — and an empty cell sits `groundwater_table_depth_m` below it), so the level rises with rain, falls as roots drink, refills from wet neighbours, and low ground pools instead of every tile tracking its own bumps. Measuring against the regional level is what keeps a dug tunnel from acting as a drain: the table stays put and the hole fills. Its height field is streamed in `RESOURCE_UPDATE.waterTable` (48 × 2 m cells, twice a second) and drawn as one continuous mesh: nearby water connects, and terrain—not a fitted disc—hides it where it is underground. The Root Sight pit is the hole through which that same surface is seen from below. That hole is cut in both faces of the double-sided soil skin: a front-face-only cut left the earth a closed ceiling from underneath, so the cavity could be seen from outside and from above but not from inside the ground. The earthen lip stays a surface effect and fades out with the eye under the soil, which is what the old front-face gate was really there for.
  - **Depth and wet ground.** Both surfaces carry their water column in an `aWater` attribute and shade it with Beer–Lambert absorption (`water_absorption_per_m`), so a deep body is dark and a shallow film is clear, while Fresnel reflection still makes a pool a sheet of sky at a glancing angle — deep water brightens where it reflects. The soil under and around standing water is stained darker by a damp layer that follows the puddle field, spreads `wet_ground_halo_cells` past the edge and fades at `wet_ground_dry_per_s` after the water soaks away, using the soil shader's own wet colour; that layer skips its spread and per-vertex writes entirely while the ground is dry. Underground, the soil shader samples the same table as a small height ramp and darkens everything below the waterline (plus a metre-scale capillary band above it), so the walls and floor of a pit or tunnel that holds water look soaked — the surface stain layer never reaches down there.
  - **The river.** The route is surveyed from the terrain, not authored: `packages/shared/src/world/terrainField.ts` rasterises the relief over the river corridor, fills closed hollows with priority-flood, points every cell at its downstream neighbour and accumulates the flow each one receives (D8). The longest-fed chain through the play area becomes the channel, so the river runs down the valleys and the fall line the hills define. The channel itself is carved into the shared ground field — a bed bowl under a monotone water line plus sloping shoulders (`river_bank_slope`, `river_bank_apron_m`), clamped by the natural ground so the river only ever cuts — and both client and server call that same function, so the drawn bank is the server's soil. The stream is one ribbon strung along the surveyed line, level across the channel, narrower than the bed so the banks cut its shoreline, with channel-local coordinates (`aFlowUV`) driving downstream ripples and streaks (`river_flow_speed_mps`). Puddles and the water table are clipped out of the channel per fragment by a baked route mask (`river_clip_margin_m`), because three translucent surfaces in one place stack their opacity. The water table mesh is clamped under the ground it stands in: it is a subsurface surface, and where it rises above the soil the rain sheet is what draws standing water. The client also clamps the streamed table to just under the drawn terrain (`EnvironmentRenderer.clampTableToTerrain`): the server's heights can stand metres above the local ground, which painted whole valleys as water and buried a sheet under the soil that flickered through from a bird's-eye view.
  - The surface tint is lifted towards a pale sky so overcast puddles do not read as dark stains, and the two surfaces never overlap: the rain sheet only draws where the table is still below the ground. The sheet also floats `surface_lift_m` above the ground it sampled (its grid is coarser than the drawn terrain, which is what caused shoreline z-fighting), water within `water_near_discard_m` of the camera is skipped so the near plane cannot smear it across the view, and the damp band above the table is `wet_band_above_table_m`. Every water surface also carries a clip-space depth bias (`water_depth_bias`): a film five centimetres above the soil is finer than the depth buffer can resolve a few hundred metres away, and a relative bias holds at any distance, which is what stopped the z-fighting from above. The puddle sheet stays a level film instead of pushing wet vertices up and dry ones down - that made every triangle between them a slope that poked through the soil as blue shards - and fragments with no water in them are discarded, while visibility uses hysteresis on the deepest cell rather than a volume hovering at a threshold. Tunables are in `config/water.json`, rendering in `renderers/environment/waterField.ts` and `waterMaterial.ts`, and the solver in `surfaceWater.test.ts`. Rival plant name tags are drawn at 1024 px with mipmaps and anisotropic filtering so they stay sharp; long names are truncated instead of shrinking. The three water colours (`water_deep_color`, `water_shallow_color`, `water_sky_color`) are config entries applied to every water material in one pass, so the rain sheet, the river, the water table and the underwater tint cannot drift apart from each other (W3).
- **P0 measurement and budget (2026-11-15):** `docs/tasks/AL-01.md` and
  `docs/tasks/AL-03.md`. A six-pose benchmark (`config/dev.json`
  `benchmark_poses`, Dev Panel → Debug, `window.__plantLegacy.benchmark`)
  reports p50/p95/p99/max frame time plus real GPU time when
  `EXT_disjoint_timer_query_webgl2` exists. The quality controller now runs a
  measured-cost band — resolution, then draw distance, then tier — instead of
  comparing vsync-clamped fps with a target. Node positions streamed between
  ticks (uproot/tumble) interpolate over one tick and are pruned when a plant
  dies mid-tumble. The detail budget is raised
  and size-class aware: `per_client_entity_cap` 1000, `detailed_plant_budget`
  256, `camera_max_distance` 2000 m with ×2/×4 classes (a giant sees further),
  and `webgpu_max_plants` 20000. Live browser verification is still pending.
- **T01 growth & C02 plant renderer:** server-authoritative typed-node growth with canopy shading and resource competition through shared tiles (root-overlap damage and root attack were deleted by INV-TM-06; roots must be able to touch for symbiosis and grafting, see ADR-051). **C02 procedural plant renderer** renders plants as unified organic living bodies via Raymarched Signed Distance Fields (SDF) with polynomial smooth minimum (`smin`) primitive fusion, continuous 3D triplanar noise, vertex wind sway, Inigo Quilez ambient occlusion (AO), and local bounding volumes. Features botanical Murray's law allometric tapering (sturdy base trunk tapering into delicate twigs aloft), paper-thin elliptic lancet foliage (eliminating hockey-puck disc thickness), smooth branch collar fillets without joint lumpiness, and real-time 0.9s growth emergence animations for seed split, shoot elongation, and leaf unfurling. Full geometric bounding box frustum culling guarantees branches extending from bases behind the camera remain fully visible.




- **T00A:** tile resource model (light/moisture/minerals), onboarding hint card
  and tooltips.
- **T03 multiplayer world:** plants persist across disconnect (binary snapshot +
  event log in Postgres). Offline simulation tiers (Active/Near/Dormant) with
  catch-up integration. Interest management with spatial cells and entity caps.
  Event bus for decoupled game events. Tick-time window (`TickMetrics`:
  Active/Near/Dormant/total ms, over-budget ticks, peak Active share) served at
  `GET /metrics`, with `TICK_BUDGET_WARNING` consumed rather than dropped.
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
  **Root rendering:** simple mesh tubes with Murray's law tapering and
  gravitropic curvature — no SDF raymarching issues, no seed visual conflict.
  Roots are 8 radial segments (`mesh_root_radial_segments`); this line used to say
  4, configurable via `root_sides`, which no config file declared, so the client
  always fell back to its compiled default and the key did nothing. The builder
  clamps to at least 8 anyway, because fewer reads as a square prism once Root
  Sight reveals it.   **Mutation appearance (ADR-059):** every render tier paints from
  `config/mutation_visuals.json` composed per organ family. The WebGPU mesh pass
  reads one composed record per plant from a storage buffer, the Three.js mesh
  pass composes per organ in JS, the impostor bake paints with the same records,
  and the billboard tier paints the whole-plant record. The WebGL SDF fallback
  still draws one organism and maps the composed foliage look onto its three
  mutation uniforms. The packed per-node index survives only for the billboard
  tiers' legacy mask. **Planet
  occlusion:** the cull pass tests each plant against the planet body, so a
  plant behind the horizon or on the far side of the globe is not drawn. Plant
  depth is still separate from the WebGL environment depth (separate canvases),
  so local relief would not occlude a plant; nothing tall exists yet.
- **T02 Root Sight & Subterranean Visualization:** two-mode camera with subterranean elevation tilting (`maxPolarAngle = 177°`), organic root-envelope ground cutaways evaluated across all subterranean elements via multi-node `smin` with smooth edges and soil rim darkening, preserving natural botanical bark and root colors without neon tints. **It opens itself when a buried part starts growing** (`player/rootSightAutoOpen.ts`): choosing a root option or receiving a root growth event opens the view, and the cavity treats a part that has just started as soil-opening with a 25%-radius floor, so the ground gives way on the first frame of the root instead of after it has emerged. `R` still owns the mode — a hand-close stands until the next buried part starts — and `root_sight.auto_open_on_root_growth` turns the rule off. **Visibility follows the opening, in volume.** Above ground a root is drawn when it is inside the aperture *cylinder* — the soil is cut in plan view, so a root under the hole is exposed at any depth — and when the eye itself goes below the soil the surface test is replaced by an air window around the eye (`root_sight.eye_window_radius_m`), so a camera flown down into the pit still sees the roots instead of the inside of a dirt skin.
- **T01 Directed Growth & Gene Clamping:** silky-smooth growth direction drawing with exponential damping (`0.35` factor) and camera-facing plane projection. Legible HUD displays gene geotropism cone (`minY`/`maxY`), maximum reach boundary ring, glowing trajectory vector, directional arrowhead, concentric ghost bud preview, and floating real-time constraint badge. Immediate preview upon option click, with server-side `clampGrowthDirectionByGene` guaranteeing full botanical rule compliance.
  **The card quotes what the charge takes.** `growthChargeScale` (soil resistance × mutation growth-cost/speed) is read by both the menu and `tryGrow`, and the menu rounds energy up, so a card can no longer offer growth the server then refuses for energy. **Every child starts on its parent:** the mesh pass begins each tube at the server's `parentAttach*` point, so branches sit on the stem's drawn surface instead of hanging under it (`renderers/webgpu/nodeAttachment.test.ts`).
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
- **T06 damage, uproot and tumbling (2026-11-15):** one damage pipeline for
  weather, tools (accepted, no verb yet), scripted herbivore swarms and terrain
  collapse/landing impacts. Roots are not a source (ADR-051). Uproot has causes —
  sustained saturation, a storm gust scaled by exposed height, a collapse under
  the root plate, or accumulated structural damage — never a dice roll (ADR-052);
  damage is biomass loss (ADR-055). The body lifts, leans and tumbles on a
  deterministic rigid-body step, the server streams node positions, and an
  uprooted player can steer a slow crawl (`REROOT_INTENT`) onto moist soil inside
  the window to reroot. Failure means the uprooted drain starves the plant. Kill
  credit goes to the player with the most damage inside the window; destroyed
  parts drop fragments and deaths/swarms leave remains and dung as expiring world
  objects (ADR-056). Protocol 37–43, PLNT snapshots v3, T04's
  `movement.rerootSpeed` is consumed, and the Dev Panel has T06 buttons. The
  in-browser checklist is still outstanding, T02's substrate multiplier is 1.0,
  and drop pickup belongs to T51/T08A. Record: `docs/tasks/T06.md`.
- **Title art pass (2026-11-17):** every cloud had a straight line hanging under
  it. The "flat underside" was a rounded bar drawn under the puffs, so its bottom
  edge sat five pixels below the lowest puff and three pixels past it at each end,
  and the hard offset shadow underneath doubled it. The generator
  (`title/cloudArt.ts`, with `cloudArt.test.ts` pinning it) now cuts the
  silhouette with a clip path instead of drawing a band, shades the whole cloud
  with one crown-to-base ramp rather than one ramp per puff, lights only the
  crown, and keeps the viewBox tight to the underside so two clouds hang at the
  same distance below their own boxes. The cumulus was rebuilt with a base tier
  that shares a bottom line, because one wide puff thirty pixels below the rest
  read as a sausage bolted to the side of the tower. The hills became curved
  ridges with a sun-lit crest stroke instead of an even sawtooth, and the mascot
  is now seven generated leaves in three depths with midribs, side veins, a
  tender top leaf and a bud, rimmed on whichever edge faces the sky (it rimmed the
  underside of every left-leaning leaf before).
- **Title art pass, second cut (2026-11-17):** the clouds' undersides were
  level. Cutting the silhouette was right, but a level cut made every cloud end on
  the same ruler line, so the cut is now a shallow wave - contacts on the base line
  with soft lifts between them, amplitude scaled to the cloud - and it still cannot
  put anything below its own trough (`cloudArt.test.ts` pins both). The sun got a
  hot core and a three-ring halo instead of one flat disc, and the moon became a
  body: lit limb, dark far side, soft maria, all coloured from the palette. The
  ground is read as a cut slice now, not a brown box: a lit lip, a four-stop depth
  ramp, and soil closing over the stem. And the plant is one object across the soil
  line - the stem continues into the ground in bark, forks into a taproot and two
  uneven laterals, and those fork into tips with hairs, every strand drawn twice so
  a pale root sits in a contact shadow instead of on the dirt. Nothing is cast onto
  the ground: the stage is a cut slice and has no plane, so the contact shadow and
  the soil darkening under the plant were removed rather than softened. The roots
  were then rebuilt from numbers - tapered filled shapes rather than stroked lines,
  branches starting on their parent's centre line and painted under it, hairs
  computed on the strands so none of them float free - and `roots.test.ts` pins
  those properties instead of leaving them to the eye. `--pl-root-band`
  reserves the band the roots hang in, so the menu stack starts below them on every
  viewport measured (357, 530 px wide; 15-19 px clearance).
- **Input and layout pass (2026-11-17):** nothing binds F1–F12 and no bare
  modifier is a toggle, so the browser keeps its own keys: the metrics overlay,
  growth readout and tick readout are three switches in the dev panel's Debug tab
  and `debug_toggle` is unbound (`config/controls.json`, pinned by
  `keyPolicy.test.ts`). Under 560 px the inspect and inventory panels become one
  full-width sheet with a tab switch instead of two cramped columns, chat becomes
  a bottom sheet above the action bar and no longer opens itself for five
  seconds on a new message (the Chat button carries an unread badge instead), and
  the standalone top-left Settings corner button is gone — Settings lives in the
  pause menu. A first spawn now fits the camera to the plant once its first node
  arrives: the welcome pass can only use `camera_start_distance` (6 m, a
  seedling four pixels wide in front of a hillside) and a young plant is framed
  from `camera_young_elevation` so the eye is not left 0.24 m off the soil.
- **Death reporting (2026-11-15):** a loss names what did it. `PlantDeathRecord.killedBy` carries the damage source (`tool`, `weather`, `herbivore`, `terrain`), the store that ran dry (`thirst`, `minerals`, `no_energy`), or `uprooted` for a plant that bled out after being torn free; `PLANT_REMOVED` and the reconnect report forward it as `source`, and the loss screen reads "It was damaged past saving by another player's tool" instead of stopping at "damage". An ungerminated seed is also sheltered from weather damage: the storm's rate is absolute rather than scaled by size, so a one-biomass seed died in its first storm tick (covered by `damagePipeline.test.ts`), and a failed germination no longer destroys the seed (`germination_failure_kills_seed` is false), so a bad spot costs a sprout attempt, not the plant.
- **HUD pass (ADR-067):** one vitals card (top right) holds biomass, energy,
  light, water and minerals with bars where a capacity exists, the single clock
  ("Season 1 · Day 3 · 11:44", season countdown in the sub-line) and a weather
  chip that turns amber for an approaching storm and pulses under a minute. The
  status card keeps the body only and says nothing when the plant is healthy; the
  old tick card is an operator readout switched from the dev panel, off by
  default and refused without server-granted dev tools. Grow mode gets an edge tint, a crosshair, a badge and
  a held-down Grow button instead of a line of text. A bottom action bar names
  Grow / Inventory / Chat / Emotes / Hints / Menu with key badges, Escape opens a
  pause menu (Resume, Settings, Controls, Leave to title), hints are contextual
  and once-per-session, and HUD type has a config floor (`ui.hud_font_small_px`,
  `ui.hud_font_secondary_px`) instead of bottoming out at 9.3px.
- **C04 HUD and panels (2026-11-15):** top-centre body-state panel shows health words when rooted (Healthy/Stressed/Withering/Dying) and the phase otherwise, with biomass and its derived rate, health against the uproot ceiling, mutation count and upkeep, and `Day N · clock` with the weather forecast. Damage pulses an edge vignette and writes one factual toast. While uprooted, a D-pad and WASD/arrow keys steer the camera-relative crawl. `I` opens Inspect on the left (body stats, mutations, per-node health) and Inventory on the right, with the world visible between. Settings has Settings/Controls tabs (text size, reduced motion, generated key list). The HUD also shows energy, water and minerals against capacity and node count, keeps mutation energy and biomass bills separate, and Inspect adds mutation kind, share bars, totals and growth-pressure bars. The death screen repeats the detailed stats and the toast stack is cleared. Growth parts start at their minimum radius and thicken with biomass; damage and drought recompute radius so tissue visibly thins, canopy is shed before roots, and unhealed stem damage decays after a delay. Text updates cap at 10 Hz. Server sends `structure` in STATE/KEYFRAME, structural damage with PLANT_DAMAGE and `dayNumber` with WEATHER_UPDATE. Record: `docs/tasks/C04.md`.
- Staging client on GitHub Pages, with the API served from the local compose
  stack through a tunnel.

### 2026-11-20 — the interface scales with the pane

- **The HUD shrinks instead of taking the pane (ADR-074).** Under 640px the vitals
  card went full width and under 560px the player panels became one full-width
  sheet — rules written for a phone, firing on every narrow pane. Measured in a
  531x653 pane the vitals card took 21% of it and the inventory 87%, so the world was
  visible only in the gaps. The whole overlay is now scaled by `--pl-ui-scale`
  (0.72..1, from `ui/uiScale.ts`) with CSS `zoom`, and the two rearrangements are
  gated on the finger layout instead. At 531x653: vitals 127x144 in the corner,
  status 158x37, action bar 333x33, two 216px panels, nothing outside the pane.
  At 1280x800 the scale is 1 and the layout is unchanged. The title screen carries
  the inverse zoom, because it already fits itself to the pane.
- **The scale is written on the first frame (ADR-075).** It was only written on
  resize, and the resize observer's first callback is a no-op, so a freshly loaded
  small pane stayed at full size until the window was nudged.

### 2026-11-20 — the title plant is a set of things to touch

- **The plant answers per part (ADR-072).** A leaf flicks about its own attachment
  and alternates direction leaf to leaf, the stem rocks the whole canopy, the bud
  nods and the roots flex; a double tap rattles everything; a drag from the top
  bends the stem in two hinges and releasing springs it back through straight. A
  press is a tap until it moves, so the bud at the top of the drawing is tappable
  *and* is where a bend starts.
- **The plant notices, without becoming a control.** It leans up to 3.2 degrees
  toward a pointer over it, and a breeze passes every 9-21 seconds at most 2.4
  degrees. No colour change, no outline, no glow: it is a drawing, and the only
  thing a touch changes is the drawing's own motion.
- **The background drags (ADR-073).** It never had: `.pl-scene` inherited
  `pointer-events: none` from the world layer, so the handler could not fire, and
  `touch-action: pan-y` turned a horizontal touch drag into a page scroll.
- **The ground line answers to the plant (ADR-071 amendment).** A fixed share of the
  pane height put the mascot above the top of a short pane (measured: 21px above at
  1200x300). `horizonForPane` keeps the configured share while the plant fits,
  pushes the line down when it does not, and stops at the ground band; the media
  queries that held a second opinion are gone.
- **A small pane keeps the essentials.** Under 560px tall (or when the column cannot
  be placed without lifting it) the guest line and the H hint step aside, and the
  title, the name and the three buttons stay reachable. Measured at 1280x800,
  531x653, 1200x300 and 320x240: nothing outside the pane, plant included.

### 2026-11-19 — mutations keep their proportions, and the sky loses its halos

- **Mutation proportion (E13, ADR-070).** Growth length was the type's segment
  length times the product of every size mutation and level card, uncapped: two
  size mutations produced a side branch several times its own trunk. Both
  `max_size_multiplier` (2, in `mutations.json`) and `max_child_length_ratio`
  (1.6, in `growth.json`) are now config keys applied through
  `clampChildSegmentLength` in the shared geometry module, so a mutation makes a
  bigger plant instead of a dismembered one.
- **Sun and moon (bug report: "halo around it and looking blurry").** The disc
  faded over its own outer 40%, a `box-shadow` added a ring the size of its blur,
  and a 400%-wide `::before` painted a second ring on top of the sky — the moon
  the same at 320%. Both bodies are now a filled disc with one edge and no
  shadow, mask or blur pass, and the light they cast lives where light belongs:
  the horizon lobe now grades on `--pl-sun-glow` as well as the hour's bloom.
- **The menu fits the pane it is drawn in (E17, ADR-071).** The title column was
  laid out for a window: in a 900x420 pane Shop and Settings fell 18px below the
  bottom, and at 1200x300 the whole menu was outside it. `title/menuFit.ts` scales
  the column to clear the guest line and lifts what the scale floor cannot, so a
  short pane overlaps the menu with its own plant rather than losing the buttons.
  Verified across six pane sizes; 531x653 - this machine's in-app preview - fits
  at scale 1.
- **A growth is not re-priced while it runs (E16).** Target mass was re-quoted every
  tick from the live mutation scale, and a mutation rolls per growth, so a size
  mutation gained mid-flight finished the part heavier than quoted. The quote is
  stamped on the node's first growth tick and frozen.
- **The plant stopped disappearing mid-growth (E15).** A node id is the
  plant's tag plus the part name; the client deleted any node that did not carry
  its own tag, and its copy of the tag length was eight characters while the
  server minted sixteen (INV-GR-05). Every node failed that test, so the first
  growth event of a session pruned the whole mirror: the plant vanished, and Root
  Sight's cavity - whose mouth is sized from the roots in that mirror - emptied
  with it. Both came back when the next sync arrived, which is why it read as a
  stutter rather than a crash. One owner now, `shared/growth/nodeId.ts`, imported
  by the server's `nodeName` and by both client readers.
- **Health reaches the scene (E14).** The inspect panel read health from
  `nodeHealthStatus`, but nothing painted the 3D plant from it: a part could be
  labelled Wilted and be drawn in the same green as a healthy one. `nodeHealthLook`
  now hangs off the *same* bands, `MeshPlantRenderer.materialFor` takes the band
  into its cache key, and a band change asks for one rebuild. Verified by
  `plantHealth.test.ts` (*dries a part in the same bands the panel reads*).
- **HUD measured, not eyeballed.** A harness (deleted afterwards) loaded the real
  app at 1280×800 and walked title → world → inventory → pause → settings,
  reporting geometry and every element whose content outgrew its box: no
  overflow at any of the five surfaces, vitals 192×201 with the weather line
  wrapping inside 167px, settings 670×198. Pause rows were the one real finding
  and went from 39px to 44px.

Covered by `pnpm verify` (1,178 tests). The sun/moon change is CSS and was not
captured as an image: the preview tab cannot screenshot a page that runs a render
loop, so the removal is verified by reading the computed styles, not by a picture.

### 2026-11-16 — Root Sight, gizmo, inventory, ledger

All of the below is covered by `pnpm verify` (lint, typecheck, config validator,
docs check, 287 server tests, 307 client tests). The **visual** half is not: no
browser pass was run in this change, so the rows in `bug-inventory.md` that need
eyes stay `[~]`.

- **Root Sight.** One `apertureVolume` (mouth, radius, top Y, floor Y) replaces
the unbounded XZ cylinder, the soil cut, the water clip and the plant occlusion
rule all read it, the rim edge is resolved by coverage, every ground patch
reports a cut, the buried-eye soil exemption is limited to the eye bubble, and
the two dead SDF cutaway uniforms are gone. The four sizing literals are config
keys and the absolute-Y ground test is `isBelowSoil`.
- **Growth gizmo.** `ringFrameFor` orients the ring on the part it leaves rather
  than the aim; "at surface" uses ground height and `planetUp()`; the ring hides
  on host occlusion while the marker does not; the overlay follows the
  renderer's size/DPR.
- **Inventory.** Item names, descriptions and the exact Use are sent with
  `INVENTORY_SYNC` and rendered; items with no implementation are disabled with
  a reason and a click returns `REJECT item_not_usable` instead of nothing.
- **Ledger.** Protocol version has one source (boot check against
  `PROTOCOL_VERSION`); `pnpm verify` includes `docs:check` and `verify:ci` adds
  the build; the ambient fade uses `1 − exp(−dt/τ)` with a config τ; the
  mutation panel has a close; upkeep/thirst loss is broadcast as one batched
  `PLANT_DAMAGE` per plant per tick; `validateMovement` is deleted and `INPUT` is
  documented as an ack-only heartbeat; the planet-body draw range and shell
  visibility live in one helper.

Not done, and deliberately out of this pass: inventory persistence (still
in-memory, so a reconnect resets the pouch), real strata/volumetric terrain, and
a wade/swim camera.

### 2026-11-16 — browser pass

Run in Chromium against the dev stack. A capture cited from this section is a
curated image committed directly in `docs/verify/` (see its README); a pass
dump (`docs/verify/pass-YYYY-MM-DD/`, root `*.png`, `screens/`, `screenshots/`)
is gitignored and is not cited.

- **The ground was not being drawn at all**, and this was the "looks weird" part
  of Root Sight and everything else. A trailing comma in a GLSL call stopped the
  soil program from linking; the browser logged `useProgram: program not valid`
  every frame. Fixed, with a string-level regression test in
  `ground/shaderOverrides.test.ts`. Terrain, soil detail, water and the shore
  came back.
- **Root Sight** now opens a real pit: a soft rim, a dry bowl, and the
  roots hanging into it, with the seed sitting at the mouth. `R`
  closes and reopens it. Getting there fixed four separate faults: the aperture
  is floored at the seed's own width (R9); the orbit floor is half the mouth, so
  the eye can be brought over the hole and dived through it (R10, R22); the cavity's
  surface height was being computed with the planet radius added twice, which
  put the whole volume 18 m above the plant (R11); and the opening was lifted to
  the highest ground under the rim, burying the seed in a well on any slope
  (R12). The water that used to stand in the hole is gone too (R13). The bowl
  used to flare 6% wider than the cut one ring below the lip, and that flare had
  no soil behind it: it showed as a brown collar of dots and a crescent of shell
  around the mouth, which made the pit look like it sat below its own hole (R14).
  The flare is gone, the rim band is off, and a colour-coded pass now shows the
  bowl filling the aperture exactly, soil purple and water green around it
  and the same scene with a blue pit on red soil.
- **The pit looks like dug earth (R16-R17).** Its wall and floor are built from
  the *dry* soil colour (0.86 at the lip, 0.62 at the floor) with every shader
  term a shade around 1.0, so it reads as dirt instead of a black void; the grain
  is sampled in cylindrical coordinates (angle x mouth radius, world height) and
  no longer smears down the wall. The rim is flush with the cut and its ring is a
  circumscribed 96-gon, so the sawtooth of sky that used to run round the mouth
  at grazing angles is gone, and the bowl's lip is the same material as its wall, not a separate band,
  the wall so it reads as the lip's shadow rather than a pale line.
- **Growth gizmo.** The ring sits on the part, the arrow points along the aim and
  the ground marker follows the drawn soil; seen from the spawn camera it reads
  correctly. The three-angle and lateral-bud checks
  could not be driven: the preview tooling has no real drag, synthetic pointer
  events do not reach OrbitControls' pointer capture, and the dev panel has no
  "grow one lateral bud" action.
- **Inventory.** Opening `I` shows the pouch and each item's name, prose,
  generated use line and meta line. All six configured items are readable: the
  starting three (Starter Fertilizer, Starter Dung, Growth Essence) plus the
  three that have no other grant path, handed out from the dev panel's new
  Inventory section (`dev_grant_item`). The two seeds and the booster show their
  reason line and a disabled **Unavailable** state rather than a button that
  lies. The prose no longer repeats the "Use:" sentence now that
  the panel generates it.
- **The drawn plant got a second growth pass (2026-11-18).** Two things the
  junction fix exposed, plus one config drift.

  **Ring density follows the bend, not just the length.** A segment was sampled
  with a flat `ceil(length / 0.05)` clamped to 4–12, so a 12 cm internode got
  **four rings** and a strongly bent branch got the same four as a straight stem.
  Four rings cannot draw a flared neck: the radius rule finishes most of its
  necking inside the first quarter, which four evenly spaced rings render as
  three facets. `chainSampleCount(length, bend)` now takes the curve's second
  difference `|start - 2*control + end|` and solves `bend / (8 n²) ≤ tolerance`
  against `chain_sagitta_tol_m`, and `chainSampleFractions` warps the ring
  positions by the same exponent that shapes the radius, so they land where the
  silhouette changes. The floor is 6 rings, the ceiling 16.

  **The WebGPU pass read two keys nobody serves.** It drew tubes from
  `tube_ring_count` and roots from `root_sides`; neither is a key in
  `config/plant_renderer.json`, so the shipped pass silently used its compiled
  defaults (**8 sides**) while the file declared `mesh_tube_radial_segments: 12`
  and only the fallback Three.js path read it. Both paths now read the one key,
  roots have their own (`mesh_root_radial_segments`, 8), and the cost is stated:
  on a 16-node plant, 12 sides and the new rings take 1658 → 2022 vertices and
  2470 → 3118 triangles (+22%/+26%).

  Pinned by six new tests in `PlantMeshBuilder.test.ts` (bend raises the count,
  length raises it, the cap holds, a missing length or bend still answers, the
  sag stays inside the tolerance, the fractions are dense at the joint and exact
  at both ends, and an even spacing when the taper is a straight cone).
- **The UI answers the window instead of a phone's width (2026-11-18).** The
  title's hero was a flat 380px column and its mascot stopped at 232px, so on a
  2560 × 1440 monitor the menu was 15% of the screen — a mobile layout on a
  desktop. The hero is now `--pl-hero: clamp(380px, 30vw, 560px)`, the name box
  shares it, the mascot caps at 300px, and controls grow at `min-width: 1200px`.
  Measured in an iframe harness at seven widths: 390 → 360px (92%, unchanged),
  1280 → 384px (30%), 1440 → 432px, 1920 → 560px, 2560 → 560px (22%). The action
  bar's finger layout now asks `(hover: none) and (pointer: coarse)`, so a
  touchscreen laptop keeps its key badges. See ADR-069.

  Also corrected: `docs/tunables.md` had stale key counts for `dev`, `emotes`,
  `net_proto`, `root_sight` and `water`; every row now equals the number of keys
  its file declares (checked against the files, not by hand).
- **The 3D plant is drawn with the same junction rules as the title's roots
  (2026-11-18).** `jointStartRadius`, `segmentRadiusAt` and `socketInset` live in
  `packages/shared/src/growth/geometry.ts` and both renderers call them, with
  three new keys in `config/growth.json` (`joint_flare_ratio` 1.25,
  `segment_taper_exponent` 2.2, `socket_inset_ratio` 0.15) and three new values
  on `/config/growth`.

  **What the shipped builder actually drew, measured at growth 1 on a 12 cm
  internode:** a trunk-to-branch junction came out at **2.65x its own shank**
  with a **19.4 degree** half angle (0.0450 base / 0.0170 shank), stem-to-vine
  1.86x, stem-to-branch 1.53x, root-to-lateral 1.54x, radicle-to-root 1.50x, and
  a leaf or flower 1.00x. At growth 0 the same probes read 10.59x and above. The
  cause was four separate rules, each the 3D form of the title's flange bug: the
  branch base *was* the parent's radius, the taper was a straight line across the
  whole segment, the tube began 0.9 of the parent's radius out (on its surface,
  not inside it), and every segment's curve was built from its own chord so
  consecutive segments met at unrelated angles — a kink at every node, with
  `maxAngleDiscontinuityDeg` already measured and ignored.

  **What it draws now:** the same junctions read **1.25x and 2.0 degrees**, soft
  organs stay 1.00x, and the parent's radius is taken at the attach *fraction*
  rather than its base. On a chain that forks twice the worst drawn-tangent kink
  fell from **44.9 degrees to 5.0**, and a wide fork now turns by about half its
  fork angle instead of holding the parent's direction and hooking back — the
  first version of the tangent rule did hold it for a full 0.45 of the span, and
  a segment dump showed a branch that climbed its trunk and then doubled back,
  which is why the mix is scaled by alignment.

  **How it is held:** `measureDrawnPlant` gained `maxJointToShankRatio` and
  `maxTangentKinkDeg`, `packages/shared/src/growth/geometry.test.ts` pins the four
  rules (knuckle ratio, parent cap, no knuckle on a soft organ, exact endpoints,
  the neck finishing early, monotone taper, config clamping), and
  `PlantMeshBuilder.test.ts` pins the drawn plant (junction cap, soft organ,
  no joint met at the chord angle, a continuation within 3 degrees of its parent,
  a wide fork under 55% of its fork angle, config honoured over the default).
  A dead `addCurvedTube` — a second copy of the linear taper that nothing
  called — was deleted so the rule has one owner. See ADR-068.

  **Not verified visually.** WebGPU does not initialise in the preview browser
  and the fallback Three.js path needs WebGL, so these numbers come from the
  bundled builder itself and from tests, not from a screenshot of the shipped
  pass. A 2D silhouette drawn from the same segments was discarded as evidence:
  it closes each tube as its own shape, while the real pass stitches consecutive
  segments through shared rings, so it exaggerates joints into notches.
- **Rerooting.** The crawl settles after roughly 2-3 m on damp ground, so a
  long move is a series of uproots: driven through `dev_uproot_plant` plus
  `dev_reroot` east, the plant covered 117 m in 47 legs without losing nodes,
  and its Root Sight pit followed it. The joints travel with the
  body now: each node's attachment point on its parent is part of the rigid pose
  the crawl rewrites, on the server and in the uproot packets, so an uprooted
  plant no longer comes apart at its laterals (R15). Measured on a live crawl:
  joint gaps stay at 0.05 m (the radicle's seed offset) and 0.00 m for laterals,
  where they were 3.4 m before. The seed joint itself was a second fault: the SDF
  pass drew a seed's children from the seed's contact point rather than the stored
  attachment, so an uprooted plant lifted its seed and left the roots hanging in
  the air. The crawl still moves smoothly: the pose is eased
  toward each packet again, and each joint is carried as a fixed offset from its
  parent, so it is re-derived from the parent's drawn position every frame rather
  than snapped ahead of it (0.00 m joint error across a live crawl).
- **Water stays under the ground (R19).** In a band of zoom levels the rain film
  and the water table used to lie on top of hills: both follow the terrain field
  at about a metre per cell, while the drawn ground is that fine only inside the
  180 m detail patch, and outside it the ~8 m ring triangles can sit decimetres
  below the field. The water shader now tests each fragment against **the ground
  that is actually drawn**, not against the field: the detail patch's own grid
  (1.41 m cells out to 180 m) near the player, and the far ring's own grid (8 m
  cells out to 560 m) past its edge, taking the lower of the two. The old 110 m
  fade is gone, so a lake stays visible when the camera pulls back. How far above
  that ground each sheet may stand before it is thrown away is per surface: the
  table is a subsurface sheet and gets 2 cm, while the rain film and the river lie
  on the ground by design and get 35 cm (the tight value tore brown holes in
  puddles wider than a terrain cell). The river ribbon is also resampled twice per
  surveyed station, so it follows the carved bed between stations instead of
  cutting under it as disconnected patches.

  **The table's own branch of that test cannot fire, and no screenshot proves it.**
  `rebuildTableMesh` writes every vertex as `min(y, ground - drySinkM)`, so the
  table mesh always sits at least 0.6 m below the drawn ground; discarding water
  that stands above the ground is therefore unreachable for it. Forcing a table
  in dev (49 × 24 m cells, socket closed so the server's 48 × 2 m grid could not
  replace it) and a dev-patched copy raised 0.35 m above the terrain gave frames
  identical with the test on and off. The part of the
  test that does act is the film and river allowance, which trims sheet geometry
  standing above the drawn ground on a slope.
- **The Root Sight pit follows the scene light (R20).** The dug wall and floor are
  unlit geometry, which is what stopped them reading as a flat lit disc at noon
  and a black hole at night, but it also meant the pit kept its noon brightness
  at midnight and became the brightest thing on screen. The bowl shader now takes
  a `uBowlLight` multiplier written every frame from the sun (weighted by how
  high it stands), ambient and sky fill, as a fraction of the measured daylight
  reference: **1.0 at noon, 0.28 at night**, with a 0.2 floor so the pit stays
  readable as dirt in the dark rather than disappearing.
- **Root Sight no longer cuts water when it is shut.** The water's cavity clip
  ran whenever a cavity bowl existed rather than while the cavity was open, so
  with Root Sight closed a disc the size of the aperture was cut out of any lake
  beside the plant. The clip now follows `uRootSightProgress`: zero radius unless
  the opening is actually open.

Also in this pass: `net_proto.max_velocity_units_per_tick` was dropped (with the
cross-field rule that compared root growth speed against it). The rule was not
restored, it was replaced by documentation, because it had no meaning left: it
compared `growth.root_growth_speed` in metres per second with a per-tick
movement cap belonging to an avatar the server does not have. The remaining
bound is the key's own 0.1-10 range, and both growth-speed keys now say so in
their `notes` in `config/growth.json`.

## Not built yet

Economy, item pickup for fragments/remains/dung, the rest of C04 (rebinding
screen, notification log).

**Touch is a second producer, not a second interface.** Orbit, pan, pinch zoom,
tap-to-select, the reroot pad, the action bar and every panel work on a finger
layout, and C09's remaining gaps are the long-press node menu, a PWA manifest and
real-device verification: the camera is OrbitControls' own touch handling, so no
touch producer exists in `@plant-legacy/input` and nothing has been tested on a
phone.

**Water you can get into.** The medium is modelled (see "Water as a medium"), but
nothing yet lets the eye reach it: river depth is 0.02–0.6 m and the rain sheet is
centimetres, so immersion needs burrowing, the underground water table or a dev
flood (W2). Caustics, god rays, foam and a swim/wade camera are the rest of the
plan's water slice. The earth is still a carved skin plus a cavity bowl rather than
a volume, so Root Sight has no strata to cut through (A1).

**Inventory caveat.** An inventory does exist in code — item definitions in
`config/items.json`, a stacking model in `ops/inventory.ts`, and protocol 24–28 —
but it is **in-memory**: no Postgres table, no row-locked transactions, and
`item_flags.json` is still a stub. The local model now rejects invalid counts,
enforces stack limits and the account-bound flag invariant, and has 11 tests;
that does not make it persistent. DESIGN T08A forbids in-memory inventories, so
treat it as scaffolding, not as the economy, until T08A is completed. Details and
the full deviation list: [`docs/tasks/T08A.md`](./tasks/T08A.md).

**V5.4 extension program (approved 2026-11-09, not built):** reactive fauna, material
simulation, volumetric terrain, parametric terrain features, streamed world
objects, ecological succession, and cloud-native orchestration. See
`DESIGN.md` Parts 11 and 16. Nothing in that list
exists in code.

The C02b WebGPU renderer is a v1 slice with impostor baking, VRAM pooling, GPU
skinning, texture arrays, tier cross-fade, mutation signatures and a planet-body
occlusion test. It still does not share depth with the WebGL environment pass,
which no browser exposes across the two canvases.

The renderer interpolates node positions between ticks (`render/PlantInterpolation.ts`; the dormant-versus-online cue is still open, tracked as 2-B in [`improvement-plan.md`](./improvement-plan.md)). Interest management filters `GROWTH_EVENT` and `PLANT_CREATED`; `STATE` and `KEYFRAME` are built per player and filtered by the same interest test (`broadcastPlantStates` keeps the owner's own plant unconditionally), and their cadence is gated by `client_send_rate_hz` through `stepCadence` (`broadcastCadence.ts`). Binary protocol not on wire.

## Next

Per the audited priority order (ADR-023), amended by ADR-048 and **ADR-050**: T05
Communication, T04 Mutation and T06 damage, uproot and tumbling are implemented;
T06 still needs its in-browser checklist. **C04 is partial**: health, damage,
reroot, Inspect/Inventory, Settings and death stats are in; rebinding and the
notification log are not. **T08A** is partial: the local inventory is hardened and tested, but Postgres
saving, row locks and restart survival are not implemented. Those are next, then
the ADR-044 burial fix. AL-01 (benchmark, six fixed poses, GPU
timing, zero-alloc audit) and AL-03 (GPU-band quality controller, replacing the
CPU-fps-based `QualityController`) follow, per ADR-050. Shared depth between the
WebGPU
plant pass and the WebGL environment pass is **deferred, not a C02b blocker**:
ADR-041 gates it on volumetric terrain (T56), the first geometry tall enough to
occlude a plant. Plant appearance follows ADR-042 (ellipsoid L2, colour-only
atlas L3). Broadcast cadence now honours `client_send_rate_hz` and
`weather_send_rate_hz`; the per-plant event log is written and read back.
Interest filtering now covers growth events, plant creation,
`PLANT_SYNC`, `STATE` and `KEYFRAME` (INV-TM-10). Known gaps: a dormant plant's
in-flight growth completes without a `GROWTH_EVENT`, so observers see the old
shape until their next sync, and offline plants have no visual "dormant" cue
yet - they look identical to an online player's plant.

## Documentation reconciliation (2026-11-14)

The Abyssal material was reviewed against this file and `DESIGN.md`. Nine
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
- **The config count is 79 files**, owned by [`tunables.md`](./tunables.md). Any
  surviving count of 77 is stale.
- The renderer work is ranked in
  [`abyssal-garden-source-analysis.md`](./abyssal-garden-source-analysis.md) Part II;
  the task specs behind it are in `DESIGN.md` Parts 11 and 16.

## Explicitly not promised

Dates beyond the gate weeks in DESIGN.md, features not in the plan, and any
outcome the players have not built themselves.
