/**
 * The day's four parts, from the server's clock.
 *
 * The vitals chip said `12:00` and nothing else, so a player had to know that
 * this world's clock is a 0..1 day fraction and that 0.5 is noon to read it. The
 * word and the glyph are the same fact in plain language: dawn, day, dusk, night.
 *
 * The boundaries are clock times, not light levels: the server owns the light and
 * the two are close enough that the label must not be a second guess at it.
 * Pure, so the edges can be tested to the minute.
 */

export type DayPart = 'dawn' | 'day' | 'dusk' | 'night';

export interface DayPartLabel {
  part: DayPart;
  word: string;
  /** A sun or moon that renders in a HUD font, not an emoji. */
  glyph: string;
}

const HOURS = (hour: number): number => hour / 24;

interface Boundary extends DayPartLabel {
  at: number;
}

/** In ascending order; the wrap below the first one is night. */
const BOUNDARIES: readonly Boundary[] = [
  { at: HOURS(5), part: 'dawn', word: 'Dawn', glyph: '\u25D0' },
  { at: HOURS(8), part: 'day', word: 'Day', glyph: '\u2600' },
  { at: HOURS(17), part: 'dusk', word: 'Dusk', glyph: '\u25D1' },
  { at: HOURS(20), part: 'night', word: 'Night', glyph: '\u263E' },
];

const NIGHT: DayPartLabel = { part: 'night', word: 'Night', glyph: '\u263E' };

export function dayPartAt(timeOfDay: number): DayPartLabel {
  // Only wrap a value that is actually outside the day. `((x % 1) + 1) % 1`
  // looks harmless and is not: adding one and taking the remainder again loses
  // a bit, so 05:00 exactly came back a hair under dawn and was called night.
  let t = Number.isFinite(timeOfDay) ? timeOfDay : 0;
  if (t < 0 || t >= 1) t -= Math.floor(t);
  let current = NIGHT;
  for (const boundary of BOUNDARIES) {
    if (t < boundary.at) break;
    current = boundary;
  }
  return { part: current.part, word: current.word, glyph: current.glyph };
}
