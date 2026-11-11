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
  _pad1: f32,
  _pad2: f32,
  _pad3: f32,
  _pad4: f32,
  _pad5: f32,
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
  _pad: u32,
}

struct PlantRenderData {
  tier: u32,
  visible: u32,
  projectedSize: f32,
  _pad: f32,
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
) -> vec3f {
  // Regular root sight preserves the plant and roots' natural botanical bark/soil colors.
  // Visibility is achieved organically by peeling back the soil envelopes rather than neon recoloring.
  return color;
}

// C02b: GPU skinning helpers live in skinning.wgsl so only the mesh pass
// declares the joint-matrix binding.

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
