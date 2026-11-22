/** The tile grid a resource update describes. */
export interface ResourceGrid {
  width: number;
  height: number;
  tileSize: number;
}

export interface ResourceBroadcastPorts {
  dirtyTileCount(): number;
  dirtyTiles(): unknown[];
  grid(): ResourceGrid;
  /** Packs the whole grid for a full re-tint. */
  encodeWholeGrid(tiles: unknown[]): string;
  /** Sends RESOURCE_UPDATE with this payload. */
  broadcast(payload: Record<string, unknown>): void;
  now(): number;
}

export interface ResourceBroadcastState {
  /** When the last whole-grid update went out, on the same clock as `now`. */
  lastWholeGridAt: number;
}

export interface ResourceBroadcastInput {
  tick: number;
  /** A dirty count above this is a whole-grid re-tint rather than a delta. */
  wholeGridThreshold: number;
  /** Minimum gap between whole-grid updates. */
  minIntervalMs: number;
}

/**
 * Delta compression for the tile grid, and its throttle.
 *
 * Whole-grid updates (daylight / weather re-tinting every tile) are capped at one
 * per interval; skipping one is harmless because the next event dirties every tile
 * again. Small deltas are never delayed. Counting the dirty tiles first matters:
 * building the tile array for a whole-grid update allocates ~65k objects and
 * touches three maps, which at 20 Hz cost more than the broadcast itself.
 */
export function broadcastResourceDeltas(
  ports: ResourceBroadcastPorts,
  input: ResourceBroadcastInput,
  state: ResourceBroadcastState,
): ResourceBroadcastState {
  const dirtyCount = ports.dirtyTileCount();
  if (dirtyCount === 0) return state;

  const wholeGrid = dirtyCount > input.wholeGridThreshold;
  const now = ports.now();
  if (wholeGrid && now - state.lastWholeGridAt < input.minIntervalMs) return state;

  const tiles = ports.dirtyTiles();
  const grid = ports.grid();
  if (wholeGrid) {
    // No unchanged-bytes check: it was measured over 35 s at a 1 s cadence and 29 s
    // at 2.5 s, and the packed grid differed every single time - the field moves at
    // byte granularity - so it never suppressed a payload and only cost a compare.
    ports.broadcast({
      tick: input.tick,
      width: grid.width,
      height: grid.height,
      tileSize: grid.tileSize,
      delta: true,
      gridBase64: ports.encodeWholeGrid(tiles),
    });
    return { lastWholeGridAt: now };
  }
  ports.broadcast({
    tick: input.tick,
    tiles,
    width: grid.width,
    height: grid.height,
    tileSize: grid.tileSize,
    delta: true,
  });
  return state;
}
