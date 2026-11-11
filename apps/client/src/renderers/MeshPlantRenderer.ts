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
import * as THREE from 'three';
import type { PlantNodeData } from './PlantRenderer.js';

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

const TUBE_RADIAL_SEGMENTS = 8;
const TUBE_LENGTH_SEGMENTS = 6;
const LEAF_SEGMENTS = 4;
const JOINT_SPHERE_SEGMENTS = 8;
const MAX_LEAVES_PER_NODE = 6;

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

function getMaterial(nodeType: string): THREE.MeshStandardMaterial {
  switch (nodeType) {
    case 'root':
    case 'radicle':
    case 'lateral_root':
      return rootMaterial;
    case 'leaf':
    case 'cotyledon':
      return leafMaterial;
    default:
      return barkMaterial;
  }
}

function buildTubeGeometry(r0: number, r1: number, length: number): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(
    r0,
    r1,
    length,
    TUBE_RADIAL_SEGMENTS,
    TUBE_LENGTH_SEGMENTS,
    true,
  );
  geo.rotateX(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

export class MeshPlantRenderer {
  private scene: THREE.Scene;
  private meshGroup = new THREE.Group();
  private nodeMap = new Map<string, MeshNode>();
  private childrenMap = new Map<string, string[]>();
  private segments = new Map<string, MeshSegmentData>();
  private structureDirty = true;

  constructor(scene: THREE.Scene) {
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

    // Build segments for nodes with parents
    for (const [id, node] of this.nodeMap) {
      if (!node.parentId || !this.nodeMap.has(node.parentId)) continue;
      if (this.segments.has(id)) continue;

      const parent = this.nodeMap.get(node.parentId);
      if (!parent) continue;
      const children = this.childrenMap.get(node.id) ?? [];

      // Murray's law taper
      const taperedRadius = this.murrayTaper(parent.radius, Math.max(1, children.length));

      // Determine segment end (target if growing)
      const segmentEnd = node.targetPosition ?? node.position.clone();

      const dir = new THREE.Vector3().subVectors(segmentEnd, parent.position);
      const length = dir.length();
      if (length < 0.001) continue;

      const geo = buildTubeGeometry(parent.radius, taperedRadius, length);
      const mat = getMaterial(node.nodeType);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(parent.position);
      if (length > 0.001) {
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.clone().normalize());
      }

      // Joint sphere at segment end
      let jointMesh: THREE.Mesh | null = null;
      if (taperedRadius > 0.02) {
        const jointGeo = new THREE.SphereGeometry(
          taperedRadius,
          JOINT_SPHERE_SEGMENTS,
          JOINT_SPHERE_SEGMENTS,
        );
        jointMesh = new THREE.Mesh(jointGeo, mat);
        jointMesh.position.copy(segmentEnd);
        this.meshGroup.add(jointMesh);
      }

      // Leaves for canopy nodes
      const leafMeshes: THREE.Mesh[] = [];
      if (node.nodeType === 'leaf' || node.nodeType === 'cotyledon' || node.nodeType === 'stem') {
        const leafCount = Math.min(MAX_LEAVES_PER_NODE, Math.max(1, Math.floor(node.biomass / 2)));
        for (let i = 0; i < leafCount; i++) {
          const leafGeo = new THREE.PlaneGeometry(
            node.radius * 0.8,
            node.radius * 1.2,
            LEAF_SEGMENTS,
            LEAF_SEGMENTS,
          );
          const leafMat = getMaterial('leaf');
          const leaf = new THREE.Mesh(leafGeo, leafMat);
          const angle = (i / Math.max(1, leafCount)) * Math.PI * 2;
          const leafPos = segmentEnd.clone().addScaledVector(dir.clone().normalize(), length * 0.5);
          leafPos.applyAxisAngle(dir.clone().normalize(), angle);
          leafPos.addScaledVector(
            new THREE.Vector3(0, 1, 0).cross(dir.clone().normalize()),
            node.radius * 0.5,
          );
          leaf.position.copy(leafPos);
          leaf.lookAt(parent.position);
          leaf.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), angle);
          this.meshGroup.add(leaf);
          leafMeshes.push(leaf);
        }
      }

      this.meshGroup.add(mesh);
      this.segments.set(id, {
        p0: parent.position.clone(),
        p1: segmentEnd.clone(),
        r0: parent.radius,
        r1: taperedRadius,
        nodeType: node.nodeType,
        isOwnPlant: node.isOwnPlant,
        growthProgress: node.growthProgress ?? 1.0,
        mesh,
        jointMesh,
        leafMeshes,
        parentPosition: parent.position.clone(),
        targetPosition: segmentEnd.clone(),
        originalRadius0: parent.radius,
        originalRadius1: taperedRadius,
        originalLength: length,
      });
    }

    this.structureDirty = false;
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
      // Animate growth progress toward target
      currentProgress = THREE.MathUtils.lerp(currentProgress, targetProgress, deltaTime * 5);
      if (Math.abs(currentProgress - targetProgress) < 0.001) currentProgress = targetProgress;
      seg.growthProgress = currentProgress;

      if (currentProgress < 1.0) {
        // Interpolate between parent and target
        const p0 = seg.parentPosition;
        const p1 = seg.targetPosition;
        const currentEnd = new THREE.Vector3().lerpVectors(p0, p1, currentProgress);
        const dir = new THREE.Vector3().subVectors(currentEnd, p0);
        const length = dir.length();

        // Update geometry in-place
        const newGeo = buildTubeGeometry(
          seg.originalRadius0,
          seg.originalRadius1 * currentProgress,
          length,
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

        // Update leaves
        const leafDir = dir.clone().normalize();
        for (let i = 0; i < seg.leafMeshes.length; i++) {
          const leaf = seg.leafMeshes[i];
          const angle = (i / Math.max(1, seg.leafMeshes.length)) * Math.PI * 2;
          const leafPos = currentEnd.clone().addScaledVector(leafDir, length * 0.5);
          leafPos.applyAxisAngle(leafDir, angle);
          leafPos.addScaledVector(
            new THREE.Vector3(0, 1, 0).cross(leafDir),
            seg.r1 * currentProgress * 0.5,
          );
          leaf.position.copy(leafPos);
          leaf.lookAt(p0);
          leaf.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), angle);
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
    this.meshGroup.clear();
    this.scene.remove(this.meshGroup);
    this.nodeMap.clear();
    this.childrenMap.clear();
    this.segments.clear();
  }
}
