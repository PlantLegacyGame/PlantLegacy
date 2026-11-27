/**
 * The capacity a store's vitals row should be drawn against.
 *
 * The vitals are repainted by whoever has news, and the messages do not all
 * carry the same amount. A growth event knows how much water the plant holds
 * but not how much it can hold; a death tick knows neither. Painting a row
 * straight from one message therefore dropped the bar and the /limit whenever
 * that message was missing the capacity, which read as the water and mineral
 * bars "disappearing sometimes" and showing a single number instead of
 * amount/limit. A repaint only replaces what it actually knows.
 *
 * `undefined` means the caller has nothing to say about the capacity. A
 * non-positive or non-finite capacity is a real answer: there is no store to
 * draw a bar for.
 */
export function keepCapacity(
  previous: number | null,
  next: number | undefined | null,
): number | null {
  if (next === undefined || next === null) return previous;
  if (!Number.isFinite(next) || next <= 0) return null;
  return next;
}
