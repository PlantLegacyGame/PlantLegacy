// Per-plant frustum culling and LOD assignment.

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var<storage, read_write> plants: array<PlantData>;
@group(0) @binding(2) var<storage, read_write> renderData: array<PlantRenderData>;

fn thresholdForTier(tier: u32) -> f32 {
  if (tier == 0u) {
    return frame.tierThreshold0;
  }
  if (tier == 1u) {
    return frame.tierThreshold1;
  }
  if (tier == 2u) {
    return frame.tierThreshold2;
  }
  if (tier == 3u) {
    return frame.tierThreshold3;
  }
  return 0.0;
}

// The environment is drawn by WebGL and the plants by WebGPU on a second
// canvas, so the two passes cannot share a depth buffer. The only surface that
// can hide a plant is the planet itself, and that test is analytic: if the
// segment from the camera to the plant crosses the body first, the plant is
// behind the horizon.
fn hiddenByPlanet(center: vec3f, radius: f32) -> bool {
  let planetRadius = frame.planetRadius;
  if (planetRadius <= 0.0) {
    return false;
  }

  let origin = vec3f(frame.planetCenterX, frame.planetCenterY, frame.planetCenterZ);
  let toCamera = frame.cameraPos.xyz - origin;
  // Inside the body (for example an underground root) is Root Sight's job.
  if (dot(toCamera, toCamera) <= planetRadius * planetRadius) {
    return false;
  }

  let toPlant = center - origin;
  if (dot(toPlant, toPlant) <= planetRadius * planetRadius) {
    return false;
  }

  let delta = toPlant - toCamera;
  let distance = length(delta);
  if (distance < 1e-4) {
    return false;
  }

  let direction = delta / distance;
  let b = dot(toCamera, direction);
  let c = dot(toCamera, toCamera) - planetRadius * planetRadius;
  let discriminant = b * b - c;
  if (discriminant <= 0.0) {
    return false;
  }

  let firstHit = -b - sqrt(discriminant);
  return firstHit > 0.0 && firstHit < distance - radius;
}

fn tierForSize(sizePx: f32) -> u32 {
  if (sizePx >= frame.tierThreshold0) {
    return 0u;
  }
  if (sizePx >= frame.tierThreshold1) {
    return 1u;
  }
  if (sizePx >= frame.tierThreshold2) {
    return 2u;
  }
  if (sizePx >= frame.tierThreshold3) {
    return 3u;
  }
  return 4u;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) globalId: vec3u) {
  let index = globalId.x;
  if (index >= arrayLength(&plants)) {
    return;
  }

  let plant = plants[index];
  let center = plant.center.xyz;
  let radius = max(0.05, plant.center.w);

  let clip = frame.viewProjection * vec4f(center, 1.0);
  if (clip.w <= 0.001) {
    renderData[index] = PlantRenderData(4u, 0u, 0.0, 0.0, center.y - radius);
    return;
  }

  let ndc = clip.xyz / clip.w;
  let radiusNdc = (radius * frame.proj11) / clip.w;
  let margin = radiusNdc * 1.15 + 0.02;
  if (
    abs(ndc.x) > 1.0 + margin ||
    abs(ndc.y) > 1.0 + margin ||
    ndc.z < -1.0 - margin ||
    ndc.z > 1.0 + margin
  ) {
    renderData[index] = PlantRenderData(4u, 0u, 0.0, 0.0, center.y - radius);
    return;
  }

  if (hiddenByPlanet(center, radius)) {
    renderData[index] = PlantRenderData(4u, 0u, 0.0, 0.0, center.y - radius);
    return;
  }

  let sizePx = radiusNdc * 2.0 * frame.viewportHeight;
  var tier = tierForSize(sizePx);
  let previousTier = plant.lastTier;

  // Hysteresis compares against the tier the plant would occupy with a
  // shrunk/expanded projected size. Clamping (rather than reverting to the
  // previous tier) lets a plant skip several tiers in one frame without
  // getting stuck at the coarsest LOD.
  if (tier < previousTier) {
    tier = max(tier, tierForSize(sizePx / frame.hysteresisPromote));
  } else if (tier > previousTier) {
    tier = min(tier, tierForSize(sizePx / frame.hysteresisDemote));
  }

  // The player's own plant is the subject of the game. Pinning it to the
  // full-detail mesh tier means it never swaps between mesh and billboard
  // while growing, which is what produced the bright flashing/pop-in look.
  let isOwn = plant.color.w;
  if (isOwn > 0.5) {
    tier = 0u;
  }

  let stableTier = select(tier, 0u, isOwn > 0.5);

  // Cross-fade blend factor: 0.0 = pure mesh, 1.0 = pure billboard. Only the
  // mesh/billboard boundary (tiers 1 <-> 2) cross-fades; other tiers are
  // single-LOD, and the own plant never fades at all.
  let crossesBoundary =
    previousTier < 4u &&
    ((previousTier < 2u && stableTier >= 2u && stableTier < 4u) ||
      (previousTier >= 2u && previousTier < 4u && stableTier < 2u));
  let isTransitioning = crossesBoundary && isOwn <= 0.5;
  // Dwell has to accumulate across frames for the fade to ramp; resetting it
  // to zero every frame while transitioning made blend snap from 0 to 1 (a pop).
  var dwellTime = 0.0;
  if (isTransitioning) {
    dwellTime = plant.dwellTime + frame.deltaTime;
  }

  var blend = 0.0;
  if (isTransitioning) {
    blend = clamp(dwellTime / max(frame.minDwellTime, 0.001), 0.0, 1.0);
  } else if (stableTier >= 2u) {
    blend = 1.0;
  }

  plants[index].lastTier = stableTier;
  plants[index].dwellTime = dwellTime;
  renderData[index] = PlantRenderData(stableTier, 1u, sizePx, blend, center.y - radius);
}
