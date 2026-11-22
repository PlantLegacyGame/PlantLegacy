/**
 * The cavity's size, decided by the roots that dug it.
 *
 * Root Sight used to open a hole sized from the configured cutaway radius alone,
 * so a seedling's first two roots and a metre-wide taproot system got the same
 * mouth, and the pit's depth was a fixed multiple of it. This module answers the
 * other question: what did *this* plant actually dig?
 *
 * The answer is deliberately conservative in one direction - the hole never
 * shrinks below what the config would have opened. The plant pass uses the same
 * radius to decide which roots are exposed (`INV-RS-14`), and a mouth narrower
 * than that cylinder would show roots hanging outside the hole.
 *
 * Pure: no THREE, no uniforms. `cavity/shape.test.ts` exercises it with numbers.
 */

/** A root bubble as the cavity field produces it: centre and drawn radius. */
export interface RootCavityBubble {
  x: number;
  y: number;
  z: number;
  radius: number;
}

export interface RootCavityShape {
  /** Furthest point any root bubble reaches from the crown, metres. */
  rootsRadiusM: number;
  /** Deepest root bubble bottom below the surface, metres. */
  rootsDepthM: number;
  /** Radius of the hole the cavity opens, metres. */
  apertureM: number;
  /**
   * `flat` when the ground under the mouth barely moves, `slope` when the rim
   * has to follow a hillside. Reported rather than branched on in the shader:
   * the rim conform handles both, this is what the player is told.
   */
  rimMode: 'flat' | 'slope';
}

/**
 * Extra hole past the outermost root, as a fraction of the root spread.
 *
 * Scales with the plant on purpose: a 20 cm root system gets ~4 cm of dirt around
 * it and a 3 m one gets ~50 cm, so the hole always reads as "the roots plus the
 * soil they broke" instead of as a fixed collar.
 */
export const ROOT_CAVITY_MARGIN_RATIO = 0.18;

/** Ground movement under the mouth below which the rim is called flat, as a ratio. */
export const ROOT_CAVITY_FLAT_RATIO = 0.08;

/**
 * Whether the ground under a mouth has to be followed as a hillside.
 *
 * Exported because the caller can sample the ground at one radius and then find
 * the mouth is wider than the ring it sampled: the answer has to be re-derivable
 * for a new ring without rebuilding the whole shape (the size does not depend on
 * the ground, only this label does).
 */
export function rimModeFor(groundHeights: readonly number[], apertureM: number): 'flat' | 'slope' {
  if (groundHeights.length < 2) return 'flat';
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  for (const height of groundHeights) {
    if (height < lowest) lowest = height;
    if (height > highest) highest = height;
  }
  const drop = highest - lowest;
  return drop > Math.max(0.1, apertureM * ROOT_CAVITY_FLAT_RATIO) ? 'slope' : 'flat';
}

/**
 * How much wider than the seed coat the mouth must be, as a ratio.
 *
 * A seedling's roots are thinner than its own seed, so an aperture sized from
 * the roots alone is entirely covered by the coat: Root Sight opened nothing the
 * player could see, and R looked like it did nothing. The mouth is floored at the
 * drawn seed radius times this factor, which leaves a visible ring of pit around
 * the seed at every stage of growth.
 */
export const ROOT_CAVITY_CROWN_CLEARANCE = 1.6;

/**
 * Mouth radius of the pit a plant with no roots may open, in seed radii.
 *
 * A seed still sits in soil, so Root Sight has to have something to open or the
 * toggle does nothing at all. Three radii is a seed in the middle with a seed's
 * width of wall on each side: wide enough to see the coat, narrow enough that it
 * cannot be mistaken for a dug cavity.
 */
export const ROOT_CAVITY_SEED_PIT_RADII = 3;

/**
 * Smallest orbit radius the camera may keep while Root Sight is open, as a
 * multiple of the mouth radius.
 *
 * The orbit could come closer than the opening and the eye then sat *inside* the
 * pit, so its far wall filled the frame and the seed was a speck on the rim. One
 * mouth of clearance keeps the camera above and outside the rim, looking down
 * into the hole it is meant to show.
 */
export const ROOT_SIGHT_APERTURE_EYE_CLEARANCE = 1.25;

/**
 * Mouth radius that can hold the bubbles the cavity will cut.
 *
 * The mouth is sized from the unmerged roots, but the cavity field pads every
 * bubble (`bubble_padding_m`, plus a floor of its own). For a thin root the
 * padding is a larger fraction than the 18% margin, so its bubble reached past
 * the mouth; the envelope loop then rejected it for standing outside the hole,
 * the cavity counted zero bubbles, and the soil shut while the root was growing
 * and opened again a rebuild later. The mouth is widened to the padded bubbles
 * here, so a bubble that is part of the plant can never be the one left outside.
 */
export function mouthRadiusFor(
  configuredApertureM: number,
  ownBubbles: readonly RootCavityBubble[],
  crownX: number,
  crownZ: number,
  paddingM: number,
): number {
  let reach = 0;
  for (const bubble of ownBubbles) {
    reach = Math.max(
      reach,
      Math.hypot(bubble.x - crownX, bubble.z - crownZ) + Math.max(0, bubble.radius),
    );
  }
  const padding = Number.isFinite(paddingM) ? Math.max(0, paddingM) : 0;
  return Math.max(Math.max(0, configuredApertureM), reach > 0 ? reach + padding : 0);
}

export interface RootCavityShapeInput {
  /** The plant's own underground bubbles, crown-relative or world - any frame. */
  bubbles: readonly RootCavityBubble[];
  /** World centre of the crown: the point the hole is cut around. */
  crownX: number;
  crownZ: number;
  /** World Y of the ground at the crown. */
  surfaceY: number;
  /** What `config/root_sight.json` would open with no roots at all. */
  configuredApertureM: number;
  apertureMinM: number;
  /** Drawn radius of the seed/crown the mouth is cut around, metres. */
  crownRadiusM?: number;
  /** Ground heights sampled around the mouth; used for the rim mode only. */
  groundHeights?: readonly number[];
}

export function rootCavityShape(input: RootCavityShapeInput): RootCavityShape {
  let rootsRadiusM = 0;
  let rootsDepthM = 0;
  for (const bubble of input.bubbles) {
    const reach =
      Math.hypot(bubble.x - input.crownX, bubble.z - input.crownZ) + Math.max(0, bubble.radius);
    if (reach > rootsRadiusM) rootsRadiusM = reach;
    const bottom = input.surfaceY - (bubble.y - Math.max(0, bubble.radius));
    if (bottom > rootsDepthM) rootsDepthM = bottom;
  }

  const apertureM = Math.max(
    Math.max(0, input.apertureMinM),
    Math.max(0, input.configuredApertureM),
    rootsRadiusM * (1 + ROOT_CAVITY_MARGIN_RATIO),
    Math.max(0, input.crownRadiusM ?? 0) * ROOT_CAVITY_CROWN_CLEARANCE,
  );

  const rimMode = rimModeFor(input.groundHeights ?? [], apertureM);

  return { rootsRadiusM, rootsDepthM, apertureM, rimMode };
}
