# 2026-11-26 — organ morphology, gizmo, Root Sight, camera, terrain, water

Evidence for the approved growth/render pass. The world ran from the existing
`pnpm dev` stack at `http://localhost:4173/PlantLegacy/?dev=1`, with the server
clock set to noon for the daylight captures. The plant used was the browser's
own persisted seedling; no fixture or synthetic plant was inserted.

## What was checked

### Gizmo, move vs rotate, and seed picking (S38)

A seed click selected the plant and opened **Sprout Radicle**, so the seed body
centre fix is live (the earlier miss came from the pick sphere, not the seed
drawing). The aim then showed the orange joint ring, green arrow, arrowhead and
ground landing ring in `2026-11-26-gizmo-seed-aim.png`.

The two gestures were driven separately and their compass lines read back from
the live panel:

| Gesture | Compass while active | Direction before | Direction after |
|---|---|---|---|
| Press on orange joint, drag horizontally | `MOVE JOINT` | away · steeply down · 0.46 m out · −0.72 m up | unchanged |
| Press on green arrow, drag up/right | `AIM DIRECTION` | away · steeply down (≈90° down) | away · 54° down · 0.50 m out · −0.69 m up |

That is the required separation: the joint gesture never changed yaw/pitch and
the arrow gesture never wrote an attach fraction. The live test also found that
the active-handle word stayed after release; `main.ts` now clears it on release
and on Escape (the fix came after this capture, so the capture still shows the
pre-fix label).

![Seed aim with joint puck and arrow](2026-11-26-gizmo-seed-aim.png)

### Root Sight and the shaft (A16/A28)

The radicle grew at 12:18 with Root Sight auto-opened. The status read
`ON - 1 bubble(s), aperture 0.64 m (roots reach 0.52 m), slope ground, progress
1.00`, so the aperture was sized from the drawn root rather than the seed-only
fallback, and it was on a slope. The aperture soil body was visible while the
opening was fully open, not only while the eye was buried.

![Root Sight with the radicle and a slope rim](2026-11-26-root-sight-top.png)

The first view of the same opening is in
`2026-11-26-root-sight-radicle-clear.png`; the earlier rain frame
`2026-11-26-root-sight-radicle.png` is kept as the wet-weather comparison. The
shaft now becomes visible from the first part of the opening (`progress >
0.001`); a 0.1-progress capture was not made.

### Free camera

With the eye at 4.87 m from the pivot and Root Sight open, a 10-second idle
period with no pointer or key input returned exactly the same pose:

- Before: `[-2.2218029891203206, 24.97055093707726, 3.666851585976767]`
- After: `[-2.2218029891203206, 24.97055093707726, 3.666851585976767]`
- Target and probe distance (4.874679476642539 m) were also unchanged.

Free flight was then put 3.8 m under the ground at the same plan position. The
eye stayed at `y = 16.97055093707726` while `groundY` was `20.796207048958117`
for 2.5 s, exactly the deliberate-through-terrain case that the ground rig used
to clamp.

![Free camera below the drawn ground](2026-11-26-free-camera-underground.png)

The full 20-second idle window and a keyboard-driven flight through a hill were
not repeated; the 10-second exact-pose check above and the underground hold are
the measurements this pass made.

### Terrain

At 28 m the chunked surface is continuous and no LOD edge is visible
(`2026-11-26-terrain-close.png`). At 220 m the clean chunked surface is
`2026-11-26-terrain-mid-clean.png`; it has no square crack. An earlier frame in
this pass showed a dark square, but that was self-inflicted: the debug inspection
had re-shown the old authored 180 m patch over the chunk tree. Hiding that patch
again removed the square, so it was not a shipped seam.

![Terrain from 220 m](2026-11-26-terrain-mid-clean.png)

The 2 km frame (`2026-11-26-terrain-2km.png`) shows the far field without a
horizon crack or a chunk square. A 180 m/560 m/6 km crack-ray test suite was not
written in this pass; the browser checks are visual only.

![Terrain from 2 km](2026-11-26-terrain-2km.png)

### Water

The shoreline is now the zero-depth contour of the solver, covered by the
focused test (`surfaceWaterMesh.test.ts`, 5×5 ramp: first crossing at
`x = 1.7`, not a cell edge at 2). The live basin filled in Rain and the same
view after the weather returned to Clear showed the pools draining over the
following minutes, so the basin retains water after rain rather than snapping
dry.

The final rain capture (`2026-11-26-water-specular-check.png`) is the one that
matters, and it records a part that is **not fixed**. The white sun speckle has
been reduced: the sheet's local sun lobe is now 0.05 at a 160-power exponent
(was 0.28 at 64), its local sky mix is 0.03–0.12, and the terrain's own puddle
layer uses a water-body reflection instead of `sky_horizon`. The sheet also
keeps a 0.72–0.98 alpha floor so the bed cannot show through as a pale film.
Even so, the shallowest cells still read as pale cyan islands at a grazing angle.
The live experiments that turned the ground puddles red, hid each water mesh and
blacked the sheet's body all showed the islands surviving at least one of those
changes, so the remaining cause is a mix of the two water paths rather than one
uniform. It needs a dedicated close-range pass; this record does not call the
water finished.

![Rain basin at dusk, with the remaining pale shallow cells](2026-11-26-water-specular-check.png)

## Automated checks

- `packages/shared` tests: 268/268 pass, including the 19-organ morphology
  registry and the config override/fallback test.
- `apps/client` tests: 1080/1080 pass, including the water contour, water
  material and free-camera rig tests.
- Focused run: 11/11 (`surfaceWaterMesh`, `waterMaterial`, `cameraRig`).
- `pnpm typecheck`: all workspace projects pass.
- `pnpm config:keys`: 736 declared, 49 allowlisted, 687 read; no unread keys.
- `pnpm config:validate`: 83 config files, OK.
- `pnpm palette:check`: 7 ramps, 31 roles, current.
- `pnpm docs:check`: after correcting the `growth` tunable count from 66 to 67
  for `organ_morphology`, no errors.
- `pnpm lint`: three import-order errors introduced by the new edits were fixed;
  the remaining diagnostics are pre-existing style warnings in unrelated title,
  WebGPU and joint-elbow files.

## What was not checked

- All 19 organ types at 0/25/50/75/100% growth were not captured. The registry
  and renderer paths are exhaustive and unit-tested, but the live session only
  had a seed and one radicle, and there is no dev command that spawns every node
  type at five progress values.
- Gene clamping was not exercised; only the unclamped 54° direction was checked.
- G03's socket knuckle is in the mesh now, but the requested 30°/90°/150°
  junction fillet test was not written, and a sharp-angle wedge was not inspected
  on screen.
- S37's orbital meridian seam was not specifically checked. The terrain volume
  is still the single authored arch plus the aperture body, not the chunked
  play-area volumes the plan described.
- Touch parity (A32) was not run on a pointer-coarse device. The canvas already
  has a `pointerdown` growth handler alongside the mouse path, but this pass did
  not drive it with a real touch pointer.
- The Root Sight shaft at an early opening progress, and a straight-down view
  inside a deep shaft, were not captured.
- Terrain crack-ray tests at the three requested distances were not written.
- Water mass conservation, downhill flow and basin fill were not re-measured in
  the live server; only the contour and shading tests were run.
