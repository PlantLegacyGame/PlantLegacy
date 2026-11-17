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
      '#include <common>\nattribute float aSurfaceCut;\nvarying float vSurfaceCut;\nvarying vec3 vSoilWorldPos;\nvarying vec3 vSoilNormal;',
    )
    .replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvSurfaceCut = aSurfaceCut;\nvSoilWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;',
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
uniform float uRootSightProgress;
uniform vec3 uRootSightCenter;
uniform vec3 uRootSightApertureCenter;
uniform float uRootSightRadius;
uniform float uRootSightApertureRadius;
// Vertical bounds of the cut: the aperture is a volume, not a plan-view disc.
uniform float uRootSightApertureTopY;
uniform float uRootSightApertureBottomY;
uniform float uRootSightRimDitherM;
uniform vec3 uRootSightWallColor;
uniform vec3 uRootSightCamera;
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
uniform float uSoilCrackStrength;
uniform float uSoilPebbleStrength;
uniform float uSoilMineralStrength;
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
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
  // T02 Root Sight cutaway: the earth peels back along the subterranean root
  // system. Each underground node contributes an envelope sphere and the whole
  // set is fused with a smooth minimum, so the opening follows branching root
  // paths as one organic cavity instead of a generic flat circle or a
  // camera-facing cone.
  float cutMask = 0.0;
  float envelope = 1e6;
  // Per-pixel stochastic edge. The rim used to be a hard smoothstep a fraction
  // of a pixel wide, so the opening ended on an aliased circle.
  float rimNoise = fract(
    52.9829189 * fract(0.06711056 * gl_FragCoord.x + 0.00583715 * gl_FragCoord.y)
  );
  // Marched interior wall of the bubble, applied after the surface lighting so
  // the dug earth inside stays readable at night instead of going pure black.
  // Is the eye buried? Decides whether this is a surface view or a view from
  // inside the earth, which need completely different shading.
  bool eyeIsUnder = uEyeUnderGround > 0.5;
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
    // The bowl's lip is built at exactly this radius, and it is a polygon: its
    // chords dip a hair inside the exact circle, and on a slope the terrain
    // between two rim vertices can rise above the chord. Either way a cut that
    // reaches the lip opens a hairline of sky along the rim. Stopping the cut a
    // percent short of the lip tucks the seam under intact soil instead; a lip
    // that is covered cannot show, and a ring of overhang in the other direction
    // is what used to draw a second contour around the hole.
    const float ROOT_SIGHT_CUT_INSET = 0.99;
    float apertureRadius = max(0.05, uRootSightApertureRadius) * ROOT_SIGHT_CUT_INSET;
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
    // cut_rim_dither_m is the configured width, capped at half the hole so a
    // seedling's aperture is softened rather than erased. Outside the dither
    // band nothing is cut; inside the core everything is, so the hole is the
    // bowl's mouth and the rim is a speckle instead of a hard edge.
    float dither = min(max(uRootSightRimDitherM, 0.0), apertureRadius * 0.5);
    float outside =
      smoothstep(max(0.0, apertureRadius - dither), apertureRadius, apertureDist);
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
  float blendedMoisture = mix(clamp(uSoilMoisture, 0.0, 1.0), clamp(tileMoisture, 0.0, 1.0), 0.3);
  dynamicSoil = mix(uSoilDryColor, uSoilWetColor, blendedMoisture);

  // Detail is sampled in world metres, not in arc-length coordinates: the arc
  // coordinate runs to ~157 km on the 100 km planet, and float precision there
  // turned the noise into aliased mush that shaded almost black.
  vec2 soilDetail = vSoilWorldPos.xz;
  // Detail has a range. The grain is sampled at 12-24 cycles per metre, which a
  // pixel a few metres away cannot resolve: the near-vertical noise aliased into
  // evenly spaced moire stripes across the whole valley, which is what read as
  // "colour changing bands" running over the land. Fading the fine octaves out
  // with distance leaves flat soil far away and texture under the player's feet.
  float detailFade = 1.0 - smoothstep(8.0, 34.0, distance(cameraPosition, vSoilWorldPos));
  float clods = soilFbm(soilDetail * 1.6);
  float patches = soilFbm(soilDetail * 0.22 + 11.7);
  float grit = soilNoise(soilDetail * 12.0);
  // Gentler contrast than before: 0.78/0.44 plus 0.90/0.20 swung the soil by
  // nearly half its brightness over a few centimetres, which read as speckle
  // rather than dirt. Softer bands with a finer grain read as texture.
  dynamicSoil *= 0.88 + 0.24 * mix(0.5, clods, detailFade);
  dynamicSoil = mix(dynamicSoil, dynamicSoil * 1.12, smoothstep(0.45, 0.82, patches));
  dynamicSoil *= 0.95 + 0.1 * mix(0.5, grit, detailFade);

  // Buried grit stones: small, sparse and only slightly greyer than the matrix.
  // At low frequency they read as puddles, so they are kept fine and subtle.
  float stones = smoothstep(0.86, 0.96, soilNoise(soilDetail * 24.0 + 17.3)) * detailFade;
  dynamicSoil = mix(dynamicSoil, uSoilMineralColor * 0.6, stones * 0.22);

  // Dried fissures. Ridged noise gives narrow, connected seams instead of the
  // soft blobs plain noise produces, so the topsoil breaks into plates and
  // reads as dirt rather than a painted sheet.
  float ridged = 1.0 - abs(soilNoise(soilDetail * 5.5 + 3.1) * 2.0 - 1.0);
  float cracks = smoothstep(0.92, 1.0, ridged) * detailFade;
  dynamicSoil *= 1.0 - cracks * uSoilCrackStrength;

  // Rounded pebbles mixed into the matrix: their own colour, brighter than the
  // soil around them, plus a second bump layer below so they catch light.
  // Sparse and warm: a stone is a slightly greyer, lighter piece of the same
  // earth, not a pale speck. Dense or cool stones read as litter on the ground.
  float pebbles = smoothstep(0.86, 0.95, soilNoise(soilDetail * 9.0 + 41.7)) * detailFade;
  vec3 pebbleColor = mix(uSoilDryColor, uSoilMineralColor, 0.45) * 1.18;
  dynamicSoil = mix(dynamicSoil, pebbleColor, pebbles * uSoilPebbleStrength);

    dynamicSoil = mix(dynamicSoil, uSoilMineralColor, mineralNoise * uSoilGrainStrength + tileMinerals * uSoilMineralStrength);

  // Soil the water table touches is waterlogged and darker: below the table it
  // is under the surface, just above it capillary rise keeps it damp. This is
  // what makes the inside of a flooded pit look soaked instead of dry, and it
  // works on the cavity walls because it is a world-space lookup.
  if (uWaterTableAvailable > 0.5) {
    vec2 tableLocal =
      (vSoilWorldPos.xz - uWaterTableOrigin) / max(0.001, uWaterTableCell * uWaterTableCells);
    if (tableLocal.x >= 0.0 && tableLocal.x <= 1.0 && tableLocal.y >= 0.0 && tableLocal.y <= 1.0) {
      float tableY =
        uWaterTableRange.x + texture2D(uWaterTable, tableLocal).r * uWaterTableRange.y;
      float depthBelow = tableY - vSoilWorldPos.y;
      float submerged = smoothstep(0.0, 0.3, depthBelow);
      float dampBand = smoothstep(-uWaterDampBandM, 0.0, depthBelow) * 0.6;
      float wet = max(submerged, dampBand);
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
  if (!gl_FrontFacing) macroNormal = -macroNormal;
  // Clod-scale relief, strongest on bare soil: this is what makes the surface
  // read as loose dirt rather than a coloured plane.
  vec3 groundNormal = soilBumpNormal(macroNormal, vSoilWorldPos.xz * 3.2, 0.55 * detailFade);
  // A finer bump layer for the pebbles, on top of the clod relief.
  groundNormal = soilBumpNormal(
    groundNormal,
    vSoilWorldPos.xz * 9.0,
    (0.2 + uSoilPebbleStrength) * detailFade
  );
  // uSunDir points FROM the ground TOWARD the sun, so use it directly.
  float NdotL = max(dot(groundNormal, normalize(uSunDir)), 0.0);
  // Sky fill and the hill-shading curve use the macro normal, not the bump
  // normal: the bump is deliberately mostly vertical, so using it here erased
  // every slope and left the terrain looking flat no matter how it was lit.
  vec3 skyFill =
    uGroundSkyColor *
    uGroundSkyIntensity *
    (0.35 + 0.65 * clamp(macroNormal.y, 0.0, 1.0));
  // Existing relief is gentle (a metre over ten), so plain Lambert barely
  // separates a slope from the flat. A steep power curve on the up component
  // makes those small normal changes read as hills without moving geometry.
  // A steep power curve on the up component drew contour lines. The terrain's
  // normals change by a percent or two across a hillside, and x^24 turned that
  // into 20% steps of brightness, so every 2% slope band came out as a stripe
  // following the terrain's contours - the "colour changing bands". x^3 keeps
  // the hill shading and removes the quantisation.
  float slopeLight = mix(0.88, 1.06, pow(clamp(macroNormal.y, 0.0, 1.0), 3.0));
  vec3 lightColor = (uSunColor * uSunIntensity * NdotL + skyFill) * slopeLight;

  // Modulate light intensity by tile light level
  lightColor *= mix(0.9, 1.0, clamp(tileLight, 0.0, 1.0));

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
    // Dithered, so the opening's edge is a stochastic rim rather than an
    // aliased circle. Deep inside the mask is 1 and always discards; outside it
    // is 0 and never does.
    if (cavityMask > rimNoise) discard;
  }

  // The bubble interior keeps its own lighting; only the surface soil is
  // multiplied by the scene light.
  vec3 finalSoil = dynamicSoil * (0.35 + 0.65 * lightColor);
  // Seen from underneath, the ground is the inside of the earth: no sunlight
  // reaches it, so it must not read as a sunlit surface while underground.
  if (!gl_FrontFacing) finalSoil *= 0.75;
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
