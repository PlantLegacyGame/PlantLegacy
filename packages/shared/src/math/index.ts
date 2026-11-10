/**
 * Small math helpers shared by client and server.
 *
 * Quantization follows DESIGN.md Part 13.8: positions to 1/64 unit, angles to
 * 16 bits. These are wire-format helpers, not tunables.
 */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Piecewise-linear curve sampling used by T00A factor curves. */
export function sampleCurve(points: readonly (readonly [number, number])[], x: number): number {
  if (points.length === 0) return 0;
  const first = points[0];
  if (!first) return 0;
  if (x <= first[0]) return first[1];
  const last = points[points.length - 1];
  if (!last) return first[1];
  if (x >= last[0]) return last[1];

  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    if (!previous || !current) break;
    if (x <= current[0]) {
      const span = current[0] - previous[0];
      if (span === 0) return current[1];
      return lerp(previous[1], current[1], (x - previous[0]) / span);
    }
  }
  return last[1];
}

const POSITION_SCALE = 64;

export function quantizePosition(value: number): number {
  return Math.round(value * POSITION_SCALE);
}

export function dequantizePosition(value: number): number {
  return value / POSITION_SCALE;
}

export function quantizeAngle(radians: number): number {
  const twoPi = Math.PI * 2;
  const normalized = ((radians % twoPi) + twoPi) % twoPi;
  return Math.round((normalized / twoPi) * 0xffff) & 0xffff;
}

export function dequantizeAngle(value: number): number {
  return (value / 0xffff) * Math.PI * 2;
}

/**
 * FNV-1a 32-bit hash for deterministic string hashing.
 * Used to derive appearance randomness from stable node IDs.
 */
export function hash32(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Returns a deterministic [0, 1) float from a string ID and salt.
 * Same ID + same salt always produces the same value.
 */
export function hash01(id: string, salt: string): number {
  return hash32(`${id}:${salt}`) / 4294967296;
}

/**
 * Mulberry32 PRNG: fast, good quality, seedable.
 * Returns a function that produces deterministic [0, 1) floats.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
