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

// Root aura bindings for this pipeline's layout.
@group(0) @binding(9) var rootAuraTexture: texture_2d<f32>;
@group(0) @binding(10) var rootAuraSampler: sampler;

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
  var rimShade: f32 = 1.0;

  // Root Sight organic cutaway:
  // Instead of a rigid spherical cutaway, we carve smooth organic envelopes ("air bubbles")
  // around each underground root and subterranean growth.
  if (frame.rootSightEnabled != 0u && frame.rootSightProgress > 0.01) {
    let progress = frame.rootSightProgress;
    let baseRadius = max(1.2, frame.rootSightAuraRadius * 0.75) * progress;
    let k: f32 = 0.55; // Smooth minimum blend radius between bubbles

    // Start with the focal root sight center (seed / base)
    let centerDist = distance(input.worldPosition.xz, frame.rootSightCenter.xz) - (baseRadius * 0.85);
    var minEnvelopeDist: f32 = centerDist;

    // Union smooth envelopes around all subterranean nodes (roots, radicles of all plants)
    let count = min(frame.rootAuraNodeCount, 64u);
    for (var i: u32 = 0u; i < count; i++) {
      let texCoord = vec2f((f32(i) + 0.5) / 64.0, 0.5);
      let nodeData = textureSample(rootAuraTexture, rootAuraSampler, texCoord);
      let nodePos = nodeData.xyz;
      let nodeRadius = max(0.3, nodeData.w);

      // Organic bubble radius around this root element
      let r = baseRadius * (0.8 + nodeRadius * 0.5);
      let d = distance(input.worldPosition.xz, nodePos.xz) - r;

      // Smooth minimum blend
      let h = clamp(0.5 + 0.5 * (d - minEnvelopeDist) / k, 0.0, 1.0);
      minEnvelopeDist = mix(d, minEnvelopeDist, h) - k * h * (1.0 - h);
    }

    // Cutaway with smooth dithered edge and soil rim darkening
    let edgeWidth: f32 = 0.18;
    if (minEnvelopeDist < 0.0) {
      if (minEnvelopeDist < -edgeWidth) {
        discard;
      }
      // Smooth dithered edge in transition zone [-edgeWidth, 0.0]
      let alpha = (minEnvelopeDist + edgeWidth) / edgeWidth;
      let dither = hash2(input.clipPosition.xy);
      if (dither > alpha) {
        discard;
      }
    }

    // Darken and soften dirt along the cutaway rim for natural soil depth
    if (minEnvelopeDist >= 0.0 && minEnvelopeDist < 0.5) {
      rimShade = smoothstep(0.0, 0.5, minEnvelopeDist);
    }
  }

  // Solid soil color with subtle low-frequency variation
  let baseColor = vec3f(0.22, 0.16, 0.11);
  // Large-scale noise (scale 0.002 = variation every ~500 units)
  let noise = valueNoise(input.worldPosition.xz * 0.002) * 0.02;
  var color = baseColor + vec3f(noise);
  color = mix(baseColor * 0.65, color, rimShade);
  
  return vec4f(color, 1.0);
}