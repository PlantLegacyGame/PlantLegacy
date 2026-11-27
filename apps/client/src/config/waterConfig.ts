/**
 * Client-side water tuning from `config/water.json`.
 *
 * The surface hydrology lives in config like every other tunable (RULE_3): the
 * flow rate, how deep a puddle may get and how much rain it takes are data, not
 * constants in the renderer. The water table is not tuned here — the server
 * simulates it per tile and streams the heights.
 */
import {
  DEFAULT_WATER_FIELD_TUNING,
  parseWaterTuning,
  type WaterFieldTuning,
} from '../renderers/environment/waterFieldTuning.ts';

export type WaterTuning = Partial<WaterFieldTuning>;

export const DEFAULT_WATER_TUNING: WaterTuning = { ...DEFAULT_WATER_FIELD_TUNING };

export { parseWaterTuning };

/** Fetch `/config/water`. A failure leaves the documented defaults. */
export async function loadWaterTuning(serverOrigin: string): Promise<WaterTuning> {
  try {
    const response = await fetch(`${serverOrigin}/config/water`, { cache: 'no-store' });
    if (!response.ok) return DEFAULT_WATER_TUNING;
    return parseWaterTuning((await response.json()) as Record<string, unknown>);
  } catch {
    return DEFAULT_WATER_TUNING;
  }
}
