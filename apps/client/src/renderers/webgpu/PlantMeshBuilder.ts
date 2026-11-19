import {
  getSeedBodyHeightRatio,
  getSegmentTaperExponent,
  jointStartRadius,
  nodeAttachmentPoint,
  nodeRenderRadius,
  resolveDrawnRadius,
  seedBodyCentreY,
  seedBodyHalfHeight,
  segmentRadiusAt,
  socketInset,
} from '@plant-legacy/shared/growth';
import { hash01 } from '@plant-legacy/shared/math';
import * as THREE from 'three';
import {
  type MutationLookStack,
  NEUTRAL_STACK,
  nodeMutationMask,
  organLook,
} from '../plant/mutations.ts';
import type { PlantNodeData } from '../plant/plantNodeData.js';

/** C02b: GPU skinning configuration */
export const MAX_JOINTS_PER_VERTEX = 4;
export const MAX_JOINTS_PER_PLANT = 64; // Max joints (segments) per plant

/** Interleaved mesh vertex: position(3) + normal(3) + uv(2) + packed(1 u32) + emergence(2 f32) + jointIndices(4) + jointWeights(4). */
export const MESH_VERTEX_STRIDE = 76; // 19 floats = 76 bytes
const MESH_FLOATS_PER_VERTEX = 19;
const MESH_PACKED_WORD = 8;
const MESH_EMERGENCE_SPAWN_TIME = 9;
const MESH_EMERGENCE_GROWTH_PROGRESS = 10;
const MESH_JOINT_INDICES_START = 11;
const MESH_JOINT_WEIGHTS_START = 15;

/** One ring of a chain tube: where it sits, how thick it is, and what it belongs to. */
interface ChainPoint {
  position: THREE.Vector3;
  radius: number;
  packed: number;
  jointA: number;
  jointB: number;
  weight: number;
  spawnTime: number;
  growthProgress: number;
  /** `spined_epidermis` density for this point's node (0 = no thorns). */
  spines: number;
}

/** Everything the chain pass needs to know about one node's segment. */
interface DrawnSegment {
  start: THREE.Vector3;
  position: THREE.Vector3;
  startRadius: number;
  radius: number;
  control: THREE.Vector3;
  packed: number;
  jointIndex: number;
  sides: number;
  spawnTime: number;
  growthEase: number;
  /** `spined_epidermis` density, 0 when the plant bristles nowhere. */
  spines: number;
}

export interface PlantMeshBuildOptions {
  leafSize: number;
  leafCountPerNode: number;
  tubeSides: number;
  rootSides: number;
  /** Ring every this many metres along a drawn tube. */
  chainRingSpacingM?: number;
  /** How far a drawn tube's polyline may sag off its curve, in metres. */
  chainSagittaTolM?: number;
  now: number;
  sunDirection: THREE.Vector3;
  /** Per-plant look parameters (petals, leaf and seed scale). */
  appearanceForPlant?: (
    plantId: string,
    isOwn: boolean,
  ) => { petalCount: number; leafScale: number; seedScale: number } | undefined;
  /** Composed mutation looks per plant (bark thickness, pigment, thorns). */
  lookForPlant?: (plantId: string, isOwn: boolean) => MutationLookStack | undefined;
}

export interface PlantRenderPlant {
  /**
   * Stable identity of the plant, not its position in this array.
   *
   * The impostor atlas keys its tiles by this: the array loses plants as they
   * die or leave interest, and every index after the hole shifts down.
   */
  id: string;
  center: THREE.Vector3;
  radius: number;
  color: [number, number, number];
  isOwn: boolean;
  nodeCount: number;
  /** OR of the mutation masks of every node, for billboard-tier plants. */
  mutationMask: number;
}

export interface BuiltPlantMesh {
  vertices: Float32Array;
  indices: Uint32Array;
  plantData: PlantRenderPlant[];
  /** Composed looks, aligned with `plantData` by plant index. */
  plantLooks: MutationLookStack[];
}

const OWN_PLANT_COLOR: [number, number, number] = [0.3, 0.62, 0.24];
const RIVAL_PLANT_COLOR: [number, number, number] = [0.46, 0.54, 0.2];
const MAX_LEAVES_PER_PLANT = 48;

function packNode(
  plantIndex: number,
  nodeType: number,
  isOwn: boolean,
  variationIndex = 0,
  mutationMask = 0,
): number {
  return (
    (plantIndex & 0xffff) |
    ((nodeType & 0xff) << 16) |
    ((isOwn ? 1 : 0) << 24) |
    ((variationIndex & 0xf) << 25) |
    // T04 mutation signature index (0..12) in the four spare high bits.
    ((mutationMask & 0xf) << 28)
  );
}

/**
 * Thorn geometry for `spined_epidermis`.
 *
 * The mutation's name promises spines, and unlocking a thorn organ is not the
 * same thing: a plant that has the mutation has to bristle. Spikes are emitted
 * as short tapered tubes on the chain's surface so they inherit its shading and
 * its skinning.
 */
function addChainSpines(mesh: MeshAccumulator, points: readonly ChainPoint[]): void {
  for (let i = 0; i < points.length; i += 2) {
    const point = points[i];
    if (!(point.spines > 0.01)) continue;
    const count = Math.max(1, Math.round(point.spines * 3));
    const spikeLength = Math.max(0.012, point.radius * 1.5);
    for (let spike = 0; spike < count; spike += 1) {
      const angle = spike * 2.399963 + i * 0.7;
      const outward = new THREE.Vector3(Math.cos(angle), 0.55, Math.sin(angle)).normalize();
      const base = point.position.clone().addScaledVector(outward, point.radius * 0.85);
      const tip = base.clone().addScaledVector(outward, spikeLength);
      mesh.addTube(
        base,
        tip,
        Math.max(0.004, point.radius * 0.4),
        0.0015,
        4,
        point.packed,
        false,
        point.spawnTime,
        point.growthProgress,
        point.jointA,
      );
    }
  }
}

function getVisualNodeType(node: PlantNodeData): number {
  // Map string nodeType to visual types for distinct rendering per plant part
  const nt = node.nodeType?.toLowerCase();

  // Root crown: always render as seed coat (type 4) since it IS the seed coat base,
  // both before and after germination
  if (nt === 'seed') {
    return 4;
  }
  if (nt === 'flower') return 5; // Flower - pink/red
  if (nt === 'spore_sac') return 6; // Spore sac - brown/orange
  if (nt === 'vine') return 2; // Vine - green
  if (nt === 'cotyledon') return 7; // Cotyledon - yellow-green seed leaf
  if (nt === 'leaf') return 3; // Regular leaf - vibrant green
  if (nt === 'stem') return 1; // Stem - woody trunk
  if (nt === 'branch') return 1; // Branch - woody trunk
  if (nt === 'trunk') return 1; // Woody trunk
  if (nt === 'culm') return 2; // Hollow segmented shoot - green stem
  if (nt === 'rhizome') return 0; // Underground stem - root colour
  if (nt === 'floating_leaf') return 3; // Buoyant pad - leaf colour
  if (nt === 'pneumatophore') return 0; // Aerial breathing root - root colour
  if (nt === 'thorn') return 1; // Hardened defensive shoot - woody
  if (nt === 'stolon') return 2; // Runner - green stem
  if (nt === 'tuber') return 0; // Storage tuber - root colour
  if (nt === 'radicle') return 0; // Radicle - delicate root
  if (nt === 'root') return 0; // Root - woody root
  if (nt === 'lateral_root') return 0; // Lateral root - thinner root
  // Fallback to numeric type
  return typeof node.type === 'number' ? node.type : 0;
}

/** C02b: Get texture variation index for a node (0-15) */
function getVariationIndex(node: PlantNodeData, visualType: number): number {
  // Use node ID hash to get deterministic variation
  const hash = hash01(node.id, `variation_${visualType}`);
  return Math.floor(hash * 16);
}

function isRootNodeType(nodeType: string | undefined): boolean {
  const nt = (nodeType ?? '').toLowerCase();
  return nt === 'radicle' || nt === 'root' || nt === 'lateral_root';
}

/** Below this distance a node is treated as sitting exactly on its parent. */
const COINCIDENT_EPSILON = 0.02;

/**
 * Where a node is actually drawn. Nodes that sit exactly on their parent (the
 * crown stem, the cotyledons, siblings sharing one tip) get a short
 * deterministic stub out of the parent so their segment exists and the chain
 * stays joined. Picking and camera framing must use this same position: using
 * the model position while the blade is drawn at the stub made double-clicks
 * miss the leaf they were aimed at.
 */
export function resolveDrawnNodePosition(
  node: PlantNodeData,
  parent: PlantNodeData | undefined,
  siblings?: Iterable<PlantNodeData>,
): THREE.Vector3 {
  // A segment that is still growing is drawn from the point it left its parent
  // toward the target the server gave it. Without this the node stayed on top of
  // its parent for the whole animation (the sync that carries the final position
  // often never arrives), so grown parts looked detached from the plant.
  if (
    node.parentAttachX !== undefined &&
    node.parentAttachY !== undefined &&
    node.parentAttachZ !== undefined &&
    node.targetX !== undefined &&
    node.targetY !== undefined &&
    node.targetZ !== undefined
  ) {
    const t = THREE.MathUtils.clamp(node.growthProgress ?? 1, 0, 1);
    return new THREE.Vector3(
      node.parentAttachX + (node.targetX - node.parentAttachX) * t,
      node.parentAttachY + (node.targetY - node.parentAttachY) * t,
      node.parentAttachZ + (node.targetZ - node.parentAttachZ) * t,
    );
  }

  // Clones, never the node's own vector: callers offset the result to build
  // geometry, and an aliased vector would move the plant in the process.
  if (!parent) return node.position.clone();
  if (parent.position.distanceTo(node.position) >= COINCIDENT_EPSILON) return node.position.clone();

  // Every node stacked on the same parent shares one fan, spread evenly around
  // it. A hash-only angle gave the two cotyledons almost the same direction, so
  // they were drawn on top of each other and a double-click could pick either.
  const stack = siblings
    ? Array.from(siblings)
        .filter(
          (other) =>
            other.parentId === parent.id &&
            parent.position.distanceTo(other.position) < COINCIDENT_EPSILON,
        )
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    : [node];
  const index = Math.max(
    0,
    stack.findIndex((other) => other.id === node.id),
  );
  const slotCount = Math.max(1, stack.length);
  // Even slots, plus a small deterministic wobble that stays inside the slot.
  const slotAngle = (index / slotCount) * Math.PI * 2;
  const wobble = (hash01(node.id, 'fan') - 0.5) * (Math.PI / slotCount) * 0.5;
  const fanAngle = slotAngle + wobble;
  const fanElevation =
    (isRootNodeType(node.nodeType) ? -0.6 : 0.55) + (hash01(node.id, 'tilt') - 0.5) * 0.2;
  const fan = new THREE.Vector3(Math.cos(fanAngle), fanElevation, Math.sin(fanAngle)).normalize();
  const stubLength = Math.max(
    0.15,
    resolveDrawnRadius(parent.nodeType, parent.radius, parent.biomass) * 1.6,
  );
  return parent.position.clone().addScaledVector(fan, stubLength);
}

function groupByRoot(nodes: PlantNodeData[]): PlantNodeData[][] {
  const byId = new Map<string, PlantNodeData>();
  for (const node of nodes) {
    byId.set(node.id, node);
  }

  const groups = new Map<string, PlantNodeData[]>();
  for (const node of nodes) {
    let root = node;
    const seen = new Set<string>();
    while (root.parentId !== null) {
      if (seen.has(root.id)) break;
      seen.add(root.id);
      const parent = byId.get(root.parentId);
      if (!parent) break;
      root = parent;
    }

    let group = groups.get(root.id);
    if (!group) {
      group = [];
      groups.set(root.id, group);
    }
    group.push(node);
  }

  return [...groups.values()];
}

function perpendicularBasis(direction: THREE.Vector3): { u: THREE.Vector3; v: THREE.Vector3 } {
  const reference =
    Math.abs(direction.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(direction, reference).normalize();
  if (u.lengthSq() < 1e-8) {
    u.set(1, 0, 0);
  }
  const v = new THREE.Vector3().crossVectors(direction, u).normalize();
  return { u, v };
}

class MeshAccumulator {
  private readonly positions: number[] = [];
  private readonly packedValues: number[] = [];
  private readonly emergenceData: number[] = []; // [spawnTime, growthProgress] per vertex
  private readonly jointIndices: number[] = []; // 4 joint indices per vertex
  private readonly jointWeights: number[] = []; // 4 joint weights per vertex
  readonly indices: number[] = [];

  get vertexCount(): number {
    return this.packedValues.length;
  }

  pushVertex(
    position: THREE.Vector3,
    normal: THREE.Vector3,
    u: number,
    v: number,
    packed: number,
    spawnTime: number = 0,
    growthProgress: number = 1,
    jointIndices: number[] = [0, 0, 0, 0],
    jointWeights: number[] = [1, 0, 0, 0],
  ): void {
    this.positions.push(position.x, position.y, position.z, normal.x, normal.y, normal.z, u, v);
    this.packedValues.push(packed);
    // Callers pass spawnTime in milliseconds (performance.now()); the shaders
    // compare it against frame.time, which is in seconds.
    this.emergenceData.push(spawnTime * 0.001, growthProgress);
    this.jointIndices.push(...jointIndices);
    this.jointWeights.push(...jointWeights);
  }

  addTriangle(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  addTube(
    a: THREE.Vector3,
    b: THREE.Vector3,
    radiusA: number,
    radiusB: number,
    sides: number,
    packed: number,
    addCaps = false,
    spawnTime = 0,
    growthProgress = 1,
    jointIndex = 0,
  ): void {
    const direction = new THREE.Vector3().subVectors(b, a);
    if (direction.lengthSq() < 1e-8) return;
    direction.normalize();

    const { u, v } = perpendicularBasis(direction);
    const ringStart = this.vertexCount;
    const rA = Math.max(0.005, radiusA);
    const rB = Math.max(0.003, radiusB);

    for (let ring = 0; ring < 2; ring += 1) {
      const center = ring === 0 ? a : b;
      const radius = ring === 0 ? rA : rB;
      for (let side = 0; side <= sides; side += 1) {
        const angle = (side / sides) * Math.PI * 2;
        const offset = u
          .clone()
          .multiplyScalar(Math.cos(angle))
          .addScaledVector(v, Math.sin(angle));
        const normal = offset.clone().normalize();
        const position = center.clone().addScaledVector(offset, radius);
        this.pushVertex(position, normal, side / sides, ring, packed, spawnTime, growthProgress);
      }
    }

    for (let side = 0; side < sides; side += 1) {
      const row = sides + 1;
      const a0 = ringStart + side;
      const a1 = ringStart + side + 1;
      const b0 = ringStart + row + side;
      const b1 = ringStart + row + side + 1;
      this.addTriangle(a0, b0, a1);
      this.addTriangle(a1, b0, b1);
    }

    if (addCaps) {
      // Caps keep the tube watertight when a branch ends in open space.
      const startCenter = this.vertexCount;
      this.pushVertex(a, direction.clone().negate(), 0.5, 0.5, packed, spawnTime, growthProgress);
      for (let side = 0; side < sides; side += 1) {
        const angle = (side / sides) * Math.PI * 2;
        const offset = u
          .clone()
          .multiplyScalar(Math.cos(angle))
          .addScaledVector(v, Math.sin(angle));
        const position = a.clone().addScaledVector(offset, rA);
        const normal = direction.clone().negate();
        this.pushVertex(
          position,
          normal,
          side / sides,
          0,
          packed,
          spawnTime,
          growthProgress,
          [jointIndex, 0, 0, 0],
          [1, 0, 0, 0],
        );
      }
      for (let side = 0; side < sides; side += 1) {
        const next = (side + 1) % sides;
        this.addTriangle(startCenter, startCenter + 1 + side, startCenter + 1 + next);
      }

      const endCenter = this.vertexCount;
      this.pushVertex(
        b,
        direction.clone(),
        0.5,
        0.5,
        packed,
        spawnTime,
        growthProgress,
        [jointIndex + 1, 0, 0, 0],
        [1, 0, 0, 0],
      );
      for (let side = 0; side < sides; side += 1) {
        const angle = (side / sides) * Math.PI * 2;
        const offset = u
          .clone()
          .multiplyScalar(Math.cos(angle))
          .addScaledVector(v, Math.sin(angle));
        const position = b.clone().addScaledVector(offset, rB);
        const normal = direction.clone();
        this.pushVertex(
          position,
          normal,
          side / sides,
          1,
          packed,
          spawnTime,
          growthProgress,
          [jointIndex + 1, 0, 0, 0],
          [1, 0, 0, 0],
        );
      }
      for (let side = 0; side < sides; side += 1) {
        const next = (side + 1) % sides;
        this.addTriangle(endCenter, endCenter + 1 + next, endCenter + 1 + side);
      }
    }
  }

  // A dead `addCurvedTube` used to live here: a quadratic tube that sampled
  // `rA * (1 - t) + rB * t` along its own rings. Nothing called it, and it was
  // a second copy of the radius rule that the chain pass owns, so it was deleted
  // rather than left to drift back into use with the old linear taper.

  /**
   * One continuous tapered tube through a run of segments, the way the lab
   * generator builds a plant: each ring is shared by the segments around it, so
   * a stem, a root or a cotyledon is a single organ instead of a tube plus a
   * sphere at every node. Frames are parallel-transported along the path so the
   * tube never pinches or twists where it bends.
   */
  addChainTube(points: ChainPoint[], sides: number): void {
    if (points.length < 2) return;

    const tangents: THREE.Vector3[] = [];
    for (let i = 0; i < points.length; i += 1) {
      const previous = points[Math.max(0, i - 1)].position;
      const next = points[Math.min(points.length - 1, i + 1)].position;
      const tangent = new THREE.Vector3().subVectors(next, previous);
      if (tangent.lengthSq() < 1e-10) tangent.set(0, 1, 0);
      tangents.push(tangent.normalize());
    }

    const { u, v } = perpendicularBasis(tangents[0]);
    const ringStarts: number[] = [];

    for (let i = 0; i < points.length; i += 1) {
      const point = points[i];
      const tangent = tangents[i];
      if (i > 0) {
        const previousTangent = tangents[i - 1];
        const axis = new THREE.Vector3().crossVectors(previousTangent, tangent);
        const sin = axis.length();
        if (sin > 1e-6) {
          axis.normalize();
          const angle = Math.atan2(sin, THREE.MathUtils.clamp(previousTangent.dot(tangent), -1, 1));
          u.applyAxisAngle(axis, angle);
          v.applyAxisAngle(axis, angle);
        }
        // Re-orthogonalise against the new tangent so the frame stays rigid.
        u.addScaledVector(tangent, -u.dot(tangent)).normalize();
        v.crossVectors(tangent, u).normalize();
      }

      const ringStart = this.vertexCount;
      ringStarts.push(ringStart);
      const radius = Math.max(0.003, point.radius);
      for (let side = 0; side <= sides; side += 1) {
        const angle = (side / sides) * Math.PI * 2;
        const offset = u
          .clone()
          .multiplyScalar(Math.cos(angle))
          .addScaledVector(v, Math.sin(angle));
        const position = point.position.clone().addScaledVector(offset, radius);
        const normal = offset.clone().normalize();
        this.pushVertex(
          position,
          normal,
          side / sides,
          i / Math.max(1, points.length - 1),
          point.packed,
          point.spawnTime,
          point.growthProgress,
          [point.jointA, point.jointB, 0, 0],
          [1 - point.weight, point.weight, 0, 0],
        );
      }
    }

    for (let i = 1; i < ringStarts.length; i += 1) {
      const previousStart = ringStarts[i - 1];
      const ringStart = ringStarts[i];
      for (let side = 0; side < sides; side += 1) {
        const a0 = previousStart + side;
        const a1 = previousStart + side + 1;
        const b0 = ringStart + side;
        const b1 = ringStart + side + 1;
        this.addTriangle(a0, b0, a1);
        this.addTriangle(a1, b0, b1);
      }
    }
  }

  addLeaf(
    base: THREE.Vector3,
    direction: THREE.Vector3,
    normal: THREE.Vector3,
    size: number,
    packed: number,
    spawnTime = 0,
    growthProgress = 1,
    jointIndex = 0,
  ): void {
    const side = new THREE.Vector3().crossVectors(normal, direction);
    if (side.lengthSq() < 1e-8) {
      side.set(1, 0, 0);
    }
    side.normalize();

    // Petiole (leaf stem): small cylinder at leaf base connecting to branch
    const petioleLength = size * 0.25;
    const petioleRadius = size * 0.03;
    const petioleBase = base.clone();
    const petioleTip = base.clone().addScaledVector(direction, petioleLength);
    this.addTube(
      petioleBase,
      petioleTip,
      petioleRadius,
      petioleRadius,
      4,
      packed,
      false,
      spawnTime,
      growthProgress,
      jointIndex,
    );

    // Leaf blade
    // Leaf blade: wide enough to read as a leaf rather than a sliver. The old
    // 0.22 half-width turned every leaf into a zero-thickness spike.
    const p0 = base.clone().addScaledVector(direction, petioleLength);
    const p1 = p0.clone().addScaledVector(side, size * 0.45);
    const p2 = p0.clone().addScaledVector(direction, size);
    const p3 = p0.clone().addScaledVector(side, -size * 0.22);

    const start = this.vertexCount;
    this.pushVertex(
      p0,
      normal,
      0,
      0.5,
      packed,
      spawnTime,
      growthProgress,
      [jointIndex, 0, 0, 0],
      [1, 0, 0, 0],
    );
    this.pushVertex(
      p1,
      normal,
      0.35,
      1,
      packed,
      spawnTime,
      growthProgress,
      [jointIndex, 0, 0, 0],
      [1, 0, 0, 0],
    );
    this.pushVertex(
      p2,
      normal,
      1,
      0.5,
      packed,
      spawnTime,
      growthProgress,
      [jointIndex, 0, 0, 0],
      [1, 0, 0, 0],
    );
    this.pushVertex(
      p3,
      normal,
      0.35,
      0,
      packed,
      spawnTime,
      growthProgress,
      [jointIndex, 0, 0, 0],
      [1, 0, 0, 0],
    );
    this.addTriangle(start, start + 1, start + 2);
    this.addTriangle(start, start + 2, start + 3);
  }

  addJoint(
    center: THREE.Vector3,
    radius: number,
    packed: number,
    spawnTime = 0,
    growthProgress = 1,
    jointIndex = 0,
  ): void {
    const sides = 10;
    const rings = 6;
    const start = this.vertexCount;
    const emergentRadius = radius * growthProgress;

    for (let ring = 0; ring <= rings; ring += 1) {
      const phi = (ring / rings) * Math.PI;
      const y = Math.cos(phi);
      const r = Math.sin(phi);
      for (let side = 0; side <= sides; side += 1) {
        const theta = (side / sides) * Math.PI * 2;
        const x = r * Math.cos(theta);
        const z = r * Math.sin(theta);
        const pos = new THREE.Vector3(x, y, z).multiplyScalar(emergentRadius).add(center);
        const normal = new THREE.Vector3(x, y, z).normalize();
        const ringWeight = 1.0 - ring / rings;
        this.pushVertex(
          pos,
          normal,
          side / sides,
          ring / rings,
          packed,
          spawnTime,
          growthProgress,
          [jointIndex, 0, 0, 0],
          [ringWeight, 1 - ringWeight, 0, 0],
        );
      }
    }

    for (let ring = 0; ring < rings; ring += 1) {
      for (let side = 0; side < sides; side += 1) {
        const a = start + ring * (sides + 1) + side;
        const b = start + ring * (sides + 1) + side + 1;
        const c = start + (ring + 1) * (sides + 1) + side;
        const d = start + (ring + 1) * (sides + 1) + side + 1;
        this.addTriangle(a, c, b);
        this.addTriangle(b, c, d);
      }
    }
  }

  addSeed(
    center: THREE.Vector3,
    radius: number,
    packed: number,
    spawnTime = 0,
    growthProgress = 1,
    jointIndex = 0,
  ): void {
    const sides = 14;
    const rings = 12;
    const start = this.vertexCount;
    const emergentRadius = radius * growthProgress;

    // Rounded ovoid seed sitting on the ground: widest around the lower belly,
    // closing smoothly at both the base and the tip (never a cone).
    // v = 0 (bottom/base) to 1 (top/tip).
    for (let ring = 0; ring <= rings; ring += 1) {
      const v = ring / rings; // 0 (bottom/base) to 1 (top/tip)
      const phi = v * Math.PI;
      const y = -Math.cos(phi); // -1 at bottom, +1 at top
      // A fractional-sine profile gives a full, rounded belly that closes
      // smoothly at both ends instead of a sharp cone.
      const profile = Math.max(0, Math.sin(phi)) ** 0.7 * (1.0 - 0.18 * v);
      const yScaled = y * getSeedBodyHeightRatio(); // slightly taller than wide

      for (let side = 0; side <= sides; side += 1) {
        const u = side / sides;
        const theta = u * Math.PI * 2;
        // Subtle lateral flattening (seeds like sunflower, bean, or acorn are slightly oval in cross section)
        const x = profile * Math.cos(theta) * 0.95;
        const z = profile * Math.sin(theta) * 0.85;

        const pos = new THREE.Vector3(x, yScaled, z).multiplyScalar(emergentRadius).add(center);
        const normal = new THREE.Vector3(x, y * 0.8, z).normalize();
        const ringWeight = v;
        this.pushVertex(
          pos,
          normal,
          u,
          v,
          packed,
          spawnTime,
          growthProgress,
          [jointIndex, 0, 0, 0],
          [ringWeight, 1 - ringWeight, 0, 0],
        );
      }
    }

    for (let ring = 0; ring < rings; ring += 1) {
      for (let side = 0; side < sides; side += 1) {
        const a = start + ring * (sides + 1) + side;
        const b = start + ring * (sides + 1) + side + 1;
        const c = start + (ring + 1) * (sides + 1) + side;
        const d = start + (ring + 1) * (sides + 1) + side + 1;
        this.addTriangle(a, c, b);
        this.addTriangle(b, c, d);
      }
    }
  }

  toVertexArray(): Float32Array {
    const buffer = new ArrayBuffer(this.packedValues.length * MESH_VERTEX_STRIDE);
    const floats = new Float32Array(buffer);
    const words = new Uint32Array(buffer);

    for (let i = 0; i < this.packedValues.length; i += 1) {
      const source = i * 8;
      const target = i * MESH_FLOATS_PER_VERTEX;
      floats[target] = this.positions[source];
      floats[target + 1] = this.positions[source + 1];
      floats[target + 2] = this.positions[source + 2];
      floats[target + 3] = this.positions[source + 3];
      floats[target + 4] = this.positions[source + 4];
      floats[target + 5] = this.positions[source + 5];
      floats[target + 6] = this.positions[source + 6];
      floats[target + 7] = this.positions[source + 7];
      words[target + MESH_PACKED_WORD] = this.packedValues[i];
      floats[target + MESH_EMERGENCE_SPAWN_TIME] = this.emergenceData[i * 2];
      floats[target + MESH_EMERGENCE_GROWTH_PROGRESS] = this.emergenceData[i * 2 + 1];
      // Joint indices (4 u32)
      words[target + MESH_JOINT_INDICES_START] = this.jointIndices[i * 4];
      words[target + MESH_JOINT_INDICES_START + 1] = this.jointIndices[i * 4 + 1];
      words[target + MESH_JOINT_INDICES_START + 2] = this.jointIndices[i * 4 + 2];
      words[target + MESH_JOINT_INDICES_START + 3] = this.jointIndices[i * 4 + 3];
      // Joint weights (4 f32)
      floats[target + MESH_JOINT_WEIGHTS_START] = this.jointWeights[i * 4];
      floats[target + MESH_JOINT_WEIGHTS_START + 1] = this.jointWeights[i * 4 + 1];
      floats[target + MESH_JOINT_WEIGHTS_START + 2] = this.jointWeights[i * 4 + 2];
      floats[target + MESH_JOINT_WEIGHTS_START + 3] = this.jointWeights[i * 4 + 3];
    }

    return floats;
  }
}

function leafDirection(
  branchDirection: THREE.Vector3,
  index: number,
  count: number,
  isCotyledon = false,
  nodeId: string,
  sunDirection: THREE.Vector3 = new THREE.Vector3(0, 1, 0),
): { direction: THREE.Vector3; normal: THREE.Vector3 } {
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(branchDirection, up);
  if (side.lengthSq() < 1e-8) {
    side.set(1, 0, 0);
  }
  side.normalize();
  const forward = new THREE.Vector3().crossVectors(side, branchDirection).normalize();

  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const angle = (index * goldenAngle) % (Math.PI * 2);

  // Cotyledon (first leaf from root crown): horizontal, perpendicular to stem
  // Phototropism: slowly unfolds toward sun direction
  if (isCotyledon) {
    // Cotyledon normal starts facing up, tilts toward sun over time (handled via growthProgress)
    const sunHorizontal = new THREE.Vector3(sunDirection.x, 0, sunDirection.z).normalize();
    const tilt = sunHorizontal.clone().multiplyScalar(0.3);
    const direction = side.clone().normalize().add(tilt).normalize();
    const normal = up.clone().addScaledVector(sunDirection, 0.15).normalize();
    return { direction, normal };
  }

  const spread = 0.35 + (count > 1 ? 0.25 : 0);
  const direction = side
    .clone()
    .multiplyScalar(Math.cos(angle))
    .addScaledVector(forward, Math.sin(angle))
    .addScaledVector(branchDirection, spread)
    .normalize();

  // Leaf normal faces UP (toward sun) for photosynthesis
  // Slight angle variation for natural look - deterministic from nodeId
  // Phototropism: tilt leaf normal toward sun direction
  const sunPull = sunDirection.clone().multiplyScalar(0.25);
  const normal = new THREE.Vector3(
    (hash01(nodeId, 'leafNormalX') - 0.5) * 0.3,
    0.85 + hash01(nodeId, 'leafNormalY') * 0.15,
    (hash01(nodeId, 'leafNormalZ') - 0.5) * 0.3,
  )
    .add(sunPull)
    .normalize();

  return { direction, normal };
}

/** One node's drawn segment, resolved with the renderer's real attachment rules. */
export interface SegmentFrame {
  /** Point the tube leaves from (parent's drawn end, seed surface, or stub). */
  start: THREE.Vector3;
  /** Where the segment ends (server target, lifted onto the seed surface). */
  target: THREE.Vector3;
  /** `start` lerped to `target` by growth progress — what is drawn this frame. */
  animated: THREE.Vector3;
  /** `animated - start`; zero-length for stacked/coincident nodes. */
  branch: THREE.Vector3;
  startRadius: number;
  endRadius: number;
  growthEase: number;
}

/**
 * Rings a segment may have, however short or straight it is.
 *
 * Four was enough for a straight cone. It is not enough for a flared neck: the
 * radius rule finishes most of its necking inside the first quarter of a
 * segment, so four evenly spaced rings draw that belly as three straight facets.
 */
export const CHAIN_MIN_SAMPLES = 6;
/** Ceiling per segment, so a long wandering root cannot flood the buffer. */
export const CHAIN_MAX_SAMPLES = 16;

/**
 * How many rings one segment needs.
 *
 * Two things decide it: how long the segment is, and how far its curve bends off
 * its own chord. The old rule was a fixed ring every 5 cm with no idea of
 * curvature, so every segment between 10 and 15 cm got the same four rings -
 * a strongly bent branch and a straight stem were drawn with the same polyline,
 * and four rings cannot show the neck at the joint either.
 *
 * `bend` is the curve's second difference, `|start - 2*control + end|`. A
 * quadratic leaves its chord by at most `bend / 8`, and a polyline of n steps
 * leaves the curve by about `bend / (8 n^2)`, so n falls out of the tolerance.
 */
export function chainSampleCount(
  length: number,
  bend: number,
  ringSpacingM = 0.05,
  sagittaTolM = 0.0015,
): number {
  const spacing = Number.isFinite(ringSpacingM) && ringSpacingM > 1e-4 ? ringSpacingM : 0.05;
  const tolerance = Number.isFinite(sagittaTolM) && sagittaTolM > 1e-6 ? sagittaTolM : 0.0015;
  const byLength = (Number.isFinite(length) ? Math.max(0, length) : 0) / spacing;
  const byBend = Math.sqrt((Number.isFinite(bend) ? Math.max(0, bend) : 0) / (8 * tolerance));
  return Math.max(
    CHAIN_MIN_SAMPLES,
    Math.min(CHAIN_MAX_SAMPLES, Math.ceil(Math.max(byLength, byBend))),
  );
}

/**
 * Ring positions along a segment, from 0 to 1.
 *
 * Bunched toward the joint on purpose: the radius rule does most of its necking
 * in the first quarter of a segment, so that is where evenly spaced rings leave
 * the belly as a polygon. Warping by the same exponent that shapes the radius
 * puts the rings where the silhouette actually changes, and keeps both ends
 * exact.
 */
export function chainSampleFractions(
  count: number,
  taperExponent = getSegmentTaperExponent(),
): number[] {
  const steps = Math.max(1, Math.round(count));
  const exponent = taperExponent > 0 ? taperExponent : 1;
  const fractions: number[] = [];
  for (let i = 0; i <= steps; i += 1) {
    if (i === 0) {
      fractions.push(0);
    } else if (i === steps) {
      fractions.push(1);
    } else {
      fractions.push(1 - (1 - i / steps) ** (1 / exponent));
    }
  }
  return fractions;
}

/**
 * Control point of the quadratic that draws one segment.
 *
 * Two rules live here, both of them about junctions rather than parts:
 *
 * - The curve leaves the joint along a direction mixed from its **parent's own
 *   outgoing tangent**: a control point built from this segment alone (a chord
 *   midpoint plus a bow) has an end tangent unrelated to the next segment's
 *   start tangent, so every node in a chain is a visible kink and the plant
 *   reads as assembled from pieces. A part that forks away is mixed back toward
 *   its own chord, because holding the parent's direction there would hook.
 * - The bend and gravitropism bias still bow the tube, capped so they cannot
 *   rotate the joint they start from.
 */
export function segmentControlPoint(
  node: PlantNodeData,
  start: THREE.Vector3,
  target: THREE.Vector3,
  parentSegment?: { position: THREE.Vector3; control: THREE.Vector3 },
): THREE.Vector3 {
  const length = start.distanceTo(target);

  // Per-part gravtropism/phototropism bias
  let tropismStrength = 0.25;
  let gravityBias = -0.1;
  if (node.nodeType === 'radicle') {
    tropismStrength = 0.35;
    gravityBias = -0.15;
  } else if (node.nodeType === 'root') {
    tropismStrength = 0.3;
    gravityBias = -0.12;
  } else if (node.nodeType === 'lateral_root') {
    tropismStrength = 0.2;
    gravityBias = -0.08;
  } else if (node.nodeType === 'stem' || node.nodeType === 'branch') {
    tropismStrength = 0.1;
    gravityBias = 0.08; // Stems curve upward toward light
  } else if (node.nodeType === 'vine') {
    tropismStrength = 0.4;
    gravityBias = -0.05;
  }

  // Add subtle noise-based bend for organic feel
  const curvature = length * tropismStrength;
  const branchDir = new THREE.Vector3().subVectors(target, start).normalize();
  const bendDir = new THREE.Vector3().crossVectors(branchDir, new THREE.Vector3(0, 1, 0));
  if (bendDir.lengthSq() < 1e-6) bendDir.set(1, 0, 0);
  else bendDir.normalize();

  const parentOutgoing = parentSegment
    ? parentSegment.position.clone().sub(parentSegment.control)
    : null;

  // How the curve leaves the joint. A part that continues its parent's
  // direction must leave along that direction exactly, or the two tubes meet at
  // an angle and every node in a chain reads as a kink - a plant assembled from
  // pieces rather than grown. A part that forks away must not: leaving along the
  // parent's direction and then turning inside its own short segment is a hook.
  //
  // So the start direction is mixed from the parent's arrival toward the child's
  // own chord, and the mix grows with the fork. A continuation is C1; a fork
  // turns by at most half the angle it forked, which is a bend at a knuckle
  // rather than a crease.
  let direction = branchDir;
  if (parentOutgoing && parentOutgoing.lengthSq() > 1e-8) {
    parentOutgoing.normalize();
    const alignment = THREE.MathUtils.clamp(branchDir.dot(parentOutgoing), 0, 1);
    const mix = 0.5 * (1 - alignment * alignment);
    direction = parentOutgoing.clone().lerp(branchDir, mix).normalize();
  }

  // Wobble is what makes a plant look grown, but it must not rotate the joint:
  // capped at a fraction of the segment, it bends the middle of the tube instead
  // of kicking the base.
  const wobble = new THREE.Vector3()
    .addScaledVector(bendDir, curvature * (hash01(node.id, 'bend') - 0.5) * 0.6)
    .addScaledVector(new THREE.Vector3(0, 1, 0), gravityBias * length * 0.5);
  const wobbleLimit = length * 0.12;
  if (wobble.length() > wobbleLimit) wobble.setLength(wobbleLimit);

  return start
    .clone()
    .addScaledVector(direction, length * 0.45)
    .add(wobble);
}

/**
 * Resolve where one node is drawn, using the exact rules the mesh pass uses.
 *
 * Exported so Plant Lab and measurements can consume the same code instead of a
 * hand-copied model. `parentDrawnEnd` is the parent's `animated` from its own
 * frame, which is how the chain stays stitched when the parent is still growing.
 */
export function resolveSegmentFrame(
  node: PlantNodeData,
  parent: PlantNodeData,
  allById: Iterable<PlantNodeData>,
  parentDrawnEnd?: THREE.Vector3,
  /** The parent's own start radius, so a bud uses the radius *there*. */
  parentFrameStartRadius?: number,
): SegmentFrame {
  const growthEase = node.growthProgress ?? 0;
  const hasTarget =
    node.targetX !== undefined && node.targetY !== undefined && node.targetZ !== undefined;
  // Always a fresh vector: the seed-surface anchor below must never mutate the
  // node's stored position.
  let target = hasTarget
    ? new THREE.Vector3(node.targetX, node.targetY, node.targetZ)
    : node.position.clone();

  // Continue the parent's drawn end, not its raw model position. The seed and
  // coincident nodes are drawn elsewhere, so starting from the model position
  // leaves a visible step at every joint.
  let start = parentDrawnEnd ? parentDrawnEnd.clone() : parent.position.clone();

  // The server placed this child from a point on its parent and shipped that
  // point; the drawn tube has to start there too. A seed's children leave the
  // coat, which is why this used to be a seed-only rule - but a stem's own
  // drawn start is its shipped attach as well, and its children attach along
  // that same segment. Recomputing the seed point here while the server shipped
  // a different one put a stem's drawn start at the coat surface and its
  // branches at fractions of a segment that began 30 cm lower: the branch then
  // hung in the air below every drawn joint.
  const shippedAttach =
    node.parentAttachX !== undefined &&
    node.parentAttachY !== undefined &&
    node.parentAttachZ !== undefined
      ? new THREE.Vector3(node.parentAttachX, node.parentAttachY, node.parentAttachZ)
      : null;
  if ((parent.nodeType ?? '').toLowerCase() === 'seed') {
    const attach =
      shippedAttach ??
      (() => {
        const point = nodeAttachmentPoint(
          {
            x: parent.position.x,
            y: parent.position.y,
            z: parent.position.z,
            nodeType: parent.nodeType,
            radius: parent.radius,
            biomass: parent.biomass,
          },
          target.clone().sub(parent.position),
        );
        return new THREE.Vector3(point.x, point.y, point.z);
      })();
    start.set(attach.x, attach.y, attach.z);
  }

  // A lateral root or branch leaves part-way along its parent's segment, at the
  // fraction the server stored. Measure on the parent's drawn segment so the
  // joint stays stitched while that parent is still growing.
  const attachFraction = node.attachFraction;
  if (
    (parent.nodeType ?? '').toLowerCase() !== 'seed' &&
    typeof attachFraction === 'number' &&
    attachFraction < 1
  ) {
    const parentStart = new THREE.Vector3(
      parent.parentAttachX ?? parent.position.x,
      parent.parentAttachY ?? parent.position.y,
      parent.parentAttachZ ?? parent.position.z,
    );
    start = parentStart.lerp(parentDrawnEnd ?? parent.position, Math.max(0, attachFraction));
  }

  // Stacked server nodes get a deterministic stub so the chain stays joined.
  if (parent.position.distanceTo(node.position) < COINCIDENT_EPSILON) {
    start = parent.position.clone();
    target = resolveDrawnNodePosition(node, parent, allById);
  }

  const parentType = (parent.nodeType ?? '').toLowerCase();
  const parentRadius = resolveDrawnRadius(parent.nodeType, parent.radius, parent.biomass);
  const nodeRadius = resolveDrawnRadius(node.nodeType, node.radius, node.biomass);

  // The parent's radius *where the child leaves it*. A lateral takes a fraction
  // of its parent's segment, and a segment necks down along its own length, so
  // using the parent's nominal radius sized a bud near the parent's tip as if it
  // sat at the parent's base.
  const parentStartRadius = parentFrameStartRadius ?? parentRadius;
  const localFraction =
    typeof node.attachFraction === 'number' && node.attachFraction < 1
      ? Math.min(1, Math.max(0, node.attachFraction))
      : 1;
  const parentRadiusAtAttach = segmentRadiusAt(parentStartRadius, parentRadius, localFraction);

  // Start the child inside the parent body and let the parent's own surface hide
  // the base disc. Pushing the base out to the parent's surface leaves its rim
  // tangent to that surface, which reads as a crease - the drawn form of a pin
  // pushed through the middle.
  if (parentType !== 'seed') {
    const outward = target.clone().sub(start);
    const span = outward.length();
    if (span > 1e-5) {
      start.addScaledVector(
        outward.normalize(),
        Math.min(socketInset(parentRadiusAtAttach), span * 0.4),
      );
    }
  }

  // A child never starts outside its parent's drawn body. The server ships the
  // attach point once, and a plant that has been re-massed by a mutation,
  // uprooted, or resynced can move under it; a stale point put a child's base in
  // the air beside its parent, which is exactly what reads as an unattached part.
  // Project the start onto the parent's drawn segment and hold it inside the
  // parent's own radius of that line. A child that already sits on the body (a
  // lateral at its own fraction) is untouched.
  if (parentDrawnEnd && parentType !== 'seed') {
    const pStart = new THREE.Vector3(
      parent.parentAttachX ?? parent.position.x,
      parent.parentAttachY ?? parent.position.y,
      parent.parentAttachZ ?? parent.position.z,
    );
    const pEnd = parentDrawnEnd;
    const along = pEnd.clone().sub(pStart);
    const spanSq = along.lengthSq();
    const fractionOnParent =
      spanSq > 1e-9
        ? THREE.MathUtils.clamp(start.clone().sub(pStart).dot(along) / spanSq, 0, 1)
        : 0;
    const closest = pStart.clone().addScaledVector(along, fractionOnParent);
    const offset = start.clone().sub(closest);
    const reach = Math.max(1e-4, parentRadiusAtAttach * 1.05);
    if (offset.length() > reach) {
      start = closest.addScaledVector(offset.normalize(), reach);
    }
  }

  const animated = start.clone().lerp(target, growthEase);
  const branch = new THREE.Vector3().subVectors(animated, start);

  const softPart =
    (node.nodeType ?? '').toLowerCase() === 'leaf' ||
    (node.nodeType ?? '').toLowerCase() === 'cotyledon' ||
    (node.nodeType ?? '').toLowerCase() === 'flower' ||
    (node.nodeType ?? '').toLowerCase() === 'spore_sac';

  // A junction belongs to the parent and the child: a knuckle wider than the
  // child's shank, never wider than the parent that carries it. A seed is drawn
  // as an ovoid rather than a tube, so anything leaving it still starts thin.
  let startRadius = jointStartRadius(parentRadiusAtAttach, nodeRadius, softPart);
  if (parent.nodeType === 'seed') {
    startRadius = Math.min(parentRadius, nodeRadius, isRootNodeType(node.nodeType) ? 0.03 : 0.028);
  }
  const endRadius = Math.max(0.004, nodeRadius * Math.max(0.25, growthEase));

  return { start, target, animated, branch, startRadius, endRadius, growthEase };
}

export interface PlantGeometryMetrics {
  nodeCount: number;
  segmentCount: number;
  /**
   * Largest distance between a segment's drawn start and the shared attachment
   * point its parent defines. Zero means model and drawing agree at the joint;
   * it only grows while a parent is still animating.
   */
  maxAnchorGap: number;
  /** Largest distance between a node's server position and where it is drawn. */
  maxDrawnOffset: number;
  /** Largest angle between a segment and its parent segment, in degrees. */
  maxAngleDiscontinuityDeg: number;
  /** Largest `node.radius / nodeRenderRadius(type, biomass)`. 1.0 means they agree. */
  maxRadiusRatio: number;
  /**
   * Largest drawn junction radius divided by the part's own radius.
   *
   * The junction rule caps a woody part at `joint_flare_ratio` of its own shank;
   * before that rule a branch off a trunk was drawn at 2.65x. One number, so a
   * regression shows up in a test instead of in a screenshot.
   */
  maxJointToShankRatio: number;
  /** Largest angle between the direction a curve leaves with and the one its parent arrives with. */
  maxTangentKinkDeg: number;
  drawnRadiusRange: [number, number];
}

/**
 * Measure a plant with the renderer's own placement and radius rules.
 *
 * Plant Lab uses this instead of a hand-copied model, so the numbers describe
 * what the real mesh pass would draw. Run it on any `PlantNodeData[]`.
 */
export function measureDrawnPlant(nodes: PlantNodeData[]): PlantGeometryMetrics {
  const byId = new Map<string, PlantNodeData>();
  for (const node of nodes) byId.set(node.id, node);

  const children = new Map<string, PlantNodeData[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }

  const metrics: PlantGeometryMetrics = {
    nodeCount: nodes.length,
    segmentCount: 0,
    maxAnchorGap: 0,
    maxDrawnOffset: 0,
    maxAngleDiscontinuityDeg: 0,
    maxRadiusRatio: 0,
    maxJointToShankRatio: 0,
    maxTangentKinkDeg: 0,
    drawnRadiusRange: [Number.POSITIVE_INFINITY, 0],
  };

  /** The curve each segment was drawn with, so drawn tangents can be compared. */
  const drawnCurves = new Map<string, { start: THREE.Vector3; control: THREE.Vector3 }>();

  const walk = (parent: PlantNodeData, parentFrame?: SegmentFrame): void => {
    for (const node of children.get(parent.id) ?? []) {
      const frame = resolveSegmentFrame(
        node,
        parent,
        byId.values(),
        parentFrame?.animated,
        parentFrame?.startRadius,
      );
      metrics.segmentCount += 1;
      const expectedStart = nodeAttachmentPoint(
        {
          x: parent.position.x,
          y: parent.position.y,
          z: parent.position.z,
          nodeType: parent.nodeType,
          radius: parent.radius,
          biomass: parent.biomass,
          segmentStart:
            parent.parentAttachX !== undefined &&
            parent.parentAttachY !== undefined &&
            parent.parentAttachZ !== undefined
              ? {
                  x: parent.parentAttachX,
                  y: parent.parentAttachY,
                  z: parent.parentAttachZ,
                }
              : undefined,
        },
        frame.target.clone().sub(parent.position),
        node.attachFraction ?? 1,
      );
      metrics.maxAnchorGap = Math.max(
        metrics.maxAnchorGap,
        frame.start.distanceTo(
          new THREE.Vector3(expectedStart.x, expectedStart.y, expectedStart.z),
        ),
      );
      metrics.maxDrawnOffset = Math.max(
        metrics.maxDrawnOffset,
        frame.target.distanceTo(node.position),
      );

      const drawn = resolveDrawnRadius(node.nodeType, node.radius, node.biomass);
      if (drawn > 1e-5) {
        metrics.maxJointToShankRatio = Math.max(
          metrics.maxJointToShankRatio,
          frame.startRadius / drawn,
        );
      }
      const reference = nodeRenderRadius(node.nodeType, node.biomass);
      if (reference > 0) {
        metrics.maxRadiusRatio = Math.max(metrics.maxRadiusRatio, drawn / reference);
      }
      metrics.drawnRadiusRange[0] = Math.min(metrics.drawnRadiusRange[0], drawn);
      metrics.drawnRadiusRange[1] = Math.max(metrics.drawnRadiusRange[1], drawn);

      // Angle to the parent segment, when both have a real direction.
      if (parentFrame) {
        const parentDir = parentFrame.target.clone().sub(parentFrame.start);
        const childDir = frame.target.clone().sub(frame.start);
        if (parentDir.lengthSq() > 1e-8 && childDir.lengthSq() > 1e-8) {
          const dot = THREE.MathUtils.clamp(parentDir.normalize().dot(childDir.normalize()), -1, 1);
          metrics.maxAngleDiscontinuityDeg = Math.max(
            metrics.maxAngleDiscontinuityDeg,
            (Math.acos(dot) * 180) / Math.PI,
          );
        }
      }

      // The chord angle above is a real fork angle, not a defect. What must be
      // continuous is the **drawn** tangent: the direction the curve leaves its
      // start, which is `control - start`. Compare it with the direction the
      // parent's curve arrives, which is `end - control`.
      const parentCurve = parentFrame ? drawnCurves.get(parent.id) : undefined;
      const control = segmentControlPoint(
        node,
        frame.start,
        frame.target,
        parentCurve && parentFrame
          ? { position: parentFrame.animated, control: parentCurve.control }
          : undefined,
      );
      drawnCurves.set(node.id, { start: frame.start.clone(), control });
      const outgoing = control.clone().sub(frame.start);
      const incoming = parentCurve ? parentFrame!.target.clone().sub(parentCurve.control) : null;
      if (incoming && incoming.lengthSq() > 1e-8 && outgoing.lengthSq() > 1e-8) {
        const dot = THREE.MathUtils.clamp(incoming.normalize().dot(outgoing.normalize()), -1, 1);
        metrics.maxTangentKinkDeg = Math.max(
          metrics.maxTangentKinkDeg,
          (Math.acos(dot) * 180) / Math.PI,
        );
      }

      walk(node, frame);
    }
  };

  for (const node of nodes) {
    if (node.parentId === null) walk(node);
  }

  if (!Number.isFinite(metrics.drawnRadiusRange[0])) {
    metrics.drawnRadiusRange = [0, 0];
  }
  return metrics;
}

export function buildPlantMesh(
  nodes: PlantNodeData[],
  options: PlantMeshBuildOptions,
): BuiltPlantMesh {
  const groups = groupByRoot(nodes);
  const allById = new Map<string, PlantNodeData>();
  for (const node of nodes) {
    allById.set(node.id, node);
  }

  // Low side counts (3-5) read as stacked square prisms, especially once Root
  // Sight reveals them, so keep every tube above prism territory.
  const sides = Math.max(6, Math.min(14, Math.round(options.tubeSides)));
  const rootSides = Math.max(8, Math.min(12, Math.round(options.rootSides)));
  const ringSpacingM = options.chainRingSpacingM ?? 0.05;
  const sagittaTolM = options.chainSagittaTolM ?? 0.0015;
  const mesh = new MeshAccumulator();
  const plantData: PlantRenderPlant[] = [];
  const plantLooks: MutationLookStack[] = [];

  const now = options.now;

  for (let plantIndex = 0; plantIndex < groups.length; plantIndex += 1) {
    const group = groups[plantIndex];
    const root = group.find((node) => node.parentId === null) ?? group[0];
    if (!root) continue;

    const isOwn = group.some((node) => node.isOwnPlant === true);
    const look = options.appearanceForPlant?.(group[0]?.plantId ?? '', isOwn) ?? {
      petalCount: 6,
      leafScale: 1,
      seedScale: 1,
    };
    // T04 appearance: one composed look per plant, shared by every part it
    // grows. Composition happens once, not per vertex.
    const stack = options.lookForPlant?.(group[0]?.plantId ?? '', isOwn) ?? NEUTRAL_STACK;
    plantLooks.push(stack);
    const color = isOwn ? OWN_PLANT_COLOR : RIVAL_PLANT_COLOR;
    const box = new THREE.Box3();
    let leafCount = 0;
    let plantSignature = 0;

    // Build children map and compute Murray's law radii
    const childrenMap = new Map<string, PlantNodeData[]>();
    for (const node of group) {
      if (node.parentId) {
        if (!childrenMap.has(node.parentId)) {
          childrenMap.set(node.parentId, []);
        }
        childrenMap.get(node.parentId)?.push(node);
      }
    }

    // Use server-authoritative Murray's law radii directly
    // Server computes and sends radii for all nodes
    const computedRadii = new Map<string, number>();
    for (const node of group) {
      computedRadii.set(node.id, node.radius);
    }

    // Check if this is a seed plant (first node is a seed that hasn't grown beyond cotyledon)
    const isSeedPlant =
      (root.isSeed === true || root.nodeType === 'seed') &&
      (childrenMap.get(root.id)?.length ?? 0) === 0;

    if (isSeedPlant) {
      // Position seed base contact point on the ground so the rounded base sits
      // on top of the soil with the pointed tip toward the sky.
      const seedRadius = resolveDrawnRadius('seed', root.radius, root.biomass) * look.seedScale;
      const seedCenter = new THREE.Vector3(
        root.position.x,
        seedBodyCentreY(root.position.y, seedRadius),
        root.position.z,
      );
      mesh.addSeed(
        seedCenter,
        seedRadius,
        packNode(plantIndex, 4, isOwn, getVariationIndex(root, 4), nodeMutationMask(root)),
        root.spawnTime ?? now,
        1.0, // Seed crown is fully present from start, not "growing"
        0, // jointIndex
      );
      const seedHalfHeight = seedBodyHalfHeight(seedRadius);
      box.expandByPoint(seedCenter.clone().add(new THREE.Vector3(0, seedHalfHeight, 0)));
      box.expandByPoint(seedCenter.clone().add(new THREE.Vector3(0, -seedHalfHeight, 0)));
    } else {
      // Normal plant with root - render seed coat base (crown at surface)
      // Render as seed coat (egg-shaped) via addSeed, NOT as tan sphere via addJoint
      const seedRadius =
        resolveDrawnRadius('seed', computedRadii.get(root.id) ?? root.radius, root.biomass) *
        look.seedScale;
      const seedCenter = new THREE.Vector3(
        root.position.x,
        seedBodyCentreY(root.position.y, seedRadius),
        root.position.z,
      );
      const crownVisualType = 4; // Seed coat appearance
      mesh.addSeed(
        seedCenter,
        seedRadius,
        packNode(
          plantIndex,
          crownVisualType,
          isOwn,
          getVariationIndex(root, crownVisualType),
          nodeMutationMask(root),
        ),
        root.spawnTime ?? now,
        1.0, // Crown is always fully present (not "growing" like new nodes)
        0, // jointIndex
      );
      const seedHalfHeight = seedBodyHalfHeight(seedRadius);
      box.expandByPoint(seedCenter.clone().add(new THREE.Vector3(0, seedHalfHeight, 0)));
      box.expandByPoint(seedCenter.clone().add(new THREE.Vector3(0, -seedHalfHeight, 0)));
    }

    // Segment data per node, filled in by the walk below and consumed by the
    // chain pass so tubes can be stitched segment to segment.
    const drawnSegments = new Map<string, DrawnSegment>();

    // Process all nodes in topological order (roots first, then children)
    const processNode = (node: PlantNodeData, depth = 0, jointIndex = 1): void => {
      if (!node.parentId) return;

      const parent = allById.get(node.parentId);
      if (!parent) return;

      // Client-side growth animation: use server-synced growthProgress (0→1 animated by client loop)
      const spawnTime = node.spawnTime ?? 0;
      const growthEase = node.growthProgress ?? 0;
      // NOTE: Do NOT early-return on growthEase < 0.02 — that delays new growth appearance.
      // Geometry is already scaled by growthProgress (zero-radius tubes are invisible by default).

      // One shared resolver owns attachment, target and thickness, so the mesh
      // pass and Plant Lab cannot drift apart.
      const frame = resolveSegmentFrame(
        node,
        parent,
        allById.values(),
        drawnSegments.get(parent.id)?.position,
        drawnSegments.get(parent.id)?.startRadius,
      );
      const parentAttachPos = frame.start;
      const targetPosition = frame.target;
      const animatedPosition = frame.animated;
      const branch = frame.branch;
      const mutationMask = nodeMutationMask(node);
      plantSignature = Math.max(plantSignature, mutationMask);
      // Bark thickness is a body change, not paint: a thickened-bark plant is
      // physically fatter, and the same style thickens roots and stems too.
      const organLookNow = organLook(stack, node.nodeType ?? 'stem');
      const spineDensity = organLookNow.spines;
      const barkScale = organLookNow.barkScale;
      const rA = frame.startRadius * barkScale;
      const rB = frame.endRadius * barkScale;

      box.expandByPoint(animatedPosition);

      if (branch.lengthSq() > 1e-8) {
        branch.normalize();

        // Use simpler root geometry (fewer sides) for underground roots
        const isRoot =
          node.type === 0 ||
          parent.type === 0 ||
          node.nodeType === 'radicle' ||
          node.nodeType === 'root' ||
          node.nodeType === 'lateral_root';
        const tubeSides = isRoot ? rootSides : sides;

        const visualNodeType = getVisualNodeType(node);
        const variationIdx = getVariationIndex(node, visualNodeType);

        // One owner for the curve: the build loop and the measurement call the
        // same function, so a metric can never describe a curve nobody draws.
        const controlPoint = segmentControlPoint(
          node,
          parentAttachPos,
          targetPosition,
          drawnSegments.get(parent.id),
        );

        // Geometry is emitted per chain after the walk, so consecutive segments
        // can share their boundary rings instead of meeting sphere-to-tube.
        drawnSegments.set(node.id, {
          start: parentAttachPos.clone(),
          position: animatedPosition,
          startRadius: rA,
          radius: Math.max(0.004, rB),
          control: controlPoint,
          packed: packNode(plantIndex, visualNodeType, isOwn, variationIdx, mutationMask),
          jointIndex,
          sides: tubeSides,
          spawnTime,
          growthEase,
          spines: spineDensity,
        });
      }

      // Use target position for bounding box (encompasses full curve)
      box.expandByPoint(targetPosition);
      box.expandByPoint(parent.position);

      const isLeafNode = node.type === 3;
      const isSeedNode = node.type === 4;
      // Cotyledons are the seed leaves: the server marks them by type, and their
      // parent is the seed, so the old "parent is a root" test never matched and
      // they were placed like ordinary canopy leaves.
      const isCotyledon =
        node.nodeType === 'cotyledon' || (isLeafNode && parent.nodeType === 'seed');
      const nodeVisualType = getVisualNodeType(node);
      const isFlower = node.nodeType?.toLowerCase() === 'flower';
      const isSporeSac = node.nodeType?.toLowerCase() === 'spore_sac';
      const nodeTypeNum = typeof node.type === 'number' ? node.type : 0;
      // A blade can never be much bigger than the part that carries it. At the
      // shared canopy size a 0.1 m cotyledon drew a metre-wide paddle hanging in
      // the air beside the stem, and every leaf read as a detached green triangle.
      // Capping by the node's own segment keeps foliage attached and proportional.
      const segmentSpan = parentAttachPos.distanceTo(targetPosition);
      const bladeCap = Number.isFinite(segmentSpan)
        ? Math.max(0.1, segmentSpan * 2.2)
        : Number.POSITIVE_INFINITY;

      // Seed leaves sprout a hand's width above the soil (the server places
      // cotyledons at ~0.23 m), so the canopy height gate cannot apply to them:
      // they are the plant's first leaves and must always get a blade.
      const canGrowLeaves =
        options.leafCountPerNode > 0 &&
        leafCount < MAX_LEAVES_PER_PLANT &&
        (isCotyledon || targetPosition.y > 0.25) &&
        nodeTypeNum >= 1 &&
        !isSeedNode &&
        growthEase > 0.15;

      if (isLeafNode && canGrowLeaves) {
        const direction = branch.lengthSq() > 1e-8 ? branch.clone() : new THREE.Vector3(0, 1, 0);
        const { normal } = leafDirection(
          direction,
          0,
          1,
          isCotyledon,
          node.id,
          options.sunDirection,
        );
        // Flower and spore_sac get distinct visual types
        const leafVisualType = isFlower ? 5 : isSporeSac ? 6 : nodeVisualType;
        const leafVariationIdx = getVariationIndex(node, leafVisualType);
        // Seed leaves are small relative to the seedling; at 0.6 they rendered
        // bigger than the whole stem and read as green paddles.
        const leafSizeMult = isCotyledon ? 0.3 : 0.55;
        mesh.addLeaf(
          animatedPosition,
          direction,
          normal,
          Math.min(
            bladeCap,
            options.leafSize *
              0.9 *
              growthEase *
              leafSizeMult *
              look.leafScale *
              (isFlower ? Math.min(2, look.petalCount / 6) : 1),
          ),
          packNode(plantIndex, leafVisualType, isOwn, leafVariationIdx, mutationMask),
          spawnTime,
          growthEase,
          jointIndex,
        );
        leafCount += 1;
      } else if (canGrowLeaves && animatedPosition.y > 0.5) {
        const direction = branch.lengthSq() > 1e-8 ? branch.clone() : new THREE.Vector3(0, 1, 0);
        const count = Math.max(1, Math.min(3, Math.round(options.leafCountPerNode)));
        for (let leaf = 0; leaf < count && leafCount < MAX_LEAVES_PER_PLANT; leaf += 1) {
          const { direction: leafDir, normal } = leafDirection(
            direction,
            leaf,
            count,
            false,
            node.id,
            options.sunDirection,
          );
          const leafVariationIdx = getVariationIndex(node, 3);
          // Cotyledons use distinct visual type 7 (yellow-green seed leaf)
          const leafVisualType = isCotyledon ? 7 : 3;
          // Cotyledons are modestly larger than regular leaves initially
          const leafSizeMult = isCotyledon ? 0.8 : 1.0;
          mesh.addLeaf(
            animatedPosition,
            leafDir,
            normal,
            Math.min(
              bladeCap,
              options.leafSize * 0.75 * growthEase * leafSizeMult * look.leafScale,
            ),
            packNode(plantIndex, leafVisualType, isOwn, leafVariationIdx, mutationMask),
            spawnTime,
            growthEase,
            jointIndex,
          );
          leafCount += 1;
        }
      }

      // Recursively process children
      const children = childrenMap.get(node.id) || [];
      for (const child of children) {
        processNode(child, depth + 1, jointIndex + 2);
      }
    };

    // Start processing from root's children
    const rootChildren = childrenMap.get(root.id) || [];
    for (const child of rootChildren) {
      processNode(child, 0, 1);
    }

    // Chain pass: walk each run of single-child nodes and emit one tapered tube
    // through it. Branch points get a single joint sphere, terminal tips none.
    const consumed = new Set<string>();
    const pending = rootChildren.map((child) => child.id);
    const addJointSphere = (id: string, scale: number): void => {
      const info = drawnSegments.get(id);
      if (!info) return;
      mesh.addJoint(
        info.position,
        Math.max(0.004, info.radius * scale),
        info.packed,
        info.spawnTime,
        info.growthEase,
        info.jointIndex,
      );
    };

    while (pending.length > 0) {
      const startId = pending.pop();
      if (startId === undefined || consumed.has(startId)) continue;

      const points: ChainPoint[] = [];
      let cursor: string | null = startId;
      let chainEnd: string | null = null;
      let first = true;

      while (cursor !== null && !consumed.has(cursor)) {
        const info = drawnSegments.get(cursor);
        if (!info) break;
        consumed.add(cursor);

        // Sample the segment's curve; the first ring of every segment after the
        // first is the previous segment's last ring, so nothing is duplicated.
        const length = info.start.distanceTo(info.position);
        const bend = info.start
          .clone()
          .addScaledVector(info.control, -2)
          .add(info.position)
          .length();
        const samples = chainSampleCount(length, bend, ringSpacingM, sagittaTolM);
        const fractions = chainSampleFractions(samples);
        for (let i = first ? 0 : 1; i <= samples; i += 1) {
          const t = fractions[i];
          const invT = 1 - t;
          const position = new THREE.Vector3()
            .addScaledVector(info.start, invT * invT)
            .addScaledVector(info.control, 2 * invT * t)
            .addScaledVector(info.position, t * t);
          points.push({
            position,
            radius: segmentRadiusAt(info.startRadius, info.radius, t),
            packed: info.packed,
            jointA: info.jointIndex,
            jointB: info.jointIndex + 1,
            weight: t,
            spawnTime: info.spawnTime,
            growthProgress: info.growthEase,
            spines: info.spines,
          });
        }
        first = false;

        const nextNodes: PlantNodeData[] = childrenMap.get(cursor) ?? [];
        if (nextNodes.length !== 1) {
          chainEnd = cursor;
          cursor = null;
        } else {
          cursor = nextNodes[0].id;
        }
      }

      if (points.length >= 2) {
        const sidesForChain = drawnSegments.get(startId)?.sides ?? sides;
        mesh.addChainTube(points, sidesForChain);
        addChainSpines(mesh, points);
      }

      if (chainEnd !== null) {
        const forkChildren: PlantNodeData[] = childrenMap.get(chainEnd) ?? [];
        if (forkChildren.length >= 2) {
          // A fork: one sphere covers the junction, then each branch is its own
          // chain (this is the only place a sphere is still needed). Sized by the
          // widest thing it has to cover - the parent's end *and* every child's
          // base - because a knuckle smaller than a child's base leaves that
          // child's base disc sticking out of it.
          const parentEnd = drawnSegments.get(chainEnd)?.radius ?? 0;
          const widestChild = forkChildren.reduce(
            (widest, child) => Math.max(widest, drawnSegments.get(child.id)?.startRadius ?? 0),
            0,
          );
          const knuckle = Math.max(parentEnd, widestChild);
          addJointSphere(chainEnd, parentEnd > 1e-6 ? (knuckle * 1.05) / parentEnd : 1.15);
          for (const child of forkChildren) pending.push(child.id);
        }
      }
    }

    box.expandByScalar(Math.max(0.2, options.leafSize));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(0.15, size.length() * 0.5);

    plantData.push({
      id: root.plantId ?? root.id,
      center,
      radius,
      color,
      isOwn,
      nodeCount: group.length,
      mutationMask: plantSignature,
    });

    // Selection is communicated by the growth panel. There is deliberately no
    // separate gold ring geometry: the old ring sat on the node like a sticker,
    // and its broken second index loop was the rainbow cone. Adding geometry
    // just to say "this node is selected" is not worth either problem.
  }

  return {
    vertices: mesh.toVertexArray(),
    indices: new Uint32Array(mesh.indices),
    plantData,
    plantLooks,
  };
}
