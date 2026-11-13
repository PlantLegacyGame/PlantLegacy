/**
 * Node-type to SDF visual mapping.
 *
 * Every renderer needs the same answer to "what shape, colour and thickness is
 * this node type?", and each one used to carry its own table. This module is the
 * single table: the SDF raymarcher, the WebGPU mesh pass and Plant Lab all read
 * it, so the same plant looks the same on both paths.
 */
import { resolveDrawnRadius, seedBodyHalfHeight } from '@plant-legacy/shared/growth';
import * as THREE from 'three';
import type { PlantNodeData } from './plantNodeData.js';

/** SDF primitives the raymarched organism is built from. */
export enum SDFPrimitive {
  CAPSULE = 0, // stem, branch, vine, root, radicle, lateral_root
  ELIPSOID = 1, // seed, flower bud
  DISK = 2, // leaf, cotyledon, petal
  CONE = 3, // flower, spore_sac
  TORUS = 4, // branch collar / fusion zone
}

/** Legacy type number to node type string mapping. */
export function legacyTypeToString(type: number): string {
  switch (type) {
    case 0:
      return 'root';
    case 1:
      return 'stem';
    case 2:
      return 'leaf';
    default:
      return 'stem';
  }
}

/** Normalized node type string from PlantNodeData. */
export function getNodeTypeString(node: PlantNodeData): string {
  if (node.nodeType) return node.nodeType;
  return legacyTypeToString(node.type);
}

/**
 * Numeric node type code for the SDF shader. Used to give the seed a distinct
 * teardrop shape (heavy rounded base on the ground, pointed tip toward the sky)
 * while every other node keeps its legacy primitive.
 */
export function nodeTypeToSdfCode(nodeType: string): number {
  switch (nodeType) {
    case 'seed':
      return 1;
    case 'radicle':
    case 'root':
    case 'lateral_root':
      return 2;
    case 'stem':
    case 'branch':
    case 'vine':
      return 3;
    case 'leaf':
    case 'cotyledon':
      return 4;
    case 'flower':
    case 'spore_sac':
      return 5;
    default:
      return 0;
  }
}

/** Node type to SDF primitive mapping. */
export function getSDFPrimitive(nodeType: string): SDFPrimitive {
  switch (nodeType) {
    case 'stem':
    case 'branch':
    case 'vine':
    case 'root':
    case 'radicle':
    case 'lateral_root':
      return SDFPrimitive.CAPSULE;
    case 'seed':
      return SDFPrimitive.ELIPSOID;
    case 'leaf':
    case 'cotyledon':
      return SDFPrimitive.DISK;
    case 'flower':
    case 'spore_sac':
      return SDFPrimitive.CONE;
    default:
      return SDFPrimitive.CAPSULE;
  }
}

const BASE_NODE_COLORS: Readonly<Record<string, readonly [number, number, number]>> = {
  seed: [0.55, 0.35, 0.2],
  radicle: [0.65, 0.45, 0.3],
  root: [0.55, 0.4, 0.28],
  lateral_root: [0.6, 0.42, 0.3],
  stem: [0.45, 0.3, 0.2],
  branch: [0.5, 0.35, 0.22],
  vine: [0.35, 0.45, 0.2],
  leaf: [0.2, 0.65, 0.15],
  cotyledon: [0.25, 0.6, 0.2],
  flower: [0.95, 0.75, 0.85],
  spore_sac: [0.7, 0.55, 0.4],
};

const DEFAULT_NODE_COLOR: readonly [number, number, number] = [0.5, 0.5, 0.5];

/** Node type to colour mapping (procedural, no textures), tinted by health. */
export function getNodeColor(nodeType: string, health: number): THREE.Vector3 {
  const base = BASE_NODE_COLORS[nodeType] ?? DEFAULT_NODE_COLOR;
  return new THREE.Vector3(base[0], base[1] * health, base[2] * health);
}

/**
 * Murray's law tapering: radius scales with distance from root.
 * r_child = r_parent * (n)^(-1/3) where n is number of children.
 * For binary branching: r_child ~ 0.79 * r_parent.
 */
export function calculateMurrayTaper(
  parentRadius: number,
  childIndex: number,
  numChildren: number,
): number {
  if (numChildren <= 1) return parentRadius * 0.85;
  const factor = numChildren ** (-1 / 3);
  return parentRadius * factor * (0.9 + 0.1 * childIndex);
}

/**
 * Drawn radius of a part. The server stores drawn metres now, so its radius is
 * authoritative; `resolveDrawnRadius` handles legacy vessel radii and previews.
 * This used to be a third, independent multiplier table, which is why the same
 * plant looked different on WebGL2 and WebGPU.
 */
export function visualRadius(nodeType: string, serverRadius: number): number {
  return resolveDrawnRadius(nodeType, serverRadius);
}

/**
 * Vertical lift that puts the seed's drawn body on top of the soil: its ovoid
 * extends below the stored base position, so drawing it at y = 0 buried it.
 *
 * The raymarched seed is an ellipsoid of half-height `1.35 r` (see
 * `sdEllipsoid(p - pos, vec3(r * 1.05, r * 1.35, r * 1.05))` in the shader),
 * which is the shared seed aspect. This used to lift by `0.85 r`, half a radius
 * short, so the SDF path drew the same seed visibly sunk into the ground while
 * the mesh paths had it resting on the surface.
 */
export function seedBodyLift(nodeType: string, serverRadius: number): number {
  return seedBodyHalfHeight(visualRadius(nodeType, serverRadius));
}
