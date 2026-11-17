import { resolveDevTileCommand } from '../ops/devCommands.ts';
import type { DevAction } from './devAction.ts';

/** Only the rates the command mentioned; anything absent is left alone. */
export interface ResourceRatePatch {
  photosynthesisRate?: number;
  diffusionRate?: number;
  maxAbsorptionPerTick?: number;
  rainGainPerS?: number;
  evaporationPerS?: number;
  canopyShadeReduction?: number;
}

export interface WorldCommandPorts {
  applyResourceRates(patch: ResourceRatePatch): void;
  resetResourceRates(): void;
  tileCoordinates(worldX: number, worldZ: number): { tileX: number; tileZ: number };
  setTileResources(tileX: number, tileZ: number, resources: Record<string, number>): void;
  setTimeOfDay(fraction: number): void;
  weatherBroadcast(): { timeOfDay: number; isDay: boolean; sunIntensity: number };
  respond(actionType: string, payload: Record<string, unknown>): void;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * The dev commands that change the world around the plant: the resource
 * simulation's rates, a single tile's resources, and the clock.
 *
 * They never needed the player or the plant, only a handful of setters, so they
 * are the part of the switch that could leave `World` first.
 */
export function handleWorldCommand(ports: WorldCommandPorts, action: DevAction): boolean {
  switch (action.type) {
    case 'dev_set_resources': {
      // A non-numeric value used to be cast straight onto the simulation, where
      // one NaN rate poisons every tile it touches. Ignore it instead.
      ports.applyResourceRates({
        photosynthesisRate: finite(action.photosynthesis_rate),
        diffusionRate: finite(action.diffusion_rate),
        maxAbsorptionPerTick: finite(action.max_absorption_per_tick),
        rainGainPerS: finite(action.rain_gain_per_s),
        evaporationPerS: finite(action.evaporation_per_s),
        canopyShadeReduction: finite(action.canopy_shade_reduction),
      });
      ports.respond(action.type, { ok: true });
      return true;
    }
    case 'dev_reset_resources': {
      ports.resetResourceRates();
      ports.respond(action.type, { ok: true });
      return true;
    }
    case 'dev_set_tile': {
      const tile = resolveDevTileCommand(action, (worldX, worldZ) =>
        ports.tileCoordinates(worldX, worldZ),
      );
      if (tile) ports.setTileResources(tile.tileX, tile.tileZ, tile.resources);
      ports.respond(action.type, { ok: true });
      return true;
    }
    case 'dev_set_time': {
      // The sun is server-authoritative: a client-side setTimeOfDay is
      // overwritten by the very next weather broadcast, which is why the world
      // sat at 04:00 while the renderer was told it was afternoon. Moving the
      // world clock here is the only way to get daylight on demand.
      const fraction = Number(action.time_of_day);
      if (!Number.isFinite(fraction)) {
        ports.respond(action.type, { ok: false, reason: 'bad_time' });
        return true;
      }
      ports.setTimeOfDay(fraction);
      const moved = ports.weatherBroadcast();
      ports.respond(action.type, {
        ok: true,
        timeOfDay: moved.timeOfDay,
        isDay: moved.isDay,
        sunIntensity: moved.sunIntensity,
      });
      return true;
    }
    default:
      return false;
  }
}
