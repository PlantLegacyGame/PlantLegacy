// L2/L3 impostor pass: one analytic ellipsoid per distant plant.
//
// DESIGN Part 14.2.0 and ADR-042 make the 12–80 px band (L2) an ellipsoid SDF
// with procedural bark and canopy colour, relit live: no atlas, no baked views,
// no camera-facing leaf card. L3 (2–12 px) is the same ellipsoid, where it is
// only a coloured point. The old atlas billboard is gone from the renderer.
//
// The quad is only the screen footprint the ray is traced in. What is drawn is
// the intersection of the eye ray with the plant's ellipsoid, so the silhouette,
// the lighting and the colour all follow the real surface at any hour.

struct VertexOutput {
  @builtin(position) clipPosition: vec4f,
  @location(0) worldPosition: vec3f,
  @location(1) @interpolate(flat) plantIndex: u32,
  @location(2) @interpolate(flat) isOwn: f32,
  @location(3) @interpolate(flat) blend: f32,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var<storage, read> renderData: array<PlantRenderData>;
@group(0) @binding(2) var<storage, read> plants: array<PlantData>;
@group(0) @binding(3) var<storage, read> impostorLooks: array<PlantLook>;

/** The quad carries this much margin around the body's widest axis, so the
 * silhouette is never clipped by the window it is traced in. */
const QUAD_MARGIN: f32 = 1.35;

/**
 * The ellipsoid is the plant's drawn body, not its bounding sphere.
 *
 * `center.w` is a sphere over every part of the plant including roots - it is
 * what the cull pass measures for the tier, and it stays that. For a seedling
 * the roots are most of it, so an ellipsoid sized from the sphere stood several
 * times taller than the stem the mesh draws and the 1<->2 swap shrank the plant
 * (E41).
 */
/**
 * The body never draws smaller than this across, however far away it is.
 *
 * The floor is a plateau, not a cure: only about a third of it survives into
 * the drawn pod (a 24 px floor measured as an 8 px dot, 4 and 6 px floors both
 * as a 2x2 px core), so it keeps a distant plant present without pretending to
 * make it legible. A plateau it cannot avoid while the true body is under it.
 */
const MIN_BODY_PX: f32 = 4.0;

/**
 * Half the height of the drawn body, from the soil up.
 *
 * The base is lifted to the terrain height: a seed crown's own box reaches
 * below the surface, and an ellipsoid left there had its widest part buried and
 * hidden by the soil test, so a grown plant drew at half its canopy width.
 */
fn impostorHalfHeight(plant: PlantData) -> f32 {
  let baseY = max(plant.impostorBaseY, plant.groundY);
  let topY = max(plant.impostorTopY, baseY + 0.02);
  return max((topY - baseY) * 0.5, 0.02);
}

/** Where the body meets the soil: the point the pixel floor is measured from. */
fn impostorFoot(plant: PlantData) -> vec3f {
  return vec3f(
    plant.center.x,
    max(plant.impostorBaseY, plant.groundY),
    plant.center.z,
  );
}

fn impostorRadii(plant: PlantData, footDistance: f32) -> vec3f {
  // L3 is 2-12 px, where a seedling's true body is under a pixel: hold the
  // ellipsoid at MIN_BODY_PX across so the tier still draws a plant.
  let floorPx =
    MIN_BODY_PX * 0.5 * footDistance / max(frame.proj11 * frame.viewportHeight, 1.0);
  let halfWidth = max(plant.impostorHalfWidth, floorPx);
  let halfHeight = max(impostorHalfHeight(plant), floorPx);
  return vec3f(halfWidth, halfHeight, halfWidth);
}

fn impostorCentre(plant: PlantData, footDistance: f32) -> vec3f {
  // The body stands on the soil, so the ellipsoid sits where the stem is rather
  // than at the sphere's centre, which roots pull underground. The half height
  // is the one the radii use, so a floored body still rests on the ground
  // instead of sinking half the floor below it.
  let foot = impostorFoot(plant);
  let radii = impostorRadii(plant, footDistance);
  return vec3f(foot.x, foot.y + radii.y, foot.z);
}

fn hiddenVertex() -> VertexOutput {
  return VertexOutput(
    vec4f(2.0, 2.0, 2.0, 1.0),
    vec3f(0.0, 0.0, 0.0),
    0u,
    0.0,
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
  // Tier 2 and below is the impostor; tier 0/1 is the merged mesh, and a tier 1
  // plant still fading toward the impostor is drawn by the mesh pass alone.
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
  let footDistance = distance(frame.cameraPos.xyz, impostorFoot(plant));
  let centre = impostorCentre(plant, footDistance);
  let radii = impostorRadii(plant, footDistance);
  let size = 2.0 * max(radii.x, radii.y) * QUAD_MARGIN;

  // The quad faces the eye, but it is not the plant: it is the window the
  // ellipsoid is traced through.
  let worldPosition = centre
    + frame.cameraRight.xyz * (corner.x - 0.5) * size
    + frame.cameraUp.xyz * (corner.y - 0.5) * size;

  return VertexOutput(
    frame.viewProjection * vec4f(worldPosition, 1.0),
    worldPosition,
    instanceIndex,
    plant.color.w,
    renderInfo.blendFactor,
  );
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let index = input.plantIndex;
  let plant = plants[index];
  let footDistance = distance(frame.cameraPos.xyz, impostorFoot(plant));
  let centre = impostorCentre(plant, footDistance);
  let radii = impostorRadii(plant, footDistance);

  let eye = frame.cameraPos.xyz;
  let toward = input.worldPosition - eye;
  let rayLength = length(toward);
  if (rayLength < 1e-4) {
    discard;
  }
  let direction = toward / rayLength;

  // Ray against the ellipsoid, in the space where it is the unit sphere.
  let scaledOrigin = (eye - centre) / radii;
  let scaledDirection = direction / radii;
  let a = dot(scaledDirection, scaledDirection);
  let b = dot(scaledOrigin, scaledDirection);
  let c = dot(scaledOrigin, scaledOrigin) - 1.0;
  let discriminant = b * b - a * c;
  if (discriminant < 0.0) {
    discard;
  }
  let root = sqrt(discriminant);
  let nearHit = (-b - root) / a;
  let farHit = (-b + root) / a;
  let depthAlongRay = select(farHit, nearHit, nearHit > 0.0);
  if (depthAlongRay <= 0.0) {
    discard;
  }

  let surface = eye + direction * depthAlongRay;
  // The overlay has no depth against the WebGL ground, so the surface the ray
  // found is what has to survive the planet's own occlusion tests.
  if (soilOccludes(surface) || groundBlocks(surface)) {
    discard;
  }

  let scaled = (surface - centre) / radii;
  let normal = normalize(scaled / radii);

  // Height up the ellipsoid turns the body from bark into canopy. The noise
  // breaks the boundary so the silhouette is a plant, not a smooth egg.
  let height = clamp((surface.y - (centre.y - radii.y)) / (2.0 * radii.y), 0.0, 1.0);
  let mottle =
    0.5
    + 0.5 * sin(surface.x * 6.3 + surface.y * 4.1) * sin(surface.z * 5.7 - surface.y * 2.3);
  let canopy = smoothstep(0.24, 0.74, height + (mottle - 0.5) * 0.22);

  var barkLook = neutralLookOrgan();
  var leafLook = neutralLookOrgan();
  if (index < arrayLength(&impostorLooks)) {
    barkLook = impostorLooks[index].woody;
    leafLook = impostorLooks[index].foliage;
  }

  // The plant's own mutations are painted onto its organs (ADR-059), so a
  // distant bioluminescent plant still glows and a variegated one still has
  // its pattern instead of turning generic green.
  let bark = applyPlantLook(vec3f(0.33, 0.25, 0.17), barkLook, surface, frame);
  let foliage = applyPlantLook(
    vec3f(0.20, 0.52, 0.22) * (0.85 + 0.30 * mottle),
    leafLook,
    surface,
    frame,
  );
  let albedo = mix(bark, foliage, canopy);

  let sun = normalize(frame.sunDirection.xyz);
  let sunDot = max(dot(normal, sun), 0.0);
  var lit = albedo * (0.30 + 0.70 * sunDot);
  let view = normalize(eye - surface);
  let rim = pow(1.0 - max(dot(normal, view), 0.0), 3.0);
  lit += vec3f(0.18, 0.30, 0.18) * rim * 0.18;
  lit += lookEmissive(leafLook, surface, frame) * canopy;
  lit = applyRootSight(lit, surface, 1.0, input.isOwn, frame).rgb;

  // The mesh pass fades a plant out as it crosses the boundary; the impostor
  // fades in with the same factor, premultiplied for the transparent pass.
  let alpha = clamp(input.blend, 0.0, 1.0);
  if (alpha < 0.02) {
    discard;
  }
  return vec4f(lit * alpha, alpha);
}
