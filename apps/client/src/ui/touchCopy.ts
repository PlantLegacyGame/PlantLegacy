/**
 * What a phone is told about itself.
 *
 * The finger layout needs its own words in three places - the title's one line,
 * the Hints card, and the Controls tab - and the first draft wrote them three
 * times: a `hint_card_lines_touch` config key, a table inside the settings panel,
 * and a string inside the title scene. Three copies of one gesture vocabulary is
 * three things to forget to update, and they had already drifted (the settings
 * table listed a recentre gesture the Hints card did not mention).
 *
 * This module is now the only place. The table is the vocabulary; the title line
 * and the Hints card are written from the same facts. The game's own description
 * of itself ("you are a plant") is not here: that is not a phone fact, and
 * `config/onboarding.json` keeps it for both layouts.
 *
 * Every line here is something the build actually does. A line that stops being
 * true is a bug in this file, not a wording problem.
 */

export interface TouchGesture {
  /** The verb, in the words the bar and the panels use. */
  readonly action: string;
  /** The finger that does it. */
  readonly gesture: string;
}

/**
 * The controls a finger can reach, in the order a player meets them: the camera
 * first, then the core verb, then the two that are not on the bar.
 */
export const TOUCH_GESTURES: readonly TouchGesture[] = [
  { action: 'Orbit', gesture: 'One-finger drag' },
  { action: 'Pan', gesture: 'Two-finger drag' },
  { action: 'Zoom', gesture: 'Pinch' },
  { action: 'Recentre', gesture: 'Double-tap' },
  { action: 'Select a part', gesture: 'Tap' },
  { action: 'Grow', gesture: 'Grow, then tap a part' },
  { action: 'Root sight', gesture: 'Root sight in the bar' },
  { action: 'Reroot', gesture: 'Pad on the status card' },
];

/**
 * The one line at the foot of the title screen.
 *
 * The keyboard line names H; a phone has no H, and hiding the menu is not what a
 * finger wants to do with a plant it can touch.
 */
export const TOUCH_TITLE_HINT = 'Drag to look · tap the plant';

/** The two facts on the Hints card that differ from the keyboard card. */
const TOUCH_HINT_LINES: readonly string[] = [
  '1-finger drag: Orbit  |  Two-finger drag: Pan  |  Pinch: Zoom  |  Double-tap: Recentre',
  'Tap: Select (Normal: focus, Grow: options)  |  Grow, Root sight and the other verbs are in the bar',
];

/**
 * The three-line Hints card for a finger layout.
 *
 * The caller passes the keyboard card so the last line - the game's own
 * description of what the player is - is read from its one owner instead of being
 * copied here. If the card ever shrinks below three lines, the short version is
 * better than an invented sentence.
 */
export function touchHintLines(keyboardLines: readonly string[]): string[] {
  const shared = keyboardLines.slice(-1);
  return [...TOUCH_HINT_LINES, ...shared];
}
