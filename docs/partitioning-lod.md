# Partitioning and LOD

**Status:** implemented (C02b WebGPU, C02 SDF Raymarched). Owner: **T03** (weeks 10–11).
**Source of truth:** DESIGN.md Parts 13.5, 13.6, 13.7.

## Overview

The system uses a **dual rendering path**:
1. **C02 (Three.js + SDF Raymarched)**: Primary renderer for plants, uses Raymarched Signed Distance Fields with polynomial smooth minimum (`smin`) organic fusion inside local bounding volumes. All primitives (tapered capsules, joint spheres, root crowns, parametric leaf blades) fuse into a single continuous anatomical membrane.
2. **C02b (WebGPU Compute-Driven)**: GPU-driven plant rendering path with compute culling/LOD, merged mesh for tiers 0/1, billboards for tiers 2–4, WebGL2 fallback.

## Architecture

### Server (`apps/server/src/ops/plantWorld.ts`)
- Single process, single world, single Postgres (RULE_31)
- Growth simulation: 20 Hz tick, Murray's law radii, gravitropism/phototropism
- Offline tiers: Active (20 Hz), Near (5 Hz), Dormant (30s steps)
- Photosynthesis: canopy leaves produce biomass from light (0.5/s at full light)
- Interest management: spatial grid cells, per-client entity caps, distance bands → detail levels

### Client - C02 SDF Raymarched Renderer (`apps/client/src/renderers/PlantRenderer.ts`)

**Unified Organism SDF:**
- Bounding box execution: raymarching only inside plant's active node graph + blend padding
- Tapered Capsule SDF (`sdCapsule`): swept tapered segments between parent/child nodes with biomass-derived radii
- Joint Spheres (`sdSphere`): at node junctions and root-crown ellipsoid at y=0
- Smooth Minimum (`smin`): blends primitives into continuous membrane with organic branch collars
- Continuous 3D Triplanar Noise: 4-octave fbm eliminates UV seams at joints
- Procedural Wind Displacement: coherent 3D wind field, sway amplitude scales with height
- Translucent Foliage & PBR-Lite: subsurface transmission, directional + ambient + rim lighting
- Three Mutation Visual Signatures: bioluminescent, thickened bark, variegated foliage
- Screen Depth Integration: writes `gl_FragDepth` for accurate occlusion

### Client - C02b WebGPU Compute-Driven Renderer (`apps/client/src/renderers/webgpu/`)

#### 4-Tier LOD System
| Tier | Projected Size | Geometry | Render Path |
|------|---------------|----------|-------------|
| 0 (Near) | ≥ 300 px | Full merged mesh | `mesh.wgsl` |
| 1 (Mid) | 80–300 px | Merged mesh (no leaves) | `mesh.wgsl` |
| 2 (Far) | 12–80 px | Billboards | `billboard.wgsl` |
| 3 (Distant) | 2–12 px | Billboards | `billboard.wgsl` |

#### Compute Pipeline (`cull.wgsl`)
- Frustum culling per plant
- Distance-based tier assignment with hysteresis (promote 1.15×, demote 0.85×)
- Minimum dwell time (0.5s) prevents oscillation
- Outputs `PlantRenderData` (tier, visible, projectedSize)

#### Mesh Pipeline (`mesh.wgsl`) — Tier 0/1
- Instanced tapered tubes for stems/roots
- Vertex format: position(3) + normal(3) + uv(2) + packed(1 u32)
- Wind animation in vertex shader
- Root-specific: simpler geometry (4 sides vs 8 for canopy)

#### Billboard Pipeline (`billboard.wgsl`) — Tier 2/3
- Camera-facing quads, no vertex buffer
- 6 vertices per plant, instanced
- Procedural leaf breakup in fragment shader

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
- 10k plants = ~2M vertices at L0 (fits in single buffer)

## Config Tunables

| Config | Default | Notes |
|--------|---------|-------|
| `webgpu_enabled` | `true` | Enable WebGPU path when available |
| `webgpu_max_plants` | 10000 | Capacity of plant/render storage buffers |
| `webgpu_tier0_threshold` | 300 | Projected pixel size for tier 0 |
| `webgpu_tier1_threshold` | 80 | Projected pixel size for tier 1 |
| `webgpu_tier2_threshold` | 12 | Projected pixel size for tier 2 |
| `webgpu_tier3_threshold` | 2 | Projected pixel size for tier 3 |
| `webgpu_hysteresis_promote` | 1.15 | Multiplier before promoting tier |
| `webgpu_hysteresis_demote` | 0.85 | Multiplier before demoting tier |
| `webgpu_min_dwell_time` | 0.5s | Minimum seconds in tier before change |
| `smin_blend_radius` | 0.08 | SDF organic fusion blend radius |
| `max_raymarch_steps` | 32 | Max sphere tracing steps per ray |
| `wind_strength` | 0.3 | Wind displacement amplitude |
| `wind_speed` | 1.0 | Wind displacement frequency |

## Root Rendering

- **C02 (SDF)**: Roots (y < 0) and stems/trunk (y > 0) are parts of the exact same continuous SDF body. In Root Sight mode, ground cutaway shader reveals underground roots of this single organism.
- **C02b (WebGPU)**: Roots use mesh tubes (4 radial sides, Murray's law radii, gravitropic curvature) rendered in same mesh pass as canopy (Tier 0/1). Hidden when camera above ground unless Root Sight enabled.

## Scaling to 10k Players

1. **Compute culling** - GPU parallel per plant (C02b)
2. **Instanced rendering** - Single draw call per tier (C02b)
3. **Merged buffers** - No per-plant buffer binds (C02b)
4. **Tier system** - 90%+ plants at billboard tiers (C02b)
5. **Hysteresis** - Stable tier assignments (C02b)
6. **Bounding volume** - Raymarching restricted to plant screen footprint (C02)
7. **Interest management** - Server filters entities per client (T03)

## Files

| File | Purpose |
|------|---------|
| `apps/client/src/renderers/PlantRenderer.ts` | C02 SDF raymarched plant renderer |
| `apps/client/src/renderers/EnvironmentRenderer.ts` | C03 environment (sky, fog, rain, terrain) |
| `apps/client/src/renderers/webgpu/WebGPURenderer.ts` | C02b main renderer, compute/render pipelines |
| `apps/client/src/renderers/webgpu/PlantMeshBuilder.ts` | C02b mesh generation, Murray's law, growth |
| `apps/client/src/renderers/webgpu/shaders/cull.wgsl` | C02b frustum culling + LOD assignment |
| `apps/client/src/renderers/webgpu/shaders/mesh.wgsl` | C02b tube vertex/fragment shader |
| `apps/client/src/renderers/webgpu/shaders/billboard.wgsl` | C02b billboard vertex/fragment shader |
| `apps/server/src/ops/plantWorld.ts` | Growth sim, photosynthesis, tiers, interest |
| `apps/server/src/ops/interestManager.ts` | T03 spatial interest management |