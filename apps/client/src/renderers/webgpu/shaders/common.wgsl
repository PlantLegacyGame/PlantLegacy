// Shared WebGPU structures and helpers.
// Keep this layout in sync with apps/client/src/renderers/webgpu/WebGPURenderer.ts.

struct FrameUniforms {
  viewProjection: mat4x4f,
  projection: mat4x4f,
  cameraPos: vec4f,
  cameraRight: vec4f,
  cameraUp: vec4f,
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

// Root aura bindings at high indices to avoid conflicts with pipeline-specific bindings
@group(0) @binding(8) var rootAuraTexture: texture_2d<f32>;
@group(0) @binding(9) var rootAuraSampler: sampler;

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

fn windOffset(position: vec3f, frame: FrameUniforms) -> vec3f {
  let height = max(0.0, position.y);
  if (height < 0.1 || frame.windStrength < 0.01) {
    return position;
  }

  let factor = (height * height) / (height * height + 64.0);
  let time = frame.time * frame.windSpeed;
  let swayX = sin(time * 1.1 + position.y * 0.06) * frame.windStrength * 0.22 * factor;
  let swayZ = cos(time * 0.85 + position.y * 0.06) * frame.windStrength * 0.15 * factor;
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

fn sampleRootAuraSDF(worldPos: vec3f, frame: FrameUniforms) -> f32 {
  if (frame.rootAuraNodeCount == 0u) {
    return 0.0;
  }
  
  let count = min(frame.rootAuraNodeCount, 64u);
  var sdfDist: f32 = 1000.0; // Large initial distance
  
  let auraRadius = frame.rootSightAuraRadius;
  let capsuleRadius = auraRadius * 0.5;
  
  for (var i: u32 = 0u; i < count; i++) {
    let idx = f32(i);
    let texCoord = vec2f((idx + 0.5) / 64.0, 0.5);
    let nodeData = textureSample(rootAuraTexture, rootAuraSampler, texCoord);
    let nodePos = nodeData.xyz;
    let valid = nodeData.w;
    
    // Compute capsule SDF for this root node
    // Capsule from nodePos to slightly above (for vertical roots)
    let segmentHeight = auraRadius;
    let segmentCenter = nodePos + vec3f(0.0, segmentHeight * 0.5, 0.0);
    let toCenter = worldPos - segmentCenter;
    let dy = abs(toCenter.y) - segmentHeight * 0.5;
    let dxz = length(toCenter.xz);
    var capsuleDist = max(dxz - capsuleRadius, dy);
    capsuleDist = min(capsuleDist, max(dxz, dy));
    
    // Smooth minimum (smin) to blend capsules into one continuous volume
    let k = auraRadius * 0.3; // Blend factor
    let h = clamp(0.5 + 0.5 * (capsuleDist - sdfDist) / k, 0.0, 1.0);
    sdfDist = mix(capsuleDist, sdfDist, h) - k * h * (1.0 - h);
  }
  
  // Convert SDF distance to strength (1 at surface, 0 at radius)
  let strength = 1.0 - smoothstep(0.0, auraRadius, max(sdfDist, 0.0));
  return strength;
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
