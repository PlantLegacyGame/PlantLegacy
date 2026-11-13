/**
 * Builds the GPU description of a plant from server nodes.
 *
 * Two jobs, both pure: turn the node graph into segments/nodes with drawn
 * thickness, and flatten them into the RGBA float texels the raymarch shader
 * reads. Keeping the packing out of the renderer means the wire layout in
 * `sdfShaders.ts` has exactly one producer, and a mismatch between the two is a
 * single place to look.
 */
import * as THREE from 'three';
import type { PlantNodeData } from './plantNodeData.js';
import {
  calculateMurrayTaper,
  getNodeColor,
  getNodeTypeString,
  getSDFPrimitive,
  nodeTypeToSdfCode,
  seedBodyLift,
  visualRadius,
} from './sdfNodeVisuals.js';

/** One tapered segment between a parent and a child, ready for upload. */
export interface SDFSegment {
  p0: THREE.Vector3;
  p1: THREE.Vector3;
  r0: number;
  r1: number;
  primitive: number;
  color: THREE.Vector3;
  growthProgress: number;
  spawnTime: number;
  nodeType: string;
  layer: number;
  isOwnPlant: boolean;
}

/** One joint/endpoint sphere, ready for upload. */
export interface SDFNode {
  position: THREE.Vector3;
  radius: number;
  primitive: number;
  color: THREE.Vector3;
  growthProgress: number;
  spawnTime: number;
  nodeType: string;
  layer: number;
  isOwnPlant: boolean;
  /** Numeric node-type code passed to the shader so seeds render as teardrops. */
  nodeTypeCode: number;
}

export interface SDFGeometry {
  segments: SDFSegment[];
  nodes: SDFNode[];
  /** Centre of the drawn plant, used for LOD distance. */
  center: THREE.Vector3;
}

/** Texels (vec4s) the shader expects per segment and per node. */
export const SEGMENT_TEXELS = 7;
export const NODE_TEXELS = 4;

/**
 * Turn the received node graph into drawable segments and joints.
 *
 * Only the player's own plant is drawn today. New growth is drawn from the
 * parent toward the server-authoritative target position, so a growing node is
 * a connector from its parent rather than a zero-length blob at the parent.
 */
export function buildSdfGeometry(allNodes: PlantNodeData[]): SDFGeometry {
  const segments: SDFSegment[] = [];
  const sdfNodes: SDFNode[] = [];

  const nodeMap = new Map<string, PlantNodeData>();
  const childrenMap = new Map<string, string[]>();

  for (const node of allNodes) {
    if (!node.isOwnPlant) continue;
    nodeMap.set(node.id, node);
    if (node.parentId) {
      const children = childrenMap.get(node.parentId) ?? [];
      children.push(node.id);
      childrenMap.set(node.parentId, children);
    }
  }

  for (const node of allNodes) {
    if (!node.isOwnPlant) continue;
    if ((node.growthProgress ?? 1.0) < 0.001) continue;

    const nodeType = getNodeTypeString(node);
    const primitive = getSDFPrimitive(nodeType);
    const color = getNodeColor(nodeType, node.health);

    // The seed's ovoid SDF extends below its center, so lift it until the
    // rounded base sits on the ground (y = 0) instead of buried in the soil.
    const nodePos = node.position.clone();
    if (nodeType === 'seed' || node.isSeed) {
      nodePos.y += seedBodyLift(nodeType, node.radius);
    }

    sdfNodes.push({
      position: nodePos,
      radius: node.radius,
      primitive,
      color,
      growthProgress: node.growthProgress ?? 1.0,
      spawnTime: node.spawnTime ?? 0,
      nodeType,
      layer: node.layer === 'canopy' ? 1 : 0,
      isOwnPlant: node.isOwnPlant ?? true,
      nodeTypeCode: nodeTypeToSdfCode(nodeType),
    });

    if (!node.parentId) continue;
    const parent = nodeMap.get(node.parentId);
    if (!parent) continue;

    const children = childrenMap.get(node.id) ?? [];
    const childIndex = children.indexOf(node.id);
    const taperedRadius = calculateMurrayTaper(
      parent.radius,
      childIndex,
      Math.max(1, children.length),
    );

    const hasTarget =
      node.targetX !== undefined && node.targetY !== undefined && node.targetZ !== undefined;
    const segmentEnd = hasTarget
      ? new THREE.Vector3(node.targetX, node.targetY, node.targetZ)
      : node.position.clone();

    // Growth from a seed emerges realistically: the radicle/root exits the
    // heavy base into the soil (down), while the shoot/cotyledon exits the
    // pointed tip toward the sky (up).
    const segmentStart = parent.position.clone();
    const parentType = getNodeTypeString(parent);
    if (parentType === 'seed') {
      const toEnd = new THREE.Vector3().subVectors(segmentEnd, parent.position);
      segmentStart.y =
        toEnd.y <= 0
          ? parent.position.y
          : parent.position.y + visualRadius(parentType, parent.radius) * 2.0;
    }

    segments.push({
      p0: segmentStart,
      p1: segmentEnd,
      r0: visualRadius(parentType, parent.radius),
      r1: visualRadius(nodeType, taperedRadius),
      primitive,
      color,
      growthProgress: Math.min(parent.growthProgress ?? 1.0, node.growthProgress ?? 1.0),
      spawnTime: Math.max(parent.spawnTime ?? 0, node.spawnTime ?? 0),
      nodeType,
      layer: node.layer === 'canopy' ? 1 : 0,
      isOwnPlant: node.isOwnPlant ?? true,
    });
  }

  // Centre of the drawn plant: LOD is a distance to the organism, not to the
  // world origin, so a plant far from spawn still picks the right LOD.
  const bounds = new THREE.Box3();
  for (const node of sdfNodes) bounds.expandByPoint(node.position);
  const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());

  return { segments, nodes: sdfNodes, center };
}

/**
 * Flatten segments into the shader's 7-vec4-per-segment layout:
 *
 * ```
 * 0: p0.xyz, r0
 * 1: p1.xyz, r1
 * 2: color.rgb, primitive
 * 3: growthProgress, spawnTime, layer, isOwnPlant
 * 4: dir.xyz, nodeTypeLength   (dir = normalised p1 - p0, for wind)
 * 5-6: reserved
 * ```
 */
export function packSegments(segments: readonly SDFSegment[]): Float32Array {
  const data = new Float32Array(Math.max(1, segments.length * SEGMENT_TEXELS) * 4);

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const base = i * SEGMENT_TEXELS * 4;

    data[base + 0] = s.p0.x;
    data[base + 1] = s.p0.y;
    data[base + 2] = s.p0.z;
    data[base + 3] = s.r0;

    data[base + 4] = s.p1.x;
    data[base + 5] = s.p1.y;
    data[base + 6] = s.p1.z;
    data[base + 7] = s.r1;

    data[base + 8] = s.color.x;
    data[base + 9] = s.color.y;
    data[base + 10] = s.color.z;
    data[base + 11] = s.primitive;

    data[base + 12] = s.growthProgress;
    data[base + 13] = s.spawnTime;
    data[base + 14] = s.layer;
    data[base + 15] = s.isOwnPlant ? 1.0 : 0.0;

    const dx = s.p1.x - s.p0.x;
    const dy = s.p1.y - s.p0.y;
    const dz = s.p1.z - s.p0.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1.0;
    data[base + 16] = dx / len;
    data[base + 17] = dy / len;
    data[base + 18] = dz / len;
    // Node type name length. The shader does not read this slot today; it is
    // kept so a future pass can pick visuals per type without a layout change.
    data[base + 19] = s.nodeType.length;
    // base + 20 .. base + 27 stay zero: reserved.
  }

  return data;
}

/**
 * Flatten nodes into the shader's 4-vec4-per-node layout:
 *
 * ```
 * 0: position.xyz, radius
 * 1: color.rgb, primitive
 * 2: growthProgress, spawnTime, layer, isOwnPlant
 * 3: nodeTypeCode, 0, 0, 0
 * ```
 */
export function packNodes(nodes: readonly SDFNode[]): Float32Array {
  const data = new Float32Array(Math.max(1, nodes.length * NODE_TEXELS) * 4);

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const base = i * NODE_TEXELS * 4;

    data[base + 0] = n.position.x;
    data[base + 1] = n.position.y;
    data[base + 2] = n.position.z;
    data[base + 3] = visualRadius(n.nodeType, n.radius);

    data[base + 4] = n.color.x;
    data[base + 5] = n.color.y;
    data[base + 6] = n.color.z;
    data[base + 7] = n.primitive;

    data[base + 8] = n.growthProgress;
    data[base + 9] = n.spawnTime;
    data[base + 10] = n.layer;
    data[base + 11] = n.isOwnPlant ? 1.0 : 0.0;

    data[base + 12] = n.nodeTypeCode;
  }

  return data;
}
