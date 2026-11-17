/**
 * Parsing for the dev commands that take free-form action objects.
 *
 * `handleDevAction` receives whatever the dev panel (or a script) put on the
 * wire, so each command has to decide what it was given before it touches the
 * world. That decision is the part worth testing, and it is the part that used
 * to be buried 600 lines inside the switch; the switching itself still lives in
 * the world, where the systems it drives are.
 */
import type { WeatherStateName } from '@plant-legacy/weather';

/** Weather states a dev command may force, in the order the panel offers them. */
export const DEV_WEATHER_STATES: readonly WeatherStateName[] = [
  'clear',
  'rain',
  'thunderstorm_telegraph',
  'thunderstorm_active',
  'thunderstorm_aftermath',
];

/** Used when a command omits a duration or sends one that is not a positive number. */
export const DEFAULT_DEV_WEATHER_DURATION_S = 180;

export interface DevWeatherCommand {
  state: WeatherStateName;
  durationS: number;
}

export type DevWeatherResult =
  | { ok: true; command: DevWeatherCommand }
  | { ok: false; error: 'unknown_weather_state' };

/** A dev command as it came off the wire: whatever the caller happened to send. */
export type DevCommandAction = Readonly<Record<string, unknown>>;

export function resolveDevWeatherCommand(action: DevCommandAction): DevWeatherResult {
  const state = typeof action.state === 'string' ? action.state : '';
  if (!DEV_WEATHER_STATES.includes(state as WeatherStateName)) {
    return { ok: false, error: 'unknown_weather_state' };
  }
  const requested = Number(action.duration_s ?? DEFAULT_DEV_WEATHER_DURATION_S);
  const durationS =
    Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_DEV_WEATHER_DURATION_S;
  return { ok: true, command: { state: state as WeatherStateName, durationS } };
}

export interface DevTileCommand {
  tileX: number;
  tileZ: number;
  /** Only the resources the command mentioned; anything absent is left alone. */
  resources: Record<string, number>;
}

function finiteOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Turn a `dev_set_tile` action into a tile and the resources to write.
 *
 * Tile indices are what the store wants, but a caller that only knows where it
 * is standing (a script, the pad's world point) should not have to invent the
 * grid maths: world coordinates are converted here. Returns null when the
 * command names no position at all, which the caller answers as a no-op rather
 * than writing to tile (0, 0).
 */
export function resolveDevTileCommand(
  action: DevCommandAction,
  toTile: (worldX: number, worldZ: number) => { tileX: number; tileZ: number },
): DevTileCommand | null {
  let tileX = finiteOrUndefined(action.x);
  let tileZ = finiteOrUndefined(action.z);
  const worldX = finiteOrUndefined(action.worldX);
  const worldZ = finiteOrUndefined(action.worldZ);
  if (
    (tileX === undefined || tileZ === undefined) &&
    worldX !== undefined &&
    worldZ !== undefined
  ) {
    const tile = toTile(worldX, worldZ);
    tileX = tile.tileX;
    tileZ = tile.tileZ;
  }
  if (tileX === undefined || tileZ === undefined) return null;

  const resources: Record<string, number> = {};
  const light = finiteOrUndefined(action.light);
  const moisture = finiteOrUndefined(action.moisture);
  const minerals = finiteOrUndefined(action.minerals);
  // The water table is a tile resource too; without it there was no way to raise
  // or drain the cavity pool and see the water surface move.
  const groundwater = finiteOrUndefined(action.groundwater);
  if (light !== undefined) resources.light = light;
  if (moisture !== undefined) resources.moisture = moisture;
  if (minerals !== undefined) resources.minerals = minerals;
  if (groundwater !== undefined) resources.groundwater = groundwater;

  return { tileX, tileZ, resources };
}
