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
  _pad6: f32,
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
    return vec4f(color * 1.15 + vec3f(0.02, 0.015, 0.01), 1.0);
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

  // The earth is between the eye and the fragment. Fragments inside the Root
  // Sight bubble are visible; the rest are buried.
  if (frame.rootSightEnabled != 0u && frame.rootSightProgress > 0.05) {
    let cavityRadius = frame.rootSightRadius * frame.rootSightProgress;
    if (distance(worldPos, frame.rootSightCenter.xyz) <= cavityRadius) {
      return false;
    }
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
