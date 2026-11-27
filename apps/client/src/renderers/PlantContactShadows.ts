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
  /** 0 is a root: underground, so it is not part of the body's shade. */
  type?: number;
  /** Drawn radius, for the shade each part throws of its own. */
  radius?: number;
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

/** One soft patch of shade the plant's own body throws on the soil. */
export interface ShadowPatch {
  plantId: string;
  x: number;
  z: number;
  /** Half-length along the light, in metres. */
  radiusX: number;
  /** Half-width across the light, in metres. */
  radiusZ: number;
  /** Heading of `radiusX` in the ground plane, radians. */
  angle: number;
  /** How dark this patch is at its centre, 0..1. */
  opacity: number;
  /** Height of the drawn ground under it, when the caller knows it. */
  groundY?: number;
}

/** A body taller than this is a tree on a hill, and its shade is the map's job. */
const MAX_SHADOW_HEIGHT_M = 7;
/** Enough parts to read as a canopy without a mesh per leaf. */
const MAX_SHADOW_PARTS = 18;

/**
 * The shade the plant's own body throws, part by part.
 *
 * The sun's shadow map covers two hundred metres in a thousand texels, so a
 * seedling's real shadow there is one grey texel; the answer used to be a single
 * soft ellipse under the plant, which grew with the plant and never moved with
 * the sun. This projects every drawn part of the body onto the soil along the
 * light: each part throws its own ellipse, offset and stretched by how high it
 * stands, so a tall stem lays a long shade down the slope, the crown throws its
 * whole spread, and turning the sun moves all of it. The plant's foot keeps a
 * contact patch of its own - the darkest thing on the soil and the one the map
 * cannot draw.
 *
 * Roots are excluded: they are under the soil, and their "shadow" would appear
 * beside the plant wherever they had reached.
 */
export function plantShadowPatches(
  nodes: readonly FootprintNode[],
  fieldY: (x: number, z: number) => number,
  sun: { x: number; y: number; z: number },
): ShadowPatch[] {
  const length = Math.hypot(sun.x, sun.y, sun.z);
  if (!Number.isFinite(length) || length < 1e-6) return [];
  const toSun = { x: sun.x / length, y: sun.y / length, z: sun.z / length };
  // The sun below the horizon: moonlight is a rim, not a cast shadow, and a
  // projected patch under a dark sky reads as a black smear.
  if (toSun.y < 0.08) return [];

  const byPlant = new Map<string, ShadowPatch[]>();
  for (const node of nodes) {
    if (node.type === 0) continue;
    const p = node.position;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue;
    const height = p.y - fieldY(p.x, p.z);
    if (height < 0.02 || height > MAX_SHADOW_HEIGHT_M) continue;
    const reach = height / toSun.y;
    const x = p.x - toSun.x * reach;
    const z = p.z - toSun.z * reach;
    const base = Math.max(0.02, (node.radius ?? 0.03) * 1.15);
    // A part high up throws a longer, softer, fainter smear; a part on the soil
    // throws a tight dark one. Both ends matter: the foot anchors the plant.
    const stretch = Math.min(3.2, 1 + height * 0.5);
    const opacity = 0.3 * Math.max(0.28, 1 - height / (MAX_SHADOW_HEIGHT_M * 0.8));
    const plantId = node.plantId ?? (node.isOwnPlant ? 'own' : 'rival');
    const patch: ShadowPatch = {
      plantId,
      x,
      z,
      radiusX: base * stretch,
      radiusZ: base,
      angle: Math.atan2(toSun.z, toSun.x),
      opacity,
    };
    const list = byPlant.get(plantId);
    if (list) list.push(patch);
    else byPlant.set(plantId, [patch]);
  }

  const out: ShadowPatch[] = [];
  for (const list of byPlant.values()) {
    // The biggest parts carry the shape of the shade; the stem's own patch is
    // kept by the contact footprint that is always laid, so trimming is safe.
    list.sort((a, b) => b.radiusX * b.radiusZ - a.radiusX * a.radiusZ);
    for (const patch of list.slice(0, MAX_SHADOW_PARTS)) out.push(patch);
  }
  return out;
}

/** Stable key for a set of part patches, to the centimetre. */
export function shadowPatchKey(patches: readonly ShadowPatch[]): string {
  return patches
    .map(
      (patch) =>
        `${patch.plantId}:${centimetres(patch.x)}:${centimetres(patch.z)}:` +
        `${centimetres(patch.radiusX)}:${centimetres(patch.radiusZ)}:` +
        `${centimetres(patch.angle)}:${centimetres(patch.opacity)}`,
    )
    .join('|');
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

/**
 * One string standing for a whole set of footprints, to the centimetre.
 *
 * A patch is a soft ellipse metres wide: a foot that moved a centimetre draws
 * the same shade. Rebuilding the patches asks the terrain for heights, and a
 * height is a raycast over every triangle drawn, so the renderer compares this
 * key first and only lays new patches when something actually moved.
 */
/** A length in centimetres, without a minus zero for a point just under one. */
function centimetres(value: number): string {
  return (Math.round(value * 100) / 100 + 0).toFixed(2);
}

export function footprintKey(footprints: readonly PlantFootprint[]): string {
  return footprints
    .map(
      (foot) =>
        `${foot.plantId}:${centimetres(foot.x)}:${centimetres(foot.z)}:${centimetres(foot.radius)}:${centimetres(foot.groundY)}`,
    )
    .join('|');
}

interface PlantShade {
  group: THREE.Group;
  disc: THREE.Mesh;
  parts: THREE.Mesh[];
}

export class PlantContactShadows {
  private readonly group = new THREE.Group();
  private readonly geometry = new THREE.CircleGeometry(1, 24);
  private readonly shades = new Map<string, PlantShade>();
  private readonly normal = new THREE.Vector3();
  private readonly options: PlantContactShadowsOptions;
  /** Soft edge for every patch, generated rather than loaded: no DOM needed. */
  private readonly soft: THREE.DataTexture;
  private readonly discMaterial: THREE.MeshBasicMaterial;
  private readonly partMaterials = new Map<number, THREE.MeshBasicMaterial>();

  constructor(options: PlantContactShadowsOptions) {
    this.options = options;
    this.group.name = 'plant-contact-shadows';
    this.soft = softPatchTexture();
    this.discMaterial = new THREE.MeshBasicMaterial({
      // The same ink as a drop's contact patch, a little lighter: a plant is a
      // bigger body than a pebble but its shadow still has to stay a shadow.
      color: 0x120c05,
      map: this.soft,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
    });
    options.scene.add(this.group);
  }

  /** Patches travel with the plants: hide both when the plant pass is hidden. */
  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  /** How many plants are in shade; parts belong to their plant. */
  size(): number {
    return this.shades.size;
  }

  /**
   * Lay the contact patch and the body's own projected shade.
   *
   * The footprint anchors the plant - the darkest mark, under the stem, which
   * the shadow map cannot resolve - and the parts are the body's shade, one
   * ellipse per part, placed and stretched by `plantShadowPatches`.
   */
  update(footprints: readonly PlantFootprint[], patches: readonly ShadowPatch[] = []): void {
    const byPlant = new Map<string, ShadowPatch[]>();
    for (const patch of patches) {
      const list = byPlant.get(patch.plantId);
      if (list) list.push(patch);
      else byPlant.set(patch.plantId, [patch]);
    }
    const seen = new Set<string>();
    for (const foot of footprints) {
      seen.add(foot.plantId);
      let shade = this.shades.get(foot.plantId);
      if (!shade) {
        const group = new THREE.Group();
        group.name = `plant-shadow-${foot.plantId}`;
        const disc = new THREE.Mesh(this.geometry, this.discMaterial);
        disc.name = `plant-contact-shadow-${foot.plantId}`;
        disc.renderOrder = 1;
        group.add(disc);
        group.position.set(foot.x, foot.groundY, foot.z);
        this.group.add(group);
        shade = { group, disc, parts: [] };
        this.shades.set(foot.plantId, shade);
      }
      const normal = this.normalUnder(foot.x, foot.z);
      // The disc's own normal is +Z, so mapping it onto the surface normal lies
      // the patch in the ground plane: on a slope the far edge climbs with the
      // hill instead of cutting into it.
      shade.group.position.set(foot.x, foot.groundY, foot.z);
      shade.disc.quaternion.setFromUnitVectors(CIRCLE_NORMAL, normal);
      const radius = THREE.MathUtils.clamp(foot.radius, MIN_RADIUS_M, MAX_RADIUS_M);
      // A little wider than deep: a plant's spread is not a circle, and a
      // perfect disc under every one reads as a stamped decal.
      shade.disc.scale.set(radius * 1.25, radius, 1);
      shade.disc.position.set(0, LIFT_M, 0);
      this.layParts(shade, byPlant.get(foot.plantId) ?? [], foot);
    }
    for (const [id, shade] of this.shades) {
      if (seen.has(id)) continue;
      this.group.remove(shade.group);
      this.shades.delete(id);
    }
  }

  /** One ellipsoid of shade per part, pooled so growth does not allocate. */
  private layParts(shade: PlantShade, patches: readonly ShadowPatch[], foot: PlantFootprint): void {
    for (let i = 0; i < patches.length; i += 1) {
      const data = patches[i];
      if (!data) continue;
      let part = shade.parts[i];
      if (!part) {
        part = new THREE.Mesh(this.geometry, this.materialFor(data.opacity));
        part.name = `plant-shadow-part-${foot.plantId}-${i}`;
        part.renderOrder = 1;
        shade.parts[i] = part;
        shade.group.add(part);
      } else {
        part.material = this.materialFor(data.opacity);
      }
      // The part is laid on the ground under where its own shade falls, then
      // turned about the surface normal so the smear points away from the sun.
      const groundY = data.groundY ?? foot.groundY;
      const normal = this.normalUnder(data.x, data.z);
      part.quaternion.setFromUnitVectors(CIRCLE_NORMAL, normal);
      part.rotateZ(data.angle);
      part.scale.set(Math.max(0.01, data.radiusX), Math.max(0.01, data.radiusZ), 1);
      part.position.set(data.x - foot.x, groundY - foot.groundY + LIFT_M, data.z - foot.z);
      part.visible = true;
    }
    for (let i = patches.length; i < shade.parts.length; i += 1) {
      const part = shade.parts[i];
      if (part) part.visible = false;
    }
  }

  /** One material per darkness, so a still canopy shares its programs. */
  private materialFor(opacity: number): THREE.MeshBasicMaterial {
    const key = Math.round(Math.max(0, Math.min(1, opacity)) * 20);
    const cached = this.partMaterials.get(key);
    if (cached) return cached;
    const material = new THREE.MeshBasicMaterial({
      color: 0x120c05,
      map: this.soft,
      transparent: true,
      opacity: key / 20,
      depthWrite: false,
    });
    this.partMaterials.set(key, material);
    return material;
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
    for (const shade of this.shades.values()) this.group.remove(shade.group);
    this.shades.clear();
    this.group.removeFromParent();
    this.geometry.dispose();
    this.soft.dispose();
    this.discMaterial.dispose();
    for (const material of this.partMaterials.values()) material.dispose();
    this.partMaterials.clear();
  }
}

/**
 * A radial falloff, packed into a data texture.
 *
 * A hard-edged circle reads as a decal: shade has no rim. Built here rather
 * than from a canvas because this module is also loaded in tests, where there
 * is no document to draw on.
 */
function softPatchTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const centre = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x - centre) / centre;
      const dy = (y - centre) / centre;
      const r = Math.min(1, Math.hypot(dx, dy));
      // Smoothstep from the centre out: dark under the part, gone at the rim.
      const t = 1 - r;
      const alpha = t * t * (3 - 2 * t);
      const index = (y * size + x) * 4;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}
