// Tier 0/1 mesh pass: tapered branch tubes and leaf cards.

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) packed: u32,
}

struct VertexOutput {
  @builtin(position) clipPosition: vec4f,
  @location(0) worldPosition: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) nodeType: f32,
  @location(4) isOwn: f32,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var<storage, read> renderData: array<PlantRenderData>;

fn hiddenVertex() -> VertexOutput {
  return VertexOutput(
    vec4f(2.0, 2.0, 2.0, 1.0),
    vec3f(0.0, 0.0, 0.0),
    vec3f(0.0, 1.0, 0.0),
    vec2f(0.0, 0.0),
    0.0,
    0.0,
  );
}

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
  let plantIndex = input.packed & 0xffffu;
  if (plantIndex >= arrayLength(&renderData)) {
    return hiddenVertex();
  }

  let renderInfo = renderData[plantIndex];
  if (renderInfo.visible == 0u || renderInfo.tier > 1u) {
    return hiddenVertex();
  }

  let nodeType = f32((input.packed >> 16u) & 0xffu);
  let isOwn = f32((input.packed >> 24u) & 0x1u);

  var worldPosition = windOffset(input.position, frame);

  // Outline type (8): expand along normal for outline effect
  let isOutline = nodeType >= 7.5 && nodeType < 8.5;
  let outlineOffset = select(0.0, 0.025, isOutline);
  worldPosition += input.normal * outlineOffset;

  let clipPosition = frame.viewProjection * vec4f(worldPosition, 1.0);

  return VertexOutput(
    clipPosition,
    worldPosition,
    input.normal,
    input.uv,
    nodeType,
    isOwn,
  );
}

@fragment
fn fs_main(input: VertexOutput, @builtin(front_facing) frontFacing: bool) -> @location(0) vec4f {
  var normal = normalize(input.normal);
  if (!frontFacing) {
    normal = -normal;
  }

  // Outline type (8): gold wireframe
  let isOutline = input.nodeType >= 7.5 && input.nodeType < 8.5;

  var baseColor = vec3f(0.34, 0.62, 0.20);
  if (isOutline) {
    baseColor = vec3f(1.0, 0.84, 0.0); // Gold
  } else if (input.nodeType < 0.5) {
    baseColor = vec3f(0.38, 0.28, 0.18); // Root: brown
  } else if (input.nodeType < 1.5) {
    baseColor = vec3f(0.22, 0.55, 0.22); // Stem: green
  } else if (input.nodeType < 2.5) {
    baseColor = vec3f(0.26, 0.48, 0.16); // Vine: darker green
  } else if (input.nodeType < 3.5) {
    // Leaf: vibrant green
    baseColor = vec3f(0.20, 0.70, 0.25);
  } else if (input.nodeType < 4.5) {
    // Seed: rich organic brown with subtle golden-amber seed-coat tone
    baseColor = vec3f(0.42, 0.28, 0.16);
  } else if (input.nodeType < 5.5) {
    // Flower: pink/red
    baseColor = vec3f(0.95, 0.35, 0.45);
  } else if (input.nodeType < 6.5) {
    // Spore sac: orange/brown
    baseColor = vec3f(0.75, 0.45, 0.20);
  } else if (input.nodeType < 7.5) {
    // Cotyledon: yellow-green (seed leaf)
    baseColor = vec3f(0.45, 0.75, 0.30);
  }

  let healthFactor = 1.0 - frame.healthTintStrength * 0.3;
  baseColor = mix(vec3f(0.42, 0.30, 0.16), baseColor, healthFactor);

  let sunDirection = normalize(frame.sunDirection.xyz);
  let nDotL = max(dot(normal, sunDirection), 0.0);
  var lit = baseColor * (0.30 + 0.70 * nDotL);

  let viewDirection = normalize(frame.cameraPos.xyz - input.worldPosition);
  let rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.0) * 0.18;
  lit += vec3f(0.18, 0.30, 0.18) * rim;

  if (frame.mutation0Param > 0.01) {
    let emissive = frame.mutation0Param * 0.25;
    let glowColor = vec3f(0.20, 0.75, 0.45);
    let pulse = 0.6 + 0.4 * sin(frame.time * 2.0 + input.worldPosition.y * 0.5);
    lit += glowColor * (emissive * pulse);
  }

  lit = applyRootSight(lit, input.worldPosition, input.nodeType, input.isOwn, frame);
  return vec4f(lit, 1.0);
}
