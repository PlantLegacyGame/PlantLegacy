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
  /** Water column the sea uses where the ground grid does not reach. */
  uniform float uOceanDepthM;
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
      waterColumn = uOceanDepthM;
      if (uGroundHeightAvailable > 0.5) {
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
      if (vWaterDepth < uMinVisibleDepth) discard;
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
    if (uCavityRadius > 0.0) {
      vec2 cavity = vWaterWorld.xz - uCavityCenter;
      // The column is the opening, at every height: the ground inside it is cut
      // away, so no water surface belongs in front of the roots. The three ray
      // heuristics this replaces reached across the map - the closest-point test
      // is a strip through the cavity centre, so a lower river seen past an
      // open pit lost a seam of water.
      if (dot(cavity, cavity) < uCavityRadius * uCavityRadius) discard;
    }
    // Water right at the camera clips through the near plane and smears a sheet
    // across the view; dropping those fragments keeps the waterline stable.
    if (distance(cameraPosition, vWaterWorld) < uNearDiscard) discard;

    vec3 viewDir = normalize(cameraPosition - vWaterWorld);

    // Water coordinates for the wave field. The river carries its own: metres
    // downstream and lateral offset. Sampling in world XZ instead painted
    // diagonal bands that had nothing to do with where the river goes.
    vec2 waterUV = vWaterWorld.xz;
    if (uRiverFlow > 0.5) {
      waterUV = vec2(vFlowUV.x - uTime * uFlow.x, vFlowUV.y * uRiverWidthM * 0.5);
    } else {
      waterUV -= uFlow * uTime;
    }

    vec2 ripplePos = waterUV * uRippleScale;
    vec3 normal = uOceanMode > 0.5
      ? normalize(mix(vec3(0.0, 1.0, 0.0), seaNormal(ripplePos, uTime), uRippleStrength))
      : mix(vec3(0.0, 1.0, 0.0), rippleNormal(ripplePos, uTime), uRippleStrength);
    // Fresnel from the *undisturbed* surface. It was taken from the rippled
    // normal, and with a ripple strength of 2.4 the sheet's facing swung through
    // most of its range every couple of metres: the sky/bed mix alternated with
    // it and the water read as concentric contour bands rather than a surface.
    // Ripples belong in the highlight, where their scale is a glint and not a
    // region of the water.
    float facing = clamp(viewDir.y, 0.0, 1.0);
    float fresnel = pow(1.0 - facing, 2.0);
    // A sea's glitter path is wide: the same tight exponent a puddle uses gives a
    // handful of isolated points on open water, which reads as flatness.
    float specPower = uOceanMode > 0.5 ? 18.0 : 48.0;
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
    float skyMix = uOceanMode > 0.5
      ? clamp(0.34 + 0.85 * fresnel + 0.6 * (normal.x * uSunDir.x + normal.z * uSunDir.z), 0.0, 0.97)
      : clamp(0.34 + 0.6 * fresnel, 0.0, 0.95);
    vec3 color = mix(body, uSkyColor, skyMix);
    color += uSkyColor * (0.1 * fresnel) + uSunColor * specular * (uOceanMode > 0.5 ? 2.2 : 1.3);

    // Downstream streaks: bands across the flow that travel with it. Ripples
    // alone are invisible from a distance, which is why a river looked like a
    // standing pond even though its surface was moving.
    // Bands across the flow that travel downstream, plus a finer riffle line on
    // the faster phase: two speeds read as water moving over a bed, where one
    // speed just reads as a scrolling texture.
    float streakPhase = waterUV.y * 2.3 + waterUV.x * 0.35;
    float streaks = 0.5 + 0.5 * sin(streakPhase);
    float riffle = smoothstep(0.72, 1.0, 0.5 + 0.5 * sin(waterUV.y * 6.1 + waterUV.x * 0.9));
    color = mix(color, uSkyColor * 1.08, uStreakStrength * (0.16 * streaks + 0.1 * riffle));

    // Shallow water is see-through, so the stained ground under it shows; deep
    // water hides the bottom.
    // Shallow water is mostly window, deep water mostly surface. It used to start
    // at half opacity, which hid the bed under a film that should be clear.
    float alpha = uOpacity * mix(0.34, 0.95, 1.0 - transmit);
    alpha *= 1.0 - smoothstep(uFadeRange.x, uFadeRange.y, distance(cameraPosition, vWaterWorld));
    if (uSheetFade.y > 0.0) {
      alpha *= 1.0 - smoothstep(
        uSheetFade.x,
        uSheetFade.y,
        distance(vWaterWorld.xz, uSheetCenter)
      );
    }
    #ifdef WATER_EDGE_FADE
      // Thin films fade at the edge so a puddle has no polygon rim.
      alpha *= uOceanMode > 0.5
        // A sea meets its shore where the bed reaches the surface: the waterline
        // is crisp, and a band of foam sits just outside it, so the edge follows
        // the ground instead of the mesh's own outline.
        ? smoothstep(0.0, 0.06, waterColumn)
        : smoothstep(uMinVisibleDepth, uMinVisibleDepth * 4.0, vWaterDepth);
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
    if (viewDir.y < 0.0) {
      float cosUp = clamp(-viewDir.y, 0.0, 1.0);
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
      float foam = 1.0 - smoothstep(0.0, max(0.05, uSeaFoamM), waterColumn);
      foam *= 0.75 + 0.25 * sin(waterColumn * 9.0 + uTime * 1.7);
      color = mix(color, uSkyColor * 1.08, clamp(foam * 0.5, 0.0, 0.5));
      alpha = max(alpha, foam * 0.5);
    }

    if (alpha < 0.01) discard;
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
  const deepColor = new THREE.Color(0x163a45);
  const shallowColor = new THREE.Color(0x5aa3b0);
  const skyColor = new THREE.Color(0x9ecfe4);
  const sunDir = new THREE.Vector3(0.4, 0.8, 0.3);
  const sunColor = new THREE.Color(0xfff3d6);
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
      uOceanDepthM: { value: 0.8 },
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
