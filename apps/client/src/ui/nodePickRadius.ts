/**
 * How big a click's pick sphere is for a node.
 *
 * The sphere follows the part, scaled up so the part is grabbable, and never
 * drops below a floor. The floors differ because a pick answers two different
 * questions:
 *
 * - Your own part is a *target for a decision*: the growth panel has to be about
 *   the part the player pressed, so its floor is small (0.1 m by default) and the
 *   sphere stays inside the part. A generous floor made a small child root
 *   unpickable, because its sphere swallowed its parent's and the ray hit
 *   whichever came first.
 * - Another player's part is *something to look at*: it is never grown, and their
 *   seedling is 3 cm across - about 13 px at 5.5 m - so it takes a reach instead
 *   (0.35 m by default), and a press plainly on the plant cannot fall through to
 *   the soil.
 *
 * Scale and both floors are config: `node_pick_radius_scale`,
 * `own_node_pick_radius`, `rival_node_pick_radius`.
 */

export interface PickRadii {
  /** Sphere size as a multiple of the part's own radius. */
  scale: number;
  /** Floor for your own parts, small enough to stay inside the part. */
  ownFloorM: number;
  /** Floor for another player's parts, far enough to reach at play distance. */
  rivalFloorM: number;
}

export function nodePickRadius(partRadiusM: number, isOwn: boolean, radii: PickRadii): number {
  const part = Number.isFinite(partRadiusM) ? Math.max(0, partRadiusM) : 0;
  return Math.max(part * radii.scale, isOwn ? radii.ownFloorM : radii.rivalFloorM);
}
