/**
 * Soil moisture and feed, as a small physical model rather than a splash decal.
 *
 * A landing does not draw a ring on the ground. It joins the nearest patch if it
 * is close enough, because water arriving beside water gathers; if it is not, it
 * starts a new patch. A patch holds two independent deposits:
 *
 * - water, which infiltrates quickly and deeply, darkening the soil to a cap;
 * - feed, which is slower, shallower, and warms the soil rather than wetting it.
 *
 * When the water is at its cap, more water cannot darken the patch further. The
 * excess widens the soil it reaches instead, which is the visible version of
 * water moving sideways into drier soil. The same rule applies to feed at its own
 * lower cap.
 *
 * This module is deliberately independent of the DOM: the menu renders the
 * numbers as a soft-edged vertical stain, but the gathering/capping/spreading
 * rules can be tested without a browser.
 */

export type SoakKind = 'water' | 'feed';

export interface SoilPatch {
  /** Stable identity for the menu's element map. */
  id: number;
  /** Centre of the deposit in the soil layer's own pixels. */
  x: number;
  /** Deposits in arbitrary equal units; one landing is one unit. */
  water: number;
  feed: number;
  /** Full width of the damp/enriched soil, in soil-layer pixels. */
  width: number;
  /** How far water has gone down from the soil line. */
  waterDepth: number;
  /** How far feed has gone down from the soil line. */
  feedDepth: number;
}

export const SOAK = {
  /** A landing within this margin of a patch joins it instead of starting a new one. */
  gatherRadius: 90,
  water: {
    capacity: 10,
    baseWidth: 48,
    widthPerDeposit: 4.2,
    overflowWidth: 6,
    baseDepth: 20,
    depthPerDeposit: 8,
    saturationDepth: 26,
    maxWidth: 220,
    maxDepth: 210,
  },
  feed: {
    capacity: 8,
    baseWidth: 42,
    widthPerDeposit: 2.8,
    overflowWidth: 4.2,
    baseDepth: 16,
    depthPerDeposit: 5.5,
    saturationDepth: 18,
    maxWidth: 190,
    maxDepth: 108,
  },
} as const;

function finiteAmount(amount: number): number {
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}

/** How saturated the water is, 0..1. This is the darkness cap. */
export function soakMoisture(patch: SoilPatch): number {
  return Math.min(1, Math.max(0, patch.water) / SOAK.water.capacity);
}

/** How enriched the feed is, 0..1. Feed never makes the soil look watery. */
export function soakFertility(patch: SoilPatch): number {
  return Math.min(1, Math.max(0, patch.feed) / SOAK.feed.capacity);
}

/**
 * Add one deposit to a patch.
 *
 * The first deposits deepen and darken a patch. Past the cap, saturation and
 * infiltration depth stop: the soil under the landing is full and the extra water
 * is now moving sideways into the drier soil, so only width keeps growing. Width
 * is capped too, because a patch that spans the whole cut is no longer a patch.
 */
export function addSoak(patch: SoilPatch, kind: SoakKind, amount = 1): SoilPatch {
  const add = finiteAmount(amount);
  const water = patch.water + (kind === 'water' ? add : 0);
  const feed = patch.feed + (kind === 'feed' ? add : 0);
  const moisture = Math.min(1, water / SOAK.water.capacity);
  const fertility = Math.min(1, feed / SOAK.feed.capacity);
  const waterOverflow = Math.max(0, water - SOAK.water.capacity);
  const feedOverflow = Math.max(0, feed - SOAK.feed.capacity);
  // Infiltration depth follows the water the soil can hold, not the water poured
  // on top of it. Once this patch is saturated, extra water has to go sideways
  // into the drier soil instead of drilling a deeper hole under the same spot.
  const waterInfiltrated = Math.min(water, SOAK.water.capacity);
  const feedInfiltrated = Math.min(feed, SOAK.feed.capacity);
  const width = Math.min(
    Math.max(SOAK.water.maxWidth, SOAK.feed.maxWidth),
    SOAK.water.baseWidth +
      water * SOAK.water.widthPerDeposit +
      feed * SOAK.feed.widthPerDeposit +
      waterOverflow * SOAK.water.overflowWidth +
      feedOverflow * SOAK.feed.overflowWidth,
  );
  const waterDepth = Math.min(
    SOAK.water.maxDepth,
    SOAK.water.baseDepth +
      waterInfiltrated * SOAK.water.depthPerDeposit +
      moisture * SOAK.water.saturationDepth,
  );
  const feedDepth = Math.min(
    SOAK.feed.maxDepth,
    SOAK.feed.baseDepth +
      feedInfiltrated * SOAK.feed.depthPerDeposit +
      fertility * SOAK.feed.saturationDepth,
  );
  return {
    ...patch,
    water,
    feed,
    width,
    waterDepth,
    feedDepth,
  };
}

/** Start a patch at a landing. */
export function createSoakPatch(id: number, x: number, kind: SoakKind, amount = 1): SoilPatch {
  return addSoak(
    {
      id,
      x,
      water: 0,
      feed: 0,
      width: 0,
      waterDepth: 0,
      feedDepth: 0,
    },
    kind,
    amount,
  );
}

/**
 * The patch a landing should gather into, if any.
 *
 * The reach includes part of the patch's own width: a drop at the edge of a wide
 * wet patch is landing on that patch, not starting a second one beside it.
 */
export function gatherSoak(
  patches: ReadonlyArray<SoilPatch>,
  x: number,
  margin = SOAK.gatherRadius,
): SoilPatch | undefined {
  let best: SoilPatch | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const patch of patches) {
    const distance = Math.abs(patch.x - x);
    const reach = margin + patch.width * 0.35;
    if (distance <= reach && distance < bestDistance) {
      best = patch;
      bestDistance = distance;
    }
  }
  return best;
}
