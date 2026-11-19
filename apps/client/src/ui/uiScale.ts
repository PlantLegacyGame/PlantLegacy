/**
 * How much the interface shrinks to fit the pane it is in.
 *
 * The HUD was laid out for a wide window and answered a narrow one by switching to
 * a finger-sized arrangement: below 640px the vitals card went full width, and
 * below 560px the two player panels became one full-pane sheet. That is right on a
 * phone and wrong in a small *browser pane*, which is the common case for this game
 * - an embedded preview, a split window, a laptop with the browser at half width.
 * Measured in a 531x653 pane: the vitals card took 515x143 of it and the inventory
 * covered 515x474, so the world was visible only in the gaps.
 *
 * The fix is one continuous number rather than more breakpoints: the whole overlay
 * scales with the pane, so the same arrangement that works at 1280 wide keeps
 * working, only smaller, and the game keeps the frame. The overlay is scaled with
 * CSS `zoom`, which - unlike a transform - scales layout and hit-testing together:
 * measured, a button 333px wide after scaling still took the click at its centre.
 *
 * A finger layout is never shrunk. Scaling a touch interface down trades away the
 * target size that makes it usable, and there a sheet that covers the world is the
 * correct answer, so `finePointer: false` returns 1. The layout itself makes the
 * same decision through `(hover: none) and (pointer: coarse)`.
 */

/** The pane this interface is drawn for: at or above it, nothing scales. */
export const UI_REFERENCE_W = 1000;
export const UI_REFERENCE_H = 760;

/**
 * The floor. Below it the smallest HUD type (11px from `ui.hud_font_secondary_px`)
 * would fall under what a player can read at a glance, and the way out of a small
 * pane is a bigger pane, not smaller text.
 */
export const UI_SCALE_MIN = 0.72;
export const UI_SCALE_MAX = 1;

export interface UiScaleInput {
  /** Pane width in CSS pixels, from the element the game fills. */
  paneW: number;
  /** Pane height in CSS pixels. */
  paneH: number;
  /**
   * False when the pane is driven by fingers - the stylesheet's
   * `(hover: none) and (pointer: coarse)` layout - which is shown at full size.
   * Defaults to true, because "no opinion" is not "a phone".
   */
  finePointer?: boolean;
}

/**
 * The scale for a pane. Both axes are considered, because a short wide pane and a
 * tall narrow one are equally unable to hold the overlay at full size; the smaller
 * ratio wins. Unknown or zero sizes mean "no opinion": 1.
 */
export function uiScaleForPane(input: UiScaleInput): number {
  if (input.finePointer === false) return 1;
  const width = Number.isFinite(input.paneW) ? input.paneW : 0;
  const height = Number.isFinite(input.paneH) ? input.paneH : 0;
  if (width <= 0 || height <= 0) return 1;
  const raw = Math.min(width / UI_REFERENCE_W, height / UI_REFERENCE_H);
  return Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, raw));
}

/** Write the scale where the stylesheet reads it. */
export function setUiScale(style: CSSStyleDeclaration, scale: number): void {
  style.setProperty('--pl-ui-scale', String(Number.isFinite(scale) ? scale : 1));
}
