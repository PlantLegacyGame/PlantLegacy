/**
 * @plant-legacy/weather - the planetary climate field.
 *
 * The weather used to be a Markov chain: one global state, rolled every few
 * minutes, with fixed probabilities that had nothing to do with where the player
 * was or what the world was like. Two plants a kilometre apart had the same sky,
 * a hillside could not wring rain out of a passing wind, and a "storm" was a die
 * roll rather than a system that had drifted in.
 *
 * This module replaces the dice with a field: temperature, humidity, cloud and
 * precipitation are sampled at a world position from smooth noise that is
 * advected by the wind and lifted over terrain. The chain still owns the phases
 * of a thunderstorm (telegraph, active, aftermath) and the durations, but *which*
 * weather happens, and where, is decided here.
 *
 * Everything is a pure function of (position, time, day, season) so the 30-day
 * test can drive it without a server, and two servers with the same seed agree.
 */

export interface ClimateConfig {
  /** Seed for the field. One number; the world's climate is reproducible from it. */
  seed: number;
  /** Size of one weather system, in metres. Smaller means more local variety. */
  systemScaleM: number;
  /** Prevailing wind, m/s and radians (0 = +x). */
  windSpeedMps: number;
  windDirectionRad: number;
  /** How far ahead the upslope is measured, in metres. */
  orographicDistanceM: number;
  /** Cloud gained per metre per second of upslope, before clamping. */
  orographicLift: number;
  temperatureBaseC: number;
  temperatureDaySwingC: number;
  temperatureSeasonSwingC: number;
  temperatureNoiseC: number;
  altitudeLapseCPerM: number;
  humidityBase: number;
  humiditySwing: number;
  /** Cloud begins at this humidity and is full at 1. */
  cloudThreshold: number;
  /** Precipitation begins at this cloud cover. */
  precipitationThreshold: number;
  /** Below this temperature, precipitation falls as snow. */
  snowThresholdC: number;
  /** Cloud above this can spawn a thunderstorm. */
  stormCloudThreshold: number;
  /** Share of eligible cells that actually storm: this is what makes storms rare. */
  stormChance: number;
  /** How often the state machine asks the field again. */
  reevaluateS: number;
  /** No storms for this long after one has passed: a cell cannot loop. */
  stormCooldownS: number;
  /** Hysteresis around `precipitationThreshold`. */
  precipitationStart: number;
  precipitationStop: number;
}

export interface ClimateSample {
  temperatureC: number;
  humidity: number;
  cloud: number;
  /** 0..1: how hard it is falling. Zero when the sky is only cloudy. */
  precipitation: number;
  kind: 'rain' | 'snow';
  storm: boolean;
}

export interface ClimateTime {
  /** Seconds since the world started. Advects the field and evolves the noise. */
  elapsedS: number;
  /** 0..1 through the day; 0.25 is sunrise, 0.5 noon. */
  dayFraction: number;
  /** 0..1 through the year. Drives the seasonal temperature swing. */
  seasonPhase?: number;
}

/** The terrain the wind has to climb: world height at a point, in metres. */
export type ClimateTerrain = (x: number, z: number) => number;

export interface ClimateField {
  readonly config: ClimateConfig;
  sample(x: number, z: number, time: ClimateTime): ClimateSample;
}

/** 32-bit integer hash, deterministic across engines (no float bit tricks). */
function hash2(seed: number, x: number, y: number): number {
  let h = seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise in 0..1, smooth between lattice points. */
function valueNoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smoothstep(x - x0);
  const fy = smoothstep(y - y0);
  const a = hash2(seed, x0, y0);
  const b = hash2(seed, x0 + 1, y0);
  const c = hash2(seed, x0, y0 + 1);
  const d = hash2(seed, x0 + 1, y0 + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/** Three octaves: a system, its fronts, and the texture inside them. */
function fbm(seed: number, x: number, y: number): number {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;
  for (let octave = 0; octave < 3; octave += 1) {
    sum += valueNoise(seed + octave * 7919, x * frequency, y * frequency) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.07;
  }
  return sum / norm;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function createClimateField(
  config: ClimateConfig,
  terrain?: ClimateTerrain | null,
): ClimateField {
  const scale = Math.max(1, config.systemScaleM);
  const windX = Math.cos(config.windDirectionRad) * config.windSpeedMps;
  const windZ = Math.sin(config.windDirectionRad) * config.windSpeedMps;
  const ahead = Math.max(1, config.orographicDistanceM);

  return {
    config,
    sample(x: number, z: number, time: ClimateTime): ClimateSample {
      const elapsed = Number.isFinite(time.elapsedS) ? time.elapsedS : 0;
      const day = Number.isFinite(time.dayFraction) ? time.dayFraction : 0.5;
      const season = Number.isFinite(time.seasonPhase ?? 0) ? (time.seasonPhase ?? 0) : 0;

      // The field is carried by the wind: the weather over a place is the
      // weather that was upwind of it, which is why a shower walks across the
      // hillside instead of blinking in and out at one spot.
      const advectX = (x - windX * elapsed) / scale;
      const advectZ = (z - windZ * elapsed) / scale;
      // A slow drift in the third dimension lets systems grow and decay.
      const evolve = (elapsed / 3600) * 0.045;

      const humidityNoise = fbm(config.seed, advectX, advectZ + evolve);
      // Night air is damper than afternoon air even without a shower.
      const diurnalHumidity = Math.cos((day - 0.25) * Math.PI * 2) * 0.06;
      let humidity =
        config.humidityBase + (humidityNoise - 0.5) * 2 * config.humiditySwing + diurnalHumidity;

      // Orographic lift: wind climbing a slope cools and condenses. The upslope
      // is measured along the wind over a real distance, so a ridge wrings rain
      // out on its windward side and leaves a dry shadow behind it.
      let lift = 0;
      let height = 0;
      if (terrain) {
        height = terrain(x, z);
        const upwindHeight = terrain(x + windX * ahead, z + windZ * ahead);
        const upslope = (height - upwindHeight) / ahead;
        lift = Math.max(0, upslope) * config.orographicLift;
        humidity += lift;
      }
      humidity = clamp01(humidity);

      const cloud = clamp01(
        (humidity - config.cloudThreshold) / Math.max(0.001, 1 - config.cloudThreshold),
      );
      const precipitation =
        cloud <= config.precipitationThreshold
          ? 0
          : clamp01(
              (cloud - config.precipitationThreshold) /
                Math.max(0.001, 1 - config.precipitationThreshold),
            );

      // Temperature: the season, the hour, the altitude and the local air.
      const seasonSwing = Math.cos(season * Math.PI * 2) * config.temperatureSeasonSwingC;
      const daySwing = Math.sin((day - 0.25) * Math.PI * 2) * config.temperatureDaySwingC;
      const altitude = -height * config.altitudeLapseCPerM;
      const texture = (humidityNoise - 0.5) * 2 * config.temperatureNoiseC;
      const temperatureC = config.temperatureBaseC + seasonSwing + daySwing + altitude + texture;

      // A storm is a rare cell inside a very heavy cloud, not a probability the
      // sky rolls every few minutes: the same cloud usually passes without one.
      const stormNoise = fbm(config.seed + 104729, advectX * 0.45 + 31, advectZ * 0.45 + evolve);
      const storm =
        cloud >= config.stormCloudThreshold &&
        stormNoise > 1 - config.stormChance &&
        config.stormChance > 0;

      return {
        temperatureC,
        humidity,
        cloud,
        precipitation,
        kind: temperatureC < config.snowThresholdC ? 'snow' : 'rain',
        storm,
      };
    },
  };
}

/** A climate config that is safe to run: every number is finite and in range. */
export function sanitizeClimateConfig(config: ClimateConfig): ClimateConfig {
  const num = (value: number, fallback: number): number =>
    Number.isFinite(value) ? value : fallback;
  const windDirectionRad = num(config.windDirectionRad, 0);
  return {
    ...config,
    seed: Math.floor(num(config.seed, 1)),
    systemScaleM: Math.max(10, num(config.systemScaleM, 900)),
    windSpeedMps: Math.max(0, num(config.windSpeedMps, 6)),
    windDirectionRad,
    orographicDistanceM: Math.max(1, num(config.orographicDistanceM, 120)),
    orographicLift: Math.max(0, num(config.orographicLift, 0.004)),
    temperatureBaseC: num(config.temperatureBaseC, 14),
    temperatureDaySwingC: Math.max(0, num(config.temperatureDaySwingC, 7)),
    temperatureSeasonSwingC: Math.max(0, num(config.temperatureSeasonSwingC, 9)),
    temperatureNoiseC: Math.max(0, num(config.temperatureNoiseC, 2)),
    altitudeLapseCPerM: Math.max(0, num(config.altitudeLapseCPerM, 0.0065)),
    humidityBase: clamp01(num(config.humidityBase, 0.52)),
    humiditySwing: Math.max(0, num(config.humiditySwing, 0.26)),
    cloudThreshold: clamp01(num(config.cloudThreshold, 0.58)),
    precipitationThreshold: Math.min(0.98, Math.max(0, num(config.precipitationThreshold, 0.28))),
    snowThresholdC: num(config.snowThresholdC, 1.5),
    stormCloudThreshold: clamp01(num(config.stormCloudThreshold, 0.82)),
    stormChance: clamp01(num(config.stormChance, 0.055)),
    reevaluateS: Math.max(5, num(config.reevaluateS, 90)),
    stormCooldownS: Math.max(0, num(config.stormCooldownS, 900)),
    precipitationStart: clamp01(num(config.precipitationStart, 0.22)),
    precipitationStop: clamp01(num(config.precipitationStop, 0.12)),
  };
}
