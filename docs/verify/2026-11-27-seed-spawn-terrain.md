# 2026-11-27 — seed archetypes, spawn scene, one play disc, attached Root Sight

Live pass on the dev stack at `http://localhost:4173/PlantLegacy/?dev=1` with
the local server at `http://127.0.0.1:8080`. The browser had no saved plant in
the fresh guest session, so Play opened the new spawn scene normally rather than
reclaiming an old plant.

## Spawn scene and archetypes

Play opens `SpawnScene` instead of connecting. Four archetype cards (Verdant,
Deeproot, Sunspire, Stoneheart) show their description and the four
config-owned multipliers, the balance is in the header, and the survey map
labels the four named areas. Wild ground is free, named areas show their cost,
and the exact-coordinate tab takes latitude and longitude.

![The spawn scene with four archetypes, the survey map and a free wild spawn](2026-11-27-spawn-scene.png)

Choosing **Grow a free wild seed** sent a `HELLO` with the selected archetype
and entered the world on a free spawn. The server-created plant carried the
verdant trait set; the HUD's geodetic readout was
`89.6678° N, 179.0349° W · 2 m`. This was also a rain frame at ground level.

![A free verdant spawn in rain, with the live geodetic readout](2026-11-27-free-spawn-world.png)

The unit and socket tests cover the parts a single free spawn does not: named
area and exact-coordinate pricing, bounds refusal, insufficient spores, refund
when plant creation fails, duplicate submits, and old clients that send no
spawn selection.

## One detailed disc, no LOD

The scene's ground meshes were inspected at runtime: there is one
`planet-play-disk` (620 m radius, fixed 2 m cells, one geometry and material)
and one static `planet-far-relief` globe. No `ReliefChunkSet`, inner/outer
horizon patch or altitude-level mesh is present. The play disc is collided by
one Rapier heightfield; the 1.2M-triangle render mesh is not a physics trimesh.
The globe is a backdrop above 1,000 m eye altitude only: at ground level it sat
below the 2 m disc and its 1.5 km triangles produced the brown ceiling, the
square island and the grey band at the disc rim. It now draws the continuous
`planetReliefAt` field, not the retired six-kilometre square far field.

A top-down frame of the same seed's ground shows continuous detail with no
square edge or chunk seam.

![Top-down view of the single 620 m play disc](2026-11-27-playdisk-ground.png)

Frame timing in the running client was measured twice. At the 1152-wide dev
panel, standing in rain with 180 consecutive `requestAnimationFrame`
intervals: **p50 16.7 ms, p95 16.8 ms, 60 fps**. At a true **1919 x 1080**
drawing buffer (obtained by sizing the app to 2133 x 1200 so the quality
controller's 0.9 ratio produced 1919 x 1080), with the camera kept active and
the weather forced to rain, it rendered **39.6 fps over 5 s**: p50 25.1 ms,
p95 43.4 ms, CPU p50 4.6 ms / p95 8.4 ms, GPU 22.1 ms. The 1080p 60 fps
acceptance target is **not met** on this machine (Intel Iris Xe / ANGLE D3D11).
Hiding every non-light object in the scene still rendered only 55.2 fps at that
buffer, so the ceiling is not the terrain alone. The play disc is 1.21M of the
1.32M triangles; no LOD was added and the fixed 2 m cells remain.

![The rain frame used for the frame-time measurement](2026-11-27-rain-performance.png)

The 1152-wide measurement was a stationary ground view; the 1080p one kept the
camera active to defeat the idle cadence. The angular blue shapes in the rain
capture are the existing surface-water film's contour, not the terrain mesh;
they are the uncommitted water work this pass preserves.

## Root Sight collar

With Root Sight open from above, the seed pit has one rim: the soil edge and the
bowl wall meet without a ring of sky. The separate aperture-soil body and skirt
are gone from the scene.

![The attached Root Sight rim from above, with no sky ring](2026-11-27-root-sight-attached-topdown.png)

The collar is part of the bowl's own lathe geometry and is conformed to the
terrain at the cut ring, so the overreach under intact ground is the same mesh
as the wall. The top-down frame above is the surface acceptance check. The
360° rim ray harness from the earlier Root Sight pass was **not** re-run after
this geometry change, and no new inside-pit frame was captured on this build.
Those remain the gaps in the acceptance evidence.

## Horizon and camera follow-up

The initial ground view showed three symptoms of the same coarse backdrop: a
brown ceiling overhead, a floating square island with vertical facets, and a
grey band where it met the play disc. Runtime inspection identified the mesh as
`planet-far-relief` at only 23.5 m from the eye: its 84,500-face icosphere spans
about 1.5 km per triangle, so it can rise above the 2 m play surface and expose
the square authored far field from the retired LOD path.

The rendered globe now evaluates only `planetReliefAt`, the seamless planet-wide
field. The old workaround - hide the globe below 1,000 m - is gone: it left the
ground reading as a circular plate whenever the player zoomed out before the
orbit view appeared. A 20 km transition ring now starts vertex-for-vertex on
the play disc's 620 m rim, blends the local cap into the global field over
1.8 km, and then follows that field outward with an 8 m outer lip tucked under
the globe. The coarse globe carries an `aFarRelief` flag; its shader discards
fragments inside an 18 km polar arc while the ring is the visible surface, and
the cut switches off in planet view so the full globe is drawn there. The cut
uses polar arc, not world X/Z, so it cannot remove the south pole as well.

An oblique camera at 1,200 m over the rim (`[0, 1200, 3000]` looking at the
play area) shows one continuous surface: no rim wall, no circular plateau and
no step to the globe. A 20 m eye just inside the rim looking outward also sees
unbroken ground to the ridge line.

![Oblique at 1,200 m across the play disc edge with the joined horizon](2026-11-27-disc-edge-1200m-oblique-after.png)

![Twenty metres above the rim, looking outward: no disc step](2026-11-27-disc-rim-low-oblique-after.png)

At 43 km and 182 km the same body remains continuous, and the whole planet is
present as soon as the orbit view opens rather than appearing only after a
further zoom. The globe is no longer hidden in planet view; that hide was what
left the zoomed-out camera with empty space around the moon.

![The continuous planet from 43 km](2026-11-27-zoom-43km-after.png)

![The whole planet from the local rig at 182 km](2026-11-27-zoom-182km-after.png)

![The whole planet in orbit view](2026-11-27-planet-view-globe-after.png)

The `camera_mode` default changed from `free` to `ground`, and
`clampEyeToGround` now rescues an eye that is already below the surface unless
Root Sight holds a cavity. A 400 px upward drag at a fresh spawn ended with the
eye 0.02 m above the drawn surface; previously the same drag left it metres
under the terrain with the sky below the ground.

![A fresh spawn with a clean horizon and the intended shallow camera](2026-11-27-horizon-clean-spawn.png)

![The same fresh-spawn view after the transition ring and globe cut](2026-11-27-horizon-ring-ground-2.png)

## Bugs found and fixed during this pass

- **WELCOME was rejected by the client's own schema.** The server put the
  plant-owned trait subset in `WELCOME.archetype` (id, name, multipliers,
  mutation bias) while the new wire schema required the spawn card's
  `description`, `color` and `seedScale`. The first free spawn logged
  `skipping malformed server message` and never entered the world. Those three
  fields are now optional in the protocol schema: the spawn scene still serves
  them from `/spawn/options`, and WELCOME/PLANT_CREATED carry the trait subset
  they actually own.
- **The spawn scene called the 620 m play radius a diameter.** The map caption
  and the random-spawn copy now read the radius from the server's
  `playRadiusM` instead of hard-coding "620 m diameter".

## Checks

The final runs, after the WELCOME schema fix, the copy fix and the Biome pass:

| Check | Result |
|---|---|
| `pnpm --filter @plant-legacy/shared test` | 283 passed, 0 failed (43 suites) |
| `pnpm --filter @plant-legacy/client test` | 1076 passed, 0 failed (191 suites) |
| `pnpm --filter @plant-legacy/server test` | 568 passed, 0 failed (115 suites) |
| `pnpm typecheck` | all 7 projects passed |
| `pnpm lint` | exit 0, 8 warnings and 13 infos, no errors (before the ring pass) |
| `biome check` on the six changed source/test files | exit 0, no fixes |
| `pnpm config:validate` | exit 0, 83 files, `config: OK` |
| `pnpm config:keys` | exit 0, every declared key is read or allowlisted |
| `pnpm docs:check` | exit 0, 81 files, 200 relative links |

The live checks above are a spawn-scene pass, one free spawn, one top-down
ground frame, one Root Sight top-down frame and the rain frame-time measurement.
No paid spawn was purchased in the browser, no orbit/globe frame was captured,
and no inside-pit frame was taken on this build.
