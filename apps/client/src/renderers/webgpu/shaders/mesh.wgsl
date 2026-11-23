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
   @location(6) @interpolate(flat) blendFactor: f32,
   // C02b: mutation signature bits for this node (billboard tiers only now).
   @location(7) @interpolate(flat) mutationMask: u32,
   // T04: which plant's composed look applies to this fragment.
   @location(8) @interpolate(flat) plantIndex: u32,
}

 @group(0) @binding(0) var<uniform> frame: FrameUniforms;
 @group(0) @binding(1) var<storage, read> renderData: array<PlantRenderData>;
 // T04 appearance: one composed look per plant, one record per organ family.
 @group(0) @binding(9) var<storage, read> plantLooks: array<PlantLook>;

/** The composed look for one organ of one plant. */
fn lookForOrgan(plantIndex: u32, nodeType: f32) -> LookOrgan {
  if (plantIndex >= arrayLength(&plantLooks)) {
    return neutralLookOrgan();
  }
  let look = plantLooks[plantIndex];
  // Organ families follow the visual node types the mesh packs: 0 root,
  // 1 stem, 2 vine, 3 leaf, 4 seed, 5 flower, 6 spore sac, 7 cotyledon.
  if (nodeType < 2.5) {
    return look.woody;
  }
  if (nodeType > 2.5 && nodeType < 3.5) {
    return look.foliage;
  }
  if (nodeType > 3.5 && nodeType < 4.5) {
    return look.seed;
  }
  if (nodeType > 4.5 && nodeType < 6.5) {
    return look.bloom;
  }
  return look.foliage;
}

 // C02b: Texture arrays for plant variation (bindings 3-8).
 @group(0) @binding(3) var barkTextureArray: texture_2d_array<f32>;
 @group(0) @binding(4) var leafTextureArray: texture_2d_array<f32>;
 @group(0) @binding(5) var flowerTextureArray: texture_2d_array<f32>;
 @group(0) @binding(6) var sporeSacTextureArray: texture_2d_array<f32>;
 @group(0) @binding(7) var seedTextureArray: texture_2d_array<f32>;
 @group(0) @binding(8) var textureArraySampler: sampler;

 fn hiddenVertex() -> VertexOutput {
   return VertexOutput(
     vec4f(2.0, 2.0, 2.0, 1.0),
     vec3f(0.0, 0.0, 0.0),
     vec3f(0.0, 1.0, 0.0),
     vec2f(0.0, 0.0),
     0.0,
          0.0,
     0u,
     0.0,
     0u,
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
    if (renderInfo.visible == 0u || renderInfo.tier > 2u || (renderInfo.tier == 2u && renderInfo.blendFactor >= 1.0)) {
      return hiddenVertex();
    }

    let nodeType = f32((input.packed >> 16u) & 0xffu);
    let isOwn = f32((input.packed >> 24u) & 0x1u);
     let variationIndex = (input.packed >> 25u) & 0xfu;
    // T04: four-bit mutation signature index (0 = none, 1..12 = a signature).
    let mutationMask = (input.packed >> 28u) & 0xFu;

    // C02b: GPU skinning - emergence value for animation. Eased so a node that
    // arrives with a chunk of server progress still unfolds smoothly instead of
    // snapping through the middle of its growth curve.
    var emergence = smoothstep(0.0, 1.0, clamp(input.growthProgress, 0.0, 1.0));

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
    var worldPosition = windOffset(input.position, frame, swayStiffness, renderInfo.groundY);
    // NOTE: Do NOT scale worldPosition by emergence from origin. JS pre-computes
    // emergent positions; emergence is used only for radius/fade effects below.
    
    // Cotyledon unfolding is baked into the vertex positions by the mesh
    // builder, which rotates the blade around its own base. Rotating it here
    // used the world origin as the pivot, so a cotyledon at (1.3, 1.2, 3.5)
    // swung metres away from the plant as it unfolded.

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
      renderInfo.blendFactor,
      mutationMask,
      plantIndex,
    );
  }


 @fragment
 fn fs_main(input: VertexOutput, @builtin(front_facing) frontFacing: bool) -> @location(0) vec4f {
   if (groundBlocks(input.worldPosition)) {
     discard;
   }
   if (soilOccludes(input.worldPosition)) {
     discard;
   }
   // The analytic sphere `soilOccludes` tests sits below the drawn terrain, so
   // the topsoil between them showed plants through it - the seed's buried half
   // was painted over the ground. Nothing falls below the terrain it stands on,
   // except what stands in the open column of the pit, which is air: that is the
   // part of the plant a player down the shaft is looking at.
   if (
     input.worldPosition.y < renderData[input.plantIndex].groundY &&
     !inRootSightShaft(input.worldPosition)
   ) {
     discard;
   }

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

   // C02b: mutation signatures, per node. Thickened bark darkens the woody
   // tissue (its thickness is baked into the tube radii) and variegated foliage
   // mottles leaf colour; bioluminescence is added after lighting below.
   // T04 appearance (ADR-059): every held mutation contributes, each on the
   // organs its style names. The JS side composed and clamped the result; the
   // shader only applies it, so a plant can show a bark mutation and a lamina
   // mutation at once instead of one signature or the other.
   // Roots are not stems under the soil. They are paler, damper bark, and the
   // earth they grew through grades their faces: the side turned up sees the sky,
   // the side turned down sits in the soil's shadow. Without that split a root
   // field is one brown mass and the cut-away shows dirt rather than roots.
   if (!isOutline && input.nodeType < 0.5) {
     let luma = dot(baseColor, vec3f(0.299, 0.587, 0.114));
     // Contrast on the bark's own grain, so the ridges read at this size.
     let grain = smoothstep(0.10, 0.60, luma);
     baseColor = mix(baseColor * 0.74, baseColor * 1.12, grain);
     // Lifted toward pale, damp bark: a root has to separate from the soil and
     // the cavity wall by value, or the three materials read as one texture
     // with creases in it. This is the same tissue, graded - not a new layer.
     baseColor = mix(baseColor, vec3f(0.58, 0.47, 0.35), 0.38);
     baseColor = baseColor * 1.06 + vec3f(0.02, 0.015, 0.01);
     // Light falls off down the root: upward faces catch sky, undersides are in
     // contact shadow with the soil around them.
     let skyward = clamp(normal.y * 0.5 + 0.5, 0.0, 1.0);
     baseColor *= mix(0.66, 1.12, skyward);
   }

   let look = lookForOrgan(input.plantIndex, input.nodeType);
   if (!isOutline) {
     baseColor = applyPlantLook(baseColor, look, input.worldPosition, frame);
   }

   let healthFactor = 1.0 - frame.healthTintStrength * 0.3;
   baseColor = mix(vec3f(0.42, 0.30, 0.16), baseColor, healthFactor);

   let sunDirection = normalize(frame.sunDirection.xyz);
   let nDotL = max(dot(normal, sunDirection), 0.0);
   // Generous ambient plus a soft sky fill keeps the player plant readable
   // even when the sun is low or the camera looks at its shaded side.
   let skyFill = vec3f(0.06, 0.09, 0.11) * (0.5 + 0.5 * normal.y);
   var lit = vec4f(baseColor * (0.45 + 0.55 * nDotL) + skyFill, 1.0);

    let viewDirection = normalize(frame.cameraPos.xyz - input.worldPosition);
    // Backlight: a leaf with a light behind it glows through its own tissue, the
    // way a torch shows through paper. Brightest when the eye, the blade and the
    // light are in a line, and only where the lit face is the one turned away -
    // a leaf lit from the front already has its light.
    //
    // This was gated on `sunWarmth`, the golden-hour number, which is zero after
    // sunset: the moon is the only light the night has, and it could not shine
    // through a leaf at all. Warmth now chooses the *colour* - honey at golden
    // hour, the moon's cold silver after dark - and its floor is what carries the
    // night, instead of switching the whole term off.
    if (!isOutline) {
      let aim = pow(max(dot(-viewDirection, sunDirection), 0.0), 1.8);
      let away = 0.35 + 0.65 * max(dot(-normal, sunDirection), 0.0);
      let tint = mix(vec3f(0.74, 0.84, 1.0), vec3f(1.0, 0.82, 0.5), frame.sunWarmth);
      let transmission = tint * aim * away * (0.42 + 0.3 * frame.sunWarmth);
      lit = vec4f(lit.rgb + baseColor.rgb * transmission, lit.a);
    }
    // The rim is the silhouette against whatever is behind it, so its colour is
    // the material's: pale bark on a root seen against dark soil, leaf green on
    // the canopy. A green rim on a root is what made roots read as painted on.
    let isRootSurface = input.nodeType < 0.5;
    let rimTint = select(vec3f(0.18, 0.30, 0.18), vec3f(0.42, 0.33, 0.22), isRootSurface);
    let rimStrength = select(0.18, 0.27, isRootSurface);
    let rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.0) * rimStrength;
    lit = vec4f(lit.rgb + rimTint * rim, lit.a);

    // T04: emissive mutations glow from the tissue, after lighting. The
    // selection outline is not tissue, so it keeps its flat gold.
    if (!isOutline) {
      lit = vec4f(lit.rgb + lookEmissive(look, input.worldPosition, frame), lit.a);
    }

    lit = applyRootSight(lit.rgb, input.worldPosition, input.nodeType, input.isOwn, frame);
    lit = vec4f(lit.rgb, lit.a * (1.0 - input.blendFactor));
    return lit;
 }
