/**
 * WASD panning, as arithmetic.
 *
 * The heading used to be `camera.getWorldDirection()`, read in the pan pass - which
 * runs before the orbit controls and the aim lean have rebuilt the camera for the
 * frame. So a pan followed the *previous* frame's rotation, and when the aim lifted
 * the view off the ground it could point somewhere the player never aimed.
 *
 * The orbit target and the eye are the truth after every clamp, so the heading is
 * simply `target - eye`: whatever the controls did, that is the direction the
 * screen is facing.
 *
 * Two rigs, one rule:
 *  - `ground`: the heading is flattened, so panning up a slope travels across it
 *    without changing the eye's height (the terrain follow is not consulted).
 *  - `free`: the whole view vector is the heading, so looking down and pressing W
 *    flies down - the free camera the plan's item 12 asks for.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PanInput {
  eye: Vec3;
  target: Vec3;
  /** The camera's up vector, in world space. */
  up: Vec3;
  /** +1 forward (W), -1 back (S). */
  forwardAxis: number;
  /** +1 right (D), -1 left (A). */
  strafe: number;
  /** True for the free flying rig; false for the ground-flattened one. */
  free: boolean;
  /** Metres per second. */
  speed: number;
  deltaTime: number;
}

const EPSILON = 1e-6;

function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function normalise(v: Vec3): Vec3 | null {
  const l = length(v);
  if (l < EPSILON) return null;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** The forward and right axes for this view, or null for a degenerate orbit. */
export function panBasis(
  eye: Vec3,
  target: Vec3,
  up: Vec3,
  free: boolean,
): { forward: Vec3; right: Vec3 } | null {
  const view = normalise({
    x: target.x - eye.x,
    y: target.y - eye.y,
    z: target.z - eye.z,
  });
  if (!view) return null;

  let forward: Vec3 | null = view;
  if (!free) {
    forward = normalise({ x: view.x, y: 0, z: view.z });
    // Looking straight down: the view defines no ground heading, so keep the
    // world's -Z. It is arbitrary but stable, and never zero - a zero axis used
    // to make a pan under a straight-down camera do nothing at all.
    if (!forward) forward = { x: 0, y: 0, z: -1 };
  }

  const right = normalise(cross(forward, up));
  if (!right) return null;
  return { forward, right };
}

/** The frame's translation for these keys, or null when nothing is held. */
export function panMove(input: PanInput): Vec3 | null {
  const { forwardAxis, strafe } = input;
  if (forwardAxis === 0 && strafe === 0) return null;
  if (!(input.speed > 0) || !(input.deltaTime > 0)) return null;

  const basis = panBasis(input.eye, input.target, input.up, input.free);
  if (!basis) return null;

  const direction = normalise({
    x: basis.forward.x * forwardAxis + basis.right.x * strafe,
    y: basis.forward.y * forwardAxis + basis.right.y * strafe,
    z: basis.forward.z * forwardAxis + basis.right.z * strafe,
  });
  if (!direction) return null;

  const step = input.speed * input.deltaTime;
  return { x: direction.x * step, y: direction.y * step, z: direction.z * step };
}
