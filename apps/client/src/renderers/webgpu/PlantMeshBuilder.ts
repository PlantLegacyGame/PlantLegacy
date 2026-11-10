import { hash01 } from '@plant-legacy/shared/math';
import * as THREE from 'three';
import type { PlantNodeData } from '../PlantRenderer';

/** Interleaved mesh vertex: position(3) + normal(3) + uv(2) + packed(1 u32). */
export const MESH_VERTEX_STRIDE = 36;
const MESH_FLOATS_PER_VERTEX = 9;
const MESH_PACKED_WORD = 8;

export interface PlantMeshBuildOptions {
  leafSize: number;
  leafCountPerNode: number;
  tubeSides: number;
  rootSides: number;
  now: number;
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

function packNode(plantIndex: number, nodeType: number, isOwn: boolean): number {
  return (plantIndex & 0xffff) | ((nodeType & 0xff) << 16) | ((isOwn ? 1 : 0) << 24);
}

function getVisualNodeType(node: PlantNodeData): number {
  // Map string nodeType to visual types for distinct rendering
  const nt = node.nodeType?.toLowerCase();
  if (nt === 'seed' || node.isSeed) return 4; // Seed - botanical teardrop
  if (nt === 'flower') return 5; // Flower - pink/red
  if (nt === 'spore_sac') return 6; // Spore sac - brown/orange
  if (nt === 'vine') return 2; // Vine - green (already type 2)
  if (nt === 'cotyledon') return 7; // Cotyledon - distinct from leaf
  if (nt === 'leaf') return 3; // Regular leaf
  if (nt === 'stem') return 1; // Stem - trunk
  if (nt === 'branch') return 1; // Branch - trunk
  if (nt === 'root') return 0; // Root
  if (nt === 'radicle') return 0; // Radicle - root
  if (nt === 'lateral_root') return 0; // Lateral root - root
  // Fallback to numeric type
  return typeof node.type === 'number' ? node.type : 0;
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
  ): void {
    this.positions.push(position.x, position.y, position.z, normal.x, normal.y, normal.z, u, v);
    this.packedValues.push(packed);
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
        this.pushVertex(position, normal, side / sides, ring, packed);
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
      this.pushVertex(a, direction.clone().negate(), 0.5, 0.5, packed);
      for (let side = 0; side < sides; side += 1) {
        const angle = (side / sides) * Math.PI * 2;
        const offset = u
          .clone()
          .multiplyScalar(Math.cos(angle))
          .addScaledVector(v, Math.sin(angle));
        const position = a.clone().addScaledVector(offset, rA);
        const normal = direction.clone().negate();
        this.pushVertex(position, normal, side / sides, 0, packed);
      }
      for (let side = 0; side < sides; side += 1) {
        const next = (side + 1) % sides;
        this.addTriangle(startCenter, startCenter + 1 + side, startCenter + 1 + next);
      }

      const endCenter = this.vertexCount;
      this.pushVertex(b, direction.clone(), 0.5, 0.5, packed);
      for (let side = 0; side < sides; side += 1) {
        const angle = (side / sides) * Math.PI * 2;
        const offset = u
          .clone()
          .multiplyScalar(Math.cos(angle))
          .addScaledVector(v, Math.sin(angle));
        const position = b.clone().addScaledVector(offset, rB);
        this.pushVertex(position, direction.clone(), side / sides, 1, packed);
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
  ): void {
    const rA = Math.max(0.005, radiusA);
    const rB = Math.max(0.003, radiusB);

    // Sample curve points
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
        this.pushVertex(position, normal, side / sides, i / segments, packed);
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
    this.addTube(petioleBase, petioleTip, petioleRadius, petioleRadius, 4, packed, false);

    // Leaf blade
    const p0 = base.clone().addScaledVector(direction, petioleLength);
    const p1 = p0.clone().addScaledVector(side, size * 0.22);
    const p2 = p0.clone().addScaledVector(direction, size);
    const p3 = p0.clone().addScaledVector(side, -size * 0.22);

    const start = this.vertexCount;
    this.pushVertex(p0, normal, 0, 0.5, packed);
    this.pushVertex(p1, normal, 0.35, 1, packed);
    this.pushVertex(p2, normal, 1, 0.5, packed);
    this.pushVertex(p3, normal, 0.35, 0, packed);
    this.addTriangle(start, start + 1, start + 2);
    this.addTriangle(start, start + 2, start + 3);
  }

  addJoint(center: THREE.Vector3, radius: number, packed: number): void {
    const sides = 6;
    const rings = 4;
    const start = this.vertexCount;

    for (let ring = 0; ring <= rings; ring += 1) {
      const phi = (ring / rings) * Math.PI;
      const y = Math.cos(phi);
      const r = Math.sin(phi);
      for (let side = 0; side <= sides; side += 1) {
        const theta = (side / sides) * Math.PI * 2;
        const x = r * Math.cos(theta);
        const z = r * Math.sin(theta);
        const pos = new THREE.Vector3(x, y, z).multiplyScalar(radius).add(center);
        const normal = new THREE.Vector3(x, y, z).normalize();
        this.pushVertex(pos, normal, side / sides, ring / rings, packed);
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

  addSeed(center: THREE.Vector3, radius: number, packed: number): void {
    const sides = 12;
    const rings = 8;
    const start = this.vertexCount;

    // Organic botanical seed shape:
    // Slightly teardrop/ovoid (tapered top, rounded bottom, gentle lateral flattening)
    for (let ring = 0; ring <= rings; ring += 1) {
      const v = ring / rings; // 0 (top) to 1 (bottom)
      const phi = v * Math.PI;
      // Botanical seed profile: wider lower-middle, slightly pointed apex
      const y = Math.cos(phi); // +1 at top, -1 at bottom
      // Teardrop curve: slightly pinched near top (v near 0)
      const profile = Math.sin(phi) * (1.0 + 0.15 * Math.cos(phi));
      const yScaled = y * 1.2; // Slightly taller than wide

      for (let side = 0; side <= sides; side += 1) {
        const u = side / sides;
        const theta = u * Math.PI * 2;
        // Subtle lateral flattening (seeds like sunflower, bean, or acorn are slightly oval in cross section)
        const x = profile * Math.cos(theta) * 0.95;
        const z = profile * Math.sin(theta) * 0.85;

        const pos = new THREE.Vector3(x, yScaled, z).multiplyScalar(radius).add(center);
        const normal = new THREE.Vector3(x, y * 0.8, z).normalize();
        this.pushVertex(pos, normal, u, v, packed);
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
  if (isCotyledon) {
    const direction = side.clone().normalize(); // Pure horizontal
    const normal = up.clone(); // Face straight up for photosynthesis
    return { direction, normal };
  }

  const spread = 0.35 + (count > 1 ? 0.25 : 0);
  const direction = side
    .clone()
    .multiplyScalar(Math.cos(angle))
    .addScaledVector(forward, Math.sin(angle))
    .addScaledVector(branchDirection, spread)
    .normalize();

  // Leaf normal faces UP (toward sun) for photosynthesis and realistic appearance
  // Slight angle variation for natural look - deterministic from nodeId
  const normal = new THREE.Vector3(
    (hash01(nodeId, 'leafNormalX') - 0.5) * 0.3,
    0.85 + hash01(nodeId, 'leafNormalY') * 0.15,
    (hash01(nodeId, 'leafNormalZ') - 0.5) * 0.3,
  ).normalize();

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

    // Compute radii using Murray's Law (r_parent^3 = sum(r_child_i^3))
    // Work bottom-up: leaves first, then parents
    const _computeRadii = (node: PlantNodeData): number => {
      const children = childrenMap.get(node.id) || [];
      if (children.length === 0) {
        // Leaf node - use server-provided radius
        return node.radius;
      }
      // Parent radius from Murray's law
      let sumCubed = 0;
      for (const child of children) {
        const childRadius = _computeRadii(child);
        sumCubed += childRadius ** 3;
      }
      return Math.cbrt(sumCubed);
    };

    // Store computed radii
    const computedRadii = new Map<string, number>();
    const assignRadii = (node: PlantNodeData): void => {
      const children = childrenMap.get(node.id) || [];
      if (children.length === 0) {
        computedRadii.set(node.id, node.radius);
      } else {
        let sumCubed = 0;
        for (const child of children) {
          assignRadii(child);
          const childRadius = computedRadii.get(child.id);
          if (childRadius !== undefined) {
            sumCubed += childRadius ** 3;
          }
        }
        const murrayRadius = Math.cbrt(sumCubed);
        // Use max of server radius and Murray's law radius so parent never shrinks
        // below its base thickness when gaining children, but can thicken with more children
        computedRadii.set(node.id, Math.max(node.radius, murrayRadius));
      }
    };
    assignRadii(root);

    // Check if this is a seed plant (first node is a seed that hasn't grown beyond cotyledon)
    const isSeedPlant = root.isSeed === true || root.nodeType === 'seed';

    if (isSeedPlant) {
      // Render botanical teardrop seed firmly resting on the ground surface
      const seedRadius = Math.max(0.07, Math.min(0.12, root.radius * 1.3));
      // Position seed center slightly above 0 so its rounded base penetrates into the soil
      // and its tapered apex points upright into the air without floating.
      const seedCenter = new THREE.Vector3(
        root.position.x,
        root.position.y + seedRadius * 0.25,
        root.position.z,
      );
      mesh.addSeed(seedCenter, seedRadius, packNode(plantIndex, 4, isOwn));
      box.expandByPoint(seedCenter.clone().add(new THREE.Vector3(0, seedRadius * 1.3, 0)));
      box.expandByPoint(seedCenter.clone().add(new THREE.Vector3(0, -seedRadius * 1.3, 0)));
    } else {
      // Normal plant with root - render seed coat base (crown at surface)
      // Only render the crown/junction at surface, NO underground root tubes
      const crownRadius =
        computedRadii.get(root.id) ?? Math.max(0.04, Math.min(0.07, root.radius * 0.45));
      const crownPos = new THREE.Vector3(root.position.x, root.position.y, root.position.z);
      mesh.addJoint(
        crownPos,
        crownRadius * 1.1,
        packNode(plantIndex, getVisualNodeType(root), isOwn),
      );
      box.expandByPoint(crownPos);
    }

    // Process all nodes in topological order (roots first, then children)
    const processNode = (node: PlantNodeData, depth = 0): void => {
      if (!node.parentId) return;

      const parent = allById.get(node.parentId);
      if (!parent) return;

      // Client-side growth animation: compute from spawnTime (0.9s smooth easing)
      const spawnTime = node.spawnTime ?? now - 5000;
      const elapsed = Math.max(0, now - spawnTime);
      const rawT = Math.min(1.0, elapsed / 900);
      const growthEase = rawT * rawT * (3.0 - 2.0 * rawT); // smoothstep
      if (growthEase < 0.02) return;

      // For a seed parent, attach from the base of the seed at ground level (y = 0)
      const parentAttachPos =
        parent.isSeed || parent.nodeType === 'seed'
          ? new THREE.Vector3(parent.position.x, 0, parent.position.z)
          : parent.position;

      const animatedPosition = parentAttachPos.clone().lerp(node.position, growthEase);
      const branch = new THREE.Vector3().subVectors(animatedPosition, parentAttachPos);
      if (branch.lengthSq() > 1e-8) {
        branch.normalize();

        // Get Murray's law radii
        const parentRadius = computedRadii.get(parent.id) ?? parent.radius;
        const nodeRadius = computedRadii.get(node.id) ?? node.radius;

        // Apply growth easing to radii for smooth emergence
        const rA = Math.max(0.015, parentRadius);
        const rB = Math.max(0.01, nodeRadius * Math.max(0.25, growthEase));

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
        mesh.addJoint(parentAttachPos, jointRadius, packNode(plantIndex, visualNodeType, isOwn));

        // Organic curvature with botanical gravitropism
        const length = parentAttachPos.distanceTo(animatedPosition);

        // Roots grow downward (gravitropism), stems grow upward (phototropism)
        const tropismStrength = isRoot ? 0.25 : 0.15; // Roots curve more naturally

        // Add subtle noise-based bend for organic feel
        const curvature = length * tropismStrength;
        const bendDir = new THREE.Vector3()
          .crossVectors(branch, new THREE.Vector3(0, 1, 0))
          .normalize();
        if (bendDir.lengthSq() < 1e-6) bendDir.set(1, 0, 0);

        // Add gravitropic bias: roots bend downward, stems bend slightly upward
        const gravityBias = isRoot ? -0.1 : 0.05;
        const controlPoint = parentAttachPos
          .clone()
          .add(animatedPosition)
          .multiplyScalar(0.5)
          .addScaledVector(bendDir, curvature * (hash01(node.id, 'bend') - 0.5) * 2)
          .addScaledVector(new THREE.Vector3(0, 1, 0), gravityBias * length);

        mesh.addCurvedTube(
          parentAttachPos,
          animatedPosition,
          controlPoint,
          rA,
          rB,
          tubeSides,
          packNode(plantIndex, visualNodeType, isOwn),
        );
      }

      box.expandByPoint(animatedPosition);
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
        animatedPosition.y > 0.25 &&
        nodeTypeNum >= 1 &&
        !isSeedNode &&
        growthEase > 0.15;

      if (isLeafNode && canGrowLeaves) {
        const direction = branch.lengthSq() > 1e-8 ? branch.clone() : new THREE.Vector3(0, 1, 0);
        const { normal } = leafDirection(direction, 0, 1, isCotyledon, node.id);
        // Flower and spore_sac get distinct visual types
        const leafVisualType = isFlower ? 5 : isSporeSac ? 6 : nodeVisualType;
        mesh.addLeaf(
          animatedPosition,
          direction,
          normal,
          options.leafSize * 0.85 * growthEase,
          packNode(plantIndex, leafVisualType, isOwn),
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
          );
          mesh.addLeaf(
            animatedPosition,
            leafDir,
            normal,
            options.leafSize * 0.75 * growthEase,
            packNode(plantIndex, 3, isOwn),
          );
          leafCount += 1;
        }
      }

      // Recursively process children
      const children = childrenMap.get(node.id) || [];
      for (const child of children) {
        processNode(child, depth + 1);
      }
    };

    // Start processing from root's children
    const rootChildren = childrenMap.get(root.id) || [];
    for (const child of rootChildren) {
      processNode(child);
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
          mesh.pushVertex(position, normal, side / ringSides, 0, packNode(plantIndex, 8, isOwn));
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
          mesh.pushVertex(position, normal, side / ringSides, 1, packNode(plantIndex, 8, isOwn));
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
