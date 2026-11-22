# Planet scale and the orbit view

**Status:** direction accepted 2026-11-21, not authorized for build. ADR-076 and
ADR-077 are accepted as direction; keep the planet at 100 km and authorize only
the P1 ring clipmap when it becomes a milestone. The P0 groundwork is built (§6);
every other section describes something that is not.

**Related:** [decisions.md](./decisions.md) accepted ADR-076 and ADR-077 as
direction,
[partitioning-lod.md](./partitioning-lod.md) (plant tiers, not restated here),
[CONTEXT.md](../CONTEXT.md) §9 (what the planet is today),
[tasks/T25.md](./tasks/T25.md) (the ground field).

## 1. Why this exists

A public Unity 6 demo renders an Earth-sized procedural planet, continuously
from a crescent at 4,600 km down to 70 m over a forest, at 9–13 ms in the editor
on an RTX 3090. It is a useful yardstick because it is one person with coding
agents and a graphics background, which is this project's shape, and because its
techniques are published rather than secret: cube-sphere quadtree terrain, a
camera held at the origin, Hillaire's atmosphere, Bruneton's sea, Palubicki's
trees.

Two questions come out of it for us:

1. Which of those ideas are worth taking, and where would they live in this
   repository?
2. The world is a 100 km sphere. Should it be bigger?

The second question is the one that gates the first, so it is answered in §4
before the plan in §6.

## 2. What the world is today

| Thing | Value / behaviour | Where |
|---|---|---|
| Planet radius | 100,000 m (`planet_radius_m`) | `config/render.json` |
| Play area | the cap at the pole; every renderer drops a position onto the sphere | `renderers/environment/planetSurface.ts` |
| Body mesh | one sphere, 256×128 segments (≈2.45 km between vertices), placed at `y = -radius` | `createPlanetBody` |
| Ground field | 4 octaves of integer-hash value noise, 26 m peak, 0.02 cycles/m, ridge 0.6; same function on server and client | `packages/shared/src/world/terrainField.ts`, `config/terrain.json` |
| Ground meshes | inner patch 180 m at 256² (0.70 m cells), outer ring 1,240 m at 154² (8.05 m cells) with the inner square removed and a 2 m overlap; relief fades out over the last 28% of `patch_radius_m` (≈446 m); vertices are patch-local metres, the mesh is placed at `+radius` | `createTerrainPatches`, `environment/ground.ts` |
| Ground thickness | soil slab under the patches, deep enough for the widest Root Sight cavity | `environment/planetSoilSlab.ts` |
| Terrain tile config | `tile_size_m`, `tile_vertices`, `lod_distances_m` were parsed into fields nothing read; **deleted 2026-11-21** (P0) | `config/terrain.json` |
| Horizon at eye height | 583 m at `h = 1.7 m` | `sqrt(2Rh)` |
| Sea | one analytic dome, 2,600 m radius, `y = level - r²/2R`; bed texture 640² over 1,800 m | `environment/ocean.ts` |
| Sky / air | analytic extinction + 700 m scale height + HG phase, mirrored as one GLSL snippet; gradient dome with 2D cloud bands on a virtual plane | `environment/atmosphere.ts`, `skyDome.ts` |
| Plants | server-authoritative nodes; WebGPU compute cull and tiers at 300/80/12/2 projected px, hysteresis 1.15/0.85, 0.5 s dwell, baked impostors re-shot every 5 s, 20,000 cap | `renderers/webgpu/WebGPURenderer.ts` |
| Orbit view | a dev action that swaps near/far (`near = R×0.01`, `far = R×12`), moves the camera to `3R` from the centre and rebuilds the controls | `main.ts` planet view |
| Camera range in play | orbit distance capped at 2,000 m | `camera_max_distance` |

The play area is therefore 620 m of authored ground on a body whose radius is
161 times that. The horizon (583 m) and the authored radius (620 m) agree, which
is why the current picture has no visible edge.

## 3. The techniques worth taking

### 3.1 One tile grid per level, chosen by the viewer

The demo's quadtree gives every tile the same 32×32 grid, so a level only
changes a tile's world size. There is one mesh shape, one crack rule and one
shader. Our two-patch pair is the degenerate case of this: two fixed levels with
a hole cut in the coarse one.

`DESIGN.md` C03b already says the pair exists "so a clipmap can replace the pair
later without changing the field, the collider plan or the camera clamp". The
tunables for that clipmap are already in `config/terrain.json` and are dead code.

**Take:** implement the ring clipmap the config describes, centred on the
camera, replacing the two patches. Same field, same colliders per tile, no
change to gameplay. **Cost:** M. **Value:** the only item in this list that is
also a documented promise.

### 3.2 Heights generated where they are drawn

The demo generates every tile on the GPU from 25 octaves of 3D gradient noise,
so the terrain has no load step and no memory. We build vertices on the CPU in a
`for` loop at startup, which is honest for 65k vertices and will not be for a
clipmap that streams.

**Take:** a WGSL compute pass that fills a tile's heights from the same integer
hash, once a tile is bigger than a few thousand vertices or the radius grows.
**Cost:** L. **Caveat:** the server validates growth against the CPU field, and
GPU fBm is not bit-identical across vendors. The CPU field stays the authority;
the GPU tile has to match it within a tolerance (millimetres) and the physics
trimesh is built from the drawn vertices, so collision follows the mesh, not the
field. Do not let the two drift silently.

### 3.3 Small numbers at the GPU

The demo holds the camera at the origin, keeps its position in doubles and feeds
the travel into TAA's previous view-projection. Their problem is float32: at
Earth radius the spacing between representable positions is 0.5 m, which is
visible on grass.

We paid a version of this until P0, and it is worth naming precisely: patch
vertices were stored in the planet's local space, so a vertex's `y` was
`sqrt(R² - r²) ≈ 100,000`, not ≈ `-1.9`. At 100 km that quantised heights to
7.8 mm — invisible, and multiplying linearly with the radius. Since 2026-11-21 a
vertex stores the curvature drop plus relief (under 30 m over the 620 m ring) and
the mesh carries `+radius`, which is the same world position with the large number
out of the attribute.

**Take, cheaply and first:** build patch geometry in patch-local metres (heights
relative to the patch's own base, a range of tens of metres) and put the radius
in the mesh's translation. The quantisation then depends on the relief, not the
planet. This is the demo's idea without the TAA machinery, and it makes a larger
radius a content decision instead of a precision one.

**Take, only if the radius passes ~8,000 km:** camera-relative rendering with a
doubles origin, which is the full technique. We have no TAA, so there is no
previous-view-projection to compensate.

### 3.4 Placing things by hash instead of by record

The demo places about 10¹² trees and rocks deterministically. The point is not
the number: nothing is stored, and a position is a function of a seed and a
coordinate. We already have the primitive (`hash01` in `packages/shared/src/math`)
and it is used for leaf angles and leaf normals.

**Take:** a scatter layer for the authored patch — stones, tussocks, dead wood —
computed from `hash01` + `terrainHeightAt`, no rows, no network, nothing to
persist. This is the cheapest "the ground is inhabited" win available and it
belongs with world objects (**T58**, `world_objects.json`, approved and not
created).

### 3.5 Climate that decides where things are

In the demo, wind carries rain inland and drops it over mountains; that decides
snow, forest and desert. Our weather is a state machine over a plant; it does not
shape the ground or place biomes.

**Take:** nothing now. This is the generator for **T59** ecological succession
and **T39** climate memory, both already approved and unbuilt. Recorded here so
that when succession is built it starts from the rain-shadow model rather than
from a noise mask.

### 3.6 Two atmospheres, one planet

The demo marches Hillaire's 2020 atmosphere per pixel with ozone at three
wavelengths. Ours is a single analytic extinction model with an art-directed
scale height, shared by every material so that hills, plants and ground fade
together.

**Take:** keep the analytic model for the surface (it is cheap, it matches, and
it is what the mesh plants and the ground both compile), and add a second,
raymarched atmosphere for the orbit camera only. The two meet at the limb, where
the orbit model takes over as the surface model's optical depth fades out. A
volumetric cloud layer, if the orbit view needs one, is the same split: half-res
march in orbit, the current bands on the dome from the ground.

## 4. How big should the world be?

### 4.1 The number players feel is the horizon

The distance to the horizon at eye height `h` on radius `R` is `sqrt(2Rh)`. It
grows with the square root of the radius, so doubling the planet moves the
horizon by 41%, not by 100%.

| Radius | Horizon at 1.7 m | Notes |
|---|---|---|
| 50 km | 412 m | inside our current authored patch |
| **100 km** | **583 m** | today; matches `terrain_radius` 620 |
| 200 km | 825 m | still inside a 1,240 m outer ring |
| 400 km | 1,166 m | needs the ring extended; inside `camera_max_distance` |
| 1,000 km | 1,844 m | past the 2 km camera limit; streaming required |
| 6,371 km | 4,654 m | Earth; the authored ground must reach nearly 5 km |

The rule that follows: **the authored ground must reach the horizon**, or the
player stands on a hill and sees the relief stop and a smooth brown sphere carry
on. Our relief already fades from 446 m, which is why the current horizon reads
as haze rather than as an edge — the fade is doing the work, not the geometry.

### 4.2 What float32 costs

Spacing between representable float32 positions near `R` is `R × 2⁻²³`:

| Radius | Quantisation | What it breaks |
|---|---|---|
| 100 km | 7.8 mm | nothing visible |
| 200 km | 15.6 mm | nothing visible on 26 m relief |
| 400 km | 31 mm | still under a leaf's thickness |
| 1,000 km | 62.5 mm | a 0.25 m leaf; marginal on thin stems |
| 6,371 km | 0.5 m | terrain facets and plant jitter at metre scale |

This is the table the demo answers with a camera at the origin. We answer it in
two stages: patch-local geometry (P0, shipped) removes the radius from the vertex
data at every size; camera-relative rendering is only needed when the *scene graph
itself* spans a planetary distance, which is the orbit view, not the ground.

### 4.3 Depth is the harder limit, not position

The orbit view already sets `near = R × 0.01` (1 km) and `far = R × 12`
(1,200 km), a ratio of 1,200 that 24-bit depth handles. A continuous descent from
orbit to standing on the grass needs a near plane at centimetres and a far plane
at a thousand kilometres in the same frame, a ratio near 10⁸. That requires
reversed-Z or a logarithmic depth buffer; Three has `logarithmicDepthBuffer`, and
it is the cheapest thing to test before promising a continuous flight.

### 4.4 Three sizes, priced

**A. Stay at 100 km.** No work. Horizon 583 m, authored 620 m, precision 7.8 mm.
The orbit view shows a small, strongly curved body — which is not a flaw, it is
the look, and it is consistent with a stylised persistent planet.

**B. 200–400 km.** Horizon 825–1,166 m. Needs the ring clipmap (§3.1) and the
outer ring extended to the horizon; precision stays under 31 mm; no change to the
server. This is the largest size that is a content change rather than a rendering
programme.

**C. Earth-size.** Horizon 4.65 km, so the authored ground must reach it: a
streaming clipmap, GPU tile generation, patch-local geometry, camera-relative
rendering for the orbit-to-ground transition, and kilometres of content per
direction. Months, and no gameplay in `DESIGN.md` asks for it.

### 4.5 Recommendation

**Keep the walkable world at 100 km now. Make the orbit view a body that can be
drawn at any radius. Do the two cheap pieces of groundwork before any radius
increase: patch-local geometry, and the ring clipmap whose config already
exists.**

If the world grows, the next size is **200–400 km** (option B), because it is the
last one that costs content instead of a rendering programme. Earth-size is a
different product: it is worth doing only if "a planet you can walk across" is
the pitch, and it should start with a measured experiment in reversed-Z depth,
not with terrain.

## 5. The orbit view as a real feature

Today it is a dev action: it saves and swaps near/far, moves the camera out to
`3R`, and rebuilds `OrbitControls` when the surface normal moves more than 1.1°.
That is enough to look at the body and not enough to be a feature.

### 5.1 What it must do

- **One camera, no mode.** Pull out from the plant, through the clouds, to the
  limb, and back, without a cut and without the surface changing LOD behind the
  camera's back.
- **A lit body.** A terminator, an atmosphere rim on the limb, sea glint, and a
  cloud layer that is between the camera and the ground when the camera is above
  it.
- **The same ground.** The patch the player lands on is generated from the same
  `terrainHeightAt` the server validates against; orbit is a camera position, not
  a second world.
- **No pop at the handover.** The LOD chain must run from orbit altitude to 0.70 m
  cells without a visible step; that is the clipmap plus tile generation, not a
  separate orbit mesh that looks different.

### 5.2 The rendering split

| Altitude | Ground | Air | Clouds |
|---|---|---|---|
| 0–2 km | clipmap tiles, 1 m at L0 | analytic atmosphere | dome bands |
| 2–50 km | tiles + shaded canopy impostors | blend to raymarched atmosphere | dome bands fade |
| 50 km–orbit | body shell + low-frequency field | raymarched single scattering with ozone | volumetric, half res |
| limb | shell silhouette + rim | raymarched, integral through the shell | accumulated layer |

Two models, one blend factor keyed on altitude, so neither has to be right
everywhere. The shell is a rendering object: it can have any radius, including
Earth's, without moving the simulation or the collider.

### 5.3 Acceptance criteria

- A continuous 0 → 300 km → 0 camera path at 60 fps on the reference machine,
  with no frame over the configured budget and no visible LOD step larger than
  one tile level at a time.
- At 300 km the body has: a lit and unlit side, a visible atmosphere rim, ocean
  with sun glint, and a cloud layer; at 2 km the analytic atmosphere matches the
  orbit model's colour within the tolerance set by eye (screenshots in
  `docs/screenshots/`).
- The reverse path lands on the same height the player left: `terrainHeightAt` at
  the landing column equals the mesh vertex under the plant's feet within 1 mm.

## 6. Staged plan

**P0 — the two cheap fixes (done 2026-11-21).**
Patch and soil-slab vertices store patch-local metres and are placed at `+radius`;
Rapier colliders take the same placement instead of having it baked into their
vertices. The three dead tile keys are deleted, so the config stops implying a
clipmap that does not exist. Acceptance, met: a test holds a 1,240 m patch at
radius 100,000 to under 30 m of stored height and checks the local height against
`planetTerrainY`; `grep` finds no key and no reader; the `planetSurface` and
`planetSoilSlab` suites are 17/17 and `pnpm verify` is green.

**P1 — ring clipmap at 100 km.** Tiles from `tile_size_m` / `tile_vertices` /
`lod_distances_m`, centred on the camera, colliders per tile, relief fade at the
rim kept. Acceptance: no seam or overlap in a 620 m walk; the outer ring's cell
size matches its configured level; a tile at the horizon is at most 8 m per cell;
the two-patch pair is deleted, not kept as a fallback.

**P2 — the orbit view.** Body shell at a configurable radius (default equal to
`planet_radius_m`), raymarched atmosphere and sea for the orbit camera only,
cloud layer, reversed-Z/log depth experiment, one camera path. Acceptance as
§5.3.

**P3 — a larger world (option B).** Raise `planet_radius_m` to 200–400 km,
extend the clipmap to the new horizon, keep the server's planar frame (the play
area is a rounding error of flat for gameplay distances at any of these radii).
Acceptance: horizon and authored ground agree within 10%; a plant at the old
620 m rim stands on drawn ground; frame cost unchanged within 10% at the play
area.

**P4 — Earth-size, only on a product decision.** Requires tile generation on the
GPU (§3.2) and camera-relative rendering (§3.3).

## 7. What we are not doing

- Not rebuilding the world at Earth radius because a demo did.
- Not adopting a quadtree whose tiles are smaller than the detail they draw:
  our finest authored cell is 0.70 m and the clipmap's L0 is 1 m, which is the
  same picture with a different bookkeeping.
- Not putting volumetric clouds in the ground-level picture: the dome bands cost
  nothing and the analytic atmosphere already matches the ground.
- Not copying the camera-at-origin machinery before there is a scene that spans
  a planetary distance.

## 8. Evidence and limits

Everything in §2 comes from reading the named files and `config/`. The dead tile
keys were found by grep: `tileSizeM`, `tileVertices` and `lodDistancesM` appeared
only in `config/clientConfig.ts`, parsed into fields no renderer read — a shape the
`config:keys` guardrail cannot catch, because the key is named in code. They were
deleted in P0. No frame timings, orbit screenshots or precision measurements were
taken for this document; the float32 and horizon numbers are arithmetic from the
configured radius and eye height, and should be confirmed against the running page
before P3 is planned.
