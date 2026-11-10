// Ground plane shader for WebGPU renderer.
// Renders opaque ground plane at y = -0.03 matching Three.js ground position.

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) uv: vec2f,
}

struct VertexOutput {
  @builtin(position) clipPosition: vec4f,
  @location(0) uv: vec2f,
  @location(1) worldPosition: vec3f,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;

// Stable 2D hash for coherent noise
fn hash2(p: vec2f) -> f32 {
  var p3 = fract(p * vec2f(0.1031, 0.11367));
  p3 += dot(p3, p3.yx + 19.19);
  return fract((p3.x + p3.y) * 63.789);
}

// Smooth interpolated value noise
fn valueNoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let f2 = f * f * (3.0 - 2.0 * f); // smoothstep

  let a = hash2(i);
  let b = hash2(i + vec2f(1.0, 0.0));
  let c = hash2(i + vec2f(0.0, 1.0));
  let d = hash2(i + vec2f(1.0, 1.0));

  return mix(mix(a, b, f2.x), mix(c, d, f2.x), f2.y);
}

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
  let worldPosition = input.position;
  let clipPosition = frame.viewProjection * vec4f(worldPosition, 1.0);
  return VertexOutput(clipPosition, input.uv, worldPosition);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  // Solid soil color with very subtle low-frequency variation
  let baseColor = vec3f(0.22, 0.16, 0.11);
  // Large-scale noise (scale 0.002 = variation every ~500 units)
  let noise = valueNoise(input.worldPosition.xz * 0.002) * 0.02;
  let color = baseColor + vec3f(noise);
  
  // Always opaque ground - root cutaway handled by plant shader
  return vec4f(color, 1.0);
}