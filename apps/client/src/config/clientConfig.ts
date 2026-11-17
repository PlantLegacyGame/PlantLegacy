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

import { type BenchmarkPose, DEFAULT_BENCHMARK_POSES } from '../dev/benchmark.js';

/** ADR-027: one organism size class, as framing and detail multipliers. */
export interface SizeClassConfig {
  id: string;
  cameraMaxDistanceMultiplier: number;
  detailedPlantBudgetMultiplier: number;
  lodSizeBias: number;
}

export interface RenderConfig {
  targetFps: number;
  fpsWarningThreshold: number;
  resolutionFloor: number;
  maxPixelRatio: number;
  /** AL-03: frame cost below which detail is restored, in ms. */
  gpuBandMinMs: number;
  /** AL-03: frame cost above which detail is spent, in ms. */
  gpuBandMaxMs: number;
  /** AL-03: minimum time between band decisions, in ms. */
  qualityHoldMs: number;
  /** AL-03: lowest draw-distance scale before the tier is lowered. */
  drawDistanceFloor: number;
  /** AL-03: cost is ignored for this long after the first sample, in ms. */
  qualityWarmupMs: number;
  /** AL-03: EMA weight for a new frame-cost sample, 0.01..1. */
  qualitySmoothing: number;
  /** AL-04: per-channel extinction per metre at sea level (linear RGB). */
  atmosphereExtinction: [number, number, number];
  /** AL-04: height over which air density falls by 1/e, in metres. */
  atmosphereScaleHeightM: number;
  /** AL-04: Henyey-Greenstein anisotropy, -1..1. */
  atmosphereSunPhaseG: number;
  /** AL-04: strength of sun in-scatter in the air. */
  atmosphereInScatter: number;
  /** AL-04: extra optical depth at grazing angles. */
  atmosphereHorizonBoost: number;
  /**
   * ADR-027: organism size classes. A giant is framed from further away and may
   * hold more detailed plants, because LOD assigns tiers by projected size.
   */
  sizeClasses: SizeClassConfig[];
  cameraSmoothing: number;
  cameraMinDistance: number;
  cameraMinDistanceRoot: number;
  cameraMaxDistance: number;
  cameraMaxPolarAngle: number;
  cameraCollisionEnabled: boolean;
  cameraCollisionMargin: number;
  cameraStartDistance: number;
  cameraPanSpeed: number;
  cameraZoomSpeed: number;
  idleDropTimeoutMs: number;
  shadowMapSize: number;
  shadowBias: number;
  shadowNormalBias: number;
  /** Radius of the planet the world sits on; 0 means a flat plane. */
  planetRadiusM: number;
  /** Orbit-view framing, as multiples of planetRadiusM. */
  planetViewDistanceMultiplier: number;
  planetViewFarMultiplier: number;
  planetViewMinDistanceMultiplier: number;
  planetViewNearMultiplier: number;
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
  /** Seconds for the ambient day/night fade; frame step is exp(-dt/tau). */
  ambientFadeTauS: number;
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
  rainStreakLength: number;
  rainStreakWidth: number;
  rainMaxVelocity: number;
  /** Horizontal drift of rain streaks per unit fallen. */
  rainSlant: number;
  /** Orbit radius that puts the directional light on the visual sun. */
  sunOrbitalDistance: number;
  /** Cross-fade between weather sky/fog presets. */
  weatherTransitionMs: number;
  /** Peak flash intensity the storm state emits. */
  lightningMaxIntensity: number;
  lightningFlashDurationMs: number;
  lightningIntensityBoost: number;
  soilDryColor: string;
  soilWetColor: string;
  soilMineralTint: string;
  soilGrainStrength: number;
  /** AL-04 dirt: dried fissures darkening the topsoil, 0..1. */
  soilCrackStrength: number;
  /** AL-04 dirt: rounded stones in colour and relief, 0..1. */
  soilPebbleStrength: number;
  soilMineralStrength: number;
  // Root Sight underground backdrop.
  undergroundViewColor: string;
  // Growth aim gizmo (ring + curved arrow) proportions, in metres / multiples.
  growthAimRingScale: number;
  growthAimRingThickness: number;
  growthAimRingMin: number;
  growthAimGrabPx: number;

  growthAimReachMin: number;
  growthAimTubeRadius: number;
  growthAimHeadRadius: number;
  growthAimHeadLength: number;
  growthAimTipRadius: number;
  growthAimCurveBend: number;
  growthAimCurveWobble: number;
  terrainMeshSubdivisions: number;
  terrainRadius: number;
  /** Peak height of the procedural ground relief, in metres. 0 = smooth sphere. */
  terrainAmplitudeM: number;
  /** Depth of the dirt layer under the surface, in metres. */
  soilDepthM: number;
  /** Minimum height the eye keeps above the terrain it is over, in metres. */
  cameraGroundClearanceM: number;
  /** Gravity for the player's vertical physics, in metres per second squared. */
  playerGravityMps2: number;
  /** How far above the ground the player spawns, in metres. */
  playerSpawnHeightM: number;
  rootAuraRadius: number;
  // C02b: WebGPU plant renderer
  webgpuEnabled: boolean;
  webgpuMaxPlants: number;
  webgpuTier0Threshold: number;
  webgpuTier1Threshold: number;
  webgpuTier2Threshold: number;
  webgpuTier3Threshold: number;
  webgpuHysteresisPromote: number;
  webgpuHysteresisDemote: number;
  webgpuMinDwellTime: number;
  // C01: Node picking for growth selection
  nodePickRadius: number;
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
  hudUpdateIntervalMs: number;
  damageVignetteMs: number;
  healthHealthyFraction: number;
  healthStressedFraction: number;
  healthWitheringFraction: number;
}

export interface RootSightConfig {
  cutawayRadius: number;
  transitionMs: number;
  soilOpacity: number;
  /** Hole radius as a fraction of `cutawayRadius` (`aperture_radius_ratio`). */
  apertureRadiusRatio: number;
  /** Floor for the hole radius in metres (`aperture_min_m`). */
  apertureMinM: number;
  ownRootHighlightColor: string;
  rivalRootHighlightColor: string;
  substrateMultiplier: number;
  cameraTarget: 'own_plant' | 'camera_position';
  maxCavityBubbles: number;
  bubbleMergeCellM: number;
  bubblePaddingM: number;
  rivalBubbleBudget: number;
  cameraBurrowEnabled: boolean;
  maxBurrowDepthM: number;
  cavityClearanceM: number;
  rebuildHz: number;
  cutRimDitherM: number;
  /** Smallest underground extent a cavity can be sized from, metres. */
  minExtentM: number;
  /** Progress below which the plant still counts as on the surface. */
  surfaceProgress: number;
  /** Smallest cutaway radius, so a seedling still opens a usable view. */
  minCutawayRadiusM: number;
  /** Pit width as a multiple of the root extent. */
  extentToRadius: number;
  /**
   * Open Root Sight by itself when a buried part starts growing. The R key
   * still owns the mode: a hand-close stands until the next buried part starts.
   */
  autoOpenOnRootGrowth: boolean;
  /**
   * Radius of the air bubble cut around a buried camera, metres. Zero leaves the
   * soil intact around the eye and Root Sight shows nothing from down there.
   */
  eyeWindowRadius: number;
}

export interface TerrainConfig {
  seed: number;
  surfaceAmplitudeM: number;
  surfaceBaseFrequency: number;
  surfaceOctaves: number;
  surfaceLacunarity: number;
  surfaceGain: number;
  ridgeStrength: number;
  patchRadiusM: number;
  rimFadeFraction: number;
  tileSizeM: number;
  tileVertices: number;
  lodDistancesM: number[];
  cellSizeM: number;
  chunkCells: number;
  maxActiveChunks: number;
  maxDepthM: number;
  surfaceBreakDepthM: number;
  maxEditVolumeM3: number;
  maxEditsPerTick: number;
  collapseCadenceHz: number;
  displacementRingCells: number;
  growthResistanceMin: number;
  growthResistanceMax: number;
  runoffFraction: number;
  evaporationPerS: number;
  rainAbsorptionPerS: number;
  /** River channel carved into the shared ground field (config/terrain.json). */
  riverEnabled: boolean;
  riverCenterZM: number;
  riverWidthM: number;
  riverDepthM: number;
  riverPathCellM: number;
  riverBankSlope: number;
  riverBankApronM: number;
  riverWaterDepthM: number;
  riverFlowSpeedMps: number;
  riverLengthM: number;
}

export interface PhysicsConfig {
  gravityMps2: number;
  fixedTimestepS: number;
  maxCollidersPerPlant: number;
  maxColliderPlants: number;
  colliderLodDistanceM: number;
  chainMergeMinNodes: number;
  leafColliderMode: 'none' | 'cuboid' | 'hull';
  jointColliders: boolean;
  colliderInflationM: number;
  debrisMaxBodies: number;
  cameraProbeRadiusM: number;
  colliderRebuildHz: number;
  rainDropRadiusM: number;
  rainDropMassKg: number;
}

export interface ChatConfig {
  proximityRangePx: number;
  worldRateMsgPerMin: number;
  logSize: number;
}

export interface NetworkConfig {
  slowRttMs: number;
  stallMs: number;
}

export interface ReportReason {
  id: string;
  label: string;
  category: string;
}

export interface ReportsConfig {
  reportReasons: ReportReason[];
  contextLineCount: number;
  reportFreeTextMax: number;
  reportRateLimitPerMin: number;
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

interface SizeClassResponse {
  id?: string;
  camera_max_distance_multiplier?: number;
  cameraMaxDistanceMultiplier?: number;
  detailed_plant_budget_multiplier?: number;
  detailedPlantBudgetMultiplier?: number;
  lod_size_bias?: number;
  lodSizeBias?: number;
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
  gpu_band_min_ms?: number;
  gpuBandMinMs?: number;
  gpu_band_max_ms?: number;
  gpuBandMaxMs?: number;
  quality_hold_ms?: number;
  qualityHoldMs?: number;
  quality_warmup_ms?: number;
  qualityWarmupMs?: number;
  quality_smoothing?: number;
  qualitySmoothing?: number;
  draw_distance_floor?: number;
  drawDistanceFloor?: number;
  atmosphere_extinction_r?: number;
  atmosphereExtinctionR?: number;
  atmosphere_extinction_g?: number;
  atmosphereExtinctionG?: number;
  atmosphere_extinction_b?: number;
  atmosphereExtinctionB?: number;
  atmosphere_scale_height_m?: number;
  atmosphereScaleHeightM?: number;
  atmosphere_sun_phase_g?: number;
  atmosphereSunPhaseG?: number;
  atmosphere_in_scatter?: number;
  atmosphereInScatter?: number;
  atmosphere_horizon_boost?: number;
  atmosphereHorizonBoost?: number;
  size_classes?: SizeClassResponse[];
  sizeClasses?: SizeClassResponse[];
  camera_smoothing?: number;
  cameraSmoothing?: number;
  camera_min_distance?: number;
  cameraMinDistance?: number;
  camera_min_distance_root?: number;
  cameraMinDistanceRoot?: number;
  camera_max_distance?: number;
  cameraMaxDistance?: number;
  camera_max_polar_angle?: number;
  cameraMaxPolarAngle?: number;
  camera_collision_enabled?: boolean;
  camera_collision_margin?: number;
  cameraCollisionEnabled?: boolean;
  cameraCollisionMargin?: number;
  camera_start_distance?: number;
  cameraStartDistance?: number;
  camera_pan_speed?: number;
  cameraPanSpeed?: number;
  camera_zoom_speed?: number;
  cameraZoomSpeed?: number;
  idle_drop_timeout_ms?: number;
  idleDropTimeoutMs?: number;
  shadow_map_size?: number;
  shadowMapSize?: number;
  shadow_bias?: number;
  shadowBias?: number;
  shadow_normal_bias?: number;
  shadowNormalBias?: number;
  planet_radius_m?: number;
  planetRadiusM?: number;
  planet_view_distance_multiplier?: number;
  planetViewDistanceMultiplier?: number;
  planet_view_far_multiplier?: number;
  planetViewFarMultiplier?: number;
  planet_view_min_distance_multiplier?: number;
  planetViewMinDistanceMultiplier?: number;
  planet_view_near_multiplier?: number;
  planetViewNearMultiplier?: number;
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
  ambient_fade_tau_s?: number;
  ambientFadeTauS?: number;
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
  rain_streak_length?: number;
  rainStreakLength?: number;
  rain_streak_width?: number;
  rainStreakWidth?: number;
  rain_max_velocity?: number;
  rainMaxVelocity?: number;
  lightning_flash_duration_ms?: number;
  lightningFlashDurationMs?: number;
  lightning_intensity_boost?: number;
  lightningIntensityBoost?: number;
  rain_slant?: number;
  rainSlant?: number;
  sun_orbital_distance?: number;
  sunOrbitalDistance?: number;
  weather_transition_ms?: number;
  weatherTransitionMs?: number;
  lightning_max_intensity?: number;
  lightningMaxIntensity?: number;
  soil_dry_color?: string;
  soilDryColor?: string;
  soil_wet_color?: string;
  soilWetColor?: string;
  soil_mineral_tint?: string;
  soilMineralTint?: string;
  soil_grain_strength?: number;
  soilGrainStrength?: number;
  soil_crack_strength?: number;
  soilCrackStrength?: number;
  soil_pebble_strength?: number;
  soilPebbleStrength?: number;
  soil_mineral_strength?: number;
  soilMineralStrength?: number;
  underground_view_color?: string;
  undergroundViewColor?: string;
  growth_aim_ring_scale?: number;
  growthAimRingScale?: number;
  growth_aim_ring_thickness?: number;
  growthAimRingThickness?: number;
  growth_aim_ring_min?: number;
  growthAimRingMin?: number;
  growth_aim_grab_px?: number;
  growthAimGrabPx?: number;

  growth_aim_reach_min?: number;
  growthAimReachMin?: number;
  growth_aim_tube_radius?: number;
  growthAimTubeRadius?: number;
  growth_aim_head_radius?: number;
  growthAimHeadRadius?: number;
  growth_aim_head_length?: number;
  growthAimHeadLength?: number;
  growth_aim_tip_radius?: number;
  growthAimTipRadius?: number;
  growth_aim_curve_bend?: number;
  growthAimCurveBend?: number;
  growth_aim_curve_wobble?: number;
  growthAimCurveWobble?: number;
  terrain_mesh_subdivisions?: number;
  terrainMeshSubdivisions?: number;
  terrain_radius?: number;
  terrainRadius?: number;
  terrain_amplitude_m?: number;
  terrainAmplitudeM?: number;
  soil_depth_m?: number;
  soilDepthM?: number;
  camera_ground_clearance_m?: number;
  cameraGroundClearanceM?: number;
  player_gravity_mps2?: number;
  playerGravityMps2?: number;
  player_spawn_height_m?: number;
  playerSpawnHeightM?: number;
  root_aura_radius?: number;
  rootAuraRadius?: number;
  webgpu_enabled?: boolean;
  webgpuEnabled?: boolean;
  webgpu_max_plants?: number;
  webgpuMaxPlants?: number;
  webgpu_tier0_threshold?: number;
  webgpuTier0Threshold?: number;
  webgpu_tier1_threshold?: number;
  webgpuTier1Threshold?: number;
  webgpu_tier2_threshold?: number;
  webgpuTier2Threshold?: number;
  webgpu_tier3_threshold?: number;
  webgpuTier3Threshold?: number;
  webgpu_hysteresis_promote?: number;
  webgpuHysteresisPromote?: number;
  webgpu_hysteresis_demote?: number;
  webgpuHysteresisDemote?: number;
  webgpu_min_dwell_time?: number;
  webgpuMinDwellTime?: number;
  node_pick_radius?: number;
  nodePickRadius?: number;
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
  hud_update_interval_ms?: number;
  hudUpdateIntervalMs?: number;
  damage_vignette_ms?: number;
  damageVignetteMs?: number;
  health_healthy_fraction?: number;
  healthHealthyFraction?: number;
  health_stressed_fraction?: number;
  healthStressedFraction?: number;
  health_withering_fraction?: number;
  healthWitheringFraction?: number;
}

interface RootSightConfigResponse {
  cutaway_radius?: number;
  cutawayRadius?: number;
  transition_ms?: number;
  transitionMs?: number;
  soil_opacity?: number;
  soilOpacity?: number;
  aperture_radius_ratio?: number;
  apertureRadiusRatio?: number;
  aperture_min_m?: number;
  apertureMinM?: number;
  own_root_highlight_color?: string;
  ownRootHighlightColor?: string;
  rival_root_highlight_color?: string;
  rivalRootHighlightColor?: string;
  substrate_multiplier?: number;
  substrateMultiplier?: number;
  camera_target?: 'own_plant' | 'camera_position';
  cameraTarget?: 'own_plant' | 'camera_position';
  max_cavity_bubbles?: number;
  maxCavityBubbles?: number;
  bubble_merge_cell_m?: number;
  bubbleMergeCellM?: number;
  bubble_padding_m?: number;
  bubblePaddingM?: number;
  rival_bubble_budget?: number;
  rivalBubbleBudget?: number;
  camera_burrow_enabled?: boolean;
  cameraBurrowEnabled?: boolean;
  max_burrow_depth_m?: number;
  maxBurrowDepthM?: number;
  cavity_clearance_m?: number;
  cavityClearanceM?: number;
  rebuild_hz?: number;
  rebuildHz?: number;
  cut_rim_dither_m?: number;
  cutRimDitherM?: number;
  min_extent_m?: number;
  minExtentM?: number;
  surface_progress?: number;
  surfaceProgress?: number;
  min_cutaway_radius_m?: number;
  minCutawayRadiusM?: number;
  extent_to_radius?: number;
  extentToRadius?: number;
  auto_open_on_root_growth?: boolean;
  eye_window_radius_m?: number;
  eyeWindowRadius?: number;
}

/**
 * Size classes arrive either snake_case from `/config/render` or already
 * normalised from the fallback; both shapes resolve to one list.
 */
function normalizeSizeClasses(
  entries: ReadonlyArray<SizeClassResponse | SizeClassConfig>,
): SizeClassConfig[] {
  return entries.map((entry) => {
    const raw = entry as SizeClassResponse & SizeClassConfig;
    return {
      id: raw.id ?? 'normal',
      cameraMaxDistanceMultiplier:
        raw.camera_max_distance_multiplier ?? raw.cameraMaxDistanceMultiplier ?? 1,
      detailedPlantBudgetMultiplier:
        raw.detailed_plant_budget_multiplier ?? raw.detailedPlantBudgetMultiplier ?? 1,
      lodSizeBias: raw.lod_size_bias ?? raw.lodSizeBias ?? 1,
    };
  });
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
    gpuBandMinMs: data.gpu_band_min_ms ?? data.gpuBandMinMs ?? fallback.gpuBandMinMs,
    gpuBandMaxMs: data.gpu_band_max_ms ?? data.gpuBandMaxMs ?? fallback.gpuBandMaxMs,
    qualityHoldMs: data.quality_hold_ms ?? data.qualityHoldMs ?? fallback.qualityHoldMs,
    qualityWarmupMs: Math.max(
      0,
      data.quality_warmup_ms ?? data.qualityWarmupMs ?? fallback.qualityWarmupMs,
    ),
    qualitySmoothing: Math.max(
      0.01,
      Math.min(1, data.quality_smoothing ?? data.qualitySmoothing ?? fallback.qualitySmoothing),
    ),
    drawDistanceFloor:
      data.draw_distance_floor ?? data.drawDistanceFloor ?? fallback.drawDistanceFloor,
    atmosphereExtinction: [
      Math.max(
        0,
        data.atmosphere_extinction_r ??
          data.atmosphereExtinctionR ??
          fallback.atmosphereExtinction[0],
      ),
      Math.max(
        0,
        data.atmosphere_extinction_g ??
          data.atmosphereExtinctionG ??
          fallback.atmosphereExtinction[1],
      ),
      Math.max(
        0,
        data.atmosphere_extinction_b ??
          data.atmosphereExtinctionB ??
          fallback.atmosphereExtinction[2],
      ),
    ],
    atmosphereScaleHeightM: Math.max(
      1,
      data.atmosphere_scale_height_m ??
        data.atmosphereScaleHeightM ??
        fallback.atmosphereScaleHeightM,
    ),
    atmosphereSunPhaseG: Math.max(
      -0.95,
      Math.min(
        0.95,
        data.atmosphere_sun_phase_g ?? data.atmosphereSunPhaseG ?? fallback.atmosphereSunPhaseG,
      ),
    ),
    atmosphereInScatter: Math.max(
      0,
      data.atmosphere_in_scatter ?? data.atmosphereInScatter ?? fallback.atmosphereInScatter,
    ),
    atmosphereHorizonBoost: Math.max(
      0,
      data.atmosphere_horizon_boost ??
        data.atmosphereHorizonBoost ??
        fallback.atmosphereHorizonBoost,
    ),
    sizeClasses: normalizeSizeClasses(
      data.size_classes ?? data.sizeClasses ?? fallback.sizeClasses,
    ),
    cameraSmoothing: data.camera_smoothing ?? data.cameraSmoothing ?? fallback.cameraSmoothing,
    cameraMinDistance:
      data.camera_min_distance ?? data.cameraMinDistance ?? fallback.cameraMinDistance,
    cameraMinDistanceRoot:
      data.camera_min_distance_root ?? data.cameraMinDistanceRoot ?? fallback.cameraMinDistanceRoot,
    cameraMaxDistance:
      data.camera_max_distance ?? data.cameraMaxDistance ?? fallback.cameraMaxDistance,
    cameraMaxPolarAngle:
      data.camera_max_polar_angle ?? data.cameraMaxPolarAngle ?? fallback.cameraMaxPolarAngle,
    cameraCollisionEnabled:
      data.camera_collision_enabled ??
      data.cameraCollisionEnabled ??
      fallback.cameraCollisionEnabled,
    cameraCollisionMargin:
      data.camera_collision_margin ?? data.cameraCollisionMargin ?? fallback.cameraCollisionMargin,
    cameraStartDistance:
      data.camera_start_distance ?? data.cameraStartDistance ?? fallback.cameraStartDistance,
    cameraPanSpeed: data.camera_pan_speed ?? data.cameraPanSpeed ?? fallback.cameraPanSpeed,
    cameraZoomSpeed: data.camera_zoom_speed ?? data.cameraZoomSpeed ?? fallback.cameraZoomSpeed,
    idleDropTimeoutMs:
      data.idle_drop_timeout_ms ?? data.idleDropTimeoutMs ?? fallback.idleDropTimeoutMs,
    shadowMapSize: data.shadow_map_size ?? data.shadowMapSize ?? fallback.shadowMapSize,
    shadowBias: data.shadow_bias ?? data.shadowBias ?? fallback.shadowBias,
    shadowNormalBias: data.shadow_normal_bias ?? data.shadowNormalBias ?? fallback.shadowNormalBias,
    planetRadiusM: data.planet_radius_m ?? data.planetRadiusM ?? fallback.planetRadiusM,
    planetViewDistanceMultiplier:
      data.planet_view_distance_multiplier ??
      data.planetViewDistanceMultiplier ??
      fallback.planetViewDistanceMultiplier,
    planetViewFarMultiplier:
      data.planet_view_far_multiplier ??
      data.planetViewFarMultiplier ??
      fallback.planetViewFarMultiplier,
    planetViewMinDistanceMultiplier:
      data.planet_view_min_distance_multiplier ??
      data.planetViewMinDistanceMultiplier ??
      fallback.planetViewMinDistanceMultiplier,
    planetViewNearMultiplier:
      data.planet_view_near_multiplier ??
      data.planetViewNearMultiplier ??
      fallback.planetViewNearMultiplier,
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
    ambientFadeTauS: data.ambient_fade_tau_s ?? data.ambientFadeTauS ?? fallback.ambientFadeTauS,
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
    rainStreakLength: data.rain_streak_length ?? data.rainStreakLength ?? fallback.rainStreakLength,
    rainStreakWidth: data.rain_streak_width ?? data.rainStreakWidth ?? fallback.rainStreakWidth,
    rainMaxVelocity: data.rain_max_velocity ?? data.rainMaxVelocity ?? fallback.rainMaxVelocity,
    lightningFlashDurationMs:
      data.lightning_flash_duration_ms ??
      data.lightningFlashDurationMs ??
      fallback.lightningFlashDurationMs,
    lightningIntensityBoost:
      data.lightning_intensity_boost ??
      data.lightningIntensityBoost ??
      fallback.lightningIntensityBoost,
    rainSlant: data.rain_slant ?? data.rainSlant ?? fallback.rainSlant,
    sunOrbitalDistance:
      data.sun_orbital_distance ?? data.sunOrbitalDistance ?? fallback.sunOrbitalDistance,
    weatherTransitionMs:
      data.weather_transition_ms ?? data.weatherTransitionMs ?? fallback.weatherTransitionMs,
    lightningMaxIntensity:
      data.lightning_max_intensity ?? data.lightningMaxIntensity ?? fallback.lightningMaxIntensity,
    soilDryColor: data.soil_dry_color ?? data.soilDryColor ?? fallback.soilDryColor,
    soilWetColor: data.soil_wet_color ?? data.soilWetColor ?? fallback.soilWetColor,
    soilMineralTint: data.soil_mineral_tint ?? data.soilMineralTint ?? fallback.soilMineralTint,
    soilGrainStrength:
      data.soil_grain_strength ?? data.soilGrainStrength ?? fallback.soilGrainStrength,
    soilCrackStrength: Math.max(
      0,
      Math.min(1, data.soil_crack_strength ?? data.soilCrackStrength ?? fallback.soilCrackStrength),
    ),
    soilPebbleStrength: Math.max(
      0,
      Math.min(
        1,
        data.soil_pebble_strength ?? data.soilPebbleStrength ?? fallback.soilPebbleStrength,
      ),
    ),
    soilMineralStrength:
      data.soil_mineral_strength ?? data.soilMineralStrength ?? fallback.soilMineralStrength,
    undergroundViewColor:
      data.underground_view_color ?? data.undergroundViewColor ?? fallback.undergroundViewColor,
    growthAimRingScale:
      data.growth_aim_ring_scale ?? data.growthAimRingScale ?? fallback.growthAimRingScale,
    growthAimRingThickness:
      data.growth_aim_ring_thickness ??
      data.growthAimRingThickness ??
      fallback.growthAimRingThickness,
    growthAimRingMin:
      data.growth_aim_ring_min ?? data.growthAimRingMin ?? fallback.growthAimRingMin,
    growthAimGrabPx: data.growth_aim_grab_px ?? data.growthAimGrabPx ?? fallback.growthAimGrabPx,

    growthAimReachMin:
      data.growth_aim_reach_min ?? data.growthAimReachMin ?? fallback.growthAimReachMin,
    growthAimTubeRadius:
      data.growth_aim_tube_radius ?? data.growthAimTubeRadius ?? fallback.growthAimTubeRadius,
    growthAimHeadRadius:
      data.growth_aim_head_radius ?? data.growthAimHeadRadius ?? fallback.growthAimHeadRadius,
    growthAimHeadLength:
      data.growth_aim_head_length ?? data.growthAimHeadLength ?? fallback.growthAimHeadLength,
    growthAimTipRadius:
      data.growth_aim_tip_radius ?? data.growthAimTipRadius ?? fallback.growthAimTipRadius,
    growthAimCurveBend:
      data.growth_aim_curve_bend ?? data.growthAimCurveBend ?? fallback.growthAimCurveBend,
    growthAimCurveWobble:
      data.growth_aim_curve_wobble ?? data.growthAimCurveWobble ?? fallback.growthAimCurveWobble,
    terrainMeshSubdivisions:
      data.terrain_mesh_subdivisions ??
      data.terrainMeshSubdivisions ??
      fallback.terrainMeshSubdivisions,
    terrainRadius: data.terrain_radius ?? data.terrainRadius ?? fallback.terrainRadius,
    terrainAmplitudeM:
      data.terrain_amplitude_m ?? data.terrainAmplitudeM ?? fallback.terrainAmplitudeM,
    soilDepthM: data.soil_depth_m ?? data.soilDepthM ?? fallback.soilDepthM,
    cameraGroundClearanceM:
      data.camera_ground_clearance_m ??
      data.cameraGroundClearanceM ??
      fallback.cameraGroundClearanceM,
    playerGravityMps2:
      data.player_gravity_mps2 ?? data.playerGravityMps2 ?? fallback.playerGravityMps2,
    playerSpawnHeightM:
      data.player_spawn_height_m ?? data.playerSpawnHeightM ?? fallback.playerSpawnHeightM,
    rootAuraRadius: data.root_aura_radius ?? data.rootAuraRadius ?? fallback.rootAuraRadius,
    webgpuEnabled: data.webgpu_enabled ?? data.webgpuEnabled ?? fallback.webgpuEnabled,
    webgpuMaxPlants: data.webgpu_max_plants ?? data.webgpuMaxPlants ?? fallback.webgpuMaxPlants,
    webgpuTier0Threshold:
      data.webgpu_tier0_threshold ?? data.webgpuTier0Threshold ?? fallback.webgpuTier0Threshold,
    webgpuTier1Threshold:
      data.webgpu_tier1_threshold ?? data.webgpuTier1Threshold ?? fallback.webgpuTier1Threshold,
    webgpuTier2Threshold:
      data.webgpu_tier2_threshold ?? data.webgpuTier2Threshold ?? fallback.webgpuTier2Threshold,
    webgpuTier3Threshold:
      data.webgpu_tier3_threshold ?? data.webgpuTier3Threshold ?? fallback.webgpuTier3Threshold,
    webgpuHysteresisPromote:
      data.webgpu_hysteresis_promote ??
      data.webgpuHysteresisPromote ??
      fallback.webgpuHysteresisPromote,
    webgpuHysteresisDemote:
      data.webgpu_hysteresis_demote ??
      data.webgpuHysteresisDemote ??
      fallback.webgpuHysteresisDemote,
    webgpuMinDwellTime:
      data.webgpu_min_dwell_time ?? data.webgpuMinDwellTime ?? fallback.webgpuMinDwellTime,
    nodePickRadius: data.node_pick_radius ?? data.nodePickRadius ?? fallback.nodePickRadius,
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
    hudUpdateIntervalMs:
      data.hud_update_interval_ms ?? data.hudUpdateIntervalMs ?? fallback.hudUpdateIntervalMs,
    damageVignetteMs: data.damage_vignette_ms ?? data.damageVignetteMs ?? fallback.damageVignetteMs,
    healthHealthyFraction:
      data.health_healthy_fraction ?? data.healthHealthyFraction ?? fallback.healthHealthyFraction,
    healthStressedFraction:
      data.health_stressed_fraction ??
      data.healthStressedFraction ??
      fallback.healthStressedFraction,
    healthWitheringFraction:
      data.health_withering_fraction ??
      data.healthWitheringFraction ??
      fallback.healthWitheringFraction,
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
    apertureRadiusRatio:
      data.aperture_radius_ratio ?? data.apertureRadiusRatio ?? fallback.apertureRadiusRatio,
    apertureMinM: data.aperture_min_m ?? data.apertureMinM ?? fallback.apertureMinM,
    ownRootHighlightColor:
      data.own_root_highlight_color ?? data.ownRootHighlightColor ?? fallback.ownRootHighlightColor,
    rivalRootHighlightColor:
      data.rival_root_highlight_color ??
      data.rivalRootHighlightColor ??
      fallback.rivalRootHighlightColor,
    substrateMultiplier:
      data.substrate_multiplier ?? data.substrateMultiplier ?? fallback.substrateMultiplier,
    cameraTarget: data.camera_target ?? data.cameraTarget ?? fallback.cameraTarget,
    maxCavityBubbles: data.max_cavity_bubbles ?? data.maxCavityBubbles ?? fallback.maxCavityBubbles,
    bubbleMergeCellM:
      data.bubble_merge_cell_m ?? data.bubbleMergeCellM ?? fallback.bubbleMergeCellM,
    bubblePaddingM: data.bubble_padding_m ?? data.bubblePaddingM ?? fallback.bubblePaddingM,
    rivalBubbleBudget:
      data.rival_bubble_budget ?? data.rivalBubbleBudget ?? fallback.rivalBubbleBudget,
    cameraBurrowEnabled:
      data.camera_burrow_enabled ?? data.cameraBurrowEnabled ?? fallback.cameraBurrowEnabled,
    maxBurrowDepthM: data.max_burrow_depth_m ?? data.maxBurrowDepthM ?? fallback.maxBurrowDepthM,
    cavityClearanceM: data.cavity_clearance_m ?? data.cavityClearanceM ?? fallback.cavityClearanceM,
    rebuildHz: data.rebuild_hz ?? data.rebuildHz ?? fallback.rebuildHz,
    cutRimDitherM: data.cut_rim_dither_m ?? data.cutRimDitherM ?? fallback.cutRimDitherM,
    minExtentM: data.min_extent_m ?? data.minExtentM ?? fallback.minExtentM,
    surfaceProgress: data.surface_progress ?? data.surfaceProgress ?? fallback.surfaceProgress,
    minCutawayRadiusM:
      data.min_cutaway_radius_m ?? data.minCutawayRadiusM ?? fallback.minCutawayRadiusM,
    extentToRadius: data.extent_to_radius ?? data.extentToRadius ?? fallback.extentToRadius,
    autoOpenOnRootGrowth: data.auto_open_on_root_growth ?? fallback.autoOpenOnRootGrowth,
    eyeWindowRadius: data.eye_window_radius_m ?? data.eyeWindowRadius ?? fallback.eyeWindowRadius,
  };
}

function normalizeChatConfig(data: Record<string, unknown>, fallback: ChatConfig): ChatConfig {
  return {
    proximityRangePx: Number(data.proximity_range_px ?? fallback.proximityRangePx),
    worldRateMsgPerMin: Number(data.world_rate_msg_per_min ?? fallback.worldRateMsgPerMin),
    logSize: Number(data.log_size ?? fallback.logSize),
  };
}

function normalizeReportsConfig(
  data: Record<string, unknown>,
  fallback: ReportsConfig,
): ReportsConfig {
  return {
    reportReasons: Array.isArray(data.report_reasons)
      ? data.report_reasons
      : fallback.reportReasons,
    contextLineCount: Number(data.context_line_count ?? fallback.contextLineCount),
    reportFreeTextMax: Number(data.report_free_text_max ?? fallback.reportFreeTextMax),
    reportRateLimitPerMin: Number(data.report_rate_limit_per_min ?? fallback.reportRateLimitPerMin),
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
      if (path === '/config/chat') {
        return normalizeChatConfig(data, fallback as ChatConfig) as T;
      }
      if (path === '/config/reports') {
        return normalizeReportsConfig(data, fallback as ReportsConfig) as T;
      }
      return data as T;
    }
  } catch {
    // Fall through to defaults.
  }
  return fallback;
}

export interface GrowthSegmentConfig {
  rootSegmentLength: number;
  canopySegmentLength: number;
  nodeLengths: Record<string, number>;
}

/** One real growth step per layer, used to draw a to-scale aim preview. */
export async function loadGrowthSegmentConfig(serverOrigin: string): Promise<GrowthSegmentConfig> {
  try {
    const response = await fetch(`${serverOrigin}/config/growth`, { cache: 'no-store' });
    if (response.ok) {
      const data = (await response.json()) as {
        root_growth_speed?: number;
        canopy_growth_speed?: number;
        rootGrowthSpeed?: number;
        canopyGrowthSpeed?: number;
        node_lengths?: Record<string, number>;
        nodeLengths?: Record<string, number>;
      };
      return {
        rootSegmentLength: data.root_growth_speed ?? data.rootGrowthSpeed ?? 0.85,
        canopySegmentLength: data.canopy_growth_speed ?? data.canopyGrowthSpeed ?? 0.95,
        nodeLengths: data.node_lengths ?? data.nodeLengths ?? {},
      };
    }
  } catch {
    // Fall through to the defaults.
  }
  return { rootSegmentLength: 0.85, canopySegmentLength: 0.95, nodeLengths: {} };
}

export async function loadRenderConfig(serverOrigin: string): Promise<RenderConfig> {
  return fetchFlat<RenderConfig>(serverOrigin, '/config/render', {
    targetFps: 60,
    fpsWarningThreshold: 0.85,
    resolutionFloor: 0.25,
    maxPixelRatio: 2.0,
    gpuBandMinMs: 10.0,
    gpuBandMaxMs: 13.6,
    qualityHoldMs: 600,
    qualityWarmupMs: 4000,
    qualitySmoothing: 0.12,
    drawDistanceFloor: 0.5,
    atmosphereExtinction: [0.00075, 0.0009, 0.0013],
    atmosphereScaleHeightM: 700,
    atmosphereSunPhaseG: 0.72,
    atmosphereInScatter: 0.6,
    atmosphereHorizonBoost: 0.4,
    sizeClasses: [
      {
        id: 'normal',
        cameraMaxDistanceMultiplier: 1,
        detailedPlantBudgetMultiplier: 1,
        lodSizeBias: 1,
      },
      {
        id: 'large',
        cameraMaxDistanceMultiplier: 2,
        detailedPlantBudgetMultiplier: 2,
        lodSizeBias: 1.5,
      },
      {
        id: 'giant',
        cameraMaxDistanceMultiplier: 4,
        detailedPlantBudgetMultiplier: 2.5,
        lodSizeBias: 2,
      },
    ],
    cameraSmoothing: 0.05,
    cameraMinDistance: 10.0,
    cameraMinDistanceRoot: 0.15,
    cameraMaxDistance: 200.0,
    cameraMaxPolarAngle: 1.52,
    cameraCollisionEnabled: true,
    cameraCollisionMargin: 0.3,
    cameraStartDistance: 6.0,
    cameraPanSpeed: 8.0,
    cameraZoomSpeed: 2.0,
    idleDropTimeoutMs: 30000,
    shadowMapSize: 2048,
    shadowBias: -0.0005,
    shadowNormalBias: 0.5,
    planetRadiusM: 100000,
    planetViewDistanceMultiplier: 3.0,
    planetViewFarMultiplier: 12.0,
    planetViewMinDistanceMultiplier: 1.4,
    planetViewNearMultiplier: 0.01,
    debugOverlayEnabled: true,
    debugOverlayKey: 'Shift',
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
    ambientFadeTauS: 0.35,
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
    rainStreakLength: 25.0,
    rainStreakWidth: 0.02,
    rainMaxVelocity: 35.0,
    rainSlant: 0.12,
    sunOrbitalDistance: 120.0,
    weatherTransitionMs: 6000,
    lightningMaxIntensity: 1.0,
    lightningFlashDurationMs: 120,
    lightningIntensityBoost: 4.0,
    soilDryColor: '#6B5539',
    soilWetColor: '#2E2418',
    soilMineralTint: '#5A8FA8',
    soilGrainStrength: 0.02,
    soilCrackStrength: 0.32,
    soilPebbleStrength: 0.28,
    soilMineralStrength: 0.05,
    undergroundViewColor: '#241D16',
    growthAimRingScale: 1.6,
    growthAimRingThickness: 0.004,
    growthAimRingMin: 0.02,
    growthAimGrabPx: 34,

    growthAimReachMin: 0.22,
    growthAimTubeRadius: 0.009,
    growthAimHeadRadius: 0.032,
    growthAimHeadLength: 0.095,
    growthAimTipRadius: 0.014,
    growthAimCurveBend: 0.24,
    growthAimCurveWobble: 0.05,
    terrainMeshSubdivisions: 256,
    terrainRadius: 300.0,
    terrainAmplitudeM: 2.4,
    soilDepthM: 1.6,
    cameraGroundClearanceM: 0.3,
    playerGravityMps2: 9.81,
    playerSpawnHeightM: 3.5,
    rootAuraRadius: 3.0,
    webgpuEnabled: false,
    webgpuMaxPlants: 10000,
    webgpuTier0Threshold: 300,
    webgpuTier1Threshold: 80,
    webgpuTier2Threshold: 12,
    webgpuTier3Threshold: 2,
    webgpuHysteresisPromote: 1.15,
    webgpuHysteresisDemote: 0.85,
    webgpuMinDwellTime: 0.5,
    nodePickRadius: 0.35,
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
    hudUpdateIntervalMs: 100,
    damageVignetteMs: 420,
    healthHealthyFraction: 0.75,
    healthStressedFraction: 0.5,
    healthWitheringFraction: 0.25,
  });
}

export async function loadRootSightConfig(serverOrigin: string): Promise<RootSightConfig> {
  return fetchFlat<RootSightConfig>(serverOrigin, '/config/root_sight', {
    cutawayRadius: 7,
    transitionMs: 500,
    soilOpacity: 0.45,
    apertureRadiusRatio: 0.7,
    apertureMinM: 0.28,
    ownRootHighlightColor: '#4CAF50',
    rivalRootHighlightColor: '#FF5722',
    substrateMultiplier: 0.5,
    cameraTarget: 'own_plant',
    maxCavityBubbles: 64,
    bubbleMergeCellM: 0.6,
    bubblePaddingM: 0.12,
    rivalBubbleBudget: 24,
    cameraBurrowEnabled: true,
    maxBurrowDepthM: 12,
    cavityClearanceM: 0.2,
    rebuildHz: 10,
    cutRimDitherM: 0.35,
    minExtentM: 0.05,
    surfaceProgress: 0.001,
    minCutawayRadiusM: 0.7,
    extentToRadius: 1.6,
    autoOpenOnRootGrowth: true,
    eyeWindowRadius: 1.1,
  });
}

export async function loadTerrainConfig(serverOrigin: string): Promise<TerrainConfig> {
  const fallback: TerrainConfig = {
    seed: 1337,
    surfaceAmplitudeM: 6,
    surfaceBaseFrequency: 0.045,
    surfaceOctaves: 4,
    surfaceLacunarity: 2,
    surfaceGain: 0.5,
    ridgeStrength: 0.35,
    patchRadiusM: 620,
    rimFadeFraction: 0.28,
    tileSizeM: 16,
    tileVertices: 17,
    lodDistancesM: [48, 120, 280, 620],
    cellSizeM: 0.5,
    chunkCells: 32,
    maxActiveChunks: 64,
    maxDepthM: 12,
    surfaceBreakDepthM: 0.8,
    maxEditVolumeM3: 4,
    maxEditsPerTick: 16,
    collapseCadenceHz: 2,
    displacementRingCells: 3,
    growthResistanceMin: 0.4,
    growthResistanceMax: 2.5,
    runoffFraction: 0.15,
    evaporationPerS: 0.002,
    rainAbsorptionPerS: 0.05,
    riverEnabled: true,
    riverCenterZM: 0,
    riverWidthM: 7,
    riverDepthM: 1.2,
    riverPathCellM: 2,
    riverBankSlope: 0.9,
    riverBankApronM: 12,
    riverWaterDepthM: 0.35,
    riverFlowSpeedMps: 1.4,
    riverLengthM: 320,
  };
  try {
    const response = await fetch(`${serverOrigin}/config/terrain`, { cache: 'no-store' });
    if (!response.ok) return fallback;
    const data = (await response.json()) as Record<string, unknown>;
    const num = (key: string, value: number): number => {
      const parsed = Number(data[key]);
      return Number.isFinite(parsed) ? parsed : value;
    };
    const lod = Array.isArray(data.lod_distances_m)
      ? (data.lod_distances_m as unknown[]).map(Number).filter((n) => Number.isFinite(n))
      : fallback.lodDistancesM;
    return {
      seed: num('seed', fallback.seed),
      surfaceAmplitudeM: num('surface_amplitude_m', fallback.surfaceAmplitudeM),
      surfaceBaseFrequency: num('surface_base_frequency', fallback.surfaceBaseFrequency),
      surfaceOctaves: num('surface_octaves', fallback.surfaceOctaves),
      surfaceLacunarity: num('surface_lacunarity', fallback.surfaceLacunarity),
      surfaceGain: num('surface_gain', fallback.surfaceGain),
      ridgeStrength: num('ridge_strength', fallback.ridgeStrength),
      patchRadiusM: num('patch_radius_m', fallback.patchRadiusM),
      rimFadeFraction: num('rim_fade_fraction', fallback.rimFadeFraction),
      tileSizeM: num('tile_size_m', fallback.tileSizeM),
      tileVertices: num('tile_vertices', fallback.tileVertices),
      lodDistancesM: lod.length > 0 ? lod : fallback.lodDistancesM,
      cellSizeM: num('cell_size_m', fallback.cellSizeM),
      chunkCells: num('chunk_cells', fallback.chunkCells),
      maxActiveChunks: num('max_active_chunks', fallback.maxActiveChunks),
      maxDepthM: num('max_depth_m', fallback.maxDepthM),
      surfaceBreakDepthM: num('surface_break_depth_m', fallback.surfaceBreakDepthM),
      maxEditVolumeM3: num('max_edit_volume_m3', fallback.maxEditVolumeM3),
      maxEditsPerTick: num('max_edits_per_tick', fallback.maxEditsPerTick),
      collapseCadenceHz: num('collapse_cadence_hz', fallback.collapseCadenceHz),
      displacementRingCells: num('displacement_ring_cells', fallback.displacementRingCells),
      growthResistanceMin: num('growth_resistance_min', fallback.growthResistanceMin),
      growthResistanceMax: num('growth_resistance_max', fallback.growthResistanceMax),
      runoffFraction: num('runoff_fraction', fallback.runoffFraction),
      riverEnabled:
        typeof data.river_enabled === 'boolean'
          ? data.river_enabled
          : (fallback.riverEnabled ?? true),
      riverCenterZM: num('river_center_z_m', fallback.riverCenterZM ?? 0),
      riverWidthM: num('river_width_m', fallback.riverWidthM ?? 7),
      riverDepthM: num('river_depth_m', fallback.riverDepthM ?? 1.2),
      riverPathCellM: num('river_path_cell_m', fallback.riverPathCellM ?? 2),
      riverBankSlope: num('river_bank_slope', fallback.riverBankSlope ?? 0.9),
      riverBankApronM: num('river_bank_apron_m', fallback.riverBankApronM ?? 12),
      riverWaterDepthM: num('river_water_depth_m', fallback.riverWaterDepthM ?? 0.35),
      riverFlowSpeedMps: num('river_flow_speed_mps', fallback.riverFlowSpeedMps ?? 1.4),
      riverLengthM: num('river_length_m', fallback.riverLengthM ?? 320),
      evaporationPerS: num('evaporation_per_s', fallback.evaporationPerS),
      rainAbsorptionPerS: num('rain_absorption_per_s', fallback.rainAbsorptionPerS),
    };
  } catch {
    return fallback;
  }
}

export async function loadPhysicsConfig(serverOrigin: string): Promise<PhysicsConfig> {
  const fallback: PhysicsConfig = {
    gravityMps2: 9.81,
    fixedTimestepS: 1 / 60,
    maxCollidersPerPlant: 192,
    maxColliderPlants: 24,
    colliderLodDistanceM: 70,
    chainMergeMinNodes: 3,
    leafColliderMode: 'cuboid',
    jointColliders: false,
    colliderInflationM: 0.005,
    debrisMaxBodies: 24,
    cameraProbeRadiusM: 0.25,
    colliderRebuildHz: 10,
    rainDropRadiusM: 0.03,
    rainDropMassKg: 0.001,
  };
  try {
    const response = await fetch(`${serverOrigin}/config/physics`, { cache: 'no-store' });
    if (!response.ok) return fallback;
    const data = (await response.json()) as Record<string, unknown>;
    const num = (key: string, value: number): number => {
      const parsed = Number(data[key]);
      return Number.isFinite(parsed) ? parsed : value;
    };
    const mode = String(data.leaf_collider_mode ?? fallback.leafColliderMode);
    return {
      gravityMps2: num('gravity_mps2', fallback.gravityMps2),
      fixedTimestepS: num('fixed_timestep_s', fallback.fixedTimestepS),
      maxCollidersPerPlant: num('max_colliders_per_plant', fallback.maxCollidersPerPlant),
      maxColliderPlants: num('max_collider_plants', fallback.maxColliderPlants),
      colliderLodDistanceM: num('collider_lod_distance_m', fallback.colliderLodDistanceM),
      chainMergeMinNodes: num('chain_merge_min_nodes', fallback.chainMergeMinNodes),
      leafColliderMode:
        mode === 'none' || mode === 'hull' || mode === 'cuboid' ? mode : fallback.leafColliderMode,
      jointColliders:
        typeof data.joint_colliders === 'boolean' ? data.joint_colliders : fallback.jointColliders,
      colliderInflationM: num('collider_inflation_m', fallback.colliderInflationM),
      debrisMaxBodies: num('debris_max_bodies', fallback.debrisMaxBodies),
      cameraProbeRadiusM: num('camera_probe_radius_m', fallback.cameraProbeRadiusM),
      colliderRebuildHz: num('collider_rebuild_hz', fallback.colliderRebuildHz),
      rainDropRadiusM: num('rain_drop_radius_m', fallback.rainDropRadiusM),
      rainDropMassKg: num('rain_drop_mass_kg', fallback.rainDropMassKg),
    };
  } catch {
    return fallback;
  }
}

export async function loadNetworkConfig(serverOrigin: string): Promise<NetworkConfig> {
  const raw = await fetchFlat<Record<string, unknown>>(serverOrigin, '/config/network', {});
  const positive = (key: string, fallback: number): number => {
    const value = Number(raw[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    slowRttMs: positive('client_slow_rtt_ms', 1200),
    stallMs: positive('client_stall_ms', 12000),
  };
}

export async function loadChatConfig(serverOrigin: string): Promise<ChatConfig> {
  return fetchFlat<ChatConfig>(serverOrigin, '/config/chat', {
    proximityRangePx: 150,
    worldRateMsgPerMin: 12,
    logSize: 200,
  });
}

export interface DayNightConfig {
  /** Full day + night cycle, in seconds (config/daynight.json cycle_length_s). */
  cycleLengthS: number;
  /** Fraction of the cycle spent in daylight. */
  dayFraction: number;
}

/**
 * Day/night length, loaded so the client clock matches the server's cycle
 * instead of advancing at its own private speed.
 */
export async function loadDayNightConfig(serverOrigin: string): Promise<DayNightConfig> {
  try {
    const response = await fetch(`${serverOrigin}/config/daynight`, { cache: 'no-store' });
    if (response.ok) {
      const data = (await response.json()) as {
        cycle_length_s?: number;
        cycleLengthS?: number;
        day_fraction?: number;
        dayFraction?: number;
      };
      return {
        cycleLengthS: data.cycle_length_s ?? data.cycleLengthS ?? 3600,
        dayFraction: data.day_fraction ?? data.dayFraction ?? 0.5,
      };
    }
  } catch {
    // Fall through to the default: a 60 minute day/night cycle.
  }
  return { cycleLengthS: 3600, dayFraction: 0.5 };
}

export interface ResourceTileConfig {
  /** Tile light that reads as full daylight (config/resources.json). */
  tileLightBase: number;
  maxLight: number;
  maxMoisture: number;
  maxMinerals: number;
  /**
   * The simulation rates the dev panel edits. They are read from the same
   * config the server boots with, so the panel shows real numbers instead of
   * hardcoded guesses that disagreed with the running world.
   */
  rates: ResourceRates;
}

export interface ResourceRates {
  photosynthesisRate: number;
  diffusionRate: number;
  maxAbsorptionPerTick: number;
  rainGainPerS: number;
  evaporationPerS: number;
  canopyShadeReduction: number;
  groundwaterCapacity: number;
}

/**
 * Tile resource ranges, so the ground shader normalises by the real maxima
 * rather than a compiled-in 255.
 */
export async function loadResourceTileConfig(serverOrigin: string): Promise<ResourceTileConfig> {
  try {
    const response = await fetch(`${serverOrigin}/config/resources`, { cache: 'no-store' });
    if (response.ok) {
      const data = (await response.json()) as {
        tile_light_base?: number;
        tileLightBase?: number;
        max_light?: number;
        maxLight?: number;
        max_moisture?: number;
        maxMoisture?: number;
        max_minerals?: number;
        maxMinerals?: number;
        photosynthesis_rate?: number;
        diffusion_rate?: number;
        max_absorption_per_tick?: number;
        rain_gain_per_s?: number;
        evaporation_per_s?: number;
        canopy_shade_reduction?: number;
        groundwater_capacity?: number;
      };
      return {
        tileLightBase: data.tile_light_base ?? data.tileLightBase ?? 80,
        maxLight: data.max_light ?? data.maxLight ?? 500,
        maxMoisture: data.max_moisture ?? data.maxMoisture ?? 500,
        maxMinerals: data.max_minerals ?? data.maxMinerals ?? 500,
        rates: {
          photosynthesisRate: data.photosynthesis_rate ?? 1,
          diffusionRate: data.diffusion_rate ?? 0.03,
          maxAbsorptionPerTick: data.max_absorption_per_tick ?? 1,
          rainGainPerS: data.rain_gain_per_s ?? 1.5,
          evaporationPerS: data.evaporation_per_s ?? 0.025,
          canopyShadeReduction: data.canopy_shade_reduction ?? 0.1,
          groundwaterCapacity: data.groundwater_capacity ?? 400,
        },
      };
    }
  } catch {
    // Fall through to the documented defaults.
  }
  return {
    tileLightBase: 80,
    maxLight: 500,
    maxMoisture: 500,
    maxMinerals: 500,
    rates: {
      photosynthesisRate: 1,
      diffusionRate: 0.03,
      maxAbsorptionPerTick: 1,
      rainGainPerS: 1.5,
      evaporationPerS: 0.025,
      canopyShadeReduction: 0.1,
      groundwaterCapacity: 400,
    },
  };
}

export async function loadReportsConfig(serverOrigin: string): Promise<ReportsConfig> {
  return fetchFlat<ReportsConfig>(serverOrigin, '/config/reports', {
    reportReasons: [
      { id: 'child_safety', label: 'Child safety', category: 'illegal' },
      { id: 'credible_threat', label: 'Credible threat', category: 'illegal' },
      { id: 'doxxing', label: 'Doxxing / personal information', category: 'illegal' },
      { id: 'other_illegal_activity', label: 'Other illegal activity', category: 'illegal' },
      { id: 'other', label: 'Other', category: 'other' },
    ],
    contextLineCount: 20,
    reportFreeTextMax: 500,
    reportRateLimitPerMin: 5,
  });
}

export interface DevSettings {
  /** Dev-only organism size class (`config/dev.json` seed_size_class). */
  seedSizeClass: 'normal' | 'large' | 'giant';
  /** AL-01: frames discarded after each pose is applied. */
  benchmarkWarmupMs: number;
  /** AL-01: measured window per fixed pose. */
  benchmarkPoseMs: number;
  /** AL-01: the fixed comparison poses, in order. */
  benchmarkPoses: BenchmarkPose[];
}

/**
 * Dev-only settings the client needs to behave correctly: the size class scales
 * framing and detail (ADR-027), and the benchmark poses are the AL-01 baseline.
 * Reading them from the same file the dev panel edits keeps one source of truth.
 */
export async function loadDevSettings(serverOrigin: string): Promise<DevSettings> {
  const fallback: DevSettings = {
    seedSizeClass: 'normal',
    benchmarkWarmupMs: 1500,
    benchmarkPoseMs: 6000,
    benchmarkPoses: DEFAULT_BENCHMARK_POSES,
  };
  try {
    const response = await fetch(`${serverOrigin}/config/dev`, { cache: 'no-store' });
    if (!response.ok) return fallback;
    const data = (await response.json()) as Record<string, unknown>;
    const sizeClass = data.seed_size_class;
    const poses = Array.isArray(data.benchmark_poses)
      ? (data.benchmark_poses as Array<Record<string, unknown>>)
          .map((entry) => ({
            id: String(entry.id ?? ''),
            distanceM: Number(entry.distance_m ?? entry.distanceM ?? 0),
            azimuthDeg: Number(entry.azimuth_deg ?? entry.azimuthDeg ?? 0),
            elevationDeg: Number(entry.elevation_deg ?? entry.elevationDeg ?? 0),
            targetLiftM: Number(entry.target_lift_m ?? entry.targetLiftM ?? 0),
          }))
          .filter((pose) => pose.id !== '' && Number.isFinite(pose.distanceM))
      : [];
    return {
      seedSizeClass:
        sizeClass === 'large' || sizeClass === 'giant' || sizeClass === 'normal'
          ? sizeClass
          : fallback.seedSizeClass,
      benchmarkWarmupMs: Number(data.benchmark_warmup_ms ?? fallback.benchmarkWarmupMs),
      benchmarkPoseMs: Number(data.benchmark_pose_ms ?? fallback.benchmarkPoseMs),
      benchmarkPoses: poses.length > 0 ? poses : fallback.benchmarkPoses,
    };
  } catch {
    return fallback;
  }
}
