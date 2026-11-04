/**
 * Client config loader.
 *
 * Reads the extended-1 config files from the server's `/config/*` routes on
 * demand and flattens them into typed objects. The client never parses the
 * extended-1 envelope itself — the server does that and returns flat values
 * (see `apps/server/src/main.ts` `/config/*` routes).
 *
 * RULE_3: every tunable here comes from config. Nothing is hardcoded.
 */

export interface RenderConfig {
  targetFps: number;
  fpsWarningThreshold: number;
  resolutionFloor: number;
  maxPixelRatio: number;
  cameraSmoothing: number;
  cameraMinDistance: number;
  cameraMaxDistance: number;
  cameraMaxPolarAngle: number;
  idleDropTimeoutMs: number;
  shadowMapSize: number;
  debugOverlayEnabled: boolean;
  debugOverlayKey: string;
  pauseOnHidden: boolean;
  qualityTiers: Array<{
    name: string;
    pixelRatio: number;
    shadowMapSize: number;
    maxTriangles: number;
    antialiasing: boolean;
  }>;
  // C03: Environment rendering
  skyZenithDay: string;
  skyHorizonDay: string;
  skyZenithDusk: string;
  skyHorizonDusk: string;
  skyZenithNight: string;
  skyHorizonNight: string;
  skyZenithRain: string;
  skyHorizonRain: string;
  skyZenithStorm: string;
  skyHorizonStorm: string;
  skyZenithTelegraph: string;
  skyHorizonTelegraph: string;
  sunColorDay: string;
  sunColorDusk: string;
  sunColorNight: string;
  sunIntensityDay: number;
  sunIntensityNight: number;
  ambientIntensityDay: number;
  ambientIntensityNight: number;
  fogNearClear: number;
  fogFarClear: number;
  fogNearRain: number;
  fogFarRain: number;
  fogNearStorm: number;
  fogFarStorm: number;
  rainParticleCount: number;
  rainParticleSpeed: number;
  rainBoxWidth: number;
  rainBoxHeight: number;
  rainParticleSize: number;
  lightningFlashDurationMs: number;
  lightningIntensityBoost: number;
  lightningMinIntervalS: number;
  lightningMaxIntervalS: number;
  soilDryColor: string;
  soilWetColor: string;
  soilMineralTint: string;
  terrainMeshSubdivisions: number;
  terrainRadius: number;
}

export interface ControlsConfig {
  bindings: Record<string, Binding>;
  touchMinTargetPx: number;
  hudMaxScreenFraction: number;
  rootSightMode: 'toggle' | 'hold';
  textScale: number;
  contextDockFadeMs: number;
}

export interface Binding {
  keys: string[];
  mouse: string;
  mode: 'press' | 'toggle' | 'hold';
  context: string;
}

export interface UIConfig {
  textScale: number;
  layers: Record<string, number>;
  theme: Record<string, string>;
  toastDurationMs: number;
  toastMaxStack: number;
  hintCardDurationMs: number;
  hintCardMaxLines: number;
  panelDefaultWidthPx: number;
  panelAnimationMs: number;
  reducedMotion: boolean;
  safeAreaPaddingPx: number;
}

export interface RootSightConfig {
  cutawayRadius: number;
  transitionMs: number;
  soilOpacity: number;
  ownRootHighlightColor: string;
  rivalRootHighlightColor: string;
  substrateMultiplier: number;
  cameraTarget: 'own_plant' | 'camera_position';
}

interface QualityTierResponse {
  name?: string;
  pixel_ratio?: number;
  pixelRatio?: number;
  shadow_map_size?: number;
  shadowMapSize?: number;
  max_triangles?: number;
  maxTriangles?: number;
  antialiasing?: boolean;
}

interface RenderConfigResponse {
  target_fps?: number;
  targetFps?: number;
  fps_warning_threshold?: number;
  fpsWarningThreshold?: number;
  resolution_floor?: number;
  resolutionFloor?: number;
  max_pixel_ratio?: number;
  maxPixelRatio?: number;
  camera_smoothing?: number;
  cameraSmoothing?: number;
  camera_min_distance?: number;
  cameraMinDistance?: number;
  camera_max_distance?: number;
  cameraMaxDistance?: number;
  camera_max_polar_angle?: number;
  cameraMaxPolarAngle?: number;
  idle_drop_timeout_ms?: number;
  idleDropTimeoutMs?: number;
  shadow_map_size?: number;
  shadowMapSize?: number;
  debug_overlay_enabled?: boolean;
  debugOverlayEnabled?: boolean;
  debug_overlay_key?: string;
  debugOverlayKey?: string;
  pause_on_hidden?: boolean;
  pauseOnHidden?: boolean;
  quality_tiers?: QualityTierResponse[];
  qualityTiers?: QualityTierResponse[];
  sky_zenith_day?: string;
  skyZenithDay?: string;
  sky_horizon_day?: string;
  skyHorizonDay?: string;
  sky_zenith_dusk?: string;
  skyZenithDusk?: string;
  sky_horizon_dusk?: string;
  skyHorizonDusk?: string;
  sky_zenith_night?: string;
  skyZenithNight?: string;
  sky_horizon_night?: string;
  skyHorizonNight?: string;
  sky_zenith_rain?: string;
  skyZenithRain?: string;
  sky_horizon_rain?: string;
  skyHorizonRain?: string;
  sky_zenith_storm?: string;
  skyZenithStorm?: string;
  sky_horizon_storm?: string;
  skyHorizonStorm?: string;
  sky_zenith_telegraph?: string;
  skyZenithTelegraph?: string;
  sky_horizon_telegraph?: string;
  skyHorizonTelegraph?: string;
  sun_color_day?: string;
  sunColorDay?: string;
  sun_color_dusk?: string;
  sunColorDusk?: string;
  sun_color_night?: string;
  sunColorNight?: string;
  sun_intensity_day?: number;
  sunIntensityDay?: number;
  sun_intensity_night?: number;
  sunIntensityNight?: number;
  ambient_intensity_day?: number;
  ambientIntensityDay?: number;
  ambient_intensity_night?: number;
  ambientIntensityNight?: number;
  fog_near_clear?: number;
  fogNearClear?: number;
  fog_far_clear?: number;
  fogFarClear?: number;
  fog_near_rain?: number;
  fogNearRain?: number;
  fog_far_rain?: number;
  fogFarRain?: number;
  fog_near_storm?: number;
  fogNearStorm?: number;
  fog_far_storm?: number;
  fogFarStorm?: number;
  rain_particle_count?: number;
  rainParticleCount?: number;
  rain_particle_speed?: number;
  rainParticleSpeed?: number;
  rain_box_width?: number;
  rainBoxWidth?: number;
  rain_box_height?: number;
  rainBoxHeight?: number;
  rain_particle_size?: number;
  rainParticleSize?: number;
  lightning_flash_duration_ms?: number;
  lightningFlashDurationMs?: number;
  lightning_intensity_boost?: number;
  lightningIntensityBoost?: number;
  lightning_min_interval_s?: number;
  lightningMinIntervalS?: number;
  lightning_max_interval_s?: number;
  lightningMaxIntervalS?: number;
  soil_dry_color?: string;
  soilDryColor?: string;
  soil_wet_color?: string;
  soilWetColor?: string;
  soil_mineral_tint?: string;
  soilMineralTint?: string;
  terrain_mesh_subdivisions?: number;
  terrainMeshSubdivisions?: number;
  terrain_radius?: number;
  terrainRadius?: number;
}

interface ControlsConfigResponse {
  bindings?: Record<string, Binding>;
  touch_min_target_px?: number;
  touchMinTargetPx?: number;
  hud_max_screen_fraction?: number;
  hudMaxScreenFraction?: number;
  root_sight_mode?: 'toggle' | 'hold';
  rootSightMode?: 'toggle' | 'hold';
  text_scale?: number;
  textScale?: number;
  context_dock_fade_ms?: number;
  contextDockFadeMs?: number;
}

interface UIConfigResponse {
  text_scale?: number;
  textScale?: number;
  layers?: Record<string, number>;
  theme?: Record<string, string>;
  toast_duration_ms?: number;
  toastDurationMs?: number;
  toast_max_stack?: number;
  toastMaxStack?: number;
  hint_card_duration_ms?: number;
  hintCardDurationMs?: number;
  hint_card_max_lines?: number;
  hintCardMaxLines?: number;
  panel_default_width_px?: number;
  panelDefaultWidthPx?: number;
  panel_animation_ms?: number;
  panelAnimationMs?: number;
  reduced_motion?: boolean;
  reducedMotion?: boolean;
  safe_area_padding_px?: number;
  safeAreaPaddingPx?: number;
}

interface RootSightConfigResponse {
  cutaway_radius?: number;
  cutawayRadius?: number;
  transition_ms?: number;
  transitionMs?: number;
  soil_opacity?: number;
  soilOpacity?: number;
  own_root_highlight_color?: string;
  ownRootHighlightColor?: string;
  rival_root_highlight_color?: string;
  rivalRootHighlightColor?: string;
  substrate_multiplier?: number;
  substrateMultiplier?: number;
  camera_target?: 'own_plant' | 'camera_position';
  cameraTarget?: 'own_plant' | 'camera_position';
}

function normalizeRenderConfig(data: RenderConfigResponse, fallback: RenderConfig): RenderConfig {
  const tiers: QualityTierResponse[] =
    data.quality_tiers ?? data.qualityTiers ?? fallback.qualityTiers;

  return {
    targetFps: data.target_fps ?? data.targetFps ?? fallback.targetFps,
    fpsWarningThreshold:
      data.fps_warning_threshold ?? data.fpsWarningThreshold ?? fallback.fpsWarningThreshold,
    resolutionFloor: data.resolution_floor ?? data.resolutionFloor ?? fallback.resolutionFloor,
    maxPixelRatio: data.max_pixel_ratio ?? data.maxPixelRatio ?? fallback.maxPixelRatio,
    cameraSmoothing: data.camera_smoothing ?? data.cameraSmoothing ?? fallback.cameraSmoothing,
    cameraMinDistance:
      data.camera_min_distance ?? data.cameraMinDistance ?? fallback.cameraMinDistance,
    cameraMaxDistance:
      data.camera_max_distance ?? data.cameraMaxDistance ?? fallback.cameraMaxDistance,
    cameraMaxPolarAngle:
      data.camera_max_polar_angle ?? data.cameraMaxPolarAngle ?? fallback.cameraMaxPolarAngle,
    idleDropTimeoutMs:
      data.idle_drop_timeout_ms ?? data.idleDropTimeoutMs ?? fallback.idleDropTimeoutMs,
    shadowMapSize: data.shadow_map_size ?? data.shadowMapSize ?? fallback.shadowMapSize,
    debugOverlayEnabled:
      data.debug_overlay_enabled ?? data.debugOverlayEnabled ?? fallback.debugOverlayEnabled,
    debugOverlayKey: data.debug_overlay_key ?? data.debugOverlayKey ?? fallback.debugOverlayKey,
    pauseOnHidden: data.pause_on_hidden ?? data.pauseOnHidden ?? fallback.pauseOnHidden,
    qualityTiers: tiers.map((tier) => ({
      name: tier.name ?? 'custom',
      pixelRatio: tier.pixel_ratio ?? tier.pixelRatio ?? 1,
      shadowMapSize: tier.shadow_map_size ?? tier.shadowMapSize ?? 2048,
      maxTriangles: tier.max_triangles ?? tier.maxTriangles ?? 100000,
      antialiasing: tier.antialiasing ?? true,
    })),
    skyZenithDay: data.sky_zenith_day ?? data.skyZenithDay ?? fallback.skyZenithDay,
    skyHorizonDay: data.sky_horizon_day ?? data.skyHorizonDay ?? fallback.skyHorizonDay,
    skyZenithDusk: data.sky_zenith_dusk ?? data.skyZenithDusk ?? fallback.skyZenithDusk,
    skyHorizonDusk: data.sky_horizon_dusk ?? data.skyHorizonDusk ?? fallback.skyHorizonDusk,
    skyZenithNight: data.sky_zenith_night ?? data.skyZenithNight ?? fallback.skyZenithNight,
    skyHorizonNight: data.sky_horizon_night ?? data.skyHorizonNight ?? fallback.skyHorizonNight,
    skyZenithRain: data.sky_zenith_rain ?? data.skyZenithRain ?? fallback.skyZenithRain,
    skyHorizonRain: data.sky_horizon_rain ?? data.skyHorizonRain ?? fallback.skyHorizonRain,
    skyZenithStorm: data.sky_zenith_storm ?? data.skyZenithStorm ?? fallback.skyZenithStorm,
    skyHorizonStorm: data.sky_horizon_storm ?? data.skyHorizonStorm ?? fallback.skyHorizonStorm,
    skyZenithTelegraph:
      data.sky_zenith_telegraph ?? data.skyZenithTelegraph ?? fallback.skyZenithTelegraph,
    skyHorizonTelegraph:
      data.sky_horizon_telegraph ?? data.skyHorizonTelegraph ?? fallback.skyHorizonTelegraph,
    sunColorDay: data.sun_color_day ?? data.sunColorDay ?? fallback.sunColorDay,
    sunColorDusk: data.sun_color_dusk ?? data.sunColorDusk ?? fallback.sunColorDusk,
    sunColorNight: data.sun_color_night ?? data.sunColorNight ?? fallback.sunColorNight,
    sunIntensityDay: data.sun_intensity_day ?? data.sunIntensityDay ?? fallback.sunIntensityDay,
    sunIntensityNight:
      data.sun_intensity_night ?? data.sunIntensityNight ?? fallback.sunIntensityNight,
    ambientIntensityDay:
      data.ambient_intensity_day ?? data.ambientIntensityDay ?? fallback.ambientIntensityDay,
    ambientIntensityNight:
      data.ambient_intensity_night ?? data.ambientIntensityNight ?? fallback.ambientIntensityNight,
    fogNearClear: data.fog_near_clear ?? data.fogNearClear ?? fallback.fogNearClear,
    fogFarClear: data.fog_far_clear ?? data.fogFarClear ?? fallback.fogFarClear,
    fogNearRain: data.fog_near_rain ?? data.fogNearRain ?? fallback.fogNearRain,
    fogFarRain: data.fog_far_rain ?? data.fogFarRain ?? fallback.fogFarRain,
    fogNearStorm: data.fog_near_storm ?? data.fogNearStorm ?? fallback.fogNearStorm,
    fogFarStorm: data.fog_far_storm ?? data.fogFarStorm ?? fallback.fogFarStorm,
    rainParticleCount:
      data.rain_particle_count ?? data.rainParticleCount ?? fallback.rainParticleCount,
    rainParticleSpeed:
      data.rain_particle_speed ?? data.rainParticleSpeed ?? fallback.rainParticleSpeed,
    rainBoxWidth: data.rain_box_width ?? data.rainBoxWidth ?? fallback.rainBoxWidth,
    rainBoxHeight: data.rain_box_height ?? data.rainBoxHeight ?? fallback.rainBoxHeight,
    rainParticleSize: data.rain_particle_size ?? data.rainParticleSize ?? fallback.rainParticleSize,
    lightningFlashDurationMs:
      data.lightning_flash_duration_ms ??
      data.lightningFlashDurationMs ??
      fallback.lightningFlashDurationMs,
    lightningIntensityBoost:
      data.lightning_intensity_boost ??
      data.lightningIntensityBoost ??
      fallback.lightningIntensityBoost,
    lightningMinIntervalS:
      data.lightning_min_interval_s ?? data.lightningMinIntervalS ?? fallback.lightningMinIntervalS,
    lightningMaxIntervalS:
      data.lightning_max_interval_s ?? data.lightningMaxIntervalS ?? fallback.lightningMaxIntervalS,
    soilDryColor: data.soil_dry_color ?? data.soilDryColor ?? fallback.soilDryColor,
    soilWetColor: data.soil_wet_color ?? data.soilWetColor ?? fallback.soilWetColor,
    soilMineralTint: data.soil_mineral_tint ?? data.soilMineralTint ?? fallback.soilMineralTint,
    terrainMeshSubdivisions:
      data.terrain_mesh_subdivisions ??
      data.terrainMeshSubdivisions ??
      fallback.terrainMeshSubdivisions,
    terrainRadius: data.terrain_radius ?? data.terrainRadius ?? fallback.terrainRadius,
  };
}

function normalizeControlsConfig(
  data: ControlsConfigResponse,
  fallback: ControlsConfig,
): ControlsConfig {
  return {
    bindings: data.bindings ?? fallback.bindings,
    touchMinTargetPx:
      data.touch_min_target_px ?? data.touchMinTargetPx ?? fallback.touchMinTargetPx,
    hudMaxScreenFraction:
      data.hud_max_screen_fraction ?? data.hudMaxScreenFraction ?? fallback.hudMaxScreenFraction,
    rootSightMode: data.root_sight_mode ?? data.rootSightMode ?? fallback.rootSightMode,
    textScale: data.text_scale ?? data.textScale ?? fallback.textScale,
    contextDockFadeMs:
      data.context_dock_fade_ms ?? data.contextDockFadeMs ?? fallback.contextDockFadeMs,
  };
}

function normalizeUIConfig(data: UIConfigResponse, fallback: UIConfig): UIConfig {
  return {
    textScale: data.text_scale ?? data.textScale ?? fallback.textScale,
    layers: data.layers ?? fallback.layers,
    theme: data.theme ?? fallback.theme,
    toastDurationMs: data.toast_duration_ms ?? data.toastDurationMs ?? fallback.toastDurationMs,
    toastMaxStack: data.toast_max_stack ?? data.toastMaxStack ?? fallback.toastMaxStack,
    hintCardDurationMs:
      data.hint_card_duration_ms ?? data.hintCardDurationMs ?? fallback.hintCardDurationMs,
    hintCardMaxLines:
      data.hint_card_max_lines ?? data.hintCardMaxLines ?? fallback.hintCardMaxLines,
    panelDefaultWidthPx:
      data.panel_default_width_px ?? data.panelDefaultWidthPx ?? fallback.panelDefaultWidthPx,
    panelAnimationMs: data.panel_animation_ms ?? data.panelAnimationMs ?? fallback.panelAnimationMs,
    reducedMotion: data.reduced_motion ?? data.reducedMotion ?? fallback.reducedMotion,
    safeAreaPaddingPx:
      data.safe_area_padding_px ?? data.safeAreaPaddingPx ?? fallback.safeAreaPaddingPx,
  };
}

function normalizeRootSightConfig(
  data: RootSightConfigResponse,
  fallback: RootSightConfig,
): RootSightConfig {
  return {
    cutawayRadius: data.cutaway_radius ?? data.cutawayRadius ?? fallback.cutawayRadius,
    transitionMs: data.transition_ms ?? data.transitionMs ?? fallback.transitionMs,
    soilOpacity: data.soil_opacity ?? data.soilOpacity ?? fallback.soilOpacity,
    ownRootHighlightColor:
      data.own_root_highlight_color ?? data.ownRootHighlightColor ?? fallback.ownRootHighlightColor,
    rivalRootHighlightColor:
      data.rival_root_highlight_color ??
      data.rivalRootHighlightColor ??
      fallback.rivalRootHighlightColor,
    substrateMultiplier:
      data.substrate_multiplier ?? data.substrateMultiplier ?? fallback.substrateMultiplier,
    cameraTarget: data.camera_target ?? data.cameraTarget ?? fallback.cameraTarget,
  };
}

async function fetchFlat<T>(serverOrigin: string, path: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(`${serverOrigin}${path}`, { cache: 'no-store' });
    if (response.ok) {
      const data = (await response.json()) as Record<string, unknown>;
      if (path === '/config/render') {
        return normalizeRenderConfig(data as RenderConfigResponse, fallback as RenderConfig) as T;
      }
      if (path === '/config/controls') {
        return normalizeControlsConfig(
          data as ControlsConfigResponse,
          fallback as ControlsConfig,
        ) as T;
      }
      if (path === '/config/ui') {
        return normalizeUIConfig(data as UIConfigResponse, fallback as UIConfig) as T;
      }
      if (path === '/config/root_sight') {
        return normalizeRootSightConfig(
          data as RootSightConfigResponse,
          fallback as RootSightConfig,
        ) as T;
      }
      return data as T;
    }
  } catch {
    // Fall through to defaults.
  }
  return fallback;
}

export async function loadRenderConfig(serverOrigin: string): Promise<RenderConfig> {
  return fetchFlat<RenderConfig>(serverOrigin, '/config/render', {
    targetFps: 60,
    fpsWarningThreshold: 0.85,
    resolutionFloor: 0.25,
    maxPixelRatio: 2.0,
    cameraSmoothing: 0.05,
    cameraMinDistance: 10.0,
    cameraMaxDistance: 200.0,
    cameraMaxPolarAngle: 1.52,
    idleDropTimeoutMs: 30000,
    shadowMapSize: 2048,
    debugOverlayEnabled: true,
    debugOverlayKey: '`',
    pauseOnHidden: true,
    qualityTiers: [
      {
        name: 'low',
        pixelRatio: 1.0,
        shadowMapSize: 1024,
        maxTriangles: 50000,
        antialiasing: false,
      },
      {
        name: 'medium',
        pixelRatio: 1.5,
        shadowMapSize: 2048,
        maxTriangles: 200000,
        antialiasing: true,
      },
      {
        name: 'high',
        pixelRatio: 2.0,
        shadowMapSize: 2048,
        maxTriangles: 500000,
        antialiasing: true,
      },
    ],
    skyZenithDay: '#4A7A96',
    skyHorizonDay: '#C8D6D4',
    skyZenithDusk: '#2A2038',
    skyHorizonDusk: '#D4553A',
    skyZenithNight: '#0B0E14',
    skyHorizonNight: '#1B202A',
    skyZenithRain: '#2E3A44',
    skyHorizonRain: '#5A6E7C',
    skyZenithStorm: '#181C22',
    skyHorizonStorm: '#2C333D',
    skyZenithTelegraph: '#242820',
    skyHorizonTelegraph: '#454A36',
    sunColorDay: '#FFFFEE',
    sunColorDusk: '#FFA066',
    sunColorNight: '#7088A8',
    sunIntensityDay: 1.4,
    sunIntensityNight: 0.15,
    ambientIntensityDay: 0.6,
    ambientIntensityNight: 0.15,
    fogNearClear: 70.0,
    fogFarClear: 320.0,
    fogNearRain: 25.0,
    fogFarRain: 160.0,
    fogNearStorm: 15.0,
    fogFarStorm: 100.0,
    rainParticleCount: 1500,
    rainParticleSpeed: 28.0,
    rainBoxWidth: 60.0,
    rainBoxHeight: 35.0,
    rainParticleSize: 0.25,
    lightningFlashDurationMs: 120,
    lightningIntensityBoost: 4.0,
    lightningMinIntervalS: 3.5,
    lightningMaxIntervalS: 9.0,
    soilDryColor: '#4A4536',
    soilWetColor: '#1B2014',
    soilMineralTint: '#5A8FA8',
    terrainMeshSubdivisions: 48,
    terrainRadius: 300.0,
  });
}

export async function loadControlsConfig(serverOrigin: string): Promise<ControlsConfig> {
  return fetchFlat<ControlsConfig>(serverOrigin, '/config/controls', {
    bindings: {},
    touchMinTargetPx: 44,
    hudMaxScreenFraction: 0.2,
    rootSightMode: 'toggle',
    textScale: 1.0,
    contextDockFadeMs: 150,
  });
}

export async function loadUIConfig(serverOrigin: string): Promise<UIConfig> {
  return fetchFlat<UIConfig>(serverOrigin, '/config/ui', {
    textScale: 1.0,
    layers: {
      world: 0,
      hud: 100,
      panel: 200,
      menu: 300,
      modal: 400,
      toast: 500,
      tooltip: 600,
      debug: 700,
    },
    theme: {},
    toastDurationMs: 4000,
    toastMaxStack: 5,
    hintCardDurationMs: 10000,
    hintCardMaxLines: 3,
    panelDefaultWidthPx: 320,
    panelAnimationMs: 200,
    reducedMotion: false,
    safeAreaPaddingPx: 8,
  });
}

export async function loadRootSightConfig(serverOrigin: string): Promise<RootSightConfig> {
  return fetchFlat<RootSightConfig>(serverOrigin, '/config/root_sight', {
    cutawayRadius: 50,
    transitionMs: 500,
    soilOpacity: 0.3,
    ownRootHighlightColor: '#4CAF50',
    rivalRootHighlightColor: '#FF5722',
    substrateMultiplier: 0.5,
    cameraTarget: 'own_plant',
  });
}
