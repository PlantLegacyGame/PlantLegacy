// Tier 2/3/4 billboard pass: camera-facing canopy cards for distant plants.
// Drawn as instanced quads (6 vertices per plant) with no vertex buffer.
// C02b: Supports impostor atlas sampling for pre-baked plant views.
// C02b: Texture arrays for plant variation.

struct VertexOutput {
  @builtin(position) clipPosition: vec4f,
  @location(0) uv: vec2f,
  @location(1) worldPosition: vec3f,
  @location(2) color: vec3f,
  @location(3) isOwn: f32,
  @location(4) @interpolate(flat) plantIndex: u32,
  @location(5) @interpolate(flat) tier: u32,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var<storage, read> renderData: array<PlantRenderData>;
@group(0) @binding(2) var<storage, read> plants: array<PlantData>;
// C02b: Impostor atlas
@group(0) @binding(9) var impostorAtlas: texture_2d<f32>;
@group(0) @binding(10) var impostorSampler: sampler;
// C02b: Impostor slot lookup (plant index -> atlas slot x,y)
@group(0) @binding(11) var<storage, read> impostorSlots: array<vec2<u32>>;

// C02b: Texture arrays for plant variation (bindings 3-8).
@group(0) @binding(3) var barkTextureArray: texture_2d_array<f32>;
@group(0) @binding(4) var leafTextureArray: texture_2d_array<f32>;
@group(0) @binding(5) var flowerTextureArray: texture_2d_array<f32>;
@group(0) @binding(6) var sporeSacTextureArray: texture_2d_array<f32>;
@group(0) @binding(7) var seedTextureArray: texture_2d_array<f32>;
@group(0) @binding(8) var textureArraySampler: sampler;

// Atlas constants
const IMPOSTOR_ATLAS_SIZE: f32 = 1024.0;
const IMPOSTOR_TILE_SIZE: f32 = 128.0;
const IMPOSTOR_VIEWS_HORIZONTAL: u32 = 8;
const IMPOSTOR_VIEWS_VERTICAL: u32 = 2;

fn hiddenVertex() -> VertexOutput {
  return VertexOutput(
    vec4f(2.0, 2.0, 2.0, 1.0),
    vec2f(0.0, 0.0),
    vec3f(0.0, 0.0, 0.0),
    vec3f(0.0, 0.0, 0.0),
    0.0,
    0u,
    4u,
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
    instanceIndex,
    renderInfo.tier,
  );
}

fn calculateImpostorUV(plantIndex: u32, cameraRight: vec3f, cameraUp: vec3f, cameraForward: vec3f) -> vec2f {
  // Get the plant's atlas slot
  let slot = impostorSlots[plantIndex];
  if (slot.x == 0u && slot.y == 0u && plantIndex > 0u) {
    // No impostor baked for this plant, return invalid UV
    return vec2f(-1.0, -1.0);
  }

  // Calculate view direction in horizontal plane
  let right = cameraRight.xz;
  let forward = cameraForward.xz;
  var angle = atan2(right.x, forward.x); // -PI to PI
  if (angle < 0.0) { angle += 2.0 * 3.14159265359; }
  
  // Determine horizontal view index (0-7)
  let hIndex = u32(floor(angle / (2.0 * 3.14159265359) * f32(IMPOSTOR_VIEWS_HORIZONTAL)));
  let hIndexClamped = min(hIndex, IMPOSTOR_VIEWS_HORIZONTAL - 1u);
  
  // Determine vertical view index (0=top 45°, 1=side 30°)
  // Based on camera elevation
  let cameraUpY = cameraUp.y;
  let vIndex = select(1u, 0u, cameraUpY > 0.5); // Top view if looking down more than 45°
  
  // Calculate UV within the atlas
  // Each plant slot is 8 tiles wide, 2 tiles tall
  let slotX = f32(slot.x) * IMPOSTOR_TILE_SIZE * f32(IMPOSTOR_VIEWS_HORIZONTAL);
  let slotY = f32(slot.y) * IMPOSTOR_TILE_SIZE * f32(IMPOSTOR_VIEWS_VERTICAL);
  
  let viewX = slotX + f32(hIndexClamped) * IMPOSTOR_TILE_SIZE;
  let viewY = slotY + f32(vIndex) * IMPOSTOR_TILE_SIZE;
  
  // Convert to normalized UV coordinates
  let uv = vec2f(
    (viewX + 0.5) / IMPOSTOR_ATLAS_SIZE,
    (viewY + 0.5) / IMPOSTOR_ATLAS_SIZE,
  );
  
  return uv;
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

  // C02b: Texture array sampling for plant variation on billboards
  // Select texture array based on LOD tier (similar to mesh shader nodeType logic)
  // Tier 2 (closer): trunk/stem visible -> bark texture
  // Tier 3-4 (distant): canopy -> leaf texture
  let variationIndex = u32(f32(input.plantIndex) * 0.1234567) & 0xfu;
  let texColor = select(
    textureSampleLevel(barkTextureArray, textureArraySampler, input.uv, variationIndex, 0.0).rgb,
    textureSampleLevel(leafTextureArray, textureArraySampler, input.uv, variationIndex, 0.0).rgb,
    input.tier >= 3u
  );
  color = mix(color, texColor, 0.5); // Blend with procedural color

  color = applyRootSight(color, input.worldPosition, 1.0, input.isOwn, frame);
  
  // C02b: Impostor atlas sampling
  let impostorUV = calculateImpostorUV(input.plantIndex, frame.cameraRight.xyz, frame.cameraUp.xyz, -frame.cameraForward.xyz);
  let hasImpostor = impostorUV.x >= 0.0;
  let impostorColor = textureSampleLevel(impostorAtlas, impostorSampler, impostorUV, 0.0).rgb;
  color = mix(color, impostorColor, select(0.0, 0.5, hasImpostor));

  return vec4f(color * alpha, alpha);
}
