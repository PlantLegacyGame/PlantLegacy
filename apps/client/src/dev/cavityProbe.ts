/**
 * Dev probes for the Root Sight cavity, for the `?dev=1` handle only.
 *
 * Three things had no way to be inspected, and they are all the same problem:
 * the camera is a physical observer. `settlePlayerOnGround` re-derives the eye
 * from the player's ground every frame and `clampEyeToGround` lifts it out of the
 * dirt, so a pose set from the console survives exactly one frame. That is the
 * clamp doing its job - and it is also why the cavity could never be looked at
 * from *inside* the earth, which is the only place the "cave walls" report could
 * be reproduced.
 *
 * So: hold a pose after the rig has had its say, tint the soil body and the
 * cavity shell apart in two unmistakable colours, and rebuild the earth's body
 * with and without its cavity hole at the numbers the ground itself used.
 */
import * as THREE from 'three';
import { createSoilSlab } from '../renderers/environment/planetSoilSlab.ts';

/** Where a held eye sits, and what it looks at, in world space. */
export interface CavityProbePose {
  x: number;
  y: number;
  z: number;
  targetX: number;
  targetY: number;
  targetZ: number;
}

/** Debug colours: the soil body in red, the cavity shell in green. */
const DEBUG_SOIL = '#ff0000';
const DEBUG_SHELL = '#00ff00';

export interface CavityProbe {
  /** Hold the eye here until released; `null` releases. */
  hold(pose: CavityProbePose | null): CavityProbePose | null;
  /** The held pose, if any. */
  held(): CavityProbePose | null;
  /** Stamp the held pose. Called last in the render frame, after the rig. */
  applyHold(): void;
  /**
   * Tint the soil body red and the cavity shell green, then restore.
   *
   * Red answers "is this the earth's own body" and green "is this the shell the
   * cavity is drawn with" without guessing from shading: a brown wall looks like
   * a brown wall whichever mesh it came from.
   */
  tint(on: boolean): { on: boolean; materials: number };
  /** Per-mesh visibility, by scene name. The renderer re-sets its own shells. */
  setVisible(name: string, visible: boolean): { found: number };
  /**
   * Add the earth's body as it was before the cavity hole existed, at the
   * options the live body was built with. Added outside `surfaceShells`, so the
   * buried-eye rule does not hide it the way it hides the real slab.
   */
  beforeSlab(
    on: boolean,
    overrides?: Partial<Parameters<typeof createSoilSlab>[0]>,
  ): { on: boolean; reason?: string };
  /** How the live earth body was built, including its cavity hole radius. */
  slabInfo(): Record<string, unknown> | null;
}

export function createCavityProbe(input: {
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** The live orbit target: `controls` is rebuilt when the surface normal moves. */
  getTarget: () => THREE.Vector3;
}): CavityProbe {
  const { scene, camera, getTarget } = input;
  let hold: CavityProbePose | null = null;
  /** Restores, one per material touched, so a tint is always reversible. */
  let restores: Array<() => void> = [];
  let before: THREE.Mesh | null = null;

  const findMesh = (name: string): THREE.Mesh | null => {
    let found: THREE.Mesh | null = null;
    scene.traverse((object) => {
      if (!found && object instanceof THREE.Mesh && object.name === name) found = object;
    });
    return found;
  };

  return {
    hold(pose) {
      hold = pose ? { ...pose } : null;
      if (pose) this.applyHold();
      return hold;
    },

    held() {
      return hold;
    },

    applyHold() {
      if (!hold) return;
      camera.position.set(hold.x, hold.y, hold.z);
      const target = getTarget();
      target.set(hold.targetX, hold.targetY, hold.targetZ);
      camera.lookAt(target);
    },

    tint(on) {
      for (const restore of restores.splice(0)) restore();
      if (!on) return { on: false, materials: 0 };
      const soil = new THREE.Color(DEBUG_SOIL);
      const shell = new THREE.Color(DEBUG_SHELL);
      const seen = new Set<THREE.Material>();
      let materials = 0;
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const material = object.material as THREE.MeshStandardMaterial;
        if (!material || seen.has(material)) return;
        const isShell = object.name === 'root-sight-bowl' || object.name === 'root-sight-skirt';
        const isSoil =
          object.name === 'planet-soil-slab' ||
          object.name.startsWith('planet-terrain') ||
          object.name === 'planet-surface';
        if (!isShell && !isSoil) return;
        seen.add(material);
        materials += 1;
        const restore: Array<() => void> = [];
        // The soil body shades from its own uniforms, not from `material.color`:
        // painting the material would have tinted nothing and the probe would
        // have reported a red-free picture as "not the soil".
        const uniforms = material.userData?.shader?.uniforms as
          | Record<string, { value: unknown }>
          | undefined;
        for (const key of ['uSoilDryColor', 'uSoilWetColor', 'uSoilMineralColor']) {
          const uniform = uniforms?.[key];
          if (!(uniform?.value instanceof THREE.Color)) continue;
          const original = uniform.value.clone();
          uniform.value.copy(soil);
          restore.push(() => (uniform.value as THREE.Color).copy(original));
        }
        if (material.color) {
          const original = material.color.clone();
          material.color.copy(isShell ? shell : soil);
          restore.push(() => material.color.copy(original));
        }
        if (material.emissive) {
          const original = material.emissive.clone();
          material.emissive.copy(shell).multiplyScalar(isShell ? 0.3 : 0);
          restore.push(() => material.emissive.copy(original));
        }
        restores.push(...restore);
      });
      return { on: true, materials };
    },

    setVisible(name, visible) {
      let found = 0;
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh && object.name === name) {
          object.visible = visible;
          found += 1;
        }
      });
      return { found };
    },

    beforeSlab(on, overrides) {
      if (!on) {
        if (!before) return { on: false };
        const geometry = before.geometry;
        before.removeFromParent();
        geometry.dispose();
        before = null;
        return { on: false };
      }
      if (before) return { on: true };
      const slab = findMesh('planet-soil-slab');
      if (!slab) return { on: false, reason: 'no planet-soil-slab in the scene' };
      const options = slab.geometry.userData?.slabOptions as
        | Parameters<typeof createSoilSlab>[0]
        | undefined;
      if (!options) return { on: false, reason: 'the slab did not record how it was built' };
      // The old body by default: no cavity hole, and whatever depth the caller
      // asks for (`depthM: 1.6` reproduces the pre-fix earth). It keeps the
      // shader's per-fragment cut, so it is the body the old build drew rather
      // than a solid disc over the pit.
      const old = createSoilSlab({ ...options, holeRadiusM: 0, ...overrides });
      old.name = 'dev-before-slab';
      const cut = slab.geometry.getAttribute('aSurfaceCut');
      if (cut) old.geometry.setAttribute('aSurfaceCut', cut.clone());
      old.position.copy(slab.position);
      old.quaternion.copy(slab.quaternion);
      old.scale.copy(slab.scale);
      (slab.parent ?? scene).add(old);
      before = old;
      return { on: true };
    },

    slabInfo() {
      const slab = findMesh('planet-soil-slab');
      return (slab?.geometry.userData?.slabOptions as Record<string, unknown> | undefined) ?? null;
    },
  };
}
