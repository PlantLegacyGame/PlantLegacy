/**
 * The client's copy of the world clock.
 *
 * Which hour it is belongs to the server: the payload carries `timeOfDay`, and
 * since the dev controls moved server-side it also carries `timePaused` and
 * `timeScale`. The client's job is only to keep the sun moving smoothly between
 * broadcasts (2 Hz, so the sun would otherwise step) using the same cycle length
 * the server uses. Nothing here decides anything - it interpolates a value it was
 * given, and it stops when the server says the clock is stopped.
 *
 * This used to be three pieces of renderer state and a local freeze flag that the
 * next broadcast silently disagreed with, which is how a dev freeze looked
 * applied while the world kept moving.
 */

export interface WorldClock {
  /** 0..1, 0 = midnight, 0.25 = sunrise, 0.5 = noon. */
  timeOfDay: number;
  paused: boolean;
  scale: number;
}

export const DEFAULT_WORLD_CLOCK: WorldClock = { timeOfDay: 0.25, paused: false, scale: 1 };

/** Wrap into 0..1, tolerating negative input and rounding at the seam. */
export function wrapDayFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(100, Math.max(0, scale));
}

/**
 * Advance the clock by `dtSeconds` of real time while the server lets it run.
 *
 * A paused clock holds its hour; the weather still advances, because stopping the
 * rain because the sun stopped is two controls pretending to be one.
 */
export function advanceWorldClock(
  clock: WorldClock,
  dtSeconds: number,
  dayLengthSeconds: number,
): WorldClock {
  if (clock.paused) return clock;
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return clock;
  if (!Number.isFinite(dayLengthSeconds) || dayLengthSeconds <= 0) return clock;
  return {
    ...clock,
    timeOfDay: wrapDayFraction(clock.timeOfDay + (dtSeconds * clock.scale) / dayLengthSeconds),
  };
}

export interface ServerClockPayload {
  timeOfDay: number;
  timePaused?: boolean;
  timeScale?: number;
}

/**
 * Adopt the server's hour, and its mode, from one broadcast.
 *
 * The hour is taken as given even when it is close: extrapolating from a stale
 * local value is exactly how the client and the world drifted apart. Fields the
 * payload omits are left alone, so an older server that sends only `timeOfDay`
 * still works.
 */
export function applyServerClock(clock: WorldClock, payload: ServerClockPayload): WorldClock {
  const next: WorldClock = { ...clock };
  if (Number.isFinite(payload.timeOfDay)) next.timeOfDay = wrapDayFraction(payload.timeOfDay);
  if (typeof payload.timePaused === 'boolean') next.paused = payload.timePaused;
  if (typeof payload.timeScale === 'number') next.scale = clampScale(payload.timeScale);
  return next;
}

/** A dev jump that has not been confirmed by the server yet. Does not pause. */
export function withTimeOfDay(clock: WorldClock, timeOfDay: number): WorldClock {
  return { ...clock, timeOfDay: wrapDayFraction(timeOfDay) };
}

/**
 * How far the server's hour is from ours, in day fractions, the short way round.
 *
 * Positive means the server is ahead. The wrap matters: a client at 0.999 and a
 * server at 0.001 are two seconds apart, not most of a day.
 */
export function shortestDayDelta(from: number, to: number): number {
  const raw = wrapDayFraction(to) - wrapDayFraction(from);
  if (raw > 0.5) return raw - 1;
  if (raw < -0.5) return raw + 1;
  return raw;
}

/**
 * The rate multiplier that closes a clock gap over the next few seconds instead
 * of teleporting to it.
 *
 * The title screen has only its own copy of the clock to run on between polls,
 * and its extrapolation and the world's do not agree exactly: the server advances
 * the day by scheduled tick time, so a loaded server's day runs slower than the
 * wall clock the title measured. Snapping to the server on every poll is what made
 * the moon jump backwards. Chasing it means the sky only ever moves forward - it
 * just moves a little slower, or faster, until it agrees.
 *
 * The result is a `scale`-style multiplier: 1 keeps pace, <1 slows down, >1 speeds
 * up. It is clamped so a wrong hour (a paused world, a jump) cannot spin the sky.
 */
export function clockCatchUpRate(
  deltaDays: number,
  dayLengthSeconds: number,
  catchUpSeconds: number,
  minRate = 0.05,
  maxRate = 6,
): number {
  if (!Number.isFinite(deltaDays) || deltaDays === 0) return 1;
  if (!Number.isFinite(dayLengthSeconds) || dayLengthSeconds <= 0) return 1;
  if (!Number.isFinite(catchUpSeconds) || catchUpSeconds <= 0) return 1;
  // World seconds represented by the gap, then the rate that spends them in the
  // catch-up window on top of the clock's normal pace.
  const gapSeconds = deltaDays * dayLengthSeconds;
  const rate = 1 + gapSeconds / catchUpSeconds;
  return Math.min(maxRate, Math.max(minRate, rate));
}
