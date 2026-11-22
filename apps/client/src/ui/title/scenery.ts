/**
 * The life around the title's ground.
 *
 * The picture was a plant on a horizon: hills behind it, a cut of soil under it,
 * weather over it. That is a landscape, not a place - nothing in it answered the
 * hour or the season, and nothing in it was alive. These are the small things that
 * make it a place: flowers that follow the season, mushrooms that come up after
 * rain, a barrel that fills with what fell, a lamp that comes on at dusk, a mill
 * turning on the ridge, birds and bats crossing, a rabbit in the near field and a
 * worm in the soil.
 *
 * A prop earns its place by saying something the others do not, and it has to be
 * legible at the size it is drawn: about fifteen pixels on screen. A windsock said
 * the same thing as the flowers' sway and the mill's sails at ten, and a beetle in
 * the cut read as a smudge beside the finds, so both went.
 *
 * The module is data and art, not DOM: what is visible for a given sky is a pure
 * function (`sceneryLevels`), so the gates can be tested without a browser, and
 * the scene only writes their answers onto a handful of elements. Everything is
 * drawn in the title's own flat cutout style - SVG paths, palette variables, no
 * bitmaps - and nothing here animates anything but a transform or an opacity.
 */

export type TitleSeason = 'spring' | 'summer' | 'autumn' | 'winter';

const SEASONS: readonly TitleSeason[] = ['spring', 'summer', 'autumn', 'winter'];

/**
 * The world's season number on the title's four-season wheel.
 *
 * The world counts seasons from one and keeps counting; the title has four
 * drawings of a verge, so the wheel wraps. Season 1 is spring, the season the
 * world starts in, so a fresh world opens on the flowers rather than on the
 * seed heads.
 */
export function seasonOf(seasonNumber: number): TitleSeason {
  // Zero is "the server has not said yet" (a title built before the first season
  // update), so it opens on spring rather than on a season nobody announced.
  if (!Number.isFinite(seasonNumber) || seasonNumber < 1) return 'spring';
  const index = (((Math.trunc(seasonNumber) - 1) % 4) + 4) % 4;
  return SEASONS[index] ?? 'spring';
}

/** How much of the verge is in flower, per season. */
export const BLOOM_LEVEL: Record<TitleSeason, number> = {
  spring: 1,
  summer: 0.85,
  autumn: 0.55,
  // Winter keeps the stalks. A verge with nothing standing in it is a verge that
  // has been mown, not one that is asleep.
  winter: 0.16,
};

/** The season's flower colour, before the hour is mixed in. */
export const BLOOM_COLOUR: Record<TitleSeason, string> = {
  spring: '#f4ecd8',
  summer: '#efb45c',
  autumn: '#c67a43',
  winter: '#c8d6dd',
};

export interface ScenerySky {
  /** The palette's star value: 0 in daylight, 1 at night. */
  star: number;
  /** Rain falling now, 0..1. */
  rain: number;
  /**
   * Standing water in the ground, 0..1: the mean of the shared cover rules'
   * per-column water. This is what makes mushrooms and worms weather rather than
   * decoration - they answer the ground, not the sky.
   */
  soak: number;
  season: TitleSeason;
}

export interface SceneryLevels {
  /** Birds crossing in daylight. */
  birds: number;
  /** Bats crossing after dark. */
  bats: number;
  /** The rabbit in the near field. */
  rabbit: number;
  /** Mushroom clusters on the ground line. */
  mushrooms: number;
  /** Worms in the soil. */
  worms: number;
  /** The lamp: on from dusk, off at dawn. */
  warmLight: number;
  /** How much of the verge is in flower. */
  blooms: number;
}

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

/**
 * What can be seen for a given sky.
 *
 * Every number is 0..1 and monotone in its input, so a sky that gets darker can
 * only put the birds away and bring the bats out - there is no weather that makes
 * a bird fly and roost at once. Animals shelter in rain (`exposed`), which is why
 * a downpour empties the sky and the field while it fills the soil.
 */
export function sceneryLevels(sky: ScenerySky): SceneryLevels {
  const star = clamp01(sky.star);
  const rain = clamp01(sky.rain);
  const soak = clamp01(sky.soak);
  const day = 1 - star;
  // Rain drives everything with a burrow indoors. The factor is steeper than the
  // rain number so a shower at 0.65 has already cleared the field: a rabbit sitting
  // in a downpour reads as a bug, not as wildlife.
  const exposed = clamp01(1 - rain * 1.45);
  return {
    // Birds are out while there is light, and gone by the time the bats appear: a
    // sky with both in it is a sky that has not decided what time it is.
    birds: clamp01((0.55 - star) / 0.5) * exposed,
    bats: clamp01((star - 0.55) / 0.4) * exposed,
    rabbit: clamp01(0.35 + day * 0.75) * exposed,
    // The ground has to be actually wet, not merely rained on: the first per cent
    // of cover disappears into the soil. The thresholds are low enough to be reached
    // by a real shower - measured, the soak climbs about 0.01 a second in steady rain,
    // so mushrooms show after half a minute and the worm after about a minute of it.
    // They used to gate at 0.18 and 0.3, which a title-length shower never reached:
    // two of the props were painted and never seen.
    mushrooms: clamp01((soak - 0.05) / 0.3),
    worms: clamp01((soak - 0.16) / 0.32),
    // A lamp answers the light, not a clock hour: heavy cloud at four in the
    // afternoon lights it early, which is what a lamp on a post actually does.
    warmLight: clamp01((star - 0.25) / 0.45),
    blooms: BLOOM_LEVEL[sky.season] * clamp01(1 - rain * 0.7),
  };
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

export interface FlowerClump {
  /** Centre of the clump, as a per cent of the verge's own width. */
  x: number;
  /** Size of the clump, 1 being the authored drawing. */
  scale: number;
  /** Degrees of lean, so six clumps are not a row of upright marks. */
  lean: number;
}

/**
 * Four clumps, hand-placed and kept off the plant's own footprint (it stands at 50%
 * and is wide): a pair either side. Nothing here is seeded - four marks are a
 * composition, not a field, and six of them were a row of specks.
 */
export const FLOWER_CLUMPS: readonly FlowerClump[] = [
  { x: 8, scale: 0.95, lean: -5 },
  { x: 17, scale: 1.05, lean: 3 },
  { x: 85, scale: 1.1, lean: 4 },
  { x: 92, scale: 0.92, lean: -4 },
];

export interface MushroomCluster {
  /** Centre of the cluster, as a per cent of the verge's own width. */
  x: number;
  scale: number;
  /** Degrees of tilt: a cluster that grows straight up is a diagram. */
  tilt: number;
}

/**
 * Two clusters, both in the plant's lee where a verge holds its damp: one at each
 * edge of the canopy, close enough to the stem to read as growing from its shadow.
 */
export const MUSHROOM_CLUSTERS: readonly MushroomCluster[] = [
  { x: 27, scale: 0.95, tilt: -4 },
  { x: 71, scale: 1, tilt: 5 },
];

// ---------------------------------------------------------------------------
// Art
// ---------------------------------------------------------------------------

/**
 * One clump: three stems at different heights and a flower on each, drawn in a
 * 40x100 box that the element scales. The leaves are two strokes, because at this
 * size a leaf with a shape is a smudge.
 */
export function flowerArt(): string {
  return `<svg viewBox="0 0 40 100" aria-hidden="true" focusable="false">
    <g class="pl-scene__flower-stems" fill="none" stroke="var(--pl-stem-colour, #55703a)" stroke-width="2.1" stroke-linecap="round">
      <path d="M14 100 Q12 60 16 30"/>
      <path d="M22 100 Q23 66 26 44"/>
      <path d="M30 100 Q29 72 32 58"/>
      <path d="M16 78 Q10 72 7 66 M26 78 Q31 73 34 68 M32 82 Q36 80 38 77"/>
    </g>
    <g fill="var(--pl-bloom-colour, #f4ecd8)">
      <circle cx="16" cy="27" r="4.6"/>
      <circle cx="12.5" cy="23" r="3.4"/>
      <circle cx="19.5" cy="23" r="3.4"/>
      <circle cx="16" cy="20" r="3.2"/>
      <circle cx="26" cy="41" r="4.1"/>
      <circle cx="23" cy="38" r="3"/>
      <circle cx="29" cy="38" r="3"/>
      <circle cx="32" cy="55" r="3.5"/>
      <circle cx="29.5" cy="52.5" r="2.6"/>
      <circle cx="34.5" cy="52.5" r="2.6"/>
    </g>
    <g fill="var(--pl-bloom-heart, #d8a54e)">
      <circle cx="16" cy="24" r="1.5"/>
      <circle cx="26" cy="39" r="1.3"/>
      <circle cx="32" cy="53" r="1.1"/>
    </g>
  </svg>`;
}

/** A cluster of three mushrooms, in a 60x50 box. */
export function mushroomArt(): string {
  return `<svg viewBox="0 0 60 50" aria-hidden="true" focusable="false">
    <g stroke="var(--pl-mushroom-stem, #e6dcc4)" stroke-width="0" fill="var(--pl-mushroom-stem, #e6dcc4)">
      <path d="M12 50 Q10 39 13 33 L17 33 Q20 40 18 50 Z"/>
      <path d="M29 50 Q27 34 30 26 L34 26 Q36 35 35 50 Z"/>
      <path d="M45 50 Q44 41 46 36 L50 36 Q51 42 49 50 Z"/>
    </g>
    <g fill="var(--pl-mushroom-cap, #b7583f)">
      <path d="M3 34 Q8 20 15 20 Q22 20 27 34 Z"/>
      <path d="M20 27 Q25 9 32 9 Q39 9 42 27 Z"/>
      <path d="M37 37 Q41 27 47 27 Q53 27 56 37 Z"/>
    </g>
    <g fill="var(--pl-mushroom-spot, #f3e7cf)" opacity="0.8">
      <circle cx="13" cy="27" r="1.6"/>
      <circle cx="30" cy="17" r="1.9"/>
      <circle cx="46" cy="31" r="1.4"/>
    </g>
  </svg>`;
}

/**
 * The rain barrel, in a 44x50 box.
 *
 * The water is not part of the drawing: it is a div the scene sizes from the
 * ground's own soak, so the level in the barrel is the water in the ground rather
 * than a second weather guess.
 */
export function barrelArt(): string {
  return `<svg viewBox="0 0 44 50" aria-hidden="true" focusable="false">
    <ellipse cx="22" cy="48.4" rx="17" ry="2.6" fill="#000" opacity="0.22"/>
    <path d="M8 8 Q4 26 8 44 Q22 50 36 44 Q40 26 36 8 Q22 12 8 8 Z" fill="var(--pl-wood, #6b4a2a)"/>
    <path d="M8 8 Q22 12 36 8" fill="none" stroke="var(--pl-wood-light, #8a6438)" stroke-width="2.4"/>
    <path d="M11 20 Q22 23 33 20 M10 33 Q22 36 34 33" fill="none" stroke="var(--pl-wood-dark, #4a3018)" stroke-width="1.6" opacity="0.75"/>
    <g fill="none" stroke="var(--pl-metal, #3f3a33)" stroke-width="2.6">
      <path d="M7.6 15 Q22 18.4 36.4 15"/>
      <path d="M7.2 40 Q22 43.4 36.8 40"/>
    </g>
  </svg>`;
}

/** A lamp on a short post, in a 40x100 box. The light is CSS, not part of this. */
export function lanternArt(): string {
  return `<svg viewBox="0 0 40 100" aria-hidden="true" focusable="false">
    <path d="M18.6 100 L19.4 30 L21.6 30 L22.4 100 Z" fill="var(--pl-wood, #6b4a2a)"/>
    <path d="M12 30 H28" stroke="var(--pl-wood, #6b4a2a)" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M20 30 V36" stroke="var(--pl-metal, #3f3a33)" stroke-width="1.8"/>
    <path d="M14 38 H26 L28 57 H12 Z" fill="var(--pl-metal, #3f3a33)"/>
    <path class="pl-scene__lamp-glass" d="M15.6 40 H24.4 L26 55 H14 Z" fill="var(--pl-lamp-warm, #ffd28a)"/>
    <path d="M12 57 H28 L26 61 H14 Z" fill="var(--pl-metal, #3f3a33)"/>
  </svg>`;
}

/**
 * The mill on the middle ridge, in a 64x90 box.
 *
 * The sails are one group: the scene spins them at the wind's pace, and a mill
 * that turns faster in a gale is the cheapest way to show that the sky is doing
 * something to the land as well as to the trees.
 */
export function millArt(): string {
  return `<svg viewBox="0 0 64 90" aria-hidden="true" focusable="false">
    <path d="M24 90 L27 34 H37 L40 90 Z" fill="var(--pl-mill-body, #4a4034)"/>
    <path d="M22 36 L32 22 L42 36 Z" fill="var(--pl-mill-roof, #38302a)"/>
    <g class="pl-scene__sails">
      <g fill="var(--pl-mill-sail, #d9d2c0)" opacity="0.92">
        <path d="M30 4 L34 4 L34 31 L30 31 Z"/>
        <path d="M30 37 L34 37 L34 64 L30 64 Z"/>
        <path d="M2 32 L29 32 L29 36 L2 36 Z"/>
        <path d="M35 32 L62 32 L62 36 L35 36 Z"/>
      </g>
      <circle cx="32" cy="34" r="3" fill="var(--pl-wood-dark, #4a3018)"/>
    </g>
    <path d="M29 58 h6 v7 h-6 z" fill="var(--pl-mill-roof, #38302a)"/>
  </svg>`;
}

/** Five birds, in a 100x30 box. Two strokes each - a bird at this size is a v. */
export function birdFlockArt(): string {
  const birds = [
    [8, 12, 1],
    [26, 6, 0.9],
    [44, 16, 1.1],
    [62, 8, 0.85],
    [78, 18, 0.95],
  ]
    .map(
      ([x = 0, y = 0, s = 1]) =>
        `<path d="M${x} ${y} q ${5 * s} ${-4 * s} ${9 * s} 0 q ${4 * s} ${-4 * s} ${9 * s} 0"/>`,
    )
    .join('');
  return `<svg viewBox="0 0 100 30" aria-hidden="true" focusable="false">
    <g fill="none" stroke="var(--pl-bird, #232b31)" stroke-width="1.6" stroke-linecap="round" opacity="0.8">${birds}</g>
  </svg>`;
}

/** Three bats, in an 80x24 box. */
export function batFlockArt(): string {
  const bats = [
    [10, 12],
    [36, 6],
    [62, 15],
  ]
    .map(
      ([x = 0, y = 0]) =>
        `<path d="M${x} ${y} q -5 -5 -10 -1 q 3 4 6 3 q 2 5 4 1 q 2 4 4 -1 q 3 1 6 -3 q -5 -4 -10 1 Z"/>`,
    )
    .join('');
  return `<svg viewBox="0 0 80 24" aria-hidden="true" focusable="false">
    <g fill="var(--pl-bat, #1b2228)" opacity="0.85">${bats}</g>
  </svg>`;
}

/** A sitting rabbit, in a 40x46 box. */
export function rabbitArt(): string {
  return `<svg viewBox="0 0 40 46" aria-hidden="true" focusable="false">
    <path d="M11 46 Q7 36 9 29 Q11 23 17 21 Q22 19 26 22 Q31 25 32 32 Q33 39 30 46 Z" fill="var(--pl-rabbit, #2b352c)"/>
    <path d="M25 23 Q29 18 30 12 Q31 6 34 7 Q36 8 34 14 Q32 20 29 25 Z" fill="var(--pl-rabbit, #2b352c)"/>
    <path d="M24 24 Q27 18 27.6 12 Q28 7 30.6 8 Q32 9 30.6 15 Q29 21 26.4 26 Z" fill="var(--pl-rabbit-ear, #414d40)"/>
    <circle cx="9" cy="32" r="3.4" fill="var(--pl-rabbit-ear, #414d40)"/>
    <circle cx="28.6" cy="27.6" r="1.1" fill="var(--pl-prop-ink, #201509)"/>
  </svg>`;
}

/** A worm, in a 60x20 box. */
export function wormArt(): string {
  return `<svg viewBox="0 0 60 20" aria-hidden="true" focusable="false">
    <path d="M4 14 Q12 4 22 12 Q32 20 42 10 Q48 4 56 8" fill="none"
          stroke="var(--pl-worm, #c08a83)" stroke-width="4.4" stroke-linecap="round"/>
    <path d="M52 7.4 Q56 7 57.4 9.6" fill="none" stroke="var(--pl-worm-tip, #e2b3aa)" stroke-width="4.4" stroke-linecap="round"/>
  </svg>`;
}
