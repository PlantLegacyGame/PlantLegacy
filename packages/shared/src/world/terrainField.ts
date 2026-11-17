/**
 * The ground field: one deterministic height function for the whole world.
 *
 * The server and the client must agree on where the surface is, or roots grow
 * through hills and plants stand in the air. This module is the single source
 * of that answer. It is pure and imports nothing (no THREE, no DOM), so the
 * server can call it inside the simulation tick and the client can call it per
 * vertex.
 *
 * Coordinates are the simulation's pole-local metres: x/z measured across the
 * surface from the planet's pole, y measured from the tangent plane there. The
 * client adds `planetSurfaceY()` for the planet's curvature; the server never
 * needs it, because the whole play area is within a rounding error of flat for
 * gameplay distances.
 *
 * The noise is an integer hash, not `Math.sin`-based: `Math.sin` is not
 * guaranteed to be bit-identical across JavaScript engines, and the client and
 * server build separate mesh/height arrays from this function.
 */

/** All terrain tunables. Values come from `config/terrain.json`. */
export interface TerrainFieldParams {
  /** World seed: the same seed always produces the same ground. */
  seed: number;
  /** Peak relief above the base surface, in metres. */
  amplitudeM: number;
  /** Base noise frequency in cycles per metre. */
  baseFrequency: number;
  /** Octave count, 1-6. */
  octaves: number;
  /** Frequency multiplier per octave. */
  lacunarity: number;
  /** Amplitude multiplier per octave. */
  gain: number;
  /** 0 = rolling hills, 1 = sharp ridges. */
  ridgeStrength: number;
  /** Radius the relief is authored for, in metres. */
  patchRadiusM: number;
  /** How far the relief fades out at the patch rim (0.1-1 of the radius). */
  rimFadeFraction: number;
  /** Deepest soil the simulation lets roots reach, metres below the surface. */
  maxDepthM: number;
  /** Depth of the topsoil layer, metres. Below it is subsoil, then bedrock. */
  soilDepthM: number;
  /** Carve a river channel into the field. */
  riverEnabled?: boolean;
  /** Centre line of the river, metres across the flow. */
  riverCenterZM?: number;
  /** Full channel width at the banks, metres. */
  riverWidthM?: number;
  /** Deepest cut of the bed below the surrounding ground, metres. */
  riverDepthM?: number;
  /** Grid step of the flow-accumulation survey, metres. */
  riverPathCellM?: number;
  /** How steeply the banks rise away from the water (rise per metre out). */
  riverBankSlope?: number;
  /** Width of the valley shoulder cut either side of the channel, metres. */
  riverBankApronM?: number;
  /** Depth of the water standing in the channel, metres. */
  riverWaterDepthM?: number;
  /** Downstream ripple speed of the stream, metres per second. */
  riverFlowSpeedMps?: number;
  /** Length of river meshed through the play area, metres. */
  riverLengthM?: number;
}

/** Material at a depth below the local surface. */
export type TerrainMaterial = 'topsoil' | 'subsoil' | 'bedrock';

export interface TerrainSample {
  /** Height above the base sphere/tangent plane, metres. */
  heightM: number;
  /** Unit normal of the surface at this point, in the local frame. */
  normal: { x: number; y: number; z: number };
  /** Slope in radians, 0 flat. */
  slopeRad: number;
  /** Material of the surface itself. */
  surface: TerrainMaterial;
}

export const DEFAULT_TERRAIN_FIELD: TerrainFieldParams = {
  seed: 1337,
  amplitudeM: 6,
  baseFrequency: 0.045,
  octaves: 4,
  lacunarity: 2,
  gain: 0.5,
  ridgeStrength: 0.35,
  patchRadiusM: 620,
  rimFadeFraction: 0.28,
  maxDepthM: 12,
  soilDepthM: 1.6,
  riverEnabled: false,
  riverCenterZM: 0,
  riverWidthM: 7,
  riverDepthM: 1.2,
  riverPathCellM: 2,
  riverBankSlope: 0.9,
  riverBankApronM: 12,
  riverWaterDepthM: 0.35,
  riverFlowSpeedMps: 1.4,
  riverLengthM: 320,
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Integer hash of a lattice point. FNV-style mixing with imul: exact 32-bit
 * integer arithmetic on every engine, unlike a sine hash.
 */
function hash2i(x: number, z: number, seed: number): number {
  let h = (seed | 0) ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smoothstep01 = (t: number): number => t * t * (3 - 2 * t);

/** Bilinear value noise in [0, 1]. */
export function terrainValueNoise(x: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = smoothstep01(x - xi);
  const zf = smoothstep01(z - zi);
  const h00 = hash2i(xi, zi, seed);
  const h10 = hash2i(xi + 1, zi, seed);
  const h01 = hash2i(xi, zi + 1, seed);
  const h11 = hash2i(xi + 1, zi + 1, seed);
  const top = h00 + (h10 - h00) * xf;
  const bottom = h01 + (h11 - h01) * xf;
  return top + (bottom - top) * zf;
}

/**
 * Fractal relief in [0, 1]. Higher octaves add the metre-scale detail; the
 * ridge blend sharpens crests without introducing a separate noise field.
 */
export function terrainUnitAt(params: TerrainFieldParams, x: number, z: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0.5;
  const octaves = Math.max(1, Math.min(6, Math.round(params.octaves)));
  const frequencyStep = Math.max(1.1, params.lacunarity);
  const gain = Math.max(0, Math.min(1, params.gain));
  let frequency = Math.max(0.0001, params.baseFrequency);
  let amplitude = 1;
  let sum = 0;
  let total = 0;
  for (let i = 0; i < octaves; i += 1) {
    const value = terrainValueNoise(
      x * frequency + i * 17.31,
      z * frequency - i * 9.17,
      params.seed + i * 1013,
    );
    sum += value * amplitude;
    total += amplitude;
    frequency *= frequencyStep;
    amplitude *= gain;
  }
  const base = total > 0 ? sum / total : 0.5;
  // Ridge noise is 1 at the crest of the underlying field. Blending it in
  // keeps valleys where the base field puts them.
  const ridge = 1 - Math.abs(base * 2 - 1);
  const strength = clamp01(params.ridgeStrength);
  return clamp01(base * (1 - strength) + ridge * strength);
}

/**
 * Relief fades to zero at the rim of the authored patch so the detailed ground
 * meets the smooth planet exactly: no step at the edge, no seam.
 */
export function terrainRimScale(params: TerrainFieldParams, x: number, z: number): number {
  const radius = Math.max(0, params.patchRadiusM);
  if (!(radius > 0)) return 0;
  const distance = Math.hypot(x, z);
  const fadeFraction = Math.min(0.95, Math.max(0.02, params.rimFadeFraction));
  const inner = radius * (1 - fadeFraction);
  if (distance <= inner) return 1;
  if (distance >= radius) return 0;
  return smoothstep01(1 - (distance - inner) / (radius - inner));
}

/** One surveyed point on the river's centre line. */
export interface RiverStation {
  x: number;
  z: number;
  /** Arc length from the head of the river, metres. */
  alongM: number;
  /** Water surface here, metres above the base surface. Never rises downstream. */
  surfaceY: number;
}

/** A point measured against the river's centre line. */
export interface RiverChannelHit {
  /** Lateral distance from the centre line, metres. */
  distanceM: number;
  /** Water surface at the nearest point on the line, metres above the base. */
  surfaceY: number;
  halfWidthM: number;
  apronM: number;
}

/**
 * A river surveyed from the terrain itself.
 *
 * The route is not authored: it is the trunk of the terrain's own drainage. The
 * relief is rasterised, every cell is pointed at its steepest downhill
 * neighbour (D8), and the flow each cell receives is accumulated. Tracing the
 * most-fed chain through the play area gives the line water would actually take
 * — through the valleys, down the fall line — instead of a sine drawn across the
 * hills.
 */
export interface RiverPath {
  stations: RiverStation[];
  halfWidthM: number;
  depthM: number;
  waterDepthM: number;
  apronM: number;
  bankSlope: number;
  /** Spatial index for nearest-point queries. */
  index: RiverSegmentIndex;
}

interface RiverSegmentIndex {
  cellM: number;
  minX: number;
  minZ: number;
  nx: number;
  nz: number;
  buckets: number[][];
}

/** Relief without the channel: the surface the river survey is cut from. */
function reliefAt(params: TerrainFieldParams, x: number, z: number): number {
  return (
    terrainUnitAt(params, x, z) * Math.max(0, params.amplitudeM) * terrainRimScale(params, x, z)
  );
}

const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Surveys keyed by the parameters object itself.
 *
 * The field is immutable in practice — the client swaps in a fresh object when
 * `/config/terrain` reloads and the server builds one at boot — so object
 * identity is the cache key. Hashing the parameters on every query meant
 * `terrainHeightAt` built and compared a sixteen-field signature string for
 * every vertex of the ground, several times over once the normals and the water
 * sheet sampled it.
 */
const riverPathCache = new WeakMap<TerrainFieldParams, RiverPath | null>();

/** Bucket the stations so a terrain vertex only tests the segments near it. */
function buildSegmentIndex(stations: RiverStation[]): RiverSegmentIndex {
  const cellM = 8;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const station of stations) {
    if (station.x < minX) minX = station.x;
    if (station.x > maxX) maxX = station.x;
    if (station.z < minZ) minZ = station.z;
    if (station.z > maxZ) maxZ = station.z;
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    maxX = 0;
    minZ = 0;
    maxZ = 0;
  }
  const nx = Math.max(1, Math.ceil((maxX - minX) / cellM) + 1);
  const nz = Math.max(1, Math.ceil((maxZ - minZ) / cellM) + 1);
  const buckets: number[][] = Array.from({ length: nx * nz }, () => []);
  for (let segment = 0; segment < stations.length - 1; segment += 1) {
    const a = stations[segment];
    const b = stations[segment + 1];
    const loX = Math.min(a.x, b.x);
    const hiX = Math.max(a.x, b.x);
    const loZ = Math.min(a.z, b.z);
    const hiZ = Math.max(a.z, b.z);
    const i0 = clampNumber(Math.floor((loX - minX) / cellM), 0, nx - 1);
    const i1 = clampNumber(Math.floor((hiX - minX) / cellM), 0, nx - 1);
    const j0 = clampNumber(Math.floor((loZ - minZ) / cellM), 0, nz - 1);
    const j1 = clampNumber(Math.floor((hiZ - minZ) / cellM), 0, nz - 1);
    for (let bj = j0; bj <= j1; bj += 1) {
      for (let bi = i0; bi <= i1; bi += 1) {
        buckets[bj * nx + bi].push(segment);
      }
    }
  }
  return { cellM, minX, minZ, nx, nz, buckets };
}

/**
 * Nearest point on the surveyed line: distance, and the water surface there.
 * Returns null when the point is further away than `reachM`.
 */
function nearestOnPath(
  path: RiverPath,
  x: number,
  z: number,
  reachM: number,
): { distanceM: number; surfaceY: number } | null {
  const { index, stations } = path;
  const rings = Math.ceil(reachM / index.cellM);
  const i = Math.floor((x - index.minX) / index.cellM);
  const j = Math.floor((z - index.minZ) / index.cellM);
  let best = Infinity;
  let bestSurface = 0;
  for (let dj = -rings; dj <= rings; dj += 1) {
    const jj = j + dj;
    if (jj < 0 || jj >= index.nz) continue;
    for (let di = -rings; di <= rings; di += 1) {
      const ii = i + di;
      if (ii < 0 || ii >= index.nx) continue;
      const bucket = index.buckets[jj * index.nx + ii];
      for (const segment of bucket) {
        const a = stations[segment];
        const b = stations[segment + 1];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const lengthSq = dx * dx + dz * dz;
        const t = lengthSq > 1e-9 ? ((x - a.x) * dx + (z - a.z) * dz) / lengthSq : 0;
        const clampedT = clampNumber(t, 0, 1);
        const px = a.x + dx * clampedT;
        const pz = a.z + dz * clampedT;
        const distance = Math.hypot(x - px, z - pz);
        if (distance < best) {
          best = distance;
          bestSurface = a.surfaceY + (b.surfaceY - a.surfaceY) * clampedT;
        }
      }
    }
  }
  if (!Number.isFinite(best) || best > reachM) return null;
  return { distanceM: best, surfaceY: bestSurface };
}

/**
 * Survey the river from the terrain.
 *
 * Steps, all deterministic and shared by client and server:
 *
 * 1. Rasterise the *uncarved* relief over the river corridor.
 * 2. Point every cell at its steepest downhill neighbour and accumulate the
 *    flow each cell receives (D8 flow accumulation).
 * 3. Pick the most-fed cell near the play area, then trace the most-fed chain
 *    upstream to the head and downstream to the outlet: that chain is the trunk
 *    of the drainage, so the river runs through the valleys the hills define.
 * 4. Smooth and resample the chain, then take a running minimum of the water
 *    level along it, so the surface never rises downstream.
 */
function buildRiverPath(params: TerrainFieldParams): RiverPath | null {
  const length = clampNumber(params.riverLengthM ?? 320, 40, 1200);
  const cell = clampNumber(params.riverPathCellM ?? 2, 0.5, 20);
  const halfLength = length / 2;
  const centreZ = params.riverCenterZM ?? 0;
  const corridorHalf = clampNumber(length * 0.18, 30, 120);
  const nx = Math.max(8, Math.round((halfLength * 2) / cell));
  const nz = Math.max(8, Math.round((corridorHalf * 2) / cell));
  const stepX = (halfLength * 2) / nx;
  const stepZ = (corridorHalf * 2) / nz;
  const x0 = -halfLength;
  const z0 = centreZ - corridorHalf;
  const count = nx * nz;
  const heights = new Float32Array(count);
  for (let j = 0; j < nz; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      heights[j * nx + i] = reliefAt(params, x0 + (i + 0.5) * stepX, z0 + (j + 0.5) * stepZ);
    }
  }

  const neighbourX = [-1, 0, 1, -1, 1, -1, 0, 1];
  const neighbourZ = [-1, -1, -1, 0, 0, 1, 1, 1];

  // Priority-Flood: a noise field is full of closed hollows, and every one of
  // them swallows the flow, which leaves the "river" ending in the first basin.
  // Filling each hollow up to its spill level first makes every cell drain to
  // the edge of the corridor, so the accumulation below is a real drainage tree.
  const filled = new Float32Array(count);
  const downstream = new Int32Array(count).fill(-1);
  const visited = new Uint8Array(count);
  const heapCells: number[] = [];
  const heapKeys: number[] = [];
  const heapPush = (cell: number, key: number): void => {
    heapCells.push(cell);
    heapKeys.push(key);
    let child = heapCells.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (heapKeys[parent] <= heapKeys[child]) break;
      [heapKeys[parent], heapKeys[child]] = [heapKeys[child], heapKeys[parent]];
      [heapCells[parent], heapCells[child]] = [heapCells[child], heapCells[parent]];
      child = parent;
    }
  };
  const heapPop = (): number => {
    const top = heapCells[0];
    const lastCell = heapCells.pop() as number;
    const lastKey = heapKeys.pop() as number;
    if (heapCells.length > 0) {
      heapCells[0] = lastCell;
      heapKeys[0] = lastKey;
      let parent = 0;
      for (;;) {
        const left = parent * 2 + 1;
        const right = left + 1;
        let smallest = parent;
        if (left < heapCells.length && heapKeys[left] < heapKeys[smallest]) smallest = left;
        if (right < heapCells.length && heapKeys[right] < heapKeys[smallest]) smallest = right;
        if (smallest === parent) break;
        [heapKeys[parent], heapKeys[smallest]] = [heapKeys[smallest], heapKeys[parent]];
        [heapCells[parent], heapCells[smallest]] = [heapCells[smallest], heapCells[parent]];
        parent = smallest;
      }
    }
    return top;
  };

  for (let j = 0; j < nz; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      if (i > 0 && j > 0 && i < nx - 1 && j < nz - 1) continue;
      const k = j * nx + i;
      visited[k] = 1;
      filled[k] = heights[k];
      heapPush(k, filled[k]);
    }
  }
  const spillEpsilon = 1e-4;
  while (heapCells.length > 0) {
    const current = heapPop();
    const i = current % nx;
    const j = Math.floor(current / nx);
    for (let n = 0; n < 8; n += 1) {
      const ii = i + neighbourX[n];
      const jj = j + neighbourZ[n];
      if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
      const next = jj * nx + ii;
      if (visited[next]) continue;
      visited[next] = 1;
      filled[next] = Math.max(heights[next], filled[current] + spillEpsilon);
      downstream[next] = current;
      heapPush(next, filled[next]);
    }
  }

  // Accumulate downstream: every cell contributes to the one it drains into.
  const order = Array.from({ length: count }, (_, k) => k).sort((a, b) => filled[b] - filled[a]);
  const flow = new Float32Array(count).fill(1);
  for (const k of order) {
    const next = downstream[k];
    if (next >= 0) flow[next] += flow[k];
  }

  // The trunk through the play area. A cell on the route is chosen near the
  // middle of the map, but only among cells that carry real flow (so it is not
  // a hollow that holds two square metres of runoff) and scored by how long a
  // chain runs through them, which keeps the river reaching across the play area
  // instead of stopping at a puddle.
  let seed = -1;
  let maxFlow = 0;
  for (let k = 0; k < count; k += 1) if (flow[k] > maxFlow) maxFlow = flow[k];

  /** Cells upstream plus cells downstream: how much river this start gives. */
  const chainLength = (start: number): number => {
    let up = 0;
    let cursor = start;
    for (let guard = 0; guard < count; guard += 1) {
      const i = cursor % nx;
      const j = Math.floor(cursor / nx);
      let best = -1;
      let bestFlow = 0;
      for (let n = 0; n < 8; n += 1) {
        const ii = i + neighbourX[n];
        const jj = j + neighbourZ[n];
        if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
        const k = jj * nx + ii;
        if (downstream[k] !== cursor) continue;
        if (flow[k] > bestFlow) {
          bestFlow = flow[k];
          best = k;
        }
      }
      if (best < 0) break;
      cursor = best;
      up += 1;
    }
    let down = 0;
    cursor = start;
    for (let guard = 0; guard < count; guard += 1) {
      const next = downstream[cursor];
      if (next < 0) break;
      cursor = next;
      down += 1;
    }
    return up + down;
  };

  const candidates: { cell: number; flow: number }[] = [];
  if (maxFlow > 0) {
    const radius = Math.min(50, halfLength * 0.5);
    for (let j = 0; j < nz; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const k = j * nx + i;
        if (flow[k] < maxFlow * 0.2) continue;
        const wx = x0 + (i + 0.5) * stepX;
        const wz = z0 + (j + 0.5) * stepZ;
        if (Math.hypot(wx, wz - centreZ) > radius) continue;
        candidates.push({ cell: k, flow: flow[k] });
      }
    }
    candidates.sort((a, b) => b.flow - a.flow);
    let bestLength = -1;
    for (const candidate of candidates.slice(0, 24)) {
      const length = chainLength(candidate.cell);
      if (length > bestLength) {
        bestLength = length;
        seed = candidate.cell;
      }
    }
  }
  if (seed < 0) {
    let bestFlow = -1;
    for (let k = 0; k < count; k += 1) {
      if (flow[k] > bestFlow) {
        bestFlow = flow[k];
        seed = k;
      }
    }
  }
  if (seed < 0) return null;

  const cellPoint = (k: number): { x: number; z: number } => ({
    x: x0 + ((k % nx) + 0.5) * stepX,
    z: z0 + (Math.floor(k / nx) + 0.5) * stepZ,
  });

  const upstream: number[] = [];
  let cursor = seed;
  for (let guard = 0; guard < count; guard += 1) {
    const i = cursor % nx;
    const j = Math.floor(cursor / nx);
    let best = -1;
    let bestFlow = 0;
    for (let n = 0; n < 8; n += 1) {
      const ii = i + neighbourX[n];
      const jj = j + neighbourZ[n];
      if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
      const k = jj * nx + ii;
      if (downstream[k] !== cursor) continue;
      if (flow[k] > bestFlow) {
        bestFlow = flow[k];
        best = k;
      }
    }
    if (best < 0) break;
    upstream.push(best);
    cursor = best;
  }
  upstream.reverse();

  const downstreamChain: number[] = [];
  cursor = seed;
  for (let guard = 0; guard < count; guard += 1) {
    const next = downstream[cursor];
    if (next < 0) break;
    downstreamChain.push(next);
    cursor = next;
  }

  const chain = [...upstream, seed, ...downstreamChain];
  if (chain.length < 3) return null;
  // A trunk shorter than a few channels' worth of ground is not a river: leave
  // the world without one rather than draw a puddle-length trickle.
  if (chain.length * Math.min(stepX, stepZ) < 60) return null;

  // Raw chain points, then three smoothing passes: the eight-direction steps
  // would otherwise show as a staircase along the bank.
  let points = chain.map(cellPoint);
  for (let pass = 0; pass < 3; pass += 1) {
    const next: { x: number; z: number }[] = [points[0]];
    for (let i = 1; i < points.length - 1; i += 1) {
      next.push({
        x: (points[i - 1].x + 2 * points[i].x + points[i + 1].x) / 4,
        z: (points[i - 1].z + 2 * points[i].z + points[i + 1].z) / 4,
      });
    }
    next.push(points[points.length - 1]);
    points = next;
  }

  // Resample at a steady spacing so the ribbon and the carve agree on vertices.
  const spacing = 1.5;
  const sampled: { x: number; z: number }[] = [points[0]];
  let nextAt = spacing;
  let travelled = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const segment = Math.hypot(b.x - a.x, b.z - a.z);
    if (segment < 1e-6) continue;
    while (nextAt <= travelled + segment) {
      const t = (nextAt - travelled) / segment;
      sampled.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      nextAt += spacing;
    }
    travelled += segment;
  }

  const waterDepth = Math.max(0.05, params.riverWaterDepthM ?? 0.35);
  const ground = sampled.map((point) => reliefAt(params, point.x, point.z));
  // The bed under the level line, lightly smoothed so the surface does not
  // inherit every metre of noise as a step.
  const smoothedGround = ground.map((value, i) => {
    let sum = 0;
    let weight = 0;
    for (let d = -2; d <= 2; d += 1) {
      const k = i + d;
      if (k < 0 || k >= ground.length) continue;
      const w = 3 - Math.abs(d);
      sum += ground[k] * w;
      weight += w;
    }
    return weight > 0 ? sum / weight : value;
  });

  const stations: RiverStation[] = [];
  let along = 0;
  let surface = smoothedGround[0] + waterDepth;
  for (let i = 0; i < sampled.length; i += 1) {
    if (i > 0) {
      along += Math.hypot(sampled[i].x - sampled[i - 1].x, sampled[i].z - sampled[i - 1].z);
      // Running minimum downstream: the water level can only fall, so it can
      // never sit under a rise in its own bed.
      surface = Math.min(surface, smoothedGround[i] + waterDepth);
    }
    stations.push({ x: sampled[i].x, z: sampled[i].z, alongM: along, surfaceY: surface });
  }
  if (stations.length < 3) return null;

  return {
    stations,
    halfWidthM: Math.max(0.5, params.riverWidthM ?? 7) / 2,
    depthM: Math.max(0.05, params.riverDepthM ?? 1.2),
    waterDepthM: waterDepth,
    apronM: Math.max(0, params.riverBankApronM ?? 12),
    bankSlope: Math.max(0, params.riverBankSlope ?? 0.9),
    index: buildSegmentIndex(stations),
  };
}

/** The surveyed river, or null when the world has none. Cached per parameters. */
export function riverPath(params: TerrainFieldParams): RiverPath | null {
  if (!params.riverEnabled) return null;
  if (!(params.amplitudeM > 0)) return null;
  const cached = riverPathCache.get(params);
  if (cached !== undefined) return cached;
  const built = buildRiverPath(params);
  riverPathCache.set(params, built);
  return built;
}

/**
 * Nearest point on an already-surveyed river. Same query the carve uses, for
 * baking maps of the channel (clip masks, bank tint) without rebuilding it.
 */
export function riverNearest(
  path: RiverPath,
  x: number,
  z: number,
  reachM: number,
): { distanceM: number; surfaceY: number } | null {
  return nearestOnPath(path, x, z, reachM);
}

/**
 * Where this point sits relative to the river, or null when it is out of reach.
 * The carve only works near the channel, so most terrain samples pay one failed
 * bucket lookup and stop.
 */
export function riverChannelAt(
  params: TerrainFieldParams,
  x: number,
  z: number,
): RiverChannelHit | null {
  const path = riverPath(params);
  if (!path) return null;
  const reach = path.halfWidthM + path.apronM;
  const hit = nearestOnPath(path, x, z, reach);
  if (!hit) return null;
  return {
    distanceM: hit.distanceM,
    surfaceY: hit.surfaceY,
    halfWidthM: path.halfWidthM,
    apronM: path.apronM,
  };
}

/**
 * Height the ground is cut to near the channel.
 *
 * Inside the channel the bed is a smooth bowl whose centre sits `river_depth_m`
 * under the surveyed water line, clamped by the natural ground: the river only
 * ever cuts, never fills. Outside it the shoulder rises at `river_bank_slope`
 * until it meets the untouched hillside, which is what gives the river a valley
 * rather than a slot. Because the water line is monotone, the centre of the bed
 * is always at least the water depth under the surface, so the stream cannot
 * pinch out over a rise.
 */
function carvedHeightAt(
  relief: number,
  channel: RiverChannelHit,
  depth: number,
  bankSlope: number,
): number {
  const { distanceM, halfWidthM, apronM, surfaceY } = channel;
  if (distanceM <= halfWidthM) {
    const t = distanceM / Math.max(0.001, halfWidthM);
    return Math.min(relief, surfaceY - depth * (1 - t * t));
  }
  if (apronM <= 0) return relief;
  const t = Math.min(1, (distanceM - halfWidthM) / apronM);
  return Math.min(relief, surfaceY + t * apronM * bankSlope);
}

/**
 * Height above the base surface in metres.
 *
 * The river channel is the only thing that cuts below the surrounding relief,
 * and the result is clamped at zero because the base sphere is also the physics
 * floor: a dip below it would be an invisible hole the player stands at the
 * bottom of.
 */
export function terrainHeightAt(params: TerrainFieldParams, x: number, z: number): number {
  if (!(params.amplitudeM > 0)) return 0;
  const relief = terrainUnitAt(params, x, z) * params.amplitudeM * terrainRimScale(params, x, z);
  const channel = riverChannelAt(params, x, z);
  if (!channel) return Math.max(0, relief);
  const path = riverPath(params);
  const depth = path?.depthM ?? Math.max(0, params.riverDepthM ?? 0);
  const bankSlope = path?.bankSlope ?? Math.max(0, params.riverBankSlope ?? 0.9);
  return Math.max(0, carvedHeightAt(relief, channel, depth, bankSlope));
}

/** Central-difference surface normal, in the local (x, up, z) frame. */
export function terrainNormalAt(
  params: TerrainFieldParams,
  x: number,
  z: number,
  epsilonM = 0.5,
): { x: number; y: number; z: number } {
  const e = Math.max(0.001, epsilonM);
  const left = terrainHeightAt(params, x - e, z);
  const right = terrainHeightAt(params, x + e, z);
  const back = terrainHeightAt(params, x, z - e);
  const front = terrainHeightAt(params, x, z + e);
  const dx = (right - left) / (2 * e);
  const dz = (front - back) / (2 * e);
  const length = Math.hypot(dx, 1, dz);
  return { x: -dx / length, y: 1 / length, z: -dz / length };
}

/** Slope in radians from the local vertical. */
export function terrainSlopeAt(
  params: TerrainFieldParams,
  x: number,
  z: number,
  epsilonM = 0.5,
): number {
  const normal = terrainNormalAt(params, x, z, epsilonM);
  return Math.acos(Math.max(-1, Math.min(1, normal.y)));
}

/**
 * Material at `depthM` below the local surface. Negative depths (above the
 * surface) report topsoil.
 */
export function terrainMaterialAt(params: TerrainFieldParams, depthM: number): TerrainMaterial {
  const depth = Math.max(0, depthM);
  if (depth <= Math.max(0.01, params.soilDepthM)) return 'topsoil';
  if (depth <= Math.max(0.02, params.maxDepthM)) return 'subsoil';
  return 'bedrock';
}

/** Everything a renderer or a validator needs at one surface point. */
export function sampleTerrain(
  params: TerrainFieldParams,
  x: number,
  z: number,
  epsilonM = 0.5,
): TerrainSample {
  const heightM = terrainHeightAt(params, x, z);
  const normal = terrainNormalAt(params, x, z, epsilonM);
  return {
    heightM,
    normal,
    slopeRad: Math.acos(Math.max(-1, Math.min(1, normal.y))),
    surface: terrainMaterialAt(params, 0),
  };
}
