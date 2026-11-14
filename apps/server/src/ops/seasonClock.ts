import type { SeasonUpdatePayload } from './net.ts';

const SECONDS_PER_DAY = 86_400;

/**
 * A season is a fixed span of simulation ticks, not wall-clock days: the same
 * save advanced by the same number of ticks always lands in the same season,
 * whether it ran online or in the dormant loop. Seasons exist so a legacy plant
 * is measured in something longer than one player's session.
 */
export interface SeasonClock {
  /** 1-based. The first season a new world runs is 1. */
  season: number;
  /** Tick at which this season began. */
  startedTick: number;
  /** Ticks in one season. Always at least 1 so a bad config cannot divide by zero. */
  lengthTicks: number;
}

/** Ticks in a season, from the configured real-day length and the tick rate. */
export function seasonLengthTicks(seasonLengthDays: number, tickRateHz: number): number {
  const days = Number.isFinite(seasonLengthDays) ? Math.max(0, seasonLengthDays) : 0;
  const hz = Number.isFinite(tickRateHz) && tickRateHz > 0 ? tickRateHz : 1;
  return Math.max(1, Math.round(days * SECONDS_PER_DAY * hz));
}

export function createSeasonClock(
  seasonLengthDays: number,
  tickRateHz: number,
  season = 1,
  startedTick = 0,
): SeasonClock {
  return { season, startedTick, lengthTicks: seasonLengthTicks(seasonLengthDays, tickRateHz) };
}

export function seasonEndsAtTick(clock: SeasonClock): number {
  return clock.startedTick + clock.lengthTicks;
}

export function seasonRemainingSeconds(
  clock: SeasonClock,
  tick: number,
  tickRateHz: number,
): number {
  const hz = Number.isFinite(tickRateHz) && tickRateHz > 0 ? tickRateHz : 1;
  const remainingTicks = Math.max(0, seasonEndsAtTick(clock) - tick);
  return remainingTicks / hz;
}

export interface SeasonAdvance {
  clock: SeasonClock;
  /**
   * How many season boundaries were crossed. More than one after a long pause:
   * a dormant world must not lose seasons just because nobody watched them end.
   */
  seasonsPassed: number;
}

/**
 * Advance the clock to `tick`. Returns the same clock object when the season is
 * still running, so the caller can compare `seasonsPassed` instead of ticks.
 */
export function seasonClockAdvance(clock: SeasonClock, tick: number): SeasonAdvance {
  if (tick < seasonEndsAtTick(clock)) return { clock, seasonsPassed: 0 };
  const passed = Math.floor((tick - clock.startedTick) / clock.lengthTicks);
  const seasonsPassed = Math.max(1, passed);
  return {
    clock: {
      season: clock.season + seasonsPassed,
      startedTick: clock.startedTick + seasonsPassed * clock.lengthTicks,
      lengthTicks: clock.lengthTicks,
    },
    seasonsPassed,
  };
}

/**
 * What survives a restart. Remaining ticks rather than an absolute tick: the
 * tick counter starts at zero every boot, and an absolute start would let a
 * restart either skip a season or stretch one.
 */
export interface SeasonSnapshot {
  season: number;
  remainingTicks: number;
  /** Epoch ms of the last calamity, or null if no season has ended yet. */
  lastCalamityAt: number | null;
}

export function seasonSnapshot(
  clock: SeasonClock,
  tick: number,
  lastCalamityAt: number | null,
): SeasonSnapshot {
  return {
    season: clock.season,
    remainingTicks: Math.max(0, seasonEndsAtTick(clock) - tick),
    lastCalamityAt,
  };
}

/**
 * Rebuild the clock from a saved snapshot. `startedTick` goes negative so the
 * same `started + length` arithmetic yields the saved time left; nothing else
 * in the clock needs to know the counter restarted.
 */
export function restoreSeasonClock(
  seasonLengthDays: number,
  tickRateHz: number,
  snapshot: SeasonSnapshot,
): SeasonClock {
  const lengthTicks = seasonLengthTicks(seasonLengthDays, tickRateHz);
  const season =
    Number.isFinite(snapshot.season) && snapshot.season >= 1 ? Math.floor(snapshot.season) : 1;
  const remainingTicks = Number.isFinite(snapshot.remainingTicks)
    ? Math.min(lengthTicks, Math.max(0, snapshot.remainingTicks))
    : lengthTicks;
  // endsAt = startedTick + length must equal the saved remainder, so the clock
  // ends exactly that many ticks from the fresh counter's zero.
  return { season, startedTick: remainingTicks - lengthTicks, lengthTicks };
}

/** The wire shape the client counts down from. */
export function seasonUpdatePayload(
  clock: SeasonClock,
  tick: number,
  tickRateHz: number,
  calamity = false,
): SeasonUpdatePayload {
  return {
    season: clock.season,
    remainingSeconds: Math.max(0, Math.round(seasonRemainingSeconds(clock, tick, tickRateHz))),
    lengthTicks: clock.lengthTicks,
    calamity,
  };
}
