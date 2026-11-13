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
import * as THREE from 'three';
import type { PlantNodeData } from './PlantRenderer.js';
import { segmentStartFor } from './plant/segmentStart.js';

interface MeshNode {
  id: string;
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
  // Animated target position for connected growth
  targetPosition?: THREE.Vector3;
  parentAttachPosition?: THREE.Vector3;
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
  parentPosition: THREE.Vector3;
  targetPosition: THREE.Vector3;
  originalRadius0: number;
  originalRadius1: number;
  originalLength: number;
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

// Material cache shared across instances
const barkMaterial: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
  color: 0x3d2b1f,
  roughness: 0.8,
  metalness: 0.1,
  flatShading: false,
});
const rootMaterial: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
  color: 0x2d1b15,
  roughness: 0.85,
  metalness: 0.05,
  flatShading: false,
});
const leafMaterial: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
  color: 0x4a7c59,
  roughness: 0.7,
  metalness: 0.0,
  flatShading: false,
  side: THREE.DoubleSide,
});

const seedMaterial: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
  color: 0x8a6d4d,
  roughness: 0.9,
  metalness: 0.0,
  flatShading: false,
});

function getMaterial(nodeType: string): THREE.MeshStandardMaterial {
  switch (nodeType) {
    case 'root':
    case 'radicle':
    case 'lateral_root':
      return rootMaterial;
    case 'leaf':
    case 'cotyledon':
      return leafMaterial;
    case 'seed':
      return seedMaterial;
    default:
      return barkMaterial;
  }
}

/**
 * Drawn radius of a part, in metres.
 *
 * The server already stores the drawn radius (`resolveDrawnRadius` in
 * packages/shared/growth), and the SDF and WebGPU paths both read it from there.
 * This path used to apply a fourth, independent multiplier-and-clamp table, so
 * the mesh plant was a different thickness from the same plant on either other
 * renderer. One table, one plant.
 */
function visualRadius(nodeType: string, serverRadius: number, biomass?: number): number {
  return resolveDrawnRadius(nodeType, serverRadius, biomass);
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
): THREE.BufferGeometry {
  const key = tubeGeometryCacheKey(r0, r1, length, quality);
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
    geo.rotateX(Math.PI / 2);
    geo.computeVertexNormals();
    tubeGeometryCache.set(key, geo);
  }
  return geo;
}

export class MeshPlantRenderer {
  private scene: THREE.Scene;
  private meshGroup = new THREE.Group();
  private nodeMap = new Map<string, MeshNode>();
  private childrenMap = new Map<string, string[]>();
  private segments = new Map<string, MeshSegmentData>();
  private seedMeshes = new Map<string, THREE.Mesh>();
  private structureDirty = true;
  private readonly quality: MeshQualityConfig;

  constructor(scene: THREE.Scene, quality: Partial<MeshQualityConfig> = {}) {
    this.quality = { ...DEFAULT_MESH_QUALITY, ...quality };
    this.scene = scene;
    this.scene.add(this.meshGroup);
    this.meshGroup.visible = false;
  }

  updatePlantData(nodes: PlantNodeData[]): void {
    this.nodeMap.clear();
    this.childrenMap.clear();

    for (const n of nodes) {
      const node: MeshNode = {
        id: n.id,
        position: n.position.clone(),
        radius: n.radius,
        nodeType: n.nodeType ?? 'stem',
        parentId: n.parentId,
        children: n.children ?? [],
        biomass: n.biomass ?? 0,
        health: n.health ?? 0.5,
        isOwnPlant: n.isOwnPlant ?? true,
        growthProgress: n.growthProgress ?? 1.0,
        spawnTime: n.spawnTime ?? 0,
      };
      if (
        n.targetX !== undefined &&
        n.targetY !== undefined &&
        n.targetZ !== undefined &&
        n.growthProgress !== undefined &&
        n.growthProgress < 1.0
      ) {
        node.targetPosition = new THREE.Vector3(n.targetX, n.targetY, n.targetZ);
        node.parentAttachPosition = new THREE.Vector3(
          n.parentAttachX ?? n.position.x,
          n.parentAttachY ?? n.position.y,
          n.parentAttachZ ?? n.position.z,
        );
      }
      this.nodeMap.set(n.id, node);
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

  private rebuildIfNeeded(): void {
    if (!this.structureDirty) return;

    // Remove segments whose nodes no longer exist
    for (const [id, seg] of this.segments) {
      if (!this.nodeMap.has(id)) {
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
      if (this.seedMeshes.has(id)) continue;
      const radius = visualRadius('seed', node.radius, node.biomass);
      const geo = new THREE.SphereGeometry(radius, 20, 14);
      const mat = getMaterial('seed');
      const mesh = new THREE.Mesh(geo, mat);
      // Slightly ovoid: a little taller than wide and flattened front-to-back.
      // The vertical scale is the shared seed aspect, so this ovoid is the same
      // shape and height as the one the WebGPU pass builds.
      mesh.scale.set(0.95, getSeedBodyHeightRatio(), 0.85);
      // Sit the rounded base on the ground: the stored y is the contact point,
      // not the centre.
      mesh.position.set(node.position.x, seedBodyCentreY(node.position.y, radius), node.position.z);
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
      if (this.segments.has(id)) continue;

      const parent = this.nodeMap.get(node.parentId);
      if (!parent) continue;
      const children = this.childrenMap.get(node.id) ?? [];

      // Murray's law taper (server radii), converted to visual radii below.
      const taperedServerRadius = this.murrayTaper(parent.radius, Math.max(1, children.length));

      // Determine segment end (target if growing)
      const segmentEnd = node.targetPosition ?? node.position.clone();

      const parentVisualRadius = visualRadius(parent.nodeType, parent.radius, parent.biomass);
      let tubeStartRadius = parentVisualRadius;
      let tubeEndRadius = visualRadius(node.nodeType, taperedServerRadius, node.biomass);
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

      // Start on the parent where the server attached this node. For a lateral
      // bud that is part-way along the parent's segment, and without it the bud
      // drew its tube from the parent's tip; for a seed it is out on the coat,
      // with upward growth leaving the coat's top and downward growth the buried
      // base. `node.parentAttachPosition` is already in draw space.
      const start = segmentStartFor({
        attach: node.parentAttachPosition,
        parentPosition: parent.position,
        seedCoatTopY:
          parent.nodeType === 'seed'
            ? parent.position.y + seedBodyHalfHeight(parentVisualRadius) * 2
            : undefined,
        growsUp: segmentEnd.y > parent.position.y,
      });
      const segmentStart = new THREE.Vector3(start.x, start.y, start.z);

      const dir = new THREE.Vector3().subVectors(segmentEnd, segmentStart);
      const length = dir.length();
      if (length < 0.001) continue;

      const geo = buildTubeGeometry(tubeStartRadius, tubeEndRadius, length, this.quality);
      const mat = getMaterial(node.nodeType);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(segmentStart);
      if (length > 0.001) {
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.clone().normalize());
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
        const leafSize = isCotyledon
          ? THREE.MathUtils.clamp(parentVisualRadius * 2.6, 0.14, this.quality.maxLeafSize)
          : THREE.MathUtils.clamp(
              visualRadius(node.nodeType, node.radius, node.biomass) * 8,
              0.08,
              this.quality.maxLeafSize,
            );
        const leafCount = isCotyledon
          ? 1
          : Math.min(this.quality.maxLeavesPerNode, Math.max(1, Math.floor(node.biomass / 3)));
        const axis = dir.clone().normalize();
        for (let i = 0; i < leafCount; i++) {
          const leafGeo = new THREE.PlaneGeometry(
            leafSize * 0.7,
            leafSize,
            this.quality.leafSegments,
            this.quality.leafSegments,
          );
          const leaf = new THREE.Mesh(leafGeo, getMaterial(node.nodeType));
          const angle = (i / Math.max(1, leafCount)) * Math.PI * 2;
          this.placeLeaf(leaf, segmentEnd, axis, angle, isCotyledon);
          this.meshGroup.add(leaf);
          leafMeshes.push(leaf);
        }
      }

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
        parentPosition: segmentStart.clone(),
        targetPosition: segmentEnd.clone(),
        originalRadius0: tubeStartRadius,
        originalRadius1: tubeEndRadius,
        originalLength: length,
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

    // Cotyledons open like seed leaves: broad blades roughly facing the sky.
    // True leaves splay their faces around the shoot axis.
    let normal: THREE.Vector3;
    if (isCotyledon) {
      normal = new THREE.Vector3(0, 1, 0);
    } else {
      normal = new THREE.Vector3().crossVectors(safeAxis, new THREE.Vector3(0, 1, 0));
      if (normal.lengthSq() < 1e-4) normal.set(1, 0, 0);
    }
    normal.normalize().applyAxisAngle(safeAxis, angle);

    leaf.position.copy(tip);
    leaf.lookAt(tip.clone().add(normal));
    // Tip the blade up a little so it catches light rather than lying dead flat.
    leaf.rotateX(-0.3);
  }

  private murrayTaper(parentRadius: number, totalChildren: number): number {
    if (totalChildren <= 1) return parentRadius * 0.85;
    const childRadius = parentRadius / totalChildren ** (1 / 3);
    return childRadius;
  }

  updateGrowth(deltaTime: number): void {
    let needsUpdate = false;

    for (const [id, seg] of this.segments) {
      const node = this.nodeMap.get(id);
      if (!node) continue;

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
        );
        seg.mesh.geometry.dispose();
        seg.mesh.geometry = newGeo;
        seg.mesh.position.copy(p0);
        if (length > 0.001) {
          seg.mesh.quaternion.setFromUnitVectors(
            new THREE.Vector3(1, 0, 0),
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
          leaf.scale.setScalar(0.35 + 0.65 * eased);
        }

        needsUpdate = true;
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
