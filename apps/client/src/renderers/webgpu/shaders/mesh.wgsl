// Tier 0/1 mesh pass: tapered branch tubes and leaf cards.
 // C02b: GPU skinning for 0.9s emergence animation.
 // C02b: Texture arrays for plant variation.

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

 @group(0) @binding(0) var<uniform> frame: FrameUniforms;
 @group(0) @binding(1) var<storage, read> renderData: array<PlantRenderData>;

 // C02b: Texture arrays for plant variation (bindings 3-8).
 @group(0) @binding(3) var barkTextureArray: texture_2d_array<f32>;
 @group(0) @binding(4) var leafTextureArray: texture_2d_array<f32>;
 @group(0) @binding(5) var flowerTextureArray: texture_2d_array<f32>;
 @group(0) @binding(6) var sporeSacTextureArray: texture_2d_array<f32>;
 @group(0) @binding(7) var seedTextureArray: texture_2d_array<f32>;
 @group(0) @binding(8) var textureArraySampler: sampler;

 // Root aura bindings for this pipeline's layout.
 @group(0) @binding(9) var rootAuraTexture: texture_2d<f32>;
 @group(0) @binding(10) var rootAuraSampler: sampler;

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
    let variationIndex = (input.packed >> 25u) & 0xfu;

    // C02b: GPU skinning - emergence value for animation
    var emergence = input.growthProgress;

    // C02b: Per-part wind sway stiffness by node type
    // Leaves/cotyledons sway most, roots/stems least
    let swayStiffness = select(
      0.45,   // root (0): stiff, little sway
      select(
        0.35, // stem/branch (1): moderate sway
        select(
          0.25, // vine (2): flexible
          select(
            0.15, // leaf (3): very flexible, lots of sway
            select(
              0.20, // seed (4): slight sway
              select(
                0.25, // flower (5): moderate sway
                select(
                  0.30, // spore_sac (6): moderate sway
                  0.20, // cotyledon (7): soft sway
                  nodeType < 7.5
                ),
                nodeType < 6.5
              ),
              nodeType < 5.5
            ),
            nodeType < 4.5
          ),
          nodeType < 3.5
        ),
        nodeType < 2.5
      ),
      nodeType < 1.5
    );

    // C02b: GPU skinning - apply joint matrices
    var worldPosition = windOffset(input.position, frame, swayStiffness);
    // NOTE: Do NOT scale worldPosition by emergence from origin. JS pre-computes
    // emergent positions; emergence is used only for radius/fade effects below.
    
    // Cotyledon unfolding animation: rotate leaf from vertical to horizontal
    // as growthProgress goes 0→1, and tilt toward sun
    let isCotyledon = nodeType >= 6.5 && nodeType < 7.5;
    if (isCotyledon && emergence > 0.02) {
      // Unfold angle: starts pointing up (vertical), unfolds toward horizontal
      let unfoldAngle = emergence * 1.4; // radians, ~80 degrees at full growth
      // Rotate position around X axis (unfold from vertical)
      let unfoldCos = cos(unfoldAngle);
      let unfoldSin = sin(unfoldAngle);
      // Rotate around X: y' = y*cos - z*sin, z' = y*sin + z*cos
      let unfoldedY = worldPosition.y * unfoldCos - worldPosition.z * unfoldSin;
      let unfoldedZ = worldPosition.y * unfoldSin + worldPosition.z * unfoldCos;
      worldPosition = vec3f(worldPosition.x, unfoldedY, unfoldedZ);
      
      // Tilt cotyledon toward sun
      let sunDirection = normalize(frame.sunDirection.xyz);
      let sunTilt = sunDirection * emergence * 0.15;
      worldPosition = worldPosition + sunTilt;
    }

    // Apply skinning for joints with weight > 0
    var skinnedNormal = input.normal;
    if (input.jointWeights.x > 0.0 || input.jointWeights.y > 0.0) {
      let skinned = skinVertexWithNormal(
        worldPosition,
        input.normal,
        input.jointIndices,
        input.jointWeights,
        plantIndex,
      );
      worldPosition = skinned.position;
      skinnedNormal = skinned.normal;
    }

    // Outline type (8): expand along normal for outline effect
    let isOutline = nodeType >= 7.5 && nodeType < 8.5;
    let outlineOffset = select(0.0, 0.025, isOutline);
    worldPosition += skinnedNormal * outlineOffset;

    let clipPosition = frame.viewProjection * vec4f(worldPosition, 1.0);

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

   // Outline type (8): gold wireframe
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
     if (input.nodeType < 0.5) {
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
