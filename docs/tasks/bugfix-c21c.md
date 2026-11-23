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
