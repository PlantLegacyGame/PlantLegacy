/**
 * Authoritative Tick Clock with Fixed-Step Accumulator
 *
 * Provides a deterministic tick loop with:
 * - Fixed timestep (configurable Hz)
 * - Accumulator for frame time
 * - Max frame time cap to prevent spiral of death
 * - Callback for each tick
 * - Drift-free scheduling using setTimeout
 */

export interface TickClockConfig {
  tickRateHz: number;
  maxFrameTimeMs: number; // Cap to prevent spiral of death
  onTick: (tick: number, dt: number) => void;
  onError?: (error: Error) => void;
}

export interface TickClock {
  tick: number;
  running: boolean;
  accumulator: number;
  lastTime: number;
  config: TickClockConfig;
  timeoutId: NodeJS.Timeout | null;
}

export function createTickClock(config: TickClockConfig): TickClock {
  return {
    tick: 0,
    running: false,
    accumulator: 0,
    lastTime: 0,
    config,
    timeoutId: null,
  };
}

export function tickClockStart(clock: TickClock): void {
  if (clock.running) return;
  clock.running = true;
  clock.lastTime = performance.now();
  tickClockScheduleNext(clock);
}

export function tickClockStop(clock: TickClock): void {
  if (clock.timeoutId) {
    clearTimeout(clock.timeoutId);
    clock.timeoutId = null;
  }
  clock.running = false;
}

export function tickClockScheduleNext(clock: TickClock): void {
  if (!clock.running) return;

  const tickIntervalMs = 1000 / clock.config.tickRateHz;
  const now = performance.now();
  const elapsed = now - clock.lastTime;
  clock.lastTime = now;

  // Accumulate REAL elapsed time, so simulated time tracks the wall clock even
  // when one tick costs more than the step. Capping the input (as this used to)
  // silently discarded the excess, and a slow tick then stretched every
  // simulation clock (day/night, growth, resources) with server load. Only a
  // backlog beyond maxFrameTimeMs (a genuine stall) is dropped.
  const maxBacklogMs = Math.max(tickIntervalMs, clock.config.maxFrameTimeMs);
  clock.accumulator = Math.min(clock.accumulator + elapsed, maxBacklogMs);

  // Process as many ticks as needed
  let ticksProcessed = 0;
  while (clock.accumulator >= tickIntervalMs) {
    clock.accumulator -= tickIntervalMs;
    clock.tick++;
    try {
      clock.config.onTick(clock.tick, tickIntervalMs / 1000);
    } catch (e) {
      clock.config.onError?.(e as Error);
    }
    ticksProcessed++;

    // Safety: prevent an unbounded catch-up burst from blocking the event loop
    // (and starving the network). The leftover backlog stays capped above.
    if (ticksProcessed > 10) break;
  }

  // Schedule next frame
  const nextDelay = Math.max(0, tickIntervalMs - clock.accumulator);
  clock.timeoutId = setTimeout(() => tickClockScheduleNext(clock), nextDelay);
}

export function tickClockGetTick(clock: TickClock): number {
  return clock.tick;
}

export function tickClockGetConfig(clock: TickClock): TickClockConfig {
  return clock.config;
}
