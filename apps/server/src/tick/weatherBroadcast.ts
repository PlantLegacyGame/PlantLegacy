import { stepCadence } from '../ops/broadcastCadence.ts';

export interface WeatherBroadcastPorts {
  broadcast(payload: Record<string, unknown>): void;
}

export interface WeatherBroadcastInput {
  tick: number;
  dt: number;
  sendRateHz: number;
  accumulatorMs: number;
  /** The weather state as the simulation has it for this tick. */
  weather: Record<string, unknown>;
}

export interface WeatherBroadcastResult {
  nextAccumulatorMs: number;
  sent: number;
  skipped: number;
}

/**
 * The weather / day-night broadcast, on its own slower cadence.
 *
 * Day length is minutes, so a few messages a second are visually smooth and cost
 * an order of magnitude less than one per tick. Banking the elapsed milliseconds
 * keeps the rate exact when the tick rate changes.
 */
export function broadcastWeather(
  ports: WeatherBroadcastPorts,
  input: WeatherBroadcastInput,
): WeatherBroadcastResult {
  const step = stepCadence(input.accumulatorMs, input.dt * 1000, input.sendRateHz);
  if (!step.due) {
    return { nextAccumulatorMs: step.nextAccumulatorMs, sent: 0, skipped: 1 };
  }
  ports.broadcast({ tick: input.tick, ...input.weather });
  return { nextAccumulatorMs: step.nextAccumulatorMs, sent: 1, skipped: 0 };
}
