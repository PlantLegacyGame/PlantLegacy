import { stepCadence } from '../ops/broadcastCadence.ts';

export interface WeatherBroadcastPorts {
  /** Sockets the message was written to; a refused socket is not a delivery. */
  broadcast(payload: Record<string, unknown>): number;
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
  /** Deliveries this tick: a fanout that every socket refused counts as 0. */
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
  const delivered = ports.broadcast({ tick: input.tick, ...input.weather });
  return { nextAccumulatorMs: step.nextAccumulatorMs, sent: delivered, skipped: 0 };
}
