/**
 * Rules behind the single vitals readout.
 *
 * The HUD used to print the same four resources three times (a debug card, the
 * status card and the readout) and printed full precision floats everywhere.
 * These helpers decide what one row says, so the DOM only has to place it: bars
 * where a capacity exists, plain numbers where it does not, and a word only when
 * something is actually wrong.
 */

export type VitalTone = 'ok' | 'low' | 'critical';

export interface VitalRowInput {
  id: string;
  label: string;
  value: number;
  /** Capacity for this store; null/undefined when the value is unbounded. */
  capacity?: number | null;
  /** Whole numbers for counts and capacities, one decimal for stores. */
  precision?: 0 | 1;
}

export interface VitalRow {
  id: string;
  label: string;
  /** Ready to paint: "1", "37/40", "30.7". */
  valueText: string;
  /** Fill fraction, or null when the row has no capacity and gets no bar. */
  fraction: number | null;
  tone: VitalTone;
  /** Title text: the exact numbers, for players who want them. */
  title: string;
}

export interface VitalThresholds {
  lowFraction: number;
  criticalFraction: number;
}

export const DEFAULT_VITAL_THRESHOLDS: VitalThresholds = {
  lowFraction: 0.25,
  criticalFraction: 0.1,
};

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Whole numbers stay whole: "40", not "40.0". */
export function formatVital(value: number, precision: 0 | 1 = 1): string {
  const safe = Number.isFinite(value) ? value : 0;
  return precision === 0 ? String(Math.round(safe)) : safe.toFixed(1);
}

export function vitalRow(input: VitalRowInput, thresholds = DEFAULT_VITAL_THRESHOLDS): VitalRow {
  const precision = input.precision ?? 1;
  const capacity =
    typeof input.capacity === 'number' && Number.isFinite(input.capacity) && input.capacity > 0
      ? input.capacity
      : null;
  const value = Number.isFinite(input.value) ? Math.max(0, input.value) : 0;
  const fraction = capacity === null ? null : clamp01(value / capacity);
  const tone: VitalTone =
    fraction === null
      ? 'ok'
      : fraction <= thresholds.criticalFraction
        ? 'critical'
        : fraction <= thresholds.lowFraction
          ? 'low'
          : 'ok';
  return {
    id: input.id,
    label: input.label,
    valueText:
      capacity === null
        ? formatVital(value, precision)
        : `${formatVital(value, precision)}/${Math.round(capacity)}`,
    fraction,
    tone,
    title:
      capacity === null
        ? `${input.label}: ${formatVital(value, precision)}`
        : `${input.label}: ${formatVital(value, precision)} of ${Math.round(capacity)}`,
  };
}

/**
 * A rate is worth a pixel only when it is not zero: "+0.0/s" on every frame is
 * noise that trains the eye to ignore the field entirely.
 */
export function rateText(perSecond: number | null | undefined): string {
  if (perSecond === null || perSecond === undefined || !Number.isFinite(perSecond)) return '';
  if (Math.abs(perSecond) < 0.05) return '';
  return `${perSecond > 0 ? '+' : ''}${perSecond.toFixed(1)}/s`;
}

import { dayPartAt } from './dayPart.ts';

export interface ClockInput {
  /** 24h clock, HH:MM. */
  time: string;
  /**
   * The server's 0..1 day fraction, for the day-part word. Omitted before the
   * first weather packet: an hour the client has not been told is not a light
   * level it may name.
   */
  timeOfDay?: number;
  day: number;
  season: number;
  /** Seconds left in the season, or null when the server has not said. */
  seasonRemainingS?: number | null;
}

export interface ClockChip {
  main: string;
  /** Season countdown; the tooltip carries it so the chip stays one line. */
  sub: string;
  title: string;
}

/** One clock, not two: the day and the hour share a chip with the season. */
export function clockChip(input: ClockInput, formatSeason: (seconds: number) => string): ClockChip {
  const season = Math.max(1, Math.round(input.season || 1));
  const day = Math.max(1, Math.round(input.day || 1));
  const remaining =
    typeof input.seasonRemainingS === 'number' && Number.isFinite(input.seasonRemainingS)
      ? formatSeason(input.seasonRemainingS)
      : '';
  // `12:00` is only a readable time if the reader knows this world's clock is a
  // 0..1 day fraction. The word and the glyph are the same fact in plain
  // language, and they come from the server's own fraction, not from the light
  // on the client.
  const dayPart =
    typeof input.timeOfDay === 'number' && Number.isFinite(input.timeOfDay)
      ? dayPartAt(input.timeOfDay)
      : null;
  const part = dayPart ? `${dayPart.glyph} ${dayPart.word} \u00B7 ` : '';
  return {
    main: `${part}Season ${season} \u00B7 Day ${day} \u00B7 ${input.time}`,
    sub: remaining ? `Season ends in ${remaining}` : '',
    title: remaining
      ? `${part}Season ${season}, day ${day}, ${input.time}. Season ends in ${remaining}.`
      : `${part}Season ${season}, day ${day}, ${input.time}.`,
  };
}

export type WeatherTone = 'calm' | 'notice' | 'warning';

export interface WeatherChip {
  label: string;
  /** "in 3:13", or empty when there is nothing to count down to. */
  eta: string;
  tone: WeatherTone;
  /** True under a minute: the chip may be emphasised. */
  urgent: boolean;
}

/**
 * The weather is the one live change on screen, so it gets its own chip instead
 * of being line six of a stat card. A warning that is already happening reads as
 * a warning; an approaching one only turns urgent in the last minute.
 */
export function weatherChip(input: {
  state: string;
  label: string;
  nextLabel: string;
  nextState: string;
  secondsUntilNext: number;
}): WeatherChip {
  const seconds = Number.isFinite(input.secondsUntilNext) ? input.secondsUntilNext : 0;
  const changing = seconds > 0 && input.nextState !== input.state;
  const urgent = changing && seconds <= 60;
  const stormy = (state: string): boolean => state.includes('thunderstorm');
  // A storm on its way is a notice even under a clear sky: that is precisely the
  // warning the old layout buried on line six of a stat card.
  const tone: WeatherTone = stormy(input.state)
    ? 'warning'
    : changing && (stormy(input.nextState) || urgent)
      ? 'notice'
      : 'calm';
  return {
    label: input.label,
    eta: changing ? `${input.nextLabel} in ${formatEta(seconds)}` : '',
    tone,
    urgent,
  };
}

/** m:ss, and never a negative countdown. */
export function formatEta(seconds: number): string {
  const total = Math.max(0, Math.ceil(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
