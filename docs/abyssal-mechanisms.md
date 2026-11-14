# Abyssal Garden — mechanism reference

Reference material extracted from *Abyssal Garden* by Maksymilian Dendura (MIT
license). This file answers one question: **what technique did AG use, where in
its source, and what must Plant Legacy change to use it?**

It is not a programme, a schedule or a spec. The programme lives in
[`PlantLegacy-Abyssal-Integration-Plan.md`](./PlantLegacy-Abyssal-Integration-Plan.md),
the rules and task specs live in [`DESIGN.md`](../DESIGN.md), and the decisions
that came out of this material are ADR-041 to ADR-049 in
[`decisions.md`](./decisions.md).

**The filter.** AG is a static, hand-authored, single-player diorama. Plant
Legacy is a persistent, player-authored, server-authoritative ecology. A
mechanism only transfers if it still works when the world is edited every
minute, preserves server authority, scales by interest/LOD rather than by
drawing everything, is configurable under RULE_3, avoids named outcomes and
rarity, keeps the player a plant, and fits the phone budget.

---

## Technique catalogue

| Technique | AG source | Mechanism | Take | Change |
|---|---|---|---|---|
| Designed SDF terrain | `shaders.js` `W_DENS`; `world.js` `MESAS/ARCHES/HOLES/CLEARS` | Combine capsules, tori, tunnels, clear zones, noise; evaluate density | T57 feature language: spline sweeps, carves, blends, booleans; T56 density rasterisation | Server-authoritative, chunked, editable, persistent; planet curvature |
| Surface nets | `math.js` `surfaceNets`; `world.js` `buildTerrain` | Iso-surface meshing from a scalar field | T56/C10 chunk meshing | Chunk seams, LOD skirts, revisions, collision, materials |
| SDF brick cache | `main.js` `CO/CN/CI/CG`, `cv`, `sd`, `collide` | Int8 distance in 4³ bricks, trilinear sample, gradient push-out | Camera/root collision against caves and overhangs | Server queries; near chunks only; integrate with Rapier trimesh |
| Connected-component cleanup | `main.js` density post-pass | Delete floating rock islands | T56 generation validation | Never delete player-created islands; only unconnected generation noise |
| Cell-sorted instancing | `world.js` `pack`, `main.js` `drawCells` | Bucket by XZ cell, min/max Y, frustum/distance cull, merged draw runs | Foliage, pebbles, fragments, fauna dots, ground cover | Generalise to 3D chunk/interest; revisioned; GPU indirect on WebGPU |
| Ribbon foliage | `shaders.js` `W_LEAF` | Analytic bend, twist, wind, translucency, iridescence, sparkle | C02/C02b leaf cards; C03 grass/undergrowth | Derive from server nodes; mutation-aware; no underwater palette |
| Underwater absorption | `shaders.js` `S_G.fogIn`, `sunE`, `amb`, `side` | Per-channel extinction, height attenuation, in-scatter, sun phase | C03 aerial perspective and height fog | Land palette; weather/time-of-day; no water-only assumptions |
| Caustics | `shaders.js` `W_WATER`, `caus` | Animated caustic texture projected along sun | Lake/cave water; dappled light | Driven by water depth and weather; optional on low tier |
| Water surface | `shaders.js` `W_SURF` | Refraction, TIR window, sky reflection, fog | T31/C10 water surface, above and below | Fresh/salt water, waves, foam, shoreline, day/night |
| Openness/skylight volume | `world.js` half-res volume | Cheap AO/skylight bake from canopy and terrain | C03 canopy shade, cave darkness, ambient occlusion | Revisioned when canopy or terrain changes; server canopy state |
| Light shafts | `shaders.js` `W_RAYS`, `W_RBLUR`, `W_POST` | Half-res jittered march, shadow compare, depth-aware blur/upsample | C03 sun shafts through canopy and caves | WebGL post first; weather-driven; no water-only phase |
| Baked detail texture | `shaders.js` `W_DETAIL` | Tileable slope/height/mottle, triplanar sample | C03/C10 rock and soil detail without visible tiling | Procedural cache at startup; no asset file |
| Post chain | `shaders.js` `W_BLIT`, `W_POST` | Karis bloom, tonemap, vignette, grain, dither | C03 desktop post; mobile fallback | Config tiers; no full-screen post on phone by default |
| Closed-loop quality | `main.js` `resize/frame`; `quality.js` | GPU timestamp band; pixels then draw distance; persist settings; device-loss fallback | C01/RULE_26 | WebGL timer query + WebGPU timestamps; per-device persistence |
| Procedural audio | `audio.js` | Noise loops, convolution reverb, pooled voices, camera-speed coupling | C06 | Land/weather/fauna/plant layers; server events |
| Fly-through benchmark | `main.js` `FLY`, `flyLUT`; `dev.js` | Catmull-Rom path, arc-length LUT, avg/p99/max frame and GPU | C01/D01/H01 | Plant and world paths, fixed visual poses, CI evidence |
| Zero-alloc frame | `main.js` `F`, preallocated buffers | One state array; no per-frame heap | C01/C02 | Audit and refactor hot paths |
| Designed clear zones | `world.js` `CLEARS`, `flyPts`, `POSES` | Keep camera path and viewpoints clear | T57/T59 authoring | Keep spawn, Root Sight and social hubs clear; no player-path scripting |
| Density-driven scatter | `world.js` `kelpDens`, `hot`, `magAt` | Noise + hand-placed hotspots + exclusion zones | T59/C03 vegetation and ground cover | Driven by server environment fields; editable and successional |
| Multi-surface placement | `world.js` `floorsAt` | All floor/ceiling intervals per column | T56 scatter/spawn on overhangs and cave floors | Server-authoritative; supports stacked layers |
| Mesh lathe/tube/coral | `world.js` `meshLathe`, `Mesh.tube`, `meshCoral` | Procedural geometry with no assets | C10 props/rocks, C11 fauna; T57 features | Budgeted, instanced, LOD |
| Fish/manta vertex animation | `shaders.js` `W_ANIM` | Procedural body wave, no skeletons | C11 fauna; T54 herds | Config body plans; server state; no decorative-only fish |

---

## The six structural lessons

**1 — A single frame beats a clever overlay.** AG's shafts, water, bloom and
correct occlusion all depend on one depth buffer. PL's split canvas cannot share
depth. But unification is a *prerequisite for volumetric geometry*, not for the
current height field: it is deferred until T56 makes local occlusion real
(ADR-041).

**2 — Sort once, bind once, draw runs.** AG's foliage cost is not a faster leaf
shader; it is pre-bucketing instances by cell and merging visible cells into
runs. The invariant that matters is *one bind, many instances, no per-entity CPU
work in the frame loop.*

**3 — Bake only what cannot change.** AG bakes shadows and skylight because its
world is static. PL cannot. The correct port is "cache with a revision key and
update incrementally", never "bake once". This single distinction prevents most
of the mistakes that would make PL feel like a diorama.

**4 — The look is mostly atmosphere, not geometry.** AG's beauty comes from
absorption, sun extinction, height falloff, shafts and a restrained palette.
Atmosphere will raise perceived quality more than doubling leaf triangles.

**5 — Measure GPU time, not just CPU fps.** At 60 Hz vsync, CPU fps cannot tell
you whether there is headroom. (This is also why AL-01/AL-03 come before visible
polish — ADR-048.)

**6 — Use the camera path as a design constraint.** Keep spawn, Root Sight
apertures, hubs and the first plant view clear. That is authoring, not scripting
outcomes: it makes the world readable without telling players what to do.

---

## Attribution

If any AG code or close adaptation is used, add to
[`ATTRIBUTION.md`](../ATTRIBUTION.md) under "Code and techniques", with the
repository URL, and keep the full MIT notice in the adapted source file:

> Abyssal Garden, Maksymilian Dendura, MIT License. Adapted techniques: terrain
> density and surface nets, SDF collision, cell-sorted instancing, ribbon
> foliage, atmosphere and light shafts, quality control, and procedural audio.

Do not add AG screenshots or built HTML as assets.
