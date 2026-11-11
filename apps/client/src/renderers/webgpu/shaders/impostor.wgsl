// Impostor baking shader: renders a single plant from multiple views into an atlas.
// This is a variant of the mesh shader that filters by a target plant index.
// C02b: Texture arrays for plant variation.

// Import shared structures and functions from common.wgsl
// Note: FrameUniforms and PlantRenderData come from common.wgsl; the vertex
// structures are declared here because this pass does not include mesh.wgsl.

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) packed: u32,
  @location(4) spawnTime: f32,
  @location(5) growthProgress: f32,
  @location(6) jointIndices: vec4<u32>,
  @location(7) jointWeights: vec4<f32>,
}

struct VertexOutput {
  @builtin(position) clipPosition: vec4f,
  @location(0) worldPosition: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) nodeType: f32,
  @location(4) isOwn: f32,
  @location(5) @interpolate(flat) variationIndex: u32,
}

struct ImpostorUniforms {
  targetPlantIndex: u32,
  _pad1: u32,
  _pad2: u32,
  _pad3: u32,
}

struct ImpostorViewUniforms {
  viewProjections: array<mat4x4<f32>, 16>,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var<storage, read> renderData: array<PlantRenderData>;
@group(0) @binding(2) var<uniform> impostor: ImpostorUniforms;
@group(0) @binding(3) var<uniform> impostorViews: ImpostorViewUniforms;
// C02b: Texture arrays for plant variation (bindings 4-8)
@group(0) @binding(4) var barkTextureArray: texture_2d_array<f32>;
@group(0) @binding(5) var leafTextureArray: texture_2d_array<f32>;
@group(0) @binding(6) var flowerTextureArray: texture_2d_array<f32>;
@group(0) @binding(7) var sporeSacTextureArray: texture_2d_array<f32>;
@group(0) @binding(8) var seedTextureArray: texture_2d_array<f32>;
@group(0) @binding(9) var textureArraySampler: sampler;

fn hiddenVertex() -> VertexOutput {
  return VertexOutput(
    vec4f(2.0, 2.0, 2.0, 1.0),
    vec3f(0.0, 0.0, 0.0),
    vec3f(0.0, 1.0, 0.0),
    vec2f(0.0, 0.0),
    0.0,
    0.0,
    0u,
  );
}

@vertex
fn vs_main(
  input: VertexInput,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOutput {
  let plantIndex = input.packed & 0xffffu;
  if (plantIndex >= arrayLength(&renderData)) {
    return hiddenVertex();
  }

  // Filter: only render the target plant for impostor baking
  if (plantIndex != impostor.targetPlantIndex) {
    return hiddenVertex();
  }

  let renderInfo = renderData[plantIndex];
  if (renderInfo.visible == 0u) {
    return hiddenVertex();
  }

  let nodeType = f32((input.packed >> 16u) & 0xffu);
  let isOwn = f32((input.packed >> 24u) & 0x1u);
  let variationIndex = (input.packed >> 25u) & 0xfu;

  // C02b: GPU skinning - emergence animation
  var emergence = input.growthProgress;
  if (input.spawnTime > 0.0) {
    let elapsed = frame.time - input.spawnTime;
    emergence = smoothstep(0.0, 0.9, elapsed) * input.growthProgress;
  }

  var worldPosition = windOffset(input.position, frame, 0.3);
  worldPosition *= emergence;

  // Impostor baking uses the unskinned rest pose. The baking bind group does
  // not provide joint matrices; live rendering applies skinning in the mesh pass.
  let skinnedNormal = input.normal;

  let isOutline = nodeType >= 7.5 && nodeType < 8.5;
  let outlineOffset = select(0.0, 0.025, isOutline);
  worldPosition += skinnedNormal * outlineOffset;

  // Use the view-projection matrix for the current view instance
  let viewProj = impostorViews.viewProjections[instanceIndex];
  let clipPosition = viewProj * vec4f(worldPosition, 1.0);

  return VertexOutput(
    clipPosition,
    worldPosition,
    skinnedNormal,
    input.uv,
    nodeType,
    isOwn,
    variationIndex,
  );
}

@fragment
fn fs_main(input: VertexOutput, @builtin(front_facing) frontFacing: bool) -> @location(0) vec4f {
  var normal = normalize(input.normal);
  if (!frontFacing) {
    normal = -normal;
  }

  let isOutline = input.nodeType >= 7.5 && input.nodeType < 8.5;

  // C02b: Sample from texture arrays based on node type and variation
  var baseColor = vec3f(0.34, 0.62, 0.20);
  var texColor = vec3f(1.0, 1.0, 1.0);
  var hasTexture = false;
  let variationIndex = input.variationIndex;

  if (isOutline) {
    baseColor = vec3f(1.0, 0.84, 0.0); // Gold
  } else if (input.nodeType < 0.5) {
    // Root: bark texture
    texColor = textureSampleLevel(barkTextureArray, textureArraySampler, input.uv, variationIndex, 0.0).rgb;
    hasTexture = true;
  } else if (input.nodeType < 1.5) {
    // Stem: bark texture
    texColor = textureSampleLevel(barkTextureArray, textureArraySampler, input.uv, variationIndex, 0.0).rgb;
    hasTexture = true;
  } else if (input.nodeType < 2.5) {
    // Vine: bark texture (darker)
    texColor = textureSampleLevel(barkTextureArray, textureArraySampler, input.uv, variationIndex, 0.0).rgb;
    hasTexture = true;
  } else if (input.nodeType < 3.5) {
    // Leaf: leaf texture
    texColor = textureSampleLevel(leafTextureArray, textureArraySampler, input.uv, variationIndex, 0.0).rgb;
    hasTexture = true;
  } else if (input.nodeType < 4.5) {
    // Seed: seed texture
    texColor = textureSampleLevel(seedTextureArray, textureArraySampler, input.uv, variationIndex, 0.0).rgb;
    hasTexture = true;
  } else if (input.nodeType < 5.5) {
    // Flower: flower texture
    texColor = textureSampleLevel(flowerTextureArray, textureArraySampler, input.uv, variationIndex, 0.0).rgb;
    hasTexture = true;
  } else if (input.nodeType < 6.5) {
    // Spore sac: spore sac texture
    texColor = textureSampleLevel(sporeSacTextureArray, textureArraySampler, input.uv, variationIndex, 0.0).rgb;
    hasTexture = true;
  } else if (input.nodeType < 7.5) {
    // Cotyledon: leaf texture (yellow-green)
    texColor = textureSampleLevel(leafTextureArray, textureArraySampler, input.uv, variationIndex, 0.0).rgb;
    hasTexture = true;
  }

  if (hasTexture) {
    baseColor = texColor;
  } else {
    // Fallback to procedural colors
    if (isOutline) {
      baseColor = vec3f(1.0, 0.84, 0.0); // Gold
    } else if (input.nodeType < 0.5) {
      baseColor = vec3f(0.38, 0.28, 0.18); // Root: brown
    } else if (input.nodeType < 1.5) {
      baseColor = vec3f(0.22, 0.55, 0.22); // Stem: green
    } else if (input.nodeType < 2.5) {
      baseColor = vec3f(0.26, 0.48, 0.16); // Vine: darker green
    } else if (input.nodeType < 3.5) {
      baseColor = vec3f(0.20, 0.70, 0.25); // Leaf: vibrant green
    } else if (input.nodeType < 4.5) {
      baseColor = vec3f(0.42, 0.28, 0.16); // Seed: rich organic brown
    } else if (input.nodeType < 5.5) {
      baseColor = vec3f(0.95, 0.35, 0.45); // Flower: pink/red
    } else if (input.nodeType < 6.5) {
      baseColor = vec3f(0.75, 0.45, 0.20); // Spore sac: orange/brown
    } else if (input.nodeType < 7.5) {
      baseColor = vec3f(0.45, 0.75, 0.30); // Cotyledon: yellow-green
    }
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