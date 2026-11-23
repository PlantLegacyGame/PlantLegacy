/**
 * MeshPlantRenderer - Mesh-based L0/L1 plant rendering for the SDF fallback path.
 *
 * Replaces expensive SDF raymarching (128 steps/pixel) with Three.js mesh geometry
 * for close plants. Uses:
 * - CylinderGeometry with smooth normals for stems/branches/roots (Murray's law taper)
 * - SphereGeometry for joints and seeds
 * - PlaneGeometry for leaves/cotyledons
 * - LOD: detailed mesh close up, simplified mesh mid-distance, points far away
 *
 * SDF raymarching is reserved for extreme close-ups where organic fusion detail
 * matters most, keeping fragment cost bounded.
 */
import {
  getSeedBodyHeightRatio,
  getSegmentTaperExponent,
  jointStartRadius,
  resolveDrawnRadius,
  seedBodyCentreY,
  seedBodyHalfHeight,
  segmentRadiusAt,
  socketInset,
} from '@plant-legacy/shared/growth';
import { hash01 } from '@plant-legacy/shared/math';
import * as THREE from 'three';
import type { PaletteConfig } from '../config/clientConfig.js';
import {
  type NodeHealthLook,
  type NodeHealthStatus,
  nodeHealthLook,
  nodeHealthStatus,
} from '../ui/plantHealth.ts';
import { DrawnGround } from './drawnGround.ts';
import { type AtmosphereParams, DEFAULT_ATMOSPHERE } from './environment/atmosphere.js';
import {
  applyAtmosphereToStandardMaterial,
  cloneStandaloneMaterial,
} from './environment/standardAtmosphere.js';
import { type OrganKey, organRoleForNodeType, resolveOrganColours } from './organPalette.ts';
import {
  PlantContactShadows,
  type PlantFootprint,
  plantFootprints,
} from './PlantContactShadows.ts';
import {
  geometryKey,
  lookAppliesTo,
  type MutationLook,
  type MutationLookStack,
  NEUTRAL_STACK,
  organFamily,
  organLook,
} from './plant/mutations.ts';
import { nubSwellForNode } from './plant/nubBulge.js';
import {
  applyLeafTranslucency,
  applySoilRamp,
  BLADE_INK_FRACTION,
  createBladeInkMaterial,
  createInkMaterial,
  INK_WIDTH_M,
  inkColourFor,
  organTaperExponent,
  setLeafBacklight,
  setSoilLine,
  usesOwnInkColour,
  usesSoilRamp,
} from './plant/organShading.ts';
import type { PlantNodeData } from './plant/plantNodeData.js';
import { segmentStartFor } from './plant/segmentStart.js';
import { buildSpineGeometry } from './plant/spineGeometry.ts';

interface MeshAppearance {
  petalCount: number;
  leafScale: number;
  seedScale: number;
}

const DEFAULT_APPEARANCE: MeshAppearance = { petalCount: 6, leafScale: 1, seedScale: 1 };

interface MeshNode {
  id: string;
  /** Owning plant, so the node draws that plant's look, not the renderer's. */
  plantId?: string;
  /** T04 signature index for this node (0 = none). */
  mutationFlags: number;
  position: THREE.Vector3;
  radius: number;
  nodeType: string;
  parentId: string | null;
  children: string[];
  biomass: number;
  health: number;
  isOwnPlant: boolean;
  growthProgress: number;
  spawnTime: number;
  /** Server node age in seconds, used for post-emergence leaf expansion. */
  age: number;
  /** Client time this node first appeared, for nodes the server reports as age 0. */
  firstSeenMs: number;
  // Animated target position for connected growth
  targetPosition?: THREE.Vector3;
  parentAttachPosition?: THREE.Vector3;
  /** Where along the parent segment this node leaves it (1 = its end). */
  attachFraction?: number;
}

interface MeshSegmentData {
  p0: THREE.Vector3;
  p1: THREE.Vector3;
  r0: number;
  r1: number;
  nodeType: string;
  isOwnPlant: boolean;
  growthProgress: number;
  mesh: THREE.Mesh;
  jointMesh: THREE.Mesh | null;
  leafMeshes: THREE.Mesh[];
  /** The ink pads drawn under the blades: one per leaf, same count and order. */
  leafInkMeshes: THREE.Mesh[];
  /** Inverted hulls under a flower's or spore sac's own meshes. */
  inkOrnament: THREE.Object3D[];
  /** Thorn cones for a spined epidermis; empty for every other plant. */
  spineMeshes: THREE.Mesh[];
  /** Geometry revision this segment was built for (bark/spine changes rebuild). */
  lookRevision: number;
  /** Health band the material was built from; a change rebuilds the materials. */
  healthBand: NodeHealthStatus;
  ornament: THREE.Group | null;
  /** The plate's ink line for a root: an inverted hull of the tube's geometry. */
  inkMesh: THREE.Mesh | null;
  parentPosition: THREE.Vector3;
  targetPosition: THREE.Vector3;
  /** Node position this segment was last drawn for, to detect rigid moves. */
  sourcePosition: THREE.Vector3;
  /**
   * Joint point this segment was built from, in world space.
   *
   * A segment is normally kept and moved by its node's delta, but the joint is
   * not tied to the node: an uproot lifts and tilts the body and a reroot puts
   * it back, so an attachment can move without the part's own position telling
   * the same story. Comparing against this rebuilds the tube when the joint has
   * actually moved, which is what keeps a root welded to its seed.
   */
  sourceAttach?: THREE.Vector3;
  originalRadius0: number;
  originalRadius1: number;
  originalLength: number;
  /** Mid-segment lateral bow, in metres. */
  bend: number;
}

/**
 * Tessellation of the mesh plants, from plant_renderer.json.
 *
 * These were compiled-in constants; they are quality knobs, so they belong in
 * config like every other tunable (RULE_3). `PlantRenderer` passes its loaded
 * values through when it builds this renderer.
 */
export interface MeshQualityConfig {
  tubeRadialSegments: number;
  tubeLengthSegments: number;
  leafSegments: number;
  jointWidthSegments: number;
  jointHeightSegments: number;
  maxLeavesPerNode: number;
  jointScale: number;
  maxLeafSize: number;
}

export const DEFAULT_MESH_QUALITY: MeshQualityConfig = {
  tubeRadialSegments: 12,
  tubeLengthSegments: 6,
  leafSegments: 4,
  jointWidthSegments: 12,
  jointHeightSegments: 10,
  maxLeavesPerNode: 6,
  jointScale: 0.55,
  maxLeafSize: 0.45,
};

// Scratch colour for mutation tinting, so the per-organ base colour is kept.
/**
 * Dry tissue is pale, dull and less glossy. This is the scene's half of the health
 * bands the inspect panel prints: same bands, same owner, so "Wilted" on the panel
 * and a straw-coloured part in the world cannot happen at different times.
 */
function applyNodeHealthLook(material: THREE.MeshStandardMaterial, health: NodeHealthStatus): void {
  const look: NodeHealthLook = nodeHealthLook(health);
  if (look.straw <= 0 && look.desaturate <= 0) return;
  const hsl = { h: 0, s: 0, l: 0 };
  material.color.getHSL(hsl);
  // Straw is hue 0.12 (about 43 degrees): the yellow a leaf goes before it browns.
  material.color.setHSL(
    hsl.h + (0.12 - hsl.h) * look.straw,
    Math.max(0, hsl.s * (1 - look.desaturate)),
    Math.min(1, hsl.l + 0.07 * look.straw),
  );
  material.roughness = Math.min(1, material.roughness + look.roughness);
}
const TMP_TINT = new THREE.Color();

// AL-04: the mesh plants use the shared atmosphere, like the ground and the SDF
// plants, instead of the scene's fog. Params are held here so organs created
// later (new mutations, a new plant) are patched with the current values.
let atmosphereParams: AtmosphereParams = DEFAULT_ATMOSPHERE;
const atmosphereSunDir = new THREE.Vector3(0, 1, 0);

// Material cache shared across instances
const barkMaterial: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
  roughness: 0.8,
  metalness: 0.1,
  flatShading: false,
});
const rootMaterial: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
  // Roots are pale bark, not dark wood: the title screen's root plate is bone by
  // the surface, and a root that changes material at the soil line is two organs.
  roughness: 0.88,
  metalness: 0.02,
  flatShading: false,
});
const stemMaterial: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
  // Young hypocotyls and branches are green-brown, not mature tree bark.
  roughness: 0.78,
  metalness: 0.02,
  flatShading: false,
});
const leafMaterial: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
  roughness: 0.7,
  metalness: 0.0,
  flatShading: false,
  side: THREE.DoubleSide,
});
const cotyledonMaterial: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
  // Fleshy, yellow-green seed leaves catch light differently from true leaves.
  roughness: 0.58,
  metalness: 0.0,
  flatShading: false,
  side: THREE.DoubleSide,
});
const flowerMaterial: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
  roughness: 0.62,
  metalness: 0.0,
  flatShading: false,
  side: THREE.DoubleSide,
});
const flowerCentreMaterial: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
  roughness: 0.74,
  metalness: 0.0,
  flatShading: false,
});
const sporeMaterial: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
  roughness: 0.85,
  metalness: 0.0,
  flatShading: false,
});

const seedMaterial: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
  roughness: 0.9,
  metalness: 0.0,
  flatShading: false,
});

/**
 * A01: each material is colourless here and painted once by
 * {@link applyOrganPalette} from the roles in `organPalette.ts`, so a palette
 * that fails to load stops the plant renderer instead of quietly falling back
 * to a second, compiled-in set of organ colours.
 */
const ORGAN_MATERIALS = {
  bark: barkMaterial,
  stem: stemMaterial,
  root: rootMaterial,
  leaf: leafMaterial,
  cotyledon: cotyledonMaterial,
  flower: flowerMaterial,
  flowerCentre: flowerCentreMaterial,
  spore: sporeMaterial,
  seed: seedMaterial,
} as const satisfies Record<OrganKey, THREE.MeshStandardMaterial>;

let organPaletteApplied = false;

/** Paint every organ material from the palette. Call once, before any plant. */
export function applyOrganPalette(palette: PaletteConfig): void {
  const colours = resolveOrganColours(palette);
  for (const organ of Object.keys(ORGAN_MATERIALS) as OrganKey[]) {
    ORGAN_MATERIALS[organ].color.set(colours[organ]);
  }
  organPaletteApplied = true;
}

/** Every uncloned organ material, so a single call can patch all of them. */
const BASE_MATERIALS: THREE.MeshStandardMaterial[] = Object.values(ORGAN_MATERIALS);

function baseMaterialFor(nodeType: string): THREE.MeshStandardMaterial {
  // The table lives with the roles, so "a trunk is bark" is testable without a
  // renderer: this switch quietly sent the trunk to the stem material, and a
  // woody plant came out green with the bark role unused.
  return ORGAN_MATERIALS[organRoleForNodeType(nodeType)];
}

function isRootNodeType(nodeType: string): boolean {
  return nodeType === 'radicle' || nodeType === 'root' || nodeType === 'lateral_root';
}

// Tube geometry cache: avoids rebuilding CylinderGeometry on every rebuild/growth
// frame when the same (radius0, radius1, length) recurs. Keys are rounded to
// 3 decimals so near-identical segments share geometry.
const tubeGeometryCache = new Map<string, THREE.BufferGeometry>();
function tubeGeometryCacheKey(
  r0: number,
  r1: number,
  length: number,
  quality: MeshQualityConfig,
  taper: number,
): string {
  // The taper exponent is part of the shape: a cached tube built with a
  // different exponent is the wrong silhouette, not just a different number.
  return `${r0.toFixed(3)},${r1.toFixed(3)},${length.toFixed(3)},${quality.tubeRadialSegments}x${quality.tubeLengthSegments},${taper.toFixed(2)}`;
}

/**
 * Bend a cylinder's rings onto the shared segment profile.
 *
 * CylinderGeometry interpolates radius linearly from base to tip, which draws
 * every internode as a funnel. The neck belongs at the junction: rescale each
 * ring by `segmentRadiusAt / linear`, so the belly is at the joint and the shank
 * holds for the rest of the segment. The tube's own ends keep the radii it was
 * built with, so joints and tips are unchanged.
 */
function applySegmentProfile(
  geometry: THREE.BufferGeometry,
  r0: number,
  r1: number,
  length: number,
  taper: number,
): void {
  const position = geometry.getAttribute('position');
  const span = Math.max(length, 1e-4);
  for (let i = 0; i < position.count; i += 1) {
    const t = THREE.MathUtils.clamp(position.getY(i) / span, 0, 1);
    const linear = r0 + (r1 - r0) * t;
    if (linear <= 1e-6) continue;
    const scale = segmentRadiusAt(r0, r1, t, taper) / linear;
    position.setX(i, position.getX(i) * scale);
    position.setZ(i, position.getZ(i) * scale);
  }
  position.needsUpdate = true;
}

function buildTubeGeometry(
  r0: number,
  r1: number,
  length: number,
  quality: MeshQualityConfig,
  bend = 0,
  /** The organ's own taper exponent: roots hold their body, shoots neck. */
  taper = getSegmentTaperExponent(),
): THREE.BufferGeometry {
  const key = `${tubeGeometryCacheKey(r0, r1, length, quality, taper)}|${bend.toFixed(3)}`;
  let geo = tubeGeometryCache.get(key);
  if (!geo) {
    geo = new THREE.CylinderGeometry(
      r0,
      r1,
      length,
      quality.tubeRadialSegments,
      quality.tubeLengthSegments,
      false,
    );
    // CylinderGeometry is centred on its Y axis. Move the base to the origin
    // and keep +Y as the growth axis; the old rotateX made the geometry run
    // along Z while the mesh was aligned from +X, so every tube was off-axis.
    geo.translate(0, length / 2, 0);
    applySegmentProfile(geo, r0, r1, length, taper);
    if (Math.abs(bend) > 1e-5) {
      const position = geo.getAttribute('position');
      for (let i = 0; i < position.count; i += 1) {
        const t = THREE.MathUtils.clamp(position.getY(i) / Math.max(length, 1e-4), 0, 1);
        // Bow the middle while keeping both endpoints on the parent/joint, so
        // roots wander without detaching from the graph.
        position.setX(i, position.getX(i) + bend * Math.sin(Math.PI * t));
      }
      position.needsUpdate = true;
    }
    geo.computeVertexNormals();
    tubeGeometryCache.set(key, geo);
  }
  return geo;
}

/**
 * Thorn cones along one woody segment, for `spined_epidermis`.
 *
 * The mutation's name promises spines, and an unlockable thorn organ is not the
 * same thing: the plant has to actually bristle. Spines are part of the
 * segment's geometry so they share its transform and its life cycle.
 */

/**
 * A leaf blade with its base at the origin and tip along +X.
 *
 * PlaneGeometry gave every leaf four sharp corners and put the petiole in the
 * middle of the blade. This builds a rounded, slightly cupped lamina that starts
 * at the attachment point, with a raised midrib and (for cotyledons) a broader,
 * fleshier profile like a bean's seed leaf.
 */
function buildLeafGeometry(
  length: number,
  width: number,
  segments: number,
  isCotyledon: boolean,
): THREE.BufferGeometry {
  const rows = Math.max(4, segments * 2);
  const cols = Math.max(4, segments * 2);
  const positions = leafSurfacePoints(length, width, rows, cols, isCotyledon);
  const indices: number[] = [];

  const stride = cols + 1;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const a = row * stride + col;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** The blade's surface, row-major, base at u = 0 and tip along +X. */
function leafSurfacePoints(
  length: number,
  width: number,
  rows: number,
  cols: number,
  isCotyledon: boolean,
): number[] {
  const positions: number[] = [];

  for (let row = 0; row <= rows; row += 1) {
    const u = row / rows;
    const profile =
      Math.sin(Math.PI * u) ** (isCotyledon ? 0.45 : 0.75) *
      (isCotyledon ? 1 : 0.72 + 0.28 * (1 - u));
    for (let col = 0; col <= cols; col += 1) {
      const v = (col / cols) * 2 - 1;
      const x = length * u;
      const y = width * 0.5 * profile * v;
      // Cup the blade toward its normal and raise the midrib slightly. The
      // centre line catches a highlight, so the leaf reads as a lamina rather
      // than a flat coloured card.
      const cup = width * 0.055 * Math.sin(Math.PI * u) * (1 - v * v);
      const midrib = width * 0.035 * Math.max(0, 1 - Math.abs(v) * 5) * Math.sin(Math.PI * u);
      const z = cup + midrib - width * 0.02 * Math.abs(v) * profile;
      positions.push(x, y, z);
    }
  }
  return positions;
}

/**
 * The ink under a blade: a band that follows the blade's own silhouette.
 *
 * A blade is a surface, so the tube's inverted hull would only put ink under the
 * leaf where the leaf already hides it. A second, slightly larger copy of the
 * whole blade is worse: the blade is cupped, so scaling lifts the copy's centre
 * in front of the original and the ink eats the leaf from the inside (which is
 * exactly what the first attempt did - a brown patch over half a cotyledon).
 *
 * This band shares the blade's own perimeter vertices and only grows *outward*
 * from them, so it is the same surface at the same depth and no part of it lies
 * where the leaf is. `inkFraction` is the band's width as a fraction of the
 * blade's size, so a cotyledon and a true leaf get the same weight of line.
 */
function buildLeafOutlineGeometry(
  length: number,
  width: number,
  segments: number,
  isCotyledon: boolean,
  inkFraction: number,
): THREE.BufferGeometry {
  const rows = Math.max(4, segments * 2);
  const cols = Math.max(4, segments * 2);
  const points = leafSurfacePoints(length, width, rows, cols, isCotyledon);
  const stride = cols + 1;
  const at = (row: number, col: number): [number, number, number] => {
    const i = (row * stride + col) * 3;
    return [points[i] ?? 0, points[i + 1] ?? 0, points[i + 2] ?? 0];
  };

  // The perimeter, in one loop: down one edge from the base, across the tip, back
  // up the other. The base itself is a single point, so it is visited once.
  const perimeter: Array<[number, number, number]> = [];
  for (let row = 0; row <= rows; row += 1) perimeter.push(at(row, 0));
  for (let col = 1; col <= cols; col += 1) perimeter.push(at(rows, col));
  for (let row = rows - 1; row >= 0; row -= 1) perimeter.push(at(row, cols));

  const centreX = length * 0.45;
  const outward = (p: [number, number, number]): [number, number, number] => [
    centreX + (p[0] - centreX) * (1 + inkFraction),
    p[1] * (1 + inkFraction),
    p[2],
  ];

  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < perimeter.length; i += 1) {
    const a = perimeter[i] as [number, number, number];
    const b = perimeter[(i + 1) % perimeter.length] as [number, number, number];
    const oa = outward(a);
    const ob = outward(b);
    const base = positions.length / 3;
    positions.push(...a, ...b, ...oa, ...ob);
    // Winding is free: the band is double sided.
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** A deterministic, type-appropriate mid-segment bow. */
function segmentBend(node: MeshNode, length: number): number {
  const type = node.nodeType.toLowerCase();
  const sign = hash01(node.id, 'segment-bend') * 2 - 1;
  if (type === 'radicle') return sign * length * 0.06;
  if (type === 'lateral_root') return sign * length * 0.24;
  if (type === 'root') return sign * length * 0.14;
  if (type === 'stem' || type === 'branch') return sign * length * 0.05;
  if (type === 'vine') return sign * length * 0.1;
  return 0;
}

export class MeshPlantRenderer {
  /**
   * AL-04: use the shared atmosphere instead of the scene's fog, so a mesh plant
   * fades into the same air as the ground and the SDF plants.
   */
  /**
   * The light blades are lit from behind by, and how much of it they let through.
   *
   * The direction is the celestial body's - the sun by day, the moon at night - so
   * the same blade turns honey at sunset and cold silver under the moon without a
   * second set of numbers. Strength follows the light's own intensity, so the
   * effect fades exactly as the disc does.
   */
  setSunLight(dir: THREE.Vector3, colour: THREE.Color, intensity: number): void {
    const strength = intensity * 0.85;
    for (const material of BASE_MATERIALS) setLeafBacklight(material, dir, colour, strength);
    for (const material of this.materialVariants.values()) {
      setLeafBacklight(material, dir, colour, strength);
    }
  }

  setAtmosphere(params: AtmosphereParams, sunDir: THREE.Vector3): void {
    atmosphereParams = params;
    atmosphereSunDir.copy(sunDir);
    for (const material of BASE_MATERIALS) {
      applyAtmosphereToStandardMaterial(material, params, atmosphereSunDir);
    }
    for (const material of this.materialVariants.values()) {
      applyAtmosphereToStandardMaterial(material, params, atmosphereSunDir);
    }
    // Ink is a line, not a surface: it takes the same air as the organ it outlines
    // but a quarter of the in-scatter. At full strength the haze washed the band
    // to a pale rim at night, brighter than the leaf it was drawn around; cut back,
    // the line stays below the body's value at every hour, which is what an ink
    // value is for.
    const inkParams: AtmosphereParams = { ...params, inScatter: params.inScatter * 0.25 };
    for (const material of this.inkVariants.values()) {
      applyAtmosphereToStandardMaterial(material, inkParams, atmosphereSunDir);
    }
  }

  private scene: THREE.Scene;
  private meshGroup = new THREE.Group();
  /** One ink material for every woody tube in the scene; the width is a uniform. */
  private readonly inkMaterial = createInkMaterial(INK_WIDTH_M);
  /**
   * Ink for the organs the tube hull cannot outline: one material per organ colour.
   *
   * Foliage is not outlined in the plate's root brown. Its line is its own pigment
   * at its deepest - green in dark green, a petal in its own shade - so the outline
   * belongs to the thing it surrounds instead of being a stamp over every growth.
   */
  private readonly inkVariants = new Map<string, THREE.MeshStandardMaterial>();
  private readonly inkColour = new THREE.Color();

  /**
   * Ink for one node's own colour. `blade` is the flat band a leaf lies on; `hull`
   * is the inverted hull a flower or spore sac wears.
   */
  private inkFor(node: MeshNode, kind: 'blade' | 'hull'): THREE.MeshStandardMaterial {
    const base = this.materialFor(node.nodeType, this.lookFor(node), this.healthBandOf(node)).color;
    inkColourFor(base, this.inkColour);
    const key = `${kind}:${this.inkColour.getHexString()}`;
    const cached = this.inkVariants.get(key);
    if (cached) return cached;
    const material =
      kind === 'blade'
        ? createBladeInkMaterial(this.inkColour.clone())
        : createInkMaterial(INK_WIDTH_M, this.inkColour.clone());
    // The same air as the organ it outlines, at a quarter of the in-scatter, so the
    // line cannot out-brighten the body at night: an ink that ignores the hour is
    // the one fixed colour left in a lit scene.
    applyAtmosphereToStandardMaterial(
      material,
      { ...atmosphereParams, inScatter: atmosphereParams.inScatter * 0.25 },
      atmosphereSunDir,
    );
    this.inkVariants.set(key, material);
    return material;
  }
  private nodeMap = new Map<string, MeshNode>();
  private childrenMap = new Map<string, string[]>();
  private segments = new Map<string, MeshSegmentData>();
  /** Bumped when a look change alters geometry (bark thickness, spines). */
  private geometryRevision = 0;
  private lookGeometryKey = '';
  private seedMeshes = new Map<string, THREE.Mesh>();
  private nodeFirstSeen = new Map<string, number>();
  private hasPlantData = false;
  private structureDirty = true;
  private readonly quality: MeshQualityConfig;
  // One tinted material per (organ type, signature). Materials live on the
  // instance and are never mutated after creation, so two plants with different
  // signatures cannot repaint each other (the old shared-material leak).
  private readonly materialVariants = new Map<string, THREE.MeshStandardMaterial>();
  // Look parameters belong to a plant, not to the renderer: the own plant's
  // petals must never leak onto a rival.
  private readonly appearanceByPlant = new Map<string, MeshAppearance>();
  // Pigment is per mutation, not per signature: two mutations sharing a
  // signature still carry their own visual_params and organ target.
  private readonly lookByPlant = new Map<string, MutationLookStack>();

  private lastSignatureKey = '';

  /** The soil as drawn, so a seed or a footprint rests on the triangle under it. */
  private readonly drawnGround = new DrawnGround();
  /** Height field under a point; classifies roots from above-ground parts. */
  private groundQuery: ((x: number, z: number) => number) | null = null;
  /** One contact patch per plant, laid in the ground plane like a drop's. */
  private contactShadows!: PlantContactShadows;

  /**
   * Give the mesh pass the mesh the ground is drawn as.
   *
   * The height field and the drawn soil are not the same surface: the terrain is
   * a coarse triangle mesh, so between two vertices the drawn ground can stand
   * well above the field, by tens of centimetres where the relief is steep. A
   * seed seated on the field sank into that triangle - half a coat underwater
   * beside a shore. Casting down onto the mesh seats it on the surface on screen.
   */
  setGroundMesh(mesh: THREE.Object3D | null): void {
    this.drawnGround.setMesh(mesh);
  }

  /**
   * Give the mesh pass the terrain height function the ground is drawn from.
   *
   * Without it the seed had only its stored contact point, which is a server
   * coordinate: a coat could hover over soil that the client painted lower.
   */
  setGroundQuery(query: ((x: number, z: number) => number) | null): void {
    this.groundQuery = query;
    this.drawnGround.setFallback(query);
  }

  constructor(scene: THREE.Scene, quality: Partial<MeshQualityConfig> = {}) {
    if (!organPaletteApplied) {
      throw new Error(
        'MeshPlantRenderer: call applyOrganPalette(palette) before building the plant',
      );
    }
    this.quality = { ...DEFAULT_MESH_QUALITY, ...quality };
    this.scene = scene;
    this.scene.add(this.meshGroup);
    this.meshGroup.visible = false;
    // The footprint is laid on the drawn slope, not the analytic field: a patch
    // flat against the field while the triangle under it faces elsewhere is the
    // shadow that reads as hovering.
    this.contactShadows = new PlantContactShadows({
      scene,
      groundNormal: (x, z) => this.drawnGround.sample(x, z).normal,
    });
  }

  /**
   * T04 look parameters that come from the mutation set rather than a symbol:
   * petal count and leaf/seed scale. A change forces a geometry rebuild.
   */
  setMutationAppearance(appearance: MeshAppearance): void {
    this.appearanceByPlant.set('own', { ...appearance });
    this.structureDirty = true;
  }

  /** Store a plant's look (own or a rival's, from the sync payload). */
  setPlantAppearance(plantId: string, appearance: MeshAppearance): void {
    this.appearanceByPlant.set(plantId, { ...appearance });
    this.structureDirty = true;
  }

  /** Store a plant's composed looks (own plant, or a rival's when synced). */
  setPlantLook(plantId: string, look: MutationLookStack): void {
    this.lookByPlant.set(plantId, look);
    const key = geometryKey(look);
    if (key !== this.lookGeometryKey) {
      // Bark thickness and spines are built into the tube meshes, so a change
      // there has to drop the existing segments or the plant keeps its old
      // silhouette for the rest of its life.
      this.lookGeometryKey = key;
      this.geometryRevision += 1;
    }
    this.structureDirty = true;
  }

  /** The composed look that applies to a node's plant; neutral when unknown. */
  private lookFor(node: MeshNode): MutationLook {
    const stack =
      (node.plantId ? this.lookByPlant.get(node.plantId) : undefined) ??
      (node.isOwnPlant ? this.lookByPlant.get('own') : undefined) ??
      NEUTRAL_STACK;
    return organLook(stack, node.nodeType);
  }

  /** Look parameters for the plant this node belongs to (defaults if unknown). */
  private appearanceFor(node: MeshNode): MeshAppearance {
    return (
      (node.plantId ? this.appearanceByPlant.get(node.plantId) : undefined) ??
      this.appearanceByPlant.get(node.isOwnPlant ? 'own' : 'rival') ??
      DEFAULT_APPEARANCE
    );
  }

  /** Woody organs: bark thickness and spines belong here, leaves do not. */
  private static isWoodyType(nodeType: string): boolean {
    return organFamily(nodeType) === 'woody';
  }

  /** Tinted material for one organ and one pigment; cached per variant. */
  /** The health band a drawn part is in, from the panel's own thresholds. */
  private healthBandOf(node: MeshNode): NodeHealthStatus {
    return nodeHealthStatus(node.health, node.growthProgress);
  }

  private materialFor(
    nodeType: string,
    look: MutationLook,
    health: NodeHealthStatus = 'intact',
  ): THREE.MeshStandardMaterial {
    const tint = look.tint.map((v) => v.toFixed(2)).join(',');
    const key = [
      nodeType,
      look.signature,
      tint,
      look.tintStrength.toFixed(2),
      look.variegation.toFixed(2),
      look.variegationColor.map((v) => v.toFixed(2)).join(','),
      look.glow.toFixed(2),
      look.glowColor.map((v) => v.toFixed(2)).join(','),
      look.barkDarken.toFixed(2),
      look.pattern,
      // Health is part of the material, so it is part of the cache key: a plant
      // that loses tissue must not keep the healthy variant's material.
      health,
    ].join(':');
    const cached = this.materialVariants.get(key);
    if (cached) return cached;
    // `cloneStandaloneMaterial`, not `.clone()`: the base carries the atmosphere
    // bookkeeping, and a plain copy would arrive with it flattened by JSON and
    // throw when the patcher below wrote its uniforms.
    const material = cloneStandaloneMaterial(baseMaterialFor(nodeType));
    applyNodeHealthLook(material, health);
    // Before the atmosphere patch, which chains whatever is already here.
    if (usesSoilRamp(nodeType)) applySoilRamp(material);
    // A blade is thin, so it transmits: patched before the atmosphere, which
    // chains whatever is already attached.
    const type = nodeType.toLowerCase();
    if (type === 'leaf' || type === 'cotyledon') applyLeafTranslucency(material);
    // A copy does not carry a shader patch across, so each new variant is
    // attached to the shared atmosphere as it is created.
    applyAtmosphereToStandardMaterial(material, atmosphereParams, atmosphereSunDir);
    // Only the mutation's own organs are repainted: "variegated foliage" must
    // not frost the trunk, and "thickened bark" must not tint the leaves.
    if (lookAppliesTo(look, nodeType)) {
      // The tint is already composed and clamped by the look builder, so it is
      // applied as a straight multiplier: no extra strength here to double it.
      material.color.multiply(TMP_TINT.setRGB(...look.tint));
      // Variegation is a pale mottle in the mutation's own variegation colour.
      if (look.variegation > 0) {
        material.color.lerp(TMP_TINT.setRGB(...look.variegationColor), look.variegation);
      }
      if (look.barkDarken > 0) {
        material.color.multiplyScalar(1 - look.barkDarken);
      }
      if (look.glow > 0) {
        material.emissive.setRGB(...look.glowColor).multiplyScalar(look.glow * 0.6);
        material.emissiveIntensity = 1;
      }
    }
    this.materialVariants.set(key, material);
    return material;
  }

  updatePlantData(nodes: PlantNodeData[]): void {
    this.nodeMap.clear();
    this.childrenMap.clear();

    const now = performance.now();
    const firstLoad = !this.hasPlantData;
    this.hasPlantData = true;
    const nextFirstSeen = new Map<string, number>();
    for (const n of nodes) {
      const firstSeen = this.nodeFirstSeen.get(n.id) ?? (firstLoad ? now - 10_000 : now);
      nextFirstSeen.set(n.id, firstSeen);
      const node: MeshNode = {
        id: n.id,
        plantId: (n as { plantId?: string }).plantId,
        mutationFlags: n.mutationFlags ?? 0,
        position: n.position.clone(),
        radius: n.radius,
        nodeType: n.nodeType ?? 'stem',
        parentId: n.parentId,
        children: n.children ?? [],
        biomass: n.biomass ?? 0,
        // A missing health field is not damage (the same rule the panels use): a
        // default of 0.5 drew every part it could not vouch for in the dry tint,
        // which is a claim the payload never made.
        health: n.health ?? 1,
        isOwnPlant: n.isOwnPlant ?? true,
        growthProgress: n.growthProgress ?? 1.0,
        attachFraction: n.attachFraction,
        spawnTime: n.spawnTime ?? 0,
        age: n.age ?? 0,
        firstSeenMs: firstSeen,
      };
      // The attach point is part of the finished skeleton, not just the growth
      // animation. Keeping it only while growthProgress < 1 made a completed
      // lateral root start at its parent's tip instead of the spot it actually
      // budded from, so a third root looked detached from the second.
      if (
        n.parentAttachX !== undefined &&
        n.parentAttachY !== undefined &&
        n.parentAttachZ !== undefined
      ) {
        node.parentAttachPosition = new THREE.Vector3(
          n.parentAttachX,
          n.parentAttachY,
          n.parentAttachZ,
        );
      }
      if (
        n.targetX !== undefined &&
        n.targetY !== undefined &&
        n.targetZ !== undefined &&
        n.growthProgress !== undefined &&
        n.growthProgress < 1.0
      ) {
        node.targetPosition = new THREE.Vector3(n.targetX, n.targetY, n.targetZ);
      }
      this.nodeMap.set(n.id, node);
    }

    this.nodeFirstSeen = nextFirstSeen;
    // A signature change must rebuild meshes so each node picks up the material
    // variant for its own signature; the old leak painted shared materials.
    const signatureKey = nodes.map((n) => n.mutationFlags ?? 0).join(',');
    if (signatureKey !== this.lastSignatureKey) {
      this.lastSignatureKey = signatureKey;
      this.structureDirty = true;
    }

    for (const [id, node] of this.nodeMap) {
      if (node.parentId && this.nodeMap.has(node.parentId)) {
        const parentChildren = this.childrenMap.get(node.parentId) ?? [];
        if (!parentChildren.includes(id)) {
          parentChildren.push(id);
          this.childrenMap.set(node.parentId, parentChildren);
        }
      }
    }

    this.structureDirty = true;
    this.updateContactShadows();
  }

  /**
   * One footprint per plant, from the parts that stand above its soil, seated on
   * the drawn ground rather than the field under it.
   */
  private updateContactShadows(): void {
    const query = this.groundQuery;
    const footprints: PlantFootprint[] = plantFootprints(
      [...this.nodeMap.values()].map((node) => ({
        plantId: node.plantId,
        isOwnPlant: node.isOwnPlant,
        position: node.position,
      })),
      (x, z) => query?.(x, z) ?? 0,
    ).map((foot) => ({ ...foot, groundY: this.drawnGround.height(foot.x, foot.z) }));
    this.contactShadows.update(footprints);
  }

  /** Drop every mesh a segment owns; geometry is disposed, materials are shared. */
  private disposeSegment(seg: MeshSegmentData): void {
    this.meshGroup.remove(seg.mesh);
    seg.mesh.geometry.dispose();
    if (seg.inkMesh) {
      // The hull shares the tube's geometry, which the line above has disposed.
      this.meshGroup.remove(seg.inkMesh);
    }
    if (seg.jointMesh) {
      this.meshGroup.remove(seg.jointMesh);
      seg.jointMesh.geometry.dispose();
    }
    for (const leaf of seg.leafMeshes) {
      this.meshGroup.remove(leaf);
      leaf.geometry.dispose();
    }
    for (const pad of seg.leafInkMeshes) {
      this.meshGroup.remove(pad);
      pad.geometry.dispose();
    }
    for (const hull of seg.inkOrnament) {
      hull.removeFromParent();
    }
    for (const spine of seg.spineMeshes) {
      this.meshGroup.remove(spine);
      spine.geometry.dispose();
    }
    if (seg.ornament) {
      this.meshGroup.remove(seg.ornament);
    }
  }

  private rebuildIfNeeded(): void {
    if (!this.structureDirty) return;

    // Remove segments whose nodes no longer exist
    for (const [id, seg] of this.segments) {
      if (!this.nodeMap.has(id)) {
        this.disposeSegment(seg);
        this.segments.delete(id);
      }
    }

    // Seed meshes: root-level seed nodes draw as a rounded ovoid seed sitting
    // on the ground. It must read as a seed, not as a primitive cone.
    const activeSeedIds = new Set<string>();
    for (const [id, node] of this.nodeMap) {
      const isSeed =
        node.parentId === null && (node.nodeType === 'seed' || node.id.startsWith('seed'));
      if (!isSeed) continue;
      activeSeedIds.add(id);
      const existingSeed = this.seedMeshes.get(id);
      if (existingSeed) {
        // Seeds are created once and kept; a later mutation still has to
        // repaint the coat, or the seed keeps the material it was born with.
        existingSeed.material = this.materialFor(
          'seed',
          this.lookFor(node),
          this.healthBandOf(node),
        );
        // The seed has to follow its node. It was positioned once at birth, so
        // after a reroot crawl the body crawled away and left its seed standing
        // on the old ground - the plant looked like it had not moved at all.
        const builtAt = existingSeed.userData.sourcePosition as THREE.Vector3 | undefined;
        if (builtAt) {
          existingSeed.position.x += node.position.x - builtAt.x;
          existingSeed.position.y += node.position.y - builtAt.y;
          existingSeed.position.z += node.position.z - builtAt.z;
          builtAt.copy(node.position);
        }
        continue;
      }
      const radius = resolveDrawnRadius('seed', node.radius, node.biomass);
      const geo = new THREE.SphereGeometry(radius, 20, 14);
      const mat = this.materialFor('seed', this.lookFor(node), this.healthBandOf(node));
      const mesh = new THREE.Mesh(geo, mat);
      // Slightly ovoid: a little taller than wide and flattened front-to-back.
      // The vertical scale is the shared seed aspect, so this ovoid is the same
      // shape and height as the one the WebGPU pass builds.
      const seedScale = this.appearanceFor(node).seedScale;
      mesh.scale.set(0.95 * seedScale, getSeedBodyHeightRatio() * seedScale, 0.85 * seedScale);
      // Sit the rounded base on the ground: the stored y is the contact point,
      // not the centre. The lift is the height actually drawn, so it takes the
      // same seedScale the ovoid is scaled by - lifting by the unscaled half
      // height left the base hovering whenever a plant's look shrank its seed.
      //
      // And the contact point is only trusted downwards: a seed that crawled
      // keeps the height it was placed at, so on soil drawn a few centimetres
      // lower it hung in the air. Seat it on the ground under it; never lift it
      // off that ground, so a stored point lower than the drawing still wins.
      const contactY = Number.isFinite(node.position.y)
        ? this.drawnGround.height(node.position.x, node.position.z)
        : node.position.y;
      mesh.position.set(
        node.position.x,
        seedBodyCentreY(contactY, radius * seedScale),
        node.position.z,
      );
      // Remember where it was drawn so later moves can be applied as a delta.
      mesh.userData.sourcePosition = node.position.clone();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // The coat is a body like any other, so it carries the same line. The hull is
      // a child of the seed, not a sibling: it inherits the ovoid's scale and every
      // move, and it shares the sphere's geometry, so it costs one draw and no
      // bookkeeping when the seed crawls.
      // The plate's own root brown, not the coat's colour deepened: a seed is
      // already a dark body, and its own ink landed on the coat as a value it
      // barely differed from. The line has to be a value below the body.
      const seedHull = new THREE.Mesh(geo, this.inkMaterial);
      seedHull.renderOrder = -1;
      seedHull.castShadow = false;
      seedHull.receiveShadow = false;
      mesh.add(seedHull);
      this.meshGroup.add(mesh);
      this.seedMeshes.set(id, mesh);
    }
    // Remove seed meshes for seeds that no longer exist
    for (const [id, mesh] of this.seedMeshes) {
      if (!activeSeedIds.has(id)) {
        this.meshGroup.remove(mesh);
        mesh.geometry.dispose();
        this.seedMeshes.delete(id);
      }
    }

    // Build segments for nodes with parents
    for (const [id, node] of this.nodeMap) {
      if (!node.parentId || !this.nodeMap.has(node.parentId)) continue;
      const existingSegment = this.segments.get(id);
      if (existingSegment) {
        const attach = node.parentAttachPosition;
        const builtAttach = existingSegment.sourceAttach;
        // Compared as the joint's offset *from the part*, not its absolute
        // position: a whole body that moves rigidly keeps that offset, so a
        // crawl does not rebuild every tube once a tick, while a joint that
        // changes relative to its own segment (lift, tilt, reroot) does.
        const jointMoved =
          attach !== undefined &&
          builtAttach !== undefined &&
          builtAttach
            .clone()
            .sub(existingSegment.sourcePosition)
            .distanceToSquared(attach.clone().sub(node.position)) > 1e-8;
        if (!jointMoved && existingSegment.lookRevision === this.geometryRevision) continue;
        // The look changed shape (bark thickness, spines), or the joint moved
        // under the tube: rebuild this part.
        this.disposeSegment(existingSegment);
        this.segments.delete(id);
      }

      const parent = this.nodeMap.get(node.parentId);
      if (!parent) continue;
      // The server already applied Murray's law and shipped the drawn radius.
      // Re-tapering here ignored the part's own biomass, so a starving node
      // kept its old full thickness even after the model said it had shrunk.

      // Determine segment end (target if growing)
      const segmentEnd = node.targetPosition ?? node.position.clone();

      const parentVisualRadius = resolveDrawnRadius(parent.nodeType, parent.radius, parent.biomass);
      const softPart =
        node.nodeType === 'leaf' ||
        node.nodeType === 'cotyledon' ||
        node.nodeType === 'flower' ||
        node.nodeType === 'spore_sac';
      let tubeEndRadius = resolveDrawnRadius(node.nodeType, node.radius, node.biomass);
      // A primed node is a little fuller than the tube it continues (see
      // nubBulge). The WebGPU mesh does this in applyNubBulges; this is the mesh
      // the player actually sees, so the swell has to be applied here too.
      //
      // Soft parts are exempt. The swell is a *tip* swell - it makes the growing
      // end of a woody tube full - and a leaf or cotyledon's drawn end is the
      // blade, not a tip of its own: swelling it made the petiole thicker where
      // the leaf met it than where it left the seed.
      if (!softPart) tubeEndRadius *= nubSwellForNode(node);
      // The parent's radius *where this part leaves it*: a lateral takes a
      // fraction of its parent's segment, and the segment necks down along
      // itself, so the parent's nominal radius sized a bud near its tip as if it
      // sat at the base. The parent's drawn start radius comes from its own
      // segment when it has been built; the first frame falls back to nominal.
      const parentSegment = this.segments.get(parent.id);
      const localFraction =
        typeof node.attachFraction === 'number' && node.attachFraction < 1
          ? Math.min(1, Math.max(0, node.attachFraction))
          : 1;
      const parentRadiusAtAttach = parentSegment
        ? segmentRadiusAt(parentSegment.r0, parentSegment.r1, localFraction)
        : parentVisualRadius;
      // A junction is a knuckle: wider than the child's shank, never wider than
      // the parent carrying it. This used to be the parent's full radius, which
      // drew a branch off a trunk as a cone 2.65x its own thickness.
      let tubeStartRadius = jointStartRadius(parentRadiusAtAttach, tubeEndRadius, softPart);

      // Anything emerging from a seed starts thin so the seed never turns into
      // a cone with a giant base.
      if (parent.nodeType === 'seed') {
        tubeStartRadius = Math.min(
          parentVisualRadius,
          isRootNodeType(node.nodeType) ? 0.03 : 0.035,
        );
        if (isRootNodeType(node.nodeType)) {
          tubeEndRadius = Math.min(tubeEndRadius, 0.03);
        }
      }
      // A petiole may only narrow towards its blade. Whatever the drawn radius
      // says, a stalk that gets wider at the leaf end reads as a growth put on
      // backwards, which is what every cotyledon looked like.
      if (softPart) tubeEndRadius = Math.min(tubeEndRadius, tubeStartRadius);

      // Start on the parent where it is drawn this frame. A child of a growing
      // parent used to start at the parent's final tip, leaving a visible gap
      // until the parent caught up.
      const parentType = (parent.nodeType ?? '').toLowerCase();
      const parentAnchor = parent.parentAttachPosition ?? parent.position;
      const parentGrowth = parent.growthProgress ?? 1;
      const parentDrawnEnd = parentAnchor.clone().lerp(parent.position, parentGrowth);
      let segmentStart: THREE.Vector3;
      if (parentType === 'seed') {
        const start = segmentStartFor({
          attach: node.parentAttachPosition,
          parentPosition: parent.position,
          seedCoatTopY: parent.position.y + seedBodyHalfHeight(parentVisualRadius) * 2,
          growsUp: segmentEnd.y > parent.position.y,
        });
        segmentStart = new THREE.Vector3(start.x, start.y, start.z);
      } else if (
        typeof node.attachFraction === 'number' &&
        node.attachFraction < 1 &&
        parent.parentAttachPosition
      ) {
        segmentStart = parentAnchor.clone().lerp(parentDrawnEnd, Math.max(0, node.attachFraction));
      } else {
        segmentStart = parentDrawnEnd.clone();
      }

      let dir = new THREE.Vector3().subVectors(segmentEnd, segmentStart);
      let length = dir.length();
      if (length < 0.001) continue;

      // Start inside the parent and let its own surface hide the base disc.
      // Pushing the base out to the surface leaves its rim tangent to it, which
      // reads as a crease rather than grown tissue.
      if (parentType !== 'seed') {
        const socket = Math.min(socketInset(parentRadiusAtAttach), length * 0.4);
        segmentStart.addScaledVector(dir.clone().normalize(), socket);
        dir = new THREE.Vector3().subVectors(segmentEnd, segmentStart);
        length = dir.length();
        if (length < 0.001) continue;
      }

      const bend = segmentBend(node, length);
      // Bark thickness is geometry, not paint: a thickened-bark plant is
      // physically fatter, and the same look also darkens the tube.
      const organLookNow = this.lookFor(node);
      const woody = MeshPlantRenderer.isWoodyType(node.nodeType);
      const barkScale = woody ? organLookNow.barkScale : 1;
      if (barkScale > 1) {
        tubeStartRadius *= barkScale;
        tubeEndRadius *= barkScale;
      }
      const taper = organTaperExponent(node.nodeType, getSegmentTaperExponent());
      const geo = buildTubeGeometry(
        tubeStartRadius,
        tubeEndRadius,
        length,
        this.quality,
        bend,
        taper,
      );
      const mat =
        node.nodeType === 'flower' || node.nodeType === 'spore_sac'
          ? this.materialFor('stem', this.lookFor(node), this.healthBandOf(node))
          : this.materialFor(node.nodeType, this.lookFor(node), this.healthBandOf(node));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(segmentStart);
      if (length > 0.001) {
        // The tube geometry grows along +Y from its base now.
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      }
      this.meshGroup.add(mesh);

      // `spined_epidermis` bristles: spines share the tube's transform so they
      // grow, bend and vanish with the part they sit on.
      const spineMeshes: THREE.Mesh[] = [];
      if (woody && organLookNow.spines > 0) {
        const spineGeo = buildSpineGeometry(
          tubeStartRadius,
          tubeEndRadius,
          length,
          organLookNow.spines,
        );
        if (spineGeo) {
          const spineMat = this.materialFor('stem', organLookNow, this.healthBandOf(node));
          const spines = new THREE.Mesh(spineGeo, spineMat);
          spines.position.copy(mesh.position);
          spines.quaternion.copy(mesh.quaternion);
          spines.castShadow = true;
          this.meshGroup.add(spines);
          spineMeshes.push(spines);
        }
      }

      // Joint sphere at segment end
      let jointMesh: THREE.Mesh | null = null;
      if (tubeEndRadius > 0.012) {
        const jointGeo = new THREE.SphereGeometry(
          tubeEndRadius * this.quality.jointScale,
          this.quality.jointWidthSegments,
          this.quality.jointHeightSegments,
        );
        jointMesh = new THREE.Mesh(jointGeo, mat);
        jointMesh.position.copy(segmentEnd);
        this.meshGroup.add(jointMesh);
      }

      // Foliage: one broad blade per cotyledon (a seed leaf is a single organ),
      // true leaves multiply with biomass. Blades are attached exactly at the
      // growing tip — never floated past it.
      const leafMeshes: THREE.Mesh[] = [];
      const leafInkMeshes: THREE.Mesh[] = [];
      if (node.nodeType === 'leaf' || node.nodeType === 'cotyledon') {
        const isCotyledon = node.nodeType === 'cotyledon';
        // Cotyledons are seed leaves: fleshy and large enough to read as the
        // first photosynthetic organs. True leaves start smaller and broaden
        // as the node matures.
        const leafLength = isCotyledon
          ? THREE.MathUtils.clamp(parentVisualRadius * 6.2, 0.3, this.quality.maxLeafSize * 1.2)
          : THREE.MathUtils.clamp(
              resolveDrawnRadius(node.nodeType, node.radius, node.biomass) * 14,
              0.14,
              Math.min(0.3, this.quality.maxLeafSize),
            );
        const leafWidth = leafLength * (isCotyledon ? 0.88 : 0.66);
        const leafCount = isCotyledon
          ? 1
          : Math.min(this.quality.maxLeavesPerNode, Math.max(1, Math.floor(node.biomass / 3)));
        const axis = dir.clone().normalize();
        for (let i = 0; i < leafCount; i++) {
          const leafGeo = buildLeafGeometry(
            leafLength * this.appearanceFor(node).leafScale,
            leafWidth * this.appearanceFor(node).leafScale,
            this.quality.leafSegments,
            isCotyledon,
          );
          const leaf = new THREE.Mesh(
            leafGeo,
            this.materialFor(node.nodeType, this.lookFor(node), this.healthBandOf(node)),
          );
          const angle = (i / Math.max(1, leafCount)) * Math.PI * 2;
          this.placeLeaf(leaf, segmentEnd, axis, angle, isCotyledon);
          // The plate's ink under a blade: the same blade, a few per cent bigger,
          // unlit, painted first - so a rim of ink shows around the silhouette.
          // The tube hull cannot do this: a blade is a surface, and a surface pushed
          // along its own normals is still the same surface underneath itself.
          const leafInk = new THREE.Mesh(
            buildLeafOutlineGeometry(
              leafLength * this.appearanceFor(node).leafScale,
              leafWidth * this.appearanceFor(node).leafScale,
              this.quality.leafSegments,
              isCotyledon,
              BLADE_INK_FRACTION,
            ),
            this.inkFor(node, 'blade'),
          );
          leafInk.position.copy(leaf.position);
          leafInk.quaternion.copy(leaf.quaternion);
          leafInk.scale.copy(leaf.scale);
          leafInk.renderOrder = -1;
          leafInk.castShadow = false;
          leafInk.receiveShadow = false;
          this.meshGroup.add(leafInk);
          leafInkMeshes.push(leafInk);
          this.meshGroup.add(leaf);
          leafMeshes.push(leaf);
        }
      }

      let ornament: THREE.Group | null = null;
      if (node.nodeType === 'flower') {
        ornament = this.buildFlower(node, segmentEnd, dir);
      } else if (node.nodeType === 'spore_sac') {
        ornament = this.buildSporeSac(node, segmentEnd, dir);
      }
      // Flowers and spore sacs are volumes, so they take the same inverted hull the
      // tubes do - mounted as children of their group so they follow it.
      const inkOrnament: THREE.Object3D[] = [];
      if (ornament) {
        for (const child of [...ornament.children]) {
          const asMesh = child as THREE.Mesh;
          if (!asMesh.isMesh) continue;
          const hull = new THREE.Mesh(asMesh.geometry, this.inkFor(node, 'hull'));
          hull.position.copy(child.position);
          hull.quaternion.copy(child.quaternion);
          hull.scale.copy(child.scale);
          hull.renderOrder = -1;
          hull.castShadow = false;
          hull.receiveShadow = false;
          ornament.add(hull);
          inkOrnament.push(hull);
        }
        this.meshGroup.add(ornament);
      }

      this.meshGroup.add(mesh);

      // The plate's ink: the same tube, back faces, pushed out along its normals
      // by a constant world distance.
      //
      // Every segment is a body and takes one. This used to be gated on the organ
      // type, which was the wrong unit: a cotyledon's petiole is drawn as this
      // node's own tube, so excluding "cotyledon" and "leaf" as blades left the
      // stalks of every leaf and seed leaf un-inked while their blades were
      // outlined. The blade's band is a second line for the blade; it was never a
      // reason for its stalk to go bare.
      let inkMesh: THREE.Mesh | null = null;
      // A green stem in the roots' warm brown reads as a root that grew upwards:
      // above the soil the line is the organ's own colour, deepened.
      inkMesh = new THREE.Mesh(
        geo,
        usesOwnInkColour(node.nodeType) ? this.inkFor(node, 'hull') : this.inkMaterial,
      );
      inkMesh.position.copy(mesh.position);
      inkMesh.quaternion.copy(mesh.quaternion);
      inkMesh.renderOrder = -1;
      inkMesh.castShadow = false;
      inkMesh.receiveShadow = false;
      this.meshGroup.add(inkMesh);

      // Bark to pale root across the soil line, decided per part: materials are
      // shared between segments and plants, so the ground under this one is
      // handed to the shader on its own draw.
      if (usesSoilRamp(node.nodeType)) {
        const soilY = this.drawnGround.height(mesh.position.x, mesh.position.z);
        mesh.onBeforeRender = (_renderer, _scene, _camera, _geometry, material) => {
          setSoilLine(material, soilY);
        };
      }

      this.segments.set(id, {
        // The segment's own start is where it is actually drawn from — the
        // attach point — so the growth animation must extend it from there.
        p0: segmentStart.clone(),
        p1: segmentEnd.clone(),
        r0: tubeStartRadius,
        r1: tubeEndRadius,
        nodeType: node.nodeType,
        isOwnPlant: node.isOwnPlant,
        growthProgress: node.growthProgress ?? 1.0,
        mesh,
        jointMesh,
        leafMeshes,
        leafInkMeshes,
        inkOrnament,
        spineMeshes,
        lookRevision: this.geometryRevision,
        healthBand: this.healthBandOf(node),
        ornament,
        inkMesh,
        parentPosition: segmentStart.clone(),
        targetPosition: segmentEnd.clone(),
        sourcePosition: node.position.clone(),
        sourceAttach: node.parentAttachPosition?.clone(),
        originalRadius0: tubeStartRadius,
        originalRadius1: tubeEndRadius,
        originalLength: length,
        bend,
      });
    }

    this.structureDirty = false;
  }

  /**
   * Attach a blade at the tip of its own stem. The previous code offset the blade
   * half a segment PAST the tip and then rotated it around that point, which is
   * why cotyledons looked like shreds thrown into the air instead of leaves
   * attached where they sprouted.
   */
  private placeLeaf(
    leaf: THREE.Mesh,
    tip: THREE.Vector3,
    axis: THREE.Vector3,
    angle: number,
    isCotyledon: boolean,
  ): void {
    const safeAxis = axis.lengthSq() < 1e-6 ? new THREE.Vector3(0, 1, 0) : axis.clone().normalize();

    // Build an explicit blade frame instead of using lookAt, whose roll is
    // arbitrary. Local +X runs from the petiole to the tip, +Z is the upper
    // face, and +Y is the leaf's width.
    const forward = new THREE.Vector3(safeAxis.x, 0, safeAxis.z);
    if (forward.lengthSq() < 1e-4) {
      forward.set(Math.cos(angle), 0, Math.sin(angle));
    }
    forward.normalize();
    if (!isCotyledon) forward.applyAxisAngle(safeAxis, angle);

    const normal = new THREE.Vector3(0, 1, 0)
      .addScaledVector(forward, isCotyledon ? 0.1 : 0.2)
      .normalize();
    forward.addScaledVector(normal, -forward.dot(normal)).normalize();
    const side = new THREE.Vector3().crossVectors(normal, forward).normalize();
    const correctedForward = new THREE.Vector3().crossVectors(side, normal).normalize();

    leaf.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(correctedForward, side, normal),
    );
    leaf.position.copy(tip);
  }

  /** A small, readable flower head instead of falling through to a bark tube. */
  private buildFlower(node: MeshNode, tip: THREE.Vector3, axis: THREE.Vector3): THREE.Group {
    const group = new THREE.Group();
    group.position.copy(tip);
    const safeAxis = axis.lengthSq() < 1e-6 ? new THREE.Vector3(0, 1, 0) : axis.clone().normalize();
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), safeAxis);
    const r = THREE.MathUtils.clamp(
      resolveDrawnRadius(node.nodeType, node.radius, node.biomass) * 9,
      0.045,
      0.1,
    );
    const petalGeo = new THREE.SphereGeometry(1, 10, 6);
    const petalCount = Math.max(3, Math.min(16, Math.round(this.appearanceFor(node).petalCount)));
    for (let i = 0; i < petalCount; i += 1) {
      const angle = (i / petalCount) * Math.PI * 2;
      const petal = new THREE.Mesh(
        petalGeo,
        this.materialFor('flower', this.lookFor(node), this.healthBandOf(node)),
      );
      petal.position.set(Math.cos(angle) * r * 0.62, 0, Math.sin(angle) * r * 0.62);
      petal.rotation.y = -angle;
      petal.scale.set(r * 0.62, r * 0.1, r * 0.3);
      group.add(petal);
    }
    const centre = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      this.materialFor('flower_centre', this.lookFor(node), this.healthBandOf(node)),
    );
    centre.scale.set(r * 0.28, r * 0.16, r * 0.28);
    group.add(centre);
    return group;
  }

  /** A cluster of spore capsules for the non-flowering reproductive node. */
  private buildSporeSac(node: MeshNode, tip: THREE.Vector3, axis: THREE.Vector3): THREE.Group {
    const group = new THREE.Group();
    group.position.copy(tip);
    const safeAxis = axis.lengthSq() < 1e-6 ? new THREE.Vector3(0, 1, 0) : axis.clone().normalize();
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), safeAxis);
    const r = THREE.MathUtils.clamp(
      resolveDrawnRadius(node.nodeType, node.radius, node.biomass) * 10,
      0.04,
      0.085,
    );
    for (let i = 0; i < 4; i += 1) {
      const angle = (i / 4) * Math.PI * 2;
      const capsule = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 7), sporeMaterial);
      capsule.position.set(Math.cos(angle) * r * 0.34, r * 0.1, Math.sin(angle) * r * 0.34);
      capsule.scale.set(r * 0.27, r * 0.42, r * 0.27);
      group.add(capsule);
    }
    return group;
  }

  updateGrowth(deltaTime: number): void {
    let needsUpdate = false;

    for (const [id, seg] of this.segments) {
      const node = this.nodeMap.get(id);
      if (!node) continue;

      // Health is part of a part's material, so a plant that loses tissue has to
      // be rebuilt to show it. Band changes are rare (a damage event, not a tick),
      // so this asks for one rebuild per change rather than a per-frame re-tint.
      const band = this.healthBandOf(node);
      if (seg.healthBand !== band) {
        seg.healthBand = band;
        this.structureDirty = true;
      }

      // Follow the live skeleton. Everything above this point was placed once, at
      // build time, so a body that moved afterwards - an uproot crawl, a plant
      // anchored somewhere else - was drawn at the spot it had left while Root
      // Sight's pit followed the server. The move is rigid, so every mesh the
      // segment owns is translated by the same delta; no geometry is rebuilt.
      const shiftX = node.position.x - seg.sourcePosition.x;
      const shiftY = node.position.y - seg.sourcePosition.y;
      const shiftZ = node.position.z - seg.sourcePosition.z;
      if (shiftX * shiftX + shiftY * shiftY + shiftZ * shiftZ > 1e-10) {
        const shift = new THREE.Vector3(shiftX, shiftY, shiftZ);
        seg.mesh.position.add(shift);
        seg.jointMesh?.position.add(shift);
        for (const leaf of seg.leafMeshes) leaf.position.add(shift);
        for (const pad of seg.leafInkMeshes) pad.position.add(shift);
        for (const spine of seg.spineMeshes) spine.position.add(shift);
        seg.inkMesh?.position.add(shift);
        seg.ornament?.position.add(shift);
        seg.parentPosition.add(shift);
        seg.targetPosition.add(shift);
        seg.sourcePosition.copy(node.position);
        needsUpdate = true;
      }

      const targetProgress = node.growthProgress ?? 1.0;
      let currentProgress = seg.growthProgress;
      // Ease toward the server's growth progress instead of snapping to it.
      currentProgress = THREE.MathUtils.lerp(currentProgress, targetProgress, deltaTime * 3);
      if (Math.abs(currentProgress - targetProgress) < 0.001) currentProgress = targetProgress;
      seg.growthProgress = currentProgress;

      if (currentProgress < 1.0) {
        // Smoothstep so a segment accelerates out of the parent and settles into
        // its final length, rather than extending at a constant mechanical rate.
        const eased = currentProgress * currentProgress * (3 - 2 * currentProgress);
        const p0 = seg.parentPosition;
        const p1 = seg.targetPosition;
        const currentEnd = new THREE.Vector3().lerpVectors(p0, p1, eased);
        const dir = new THREE.Vector3().subVectors(currentEnd, p0);
        const length = dir.length();

        // Update geometry in-place
        const newGeo = buildTubeGeometry(
          seg.originalRadius0,
          seg.originalRadius1 * currentProgress,
          length,
          this.quality,
          seg.bend * (length / Math.max(seg.originalLength, 1e-4)),
          organTaperExponent(seg.nodeType, getSegmentTaperExponent()),
        );
        seg.mesh.geometry.dispose();
        seg.mesh.geometry = newGeo;
        seg.mesh.position.copy(p0);
        if (length > 0.001) {
          seg.mesh.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            dir.clone().normalize(),
          );
        }
        // The ink hull is the same tube: it follows the growth step exactly.
        if (seg.inkMesh) {
          seg.inkMesh.geometry = newGeo;
          seg.inkMesh.position.copy(seg.mesh.position);
          seg.inkMesh.quaternion.copy(seg.mesh.quaternion);
        }

        // Update joint sphere
        if (seg.jointMesh) {
          seg.jointMesh.position.copy(currentEnd);
          seg.jointMesh.scale.setScalar(currentProgress);
        }

        // Update leaves: stay pinned to the tip while it extends, and unfurl.
        const leafDir = dir.clone().normalize();
        for (let i = 0; i < seg.leafMeshes.length; i++) {
          const leaf = seg.leafMeshes[i];
          const angle = (i / Math.max(1, seg.leafMeshes.length)) * Math.PI * 2;
          this.placeLeaf(leaf, currentEnd, leafDir, angle, seg.nodeType === 'cotyledon');
          // The pad is the blade's own shadow: same place, same angle, bigger.
          const pad = seg.leafInkMeshes[i];
          if (pad) {
            pad.position.copy(leaf.position);
            pad.quaternion.copy(leaf.quaternion);
          }
        }

        needsUpdate = true;
      }

      // Seed leaves keep expanding after the segment has finished extending.
      // This is the post-emergence greening/expansion stage, not a second
      // growth animation: the blade opens and broadens, then holds.
      const isCotyledon = seg.nodeType === 'cotyledon';
      const age = node.age > 0.01 ? node.age : (performance.now() - node.firstSeenMs) / 1000;
      const matureScale = isCotyledon ? 0.62 + 0.58 * THREE.MathUtils.clamp(age / 2.6, 0, 1) : 1;
      const extended = node.growthProgress ?? 1;
      const growthScale = 0.35 + 0.65 * extended * extended * (3 - 2 * extended);
      for (const leaf of seg.leafMeshes) {
        leaf.scale.setScalar(growthScale * matureScale);
      }
      for (const pad of seg.leafInkMeshes) {
        pad.scale.setScalar(growthScale * matureScale);
      }
      if (seg.ornament) {
        const ornamentEnd = new THREE.Vector3().lerpVectors(
          seg.parentPosition,
          seg.targetPosition,
          currentProgress * currentProgress * (3 - 2 * currentProgress),
        );
        seg.ornament.position.copy(ornamentEnd);
        seg.ornament.scale.setScalar(growthScale);
      }
    }

    if (needsUpdate || this.structureDirty) {
      this.rebuildIfNeeded();
    }
  }

  render(deltaTime: number): void {
    this.rebuildIfNeeded();
    this.updateGrowth(deltaTime);
    this.meshGroup.visible = true;
    // The shade belongs to the plant: it is drawn exactly when the body is.
    this.contactShadows.setVisible(true);
  }

  setVisible(visible: boolean): void {
    this.meshGroup.visible = visible;
    this.contactShadows.setVisible(visible);
  }

  setLOD(): void {
    // LOD handled by tier selection in caller; mesh renderer always renders full detail
  }

  /**
   * Every drawn surface, mapped to the node that owns it.
   *
   * Clicking the plant must land on the plant. The pick spheres the caller casts
   * are sized from the node radius, so a click between two nodes - on the tube,
   * on a leaf, on a thorn - used to fall through the plant and hit nothing, which
   * read as "clicking the middle of my plant does nothing". The tubes, joints,
   * leaves, spines and ornaments here are the same meshes the player sees, so a
   * hit on any of them names the node to grow from.
   */
  pickSurfaces(): Array<{
    nodeId: string;
    plantId: string | undefined;
    isOwnPlant: boolean;
    object: THREE.Object3D;
  }> {
    const out: Array<{
      nodeId: string;
      plantId: string | undefined;
      isOwnPlant: boolean;
      object: THREE.Object3D;
    }> = [];
    for (const [nodeId, seg] of this.segments) {
      const plantId = this.nodeMap.get(nodeId)?.plantId;
      const push = (object: THREE.Object3D | null): void => {
        if (object) out.push({ nodeId, plantId, isOwnPlant: seg.isOwnPlant, object });
      };
      push(seg.mesh);
      push(seg.jointMesh);
      for (const leaf of seg.leafMeshes) push(leaf);
      for (const spine of seg.spineMeshes) push(spine);
      push(seg.ornament);
    }
    return out;
  }

  dispose(): void {
    for (const seg of this.segments.values()) {
      seg.mesh.geometry.dispose();
      if (seg.jointMesh) seg.jointMesh.geometry.dispose();
      for (const leaf of seg.leafMeshes) leaf.geometry.dispose();
      for (const pad of seg.leafInkMeshes) pad.geometry.dispose();
      if (seg.ornament) {
        seg.ornament.traverse((obj) => {
          if (obj instanceof THREE.Mesh) obj.geometry.dispose();
        });
      }
    }
    for (const mesh of this.seedMeshes.values()) {
      mesh.geometry.dispose();
    }
    this.meshGroup.clear();
    this.scene.remove(this.meshGroup);
    this.contactShadows.dispose();
    this.nodeMap.clear();
    this.childrenMap.clear();
    this.segments.clear();
    this.seedMeshes.clear();
  }
}
