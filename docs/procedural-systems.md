# Procedural systems: what we already had, what we took, what we refused

**Status:** review, 2026-11-23. Nothing here authorises a build. Adopted items are
recorded against their owners in `DESIGN.md` (Part 13.10, T05, T54, T55, T59 and
19.9) and in `docs/decisions.md` ADR-083 to ADR-087.

**Source.** A compiled design guide, "Plant Legacy: Procedural Systems and
Feature Guide", dated November 2026, covering planet generation, water, plants,
animation, fauna, materials, weather, physics, inventory, emotes, ecology and
performance.

**Related:** [`planet-scale.md`](./planet-scale.md) (radius, horizon, precision,
clipmap), [`partitioning-lod.md`](./partitioning-lod.md) (render tiers),
[`art-bible.md`](./art-bible.md) (look and audio),
[`calamities.md`](./calamities.md) (world events),
[`decisions.md`](./decisions.md) (rulings).

## 1. How the claims were judged

The guide is a good survey of what a procedural planet game can be, written
without knowledge of this repository. Its value here is therefore uneven: most of
it we already do in a form that is smaller and tied to shipped code, some of it is
new and worth taking, and some of it would break a rule this project has already
paid to learn. The judgements are:

1. **Already ours** — the repository does it; the guide only confirms it. No
   change, and no second description of it.
2. **Taken** — it fills a real gap, and it lands in the spec that already owns
   that area. A guide line never becomes a task by itself.
3. **Refused** — it contradicts a ruling, or it buys a budget this project has
   already measured and declined. Each refusal names the clause it would break,
   because the same idea will be proposed again.

Evidence standard: a claim about today's code was checked against the named file
or the named ADR. No frame timings were taken for this review, and no number in
the guide was copied into `config/`.

## 2. Already ours

| Guide claim | Where we already do it | Note |
|---|---|---|
| Seeded, hash-based generation; randomness by coordinate, not by draw order | `hash32` / `hash01` / `mulberry32` in `packages/shared/src/math`, ADR-038 | Order-independent hashing is why two clients draw the same leaf from the same node id. |
| Deterministic base plus sparse, server-authoritative edit layers | T25 sparse soil edits, `TERRAIN_EDITS` (32–34), one cavity field for Root Sight | The plant world itself is state, not a delta: ADR-039 snapshot plus event log. |
| Server decides gameplay, clients add particles, sway, splashes | RULE_4, RULE_27, Part 13.8 | Also the reason a particle simulation never decides anything. |
| Interest management, sleep far entities, per-tier ticks | T03 tiers Active/Near/Dormant, `ops/interestManager.ts`, Part 13.6–13.7 | Dormant uses catch-up integration rather than replaying missed ticks. |
| Quality tiers and device budgets from day one | Part 13.4 (desktop / phone / low-end), `QualityController` as a measured-cost band | Battery rules already name the levers: resolution, then draw distance, then tier. |
| three.js + WebGPU compute with a WebGL2 fallback | Part 13.1, C02 SDF raymarch, C02b compute LOD, `renderers/webgpu/` | The fallback is a reduced path, not a second architecture. |
| Rendering 10k unique plants is the real bottleneck, not generating them | Part 13.5, Part 14.2, ADR-042 | Projected size decides the tier; distance is a consequence. |
| LOD, impostors, instancing, GPU skinning, shared meshes, detail caps | Part 14.2.0 (canonical tiers), 14.2.3 leaf cards, 14.2.4 pose buffer | L2 is an analytic ellipsoid; the atlas is colour-only at L3. |
| Wind bending in the vertex shader, height-scaled | C02 wind displacement, `PlantMeshBuilder`, 14.2.4 | Already the same idea as the guide's hierarchical bend, without a separate system. |
| Growth animates in the shader from an age parameter | 0.9 s smoothstep from `spawnTime`, GPU skinning in C02b | No mesh regeneration per growth step. |
| IK for the moving moments only, cosmetic | 14.1.4 FABRIK/CCD for reroot crawl and tendrils | RULE_27: IK never decides a gameplay result. |
| One permission check before every growth step | `tryGrow` + gene clamp + bounds + the growth quote (ADR-061) | A refusal carries a reason the client can show. |
| Gene items extracted from fragments and own plant, traceable | T15, T51, RULE_30 provenance | One transaction creates a gene, one consumes it. |
| 10 hotbar slots; genes, seeds and materials are all item types | T08A, `items.json` (ADR-082) | The pouch and purse share one `player_state` row (ADR-081). |
| Weather as a deterministic field, not a dice roll per plant | `packages/weather/src/climateField.ts`, `config/climate.json`, bugfix-c21b | Advected humidity, orographic lift from the real height field, altitude lapse, rare storms, hysteresis. Better than the guide's `f(pos, time, seed)`: it is a *field*, not a function, and it rains where mountains are. |
| Atmosphere on the surface, raymarched sky in orbit, clouds split by altitude | Part 13.1, `environment/atmosphere.ts`, `planet-scale.md` §5.2 | The split is already priced: analytic at ground, raymarched only for the orbit camera. |
| Triplanar mapping, procedural noise instead of texture files, per-genome palette | C02 triplanar FBM, `config/mutation_visuals.json` (ADR-059), Part 19.5 | Mutation appearance is data, composed per organ family. |
| Physics: capsule chains along the skeleton, inflated clearance | `packages/shared/src/physics/plantColliderPlan.ts`, `config/physics.json` (`collider_inflation_m`, caps, merge rules) | Exact trimesh ground, capsules for organs, budget by merging degree-2 runs. |
| Multiplayer: particles are client-side visuals; the server owns the settled result | RULE_4, RULE_27 | The rule the guide states last is the rule we start from. |
| Interest-managed networking sends state, not meshes | Part 13.7–13.8, T03P | Quantised deltas plus keyframes, one source of plant state. |

## 3. Taken, and where it landed

Each row is one change, in the document that already owns the area. None of them
is a new task.

| # | Taken from the guide | Change | Ruling |
|---|---|---|---|
| 1 | Generate from seeds rather than store rows | New Part 13.10 §A: a content rule for anything no gameplay rule reads — scatter, wild flora, ground cover, textures, ambient placement. The server still owns every value a rule reads. | ADR-083 |
| 2 | Light, moisture, temperature, nutrients, wind and water are one field set every system samples | New Part 13.10 §B: the field table, its one-owner-per-field rule, the declare-what-you-read rule, and the "visuals may compute a field only where divergence cannot affect play" line. | ADR-084 |
| 3 | Plants generated from an L-system or space colonization, with a genome | Narrowed to **wild flora only**, in T59: ambient canopy is grown from a seed plus a species record and never stored; the player's body stays grown by the player. | ADR-085 |
| 4 | Emotes authored as roles and goals, solved with IK, with graceful fallback and automatic coverage tests | New T05 subsection: role tagging at generation, emote data as roles/targets/rhythm/amplitude, scoring for the hand pair and head, fallback chain, and a test that runs every emote on thousands of generated bodies. | ADR-086 |
| 5 | Sand as a height layer relaxed toward its angle of repose, local particles baked back, server owns settled heights | T55 gets the two-scale split: a global height layer is the authority, local grain particles are visuals and settle into it. | ADR-087 |
| 6 | Coarse predator–prey population per region, reacting to what players do to the land | T54 gets a population layer under the per-entity caps: regional carrying capacity, hunger pressure, migration between regions, and local extinction that T59 seed banks can reverse. | — |
| 7 | Colliders guarantee non-intersection; the drawn mesh may deform inside a safety margin | Part 13.10 §C states the guarantee and the margin as a rule, and records that nothing tests the drawn result; the margin's value is an open decision (Part 16 item 20). | — |
| 8 | Every size-dependent value is normalised by body size | Part 13.10 §D generalises ADR-027 (size classes), ADR-057 (`quota × scale³`) and ADR-070 (proportion is a rule) into one sentence about new tunables. | — |
| 9 | Procedural items are an id plus genes or a seed, never a mesh | T08A/T14 data rule: a record is the item, and a mesh is rebuilt. Already true; now stated so the marketplace cannot store geometry. | — |
| 10 | Terrain shape from fBm, ridged noise, domain warping and cheap derivative erosion | T57/T59 parameter list only: the vocabulary a future terrain task may use. No new key in `config/terrain.json` until a task owns it. Raised because our 26 m field reads soft next to the ridges the guide describes. | — |
| 11 | Rivers from flow accumulation, lakes from flood fill; water reads the edited terrain | Recorded against ADR-065's inland water: a flow map is the generator for the drawn water, and a dug channel must redirect it. Coupling direction is fixed (water samples terrain, never the reverse). | — |
| 12 | Synthesise wind, rain and rustle from the simulation; generative music follows weather, biome and hour | Part 19.9 audio direction for C06, which is unbuilt. Fits RULE_31 (free assets) and removes a licensing surface. | — |
| 13 | Stochastic or Wang-tile sampling to remove visible repetition | Art-direction line for terrain materials (C03/C10 polish): triplanar stays, sampling gets stochastic offsets. | — |
| 14 | Continuous collision detection so fast bodies never tunnel | C02c: a tunable to enable *if* tumbling debris is measured tunneling. Not on by default; it costs. | — |
| 15 | Test generated bodies in bulk: run every emote, flag missed targets and self-intersections | The test harness in ADR-086. This is the guide's single best process idea: coverage by generation, not by hand-picked cases. | — |
| 16 | Pollination and seed dispersal by wind, water and animals | One line in T53/T59: a dispersal agent samples the field bundle (§B) instead of inventing its own wind or current. | — |
| 17 | Scars, ash and regrowth that follow a body | Routed to T26 consequence persistence, already approved: persistent marks are consequences, not decoration. | — |

## 4. Refused, and the clause it would break

| Refused | Why | Clause |
|---|---|---|
| Cube-sphere quadtree, 100–1000 km, streaming to the horizon | The horizon, not the radius, is what players feel (`sqrt(2Rh)`). At 100 km it is 583 m against 620 m of authored ground. Our addressing is a spherical lat-ring grid, the play frame is planar, and a radius change is a content decision, not a rendering programme. | ADR-076, ADR-077, `planet-scale.md` §4 |
| Every client rebuilds the world from seeds, including what gameplay reads | A generator is only shared if it is bit-identical, and GPU fBm is not identical across vendors. Things gameplay reads stay server-computed and server-sent; only visuals may be recomputed. | RULE_4, RULE_27, `planet-scale.md` §3.2 |
| The player's plant generated from a genome or an L-system | The player *is* the organism and growth is a two-step, gene-gated decision. A generated body removes the game. | RULE_1, locked decisions 11–12, DESIGN 1.1 |
| Heirloom seed as a compact genome record | A traded or bought seed must never import someone else's build. Our heirloom is a blank vessel restoring the owner's own death record. | DESIGN 1.2 inheritance honesty, T06A |
| Store the choice history and rebuild the plant from it | The shipped save is a versioned binary snapshot plus a bounded event log with a CRC32 (ADR-039). Replay is O(n), slower to load, and can diverge after a rules change. | ADR-039, Part 13.9 |
| Physics-engine determinism as the authority ("Rapier is deterministic") | Determinism is a property of our rules and seeds, not of a WASM build. Rapier is the client's cosmetic layer (C02c); the server decides collision and tumbling in its own code. | RULE_4, Part 13.3 |
| FFT ocean, and a GPU shallow-water simulation near players | The sea is a 2.6 km analytic dome and inland water is not geometry (ADR-065). A second fluid solver has no gameplay owner and competes with T55 for the same tick. | ADR-065, Part 13.4, ADR-045 |
| A 3D soil grid for water, minerals and pH | A planet-wide 1 m grid is ~1.3e11 cells for each metre of depth, and the plan already budgets it as unaffordable. Soil is the T00A 2D grid; depth, where a rule needs it, is a small number of layers. | `planet-scale.md`, T00A |
| Client prediction for movement | There is no server avatar to predict. WASD pans the camera; `INPUT` is an ack-only heartbeat and movement is deliberately not validated. | Part 13.8, locked decision 15, `protocol.md` |
| Mesh colliders are forbidden | True for organs, false for ground: the ground collider is built from the drawn triangles on purpose, so collision follows the mesh and not the field. | C03b, T25 |
| Fungal networks that share and steal nutrients | T09 symbiosis is post-MVP and has no MVP consumer. Adding the field without the gameplay would be a system nobody can play. | T09, DESIGN 1.3 |
| Meteors, volcanoes and floods "on a schedule" | There is no luck and no automatic wipe. Calamities are placed, forecast and aimable; a survivor may carry. A schedule reintroduces the dice the scope reset removed. | ADR-078, Part 16 items 1 and 17 |
| Workers for chunk generation and meshing now | Deferred until profiling shows the single thread cannot hold the tick budget. The authored ground is 65k vertices. | Part 16 item 7 |
| Floating origin, camera-relative rendering and double-precision world positions now | Patch-local metres already keep the radius out of the vertex attribute at any size. Camera-relative rendering is needed when the *scene graph* spans a planetary distance, which is the orbit view. | `planet-scale.md` §3.3, §4.2 (P0 shipped) |
| Clients compute weather independently for gameplay | The field can be recomputed for a splash, never for a damage number. Weather state stays server-sent; the client draws it. | RULE_4, bugfix-c21b |
| "10,000 players in one place at 60 fps" as an acceptance test | It is a design target, not an MVP test, and no client can draw 10,000 detailed plants. Each client receives a bounded set at projected-size tiers. | Part 13.5, RULE_14 |

## 5. The one genuinely new architecture: the field bundle

The guide's second principle is the only structural idea here that we do not
already have, and it is worth having: today each system carries its own weather,
moisture and wind, and a new system copies one of them. The rule is that a field
has **one owner**, **one sampling API**, and **readers, not copies**.

| Field | Owner today | Readers |
|---|---|---|
| Light | T00A tile grid, canopy shade, day/night | photosynthesis, growth rate, mutation triggers, plant shading |
| Moisture | T00A plus rain, climate, water surfaces | germination, uproot saturation, soil tint, water film |
| Minerals | T00A plus dung and fertilizer | growth, upkeep, succession |
| Temperature | T07 and `climateField` (season, hour, altitude lapse) | precipitation phase, snow cover, growth rate |
| Humidity and cloud | `climateField` (advected noise, orographic lift) | weather state machine, precipitation, sky |
| Wind (direction, strength, gust) | weather/climate | plant sway, rain slant, snow drift, splash crowns, future debris and water surface |
| Water surface and flow | `WaterField` surfaces; flow map per §3 row 11 | immersion and the underwater medium, carried debris, soil wetting |
| Terrain height and edits | `terrainField` plus T25 sparse deltas | colliders, placement, camera clamp, water, scatter, Root Sight |

Rules that go with it:

1. **One owner per field.** Only the owner writes. A reader that "just tweaks"
   wind is the bug this prevents.
2. **Sample in metres in the play frame.** The planet is a placement, not a
   coordinate space; a field never takes latitude as input.
3. **Declare the reads and the write.** A new system states which fields it
   samples and which one it changes, so a coupling is visible in review.
4. **Gameplay fields are server-computed or server-verified.** A client may
   recompute a field for a visual when a difference cannot change a number a rule
   reads. Splashes, sway and rain qualify; damage and growth do not.
5. **A field survives a season.** Fields are state that deep time transforms
   (T20, T39), not per-session noise.

## 6. Risks we adopted

The first three are now open decisions in `DESIGN.md` Part 16 items 20–22;
none is resolved.

1. **The visual margin.** Capsules with `collider_inflation_m` guarantee that a
   *collider* does not intersect. Rendered sway can still cross another body
   inside that margin. The margin is currently a physics number, not an art
   contract, and nothing tests the drawn result.
2. **Edit-layer compaction.** Plant event logs compact on a threshold. Terrain
   edits, root tunnels and cave voids do not: a long-lived world accumulates them
   with no policy, and the guide is right that this grows with player activity.
3. **The ambient-flora budget.** Wild flora generated in T59 has no render budget
   of its own yet. It must fit inside the existing per-client caps and projected
   tiers rather than becoming a second population with its own draw call.

One conflict was found in our own documents while checking them, and is recorded
rather than fixed:

4. **The L2 threshold.** `config/render.json` `webgpu_tier2_threshold` is 50, but
   ADR-042 and DESIGN 14.2.0 define L2 as 12–80 px. `docs/partitioning-lod.md`
   used to quote 12 as if it were the tunable's value; it now quotes the config
   value and names the disagreement. Whoever decides it should change one side
   deliberately: the config changes when a plant becomes a billboard, the band
   changes what the atlas is for. **New fact for the decision (2026-11-23):**
   `config/dev.json` declares the same key as **12**, but nothing applies it — the
   dev panel only fills its inputs from `/dev/config`, and `world.applyDevConfig`
   refuses any key outside its four cases, so every session runs 50. Do not read
   the dev copy as the live value (E21).
