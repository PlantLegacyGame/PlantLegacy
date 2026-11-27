/**
 * The whole planet's relief, at a resolution that can be drawn everywhere.
 *
 * The authored world is a six-kilometre square of a 100 km body. Everything
 * outside it used to be the bare sphere: `planet-terrain-horizon` carries the
 * relief to 6 km and the body itself is smooth to the limb, so an eye that
 * left the play area - which planet view allows anywhere on the planet - flew
 * over a painted brown ball. The whole planet now shares one relief field,
 * evaluated by direction on the sphere rather than on the tangent plane, so it
 * is seamless across the poles and the antimeridian.
 *
 * Three levels are built from that one function. A level is a tessellation, not
 * a second terrain: every level evaluates `planetReliefAt` at its own vertices,
 * so nothing is baked, clipped or thrown away when the level changes and no
 * height is lost at the switch. The level only decides how finely the same
 * surface is sampled.
 *
 * The play area keeps its own patches, which are far finer than any global
 * level. The relief is faded to exactly zero inside the radius those patches
 * own, so the two surfaces meet on the bare sphere with no step - and the
 * far-field relief is already zero out there, so all three agree on one line.
 */
import type { TerrainFieldParams } from '@plant-legacy/shared/world';
import type * as THREE from 'three';
import { terrainRelief } from './planetSurface.ts';

/**
 * Biasing the noise down puts most of the world under the configured sea
 * level, which is what gives the globe its coastlines instead of a uniform
 * speckle of lakes. It is a fraction of the amplitude, not a height: a bigger
 * planet gets proportionally deeper basins.
 */
const SEA_BIAS_FRACTION = 0.18;

/**
 * Continental provinces, in metres of wavelength. The relief rides on them, so
 * the globe has a few large landmasses rather than evenly scattered pimples.
 */
const CONTINENT_WAVELENGTH_M = 26_000;

/**
 * The relief octaves: a region's shape, its hills, and then the ground a player
 * standing on it would call terrain.
 *
 * The first three carry the planet's form and are all a globe tessellation can
 * resolve. The last three are for the eye, which is why they are small: 900 m
 * hills, 380 m folds and 160 m clods, a few metres tall each. Without them the
 * surface was smooth at every distance - the globe could not sample detail that
 * did not exist - and a camera that zoomed in anywhere but the play area landed
 * on a featureless shell.
 */
const OCTAVES: ReadonlyArray<{ wavelengthM: number; weight: number }> = [
  { wavelengthM: 9_000, weight: 0.3 },
  { wavelengthM: 4_200, weight: 0.2 },
  { wavelengthM: 2_100, weight: 0.16 },
  { wavelengthM: 900, weight: 0.18 },
  { wavelengthM: 380, weight: 0.16 },
  { wavelengthM: 160, weight: 0.12 },
];

export interface PlanetReliefParams {
  /** Peak relief in metres, before the sea bias. */
  amplitudeM: number;
  /** The terrain field's seed, so the globe is this world's globe. */
  seed: number;
  /** Radius of the body the relief is measured from, metres. */
  surfaceRadiusM: number;
  /**
   * Arc distance from the pole, metres, that the authored patches own. Relief
   * is exactly zero inside it and grows in over `rampM`.
   */
  holdoffM: number;
  /** Metres of arc over which the global relief grows from zero. */
  rampM: number;
}

/** Deterministic 3D value hash, unit range. */
function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h = Math.imul(ix | 0, 374_761_393);
  h = (h + Math.imul(iy | 0, 668_265_263)) | 0;
  h = (h + Math.imul(iz | 0, 1_274_126_177)) | 0;
  h = (h + Math.imul(seed | 0, 1_013_904_223)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1_274_126_177);
  return ((h ^ (h >>> 16)) >>> 0) / 4_294_967_296;
}

function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Trilinear value noise on a lattice, 0..1. */
function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = smootherstep(x - ix);
  const fy = smootherstep(y - iy);
  const fz = smootherstep(z - iz);
  const at = (dx: number, dy: number, dz: number): number => hash3(ix + dx, iy + dy, iz + dz, seed);
  const x00 = at(0, 0, 0) + (at(1, 0, 0) - at(0, 0, 0)) * fx;
  const x10 = at(0, 1, 0) + (at(1, 1, 0) - at(0, 1, 0)) * fx;
  const x01 = at(0, 0, 1) + (at(1, 0, 1) - at(0, 0, 1)) * fx;
  const x11 = at(0, 1, 1) + (at(1, 1, 1) - at(0, 1, 1)) * fx;
  const y0 = x00 + (x10 - x00) * fy;
  const y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

function smoothstep01(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Relief in metres at a direction on the unit sphere.
 *
 * Positive is above the base sphere; the sea level is a single number added to
 * it, so a shoreline is wherever this crosses `seaLevel - baseRadius` in the
 * water model. The direction is taken as-is for the noise, which is why the
 * field has no seam at a pole or a meridian.
 */
export function planetReliefAt(
  direction: Pick<THREE.Vector3, 'x' | 'y' | 'z'>,
  params: PlanetReliefParams,
  /**
   * Drop octaves shorter than this, metres. 0 keeps the whole field the ground
   * is drawn from. The orbital mask asks for the long ones only: at a kilometre
   * per texel the 160 m and 380 m octaves are aliasing, not relief, and they
   * were the salt-and-pepper mottling across the disc.
   */
  minWavelengthM = 0,
): number {
  const radius = Math.max(1, params.surfaceRadiusM);
  const amplitude = Math.max(0, params.amplitudeM);
  const x = direction.x;
  const y = direction.y;
  const z = direction.z;
  const length = Math.hypot(x, y, z) || 1;
  const nx = x / length;
  const ny = y / length;
  const nz = z / length;
  if (!(amplitude > 0)) return 0;

  // The authored patches own the polar cap, and that cap is a *square* in the
  // pole's tangent plane: six kilometres to each side, eight and a half to its
  // corners. The holdoff used to be measured by arc from the pole, which is a
  // circle - so the four corners of the authored square stood outside it and
  // both fields claimed the same ground, the global relief lifting a shell
  // through the far patch. Measure the square's own max axis instead: the
  // handoff is exactly the edge the patches end on, all the way round.
  //
  // The tangent-plane coordinate is the same chord the ground patches use
  // (x = nx * radius, z = nz * radius at the pole), so there is one frame.
  const planar = Math.max(Math.abs(nx), Math.abs(nz)) * radius;
  if (planar <= params.holdoffM) return 0;
  const fade = smoothstep01(params.holdoffM, params.holdoffM + Math.max(1, params.rampM), planar);
  if (fade <= 0) return 0;

  const seed = params.seed | 0;
  const continentFrequency = radius / CONTINENT_WAVELENGTH_M;
  const continent = valueNoise3(
    nx * continentFrequency + 11.3,
    ny * continentFrequency - 4.7,
    nz * continentFrequency + 2.1,
    seed ^ 0x5f3a1,
  );
  let noise = 0;
  for (const octave of OCTAVES) {
    if (minWavelengthM > 0 && octave.wavelengthM < minWavelengthM) continue;
    const frequency = radius / octave.wavelengthM;
    noise +=
      octave.weight *
      valueNoise3(
        nx * frequency + octave.wavelengthM * 0.00037,
        ny * frequency - octave.wavelengthM * 0.00019,
        nz * frequency + octave.wavelengthM * 0.00053,
        seed + Math.round(octave.wavelengthM),
      );
  }
  // Continents lift the whole stack, so the high ground is on the landmasses
  // instead of everywhere at once.
  const shaped = (0.35 + 0.65 * continent) * noise;
  return amplitude * (shaped - SEA_BIAS_FRACTION) * fade;
}

/**
 * The relief the world actually draws, at a direction on the sphere.
 *
 * Two fields own the surface: the authored play-area field inside the patch,
 * and the global relief outside it. Each is exactly zero where the other lives
 * (the far field fades out by 5.6 km; the global relief is zero inside its
 * holdoff), so their sum is continuous across the handoff - one surface, no
 * step, and nothing to choose between at a coast or an LOD switch. That is what
 * lets the orbital face, the relief shells and the ground all read one height.
 *
 * The plane coordinates are the point's own chord from the pole, which is the
 * frame `planetSurface` uses; near the pole chord and arc are the same number.
 */
export function planetSurfaceReliefAt(
  direction: Pick<THREE.Vector3, 'x' | 'y' | 'z'>,
  radiusM: number,
  field: TerrainFieldParams,
  relief: PlanetReliefParams,
): number {
  const radius = Math.max(1, radiusM);
  const length = Math.hypot(direction.x, direction.y, direction.z) || 1;
  const ny = Math.max(-1, Math.min(1, direction.y / length));
  const theta = Math.acos(ny);
  const horizontal = Math.sin(theta) * radius;
  const phi = Math.atan2(direction.z, direction.x);
  const x = horizontal * Math.cos(phi);
  const z = horizontal * Math.sin(phi);
  return terrainRelief(x, z, field) + planetReliefAt(direction, relief);
}
