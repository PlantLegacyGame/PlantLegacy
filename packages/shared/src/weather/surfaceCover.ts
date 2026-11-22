/**
 * What weather leaves lying on the ground, as one set of rules for both skies.
 *
 * The title screen and the game world both draw rain and snow that *stay*: a
 * puddle that grows while it rains and dries after, a drift that piles up and
 * melts. They had separate arithmetic for it - two rates in the 3D rain system and
 * nothing at all in the 2D scene, where the pools were sized once from where the
 * first shower landed - so the same weather could leave different ground in the
 * two places. These are the rules, in one function, with no renderer in them.
 *
 * The ruleset:
 *
 * 1. **Water fills from the rain that reaches the column**, in proportion to the
 *    intensity there: a drizzle adds slowly, a downpour quickly. Wind is not water,
 *    so it is not a term here; it moves *where* the rain lands, which is the
 *    caller's business (it shifts its columns), not the water's.
 * 2. **Water drains whenever rain is below full**, at a rate set by how dry the air
 *    is: a light rain still loses more than it gains, which is why a drizzle darkens
 *    the ground without making lakes.
 * 3. **Snow settles slowly** - it is the same water arriving over minutes, not
 *    seconds - and **melts slowly** when nothing is falling.
 * 4. **Rain washes snow away faster than air melts it.** A shower on a drift is
 *    water moving over it, not a warm afternoon.
 * 5. **Both are capped at one** (a full pool, a full drift) and never go negative.
 * 6. **A long gap is not an instant flood.** `dt` is clamped, so a tab that was
 *    hidden for ten minutes comes back with wet ground rather than a lake.
 */

export interface SurfaceClimate {
  /** Rain reaching this column, 0..1. */
  rain: number;
  /** Snow reaching this column, 0..1. */
  snow: number;
}

export interface SurfaceCover {
  /** Standing water, 0..1. */
  water: number;
  /** Lying snow, 0..1. */
  snow: number;
}

export interface SurfaceCoverRules {
  /** Water added per second at full rain. */
  waterFill: number;
  /** Water lost per second when nothing is falling. */
  waterDry: number;
  /** Snow added per second at full snow. */
  snowFill: number;
  /** Snow lost per second when nothing is falling. */
  snowMelt: number;
  /** Snow lost per second at full rain - washed away, not melted. */
  snowWash: number;
}

/**
 * The shared rates. They are the numbers the 3D rain system already used per frame
 * - a lake in about twenty seconds of real rain, dry in half a minute, a drift over
 * three quarters of a minute, gone in a couple of minutes - so adopting the rules
 * changed no one's ground, only who owns the arithmetic.
 */
export const SURFACE_COVER_RULES: SurfaceCoverRules = {
  waterFill: 1 / 22,
  waterDry: 1 / 34,
  snowFill: 1 / 45,
  snowMelt: 1 / 110,
  snowWash: 1 / 60,
};

/** A column below this has no pool, however wet the dirt looks. */
export const PUDDLE_FLOOR = 0.12;
/** A column below this has no drift. */
export const DRIFT_FLOOR = 0.08;
/** Longest step the rules will take in one go. */
export const MAX_COVER_STEP_S = 2;

const clamp01 = (value: number): number => (value > 1 ? 1 : value > 0 ? value : 0);
const rate = (value: number): number => (Number.isFinite(value) ? clamp01(value) : 0);

/** One step of the rules. Pure: the same inputs always give the same ground. */
export function stepSurfaceCover(
  cover: SurfaceCover,
  climate: SurfaceClimate,
  dtSeconds: number,
): SurfaceCover {
  const dt = Number.isFinite(dtSeconds) ? Math.min(MAX_COVER_STEP_S, Math.max(0, dtSeconds)) : 0;
  if (dt === 0) return { water: clamp01(cover.water), snow: clamp01(cover.snow) };
  const rain = rate(climate.rain);
  const snowing = rate(climate.snow);
  const water = clamp01(cover.water);
  const snow = clamp01(cover.snow);
  const rules = SURFACE_COVER_RULES;
  // Rules 1, 2, 5.
  const waterNext = clamp01(water + dt * (rain * rules.waterFill - (1 - rain) * rules.waterDry));
  // Rules 3, 4, 5.
  const snowNext = clamp01(
    snow + dt * (snowing * rules.snowFill - (1 - snowing) * rules.snowMelt - rain * rules.snowWash),
  );
  return { water: waterNext, snow: snowNext };
}

/**
 * How much of a column's cover is drawn, 0..1.
 *
 * The rules leave a film on ground that has stopped being a puddle, so what is
 * drawn is remapped from the floor (nothing visible) to 0.55 (full): a pool opens
 * and closes over a band of water instead of popping in at one number.
 */
export function coverStrength(value: number, floor: number): number {
  const raw = Number.isFinite(value) ? value : 0;
  if (raw <= floor) return 0;
  return clamp01((raw - floor) / Math.max(0.001, 0.55 - floor));
}
