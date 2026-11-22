/**
 * The title sky, as data.
 *
 * The clouds were an inline array in `TitleScene` and a family picked by
 * `seed % 3` inside `cloudArt`: two places deciding one thing, so "more cloud
 * shapes" meant editing a generator and "the clouds do not move" could not be
 * tested at all, because the motion was a keyframe nobody measured. The layout is
 * a table here, the motion is one number - a crossing measured in viewport widths
 * - and `skyLayout.test.ts` checks what a person would otherwise have to stare at:
 * every cloud is set to move, no thin streak hangs in the bottom-right corner, and
 * the sun and the moon are one size.
 *
 * The ground's cloud shadows read the same table, so a shadow cannot pass at a
 * different speed from the cloud that cast it.
 */

import type { CloudFamily } from './cloudArt.ts';

export interface CloudSpec {
  id: string;
  /** The cloud's left edge at the start of its crossing, in % of the sky's width. */
  left: number;
  /** Its top edge, in % of the sky's height (0 is the top of the pane). */
  top: number;
  /** Its width, in % of the sky's width. */
  width: number;
  family: CloudFamily;
  /** Seconds for one full crossing. Short is fast; a crosswind is not a gale. */
  crossS: number;
  /** Negative starts the cloud part-way across, so the sky is never empty. */
  delayS: number;
  opacity: number;
}

/** Sun and moon are one body size: a moon a third smaller reads as an error. */
export const CELESTIAL_SIZE_VMIN = 11.6;

/**
 * How far a cloud travels in one crossing, in viewport widths.
 *
 * The old motion was two keyframes 2.2% of the cloud's *own* width apart over two
 * minutes - about seven pixels an hour, which is a still sky with an animation in
 * the file. The title sky is the whole 200vw world, so a crossing has to be the
 * world plus the cloud's own width: a cloud starts with its trailing edge on the
 * upwind edge of the world and leaves by the far one, and the weather is there on
 * the sides when the camera pulls back. 230vw also keeps a cloud's on-screen
 * speed close to what the crossing times were tuned for.
 */
export const CLOUD_TRAVEL_VW = 230;

/**
 * Which way the weather blows: 1 west to east, -1 east to west.
 *
 * One value for the whole sky, because the clouds in one sky are in one wind. A
 * cloud no longer begins where it is drawn: every cloud starts just off the
 * upwind edge and crosses the frame, so it *enters* instead of appearing in the
 * middle of the blue. The shadows read the same sign, so the shade under a cloud
 * still comes from the same direction.
 */
export const CLOUD_WIND: 1 | -1 = 1;

/**
 * The weather, from the low banks to the high sheets.
 *
 * Two rules kept the old sky dull and are broken on purpose here: every cloud was
 * a wide bank (so the sky read as one shape at five sizes), and the widest, lowest
 * one sat in the bottom-right corner where a thin horizontal puff reads as a
 * sausage. The thin families are high, the tall ones are mid, and the low ones are
 * wide and soft.
 */
export const CLOUDS: readonly CloudSpec[] = [
  {
    id: 'bank-west',
    left: -14,
    top: 26,
    width: 30,
    family: 'bank',
    crossS: 128,
    delayS: -30,
    opacity: 0.92,
  },
  {
    id: 'cumulus-mid',
    left: 22,
    top: 33,
    width: 18,
    family: 'cumulus',
    crossS: 104,
    delayS: -78,
    opacity: 0.84,
  },
  {
    id: 'tower-east',
    left: 54,
    top: 18,
    width: 20,
    family: 'tower',
    crossS: 118,
    delayS: -12,
    opacity: 0.9,
  },
  {
    id: 'puff-small',
    left: 38,
    top: 44,
    width: 11,
    family: 'puff',
    crossS: 88,
    delayS: -58,
    opacity: 0.7,
  },
  {
    id: 'bank-far',
    left: 64,
    top: 47,
    width: 17,
    family: 'bank',
    crossS: 96,
    delayS: -96,
    opacity: 0.66,
  },
  {
    id: 'cumulus-west',
    left: -28,
    top: 51,
    width: 22,
    family: 'cumulus',
    crossS: 140,
    delayS: -50,
    opacity: 0.72,
  },
  {
    id: 'veil-high',
    left: 8,
    top: 7,
    width: 34,
    family: 'veil',
    crossS: 150,
    delayS: -20,
    opacity: 0.34,
  },
  {
    id: 'wisp-high',
    left: 44,
    top: 13,
    width: 26,
    family: 'wisp',
    crossS: 132,
    delayS: -104,
    opacity: 0.3,
  },
  {
    id: 'puff-high',
    left: 74,
    top: 5,
    width: 14,
    family: 'puff',
    crossS: 112,
    delayS: -70,
    opacity: 0.26,
  },
  {
    id: 'tower-far',
    left: 86,
    top: 30,
    width: 15,
    family: 'tower',
    crossS: 100,
    delayS: -40,
    opacity: 0.6,
  },
  {
    id: 'veil-west',
    left: -22,
    top: 39,
    width: 26,
    family: 'veil',
    crossS: 146,
    delayS: -112,
    opacity: 0.4,
  },
  {
    id: 'bank-low',
    left: 2,
    top: 58,
    width: 21,
    family: 'bank',
    crossS: 124,
    delayS: -84,
    opacity: 0.62,
  },
  {
    id: 'puff-east',
    left: 92,
    top: 21,
    width: 12,
    family: 'puff',
    crossS: 94,
    delayS: -24,
    opacity: 0.5,
  },
  {
    id: 'wisp-low',
    left: 12,
    top: 18,
    width: 23,
    family: 'wisp',
    crossS: 136,
    delayS: -8,
    opacity: 0.24,
  },
];

/** One shadow on the soil, matched to a cloud above it. */
export interface CloudShadowSpec {
  id: string;
  /** Centre of the shadow, in % of the soil band's width. */
  left: number;
  /** Its top, in % of the soil band's height. */
  top: number;
  /** Width in % of the band's width. */
  width: number;
  crossS: number;
  delayS: number;
  opacity: number;
}

/**
 * Shadows for the three biggest clouds.
 *
 * They are the clouds' own specs, not a second set: a shadow that drifts at its
 * own speed while the cloud above it drifts at another is the one thing that makes
 * weather look painted on. Same crossing time, same offset, slightly wider.
 */
export function cloudShadows(clouds: readonly CloudSpec[] = CLOUDS, count = 3): CloudShadowSpec[] {
  return clouds
    .filter((cloud) => cloud.width >= 16)
    .slice(0, Math.max(0, count))
    .map((cloud, index) => ({
      id: `${cloud.id}-shadow`,
      left: cloud.left + cloud.width / 2,
      top: 6 + index * 12,
      width: cloud.width * 1.15,
      crossS: cloud.crossS,
      delayS: cloud.delayS,
      opacity: Math.min(1, cloud.opacity * 0.9),
    }));
}
