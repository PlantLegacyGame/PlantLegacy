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
  /**
   * Vertical bounds of the cut. Root Sight removes a volume, not a column
   * through the whole body: the mouth is the highest ground under it and the
   * floor is the cavity's own depth budget. Without these the shader cut a
   * horizontal core through every hillside it opened on, and the same X/Z on
   * the far side of the planet.
   */
  uRootSightApertureTopY: { value: number };
  uRootSightApertureBottomY: { value: number };
  /**
   * Width of the dithered rim, metres (`cut_rim_dither_m`). The cut used to end
   * on a hard `smoothstep` a fraction of a pixel wide, so the opening's edge
   * was an aliased circle.
   */
  uRootSightRimDitherM: { value: number };
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

/** The presentation values Root Sight takes from `config/root_sight.json`. */
export interface RootSightPresentation {
  /** `cutaway_radius`: radius of the cavity around the plant, metres. */
  cutawayRadius: number;
  /** `soil_opacity`: how solid the soil inside the cavity looks, 0..1. */
  soilOpacity: number;
  /** `aperture_radius_ratio`: hole radius as a fraction of the cutaway radius. */
  apertureRadiusRatio: number;
  /** `aperture_min_m`: floor for the hole radius, metres. */
  apertureMinM: number;
}

/**
 * Radius of the circular hole the cavity opens in the ground, in metres.
 *
 * The hole is a fraction of the cutaway radius with a floor, so a seedling's
 * small cavity still reaches daylight instead of cutting a pinhole. Both numbers
 * are config (`aperture_radius_ratio`, `aperture_min_m`); this function owns the
 * relationship so the shader uniform, the diagnostic readout and the lateral
 * reach filter cannot disagree.
 */
export function apertureRadiusFor(
  cutawayRadius: number,
  config: Pick<RootSightPresentation, 'apertureRadiusRatio' | 'apertureMinM'>,
): number {
  const radius = Number.isFinite(cutawayRadius) ? Math.max(0, cutawayRadius) : 0;
  // A closed cavity has no hole: without this the floor would cut a pinhole in
  // a cavity of radius zero.
  if (radius <= 0) return 0;
  const ratio = Number.isFinite(config.apertureRadiusRatio) ? config.apertureRadiusRatio : 0;
  const floor = Number.isFinite(config.apertureMinM) ? Math.max(0, config.apertureMinM) : 0;
  return Math.max(floor, radius * ratio);
}

/**
 * Create a set of cutaway uniforms in the **closed** state.
 *
 * Nothing here is a tuned value on purpose. Before `/config/root_sight` has
 * answered, Root Sight is off and the cavity is zero, so no frame can be drawn
 * with a radius the file did not ask for. `applyRootSightConfig` fills in the
 * presentation values as soon as the config is loaded.
 *
 * The factory used to default to a 50 m radius at 0.3 opacity while the file
 * said 7 and 0.45, so the first frames of every session disagreed with config.
 */
export function createRootSightUniforms(): RootSightUniforms {
  return {
    uRootSightProgress: { value: 0 },
    uRootSightCenter: { value: new THREE.Vector3() },
    uRootSightApertureCenter: { value: new THREE.Vector3() },
    uRootSightRadius: { value: 0 },
    uRootSightApertureRadius: { value: 0 },
    uRootSightApertureTopY: { value: 0 },
    uRootSightApertureBottomY: { value: 0 },
    uRootSightRimDitherM: { value: 0 },
    uRootSightSoilOpacity: { value: 0 },
    uRootSightNodes: {
      value: Array.from({ length: 64 }, () => new THREE.Vector4(0, 0, 0, 0)),
    },
    uRootSightNodeCount: { value: 0 },
    uRootSightWallColor: { value: new THREE.Color(0x241d16) },
    uRootSightCamera: { value: new THREE.Vector3() },
  };
}

/**
 * Write the configured presentation into an existing uniform set.
 *
 * The set is shared by reference with the ground shader, the SDF plant pass and
 * the per-frame transition, so this mutates the values in place instead of
 * returning a new object. Called once when the config loads and again each frame
 * from `updateRootSight`.
 */
export function applyRootSightConfig(
  uniforms: RootSightUniforms,
  config: RootSightPresentation,
): void {
  const radius = Number.isFinite(config.cutawayRadius) ? Math.max(0, config.cutawayRadius) : 0;
  uniforms.uRootSightRadius.value = radius;
  uniforms.uRootSightApertureRadius.value = apertureRadiusFor(radius, config);
  uniforms.uRootSightSoilOpacity.value = Number.isFinite(config.soilOpacity)
    ? Math.min(1, Math.max(0, config.soilOpacity))
    : 0;
}
