import * as THREE from 'three';

/**
 * Root Sight cutaway uniforms.
 *
 * The same four values are read by the soil shader (the hole in the ground), the
 * SDF plant renderer (aura) and the per-frame transition in `main.ts`, so they
 * are declared once here and passed by reference. Anything that copies them
 * breaks the link that makes the pit and the aura grow together.
 */
export interface RootSightUniforms {
  uRootSightProgress: { value: number };
  uRootSightCenter: { value: THREE.Vector3 };
  uRootSightRadius: { value: number };
  /**
   * Radius of the plug of earth kept under the plant's seed. The cavity opens
   * around the seed, never directly beneath it, or the seed is left hanging in
   * the air over its own hole.
   */
  uRootSightSeedPad: { value: number };
  uRootSightSoilOpacity: { value: number };
  /**
   * T02 organic envelope: subterranean node positions (xyz) with a validity
   * flag in w. The soil shader fuses them with a smooth minimum so the cutaway
   * follows the root system rather than a single bubble.
   */
  uRootSightNodes: { value: THREE.Vector4[] };
  uRootSightNodeCount: { value: number };
  /** Colour of the cavity wall, so the soil rim can fade into it exactly. */
  uRootSightWallColor: { value: THREE.Color };
  /** Eye position: the soil is cut only on the camera-facing half of a bubble. */
  uRootSightCamera: { value: THREE.Vector3 };
}

/** Create a fresh set of cutaway uniforms, closed on the surface. */
export function createRootSightUniforms(
  overrides: { radius?: number; soilOpacity?: number } = {},
): RootSightUniforms {
  return {
    uRootSightProgress: { value: 0 },
    uRootSightCenter: { value: new THREE.Vector3() },
    uRootSightRadius: { value: overrides.radius ?? 50 },
    uRootSightSeedPad: { value: 0.5 },
    uRootSightSoilOpacity: { value: overrides.soilOpacity ?? 0.3 },
    uRootSightNodes: {
      value: Array.from({ length: 64 }, () => new THREE.Vector4(0, 0, 0, 0)),
    },
    uRootSightNodeCount: { value: 0 },
    uRootSightWallColor: { value: new THREE.Color(0x241d16) },
    uRootSightCamera: { value: new THREE.Vector3() },
  };
}
