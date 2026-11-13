/**
 * Where a child's drawn segment starts.
 *
 * The server places every new node from a point on its parent and sends that
 * point as `parentAttach*`; for a lateral bud it is part-way along the parent's
 * own segment, for a seed it is out on the coat. A renderer that starts the tube
 * somewhere else draws the child either pivoting from the parent's tip or
 * hanging away from the plant entirely, which is exactly what "the nodes do not
 * connect" looks like.
 *
 * One rule, shared by both mesh paths:
 *  - an attach point from the server wins;
 *  - a child of a seed leaves the coat (its top when growing up, the buried
 *    contact point when growing down);
 *  - everything else continues from the parent's drawn end.
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface SegmentStartInput {
  /** Server-authoritative attach point, already in draw space. */
  attach?: Vec3Like | undefined;
  /** The parent's drawn end. */
  parentPosition: Vec3Like;
  /** Height of the top of a seed's coat, when the parent is a seed. */
  seedCoatTopY?: number | undefined;
  /** True when the child grows away from the soil (upward). */
  growsUp: boolean;
}

export function segmentStartFor(input: SegmentStartInput): Vec3Like {
  const { attach, parentPosition, seedCoatTopY, growsUp } = input;
  if (attach) return { x: attach.x, y: attach.y, z: attach.z };
  if (seedCoatTopY !== undefined) {
    return growsUp
      ? { x: parentPosition.x, y: seedCoatTopY, z: parentPosition.z }
      : { x: parentPosition.x, y: parentPosition.y, z: parentPosition.z };
  }
  return { x: parentPosition.x, y: parentPosition.y, z: parentPosition.z };
}
