/**
 * @plant-legacy/weather - Weather state machine.
 *
 * Deterministic weather state machine with seeded RNG. Transitions between
 * clear, rain, thunderstorm_telegraph, thunderstorm_active, thunderstorm_aftermath
 * states based on configurable probabilities and durations. Also computes day/night
 * cycle time-of-day, sun intensity, and light multipliers per weather state.
 *
 * Dependency: @plant-legacy/shared/math (hash32, mulberry32).
 */

import { hash32, mulberry32 } from '@plant-legacy/shared/math';

export type WeatherStateName =
  | 'clear'
  | 'rain'
  | 'thunderstorm_telegraph'
  | 'thunderstorm_active'
  | 'thunderstorm_aftermath';

export interface WeatherConfig {
  clearDurationMinS: number;
  clearDurationMaxS: number;
  rainDurationMinS: number;
  rainDurationMaxS: number;
  stormTelegraphDurationS: number;
  stormActiveDurationS: number;
  stormAftermathDurationS: number;
  rainMoistureGainPerS: number;
  stormMoistureGainPerS: number;
  clearLightMultiplier: number;
  rainLightMultiplier: number;
  stormLightMultiplier: number;
  stormWindDamageThreshold: number;
  stormWindDamageRate: number;
  lightningFrequencyPerMinute: number;
  lightningDamageRadius: number;
  lightningDamageAmount: number;
  forecastWindowS: number;
  biomeWeatherModifier: number;
}

export interface DayNightConfig {
  cycleLengthS: number;
  dayFraction: number;
  dawnDuskTransitionS: number;
  conditionMapping: Record<string, string>;
}

export interface WeatherBroadcast {
  /** 1-based in-game day; one day is `cycleLengthS` (1 real hour by default). */
  dayNumber: number;
  timeOfDay: number;
  isDay: boolean;
  sunIntensity: number;
  /**
   * The weather's own light multiplier. `sunIntensity` already carries it; this
   * is what lets the client grade the direct beam and its disk, which the
   * ambient number never reaches.
   */
  lightMultiplier: number;
  weatherState: WeatherStateName;
  conditionToken: string;
  stateTimeRemainingS: number;
  forecast: {
    nextWeatherState: WeatherStateName;
    timeUntilNextStateS: number;
  };
}

export interface WeatherStateConfig {
  name: WeatherStateName;
  nextStates: Readonly<{
    clear?: number;
    rain?: number;
    thunderstorm_telegraph?: number;
    thunderstorm_active?: number;
    thunderstorm_aftermath?: number;
  }>;
}

export const WEATHER_STATE_MACHINE: ReadonlyMap<WeatherStateName, WeatherStateConfig> = new Map([
  [
    'clear',
    {
      name: 'clear',
      nextStates: { rain: 0.5, thunderstorm_telegraph: 0.5 },
    } as const,
  ],
  [
    'rain',
    {
      name: 'rain',
      nextStates: { clear: 0.65, thunderstorm_telegraph: 0.35 },
    } as const,
  ],
  [
    'thunderstorm_telegraph',
    {
      name: 'thunderstorm_telegraph',
      nextStates: { thunderstorm_active: 1.0 },
    } as const,
  ],
  [
    'thunderstorm_active',
    {
      name: 'thunderstorm_active',
      nextStates: { thunderstorm_aftermath: 1.0 },
    } as const,
  ],
  [
    'thunderstorm_aftermath',
    {
      name: 'thunderstorm_aftermath',
      nextStates: { clear: 1.0 },
    } as const,
  ],
]);

export interface WeatherStateMachine {
  currentState: WeatherStateName;
  stateTimerS: number;
  currentDurationS: number;
  nextState: WeatherStateName;
  totalElapsedS: number;
  timeOfDay: number;
  config: WeatherConfig;
  cycleLengthS: number;
  dayFraction: number;
  conditionMapping: Record<string, string>;
  rng: () => number;
  /** Dev control: the world clock stands still while true. Weather still runs. */
  timePaused: boolean;
  /** Dev control: multiplier on the clock's advance rate. */
  timeScale: number;
}

export function createWeatherStateMachine(
  weatherConfig: WeatherConfig,
  dayNightConfig: {
    cycleLengthS: number;
    dayFraction: number;
    conditionMapping: Record<string, string>;
  },
): WeatherStateMachine {
  const initialState: WeatherStateName = 'clear';
  const initialDuration = weatherConfig.clearDurationMinS;
  const worldSeed = hash32('weather_world_seed');

  return {
    currentState: initialState,
    stateTimerS: 0,
    currentDurationS: initialDuration,
    nextState: pickNextState(initialState, mulberry32(worldSeed)),
    totalElapsedS: 0,
    timeOfDay: 0.25,
    config: weatherConfig,
    cycleLengthS: Math.max(1, dayNightConfig.cycleLengthS),
    dayFraction: dayNightConfig.dayFraction,
    conditionMapping: dayNightConfig.conditionMapping,
    rng: mulberry32(worldSeed),
    timePaused: false,
    timeScale: 1,
  };
}

function randomBetween(rng: () => number, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + rng() * (hi - lo);
}

function getRandomDuration(
  rng: () => number,
  state: WeatherStateName,
  config: WeatherConfig,
): number {
  switch (state) {
    case 'clear':
      return randomBetween(rng, config.clearDurationMinS, config.clearDurationMaxS);
    case 'rain':
      return randomBetween(rng, config.rainDurationMinS, config.rainDurationMaxS);
    case 'thunderstorm_telegraph':
      return config.stormTelegraphDurationS;
    case 'thunderstorm_active':
      return config.stormActiveDurationS;
    case 'thunderstorm_aftermath':
      return config.stormAftermathDurationS;
    default:
      return config.clearDurationMinS;
  }
}

function pickNextState(current: WeatherStateName, rng: () => number): WeatherStateName {
  const stateConfig = WEATHER_STATE_MACHINE.get(current);
  if (!stateConfig) return 'clear';

  const entries = Object.entries(stateConfig.nextStates) as Array<[WeatherStateName, number]>;
  if (entries.length === 0) return 'clear';

  const total = entries.reduce((sum, [, probability]) => sum + probability, 0);
  if (total <= 0) return entries[0][0];

  let roll = rng() * total;
  for (const [state, probability] of entries) {
    roll -= probability;
    if (roll <= 0) return state;
  }
  return entries[entries.length - 1][0];
}

/** Dev control: hold the world clock where it is, or let it run again. */
export function weatherStateMachineSetTimePaused(
  machine: WeatherStateMachine,
  paused: boolean,
): void {
  machine.timePaused = paused;
}

/** Dev control: how fast the world clock advances, as a multiplier on real time. */
export function weatherStateMachineSetTimeScale(machine: WeatherStateMachine, scale: number): void {
  if (!Number.isFinite(scale)) return;
  machine.timeScale = Math.min(100, Math.max(0, scale));
}

export function weatherStateMachineUpdate(
  machine: WeatherStateMachine,
  dtSeconds: number,
): WeatherStateName | null {
  machine.totalElapsedS += dtSeconds;
  machine.stateTimerS += dtSeconds;

  // The clock is server state, so a dev freeze or speed change has to live here
  // rather than in a renderer that the next broadcast overwrites. Weather keeps
  // running while the clock is paused: stopping the rain because time stopped
  // would be two controls pretending to be one.
  if (!machine.timePaused) {
    machine.timeOfDay =
      (machine.timeOfDay + (dtSeconds * machine.timeScale) / machine.cycleLengthS) % 1.0;
    if (machine.timeOfDay < 0) machine.timeOfDay += 1.0;
  }

  if (machine.stateTimerS >= machine.currentDurationS) {
    return weatherStateMachineAdvance(machine);
  }
  return null;
}

/**
 * Put the machine into a chosen state now.
 *
 * The world weather is autonomous, so a developer control that only changed the
 * client's visuals was reverted by the next broadcast - the select looked
 * broken because it was. Forcing the authoritative machine is the only way the
 * sky, the rain, the light multiplier and the groundwater recharge all agree
 * that it is raining. `durationS` holds the state for that long before the
 * normal transition resumes; without it the state keeps its own configured
 * duration and then advances as usual.
 */
export function weatherStateMachineForceState(
  machine: WeatherStateMachine,
  state: WeatherStateName,
  durationS?: number,
): WeatherStateName {
  machine.currentState = state;
  machine.stateTimerS = 0;
  machine.currentDurationS =
    typeof durationS === 'number' && Number.isFinite(durationS) && durationS > 0
      ? durationS
      : getRandomDuration(machine.rng, state, machine.config);
  machine.nextState = pickNextState(state, machine.rng);
  return machine.currentState;
}

export function weatherStateMachineAdvance(machine: WeatherStateMachine): WeatherStateName {
  const currentConfig = WEATHER_STATE_MACHINE.get(machine.currentState);
  if (!currentConfig) return machine.currentState;

  const nextState = machine.nextState;

  machine.currentState = nextState;
  machine.stateTimerS = 0;
  machine.currentDurationS = getRandomDuration(machine.rng, nextState, machine.config);
  machine.nextState = pickNextState(nextState, machine.rng);

  return nextState;
}

export function weatherStateMachineGetLightMultiplier(machine: WeatherStateMachine): number {
  switch (machine.currentState) {
    case 'clear':
      return machine.config.clearLightMultiplier;
    case 'rain':
      return machine.config.rainLightMultiplier;
    default:
      return machine.config.stormLightMultiplier;
  }
}

export function weatherStateMachineGetMoistureGainPerS(machine: WeatherStateMachine): number {
  switch (machine.currentState) {
    case 'rain':
      return machine.config.rainMoistureGainPerS * machine.config.biomeWeatherModifier;
    case 'thunderstorm_active':
      return machine.config.stormMoistureGainPerS * machine.config.biomeWeatherModifier;
    default:
      return 0.0;
  }
}

export function weatherStateMachineGetNextState(machine: WeatherStateMachine): WeatherStateName {
  return machine.nextState;
}

export function weatherStateMachineGetBroadcast(machine: WeatherStateMachine): {
  dayNumber: number;
  timeOfDay: number;
  timePaused: boolean;
  timeScale: number;
  isDay: boolean;
  sunIntensity: number;
  lightMultiplier: number;
  weatherState: WeatherStateName;
  conditionToken: string;
  stateTimeRemainingS: number;
  forecast: {
    nextWeatherState: WeatherStateName;
    timeUntilNextStateS: number;
  };
} {
  // Phase the day exactly like the renderer's sun arc (`celestial.ts`):
  // 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset. Anchoring the
  // curve at midnight instead (day = 0..dayFraction) made the broadcast call
  // midnight daytime and drop sun intensity to zero by 4pm while the sky was
  // still bright.
  const sunElev = Math.sin(machine.timeOfDay * Math.PI * 2 - Math.PI / 2);
  const isDayTime = sunElev > 0;
  const condition = machine.conditionMapping[machine.currentState] ?? 'sun';
  const remainingS = Math.max(0, machine.currentDurationS - machine.stateTimerS);
  const sunIntensity = Math.max(0, sunElev) * weatherStateMachineGetLightMultiplier(machine);

  return {
    // The world starts at 06:00, so a day rolls over at midnight rather than
    // at an arbitrary hour after the process started.
    dayNumber:
      1 + Math.floor((machine.totalElapsedS + machine.cycleLengthS * 0.25) / machine.cycleLengthS),
    timeOfDay: machine.timeOfDay,
    timePaused: machine.timePaused,
    timeScale: machine.timeScale,
    isDay: isDayTime,
    sunIntensity,
    lightMultiplier: weatherStateMachineGetLightMultiplier(machine),
    weatherState: machine.currentState,
    conditionToken: condition,
    stateTimeRemainingS: Math.round(remainingS),
    forecast: {
      nextWeatherState: weatherStateMachineGetNextState(machine),
      timeUntilNextStateS: Math.round(remainingS),
    },
  };
}

export function weatherStateMachineIsDay(machine: WeatherStateMachine): boolean {
  // Same sun arc as the broadcast and the renderer, so "is it day" agrees with
  // the sky at midnight and dusk instead of calling 00:00 daylight.
  return Math.sin(machine.timeOfDay * Math.PI * 2 - Math.PI / 2) > 0;
}

export function weatherStateMachineGetTimeOfDay(machine: WeatherStateMachine): number {
  return machine.timeOfDay;
}

export function weatherStateMachineGetWeatherState(machine: WeatherStateMachine): WeatherStateName {
  return machine.currentState;
}

/**
 * Dev hook: move the world clock to a given fraction of the day.
 *
 * The sun is server-authoritative, so a client cannot brighten the world for a
 * screenshot - `setTimeOfDay` on the renderer is overwritten by the next
 * broadcast. 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset, matching the sun
 * arc used by the broadcast and the renderer.
 */
export function weatherStateMachineSetTimeOfDay(
  machine: WeatherStateMachine,
  timeOfDay: number,
): void {
  if (!Number.isFinite(timeOfDay)) return;
  machine.timeOfDay = ((timeOfDay % 1) + 1) % 1;
}
