# Plant Legacy × Abyssal Garden
## Integration and Technical Plan v1.0

**Status:** v1.1, reviewed 2026-11-14. Nine decisions were taken in review (§0.1) and are recorded as ADR-041 to ADR-049 in `docs/decisions.md`. Still a proposal, not an implementation record: no game code was modified.
**Document discipline (ADR-049).** This plan owns the *programme*: work packages, waves, risks, acceptance. It does not restate task specs (`DESIGN.md` Part 11), approval records (`v5.4-extension-plan.md`), config values (`config/*.json`, indexed by `docs/tunables.md`), tier numbers (`DESIGN.md` Part 14.2.0) or mechanisms (`docs/abyssal-mechanisms.md`). Where this document and an owner disagree, the owner wins.
**Primary source of truth for Plant Legacy:** `DESIGN.md` v5.3.1. Where this plan and `DESIGN.md` disagree, `DESIGN.md` wins. This plan is a proposal for how to extend it, not a replacement.
**Reference implementation studied:** *Abyssal Garden* by Maksymilian Dendura, MIT license. Source: `source/src/{quality,math,shaders,world,main,audio,dev}.js`.
**Scope:** the whole living-world programme implied by the current design: editable planet, volumetric terrain and caves, sea and sky, weather and biomes, reactive fauna, plants in every environment, physics, 10,000-player world scale, and the renderer that makes it readable.

---

# 0. Decision summary

The plan has one central thesis:

> **Abyssal Garden is a masterclass in turning a small number of procedural mechanisms into a large, coherent, living-looking world. Plant Legacy should adopt its mechanisms, not its scenery.**

Abyssal Garden is a static, hand-authored, single-player diorama. Plant Legacy is a persistent, player-authored, server-authoritative ecology. That difference decides almost every adaptation in this document.

The plan makes twelve decisions:

| # | Decision | Why |
|---|---|---|
| D1 | **Adopt the technique, reject the diorama.** | AG bakes a world once. PL must simulate a world that changes forever. |
| D2 | **Simulate broadly, render narrowly, collide locally.** | 10k plants exist in one World; no client draws 10k full organisms. This is already the DESIGN (13.5–13.7). |
| D3 | **One frame, one depth, two implementations — proposed, not inherited.** Unify on WebGPU with a complete WebGL2 fallback. This **reverses** DESIGN C02's transparent-canvas architecture and needs a C02 amendment; it is deferred until T56 makes local occlusion real (ADR-041). | AG proves a single WebGPU frame enables shafts, water, post, and correct occlusion. PL's split canvas cannot — but nothing currently in the world is tall enough to occlude a plant. |
| D4 | **LOD changes representation, never rules.** | A distant plant must obey the same growth, damage, and physics rules as a near one. Only its drawing and collision detail change. |
| D5 | **Terrain is sparse, editable, server-authoritative volume.** | AG's surface nets and SDF primitives are the generator/mesher blueprint for T56/T57. AG's static, client-owned terrain is not the authority model. |
| D6 | **Environment is continuous fields, not named biomes.** | Temperature, moisture, salinity, light, pressure, nutrients, pH, flow. Biomes are config thresholds over those fields, preserving RULE_7 and the "no named outcomes" rule. |
| D7 | **Plants live everywhere through general traits.** | Tolerance, metabolism, attachment, buoyancy, and structure are general mutation/trait data. There is no separate "aquatic mutation category" and no special-case cave plant system. |
| D8 | **Physics has two truths.** Server analytic/deterministic truth for gameplay; client Rapier for local, cosmetic, and near-field physicality. | 10k Rapier plants is neither possible nor desirable. DESIGN 13.3 already chooses a small custom server solver. |
| D9 | **10k uniqueness is data, not art.** | One material language, shared texture arrays, per-instance mutation/seed parameters, impostors, and GPU skinning. No per-player textures or shaders. |
| D10 | **Caches are revisioned, never permanent.** | AG bakes shadow/detail/skylight once. PL must invalidate terrain, shadow, and skylight caches when players, roots, water, or weather change the world. |
| D11 | **Every edit is an event with provenance.** | T25/T26 already require consequence persistence. T56/T57/T58 must inherit the same event, revision, interest, and persistence discipline. |
| D12 | **No new named outcomes, no rarity, no intelligent NPCs, no client authority.** | These are the identity rules. The plan deliberately has no "coral kingdom", "abyssal leviathan", or "legendary mutation". |

## 0.1 Decisions taken 2026-11-14 (v1.1)

These supersede the rows above wherever they conflict. Each is an ADR.

| # | Decision | Effect on this plan |
|---|---|---|
| A1 | The unified renderer is **deferred until T56 makes local occlusion real**. C02's transparent canvas stands (ADR-041). | AL-02 leaves Wave 0 and becomes the gate for shipping caves/arches/sea. D3 becomes a proposal, not a precedent. |
| A2 | **L2 = ellipsoid SDF, L3 = colour-only atlas** (ADR-042). | §7.2–7.4 and Appendix A: ~37 MB of L3 atlas, no L2 atlas, no `impostor_atlas_size`. |
| A3 | Volumetric terrain's **first slice is one authored region** around spawn (ADR-043). | AL-08 acceptance scoped to the region; planet-wide generation deferred. |
| A4 | A calamity is a **burial**; biomass becomes an organic-matter soil field (ADR-044). | T20/T59 own the fix. `season_length_days` stays in `world.json`, not `deep_time.json`. |
| A5 | Water ships in **two slices**: lakes/rivers/pools, then ocean (ADR-045). | AL-09 splits; salinity, pressure, depth biomes and underwater traits move to slice two. |
| A6 | **Full trait model, five metabolisms on equal footing**, chemosynthesis as a tunable (ADR-046). | New AL-17 owns the trait and mutation rules; T09/T10 needed for attachment. |
| A7 | **Fauna before volumetric terrain** (ADR-047). | AL-11 depends on AL-07 only. |
| A8 | **Full AL-01 then AL-03 before visible polish** (ADR-048). | Wave 0 order stands without AL-02; atmosphere follows measurement. |
| A9 | **Two documents, reference-only discipline** (ADR-049). | This plan stops quoting specs and config values; techniques move to `docs/abyssal-mechanisms.md`. |

## 0.2 Explicit non-goals

These are not oversights; they are deliberate boundaries:

- **No 10,000 fully detailed, fully simulated rigid-body plants on one screen.** The 10k target is one World, interest-managed and LOD-rendered, exactly as DESIGN 13.5–13.7 says.
- **No per-player texture files, unique shaders, or per-plant shadow maps.** Uniqueness comes from data + procedural variation.
- **No global 20 Hz water/lava cellular automaton.** T55 runs at a decoupled cadence with active-chunk caps.
- **No fully soft-body plant simulation for every node.** Only local, visible, gameplay-relevant softness.
- **No static baked world.** There are no world resets (RULE_8); even deep time transforms the same planet.
- **No direct copy of Abyssal Garden's underwater palette, water surface, kelp, or creature content.** Only mechanisms.
- **No AG-style hardcoded constants.** Every ported value becomes a config tunable under RULE_3.
- **No client-side terrain, growth, physics, or fauna decisions.** Rendering is never authoritative (RULE_27).

---

# 1. Guardrails: what must not change

These are the parts of Plant Legacy that make it *Plant Legacy*. The plan is designed around them.

## 0.3 The v5.4 extension basis (folded 2026-11-14)

The v5.4 extension programme was approved on 2026-11-09 as a separate index
document (`v5.4-extension-plan.md`). Its content is folded here so one file owns
the programme; nothing in it was re-decided. Task specs remain in `DESIGN.md`
Part 11, and approval items 9–14 in Part 16.

**The ten requests, and what each became.**

| # | Request | Disposition | Task |
|---|---|---|---|
| 1 | Volumetric terrain with overhangs, arches, caves, stacked layers | Accepted as a sparse 3D terrain volume, not dense voxels | T56 + C10 |
| 2 | Parametric terrain features from Bézier surfaces / spline sweeps | Accepted as general surface/sweep/carve primitives | T57 |
| 3 | Cellular automata over material cells | Accepted, layered on the T00A grid with a decoupled cadence | T55 |
| 4 | Fully dynamic sand / water / lava / vegetation | Accepted through the material CA and T59 succession | T55 + C10 |
| 5 | Reactive agents using CA + influence maps | Accepted as **non-sapient reactive fauna**, not intelligent NPCs | T54 + C11 |
| 6 | Needs-based AI | Split: needs/reflexes in multiplayer; conversation, story goals and judgment campaign-only | T54 + T32 |
| 7 | Persistent modifiable world, streamed objects, behaviour on any object | Accepted as an object registry with config-defined behaviour | T58 |
| 8 | Cloud-native architecture | Accepted as many single-process Worlds with global accounts; allocation is ops, not gameplay | O04 |
| 9 | Ecological succession and failsafes | Accepted; the strongest fit with "the planet remembers" | T59 |
| 10 | Material state transitions by element strength | Accepted as part of the material simulation | T55 |

**Rule amendments (approved 2026-11-09).**

| Rule | Change | Why |
|---|---|---|
| RULE_2 | Allow persistent non-sapient fauna with needs, reflexes and animal vocalizations; intelligent NPCs stay campaign-only | Makes reactive herbivores legal without opening the door to NPCs |
| RULE_8 | There are no world resets; a calamity is a burial | Matches the intended persistence |
| RULE_19 | Taming fauna grants no speech, human words, goals or judgment | Keeps companions inside the same ceiling |
| RULE_22 | Damage pipeline is target-agnostic: plants and fauna share one record shape | Plant-vs-fauna combat needs one pipeline, not a parallel one |

The fauna ceiling is unchanged by this plan: needs, local senses, deterministic
reflexes, animal sounds, trap/struggle, tameable — never conversation, quests,
story goals, judgment, factions or planning (ADR-047, ADR-044).

**Approvals resolved 2026-11-09.**

| # | Decision | Answer |
|---|---|---|
| 9 | RULE_2/8/19/22 amendments | Approved; fauna vocalize with animal sounds only |
| 10 | T56 terrain scope | Full multi-layer/overhang terrain from the first release |
| 11 | T55 cadence, chunk cap, budget | 2 Hz, 64 active chunks, ~10% of the tick budget |
| 12 | O04 cloud model | Many Worlds per host first; on-demand allocation later behind the same contract |
| 13 | T59 recovery | Natural, real-time days, weather-dependent, guaranteed within a configured maximum |
| 14 | T58 scripting boundary | Config-defined state machines only; no plugin model |

**What stays out.** No intelligent NPCs in multiplayer; no world resets; no
arbitrary object scripting (config state machines, never uploaded code or
`eval`); no dense voxel database (sparse binary chunks only); no default
microservices, queues or Redis (many single-process Worlds, an ADR for any
exception); no named outcomes (RULE_7 — general capabilities, not proper-noun
structures); no `rarity` fields (RULE_20 applies to every new item, material and
species).

**Honest cost.** T55 and T56 are each multi-week systems with renderer,
persistence, interest and performance work; T58 changes the object model; T59 is
a rules layer over T55 and T20; O04 is an ops project. T54 is the smallest and
the best first slice because it turns scripted herbivore events into something
players can fight, trap or flee.

## 1.1 Identity invariants

1. **The player is the plant.** Never a character controlling a plant. Every system must answer: what does this let a plant *be* or *do*?
2. **The planet is the world.** One continuous planet across seasons, no resets, no blank-state regeneration. Calamity is burial, not a wipe.
3. **The server owns truth.** Growth, mutation, damage, economy, terrain edits, fauna, water, physics outcomes, and persistence are server-authoritative.
4. **Discovery over explanation.** No UI that explains depth, strategy, or emergent outcomes. The world may be beautiful; it must not be a tutorial.
5. **Systems, not outcomes.** No proper-noun cultures, named biomes as designed outcomes, named creatures as scripted story, or "legendary" tiers.
6. **No rarity.** Any schema field named `rarity` is a bug. Mutations are described by what they do, not how special they are.
7. **No intelligent NPCs in multiplayer.** Fauna may have needs and reflexes. They do not speak, plan, quest, judge, or form factions.
8. **Every trace persists.** Dead roots become organic matter; compacted soil stays compacted; blocked light stays blocked until the blocker changes; erased content leaves a tombstone.
9. **Underdog paths exist.** Power gaps must be surmountable by skill, patience, creativity, or alliance, not only money.
10. **Free-first, portable ops.** No microservices, queues, or Redis by default. One World = one process + one Postgres until measured need.

## 1.2 Abyssal Garden filter

Before any AG idea enters the plan, it passes these questions:

| Filter question | If "no" |
|---|---|
| Does it still work when the world is edited every minute? | Reject or redesign as revisioned/incremental. |
| Does it preserve server authority? | Reject the client-authoritative part; keep only the visual/generation idea. |
| Does it scale by interest/LOD rather than by drawing everything? | Redesign around tiers and budgets. |
| Is every value configurable with a range and default? | Reject the hardcoded constant. |
| Does it avoid named outcomes and rarity? | Rewrite as a general capability. |
| Does it preserve the player-as-plant fantasy? | Reject if it turns the plant into a conventional avatar. |
| Does it work on the phone/low-end budget? | Provide a reduced fallback or gate it to desktop. |

## 1.3 What Abyssal Garden does better than Plant Legacy today

Be honest about the gaps:

- AG has a **single coherent frame** with correct shared depth; PL has a WebGL environment and a WebGPU plant overlay that cannot share depth.
- AG has **closed-loop GPU-time quality control**; PL adjusts pixel ratio from CPU fps and triangles.
- AG has **atmosphere and light shafts**; PL has linear fog and a sky dome.
- AG has **procedural audio**; PL has none.
- AG has **instanced foliage at millions of instances**; PL has per-plant merged meshes with limited foliage.
- AG has **SDF terrain and collision bricks**; PL has a height field and sparse height deltas.
- AG has **a benchmark and fixed visual poses**; PL has tick budgets and debug overlays but no equivalent client performance/visual gate.
- AG demonstrates **zero-allocation frame discipline** in a way PL's render loop does not yet fully follow.

## 1.4 What Plant Legacy does better than Abyssal Garden

Do not lose these while porting:

- **Real persistence and replayable consequence.** AG's world is static. PL's world remembers.
- **Server-authoritative simulation at scale.** AG is a client-only demo.
- **Plant biology as gameplay.** Nodes, biomass, water, minerals, light, mutation, parasitism, inheritance.
- **A social and economic layer.** AG has no players, trade, guilds, or history.
- **A living ecology.** AG's fish and kelp are decoration; PL's fauna and vegetation must feed, damage, die, and alter the world.
- **Planet-scale addressability.** AG's 384 m box is not a planet; PL's spherical grid and planet surface are.
- **A design document with explicit rules and cut lines.** Keep using it.

---

# 2. Current-state audit

## 2.1 Design coverage

| Layer | Implemented | Design owner | Main gap |
|---|---|---|---|
| Accounts, sessions, protocol | Yes | T08C, T03P | JSON on wire, not the binary protocol in 13.8 |
| Resource model | Yes | T00A | Environment is light/moisture/minerals only; no temperature/salinity/pressure |
| Growth | Yes | T01 | Node types fixed; no medium/tolerance model |
| Mutation | Not built (config stub) | T04/T24 | No trait/tolerance schema |
| Damage/uproot/tumbling | Not built (config stubs) | T06 | Physics and damage pipeline incomplete |
| Parasitism/symbiosis | Not built | T10/T09 | Attachment and host interaction undefined |
| Persistence | Yes for plants; sparse soil | T03/T25 | No volumetric chunks, materials, fauna, objects |
| Weather/day-night | Yes | T07 | No biome/climate coupling, no sea, no volumetric weather |
| Root Sight | Yes | T02 | Cutaway is height-field based; must work through volume |
| Plant renderer | SDF + optional WebGPU overlay | C02/C02b | Split depth, overlay off by default, no unified frame |
| Environment | Sky, fog, rain, ground | C03 | Linear fog, no shafts, no water, no volumetric atmosphere |
| Terrain | Height field + sparse height deltas | T25 | No overhangs/caves, no full SDF volume |
| Physics | Rapier local + analytic collision helpers | C02c (config exists) | No formal task record; no water/fragment/fauna physics |
| Fauna | Scripted herbivore events only | T06/T54 | No persistent reactive fauna |
| Water | Config stub | T31 | No sea, water volume, underwater rendering, buoyancy |
| Biomes | MVP constant | T20/T39/T59 | No continuous environment/biome field |
| Audio | None | C06 | No procedural or asset audio |
| 10k readiness | Design only | T03/H01 | No 10k soak, no binary protocol, no GPU benchmark |

## 2.2 Scale scorecard

| Requirement | Current | Required by plan |
|---|---|---|
| Plants per World | Design target 10k | 10k records, tiered simulation, interest-managed |
| Plants per client | cap 200, detail budget 100 | 200 entities, ≤100 L0 desktop, ≤40 phone |
| Plant uniqueness | mesh + mutation bits | 64-bit appearance signature + mutation mask + array layer + growth state |
| Draw calls | unbounded by plant count | ≤400 desktop, ≤150 phone, target ≤100 |
| Shadows | 1024–2048 single map, ~8 Hz | cascaded sun + caster budget + contact/blob; revisioned terrain cache |
| Physics bodies | 24 plants × 192 colliders | configurable per tier; server analytic, client near only |
| Network | JSON, 20 Hz, per-player state | binary quantized deltas, priority, keyframes, interest |
| Terrain | height field | sparse 3D chunks, surface nets, SDF queries |
| Water | none | sea/lake/river volumes, surface + underwater rendering |
| Biomes | constant | continuous fields, config thresholds, climate memory |

---

# 3. What Abyssal Garden actually teaches

**Moved to its own reference (ADR-049).** The technique catalogue and the six
structural lessons now live in
[`docs/abyssal-mechanisms.md`](./abyssal-mechanisms.md): 22 techniques with
their AG source locations, what PL should take from each, and what must change
for a persistent server-authoritative world, plus the lessons that constrain how
they are ported.

Read it before starting any work package that touches terrain, atmosphere,
foliage, scattering, quality control or audio. The work packages below cite it
as the AG reference instead of repeating the mechanism.

---

# 4. Target architecture

## 4.1 Layered architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  PRESENTATION                                                        │
│  DOM UI  ·  C06 audio  ·  camera rig  ·  debug/benchmark             │
├──────────────────────────────────────────────────────────────────────┤
│  RENDER FRAME (single API per device)                                │
│  WebGPU primary: terrain · plants · fauna · water · sky · post       │
│  WebGL2 fallback: reduced terrain/plants/water, no compute LOD       │
├──────────────────────────────────────────────────────────────────────┤
│  CLIENT WORLD VIEW                                                   │
│  interest snapshot · entity store · interpolation · LOD hints        │
│  revisioned caches: terrain mesh, shadow, skylight, L3 plant atlas   │
├──────────────────────────────────────────────────────────────────────┤
│  SERVER WORLD TRUTH (one process, one Postgres)                      │
│  plants · fauna · terrain volume · materials · water · climate       │
│  objects · damage · economy · ledger · seasons                       │
├──────────────────────────────────────────────────────────────────────┤
│  PERSISTENCE / STREAMING                                             │
│  binary plant snapshots · terrain chunks · material deltas · events  │
│  interest cells/chunks · per-client caps · keyframes                 │
└──────────────────────────────────────────────────────────────────────┘
```

## 4.2 Coordinate and precision model

PL's planet is large (default 100 km radius), while play happens near the surface. AG's 384 m box avoids precision problems by being small. PL needs an explicit model:

- **Server:** double-precision world coordinates in a planet frame. Spherical cells for planet-scale addressing. Pole-local tangent frame for gameplay near the spawn.
- **Client:** camera-relative rendering. Every render-space position is `worldPosition - cameraOrigin` (or chunk-local plus `chunkOrigin - cameraOrigin`). This avoids float32 jitter at 100 km from the origin.
- **Chunks:** local tangent frames anchored to a spherical cell. A chunk stores its origin as double on the CPU and uses float32 offsets inside the GPU buffers.
- **Physics:** double-precision server; float32 client. Rapier world recentered around the active play area; rebase when the camera moves more than a configured distance.
- **Precision rule:** no GPU buffer contains an absolute planet position. This becomes a C01/C03 acceptance criterion.

## 4.3 Unified frame and fallback

### Target
One render frame per device:

1. Shadow passes (cascades + local shadow atlas).
2. Opaque terrain chunks.
3. Opaque props, structures, large rocks.
4. Plant mesh tiers (T0/T1) and impostors (T2/T3).
5. Fauna.
6. Water surface and underwater volume.
7. Sky and atmosphere.
8. Transparent particles, light shafts, bioluminescence.
9. Post: bloom, tonemap, color grade, vignette, grain, dither.
10. UI is DOM, not in-frame.

### Primary path
WebGPU (DESIGN Part 14.2). Compute culling/ranking, indirect draw, storage buffers, texture arrays, GPU skinning, timestamp queries.

### Fallback
WebGL2 reduced path: no compute culling; CPU frustum culling by cell/run; simplified SDF or mesh plants; no volumetric shafts unless the post pass is cheap; 1 shadow cascade; reduced water; no impostor bake (use billboard atlas). The fallback must be *complete enough to play*, not a black screen. The current overlay path is not a fallback; it is a second renderer with a depth problem and should be retired or hidden behind a dev flag.

### Migration slices
| Slice | Scope | Exit criterion |
|---|---|---|
| U0 | Move environment meshes and plants to one API on a branch; keep current WebGL as fallback | One depth buffer; plants occlude against terrain |
| U1 | Port sky, ground, rain to the unified path | Weather visuals match current C03 |
| U2 | Add terrain chunks, water, post | Full frame graph stable at 60 fps |
| U3 | Remove the split-canvas path | `webgpu_enabled` no longer needed; one path per device |

Do not ship U0 to players until U1 is complete. A half-unified renderer is worse than the current split.

## 4.4 LOD contract

Tier numbering is owned by **`DESIGN.md` Part 14.2.0** and is not restated here (ADR-049). The table below keeps the plan's mapping to work but defers to that table for names and thresholds.

Every entity has a tier derived from projected size, importance, and visibility:

| Tier | Plant | Terrain | Fauna | Physics |
|---|---|---|---|---|
| T0 / L0 | Full node graph, SDF/mesh, full leaves, IK, shadow caster | 0.5–1 m voxels, trimesh | Full procedural body, animation | Full near-field Rapier; server full |
| T1 / L1 | Simplified mesh, fewer leaves, analytic sway, blob shadow | 2 m voxels, trimesh | Simplified body | Merged colliders; server reduced |
| T2 / L2 | Impostor/ellipsoid SDF, mutation tint | 4 m voxels, no collision | Animated billboard | None |
| T3 / L3 | Colored point / minimap dot | Global coarse shell | Dot | None |

**Rules:**
- Tier changes are hysteretic (promote 1.15×, demote 0.85×) with minimum dwell (0.5 s), as AG does.
- A tier never changes gameplay truth. A T3 plant still grows, starves, and dies.
- Own plant is pinned to T0 (or the best tier the device can afford) for readability.
- Cross-fades are dithered over 0.3 s; transitions are capped per frame.
- New entities arrive at T3 and promote progressively; never pop in at T0.

## 4.5 Budget model

| Device | Frame | Tris | Draw calls | L0 plants | L1 plants | Shadow cascades | Post |
|---|---|---|---|---|---|---|---|
| Desktop mid | 16.6 ms | ≤1.5 M | ≤400 | ≤100 | ≤1,280 | 2–4 | full |
| Phone mid | 16.6 ms | ≤400 K | ≤150 | ≤40 | ≤320 | 1 | minimal |
| Low-end | 33 ms | ≤150 K | ≤80 | ≤15 | ≤120 | 1 | none |

Server budgets (existing DESIGN 13.4/13.6):
- 20 Hz active, 5 Hz near, dormant step 30 s.
- Active share ≤70% of tick budget; warn at 40 ms.
- Per-client entity cap 200 default.
- Terrain chunk cap per client and per world; material active chunks ≤64.
- Fauna caps per species; not unbounded.

## 4.6 Data flow

```
Player intent
  → validate (auth, rate, bounds, energy, traits)
  → deterministic server apply
  → append event + revision
  → queue interest deltas
  → persist snapshot/event log
  → client interpolates
  → render tier chooses representation
```

No client step may skip validation. No visual cache may outlive its revision.

---

# 5. The editable planet

## 5.1 Planetary addressing

Keep the existing spherical grid (`sphericalGrid.ts`) as the planet-scale address. Extend it with altitude/layer:

```
SurfaceCellKey = (ring, longitudeIndex)
VolumeChunkKey = (ring, longitudeIndex, verticalChunkIndex)
```

For the play area near the pole, use a local tangent frame for performance and precision. A chunk knows how to convert local ↔ planet coordinates. This preserves the 100 km planet while keeping physics and rendering numerically stable.

**Acceptance:**
- A point can round-trip local → planet → local within 1 mm at 1 km from the pole.
- Neighbor queries work across the pole and longitude wrap.
- Chunk keys are stable across restarts.
- A chunk can be streamed by interest without loading the whole planet.

## 5.2 Environment field

Replace the three-resource MVP with a continuous environment field, while keeping light/moisture/minerals as the core plant resources.

```ts
interface EnvironmentSample {
  light: number;          // 0..100, includes canopy, water depth, cave occlusion
  moisture: number;       // 0..100, soil or water availability
  minerals: number;       // 0..100
  temperatureC: number;   // local temperature
  salinity: number;       // 0..100, fresh to hypersaline
  pressureKPa: number;    // atmospheric or hydrostatic
  ph: number;             // 0..14
  oxygen: number;         // 0..100
  co2: number;            // 0..100
  organicMatter: number;  // 0..100, dead matter / detritus
  flow: Vec3;             // water/air current
  substrate: 'soil' | 'rock' | 'water' | 'host' | 'air';
  waterDepthM: number;    // 0 above water
  medium: 'air' | 'water' | 'host' | 'void';
}
```

The server samples this at:
- coarse biome/climate grid (e.g., 32 m),
- local resource tiles (existing 1 m-ish grid),
- node positions for growth validity,
- chunk centers for material/succession.

**Rules:**
- Light is still the primary photosynthesis input. Water depth attenuates it; caves reduce it to near zero except shafts and bioluminescence.
- Moisture in soil and water availability in a water body are the same continuum but different media; a plant trait says whether it can use each.
- Temperature, salinity, pressure, pH, oxygen, and CO2 are tolerance fields, not new currencies.
- All fields are server-authoritative and interest-streamed at coarse resolution; local detail can be derived client-side from the same deterministic functions.

## 5.3 Terrain volume (T56)

### Representation
A sparse 3D chunk grid, not dense voxels:

```ts
interface TerrainChunk {
  key: string;                 // planet cell + vertical index
  originLocal: DVec3;          // double precision, local tangent frame
  sizeM: number;               // e.g. 32 m
  resolution: number;          // e.g. 32³ or 64³
  sdf: Int16Array;             // quantized signed distance, <0 solid, >0 air/water
  material: Uint8Array;        // material id per voxel
  flags: Uint8Array;           // water-filled, lava, organic, edited, collapsed
  revision: number;
  lod: 0 | 1 | 2 | 3;
  dirty: boolean;
  lastAccessTick: number;
}
```

- **SDF range:** fixed ±8 m per chunk, quantized to 1/256 m (int16). Larger features are represented by neighboring chunks; this keeps precision and memory predictable.
- **Chunk size:** default 32³ at 0.5–1 m voxels near play; 16³ at 2 m for far LOD. Configurable.
- **Materials:** air, soil, rock, sand, water, lava, organic, wood, ice, ash, metal. No per-material meshes; one shader with material blending.
- **Persistence:** binary chunk snapshot (SDF, material, flags, revision) + append-only edit events. Never one DB row per voxel.
- **Interest:** chunk radius around each client; per-client cap; priority by distance, view, and edit recency.
- **Eviction:** chunks not accessed for a configured time are saved and unloaded, except chunks with player edits inside the reconnect window.

### Generation (T57)
Use AG's density language, but as config-defined general primitives:

- `spline_sweep` (capsule/sweep along a polyline)
- `bezier_surface_patch`
- `extrusion`
- `volume_carve`
- `noise_blend`
- `boolean_add` / `boolean_subtract`
- `torus_arch` (a special case of sweep, but useful for arches)
- `clear_zone` (keeps spawn/Root Sight/viewpoints open)

Each feature has control points, radius/taper, twist, noise amplitude/frequency, blend radius, material, orientation, seed. No named outcomes. Rasterize deterministically on the server into chunk SDFs. The client may compute the same field for visual detail, but the server result is truth.

**Generation stages:**
1. Base planet surface from the existing `terrainField` (seed, amplitude, ridge).
2. Sea level and large basins.
3. T57 features (uplift, arches, overhangs, caves, tunnels).
4. Hydraulic/thermal erosion pass (optional; config).
5. Connectivity cleanup: remove isolated generation islands, keep player-created ones.
6. Material assignment by depth, slope, moisture, temperature.
7. Initial vegetation/soil seed points (T59).

### Meshing and LOD
- Surface nets per chunk with a 1-voxel border sampled from the neighbor field.
- Weld vertices at chunk borders by hashing global voxel coordinates; store a seam index per chunk.
- LOD skirts hide cracks between different resolutions; no visible gaps.
- Normals from SDF gradient (central differences), not face normals.
- Material blending in the fragment shader: soil/rock/sand/organic by material id + noise.
- Collision mesh generated only for chunks at LOD0/L1, using the exact drawn vertices (T25 pattern).
- Caves and overhangs are meshed by the same surface nets; no separate cave system.
- Underground water surfaces are separate flat/flowing meshes at water level.

### Collision and queries
- Near: Rapier trimesh from LOD0/L1 chunk vertices, with a small inflation.
- Far/server: SDF brick cache and direct SDF sample for roots, fauna, camera, and projectile-like queries.
- `surfacesAt(x,z)` returns all floor/ceiling intervals per column, so scatter/spawn can use cave floors and overhangs (AG's `floorsAt`).
- Camera collision: sphere cast against trimesh near; SDF gradient push-out in caves (AG's `collide`).
- Root growth: segment-vs-SDF sampling; resistance from material/compaction; tunnel edits.

### Edits
An edit is a validated brush operation:

```ts
interface TerrainEdit {
  id: number;
  tick: number;
  actorId: string | null;
  kind: 'root_tunnel' | 'excavate' | 'deposit' | 'compact' | 'collapse' | 'erode' | 'freeze' | 'melt' | 'sediment';
  shape: 'sphere' | 'capsule' | 'box' | 'spline';
  points: Vec3[];
  radiusM: number;
  material: MaterialId;
  volumeM3: number;
  revisionBefore: number;
  revisionAfter: number;
}
```

Validation:
- actor exists and is allowed (root growth, fauna digging, material reaction, or a future tool).
- volume ≤ per-action cap; rate ≤ per-actor cap.
- target chunk is loaded/owned by the server.
- resulting material state is valid (no creating water from nothing; conservation rules per T55).
- edit does not disconnect a player-created structure in a way that would corrupt physics; instead schedule collapse.

**Provenance:** every edit keeps actor, tick, position, kind. Player-caused edits are visible in the world's history; erased content leaves a tombstone per RULE_5. Do not expose a UI that explains outcomes.

### Revisioned caches
This is where PL must diverge from AG:

| Cache | Invalidation |
|---|---|
| Chunk mesh | chunk revision |
| Chunk collision | chunk revision |
| Shadow map | sun movement, caster change, terrain revision in the cascade |
| Skylight/openness volume | canopy/terrain revision in the region |
| Impostor atlas | plant shape revision |
| Water surface | water level/flow revision |
| Biome tint | climate/season update |
| Scatter instances | environment/succession revision |

Never keep a cache across a revision change. Use a ring of revision keys and rebuild only dirty regions.

## 5.4 Sea, water, and sky

### Water model (T31 + T55 + C10)

> **Two slices (ADR-045).** Slice one is lakes, rivers and rain-filled pools: volume, surface, buoyancy, shoreline blend, T25 basins, T07 rain. The global sea, salinity, pressure, depth biomes and underwater plant traits described below are **slice two**, after caves and fauna. Read this section as the slice-two target, not the first release.

Water is a material volume plus a surface, not a single plane:

- **Global sea level** per planet/season (T20).
- **Water bodies:** ocean, lake, river, underground aquifer, cave pool. Defined by connected water cells and a surface level.
- **Depth:** hydrostatic pressure from depth; light attenuation with depth; temperature stratification optional.
- **Flow:** T55 material CA at 2 Hz for active chunks; rivers flow downhill; currents in oceans from a coarse flow field; waves are a visual layer driven by weather/wind.
- **Salinity:** fresh/salt/brackish field; affects plant traits, buoyancy, corrosion, and material reactions.
- **Ice:** surface freezing at low temperature; ice is a material state, not a separate system.
- **Water edits:** damming, diversion, evaporation, rain, flooding; all via T55/T56 events.

### Rendering
- Surface: AG's `W_SURF` adapted for above/below, with refraction, sky reflection, Fresnel, foam at shorelines, and depth-based color. Waves are a sum of directional waves + weather amplitude.
- Underwater: AG's absorption `fogIn` with per-channel extinction, depth, salinity, and turbidity; caustics projected along the sun; god rays; particulate matter.
- Above water: aerial perspective, not water absorption.
- Shoreline: soft blend between terrain, wet soil, shallow water, foam; no hard seam.
- Caves: water surface with dark reflection, drip ripples, mineral tint.
- Performance: low tier uses a flat water plane with a cheap normal map and no refraction; medium uses one refraction pass; high uses depth-aware refraction and caustics.

### Sky
- C03 owns the sky dome. Extend it with:
  - physically motivated atmospheric scattering (single-scattering approximation),
  - sun/moon/stars,
  - procedural cloud layer (2D noise, optional volumetric for high tier),
  - weather-driven cloud coverage, haze, and precipitation,
  - biome/climate tint (dust, humidity, sea haze),
  - lightning illumination,
  - aurora only if added later as a general atmospheric phenomenon, not a named biome.
- AG's sky is underwater; do not copy it. Use its *structure*: a small number of analytic terms, a phase function, and a restrained palette.

## 5.5 Caves and the underground

Caves are part of T56, not a separate system:

- Air-filled, water-filled, or flooded; determined by water connectivity.
- Light: near-zero except entrance shafts, bioluminescence, and player/plant emissive light.
- Environment: high humidity, stable temperature, elevated CO2, minerals, organic matter.
- Root Sight: cutaway must march the volume, not just the height field. T02's shader ownership remains; C03/C10 reuse it for volumetric cutaways.
- Cave flora: general traits (low-light metabolism, saprotrophy, chemosynthesis, parasitism) plus attachment to rock/host.
- Cave fauna: T54 species with darkness/water/shelter needs; no new AI type.
- Physics: cave roofs and walls are trimesh/SDF; camera collision uses SDF gradient; falling rocks use Rapier near.
- Audio: convolution reverb from cave size; water drips; fauna calls.

## 5.6 Weather, climate, biomes

### Weather (T07, extended)
Keep the existing clear/rain/thunderstorm state machine. Add:
- wind fields (direction, gusts) affecting plants, particles, water, and fire;
- snow/sleet in cold biomes;
- fog/mist;
- heat/drought;
- weather fronts moving across the planet (coarse grid), not just a global state;
- forecast from the server's weather grid;
- per-biome weather modifiers (no longer constant 1.0).

### Climate (T39)
A slow field: seasonal temperature, rainfall, humidity, prevailing wind, sea level. Updated at low frequency, persisted, and fed by T20 deep time. Climate memory records long-term averages and extremes, so a region can become wetter/drier.

### Biomes
Do not implement named biomes as scripted zones. Implement a **biome field**:

```
temperature, moisture, salinity, light, pressure, nutrients, altitude, waterDepth, substrate
  → config thresholds → biome parameters
```

Biome parameters include palette, soil type, vegetation density, fauna spawn weights, weather modifiers, and ambient audio. The *names* are display labels in config; the mechanics are continuous. This satisfies "biomes" without violating RULE_7.

**Biome coverage required by the design:**
- temperate surface (MVP),
- arid/dry,
- cold/tundra/ice,
- wetland/marsh,
- freshwater,
- coastal/marine,
- deep ocean,
- cave/underground,
- volcanic/thermal (if T55 lava is present),
- high-altitude/rocky,
- host/epiphyte microhabitats (not a biome; a trait/attachment).

## 5.7 Deep time and succession

### T20 deep time
- Never regenerate the planet. Apply transformation operators to the existing volume and fields:
  - uplift/subsidence,
  - erosion/deposition,
  - volcanism,
  - sea-level change,
  - climate shift,
  - biome redistribution,
  - fossilization of player scars.
- Re-run only the affected chunks and fields; not the whole planet.
- Time-lapse is a replay of the same event stream, not a re-simulation from scratch.
- All plant deaths at season end go through T06A, as designed.
- The next season starts from the transformed planet, not a blank one.

### T59 succession
- Stages: bare substrate → pioneer → grass → shrub → woodland → forest (config).
- Driven by environment, seed bank, disturbance, and time.
- Dead matter → organic matter → soil minerals.
- Erosion/sedimentation moves material and fills pits.
- Fire/lava/flood/overgrazing/root tunneling reset stages locally.
- Recovery is natural, weather-dependent, and guaranteed within a configured maximum; no irreversible collapse.
- **Important:** succession is a server simulation of vegetation *potential*, not a client scatter rule. The client renders instances derived from server state.

---

# 6. Life: plants, fauna, and ecology

## 6.1 Plant traits and growth medium

Add a general trait layer to T04/T24. Traits are data, not new node types.

```ts
interface PlantTrait {
  id: string;                    // config-defined, no rarity
  kind: 'tolerance' | 'metabolism' | 'structure' | 'attachment' | 'reproduction' | 'defense';
  maintenanceCost: number;
  effects: {
    temperature?: Range;
    salinity?: Range;
    pressure?: Range;
    ph?: Range;
    light?: Range;
    moisture?: Range;
    oxygen?: Range;
    buoyancy?: number;
    drag?: number;
    structuralStrength?: number;
    metabolism?: ('photosynthesis' | 'chemosynthesis' | 'saprotrophy' | 'parasitism' | 'symbiosis')[];
    attachment?: ('soil' | 'rock' | 'water' | 'host_surface' | 'host_interior')[];
  };
}
```

The server evaluates growth at each proposed node:

1. Is the target position inside a valid medium for the node and the plant's traits?
2. Does the environment sample satisfy tolerances?
3. Is there room? (collision/SDF)
4. Is the parent chain alive and supplied?
5. Is the growth direction allowed by genes (existing `clampGrowthDirectionByGene`)?
6. Does the plant have biomass/water/minerals/energy?
7. Apply growth, emit event, update resource/terrain/light fields.

This is the single mechanism that lets plants live on the surface, underwater, in caves, on hosts, and inside hosts.

## 6.2 Plants everywhere

| Habitat | How it works | Design fit |
|---|---|---|
| Surface soil | Existing root/canopy growth; light photosynthesis | T01/T00A |
| Shallow water | Roots anchor in sediment; leaves at surface or submerged; buoyancy trait; light attenuation | T31 |
| Deep water | Pressure/salinity tolerance; low light; chemosynthesis/saprotrophy/parasitism; buoyancy control | T31/T24 |
| Caves | Low light; humidity; chemosynthesis/saprotrophy; attachment to rock; root networks in cracks | T56/T59 |
| On other plants (epiphyte) | Attach to host surface; use host light/space; no drain unless parasitic | T09/T10 extension |
| Inside another plant (endophyte/parasite) | Attach to host node; grow through host tissue; drain or share; host can reject/shake | T10 |
| Parasite | T10: biomass ratio/consent, drain, public attachment, shake-off, prestige only non-consensual | T10 |
| Symbiont | T09: root-link, shared resources/vision, severing cost | T09 |
| Floating/aquatic | Buoyancy trait; gas-filled structures; current drag; tumbling | T06/T31 |
| On fauna | Rare, general attachment trait; not a new creature system | T54/T10 |
| In air (epiphytic on structures) | Attachment to T58 world objects; moisture from air; slow growth | T58/T31 |

**No special aquatic mutation category.** The trait is general. A desert plant can acquire salinity tolerance if pressured; a surface plant can acquire pressure tolerance. The environment and maintenance cost decide whether it survives.

## 6.3 Metabolism without breaking T00A

T00A says only leaf nodes photosynthesize. Keep that as the default and primary path. Add general metabolic *traits* that modify or supplement it:

- **Photosynthesis:** leaves, light, water, minerals. Existing.
- **Chemosynthesis:** leaf/root-like nodes, chemical energy from minerals (e.g., sulfur/iron), very low rate, high mineral upkeep. General trait.
- **Saprotrophy:** root nodes absorb organic matter from dead plants/fauna/dung. General trait.
- **Parasitism:** T10 drain. Existing.
- **Symbiosis:** T09 sharing. Existing.

All produce biomass through the same growth/upkeep pipeline. No parallel economy. No "aquatic photosynthesis" special case.

## 6.4 Parasitism, epiphytism, and host interaction

T10 already defines the gameplay contract. Extend with physical/visual rules:

- Attach to a host node's surface using a small attachment organ (a root/vine node).
- The host and parasite occupy the same volume; collision must not eject the parasite. Use attachment constraints, not rigid-body collision.
- Parasite drain reduces host biomass/energy and appears as a visible connection.
- Host shake-off applies force/damage to the attachment and costs biomass.
- Multiple parasites allowed per T10.
- A parasite inside a host is occluded by the host's body; render it with a subtle internal glow or Root Sight only. Do not make it a floating separate model.
- Host death releases the parasite; it becomes uprooted/tumbling (T06) unless it can re-root.
- Prestige only for non-consensual drains.

Epiphytes use the same attachment mechanism without drain. This is a general capability, not a named "epiphyte" system.

## 6.5 Fauna (T54, C11)

### Server
- Persistent, server-authoritative entities with needs (hunger, thirst, fear, fatigue, herd, shelter, temperature, salinity, pressure).
- Senses: sight, smell, vibration, water pressure.
- Deterministic reflexes: graze, drink, flee, herd, sleep, seek shelter, attack a plant, struggle, escape.
- Influence maps: threat, food, water, fire, shelter, darkness. Recomputed at low frequency.
- Habitat: surface, water, cave, air; body plans config-defined.
- Plants can trap/entangle; fauna struggle/damage the trap; either side can die.
- Population caps, spawn sources, despawn, migration, local extinction.
- Offline tiers and interest management.
- No speech, quests, judgment, factions, planning. Animal vocalizations only.

### Client (C11)
- **Bodies:** procedural, no asset pipeline. Use AG's `meshFish`/`meshManta`/`Mesh.tube` thinking: body plan from a small config (segments, radius profile, fins, legs, wings).
- **Animation:** vertex-shader body wave for fish/eels/worms; simple joint chains for legged fauna; herd motion from server transforms; no per-agent skeleton hierarchy on CPU.
- **LOD:** full body near, simplified body mid, animated billboard far, dot beyond.
- **Instancing:** one draw per body plan/LOD; per-instance transform, phase, color, size.
- **Vocalizations:** server event → C06 positional voice with range/volume/cooldown. No human words.
- **Traps:** visible attachment lines/constraints; struggle animation.
- **Physics:** capsule bodies near; kinematic far; terrain/water queries server-side.

## 6.6 Ecological interaction matrix

Every cell is a mechanism, not a scripted outcome:

| Actor ↓ / Target → | Terrain | Water | Light | Plant | Fauna | Material |
|---|---|---|---|---|---|---|
| **Plant** | roots tunnel, compact, displace, deposit | roots filter, transpire, alter flow | canopy blocks, leaves absorb | competition, parasitism, symbiosis, epiphytism | trap, feed, poison, shelter | roots fracture rock, absorb minerals |
| **Fauna** | burrow, compact, erode | drink, wade, swim, muddy | trample/graze canopy | graze, pollinate, spread seeds, damage | predation, herd, competition | dig, consume, deposit dung |
| **Weather** | rain erodes, wind moves dust, frost cracks | fill, evaporate, freeze, flood | clouds/season change light | damage, uproot, trigger mutation | shelter/flee, migration | wet/dry, freeze/melt, ignite |
| **Water** | erode, deposit, flood caves | flow, mix, salinity | attenuate | buoyancy, drag, submerged growth | habitat, drowning, currents | dissolve, rust, freeze |
| **Players** | grow, tunnel, build via roots/vines, claim | dam/divert (if tools later) | shade | all of the above | tame, trap, hunt | harvest, burn, craft (later) |
| **Materials** | lava melts, ash deposits, sand collapses | lava boils, water floods | smoke blocks light | fire/lava damage, ash fertilization | fire/lava kills, smoke flees | reaction matrix |

This matrix is the "nothing is static" guarantee. It also defines the minimum test coverage.

---

# 7. Rendering 10k unique plants and a living world

## 7.1 Renderer convergence

Follow DESIGN Part 14.2 exactly:

- WebGPU primary: compute culling/ranking, storage buffers, indirect draws, texture arrays, GPU skinning, timestamp queries.
- WebGL2 fallback: reduced path, no compute; cell/run culling; mesh/SDF plants; 1 cascade; no volumetric shafts.
- No mixed WebGL/WebGPU canvas. The current overlay is a dev-only path until U0–U3 complete.

### Frame graph
A small explicit frame graph (not a scene-tree render) is recommended, modeled on AG's encoder order:

```
begin frame
  update uniforms (preallocated)
  shadow cascades (cascade 0 nearest, 1 mid, 2 far)
  opaque terrain chunks (front-to-back)
  opaque props/structures
  plant mesh tiers (T0 then T1)
  fauna
  water surface (refraction prepass if high)
  sky
  impostors/billboards (alpha-tested, sorted by tier)
  transparent particles / shafts / bioluminescence
  post (bloom, tonemap, grade, dither)
end frame
```

No per-frame `new`, no array spreads, no per-entity material binds.

## 7.2 Plant appearance model

Every plant has a compact appearance record:

```ts
interface PlantAppearance {
  appearanceSeed: number;     // 64-bit-ish hash from plant id + genes
  mutationMask: number;       // bitset of visual signatures
  mutationParams: [number, number, number]; // max 3 per art bible
  textureSet: number;         // texture array index
  leafShape: number;          // array layer / card variant
  barkTone: number;           // 0..1
  leafTone: number;           // 0..1
  flowerTone: number;         // 0..1
  bioluminescence: number;    // 0..1
  healthTint: number;         // 0..1
  growthEase: number;         // animation state
  height: number;             // bounding extent for impostor
  radius: number;
}
```

This is what makes 10k plants unique without 10k assets:
- texture array layer + two-layer blend for hybrids,
- hue/vein/gradient from `appearanceSeed`,
- mutation signatures (max three shader params),
- growth/health/wind state,
- L3 atlas view (single view, colour only).

No `rarity` field. No glow that implies tier.

## 7.3 GPU data layout and compute

### Buffers (preallocated, pooled)
- `PlantHeader[10000]`: center, radius, appearance seed, mutation mask, tier, importance, bounds, flags.
- `PlantNode[]`: SoA or packed struct; only near plant node data uploaded.
- `PlantMeshPool`: fixed slots per tier, as DESIGN 14.2.1.
- `L3Atlas`: one colour-only view per distant plant (2–12 px). L2 is an ellipsoid SDF and needs no atlas entry (ADR-042).
- `LeafInstances`: per-leaf packed data (branch id, local transform, seed, mutation bits).
- `JointMatrices`: per-plant branch poses for GPU skinning.
- `DrawArgs`: indirect args per tier/batch.

### Compute passes
1. **Cull/rank:** frustum + planet occlusion + distance + importance; assign tier with hysteresis/dwell.
2. **Pose:** for T0 plants, walk branch tree and write joint matrices; analytic sway for T1.
3. **Leaf cull/compact:** optional; AG does cell/run culling on CPU, but GPU compaction is better for 10k.
4. **L3 atlas selection:** one colour-only view per plant — no camera-angle lookup, no multi-view bake; prefetch the next tier. L2 is an ellipsoid and needs no view selection (ADR-042).

### Draw
- T0/T1: one indexed draw per tier batch; instanced by plant.
- T2: ellipsoid SDF impostor — one sphere trace per pixel, no quad and no atlas.
- T3: one instanced quad draw sampling the colour-only atlas.
- Own plant: pinned T0, separate draw for outline/highlight if needed.
- Cross-fade: dither in fragment shader; render both tiers for the transition window.

### Budgets
- 10k headers + 200 visible plants is trivial. 10k full node graphs is not; only interest plants upload nodes.
- T0 pool 256 × 80 KB ≈ 20 MB; T1 1,280 × 20 KB ≈ 26 MB; **L2 ellipsoid ≈ 0 MB** (header params only); **L3 colour atlas ≈ 37 MB** for 9k plants (ADR-042). The older "≈ 170 MB impostors" figure was the full-fidelity multi-view atlas and does not apply. Phone caps are lower.
- No VRAM query; count allocations and use a startup benchmark. Device loss rebuilds from server state.

### 7.3.1 What "10k unique" means, and how it is proven

"Unique" does not mean unique geometry, unique texture files, or unique shaders. It means **no two plants produce the same observable identity** from the player's point of view.

Identity fingerprint:

```
(appearanceSeed, textureSet, leafShape, barkTone, leafTone, flowerTone,
 mutationMask, mutationParam0..2, growthEase, healthTint, windPhase)
```

- `appearanceSeed` is derived from the plant id + gene signature with a stable hash, so reconnects and restarts reproduce the same look.
- Texture set and leaf shape choose from shared arrays.
- Mutation parameters and mask are server data.
- Growth/health/wind are live state.
- Two plants may share a texture set; they must differ in at least one visible dimension.

Acceptance test:

1. Generate 10,000 deterministic fingerprints from synthetic ids/genes.
2. Quantize the visible fields to their shader precision.
3. Assert no two fingerprints collide after quantisation — a real check on the hash and quantisation widths, not a proof of visual difference.
4. Render a contact sheet of 100 random plants; a reviewer must be able to distinguish them at gameplay distance.
5. Verify the same id produces the same fingerprint after reload.

This is the concrete proof that the 10k target is a data/LOD problem, not an art-production problem.

## 7.4 Materials, textures, mutations

- **Texture arrays:** bark, leaf, flower, spore sac, seed; 256²/512²; KTX2/Basis; procedural fallback.
- **Channels:** albedo, normal, roughness, emission mask. Pack where possible.
- **Mutation masks:** per-node bits (bioluminescent, thickened bark, variegated). Shader applies max three parameters, per art bible.
- **Health/damage:** wilt blends geometry/shader; local darkening at contact; no separate damage mesh.
- **No per-player texture.** Variation is procedural + array layer + params.
- **No rarity glow.** Bioluminescence describes a function, not a tier.

## 7.5 Lighting for 10k plants

### Global
- One directional sun (day/night, weather).
- Hemispheric ambient from sky.
- Aerial perspective and height fog.
- Exposure/tone mapping per time of day.

### Local and per-plant
- **Per-plant emissive** for bioluminescence, flowers, spores; drives bloom and a small light contribution.
- **Clustered light grid** for a budgeted number of local emitters (e.g., 8–32): glowing plants, lava, fire, lightning, cave crystals. Each fragment reads the nearest lights; no 10k dynamic lights.
- **Light probes / irradiance volume** for ambient bounce in caves and under canopy. Coarse, updated at low frequency; revisioned.
- **No per-plant light object.** A plant's "own lighting" is an emissive/tint parameter, not a new light in the scene.

### Shadows
- **Cascaded sun shadows** (2 desktop, 1 phone) with stable filtering.
- **Caster budget:** own plant + nearest L0 plants + key props. T1 uses blob/contact; T2/T3 cast none.
- **Terrain shadow cache:** static within a revision; rebuild only dirty cascade regions.
- **Local shadow atlas:** optional for a few important emitters/structures; not per plant.
- **Contact shadows:** screen-space or small blob under T1 plants; cheap and readable.
- **Canopy shade:** the server already computes light blocking; the client uses it for ground shading and skylight volume, so a plant's shadow is not purely a renderer artifact.
- **Revisioned:** when a plant grows or terrain changes, invalidate the affected cascade pages, not the whole map.

## 7.6 Atmosphere, sky, weather, and water

### Atmosphere
Port AG's `fogIn` structure, but as **aerial perspective** for a land world:

- per-channel extinction,
- height-dependent density,
- sun in-scattering with a phase function,
- distance/height fog,
- weather-driven density and color,
- underwater variant with depth absorption and caustics.

Use the same function in every custom material, so terrain, plants, fauna, water, and sky agree. `THREE.Fog` alone cannot do this; custom shaders need the shared function.

### Light shafts
- Half-res pass, 16–34 samples depending on tier.
- Shadow-map visibility at each sample.
- Canopy/cave occlusion from the skylight volume.
- Jittered sampling + depth-aware blur + depth-aware upsample.
- Weather/time-of-day modulation.
- WebGL post first; WebGPU post after unification.
- Phone: disabled or 8 samples max.

### Detail texture
- Bake a tileable RGBA detail texture once at startup (slope, height, mottle, crack).
- Triplanar sample on rock/soil.
- No asset file; no network cost.
- Config scale/strength.

### Post
- Bloom with Karis average (AG), tonemap, vignette, grain, dither.
- Desktop only by default; phone gets tonemap + dither only.
- No full-screen post that hides gameplay readability.
- Photosensitivity: lightning/bloom limits configurable; no strobing beyond design 19.4.

## 7.7 Terrain and cave rendering

- Chunk meshes from surface nets, material blending.
- LOD skirts; no cracks.
- Front-to-back opaque order.
- Caves: darker ambient, dampness, mineral sheen, water surfaces, bioluminescence.
- Root Sight: volumetric cutaway; reveal roots/soil layers; no second surface showing through the sky.
- Edits: dirty chunk remesh; incremental; budgeted per frame (e.g., 1–2 chunks/frame) to avoid spikes.
- Far terrain: coarse shell with normal/color from the same field; no pop.

## 7.8 Foliage and ground scatter

- Generate instances from server environment/succession state, not client noise.
- Bucket by cell/chunk; store min/max bounds.
- LOD pipelines: 9-row, 5-row, 3-row blades (AG); use 3 for grass, 5 for undergrowth, 9 for hero plants.
- Cull by frustum, distance, terrain occlusion, and canopy light.
- Merge runs; GPU indirect on WebGPU.
- Wind: global coherent field; stiffness per type; no CPU animation.
- Interaction: trampling by fauna, damage by weather, harvest by players → server updates density/revision.
- No 2M instances on phone; budget per tier.

## 7.9 Fauna rendering

- Procedural bodies, vertex animation, instancing.
- LOD and herd batching.
- Traps/entanglement visuals.
- Vocalization events.
- No per-fauna materials; palette/params per instance.

## 7.10 Transparency and ordering

- Opaque: terrain, plants T0/T1, fauna, props.
- Alpha-test: leaves, grass, impostors (no blending where possible).
- Transparent: water, particles, shafts, bioluminescence, UI-like world markers.
- Sort transparent by depth; water surface after opaque; underwater volume before surface.
- Depth prepass for alpha-tested foliage on desktop if overdraw is high (DESIGN 14.2.3).

## 7.11 Quality tiers and dynamic resolution

Rebuild `QualityController` around GPU time:

- Inputs: GPU ms (WebGPU timestamp or WebGL timer query), CPU frame ms, triangle count, visible entity count, VRAM estimate.
- Control band: target min/max GPU ms (e.g., 9.8–13.6 at 60 Hz).
- Scale order: pixel budget → draw distance → post quality → shadow cascade → plant tier budget → scatter density.
- Hysteresis and cooldown to prevent oscillation.
- Persist `{tier, pixelBudget, drawDistance, postLevel}` per device; if a load crashes, start one tier lower; on device loss, reload lower.
- Never drop below a configured floor; never reduce gameplay truth.
- Pause rendering when hidden; idle drop to 30 fps; restore on input.
- Battery saver option.

## 7.12 Fallback and failure modes

- WebGPU unavailable → WebGL2 path with reduced features.
- Device lost → rebuild from server state; reload one tier lower.
- OOM → free impostor/cache pools, reduce draw distance, notify once.
- Shader compile failure → fallback material, log, never black screen.
- Corrupt chunk → re-request from server; if unavailable, render a neutral shell and report.
- Network loss → freeze remote state, keep local camera; reconnect snapshot.
- Server tick overrun → shed dormant work first, then near; never active.

---

# 8. Physics and collision

## 8.1 Authority model

| Thing | Server | Client |
|---|---|---|
| Plant growth/damage | Deterministic analytic | Visual only |
| Root competition | Analytic overlap | Visual |
| Uproot/tumble/reroot | Custom deterministic solver | Cosmetic Rapier |
| Terrain collision | SDF/trimesh queries | Rapier near |
| Fauna movement | Deterministic steering + collision | Interpolated |
| Water buoyancy/current | Analytical per body | Cosmetic particles |
| Debris/fragments | Event/ownership | Rapier bodies near |
| Camera | Client (cosmetic, not gameplay) | Rapier sphere cast |

The client never resolves a gameplay outcome by physics. It can predict camera movement and local cosmetic motion only.

## 8.2 Fixed step and interpolation

- Server: 20 Hz active; fixed dt. Sub-step fast events (falling, tumbling) if needed.
- Client: 60 Hz Rapier; fixed 1/60; accumulator; max 3 steps/frame.
- Remote entities: 100 ms interpolation buffer; extrapolate only short, non-gameplay transforms.
- Plant growth: interpolate `growthProgress` and node positions from server keyframes; do not run growth locally.
- Damage/death: server event; client visual reaction after event, not before.

## 8.3 Collider LOD and budgets

Formalize the existing `config/physics.json` owner C02c:

- `max_colliders_per_plant`: 192 default, 384 desktop high.
- `max_collider_plants`: 24 default, 64 desktop, 16 phone.
- `collider_lod_distance_m`: 70 m; beyond, merge chains or drop.
- Leaf colliders: none/box/hull by tier.
- Joint spheres: off by default.
- Debris bodies: 24 default; 64 desktop.
- Camera probe radius: 0.25 m.
- Rebuild Hz: 10.

Collider plan (existing `plantColliderPlan.ts`) is the single source. Extend it for:
- nodes inside hosts (attachment constraints, not collision),
- underwater buoyant nodes,
- cave walls/roofs,
- terrain chunks,
- fauna capsules,
- fragments.

## 8.4 Terrain and cave collision

- Near: Rapier trimesh from LOD0/L1 chunk vertices. Exact drawn vertices, so visual and physical surfaces agree (T25 pattern).
- Far/server: SDF sample + gradient; sphere/capsule queries; segment marching for roots.
- Camera: sphere cast near; SDF push-out in caves; no clipping through thin walls.
- Plants: root/stem capsules from the collider plan; host attachment constraints.
- Fauna: capsule/ball bodies; sample ground/water.
- Debris: dynamic Rapier bodies; despawn/sleep.
- Water: sensor volumes + buoyancy; no fluid rigid-body coupling.

## 8.5 Water physics

- Buoyancy: `F = displacedVolume × waterDensity × gravity`; drag along velocity; current adds force.
- Anchored plants: roots hold; buoyant canopy pulls; structural strength resists; storm/current can uproot.
- Tumbling: buoyancy + drag + collision; floats/sinks based on trait.
- Fauna: swim speed, buoyancy, depth tolerance.
- Debris: floats/sinks by material density.
- Player camera: underwater movement is camera-only, with drag/visual effects; no avatar.

## 8.6 Tumbling and uprooting

- Server state machine: rooted → uprooted → tumbling → re-rooting → rooted.
- Forces: weather, root attack, fauna, terrain collapse, water current.
- Tumbling path: simple rigid-body approximation against terrain/water; no full ragdoll.
- Re-root: crawl toward valid substrate; speed × substrate × movement trait; failure death.
- Client: cosmetic Rapier body follows server path; no authority.

## 8.7 Determinism and tests

- Server math is deterministic for a fixed input sequence and seed.
- No `Math.random` in simulation; use seeded RNG (`hash32`/`mulberry32`).
- Fixed-step tests compare one 0.1 s step with two 0.05 s steps.
- Replay tests: record intents + seed, replay, compare hashes of plant/terrain state.
- Physics tests: capsule-vs-SDF, camera push-out, buoyancy equilibrium, tumbling rest, cave roof collision.
- Cross-check server analytic vs client Rapier for near plants; divergence beyond tolerance is a bug.

## 8.8 10k scale

- Only active/near plants get server collision queries.
- Client only near plants get Rapier bodies.
- Broadphase spatial hash for roots/canopy; no all-pairs.
- Collider plan merges chains; budget caps.
- Fauna caps and LOD.
- Profiling gates: tick budget, frame budget, memory, network.

## 8.9 Debug tools

- Collider overlay by layer.
- SDF slice view for terrain.
- Chunk bounds/material ids.
- Physics body counts/sleep states.
- Determinism replay hash.
- Terrain edit history.
- Network interest/cap visualization.

---

# 9. Networking, persistence, and streaming

## 9.1 Binary protocol

Move from JSON to the DESIGN 13.8 binary protocol:

- Header: `[version:u8][type:u8][payload]`.
- Hot messages: quantized positions (1/64 m), radii (1/256 m), angles (16-bit), flags, varints.
- Cold messages: generic binary encoder behind the same codec.
- Client intents + ack/reject with reason.
- Delta + keyframe.
- Per-message rate limits.
- Protocol version mismatch → friendly update screen.
- No compression on hot path; optional for cold large payloads.

## 9.2 New / extended messages

| Message | Purpose |
|---|---|
| `PLANT_SUMMARY` | L2/L3 plant representation: bounds, color, mutation mask, appearance seed, health, age |
| `PLANT_DELTA` | Node growth/damage/removal with quantized transforms |
| `TERRAIN_CHUNK` | Chunk snapshot: SDF, material, flags, revision |
| `TERRAIN_EDIT` | Brush event with actor/tick/volume |
| `MATERIAL_DELTA` | T55 cell changes for active chunks |
| `WATER_STATE` | Water level, flow, salinity, temperature for a region |
| `ENVIRONMENT_UPDATE` | Coarse temperature/moisture/pressure/light fields |
| `FAUNA_SPAWN/MOVE/STATE/ATTACK/TRAP/ESCAPE/DIE/VOCALIZE` | T54 |
| `OBJECT_CREATE/UPDATE/REMOVE` | T58 |
| `BIOME_UPDATE` | Climate/biome parameter changes |
| `SEASON_STATE` | Existing season clock + calamity |
| `PHYSICS_CORRECTION` | Rare server correction for a predicted local body |
| `BENCHMARK` | Dev-only perf request/response |

## 9.3 Interest and priority

- Existing cell interest (64 m) extended to a 3D volume/chunk interest for caves and water.
- Per-client caps by type: plants, fauna, chunks, fragments, objects.
- Priority = distance + screen size + importance (own plant, target, party, recent edit).
- Coarse summaries for entities beyond the detail radius.
- Chunk streaming by distance/view; prefetch in movement direction.
- Edits broadcast only to interested clients; revision prevents stale applies.

## 9.4 Persistence

| Data | Format | Notes |
|---|---|---|
| Plant node graph | Binary snapshot + event log | Existing `PLNT` envelope, CRC32 |
| Plant appearance | Compact record | Seed, mutation mask, params, texture set |
| Terrain chunk | Binary SDF/material/flags + revision | Never per-voxel rows |
| Terrain edits | Event log + snapshots | Time-sliced |
| Materials | Delta log per active chunk | T55 |
| Water | Coarse field + volume snapshots | T31/T55 |
| Fauna | Per-entity snapshot + event log | T54 |
| World objects | Registry + snapshot | T58 |
| Climate/season | Rows + snapshots | Existing `world_state` |
| Ledger/provenance | Relational + ledger | T16 |

- Save cadence time-sliced; no tick spikes.
- Compaction after threshold.
- Restore drill in O02; verify a chunk edit survives restart.
- Schema migrations versioned; old plant snapshots remain readable.

## 9.5 Anti-cheat

- All edits/growth/damage/physics outcomes validated server-side.
- Rate/volume/energy checks per action.
- No client terrain authority.
- No client-calculated loot/genes.
- Teleport/speed validation for camera/observer only if it affects interaction; currently camera-only.
- Suspicious edit patterns logged; RULE_6 compliance-only moderation still applies.
- Replay/determinism checks in H01.

## 9.6 Backpressure

- Drop/coalesce state updates for slow clients; keyframe heals.
- Cap bytes per client per second.
- Prioritize own plant and nearby edits.
- Never grow an unbounded queue.
- Log per-client backlog; warn at threshold.

## 9.7 Server data model for 10k plants

The current `PlantWorld` is object/map based. That is excellent for correctness and bad for a 10k hot loop. The target is not a full ECS rewrite; it is a **structure-of-arrays hot path** with maps kept for cold lookup.

### Records

```ts
interface PlantRecord {
  id: number;                 // dense index
  ownerId: number;
  rootNode: number;           // index into node store
  nodeStart: number;
  nodeCount: number;
  tier: 0 | 1 | 2 | 3;
  lastTick: number;
  biomass: number;
  energy: number;
  water: number;
  minerals: number;
  health: number;
  age: number;
  appearanceSeed: number;
  mutationMask: number;
  flags: number;              // alive, uprooted, submerged, dormant, edited
  bounds: Float32Array;       // six floats, SoA
}

interface NodeRecord {
  id: number;
  plantId: number;
  parent: number;
  type: number;
  medium: number;             // air, water, host, void
  x: number; y: number; z: number;
  radius: number;
  biomass: number;
  health: number;
  growthProgress: number;
  flags: number;
  hostNode: number;
}
```

- Dense arrays for plants and nodes; free lists for reuse.
- Spatial hash for root/canopy occupancy, rebuilt incrementally.
- Event queues for growth, damage, death, terrain edits, fauna interactions.
- A map from public string id to dense index at the boundary; the hot loop never does string work.
- Node graphs remain compact binary on the wire and in Postgres; the SoA store is the live simulation view.

### Tick distribution (design target)

| Tier | Population | Update | Work |
|---|---|---|---|
| Active | 50–200 online or interacting | 20 Hz | Full growth, resources, damage, physics queries |
| Near | ~500–2,000 around active players | 5 Hz | Reduced growth/damage, no full collision |
| Dormant | remainder of 10k | 30 s step | Closed-form catch-up; wake on events |

- Tick buckets by `lastTick`; never scan all 10k every tick.
- Active work is never delayed by near/dormant work.
- Dormant catch-up is analytical, not a replay of missed ticks.
- Per-client interest selects at most `per_client_entity_cap` plants; the server does not serialize the other 9,800 to that client.

### Acceptance

- 10k dormant records step within the dormant budget.
- 2,000 bots + 10k records do not starve active plants.
- No string/Map lookups in the active growth loop after warm-up.
- Profile shows allocation-free steady state (or bounded, pooled allocation).

---

# 10. Audio (C06)

AG's procedural audio is a strong fit for PL's "no asset files" and "quiet, organic" direction.

## 10.1 Architecture

- One audio graph built on first user gesture.
- 10 Hz scheduler, not the frame loop.
- Preallocated voice pools; no per-frame allocation.
- Convolution reverb from a generated impulse; cave/underwater variants.
- Layers: wind, leaves, insects, birds, water, rain, thunder, fire, lava, fauna calls, plant growth/creak, damage/tear, UI taps.
- Spatialization: stereo pan + distance attenuation for fauna/events; no HRTF.
- Weather/biome/season drive layer gains and filters.
- Underwater: low-pass + absorption + bubble/current layers.
- Cave: longer reverb, drips, low rumble.
- Voltage/voice budget: max simultaneous voices; cull by distance/priority.

## 10.2 Events
- Server events: growth, mutation, damage, death, uproot, fauna vocalization, weather, water.
- Client-only: wind, footsteps? (no avatar), UI.
- No client-side decisions that reveal hidden state.
- No stingers for achievements; no editorializing.

## 10.3 Acceptance
- All sounds stop/pause on hidden tab.
- No audio before a gesture.
- Weather transition audible.
- Underwater/cave filters work.
- Voice budget holds at 10k world / 200 visible.
- No asset licensing needed; procedural code attributed if adapted from AG.

---

# 11. Content, config, and data model

## 11.1 Config files

Existing files to fill:
- `mutations.json` — traits, visual signatures, tolerances, metabolism, maintenance.
- `parasitism.json` — attachment, drain, shake, host interaction.
- `water.json` — sea level, water bodies, salinity, flow, waves, underwater light, buoyancy.
- `climate_memory.json` — climate fields, memory, extremes.
- `deep_time.json` — transformation operators, sea level, biome shift, fossilization.
- `persistence.json` — trace retention, organic conversion, compression, light blocking.
- `damage.json`, `uproot.json`, `tumbling.json` — complete T06.
- `audio.json` — C06 layers, voice budget, reverb, underwater/cave filters.
- `physics.json` — formalize C02c.

New v5.4 files (create only when the task starts):
- `fauna.json` (T54)
- `materials.json` (T55)
- `terrain_volume.json` (T56)
- `terrain_features.json` (T57)
- `world_objects.json` (T58)
- `succession.json` (T59)
- `orchestration.json` (O04)

**Biome fields:** no new file by default. Put continuous biome parameters in `terrain_volume.json` (`biome_field`, `biome_rules`) and stage/threshold data in `succession.json`; climate memory in `climate_memory.json`. If the team wants a dedicated `biomes.json`, add it with an ADR and update the config count and docs.

## 11.2 Schema additions

### Plant
- `traits: string[]` (IDs into mutation/trait table)
- `environmentSignature` (cached coarse sample)
- `medium` per node
- `appearance: PlantAppearance`
- `attachment?: { hostPlantId, hostNodeId, kind }`
- `buoyancy`, `drag`, `structuralStrength`

### Node
- `medium: 'air' | 'water' | 'host' | 'void'`
- `hostNodeId?: string`
- `buoyancyFactor?: number`
- `lightAtGrowth?: number`

### Terrain chunk
As in 5.3; plus `biomeId`, `waterBodyId`, `materialRevision`.

### Fauna
- `speciesId`, `needs`, `reflexState`, `homeRange`, `trapState`, `health`, `age`, `vocalizationCooldown`.

### World object
- `typeId`, `transform`, `material`, `stateMachine`, `ownerId`, `persistencePolicy`, `interestCell`, `lod`.

## 11.3 Config rules

- Every value has `_meta`, type, range/default, owner task.
- No `rarity` anywhere; validator rejects.
- IDs stable; no localized strings as IDs.
- Visual signature max 3 shader params.
- No named outcomes in config IDs; descriptive, general names only.
- Migration notes for changed values.

## 11.4 Documentation updates required with each change

Per DESIGN 7.1:
- `CONTEXT.md` tree/interfaces.
- `docs/tunables.md` values.
- `README.md` status.
- `docs/tasks/<task>.md` acceptance evidence.
- `docs/checklists/` manual tests.
- `docs/decisions.md` for any new ADR.
- `ATTRIBUTION.md` for AG-derived code.
- `docs/art-bible.md` for new visual language.
- `docs/partitioning-lod.md` for renderer changes.
- `docs/state-machines-and-invariants.md` for new machines.

**Current doc discrepancies to fix first:**
- ~~Config count is 78 files while README/CONTEXT say 77.~~ **Resolved 2026-11-14:** `docs/tunables.md` owns the count; other documents link to it (ADR-049).
- `C02c` exists in `config/physics.json` but has no task record.
- ~~`docs/v5.4-extension-plan.md` says 75 in one place.~~ **Resolved 2026-11-14:** the record said 77, was corrected to 78, and was then folded into §0.3 above with a pointer to `docs/tunables.md`.
- `what-works-now.md` and `README.md` need a refresh after the next task.

## 11.5 Non-functional requirements

### Accessibility
- Text scale, remappable keys, reduced motion, no color-only information (design 17.8).
- Photosensitivity: lightning, bloom, and bioluminescence rate/brightness limits; no strobing.
- Readable silhouettes under low light; Root Sight and cave views must not rely on color alone.
- Touch controls are C09; this plan's renderer must expose a touch-safe UI layer.

### Battery and thermal
- Pause rendering when hidden; idle drop to 30 fps; restore on input.
- Dynamic resolution before detail cuts; no always-on post on phone.
- Battery saver option; no hidden background simulation on the client.

### Privacy and telemetry
- Minimal client telemetry: performance counters only; no player content.
- Server logs redact tokens/secrets; no chat content in perf logs.
- Config/telemetry opt-in where required.

### Ops and recovery
- One process + one Postgres per World (RULE_14/RULE_31).
- Docker/compose portable; free-first hosting.
- Backup/restore drill for plants, terrain chunks, materials, fauna, world state.
- Device loss, OOM, DB down, and network loss have explicit fallbacks.

### Observability
- Tick budget, per-tier cost, queue depth, interest counts, bytes/client.
- GPU/CPU frame time, draw calls, triangles, chunk counts, cache sizes.
- Chunk load/remesh time, edit broadcast counts, physics body counts.
- No per-tick console spam; sampled metrics only.

### Compatibility
- WebGPU primary, WebGL2 fallback; Chrome/Edge desktop first, mobile browsers supported but not optimized (RULE_25).
- Desktop/mobile wrappers later; one shared client codebase.
- Save-format versioning and migration for plant/terrain/material/fauna snapshots.

---

# 12. Implementation programme

This programme does not reorder the 80-week gate plan. It defines work packages that fit existing tasks, plus the approved v5.4 extensions when their dependencies are ready. Estimates are AI-assisted focused weeks (RULE_28).

## 12.1 Work packages

| ID | Work package | DESIGN owner | Depends | Estimate | Primary output |
|---|---|---|---|---|---|
| AL-01 | Benchmark, telemetry, zero-alloc audit | C01/D01/H01 | none | 1–2 wk | Flythrough, fixed poses, GPU/frame report, allocation guard |
| AL-02 | Unified frame + fallback | C02/C03/C10 | AL-01, **gated on T56** (ADR-041) | 4–6 wk | One depth per device; plants occlude terrain; WebGL2 fallback |
| AL-03 | Quality/memory/persistence | C01/RULE_26 | AL-01 | 2 wk | GPU-band controller, device presets, cache eviction |
| AL-04 | Atmosphere, sky, post, shafts | C03 | AL-02 | 3 wk | Aerial perspective, shafts, clouds/stars, post chain |
| AL-05 | Scatter, grass, foliage LOD | C03/T59 | AL-02 | 3 wk | Cell-sorted instancing, wind, density from server |
| AL-06 | Plant GPU uniqueness, shadows, texture arrays | C02/C02b/T04/T24 | AL-02 | 4 wk | 10k headers, tier pools, impostors, mutation params, cascades |
| AL-07 | Physics/collision LOD | C02c/T25/T06 | AL-02 | 3 wk | Shared collider plans, Rapier near, SDF far, water buoyancy |
| AL-08 | Volumetric terrain + caves | T56/T57/C10 | AL-07 | 6–8 wk | Sparse chunks, surface nets, T57 primitives, streaming, persistence |
| AL-09 | Sea, water, underwater | T31/C10 | AL-08 | 4 wk | Water volume, surface, absorption, caustics, buoyancy |
| AL-10 | Materials + succession | T55/T59 | AL-08 | 6 wk | CA, reactions, succession, recovery, organic matter |
| AL-11 | Reactive fauna | T54/C11 | AL-07 only (v5.4: needs T01/T03/T06/T07, all built) | 4 wk | Needs/reflexes/influence maps, streaming, rendering, vocalizations |
| AL-12 | Procedural audio | C06 | AL-01 | 2 wk | Land/sea/cave/weather/fauna audio, voice budget |
| AL-13 | Binary protocol + 10k streaming | T03/T58 | AL-01 | 4 wk | Quantized deltas, summaries, chunk/entity interest, backpressure |
| AL-14 | Biomes, climate, deep time | T20/T39/T59 | AL-08/AL-10 | 4 wk | Continuous fields, climate memory, transformation operators |
| AL-15 | Hardening, load, restore | H01/O02 | all | 4 wk | 10k soak, 500/2k bots, restore drill, failure injection |
| AL-16 | Docs and acceptance | all | continuous | ongoing | Task records, tunables, art bible, checklists |
| AL-17 | Trait and mutation rules | T04/T24 | T09/T10 for attachment, AL-06 for visuals | 4 wk | `PlantTrait` schema, tolerance/metabolism/attachment evaluation in the growth loop, `chemosynthesis_ratio` tunable |

## 12.2 Waves

### Wave 0 — See and measure (now; fits Gate 1–2 polish)
AL-01, AL-03, AL-04a (atmosphere without shafts), AL-12. **AL-02a is not in Wave 0** (ADR-041): unification is gated on T56.
**Exit:** a repeatable 60 s benchmark and six fixed poses; GPU-band quality; procedural ambience; one-API frame proof.

### Wave 1 — Living surface (Gate 1–2)
AL-02b, AL-05, AL-06, AL-07, **AL-11**; T04/T06/T10 as scheduled. AL-11 is here because T54 needs only T01/T03/T06/T07, all built (ADR-047).
**Exit:** a plant grows, mutates, is damaged, uproots, tumbles, re-roots, and can parasitize; herbivores graze it, flee, and can be trapped and fought; foliage and scatter read densely; physics doesn't explode; frame stays in budget.

### Wave 2 — Editable planet (post-Gate 2 / post-alpha v5.4 start)
AL-08, AL-09, AL-10.
**Exit:** arches, overhangs, caves, water bodies, editable terrain; Root Sight works in volume; water plants and cave plants possible through traits; material reactions.

### Wave 3 — Living ecology
AL-14, AL-03b. **AL-11 (fauna) has moved to Wave 1** (ADR-047).
**Exit:** fauna stream, react, vocalize, trap/escape; succession and climate fields; biome variation; seasonal transformation.

### Wave 4 — 10k hardening
AL-13, AL-15.
**Exit:** 10k records in one World; 200 per client; 100 L0 desktop; 10k impostor-capable; 500–2,000 bot soak; restore drill; no tick spike.

## 12.3 Gate mapping

| Gate | Additions that fit | Do not start yet |
|---|---|---|
| Gate 1 (W24) | AL-01, AL-03, AL-12, atmosphere, scatter, plant LOD polish, physics C02c | Volumetric terrain, fauna, materials, deep time |
| Gate 2 (W52) | AL-06, AL-07, **AL-11 (T54 fauna)**, T04/T06/T10 integration, water slice if T31 approved | T56/T57/T55/T59 unless dependencies met |
| Gate 3 (W80) | Unified frame, 10k streaming, sea/cave slice, audio/visual polish | Full v5.4 ecology unless the gate has slack |
| Post-alpha | T55/T56/T57/T58/T59/C10/O04 — T54 and C11 have moved to Gate 2 (Wave 1, ADR-047) | Nothing in this list is a launch blocker |

**Cut rule:** if a gate slips, cut optional visual tiers, not the core loop or server truth. Volumetric terrain is the first feature to defer; the height field still works.

---

# 13. Detailed work packages

## AL-01 — Benchmark, telemetry, zero-allocation

**Objective:** make performance and visual quality measurable before changing the renderer.

**Steps:**
1. Add a dev-only Catmull-Rom camera path around a mature plant, a clearing, and a planned cave/water location. Arc-length LUT as AG.
2. Record frame time, GPU time, CPU time, triangles, draw calls, visible plants, chunks, bytes, JS heap.
3. Report avg/p95/p99/max over 60 s; include first-load and steady-state.
4. Add six fixed poses at 2560×1440 and phone resolution; save PNGs for visual review.
5. Add a render-path allocation guard: wrap `renderFrame` with a dev check that samples heap/gc; manually audit spreads/new arrays.
6. Add a server tick report: active/near/dormant ms, queue depth, interest counts.
7. Document in `docs/checklists/`.

**Files:** `apps/client/src/dev/benchmark.ts`, `apps/client/src/ui/DevPanel.ts`, `apps/client/src/main.ts`, `docs/tasks/C01.md`, `docs/checklists/`.

**Acceptance:** one command produces a report; six poses reproducible; no per-frame allocations in the render path; baseline stored.

**AG reference:** `main.js` `FLY`, `flyLUT`, `flyAt`; `dev.js` benchmark; `F` preallocated state.

## AL-02 — Unified frame and fallback

**Not in Wave 0 (ADR-041).** Start this only when T56 volumetric terrain exists, because nothing currently in the world is tall enough to occlude a plant. Until then the split canvas stays and C02's locked architecture is unchanged.

**Objective:** one depth buffer per device; remove the split-canvas compromise.

**Steps:**
1. Define a `FrameGraph` with pass/resource lifetimes and a single command encoder (WebGPU) or renderer (WebGL2).
2. U0: render environment and plants in the same API on a branch. Start with WebGL2 + WebGL plant SDF to prove shared depth; then WebGPU.
3. U1: port sky, ground, rain, and plant passes.
4. U2: add terrain chunks, water, post.
5. U3: retire the split path; keep a dev flag only for comparison.
6. Add a "frame path" field to debug overlay: `webgpu-unified`, `webgl2-fallback`.
7. Add device-loss recovery: rebuild pipelines, caches, buffers from server state.

**Files:** `apps/client/src/renderers/WebGPURenderer.ts` (new full-frame), `WebGPUDevice.ts`, `apps/client/src/main.ts`, `EnvironmentRenderer.ts`, `PlantRenderer.ts`, `docs/partitioning-lod.md`.

**Acceptance:** plants are occluded by terrain; water/shafts see correct depth; fallback plays; no second canvas; debug overlay reports path.

**Risk:** large; do not ship intermediate state. Keep the current path as fallback until U2.

## AL-03 — GPU-band quality controller

**Steps:**
1. Add GPU timing abstraction: WebGPU timestamp-query; WebGL `EXT_disjoint_timer_query_webgl2`; fallback to frame time with a clear "estimated" flag.
2. Implement AG's band control: target min/max ms, scale pixels, then draw distance, then post/shadow/scatter.
3. Add hysteresis and a cooldown; avoid oscillation.
4. Persist per-device settings; load lower after a crash; reset on device change.
5. Add `drawDistanceScale` to LOD thresholds and scatter.
6. Add a dev overlay with the control state.
7. Add tests for the controller as a pure function.

**Files:** `QualityController.ts`, `render.json`, `main.ts`, `WebGPURenderer.ts`, `docs/tunables.md`.

**Acceptance:** a 30% GPU load increase triggers a controlled downgrade within 2 s; no visible oscillation; settings persist; phone stays playable.

## AL-04 — Atmosphere, sky, post, shafts

**Steps:**
1. Add shared `atmosphere()` WGSL/GLSL with extinction, height fog, sun phase, ambient.
2. Replace linear fog in ground/sky/plant/water shaders; keep a low-tier approximation.
3. Add sky: scattering, sun/moon/stars, procedural clouds, weather coverage.
4. Add a half-res light-shaft pass with shadow compare and depth-aware blur/upsample (WebGL post first).
5. Add a one-time procedural detail texture for rock/soil; triplanar sample.
6. Add bloom/tonemap/grade/vignette/grain/dither; desktop only by default.
7. Add weather/time-of-day/biome params.
8. Add photosensitivity limits.

**Files:** `environment/atmosphere.ts`, `skyDome.ts`, `ground.ts`, `rainSystem.ts`, `renderers/post/`, `render.json`, `docs/art-bible.md`.

**Acceptance:** fog reads as atmosphere, not grey; shafts through canopy; cave darkness; no banding; phone fallback; visual poses pass.

## AL-05 — Scatter, grass, foliage LOD

**Steps:**
1. Define `ScatterField` from server environment/succession: density, type, height, color, seed.
2. Bucket by cell/chunk; store min/max bounds.
3. Build three blade pipelines (3/5/9 rows), one material, per-instance variation.
4. Implement cell/run culling; GPU indirect for WebGPU; multi-draw or runs for WebGL.
5. Add wind field (global coherent), stiffness, interaction masks (trampled/harvested).
6. Add revision invalidation on terrain/succession/weather changes.
7. Budget by tier; no 2M on phone.

**Files:** `environment/scatterField.ts`, `renderers/webgpu/ScatterRenderer.ts`, `shaders/scatter.wgsl`, `render.json`, `docs/tunables.md`.

**Acceptance:** 100k–1M instances at target frame; no per-instance CPU; edits update density; phone budget holds.

## AL-06 — Plant uniqueness, shadows, textures

**Steps:**
1. Add `PlantAppearance` to server summary and binary snapshot.
2. Add texture arrays + procedural fallback; KTX2 loading; no per-player assets.
3. Extend WebGPU plant data with appearance seed/params/mutation mask.
4. Implement per-instance hue/vein/gradient/leaf-shape variation.
5. Implement mutation signatures (max 3 params) per art bible.
6. Add cascaded shadows + caster budget + contact/blob for L1.
7. Add revisioned shadow cache invalidation on growth/terrain change.
8. Add the L2 ellipsoid impostor shader and the L3 colour-only atlas (single view, no multi-view bake, no relight) — ADR-042.
9. Add L0/L1/L2 cross-fade and prefetch.
10. Add 10k header buffer and per-client 200 entity test.

**Files:** `PlantMeshBuilder.ts`, `WebGPURenderer.ts`, `shaders/mesh.wgsl`, `billboard.wgsl`, `render.json`, `plant_renderer.json`, `docs/partitioning-lod.md`.

**Acceptance:** 10k records in buffer; 200 visible; 100 L0; unique appearance for 10k seeds; shadows budgeted; no per-plant materials.

## AL-07 — Physics and collision LOD

**Steps:**
1. Formalize C02c task record; align `physics.json`.
2. Extend `plantColliderPlan` for host attachment, water, fragments.
3. Add Rapier layers/masks; near-only bodies; sleep; fixed step.
4. Add terrain chunk trimesh and SDF query; camera sphere cast and SDF push-out.
5. Add water buoyancy/drag/current for plants, fauna, debris.
6. Add tumbling/re-root cosmetic bodies.
7. Add server analytic equivalents and tests.
8. Add debug overlay.
9. Add 24/64 plant collider budget test.

**Files:** `physics/RapierPhysicsManager.ts`, `physics/playerPhysics.ts`, `packages/shared/src/physics/*`, `packages/shared/src/world/terrainField.ts`, `config/physics.json`, `docs/tasks/C02c.md`.

**Acceptance:** camera cannot enter caves through walls; roots collide with terrain; tumbling looks physical; server and client agree near plants; 10k safe.

## AL-08 — Volumetric terrain and caves

**Steps:**
1. Add `terrainVolume.ts` with chunk storage, SDF sampling, edit brushes.
2. Add `surfaceNets.ts` (port AG's implementation; deterministic CPU).
3. Add `terrainFeatures.ts` for T57 primitives; config schema/validator.
4. Add server chunk generation, revision, persistence, interest.
5. Add client chunk meshing, LOD, seams/skirts, material blending.
6. Add trimesh colliders and SDF queries.
7. Add `surfacesAt` for scatter/spawn.
8. Add Root Sight volumetric cutaway.
9. Add cave water/air flags.
10. Add migration from T25 height deltas.
11. Add debug views.

**Files:** `packages/shared/src/world/terrainVolume.ts`, `surfaceNets.ts`, `terrainFeatures.ts`, `apps/server/src/ops/terrainVolume.ts`, `apps/server/src/ops/persistence/terrainVolumePersistence.ts`, `apps/client/src/renderers/terrain/*`, `config/terrain_volume.json`, `terrain_features.json`, `docs/tasks/T56.md`, `T57.md`, `C10.md`.

**Acceptance:** arches/overhangs/caves **inside one authored region around spawn** (ADR-043); editable; Root Sight works in volume; chunks mesh with welded seams and skirts; edits persist across restart; tick budget holds; 60 fps. Planet-wide generation and streaming are explicitly **out of scope for the first slice**.

## AL-09 — Sea and underwater

**Steps:**
1. Add water volume and water body model.
2. Add sea level, salinity, temperature, flow, waves.
3. Add water surface rendering above/below; refraction; foam; shoreline.
4. Add underwater absorption, caustics, shafts, particles.
5. Add buoyancy/drag/current to physics.
6. Add water plant traits/tolerances; underwater growth checks.
7. Add cave pools/aquifers.
8. Add weather coupling (rain, storm, freeze).
9. Add low-tier fallback.

**Files:** `packages/shared/src/world/water.ts`, `apps/server/src/ops/water.ts`, `apps/client/src/renderers/water/*`, `config/water.json`, `docs/tasks/T31.md`.

**Acceptance:** plants can live at depth with traits; camera underwater looks right; buoyancy stable; shoreline no seam; phone fallback.

## AL-10 — Materials and succession

**Steps:**
1. Add material cell model, reaction matrix, flow/settle/fire/lava/weathering.
2. Run at 2 Hz on active chunks; cap 64; tick budget.
3. Persist deltas, snapshot.
4. Emit damage through RULE_22 pipeline.
5. Add client material blending and dynamic effects.
6. Add succession stages, seed bank, organic matter, recovery, disturbance.
7. Add failsafes/max recovery.
8. Add T20 hooks.

**Files:** `packages/shared/src/world/materials.ts`, `apps/server/src/ops/materials.ts`, `succession.ts`, `config/materials.json`, `succession.json`, `docs/tasks/T55.md`, `T59.md`.

**Acceptance:** water flows/settles; sand collapses; fire spreads; rain extinguishes; lava cools; succession regrows; no irreversible collapse; tick budget.

## AL-11 — Reactive fauna

**Steps:**
1. Implement T54 server species, needs, senses, reflexes, influence maps.
2. Add streaming/interest/tiers/population caps.
3. Add plant trap/struggle and damage pipeline.
4. Add C11 procedural bodies, instancing, LOD, animation.
5. Add vocalizations through C06.
6. Add taming hook.
7. Add tests for no speech/planning; determinism.

**Files:** `packages/shared/src/fauna/*`, `apps/server/src/ops/fauna.ts`, `apps/client/src/renderers/fauna/*`, `config/fauna.json`, `docs/tasks/T54.md`, `C11.md`.

**Acceptance:** herds graze/drink/flee; herbivores damage plants; plants trap fauna; fauna escape/die; vocalizations; caps; no intelligent behavior.

## AL-12 — Procedural audio

Covered in section 10. Files: `apps/client/src/audio/ProceduralAudio.ts`, `config/audio.json`, `docs/tasks/C06.md`.

## AL-13 — Binary protocol and 10k streaming

**Steps:**
1. Define binary codec, quantization, message types, version.
2. Add plant summaries, deltas, keyframes.
3. Add terrain/material/fauna/object messages.
4. Add priority/interest/caps/backpressure.
5. Add client interpolator/decoder.
6. Add compatibility tests and fuzz.
7. Add metrics.

**Files:** `packages/shared/src/protocol/*`, `apps/server/src/ops/net.ts`, `apps/client/src/net/*`, `docs/protocol.md`.

**Acceptance:** 10k records; 200 per client; bandwidth budget; no queue growth; keyframe heals loss; old clients get update screen.

## AL-14 — Biomes, climate, deep time

**Steps:**
1. Add continuous environment/climate fields; server computation at coarse cadence.
2. Add biome parameter table/thresholds; client palette/vegetation/audio.
3. Add climate memory and extremes.
4. Add T20 transformation operators; sea level/biome shift/fossilization.
5. Add time-lapse replay from event stream.
6. Add tests for no reset/no named outcomes.

**Files:** `packages/shared/src/world/climate.ts`, `biomes.ts`, `apps/server/src/ops/climate.ts`, `deepTime.ts`, `config/climate_memory.json`, `deep_time.json`, `terrain_volume.json`, `docs/tasks/T20.md`, `T39.md`.

**Acceptance:** biome variation from fields; climate memory; deep time changes the same planet; no blank reset; performance.

## AL-15 — Hardening and load

**Steps:**
1. 10k records, 50/500/2,000 bots.
2. 60 s GPU benchmark on desktop/phone; frame budget.
3. 24 h soak; memory/leaks; chunk churn.
4. Restore drill; corruption/partial save.
5. Device loss/OOM/network loss.
6. Security/rate-limit tests.
7. Final report and cut list.

**Acceptance:** DESIGN 13.4 budgets; no tick spike; restore works; no duplication/loss; failures handled.

---

# 14. Acceptance and verification

## 14.1 Test pyramid

| Level | What |
|---|---|
| Unit | Pure rules: growth, traits, environment, materials, collider plan, quality controller, protocol codec, biome thresholds |
| Determinism | Fixed seed + intents → hash state; replay |
| Integration | Server + Postgres + client; two tabs; reconnect; persistence |
| Physics | Capsule/SDF, buoyancy, tumbling, cave roof, host attachment |
| Network | Loss/latency/duplicate/out-of-order; keyframe; caps |
| Visual | Six fixed poses; flythrough; day/night/weather/biome variants |
| Performance | GPU/CPU/frame/tick/bandwidth/memory; desktop/phone/low |
| Soak | 10k records; 24 h; chunk churn; edit storm |
| Failure | Device loss, OOM, corrupt chunk, DB down, auth expiry |
| Compliance | No rarity, item flags, report/block, no intelligent NPC |

## 14.2 Metrics and thresholds

- Server tick: active ≤70%, warn 40 ms; no active starvation.
- Client frame: 60 fps target; p99 ≤16.7 ms desktop; phone adaptive.
- GPU: band 9.8–13.6 ms at 60 Hz; no >16.7 ms spikes during benchmark.
- Draw calls/tris: DESIGN 13.4.
- Network: ≤60 KB/s desktop, ≤30 KB/s phone.
- Memory: ≤512 MB desktop, ≤192 MB phone, ≤96 MB low.
- Chunk load: ≤N ms/frame; no visible hitch.
- Edit broadcast: interested clients only; revision monotonic.
- Persistence: restore exact chunk/plant/fauna state.

## 14.3 Visual acceptance

- Six fixed poses at 2560×1440 and 1280×720:
  1. spawn/seedling,
  2. mature plant at golden hour,
  3. canopy from below,
  4. cave/overhang,
  5. water surface from above/below,
  6. storm/biome extreme.
- A 60 s flythrough with no popping, shimmer, banding, or holes.
- A separate reviewer sees only renders, not code/reasoning (AG's visual critic pattern).
- Acceptance: no defect above "minor" before a gate.

## 14.4 "Living world" acceptance

A reviewer must be able to observe:
- a root tunnel persists and changes water/soil,
- a plant's canopy changes ground light,
- fauna grazes and damages a plant,
- a plant traps fauna; either can die,
- water flows into a dug channel,
- fire/lava changes material and damages plants,
- a season transforms the same terrain without resetting it,
- a dead plant leaves organic matter that later feeds another plant.

If any of these is only a visual effect, it fails.

---

# 15. Risks, open decisions, assumptions

## 15.1 Risk register

| Risk | Prob. | Impact | Mitigation |
|---|---|---|---|
| Renderer unification takes longer than planned | High | High | Slice U0–U3; keep WebGL fallback; don't ship intermediate |
| 10k target mistaken for 10k full meshes | Medium | High | Contract in 4.5; budget gates; interest tests |
| Volumetric terrain tick/memory blow-up | High | High | Sparse chunks, active caps, time-slicing, LOD, profiling |
| Chunk seams/cracks | Medium | Medium | Border sampling, welding, skirts, visual tests |
| Terrain edits break collision/persistence | Medium | High | Revisioned chunks, exact trimesh, restore drill |
| Shadow cache invalidation is too expensive | High | Medium | Dirty cascade pages, caster budget, update at 8/4 Hz |
| Plants everywhere causes simulation edge cases | High | Medium | Trait model, medium checks, tests per habitat |
| Physics divergence client/server | Medium | Medium | Server analytic truth; near-only Rapier; correction events |
| Water/material CA destabilizes tick | Medium | High | 2 Hz, active chunk cap, deterministic order, budget |
| Fauna AI creeps into intelligence | Low | High | Rule tests: no speech/goals/judgment; config-only reflexes |
| Biomes become named outcomes | Medium | High | Continuous fields; general thresholds; review rule |
| AG code license/attribution missed | Low | Medium | `ATTRIBUTION.md` entry; keep MIT notice |
| Docs drift again | High | Medium | Same-change doc rule; count/owner checks in CI |
| Mobile memory/thermal | High | Medium | Low tier, caps, battery saver, no full post |
| Visual quality regresses for performance | Medium | Medium | Fixed poses; visual critic; tier-specific acceptance |

## 15.2 Open decisions requiring approval

1. **Unified renderer timing:** start AL-02 now or after Gate 1? Recommended now as a branch, not a release.
2. **WebGPU/Three integration:** raw WebGPU frame vs Three WebGPURenderer. Recommended raw WebGPU for the frame graph, Three for fallback/UI, unless the team prefers one API.
3. **Terrain chunk size/voxel size:** 32³ at 0.5 m near vs 1 m. Needs a memory/perf spike.
4. **Water simulation cadence:** T55 2 Hz and 64 active chunks; confirm with sea scope.
5. **Biome config location:** `terrain_volume.json` vs a new `biomes.json`. Recommended no new file until T59.
6. **Metabolism traits:** approve chemosynthesis/saprotrophy as general mutation traits (not aquatic categories). Required for deep caves/deep sea plants.
7. **Host-interior growth:** approve attachment constraints and occlusion rules for parasites/endophytes.
8. **Shadow strategy:** cascades + caster budget vs a virtual shadow atlas. Recommended cascades first.
9. **Protocol binary migration:** confirm timing; JSON remains for cold paths.
10. **10k acceptance:** define whether "10k" means records in one World or concurrent visible; recommended the former, per DESIGN 13.5.

## 15.3 Assumptions

- The team accepts that "10k players" means one World with interest-managed clients, not 10k full-detail organisms on one screen.
- WebGPU is available on the primary desktop target; WebGL2 fallback is required for the rest.
- The server remains Node/TypeScript/Postgres, single process per World.
- The existing plant node model can be extended without a rewrite; hot paths may be SoA-refactored.
- AG's MIT license permits adaptation with attribution.
- The design's no-rarity/no-named-outcomes rules remain non-negotiable.

---

# 16. Traceability matrix

| Requirement | DESIGN aspect | Work package | Acceptance |
|---|---|---|---|
| Editable planet | T25/T26/T56/T57/T20 | AL-07/08/14 | Persist edits; same planet across seasons; no reset |
| Terrain and caves | T56/T57/C10 | AL-08 | Arches/overhangs/caves; collision; Root Sight |
| Sea and sky | T31/C03/C10 | AL-04/09 | Water volume/surface/underwater; sky/weather |
| Weather and biomes | T07/T39/T59 | AL-04/10/14 | Continuous fields; climate memory; biome variation |
| Fauna | T54/C11 | AL-11 | Needs/reflexes; traps; vocalizations; no intelligence |
| Plants and vegetation | T01/T04/T24/T59 | AL-05/06/10 | Growth, mutation, succession, scatter |
| Plants in sea/deep/caves/hosts | T31/T10/T56 | AL-07/08/09/10 | Trait-based habitats; parasitism; host interaction |
| 10k unique animated plants | C02/C02b/T03/H01 | AL-06/13/15 | 10k records; 200/client; unique appearance; budget |
| Lighting | C03/C10 | AL-04/06 | Sun/hemi/emissive/local light grid; no 10k lights |
| Shadows | C03 | AL-04/06 | Cascades; caster budget; revisioned cache |
| Textures | C02b/C10 | AL-06 | Texture arrays; procedural fallback; no per-player assets |
| Mutations | T04/T24 | AL-06 | Max 3 params; no rarity; visual signatures |
| 3D colliders | C02c/T25 | AL-07 | Collider plan; near-only; terrain/SDF; tests |
| Physics | C02c/T06/T54/T55 | AL-07/09/10/11 | Server truth; buoyancy; tumbling; determinism |
| Everything alters everything | T55/T56/T59/T26 | AL-08/10/14 | Interaction matrix observable; traces persist |
| Preserve spirit | Part 2/Part 10 | all | Rule review per PR; no named outcomes/rarity/NPC authority |

---

# 17. What we deliberately will not do

1. **No static diorama.** No world that is generated once and never changes.
2. **No AG underwater content transplant.** No kelp/whale/ship/grotto; only mechanisms.
3. **No 10k full meshes.** No promise that every plant is fully detailed on every client.
4. **No per-plant lights/textures/shaders.** Shared material, per-instance data.
5. **No client-authoritative terrain/physics/fauna.** No exceptions.
6. **No 20 Hz global fluid/lava simulation.** T55 cadence and caps.
7. **No named biomes/cultures/creatures as outcomes.** Continuous fields and general capabilities.
8. **No rarity/tiers as power.** Potency grades are not rarity; visual signatures do not imply power.
9. **No intelligent NPCs, dialogue, quests, or planning in multiplayer.**
10. **No tutorialized depth or editorializing UI.** The world shows; it does not explain.
11. **No permanent baked shadows/skylight.** Caches are revisioned.
12. **No "big bang" renderer rewrite shipped half-done.** Keep a fallback until the unified path is complete.

---

# 18. First 30 days

A concrete starting sequence that does not break the current gate plan:

**Week 1**
- Add the benchmark/flythrough and six fixed poses (AL-01).
- Audit and remove per-frame allocations in `renderFrame`; add a dev guard.
- Add GPU timing abstraction and a first GPU-band controller (AL-03).
- Add `ATTRIBUTION.md` entry for AG if any code/technique is adapted.

**Week 2**
- Build the shared atmosphere function and replace linear fog in ground/sky (AL-04).
- Add the procedural detail texture and triplanar sample.
- Add the procedural audio graph shell (AL-12) with wind/insects/rain.

**Week 3**
- Add cell-sorted scatter for grass/pebbles around spawn (AL-05).
- Add a 60 s visual flythrough and compare before/after.
- Write the U0 unified-frame proof branch (AL-02); do not merge to release.

**Week 4**
- Add plant appearance record and per-instance variation to the WebGPU path (AL-06).
- Add cascaded shadow caster budget and contact shadows.
- Review all new values in `config/*.json`; update `docs/tunables.md`.
- Run the acceptance tests in section 14; record results.

---

# Appendix A — Config key catalogue (initial values)

**Key names only (ADR-049).** Config values are owned by `config/*.json` and indexed by `docs/tunables.md`; this appendix names the keys a work package will add and deliberately does not carry defaults that would drift. Any `value` you see below is a pre-review starting point, not an owner.

All keys require `_meta`, type, range/default, owner task, and notes.

## `render.json`
- `renderer_primary`: `webgpu`
- `renderer_fallback`: `webgl2`
- `gpu_target_min_ms`: 9.8
- `gpu_target_max_ms`: 13.6
- `draw_distance_floor`: 0.4
- `quality_persistence_key`: `plantlegacy.quality`
- `atmosphere_extinction`: [0.018, 0.012, 0.009]
- `atmosphere_height_falloff`: 0.012
- `atmosphere_sun_phase`: 0.6
- `light_shaft_samples`: 24
- `light_shaft_strength`: 0.5
- `detail_texture_scale`: 0.5
- `scatter_budget_desktop`: 500000
- `scatter_budget_phone`: 80000
- `post_bloom`: true
- `post_grain`: 0.02
- `shadow_cascades_desktop`: 2
- `shadow_caster_budget`: 128
- `plant_tier0_budget`: 100
- `plant_tier1_budget`: 1280
- `l3_atlas_size`: 1024 (L3 colour-only billboard only; L2 is an ellipsoid and has no atlas — ADR-042)
- `water_quality`: `medium`

## `terrain_volume.json`
- `chunk_size_m`: 32
- `chunk_resolution`: 32
- `voxel_size_m`: 0.5
- `world_height_m`: 512
- `sea_level_m`: 0
- `sdf_range_m`: 8
- `sdf_quantization`: 1/256
- `lod_distances_m`: [32, 96, 256, 768]
- `max_chunks_per_client`: 256
- `max_active_chunks`: 64
- `collision_lod`: 1
- `snapshot_interval_s`: 300
- `interest_radius_chunks`: 4
- `biome_field_resolution_m`: 32
- `biome_rules`: [] (schema array)

## `terrain_features.json`
- `max_features_per_chunk`: 8
- `max_control_points`: 16
- `max_blend_radius_m`: 8
- `types`: `spline_sweep`, `bezier_patch`, `extrusion`, `volume_carve`, `noise_blend`, `torus_arch`, `clear_zone`
- `clear_zones`: [] (spawn, Root Sight, hubs; no named outcomes)

## `materials.json`
- `ca_hz`: 2
- `max_active_chunks`: 64
- `tick_budget_share`: 0.10
- `flow_rate`: 0.5
- `settle_threshold`: 0.2
- `temperature_range`: [-50, 1200]
- `moisture_range`: [0, 1]
- `material_definitions`: []
- `element_definitions`: []
- `reaction_matrix`: []
- `snapshot_interval_s`: 300
- `interest_radius_chunks`: 3

## `fauna.json`
- `max_fauna_per_world`: 2000
- `species`: []
- `vocalizations`: []
- `influence_map`: { `cell_size_m`: 8, `update_hz`: 2, `decay`: 0.1 }
- `spawn_sources`: []
- `population_caps`: {}
- `offline_tick_hz`: 1
- `trap_strength`: 1
- `struggle_damage`: 1
- `escape_threshold`: 1
- `kill_credit_window_s`: 60

## `water.json`
- `sea_level_m`: 0
- `max_depth_m`: 400
- `water_density_kg_m3`: 1000
- `salinity_default`: 35
- `temperature_default_c`: 12
- `flow_update_hz`: 1
- `wave_amplitude_m`: 0.4
- `wave_speed`: 1
- `underwater_extinction`: [0.20, 0.08, 0.05]
- `caustics_strength`: 1
- `foam_strength`: 1
- `ice_temperature_c`: -2
- `max_water_bodies_per_chunk`: 4

## `physics.json`
- Existing values plus:
- `max_collider_plants`: 64 desktop / 16 phone (tier override)
- `max_colliders_per_plant`: 384 high / 192 default
- `water_buoyancy_enabled`: true
- `server_analytic_collision`: true
- `client_physics_layers`: [terrain, plant, fauna, debris, water, sensor]
- `rebase_distance_m`: 1000
- `interpolation_ms`: 100

## `mutations.json`
- `traits`: []
- `tolerance_weights`: {}
- `adaptive_pressure_enabled`: true
- `decay_half_life_ticks`: 6000
- `max_pressure_multiplier`: 4
- `category_to_tag_map`: {}
- `visual_signature_max_params`: 3
- `maintenance_curve`: []

## `deep_time.json`
- *(removed)* `season_length_days` — owned by `world.json` and persisted in `world_state`. A second owner here would have made two sources for one clock (ADR-044).
- `transformation_ops`: [`uplift`, `subsidence`, `erosion`, `deposition`, `volcanism`, `sea_level`, `climate_shift`]
- `fossilization_chance`: 0.05
- `time_lapse_years_per_second`: 1000
- `calamity_grant_seed`: false

## `succession.json`
- `stages`: [`bare`, `pioneer`, `grass`, `shrub`, `woodland`, `forest`]
- `thresholds`: {}
- `seed_bank`: {}
- `recovery_pulses`: {}
- `recovery_real_time_days`: 3
- `weather_dependency`: 1
- `max_recovery_time_days`: 14
- `disturbance_resets`: {}

## `audio.json`
- `scheduler_hz`: 10
- `master_gain`: 0.8
- `max_voices`: 64
- `reverb_decay_s`: 3.5
- `underwater_lowpass_hz`: 900
- `cave_reverb_scale`: 1.8
- `layer_gains`: { wind: 0.3, leaves: 0.2, insects: 0.2, water: 0.4, rain: 0.5, thunder: 0.7 }
- `fauna_voice_budget`: 16

---

# Appendix B — File map (new/modified)

This is a planning map, not a patch list.

## Shared
- `packages/shared/src/world/environment.ts` — EnvironmentSample, fields, sampling.
- `packages/shared/src/world/biomes.ts` — thresholds, biome params.
- `packages/shared/src/world/terrainVolume.ts` — chunks, SDF, edits.
- `packages/shared/src/world/surfaceNets.ts` — meshing.
- `packages/shared/src/world/terrainFeatures.ts` — T57 primitives.
- `packages/shared/src/world/materials.ts` — T55 state/reactions.
- `packages/shared/src/world/water.ts` — water bodies/flow/buoyancy.
- `packages/shared/src/world/climate.ts` — climate fields/memory.
- `packages/shared/src/fauna/*` — species, needs, reflexes, influence maps.
- `packages/shared/src/physics/*` — collider plan extensions, SDF queries, layers.
- `packages/shared/src/protocol/*` — binary codec/messages.
- `packages/shared/src/growth/traits.ts` — trait schema/evaluation.

## Server
- `apps/server/src/ops/environment.ts` — field sampling.
- `apps/server/src/ops/terrainVolume.ts` — generation, edits, revisions.
- `apps/server/src/ops/terrainFeatures.ts` — feature rasterization.
- `apps/server/src/ops/materials.ts` — CA, reactions, damage.
- `apps/server/src/ops/water.ts` — water bodies, flow.
- `apps/server/src/ops/fauna.ts` — T54.
- `apps/server/src/ops/climate.ts` — T39.
- `apps/server/src/ops/deepTime.ts` — T20.
- `apps/server/src/ops/succession.ts` — T59.
- `apps/server/src/ops/worldObjects.ts` — T58.
- `apps/server/src/ops/persistence/terrainVolumePersistence.ts`
- `apps/server/src/ops/persistence/materialPersistence.ts`
- `apps/server/src/ops/persistence/faunaPersistence.ts`
- `apps/server/src/main.ts` — tick integration, interest, messages.

## Client
- `apps/client/src/renderers/FrameGraph.ts` — unified frame.
- `apps/client/src/renderers/webgpu/*` — full-frame pipelines, pools, compute.
- `apps/client/src/renderers/terrain/*` — chunk meshing/render.
- `apps/client/src/renderers/water/*` — surface/underwater.
- `apps/client/src/renderers/fauna/*` — bodies/LOD.
- `apps/client/src/renderers/vegetation/ScatterField.ts` — foliage/grass.
- `apps/client/src/renderers/post/*` — atmosphere/shafts/bloom/tonemap.
- `apps/client/src/physics/*` — Rapier LOD, buoyancy, tumbling.
- `apps/client/src/audio/ProceduralAudio.ts` — C06.
- `apps/client/src/dev/benchmark.ts` — flythrough/poses.
- `apps/client/src/net/*` — binary decoder/interpolation.

## Config
As Appendix A and section 11.1.

## Docs
- `docs/tasks/C02c.md` — physics/collision task record.
- `docs/tasks/T56.md`, `T57.md`, `C10.md`, `T31.md`, `T54.md`, `C11.md`, `T55.md`, `T59.md`, `T20.md`, `T39.md`.
- `docs/art-bible.md` — atmosphere/palette/water/cave/biome.
- `docs/partitioning-lod.md` — unified renderer, tiers, budgets.
- `docs/tunables.md` — every new value.
- `docs/decisions.md` — ADRs for renderer, biome config, traits, water.
- `ATTRIBUTION.md` — AG MIT notice.

---

# Appendix C — Abyssal Garden source map

| File | Read for |
|---|---|
| `source/src/quality.js` | Device tiers, THIN/SHADOW/AA/RAYN, persistent quality, crash downgrade |
| `source/src/math.js` | Seeded RNG, integer hash noise, quaternions, surface nets, sampler3, Mesh, icosphere |
| `source/src/shaders.js` | Density, detail texture, water, fog/atmosphere, solids, leaves, fish/manta, surface, sprites, rays, blur, post |
| `source/src/world.js` | Designed SDF masses, terrain mesh, instance stores, kelp/ground cover, coral, rocks, set pieces, volume bake, ground map, fish/mantas |
| `source/src/main.js` | Compute density, connected components, SDF bricks, camera collision, cell culling, frame graph, dynamic resolution, flythrough |
| `source/src/audio.js` | Procedural graph, noise loop, reverb, voice pools, scheduler |
| `source/src/dev.js` | Flythrough benchmark, frame/GPU logs |
| `source/src/template.html` | Loading/menu/quality UI, device-loss UX |
| `source/build.mjs` | Single-file build, WGSL minify, gzip size |

**Attribution:** add to `ATTRIBUTION.md` under "Code and techniques" if any code or close adaptation is used:

> Abyssal Garden, Maksymilian Dendura, MIT License. Source: the repository URL recorded with the distributed archive. Adapted techniques: terrain density/surface nets, SDF collision, cell-sorted instancing, ribbon foliage, atmosphere/light shafts, quality control, and procedural audio. Copyright (c) 2026 Maksymilian Dendura.

Keep the full MIT notice in the adapted source file. Do not add AG screenshots or built HTML as assets.

---

# Appendix D — Glossary additions

| Term | Meaning |
|---|---|
| **Environment field** | Continuous server-side values (light, moisture, minerals, temperature, salinity, pressure, pH, oxygen, CO2, organic matter, flow, medium) sampled for growth and rendering. |
| **Biome field** | Config thresholds over environment fields producing palette/vegetation/fauna parameters. Not a named zone. |
| **Trait** | General mutation data describing tolerance, metabolism, structure, attachment, reproduction, or defense. No rarity. |
| **Medium** | Air, water, host, or void at a node position. |
| **Terrain chunk** | Sparse 3D block of SDF/material/flags with a revision. |
| **Edit brush** | Validated server operation that changes a chunk (tunnel, excavate, deposit, compact, collapse, erode). |
| **Revision** | Monotonic version of a chunk/cache; invalidates meshes, colliders, shadows, skylight. |
| **Appearance signature** | Compact per-plant seed/params driving unique color/shape/mutation visuals without unique assets. |
| **Tier / LOD** | Representation level: T0 full, T1 simplified, T2 impostor, T3 dot. Never changes gameplay rules. |
| **Physics truth** | Server-authoritative outcome. Client Rapier is cosmetic/predictive only. |
| **Influence map** | Coarse server grid read by fauna reflexes (threat/food/water/fire/shelter). |
| **Revisioned cache** | A visual cache that is valid only for a specific world revision; never permanent. |
| **Clear zone** | Authored region kept free of generated geometry for spawn/Root Sight/hubs; not a named outcome. |

---

# Appendix E — PR review checklist

Every PR that touches this programme must answer:

- [ ] Which DESIGN rule/task does this serve?
- [ ] Is every new value in `config/*.json` with type/range/default/owner?
- [ ] Did any `rarity` field appear? (Must be no.)
- [ ] Does the client remain non-authoritative?
- [ ] Does the change preserve 10k/interest/LOD budgets?
- [ ] Is there a fallback for WebGL2/phone/low-end?
- [ ] Are caches revisioned and invalidated?
- [ ] Are per-frame allocations avoided?
- [ ] Are there tests for determinism, persistence, and failure?
- [ ] Is the visual pose/flythrough still acceptable?
- [ ] Are docs (`CONTEXT`, tunables, task record, art bible) updated?
- [ ] Is AG-derived code attributed?
- [ ] Does this create a named outcome, culture, or scripted story? (Must be no.)
- [ ] Does this make fauna intelligent? (Must be no.)
- [ ] Does this turn the player into a conventional avatar? (Must be no.)

---

# Final statement

Abyssal Garden proves that a small set of procedural mechanisms can produce a world that feels vast, alive, and beautiful. Plant Legacy needs the same *economy of means*, but pointed at a different goal: not a scene to swim through, but a planet that players inhabit, alter, and remember.

The plan therefore takes:

- AG's **terrain generation and SDF collision**,
- AG's **cell-sorted instancing and ribbon foliage**,
- AG's **atmospheric absorption, light shafts, water, and post**,
- AG's **closed-loop GPU quality control and procedural audio**,
- AG's **benchmark and visual-critic discipline**,

and refuses:

- its static, baked, client-owned world,
- its underwater content,
- its hardcoded constants,
- its "render everything" assumptions.

Everything else is Plant Legacy: the plant is the player, the server is the truth, the planet remembers, and the players build the castles.

**Recommended first action (v1.1):** run **AL-01** (benchmark, six fixed poses, GPU timing, zero-alloc audit) and then **AL-03** (GPU-band quality) as approved in ADR-048. Do **not** start AL-02: unification is gated on T56 (ADR-041). After measurement, atmosphere (AL-04) is the largest visible gain available.
