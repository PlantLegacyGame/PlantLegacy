// The ground the overlay has no depth for.
//
// This pass composites on its own canvas, so the three.js ground can never
// depth-test it: a plant in a valley was painted over the ridge in front of it
// and a drop fell across a hill it should have been behind. The terrain arrives
// as a coarse height map (baked from the same function the ground is drawn from)
// and the eye-to-fragment ray is walked over it.
//
// Shared by the mesh and rain modules, and by nothing else: the impostor and
// billboard modules have fixed bind group layouts, so a binding they never use
// must not reach them. That is why this lives in its own file and not in
// `common.wgsl`, which all five modules include.

@group(0) @binding(10) var groundHeightMap: texture_2d<f32>;

const GROUND_MAP_SIZE: f32 = 64.0;
const GROUND_MARCH_STEPS: u32 = 8u;
/** Slack for a 3.1 m texel: it cannot resolve a clod, only a ridge. */
const GROUND_MARCH_SLACK_M: f32 = 0.5;
/** Fraction of the ray left to the fragment's own exact column test. */
const GROUND_MARCH_NEAR_FRACTION: f32 = 0.8;

/**
 * Is ground standing between the eye and this point?
 *
 * The last fifth of the ray is skipped: what stands on the ground is already
 * tested exactly against its own `groundY` (plants) or its own column's height
 * (drops), and a coarse texel there would cull what is standing on the hill.
 */
fn groundBlocks(worldPos: vec3f) -> bool {
  if (frame.groundMapExtent <= 0.0) {
    return false;
  }
  let eye = frame.cameraPos.xyz;
  // The map is baked from open ground and has no hole where the root sight
  // shaft was cut. An eye standing on the pit floor is inside that hole, so the
  // texels it walks are earth the player is already under: marching them would
  // cull the plant above the mouth, which is the whole point of going down
  // there. `soilOccludes` makes the same exemption for the same reason.
  if (frame.cameraUnderSoil != 0u && inRootSightShaft(eye)) {
    return false;
  }
  let toPoint = worldPos - eye;
  if (dot(toPoint, toPoint) < 2.25) {
    return false;
  }
  for (var i = 1u; i < GROUND_MARCH_STEPS; i = i + 1u) {
    let t = f32(i) / f32(GROUND_MARCH_STEPS);
    if (t > GROUND_MARCH_NEAR_FRACTION) {
      break;
    }
    let p = eye + toPoint * t;
    let uv = (p.xz - frame.groundMapOrigin) / frame.groundMapExtent;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x >= 1.0 || uv.y >= 1.0) {
      continue;
    }
    let texel = vec2i(vec2u(uv * GROUND_MAP_SIZE));
    let height = textureLoad(groundHeightMap, texel, 0).r;
    if (p.y < height - GROUND_MARCH_SLACK_M) {
      return true;
    }
  }
  return false;
}
