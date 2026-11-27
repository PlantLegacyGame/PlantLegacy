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
    renderData[index] = PlantRenderData(4u, 0u, 0.0, 0.0, plant.groundY);
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
    renderData[index] = PlantRenderData(4u, 0u, 0.0, 0.0, plant.groundY);
    return;
  }

  if (hiddenByPlanet(center, radius)) {
    renderData[index] = PlantRenderData(4u, 0u, 0.0, 0.0, plant.groundY);
    return;
  }

  let sizePx = radiusNdc * 2.0 * frame.viewportHeight;
  var tier = tierForSize(sizePx);
  // The previous tier comes from `renderData`, which only this pass writes.
  // It used to come from `plants[].lastTier`, but the renderer re-uploads that
  // buffer whole every frame with the initial "promote me" tier, so the last
  // tier was never the last tier: every plant took the promotion branch every
  // frame and the 0.85 demotion factor could not fire, which put both the
  // mesh->impostor and impostor->mesh swaps at the same size (E42).
  let previousTier = renderData[index].tier;

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
  //
  // The factor is its own state: it is read back from `renderData` and stepped
  // by `deltaTime / minDwellTime` towards the tier's look, so the fade ramps
  // over the dwell instead of snapping on the frame the tier changed. It used
  // to be recomputed from a dwell timer kept in `plants[]`, which the renderer
  // re-uploads with a full timer every frame - and the transition test only
  // held on the frame the tier changed, so even an intact timer could not have
  // ramped (E43).
  let targetBlend = select(0.0, 1.0, stableTier >= 2u);
  let previousBlend = renderData[index].blendFactor;
  var blend = targetBlend;
  // `previousTier` above 2 means the plant was tier 3 or culled: it has no mesh
  // to fade against, and a plant coming back into view takes its look at once.
  // The own plant needs no case of its own: it is pinned to tier 0, so its
  // target is already 0 and its blend is already there.
  if (previousTier <= 2u && stableTier <= 2u) {
    let step = frame.deltaTime / max(frame.minDwellTime, 0.001);
    if (previousBlend < targetBlend) {
      blend = min(targetBlend, previousBlend + step);
    } else {
      blend = max(targetBlend, previousBlend - step);
    }
  }

  renderData[index] = PlantRenderData(stableTier, 1u, sizePx, blend, plant.groundY);
}
