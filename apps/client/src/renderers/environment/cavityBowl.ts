/**
 * The cavity as real geometry: a dug bowl of earth under the opening.
 *
 * Root Sight used to fake the inside of the cavity in the soil shader, which
 * meant the "walls" had no parallax and every viewing angle had to be handled
 * as a special case — the dome, the flat disc, the horizon. This is the actual
 * pit: a single inverted bowl whose rim sits just under the surface opening, so
 * looking in from above, from the side or from a distance all show the same
 * dug earth with real depth.
 *
 * One geometry, reused: the mesh is built once at unit radius and scaled per
 * frame from the cavity radius, so opening and growing the cavity allocates
 * nothing. Vertex colours carry the strata (darker topsoil at the rim, paler
 * subsoil deeper down) with no textures.
 */
import * as THREE from 'three';

/** Height of the rim above the bowl's centre, as a fraction of its radius. */
export const CAVITY_BOWL_RIM_FRACTION = 0.3;

/**
 * Radius of the mouth the soil shader cuts in the surface, as a fraction of the
 * Root Sight radius. Must match `sightRadius` in `ground.ts`: a bowl narrower
 * than the mouth leaves a ring of void between the lip and the wall, which is
 * what showed as black crescents around the pit.
 */
export const CAVITY_MOUTH_FRACTION = 0.8;

/** Rim tucked under the lip, as a fraction of the cavity radius. */
const RIM_BURY_FRACTION = 0.02;

/** Horizontal radius of the unit bowl's rim circle. */
const RIM_CIRCLE_RADIUS = Math.sqrt(1 - CAVITY_BOWL_RIM_FRACTION * CAVITY_BOWL_RIM_FRACTION);

const TOP_THETA = Math.acos(CAVITY_BOWL_RIM_FRACTION);

export interface CavityBowlPlacement {
  visible: boolean;
  horizontalScale: number;
  verticalScale: number;
  /** Rim height relative to the cavity centre (negative is below the surface). */
  rimOffsetY: number;
}

/**
 * Where the bowl sits for a cavity of `radius` opened to `progress`. Pure so the
 * mouth match can be tested without a GPU: the rim circle has to reach the
 * shader's cut at every size, and the rim has to stay under the soil line.
 */
export function cavityBowlPlacement(radius: number, progress: number): CavityBowlPlacement {
  const scale = radius * Math.max(progress, 0);
  const visible = scale > 0.05;
  const verticalScale = scale * 1.15;
  // 1.02 tucks the rim just outside the cut, under the lip, so the shader's
  // soft edge can never leave a sliver of void between the two.
  const horizontalScale = visible
    ? ((scale * CAVITY_MOUTH_FRACTION) / RIM_CIRCLE_RADIUS) * 1.02
    : 0;
  const rimAboveCentre = verticalScale * CAVITY_BOWL_RIM_FRACTION;
  return {
    visible,
    horizontalScale,
    verticalScale,
    rimOffsetY: -(scale * RIM_BURY_FRACTION + rimAboveCentre),
  };
}

function hash(angle: number, ring: number): number {
  const s = Math.sin(angle * 12.9898 + ring * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Build the bowl. Unit radius, opening upward, inside faces only: the eye is
 * always inside the pit looking at its wall.
 */
export function createCavityBowl(
  topsoil: THREE.Color,
  subsoil: THREE.Color,
  widthSegments = 48,
  heightSegments = 24,
): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(
    1,
    widthSegments,
    heightSegments,
    0,
    Math.PI * 2,
    TOP_THETA,
    Math.PI - TOP_THETA,
  );
  const positions = geometry.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  const color = new THREE.Color();
  const depthSpan = 1 + CAVITY_BOWL_RIM_FRACTION;
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    // 0 at the rim, 1 at the deepest point of the bowl.
    const depth = THREE.MathUtils.clamp((CAVITY_BOWL_RIM_FRACTION - y) / depthSpan, 0, 1);
    const grit = hash(Math.atan2(z, x), Math.round(y * 8));
    color.copy(topsoil).lerp(subsoil, depth);
    const shade = 0.82 + 0.36 * grit;
    colors[i * 3] = color.r * shade;
    colors[i * 3 + 1] = color.g * shade;
    colors[i * 3 + 2] = color.b * shade;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    // The eye looks at the inside of the bowl, so render inner faces.
    side: THREE.BackSide,
  });
  // A pit's own walls face away from the sun, so without a floor of their own
  // they read as a black hole rather than as dug earth. Slight self-illumination
  // keeps the strata legible without making the bowl glow.
  material.emissive.copy(subsoil).multiplyScalar(0.45);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'root-sight-bowl';
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  mesh.visible = false;
  return mesh;
}

/**
 * Place the bowl for this frame: centred on the cavity, scaled by its current
 * radius as Root Sight opens, hidden while it is closed.
 */
export function updateCavityBowl(
  bowl: THREE.Mesh,
  centre: THREE.Vector3,
  radius: number,
  progress: number,
): void {
  const placement = cavityBowlPlacement(radius, progress);
  bowl.visible = placement.visible;
  if (!bowl.visible) return;
  bowl.scale.set(placement.horizontalScale, placement.verticalScale, placement.horizontalScale);
  bowl.position.copy(centre);
  bowl.position.y += placement.rimOffsetY;
}
