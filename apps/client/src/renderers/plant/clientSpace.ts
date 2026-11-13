/**
 * Server geometry is surface-relative: a node's `y` is metres above the soil,
 * not metres above the planet's centre, and every node carries the point on its
 * parent where it attaches (`parentAttach*`) in the same frame.
 *
 * The client draws on the planet's displaced surface, so node positions are
 * mapped through `surfacePosition`. Attach points used to skip that mapping,
 * which put them metres away from their parent's drawn segment — the tube then
 * started in mid-air and the node looked detached from the plant. Both ends of
 * a segment have to go through the same mapping, which is what this does.
 */

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Map a server-side point into the client's drawn space.
 *
 * `surfaceY` takes (x, z, y) - horizontal position plus the height above the
 * surface - and returns the world height of the ground there. Passing a point
 * that is missing any component returns `undefined`, so callers can keep
 * "no attach point" out of the drawn node rather than inventing one at zero.
 */
export function toClientSpace(
  point: Partial<Point3> | undefined,
  surfaceY: (x: number, z: number, y: number) => number,
): Point3 | undefined {
  if (!point) return undefined;
  const { x, y, z } = point;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return undefined;
  return { x, y: surfaceY(x, z, y), z };
}
