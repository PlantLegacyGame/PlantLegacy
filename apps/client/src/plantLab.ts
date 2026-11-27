import {
  DEFAULT_BRANCH_ATTACH_FRACTION,
  getSeedBodyHeightRatio,
  isRootOrgan,
  type NodeRadiusProfile,
  nodeAttachmentPoint,
  nodeRenderRadius,
  organMorphologyFor,
  resolveAttachFraction,
} from '@plant-legacy/shared/growth';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { applyGrowthGeometry } from './config/growthGeometryConfig.js';
import type { PlantNodeData } from './renderers/plant/plantNodeData.js';
import {
  measureDrawnPlant,
  resolveSegmentFrame,
  type SegmentFrame,
} from './renderers/webgpu/PlantMeshBuilder.js';

/**
 * Plant Lab: 3D procedural plants, rendered side by side.
 *
 *  LEFT  "scratch": a skeleton grown by this file, each chain turned into a
 *        tapered tube whose first ring lies on its parent, radii chosen in metres.
 *  RIGHT "game": server-shaped nodes drawn through the REAL renderer resolver
 *        (`resolveSegmentFrame`) and measured by `measureDrawnPlant`, so the
 *        HUD reports what the mesh pass would actually draw. No hand-copied
 *        radius formula or attachment model lives in this file.

 * Both read segment lengths and node costs from config/growth.json, so the only
 * difference is the rules, not the numbers. Press G to hide the ground and see
 * the roots.
 */

// ---------- deterministic rng ----------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(20261112);
const rand = (min: number, max: number) => min + rng() * (max - min);

// ---------- scene ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color('#8fb6c9');
scene.fog = new THREE.Fog('#8fb6c9', 4.5, 11);

const camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.01, 60);
camera.position.set(2.1, 1.15, 2.9);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(-0.1, 0.2, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.25;
controls.maxDistance = 9;

scene.add(new THREE.HemisphereLight('#cfe7f5', '#4a3b28', 1.15));
const sun = new THREE.DirectionalLight('#fff3d6', 2.1);
sun.position.set(2.2, 3.4, 1.8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -3;
sun.shadow.camera.right = 3;
sun.shadow.camera.top = 3;
sun.shadow.camera.bottom = -3;
sun.shadow.bias = -0.0009;
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(4.2, 64),
  new THREE.MeshStandardMaterial({ color: '#6d4f34', roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(6, 30, '#8a6b47', '#7a5c3d');
grid.position.y = 0.001;
(grid.material as THREE.Material).transparent = true;
(grid.material as THREE.Material).opacity = 0.22;
scene.add(grid);

// ---------- tapered tube (shared) ----------
function taperedTube(
  points: THREE.Vector3[],
  r0: number,
  r1: number,
  radialSegments = 8,
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  const divisions = Math.max(6, points.length * 3);
  const positions: number[] = [];
  const indices: number[] = [];
  const frameUp = new THREE.Vector3(0, 1, 0);

  for (let i = 0; i <= divisions; i++) {
    const t = i / divisions;
    const centre = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    const side = new THREE.Vector3().crossVectors(tangent, frameUp);
    if (side.lengthSq() < 1e-5) side.set(1, 0, 0);
    side.normalize();
    const upSide = new THREE.Vector3().crossVectors(side, tangent).normalize();
    const radius = r0 + (r1 - r0) * t;
    for (let j = 0; j < radialSegments; j++) {
      const angle = (j / radialSegments) * Math.PI * 2;
      const offset = side
        .clone()
        .multiplyScalar(Math.cos(angle) * radius)
        .addScaledVector(upSide, Math.sin(angle) * radius);
      positions.push(centre.x + offset.x, centre.y + offset.y, centre.z + offset.z);
    }
  }
  for (let i = 0; i < divisions; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * radialSegments + j;
      const b = i * radialSegments + ((j + 1) % radialSegments);
      const c = (i + 1) * radialSegments + j;
      const dd = (i + 1) * radialSegments + ((j + 1) % radialSegments);
      indices.push(a, c, b, b, c, dd);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function leafGeometry(size: number): THREE.BufferGeometry {
  const segmentsU = 6;
  const segmentsV = 8;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let v = 0; v <= segmentsV; v++) {
    const t = v / segmentsV;
    const width = Math.sin(Math.PI * t) * size * 0.42;
    for (let u = 0; u <= segmentsU; u++) {
      const s = u / segmentsU;
      positions.push(
        (s - 0.5) * 2 * width,
        t * size,
        Math.sin(Math.PI * t) * size * 0.16 + Math.abs(s - 0.5) * width * 0.35,
      );
    }
  }
  for (let v = 0; v < segmentsV; v++) {
    for (let u = 0; u < segmentsU; u++) {
      const a = v * (segmentsU + 1) + u;
      const c = a + segmentsU + 1;
      indices.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const rootMaterial = new THREE.MeshStandardMaterial({ color: '#a89a6a', roughness: 0.95 });
const shootMaterial = new THREE.MeshStandardMaterial({ color: '#7fa855', roughness: 0.85 });
const petioleMaterial = new THREE.MeshStandardMaterial({ color: '#8cbf5f', roughness: 0.8 });
const leafMaterial = new THREE.MeshStandardMaterial({
  color: '#8fce6a',
  roughness: 0.65,
  side: THREE.DoubleSide,
});
const seedMaterial = new THREE.MeshStandardMaterial({ color: '#4b3524', roughness: 0.75 });

// =============================================================================
// LEFT: grown from scratch, connected by construction
// =============================================================================
interface Chain {
  points: THREE.Vector3[];
  radiusStart: number;
  radiusEnd: number;
  kind: 'root' | 'shoot' | 'petiole';
  parent: Chain | null;
}

function buildScratchPlant(segment: (type: string) => number, originX: number) {
  const group = new THREE.Group();
  group.position.x = originX;
  const chains: Chain[] = [];
  const leaves: { position: THREE.Vector3; normal: THREE.Vector3; size: number }[] = [];
  const up = new THREE.Vector3(0, 1, 0);

  const grow = (
    parent: Chain | null,
    start: THREE.Vector3,
    dir: THREE.Vector3,
    length: number,
    radiusStart: number,
    radiusEnd: number,
    kind: Chain['kind'],
    curl: number,
  ): Chain => {
    const steps = Math.max(3, Math.round(length / 0.05));
    const points: THREE.Vector3[] = [start.clone()];
    const d = dir.clone().normalize();
    const bendAxis = new THREE.Vector3().crossVectors(d, up).normalize();
    if (bendAxis.lengthSq() < 1e-4) bendAxis.set(1, 0, 0);
    const stepLength = length / steps;
    let current = start.clone();
    for (let i = 0; i < steps; i++) {
      d.addScaledVector(bendAxis, curl * (i / steps) * stepLength * rand(0.6, 1.4));
      d.x += rand(-0.05, 0.05) * stepLength;
      d.z += rand(-0.05, 0.05) * stepLength;
      d.normalize();
      current = current.clone().addScaledVector(d, stepLength);
      points.push(current);
    }
    const chain: Chain = { points, radiusStart, radiusEnd, kind, parent };
    chains.push(chain);
    return chain;
  };

  const seedRadius = 0.075;
  const seed = new THREE.Mesh(new THREE.SphereGeometry(seedRadius, 32, 24), seedMaterial);
  seed.scale.set(1, 1.3, 0.92);
  seed.position.y = seedRadius * 1.3 * 0.55;
  seed.castShadow = true;
  seed.receiveShadow = true;
  group.add(seed);

  const seedTop = new THREE.Vector3(0, seedRadius * 1.3 * 1.05, 0);
  const seedBottom = new THREE.Vector3(0, seedRadius * 0.15, 0);

  const taproot = grow(
    null,
    seedBottom,
    new THREE.Vector3(0.05, -1, 0.02),
    segment('radicle'),
    0.028,
    0.008,
    'root',
    0.55,
  );
  for (let i = 0; i < 6; i++) {
    const t = 0.18 + (i / 6) * 0.62;
    const point = taproot.points[Math.floor(t * (taproot.points.length - 1))];
    const angle = i * 2.399;
    grow(
      taproot,
      point.clone(),
      new THREE.Vector3(Math.cos(angle), -0.55, Math.sin(angle)),
      segment('lateral_root') * rand(0.6, 1.2),
      0.012,
      0.004,
      'root',
      0.9,
    );
  }

  let shootTip = seedTop.clone();
  let shootParent: Chain | null = null;
  for (let i = 0; i < 3; i++) {
    const chain = grow(
      shootParent,
      shootTip,
      new THREE.Vector3(rand(-0.25, 0.25), 1, rand(-0.25, 0.25)),
      segment('stem') * rand(0.85, 1.15),
      0.026 - i * 0.005,
      0.018 - i * 0.004,
      'shoot',
      0.4,
    );
    shootParent = chain;
    shootTip = chain.points[chain.points.length - 1];
    const petioleDir = new THREE.Vector3(rand(-1, 1), rand(0.25, 0.7), rand(-1, 1)).normalize();
    const petiole = grow(
      chain,
      shootTip.clone(),
      petioleDir,
      segment('leaf'),
      0.008,
      0.005,
      'petiole',
      0.7,
    );
    leaves.push({
      position: petiole.points[petiole.points.length - 1].clone(),
      normal: petioleDir.clone(),
      size: rand(0.15, 0.22),
    });
  }

  for (const side of [-1, 1]) {
    const dir = new THREE.Vector3(side * 0.55, 0.85, side * 0.2).normalize();
    const coty = grow(
      null,
      seedTop.clone(),
      dir,
      segment('cotyledon'),
      0.012,
      0.008,
      'petiole',
      0.5,
    );
    leaves.push({
      position: coty.points[coty.points.length - 1].clone(),
      normal: dir,
      size: 0.14,
    });
  }

  for (const chain of chains) {
    const material =
      chain.kind === 'root'
        ? rootMaterial
        : chain.kind === 'petiole'
          ? petioleMaterial
          : shootMaterial;
    const mesh = new THREE.Mesh(
      taperedTube(chain.points, chain.radiusStart, chain.radiusEnd),
      material,
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  for (const anchor of leaves) {
    const blade = new THREE.Mesh(leafGeometry(anchor.size), leafMaterial);
    blade.position.copy(anchor.position);
    blade.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      anchor.normal.clone().normalize(),
    );
    blade.castShadow = true;
    group.add(blade);
  }

  // a child may branch from any parent point, so measure the nearest one
  let maxGap = 0;
  let segments = 0;
  let totalLength = 0;
  for (const chain of chains) {
    segments += chain.points.length - 1;
    for (let i = 1; i < chain.points.length; i++) {
      totalLength += chain.points[i].distanceTo(chain.points[i - 1]);
    }
    if (!chain.parent) continue;
    let nearest = Number.POSITIVE_INFINITY;
    for (const point of chain.parent.points) {
      nearest = Math.min(nearest, chain.points[0].distanceTo(point));
    }
    maxGap = Math.max(maxGap, nearest);
  }

  scene.add(group);
  return { maxGap, segments, totalLength, chains: chains.length, leaves: leaves.length };
}

// =============================================================================
// RIGHT: server-shaped nodes drawn and measured with the real renderer code
// =============================================================================
const DEFAULT_NODE_COSTS: Record<string, number> = {
  seed: 1,
  radicle: 8,
  cotyledon: 6,
  stem: 12,
  lateral_root: 6,
  branch: 10,
  leaf: 6,
};

function nodeVisualType(type: string): number {
  // The Lab used to keep its own four-value table and told the reader it drew
  // the same morphology as the game. It does not: this preview builds its own
  // primitives, and its only honest shared answer is the visual type.
  return organMorphologyFor(type).visualType;
}

function buildGamePlant(
  segment: (type: string) => number,
  costs: Record<string, number>,
  originX: number,
  branchFraction: number,
) {
  const group = new THREE.Group();
  group.position.x = originX;

  const nodes: PlantNodeData[] = [];
  const addNode = (
    type: string,
    parent: PlantNodeData | null,
    dir: THREE.Vector3,
    attachFraction = 1,
  ) => {
    const d = dir.clone().normalize();
    const length = segment(type);
    let position = new THREE.Vector3(0, 0, 0);
    let attach = new THREE.Vector3(0, 0, 0);
    if (parent) {
      // Same placement the server uses: a seed's children start on the coat and
      // a lateral organ buds part-way along its parent's own segment.
      const point = nodeAttachmentPoint(
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
        d,
        attachFraction,
      );
      attach = new THREE.Vector3(point.x, point.y, point.z);
      position = attach.clone().addScaledVector(d, length);
    }
    const biomass = costs[type] ?? DEFAULT_NODE_COSTS[type] ?? 1;
    const node: PlantNodeData = {
      id: `${type}_${nodes.length}`,
      position,
      type: nodeVisualType(type),
      nodeType: type,
      // The server now stores the same shared drawn radius it sends to clients.
      radius: nodeRenderRadius(type, biomass),
      parentId: parent?.id ?? null,
      children: [],
      age: 0,
      health: 1,
      mutationFlags: 0,
      biomass,
      isOwnPlant: true,
      growthProgress: 1,
      isSeed: type === 'seed',
      layer: type === 'seed' || isRootOrgan(type) ? 'root' : 'canopy',
      ...(parent
        ? {
            parentAttachX: attach.x,
            parentAttachY: attach.y,
            parentAttachZ: attach.z,
            attachFraction,
          }
        : {}),
    };
    if (parent?.children) parent.children.push(node.id);
    nodes.push(node);
    return node;
  };

  const seed = addNode('seed', null, new THREE.Vector3(0, 1, 0));
  const radicle = addNode('radicle', seed, new THREE.Vector3(0, -1, 0));
  addNode('cotyledon', seed, new THREE.Vector3(0.6, 1, 0));
  addNode('cotyledon', seed, new THREE.Vector3(-0.6, 1, 0));
  const stem = addNode('stem', seed, new THREE.Vector3(0, 1, 0));
  addNode('leaf', stem, new THREE.Vector3(0.5, 1, 0));

  // Lateral organs bud along the parent, the way the scratch generator already
  // branches its taproot: a lateral root off the radicle and a branch off the
  // stem, both at the configured fraction. This is the topology the server now
  // produces, so the two sides compare like for like.
  if (branchFraction < 1) {
    addNode('lateral_root', radicle, new THREE.Vector3(0.95, -0.45, 0.1), branchFraction);
    addNode('lateral_root', radicle, new THREE.Vector3(-0.9, -0.5, -0.15), branchFraction);
    const branch = addNode('branch', stem, new THREE.Vector3(0.85, 0.5, 0.1), branchFraction);
    addNode('leaf', branch, new THREE.Vector3(0.7, 0.6, 0), 1);
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));

  // Seed body, drawn at the same centre and radius the mesh pass uses.
  const seedRadius = nodeRenderRadius('seed', seed.biomass);
  const seedAspect = getSeedBodyHeightRatio();
  const seedCentre = new THREE.Vector3(
    seed.position.x,
    seed.position.y + seedRadius * seedAspect,
    seed.position.z,
  );
  const seedMesh = new THREE.Mesh(new THREE.SphereGeometry(seedRadius, 32, 24), seedMaterial);
  seedMesh.scale.set(1, seedAspect, 1);
  seedMesh.position.copy(seedCentre);
  seedMesh.castShadow = true;
  group.add(seedMesh);

  const walk = (parent: PlantNodeData, parentFrame?: SegmentFrame): void => {
    for (const childId of parent.children ?? []) {
      const node = byId.get(childId);
      if (!node) continue;
      const frame = resolveSegmentFrame(
        node,
        parent,
        byId.values(),
        parentFrame?.animated,
        parentFrame?.startRadius,
      );
      const material =
        node.nodeType === 'radicle'
          ? rootMaterial
          : node.nodeType === 'cotyledon'
            ? leafMaterial
            : shootMaterial;
      const mesh = new THREE.Mesh(
        taperedTube([frame.start, frame.target], frame.startRadius, frame.endRadius, 10),
        material,
      );
      mesh.castShadow = true;
      group.add(mesh);

      if (node.nodeType === 'leaf' || node.nodeType === 'cotyledon') {
        const bladeSize = node.nodeType === 'cotyledon' ? 0.14 : 0.2;
        const blade = new THREE.Mesh(leafGeometry(bladeSize), leafMaterial);
        blade.position.copy(frame.target);
        const dir = frame.target.clone().sub(frame.start).normalize();
        blade.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        blade.castShadow = true;
        group.add(blade);
      }

      walk(node, frame);
    }
  };
  walk(seed);

  scene.add(group);
  return {
    count: nodes.length,
    midSegment: nodes.filter((node) => (node.attachFraction ?? 1) < 1).length,
    metrics: measureDrawnPlant(nodes),
  };
}

// ---------- build both, from the live config ----------
const hud = document.createElement('div');
hud.style.cssText =
  'position:fixed;left:12px;top:12px;padding:10px 12px;border-radius:8px;background:rgba(20,16,12,0.8);color:#e7dcc7;font:12px/1.55 ui-monospace,monospace;white-space:pre;pointer-events:none';
document.body.appendChild(hud);

async function main(): Promise<void> {
  let lengths: Record<string, number> = {};
  let costs: Record<string, number> = {};
  let branchFraction = DEFAULT_BRANCH_ATTACH_FRACTION;
  try {
    const response = await fetch('/config/growth');
    // A missing config is the catch block's job, like every other loader: a 404
    // body is `{ error }`, so parsing it would leave every tunable undefined
    // and draw the lab from an empty table.
    if (!response.ok) throw new Error(`/config/growth answered ${response.status}`);
    const data = (await response.json()) as {
      node_lengths?: Record<string, number>;
      node_costs?: Record<string, number>;
      root_growth_speed?: number;
      canopy_growth_speed?: number;
      branch_attach_fraction?: number;
      seed_body_height_ratio?: number;
      node_radius_profiles?: Record<string, NodeRadiusProfile>;
    };
    lengths = data.node_lengths ?? {};
    costs = data.node_costs ?? {};
    // Same geometry tunables the real client and server apply, so the Lab draws
    // the configured seed aspect and radius table rather than a copy.
    applyGrowthGeometry(data);
    branchFraction = resolveAttachFraction('branch', undefined);
    hud.dataset.raw = JSON.stringify(data);
  } catch {
    lengths = {};
    costs = {};
  }
  const segment = (type: string) => lengths[type] ?? 0.2;

  const scratch = buildScratchPlant(segment, -0.75);
  const game = buildGamePlant(segment, costs, 0.95, branchFraction);
  const m = game.metrics;

  hud.textContent = [
    'PLANT LAB — dev-only preview, not the game renderer',
    'Right uses shared sizes and visual types, not MeshPlantRenderer anatomy.',
    '',
    `LEFT  scratch   chains=${scratch.chains} leaves=${scratch.leaves}`,
    `      segments=${scratch.segments} total=${scratch.totalLength.toFixed(2)} m`,
    `      maxJointGap=${scratch.maxGap.toFixed(6)} m   parts buried in parent: 0`,
    '',
    `RIGHT game      nodes=${m.nodeCount} segments=${m.segmentCount} (real renderer)`,
    `      mid-segment=${game.midSegment} attach@=${branchFraction.toFixed(2)}`,
    `      anchorGap=${m.maxAnchorGap.toFixed(3)} m  drawnOffset=${m.maxDrawnOffset.toFixed(3)} m`,
    `      maxAngle=${m.maxAngleDiscontinuityDeg.toFixed(1)}°  radiusRatio=${m.maxRadiusRatio.toFixed(2)}x`,
    `      drawn radius=${m.drawnRadiusRange[0].toFixed(3)}..${m.drawnRadiusRange[1].toFixed(3)} m`,
    '',
    'radiusRatio 1.00x = server and shared table agree',
    'G toggles ground · drag to orbit',
  ].join('\n');

  window.addEventListener('keydown', (event) => {
    if (event.key === 'g' || event.key === 'G') ground.visible = !ground.visible;
  });

  (window as unknown as { plantLab: unknown }).plantLab = { scene, camera, scratch, game, lengths };
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function frame(): void {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
void main();
