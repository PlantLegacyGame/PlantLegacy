# 2026-11-27 — seed accent, Root Sight and growth audit

A live visual pass on the dev stack at
`http://localhost:4173/PlantLegacy/?dev=1`, with the existing server at
`http://127.0.0.1:8080`. The browser's own persisted seedling was used; no
fixture or synthetic plant was inserted. Captures are at the normal game camera
unless the caption says otherwise.

## The seed detail covered the pit, then the seam read as a halo

The seed's hilum and seam are built from unit-sphere detail, but they were
parented to a coat whose geometry already carries the seed's own radius. They
were therefore drawn about a metre across around a seed roughly ten centimetres
across. That one fault produced both reported symptoms:

- the hilum sphere looked like a brown ball above the seed;
- the seam torus looked like a brown hoop;
- in Root Sight, the oversized sphere sat over the opening and read as a
  covered shaft instead of an open pit.

![Before: the unit-scale hilum and seam around the seed](2026-11-27-seed-world.png)

![Before: Root Sight's opening covered by the oversized seed detail](2026-11-27-root-sight-initial.png)

`MeshPlantRenderer` now scales the accent group by the coat's radius before it
is attached. The detail is still built in unit space and still inherits every
move of the seed; only its size changed.

![After scaling, before the seam was removed: the seam still reads as a halo](2026-11-27-final-seed.png)

The remaining loop was the seam torus from `addSeedDetail`. It was horizontal at
`length * 0.5`, the very top of the unit coat, so even at the correct scale it
sat above the seed rather than on its flanks and read as a halo. The seed only
needs the hilum scar; the seam was removed. `buildOrganAccents` now gives a seed
one detail mesh, and the test fails if that hilum goes missing.

![Final: the seed with its hilum and no seam halo](2026-11-27-seed-no-halo.png)

A daylight frame with the same seed is `2026-11-27-seed-no-halo-day.png`; the
ground was standing in rain water in that capture, but the top of the seed where
the hoop used to sit is clear.

## The aperture soil body showed its flat top

With the seed detail fixed, the opening was open, but a grown Root Sight still
drew two hard-edged brown slabs on the ground beside the pit. They were not
shadows and not the cavity bowl: the aperture soil body's flat top sits just
under the surface sheet at the mouth, and on a slope the downhill side rises
through the terrain. From above, that exposed top read as earth laid over the
ground.

The body is meant to be the earth a buried eye sees in front of the sheet, not
an overlay for a surface view. `EnvironmentRenderer` hides it above the surface;
the sheet and cavity bowl own the view from above. The source test in
`apertureSoilMesh.test.ts` pins that condition.

![Before: the body's top exposed as brown slabs beside a grown pit](2026-11-27-growth-fixed-root-sight.png)

![After: the same grown pit with the body withheld above ground](2026-11-27-root-sight-open-final.png)

## Regression: hiding the body above ground also hid it inside the pit

The first visibility fix keyed the body to `eyeBuried`, but that term excludes
the Root Sight opening by design: standing over the open pit is not being buried
in the terrain sheet. When the camera entered the shaft, `eyeBuried` was false,
the body was hidden, and the ground sheet's backfaces read as a brown ceiling,
with a gap of sky where the shaft wall should be. That was a real regression in
the buried view, introduced by over-applying the surface fix.

The renderer now passes `eyeUnder` (the eye is below the surface, including
inside the opening) to `syncApertureSoil`, and gates body visibility on that.
The near-side cut remains keyed to `eyeBuried && inside`, so the surface view is
still clean while the pit view keeps its walls. The live camera was placed at
`(-4.15, 20.05, 3.25)` under ground level `20.77`, with the 0.64 m aperture open
and one radicle; `aperture-soil-volume.visible` was `true` and Root Sight
reported `eyeWindow: true`. The shaft wall, the radicle and a small piece of the
real opening all render, with no ceiling slab.

![Inside the shaft: the wall and radicle render with the body visible](2026-11-27-root-sight-inside-fixed.png)

## Growth

Growth was driven from the live UI, not inserted. The seed click offered
**Sprout Radicle**; selecting it started the growth; it completed in 17 seconds
with two nodes, biomass 5.8, energy 38.0, water 46.4/46.4 and minerals
46.4/46.4. Root Sight auto-opened on the buried part. No console errors were
recorded.

![The radicle option selected with the fixed seed](2026-11-27-growth-option-fixed.png)

The final grown frame is the `root-sight-open-final.png` above: the seed is
correctly small, the pit is a clean open oval, and the ground beside it has no
brown slabs. The earlier growth captures with the metre-wide hoop are not kept:
they show the old seed bug, not the current look.

## Checks

- `apps/client` tests: 1097 passing in 194 suites after all three fixes.
- `pnpm --filter @plant-legacy/client typecheck`: pass.
- Biome check on the changed client files: pass.
- `pnpm docs:check`: pass.
- The focused world-cap test in `apps/server/src/main.socket.test.ts` passed on
  four more runs; it closes ten admitted players, checks `SERVER_FULL`/1013 on
  the eleventh, then proves a fresh `HELLO` is admitted with `WELCOME` after the
  ten close.
- The Root Sight opening and the growth flow were checked in the browser. The
  inside-pit view was produced by placing the live camera with the dev camera
  helper, not with a mouse orbit; the wall/root frame is the screenshot above.
  The no-halo seed frame was taken from the live camera as well.
- Not every organ type at every growth stage was grown or captured. Weather,
  time of day and terrain slope vary between sessions; the aperture body's
  exposed-top case was also confirmed by removing the body live and seeing the
  slabs disappear.

## Camera lag in rain

The first live profile put the standing-water simulation at the front of the
frame: **11.7 fps** while orbiting at ground level in rain, with
`surfaceWater.update` taking **49 ms/frame**, the water contour sync **8-12 ms**
per call, and the GPU only **10-12 ms**. The field was 192 x 192 (36,864 cells),
ran up to several 20 Hz solver ticks in one frame when the frame was late, ran
the hidden cave river on every tick, rebuilt the cave contour at 10 Hz even with
Root Sight closed, and rewrote dampness/uploaded both float textures even when
the ground was dry.

The fix keeps the water, weather, puddles, damp shore, cave river and Root Sight
cut. It changes how much work each frame does:

- The field is **80 x 80** (1.6 m cells over the 128 m square), configured by
  `surface_cells`. Marching squares still places the shoreline between samples.
- The solver runs **at most one tick per frame**, so a slow frame no longer
  schedules two or three more solver ticks and makes the next frame slower.
- A **dry field** skips the solver and texture upload entirely; dampness still
  dries at the upload cadence, then the idle path stops uploading too.
- The hidden cave river solves at **a quarter cadence** and its contour is only
  rebuilt when a Root Sight cut is open. Surface contour sync is revision-gated
  and runs at 5 Hz.
- The contour builder no longer allocates a `WaterCorner` object for every one
  of 37,000 samples and several arrays for every wet cell; it samples into flat
  arrays and reuses one set of scratch buffers.
- The open-sky solver skips roof/capacity tests that can only matter to a
  roofed body (the cave).

Measured live in the same browser, during rain, with the camera dragging:
**59.5 fps, p50 16.7 ms, p95 16.8 ms** over 118 frames; `frameStats` reported
CPU p50 **8.6 ms**, p95 **13.3 ms**, GPU **10.6 ms**, with 366.8 m3 of surface
water and 85.5 m3 in the cave. Before the change the same orbit was 11.7 fps.

## The seed's scar

The hilum was present in the scene graph but was placed at 0.42 of the seed
radius with a 0.18-radius bump, so the coat enclosed it completely and the seed
read as a plain bead. It now sits on the upper front as a shallow oval, tilted
to the local surface, with a material derived from the seed's own palette colour
and lightened for legibility. The close view confirms the pale oval on the coat
instead of a buried mesh.

![The seed's hilum, now a visible pale scar on the upper front](2026-11-27-seed-scar-front.png)

## Final checks

- `packages/shared` full suite: **272 passing in 41 suites**.
- `apps/client` full suite: **1097 passing in 194 suites**.
- `pnpm typecheck` (all packages) and the client typecheck: pass.
- Biome check on all changed source and config files: pass.
- `pnpm docs:check`: pass (80 files, 199 relative links).
- `pnpm config:validate`: pass (83 config files).
- The performance and scar captures come from the live game, not a synthetic
  harness. The close seed view used the dev camera helper at 0.35 m; the orbit
  measurement used real pointer drags over the canvas.
