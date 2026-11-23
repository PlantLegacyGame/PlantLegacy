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
| 13 | A buried eye was surrounded by dirt: the sheet's back faces, the slab's walls and underside, and (newly) the aperture body. The pit could be an arm's length away and the frame was still a brown wall | Every soil fragment is opaque, and being *inside* the earth means every direction is earth. The sheet had a partial answer (bubbles open with the cavity, back faces dropped in the pit) but nothing cut the body around the camera | One **camera-centred near-side cut**: a `SOIL_NEAR_CUT_M = 0.45 m` bubble of soil is dropped around a buried eye, in the soil shader (which the patches, the slab and the ring all share) and in the aperture body's own material (`setApertureSoilEye`, wired per frame from `syncApertureSoil`). Conditional on the eye being under the ground, so the surface view is untouched |

## 2. Config

No new keys. The numbers are code constants with comments:

| Where | Constant | Value | Why |
|---|---|---|---|
| `planetSurface.ts` | `PLANET_BODY_SEGMENTS` | 384 | Halves the facet sag; the skirt is sized from the same number |
| `ground/shaderOverrides.ts` | `SOIL_NEAR_CUT_M` | 0.45 | The near distance of a camera: big enough not to be inside a shaded face, small enough that a stride away is a wall |
| — | bowl columns | 96 (unchanged) | Measured chord sag is 0.5–1.1 mm below a millimetre-and-a-bit; density bought nothing |

## 3. Tests

| Test | What it pins |
|---|---|
| `planetSurface.test.ts` (+2) | The skirt's top edge is `patchLocalSurfaceY` at every vertex (the patch's own edge, to float32); its depth clears the body's facet sag; it winds outward. The body is finer than 256 (sag more than halved) and its own geometry really carries facets |
| `shaderOverrides.test.ts` (+1) | The soil discards a bubble around `uRootSightCamera` only while `eyeIsUnder` **and** only outside the opening's column (`uRootSightEyeInPit < 0.5`), and it is a bubble, not a half-space |
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
- Not checked: the skirt at its own edge (1 240 m away — the geometry and its
  numbers are asserted, no eye was flown there), and the near cut in a grown
  4.9 m pit.
