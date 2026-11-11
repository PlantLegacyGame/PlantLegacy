import { hash01 } from '@plant-legacy/shared/math';
import * as THREE from 'three';
import type { PlantNodeData } from '../PlantRenderer';

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

export interface PlantMeshBuildOptions {
  leafSize: number;
  leafCountPerNode: number;
  tubeSides: number;
  rootSides: number;
  now: number;
  sunDirection: THREE.Vector3;
  selectedNodeId?: string | null;
}

export interface PlantRenderPlant {
  center: THREE.Vector3;
  radius: number;
  color: [number, number, number];
  isOwn: boolean;
  nodeCount: number;
}

export interface BuiltPlantMesh {
  vertices: Float32Array;
  indices: Uint32Array;
  plantData: PlantRenderPlant[];
  outlineIndexOffset: number;
  outlineIndexCount: number;
}

const OWN_PLANT_COLOR: [number, number, number] = [0.3, 0.62, 0.24];
const RIVAL_PLANT_COLOR: [number, number, number] = [0.46, 0.54, 0.2];
const MAX_LEAVES_PER_PLANT = 48;

function packNode(
  plantIndex: number,
  nodeType: number,
  isOwn: boolean,
  variationIndex = 0,
): number {
  return (
    (plantIndex & 0xffff) |
    ((nodeType & 0xff) << 16) |
    ((isOwn ? 1 : 0) << 24) |
    ((variationIndex & 0xf) << 25)
  );
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

  // Quadratic bezier curve tube with organic noise-based curvature
  addCurvedTube(
    start: THREE.Vector3,
    end: THREE.Vector3,
    control: THREE.Vector3,
    radiusA: number,
    radiusB: number,
    sides: number,
    packed: number,
    segments = 8,
    spawnTime = 0,
    growthProgress = 1,
    jointIndex = 0,
  ): void {
    // Sample curve points
    const emergentR = growthProgress;
    const rA = Math.max(0.005, radiusA) * emergentR;
    const rB = Math.max(0.003, radiusB) * emergentR;
    const points: THREE.Vector3[] = [];
    const radii: number[] = [];
    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      const invT = 1 - t;
      const pos = start
        .clone()
        .multiplyScalar(invT * invT)
        .addScaledVector(control, 2 * invT * t)
        .addScaledVector(end, t * t);
      points.push(pos);
      radii.push(rA * invT + rB * t);
    }

    // Build tube rings along curve
    for (let i = 0; i <= segments; i += 1) {
      const pos = points[i];
      const radius = radii[i];

      // Tangent direction for this segment
      let tangent: THREE.Vector3;
      if (i === 0) {
        tangent = points[1].clone().sub(points[0]).normalize();
      } else if (i === segments) {
        tangent = points[segments]
          .clone()
          .sub(points[segments - 1])
          .normalize();
      } else {
        tangent = points[i + 1]
          .clone()
          .sub(points[i - 1])
          .normalize();
      }

      const { u, v } = perpendicularBasis(tangent);
      const ringStart = this.vertexCount;

      for (let side = 0; side <= sides; side += 1) {
        const angle = (side / sides) * Math.PI * 2;
        const offset = u
          .clone()
          .multiplyScalar(Math.cos(angle))
          .addScaledVector(v, Math.sin(angle));
        const normal = offset.clone().normalize();
        const position = pos.clone().addScaledVector(offset, radius);
        const segmentWeight = 1.0 - i / segments;
        const nextSegmentWeight = i / segments;
        this.pushVertex(
          position,
          normal,
          side / sides,
          i / segments,
          packed,
          spawnTime,
          growthProgress,
          [jointIndex, jointIndex + 1, 0, 0],
          [segmentWeight, nextSegmentWeight, 0, 0],
        );
      }

      if (i > 0) {
        const prevStart = ringStart - (sides + 1);
        for (let side = 0; side < sides; side += 1) {
          const a0 = prevStart + side;
          const a1 = prevStart + side + 1;
          const b0 = ringStart + side;
          const b1 = ringStart + side + 1;
          this.addTriangle(a0, b0, a1);
          this.addTriangle(a1, b0, b1);
        }
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
    const p0 = base.clone().addScaledVector(direction, petioleLength);
    const p1 = p0.clone().addScaledVector(side, size * 0.22);
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
    const sides = 6;
    const rings = 4;
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
    const sides = 12;
    const rings = 8;
    const start = this.vertexCount;
    const emergentRadius = radius * growthProgress;

    // Organic botanical seed shape:
    // Egg-shaped: narrower at top (pointed apex), wider at bottom (rounded base)
    // This matches a seed sitting on soil with radicle emerging downward
    for (let ring = 0; ring <= rings; ring += 1) {
      const v = ring / rings; // 0 (top) to 1 (bottom)
      const phi = v * Math.PI;
      const y = Math.cos(phi); // +1 at top, -1 at bottom
      // Egg profile: narrow pointed top, wide rounded bottom
      // Asymmetric: top is pinched, bottom is bulbous
      const eggTaper = 1.0 - 0.35 * v; // less taper toward bottom
      const profile = Math.sin(phi) * eggTaper * (1.0 + 0.15 * Math.cos(phi));
      const yScaled = y * 1.3; // Slightly taller than wide

      for (let side = 0; side <= sides; side += 1) {
        const u = side / sides;
        const theta = u * Math.PI * 2;
        // Subtle lateral flattening (seeds like sunflower, bean, or acorn are slightly oval in cross section)
        const x = profile * Math.cos(theta) * 0.95;
        const z = profile * Math.sin(theta) * 0.85;

        const pos = new THREE.Vector3(x, yScaled, z).multiplyScalar(emergentRadius).add(center);
        const normal = new THREE.Vector3(x, y * 0.8, z).normalize();
        const ringWeight = 1.0 - v;
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

export function buildPlantMesh(
  nodes: PlantNodeData[],
  options: PlantMeshBuildOptions,
): BuiltPlantMesh {
  const groups = groupByRoot(nodes);
  const allById = new Map<string, PlantNodeData>();
  for (const node of nodes) {
    allById.set(node.id, node);
  }

  const sides = Math.max(3, Math.min(12, Math.round(options.tubeSides)));
  const rootSides = Math.max(3, Math.min(8, Math.round(options.rootSides)));
  const mesh = new MeshAccumulator();
  const plantData: PlantRenderPlant[] = [];

  const now = options.now;

  // Track outline index range (for separate outline pass)
  let outlineIndexOffset = 0;
  let outlineIndexCount = 0;

  for (let plantIndex = 0; plantIndex < groups.length; plantIndex += 1) {
    const group = groups[plantIndex];
    const root = group.find((node) => node.parentId === null) ?? group[0];
    if (!root) continue;

    const isOwn = group.some((node) => node.isOwnPlant === true);
    const color = isOwn ? OWN_PLANT_COLOR : RIVAL_PLANT_COLOR;
    const box = new THREE.Box3();
    let leafCount = 0;

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
      // Render botanical teardrop seed sitting fully above the soil surface
      const seedRadius = Math.max(0.07, Math.min(0.12, root.radius * 1.3));
      // Position seed center at radius height so it sits on top of the ground
      const seedCenter = new THREE.Vector3(
        root.position.x,
        root.position.y + seedRadius,
        root.position.z,
      );
      mesh.addSeed(
        seedCenter,
        seedRadius,
        packNode(plantIndex, 4, isOwn, getVariationIndex(root, 4)),
        root.spawnTime ?? now,
        1.0, // Seed crown is fully present from start, not "growing"
        0, // jointIndex
      );
      box.expandByPoint(seedCenter.clone().add(new THREE.Vector3(0, seedRadius * 1.3, 0)));
      box.expandByPoint(seedCenter.clone().add(new THREE.Vector3(0, -seedRadius * 1.3, 0)));
    } else {
      // Normal plant with root - render seed coat base (crown at surface)
      // Render as seed coat (egg-shaped) via addSeed, NOT as tan sphere via addJoint
      const seedRadius = Math.max(
        0.07,
        Math.min(0.12, computedRadii.get(root.id) ?? root.radius * 1.3),
      );
      const seedCenter = new THREE.Vector3(
        root.position.x,
        root.position.y + seedRadius,
        root.position.z,
      );
      const crownVisualType = 4; // Seed coat appearance
      mesh.addSeed(
        seedCenter,
        seedRadius,
        packNode(plantIndex, crownVisualType, isOwn, getVariationIndex(root, crownVisualType)),
        root.spawnTime ?? now,
        1.0, // Crown is always fully present (not "growing" like new nodes)
        0, // jointIndex
      );
      box.expandByPoint(seedCenter.clone().add(new THREE.Vector3(0, seedRadius * 1.3, 0)));
      box.expandByPoint(seedCenter.clone().add(new THREE.Vector3(0, -seedRadius * 1.3, 0)));
    }

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

      // Use server-authoritative parent attachment position for growth animation
      // Fall back to heuristic for older data without parentAttachPos
      let parentAttachPos: THREE.Vector3;
      if (
        parent.parentAttachX !== undefined &&
        parent.parentAttachY !== undefined &&
        parent.parentAttachZ !== undefined
      ) {
        parentAttachPos = new THREE.Vector3(
          parent.parentAttachX,
          parent.parentAttachY,
          parent.parentAttachZ,
        );
      } else {
        // Legacy heuristic: for seed parents, attach from base at ground level (y = 0)
        parentAttachPos =
          parent.isSeed || parent.nodeType === 'seed'
            ? new THREE.Vector3(parent.position.x, 0, parent.position.z)
            : parent.position;
      }

      // Use server-authoritative target position (where the node is growing to)
      // for the connector tube end and curve control point. Falls back to the
      // node's current position for fully-grown nodes that have no target.
      // This ensures new growth is drawn as a tube extending from the parent
      // toward the target, not as a zero-length blob at the parent.
      const hasTarget =
        node.targetX !== undefined && node.targetY !== undefined && node.targetZ !== undefined;
      const targetPosition = hasTarget
        ? new THREE.Vector3(node.targetX, node.targetY, node.targetZ)
        : node.position;

      const animatedPosition = parentAttachPos.clone().lerp(targetPosition, growthEase);
      box.expandByPoint(animatedPosition);
      const branch = new THREE.Vector3().subVectors(animatedPosition, parentAttachPos);

      if (branch.lengthSq() > 1e-8) {
        branch.normalize();

        // Get Murray's law radii (clamped to prevent giant segments from server radii)
        const parentRadius = Math.min(computedRadii.get(parent.id) ?? parent.radius, 0.2);
        const nodeRadius = Math.min(computedRadii.get(node.id) ?? node.radius, 0.2);

        // Apply growth easing to radii for smooth emergence
        const rA = Math.max(0.015, parentRadius);
        // Per-part radius scaling: radicles thin, stems sturdy
        let radiusMult = 1.0;
        if (node.nodeType === 'radicle') radiusMult = 0.5;
        else if (node.nodeType === 'root') radiusMult = 0.8;
        else if (node.nodeType === 'lateral_root') radiusMult = 0.6;
        else if (node.nodeType === 'stem' || node.nodeType === 'branch') radiusMult = 1.2;
        const rB = Math.max(0.008, nodeRadius * radiusMult * Math.max(0.25, growthEase));

        // Use simpler root geometry (fewer sides) for underground roots
        const isRoot =
          node.type === 0 ||
          parent.type === 0 ||
          node.nodeType === 'radicle' ||
          node.nodeType === 'root' ||
          node.nodeType === 'lateral_root';
        const tubeSides = isRoot ? rootSides : sides;

        // Root-specific: stronger joint blending for organic fusion
        const jointMult = isRoot ? 1.3 : 1.1;
        const jointRadius = Math.max(rA, rB) * jointMult;

        const visualNodeType = getVisualNodeType(node);
        const variationIdx = getVariationIndex(node, visualNodeType);
        mesh.addJoint(
          parentAttachPos,
          jointRadius,
          packNode(plantIndex, visualNodeType, isOwn, variationIdx),
          spawnTime,
          growthEase,
          jointIndex,
        );

        // Organic curvature with botanical gravitropism
        const length = parentAttachPos.distanceTo(targetPosition);

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
        const branchDir = new THREE.Vector3()
          .subVectors(targetPosition, parentAttachPos)
          .normalize();
        const bendDir = new THREE.Vector3()
          .crossVectors(branchDir, new THREE.Vector3(0, 1, 0))
          .normalize();
        if (bendDir.lengthSq() < 1e-6) bendDir.set(1, 0, 0);

        const controlPoint = parentAttachPos
          .clone()
          .add(targetPosition)
          .multiplyScalar(0.5)
          .addScaledVector(bendDir, curvature * (hash01(node.id, 'bend') - 0.5) * 2)
          .addScaledVector(new THREE.Vector3(0, 1, 0), gravityBias * length);

        // Animate along the fixed curve using growthEase
        const animatedPosition = parentAttachPos.clone().lerp(targetPosition, growthEase);

        mesh.addCurvedTube(
          parentAttachPos,
          animatedPosition,
          controlPoint,
          rA,
          rB,
          tubeSides,
          packNode(plantIndex, visualNodeType, isOwn, variationIdx),
          8,
          spawnTime,
          growthEase,
          jointIndex + 1,
        );
      }

      // Use target position for bounding box (encompasses full curve)
      box.expandByPoint(targetPosition);
      box.expandByPoint(parent.position);

      const isLeafNode = node.type === 3;
      const isSeedNode = node.type === 4;
      const isCotyledon = isLeafNode && parent.type === 0 && parent.parentId === null;
      const nodeVisualType = getVisualNodeType(node);
      const isFlower = node.nodeType?.toLowerCase() === 'flower';
      const isSporeSac = node.nodeType?.toLowerCase() === 'spore_sac';
      const nodeTypeNum = typeof node.type === 'number' ? node.type : 0;
      const canGrowLeaves =
        options.leafCountPerNode > 0 &&
        leafCount < MAX_LEAVES_PER_PLANT &&
        targetPosition.y > 0.25 &&
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
        const leafSizeMult = isCotyledon ? 1.3 : 1.0;
        mesh.addLeaf(
          animatedPosition,
          direction,
          normal,
          options.leafSize * 0.9 * growthEase * leafSizeMult,
          packNode(plantIndex, leafVisualType, isOwn, leafVariationIdx),
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
          // Cotyledons are larger than regular leaves initially
          const leafSizeMult = isCotyledon ? 1.6 : 1.0;
          mesh.addLeaf(
            animatedPosition,
            leafDir,
            normal,
            options.leafSize * 0.75 * growthEase * leafSizeMult,
            packNode(plantIndex, leafVisualType, isOwn, leafVariationIdx),
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

    box.expandByScalar(Math.max(0.2, options.leafSize));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(0.15, size.length() * 0.5);

    plantData.push({
      center,
      radius,
      color,
      isOwn,
      nodeCount: group.length,
    });

    // Add outline for selected node in this plant (visual type 8 = gold outline)
    let plantOutlineIndexOffset = 0;
    let plantOutlineIndexCount = 0;
    if (options.selectedNodeId) {
      const selectedNode = group.find((n) => n.id === options.selectedNodeId);
      if (selectedNode) {
        const outlineRadius = Math.max(selectedNode.radius * 1.3, 0.12);
        const outlinePos = new THREE.Vector3(
          selectedNode.position.x,
          selectedNode.position.y,
          selectedNode.position.z,
        );
        plantOutlineIndexOffset = mesh.indices.length;
        // Render outline as a thin ring (tube) instead of a solid sphere joint
        // This avoids the "yellow sphere" appearance while still marking the node
        const ringRadius = outlineRadius;
        const tubeRadius = Math.max(0.008, outlineRadius * 0.06); // Thin wire
        // Create a horizontal ring at node position
        const ringCenter = outlinePos.clone();
        const up = new THREE.Vector3(0, 1, 0);
        const { u, v } = perpendicularBasis(up);
        const ringSides = 16;
        const ringStart = mesh.vertexCount;
        for (let side = 0; side <= ringSides; side += 1) {
          const angle = (side / ringSides) * Math.PI * 2;
          const offset = u
            .clone()
            .multiplyScalar(Math.cos(angle))
            .addScaledVector(v, Math.sin(angle));
          const position = ringCenter.clone().addScaledVector(offset, ringRadius);
          const normal = offset.clone().normalize();
          mesh.pushVertex(
            position,
            normal,
            side / ringSides,
            0,
            packNode(plantIndex, 8, isOwn),
            0,
            1,
          );
        }
        for (let side = 0; side < ringSides; side += 1) {
          const a0 = ringStart + side;
          const a1 = ringStart + side + 1;
          const b0 = ringStart + ringSides + 1 + side;
          const b1 = ringStart + ringSides + 1 + side + 1;
          mesh.addTriangle(a0, b0, a1);
          mesh.addTriangle(a1, b0, b1);
        }
        // Add second ring slightly offset for thickness
        const ringCenter2 = ringCenter.clone().addScaledVector(up, tubeRadius * 2);
        const ringStart2 = mesh.vertexCount;
        for (let side = 0; side <= ringSides; side += 1) {
          const angle = (side / ringSides) * Math.PI * 2;
          const offset = u
            .clone()
            .multiplyScalar(Math.cos(angle))
            .addScaledVector(v, Math.sin(angle));
          const position = ringCenter2.clone().addScaledVector(offset, ringRadius);
          const normal = offset.clone().normalize();
          mesh.pushVertex(
            position,
            normal,
            side / ringSides,
            1,
            packNode(plantIndex, 8, isOwn),
            0,
            1,
          );
        }
        for (let side = 0; side < ringSides; side += 1) {
          const a0 = ringStart2 + side;
          const a1 = ringStart2 + side + 1;
          const b0 = ringStart2 + ringSides + 1 + side;
          const b1 = ringStart2 + ringSides + 1 + side + 1;
          mesh.addTriangle(a0, b0, a1);
          mesh.addTriangle(a1, b0, b1);
        }
        // Connect the two rings (tube walls)
        for (let side = 0; side < ringSides; side += 1) {
          const a0 = ringStart + side;
          const a1 = ringStart + side + 1;
          const b0 = ringStart2 + side;
          const b1 = ringStart2 + side + 1;
          mesh.addTriangle(a0, b0, a1);
          mesh.addTriangle(a1, b0, b1);
        }
        plantOutlineIndexCount = mesh.indices.length - plantOutlineIndexOffset;
        box.expandByPoint(
          outlinePos.clone().add(new THREE.Vector3(0, outlineRadius + tubeRadius, 0)),
        );
        box.expandByPoint(
          outlinePos.clone().add(new THREE.Vector3(0, -outlineRadius - tubeRadius, 0)),
        );
      }
    }

    // Track outline range for the plant containing the selected node
    if (plantOutlineIndexCount > 0) {
      outlineIndexOffset = plantOutlineIndexOffset;
      outlineIndexCount = plantOutlineIndexCount;
    }
  }

  return {
    vertices: mesh.toVertexArray(),
    indices: new Uint32Array(mesh.indices),
    plantData,
    outlineIndexOffset,
    outlineIndexCount,
  };
}
