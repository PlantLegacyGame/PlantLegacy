// Rain shader for WebGPU renderer.
// Renders rain streaks as camera-facing quads with velocity-based stretching.

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) instanceData: vec4f,
  @builtin(instance_index) instanceIndex: u32,
}

struct VertexOutput {
  @builtin(position) clipPosition: vec4f,
  @location(0) worldPosition: vec3f,
  @location(1) velocity: f32,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var<uniform> rain: RainUniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;

  // Get instance data from vertex buffer
  let pos = input.instanceData.xyz;
  let velocity = input.instanceData.w;

  // Camera-facing quad for rain streak
  let streakLength = rain.streakLength * velocity / rain.maxVelocity;
  let streakDir = normalize(vec3f(0.0, -1.0, 0.1)); // Slight wind drift

  // Create quad vertices in local space
  let localOffset = array<vec3f, 4>(
    vec3f(-0.5, -0.5, 0.0), // bottom-left
    vec3f(0.5, -0.5, 0.0),  // bottom-right
    vec3f(-0.5, 0.5, 0.0),  // top-left
    vec3f(0.5, 0.5, 0.0),   // top-right
  );

  let vertIndex = input.instanceIndex % 4u;
  let localPos = localOffset[vertIndex];

  // Scale quad: thin and long (streak)
  let quadSize = vec2f(rain.streakWidth, streakLength);
  let worldOffset = vec3f(localPos.x * quadSize.x, localPos.y * quadSize.y, localPos.z);
  
  // Camera-facing: use precomputed camera right/up vectors from frame uniforms
  let right = frame.cameraRight.xyz;
  let up = frame.cameraUp.xyz;
  let worldPos = pos + worldOffset.x * right + worldOffset.y * up;

  output.worldPosition = worldPos;
  output.velocity = velocity;
  output.clipPosition = frame.viewProjection * vec4f(worldPos, 1.0);
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  // Soft circular alpha for rain drop
  var alpha = 0.7;
  
  // Fade based on velocity (faster = more transparent)
  alpha *= 0.5 + 0.5 * (1.0 - input.velocity / rain.maxVelocity);
  
  return vec4f(0.6, 0.75, 0.95, alpha); // Cool rain color
}