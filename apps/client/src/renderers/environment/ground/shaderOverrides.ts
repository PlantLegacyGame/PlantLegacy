/**
 * The ground material's shader surgery, out of `ground.ts`.
 *
 * The soil surface is the largest shader in the client: it carries the Root
 * Sight cutaway, the procedural soil, the water-table and river damping, and
 * the terrain lighting. It used to be spliced into the standard material from
 * inside `createGround`, which made that file 774 lines and left the shading
 * edits buried between uniform assignments. These two functions take the stock
 * Three.js shader and return the soil shader; nothing else lives here.
 */
import { CAVITY_CUT_OVERREACH } from '../cavity/profile.ts';

/**
 * Radius of the air bubble the soil drops around a buried eye, in metres.
 *
 * Sized to the camera's own near distance: big enough that the eye is not
 * sitting inside a shaded surface, small enough that a wall a stride away is
 * still a wall. The aperture body uses the same number (`apertureSoilMesh.ts`
 * imports it), so the sheet and the earth under it open the same hole.
 */
export const SOIL_NEAR_CUT_M = 0.45;

export interface SoilShaderSources {
  /** Replaces `#include <fog_pars_fragment>`. */
  prelude: string;
  /** Inserted before `#include <colorspace_fragment>`. */
  apply: string;
}

export function applySoilVertexShader(source: string): string {
  return source
    .replace(
      '#include <common>',
      '#include <common>\nattribute float aSurfaceCut;\nattribute float aFarRelief;\nattribute float aSkirt;\nattribute vec3 aSkirtTop;\nvarying float vSurfaceCut;\nvarying float vFarRelief;\nvarying float vSoilSkirt;\nvarying vec3 vSoilWorldPos;\nvarying vec3 vSoilNormal;',
    )
    .replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvSurfaceCut = aSurfaceCut;\nvFarRelief = aFarRelief;\nvSoilSkirt = aSkirt;\nvec3 soilActualWorld = (modelMatrix * vec4(position, 1.0)).xyz;\nvec3 soilSkirtTopWorld = (modelMatrix * vec4(aSkirtTop, 1.0)).xyz;\nvSoilWorldPos = mix(soilActualWorld, soilSkirtTopWorld, step(0.5, aSkirt));',
    )
    .replace(
      '#include <beginnormal_vertex>',
      '#include <beginnormal_vertex>\nvSoilNormal = normalize(mat3(modelMatrix) * objectNormal);',
    );
}

export function applySoilFragmentShader(source: string, sources: SoilShaderSources): string {
  const { prelude: ATMOSPHERE_FRAGMENT_PRELUDE, apply: ATMOSPHERE_APPLY } = sources;
  return source
    .replace('#include <fog_pars_fragment>', ATMOSPHERE_FRAGMENT_PRELUDE)
    .replace(
      '#include <colorspace_fragment>',
      `${ATMOSPHERE_APPLY}\n#include <colorspace_fragment>`,
    )
    .replace(
      '#include <common>',
      `#include <common>
varying vec3 vSoilWorldPos;
varying vec3 vSoilNormal;
varying float vSurfaceCut;
varying float vFarRelief;
varying float vSoilSkirt;
uniform float uFarReliefCutRadius;
uniform float uRootSightProgress;
uniform vec3 uRootSightCenter;
uniform vec3 uRootSightApertureCenter;
uniform float uRootSightRadius;
uniform float uRootSightApertureRadius;
// Vertical bounds of the cut: the aperture is a volume, not a plan-view disc.
uniform float uRootSightApertureTopY;
uniform float uRootSightApertureBottomY;
uniform vec3 uRootSightWallColor;
uniform vec3 uRootSightCamera;
// 1 while the eye stands buried inside the cavity's own column (R23).
uniform float uRootSightEyeInPit;
// T02 organic envelope: every subterranean root node, fused with a smooth
// minimum so the cut follows the branching root paths instead of one sphere.
uniform vec4 uRootSightNodes[64];
uniform int uRootSightNodeCount;
uniform float uEyeUnderGround;
uniform vec3 uSoilDryColor;
uniform vec3 uSoilWetColor;
uniform vec3 uSoilMineralColor;
uniform float uSoilMoisture;
uniform float uSoilGrainStrength;
uniform float uSoilMineralStrength;
  // Form rather than texture: the palette step a clod top lifts to and the one
  // the hollow between clods falls to, so the relief is of the same earth.
uniform vec3 uSoilClodLiftColor;
uniform vec3 uSoilHollowColor;
uniform vec3 uSoilCoverColor;
// Sun uniforms for ground lighting
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uGroundSkyColor;
uniform float uGroundSkyIntensity;
// Resource grid for per-tile lighting
uniform sampler2D uResourceGrid;
uniform vec2 uResourceGridSize;
uniform float uTileSize;
uniform float uResourceGridAvailable;
uniform vec3 uPlanetCenter;
uniform float uPlanetRadius;
uniform float uPlanetEnabled;
/** Vertical radians per pixel; the eye's real footprint, not the LOD triangle's. */
uniform float uPixelAngle;
// Water table: a height ramp sampled in world XZ. Soil below the table is
// waterlogged, which is what darkens the walls and floor of a pit that holds
// water — the surface stain layer never reaches down there.
uniform sampler2D uWaterTable;
uniform vec2 uWaterTableOrigin;
uniform float uWaterTableCell;
uniform float uWaterTableCells;
uniform vec2 uWaterTableRange;
uniform float uWaterTableAvailable;
uniform float uWaterDampStrength;
uniform float uWaterDampBandM;
// River banks: ground beside a channel is damp from the water it carries. The
// route is baked into a mask, so the band follows the terrain's own valley.
uniform sampler2D uRiverMask;
uniform vec2 uRiverMaskOrigin;
uniform float uRiverMaskSize;
uniform float uRiverMaskAvailable;
uniform float uRiverDampStrength;
// Standing water, as a field rather than a sheet: R = the water's surface height,
// G = how damp the soil is, B = the depth the solver holds. The ground draws the
// water where B says there is water and fades it out at the depth the solver
// itself runs dry, so the shoreline belongs to the pool and not to a polygon.
uniform sampler2D uPuddleField;
uniform vec2 uPuddleOrigin;
uniform float uPuddleCell;
uniform float uPuddleCells;
uniform float uPuddleAvailable;
uniform vec3 uWaterBodyColor;
uniform vec3 uWaterDeepColor;
uniform vec3 uWaterSkyColor;
// The reflection is the sky, not one colour of it: a grazing ray catches the
// bright horizon band, a steep one catches the dark zenith, and that gradient is
// most of what makes a puddle look deep instead of painted.
uniform vec3 uWaterZenithColor;
uniform float uWaterAbsorption;
uniform float uPuddleDamp;
uniform float uWaterTime;
uniform float uRainStrength;
uniform float uSnowCover;

// --- Procedural soil -------------------------------------------------------
// Every grain, clod and stone is generated from world position. There are no
// image textures in this material: the dirt is synthesised from noise so it
// works at any distance on a 100 km planet without tiling or stretching.
float soilHash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float soilNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(soilHash21(i), soilHash21(i + vec2(1.0, 0.0)), f.x),
    mix(soilHash21(i + vec2(0.0, 1.0)), soilHash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float soilFbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += soilNoise(p) * amp;
    p *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

// The same fields in three dimensions, sampled on the surface point itself.
//
// Every 2D unwrap of a sphere folds noise into concentric circles around the
// pole: world xz is the plane through the play area, and arc-by-azimuth is a
// polar map, so both draw rings centred on the one patch a player stands in -
// which is the ring pattern the ground was showing. A field sampled in 3D has
// no pole to fold around and no seam to close.
float soilHash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float soilNoise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(
      mix(soilHash31(i), soilHash31(i + vec3(1.0, 0.0, 0.0)), f.x),
      mix(soilHash31(i + vec3(0.0, 1.0, 0.0)), soilHash31(i + vec3(1.0, 1.0, 0.0)), f.x),
      f.y
    ),
    mix(
      mix(soilHash31(i + vec3(0.0, 0.0, 1.0)), soilHash31(i + vec3(1.0, 0.0, 1.0)), f.x),
      mix(soilHash31(i + vec3(0.0, 1.0, 1.0)), soilHash31(i + vec3(1.0, 1.0, 1.0)), f.x),
      f.y
    ),
    f.z
  );
}

// Three octaves, not four: this runs seven times per fragment, and the fourth
// octave was below the pixel footprint nearly everywhere it was used.
float soilFbm3(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    sum += soilNoise3(p) * amp;
    p *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

// The water field is sampled by hand: a float texture is not filterable without
// an extension (and half-float would quantise a two centimetre puddle into
// visible steps), so four nearest texels are blended here instead.
vec4 soilPuddleSample(vec2 local) {
  vec2 p = local - 0.5;
  vec2 base = floor(p);
  vec2 f = clamp(p - base, 0.0, 1.0);
  vec2 maxIndex = vec2(uPuddleCells - 1.0);
  vec2 texel = vec2(1.0 / uPuddleCells);
  vec2 uv00 = (clamp(base, vec2(0.0), maxIndex) + 0.5) * texel;
  vec2 uv10 = (clamp(base + vec2(1.0, 0.0), vec2(0.0), maxIndex) + 0.5) * texel;
  vec2 uv01 = (clamp(base + vec2(0.0, 1.0), vec2(0.0), maxIndex) + 0.5) * texel;
  vec2 uv11 = (clamp(base + vec2(1.0, 1.0), vec2(0.0), maxIndex) + 0.5) * texel;
  vec4 a = texture2D(uPuddleField, uv00);
  vec4 b = texture2D(uPuddleField, uv10);
  vec4 c = texture2D(uPuddleField, uv01);
  vec4 d = texture2D(uPuddleField, uv11);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Impact rings, matched across cell borders: the pixel looks at the four cells
// around it, so a ring that crosses an edge is drawn whole instead of being cut
// off at the seam of a hash grid. Most cells stay clear this pass - real rain
// lands sparsely, and a ring in every cell reads as a pattern, not as weather.
float soilRainRings(vec2 worldXZ, float t) {
  vec2 cell = worldXZ / 1.15;
  vec2 base = floor(cell);
  float rings = 0.0;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      vec2 index = base + vec2(float(i), float(j));
      float seed = soilHash21(index);
      if (seed > 0.42) continue;
      vec2 centre = index + vec2(soilHash21(index + 31.7), soilHash21(index + 71.3));
      float phase = fract(t * 0.62 + seed * 9.0);
      float radius = phase * 0.36;
      float distanceM = length(cell - centre) * 1.15;
      float ring = smoothstep(0.055, 0.0, abs(distanceM - radius));
      rings = max(rings, ring * (1.0 - phase));
    }
  }
  return rings;
}

// Micro-relief: tilt the normal by the local noise gradient so clods catch the
// light instead of the ground reading as a flat sheet of colour.
vec3 soilBumpNormal(vec3 normal, vec2 uv, float strength) {
  float e = 0.15;
  float dx = soilNoise(uv + vec2(e, 0.0)) - soilNoise(uv - vec2(e, 0.0));
  float dz = soilNoise(uv + vec2(0.0, e)) - soilNoise(uv - vec2(0.0, e));
  return normalize(normal + vec3(dx, 0.0, dz) * strength);
}
`,
    )
    .replace(
      '#include <colorspace_fragment>',
      `#include <colorspace_fragment>
  // T02 Root Sight cutaway: the earth peels back along the subterranean root
  // system. Each underground node contributes an envelope sphere and the whole
  // set is fused with a smooth minimum, so the opening follows branching root
  // paths as one organic cavity instead of a generic flat circle or a
  // camera-facing cone.
  float cutMask = 0.0;
  // The coarse globe is a 1.5 km triangle mesh, so one of its triangles can
  // bridge the play area and draw a brown ceiling over the player. The fine
  // transition ring covers this polar cap; cutting the globe here leaves no
  // hole while removing the overhead sheet. Planet view sets the radius to 0.
  if (vFarRelief > 0.5 && uFarReliefCutRadius > 0.0 && uPlanetEnabled > 0.5) {
    vec3 farRel = vSoilWorldPos - uPlanetCenter;
    float farLen = max(length(farRel), 0.0001);
    float farPolar = acos(clamp(farRel.y / farLen, -1.0, 1.0));
    if (farPolar * uPlanetRadius < uFarReliefCutRadius) discard;
  }

  float envelope = 1e6;
  // Marched interior wall of the bubble, applied after the surface lighting so
  // the dug earth inside stays readable at night instead of going pure black.
  // Is the eye buried? Decides whether this is a surface view or a view from
  // inside the earth, which need completely different shading.
  bool eyeIsUnder = uEyeUnderGround > 0.5;
  // Camera-centred near-side cut (T56/C21-C). An eye under the surface is
  // inside solid earth, and the soil between it and the pit is a brown wall
  // across the whole frame - the slab's walls and underside, or the far side of
  // a hill. Dropping the pit-facing cap of a hand-sized bubble around the eye
  // lets the pit and the roots be seen from wherever the camera ends up, and
  // leaves the earth that was never in the way.
  //
  // Two exemptions, both of them ground the player may be standing on. Above
  // the surface the bubble would eat the soil under their feet. And an eye
  // inside the opening's column is below the sheet but not inside the earth at
  // all: it is standing in the pit, with that pit's wall a stride away, and a
  // bubble there would hole the ground right beside the player.
  //
  // eyeIsUnder is already the renderer's buried flag, which excludes the
  // opening's column, so today the second test changes nothing. It stays
  // because it is the guarantee stated where the discard happens rather than
  // eighty lines away in the renderer that fills the uniform, and because the
  // shader test pins it: a change to what that uniform means cannot quietly
  // reintroduce the hole.
  // Only the earth in the way is cut. A full sphere around the eye also ate the
  // dirt beside and behind it, which is not between the eye and anything: from a
  // shallow orbit that read as a bowl bitten out of the hill around the camera,
  // and it left the near wall of the pit floating in air without the soil that
  // gives it its depth (play-test 2026-11-26: "too much dirt gets cut from the
  // near sides including areas that aren't even blocking the roots"). The cut
  // is now the pit-facing cap of the same bubble: everything from the eye toward
  // the opening goes, and the small crescent behind the eye - which is the eye's
  // own side of the wall, never between it and the roots - stays.
  if (eyeIsUnder && uRootSightEyeInPit < 0.5) {
    vec3 fromEye = vSoilWorldPos - uRootSightCamera;
    float nearLen = length(fromEye);
    vec3 toPit = uRootSightApertureCenter - uRootSightCamera;
    float toPitLen = length(toPit);
    // A hair of slack keeps a fragment level with the eye from being kept on a
    // rounding error; -0.2 is still well behind the eye's shoulder.
    float facing = toPitLen > 1e-3 ? dot(fromEye, toPit) / max(nearLen * toPitLen, 1e-6) : 1.0;
    if (nearLen < ${SOIL_NEAR_CUT_M.toFixed(3)} && facing > -0.2) {
      discard;
    }
  }
  // Both faces. The ground is a double-sided skin, so cutting only the front
  // face left the earth a closed ceiling from underneath: Root Sight's cavity
  // could be seen from outside and from above, and from inside the ground there
  // was no opening at all - the shader still shaded solid dirt over the hole.
  // Only the aperture is cut here; the rim's own shading stays a surface
  // effect (see the earthen lip below), which is what that ring ever was.
  if (vSurfaceCut > 0.5 && uRootSightProgress > 0.01) {
    // Each node supplies its own bubble radius (w), so the cavity is sized by
    // the underground elements themselves rather than one global sphere.
    // The whole bubble is cut, not one camera-facing half: a half-cut bubble
    // put the opening off to one side of the plant and made the cavity slide
    // around as the camera moved. The interior is dirt anyway — the shader
    // marches its far wall — so the full sphere is what reads as a bubble.
    // A fixed fraction of the cavity radius made the fused surface bulge far
    // past the roots; keep the soft blend to a hand-sized fillet instead.
    float sminK = clamp(uRootSightRadius * 0.12, 0.06, 0.32);
    for (int i = 0; i < 64; i++) {
      if (i >= uRootSightNodeCount) break;
      vec4 node = uRootSightNodes[i];
      float nodeRadius = node.w * uRootSightProgress;
      if (nodeRadius < 0.001) continue;
      float d = distance(vSoilWorldPos, node.xyz) - nodeRadius;
      // Polynomial smooth minimum, the same fuse the plant SDF uses.
      float h = clamp(0.5 + 0.5 * (d - envelope) / sminK, 0.0, 1.0);
      envelope = mix(d, envelope, h) - sminK * h * (1.0 - h);
    }
    // Inside the fused envelope the soil is gone; outside it the rim darkens
    // into packed earth so the cavity reads as a dug cavity, not a cut-out.
    float bubbleMask = 1.0 - smoothstep(-sminK * 0.35, sminK * 0.35, envelope);

    // A root bubble can sit wholly below the surface, especially a deep root
    // system or a seed that settled into a divot. Cutting only the bubbles then
    // leaves Root Sight closed from above, so the view has to be lowered until
    // the camera itself is underground. This aperture is cut in the terrain
    // surface around the seed, in plan view: every fragment keeps its own
    // terrain height, so the visible lip follows slopes and dips instead of
    // being a horizontal disc. The cavity bowl sits underneath it.
    // One radius, owned by the client and handed to both this shader and the
    // bowl. It used to be recomputed here with a hard 1.8 m cap while the bowl
    // used the full cutaway radius: a 1.8 m hole over a 4.9 m mouth left the
    // bowl's buried rim crossing the sightline through the opening, which is
    // what painted dirt across the hole from some angles.
    // The bowl's rim ring is built out to exactly this width, so the soil's edge
    // and the lip share one boundary: the cut cannot leave a ring of lip poking
    // through intact soil, and cannot leave an uncovered annulus beside it.
    const float ROOT_SIGHT_CUT_OVERREACH = ${CAVITY_CUT_OVERREACH};
    float apertureRadius = max(0.05, uRootSightApertureRadius) * ROOT_SIGHT_CUT_OVERREACH;
    // Open with the transition. The bowl is scaled by the same progress; a
    // full-size aperture over a half-size bowl leaves a void ring around the
    // opening for the first frames.
    apertureRadius *= clamp(uRootSightProgress, 0.0, 1.0);
    float apertureDist = distance(vSoilWorldPos.xz, uRootSightApertureCenter.xz);
    // The cut is a volume, not a plan-view disc: the mouth's plan radius, from
    // the highest ground under it down to the cavity floor. With no vertical
    // bound this discarded a horizontal core through a hillside (the surface
    // there spans metres of relief) and, on the planet sphere, ground at the
    // same X/Z on the far side of the world.
    bool insideColumn =
      vSoilWorldPos.y <= uRootSightApertureTopY &&
      vSoilWorldPos.y >= uRootSightApertureBottomY;
    // One screen pixel of ramp, measured in derivatives rather than in metres:
    // the opening's edge is exactly as soft as the sampling grid needs and no
    // wider, so a seedling's pit is not eaten by a band sized for a root cavity
    // and a big one does not get a stair-stepped lip. Alpha-to-coverage resolves
    // that ramp into a smooth edge.
    float edge = max(fwidth(apertureDist), 1e-5);
    float outside = smoothstep(apertureRadius - edge, apertureRadius + edge, apertureDist);
    float apertureMask = insideColumn ? (1.0 - outside) : 0.0;
    // Above ground the aperture is the only hole in the surface: cutting the
    // root bubbles there too opened sky outside the bowl whenever a bubble
    // reached past the bowl mouth, and the bowl is real geometry that already
    // exposes the roots.
    cutMask = apertureMask;
    // From inside the earth it is the other way round. The soil skin is on every
    // side of a buried eye, so the bubble envelope itself has to be air: without
    // this the eye sat inside a brown shell and the only thing in the pit was
    // its far wall. The bubble set is confined to the bowl mouth above the
    // surface, so this cannot open sky outside the opening.
    if (eyeIsUnder) {
      cutMask = max(cutMask, bubbleMask);
    }
  }

  // From inside the pit, the ground beyond the rim is seen from *underneath*:
  // the eye is below the sheet, so every fragment of that ground it faces is a
  // back face. There is no dirt there to draw - the earth is solid under the
  // pit, and the only opening is the mouth - so what reaches the screen is a
  // wall of soil across the whole frame at lip height, with the pit's sky cut
  // off behind it. The top of the ground cannot be seen from below it, so only
  // the underside is dropped; a buried eye anywhere else is inside the dirt and
  // keeps its enclosure.
  if (uRootSightEyeInPit > 0.5 && !gl_FrontFacing && vSoilWorldPos.y > uRootSightCamera.y) {
    discard;
  }

  // Surface coordinates: metres of arc from the planet's pole, in the azimuth
  // direction. On a flat world this is just the world x/z; on the planet it is
  // what keeps tiles square and evenly spaced all the way around the body.
  vec2 soilSurface = vSoilWorldPos.xz;
  if (uPlanetEnabled > 0.5) {
    vec3 rel = vSoilWorldPos - uPlanetCenter;
    float len = max(length(rel), 0.0001);
    float polar = acos(clamp(rel.y / len, -1.0, 1.0));
    float azimuth = atan(rel.z, rel.x);
    float arc = polar * uPlanetRadius;
    soilSurface = vec2(cos(azimuth), sin(azimuth)) * arc;
  }

  // What the noise is sampled on: the surface point in metres, on the body's
  // own sphere. Everything that used a 2D unwrap above drew rings around the
  // pole, which is the play area - so the grain, the clods, the damp patches,
  // the cover and the provinces all run on this instead.
  vec3 soilField = vSoilWorldPos;
  if (uPlanetEnabled > 0.5) {
    soilField = normalize(vSoilWorldPos - uPlanetCenter) * uPlanetRadius;
  }
  // The water-table and standing-water grids are solved in a square around the
  // player, and their wet-soil tint moves with that square. From the air that
  // reads as a dark patch sliding across the land - the LOD-shaped shading the
  // player keeps seeing. Their water surfaces still belong to the pools; the
  // soil dampness is a near-ground cue and is faded out once the eye is high
  // enough that the whole solve sits inside a few pixels.
  float eyeAltitudeM = uPlanetEnabled > 0.5
    ? max(0.0, length(cameraPosition - uPlanetCenter) - uPlanetRadius)
    : max(0.0, cameraPosition.y);
  float localFieldFade = 1.0 - smoothstep(45.0, 110.0, eyeAltitudeM);

  // C03: Soil moisture darkening. The old per-pixel hash read as grain sitting
  // on top of the dirt; the Root Sight dome shows the smooth colour the ground
  // should have, so the grain and mineral tint are config strengths now.
  vec3 dynamicSoil = mix(uSoilDryColor, uSoilWetColor, clamp(uSoilMoisture, 0.0, 1.0));
  float mineralNoise = fract(sin(dot(soilSurface, vec2(12.9898, 78.233))) * 43758.5453);
  dynamicSoil = mix(dynamicSoil, uSoilMineralColor, mineralNoise * uSoilGrainStrength);

  // Sample resource grid for per-tile lighting (with fallback)
  float tileLight = 1.0;
  float tileMoisture = uSoilMoisture;
  float tileMinerals = 0.0;

  if (uResourceGridAvailable > 0.5) {
    // Blend the four surrounding tile centres instead of reading one texel.
    // A single texel is one simulation tile, so the whole tile took that tile's
    // moisture and light: the land became a grid of evenly spaced squares of
    // slightly different brown, which is exactly what the player saw as random
    // patches spaced at regular intervals. Blending makes the grid a gradient.
    vec2 cell = soilSurface / uTileSize;
    vec2 base = floor(cell);
    vec2 f = smoothstep(vec2(0.0), vec2(1.0), cell - base);
    vec2 texel = (base + 0.5 + uResourceGridSize * 0.5) / uResourceGridSize;
    float step1 = 1.0 / uResourceGridSize.x;
    vec4 r00 = texture2D(uResourceGrid, texel);
    vec4 r10 = texture2D(uResourceGrid, texel + vec2(step1, 0.0));
    vec4 r01 = texture2D(uResourceGrid, texel + vec2(0.0, step1));
    vec4 r11 = texture2D(uResourceGrid, texel + vec2(step1, step1));
    vec4 resourceData = mix(mix(r00, r10, f.x), mix(r01, r11, f.x), f.y);
    tileLight = resourceData.r;
    tileMoisture = resourceData.g;
    tileMinerals = resourceData.b;
  }

  // Soil colour comes from the physical state (dry/wet/mineral) and then from
  // three scales of structure: metre-scale clods, several-metre damp patches,
  // and millimetre grit, plus sparse buried stones.
  // Tile moisture is a hint, not the colour. Taken at face value it repainted
  // whole tiles dry or wet, so the ground read as tiles rather than soil; the
  // global moisture keeps the shading smooth and the tile data only nudges it.
  // Colour comes from the global moisture alone. The per-tile grid arrives with
  // every resource sync - a couple of seconds - and tinting the soil with it made
  // the ground shift in stripes at that cadence: fine noise re-quantised by a
  // slowly changing texture reads as banding that appears and vanishes all over
  // the surface. The grid is gameplay data and no longer touches soil colour.
  float blendedMoisture = clamp(uSoilMoisture, 0.0, 1.0);
  dynamicSoil = mix(uSoilDryColor, uSoilWetColor, blendedMoisture);

  // Detail is sampled in world metres, not in arc-length coordinates: the arc
  // coordinate runs to ~157 km on the 100 km planet, and float precision there
  // turned the noise into aliased mush that shaded almost black.
  // Sampled on the surface, not through the plane at the pole.
  //
  // World xz is a flat projection: on a sphere the noise field it produces
  // folds into concentric rings centred on the pole - the player's own area,
  // which is exactly where they were reported - and the same flat lookup once
  // put a lattice of squares on the sea. Arc and azimuth are the surface's own
  // coordinates, so the grain, the clods and the bump run along the ground.
  vec3 soilDetail = soilField;
  // Detail has a range. The grain is sampled at 12-24 cycles per metre, which a
  // pixel a few metres away cannot resolve: the near-vertical noise aliased into
  // evenly spaced moire stripes across the whole valley, which is what read as
  // "colour changing bands" running over the land. Fading the fine octaves out
  // with distance leaves flat soil far away and texture under the player's feet.
  // Faded by what a pixel covers, not by how far the eye is. The old distance
  // gate (8 m to 34 m) meant that any eye above the clods - a planet-view eye at
  // sixty metres, the developer camera, a player who zoomed out - saw soil with
  // no grain, no clods and no bump shading at all, which is why a close-up of
  // the far side read as flat orange paint.
  // Macro relief shading. The terrain's small detail fades out within a hundred
  // metres, and a high noon sun leaves the broad hills almost the same tone as
  // the flats: from a kilometre up the world read as one flat orange sheet.
  // Height and slope are the two cues that survive every distance, so they are
  // applied before the detail and are not multiplied by its fade. Height is the
  // radial distance above the mean sphere, not world y: on a 100 km planet the
  // same world height occurs on every latitude.
  float elevationM = vSoilWorldPos.y;
  if (uPlanetEnabled > 0.5) {
    elevationM = length(vSoilWorldPos - uPlanetCenter) - uPlanetRadius;
  }
  float hillShade = smoothstep(
    -70.0,
    260.0,
    elevationM + soilFbm3(soilField * 0.0015 + vec3(4.7, 19.1, 2.3)) * 55.0
  );
  dynamicSoil *= mix(0.62, 1.08, hillShade);
  float macroUpness = clamp(abs(vSoilNormal.y), 0.0, 1.0);
  dynamicSoil *= mix(0.62, 1.0, smoothstep(0.34, 0.97, macroUpness));

  float detailFade = 1.0;
  // Distance is only one axis of the same problem. At grazing incidence a pixel
  // a few metres away still covers metres of surface, and the fine octaves then
  // band into stripes running across the slope - the striping a player sees when
  // the eye drops to the ground. The pixel footprint says how much surface one
  // pixel spans, so detail finer than that fades out whatever the distance.
  //
  // It must be measured from the eye, never from derivatives of the interpolated
  // world position. fwidth(vSoilWorldPos) is the triangle's own size: it jumps by
  // a factor of two at every LOD boundary, so the detail fade changed there and
  // painted the quadtree's squares into the soil. The derivative knew about the
  // mesh, not about the surface the mesh was standing in for.
  vec3 eyeToSoil = cameraPosition - vSoilWorldPos;
  float eyeDistance = max(0.001, length(eyeToSoil));
  float eyeCosine = max(abs(dot(eyeToSoil / eyeDistance, vSoilNormal)), 0.12);
  float footprint = max(0.001, (eyeDistance * uPixelAngle) / eyeCosine);
  detailFade *= 1.0 - smoothstep(0.03, 0.35, footprint);
  float clods = soilFbm3(soilDetail * 1.6);
  float patches = soilFbm3(soilDetail * 0.22 + 11.7);
  float grit = soilNoise3(soilDetail * 12.0);
  // Form, not texture. A multiplier used to lighten and darken the one brown,
  // which reads as a shaded sheet; the clods are palette steps instead - their
  // tops lift toward soil_lit, the hollows between them sink toward soil_shade -
  // so the ground's surface is made of the ground's own earth.
  //
  // Two things to keep in mind when tuning this. soilFbm sums four octaves of
  // 0..1 noise, so its mean is ~0.47 and its swing is about +-0.13: thresholds
  // picked as if it spanned 0..1 left the clods invisible above the mean and
  // darkened everything below it. The deviation from the mean is the shape,
  // signed, so tops and hollows are equal halves of one relief and the average
  // colour does not move. And form outlives grit - a clod is half a metre
  // across, so it still reads where the millimetre octaves have blurred - so it
  // gets a gentler footprint fade and a second, coarser scale.
  float clodFade = 1.0 - smoothstep(0.2, 0.7, footprint);
  float clodsBig = soilFbm3(soilDetail * 0.75 + 5.3);
  float clodStep = clamp((mix(clodsBig, clods, 0.5) - 0.47) * 4.0, -1.0, 1.0) * clodFade;
  dynamicSoil = mix(dynamicSoil, uSoilClodLiftColor, max(clodStep, 0.0) * 0.42);
  dynamicSoil = mix(dynamicSoil, uSoilHollowColor, max(-clodStep, 0.0) * 0.36);
  // Small stones and hard crumbs, at the one scale between a clod and a grain.
  // Sparse, not a uniform speckle: most of the surface is still soil. The mask
  // uses the same footprint fade as the clods, so it is a close-up detail only
  // and disappears before it can alias into a fine checker at distance.
  float pebble = soilNoise3(soilDetail * 7.0 + vec3(23.1, 5.7, 41.3));
  float pebbleFade = 1.0 - smoothstep(0.12, 0.8, footprint);
  float pebbleMask = smoothstep(0.77, 0.9, pebble) * pebbleFade;
  dynamicSoil = mix(dynamicSoil, uSoilHollowColor, pebbleMask * 0.32);
  dynamicSoil = mix(
    dynamicSoil,
    uSoilClodLiftColor,
    smoothstep(0.9, 0.97, pebble) * pebbleFade * 0.34
  );
  // Damp patches drift toward the wet step rather than being brightened: damper
  // soil is darker and browner, which is exactly what soil_wet is. They are
  // metres across, so they keep their own, much longer fade.
  float patchFade = 1.0 - smoothstep(20.0, 90.0, distance(cameraPosition, vSoilWorldPos));
  float dampPatch = clamp((patches - 0.47) * 3.5, -1.0, 1.0);
  dynamicSoil = mix(dynamicSoil, uSoilWetColor, max(dampPatch, 0.0) * 0.16 * patchFade);
  dynamicSoil *= 0.97 + 0.06 * mix(0.5, grit, detailFade);

  // Dry provinces, at the one scale the clods and the damp patches cannot
  // reach. Every other structure here fades by about 90 m - a clod is half a
  // metre and a damp patch is metres - so past that the plain was one flat brown
  // right out to where it met the sky. These are hundreds of metres to
  // kilometres across, so they survive to the horizon and to orbit. They are a
  // paler, wind-winnowed earth on the crowns of the broad rises, not plant
  // cover: the world has no vegetation yet.
  float coverNoise = soilFbm3(soilField * 0.0028 + vec3(31.4, 8.9, 12.2));
  float coverMask = smoothstep(0.44, 0.63, coverNoise);
  // Steep ground sheds the pale crust and shows the packed earth beneath, so a
  // hill's face stays the darker brown. The normal's up-component is the slope.
  coverMask *= mix(0.35, 1.0, smoothstep(0.55, 0.9, abs(vSoilNormal.y)));
  dynamicSoil = mix(dynamicSoil, uSoilClodLiftColor, coverMask * 0.14);
  // The dry provinces are deliberately gentle: they are a change of soil, not a
  // second palette fighting the first, and 0.14 keeps them a tone apart.
  float province = soilFbm3(soilField * 0.00055 + vec3(71.3, 17.2, 5.1));
  dynamicSoil = mix(dynamicSoil, uSoilClodLiftColor, smoothstep(0.5, 0.72, province) * 0.14);

  // Bedding and erosion (AG 3.2.6). Sediment is laid in near-horizontal layers,
  // so a cut through it shows bands that follow the contours - which is why this
  // is keyed to world height and not to a texture. Two things keep it from
  // reading as a contour map: it is only drawn on exposed slopes, and the band
  // height is warped by noise so no layer is perfectly flat.
  float slopeCut = 1.0 - smoothstep(0.55, 0.95, abs(vSoilNormal.y));
  float strataPhase = vSoilWorldPos.y * 0.21 + soilFbm3(soilDetail * 0.05) * 2.2;
  float strataSeam = smoothstep(0.3, 0.5, abs(fract(strataPhase) - 0.5));
  // A band 4.8 m apart is still finer than a pixel at 300 m; it fades with the
  // footprint like every other detail, and never reaches more than a step of the
  // palette because rock and dirt here are the same earth.
  float strataFade = (1.0 - smoothstep(0.25, 1.2, footprint)) * patchFade;
  dynamicSoil *= mix(1.0, 0.8, strataSeam * slopeCut * strataFade * 0.65);
  // Erosion: water leaves channels down a slope, so the darkening is stretched
  // along the fall line rather than being round blobs.
  float gully = 1.0 - smoothstep(0.0, 0.075, abs(soilFbm3(soilDetail * 0.085 + vec3(13.1, 7.7, 4.3)) - 0.47));
  dynamicSoil *= mix(1.0, 0.84, gully * slopeCut * patchFade * 0.55);

  dynamicSoil = mix(dynamicSoil, uSoilMineralColor, mineralNoise * uSoilGrainStrength + tileMinerals * uSoilMineralStrength);

  // Soil the water table touches is waterlogged and darker: below the table it
  // is under the surface, just above it capillary rise keeps it damp. This is
  // what makes the inside of a flooded pit look soaked instead of dry, and it
  // works on the cavity walls because it is a world-space lookup.
  if (uWaterTableAvailable > 0.5) {
    float tableExtent = max(0.001, uWaterTableCell * uWaterTableCells);
    vec2 tableLocal = (vSoilWorldPos.xz - uWaterTableOrigin) / tableExtent;
    if (tableLocal.x >= 0.0 && tableLocal.x <= 1.0 && tableLocal.y >= 0.0 && tableLocal.y <= 1.0) {
      float tableY =
        uWaterTableRange.x + texture2D(uWaterTable, tableLocal).r * uWaterTableRange.y;
      float depthBelow = tableY - vSoilWorldPos.y;
      float submerged = smoothstep(0.0, 0.3, depthBelow);
      float dampBand = smoothstep(-uWaterDampBandM, 0.0, depthBelow) * 0.6;
      // The field is a square that follows the player. Damp soil has no rim, so
      // fade the solve out radially before the texture's own border. Without
      // this the whole fine-LOD patch sat inside a darker square, visible from
      // a hundred metres as an LOD tile.
      vec2 tableOffset = vSoilWorldPos.xz - (uWaterTableOrigin + vec2(tableExtent * 0.5));
      float tableFade = 1.0 - smoothstep(tableExtent * 0.34, tableExtent * 0.49, length(tableOffset));
      float wet = max(submerged, dampBand) * tableFade * localFieldFade;
      dynamicSoil *= mix(1.0, 1.0 - uWaterDampStrength, wet);
    }
  }

  if (uRiverMaskAvailable > 0.5) {
    vec2 riverUV = (vSoilWorldPos.xz - uRiverMaskOrigin) / max(1.0, uRiverMaskSize);
    if (riverUV.x >= 0.0 && riverUV.x <= 1.0 && riverUV.y >= 0.0 && riverUV.y <= 1.0) {
      float wetBank = texture2D(uRiverMask, riverUV).g;
      dynamicSoil *= mix(1.0, 1.0 - uRiverDampStrength, wetBank);
    }
  }

  // Apply lighting to ground (use existing normal from standard material)
  vec3 macroNormal = normalize(vSoilNormal);
  // A chunk's skirt is a wall under a seam, not a real face. Its vertices carry
  // the top edge's upward normal and no back-face darkening, so a sliver seen
  // through an LOD crack takes the colour of the ground above it instead of
  // drawing a dark line across the planet.
  if (!gl_FrontFacing && vSoilSkirt < 0.5) macroNormal = -macroNormal;
  // Clod-scale relief, strongest on bare soil: this is what makes the surface
  // read as loose dirt rather than a coloured plane.
  vec3 groundNormal = soilBumpNormal(macroNormal, vSoilWorldPos.xz * 3.2, 1.25 * detailFade);
  // A finer bump layer on top of the clod relief, so the surface has a second
  // scale of looseness underfoot.
  groundNormal = soilBumpNormal(groundNormal, vSoilWorldPos.xz * 9.0, 0.42 * detailFade);
  // And a third, grain-sized layer. The footprint fade is what keeps it from
  // turning into moire at range; at arm's length it is the difference between
  // packed earth and a painted plane.
  groundNormal = soilBumpNormal(groundNormal, vSoilWorldPos.xz * 19.0, 0.22 * detailFade);
  // uSunDir points FROM the ground TOWARD the sun, so use it directly.
  float NdotL = max(dot(groundNormal, normalize(uSunDir)), 0.0);
  // Which way is up *here*.
  //
  // This shader was written for one flat plot: macroNormal.y was the sky-facing
  // weight and the ambient was the eye's own sky colour. Both are the pole's
  // answer, and on a body a hundred kilometres across the far side has its own
  // up and its own day: with the sun overhead there the shader still read the
  // eye's night sky (0.03) as its only fill and lit the ground by a normal that
  // pointed sideways, so the far side came out black. Up is now the direction
  // from the body's centre, and the ambient is chosen by the sun's elevation at
  // this point rather than by the colour of the sky above the camera.
  vec3 planetUp =
    uPlanetEnabled > 0.5
      ? normalize(vSoilWorldPos - uPlanetCenter)
      : vec3(0.0, 1.0, 0.0);
  float upness = clamp(dot(macroNormal, planetUp), 0.0, 1.0);
  float sunElevation = dot(planetUp, normalize(uSunDir));
  float daylight = smoothstep(-0.16, 0.16, sunElevation);
  // Sky fill and the hill-shading curve use the macro normal, not the bump
  // normal: the bump is deliberately mostly vertical, so using it here erased
  // every slope and left the terrain looking flat no matter how it was lit.
  vec3 nightFill = uGroundSkyColor * uGroundSkyIntensity;
  vec3 dayFill = uSunColor * uGroundSkyIntensity * 2.4 + nightFill;
  vec3 skyFill = mix(nightFill, dayFill, daylight) * (0.35 + 0.65 * upness);
  // Existing relief is gentle (a metre over ten), so plain Lambert barely
  // separates a slope from the flat. A steep power curve on the up component
  // makes those small normal changes read as hills without moving geometry.
  // A steep power curve on the up component drew contour lines. The terrain's
  // normals change by a percent or two across a hillside, and x^24 turned that
  // into 20% steps of brightness, so every 2% slope band came out as a stripe
  // following the terrain's contours - the "colour changing bands". x^3 keeps
  // the hill shading and removes the quantisation.
  float slopeLight = mix(0.88, 1.06, pow(upness, 3.0));
  vec3 lightColor = (uSunColor * uSunIntensity * NdotL + skyFill) * slopeLight;


  // Output in the renderer's color space. The soil/sun uniforms are linear
  // (Three.js converts colors on upload), so convert back to sRGB here instead
  // of writing linear values directly, which rendered the ground near-black.
  // Earthen rim: soil just outside the cavity fades into the exact colour of
  // the cavity wall, so the opening blends instead of ending on a hard edge.
  // Root Sight is drawn as a cavity in the same surface, not as a hole plus a
  // separate sphere. The soil inside the bubble is shaded as the dug interior —
  // darkest at the bubble centre, easing back into surface soil at the rim — so
  // the opening, the dirt behind it and the edge all come from one surface and
  // nothing can leak sky or a second ground layer.
  if (vSurfaceCut > 0.5 && uRootSightProgress > 0.01) {
    // The earthen rim belongs to the surface view. Seen from under the soil it
    // drew a bright ring around the opening, which is half of what made the cut
    // read as a lit dome instead of a hole.
    // A narrow earthen lip at the cut, not a band across the whole cavity.
    // The old version tinted everything within 0.6 of the cavity radius towards
    // the wall colour, which painted a dark ring on the surface far from the
    // hole; from underground that ring is the thin crescent the player saw.
    // Recomputed here rather than reusing the values from the cut block above:
    // those are scoped inside their own if-block, and referring to them out
    // here is a shader compile error - which took the whole terrain down.
    float lipRadius = max(0.05, uRootSightApertureRadius) * clamp(uRootSightProgress, 0.0, 1.0);
    float lipDist = distance(vSoilWorldPos.xz, uRootSightApertureCenter.xz);
    float lip = 1.0 - smoothstep(lipRadius, lipRadius * 1.35, lipDist);
    dynamicSoil = mix(dynamicSoil, uRootSightWallColor, lip * (eyeIsUnder ? 0.0 : 0.55));

    // A second camera-to-root corridor used to be cut through this same surface.
    // Because the ground is a skin, that corridor exposed the sky behind it and
    // appeared as gaps between the surface and the bowl. The aperture (backed by
    // the solid bowl) is now the only opening; side views see dirt, and the sky
    // is visible only by looking up through the aperture.
    float cavityMask = cutMask;
    // The opening is a hole, and the earth inside it is real geometry (the
    // cavity bowl), so the surface has nothing left to shade here: it simply
    // stops. Faking the inside in this shader is what produced the dome, the
    // flat disc and every other angle-dependent artefact.
    // The hole is coverage, not colour: the mask goes out as alpha and the
    // multisampled buffer decides the edge. Deep inside the mask is 1 and the
    // fragment is dropped outright; outside it is 0 and the soil is untouched.
    gl_FragColor.a = min(gl_FragColor.a, 1.0 - cavityMask);
    if (gl_FragColor.a < 0.01) discard;
  }

  // The bubble interior keeps its own lighting; only the surface soil is
  // multiplied by the scene light.
  vec3 finalSoil = dynamicSoil * (0.35 + 0.65 * lightColor);
  // Standing water and snow are properties of this ground, not sheets laid over
  // it. Both come from the same field, and the shore is where the field's own
  // depth runs out, so no polygon edge, lift or depth bias can cut a pool into a
  // shard.
  if (uPuddleAvailable > 0.5 && gl_FrontFacing && !eyeIsUnder) {
    vec2 puddleLocal = (vSoilWorldPos.xz - uPuddleOrigin) / uPuddleCell;
    // The field is a square that follows the player. Water has no rim, so the
    // solve fades out on a wide radial margin well inside the texture border.
    // A six-cell border was still a straight line across a hundred-metre view.
    float puddleRadius = uPuddleCells * 0.5;
    vec2 puddleOffset = puddleLocal - vec2(puddleRadius);
    float fieldFade = 1.0 - smoothstep(puddleRadius * 0.72, puddleRadius * 0.97, length(puddleOffset));
    if (fieldFade > 0.002) {
      // Domain warp: the field is sampled slightly off its own grid, so the
      // shoreline bends inside the cells instead of stepping along them. Warping
      // the sample point cannot invent water the way a depth offset can, because
      // every value still comes from a real cell of the solver.
      vec2 warp =
        (vec2(
          soilNoise(vSoilWorldPos.xz * 2.3),
          soilNoise(vSoilWorldPos.xz * 2.9 + vec2(17.0, 3.0))
        ) - 0.5) *
        0.6;
      vec4 puddle = soilPuddleSample(
        clamp(puddleLocal + warp, vec2(0.0), vec2(uPuddleCells))
      );
      // The solver's own depth, not "surface height minus this fragment's height".
      // The drawn terrain is a coarser triangle mesh than the field's grid, so in
      // a hollow the mesh can sit a hand's width *above* the analytic surface:
      // comparing the two hid whole pools, while on a ridge it invented water on
      // dry ground. The field already knows how deep the water is; the shoreline
      // is where that depth runs out.
      float waterDepth = puddle.b;
      // A grid cell is two thirds of a metre, so a shoreline taken straight from
      // the field steps from dry to deep inside one cell and reads as a cut-out
      // tile. The warped sample above bends it; a small depth ripple breaks what
      // is left into a line the eye reads as a waterline.
      float edge = waterDepth + (soilNoise(vSoilWorldPos.xz * 11.0) - 0.5) * 0.003;
      // Damp soil is darker soil, not painted water: it is the shoreline, and it
      // is what stays after the pool has drained. It inherits the same wobble so
      // the wet margin and the water agree about where the shore is.
      float dampness = smoothstep(0.05, 0.7, clamp(puddle.g, 0.0, 1.0));
      dampness *= uPuddleDamp * fieldFade * localFieldFade;
      finalSoil *= mix(1.0, 0.52, dampness);
      // A sheet of water is only worth drawing once it is deep enough to hold a
      // reflection: below half a centimetre it is a wet film, and the damp stain
      // below already draws that without turning the whole field into a lake.
      float cover = smoothstep(0.004, 0.03, edge);
      if (cover > 0.001) {
        if (uSnowCover > 0.5) {
          // A drift is white where it is deep and grey-blue where it thins, which
          // is what makes an edge of snow look soft rather than stamped.
          vec3 snowColour = mix(vec3(0.78, 0.82, 0.9), vec3(1.0), clamp(waterDepth * 9.0, 0.0, 1.0));
          snowColour *= 0.3 + 0.7 * clamp(lightColor, 0.0, 1.4);
          finalSoil = mix(finalSoil, snowColour, cover * fieldFade * localFieldFade * 0.94);
        } else {
          vec3 view = normalize(cameraPosition - vSoilWorldPos);
          // Water lies level: its normal starts straight up and only the wind
          // and the rain tilt it. Taking the soil normal as the base made every
          // pool on a bank look like it followed the tilt of the bank.
          float t = uWaterTime;
          float r1 = soilNoise(vSoilWorldPos.xz * 1.9 + vec2(t * 0.30, -t * 0.11));
          float r2 = soilNoise(vSoilWorldPos.xz * 4.3 + vec2(-t * 0.19, t * 0.24));
          float r3 = soilNoise(vSoilWorldPos.xz * 8.9 + vec2(t * 0.62, t * 0.41));
          vec3 rippleNormal = normalize(vec3(
            (r1 - 0.5) * 0.22 + (r3 - 0.5) * 0.10,
            1.0,
            (r2 - 0.5) * 0.22 + (r3 - 0.5) * 0.10
          ));
          // Rings brighten the surface where a drop has just landed; the dark
          // pit in the middle of the ring is what makes it read as a dimple.
          float rings = soilRainRings(vSoilWorldPos.xz, t) * uRainStrength;
          float ndv = clamp(dot(rippleNormal, view), 0.0, 1.0);
          // How much water the eye ray crosses: shallow water shows the soil,
          // deep water has already eaten its red.
          float path = waterDepth / max(0.25, ndv);
          vec3 absorb = exp(-path * uWaterAbsorption * vec3(1.7, 0.85, 0.65));
          // The body colour is a material, so it is lit like one: an unlit teal
          // add made every pool glow at midnight.
          vec3 body =
            mix(uWaterBodyColor, uWaterDeepColor, smoothstep(0.0, 0.3, waterDepth)) *
            (0.3 + 0.7 * clamp(lightColor, 0.0, 1.4));
          // A six-centimetre pool is almost transparent water, so a physically
          // exact mix is a damp stain. A base tint of the body colour, growing
          // with absorption, is what makes the shallow pool read as water while
          // the soil still shows through it.
          // A shallow film over bright soil is mostly soil, and that is what
          // broke the pools into pale cyan islands. Keep the water body dominant
          // while the depth still controls how much bottom colour comes through.
          float murk = 0.78 + 0.15 * (1.0 - absorb.g);
          vec3 seen = mix(finalSoil, body, murk);
          // Fresnel: the sky is in the water at grazing angles and the bottom is
          // in it underfoot, which is the whole difference between a puddle and a
          // blue stain.
          // Water reflects far less than a mirror even at a grazing angle; the
          // old 0.98 turned every pool at eye level into a white sheet.
          // Two parts: the physical Fresnel curve, and a broad sheen that keeps a
          // pool visibly wet when it is looked at from above. Without the sheen a
          // six-centimetre pool is 2% reflection over soil, i.e. a damp stain.
          float fresnel = 0.015 + 0.10 * pow(1.0 - ndv, 5.0) + 0.01;
          // A puddle reflects the water's own body, not the near-white horizon.
          // Sampling the sky hemisphere here broke into pale islands wherever
          // the ripple normal caught it. The Fresnel term still moves the sheen,
          // but the colour stays water.
          vec3 sky = mix(uWaterBodyColor, uWaterDeepColor, 0.22);
          sky += mix(uWaterSkyColor, uWaterZenithColor, 0.25) * 0.03;
          sky *= 0.55 + 0.35 * clamp(lightColor, 0.0, 1.4);
          vec3 waterColour = mix(seen, sky, fresnel);
          vec3 halfDir = normalize(normalize(uSunDir) + view);
          waterColour +=
            uSunColor * uSunIntensity * pow(max(dot(rippleNormal, halfDir), 0.0), 320.0) *
            (0.25 + fresnel) * 0.18;
          // Rings are a hint of the drop that made them: a white cap on every ring
          // read as litter floating on the pool.
          waterColour = mix(waterColour, sky * 1.1, rings * 0.05 * (1.0 - fresnel));
          waterColour *= 1.0 - rings * 0.03;
          // Shallow water is aerated film, not a cut edge. It is mixed, never
          // painted on as a rim: a bright outline around a pool is the sticker
          // again, and the wobbled edge already softens the boundary.
          float shore = 1.0 - smoothstep(0.0, 0.045, edge);
          waterColour = mix(waterColour, sky, shore * 0.05);
          finalSoil = mix(finalSoil, waterColour, cover);
        }
      }
    }
  }
  // Seen from underneath, the ground is the inside of the earth: no sunlight
  // reaches it, so it must not read as a sunlit surface while underground.
  if (!gl_FrontFacing && vSoilSkirt < 0.5) finalSoil *= 0.75;
  // Buried, the earth has to enclose the camera. Without this the underside of
  // the thin ground shell reads as a lit plain running to a horizon, and the
  // opening above it looks like a dome standing on that plain. Fading soil to
  // black with distance leaves a dark burrow with a lit opening overhead.
  if (eyeIsUnder) {
    float depthFromEye = distance(vSoilWorldPos, uRootSightCamera);
    // A floor of 0.04 turned the earth around a buried camera into a black
    // void: the player asked for dirt, not a hole. Soil in shade stays dark
    // brown and only the far distance is allowed to fall away.
    float enclosure = 1.0 - smoothstep(3.0, 14.0, depthFromEye);
    finalSoil *= mix(0.34, 0.92, enclosure);
  }
  gl_FragColor = linearToOutputTexel(vec4(finalSoil, 1.0));`,
    );
}
