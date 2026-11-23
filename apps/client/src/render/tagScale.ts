/**
 * Name-tag size, in world terms.
 *
 * A tag used to be sized for one goal only: exactly `TARGET_TEXT_PX` tall on
 * screen at every distance, which made a rival 50 m away as loud as one at arm's
 * length and a row of tags at mid distance read as a wall of text. A tag is a
 * thing standing over a plant, so it grows and shrinks with distance - but a
 * plant is legible or it is not, so the projection falloff is gentle and there is
 * a floor beneath which the tag would only be a smear.
 *
 * Pure, so the curve can be checked without a camera: `tagTextPx` falls with
 * distance, equals the authored size at the reference distance, and is bounded.
 */

export interface TagScaleConfig {
  /** Distance at which a tag is its authored size. */
  referenceDistanceM: number;
  /** Text height on screen at the reference distance, in CSS pixels. */
  referenceTextPx: number;
  /**
   * How hard the tag answers distance. 0 would be constant screen size (what the
   * old tags did); 1 would be a true world object. Values under one keep a tag
   * readable at range while still letting distance mean something.
   */
  falloff: number;
  minTextPx: number;
  maxTextPx: number;
}

export const DEFAULT_TAG_SCALE: TagScaleConfig = {
  referenceDistanceM: 20,
  referenceTextPx: 16,
  falloff: 0.35,
  minTextPx: 7,
  maxTextPx: 22,
};

/** Text height on screen for a tag at this distance, in CSS pixels. */
export function tagTextPx(distanceM: number, config: TagScaleConfig = DEFAULT_TAG_SCALE): number {
  const distance = Number.isFinite(distanceM)
    ? Math.max(0.1, distanceM)
    : config.referenceDistanceM;
  const ratio = config.referenceDistanceM / distance;
  const projected = config.referenceTextPx * Math.max(0.0001, ratio) ** config.falloff;
  return Math.min(config.maxTextPx, Math.max(config.minTextPx, projected));
}
