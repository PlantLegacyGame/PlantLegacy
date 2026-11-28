/**
 * Water's numbers and colours, in one dependency-free module.
 *
 * These once lived inside the renderer's water field module, which imports
 * Three.js and the water material shader. Anything that only needs the tuning —
 * the config loader, and its tests under the plain Node test runner — pulled the
 * whole renderer in and failed on Vite-only `.js` specifiers, so the type and
 * its defaults live here now.
 */
import { isPaletteRoleName } from '@plant-legacy/shared/color';

/**
 * The water's own colours, from `config/water.json`.
 *
 * These were three literals in the water material and in the field, so the tint
 * of the medium, the fog you see underwater and the body of every sheet could not
 * be changed without a code edit — and could not be kept in step at all.
 */
export interface WaterColors {
  /** Deep water: the body, and the tint of the view under the surface. */
  deep: string;
  /** Water a few centimetres deep, before absorption. */
  shallow: string;
  /** What the sheet reflects at a grazing angle, and the inside of Snell's window. */
  sky: string;
}

/**
 * Palette role names, not hexes: A01 keeps every colour value in
 * `config/palette.json`, so `config/water.json` chooses which role paints each
 * of the three water surfaces and the renderer looks the role up.
 */
export const DEFAULT_WATER_COLORS: WaterColors = {
  deep: 'water_deep',
  shallow: 'water_body',
  sky: 'water_shallow',
};

export interface WaterFieldTuning {
  /**
   * Draw standing water at all: the solved surface and its visible mesh.
   *
   * Off removes the surface water while the hydrology keeps running, so the
   * ground still darkens after rain and the world is simply dry.
   */
  enabled: boolean;
  /** Surface sheet resolution (vertices per side). */
  surfaceCells: number;
  /** Half-extent of the surface sheet around the origin, metres. */
  surfaceExtentM: number;
  flowRatePerS: number;
  infiltrationPerS: number;
  evaporationPerS: number;
  maxDepthM: number;
  /** Metres of rain depth added per second while it is raining. */
  rainDepthPerS: number;
  /** Metres of water that halve light reaching the bottom of a body. */
  absorptionPerM: number;
  /** How dark the damp ground gets, 0 (invisible) .. 1 (black). */
  wetGroundOpacity: number;
  /** Cells the damp stain spreads beyond the water, on the surface sheet. */
  wetGroundHaloCells: number;
  /** How fast the stain dries after the water leaves, per second. */
  wetGroundDryPerS: number;
  /** Margin the channel mask widens the river by, metres. */
  riverClipMarginM: number;
  /** How far above the water table soil reads as damp, metres. */
  wetBandAboveTableM: number;
  /** The surface sheet floats this far above the ground it sampled. */
  surfaceLiftM: number;
  /** Water this close to the camera is skipped (near-plane clipping). */
  nearDiscardM: number;
  /** Shallowest standing water the sheet draws at all, in metres. */
  minVisibleDepthM: number;
  /** Metres beyond which the rain film starts to fade out. */
  puddleFadeStartM: number;
  /** Metres at which the rain film is gone. */
  puddleFadeEndM: number;
  /** Metres beyond which the water table starts to fade out. */
  tableFadeStartM: number;
  /** Metres at which the water table is gone. */
  tableFadeEndM: number;
  /**
   * Where the sheet's radial edge fade starts, as a fraction of its half-size.
   *
   * The sheet is a square grid. Seen from high above, its straight boundary was
   * the visible edge of the world - water drawn as a square - and it vanished
   * entirely once the whole sheet fell past the camera distance fade. Fading the
   * alpha out radially, well inside the grid, means the water always ends in a
   * soft falloff and no straight edge can be seen at any zoom.
   */
  sheetEdgeFade: number;
  /**
   * How far dry sheet vertices are pushed under the terrain. A triangle between
   * a wet vertex and a dry one is sloped, so a shallow sink still lets that
   * slope poke through the soil as blue shards.
   */
  drySinkM: number;
  /**
   * Spacing of the coarse ground guard over the transition ring, in metres.
   *
   * The ring's cells grow with radius; 64 m is its outer angular spacing, where
   * the guard has to cover the most ground. A uniform 8 m grid over 20 km would
   * be 25 million samples, and the fine disc grid already owns every metre the
   * player can walk.
   */
  groundTestCellM: number;
  /**
   * Half-extent of the coarse ground guard, in metres: the transition ring's
   * outer radius. Beyond this the water test is simply skipped.
   */
  groundTestRadiusM: number;
  /**
   * Half-extent of the fine ground guard, in metres: the play disc's radius.
   * Inside it the drawn ground is the 2 m disc, so the coarse ring only takes
   * over past its edge.
   */
  groundTestFineRadiusM: number;
  /** Cell size of that fine ground guard, in metres (the play disc's own). */
  groundTestFineCellM: number;
  /**
   * Height of the planet-wide sea above the play area's tangent plane, metres.
   *
   * Negative is normal: the play area is land, and the sea fills the basins
   * below it. The sea is a sphere centred on the planet, so this one number
   * decides every coastline on the world at once.
   */
  seaLevelM: number;
  /** Draw the planet-wide sea at all. */
  oceanEnabled: boolean;
  /** How much wave slope the sea's normal carries, 0 (mirror) .. 2. */
  seaWaveStrength: number;
  /** Wavelength of the sea's main swell, metres. */
  seaWaveScaleM: number;
  /** How wide the sea's foam band is, in metres of water column. */
  seaFoamWidthM: number;
  /** Body/shallow/sky colours (`config/water.json`). */
  colors: WaterColors;
}

export const DEFAULT_WATER_FIELD_TUNING: WaterFieldTuning = {
  enabled: true,
  surfaceCells: 96,
  surfaceExtentM: 64,
  flowRatePerS: 0.55,
  infiltrationPerS: 0.002,
  evaporationPerS: 0.003,
  maxDepthM: 0.22,
  rainDepthPerS: 0.006,
  absorptionPerM: 1.0,
  wetGroundOpacity: 0.35,
  wetGroundHaloCells: 1,
  wetGroundDryPerS: 0.05,
  riverClipMarginM: 0.5,
  wetBandAboveTableM: 0.6,
  surfaceLiftM: 0.05,
  nearDiscardM: 0.35,
  minVisibleDepthM: 0.02,
  drySinkM: 0.6,
  groundTestCellM: 64,
  groundTestRadiusM: 20_000,
  groundTestFineRadiusM: 620,
  groundTestFineCellM: 2,
  seaLevelM: 6,
  oceanEnabled: true,
  seaWaveStrength: 1.2,
  seaWaveScaleM: 5.5,
  seaFoamWidthM: 0.9,
  colors: DEFAULT_WATER_COLORS,
  puddleFadeStartM: 160,
  puddleFadeEndM: 260,
  tableFadeStartM: 320,
  tableFadeEndM: 520,
  sheetEdgeFade: 0.82,
};

/**
 * Metres from the sheet's centre where its radial edge fade begins and ends.
 *
 * `radiusM` is the sheet's half-size (the surface sheet is a square, so that is
 * also the distance to its corner); the fade finishes at that radius so the last
 * cells of the grid are already fully transparent.
 */
export function sheetFadeRange(
  radiusM: number,
  fadeFraction: number,
): { startM: number; endM: number } {
  const radius = Math.max(0, radiusM);
  const fraction = Math.min(0.98, Math.max(0.2, fadeFraction));
  return { startM: radius * fraction, endM: radius };
}

/**
 * Turn a `/config/water` payload into tuning.
 *
 * It lives here, beside the shape it returns, because it is pure and needs
 * nothing but the payload: the config loader only fetches, and this can be
 * tested without a server or a renderer. Numbers keep their documented default
 * when the payload omits or mangles them, and a malformed colour falls back per
 * colour rather than painting black.
 */

/** Read a palette role name, falling back rather than painting nothing. */
function readRole(value: unknown, fallback: string): string {
  return isPaletteRoleName(value) ? value : fallback;
}

export function parseWaterTuning(data: Record<string, unknown>): Partial<WaterFieldTuning> {
  const fallback = DEFAULT_WATER_FIELD_TUNING;
  const num = (key: string, value: number): number => {
    const parsed = Number(data[key]);
    return Number.isFinite(parsed) ? parsed : value;
  };
  const int = (key: string, value: number): number => Math.round(num(key, value));
  return {
    enabled: data.enabled !== false,
    surfaceCells: int('surface_cells', fallback.surfaceCells ?? 72),
    surfaceExtentM: num('surface_extent_m', fallback.surfaceExtentM ?? 64),
    flowRatePerS: num('surface_flow_rate_per_s', fallback.flowRatePerS ?? 0.55),
    infiltrationPerS: num('surface_infiltration_per_s', fallback.infiltrationPerS ?? 0.015),
    evaporationPerS: num('surface_evaporation_per_s', fallback.evaporationPerS ?? 0.003),
    maxDepthM: num('surface_max_depth_m', fallback.maxDepthM ?? 0.28),
    rainDepthPerS: num('rain_depth_per_s', fallback.rainDepthPerS ?? 0.006),
    absorptionPerM: num('water_absorption_per_m', fallback.absorptionPerM ?? 1.6),
    wetGroundOpacity: num('wet_ground_opacity', fallback.wetGroundOpacity ?? 0.5),
    wetGroundHaloCells: int('wet_ground_halo_cells', fallback.wetGroundHaloCells ?? 2),
    wetGroundDryPerS: num('wet_ground_dry_per_s', fallback.wetGroundDryPerS ?? 0.05),
    riverClipMarginM: num('river_clip_margin_m', fallback.riverClipMarginM ?? 0.5),
    wetBandAboveTableM: num('wet_band_above_table_m', fallback.wetBandAboveTableM ?? 0.6),
    surfaceLiftM: num('surface_lift_m', fallback.surfaceLiftM ?? 0.05),
    nearDiscardM: num('water_near_discard_m', fallback.nearDiscardM ?? 0.35),
    minVisibleDepthM: num('water_min_visible_depth_m', fallback.minVisibleDepthM ?? 0.02),
    drySinkM: num('water_dry_sink_m', fallback.drySinkM ?? 0.6),
    groundTestCellM: num('ground_test_cell_m', fallback.groundTestCellM ?? 64),
    groundTestRadiusM: num('ground_test_radius_m', fallback.groundTestRadiusM ?? 20_000),
    groundTestFineRadiusM: num('ground_test_fine_radius_m', fallback.groundTestFineRadiusM ?? 620),
    groundTestFineCellM: num('ground_test_fine_cell_m', fallback.groundTestFineCellM ?? 2),
    puddleFadeStartM: num('puddle_fade_start_m', fallback.puddleFadeStartM ?? 160),
    puddleFadeEndM: num('puddle_fade_end_m', fallback.puddleFadeEndM ?? 260),
    tableFadeStartM: num('table_fade_start_m', fallback.tableFadeStartM ?? 320),
    tableFadeEndM: num('table_fade_end_m', fallback.tableFadeEndM ?? 520),
    sheetEdgeFade: num('sheet_edge_fade', fallback.sheetEdgeFade ?? 0.82),
    seaLevelM: num('sea_level_m', fallback.seaLevelM ?? 6),
    oceanEnabled: data.ocean_enabled !== false && data.ocean_enabled !== 'false',
    seaWaveStrength: num('sea_wave_strength', fallback.seaWaveStrength ?? 1.2),
    seaWaveScaleM: num('sea_wave_scale_m', fallback.seaWaveScaleM ?? 5.5),
    seaFoamWidthM: num('sea_foam_width_m', fallback.seaFoamWidthM ?? 0.9),
    colors: {
      deep: readRole(data.water_deep_color, DEFAULT_WATER_COLORS.deep),
      shallow: readRole(data.water_shallow_color, DEFAULT_WATER_COLORS.shallow),
      sky: readRole(data.water_sky_color, DEFAULT_WATER_COLORS.sky),
    } satisfies WaterColors,
  };
}
