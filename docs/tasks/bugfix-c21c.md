# Bugfix record — the twenty-one defects, Wave C

**Status:** `[x]` for Wave C (items 4, 7, 13). Waves A and B are in
[`bugfix-c21.md`](./bugfix-c21.md) and [`bugfix-c21b.md`](./bugfix-c21b.md);
Wave D (14, 17) and Wave E (21, the volume programme) are planned, not started.

Wave C is the ground itself: the rim that has to meet the hillside, the step where
the last ground patch ends over a faceted planet, and the dirt between a buried
eye and the pit it wants to look into. All three are one subject — what the ground
is made of at its edges — and none of them changes the tuned bowl, the aperture
sizing or the surface view.

## 1. What changed

| Item | Defect | Cause | Fix |
|---|---|---|---|
| 4 | The cavity rim is a polygon chord against a per-fragment cut, so in principle the lip and the cut can disagree by the chord error | The shader cuts the opening per pixel (exact); the bowl is geometry, one chord per column. The conform was already there — every rim vertex rises to its own ground, the lip borrows the top course's normals, and the opening is cut per fragment | **Nothing to fix, and the first version of this row got its number wrong.** A circle sampled at N columns sags `R · (1 − cos(π / N))`: **0.5 mm** at a 0.9 m mouth and **1.1 mm** at 2 m, at the shipped 96 columns. The 6.5 cm in the first draft was the arc length between columns, not the sag. The bowl stays at 96 columns. The sink stays at **0** as well, because `cavityBowl.test.ts` pins that a lip sunk below its ground opens a slot of sky at the mouth — the per-fragment cut plus the vertex conform is the right pair |
| 7 | The far ground patch ended over a step: the patches are built on the *exact* sphere, the planet body is a polyhedron whose facets sit inside it, so at the ring's outer edge the ground stopped metres above the body | `SphereGeometry(radius, 256, 128)` sags `radius · (1 − cos(π / 256))` — 7.5 m at a 100 km radius — and only the inner patch had a wall hung off it (the soil slab), not the coarse ring | The body is built at **384 × 192** facets, and a **perimeter skirt** hangs off the coarse ring's own edge, from the ring's own height function, to `planetFacetSag(radius, 384) + 2` metres down. `planetSurface.test.ts` pins the skirt's top to the patch's edge, its depth past the facet sag, and its outward winding |
| — | **The bowl was 20–32 % deeper than its depth budget**, so the pit and the earth body it is cut into had two floors: 5.73 m drawn against 4.75 m at a 2.5 m mouth, 12.3 m against 9.31 m at 4.9 m, with the shell's floor hanging *below* the cut's floor by up to 2.4 m | `verticalScale = depth / CAVITY_PROFILE_DEPTH` (1.02) scales the profile, but the rim conforms up to `reliefM` above the mouth plane before it is drawn, so the rim-to-floor depth came out as `budget + relief` — 1 m of relief on a 2.5 m mouth, 3 m on a 4.9 m one | `bowlVerticalScale(depthM, reliefM)` takes the rim's travel out of the wall: `(depthM − relief) / 1.02`, floored at 5 % of a wall so a cliff wider than the pit is deep cannot invert it. Pinned by three tests and measured live: rim-to-floor is exactly `cavityDepthM` at 0.63, 2.5 and 4.9 m (1.197 / 4.75 / 9.31), with the bowl's floor 0.45–0.57 m above the cut's floor instead of below it |
| 13 | A buried eye was surrounded by dirt: the sheet's back faces, the slab's walls and underside, and (newly) the aperture body. The pit could be an arm's length away and the frame was still a brown wall | Every soil fragment is opaque, and being *inside* the earth means every direction is earth. The sheet had a partial answer (bubbles open with the cavity, back faces dropped in the pit) but nothing cut the body around the camera | One **camera-centred near-side cut**: a `SOIL_NEAR_CUT_M = 0.45 m` bubble of soil is dropped around a buried eye, in the soil shader (which the patches, the slab and the ring all share) and in the aperture body's own material (`setApertureSoilEye`, wired per frame from `syncApertureSoil`). Conditional on the eye being under the ground, so the surface view is untouched |

## 2. Config

No new keys. The numbers are code constants with comments:

| Where | Constant | Value | Why |
|---|---|---|---|
| `planetSurface.ts` | `PLANET_BODY_SEGMENTS` | 384 | Halves the facet sag; the skirt is sized from the same number |
| `ground/shaderOverrides.ts` | `SOIL_NEAR_CUT_M` | 0.45 | The near distance of a camera: big enough not to be inside a shaded face, small enough that a stride away is a wall |
| — | bowl columns | 96 (unchanged) | Measured chord sag is 0.5–1.1 mm below a millimetre-and-a-bit; density bought nothing |
| `cavity/placement.ts` | `bowlVerticalScale` floor | 5 % of a wall | The one case the depth rule cannot win: a mouth wider than the pit is deep across a cliff, where the rim's own travel is the whole budget |

## 3. Tests

| Test | What it pins |
|---|---|
| `planetSurface.test.ts` (+2) | The skirt's top edge is `patchLocalSurfaceY` at every vertex (the patch's own edge, to float32); its depth clears the body's facet sag; it winds outward. The body is finer than 256 (sag more than halved) and its own geometry really carries facets |
| `shaderOverrides.test.ts` (+1) | The soil discards a bubble around `uRootSightCamera` only while `eyeIsUnder` **and** only outside the opening's column (`uRootSightEyeInPit < 0.5`), and it is a bubble, not a half-space |
| `cavityProbe.test.ts` (+5) | `devCavity.setRadius` keeps the cavity and the mouth apart, floors both, falls back to the cavity for a missing mouth, returns copies, and `setRadius(null)` clears it |
| `apertureSoilMesh.test.ts` (+1) | The body's material carries the near-cut switch and a distance discard; `nearCutHides` is the shader's test as a function; `setApertureSoilEye` writes the eye and toggles the cut |

## 4. Browser pass — `localhost:4174/PlantLegacy/?dev=1`, 2026-11-23

Measured in the running page after the client reloaded on the new code:

- **The ring and the body are in the scene:** `planet-terrain-skirt` exists with a
  1 240 m width and **7.27 m** of drop (the 384-facet sag at this planet's radius
  plus 2 m), `planet-soil-slab` is 13.9 m deep, and the bowl is the shipped
  **96 columns / 1 920 vertices**.
- **The rim, from above:** a 0.63 m aperture shot from 1.7 m up and 2.4 m out
  shows one continuous ellipse of earth — the seed and two roots through it, no
  pale seam, no sky sliver, nothing standing over the hole. Taken on the shipped
  96-column bowl (`screenshots/wave-c-rim-96.png`), whose geometry reports
  1 920 vertices.
- **The near cut, from inside the earth:** the pose that used to be a brown wall
  (0.95 m out from the aperture centre, 0.45 m under the drawn ground, 0.63 m
  mouth) now shows the shaft's far wall, the sky through the opening, the roots
  and the pit floor. `eyeUnderSoil` true, `uRootSightEyeInPit` 0, the body built,
  and its near-cut uniform reads `on: 1, radius: 0.45`.
- **The near cut in the pit, and beside its wall.** Standing in the opening
  0.3 m under the sheet (`eyeInPit` 1, `eyeUnderSoil` true), the shader's own
  `uEyeUnderGround` reads **0** and the frame is the pit: the near wall whole, the
  stem through the mouth, sky above it — no bubble. Standing on the surface at
  the rim (`eyeUnderSoil` false, `uEyeUnderGround` 0) the ground all round the
  mouth is intact. Both shots are `screenshots/wave-c-inpit-wall.png` and
  `screenshots/wave-c-beside-rim.png`. So the bubble was never able to fire at a
  player standing in the pit *or* beside it: its gate is `eyeIsUnder`, which the
  renderer fills with its buried flag — under the sheet **and** outside the
  opening's column — and the aperture body is only ever built for that same
  buried eye. The `uRootSightEyeInPit < 0.5` clause is therefore a second,
  local guarantee at the discard, not the thing the measurement depends on, and
  it says so in the shader.
- **The near cut at a grown 4.91 m mouth.** Sized by the dev action
  `devCavity.setRadius({ cavityM: 7, apertureM: 4.9 })`, on a page with a single
  seed node and no fake roots: one call, one click on Root sight, and the
  uniforms read **cavity 7.00 m, mouth 4.90 m** (`aperture 4.90`, one bubble).
  The previous pass needed 24 root nodes written into the client's node map plus
  a page interval to re-add them after every state sync; the radii and the
  pictures below are the same, the harness is gone. Inside it:
  - 1.0 m under the sheet, 0.3 m from the crown: `eyeInPit` 1,
    `uEyeUnderGround` **0**, the body not drawn, the frame the pit's walls, floor
    and rim with sky over it, continuous —
    `screenshots/wave-c-49-inside-devaction.png`.
  - 0.7 m from the wall (radius 4.22 m), 0.7 m under: `eyeInPit` 1, cut off, the
    wall rising to its rim and the floor whole, no hole in either —
    `screenshots/wave-c-49-beside-wall-devaction.png`.
  - Inside the soil just outside the mouth (radius 5.12 m, 1.4 m down):
    `eyeInPit` 0, `uEyeUnderGround` 1, body drawn with its cut on, and the
    bubble opens the mouth — sky disc, rim silhouette, the seed and the sun in
    it — `screenshots/wave-c-49-body-wall-devaction.png`.
  - `setRadius(null)` hands the cavity back: the reported aperture returns to the
    seed's own **0.22 m**, so the override is a replacement, not a latch.
  - 0.65 m outside the mouth (radius 5.56 m, 0.7 m under): cut on, **and the
    frame is still soil**. That is the bubble's radius, not a regression: it
    clears 0.45 m around the eye and 0.2 m of earth is left between that and the
    mouth. The cut makes the pit visible from *inside the soil skin* it was built
    for, not from arbitrary depth in the earth.
- **The skirt at its own edge.** Flew to the ring's outer edge (the ring is
  ±620 m, so the skirt's 1 240 m is its full perimeter): `planet-terrain-skirt`
  reports **1 240 m span, 7.27 m drop**, world Y 0 (the patch's own placement),
  and the body is drawn. From 12 m inside the edge at eye height the ground runs
  to a clean horizon with sky above it and no band of gap
  (`screenshots/wave-c-skirt-eyelevel.png`). From outside — 40 m out at 4 m up
  (`wave-c-skirt-outside.png`) and 8 m out at 8 m up
  (`wave-c-skirt-close.png`) — the wall joins the ring's lip to the body with no
  sky between the two surfaces. It does read as a **dark stripe**, because the
  face is vertical and catches no direct sun, so the world's edge is closed
  rather than invisible.
- Not checked: the skirt's four corners up close (the loop is built to the same
  square as the ring, and the shots above are along one edge), and whether that
  7.27 m step at the world's edge should read as a cliff at all — the skirt was
  asked to close a gap, and closing it is all that was measured.

## 5. The dev action — `devCavity.setRadius`

`?dev=1` only, on the existing cavity probe (`apps/client/src/dev/cavityProbe.ts`),
so it lives with the other things a camera cannot do by hand:

```js
window.__plantLegacy.devCavity.setRadius({ cavityM: 7, apertureM: 4.9 }); // returns a copy
window.__plantLegacy.devCavity.forcedRadius(); // { cavityM: 7, apertureM: 4.9 } | null
window.__plantLegacy.devCavity.setRadius(null); // back to the plant's own sizing
```

- It replaces **both** radii where the plant's sizing is decided (`main.ts`),
  before `rootCavityShape`, so the uniform, the cut volume, the ground sampling
  for the rim mode, the bowl, the earth body and the camera's "inside the
  opening" test all read the same two numbers. Nothing is duplicated.
- A forced mouth is not capped by a seedling's seed pit: the value is used as
  given. Measured afterwards (§6), the two numbers are not a pair the caller can
  contradict: the cavity radius never reaches the cut, the bowl, the body or the
  clamps, so `{cavityM: 0.7, apertureM: 4.9}` draws exactly the pit
  `{cavityM: 7, apertureM: 4.9}` draws and the cavity figure only shows up in the
  status line.
- The two values stay separate because the shipped config keeps them separate:
  a 7 m cutaway sphere carries a 4.9 m mouth (0.7 of it), and forcing both to
  one number is how the bowl and the hole came to disagree before.
- `null` clears it. Measured live: back to the seed's own 0.22 m in one frame.

## 6. What the override exposed — odd sizes, 2026-11-23

Two configurations, each looked at from above, from the rim and from inside:
`{ cavityM: 0.7, apertureM: 4.9 }` (a cavity smaller than its mouth) and
`{ cavityM: 3.57, apertureM: 2.5 }` (a mid-size pit at the config's 0.7 ratio).

**The cavity radius does not size anything on screen.** The bowl's scale is the
same at `cavityM` 0.7 and 7 for one mouth: 4.9 → `[4.90, 9.13]`, 2.5 →
`[2.50, 4.66]`. The mouth and its depth rule drive the cut, the bowl, the earth
body and the camera's in-the-opening test; `uRootSightRadius` reaches the soil
shader in exactly one place, the fused-envelope blend
`sminK = clamp(radius · 0.12, 0.06, 0.32)` — 0.084 m at 0.7 m against 0.32 m at
7 m. So a mouth four times its cavity is drawn as a normal mouth-sized pit, the
walls near the roots blend harder, and the HUD's `cutawayRadius 0.70` describes
nothing that is on screen. Nothing clamps the mouth to the cavity.

**The drawn bowl was 20–32 % deeper than the depth rule — fixed since.** The
rim is conformed before it is drawn (each lip vertex raised to its own ground,
up to +0.21 native here and +0.33 on the slope), and `verticalScale` was
`depth / CAVITY_PROFILE_DEPTH` (1.02), so rim→floor came out as `budget +
relief`: **5.73 m** at a 2.5 m mouth (budget 4.75) and **12.3 m** at 4.9 (9.31).
`bowlVerticalScale` now takes the rim's travel out of the wall. Re-measured in
the page, camera above ground so no eye bubble inflates the budget:

| mouth | `cavityDepthM` | rim→floor drawn | cut depth | bowl floor above the cut's floor |
|---|---|---|---|---|
| 0.63 m | 1.197 m | **1.197 m** | 1.70 m | 0.45 m |
| 2.5 m | 4.75 m | **4.75 m** | 5.25 m | 0.48 m |
| 4.9 m | 9.31 m | **9.31 m** | 9.81 m | 0.57 m |

The shell's floor now sits just above the cut's floor — the floor margin the
cut volume was always built with — instead of hanging below it by up to 2.4 m,
so the pit and the earth it is cut into share a floor again. With a buried eye
the pit is deeper than the mouth rule on purpose: `cavityDepthM` takes the larger
of the mouth rule and the deepest bubble (here an eye window 1.1 m across),
which is why the same 0.63 m mouth reads 5.85 m with the camera in the earth.

**From straight above, a pit reads as a plate.** At both sizes the mouth is
filled by a grey, radially-streaked disc with a lobed edge, and the wall is a
thin ochre ring; from inside the same geometry reads correctly as a shaft. A
top-down frame — or a player looking straight down — cannot tell the 5.7 m shaft
from a dish.

**The probe cannot separate the shell meshes.** `root-sight-bowl` and
`root-sight-skirt` share one material (`===` in the page), `setVisible` is
overwritten each frame for the shells and the terrain volume, and
`tint()` colours both shells the same green. Hiding the skirt's material took
the whole floor read with it, so which mesh draws the mouth-filling disc is
still unattributed: `root-sight-skirt` is 192 vertices — a 96-segment ring — and
is the one shell piece sized at 1.04 of the mouth circle.

### The rule holds for the plant's own cavity

The three sizes above came from the dev override. Re-measured with `forcedRadius()`
`null`, growing a real plant with `dev_grow_roots` and reading the same geometry
and the same uniforms the renderer uses (`uRootSightNodes` for the deepest
bubble, the ground at the mouth for the datum):

| stage | mouth | deepest bubble | `cavityDepthM` | rim→floor drawn |
|---|---|---|---|---|
| seed | 0.22 m | 0.41 m | 0.807 m | **0.805 m** |
| +6 roots, 5 bubbles | 0.63 m | 3.02 m | 3.415 m | **3.415 m** |
| +12 roots, 9 bubbles | 0.86 m | 5.35 m | 5.753 m | **5.753 m** |
| +24 roots, 16 bubbles, 43 nodes | 0.86 m | 9.57 m | 9.973 m | **9.973 m** |

Every row is root-driven rather than mouth-driven (`cavityDepthM` takes the
larger), which is the case the old code drifted on hardest: a 0.86 m mouth with
9.6 m of roots is a 9.97 m pit, and it is drawn 9.97 m deep.

### What the review cut

- `RimFit.verticalScale` and `fitRimToGround`'s `baseVerticalScale` parameter:
  both existed only to echo a number back after the depth rule moved out of it.
  Gone, with the two test assertions that only checked the echo.
- `bowlVerticalScale`'s `Math.max(0.1, depthM)` clamp: the call site already
  clamps, and the wall floor already keeps the result positive.
- Two `placement.test.ts` cases that proved constants against themselves (the
  scale times the profile depth, and `-CAVITY_PROFILE_DEPTH < -0.27`), and the
  standalone flat-ground unit test — folded into the relief loop as a `relief 0`
  row, since it is the same rule.
- The 5 % wall floor is now `MIN_CAVITY_WALL_FRACTION` in `profile.ts`, because
  every number in that file is a named constant with a comment; it earns its
  place by keeping a cliff from inverting the shell.

### Mid-opening: the taper

The depth rule uses the full mouth before the 500 ms ease finishes, so the pit is
full depth while its mouth is still growing. Measured on the 43-node plant
(0.86 m mouth, 9.97 m root-driven depth), sampling every frame of a real open:

| t | progress | mouth radius drawn | rim→floor | depth : width |
|---|---|---|---|---|
| 54 ms | 0.35 | 0.301 m | 9.882 m | 16.4 : 1 |
| 120 ms | 0.61 | 0.522 m | 9.918 m | 9.5 : 1 |
| 170 ms | 0.75 | 0.643 m | 9.937 m | 7.7 : 1 |
| 270 ms | 0.92 | 0.792 m | 9.962 m | 6.3 : 1 |
| — | 1.00 | 0.863 m | 9.973 m | 5.8 : 1 |

A screenshot cannot be timed into a 500 ms ease, so the page's clock was pinned
at a chosen progress for the pictures (`taper-p57.png`, `taper-p82.png`); the
HUD's own transition was not touched. At the frozen p = 0.58 state:

- the **cut and the mouth agree exactly** — drawn mouth radius 0.497 m, shader
  cut radius 0.497 m — because both scale by progress;
- the **rim stays on its ground**: largest error across the 96 rim vertices
  **0.0000 m**;
- depth is **99.4 % of the budget** already, so the opening is a *widening* of a
  pit that is at depth, not a deepening.

**Verdict: it does not read wrong.** At p = 0.57 the frame is a small, dark,
deep hole with the roots at its floor, its lip on the terrain, no sky wedge and
no seam; by 0.82 it is the full mouth over the same floor. The only sharp state
is the first frame or two (p ≈ 0.1, a 0.09 m mouth over a 9.9 m shaft — a needle),
which no 60 fps eye catches. What the taper does *not* do is grow from a shallow
dish; making it do that means easing `cavityDepthM` for the cut, the bowl and the
body together, or the three come apart again — the bug this section is about.
Not done, and not asked for.

### Which mesh draws the disc, and the read from above

**Attribution.** Vertical rays fired from straight above a 4.9 m mouth (eye
26 m up; ground 20.37, cut from +0.50 to -9.82), skipping soil-sheet hits inside
the cut the way the shader does:

| plan radius | first surface hit | its height |
|---|---|---|
| 0.00 m | `root-sight-bowl` | -9.52 m |
| 1.23 m | `root-sight-bowl` | -9.33 m |
| 2.45 m | `root-sight-bowl` | -9.14 m |
| 3.68 m | `root-sight-bowl` | -8.40 m |
| 4.80 m | `root-sight-bowl` | -5.71 m |

`root-sight-skirt` (192 vertices, the 96-column ring at 1.04 of the mouth) and
`terrain-volume` were never the first surface at any radius. The disc is the
**bowl's own floor and lower wall**, and it sits 5.7–9.5 m below the lip: the
pit's real depth, not a plug near the surface. The earlier "hiding the skirt took
the floor read with it" was the shared material hiding the bowl as well.

**Why a shaft read as a plate**, measured rather than guessed:

1. **46 % of the visible opening was one near-flat surface.** Casting rays
   through the mouth from 7 m up (2.5 m mouth) and bucketing the hits by depth:
   `0.11 / 0.10 / 0.11 / 0.22 / 0.46` of the visible area in each depth fifth.
   The bottom flare (r 0.82 → 0.55 → 0 over the last 0.24 of the profile) is a
   29° saucer, and it filled almost half the disc.
2. **70 % of the visible interior was one stratum.** The deep band started at
   0.58 of the depth, and an eye above the lip only ever sees the lower half of
   the wall: the three-bed palette was there and exactly one bed was in view.
3. **The grain chart had a singular axis.** It is `atan2 · mouthRadius` by
   world height; at the centre the angle sweeps a full turn within centimetres,
   so the noise was squeezed into 96 radial spokes converging on the floor —
   the "grey plate with a hub" the screenshots show at both sizes.
4. **The shading is in the shell's own units.** Depth darkening was 14 % over the
   whole profile, which changed almost nothing across the 5.7–9.5 m an eye can
   see, and it is identical at every mouth size. That is why the read was the
   same at 0.63 m, 2.5 m and 4.9 m and never got attributed to the size: nothing
   in the pit's shading knows how deep the pit is.

**The change, second pass: only the shading.** The cone bottom and the 0.80
deep-band move were reverted. They did move the area distribution, but only by
reshaping the pit in every view, and seen from the rim the pit was a funnel again
— the shape `profile.ts` had already been changed out of, because a funnel reads
as a banded disc and has no cut wall. `profile.ts` is byte-identical to `0582da2`
again: the saucer bottom (r 0.82 → 0.55 → 0) and the strata bands at 0.24 / 0.58
stand. What is kept is the two fixes that do not touch the geometry: the grain
blends from the cylindrical chart to world xz over the floor, and the wall
darkens 0.45 with its depth instead of 0.14.

**Measured after the revert.** The visible area by depth fifth is back to what
the saucer gives — `0.11 / 0.10 / 0.11 / 0.22 / 0.46` through the mouth from 7 m
up on a 2.5 m pit. Half the opening is still one near-flat surface, and that is a
property of the profile, not of the shading. What did change on screen is the
texture and the tone: at both mouths and in both views the 96 radial spokes
converging on the floor are gone, and the wall carries a depth falloff instead of
one value.

The first axis blend was too narrow to fix the floor: it finished at 0.30 of the
mouth, but the saucer reaches 0.55, so the outer floor still drew the cylinder
chart and streaked. 0.10–0.55 covers the floor and leaves the vertical wall on
the cylinder, where the chart is isotropic by construction.

The depth rule is untouched by any of this: rim→floor 9.31 m at a 4.9 m mouth,
4.75 m at 2.5 m, and on the plant's own 0.64 m mouth **9.204 m against a 9.204 m
budget**. The roots' worst node is 3.2 cm outside the wall, as it was before the
reshape.

Re-shot in frozen noon daylight, straight down from 9 m (4.9 m mouth) and 7 m (2.5 m), and from the side at 11.4 m out / 5.5 m up and 6.2 m out / 3.2 m up: `topdown-49-keep2.png`, `topdown-25-keep2.png`, `oblique-49-keep4.png`, `oblique-25-keep2.png`. Both oblique frames show the saucer pit with its cut wall and strata, as earlier passes settled it. Both top-down frames are a smooth grey floor inside an ochre ring — no spokes, but still a disc.

**What it still does not do.** Reading as a shaft from straight above needs the
opening to stop being half one flat surface, and that is a profile decision: a
cone bought the read by giving up the oblique view, which is the trade this file
has already refused once. A terrace or a stepped bottom would have to be judged
from the rim before it is believed from above. Separately, the depth falloff is
in profile units, so the pit stays self-similar — a 0.63 m pit and a 4.9 m one
read as the same shape, and the absolute depth is carried by the measured
geometry (9.5 m) rather than by brightness. Strata positions in metres rather
than fractions of the pit would give a pit that visibly deepens with size; that
is a palette decision for another pass.

### Shading-only depth: what does not work, and what does

**The negative result, so it is not tried again.** With the profile untouched, a
ramp on the wall's own depth cannot make a pit read deep from straight above:

- The ramp in this build (`1 − 0.45 · smoothstep(0.10, 1, d)`) already spans
  0.999 → 0.557 of tone across the visible opening, rank-correlated −0.99 with
  depth, and the pit still reads as a plate. The tone range sits in the thin lit
  ring at the rim.
- 45 % of the visible opening is one depth band (> 0.7 of the profile), and inside
  that band the ramp moves the tone by only 20 %. That is what "flat disc" means
  numerically.
- A physically-shaped term (sky solid angle over the mouth) moves the same band
  by 16 %: worse than the tuned one.
- Concentrating the ramp in that band (`1 − 0.50 · smoothstep(0.55, 1, d)`) gives
  the band a 59 % gradient, and the frame reads as a *decorated* plate: the
  gradient traces the floor's clod relief as radial wedges, because on this
  surface a fragment's height varies with angle as much as with depth. It was
  measured at 2.5 m and 4.9 m and reverted, not committed.

The reason is physical: a flat floor under a sky that is uniform over the mouth
is uniformly lit. At noon there is no shadow on it anywhere, so the only thing a
shading term can paint is the saucer's own noise.

**What does read: the rim's own shadow.** The sun reaches a point in the pit only
where the line from it towards the sun leaves through the mouth. That is computed
per fragment, analytically, with no shadow map: walk the sun ray up to the mouth's
plane and test the exit point against `uBowlApertureRadius` about
`uBowlApertureCenter` (`BOWL_LIP_SHADOW` 0.55, edge soft over 6 % of the mouth).
The bowl's sun uniform is written from `bodies.sunDir` each frame, the same vector
the sky dome and the ground read, so the shadow cannot fall on the sunward side.

Measured from straight above by casting rays through the opening and evaluating
the shader's own test at each hit (`shadow = share of the visible opening whose
sun ray leaves outside the mouth`):

| mouth | time | sun elevation | shadowed share | what the frame does |
|---|---|---|---|---|
| 2.5 m | 12:00 | 68.2° | **0.10** | still a disc |
| 2.5 m | 15:00 | 48.2° | **0.18** | still a disc |
| 2.5 m | 17:16 | 13.4° | **0.67** | reads as a shaft: dark hole, lit sliver of floor |
| 4.9 m | 12:00 | 68.2° | **0.35** | softly shaded, still disc-like |
| 4.9 m | 15:00 | 48.2° | **0.53** | reads deep: shadowed half, lit floor with its strata |

So the cue fixes the frames it can reach and leaves noon alone, which is correct
rather than a failure: at noon the sun is overhead and the whole floor is lit.
The top-down read at noon still needs a shape, and the shape is not being changed.
Frames: `shadow-25-noon.png`, `shadow-25-1500.png`, `shadow-25-1716.png`,
`shadow-49-noon.png`, `shadow-49-1500.png`.

### The cue from inside the pit, and from eye level

The crescent is a read from above. From the ground it has to survive a different
question - does the eye inside the pit see a lit patch, or only a dark wall - so
the same 4.9 m pit was checked from a player's eye level (1.7 m, downhill of the
rim, the only side with room to see in) and from inside it (1.6 m under the
mouth's plane), at 15:00 and at dusk.

The site matters here: this pit sits on a bank, and the ground across its mouth
spans **5.21 m**. The depth rule spends that out of the budget, so the floor is
9.31 m below the uphill lip and only 4.09 m below the downhill one. That is the
rule working, not a fault, but it means the uphill wall stands 5 m proud of the
mouth's plane and fills the frame from inside.

Share of the wall the lip test darkens, split by which side of the mouth it is on
(sunward = the wall the sun is over, whose inner face is turned away from it):

| time | sun elevation | sunward wall | sun-facing wall |
|---|---|---|---|
| 15:00 | 48.2° | **0.88** | **0.03** |
| 17:16 | 13.4° | **0.97** | **0.63** |

So it does not darken the wall the sun reaches: at 15:00 the sun-facing wall is
97 % clear, and at dusk it loses 63 % because a 13° sun only grazes its top - which
is the far lip's shadow, which is what should happen. The wall it darkens is the
one whose inner face already turned away from the sun. That is right in geometry
and wrong in lighting: `diffuseColor.rgb *= (1.0 - BOWL_LIP_SHADOW * shadow)` takes
the ambient with it, so a surface that had no direct sun to lose still loses 45 %
of its light. That is why the inside of the pit is uniformly pressed down and why
the lit strip does not read:

- **Eye level, 15:00** (`shadow-eyelevel-1500-downhill.png`): the pit reads as a
  hole, clearly deep, but the cue doing the work is the rim's light against a dark
  interior. The crescent itself is not identifiable as a crescent from this angle.
- **Eye level, dusk** (`shadow-eyelevel-dusk.png`): same read, darker, with a faint
  strip on the far wall and the floor almost black.
- **Inside, 15:00** (`shadow-inside-lit-wall-1500.png`): the sun-facing wall shows
  an ochre strip between two dark bands. It reads as a **stratum**, not as
  sunlight, because the strata are ochre too - the shadow has no colour of its own
  to tell them apart.
- **Inside, dusk** (`shadow-inside-lit-wall-dusk.png`): a short band low on the
  wall. It says the sun is low; it does not say how far down the floor is.

Next pass, if the inside read matters: apply the lip shadow to the direct sun
term only and leave the ambient and the strata alone, so the shaded wall keeps its
structure and the lit strip has something to contrast against. Do not strengthen
`BOWL_LIP_SHADOW` - the geometry is already at 0.88 on the wall it is entitled to
shade, and more would only deepen the same flatness.

### The sheet is not what a buried eye sees - and where it is

A buried Root Sight frame was reported as "the ground's back face and raw clods".
Both halves are real, but they come from different places, and a clip of the
terrain inside the aperture cannot reach either. Measured on a seedling pit
(0.22 m) at noon, eye frozen 1.5 m under its own ground:

- **4.6 m from the aperture centre**, `apertureSoil.visible` is `false` - the
  body's footprint is 3.6 m and the renderer only draws it inside 3.35 m - and
  the frame is exactly the sheet's underside: a brown expanse of soil cracks with
  the plant's own top showing through a thimble-sized hole
  (`underground-sheet-face.png`). This is the "back face", and it is what every
  buried pose outside the body sees.
- **Inside the footprint** the body is drawn, and its top is already 3 cm under
  the sheet: the sheet is behind it, so the frame is the body's own interior -
  the hollow between its outer skin and its shaft wall - which is the "raw clods".
  The earlier zoom-out frame (eye 8 cm under the surface, 3.59 m out) is the
  second case with the first one's cause: 3.59 m is outside the 3.35 m bound, so
  no body was drawn at all.

So "clip the terrain inside the aperture when the eye is below the surface" was
implemented and measured as asked (`uRootSightSectionRadius`, the sheet stood down
over the body's footprint, keeping a hand's breadth over the eye so the body's own
near-cut bubble cannot look through both holes at once; four pinning tests). At
1.2 m under, 2.4 m out on the seedling and 5.4 m out on a 4.9 m pit, the before
and after frames are the same picture: 1.7 % and 4.5 % of pixels differ and all of
it is the weather's light level (67.7 -> 64.6 in the HUD) - the cut fires only
where the body was already standing in front of the sheet, so it removes a surface
nobody could see. Reverted rather than shipped as a no-op; the frames are kept as
`underground-before/after-022.png` and `-49.png`.

Two changes would actually move the picture, in this order:

1. **Keep a buried eye inside the body.** Root Sight lets the camera sit under the
   surface anywhere, and everywhere outside the 3.6 m footprint there is nothing
   in the world but the back of the sheet. Clamping a buried eye into the body's
   plan (the same idea as `clampToCavity`) makes the earth body what surrounds it.
2. **Cap the section.** The body is a hollow shell, so cutting it only shows its
   inside; a section needs a filled face - a strata-banded slice through the body
   on the eye's side of the pit, with the bowl's near half clipped by the same
   plane, or the near bowl wall stands in front of the slice.

### The hold: a buried eye stays inside the soil body

The clip could not help because it was gated on the very thing that was missing.
The gate is now closed from the other side: a buried Root Sight eye is held inside
the aperture soil body's own footprint, so the body is always what surrounds it.

- `APERTURE_SOIL_EYE_HOLD_M` (0.3 m) is the keep-out margin inside the footprint,
  and `apertureSoilHoldRadiusM(aperture)` returns `max(3.6, aperture * 1.02 + 1.2)
  - 0.3`: the seedling's 0.22 m pit holds the eye at **3.30 m**, the 4.9 m one at
  **5.90 m**.
- The lock is in `clampEyeToCavity`, **before** the opening's own gate, because
  the eye it catches is by definition not over the opening. The renderer draws the
  body within `extentM - APERTURE_SOIL_EYE_HOLD_M + APERTURE_SOIL_HOLD_SLACK_M`
  (0.05 m of slack for the frame between the clamp and the draw), so the two
  cannot disagree about where "inside" ends - the first attempt held the eye to
  exactly the draw bound and the body blinked out on the boundary.

Measured with the weather pinned clear server-side (`dev_set_weather`,
`duration_s` 3600 - it survives the reloads the A/B needs) and the clock frozen at
noon, eye 1.5 m under its own ground:

| pit | before: plan 4.6 / 7.0 m, no hold | after: the held radius |
|---|---|---|
| 0.22 m | body `visible: false`; the sheet's underside across the frame with the plant's top through a thimble hole (`hold-before2-022.png`) | 3.30 m, `visible: true`; earth wall, floor and the trunk read as a space (`hold-after-022.png`) |
| 4.9 m | body `visible: false`; the sheet's underside with a wedge of sky through the huge mouth (`hold-before2-49.png`) | 5.90 m, `visible: true`; uniform earth close around the eye (`hold-after-49.png`) |

What it does and does not buy: the sheet's back face is gone from every buried
pose, because wherever the eye can be, the body is drawn. At the 4.9 m pit the
held frame is then a brown void - the body is a hollow shell and the eye is
between its outer skin and its shaft - which is exactly the "cap the section"
item below, now the only thing left between this and a readable section.

One number to keep honest: the two halves are different sessions, so the local
tile light differs (HUD 74.6 before, 68.5 after). The weather is identical and
pinned; the offset is the plant's site, not the sky.

## 7. The pit's size. Which roots count, 2026-11-23

The cavity and the mouth were sized from every node whose *type* is underground.
`plantExtent` had no height frame, so a root tip crossing an open tunnel or lying
on the surface - a root by type, in air - still added its reach to the pit's
radius (capped by `cutaway_radius_m` only). The bubbles that dig the earth had
already been filtered: `main.ts` built `atOrBelowTheSoil` from the planet radius
and the terrain field with `soilMarginM` 0.15 and used it for `isUndergroundNode`.
Two rules for one pit, and the one with the height frame was not the one setting
its size.

`plantExtent` and `plantLateralExtent` now take the caller's soil test
(`InSoilTest`) and both are called with that same `atOrBelowTheSoil`, defined once
above the sizing so the hole and its walls cannot disagree. A test that rejects
every root falls back to every underground part - a wrong height frame must not
pin the pit at its minimum, which is the rescue the envelope already made.

What this does not change: the seed still anchors the reach (it is the plant's
origin, not soil), and `growthProgress` still gates each node, so a requested-but-
not-drawn root cannot open the pit early.

## 8. The pit's earth, from the palette, 2026-11-23

Two hex sets and a texture stack were painting the dirt. `config/render.json`
carried `soil_dry_color` `#6B5539`, `soil_wet_color` `#2E2418` and a blue
`soil_mineral_tint` `#5A8FA8` for the ground; `config/root_sight.json` carried
`cavity_topsoil_color` `#51402a`, `cavity_subsoil_color` `#80633e` and
`cavity_deep_color` `#625a4d` for the pit wall. Neither was the palette's own soil
ramp, so the ground, the dug wall and the aperture body were three families of
brown, and the shader's ridged crack noise drew dark lines across all of it.

Now both read `config/palette.json` through `worldColour`:

| surface | role | notes |
|---|---|---|
| ground, dry | `soil_mid` (soil.500) | "ground in plain light" |
| ground, damp | `soil_wet` (soil.900) | the moisture mix spans the ramp |
| ground, mineral fleck | `soil_shade` (soil.700) | was a blue that read as metal in the dirt |
| pit lip | `soil_wet` | damp, root-woven topsoil |
| pit wall | `soil_mid` | ochre subsoil |
| pit floor | `soil_shade` | dark earth above the floor |

`cavityPaletteFromWorld` (in `renderers/EnvironmentRenderer.ts`) builds the wall's
three strata, so the palette roles stay in one file the world-palette test scans;
`soil_mid`, `soil_shade` and `soil_wet` joined `WORLD_ROLES`.

Two mappings were tried and are recorded so nobody repeats them. `soil_lit` at the
floor is a *sunlit surface* tone: at that albedo the bowl's own facets and
specular turned the pit floor into polished ceramic (`palette-dirt-inside.png`).
`soil_wet` at the floor is so dark under the day fill that the pit read as a void
with no bottom (`palette-dirt-inside2.png`). `soil_shade` keeps the floor visible
and still darker than the wall (`palette-dirt-inside3.png`).

The dark lines went with two config values: `soil_crack_strength` 0.18 -> 0 and
`soil_pebble_strength` 0.18 -> 0, both still live knobs. The hardcoded grey grit
layer in `shaderOverrides.ts` (`mix(dynamicSoil, uSoilMineralColor * 0.6, stones *
0.22)`) was deleted outright - it was the one speckle nothing could tune. What
remains on the surface is the moisture mix, the clod and patch variation and the
fine grit; the ground now reads as flat palette dirt (`palette-dirt-ground.png`).

The six colour keys were then deleted rather than left as knobs nobody paints
from: `soil_dry_color`, `soil_wet_color` and `soil_mineral_tint` are gone from
`config/render.json`, `cavity_topsoil_color`, `cavity_subsoil_color` and
`cavity_deep_color` from `config/root_sight.json`, along with their interfaces,
input types, parsing and defaults in `clientConfig.ts`. Three more consumers had
to move with them, and each had been reading a colour the palette now owns: the
rock arch (`EnvironmentRenderer`), the wall colour behind the lip, the wet-ground
stain the water field is built with, and the WebGPU renderer's own soil palette,
which had been carrying a second copy of the same hexes as its defaults.
`soil_crack_strength` and `soil_pebble_strength` went too, because the shader
terms they scaled were deleted in the same pass (see Sec. 9) and a strength knob
for a term that no longer exists is the same lie.

`docs/tunables.md`'s counts moved with the files (render 137 -> 132, root_sight
30 -> 27) and the three rows left `docs/tasks/C03.md`'s config table.

## 9. The ground's form, from the palette, 2026-11-23

With the crack and grit layers gone the surface was flat colour plus a
brightness ramp - honest, but it read as painted paper. The relief is now made
of palette steps: clod tops mix toward `soil_lit`, the hollows between clods
toward `soil_shade`, and the damp patches drift toward `soil_wet`. Nothing is a
brighter or darker copy of the same brown, and the two clod mixes cancel over an
area, so the ground's average colour is still `soil_mid`.

Two measurements decided the shape of this term, both from the running page:

- `soilFbm` sums four octaves of 0..1 noise, so its mean is ~0.47 with a swing of
  about +-0.13. Thresholds written as if it spanned 0..1 (tops above 0.52,
  hollows below 0.46) fired on the wrong side of the mean: the tops almost never
  appeared and half the ground darkened at once, which read as one flat brown
  sheet with no clods at all. The signed deviation from the mean is the shape.
- Form outlives grit. Under `detailFade` (which fades from 8 m and by pixel
  footprint) the clods sat at a third of their strength at eye level. They get
  their own gentler footprint fade and a second, coarser scale (0.75 cycles/m
  against 1.6), which is visible at 1.4 m and still soft at 7 m.

At noon, clear weather (`dev_set_time` 0.5 paused, `dev_set_weather` clear, both
through the DEV_ACTION message - as raw `{type: 'dev_set_weather'}` they are
ignored, which is why an earlier pass thought the clock would not move):
`palette-ground-form-day.png` from 7 m up, `palette-ground-form-close-noon3.png`
from 1.4 m. Low-contrast clod relief and damp patches, no cracks, no speckle, no
dark lines.

## 10. The WebGPU path, checked, 2026-11-23

Asked whether the WebGPU path still draws the ground from the palette. It does
not draw the ground at all, and it has not run for a while:

- **No ground pass.** `WebGPURenderer` draws the plant overlay (and rain) on a
  second canvas; the ground, the sky and the pit are the three.js passes, and the
  soil surface is `environment/ground.ts`'s shader - the one these palette
  commits changed. So the palette ground a session sees is the same in a WebGPU
  session and a WebGL one, because it is the same mesh.
- **Its soil palette reaches nothing.** `writeSoilPalette()` fills `soilData`
  from `soil_mid`, `soil_wet` and `soil_shade` and `setSoilMoisture()` rewrites the
  buffer every frame, but no bind group names `soilUniformBuffer` and no shader
  declares its `@binding`. Recorded as **E28**.
- **It could not initialise.** `webgpu_enabled` true failed `initialize()` on two
  WGSL modules: `soilOccludes()` in `common.wgsl` reassigned a `let cavityRadius`
  (WGSL `let` is immutable), and `rain.wgsl` wrote `output.worldPosition` into a
  vertex output with no such member. The fallback to three.js was complete and
  silent. Recorded as **E29**.

All three were then fixed rather than recorded as open. The soil buffer and its
plumbing are deleted (**E28** closed): `soilData`, `soilUniformBuffer`,
`writeSoilPalette()`, `soilMoisture`, `setSoilMoisture()`, the allocation, the
per-frame write and main.ts's per-frame call, along with `writeSrgbTriplet` and
the palette import that only the buffer used. `cavityRadius` is a `var` and the
`output.worldPosition` line is gone (**E29** closed); with `webgpu_enabled` true
the page logs "WebGPU plant renderer initialized" and reports 195 vertices for
the seed.

What let it hide for so long was the smoke test: it checks braces, undefined
functions, bindings and layouts, but it never looked at immutability or at
struct members, so neither fault could fail `pnpm verify`. `shaderSmoke.test.ts`
now has `no let is assigned twice` and `every struct field assignment names a
declared field`, both negative-tested by re-introducing the two faults (the
`let` check fails in all five modules because `common.wgsl` is shared, the
member check in `rain`) and then restoring the fix. They are not a WGSL parser -
there is no GPU in the test runner - but they are exactly the two classes of
breakage that killed this pass.

Two things the first live check found. The palette ground is unchanged, as
expected (`webgpu-requested-palette-ground2.png`, taken while the pass still
fell back). And a rainy frame grew soft grey ellipses a metre or two across,
which were recorded as **E30** and blamed on the rain pass - wrongly. Hiding the
WebGPU canvas left the ellipses in place, and setting the rain pass to zero
instances left them too: they are the three.js weather's wet patches, exactly
the puddles `rainSystem.ts` describes.

The real E30 was worse and simpler. The rain pipeline bound a per-vertex quad
buffer at `@location(0)`/`@location(1)` and the instance buffer at locations 2
and 3, while `rain.wgsl` read `position` and a `vec4f instanceData` from
locations 0 and 1. So `instanceData` was the quad's `w` (always 0), and every
corner of a drop took the same `localOffset` entry - a zero-area quad, no drops
at all, since the first time the module compiled. The fix keeps one vertex
buffer (the instances, at locations 0 and 1), takes the quad corners from
`@builtin(vertex_index)`, gives each drop its own fall clock through
`rain_box_height` (using `fract`, because WGSL has no `mod`) and wraps the copy
of a drop that leaves the 60 m box round to the far side so the shower follows
the eye. The dead quad buffer is deleted. A rainy frame now draws thin streaks
(`webgpu-rain-fixed-4.png`).

Hiding the WebGPU canvas in that rainy frame showed no rain at all, so this is
the only rain pass in the overlay, not a second copy of the three.js one; the
one limit left is that the canvas carries no ground depth, so a drop behind a
hill is not occluded. `webgpu_enabled` stays false in the shipped config.

Driving it turned up three more, all fixed and recorded as E31-E33. The frame
cost a whole joint buffer per frame: `writeJointMatrices()` uploaded all 82 MB
of the `maxPlants` x 64 x 16-float buffer even with one plant on screen, and
`queue.writeBuffer` measured 46 ms of a 65 ms `render()` - 14 fps with the GPU
idle, 60 fps once the write was limited to the plants in frame. The impostor
baker ran a blocking readback every frame whenever no plant was at billboard
tier, because its throttle was stamped only on a bake that baked something (E33).
And the seed slid side to side because wind sway was measured from world Y: on a
planet whose surface is 17 m up, every vertex of a plant hashes to the same
near-maximal sway factor, so the whole mesh - seed included - translated as one
block (E32). Sway is now measured from the bottom of each plant's bounding
sphere, which the cull pass writes into `PlantRenderData` as `baseY`, and
`RENDER_STRIDE` moved 16 -> 20 with it.

The rain itself got its quad: a triangle list cannot make a quad from four
vertices, so `draw(4, count)` had been drawing one triangle per drop since the
pass first compiled - the "white dots or triangles" in the report. Six corners
from a corner table make both triangles, and the colour came down from 0.66-0.91
to 0.45-0.70 grey so a drop near the eye reads as water rather than a white
speck. `shaderSmoke.test.ts` grew three checks to hold all of this: every
`@location` a vertex shader reads against the layout its pipeline declares (with
the old rain layout as the negative case), and the `PlantRenderData` fields
against `RENDER_STRIDE`.

A review of that turn cut one of its own tests: a second stride check asserted on
two arrays of literals written in the test itself, which can never fail. The check
that reads the WGSL struct and the renderer constant stays, because both are the
real data. Two more defects came out of looking at the rain again. Its pipeline
blended with `srcFactor: one` - premultiplied - while the shader wrote straight
alpha, so every drop mixed at full colour and the shower was pure white whatever
the shader chose (E34). And the overlay's only soil occlusion was the analytic
sphere, which sits below the drawn terrain, so rain fell through the hillside and
the seed's buried half was painted over it (E35). Rain now carries the terrain
height under each drop and wraps through the box height above it; plants carry
`groundY` and discard what falls below, except in Root Sight. The rain volume is
placed over the viewer when the instances are built rather than wrapped in the
shader, because a wrap moves a drop off the column its ground was sampled at.
The drops also got an aspect: a width floor of 7% of the streak, a round bead and a
tail that narrows with height, so a drop reads as a droplet instead of a tick, and
anything within 1.8 m of the eye shrinks away instead of covering the screen.
## 11. The rain takes the light, and a buried eye stops seeing through the dirt, 2026-11-23

Asked why the rain was still a hardcoded sky grey and why the seed and the rain
still came through the ground from underground:

- **The colour was the noon sky, forever.** `rain.wgsl` had 0.62-0.96 written
  into the fragment. That is the sRGB value of the sky the three.js drops are
  tinted from at midday, so the shower kept it through sunset and moonlight -
  the same complaint the palette tint was meant to answer. `getRainLight()` now
  hands the WebGPU pass the exact tint and level `RainSystem.setLight()` gets,
  the tint is encoded for a canvas that is not sRGB, and the alpha carries the
  level. Read live: `d1d4d2` / 1.00 at noon, `8d9aaa` / 0.73 at dusk,
  `8c99a9` / 0.79 at night (`rain-day-final`, `rain-dusk-final`,
  `rain-night-final`). At dusk the drops are faint, which is what taking the
  dusk light means; the alternative - a floor bright enough to read at midnight
  - is the white rain again.
- **A buried eye defeated its own occlusion.** `soilOccludes()` returned "not
  occluded" for every ray whose sphere hit fell behind the eye or beyond the
  fragment, which is *every* ray from inside the sphere, so the `cameraUnderSoil`
  test under it never ran and plants drew through the earth (E37). The buried-eye
  check is now first: soil everywhere but the eye's own bubble. Rain is skipped
  entirely while the eye is under soil, as the three.js field does, and a drop
  behind the planet's bulk is collapsed in the vertex shader, which is the
  "rain through the dirt" seen from a distance. A camera parked 3.2 m down
  (`devCavity.hold`) shows earth with no seed and no drops.
- **The reseed was the skip.** 4000 terrain samples and a fresh 80 KB array in
  the frame that crossed the anchor threshold: 5.4 ms, every 24 m walked (E38).
  The field is laid out first and its heights filled 600 drops a frame, then
  uploaded once; the ground error after the refine is 0.000 m. Frame times with
  rain at 4000: p50 16.7 ms, p99 16.9 ms over 9 s of walking, and a 28 s standing
  sample whose only 30 fps stretch matched neither a bake nor a readback - no
  overlay hitches were found, and the dip is recorded rather than explained.

Still open, unchanged: a hill *in front* of a plant or drop needs a ground depth
pass in this canvas (E30), and the three.js weather still draws its own rain
alongside (`rain_threejs_only` was the measurement that settled that). This turn
only made the overlay's copies agree with the light and stand on the ground.


One correction to that, from the other side of the same test. Asked whether a
player standing down inside the pit could still see their plant above the mouth:
the buried-eye check hid it, because it exempted only a bubble around the eye and
the plant stood outside that bubble. The exemption is the open *shaft*, not the
eye: `inRootSightShaft()` tests the plan-view column the soil is cut in, and it
now runs before the buried-eye branch, so anything in that column is air whether
the eye is above it or on the floor of it. The mesh's ground clip takes the same
test, so the plant's buried half is clipped where it stands outside the column
and kept where it stands inside - which is what Root Sight actually opens.
Confirmed with the eye 1.1 m and 1.6 m below the mouth of a 2.8 m pit
(`pit-floor-plant-1`, `pit-floor-plant-2`) and again from the rim
(`pit-above-ground-1`).

One correction to that, from the other side of the same test. Asked whether a
player standing down inside the pit could still see their plant above the mouth:
the buried-eye check hid it, because it exempted only a bubble around the eye and
the plant stood outside that bubble. The exemption is the open *shaft*, not the
eye: `inRootSightShaft()` tests the plan-view column the soil is cut in, and it
now runs before the buried-eye branch, so anything in that column is air whether
the eye is above it or on the floor of it. The mesh's ground clip takes the same
test, so the plant's buried half is clipped where it stands outside the column
and kept where it stands inside - which is what Root Sight actually opens.
Confirmed with the eye 1.1 m and 1.6 m below the mouth of a 2.8 m pit
(`pit-floor-plant-1`, `pit-floor-plant-2`) and again from the rim
(`pit-above-ground-1`).

Then the one thing the overlay could never do: hide a plant behind ground.
Compositing on its own canvas means no depth from the three.js scene, and the
shaft view made that obvious - standing on the pit floor, a seed beyond the rim
was painted over the rim. Asking three.js for its depth buffer is not possible
across the two APIs, so the terrain is handed over instead: a 64-square height
map spanning 200 m, baked from the same `planetTerrainY` the ground is drawn
from, sampled unfiltered with `textureLoad` (a new binding 10 on the plant
layout, no sampler), and marched in eight steps along the eye-to-fragment ray
with half a metre of slack. It fills 512 texels a frame and re-bakes only after
50 m of walking. Measured on a pose 20 m behind a 2.8 m ridge: the seed is
invisible with the map on and visible as a speck on the hillside with it off
(`depth-near-ridge-on`, `depth-near-ridge-off`), and the close seed still draws
(`depth-close-seed`). The bake's first cut compared the viewer against the map's
corner instead of its centre and re-baked every frame - the cursor was at 1536
of 4096 rather than idle, which is how it was caught.

The rain is not marched yet, so drops still draw over a hill; that is the
remaining half of E30 and the next thing to do with this map.
