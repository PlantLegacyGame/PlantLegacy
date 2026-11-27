/**
 * Flatten the client's plant mirrors into one renderer input array.
 *
 * `array.push(...map.values())` has two costs here: it allocates a temporary
 * array for every plant, and it passes one argument per node, so a single large
 * plant can exceed the engine's argument limit (`RangeError: Maximum call stack
 * size exceeded`). Collect with explicit loops instead. The target array is
 * reused on the hot path; renderers that defer work must copy it before
 * retaining it.
 */
export function collectPlantNodes<T>(
  own: ReadonlyMap<string, T>,
  otherPlants: Iterable<ReadonlyMap<string, T>>,
  target: T[] = [],
): T[] {
  target.length = 0;
  for (const node of own.values()) target.push(node);
  for (const nodes of otherPlants) {
    for (const node of nodes.values()) target.push(node);
  }
  return target;
}
