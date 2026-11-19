# Abyssal Garden — independent source analysis

**Scope:** two parts with two different evidence bases.

- **Part I (§1–§10)** is what is actually in `abyssal-garden-main.zip`, derived
  only from that archive. Part I was written without reference to the two
  Abyssal Garden documents that preceded it
  (`PlantLegacy-Abyssal-Integration-Plan.md` and `abyssal-mechanisms.md`, both
  deleted 2026-11-16 and recoverable from git history); §9 records where they
  disagreed with the source.
- **Part II (§11–§15)** is about this repository: what our client code actually
  does today, measured against what Abyssal Garden (AG) does, and what to change
  in what order. It is derived from `apps/client/src` and `config/*.json`, not
  from the plan documents.

**Why this file exists:** a second opinion that can be checked line by line.
Where this analysis and an earlier description of AG disagree, this one cites
the source; where it and a plan document disagree about our own code, it cites
the file.

**Method:** the archive was unpacked and read in full. `quality.js`,
`math.js` and `world.js` were then loaded unmodified into Node 24 with browser
globals stubbed, its WGSL density shader was ported to JavaScript, and the real
`buildTerrain()` and `makeWorld()` were executed. §5 reports those
measurements. Absolute instance counts depend on the reconstructed field and are
marked as such; buffer formats, byte costs and algorithm timings are exact.

---

## 1. What is in the archive

| | |
|---|---|
| Upstream | `https://github.com/Noniv/abyssal-garden` (from `source/template.html`) |
| Licence | MIT, `Copyright (c) 2026 Maksymilian Dendura`, full text in `LICENSE` |
| Code | `source/src/{quality,math,shaders,world,main,audio,dev}.js` = **2 320 lines** |
| Build | `source/build.mjs` (35 lines), `source/template.html` (158 lines) |
| Total source | 2 513 lines |
| Shipped artifact | `index.html`, 99 515 bytes, 39 777 bytes gzipped |
| Assets | none. No image, model, font or sound file; `.github/screenshots/` is documentation only |
| Build system | esbuild, files concatenated in a fixed order, WGSL minified inside `/*wgsl*/` template literals, everything wrapped in one async IIFE |
| Runtime | **WebGPU only** (`if (!navigator.gpu) fail(...)`). No WebGL path exists |

File-level inventory:

| File | Lines | Role |
|---|---|---|
| `quality.js` | 14 | picks a starting detail level; persistence and crash sentinel |
| `math.js` | 214 | seeded RNG, integer-hash noise, `surfaceNets`, trilinear sampler, `Mesh` builder, icosphere, world-grid constants |
| `shaders.js` | 782 | all WGSL: density compute, solid/leaf/fish/surface/sprite passes, shafts, post |
| `world.js` | 557 | designed rock layout, terrain mesh, every instance store, procedural set-piece meshes |
| `main.js` | 643 | device setup, startup sequence, frame graph, cell culling, camera, collision, input, menu |
| `audio.js` | 71 | procedural ambience, no samples |
| `dev.js` | 39 | fly-through and benchmark, `dev.html` only |

The README claims "one 96 KB HTML file"; the shipped file is 97.2 KiB (99.5 kB).

---

## 2. How it runs

### 2.1 Startup

`main.js` executes top to bottom as one awaited sequence:

1. Request adapter and device (optional `timestamp-query`).
2. Compile ~12 pipelines (`W_SOLID`, `W_LEAF` × 5 variants, `W_ANIM` × 2,
   `W_SURF`, `W_SPR` × 3, `W_WATER`, `W_RAYS`, `W_RBLUR`, `W_POST`, `W_BLIT`).
3. **Density compute pass** over a 512×80×512 grid at 0.75 m voxels, then
   `mapAsync` the result back to the CPU as a `Float32Array`.
4. **Connected-component cleanup** on the CPU (flood from each column's base,
   then 6-neighbour propagation to a fixed point; anything unreached is flipped
   from rock to water so noise specks become water instead of small boxes).
5. **SDF brick cache** build (§3.5).
6. `buildTerrain(D)` — surface nets, gradient normals, quad bucketing.
7. `makeWorld(D, T, flyPts, POSES)` — every instance store (§4).
8. Procedural set-piece meshes: boulders, sponges, coral, tube sponges, whale
   fluke (itself surface-netted from a capsule SDF), ship, manta, fish.
9. Upload everything; free the generator's working memory (`D` and
   `makeWorld`'s internals are nulled — the source comments "about 300 MB").
10. **Bake once:** a 1024² procedural detail texture with 10 mip passes, and
    the shadow map.
11. `resize()`, render one frame, `await Q.onSubmittedWorkDone()`, reveal.

Steps 3–7 are the load time; step 10 is the only "bake" step and it never
recurs.

### 2.2 Frame

One command encoder per frame, in `render()`:

1. Water texture regenerated: one 512² HDR fullscreen pass + 4 mip blits.
2. Scene pass (`rgba16float`, 4× MSAA on High): terrain, solids, rocks, plants,
   fish, mantas, water surface from below, bubbles, glints, dust.
3. Half-res light shafts.
4. Depth-aware 3×3 blur of the shafts.
5. Bloom: 6 down, 5 up (additive).
6. Composite: depth-aware bilinear shaft upsample, bloom mix, exposure,
   vignette, ACES-ish tonemap, luma smoothing, gamma, dither.

Conventions worth copying: **reverse-Z** (`depthCompare: 'greater'`,
`depthClearValue: 0`), HDR throughout, integer `depth32float`, and a
preallocated `Float64Array` for all per-frame camera state.

Per-frame heap allocations that remain: one command encoder, one
`getCurrentTexture().createView()`, and one promise per GPU-timer readback.

### 2.3 The two bakes

| Bake | Contents | Invalidated by |
|---|---|---|
| Shadow map | one 4096² (High) / 2048² depth map, terrain + solids + leaves + (High only) small rocks | nothing — the sun is a module constant and the world never changes |
| Skylight volume | RG8 256×40×256: `r` = openness, `g` = skylight | nothing — computed once from the density field and the kelp absorption footprint |

Both are legitimate *because the world is static*. This is the single largest
structural difference from a persistent world and is discussed in §7.

---

## 3. Terrain as a designed SDF

### 3.1 The primitive set is data, not a scene graph

`world.js` declares four flat literal tables (`MESAS`, `ARCHES`, `HOLES`,
`CLEARS`), each row packed into a uniform 8-float record by `primBuffer()` and
uploaded as one storage buffer. The shader iterates them by index with counts
from a uniform. Nothing is named, nothing is a node, nothing is a mesh — so the
whole world layout is ~40 rows of numbers, trivially diffable and streamable.

### 3.2 `dens(p)` — the density field

`shaders.js:29–90`. Structure, in order:

1. **Domain warp.** Three 3-octave `fbm` samples give a vector; `q = p + w*vec3(15,6,15)`.
   Every subsequent query uses `q`, so rock, strata and erosion all warp
   together.
2. **Base floor.** `g0 = -45.5 + 7*fbm(q.xz*.011) + 1.6*fbm(q.xz*.07)` — two
   noise scales, one broad and one fine.
3. **Mesas** (`:50`). A 2D capsule distance in XZ, then a *height-dependent
   radius correction*:

   ```
   yr = clamp((p.y - g0)/(top - g0), 0, 1.3)
   e  = seg2(q.xz, a, b) - radius
   e -= overhang*ss(.3,.92,yr) + 3*(1-yr)^2 - waist*ss(0,.5,yr)*(1-ss(.5,1,yr))
   dm = smax(dm, smin(-e, top + tn - p.y, 3), 2.5)
   ```

   This one expression produces overhangs (wider near the top), flared feet
   (wider at the base) and a pinched waist. It is the reason the rock reads as
   geology and not as blobs, and it costs one `seg2` per mesa.
4. **Plateau.** `plat = max(ss(.5,.565,noise)*(1-clear), ring)`, where
   `ring = ss(156,172,|p.xz| + warp)`. The `ring` term turns the outer boundary
   into a cliff, which also bounds the playable world; `th` mixes two heights by
   `ring` so the rim rises to a wall.
5. **Arches** (`:66`). A torus in a yaw-rotated frame with `r.y/b.z`, i.e. an
   elliptical torus, smooth-unioned at `k = 1.5`.
6. **Erosion** (`:76–77`). Gated by height above the floor (`rk` ranges 0.25→1):

   ```
   d += rk * ((.5 - wor(p*.17 + w*2))*3.4 + (.5 - wor(p*.41 + 7))*1.3
            + (fbm(p*.3,3) - .5)*2.2)
   d += rk * 2.2 * (abs(fract(p.y*.21 + w.y*2.2) - .5) - .25)
   ```

   Two Worley octaves make erosion channels; the `fract(p.y*.21)` term is
   **horizontal sedimentary banding**. Two lines buy the entire "stacked rock"
   read.
7. **Tunnels** (`:80`). `smin(d, seg3(p + w*2, a, b) - radius, 2)` — smooth-
   subtracted capsules.
8. **Sealing.** `return min(d, 3 - p.y)` caps the world at the waterline. The
   compute shader also writes `d = -1` on the `x=0`, `z=0`, `x=n-1`, `z=n-1`,
   `y=n-1` faces so the mesher never sees an open border.

Workgroup is `4×4×4`; dispatch is `NX/4, NY/4, NZ/4` = 327 680 groups,
20.97 M invocations. Per voxel: ~28 `vnoise` taps, 54 hash evaluations for the
two Worley octaves, 19 `seg2`, 3 torus tests, 2 `seg3`. This is deliberately
expensive GPU work, and it is the whole reason the page needs "a few seconds".

### 3.3 Surface nets

`math.js:60`. Naive one-vertex-per-crossed-cell, placed at the centroid of the
12 edge crossings; 8 neighbour lookups per cell; `cur`/`prev` `Int32Array` row
caches; dynamic arrays grown by doubling; degenerate cells skipped by the
`m === 0 || m === 255` early-out.

It assumes the field is a complete grid: **no border sampling, no chunk seams,
no LOD, no material output**. It writes grid-space positions; `buildTerrain`
converts to world space and computes normals from the SDF gradient through
`sampler3` with a 0.8-voxel stencil, *not* from triangle faces. That is the
single most important detail for copying the look: gradient normals are what
make the rock smooth while the geometry stays low-poly.

### 3.4 Quad bucketing

`buildTerrain` (`world.js:55`) assigns every quad to a 16×16 XZ cell and stores
per-cell min/max Y across all six of its vertices, plus a per-cell `start`
prefix-sum that turns the index buffer into contiguous runs. This is the data
structure the frame loop consumes; it is built once.

### 3.5 The brick cache and camera collision

`main.js:176`, `cv` `:505`, `sd` `:506`, `collide` `:515`.

- 4³-voxel bricks, `Int8Array`, storing **`D/|∇D|` clamped to ±1 m** — a
  normalised distance estimate, not the raw field. Anything larger than a metre
  reads as a metre, which is correct for a camera collider and saves the range.
- All-air and all-rock bricks are compressed to a sentinel value
  (`lo === hi && lo*lo === 16129`, i.e. ±127) so their 64 samples are not
  stored; the `CI` header holds `brickIndex + 2`, and `cv` recovers the offset
  with `b*64 - 128`.
- Coverage is a **cylinder of 52 bricks** — 156 m — around the origin, plus
  `y` grid 4..75. That is exactly the camera's clamp (`|x,z| ≤ 150`,
  `y ∈ [-52, -1.2]`). The acceleration structure is coextensive with the
  player's movement box, not with the world.
- `collide()` steps the movement vector in sub-radius increments and, per step,
  samples the field at the camera plus six ±0.375 m offsets, forms a gradient,
  pushes out along it and projects velocity out of the surface. Two curvature
  iterations per step, `CR = 0.5`.

There is no physics engine anywhere in AG. This *is* the physics layer, and it
only ever moves the camera.

---

## 4. Instance stores and culling

### 4.1 Formats

| Store | Bytes/instance | Fields |
|---|---|---|
| Leaf | 36 | 8 floats (pos, length, yaw, tilt, width, height, type, seed1, seed2, bend packed as 8 floats + 4 bytes) + 4 `unorm8` |
| Solid | 48 | 3 × `float4`: translation+scale, quaternion, (material, seed, texScale, bob) |
| Glint | 32 | 2 × `float4` |
| Fish / manta | 32 | 2 × `float4` |
| Bubble | 32 | 2 × `float4` |
| Dust | 16 | 1 × `float4` |

All are SoA-free single interleaved buffers per store, bucketed by cull cell at
load: `pack()` for leaves, `packC()` for solids. `pack()` also supports `step`
and `widthMultiplier`, which is how the far-LOD copy of the leaf set is produced
(`pack(big, 2, 1.5)` = every second leaf, 1.5× wider).

### 4.2 Culling

`drawCells` (`main.js:398`) is the heart of the frame cost. For each of 16 rows,
ordered nearest-first by `rowOrd`:

- One `pz`/`hz` per row, not per cell.
- Per cell: an annulus test `min2 ≤ h² < max2` (LOD bands by squared distance on
  XZ) then a **conservative half-space test**: `lim = dot(p, f) + extent`,
  accepted when `|p·right| - extentR ≤ lim*tanHalfFovX` and likewise for up.
  This is a frustum test without a matrix, correct because it uses the cell's
  full half-extent as slack.
- Consecutive visible cells accumulate into one run, then `drawIndexed`/

  `draw(verts, count, 0, start)` — one call per run per depth band.

Depth bands are hardcoded per store type: hero leaf set 0–24 m (9 rows),
24–58 m (5 rows), 58–150 m (3-row decimated copy); small cover 0–70 m; big
rocks 0–150 m with an LOD swap at 40–96 m.

### 4.3 LOD strategy, stated precisely

AG has **no tier system and no mesh swapping per entity**. "LOD" here means:

1. Pre-decimated *copies* of instance data (every 2nd leaf), uploaded separately,
   selected by distance band;
2. One shader with an `override ROWS` constant, compiled into 5 pipelines;
3. Distance cutoffs per store;
4. Inside the fragment shader, the highest-frequency normal octave is faded out
   between 60 m and 12 m (`ss(60.,12.,dist)`), and small props near the camera
   are shrunk (`sc *= 1 - ss(z*.7, z, dist)`) to avoid clipping through the lens.

That is the whole of it. Nothing changes representation per entity, and no
entity's *behaviour* is affected.

---

## 5. Measurements

Executed offline (Node 24, `quality.js` + `math.js` + `world.js` unmodified, own
`dens()` port, LU = High).

| Stage | Result |
|---|---|
| Density field, 20.97 M voxels | 80.0 MB `Float32Array`; **210 s** in scalar JS |
| Connected-component cleanup | 140 ms; work list 47 256 ints; **4** voxels flipped to water |
| `buildTerrain` | **914 ms** → 399 943 vertices, 797 008 triangles |
| Terrain buffers | 6.1 MB vertex (16 B/vert) + 9.1 MB index |
| `makeWorld` | **3 218 ms** |
| Skylight volume | 5.0 MB (RG8 256×40×256) |
| Ground map | 1.0 MB (512² RGBA8) |
| Leaf instances | 305 774 (184 275 hero / 92 152 far / 29 347 cover) |
| Glints | 78 558 |
| Rock / sponge / coral / set-piece | 38 477 |
| Fish / mantas / bubbles / dust | 4 240 / 6 / 14 355 / 9 000 |
| Total uploaded | 36.6 MB |

Interpretation:

- The 210 s figure is a *CPU* number and is not what users experience; the
  density pass is GPU compute. It exists here to quantify the work: ~40 Gflop
  of noise and distance evaluation, which is why AG starts the scene behind the
  menu and tunes quality before the player dives in.
- Meshing 797 k triangles from a 21 M-voxel grid in under a second on one CPU
  thread is the strongest result in the archive. Surface nets is cheap; the
  density field is not.
- **Leaf counts are field-dependent and not trustworthy for the shipped scene.**
  Placement gates on 9 m of column clearance, `grad.y ≥ 0.55`, a 2.3 m spacing
  set, and a fly-path exclusion. The README's "about two million" leaves means
  roughly 6× more kelp columns than my reconstruction produces; at 36 B each
  that is ~72 MB of leaf instance data. Treat the count as an upper-bound
  reminder of the memory cost, not a measurement.
- The source comments on a "~35M triangle" small-rock shadow pass; that is
  consistent with 38 k instances of 0.3–1.3 k-triangle icospheres.

---

## 6. The look, mechanism by mechanism

### 6.1 One atmosphere function

`fogIn(ro, rd, d, z, sun)` (`shaders.js:207`) is a closed-form integral of
exponential height fog with per-channel extinction and height density:

```
a = sg(z) - k*rd.y
I = (1 - exp(-a*d)) / a
return colour(z) * sg(z) * exp(k*ro.y) * I * (1.22 + .3*mu^4)
```

There is no marching: the integral is analytic. Every material shares one
`fog(c, wp, z)`, and the background pass (`vsB`/`fsB`) draws the same fog at a
fixed 240 m so terrain draw-distance culling leaves no seam. `sunE(y,z)` applies
the same extinction along the sun direction to direct light.

**Consequence:** terrain, plants, animals, water, bubbles and shafts all agree
because they all call the same two functions. A renderer that mixes `THREE.Fog`
with custom shaders cannot reproduce this.

### 6.2 Caustics for free

`cuv(p) = p.xz - sun.xz*(p.y/sun.y)` projects a point onto the water plane along
the sun. `caus()` samples the per-frame water texture at that coordinate — three
offset samples per channel for dispersion — and raises it to a power. So the
water texture is doing double duty: surface normals *and* caustics, with no
second texture and no second pass. Distance-faded to a flat 0.33 value by 100 m.

### 6.3 Ambient occlusion from a baked 3D volume

`vol(p)` is one trilinear fetch of the RG8 volume. `W_SOLID` uses two fetches at
1.5 m and 4.5 m along the normal, mixes `sat((r-.5)*8)` and
`sat((r-.5)*2.7)`, multiplies by a per-instance AO and by height above the
floor. Skylight (`g`) feeds `amb()`; openness (`r`) also gates a "side" light
term that gives underwater rock its characteristic rim glow. Two texture fetches
replace an SSAO pass.

### 6.4 Ribbon foliage

`W_LEAF` is a single vertex shader instanced once per leaf, drawn as a triangle
**strip** of `ROWS×2` vertices. Per type (8 in a `switch`): base colour pair,
translucency, iridescence, sparkle probability, emissive, shape exponents, wave
amplitude. The bend is analytic and arc-length preserving:

```
k  = curvature from instance params and time
c  = origin + len*(d*(sin(kv)/k) + pe*((1-cos(kv))/k))
```

`sin(kv)/k` keeps the leaf's length roughly constant as it curls — a cheaper and
more stable alternative to a bone chain. Twist rotates the ribbon about its
tangent; `sway()` is a 2-frequency sinusoid phase-keyed on world position so
whole kelp columns move together. Near-field detail: a fine rib pattern on
`u` fades out by distance, and the shadow test is a single `shadow1`, not
`shadow9`.

The glint pass is separate and additive: constant screen size clamped between
`d*.0026` and `d*.0045`, energy-normalised by `(b.z/sz)²`, faded by
`exp(-SIG.g*d)`.

### 6.5 Water surface seen from below

`W_SURF` is a single quad at y=0, 900 m square, recentred on the camera. It
computes the Snell window explicitly:

```
k   = 1 - 1.769*(1 - cos²θ)     // < 0 outside the critical angle
win = ss(0, .22, k)             // 1 inside the window, 0 outside
```

Inside the window: refracted sky gradient plus two sun glints; outside:
`fogIn()` along the reflection ray. There is no refraction of the scene and no
above-water geometry at all — terrain is capped at `y = 3` and the camera at
`y ≤ -1.2`.

### 6.6 Light shafts

Half-res, `${RAYN}` samples (34 on High, 12 on Low), jittered with interleaved
gradient noise, marched to the lesser of scene depth, 120 m, and the water
surface. Per sample: shadow-map compare, a caustic-ish pattern from the water
texture projected along the sun, and openness from the 3D volume for a mist
term. Density is analytic (`exp(-sgz*t + k*(p.y/sx.y))`), not step-integrated.
Phase is `mix(.2 + 2μ³, .8, sunw)`. Then a 3×3 blur weighted by
`1/(.03 + |Δz|/z)` and a depth-aware 4-tap bilinear upsample in the composite.

### 6.7 Composite

Depth-aware shaft upsample → `mix(c, bloom, .06) + bloom*.03` → exposure →
vignette `1 - dot(q,q)*.55` → Narkowicz ACES fit → luma smoothing → 7 %
desaturation toward luma → gamma 1/2.2 → ±1/255 dither. Cheap and effective.

---

## 7. What AG does not contain

This list matters more than the positive one, because these are where a port
fails silently.

- No server, persistence, networking, accounts, or player state.
- No configuration system: every value is a module-level constant or a literal
  in a WGSL string.
- No tests of any kind.
- No WebGL fallback. The "fallback" is content decimation plus a resolution
  controller.
- No physics engine. Camera-only SDF marching; nothing else collides.
- No collision for plants, creatures, props or debris.
- No streaming: the whole world is resident.
- No shadow or skylight invalidation: both are baked once against a constant sun.
- No per-entity LOD representation swap (§4.3).
- No scene graph, no material system, no asset pipeline.
- No above-water world, so no sky, no aerial perspective for land, no horizon.
- No frustum matrices; culling is a bespoke half-space test over a 16×16 XZ grid
  (correct only for a surface world with a bounded vertical extent).
- Not reusable as a module: `math.js` and `world.js` are scripts that mutate a
  module-global RNG stream and rely on load-order concatenation.

---

## 8. The quality controller, precisely

Because it is easy to over-describe, here it is exactly.

`quality.js` (14 lines) chooses `LV` once:

```
LV = stored level, else coarse-pointer ? (deviceMemory > 7 ? 1 : 2)
                                      : (deviceMemory <= 4 ? 2 : 0)
```

then sets `THIN = 1 << LV` (leaf/pebble decimation), `SHADOW` 4096→2048,
`AA` 4→1, `WATER` 512→256, `RAYN` 34→12, and interpolates a `LOW` boolean into
the WGSL. Changing level reloads the page. If `localStorage.abyssalLoad` is
still set on the next visit, the previous load crashed the tab and the level
drops by one.

The closed loop lives in `frame()` (`main.js:531`) and runs **at most once per
second** (400 ms while the menu is up):

- Accumulate frame times and, when `timestamp-query` is available, GPU times
  from 6 round-robined readback slots.
- Target band 9.8–13.6 ms, aim 11.7; `k = 11.7/gpuMs`, clamped to 0.5–1.7.
- Without GPU timing: two consecutive slow periods (> 17.6 ms) scale down and
  double the wait before trying to scale up again.
- Apply `k` to **pixels first** (down to half the native budget, then the
  minimum), **then** to draw distance (`det`, 1.0 → 0.4), then to the remaining
  pixels. Faster reverses the order.
- Persist `{level, pixels, detail}` to `localStorage`.

It never touches post quality, shadow cascades, scatter density, plant tiers or
frame cadence at runtime. There is one anthropic trick worth stealing: the scene
renders blurred behind the menu, so most tuning is finished before the player
dives in.

---

## 9. Comparison with earlier descriptions

Only factual differences, each checkable against the source. The two documents
compared here were deleted on 2026-11-16 (recoverable from git history); the
rows are kept because they are the evidence for why this file replaced them.

| Earlier description | Source says |
|---|---|
| "closed-loop GPU-time quality control" in `quality.js` | `quality.js` is 14 lines of level selection. The loop is in `frame()`, at 1 Hz, and scales pixels and draw distance only |
| "cell-sorted instancing" | Sorting happens once at load (`pack`); the frame loop walks rows nearest-first and merges contiguous runs. There is no per-frame sort |
| "impostors, GPU skinning, indirect draws" as AG techniques | AG has none of these. Its LOD is distance bands over pre-decimated instance copies plus `ROWS` pipeline variants |
| "AG proves a single frame enables shafts, water, post" | True, and worth keeping: one encoder, reverse-Z, HDR, depth-aware upsample. But AG has no WebGL path to fall back to, so it proves nothing about fallbacks |
| "SDF terrain and collision bricks" as one system | They are two systems: the density field is meshed once and then discarded; the brick cache is a separate, coarser, ±1 m normalised-distance structure covering only the camera's 156 m movement cylinder |
| "zero-allocation frame discipline" | Mostly true (preallocated camera state and submit list), but one command encoder, one canvas view and one readback promise are allocated per frame |
| Source size "2 490 lines including build script and template" | 2 320 in `source/src`, 2 513 including `build.mjs` and `template.html` |

---

## 10. What is worth taking, and the precondition for each

"Portable" here means: works as plain TypeScript with no renderer coupling.

### 10.1 Portable as-is

| Mechanism | Where | Notes |
|---|---|---|
| `surfaceNets` | `math.js:60` | Add border sampling and a seam key; keep the grow-by-doubling buffers and the `m===0||m===255` early-out |
| `sampler3` | `math.js:117` | Trilinear field access, needed for gradient normals |
| Designed SDF expressions | `shaders.js:41–88` | Mesa/arch/clear/hole/erosion/strata, as a typed feature list |
| Connected-component cleanup | `main.js:166–174` | Flip unreachable rock to water; **never** delete authored or player-made geometry |
| `Mesh.sweep/tube/build` | `math.js:127–214` | Box-section sweeps and round tubes with `snorm8x4` normals and a per-vertex aux channel |
| `icosphere`, `meshChunk`, `meshLathe`, `meshCoral`, `meshTubes` | `math.js`, `world.js` | Faceted-displacement boulders; recursive tube coral |
| `floorsAt` | `world.js:106` | **Multi-interval** column query: every floor/ceiling pair with the clear height between. Better than a height field for scattering on overhangs and cave floors |
| `snap()` | `world.js:118` | March in from outside, bisect, return point + gradient |
| Analytic `fogIn` / `sunE` | `shaders.js:207`, `:239` | Closed-form height fog; the same formulas in every material |
| Seeded RNG and integer-hash noise | `math.js:4–47` | Per-system streams (`rseed`) so adding content does not disturb existing content |
| Camera SDF push-out | `main.js:515` | Sub-radius stepping plus gradient projection; no physics engine needed |

### 10.2 Portable with an architectural precondition

| Mechanism | Precondition |
|---|---|
| Density field as a whole-box compute pass | Assumes one static box and no edits. Editable or planet-scale versions need per-chunk borders, revisions and server determinism |
| Brick cache | Assumes a static world and a bounded movement cylinder. Any moving/edited geometry needs revisioned bricks or a different query |
| Shadow and skylight bakes | Assume a constant sun and an unedited world. Revisioned, incrementally rebuilt caches are a different design |
| 16×16 XZ cull grid | Assumes a surface world with bounded vertical extent. Caves and stacked layers break it |
| Per-frame water texture | Assumes a 512² HDR generator pass is affordable every frame |
| `drawCells` run merging | Portable, but the half-space test must become a real frustum test once the world is not a bounded box |

### 10.3 Not portable

The WGSL itself (only the mathematics transfers), the `override`-constant
pipeline variant trick, the single-file build and DOM shell, and the level
chooser in `quality.js`.

---

---

# Part II — what this means for Plant Legacy

Part I answers "what did AG do". This part answers "what should we change", and
every claim in it is checkable in this repository. It deliberately does not
import any conclusion from the plan documents.

### 10.2 The six structural lessons

These are the transferable claims, stated so they can be argued with. They are
the part of this analysis most likely to outlive the code details.

1. **One frame, one depth buffer.** Shafts, water, bloom and correct occlusion
   all depend on it. AG never demonstrates a fallback, so it proves nothing
   about fallbacks — only that the single-frame path is what makes the look
   possible.
2. **Bucket once, bind once, draw runs.** AG's foliage cost is not a faster
   leaf shader; it is pre-bucketing instances by cell and merging visible cells
   into contiguous runs. The invariant is *one bind, many instances, no
   per-entity CPU work in the frame loop*.
3. **Bake only what cannot change.** AG bakes shadows and skylight because its
   world is static and its sun is a constant. The correct port is *cache with a
   revision key and rebuild only the dirty part*, never *bake once*.
4. **The look is mostly atmosphere, not geometry.** A closed-form fog integral,
   direction-dependent sun extinction, caustics from a texture that already
   exists, and AO from a small 3D volume carry more of the image than doubling
   leaf triangles.
5. **Measure GPU time, not just fps.** AG's band controller reads GPU
   timestamps; at vsync, CPU frame time cannot show headroom. This is why
   measurement comes before visual polish.
6. **A small number of parametric primitives goes a long way.** Four flat
   primitive tables and three meshers (surface nets, lathe/tube, displaced
   icosphere) produce the entire world. Content is parameterised, not authored.

## 11. What our client already does

Measured from `apps/client/src` and `config/*.json`, not from the plans.

| Area | Where | Verdict against AG |
|---|---|---|
| GPU-band quality control | [`QualityController.ts`](../apps/client/src/render/QualityController.ts) — pure `nextQualityState`, tier + pixel scale + draw scale, `holdMs`, `warmupMs`, EMA smoothing, tests | **Ahead of AG.** AG has 14 lines of tier selection plus a 1 Hz pixel/draw-distance loop that never touches post, shadows or tiers at runtime |
| Shared atmosphere | [`atmosphere.ts`](../apps/client/src/renderers/environment/atmosphere.ts) + `GLSL_ATMOSPHERE`, consumed by [`ground.ts`](../apps/client/src/renderers/environment/ground.ts) and [`sdfShaders.ts`](../apps/client/src/renderers/plant/sdfShaders.ts); `scene.fog` disabled on those materials | **Matches AG's core idea** — one air for every material |
| Underwater optics | [`underwater.ts`](../apps/client/src/renderers/environment/underwater.ts) — Beer–Lambert sun dimming, Snell window, 48.6° self-reflection, immersion from 6 cm | **AG's `W_SURF` already ported**, and done from the water field rather than a hardcoded plane |
| Benchmark and fixed poses | [`benchmark.ts`](../apps/client/src/dev/benchmark.ts), `config/dev.json` `benchmark_poses` | **Matches AG's dev harness** |
| Depth-correct plant occlusion | [`PlantRenderer.ts`](../apps/client/src/renderers/PlantRenderer.ts) — the SDF fullscreen quad ran with `depthTest: false`, so plants composited over terrain; meshes are now the default path | **AG's lesson 1 already learned and implemented** |
| Renderer targets | `main.ts:4644` — `WebGLRenderer`, `antialias`, `alpha: true`, `autoClear: false` | Behind AG: no HDR target, no tone mapping, no post |
| Shadows | `main.ts:4648–4652` — `PCFShadowMap`, `autoUpdate: false`, refresh on a 125/250 ms timer (`:9385`); tiers 1024/1024/2048, `max_triangles` 50k/200k/500k | Behind AG: one map, no cascades, no caster budget, no contact term |
| Plant geometry | [`MeshPlantRenderer.ts`](../apps/client/src/renderers/MeshPlantRenderer.ts) — one `THREE.Mesh` per stem node and one per leaf, each leaf geometry rebuilt from JS arrays | Behind AG by a wide margin; see §12.1 |
| Vegetation between plants | no scatter/undergrowth module exists | Behind AG: AG's world is mostly *ground cover and ribbons*, ours is bare ground between organisms |

Three items the plan documents still list as work — a GPU-band controller, a
shared atmosphere, and a benchmark with fixed poses — are already in the client
and already tested. Any sequencing that starts there is starting behind the
code.

## 12. The three changes that matter, in order

### 12.1 Draw calls are O(nodes + leaves) per plant

`MeshPlantRenderer.ts:860–951` creates one `THREE.Mesh` per stem node and one
per leaf (`new THREE.Mesh(leafGeo, ...)`, `this.meshGroup.add(leaf)`), and
`buildLeafGeometry` (`:331`) builds a fresh `BufferGeometry` from JS arrays for
each leaf on every rebuild. `buildTubeGeometry` is cached (`:267`); leaves are
not.

With `max_nodes_per_plant: 2000` (`config/plant_renderer.json`) and
`per_client_entity_cap: 1000` (`config/world.json`), a mature plant is up to
~4 000 draw calls and 1 000 plants is unbounded in practice. three.js cannot
batch separate `Mesh` objects, so this does not improve with a better GPU, and
every growth event rebuilds geometry.

**This is exactly what AG's data layout solves, and the layout is the part worth
copying — not the shader.** AG never draws a leaf as an object: a leaf is a
36-byte instance record in a per-cell array, and a distance band is one
`draw(18, runCount)`. All variation — type, length, width, twist, colour pair,
translucency, iridescence, sparkle — is an instance attribute decoded by one
shader. Our own WebGPU path already does this (`PLANT_STRIDE`, `RENDER_STRIDE`,
`LOOK_BYTES_PER_PLANT` buffers, one mesh pipeline); the default three.js path is
the one that does not.

Two steps:

1. **Now:** cache `buildLeafGeometry` on `(length, width, segments, cotyledon)`,
   the way `tubeGeometryCache` already works. No visual change, removes the
   per-growth allocation storm.
2. **Next:** one merged geometry per organ family with per-vertex instance data,
   or `InstancedMesh` per organ family. This is AG's "one bind, many instances,
   no per-entity CPU work" invariant, and it is what makes 10k a data problem
   rather than an art problem.

### 12.2 There is no HDR and no post

The client has no `toneMapping`, no `outputColorSpace`, and no composer: there
are zero references to `EffectComposer`, `UnrealBloom` or a tone-mapping mode.
The cinematic vignette and grain are a DOM overlay, not a GPU pass.

AG's luminance comes from `rgba16float` + a Narkowicz ACES fit + Karis bloom
(`mix(c, bloom, .06) + bloom*.03`) + a depth-aware shaft upsample. In our order
of value:

1. **Tone mapping** — one line, changes how every highlight reads.
2. **Bloom** — the only thing that makes bioluminescence, spores, flowers and
   lightning read. We already carry emissive mutation data
   ([`mutationVisuals.ts`](../apps/client/src/config/mutationVisuals.ts)) that
   nothing currently spends.
3. **Shafts** — we have the atmosphere integral and the sun direction already;
   AG's trick is that the shaft pass reuses the same analytic density instead
   of integrating per step.

### 12.3 Shadows are one map at 8 Hz, with no cascade and no contact term

`main.ts:4648–4652` sets `PCFShadowMap`, `autoUpdate = false`, and `renderFrame`
(`:9385`) flips `needsUpdate` on a 125/250 ms timer. There is no cascade, no
caster budget, and no blob under a near plant, so a trunk has no grounding and a
distant canopy casts nothing.

AG's 4096 map works only because it is baked once against a constant sun, which
we cannot copy. The half worth copying is the other half: **a cache with a
revision key, rebuilt only where something changed.** The 8 Hz timer is already
half of that idea; it is not yet revision-aware.

## 13. AG mechanisms worth taking, beyond the renderer

| Mechanism | Why it fits us | Cost |
|---|---|---|
| Multi-interval column queries (`floorsAt`) | Returns every floor/ceiling pair with the clear height between. Our placement, scattering and Root Sight all assume one height per column | Days; unlocks overhangs and stacked layers without volumetric terrain |
| The density-primitive language | Mesa as a height-profiled 2D capsule, squashed-torus arches, `clear_zone`, Worley erosion, the one-line strata term | The cheapest credible path from height field to real arches and caves; a feature list, not a volume database |
| Caustics from the water texture | Project world position along the sun and sample the water texture; one texture does surface normals and caustics | Days, given `waterField` already exists |
| `meshChunk` / `meshCoral` / `meshLathe` / `Mesh.tube` | ~20 lines each: faceted boulders, recursive tube coral, lathed sponges | Days; would fill the empty ground-cover tier immediately |
| Camera SDF push-out | Sub-radius stepping plus gradient projection against a coarse normalised-distance brick cache; no physics engine | Only if camera clipping against new geometry becomes a problem |

## 14. What not to do

- **Do not unify the renderer now.** The shipping path (`webgpuEnabled: false`)
  is already a single depth buffer. The split exists only on the optional WebGPU
  overlay, which is off by default, so unifying buys almost nothing until
  occluding geometry (arches, overhangs) exists.
- **Do not port AG's bake-once shadow or skylight.** Our world has day/night,
  weather and edits. Copy the revision discipline, never the bake.
- **Do not port AG's WGSL.** Only the mathematics transfers; the
  `override`-constant pipeline-variant trick has no three.js equivalent.
- **Do not start volumetric terrain first.** AG's own strongest measurement is
  that meshing is cheap (914 ms for 797 k triangles) and the density field is
  expensive. We have a draw-call problem that would absorb any terrain gain.

## 15. Order, with the evidence each step is checked against

| # | Change | Impact | Effort | Check |
|---|---|---|---|---|
| 1 | Cache leaf geometry; stop rebuilding per growth | Removes rebuild churn | Hours | `benchmark_poses` frame ms before/after |
| 2 | Tone mapping, then bloom, then exposure | Large, whole-scene | 1–2 days | Fixed poses, visual review |
| 3 | Merge or instance plant organs (AG's store layout) | Large; the precondition for 10k | 1–2 weeks | `renderer.info.calls` in the debug overlay |
| 4 | Two shadow cascades + caster budget + blob shadows | Medium to large | 1 week | Pose set, phone tier |
| 5 | Multi-interval column queries + ground-cover scatter | Medium | 1 week | Scatter density against the frame budget |
| 6 | Density primitives for arches and overhangs | Large, but later | Weeks | Mesher timing, pose set |

Steps 1 and 2 are hours to days and both show up in poses we already have. Step
3 decides whether 10k plants is a data problem or an art problem; AG reaches the
same conclusion from a static diorama, and our own debug-overlay figures point
there independently.

## Attribution

If any of this source, or a close adaptation of it, is used, MIT requires the
copyright notice and permission text to travel with the code:

> Abyssal Garden, Maksymilian Dendura, MIT License.
> <https://github.com/Noniv/abyssal-garden>
> Copyright (c) 2026 Maksymilian Dendura

Keep the notice in each adapted source file and record the adaptation in
[`ATTRIBUTION.md`](../ATTRIBUTION.md). No AG assets, screenshots or built HTML
should be added to the repository: there are none to take, and the screenshot
directory is documentation for the upstream project only.
