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
  /** Where the cavity reaches daylight: the plant's seed/root crown. */
  uRootSightApertureCenter: { value: THREE.Vector3 };
  uRootSightRadius: { value: number };
  /**
   * Radius of the circular hole cut in the terrain surface, in metres.
   *
   * One number, shared by the soil shader and the cavity bowl. They used to be
   * computed separately (the shader clamped the hole to 1.8 m, the bowl sized
   * its mouth from the full cutaway radius), so the bowl was several times
   * wider than the hole and its buried rim crossed the line of sight through
   * the opening - dirt appearing in the hole from some angles only.
   */
  uRootSightApertureRadius: { value: number };
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
  /** Eye position: used to keep the cavity enclosed and shaded while underground. */
  uRootSightCamera: { value: THREE.Vector3 };
}

/** Create a fresh set of cutaway uniforms, closed on the surface. */
export function createRootSightUniforms(
  overrides: { radius?: number; soilOpacity?: number } = {},
): RootSightUniforms {
  return {
    uRootSightProgress: { value: 0 },
    uRootSightCenter: { value: new THREE.Vector3() },
    uRootSightApertureCenter: { value: new THREE.Vector3() },
    uRootSightRadius: { value: overrides.radius ?? 50 },
    uRootSightApertureRadius: { value: Math.max(0.28, (overrides.radius ?? 50) * 0.7) },
    uRootSightSoilOpacity: { value: overrides.soilOpacity ?? 0.3 },
    uRootSightNodes: {
      value: Array.from({ length: 64 }, () => new THREE.Vector4(0, 0, 0, 0)),
    },
    uRootSightNodeCount: { value: 0 },
    uRootSightWallColor: { value: new THREE.Color(0x241d16) },
    uRootSightCamera: { value: new THREE.Vector3() },
  };
}
