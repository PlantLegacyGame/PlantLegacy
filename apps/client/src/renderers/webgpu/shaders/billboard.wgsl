// Tier 2/3/4 billboard pass: camera-facing canopy cards for distant plants.
// Drawn as instanced quads (6 vertices per plant) with no vertex buffer.

struct VertexOutput {
  @builtin(position) clipPosition: vec4f,
  @location(0) uv: vec2f,
  @location(1) worldPosition: vec3f,
  @location(2) color: vec3f,
  @location(3) isOwn: f32,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var<storage, read> renderData: array<PlantRenderData>;
@group(0) @binding(2) var<storage, read> plants: array<PlantData>;

fn hiddenVertex() -> VertexOutput {
  return VertexOutput(
    vec4f(2.0, 2.0, 2.0, 1.0),
    vec2f(0.0, 0.0),
    vec3f(0.0, 0.0, 0.0),
    vec3f(0.0, 0.0, 0.0),
    0.0,
  );
}

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOutput {
  if (instanceIndex >= arrayLength(&renderData) || instanceIndex >= arrayLength(&plants)) {
    return hiddenVertex();
  }

  let renderInfo = renderData[instanceIndex];
  if (renderInfo.visible == 0u || renderInfo.tier < 2u) {
    return hiddenVertex();
  }

  let corners = array<vec2f, 6>(
    vec2f(0.0, 0.0),
    vec2f(1.0, 0.0),
    vec2f(0.0, 1.0),
    vec2f(1.0, 0.0),
    vec2f(1.0, 1.0),
    vec2f(0.0, 1.0),
  );
  let corner = corners[vertexIndex];

  let plant = plants[instanceIndex];
  let center = plant.center.xyz;
  let radius = max(0.05, plant.center.w);
  let isOwn = plant.color.w;

  var size = radius * 1.2;
  if (renderInfo.tier == 2u) {
    size = radius * 2.0;
  } else if (renderInfo.tier == 3u) {
    size = radius * 1.6;
  }

  let worldPosition = center
    + frame.cameraRight.xyz * (corner.x - 0.5) * size
    + frame.cameraUp.xyz * (corner.y - 0.5) * size;

  let clipPosition = frame.viewProjection * vec4f(worldPosition, 1.0);

  return VertexOutput(
    clipPosition,
    corner,
    worldPosition,
    plant.color.rgb,
    isOwn,
  );
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let distanceFromCenter = length(input.uv - vec2f(0.5)) * 2.0;
  var alpha = 1.0 - smoothstep(0.45, 1.0, distanceFromCenter);
  if (alpha < 0.04) {
    discard;
  }

  // Cheap leafy breakup so distant plants do not read as flat discs.
  let noise = 1.0;
  // let noise = 0.5 + 0.5 * sin(input.uv.x * 37.0 + input.uv.y * 19.0 + frame.time * 0.15);
  alpha *= 0.72 + 0.28 * noise;

  // Approximate leaf normal: outward from center, slightly upward
  let viewDir = normalize(input.worldPosition - frame.cameraPos.xyz);
  let up = vec3f(0.0, 1.0, 0.0);
  let approxNormal = normalize(up * 0.7 + viewDir * 0.3);
  
  let sunDirection = normalize(frame.sunDirection.xyz);
  let nDotL = max(dot(approxNormal, sunDirection), 0.0);
  let light = 0.25 + 0.75 * nDotL;

  var color = input.color * light;

  // Rim light for depth
  let rim = pow(1.0 - max(dot(approxNormal, viewDir), 0.0), 2.0) * 0.15;
  color += vec3f(0.12, 0.22, 0.12) * rim;

  if (frame.mutation0Param > 0.01) {
    color += vec3f(0.20, 0.75, 0.45) * (frame.mutation0Param * 0.18);
  }

  color = applyRootSight(color, input.worldPosition, 1.0, input.isOwn, frame);
  return vec4f(color * alpha, alpha);
}
