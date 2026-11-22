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
  /**
   * The packed whole grid that was actually sent, so an identical re-tint is not
   * sent again.
   *
   * The grid is quantised to three bytes a tile, so a re-tint that changes nothing
   * a player can see encodes to the same buffer. It used to be resent anyway: one
   * 192 KB base64 payload a second, which the client decodes, parses and uploads as
   * a texture - a dropped frame every second on the receiving side. Comparing the
   * packed bytes is the whole test; a tint that really changed still goes out.
   */
  lastWholeGridBase64: string | null;
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
    const packed = ports.encodeWholeGrid(tiles);
    // Same bytes as last time: nothing on screen changed, so nothing is sent. The
    // clock still moves on, which keeps the encode on the throttle instead of
    // running it on every tick.
    if (packed === state.lastWholeGridBase64) {
      return { lastWholeGridAt: now, lastWholeGridBase64: state.lastWholeGridBase64 };
    }
    ports.broadcast({
      tick: input.tick,
      width: grid.width,
      height: grid.height,
      tileSize: grid.tileSize,
      delta: true,
      gridBase64: packed,
    });
    return { lastWholeGridAt: now, lastWholeGridBase64: packed };
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
