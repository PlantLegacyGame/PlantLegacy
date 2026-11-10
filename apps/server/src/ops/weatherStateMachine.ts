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
  timeOfDay: number;
  isDay: boolean;
  sunIntensity: number;
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

/**
 * The weather graph owns only transitions. Durations, light multipliers, and
 * moisture rates are config values (`config/weather.json`) read through
 * `WeatherConfig`; keeping them here as well caused a silent drift where
 * clear/rain durations were hardcoded to zero.
 */
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
  /** The state that will be entered when the timer expires. Preselected so the
   * broadcast forecast is the same value the transition will actually use. */
  nextState: WeatherStateName;
  totalElapsedS: number;
  timeOfDay: number;
  config: WeatherConfig;
  cycleLengthS: number;
  dayFraction: number;
  conditionMapping: Record<string, string>;
  /** Seeded RNG for deterministic weather transitions */
  rng: () => number;
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

export function weatherStateMachineUpdate(
  machine: WeatherStateMachine,
  dtSeconds: number,
): WeatherStateName | null {
  machine.totalElapsedS += dtSeconds;
  machine.stateTimerS += dtSeconds;

  machine.timeOfDay = (machine.timeOfDay + dtSeconds / machine.cycleLengthS) % 1.0;

  if (machine.stateTimerS >= machine.currentDurationS) {
    return weatherStateMachineAdvance(machine);
  }
  return null;
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
  timeOfDay: number;
  isDay: boolean;
  sunIntensity: number;
  weatherState: WeatherStateName;
  conditionToken: string;
  stateTimeRemainingS: number;
  forecast: {
    nextWeatherState: WeatherStateName;
    timeUntilNextStateS: number;
  };
} {
  const isDayTime = machine.timeOfDay < machine.dayFraction;
  const condition = machine.conditionMapping[machine.currentState] ?? 'sun';
  const remainingS = Math.max(0, machine.currentDurationS - machine.stateTimerS);

  let dayCurve = 0.0;
  if (machine.timeOfDay < machine.dayFraction) {
    dayCurve = Math.sin((machine.timeOfDay / machine.dayFraction) * Math.PI);
  }
  const sunIntensity = dayCurve * weatherStateMachineGetLightMultiplier(machine);

  return {
    timeOfDay: machine.timeOfDay,
    isDay: isDayTime,
    sunIntensity,
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
  return machine.timeOfDay < machine.dayFraction;
}

export function weatherStateMachineGetTimeOfDay(machine: WeatherStateMachine): number {
  return machine.timeOfDay;
}

export function weatherStateMachineGetWeatherState(machine: WeatherStateMachine): WeatherStateName {
  return machine.currentState;
}
