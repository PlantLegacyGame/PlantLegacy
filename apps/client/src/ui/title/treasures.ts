/**
 * What is buried under the title screen, and what the plant's care does to it.
 *
 * The soil cut under the mascot was a brown rectangle: a cross-section with roots
 * in it and nothing else, which reads as a wall rather than as ground. Real ground
 * has things in it. This module owns what is down there and the pure rules for the
 * plant's care: how far the plant has grown, and which find its roots have reached.
 *
 * Everything is data plus SVG strings, so the layout and the growth arithmetic can
 * be tested without a browser. The DOM side lives in MainMenu.
 *
 * Care is not rationed. The props used to be once a day, which turned the loop into
 * a chore with a timer and made a save depend on the calendar; now every watering
 * or feeding is a step, and the only limit is how much there is left to grow.
 */

export type TreasureKind =
  | 'worm'
  | 'chest'
  | 'gold_ore'
  | 'mushroom'
  | 'skeleton'
  | 'fossil'
  | 'bone'
  | 'crystal';

export type TreasureReaction = 'wiggle' | 'open' | 'sparkle';

export interface Treasure {
  id: string;
  kind: TreasureKind;
  /** Centre of the piece, as a percentage of the ground's width. */
  x: number;
  /** Top of the piece, as a percentage of the ground's height. */
  y: number;
  /** Degrees of tilt, so nothing sits on the grid. */
  tilt: number;
  /** Width as a share of the ground's width. */
  width: number;
  reaction: TreasureReaction;
  /** Shown when the plant's roots finally reach it. */
  find: string;
}

/**
 * The art's aspect: every piece is drawn in a 120×104 box.
 *
 * The layout needs it, because a piece's height on the stage is not its share of
 * the width - the ground is roughly twice as wide as it is tall, so a width of
 * 7.5% comes out about 22% of the height. Placing pieces by width alone is exactly
 * how two of them ended up on top of each other.
 */
export const TREASURE_ASPECT = 104 / 120;

/**
 * How tall a piece occupies the ground, in percent of its height, for a stage whose
 * width is `aspect` times its height. The title ground is close to 3.3:1 on a
 * desktop (a full-width band about 46% of the pane's height).
 */
export function treasureHeightPercent(width: number, stageAspect = 3.3): number {
  return width * TREASURE_ASPECT * stageAspect;
}

/**
 * Tallest a piece ever gets, as a share of the ground's height.
 *
 * The CSS caps a piece's width at 10.8vh for exactly this reason: on a very wide
 * pane the ground is short and wide, so a piece sized by width alone grows taller
 * than the row it sits in and lands on the next one. In ground terms 10.8vh is
 * 10.8 × 0.867 / 46 of the band, about 20%, on every pane.
 */
export const TREASURE_MAX_HEIGHT = 20.5;

/**
 * Placement, in two columns - organic finds down the left, mineral down the right -
 * with four rows each. The rows are spaced further apart than a piece is tall, so
 * nothing can land on anything else at any sane pane aspect; the middle third is
 * left clear for the title column.
 */
export const TREASURES: ReadonlyArray<Treasure> = [
  {
    id: 'worm',
    kind: 'worm',
    x: 8.5,
    y: 1,
    tilt: 8,
    width: 7.5,
    reaction: 'wiggle',
    find: 'A fat worm, very annoyed',
  },
  {
    id: 'chest',
    kind: 'chest',
    x: 8.5,
    y: 25,
    tilt: -5,
    // Wider than the other pieces: the chest is the one find with a container in
    // it, and at the shared width its riches had nowhere to sit.
    width: 9.2,
    reaction: 'open',
    find: 'A cedar chest, still full of treasure',
  },
  {
    id: 'mushroom',
    kind: 'mushroom',
    x: 8.5,
    y: 49,
    tilt: 4,
    width: 7.5,
    reaction: 'sparkle',
    find: 'A pale mushroom in the dark',
  },
  {
    id: 'ore',
    kind: 'gold_ore',
    x: 8.5,
    y: 73,
    tilt: -3,
    width: 7.5,
    reaction: 'sparkle',
    find: 'A seam of gold in the bedrock',
  },
  {
    id: 'skull',
    kind: 'skeleton',
    x: 92,
    y: 1,
    tilt: -10,
    width: 7.5,
    reaction: 'sparkle',
    find: 'Somebody from a very old season',
  },
  {
    id: 'fossil',
    kind: 'fossil',
    x: 92,
    y: 25,
    tilt: 6,
    width: 7.5,
    reaction: 'sparkle',
    find: 'A fern, printed in stone',
  },
  {
    id: 'bone',
    kind: 'bone',
    x: 92,
    y: 49,
    tilt: -12,
    width: 7.5,
    reaction: 'wiggle',
    find: 'A dinosaur’s leg bone',
  },
  {
    id: 'crystal',
    kind: 'crystal',
    x: 92,
    y: 73,
    tilt: 10,
    width: 7.5,
    reaction: 'sparkle',
    find: 'A clutch of amber crystals',
  },
];

/** One care action the player can take on the title screen. */
export type CareAction = 'water' | 'feed';

/**
 * How much care the plant has had.
 *
 * `points` counts the finished actions (water and feed both count one). There is no
 * "used today" flag: the props are not rationed, so a state is one number.
 */
export interface CareState {
  points: number;
}

/**
 * Stages: 0 is the seed in the soil, 1 is a sprout with two leaves, 2 is a young
 * plant, and every stage after that sends the roots to one more buried find.
 */
export const CARE_STAGES = TREASURES.length + 2;

/**
 * Care points one growth stage costs.
 *
 * A point per stage grew a full tree in nine waterings, which made the title's
 * whole progression a minute of clicking. Two points a stage keeps every stage
 * and every find where it was and doubles the tending a tree asks for.
 */
export const POINTS_PER_STAGE = 2;

export function emptyCare(): CareState {
  return { points: 0 };
}

/** The stage the plant has reached, 0..CARE_STAGES-1. */
export function careStage(points: number): number {
  if (!Number.isFinite(points) || points <= 0) return 0;
  return Math.max(0, Math.min(CARE_STAGES - 1, Math.floor(points / POINTS_PER_STAGE)));
}

/** A care action is always possible: the props are not rationed. */
export function applyCare(state: CareState, _action: CareAction): CareState {
  return { points: state.points + 1 };
}

/**
 * The treasures the roots have reached at a given stage.
 *
 * The seed and the sprout reach nothing: a sprout has not grown down yet. From the
 * young-plant stage on, each stage sends one more root out, in the order they are
 * buried down each column.
 */
export function reachedTreasures(points: number): Treasure[] {
  const reached = Math.max(0, careStage(points) - 1);
  return TREASURES.slice(0, Math.min(TREASURES.length, reached));
}

// ---------------------------------------------------------------------------
// Art
// ---------------------------------------------------------------------------

const INK = 'var(--pl-treasure-ink, #201509)';
const BONE = 'var(--pl-bone, #e7dcc4)';
const STONE = 'var(--pl-fossil-stone, #5f5442)';

/**
 * The pieces are 60-90 px on screen, so each one is five or six shapes: rock,
 * a body, the thing that names it. Earlier versions carried facets, cracks and
 * specular dots that merged into noise at this size.
 */

/**
 * A chest, shut.
 *
 * The lid is the whole rule of the drawing: it is a closed dome, so nothing of what
 * is inside is on screen until it lifts. The body is wide and low with iron bands
 * and a hasp because at 80 px a box with grain reads as a crate, and behind the
 * lid sits a heap that is deliberately more than gold - coins, three cut stones, a
 * pearl strand, a small crown and a ring - so opening it is worth doing twice.
 */
function chestArt(): string {
  return `
  <g class="pl-treasure__chest">
    <path d="M8 58 H112 V92 Q112 100 104 100 H16 Q8 100 8 92 Z" fill="#7b4a24" stroke="${INK}" stroke-opacity="0.35" stroke-width="2"/>
    <!-- Planks and their shadow lines: a box with no grain is a plastic box. -->
    <path d="M8 70 H112 M8 82 H112 M8 92 H112" stroke="#5d3317" stroke-width="1.6" opacity="0.5"/>
    <path d="M30 58 V100 M92 58 V100" stroke="#5d3317" stroke-width="1.4" opacity="0.38"/>
    <!-- Iron bands with rivets. -->
    <path d="M16 58 V100" stroke="#4a3c2a" stroke-width="6" opacity="0.9"/>
    <path d="M104 58 V100" stroke="#4a3c2a" stroke-width="6" opacity="0.9"/>
    <g fill="#c9b48a"><circle cx="16" cy="68" r="1.6"/><circle cx="16" cy="90" r="1.6"/><circle cx="104" cy="68" r="1.6"/><circle cx="104" cy="90" r="1.6"/></g>
    <!-- The mouth of the chest: a dark throat, so what is inside sits in something
         rather than floating on the planks. -->
    <path class="pl-treasure__throat" d="M10 58 H110 V66 Q60 74 10 66 Z" fill="#2c1a0c"/>
    <path d="M50 54 H70 V76 H50 Z" fill="#e8c069" stroke="${INK}" stroke-opacity="0.4" stroke-width="1.6"/>
    <path d="M57 62 h6 v4 a3 3 0 0 1 -6 0 z M60 60 v2" fill="none" stroke="#4a2c12" stroke-width="1.8" stroke-linecap="round"/>
    <!-- What is inside. Hidden until the lid lifts (see the riches rule in
         MainMenu): a chest that shows its gold through a shut lid is a picture of
         a chest, not a chest. -->
    <g class="pl-treasure__riches">
      <g class="pl-treasure__gold" fill="#f5cc5e" stroke="#b8852a" stroke-width="1.3">
        <circle cx="26" cy="58" r="8"/><circle cx="41" cy="53" r="9"/><circle cx="56" cy="58" r="8"/>
        <circle cx="72" cy="54" r="9"/><circle cx="87" cy="59" r="8"/><circle cx="100" cy="56" r="7"/>
        <circle cx="34" cy="47" r="7"/><circle cx="63" cy="46" r="8"/><circle cx="92" cy="48" r="6.5"/>
      </g>
      <g fill="#fff3c2" opacity="0.9">
        <circle cx="38" cy="50" r="2.2"/><circle cx="60" cy="43" r="2"/><circle cx="89" cy="45" r="1.8"/>
      </g>
      <!-- Cut stones: a chest of nothing but coins is a piggy bank. -->
      <g stroke="${INK}" stroke-opacity="0.28" stroke-width="1.2">
        <path d="M21 42 l6 -7 l7 7 l-6 7 z" fill="#7fd8c4"/>
        <path d="M74 40 l5 -6 l6 6 l-5 6 z" fill="#c98fe8"/>
        <path d="M46 38 l5 -6 l6 6 l-5 6 z" fill="#f2a1c4"/>
      </g>
      <!-- A pearl strand, draped over the rim. -->
      <g fill="#f6efff" stroke="#c7b9d8" stroke-width="0.8">
        <circle cx="13" cy="53" r="2.4"/><circle cx="110" cy="53" r="2.4"/>
        <circle cx="17" cy="48" r="2.1"/><circle cx="106" cy="48" r="2.1"/>
        <circle cx="22" cy="44" r="1.8"/><circle cx="101" cy="44" r="1.8"/>
      </g>
      <!-- A little crown, tipped, and a ring beside it. -->
      <path d="M52 38 l4 -9 l4 5 l4 -8 l4 8 l4 -5 l4 9 z" fill="#f0c860" stroke="${INK}" stroke-opacity="0.3" stroke-width="1.2"/>
      <circle cx="86" cy="43" r="5" fill="none" stroke="#f0c860" stroke-width="2.4"/>
      <circle cx="86" cy="38" r="1.6" fill="#9ce0ff"/>
    </g>
    <!-- The lid, hinged at its back edge, wide enough to cover the whole coffer. -->
    <g class="pl-treasure__lid">
      <path d="M6 58 Q60 16 114 58 L114 64 Q60 26 6 64 Z" fill="#9c6531" stroke="${INK}" stroke-opacity="0.32" stroke-width="2"/>
      <path d="M6 58 Q60 20 114 58" fill="none" stroke="#e0a95a" stroke-width="2" opacity="0.75"/>
      <path d="M20 52 Q60 20 100 52" fill="none" stroke="#7d4c22" stroke-width="2" opacity="0.4"/>
      <path d="M16 58 V63 M104 58 V63" stroke="#4a3c2a" stroke-width="5" opacity="0.85"/>
      <path d="M50 60 H70 V66 H50 Z" fill="#e8c069" stroke="${INK}" stroke-opacity="0.35" stroke-width="1.4"/>
    </g>
  </g>`;
}

/** A worm with a face, curled and slightly indignant. */
function wormArt(): string {
  const body = 'M10 66 C24 42 46 76 62 54 C74 38 90 52 100 42';
  // Segment shading, placed on the body's own path rather than on a straight line:
  // six soft dots read as rings without any tick sticking out of the worm.
  const segments = [
    [22, 58],
    [32, 62],
    [44, 66],
    [56, 60],
    [70, 52],
    [84, 46],
  ]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6"/>`)
    .join('');
  return `
  <g class="pl-treasure__worm">
    <path d="${body}" fill="none" stroke="#b96f6f" stroke-width="19" stroke-linecap="round" opacity="0.55"/>
    <path d="${body}" fill="none" stroke="#d98a8a" stroke-width="16" stroke-linecap="round"/>
    <path d="${body}" fill="none" stroke="#f0a8a8" stroke-width="5" stroke-linecap="round" opacity="0.45"/>
    <g fill="#a85f5f" opacity="0.45">${segments}</g>
    <circle cx="95" cy="40" r="2.4" fill="${INK}"/>
    <circle cx="102" cy="43" r="2.4" fill="${INK}"/>
    <path d="M95 47 q4 3 8 1" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linecap="round" opacity="0.7"/>
  </g>`;
}

/** A pale mushroom: cap with gills, stem, spots, and its own little shadows. */
function mushroomArt(): string {
  return `
  <g class="pl-treasure__mushroom">
    <ellipse cx="60" cy="97" rx="30" ry="5" fill="rgba(0, 0, 0, 0.22)"/>
    <path d="M52 58 H68 L73 90 Q73 97 66 97 H54 Q47 97 47 90 Z" fill="#e8dcc0" stroke="${INK}" stroke-opacity="0.3" stroke-width="2"/>
    <path d="M56 62 L57 90" stroke="#c9b894" stroke-width="2.4" opacity="0.7"/>
    <path d="M18 60 C18 34 40 18 60 18 C80 18 102 34 102 60 Z" fill="#c2704f" stroke="${INK}" stroke-opacity="0.35" stroke-width="2"/>
    <path d="M20 58 C30 44 44 34 60 32 C76 34 90 44 100 58 Z" fill="#d98a63" opacity="0.55"/>
    <path d="M20 60 H100" stroke="#8f4b32" stroke-width="3" opacity="0.55"/>
    <g stroke="#e8c39e" stroke-width="1.5" opacity="0.5">
      <path d="M30 60 V54 M38 60 V52 M46 60 V51 M54 60 V50 M62 60 V50 M70 60 V51 M78 60 V52 M86 60 V54"/>
    </g>
    <ellipse cx="45" cy="41" rx="8" ry="5.5" fill="#f6ead0" opacity="0.9" transform="rotate(-14 45 41)"/>
    <ellipse cx="73" cy="49" rx="6" ry="4" fill="#f6ead0" opacity="0.85"/>
    <circle cx="58" cy="30" r="3" fill="#f6ead0" opacity="0.7"/>
  </g>`;
}

/**
 * A fossil: a fern frond pressed into a broken slab.
 *
 * It used to be an ammonite coil, which is a fossil but not *this* find - the
 * piece is labelled "a fern, printed in stone", so it is a fern. Eight pairs of
 * tapered pinnae on a curving rachis, each lobe swept back toward the base: a row
 * of even blobs reads as a feather, and a fern's leaflets shrink as the frond
 * rises. The print is a dark impression under a pale leaf, which is what a fossil
 * in a cut slab actually looks like.
 */
function fossilArt(): string {
  const pairs = 8;
  const pinnae: string[] = [];
  for (let i = 0; i < pairs; i += 1) {
    const t = i / (pairs - 1);
    const y = 84 - t * 62;
    const len = 8 + 26 * Math.sin(Math.PI * (0.14 + t * 0.8));
    const ry = 2.2 + 5.2 * (1 - t) ** 0.7;
    for (const side of [-1, 1]) {
      const cx = 60 + side * len * 0.55;
      const cy = y - len * 0.12;
      pinnae.push(
        `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${(len * 0.52).toFixed(1)}" ` +
          `ry="${ry.toFixed(1)}" transform="rotate(${(side * -22).toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)})"/>`,
      );
    }
  }
  const frond = (colour: string, alpha: number): string =>
    `<g fill="${colour}" opacity="${alpha}">` +
    `<path d="M60 94 C56 74 57 46 61 18" fill="none" stroke="${colour}" stroke-width="3.4" stroke-linecap="round"/>` +
    `${pinnae.join('')}` +
    '</g>';
  return `
  <g class="pl-treasure__fossil">
    <path d="M14 44 L28 16 L72 8 L108 22 L114 58 L100 90 L58 100 L22 86 Z"
          fill="${STONE}" stroke="${INK}" stroke-opacity="0.45" stroke-width="2"/>
    <path d="M28 16 L72 8 L108 22 L84 36 L48 32 Z" fill="#8b7a5f" opacity="0.9"/>
    <path d="M48 32 L84 36 L100 90 L58 100 L22 86 L14 44 Z" fill="#3f3829" opacity="0.3"/>
    <path d="M48 32 L84 36" stroke="#a2937a" stroke-width="1.6" opacity="0.55"/>
    <g transform="translate(1.6 2.4)">${frond('#2b2419', 0.4)}</g>
    ${frond(BONE, 0.96)}
    <g fill="${INK}" opacity="0.3">
      <circle cx="26" cy="68" r="2.4"/><circle cx="98" cy="72" r="2"/>
    </g>
  </g>`;
}

/** A skull over two crossed bones. */
function skeletonArt(): string {
  return `
  <g class="pl-treasure__skeleton">
    <!-- Two bones crossed behind the skull. At 80 px a skull on its own reads as a
         pebble; the crossing is what makes the piece a find. -->
    <g stroke="${BONE}" stroke-width="9" stroke-linecap="round" fill="none">
      <path d="M14 80 L100 36"/>
      <path d="M20 36 L94 80"/>
    </g>
    <!-- Knuckles: two lobes at each end, so they are bones and not sticks. -->
    <g fill="${BONE}">
      <circle cx="13" cy="77" r="6"/><circle cx="18" cy="84" r="6"/>
      <circle cx="101" cy="33" r="6"/><circle cx="96" cy="40" r="6"/>
      <circle cx="19" cy="33" r="6"/><circle cx="24" cy="40" r="6"/>
      <circle cx="95" cy="77" r="6"/><circle cx="89" cy="84" r="6"/>
    </g>
    <g stroke="${INK}" stroke-opacity="0.22" stroke-width="1.6" fill="none">
      <path d="M17 78 L97 37"/><path d="M23 37 L92 78"/>
    </g>
    <!-- The skull: cranium, cheek, jaw and two yawning sockets. -->
    <path d="M60 16 C42 16 33 28 33 41 C33 50 36 56 42 61 L42 71 Q42 79 51 79 H69 Q78 79 78 71 L78 61 C84 56 87 50 87 41 C87 28 78 16 60 16 Z"
          fill="${BONE}" stroke="${INK}" stroke-opacity="0.42" stroke-width="2"/>
    <path d="M37 31 C46 21 74 21 83 31 C73 25 47 25 37 31 Z" fill="#fbf5e4" opacity="0.8"/>
    <ellipse cx="47" cy="42" rx="9.5" ry="10.5" fill="${INK}" opacity="0.86"/>
    <ellipse cx="73" cy="42" rx="9.5" ry="10.5" fill="${INK}" opacity="0.86"/>
    <ellipse cx="44.5" cy="39" rx="2.6" ry="2.2" fill="#fbf5e4" opacity="0.32"/>
    <ellipse cx="70.5" cy="39" rx="2.6" ry="2.2" fill="#fbf5e4" opacity="0.32"/>
    <path d="M60 52 L54 62 H66 Z" fill="${INK}" opacity="0.7"/>
    <path d="M44 69 H76" stroke="${INK}" stroke-opacity="0.34" stroke-width="1.8"/>
    <g stroke="${INK}" stroke-opacity="0.42" stroke-width="1.5">
      <path d="M50 69 V77 M56 69 V77 M62 69 V77 M68 69 V77"/>
    </g>
  </g>`;
}

/** A leg bone: a femur with a knuckle at each end. */
function boneArt(): string {
  // One silhouette, drawn flat and then tilted: two lobes per end, a shaft between
  // them and a lit top edge. The first version was a rounded bar with corners, and
  // read as a dumbbell.
  return `
  <g class="pl-treasure__bone" transform="rotate(-24 60 52)">
    <path d="M24 32 C13 32 6 41 6 52 C6 63 13 72 24 72 C31 72 36 68 38 63 L82 63 C84 68 89 72 96 72 C107 72 114 63 114 52 C114 41 107 32 96 32 C89 32 84 36 82 41 L38 41 C36 36 31 32 24 32 Z"
          fill="${BONE}" stroke="${INK}" stroke-opacity="0.45" stroke-width="2.2"/>
    <path d="M31 38 C22 38 14 44 13 52" fill="none" stroke="#fbf5e4" stroke-width="3.4" opacity="0.55" stroke-linecap="round"/>
    <path d="M90 44 C98 44 104 47 106 52" fill="none" stroke="#fbf5e4" stroke-width="3" opacity="0.4" stroke-linecap="round"/>
    <path d="M42 48 L78 48" stroke="${INK}" stroke-opacity="0.14" stroke-width="2"/>
    <path d="M42 57 L78 57" stroke="#fbf5e4" stroke-width="2.6" opacity="0.28"/>
    <path d="M56 38 L56 44" stroke="${INK}" stroke-opacity="0.12" stroke-width="2"/>
    <path d="M66 60 L66 66" stroke="${INK}" stroke-opacity="0.12" stroke-width="2"/>
  </g>`;
}

/** Ore in the rock: a broken chunk with a gold seam, or a crystal pocket. */
function oreArt(kind: 'gold_ore' | 'crystal'): string {
  if (kind === 'crystal') {
    return `
    <g class="pl-treasure__crystal">
      <path d="M14 76 L24 34 L62 20 L102 40 L108 78 L80 98 L34 96 Z"
            fill="${STONE}" stroke="${INK}" stroke-opacity="0.4" stroke-width="2"/>
      <path d="M24 34 L62 20 L102 40 L70 50 Z" fill="#6f6450" opacity="0.9"/>
      <path d="M24 34 L42 80 L34 96 L14 76 Z" fill="#4a4030" opacity="0.55"/>
      <path d="M40 94 L31 54 L47 28 L58 56 L54 94 Z" fill="#cf8f2c" stroke="${INK}" stroke-opacity="0.4" stroke-width="1.5"/>
      <path d="M31 54 L47 28 L49 58 Z" fill="#a76f1e" opacity="0.8"/>
      <path d="M58 94 L57 44 L75 22 L86 50 L80 94 Z" fill="#eeb75a" stroke="${INK}" stroke-opacity="0.4" stroke-width="1.5"/>
      <path d="M75 22 L86 50 L72 46 Z" fill="#ffe6a6" opacity="0.95"/>
      <path d="M63 92 L62 56 L70 40 L74 58 L72 92 Z" fill="#f8cf82" opacity="0.55"/>
      <g fill="#fff4cd" opacity="0.9">
        <circle cx="84" cy="66" r="2.2"/><circle cx="38" cy="78" r="1.8"/><circle cx="50" cy="38" r="1.6"/>
      </g>
      <path d="M20 88 l7 -4 M96 30 l6 4" stroke="#fff4cd" stroke-width="1.2" opacity="0.4"/>
    </g>`;
  }
  return `
  <g class="pl-treasure__ore">
    <path d="M12 56 L26 28 L64 16 L96 30 L110 62 L94 92 L48 100 L18 82 Z"
          fill="${STONE}" stroke="${INK}" stroke-opacity="0.4" stroke-width="2"/>
    <path d="M26 28 L64 16 L96 30 L72 44 L44 40 Z" fill="#847457" opacity="0.9"/>
    <path d="M72 44 L96 30 L110 62 L94 92 L78 84 Z" fill="#4b4335" opacity="0.55"/>
    <path d="M18 82 L48 100 L94 92 L78 84 L44 76 Z" fill="#3f382c" opacity="0.45"/>
    <path d="M44 76 L78 84" stroke="#a2937a" stroke-width="1.4" opacity="0.4"/>
    <g fill="#f5cc5e" stroke="#a8791e" stroke-width="1.4">
      <path d="M44 52 l10 -7 l9 8 l-6 10 l-11 -2 Z"/>
      <path d="M70 40 l8 -5 l7 7 l-5 8 l-8 -2 Z"/>
      <path d="M62 70 l9 -6 l8 7 l-5 9 l-10 -1 Z"/>
      <path d="M32 74 l7 -4 l6 6 l-4 6 l-7 -1 Z"/>
    </g>
    <g fill="#fff3c2" opacity="0.9">
      <circle cx="48" cy="49" r="2.2"/><circle cx="74" cy="39" r="1.8"/><circle cx="67" cy="69" r="2"/>
    </g>
  </g>`;
}

/** The SVG body for one buried thing, in a 120×104 viewBox. */
export function treasureArt(kind: TreasureKind): string {
  switch (kind) {
    case 'chest':
      return chestArt();
    case 'worm':
      return wormArt();
    case 'fossil':
      return fossilArt();
    case 'skeleton':
      return skeletonArt();
    case 'bone':
      return boneArt();
    case 'mushroom':
      return mushroomArt();
    case 'crystal':
      return oreArt('crystal');
    default:
      return oreArt('gold_ore');
  }
}
