// Shared WebGPU structures and helpers.
// Keep this layout in sync with apps/client/src/renderers/webgpu/WebGPURenderer.ts.

struct FrameUniforms {
  viewProjection: mat4x4f,
  projection: mat4x4f,
  cameraPos: vec4f,
  cameraRight: vec4f,
  cameraUp: vec4f,
  cameraForward: vec4f,
  sunDirection: vec4f,
  ownRootColor: vec4f,
  rivalRootColor: vec4f,
  rootSightCenter: vec4f,
  time: f32,
  windStrength: f32,
  windSpeed: f32,
  healthTintStrength: f32,
  mutation0Param: f32,
  mutation1Param: f32,
  mutation2Param: f32,
  viewportHeight: f32,
  rootSightEnabled: u32,
  rootSightProgress: f32,
  rootSightRadius: f32,
  rootSightAuraRadius: f32,
  rootAuraNodeCount: u32,
  tierThreshold0: f32,
  tierThreshold1: f32,
  tierThreshold2: f32,
  tierThreshold3: f32,
  hysteresisPromote: f32,
  hysteresisDemote: f32,
  minDwellTime: f32,
  pointSizeScale: f32,
  proj11: f32,
  deltaTime: f32,
  rootSightSoilOpacity: f32,
  // Planet body used for occlusion: centre and radius. Radius 0 disables it.
  planetCenterX: f32,
  planetCenterY: f32,
  planetCenterZ: f32,
  planetRadius: f32,
  // Is the eye itself under the soil? A buried eye looks at roots through the
  // same medium, so the analytic surface test must not hide them.
  cameraUnderSoil: u32,
  // The radius of the actual hole in the soil, in plan view. Above ground this
  // is what decides which roots are exposed through the opening.
  rootSightApertureRadius: f32,
  // Radius of the air bubble cut around a buried eye (`eye_window_radius_m`).
  // Only this bubble is exempt from the soil test while the eye is under the
  // surface; the rest of the world still hides what the earth stands in front of.
  rootSightEyeWindow: f32,
  // Golden-hour warmth, 0..1. Lit leaves facing away from the sun glow through.
  sunWarmth: f32,
}

// C02b: Per-vertex emergence data for GPU skinning
struct VertexEmergenceData {
  spawnTime: f32,
  growthProgress: f32,
  nodeIndex: u32,
  _pad: u32,
}

// Resource bindings live in the per-pipeline shaders because their indices
// differ between passes (mesh/joints, billboard/impostor, ground, cull).

struct PlantData {
  center: vec4f,
  color: vec4f,
  lastTier: u32,
  dwellTime: f32,
  importance: f32,
  // C02b: OR of the plant's node mutation bits, for billboard tiers.
  mutationMask: u32,
}

struct PlantRenderData {
  tier: u32,
  visible: u32,
  projectedSize: f32,
  blendFactor: f32,
}

// T04 appearance, per plant and per organ family (ADR-059).
//
// One composed look per organ family, so a plant holding several mutations shows
// all of them at once instead of only the strongest (C1). The JS side composes
// and clamps, so the shader only applies what it is handed.
struct LookOrgan {
  // rgb = tint multiplier, a = tint strength
  tintPlus: vec4f,
  // rgb = variegation colour, a = variegation amount
  varPlus: vec4f,
  // rgb = emission colour, a = glow strength
  glowPlus: vec4f,
  // x = pattern id, y = pattern scale, z = bark darkening, w = spare
  patternPlus: vec4f,
}

struct PlantLook {
  foliage: LookOrgan,
  woody: LookOrgan,
  seed: LookOrgan,
  bloom: LookOrgan,
  // Everything the plant is painted with, for the billboard tiers that draw a
  // whole plant as one disc and so cannot choose an organ family.
  disc: LookOrgan,
}

fn lookPatternMottle(p: vec3f, scale: f32) -> f32 {
  let value = sin(p.x * 9.0 * scale + p.y * 5.0 * scale) * sin(p.z * 7.0 * scale - p.y * 3.0 * scale);
  return clamp(0.5 + 0.5 * value, 0.0, 1.0);
}

fn lookPatternSpots(p: vec3f, scale: f32) -> f32 {
  // Two crossed rings read as flecks at any viewing angle, unlike a flat grid.
  let a = sin(p.x * 14.0 * scale) * sin(p.y * 11.0 * scale) * sin(p.z * 13.0 * scale);
  let fleck = smoothstep(0.35, 0.95, abs(a));
  return fleck;
}

fn lookPatternStripes(p: vec3f, scale: f32) -> f32 {
  // Bands across the axis of growth, so a culm reads as segmented.
  return smoothstep(0.1, 0.9, 0.5 + 0.5 * sin(p.y * 22.0 * scale));
}

fn lookPatternVeins(p: vec3f, scale: f32) -> f32 {
  let radial = sqrt(p.x * p.x + p.z * p.z);
  let midrib = 1.0 - smoothstep(0.0, 0.06, radial);
  let branches = abs(sin(atan2(p.z, p.x) * 3.0 + p.y * scale * 4.0));
  return clamp(midrib + smoothstep(0.85, 1.0, branches) * 0.7, 0.0, 1.0);
}

fn lookPatternSheen(p: vec3f, scale: f32) -> f32 {
  // A waxy glaze follows the surface, so it is bright where the normal turns
  // away from the sun - approximated from position noise here.
  let value = sin(p.y * 3.0 * scale) * cos(p.x * 2.0 * scale + p.z * 2.0 * scale);
  return clamp(0.5 + 0.5 * value, 0.0, 1.0);
}

/** A look that paints nothing; also the fallback for an unknown plant. */
fn neutralLookOrgan() -> LookOrgan {
  return LookOrgan(
    vec4f(1.0, 1.0, 1.0, 0.0),
    vec4f(1.0, 1.0, 1.0, 0.0),
    vec4f(0.0, 0.0, 0.0, 0.0),
    vec4f(0.0, 1.0, 0.0, 0.0),
  );
}

/** Paint one organ with its composed look. */
fn applyPlantLook(
  color: vec3f,
  look: LookOrgan,
  worldPosition: vec3f,
  frame: FrameUniforms,
) -> vec3f {
  var result = color;
  // Tint: mix(1, tint, strength) keeps a light pigment light.
  result = result * mix(vec3f(1.0), look.tintPlus.rgb, look.tintPlus.a);
  // Bark darkening is geometry-modulated shading, not a colour change.
  result = result * (1.0 - clamp(look.patternPlus.z, 0.0, 0.6));

  let patternId = u32(round(look.patternPlus.x));
  let patternScale = max(0.05, look.patternPlus.y);
  let variegation = clamp(look.varPlus.a, 0.0, 1.0);
  if (variegation > 0.001 && patternId != 0u) {
    var figure = 0.0;
    if (patternId == 1u) {
      figure = lookPatternMottle(worldPosition, patternScale);
    } else if (patternId == 2u) {
      figure = lookPatternSpots(worldPosition, patternScale);
    } else if (patternId == 3u) {
      figure = lookPatternStripes(worldPosition, patternScale);
    } else if (patternId == 4u) {
      figure = lookPatternVeins(worldPosition, patternScale);
    } else if (patternId == 5u) {
      figure = lookPatternSheen(worldPosition, patternScale);
    }
    if (figure > 0.001) {
      let figureColor = look.varPlus.rgb * (0.62 + 0.38 * figure);
      result = mix(result, figureColor, variegation * figure);
    }
  }
  return result;
}

/**
 * Additive emission, applied after lighting.
 *
 * A bioluminescent lamina has to glow from the tissue, not be shaded like
 * pigment: adding it into the albedo multiplied the glow by the sun and left a
 * night-time plant dark, which is the opposite of what the name promises.
 */
fn lookEmissive(look: LookOrgan, worldPosition: vec3f, frame: FrameUniforms) -> vec3f {
  let glow = clamp(look.glowPlus.a, 0.0, 1.0);
  if (glow <= 0.001) {
    return vec3f(0.0);
  }
  let pulse = 0.68 + 0.32 * sin(frame.time * 1.7 + worldPosition.y * 0.6);
  return look.glowPlus.rgb * (glow * 0.32 * pulse);
}

fn windOffset(position: vec3f, frame: FrameUniforms, swayStiffness: f32) -> vec3f {
  let height = max(0.0, position.y);
  if (height < 0.1 || frame.windStrength < 0.01) {
    return position;
  }

  let factor = (height * height) / (height * height + 64.0);
  let time = frame.time * frame.windSpeed;
  // swayStiffness: 0.15 = very flexible (leaves), 0.45 = stiff (roots)
  let swayAmount = 1.0 - swayStiffness; // invert: lower stiffness = more sway
  let swayX = sin(time * 1.1 + position.y * 0.06) * frame.windStrength * 0.22 * factor * swayAmount;
  let swayZ = cos(time * 0.85 + position.y * 0.06) * frame.windStrength * 0.15 * factor * swayAmount;
  return vec3f(position.x - swayX, position.y, position.z - swayZ);
}

fn applyRootSight(
  color: vec3f,
  worldPosition: vec3f,
  nodeType: f32,
  isOwn: f32,
  frame: FrameUniforms,
) -> vec4f {
  // Root Sight: roots stay opaque. Blending them at 0.5-0.85 alpha showed every
  // tube facet and every segment seam through the ones in front, so the roots
  // looked like they were built out of stacked squares. The soil cutaway (a real
  // hole in the ground plus the pit behind it) is what reveals them now, so the
  // roots only need a slight lift in brightness to separate from the dirt.
  let isRoot = nodeType < 0.5;
  if (frame.rootSightEnabled != 0u && isRoot && frame.rootSightProgress > 0.01) {
    // A neutral lift, not a warm one: the old +0.02 red bias tinted every root
    // maroon under Root Sight, so the bark read as a different material from
    // the same bark above ground.
    return vec4f(color * 1.18 + vec3f(0.02, 0.018, 0.016), 1.0);
  }
  return vec4f(color, 1.0);
}

// C02b: GPU skinning helpers live in skinning.wgsl so only the mesh pass
// declares the joint-matrix binding.

// Soil occlusion shared by every plant pass.
//
// Plants composite on their own canvas, so the WebGL ground can never
// depth-test them. The planet surface is analytic, so it is tested directly
// along the eye-to-fragment segment: anything the earth stands in front of is
// buried. Root Sight carves a bubble, and fragments inside that bubble are let
// through, which is what makes the cavity read as air.
fn soilOccludes(worldPos: vec3f) -> bool {
  let planetRadius = frame.planetRadius;
  if (planetRadius <= 0.0) {
    return false;
  }

  let centre = vec3f(frame.planetCenterX, frame.planetCenterY, frame.planetCenterZ);
  let ro = frame.cameraPos.xyz - centre;
  let toFragment = worldPos - frame.cameraPos.xyz;
  let distanceToFragment = length(toFragment);
  if (distanceToFragment < 0.0001) {
    return false;
  }
  let rd = toFragment / distanceToFragment;

  let b = dot(ro, rd);
  let c = dot(ro, ro) - planetRadius * planetRadius;
  let discriminant = b * b - c;
  if (discriminant < 0.0) {
    return false;
  }
  let root = sqrt(discriminant);
  let nearHit = -b - root;
  let farHit = -b + root;
  var hit = nearHit;
  if (hit <= 0.0) {
    hit = farHit;
  }
  if (hit <= 0.0 || hit >= distanceToFragment) {
    return false;
  }

  // The earth is between the eye and the fragment. The soil is cut in plan view
  // around the cavity, so the test is a cylinder, not a sphere: every root under
  // the opening is exposed whatever its depth, which is what the hole in the
  // ground actually is.
  if (frame.rootSightEnabled != 0u && frame.rootSightProgress > 0.05) {
    let cavityRadius = frame.rootSightRadius * frame.rootSightProgress;
    if (frame.rootSightApertureRadius > 0.0) {
      cavityRadius = frame.rootSightApertureRadius * frame.rootSightProgress;
    }
    if (distance(worldPos.xz, frame.rootSightCenter.xz) <= cavityRadius) {
      return false;
    }
  }
  if (frame.cameraUnderSoil != 0u) {
    // A buried eye is exempt only inside the air bubble around itself. The old
    // blanket `return false` stopped the eye's own cavity reading as solid dirt,
    // but it did it for every fragment in the world: rival plants and their
    // roots were drawn straight through hills from underground.
    if (
      frame.rootSightEyeWindow > 0.0 &&
      distance(worldPos, frame.cameraPos.xyz) <= frame.rootSightEyeWindow * 1.5
    ) {
      return false;
    }
    return true;
  }
  return true;
}

struct RainUniforms {
  streakLength: f32,
  streakWidth: f32,
  maxVelocity: f32,
  particleCount: u32,
  boxWidth: f32,
  boxHeight: f32,
  _pad1: f32,
  _pad2: f32,
}
