/**
 * The patch of shade a plant stands in.
 *
 * A plant's cast shadow comes from the sun's shadow map, which is two hundred
 * metres wide across a thousand texels: a seedling's shadow there is a texel or
 * two of grey, and because the map is one grid over one flat plane it looked the
 * same on every hill. Drops already carry a contact patch that lies in the
 * ground plane (see WorldDrops); plants get the same treatment here - one soft
 * ellipse per plant, laid on the terrain normal under its foot and sized to what
 * the plant spreads over.
 *
 * The patch is a footprint, not a second projection of the body: it is darkest
 * where the stem meets the soil, which is the one thing the shadow map cannot
 * say on a coarse map, and it disappears with the plant.
 */
import * as THREE from 'three';

const CIRCLE_NORMAL = new THREE.Vector3(0, 0, 1);
const WORLD_UP = new THREE.Vector3(0, 1, 0);
/** Below this a seed's patch is a dot; the foot always reads. */
const MIN_RADIUS_M = 0.12;
/** A plant wider than this is a thicket, and one ellipse stops meaning anything. */
const MAX_RADIUS_M = 2.6;
/** A whisker along the normal, so the patch never z-fights the soil. */
const LIFT_M = 0.02;

export interface PlantFootprint {
  /** Stable owner id; two plants never share one patch. */
  plantId: string;
  /** Where the plant meets the ground, in world metres. */
  x: number;
  z: number;
  /** Height of the drawn ground under that foot. */
  groundY: number;
  /** Half-width of the plant's spread, in metres. */
  radius: number;
}

/** The part of a node the footprint needs: where its plant put it. */
export interface FootprintNode {
  plantId?: string | undefined;
  isOwnPlant?: boolean;
  position: { x: number; y: number; z: number };
}

/** A plant is airborne (uprooted, tumbling) above this height off its soil. */
const AIRBORNE_M = 0.35;
/** A node within this of its soil counts as standing on it. */
const SURFACE_BAND_M = 0.12;
const MIN_SPREAD_RADIUS_M = 0.16;

/**
 * One footprint per plant: its base, and how far its body spreads above ground.
 *
 * Roots are deliberately out of it. The lowest node of a grown plant is a root
 * tip a metre down, so taking the lowest node as the foot lost the patch entirely
 * once a plant rooted, and counting root tips in the spread widened the shade to
 * wherever the roots had reached. Only parts at or above the soil are the plant's
 * footprint on the soil; a plant whose body is all airborne has none.
 */
export function plantFootprints(
  nodes: readonly FootprintNode[],
  fieldY: (x: number, z: number) => number,
): Array<Omit<PlantFootprint, 'groundY'>> {
  // Two passes: the foot first, then the spread measured from it. Accumulating
  // the spread while the foot was still moving measured early parts from a foot
  // the plant did not have.
  const above = new Map<string, Array<{ x: number; y: number; z: number }>>();
  for (const node of nodes) {
    const p = node.position;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue;
    // A buried part is not part of the plant's silhouette on the soil.
    if (p.y < fieldY(p.x, p.z) - SURFACE_BAND_M) continue;
    const plantId = node.plantId ?? (node.isOwnPlant ? 'own' : 'rival');
    const list = above.get(plantId);
    if (list) list.push({ x: p.x, y: p.y, z: p.z });
    else above.set(plantId, [{ x: p.x, y: p.y, z: p.z }]);
  }

  const feet = new Map<string, { x: number; y: number; z: number; spread: number }>();
  for (const [plantId, list] of above) {
    let base = list[0];
    if (!base) continue;
    for (const p of list) if (p.y < base.y) base = p;
    let spread = 0;
    for (const p of list) spread = Math.max(spread, Math.hypot(p.x - base.x, p.z - base.z));
    feet.set(plantId, { x: base.x, y: base.y, z: base.z, spread });
  }

  const out: Array<Omit<PlantFootprint, 'groundY'>> = [];
  for (const [plantId, foot] of feet) {
    if (foot.y - fieldY(foot.x, foot.z) > AIRBORNE_M) continue;
    out.push({
      plantId,
      x: foot.x,
      z: foot.z,
      radius: Math.max(MIN_SPREAD_RADIUS_M, foot.spread * 0.55),
    });
  }
  return out;
}

export interface SurfaceNormal {
  x: number;
  y: number;
  z: number;
}

export interface PlantContactShadowsOptions {
  scene: THREE.Object3D;
  /** Terrain normal under a plan position; flat ground when omitted. */
  groundNormal?: (x: number, z: number) => SurfaceNormal | null | undefined;
}

export class PlantContactShadows {
  private readonly group = new THREE.Group();
  private readonly geometry = new THREE.CircleGeometry(1, 24);
  private readonly material: THREE.MeshBasicMaterial;
  private readonly patches = new Map<string, THREE.Mesh>();
  private readonly normal = new THREE.Vector3();
  private readonly options: PlantContactShadowsOptions;

  constructor(options: PlantContactShadowsOptions) {
    this.options = options;
    this.group.name = 'plant-contact-shadows';
    this.material = new THREE.MeshBasicMaterial({
      // The same ink as a drop's contact patch, a little lighter: a plant is a
      // bigger body than a pebble but its shadow still has to stay a shadow.
      color: 0x120c05,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
    });
    options.scene.add(this.group);
  }

  /** Patches travel with the plants: hide both when the plant pass is hidden. */
  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  size(): number {
    return this.patches.size;
  }

  /** One patch per plant; anything the payload no longer carries is removed. */
  update(footprints: readonly PlantFootprint[]): void {
    const seen = new Set<string>();
    for (const foot of footprints) {
      seen.add(foot.plantId);
      let patch = this.patches.get(foot.plantId);
      if (!patch) {
        patch = new THREE.Mesh(this.geometry, this.material);
        patch.name = `plant-contact-shadow-${foot.plantId}`;
        patch.renderOrder = 1;
        this.patches.set(foot.plantId, patch);
        this.group.add(patch);
      }
      const normal = this.normalUnder(foot.x, foot.z);
      // The disc's own normal is +Z, so mapping it onto the surface normal lies
      // the patch in the ground plane: on a slope the far edge climbs with the
      // hill instead of cutting into it.
      patch.quaternion.setFromUnitVectors(CIRCLE_NORMAL, normal);
      const radius = THREE.MathUtils.clamp(foot.radius, MIN_RADIUS_M, MAX_RADIUS_M);
      // A little wider than deep: a plant's spread is not a circle, and a
      // perfect disc under every one reads as a stamped decal.
      patch.scale.set(radius * 1.25, radius, 1);
      patch.position.set(foot.x, foot.groundY, foot.z).addScaledVector(normal, LIFT_M);
    }
    for (const [id, patch] of this.patches) {
      if (seen.has(id)) continue;
      this.group.remove(patch);
      this.patches.delete(id);
    }
  }

  private normalUnder(x: number, z: number): THREE.Vector3 {
    const normal = this.options.groundNormal?.(x, z);
    if (
      normal &&
      Number.isFinite(normal.x) &&
      Number.isFinite(normal.y) &&
      Number.isFinite(normal.z) &&
      Math.abs(normal.x) + Math.abs(normal.y) + Math.abs(normal.z) > 1e-6
    ) {
      this.normal.set(normal.x, normal.y, normal.z).normalize();
    } else {
      this.normal.copy(WORLD_UP);
    }
    return this.normal;
  }

  dispose(): void {
    for (const patch of this.patches.values()) this.group.remove(patch);
    this.patches.clear();
    this.group.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
