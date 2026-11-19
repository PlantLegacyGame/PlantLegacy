/**
 * Reading the world clock from outside the game.
 *
 * The title screen has no socket yet, so it cannot wait for `WEATHER_UPDATE` to
 * learn what time it is in the world. `GET /world/time` is the small read-only
 * door for that: the same clock the simulation runs, not a second day.
 *
 * A failure here is not an error worth showing anyone: no server, no clock, and
 * the menu falls back to its own cycle rather than refusing to draw.
 */

export interface WorldTime {
  /** 0..1, 0 = midnight, 0.25 sunrise, 0.5 noon. */
  timeOfDay: number;
  isDay: boolean;
  paused: boolean;
  scale: number;
}

export type WorldTimeFetch = (
  input: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Normalizes the payload; anything unusable becomes null so callers can fall back. */
export function parseWorldTime(payload: unknown): WorldTime | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  const timeOfDay = record.timeOfDay;
  if (typeof timeOfDay !== 'number' || !Number.isFinite(timeOfDay)) return null;
  return {
    timeOfDay: ((timeOfDay % 1) + 1) % 1,
    isDay: record.isDay === true,
    paused: record.paused === true,
    scale: readNumber(record.scale, 1),
  };
}

export async function fetchWorldTime(
  fetchImpl: WorldTimeFetch,
  origin: string,
): Promise<WorldTime | null> {
  try {
    const response = await fetchImpl(`${origin}/world/time`, { method: 'GET' });
    if (!response.ok) return null;
    return parseWorldTime(await response.json());
  } catch {
    return null;
  }
}
