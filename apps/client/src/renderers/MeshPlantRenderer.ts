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
  resolveDrawnRadius,
  seedBodyCentreY,
  seedBodyHalfHeight,
} from '@plant-legacy/shared/growth';
import { hash01 } from '@plant-legacy/shared/math';
import * as THREE from 'three';
import { type AtmosphereParams, DEFAULT_ATMOSPHERE } from './environment/atmosphere.js';
import { applyAtmosphereToStandardMaterial } from './environment/standardAtmosphere.js';
import {
  geometryKey,
  lookAppliesTo,
  type MutationLook,
  type MutationLookStack,
  NEUTRAL_STACK,
  organFamily,
  organLook,
} from './plant/mutations.ts';
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
  /** Thorn cones for a spined epidermis; empty for every other plant. */
  spineMeshes: THREE.Mesh[];
  /** Geometry revision this segment was built for (bark/spine changes rebuild). */
  lookRevision: number;
  ornament: THREE.Group | null;
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
const TMP_TINT = new THREE.Color();

// AL-04: the mesh plants use the shared atmosphere, like the ground and the SDF
// plants, instead of the scene's fog. Params are held here so organs created
// later (new mutations, a new plant) are patched with the current values.
let atmosphereParams: AtmosphereParams = DEFAULT_ATMOSPHERE;
const atmosphereSunDir = new THREE.Vector3(0, 1, 0);

// Material cache shared across instances
const barkMaterial: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
  color: 0x3d2b1f,
  roughness: 0.8,
  metalness: 0.1,
  flatShading: false,
});
const rootMaterial: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
  // Roots in the cavity were nearly black against the dirt. A warmer, lighter
  // brown keeps the silhouette and still reads as an underground organ.
  color: 0x684632,
  roughness: 0.88,
  metalness: 0.02,
  flatShading: false,
});
const stemMaterial: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
  // Young hypocotyls and branches are green-brown, not mature tree bark.
  color: 0x526b38,
  roughness: 0.78,
  metalness: 0.02,
  flatShading: false,
});
const leafMaterial: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
  color: 0x4a7c59,
  roughness: 0.7,
  metalness: 0.0,
  flatShading: false,
  side: THREE.DoubleSide,
});
const cotyledonMaterial: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
  // Fleshy, yellow-green seed leaves catch light differently from true leaves.
  color: 0x7fa24d,
  roughness: 0.58,
  metalness: 0.0,
  flatShading: false,
  side: THREE.DoubleSide,
});
const flowerMaterial: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
  color: 0xd98aaa,
  roughness: 0.62,
  metalness: 0.0,
  flatShading: false,
  side: THREE.DoubleSide,
});
const flowerCentreMaterial: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
  color: 0xe6c45f,
  roughness: 0.74,
  metalness: 0.0,
  flatShading: false,
});
const sporeMaterial: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
  color: 0xa88752,
  roughness: 0.85,
  metalness: 0.0,
  flatShading: false,
});

const seedMaterial: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
  color: 0x8a6d4d,
  roughness: 0.9,
  metalness: 0.0,
  flatShading: false,
});

/** Every uncloned organ material, so a single call can patch all of them. */
const BASE_MATERIALS: THREE.MeshStandardMaterial[] = [
  barkMaterial,
  rootMaterial,
  stemMaterial,
  leafMaterial,
  cotyledonMaterial,
  flowerMaterial,
  flowerCentreMaterial,
  sporeMaterial,
  seedMaterial,
];

function baseMaterialFor(nodeType: string): THREE.MeshStandardMaterial {
  switch (nodeType) {
    case 'root':
    case 'radicle':
    case 'lateral_root':
    case 'rhizome':
    case 'pneumatophore':
    case 'tuber':
      return rootMaterial;
    case 'leaf':
      return leafMaterial;
    case 'cotyledon':
      return cotyledonMaterial;
    case 'stem':
    case 'branch':
    case 'trunk':
    case 'culm':
    case 'vine':
    case 'thorn':
    case 'stolon':
      return stemMaterial;
    case 'floating_leaf':
      return leafMaterial;
    case 'flower':
      return flowerMaterial;
    case 'flower_centre':
      return flowerCentreMaterial;
    case 'spore_sac':
      return sporeMaterial;
    case 'seed':
      return seedMaterial;
    default:
      return barkMaterial;
  }
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
): string {
  return `${r0.toFixed(3)},${r1.toFixed(3)},${length.toFixed(3)},${quality.tubeRadialSegments}x${quality.tubeLengthSegments}`;
}

function buildTubeGeometry(
  r0: number,
  r1: number,
  length: number,
  quality: MeshQualityConfig,
  bend = 0,
): THREE.BufferGeometry {
  const key = `${tubeGeometryCacheKey(r0, r1, length, quality)}|${bend.toFixed(3)}`;
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
  const positions: number[] = [];
  const indices: number[] = [];

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
  setAtmosphere(params: AtmosphereParams, sunDir: THREE.Vector3): void {
    atmosphereParams = params;
    atmosphereSunDir.copy(sunDir);
    for (const material of BASE_MATERIALS) {
      applyAtmosphereToStandardMaterial(material, params, atmosphereSunDir);
    }
    for (const material of this.materialVariants.values()) {
      applyAtmosphereToStandardMaterial(material, params, atmosphereSunDir);
    }
  }

  private scene: THREE.Scene;
  private meshGroup = new THREE.Group();
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

  /** Terrain under a plan position, so a seed can sit on the soil it is drawn over. */
  private groundQuery: ((x: number, z: number) => number) | null = null;
  /** The drawn ground mesh, so a seed can rest on the triangle, not the field. */
  private groundMesh: THREE.Object3D | null = null;
  private readonly groundRay = new THREE.Raycaster();

  /** The height of the soil actually drawn under a point, or the field's fallback. */
  private drawnGroundY(x: number, z: number, fallback: number): number {
    const mesh = this.groundMesh;
    if (!mesh) return fallback;
    this.groundRay.near = 0;
    this.groundRay.far = 8;
    this.groundRay.set(new THREE.Vector3(x, fallback + 4, z), new THREE.Vector3(0, -1, 0));
    const hit = this.groundRay.intersectObject(mesh, false)[0];
    return hit && Number.isFinite(hit.point.y) ? hit.point.y : fallback;
  }

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
    this.groundMesh = mesh;
  }

  /**
   * Give the mesh pass the terrain height function the ground is drawn from.
   *
   * Without it the seed had only its stored contact point, which is a server
   * coordinate: a coat could hover over soil that the client painted lower.
   */
  setGroundQuery(query: ((x: number, z: number) => number) | null): void {
    this.groundQuery = query;
  }

  constructor(scene: THREE.Scene, quality: Partial<MeshQualityConfig> = {}) {
    this.quality = { ...DEFAULT_MESH_QUALITY, ...quality };
    this.scene = scene;
    this.scene.add(this.meshGroup);
    this.meshGroup.visible = false;
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
  private materialFor(nodeType: string, look: MutationLook): THREE.MeshStandardMaterial {
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
    ].join(':');
    const cached = this.materialVariants.get(key);
    if (cached) return cached;
    const material = baseMaterialFor(nodeType).clone();
    // `.clone()` does not carry the fog patch across, so each new variant is
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
        health: n.health ?? 0.5,
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
  }

  /** Drop every mesh a segment owns; geometry is disposed, materials are shared. */
  private disposeSegment(seg: MeshSegmentData): void {
    this.meshGroup.remove(seg.mesh);
    seg.mesh.geometry.dispose();
    if (seg.jointMesh) {
      this.meshGroup.remove(seg.jointMesh);
      seg.jointMesh.geometry.dispose();
    }
    for (const leaf of seg.leafMeshes) {
      this.meshGroup.remove(leaf);
      leaf.geometry.dispose();
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
        existingSeed.material = this.materialFor('seed', this.lookFor(node));
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
      const mat = this.materialFor('seed', this.lookFor(node));
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
      const fieldY = this.groundQuery?.(node.position.x, node.position.z);
      const contactY = Number.isFinite(fieldY)
        ? this.drawnGroundY(node.position.x, node.position.z, fieldY as number)
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
      let tubeStartRadius = parentVisualRadius;
      let tubeEndRadius = resolveDrawnRadius(node.nodeType, node.radius, node.biomass);
      const softPart =
        node.nodeType === 'leaf' ||
        node.nodeType === 'cotyledon' ||
        node.nodeType === 'flower' ||
        node.nodeType === 'spore_sac';
      if (softPart) tubeStartRadius = Math.min(tubeStartRadius, tubeEndRadius);

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

      // Leave the parent's centre line on its surface. The tube still overlaps
      // the parent by more than half its radius, so the joint reads as grown
      // tissue instead of a pin pushed through the middle.
      if (parentType !== 'seed') {
        const socket = Math.min(parentVisualRadius * 0.9, length * 0.4);
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
      const geo = buildTubeGeometry(tubeStartRadius, tubeEndRadius, length, this.quality, bend);
      const mat =
        node.nodeType === 'flower' || node.nodeType === 'spore_sac'
          ? this.materialFor('stem', this.lookFor(node))
          : this.materialFor(node.nodeType, this.lookFor(node));
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
          const spineMat = this.materialFor('stem', organLookNow);
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
          const leaf = new THREE.Mesh(leafGeo, this.materialFor(node.nodeType, this.lookFor(node)));
          const angle = (i / Math.max(1, leafCount)) * Math.PI * 2;
          this.placeLeaf(leaf, segmentEnd, axis, angle, isCotyledon);
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
      if (ornament) this.meshGroup.add(ornament);

      this.meshGroup.add(mesh);
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
        spineMeshes,
        lookRevision: this.geometryRevision,
        ornament,
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
      const petal = new THREE.Mesh(petalGeo, this.materialFor('flower', this.lookFor(node)));
      petal.position.set(Math.cos(angle) * r * 0.62, 0, Math.sin(angle) * r * 0.62);
      petal.rotation.y = -angle;
      petal.scale.set(r * 0.62, r * 0.1, r * 0.3);
      group.add(petal);
    }
    const centre = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      this.materialFor('flower_centre', this.lookFor(node)),
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
        for (const spine of seg.spineMeshes) spine.position.add(shift);
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
  }

  setVisible(visible: boolean): void {
    this.meshGroup.visible = visible;
  }

  setLOD(): void {
    // LOD handled by tier selection in caller; mesh renderer always renders full detail
  }

  dispose(): void {
    for (const seg of this.segments.values()) {
      seg.mesh.geometry.dispose();
      if (seg.jointMesh) seg.jointMesh.geometry.dispose();
      for (const leaf of seg.leafMeshes) leaf.geometry.dispose();
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
    this.nodeMap.clear();
    this.childrenMap.clear();
    this.segments.clear();
    this.seedMeshes.clear();
  }
}
