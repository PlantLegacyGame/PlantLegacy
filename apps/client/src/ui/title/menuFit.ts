/**
 * How the title menu fits in the pane it is drawn in.
 *
 * The hero column (plant, logotype, name field, Play, Settings, Shop) starts just
 * below the ground line and grows downward, and nothing in it knew how tall the
 * pane was. In a short window - an embedded preview panel, a browser at 1200x300 -
 * the column ran off the bottom: measured in a 900x420 pane, Settings and Shop sat
 * at y 394..438, and at 1200x300 Play, Settings and Shop were all below the pane
 * while the plant was above it. The menu was not laid out wrong; it was laid out
 * for a taller window.
 *
 * Two moves, in this order, because one is not enough:
 *
 * 1. **Scale the column** so its foot clears the guest line and key hint at the
 *    bottom. The whole hero shrinks together and keeps its proportions.
 * 2. **Lift what is left over.** Scaling has a floor - text below about half size
 *    is not text - so a pane shorter than the floor allows would still overflow.
 *    The remainder is taken out of the column's top offset, which moves it up over
 *    the plant instead of off the bottom of the screen. The plant is the scene's
 *    subject but the buttons are the game; a menu that overlaps its own illustration
 *    is still a menu, a Shop button below the window is not.
 *
 * It never scales up: a menu that fits is not enlarged to fill the screen.
 */

/** Ground band kept under the line: the roots, and the foot the menu stands on. */
export const GROUND_BAND_PX = 96;

/**
 * Most of the pane the sky may take.
 *
 * The plant grows upward from the ground line, so the only honest way to give a
 * tall tree room is to move that line down - and the only thing that stops it is
 * the menu standing under it. At 0.66 the sky is two thirds of the pane at most
 * and the hero column always has a third to stand in (at the minimum scale its
 * own `menuFit` allows). Without this the line could slide to 96 px from the
 * bottom to keep a huge plant in frame, which put the Play button on the trunk.
 */
export const SKY_MAX_SHARE = 0.66;

/** The smallest ground band a pane may be given, given how tall it is. */
export function skyGroundPx(viewportPx: number, minPx = GROUND_BAND_PX): number {
  const viewport = Math.max(viewportPx, 0);
  const floor = Number.isFinite(minPx) ? Math.max(0, minPx) : GROUND_BAND_PX;
  if (viewport <= 0) return floor;
  return Math.max(floor, Math.round(viewport * (1 - SKY_MAX_SHARE)));
}

/** Room kept clear at the foot of the pane for the guest line and the key hint. */
export const MENU_FOOT_RESERVE_PX = 52;

/** Smallest the hero column may be scaled to. */
export const MENU_FIT_MIN_SCALE = 0.5;

/** Highest the lifted column's top may sit, in from the top of the pane. */
export const MENU_MIN_TOP_PX = 8;

export interface MenuFitInput {
  /** Height of the pane the menu is drawn in, in CSS pixels. */
  viewportPx: number;
  /** Where the hero column starts, measured from the top of the pane. */
  topPx: number;
  /** The column's own height at scale 1. */
  naturalPx: number;
  /** Room to leave clear at the foot of the pane. */
  reservePx?: number;
  /** Floor for the scale. */
  minScale?: number;
  /** How far the column may be lifted. */
  minTopPx?: number;
}

export interface MenuFit {
  /** Multiplier for the column. 1 means it fits as drawn. */
  scale: number;
  /** Pixels to lift the column (0 or negative), after scaling. */
  liftPx: number;
}

export function menuFit(input: MenuFitInput): MenuFit {
  const viewport = finite(input.viewportPx);
  const top = finite(input.topPx);
  const natural = finite(input.naturalPx);
  const reserve = finite(input.reservePx ?? MENU_FOOT_RESERVE_PX);
  const minScale = finite(input.minScale ?? MENU_FIT_MIN_SCALE);
  const minTop = finite(input.minTopPx ?? MENU_MIN_TOP_PX);
  // A column with no height has nothing to fit, and a scale derived from nothing
  // would hide the menu on its first frame. Ask again after layout.
  if (natural <= 0 || viewport <= 0) return { scale: 1, liftPx: 0 };

  const available = viewport - top - reserve;
  if (!Number.isFinite(available)) return { scale: 1, liftPx: 0 };

  const scale = Math.min(1, Math.max(minScale, available / natural));
  const foot = top + natural * scale;
  const limit = viewport - reserve;
  if (foot <= limit) return { scale, liftPx: 0 };

  // Lift by the overflow, but never past the top of the pane: whatever is still
  // out of room then belongs to the plant, not to the buttons.
  const lift = Math.min(foot - limit, top - minTop);
  return { scale, liftPx: -Math.max(0, lift) };
}

/** Just the scale half of the rule, for callers that only need it. */
export function menuFitScale(input: MenuFitInput): number {
  return menuFit(input).scale;
}

function finite(value: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Where the ground line goes, in pixels, for a pane this tall.
 *
 * The scene's ground line was a fixed share of the pane height
 * (`ui.title_horizon_fraction`, with media-query fallbacks). A share is fine while
 * the pane is tall, and wrong the moment it is not: the plant stands *on* that
 * line and grows upward, so at 1200x300 the horizon at 54% put the mascot's top
 * above the top of the pane while its own buttons fell off the bottom. The line has
 * to answer to the plant's height, which is why this rule takes it.
 *
 * It stays a share of the pane where it can, and is pushed down only enough to give
 * the plant sky above it, never so far that the ground band disappears.
 */
export interface HorizonInput {
  /** Height of the pane, in CSS pixels. */
  viewportPx: number;
  /** `ui.title_horizon_fraction`: where the line would sit as a share of the pane. */
  fraction: number;
  /** Height the plant is drawn at, in CSS pixels. */
  plantPx: number;
  /** Sky kept above the plant's top, in pixels. */
  topPadPx?: number;
  /** Ground kept below the line, in pixels. */
  minGroundPx?: number;
}

export function horizonForPane(input: HorizonInput): number {
  const viewport = input.viewportPx > 0 ? input.viewportPx : 0;
  if (viewport <= 0) return 0;
  const pad = Number.isFinite(input.topPadPx) ? (input.topPadPx as number) : 10;
  const ground = Number.isFinite(input.minGroundPx) ? (input.minGroundPx as number) : 96;
  const fraction = Number.isFinite(input.fraction) ? input.fraction : 0.54;
  const plant = Number.isFinite(input.plantPx) && input.plantPx > 0 ? input.plantPx : 0;

  const desired = Math.min(1, Math.max(0, fraction)) * viewport;
  // The plant stands on the line and grows upward, so the line must sit at least
  // its own height down: that is the only reason to move it from the configured
  // share. The ground band below is the ceiling - when a pane cannot hold both, the
  // top of the art gives way, never the menu.
  const wantsSky = plant + pad;
  const ceiling = Math.max(0, viewport - ground);
  return Math.max(0, Math.min(ceiling, Math.max(desired, wantsSky)));
}

/**
 * Largest the mascot may be drawn in this pane.
 *
 * The plant's own height is the thing the ground line has to clear, so the pane's
 * sky is the plant's budget: it may be as tall as the band above the line, and no
 * taller. `PLANT_ART_ASPECT` is the art's own height over its width (200 units
 * wide around 283 units of drawing), so a maximum *width* is what the CSS can set.
 *
 * `maxScale` is the important part: care scales the drawing up to 1.6x, and a cap
 * derived from the unscaled art is a cap that the grown tree walks straight
 * through - which is how the crown ended up above the top of the pane. The budget
 * is divided by it, so the tree at its full height is the tree that fits.
 */
export const PLANT_ART_ASPECT = 283 / 200;

export function mascotMaxWidthPx(
  viewportPx: number,
  groundPx: number,
  minPx = 84,
  maxScale = 1,
): number {
  const viewport = Math.max(viewportPx, 0);
  if (viewport <= 0) return minPx;
  const scale = Number.isFinite(maxScale) && maxScale > 0 ? maxScale : 1;
  const aspect = PLANT_ART_ASPECT * scale;
  const room = Math.max(minPx * aspect, viewport - groundPx);
  return Math.max(minPx, room / aspect);
}
