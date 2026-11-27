/**
 * One water material, used by every water surface in the world.
 *
 * Shading follows what makes water read as water:
 *
 * - **Depth darkens it.** Light has to get through the water to the bottom and
 *   back, so a deep body is dark and a shallow film is bright and see-through.
 *   The `aWater` attribute carries the water column in metres and absorption is
 *   Beer–Lambert (`exp(-depth * k)`), so a puddle and a flooded pit shade by the
 *   same rule instead of by whichever mesh they happen to be.
 * - **Reflection brightens it.** Fresnel dominates at grazing angles, which is
 *   why a pool seen across the ground is a sheet of sky while the same water
 *   seen from above shows its dark body. The sun adds a highlight on top.
 * - **A river clips other water out of its channel.** Puddles and the water
 *   table are drawn on the same ground, and three translucent surfaces in one
 *   place stack their alpha and read as a mess of overlapping sheets. Materials
 *   that opt into `uRiverClip` discard fragments inside the channel, using a
 *   baked mask of the surveyed route.
 *
 * Ripples are sampled in world space and advected by `uFlow`. The river's own
 * geometry carries channel-local coordinates (`aFlowUV`), so its streaks follow
 * the valley the water actually runs down instead of a world axis.
 */
import * as THREE from 'three';
import { worldColour } from '../worldPalette.ts';
import {
  type AtmosphereParams,
  atmosphereUniformValues,
  DEFAULT_ATMOSPHERE,
  GLSL_ATMOSPHERE,
} from './atmosphere.ts';

const WATER_VERTEX_SHADER = /* glsl */ `
  attribute float aWater;
  // Channel-local coordinates on the river ribbon: x is metres downstream, y is
  // the lateral position in -1..1. Other water meshes leave this at zero.
  attribute vec2 aFlowUV;
  varying vec3 vWaterWorld;
  varying float vWaterDepth;
  varying vec2 vFlowUV;

  void main() {
    #ifdef USE_INSTANCING
      vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    #else
      vec4 world = modelMatrix * vec4(position, 1.0);
    #endif
    vWaterWorld = world.xyz;
    vWaterDepth = aWater;
    vFlowUV = aFlowUV;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const WATER_FRAGMENT_SHADER = /* glsl */ `
  // The same air the ground and the plants use (AL-04). Without it a lake two
  // kilometres away kept its own colour while the hillside behind it faded to
  // the sky, so the water read as a decal laid on the view.
  uniform vec3 uAtmoExtinction;
  uniform float uAtmoScaleHeight;
  uniform float uAtmoSunPhaseG;
  uniform float uAtmoInScatter;
  uniform float uAtmoHorizonBoost;
  ${GLSL_ATMOSPHERE}
  uniform float uTime;
  uniform float uOpacity;
  uniform float uAbsorption;
  /** Metres of standing water a fragment needs to be drawn at all. */
  uniform float uWaterSubmergeM;
  /** Shallowest standing water the sheet draws at all, in metres. */
  uniform float uMinVisibleDepth;
  uniform float uNearDiscard;
  // Metres at which this surface starts and finishes fading out with distance.
  // The sheet follows the fine ground, the drawn ground gets coarser with
  // distance, and where the two disagree the water ends up in front of a hill
  // the camera is looking down at. Far-away film has no visible surface anyway.
  uniform vec2 uFadeRange;
  // The sheet is a square grid, and its straight edge is visible from a high
  // camera as the edge of the world: "water is a square" from a bird's eye. A
  // radial fade from uSheetFade.x to uSheetFade.y (metres from the sheet's own
  // centre) means the water ends in a soft, irregular-looking falloff well
  // inside the grid, so no straight boundary can ever be seen.
  uniform vec2 uSheetCenter;
  uniform vec2 uSheetFade;
  // How far the eye is above this surface, in metres, and the band over which the
  // whole sheet gives way to the orbital face. The sea is a ground-level device:
  // a 146 km disc of water under a camera at 300 km covers the planet with one
  // pale puddle and hides the land, the ice and the terminator the orbital shell
  // paints. The scale height of the handover is the shell's own fade band.
  uniform float uEyeAltitudeM;
  uniform vec2 uAltitudeFade;
  // Root Sight's cavity is a cut-away into the ground. Water surfaces inside
  // that opening would cover the roots with a dark disc, so they are dropped
  // there: the cavity shows dirt and roots, not a well of water.
  uniform vec2 uCavityCenter;
  uniform float uCavityRadius;
  // The opening's plan column. Root Sight is a cut-away, not a real hole in a
  // lake bed: any water surface inside the column is dropped at every height,
  // because a sheet hanging over the opening hides the roots and reads as
  // flooded ground. There was a "below the mouth plane" bound here; a lake
  // lapping above a shore pit then kept its surface inside the column and the
  // pit looked like water seen through the ground.
  // Ground height sampled from the same field the sheet is built on. A water
  // surface that stands above the soil is not water, it is a flood: the water
  // table can sit above a valley floor, and the sheet used to be drawn there
  // regardless, which is what "water rising out of the ground when I zoom out"
  // and the dark disc filling the Root Sight cavity actually were.
  uniform sampler2D uGroundHeight;
  uniform vec2 uGroundHeightOrigin;
  uniform float uGroundHeightSize;
  uniform vec2 uGroundHeightRange;
  uniform float uGroundHeightAvailable;
  // The same field sampled at the far terrain ring's own spacing. Past the detail
  // patch the ground on screen is a mesh of those coarse cells, and a triangle
  // interpolated across metres of relief sits below the field: water that is
  // genuinely underground then stands in front of the drawn hill. This test uses
  // whichever ground is lower, so it compares against what is actually drawn.
  uniform sampler2D uGroundCoarse;
  uniform vec2 uGroundCoarseOrigin;
  uniform float uGroundCoarseSize;
  uniform vec2 uGroundCoarseRange;
  uniform float uGroundCoarseAvailable;
  /** Metres from the coarse grid's centre where it starts to apply. */
  uniform float uGroundCoarseInnerRadiusM;
  /** 1 on the planet-wide sea: a sphere, not a sheet lying on a bed. */
  uniform float uOceanMode;
  /**
   * The body the sea wraps: xyz its centre, w 1 when this material is that sea.
   * Its detail is sampled from the surface direction, not from the flat plane
   * through the pole (see seaSurfaceNormal below).
   */
  uniform vec4 uPlanetSeaCentre;
  uniform float uPlanetSeaRadius;
  /** Water column the sea uses where the ground grid does not reach. */
  uniform float uOceanDepthM;
  /** 1 when the sea carries its own column per vertex (the global sea). */
  uniform float uOceanVertexDepth;
  /** How wide the sea's foam line is, metres of water column. */
  uniform float uSeaFoamM;
  uniform vec2 uFlow;
  uniform vec2 uRippleScale;
  uniform float uRippleStrength;
  uniform float uStreakStrength;
  // 1 = sample the wave field in the river's own frame (along the channel /
  // across it) instead of in world XZ, so streaks follow the valley.
  uniform float uRiverFlow;
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;
  uniform vec3 uSkyColor;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  // River channel, for clipping other water out of it. The mask is baked from
  // the surveyed route: red is inside the channel, green is the damp bank band.
  uniform float uRiverClip;
  uniform float uRiverWidthM;
  uniform sampler2D uChannelMask;
  uniform vec2 uChannelMaskOrigin;
  uniform float uChannelMaskSize;
  uniform float uChannelMaskAvailable;
  varying vec3 vWaterWorld;
  varying float vWaterDepth;
  varying vec2 vFlowUV;

  // Two travelling ripple trains plus a slow swell, sampled in world metres so
  // every surface shares the same wave field.
  vec3 rippleNormal(vec2 p, float t) {
    float dx = cos(p.x * 3.1 + t * 1.7) * 0.5 + cos((p.x + p.y) * 5.3 + t * 2.3) * 0.35;
    float dy = cos(p.y * 2.7 - t * 1.3) * 0.5 + cos((p.x + p.y) * 5.3 + t * 2.3) * 0.35;
    return normalize(vec3(-dx * 0.05, 1.0, -dy * 0.05));
  }

  // Open water is three wave trains deep, not one: a long swell, a wind chop and
  // a fine ripple on top. One train at a puddle's wavelength made the sea read as
  // a flat grey band - the surface had almost no slope to catch the sun with.
  // A wave on a sphere, without coordinates.
  //
  // The sea's detail used to be a function of world xz - a flat projection. On a
  // sphere that projection folds into concentric rings around the pole and a
  // lattice of squares everywhere else, and both of them turn as the camera
  // moves: the tiled water a low eye sees, and the moire that appears and
  // disappears at different zooms. A wave is a gradient, and a gradient needs no
  // projection: a train travelling along direction k has height sin(dot(p,k)-wt)
  // at a surface point p, so its slope is k times the cosine, projected into the
  // tangent plane. The field then runs round the whole body with no seam, no
  // pole and no coordinate precision to lose.
  vec3 seaWaveSlope(vec3 p, vec3 k, float speed, float t) {
    return k * cos(dot(p, k) - t * speed);
  }

  // Five trains, none of them a multiple of another and all of them tilted off
  // the axes. Three orthogonal trains of related frequency summed to a standing
  // lattice: the crests met in a regular grid of bright points, which is what
  // open water at arm's length was showing - rows of white dashes rather than
  // sea. Directions and speeds chosen so no pair repeats over a wavelength.
  //
  // Each train also retires at its own distance. A ripple is a highlight within a
  // hundred metres and an aliasing dotted line at a kilometre, so the fine trains
  // are weighted by how far the fragment is from the eye - and the whole scale is
  // stretched by the eye's altitude, because a taller eye resolves a wave from
  // proportionally further away. Without this the sea was either banded stripes
  // all the way to the horizon or a flat grey plate with no water in it.
  // A train is retired when its phase changes faster than about a radian per
  // pixel, which is exactly when it can no longer be drawn and starts to band.
  // That is the screen's answer, not a distance: the same wave is a ripple under
  // a sixty-metre eye and a broad swell from thirty kilometres up, and a fixed
  // distance cut-off either banded the near sea or flattened the far one.
  float seaTrainAA(vec3 p, vec3 k) {
    return 1.0 - smoothstep(0.45, 1.35, fwidth(dot(p, k)));
  }

  vec3 seaSurfaceNormal(vec3 p, vec3 up, float t) {
    // Two long swells and three short ones. The long pair is what the sea shows
    // from two kilometres and from orbit - without them the surface was a flat
    // colour past a kilometre, because every train short enough to look like a
    // wave had already retired and nothing replaced it.
    vec3 kLong = vec3(0.021, 0.006, 0.017);
    vec3 kLong2 = vec3(-0.009, 0.004, 0.013);
    vec3 k3 = vec3(1.55, 0.62, -1.30);
    vec3 k1 = vec3(2.05, 0.31, 0.72);
    vec3 k2 = vec3(0.41, 0.19, 2.10);
    vec3 k4 = vec3(-1.11, 0.44, 1.77);
    vec3 k5 = vec3(0.83, -0.27, -0.61);
    // The long trains' wave vectors are tiny by construction (a two-hundred-metre
    // wavelength is a k of 0.03), so their slope is tiny too at the weight a short
    // train uses: the surface came out perfectly flat from two kilometres, which is
    // what "featureless past a kilometre" was. A long swell is *gentle*, not
    // invisible - its amplitude is metres, so its slope is a tenth of a radian -
    // and the weights below are the amplitude those two trains should carry.
    vec3 slope = seaWaveSlope(p, kLong, 0.55, t * 0.30) * 58.0 * seaTrainAA(p, kLong);
    slope += seaWaveSlope(p, kLong2, 0.42, t * 0.24) * 34.0 * seaTrainAA(p, kLong2);
    slope += seaWaveSlope(p * 0.22, k3, 1.7, t * 0.55) * 2.4 * seaTrainAA(p * 0.22, k3);
    slope += seaWaveSlope(p * 0.63, k1, 2.3, t * 1.35) * 1.05 * seaTrainAA(p * 0.63, k1);
    slope += seaWaveSlope(p * 1.87, k2, 2.7, t * 1.90) * 0.72 * seaTrainAA(p * 1.87, k2);
    slope += seaWaveSlope(p * 3.41, k4, 1.3, t * 2.35) * 0.46 * seaTrainAA(p * 3.41, k4);
    slope += seaWaveSlope(p * 5.73, k5, 0.9, t * 2.95) * 0.28 * seaTrainAA(p * 5.73, k5);
    // Only the part of the slope along the surface tilts it; the radial part would
    // only stretch the normal.
    slope -= up * dot(slope, up);
    return normalize(up - slope * 0.05);
  }

  // The sea's swell, as noise on the surface itself.
  //
  // It used to be cosines: two long trains, then four at assorted lengths. Two
  // long ones alone are a corduroy of parallel stripes right across the disc,
  // and a crossing pair is a woven checkerboard - both are patterns, and from
  // thirty kilometres the eye locks on to whichever frequency the screen kept.
  // Noise has no wavelength and no direction, so there is nothing to lock on
  // to: the same field reads as swell at two kilometres and as broad patches at
  // thirty, and an octave that goes finer than a pixel fades to the mean
  // instead of aliasing into a moire.
  float seaHash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float seaNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(
        mix(seaHash(i), seaHash(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(seaHash(i + vec3(0.0, 1.0, 0.0)), seaHash(i + vec3(1.0, 1.0, 0.0)), f.x),
        f.y
      ),
      mix(
        mix(seaHash(i + vec3(0.0, 0.0, 1.0)), seaHash(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(seaHash(i + vec3(0.0, 1.0, 1.0)), seaHash(i + vec3(1.0, 1.0, 1.0)), f.x),
        f.y
      ),
      f.z
    );
  }

  // Signed swell in about [-0.5, 0.5]: four octaves from 2.6 km down to 200 m,
  // each retired by its own screen footprint. The short ones are the sea's own
  // texture from two kilometres; the long ones are what thirty kilometres shows.
  float seaSwell(vec3 p) {
    float sum = 0.0;
    float amp = 1.0;
    float scale = 0.00038;
    for (int i = 0; i < 4; i++) {
      vec3 q = p * scale;
      float foot = max(max(fwidth(q.x), fwidth(q.y)), fwidth(q.z));
      float aa = 1.0 - smoothstep(0.30, 0.75, foot);
      sum += (seaNoise(q) - 0.5) * amp * aa;
      amp *= 0.62;
      scale *= 2.35;
    }
    // Value noise rarely reaches its own limits - the sum of four octaves sits
    // near a third of the way out most of the time - so it is scaled up and
    // clamped: the swell should reach the ends of its range over the sea the eye
    // can see, not only at the rare extreme.
    return clamp(sum * 2.6, -0.5, 0.5);
  }

  vec3 seaNormal(vec2 p, float t) {
    vec3 swell = rippleNormal(p * 0.22, t * 0.55) - vec3(0.0, 1.0, 0.0);
    vec3 chop = rippleNormal(p * 0.8 + vec2(7.3, 2.1), t * 1.35) - vec3(0.0, 1.0, 0.0);
    vec3 ripple = rippleNormal(p * 2.7 + vec2(1.7, 9.4), t * 2.2) - vec3(0.0, 1.0, 0.0);
    vec3 slope = swell * 2.4 + chop * 1.15 + ripple * 0.5;
    return normalize(vec3(slope.x, 1.0, slope.z));
  }

  void main() {
    // How much water stands over this fragment. Sheets carry it in aWater; the
    // sea has no bed of its own, so it takes the depth down to the ground grid
    // under it (that is what makes a shallow shelf pale and a deep basin dark)
    // and a constant column where the grid does not reach.
    float waterColumn = vWaterDepth;
    if (uOceanMode > 0.5) {
      // The global sea bakes the column into its vertices from the relief: one
      // sphere carries the whole planet's coast and basin, with no bed texture
      // to run out of reach. The play-area dome has no bed of its own, so it
      // still reads the local ground grid underneath it.
      waterColumn = uOceanVertexDepth > 0.5 ? max(0.0, vWaterDepth) : uOceanDepthM;
      if (uOceanVertexDepth < 0.5 && uGroundHeightAvailable > 0.5) {
        vec2 seaUV = (vWaterWorld.xz - uGroundHeightOrigin) / uGroundHeightSize;
        if (seaUV.x >= 0.0 && seaUV.x <= 1.0 && seaUV.y >= 0.0 && seaUV.y <= 1.0) {
          float bedY =
            uGroundHeightRange.x + texture2D(uGroundHeight, seaUV).r * uGroundHeightRange.y;
          waterColumn = max(0.0, vWaterWorld.y - bedY);
        }
      }
    } else {
      // A cell with no water in it has nothing to draw. Discarding here rather
      // than moving the geometry leaves the sheet level and keeps its triangles
      // from cutting through the soil. The threshold is in centimetres, not
      // millimetres: a two-centimetre film after rain covered the whole map in a
      // grey sheet that read as a flood, and hid the soil underneath it.
      // Depth itself is the shoreline: the alpha ramp below fades a column out from
// nothing, so a hard cut here only ever ate the water *inside* a pool's edge and
// left the moth-eaten shore the depth cap used to make. Zero-depth cells are the
// only ones with nothing to draw.
if (vWaterDepth <= 0.0) discard;
    }
    if (uRiverClip > 0.5 && uChannelMaskAvailable > 0.5) {
      vec2 maskUV = (vWaterWorld.xz - uChannelMaskOrigin) / uChannelMaskSize;
      if (
        maskUV.x >= 0.0 && maskUV.x <= 1.0 &&
        maskUV.y >= 0.0 && maskUV.y <= 1.0 &&
        texture2D(uChannelMask, maskUV).r > 0.5
      ) discard;
    }
    if (uGroundHeightAvailable > 0.5 && uOceanMode < 0.5) {
      vec2 groundUV = (vWaterWorld.xz - uGroundHeightOrigin) / uGroundHeightSize;
      // The sheet may only be drawn where it is below the ground the eye can see.
      // Two grounds: the fine field near the player (which is what the detail
      // patch draws), and the field sampled at the far ring's spacing out to the
      // water table's own range. Out there the drawn ground is that ring's mesh,
      // and an interpolated triangle dips below the field on a rise, which is
      // what put sheets of water on top of distant hills. Where both apply, the
      // lower one wins: water hidden under either surface is not drawn, and a
      // lake in a hollow stays because the coarse triangle there sits above the
      // field, above nothing else.
      bool groundTested = false;
      float groundY = 0.0;
      if (groundUV.x >= 0.0 && groundUV.x <= 1.0 && groundUV.y >= 0.0 && groundUV.y <= 1.0) {
        groundY =
          uGroundHeightRange.x + texture2D(uGroundHeight, groundUV).r * uGroundHeightRange.y;
        groundTested = true;
      }
      if (uGroundCoarseAvailable > 0.5) {
        vec2 coarseUV = (vWaterWorld.xz - uGroundCoarseOrigin) / uGroundCoarseSize;
        if (coarseUV.x >= 0.0 && coarseUV.x <= 1.0 && coarseUV.y >= 0.0 && coarseUV.y <= 1.0) {
          if (length(coarseUV - 0.5) * uGroundCoarseSize > uGroundCoarseInnerRadiusM) {
            float coarseY =
              uGroundCoarseRange.x + texture2D(uGroundCoarse, coarseUV).r * uGroundCoarseRange.y;
            groundY = groundTested ? min(groundY, coarseY) : coarseY;
            groundTested = true;
          }
        }
      }
      if (groundTested && vWaterWorld.y > groundY + uWaterSubmergeM) discard;
    }
    float cavityAlpha = 1.0;
    if (uCavityRadius > 0.0) {
      vec2 cavity = vWaterWorld.xz - uCavityCenter;
      // The column is the opening, at every height: the ground inside it is cut
      // away, so no water surface belongs in front of the roots. The three ray
      // heuristics this replaces reached across the map - the closest-point test
      // is a strip through the cavity centre, so a lower river seen past an
      // open pit lost a seam of water.
      // A hard cut left the water's own edge as a one-pixel blue line lying
      // against the pit's rim. Water is transparent, so the alpha fades over the
      // last tenth of the radius and the surface dissolves into the soil instead.
      float cavityDist = length(cavity);
      cavityAlpha = smoothstep(uCavityRadius * 0.9, uCavityRadius, cavityDist);
      if (cavityAlpha <= 0.002) discard;
    }
    // Water right at the camera clips through the near plane and smears a sheet
    // across the view; dropping those fragments keeps the waterline stable.
    if (distance(cameraPosition, vWaterWorld) < uNearDiscard) discard;

    vec3 viewDir = normalize(cameraPosition - vWaterWorld);

    // Water coordinates for the wave field. The river carries its own: metres
    // downstream and lateral offset. Sampling in world XZ instead painted
    // diagonal bands that had nothing to do with where the river goes.
    vec2 waterUV = vWaterWorld.xz;
    // The body's sea is sampled on the surface, not through the plane at the
    // pole. World xz is a flat projection, so on a sphere the wave grid becomes
    // a lattice of squares that turns as the camera moves and re-appears in
    // rings away from the pole - the tiled water a low camera sees. On the arc
    // and azimuth the same field runs along the surface like water should.
    // The body's sea still samples this flat field. Arc and azimuth were tried
    // and are worse: the arc runs to 157 km and a ripple field multiplied by that
    // length aliases into a regular lattice far finer than the flat projection's
    // squares - the grid it was meant to remove. The honest version is a 3D noise
    // field on the unit direction, which has no coordinate singularity and no
    // precision to lose; the distance fade below keeps this one off the near sea
    // in the meantime.
    if (uRiverFlow > 0.5) {
      waterUV = vec2(vFlowUV.x - uTime * uFlow.x, vFlowUV.y * uRiverWidthM * 0.5);
    } else {
      waterUV -= uFlow * uTime;
    }

    vec2 ripplePos = waterUV * uRippleScale;
    // Which way is "up" for this fragment. A sheet of water lies in the world's
    // own plane, but the body's sea is a sphere: its up is radial, and every
    // facing test below has to use that rather than world +Y, which on the far
    // side of the planet points into the water.
    vec3 localUp = vec3(0.0, 1.0, 0.0);
    vec3 normal;
    if (uPlanetSeaCentre.w > 0.5) {
      localUp = normalize(vWaterWorld - uPlanetSeaCentre.xyz);
      vec3 seaPoint = localUp * uPlanetSeaRadius;
      // Clamped: the sheet's ripple strength is an exaggeration on a puddle's
      // slope, and applying it as a mix weight on the sea overshot past the
      // wave's own normal into a faceted, glittering lattice.
      float seaMix = clamp(uRippleStrength, 0.0, 1.0);
      vec3 seaNormal = seaSurfaceNormal(seaPoint, localUp, uTime);
      normal = normalize(mix(localUp, seaNormal, seaMix));
    } else {
      normal = uOceanMode > 0.5
        ? normalize(mix(vec3(0.0, 1.0, 0.0), seaNormal(ripplePos, uTime), uRippleStrength))
        : mix(vec3(0.0, 1.0, 0.0), rippleNormal(ripplePos, uTime), uRippleStrength);
    }
    // The wave field is a metre-scale grid. At altitude the fragments under a
    // pixel are metres apart, so the grid aliases into concentric moire rings
    // over the whole planet. Detail belongs to the near water; past a couple of
    // kilometres the sea is its own colour and the sky's.
    if (uOceanMode > 0.5 || uPlanetSeaCentre.w > 0.5) {
      // The trains carry their own antialiasing now (see seaTrainAA), so there is
      // no distance cut-off here: what survives is whatever the screen can still
      // resolve, from ripples at arm's length to the long swell from orbit.
      normal = normalize(normal);
    }
    // Fresnel from the *undisturbed* surface. It was taken from the rippled
    // normal, and with a ripple strength of 2.4 the sheet's facing swung through
    // most of its range every couple of metres: the sky/bed mix alternated with
    // it and the water read as concentric contour bands rather than a surface.
    // Ripples belong in the highlight, where their scale is a glint and not a
    // region of the water.
    float facing = clamp(dot(viewDir, localUp), 0.0, 1.0);
    // A narrower lobe than the old square: a puddle seen from standing height
    // should keep its body colour, not turn into a white plate at the bank.
    float fresnel = pow(1.0 - facing, 3.0);
    // A sea's glitter path is wide: the same tight exponent a puddle uses gives a
    // handful of isolated points on open water, which reads as flatness.
    // The sea's normal is the wave field's, and past a few kilometres that
    // field is faded flat (see the normal fade above). A broad lobe on a flat
    // sheet lights the whole disc at once - a white smear with a green rim,
    // not the sun's path on water. The ocean's highlight is tight enough to
    // stay a path; the local sheet keeps its softer one.
    float specPower = uOceanMode > 0.5 ? 96.0 : 160.0;
    float specular = pow(max(dot(reflect(-normalize(uSunDir), normal), viewDir), 0.0), specPower);

    // Beer-Lambert: how much of the light that reaches the bottom comes back.
    float depth = max(waterColumn, 0.0);
    float transmit = exp(-depth * uAbsorption);
    vec3 body = mix(uDeepColor, uShallowColor, transmit);

    // The surface reflects the sky regardless of depth — that is what keeps a
    // deep pool bright at a glancing angle instead of turning it into a hole.
    // A third of the sky even straight down: open water is never as dark as the
    // colour of its depths, and at 0.18 the river bed's own tint came through as
    // a black plate under a clear noon.
    // The waves ride in the sky reflection: each crest faces a slightly different
    // part of the sky, and that banding is what makes a surface read as moving
    // water rather than a painted plane.
    // Sky reflection is tinted by the water body, not replaced by the fog
    // colour. A pure sky mix at a grazing angle turned every sheet into a flat
    // white-grey plate, because the horizon colour is nearly white at noon and
    // the whole surface sat at 97% of it. Real water keeps its own blue-green
    // even when it is mostly reflecting: the reflection is filtered through the
    // surface and the water below it.
    vec3 reflected = mix(uSkyColor, uShallowColor * 2.1, 0.55);
    reflected = mix(reflected, uDeepColor * 1.8, 0.18);
    float skyMix = uOceanMode > 0.5
      ? clamp(0.20 + 0.56 * fresnel + 0.5 * (normal.x * uSunDir.x + normal.z * uSunDir.z), 0.0, 0.80)
      : clamp(0.03 + 0.08 * fresnel, 0.0, 0.12);
    // The shallow rim is water over a bright bed, not a white shore. Keep the
    // reflection out of the first centimetres so the fading alpha reveals the
    // body's own darker shallow colour instead of a pale fringe.
    if (uOceanMode < 0.5) {
      float shallowFade = smoothstep(0.0, max(0.02, uMinVisibleDepth * 3.0), vWaterDepth);
      skyMix *= mix(0.45, 1.0, shallowFade);
    }
    vec3 color = mix(body, reflected, skyMix);
    // A puddle is not a mirror of the sun. The old 0.62 lobe on every ripple made
    // the sheet a field of white pinpricks from any altitude; open water keeps
    // its glint path, while standing water keeps only a restrained sparkle.
    color += reflected * (0.01 * fresnel) + uSunColor * specular * (uOceanMode > 0.5 ? 0.95 : 0.05);
    // The body's sea also carries its swell in its colour, not only in its
    // normal. A wave's *slope* is invisible from two kilometres up - the sun is
    // high, the eye looks down, and a five-degree tilt moves neither the fresnel
    // nor the glint - which is why the far sea was a flat plate however much swell
    // the normal carried.
    //
    // This term is noise, not a sum of cosines (see seaSwell): a fifth of the
    // colour either side of the mean, on a field with no wavelength to band on.
    // When the sun is high, the surface is 97 per cent reflected sky, and a
    // tenth of that is not a difference anyone can see - hence the size.
    if (uPlanetSeaCentre.w > 0.5) {
      vec3 seaPoint = localUp * uPlanetSeaRadius;
      // The swell drifts a few metres a second: the field itself has no
      // direction, so moving it along one adds motion without adding a heading
      // the eye can resolve into stripes.
      vec3 swellPoint = seaPoint + vec3(0.35, 0.0, 0.55) * (uTime * 4.0);
      float lift = 0.5 + 1.15 * seaSwell(swellPoint);
      color = mix(color * 0.80, color * 1.20, clamp(lift, 0.0, 1.0));
    }

    // Downstream streaks: bands across the flow that travel with it. Ripples
    // alone are invisible from a distance, which is why a river looked like a
    // standing pond even though its surface was moving.
    // Bands across the flow that travel downstream, plus a finer riffle line on
    // the faster phase: two speeds read as water moving over a bed, where one
    // speed just reads as a scrolling texture.
    float streakPhase = waterUV.y * 2.3 + waterUV.x * 0.35;
    float rifflePhase = waterUV.y * 6.1 + waterUV.x * 0.9;
    // Both patterns are about a metre across, and at a kilometre that is less
    // than a pixel: unfiltered, the sine aliased into the evenly spaced dashes
    // the eye read as a broken surface all the way out to the horizon. Fading
    // each band by its own screen-space footprint retires it exactly when it
    // can no longer be drawn, and leaves the wave normals to carry the surface.
    float streakAA = 1.0 - smoothstep(0.5, 1.5, fwidth(streakPhase));
    float riffleAA = 1.0 - smoothstep(0.5, 1.5, fwidth(rifflePhase));
    float streaks = 0.5 + 0.5 * sin(streakPhase);
    float riffle = smoothstep(0.72, 1.0, 0.5 + 0.5 * sin(rifflePhase));
    color = mix(
      color,
      uSkyColor * 1.08,
      uStreakStrength * (0.16 * streaks * streakAA + 0.1 * riffle * riffleAA)
    );

    // Shallow water is see-through, so the stained ground under it shows; deep
    // water hides the bottom.
    // Shallow water is mostly window, deep water mostly surface. It used to start
    // at half opacity, which hid the bed under a film that should be clear.
    //
    // The sea is the exception: its "ground" is the planet body, not a pond bed,
    // and the body is bare soil. At a puddle's shallow alpha the whole sea over
    // the bed grid showed that brown body through the water - a 6.4 km square of
    // mud in the middle of the ocean, with the grid's edge as its straight coast.
    // Open water gets the same sheet alpha everywhere and carries its own
    // shallow-to-deep colour; only the waterline still fades.
    // The sea is a body, not a sheet over a bed the eye should read: at 0.91 the
    // bare soil of the planet body tinted the whole ocean, and the tint moved
    // with the sun. Only the waterline fades.
    // Standing water is a body, not a window: at a puddle's old 0.34 base the
    // pale bed showed straight through and its white stones read as foam on the
    // surface. The water keeps its own tint even when it is shallow, while the
    // shoreline fade still opens the very edge.
    float alpha = uOpacity * (uOceanMode > 0.5 ? 1.0 : mix(0.72, 0.98, 1.0 - transmit));
    // A fade is only a fade when it has somewhere to fade over. The "no fade"
    // setting is a pair of equal numbers (1e9, 1e9), and smoothstep(e, e, x)
    // is a division by zero: D3D/ANGLE answers 1, so 1 - 1 wiped the alpha
    // and the whole surface was discarded. That is how the planet-wide sea has
    // been invisible below every camera outside the play area's dome - the eye
    // saw the bare soil of the body where the water should have been, not water
    // with no detail on it - and the same pair on the standing-water sheet took
    // the drawn surface off every puddle.
    if (uFadeRange.y > uFadeRange.x) {
      alpha *= 1.0 - smoothstep(uFadeRange.x, uFadeRange.y, distance(cameraPosition, vWaterWorld));
    }
    if (uAltitudeFade.y > uAltitudeFade.x) {
      alpha *= 1.0 - smoothstep(uAltitudeFade.x, uAltitudeFade.y, uEyeAltitudeM);
    }
    if (uSheetFade.y > 0.0) {
      // The field is a square, so its rim used to be a ruler-straight cut across
      // the water wherever the eye was low enough to see that far. A shoreline is
      // not a circle either: wobble the fade radius so the sheet ends in bays and
      // points instead of a line.
      float rim = distance(vWaterWorld.xz, uSheetCenter);
      // Keep the wavy cutoff inside the square for every phase: the waves only
      // pull the shore inward, never past the field's rim where a hard mesh edge
      // would show again.
      float rimWobble =
        sin(vWaterWorld.x * 0.37 + vWaterWorld.z * 0.23) * 1.6 +
        sin(vWaterWorld.z * 0.53 - 1.3) * 0.9 -
        2.5;
      alpha *= 1.0 - smoothstep(
        uSheetFade.x + rimWobble,
        uSheetFade.y + rimWobble,
        rim
      );
    }
    #ifdef WATER_EDGE_FADE
      // Thin films fade at the edge so a puddle has no polygon rim.
      alpha *= uOceanMode > 0.5
        // A sea meets its shore where the bed reaches the surface: the waterline
        // is crisp, and a band of foam sits just outside it, so the edge follows
        // the ground instead of the mesh's own outline. The band is one pixel
        // wide wherever the eye is: at 10 km a fixed 6 cm band is far narrower
        // than a pixel and the coast fell into stair-steps, and a fixed wide
        // band would have eaten the shallows.
        // Distance widens the band a little: past a kilometre the bed is
        // minified, and a crisp one-pixel waterline then followed the bed's
        // texels instead of the coast. Six metres is under half a pixel at four
        // kilometres, so it only softens the stair-step; a wide band is not an
        // option, because the ocean's whole body is only metres deep over the
        // shelf and would turn transparent along with its coast.
        // The mip chain on the bed does the real filtering.
        ? smoothstep(
            0.0,
            mix(
              max(0.06, fwidth(waterColumn) * 1.5),
              6.0,
              smoothstep(1200.0, 4000.0, distance(cameraPosition, vWaterWorld))
            ),
            waterColumn
          )
        // Alpha is the water column, antialiased by its own screen derivative.
        // The old ramp to four times the visible depth painted a wide grey band
        // along every bank; this is one pixel of fade wherever the eye is.
        : smoothstep(
            0.0,
            max(fwidth(vWaterDepth) * 1.5, uMinVisibleDepth * 0.5),
            vWaterDepth
          );
    #endif

    // Seen from under the surface. Water reflects itself: light leaving it is
    // totally internally reflected beyond about 48.6 degrees from vertical, so
    // the sky is a bright window straight overhead and the rest of the sheet is
    // a dim mirror of the water body. Drawing the top-side shading from below
    // made the underside a flat, evenly bright lid - the water looked exactly
    // like a sheet of sky instead of something you are inside.
    // Keyed on where the eye is, not on which face is showing. The sheet's
    // winding makes its front faces look down, so the front-facing test was true
    // for the underside on every above-water camera: the sheet was shaded as the
    // underside (deep colour at half brightness) and the whole river read as a
    // black plate under a clear sky. viewDir points from the fragment to the eye,
    // so a positive y means the eye is above this bit of surface.
    if (dot(viewDir, localUp) < 0.0) {
      float cosUp = clamp(-dot(viewDir, localUp), 0.0, 1.0);
      // Ripples wobble the edge of the window; without them it is a perfect
      // circle, which reads as a texture rather than a surface.
      float wobble = rippleNormal(ripplePos * 1.7, uTime * 1.3).x * 6.0;
      float windowEdge = smoothstep(0.56, 0.76, cosUp + wobble);
      vec3 under = mix(uDeepColor * 0.5, uSkyColor * 1.2, windowEdge);
      under = mix(under, uShallowColor, 0.2);
      color = under;
      alpha *= mix(0.95, 0.62, windowEdge);
    }

    // Foam where the water is barely deep enough to cover the bed: it breaks on
    // the shore and on the shoals, which is what ties the sea's edge to the
    // ground rather than to the grid the dome is made of.
    if (uOceanMode > 0.5) {
      // Foam is a metre-wide band; past a couple of kilometres it is thinner
      // than a pixel and only aliased the coast into a grey fringe, so it
      // belongs to the near sea.
      float foamNear = 1.0 - smoothstep(1200.0, 4000.0, distance(cameraPosition, vWaterWorld));
      float foam = (1.0 - smoothstep(0.0, max(0.05, uSeaFoamM), waterColumn)) * foamNear;
      foam *= 0.75 + 0.25 * sin(waterColumn * 9.0 + uTime * 1.7);
      color = mix(color, uSkyColor * 1.08, clamp(foam * 0.5, 0.0, 0.5));
      alpha = max(alpha, foam * 0.5);
    }

    alpha *= cavityAlpha;
    if (alpha < 0.01) discard;

    // Aerial perspective on the sheet itself. Both ends of the ray are used, so
    // the water keeps its colour from orbit and fades into the horizon from the
    // ground, exactly as the soil it lies in does.
    if (alpha > 0.02) {
      vec3 toFragment = vWaterWorld - cameraPosition;
      float atmoDist = length(toFragment);
      vec3 atmoView = atmoDist > 1e-4 ? toFragment / atmoDist : vec3(0.0, 1.0, 0.0);
      // Height above the water, not world y. World y is the ground only around
      // the pole: an eye two kilometres over the far ocean has y of -49000, and
      // the clamp below turned that into "at sea level". The air was then asked
      // for the density of the thickest part of the atmosphere across the whole
      // chord, four kilometres of it came out 99 per cent horizon haze, and the
      // sea read as a pale plate with every wave erased - the reason the swell
      // was invisible from two kilometres however strong it was made.
      float atmoEyeHeight = max(0.0, cameraPosition.y);
      float atmoTargetHeight = max(0.0, vWaterWorld.y);
      if (uPlanetSeaCentre.w > 0.5) {
        atmoEyeHeight = max(
          0.0,
          length(cameraPosition - uPlanetSeaCentre.xyz) - uPlanetSeaRadius
        );
        atmoTargetHeight = max(
          0.0,
          length(vWaterWorld - uPlanetSeaCentre.xyz) - uPlanetSeaRadius
        );
      }
      vec3 air = atmoTransmittanceRay(atmoDist, atmoEyeHeight, atmoTargetHeight);
      if (uOceanMode > 0.5) {
        // The sea is a mirror of the sky, so the air in front of it is the
        // sky at the horizon, not the directional in-scatter. Looking across
        // the sun turns that haze a muddy brown, and the sea faded into a band
        // of it under a pale sky - the whole horizon read as dirty water.
        color = color * air + uSkyColor * (1.0 - air);
      } else {
        vec3 scatter = atmoInScatter(atmoView, normalize(uSunDir));
        color = color * air + scatter * (1.0 - air);
      }
    }

    gl_FragColor = vec4(color, alpha);
  }
`;

export interface WaterMaterial {
  material: THREE.ShaderMaterial;
  deepColor: THREE.Color;
  shallowColor: THREE.Color;
  skyColor: THREE.Color;
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
}

export interface WaterMaterialOptions {
  /** Fade thin films out at their edge (the rain sheet). */
  edgeFade?: boolean;
}

export function createWaterMaterial(options: WaterMaterialOptions = {}): WaterMaterial {
  // Teal, not ink. #0d2a33 is darker than any water seen in daylight and made
  // a deep channel read as a hole in the ground.
  const deepColor = worldColour('water_deep');
  const shallowColor = worldColour('water_body');
  const skyColor = worldColour('water_shallow');
  const sunDir = new THREE.Vector3(0.4, 0.8, 0.3);
  const sunColor = worldColour('sunlight');
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0.85 },
      // Metres of water that halve the light. At 1.6 the D8 river channel was
      // already opaque after half a metre; 1.0 keeps a metre of water readable as
      // water and still darkens a deep pit.
      uAbsorption: { value: 1.0 },
      uNearDiscard: { value: 0.35 },
      uFadeRange: { value: new THREE.Vector2(1e6, 1e6) },
      uSheetCenter: { value: new THREE.Vector2(0, 0) },
      // 0 disables the radial edge (river ribbons are not square).
      uSheetFade: { value: new THREE.Vector2(0, 0) },
      uEyeAltitudeM: { value: 0 },
      // Default: no altitude handover. Only the open sea sets a band, because it is
      // the one surface a camera can climb away from.
      uAltitudeFade: { value: new THREE.Vector2(1e9, 1e9) },
      uCavityCenter: { value: new THREE.Vector2(0, 0) },
      uCavityRadius: { value: 0 },
      // Just above the film's own lift (5 cm), so a puddle on the soil is kept
      // and anything hovering over the ground is not drawn at all.
      uWaterSubmergeM: { value: 0.08 },
      uMinVisibleDepth: { value: 0.02 },
      uGroundHeight: { value: null },
      uGroundHeightOrigin: { value: new THREE.Vector2(0, 0) },
      uGroundHeightSize: { value: 1 },
      uGroundHeightRange: { value: new THREE.Vector2(0, 1) },
      uGroundHeightAvailable: { value: 0 },
      uGroundCoarse: { value: null },
      uGroundCoarseOrigin: { value: new THREE.Vector2(0, 0) },
      uGroundCoarseSize: { value: 1 },
      uGroundCoarseRange: { value: new THREE.Vector2(0, 1) },
      uGroundCoarseAvailable: { value: 0 },
      uGroundCoarseInnerRadiusM: { value: 0 },
      uOceanMode: { value: 0 },
      // 0 in w means "not the body's sea", which keeps every other water mesh on
      // the flat field it has always used.
      uPlanetSeaCentre: { value: new THREE.Vector4(0, 0, 0, 0) },
      uPlanetSeaRadius: { value: 0 },
      uOceanDepthM: { value: 0.8 },
      uOceanVertexDepth: { value: 0 },
      uSeaFoamM: { value: 0.9 },
      uFlow: { value: new THREE.Vector2(0, 0) },
      uRippleScale: { value: new THREE.Vector2(1, 1) },
      uRippleStrength: { value: 1 },
      uStreakStrength: { value: 0 },
      uRiverFlow: { value: 0 },
      uDeepColor: { value: deepColor },
      uShallowColor: { value: shallowColor },
      uSkyColor: { value: skyColor },
      uSunDir: { value: sunDir },
      uSunColor: { value: sunColor },
      uRiverClip: { value: 0 },
      uRiverWidthM: { value: 0 },
      uChannelMask: { value: null },
      uChannelMaskOrigin: { value: new THREE.Vector2(0, 0) },
      uChannelMaskSize: { value: 1 },
      uChannelMaskAvailable: { value: 0 },
      ...atmosphereUniforms(DEFAULT_ATMOSPHERE),
    },
    vertexShader: WATER_VERTEX_SHADER,
    fragmentShader: WATER_FRAGMENT_SHADER,
    defines: options.edgeFade ? { WATER_EDGE_FADE: 1 } : {},
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return { material, deepColor, shallowColor, skyColor, sunDir, sunColor };
}

/** Uniform holder for the shared model, wrapping the values the shader wants. */
function atmosphereUniforms(params: AtmosphereParams): Record<string, THREE.IUniform> {
  const values = atmosphereUniformValues(params);
  const uniforms: Record<string, THREE.IUniform> = {};
  for (const [name, value] of Object.entries(values)) {
    uniforms[name] = {
      value:
        name === 'uAtmoExtinction'
          ? new THREE.Vector3(...(value as [number, number, number]))
          : value,
    };
  }
  return uniforms;
}

/**
 * Repoint a water material at a different atmosphere.
 *
 * The default is the art-directed day the field was authored with; the live
 * config can move it, and a shader compiled from the default would then disagree
 * with the ground beside it.
 */
export function setWaterAtmosphere(water: WaterMaterial, params: AtmosphereParams): void {
  const values = atmosphereUniformValues(params);
  const uniforms = water.material.uniforms;
  const extinction = uniforms.uAtmoExtinction?.value as THREE.Vector3 | undefined;
  extinction?.set(...(values.uAtmoExtinction as [number, number, number]));
  if (uniforms.uAtmoScaleHeight) uniforms.uAtmoScaleHeight.value = values.uAtmoScaleHeight;
  if (uniforms.uAtmoSunPhaseG) uniforms.uAtmoSunPhaseG.value = values.uAtmoSunPhaseG;
  if (uniforms.uAtmoInScatter) uniforms.uAtmoInScatter.value = values.uAtmoInScatter;
  if (uniforms.uAtmoHorizonBoost) uniforms.uAtmoHorizonBoost.value = values.uAtmoHorizonBoost;
}
