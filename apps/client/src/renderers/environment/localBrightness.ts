/**
 * How strongly the light on the plant's own soil grades the sky.
 *
 * The sky is graded by the tiles the plant stands on, not by the camera, so the
 * world darkens where the roots are shaded. Before the first root readout - a
 * seed that has not rooted, or the moment after a join - there is no such number,
 * and the old default of `tile_light_base` snapped the sky from full daylight to
 * whatever the first packet said. Until a packet arrives the clock is the best
 * local estimate: `dayFactor` is the same curve the tiles follow.
 */

const DEFAULT_TILE_LIGHT_BASE = 80;

export function localSkyBrightness(params: {
  /** Average light of the plant's covered tiles, or null before any packet. */
  localTileLight: number | null;
  /** `resources.tile_light_base`: the light a full-day tile reaches. */
  tileLightBase: number;
  /** 0 night .. 1 day, from the server clock. */
  dayFactor: number;
}): number {
  const base =
    Number.isFinite(params.tileLightBase) && params.tileLightBase > 0
      ? params.tileLightBase
      : DEFAULT_TILE_LIGHT_BASE;
  const light01 =
    params.localTileLight === null || !Number.isFinite(params.localTileLight)
      ? clamp(params.dayFactor, 0, 1.5)
      : clamp(params.localTileLight / base, 0, 1.5);
  // Shade bottoms out at 0.55 so a plant in deep shade still reads as a lit
  // world; light above full day adds a little more, and nothing more than that.
  //
  // Night is not decided here. A tile-light ceiling used to sit on top of this
  // grade while the sky's night palette was blended in elsewhere, two treatments
  // for one hour that dimmed the palette as well as choosing it. The hour is the
  // sky's own business now (`gradeSkyTarget`): this number only says how lit the
  // plant's own ground is.
  return 0.55 + 0.45 * Math.min(1, light01) + Math.max(0, light01 - 1) * 0.25;
}

function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return Math.min(hi, Math.max(lo, value));
}
