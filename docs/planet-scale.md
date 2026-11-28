# Planet terrain, detail and the living crust

**Status:** current direction, 2026-11-27. The walkable radius stays 100 km. A
uniform 2 m mesh over the whole body is rejected; a screen-space detail chain
and a sparse shallow crust are the direction. The built baseline is one 620 m
play disc at 2 m cells, a 20 km transition ring, and a 100 km global-relief
globe. The detail chain and the streamed crust are **not built**. Orbit is still
the dev-panel camera action described in ADR-077, not a player-facing descent.

**Related:** [DESIGN.md](../DESIGN.md) C03b and T25/T56,
[T56](./tasks/T56.md) (the first real volumes),
[abyssal-garden-source-analysis.md](./abyssal-garden-source-analysis.md)
(what the reference does and does not prove),
[decisions.md](./decisions.md) ADR-076/ADR-077,
[procedural-systems.md](./procedural-systems.md).

The 100 km radius and the one-camera orbit direction in ADR-076/ADR-077 stand.
This record replaces the older two-patch/clipmap-only description: the shipped
ground is now a disc, a transition ring and a globe, and the missing capability
is continuous detail and an editable crust, not a second square patch.

## 1. The short answer

We can have **detail everywhere**, but not the same **geometric resolution**
everywhere.

A 100 km planet has

```
surface area = 4πR² = 1.2566 × 10¹¹ m²
```

At the play disc's 2 m cells that is **31.4 billion cells**, or at least **62.8
billion triangles** at two triangles per cell. The existing 620 m disc is 1.21
million triangles; repeating its density over the body would be roughly **126
billion**. No client renders that, no server stores that, and no amount of
procedural generation makes the rasterisation or the collider free.

The useful resolution depends on the eye, not on whether a player owns the
ground:

| Cell size | Cells on the body | Triangles at 2/cell | Enough for |
|---|---:|---:|---|
| 2 m | 31.4 B | 62.8 B | standing on the soil |
| 8 m | 1.96 B | 3.93 B | the first few hundred metres |
| 20 m | 314 M | 628 M | a valley seen from a hill |
| 160 m | 4.9 M | 9.8 M | tens of kilometres |
| 1,500 m | 55.8 k | 111 k | the whole body from orbit |

The current 620 m disc is the first row, the 20 km ring covers the transition,
and the 84,500-face globe is the last row. The visible player-area clue is the
**disc-to-ring step**, not a law of the world.

Two rules follow:

1. **Use the coarsest cell that is still one to two pixels at its distance.**
   A 2 m triangle at 1.2 km is far below a pixel; spending it there buys
   nothing but memory and draw time.
2. **Never let the material change at a mesh boundary.** The same procedural
   soil, wetness and climate must cross the boundary, or a perfectly correct
   LOD transition still paints a visible disc.

The current disc is not a "player area" to the renderer. It is the one mesh
that carries the fine terrain field and the near-field water/moisture data. A
second player standing elsewhere would not make their ground detailed on this
client either; the boundary is camera-local LOD, and it is visible because it
is too abrupt.

## 2. What is built today

| Layer | Geometry | Spacing | Cost / role |
|---|---|---|---|
| Play disc | `planet-play-disk`, 620 m radius, fixed tessellation | 2 m at the rim; 1,948 angular segments; 310 rings | 1.21 M triangles; the only walkable ground; one Rapier heightfield over the same cells |
| Transition ring | `planet-horizon-ring`, 620 m to 20 km | 1,948 angular segments; 48 quadratic radial rows; first row ~8.4 m | ~191 k triangles; blends the local cap into `planetReliefAt` over 1.8 km; 8 m lip under the globe |
| Globe | `planet-far-relief`, icosphere detail 64 | ~1.5 km triangles at 100 km | 84,500 faces; global field everywhere; shader cut inside an 18 km polar arc while the ring is visible |
| Material | shared soil shader | procedural, per fragment | world-space soil, clods, moisture, wetness, water-table response |
| Water | local shallow-water field plus cave river, river channel, sea dome/planet sea | 96 m surface field around the player; local channels | surface puddles, cave aquifer, carved river, whole-body sea |
| Edits | server-owned sparse soil edits | 0.5 m cells, 16 m chunks, 64 active chunks, 12 m max depth, 4 m³ per edit | root tunnels, collapse and backfill; persisted; not a general voxel planet |

The play disc is not a square patch with an outer ring any more. It is a
circular mesh at one resolution with a buried 8 m rim. The ring exists because
the disc's fine field ends at 620 m and the global field has to take over
somewhere. The physics is deliberately only the disc: the other 99.999% of the
planet is scenery you can look at, not ground the plant walks on.

### 2.1 Why the boundary is legible

Three different things end at roughly the same place:

- **Cell size:** the disc is 2 m at its rim; the ring's first radial row is
  ~8.4 m. That is a four-times jump at the exact edge of the detailed ground.
- **Field frequency:** the local field has four octaves around a 50 m base, so
  it contains folds down to a few metres. The global field's shortest octave is
  **160 m**. The ring can sample the 160 m hills; it cannot make a 6 m clod
  silhouette. Shader detail can paint texture on the surface, but it cannot
  change the skyline.
- **Local data:** water, wetness and the fine soil response are solved around
  the player. They fade at their own extents; outside them the same shader has
  less to say. That is a second, independent way for the eye to find the disc.

At 1.2 km the first two are the dominant cue: the ground beyond the disc is
smoother because the field is lower-frequency, and the first ring row is
coarser. The answer is not to hide the globe below 1 km. It is to make the
transition gradual in **both** frequency and cell size.

## 3. The detail chain

### 3.1 One view-dependent chain, not one player patch

The target is a single LOD chain centred on the **eye** (not on the plant,
and not on a server "active area"):

```
2 m cells near the eye
  → cells double as the distance grows
  → 1.5 km cells at the limb
```

A clipmap or quadtree is the bookkeeping. Each tile has the same small vertex
grid; the level chooses its world size. A tile is generated from the same
shared height field, and a screen-space error threshold decides when it splits.

Acceptance for the chain is visual, not merely topological:

- no T-junction or skirt line visible at any transition;
- no height step at a shared edge (skirts hide cracks, they must not draw);
- at 1.2 km, a ridge that crosses the current 620 m boundary keeps its
  silhouette and its lighting;
- the chain can follow a camera anywhere on the body, not only the spawn cap;
- the disc and the 20 km ring are deleted when the chain lands, not kept as a
  fallback.

The first implementation does not need GPU generation. A CPU clipmap with a
worker that fills tile heights, and a bounded pool of tile buffers, is enough
to prove the visual contract. GPU generation is a later optimisation with a
cross-vendor determinism caveat: the server field remains authoritative and
the physics mesh is built from the drawn vertices.

### 3.2 Heights generated where they are drawn

The shared field is cheap enough to evaluate from a seed; the expensive part
is turning every sample into a vertex, a normal, a collider and a draw. The
chain should generate a tile only when it enters the pool, keep the generated
heights for the pool's lifetime, and rebuild only after an edit revision
changes.

The server does not send terrain meshes. It sends the seed and the sparse
edits. A client that leaves an area can rebuild it from the same seed later and
land on the same height. The base field is not persisted row by row.

### 3.3 Small numbers at the GPU

Patch-local metres remain the rule. A vertex stores its height above the pole
tangent plane, not a 100,000 m radius; the mesh carries the radius in its
transform. At 100 km that keeps float32 spacing at millimetres instead of
centimetres. A larger radius or a camera-relative chain does not need a new
world coordinate system until the scene graph itself spans a planetary
distance, which is the orbit view, not the walk.

### 3.4 Placing things by hash instead of by record

Stones, tussocks, dead wood and future ground cover are functions of the seed
and a coordinate. They do not need rows, and they must use the same LOD chain
and the same height function as the ground. This is the cheapest way to make
the whole surface feel inhabited without turning the planet into content data.

### 3.5 Climate that decides where things are

Weather should shape the surface instead of only tinting it: rain shadow,
erosion, deposition, snow line and wetness. The local water field is one
solver; the planet view needs a coarse climate/hydrology field that can be
sampled anywhere. The two meet by an altitude and distance blend, not by a
server switch.

### 3.6 Two atmospheres, one planet

The surface keeps the analytic atmosphere shared by every material. The orbit
view needs a raymarched single-scattering model with a limb. The two blend by
altitude, and the cloud layer belongs to the same blend. The weather state must
be visible in both: a storm at the plant is cloud cover and shadow on the
globe, not a separate orbit effect.

### 3.7 The living crust

A thick 3D crust is not a planet-sized voxel grid. At 0.5 m cells, one metre of
depth over the whole body is **5 × 10¹¹ cells**; it would dwarf every other
budget in the project. Thickness here is a **layered shell where the game can
reach**, not a voxel ball to the centre. The crust is a **shallow editable
shell plus authored volumes**, with deeper caves and strata added only where
they are content:

- The shared height field remains the surface truth for the walkable area.
- A sparse 3D volume layer represents overhangs, arches, caves and root
  tunnels where they actually exist (T56). Surface nets is the mesher; its
  gradient normals give the low-poly rock its smooth shading.
- Chunks are addressed by revision. Base occupancy is derived from the field;
  only edits are stored. A chunk is re-meshed when its revision changes, and
  only clients with that chunk in their pool receive it.
- The column query must return **every floor and ceiling**, not one height.
  One height per column cannot represent a cave, an overhang or stacked
  strata. This is the specific Abyssal Garden idea worth taking.
- Collision stays near the player. The far crust is visual until a player can
  walk there; do not build a planet-wide collider for scenery.

The direction for terraforming is therefore: edit the surface field for
shallow changes, edit a sparse volume for real 3D changes, persist the edit,
bump the chunk revision, and let each client re-mesh the dirty chunk. The
server's edit budget remains the authority (`max_edit_volume_m3`,
`max_edits_per_tick`, `max_active_chunks`); a client cannot mine a canyon by
sending a bigger number.

### 3.8 Water and weather across scales

Water has four scales, and they must not pretend to be one mesh:

1. **Whole-body sea:** the analytic/planet-sea surface, visible from orbit.
2. **Regional hydrology:** a coarse flow-accumulation field that carves river
   channels into the shared terrain field.
3. **Local surface water:** the shallow-water grid around the player, with a
   real shoreline where the ground crosses the water plane.
4. **Cave water:** the confined aquifer/river under the surface, exchanging
   with the surface at springs.

The local grid is 96 m and cannot be the planet's water. The planet's water is
the sea and the coarse river network. A waterfall or a stream seen from orbit
can be a coarse ribbon; it becomes the solved local grid only when the eye is
close enough to see the surface.

Weather is one server-owned state machine. The surface gets rain/snow, wind,
light and sky cloud bands; the orbit gets a cloud veil, a shadow on the ground
and the same terminator. Volumetric clouds are a later shared layer, not a
second weather system. The acceptance is that a storm started at the plant is
still the same storm when the camera pulls out to the limb.

## 4. How big should the world be?

The horizon at eye height `h` on radius `R` is `sqrt(2Rh)`. At 100 km and 1.7 m
that is 583 m, which is why a 620 m authored disc looked complete at ground
level. From 1.2 km the horizon is about 15.5 km, and from orbit it is the limb.

The radius stays **100 km** for now. Growing to 200–400 km is a content
decision (more horizon to author) rather than a precision decision; the next
size still needs the continuous chain. Earth-size needs a depth-range
experiment and a much larger content budget, not a bigger heightfield.

## 5. The orbit view as a real feature

The orbit is a camera position, not a second world. The body must be drawn from
the same relief field and the same weather state as the ground. The camera path
must not cut between a detailed disc and a painted ball.

**Current state (2026-11-27):** orbit is still the dev-panel camera action
described in ADR-077. It draws the globe and hides the local disc/ring; the
continuous descent described below is P2 work, not a shipped player feature.

### 5.1 What it must do

- Pull out from the plant, through the cloud layer, to the limb, and back,
  without a cut.
- Keep the same ground under the landing point; no second terrain mesh.
- Show a lit and unlit side, an atmosphere rim, sea glint and the current
  cloud cover.
- Hide the disc/ring only when the continuous chain has replaced them, not as
  a permanent special case.

### 5.2 The rendering split

| Altitude | Ground | Air | Clouds |
|---|---|---|---|
| 0–2 km | local chain, 2 m near the eye | analytic atmosphere | dome bands + rain/snow |
| 2–50 km | chain coarsening with distance | blend to raymarched | dome bands fade into the shared layer |
| 50 km–orbit | global relief, no local disc | raymarched single scattering | cloud veil and shadow on the body |
| limb | body silhouette + rim | raymarched through the shell | accumulated layer |

The blend factor is altitude and distance, decided in one place. A new model
joins by that factor, not by a new mode switch.

## 6. Staged plan

**P0 — precision groundwork (done 2026-11-21).** Patch-local metres; the dead
tile keys deleted. The current disc/ring/globe replaced the earlier two-patch
pair after that groundwork.

**P1 — make the detail island stop reading as a player mark (next, visual).**
Keep the existing physics and gameplay. Give the global field the
mid/high-frequency term it lacks, match the ring's first radial cells to the
disc's 2 m edge, and make wetness/water tint a global field with a soft local
solve on top. Acceptance: at ground level and at 1.2 km, no colour, silhouette
or specular boundary at 620 m; the same ridge crosses the old boundary with the
same shape. This is the cheap pass that answers the screenshot before the
clipmap exists.

**P2 — continuous detail chain.** Replace the disc and ring with the
view-dependent chain. Start on the CPU with a tile pool; add GPU generation
only after the visual contract holds. Acceptance: no visible transition from
standing height to the limb, no T-junction/skirt line, the tile pool stays
inside the frame budget, and physics remains the near heightfield.

**P3 — editable crust.** Stream T56-style sparse volumes and the existing
sparse soil edits through the same chunk revisions. Add multi-interval column
queries, cave collision near the player, and a re-mesh path for dirty chunks.
Acceptance: a root tunnel, a dug cave and an authored arch all survive a
disconnect/reconnect, and two clients see the same edited surface.

**P4 — water and weather at planet scale.** Promote the coarse hydrology and
cloud layer into the orbit blend. Acceptance: a storm at the plant is visible
as cloud and shadow on the globe; a river seen from orbit is the same channel
the local solver fills.

## 7. What we are not doing

- Not drawing 2 m triangles over 100 km. The arithmetic in §1 is the reason.
- Not voxelising the whole planet. The crust is sparse and shallow; the deep
  body is an analytic sphere.
- Not keeping a permanent 620 m "player patch" and hiding the seam with fog.
  The chain replaces it.
- Not letting other players' locations change this client's ground detail.
  Detail follows the camera; the server owns edits and simulation, not meshes.
- Not storing the base terrain row by row. Seed plus edits is the storage
  contract.
- Not treating Abyssal Garden's static 384 m box as a planet architecture. Its
  mesher and primitive language transfer; its no-streaming, no-LOD, bake-once
  assumptions do not.

## 8. Evidence and limits

The built numbers in §2 come from the live scene and the source on 2026-11-27:
`planet-play-disk` 1,210,000 triangles, `planet-horizon-ring` 190,904
triangles, `planet-far-relief` 84,500 faces; the shader cut is
`uFarReliefCutRadius` 18,000 with the ring at 20,000. The global octave list
ends at 160 m in `planetRelief.ts`; the local terrain field's base frequency and
its octaves are in `config/terrain.json`.

The 1080p frame figure quoted elsewhere in the project is **39.6 fps** on the
reference Intel Iris Xe machine, so the chain is a frame-budget change, not a
free visual upgrade. No continuous-chain frame timings, cave collision tests
or planet-scale hydrology tests exist yet. Those are acceptance work for P2–P4,
not claims.
