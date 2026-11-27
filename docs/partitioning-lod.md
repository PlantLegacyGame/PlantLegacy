# Partitioning and LOD

**Status:** implemented (C02b WebGPU, C02 SDF Raymarched). Owners: **C02/C02b**
(renderer and tiers), **T03** (server interest management).
**Source of truth:** DESIGN.md Parts 13.5, 13.6, 13.7. Tier numbering is owned
by DESIGN.md Part 14.2.0 (v5.3.2) and is not restated here (ADR-042, ADR-049).

**Scope:** the tiers below are **plants**, not terrain. The planet's ground
levels, the detail budget, the sparse crust and the water/weather scale split
are in [planet-scale.md](./planet-scale.md). A player-area terrain boundary is
not a plant LOD tier and is not fixed by changing these values.

## Overview

The system uses a **dual rendering path**:
1. **C02 mesh (Three.js, shipped default)**: the close plant is drawn as real mesh geometry per organ in `MeshPlantRenderer.ts`. It sits in the scene graph, so terrain, the Root Sight cavity and the plant sort in one depth buffer. This is the path `PlantRenderer` uses by default (`useMeshL0L1 = true`).
2. **C02 SDF raymarched (fallback)**: Raymarched Signed Distance Fields with polynomial smooth minimum (`smin`) organic fusion inside local bounding volumes, drawn as a fullscreen quad. Used when the mesh pass is disabled or for the far tier.
3. **C02b (WebGPU Compute-Driven)**: GPU-driven plant rendering path with compute culling/LOD, merged mesh for tiers 0/1, analytic ellipsoid impostor for tiers 2/3 (a coloured point at L3's size), WebGL2 fallback. Off by default.

## Architecture

### Server (`apps/server/src/ops/plantWorld.ts`)
- Single process, single world, single Postgres (RULE_31)
- Growth simulation: 20 Hz tick, Murray's law radii, gravitropism/phototropism
- Offline tiers: Active (20 Hz), Near (5 Hz), Dormant (30s steps)
- Photosynthesis: canopy leaves produce biomass from light (0.5/s at full light)
- Interest management: spatial grid cells, per-client entity caps, distance bands → detail levels

### Client - C02 SDF Raymarched Renderer (`apps/client/src/renderers/PlantRenderer.ts`)

**Depth behaviour:** the raymarch is a fullscreen quad with `depthTest: false`
and `depthWrite: false`, because a missed ray has to output alpha 0 and blend
over the sky rather than write depth across the whole screen. The consequence is
that an SDF-drawn plant cannot be occluded by nearby relief: it composites over
the terrain. That is why the mesh path above, not this one, is the default for
close plants.

**Unified Organism SDF:**
- Bounding box execution: raymarching only inside plant's active node graph + blend padding
- Tapered Capsule SDF (`sdCapsule`): swept tapered segments between parent/child nodes with biomass-derived radii
- Joint Spheres (`sdSphere`): at node junctions and root-crown ellipsoid at y=0
- Smooth Minimum (`smin`): blends primitives into continuous membrane with organic branch collars
- Continuous 3D Triplanar Noise: 4-octave fbm eliminates UV seams at joints
- Procedural Wind Displacement: coherent 3D wind field, sway amplitude scales with height
- Translucent Foliage & PBR-Lite: subsurface transmission, directional + ambient + rim lighting
- Three Mutation Visual Signatures: bioluminescent, thickened bark, variegated foliage

### Client - C02b WebGPU Compute-Driven Renderer (`apps/client/src/renderers/webgpu/`)

#### LOD tiers (canonical table: `DESIGN.md` Part 14.2.0)
| Tier | Projected Size | Geometry | Render Path |
|------|---------------|----------|-------------|
| 0 (Near) | ≥ 300 px | Full merged mesh | `mesh.wgsl` |
| 1 (Mid) | 80–300 px | Merged mesh (no leaves) | `mesh.wgsl` |
| 2 (Far) | 12–80 px | Ellipsoid SDF impostor | `impostor.wgsl` |
| 3 (Distant) | 2–12 px | Same ellipsoid impostor (a coloured point at this size) | `impostor.wgsl` |

As **shipped**, tiers 2 and 3 are one analytic ellipsoid pass, relit live; there
is no atlas, no bake and no billboard (ruling 2026-11-24). `webgpu_tier2_threshold`
is **12**, so the ellipsoid starts where the ADR-042 band starts. The old atlas
billboard and its baker are deleted rather than left switched off.

#### Compute Pipeline (`cull.wgsl`)
- Frustum culling per plant
- Projected-size tier assignment with hysteresis (promote 1.15×, demote 0.85×); distance is a consequence, not the rule (Part 14.2.0)
- Minimum dwell time (0.5s) prevents oscillation
- Outputs `PlantRenderData` (tier, visible, projectedSize)

#### Mesh Pipeline (`mesh.wgsl`) — Tier 0/1
- Instanced tapered tubes for stems/roots
- Vertex format: position(3) + normal(3) + uv(2) + packed(1 u32)
- Wind animation in vertex shader
- Root-specific: simpler geometry (4 sides vs 8 for canopy)

#### Impostor Pipeline (`impostor.wgsl`) — tiers 2 and 3
- Camera-facing quad, no vertex buffer, 6 vertices per plant, instanced; the
  quad is only the window the eye ray is traced through
- Ray-ellipsoid intersection in the fragment shader, normal from the gradient
- Procedural bark/canopy colour, the plant's own composed look, and the same
  ground-map hill test the mesh pass uses
- Lit from the frame's sun every frame, so a distant plant turns with the day
  instead of carrying a baked copy of one hour
- Its extent is the plant's own body above the soil (`impostorBaseY`,
  `impostorTopY`, `impostorHalfWidth`), not the bounding sphere the cull pass
  measures: that sphere carries the roots, and a seedling sized from it drew
  several times its stem and shrank at the 1<->2 swap (E41). The sphere still
  drives the tier, so the LOD decision and the silhouette cannot disagree about
  where the plant is, only about how big its body is. The box takes every leaf
  blade at its drawn position, so a canopy wider than its stem is covered; its
  base is lifted to `max(impostorBaseY, groundY)` because a seed crown's box
  reaches below the soil and a buried base hid the widest part of the pod; and
  the resulting radii have a floor of `MIN_BODY_PX` (4 px across) so the 2–12 px
  tier keeps drawing a coloured point instead of fraying to nothing. The floor
  is a plateau by nature: while a body's true width is under it the pod stays
  one size however far the plant is, which is what keeps the distant tier legible
  and what made 6 px hold a seedling at a constant 4 px across a 12–27 px
  cull-sphere span. 4 px halves that error and still draws a 2x2 px point;
  a 24 px probe floor drew an 8 px dot at the same distance, so only about a
  third of the floor reaches the drawn pod and no floor of 5-6 px changes what
  a far plant looks like. On the shipped 80 px boundary the same 3.38 m body
  measured 7x24 px as the impostor and 6x32 px as the mesh, 2.95 m against
  3.42 m of body

### Plant Mesh Generation (`PlantMeshBuilder.ts`)

#### Geometry
- **Roots**: 4 radial sides, tapered tubes, gravitropic curvature
- **Canopy**: 8 radial sides, stems + leaves + joints
- **Murray's Law**: r_parent³ = Σr_child³ (bottom-up computation)
- **Growth Animation**: 0.9s smoothstep from spawnTime
- **Seeded RNG** (2026-11-09): `hash01(nodeId, 'salt')` replaces `Math.random()` for deterministic leaf normals and branch curvature

#### Performance
- Single merged vertex/index buffer for all plants (C02b)
- Rebuild throttled (100ms interval) during active growth
- 10k plants do not all reach L0: a fixed slot pool holds the full meshes (256 T0 + 1,280 T1 slots, DESIGN 14.2.1) and everything beyond it is an impostor, so the merged buffer's size is set by the pools, not by the plant count

#### Cost of the shipped mesh path

`MeshPlantRenderer` (above) is a mesh per organ, not a merged buffer: it adds one
`THREE.Mesh` per stem node and one per leaf, caches tube geometry but rebuilds
leaf geometry on every growth rebuild, and leaves three.js nothing it can batch.
Draw calls therefore scale with organs rather than plants. What to do about it is
ranked, with effort, in
[`abyssal-garden-source-analysis.md`](./abyssal-garden-source-analysis.md) Part II.

## Config Tunables

| Config | Default | Notes |
|--------|---------|-------|
| `webgpu_enabled` | `false` | Enable the WebGPU overlay; off because its separate depth buffer cannot sort against terrain |
| `webgpu_max_plants` | 20000 | Capacity of plant/render storage buffers |
| `webgpu_tier0_threshold` | 300 | Projected pixel size for tier 0 |
| `webgpu_tier1_threshold` | 80 | Projected pixel size for tier 1 |
| `webgpu_tier2_threshold` | 12 | Projected pixel size for tier 2, the ellipsoid band (ADR-042: 12–80 px) |
| `webgpu_tier3_threshold` | 2 | Projected pixel size for tier 3 |
| `webgpu_hysteresis_promote` | 1.15 | Multiplier before promoting tier |
| `webgpu_hysteresis_demote` | 0.85 | Multiplier before demoting tier |
| `webgpu_min_dwell_time` | 0.5 | Minimum seconds in tier before change |
| `smin_blend_radius` | 0.15 | SDF organic fusion blend radius (`config/plant_renderer.json`) |
| `max_raymarch_steps` | 128 | Max sphere tracing steps per ray (`config/plant_renderer.json`) |
| `wind_strength` | 0.3 | Wind displacement amplitude |
| `wind_speed` | 1.0 | Wind displacement frequency |

## Root Rendering

- **C02 (SDF)**: Roots (y < 0) and stems/trunk (y > 0) are parts of the exact same continuous SDF body. In Root Sight mode, ground cutaway shader reveals underground roots of this single organism.
- **C02b (WebGPU)**: Roots use mesh tubes (4 radial sides, Murray's law radii, gravitropic curvature) rendered in same mesh pass as canopy (Tier 0/1). Hidden when camera above ground unless Root Sight enabled.

## Scaling to 10k Players

1. **Compute culling** - GPU parallel per plant (C02b)
2. **Instanced rendering** - Single draw call per tier (C02b)
3. **Merged buffers** - No per-plant buffer binds (C02b)
4. **Tier system** - 90%+ plants at L2/L3 (C02b)
5. **Hysteresis** - Stable tier assignments (C02b)
6. **Bounding volume** - Raymarching restricted to plant screen footprint (C02)
7. **Interest management** - Server filters entities per client (T03)

## Files

| File | Purpose |
|------|---------|
| `apps/client/src/renderers/PlantRenderer.ts` | C02 SDF raymarched plant renderer (fallback) and the LOD/tier switch between paths |
| `apps/client/src/renderers/MeshPlantRenderer.ts` | C02 mesh plant renderer: the shipped close-plant path, one `THREE.Mesh` per organ |
| `apps/client/src/renderers/EnvironmentRenderer.ts` | C03 environment (sky, fog, rain, terrain) |
| `apps/client/src/renderers/webgpu/WebGPURenderer.ts` | C02b main renderer, compute/render pipelines |
| `apps/client/src/renderers/webgpu/PlantMeshBuilder.ts` | C02b mesh generation, Murray's law, growth |
| `apps/client/src/renderers/webgpu/shaders/cull.wgsl` | C02b frustum culling + LOD assignment |
| `apps/client/src/renderers/webgpu/shaders/mesh.wgsl` | C02b tube vertex/fragment shader |
| `apps/client/src/renderers/webgpu/shaders/impostor.wgsl` | C02b ellipsoid impostor (tiers 2–3) |
| `apps/server/src/ops/plantWorld.ts` | Growth sim, photosynthesis, tiers, interest |
| `apps/server/src/ops/interestManager.ts` | T03 spatial interest management |