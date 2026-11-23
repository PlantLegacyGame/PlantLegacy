// Rain for the WebGPU pass.
//
// Drops are camera-facing quads built along each drop's own fall axis. A drop is
// a round head with the water it has passed through trailing above it, and every
// drop leans, stretches and thickens differently, keyed off its own position.
// The old shader stretched every quad along the screen's up axis with one
// hardcoded blue, which is why rain read as a wall of identical blue lines.

// The instance buffer is the only vertex buffer this pass binds: each instance
// is one drop (world position + fall velocity), and the quad corners come from
// the vertex index. Reading a per-vertex quad buffer instead left every corner
// of a drop identical, which is a zero-area quad and no visible rain at all.
struct VertexInput {
  @location(0) instancePosition: vec3f,
  @location(1) velocity: f32,
  @builtin(vertex_index) vertexIndex: u32,
}

struct VertexOutput {
  @builtin(position) clipPosition: vec4f,
  @location(0) uv: vec2f,
  @location(1) velocity: f32,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var<uniform> rain: RainUniforms;

/** Stable per-drop random in 0..1, from where the drop is. */
fn dropSeed(position: vec3f) -> f32 {
  let h = sin(dot(position.xz, vec2f(12.9898, 78.233))) * 43758.5453;
  return fract(h);
}

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;

  let home = input.instancePosition;
  let velocity = input.velocity;
  let seed = dropSeed(home);

  // The drops fall: each one wraps through the box height on its own clock, so
  // the field stays full and the shower reads as moving water rather than a
  // field of static sprinkles.
  let fallSpeed = rain.maxVelocity * velocity;
  let boxHeight = max(rain.boxHeight, 0.001);
  // `fract` rather than a remainder: WGSL has no `mod`, and `%` keeps the
  // dividend's sign, which would drop half the field below the box.
  let cycle = fract((home.y - frame.time * fallSpeed) / boxHeight);

  // The field follows the eye. Each drop owns a world position, so the copy that
  // falls outside the box wraps exactly one box width round to the far side;
  // walking then moves the viewer through standing weather, and the volume never
  // runs out behind you.
  let eye = frame.cameraPos.xyz;
  let boxWidth = max(rain.boxWidth, 0.001);
  let halfWidth = boxWidth * 0.5;
  let wrapped = (fract((home.xz - eye.xz + halfWidth) / boxWidth) - 0.5) * boxWidth;
  let pos = vec3f(
    eye.x + wrapped.x,
    eye.y - boxHeight * 0.3 + cycle * boxHeight,
    eye.z + wrapped.y,
  );

  // Each drop its own lean, so the shower is not one ruled line.
  let lean = (seed - 0.5) * 0.5;
  let fall = normalize(vec3f(lean, -1.0, lean * 0.35));
  let speedShare = clamp(velocity / max(rain.maxVelocity, 0.001), 0.0, 1.0);

  // Short enough to read as a drop: a quarter of the old length at the top of the
  // speed range, and still varied per drop.
  let streakLength = rain.streakLength * (0.2 + 0.35 * speedShare) * (0.5 + 0.9 * seed);
  let width = rain.streakWidth * (0.7 + 1.1 * seed);

  let localOffset = array<vec4f, 4>(
    vec4f(-0.5, -0.5, 0.0, 0.0),
    vec4f(0.5, -0.5, 0.0, 0.0),
    vec4f(-0.5, 0.5, 0.0, 0.0),
    vec4f(0.5, 0.5, 0.0, 0.0),
  );
  let local = localOffset[input.vertexIndex];

  // Face the camera in width, follow the world fall axis in length.
  let toEye = frame.cameraPos.xyz - pos;
  var side = cross(fall, toEye);
  if (dot(side, side) < 1e-6) {
    side = vec3f(1.0, 0.0, 0.0);
  }
  side = normalize(side);

  output.uv = local.xy + vec2f(0.5, 0.5);
  output.velocity = velocity;
  output.clipPosition = frame.viewProjection * vec4f(
    pos + fall * (local.y * streakLength) + side * (local.x * width),
    1.0,
  );
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let x = (input.uv.x - 0.5) * 2.0;
  let y = input.uv.y;

  let head = 1.0 - smoothstep(0.55, 1.0, length(vec2f(x, (y - 0.12) * 4.0)));
  let girth = mix(0.62, 0.14, y);
  let tail = (1.0 - smoothstep(0.0, girth, abs(x))) * smoothstep(0.02, 0.24, y);
  let shape = clamp(max(head, tail * 0.7), 0.0, 1.0);

  let speedShare = clamp(input.velocity / max(rain.maxVelocity, 0.001), 0.0, 1.0);
  let alpha = shape * mix(0.9, 0.42, y) * (0.55 - 0.2 * speedShare);
  if (alpha < 0.004) {
    discard;
  }
  // Water, not a lamp: neutral grey, cooler in the tail, never additive.
  return vec4f(mix(vec3f(0.66, 0.71, 0.75), vec3f(0.84, 0.88, 0.91), 1.0 - y), alpha);
}
