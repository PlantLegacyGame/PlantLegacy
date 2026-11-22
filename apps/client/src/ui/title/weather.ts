/**
 * The title screen's weather.
 *
 * The title's sky already runs a whole day, but every day was identical: the same
 * clouds crossing the same blue. Weather is what makes a sky a place - and it has
 * to come from the same clock the light does, so a raincloud cannot cross a noon
 * sky that is painting a sunset.
 *
 * Deterministic, not random: the weather for an hour of a given day is a pure
 * function of (day, hour), so it does not flicker between boots, the same storm
 * arrives for every player at that hour, and a test can pin it. The world's clock
 * drives it, so time passing is what changes the weather.
 */

export type WeatherKind = 'clear' | 'breezy' | 'overcast' | 'rain' | 'drizzle' | 'snow' | 'fog';

export interface TitleWeather {
  kind: WeatherKind;
  /** How much extra cloud there is, 0..1: 0 is the authored fair-weather sky. */
  cloudiness: number;
  /** Rain streaks, 0..1. */
  rain: number;
  /** Haze near the ground, 0..1. */
  fog: number;
  /** Extra wind on the canopy, 0..1. */
  wind: number;
}

const CLEAR: TitleWeather = { kind: 'clear', cloudiness: 0, rain: 0, fog: 0, wind: 0.2 };

/**
 * The weather table. Clear is the most common by a wide margin: a title screen
 * that is raining half the time is a mood, not a sky.
 */
const KINDS: ReadonlyArray<{
  kind: WeatherKind;
  cloudiness: number;
  rain: number;
  fog: number;
  wind: number;
}> = [
  { kind: 'clear', cloudiness: 0, rain: 0, fog: 0, wind: 0.2 },
  { kind: 'clear', cloudiness: 0, rain: 0, fog: 0, wind: 0.2 },
  { kind: 'breezy', cloudiness: 0.25, rain: 0, fog: 0, wind: 0.85 },
  { kind: 'breezy', cloudiness: 0.3, rain: 0, fog: 0, wind: 0.7 },
  { kind: 'overcast', cloudiness: 0.8, rain: 0, fog: 0.25, wind: 0.45 },
  { kind: 'overcast', cloudiness: 0.9, rain: 0, fog: 0.2, wind: 0.35 },
  { kind: 'rain', cloudiness: 1, rain: 0.85, fog: 0.4, wind: 0.6 },
  { kind: 'rain', cloudiness: 0.95, rain: 0.6, fog: 0.35, wind: 0.5 },
  // A drizzle and a snowfall are not a downpour with the volume turned down: one
  // is a fine soft rain, the other falls round and slow, and the title draws them
  // as different weather rather than the same rain at a lower opacity.
  { kind: 'drizzle', cloudiness: 0.75, rain: 0.26, fog: 0.3, wind: 0.35 },
  { kind: 'snow', cloudiness: 0.95, rain: 0.6, fog: 0.35, wind: 0.2 },
  // Two more fair slots to pay for the two wet ones above: adding drizzle and snow
  // must not turn the title's climate into a wet one. Fair weather is still the
  // majority of the day, which is what makes a storm read as weather.
  { kind: 'clear', cloudiness: 0, rain: 0, fog: 0, wind: 0.3 },
  { kind: 'breezy', cloudiness: 0.2, rain: 0, fog: 0, wind: 0.75 },
  { kind: 'clear', cloudiness: 0.05, rain: 0, fog: 0, wind: 0.15 },
  { kind: 'fog', cloudiness: 0.55, rain: 0, fog: 0.85, wind: 0.1 },
  { kind: 'fog', cloudiness: 0.6, rain: 0, fog: 0.7, wind: 0.15 },
];

/**
 * Pick a bucket from a landing profile, weighted by what lands in it.
 *
 * The weights are *rates* - drops per second per column - so the pick, a 0..1
 * seeded number, is scaled by their total: a column's chance is its share of the
 * field. Each draw is compared strictly below its column's cumulative rate, so a
 * column with nothing landing in it never wins one.
 */
export function landingBucket(weights: readonly number[], pick: number): number {
  const total = weights.reduce((sum, value) => sum + (value > 0 ? value : 0), 0);
  if (total <= 0) return 0;
  const target = Math.min(0.999999, Math.max(0, pick)) * total;
  let cumulative = 0;
  for (let index = 0; index < weights.length; index += 1) {
    const weight = weights[index] ?? 0;
    cumulative += weight > 0 ? weight : 0;
    if (target < cumulative) return index;
  }
  // Only floating-point drift can get here: the last column ends at the total.
  return weights.length - 1;
}

/** An integer hash: same inputs, same weather, on every machine. */
function hash(a: number, b: number): number {
  let h = 2166136261 ^ (a * 374761393);
  h = Math.imul(h ^ (b * 668265263), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Rain reads as a *period* rather than a slot: the weather changes on the hour,
 * but a storm that starts and stops on the hour exactly is a schedule, not
 * weather. Each slot is held for its hour and then eased into the next.
 */
const SLICE = 8;

/** The weather while standing at `phase` (0..1 of the day) on day `day`. */
export function weatherAt(phase: number, day = 0): TitleWeather {
  if (!Number.isFinite(phase) || !Number.isFinite(day)) return CLEAR;
  const wrapped = ((phase % 1) + 1) % 1;
  const slot = Math.floor(wrapped * SLICE) % SLICE;
  const pick = KINDS[hash(Math.round(day), slot) % KINDS.length];
  if (!pick) return CLEAR;
  return {
    kind: pick.kind,
    cloudiness: pick.cloudiness,
    rain: pick.rain,
    fog: pick.fog,
    wind: pick.wind,
  };
}

/**
 * The title's weather for the world's own weather token.
 *
 * The game's weather is a server state (clear, rain, fog, ...) that the title
 * learns from /world/time. Mapping it here - rather than in the menu - keeps one
 * table of what each token looks like, and returns null for a token the title does
 * not know, so the caller can fall back to its own clock instead of pretending the
 * sky is clear.
 */
export function weatherFromState(state: string | null | undefined): TitleWeather | null {
  if (typeof state !== 'string') return null;
  const token = state
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  if (!token) return null;
  if (/snow|sleet|flake|blizzard/.test(token)) {
    return { kind: 'snow', cloudiness: 0.95, rain: 0.6, fog: 0.35, wind: 0.2 };
  }
  if (/drizzle|spitting|lightrain/.test(token)) {
    return { kind: 'drizzle', cloudiness: 0.75, rain: 0.26, fog: 0.3, wind: 0.35 };
  }
  // A thunderstorm is not a rainy hour with a noise on top: the title paints it
  // from the rain amount and the cloud, and both go to the top of their range so
  // the curtain is dense, fast, slanted and the ground runs. Plain rain stays
  // inside the mid range, which is what makes the two read as different weather.
  if (/thunder|squall|gale|hurricane|storm/.test(token)) {
    return { kind: 'rain', cloudiness: 1, rain: 1, fog: 0.5, wind: 0.95 };
  }
  if (/rain|shower|downpour/.test(token)) {
    return { kind: 'rain', cloudiness: 0.8, rain: 0.68, fog: 0.34, wind: 0.5 };
  }
  if (/fog|mist|haze/.test(token)) {
    return { kind: 'fog', cloudiness: 0.55, rain: 0, fog: 0.85, wind: 0.1 };
  }
  if (/overcast|cloud/.test(token)) {
    return { kind: 'overcast', cloudiness: 0.85, rain: 0, fog: 0.25, wind: 0.4 };
  }
  if (/wind|breez|gust/.test(token)) {
    return { kind: 'breezy', cloudiness: 0.28, rain: 0, fog: 0, wind: 0.8 };
  }
  if (/clear|sun|fair|calm/.test(token)) return CLEAR;
  return null;
}

/**
 * Blend of two weather samples, so a change of weather crosses over instead of
 * cutting. Two slots on either side of the hour: the caller passes the hour and
 * this returns the eased value.
 */
export function weatherBetween(phase: number, day = 0, blend = 0.35): TitleWeather {
  const next = weatherAt(phase, day);
  const previous = weatherAt(phase - 1 / SLICE, day);
  const k = Math.max(0, Math.min(1, blend));
  const mix = (a: number, b: number): number => a + (b - a) * k;
  return {
    kind: next.kind,
    cloudiness: mix(previous.cloudiness, next.cloudiness),
    rain: mix(previous.rain, next.rain),
    fog: mix(previous.fog, next.fog),
    wind: mix(previous.wind, next.wind),
  };
}
