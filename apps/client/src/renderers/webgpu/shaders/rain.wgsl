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
  @location(2) groundY: f32,
  @builtin(vertex_index) vertexIndex: u32,
}

struct VertexOutput {
  @builtin(position) clipPosition: vec4f,
  @location(0) uv: vec2f,
  @location(1) velocity: f32,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var<uniform> rain: RainUniforms;
// `groundBlocks()` and its height map come from `groundMap.wgsl`, shared with the
// mesh pass. The map sits at binding 10 of this pass's layout.

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

  // The column stands on the terrain: a drop wraps through the box height above
  // the ground under it, so rain lands on the slope instead of falling through
  // it. The box itself is placed over the viewer when the instances are built.
  let pos = vec3f(home.x, input.groundY + cycle * boxHeight, home.z);

  // No water inside the earth. This pass has no depth buffer to test against the
  // drawn ground, so a drop beyond the planet's bulk - past a ridge, over the
  // horizon - was painted on top of the dirt it should be behind. Collapsing the
  // quad puts it outside the clip volume, where it costs nothing.
  if (soilOccludes(pos) || groundBlocks(pos)) {
    output.uv = vec2f(0.0);
    output.velocity = velocity;
    output.clipPosition = vec4f(0.0, 0.0, -2.0, 1.0);
    return output;
  }

  // Each drop its own lean, so the shower is not one ruled line.
  let lean = (seed - 0.5) * 0.5;
  let fall = normalize(vec3f(lean, -1.0, lean * 0.35));
  let speedShare = clamp(velocity / max(rain.maxVelocity, 0.001), 0.0, 1.0);

  // Short enough to read as a drop: a quarter of the old length at the top of the
  // speed range, and still varied per drop.
  var streakLength = rain.streakLength * (0.35 + 0.5 * speedShare) * (0.5 + 0.9 * seed);
  // A droplet keeps an aspect: the head has to be a few pixels wide or the quad
  // is a subpixel hairline that reads as a white tick. The configured width is
  // the floor, 7% of the streak the working width.
  var width = max(rain.streakWidth * (0.7 + 1.1 * seed), streakLength * 0.07);

  // A triangle list has no four-vertex quad: drawing four vertices per instance
  // gave one triangle per drop, which is why rain read as white ticks. Six
  // corners make the two triangles back to back.
  let quadCorners = array<u32, 6>(0u, 1u, 2u, 2u, 1u, 3u);
  let localOffset = array<vec4f, 4>(
    vec4f(-0.5, -0.5, 0.0, 0.0),
    vec4f(0.5, -0.5, 0.0, 0.0),
    vec4f(-0.5, 0.5, 0.0, 0.0),
    vec4f(0.5, 0.5, 0.0, 0.0),
  );
  let local = localOffset[quadCorners[input.vertexIndex]];

  // Face the camera in width, follow the world fall axis in length.
  let toEye = frame.cameraPos.xyz - pos;
  let eyeDistance = length(toEye);
  // A drop a hand's width from the eye covers most of the screen, and every one
  // of those is a full-screen blended quad: shrink them away before they cost
  // the fill. Water that close is a blur, not a streak.
  let apart = smoothstep(0.4, 1.8, eyeDistance);
  streakLength *= apart;
  width *= apart;
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

  // A droplet: a round bead low in the quad, and a tail that narrows as it
  // climbs, so the silhouette tapers to a point instead of reading as a wedge.
  let bead = 1.0 - smoothstep(0.3, 0.55, length(vec2f(x, (y - 0.16) * 2.2)));
  let tailHalfWidth = mix(0.36, 0.04, smoothstep(0.16, 1.0, y));
  let tail = (1.0 - smoothstep(tailHalfWidth * 0.55, tailHalfWidth, abs(x))) * smoothstep(0.16, 0.3, y);
  let shape = clamp(max(bead, tail * 0.8), 0.0, 1.0);

  let speedShare = clamp(input.velocity / max(rain.maxVelocity, 0.001), 0.0, 1.0);
  // The light the drops fall through, and how much of it there is: the same
  // sky-tinted colour and dimming the three.js drops use, so the shower goes
  // grey-blue at dusk and nearly out at midnight instead of staying white.
  let alpha = shape * mix(0.95, 0.5, y) * (0.7 - 0.25 * speedShare) * rain.level;
  if (alpha < 0.004) {
    discard;
  }
  // Water, not a lamp: the tinted light, cooler at the tail. Mixed by the alpha
  // in the blend, so the colour is the lit value and the alpha the weight - the
  // old pipeline blended it as if premultiplied, which made every drop white.
  return vec4f(rain.color * mix(1.0, 0.86, 1.0 - y), alpha);
}
