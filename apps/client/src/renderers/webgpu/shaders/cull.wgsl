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
    renderData[index] = PlantRenderData(4u, 0u, 0.0, 0.0);
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
    renderData[index] = PlantRenderData(4u, 0u, 0.0, 0.0);
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

  // Force own plant to never use billboard (tier >= 2) - use color.w as isOwn flag
  let isOwn = plant.color.w;
  if (isOwn > 0.5) {
    tier = min(tier, 1u);
  }

  if (tier != previousTier && plant.dwellTime < frame.minDwellTime) {
    tier = previousTier;
  }

  let dwellTime = select(plant.dwellTime + frame.deltaTime, 0.0, tier != previousTier);
  plants[index].lastTier = tier;
  plants[index].dwellTime = dwellTime;
  renderData[index] = PlantRenderData(tier, 1u, sizePx, 0.0);
}
