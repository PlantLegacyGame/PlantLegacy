import { MESSAGE_TYPE } from '@plant-legacy/shared/protocol';
import { stepCadence } from '../ops/broadcastCadence.ts';

/** What one plant looks like on the wire for STATE / KEYFRAME. */
export interface PlantStateSnapshot {
  id: string;
  totalBiomass: number;
  totalEnergy: number;
  totalUpkeep: number;
  structure?: { damageHp: number; threshold: number };
}

export interface StateBroadcastPorts {
  /**
   * `messageType` is STATE or KEYFRAME, so the writer records the right one.
   * False when the socket refused it (closed, or over the backlog limit).
   */
  send(playerId: string, message: string, messageType: number): boolean;
}

export interface StateBroadcastPlayer {
  playerId: string;
  plantId: string | null;
  /** Precomputed interest cells from InterestManager, not a world position. */
  cells: ReadonlySet<string>;
}

export interface StateBroadcastInput {
  tick: number;
  dt: number;
  keyframeIntervalTicks: number;
  clientSendRateHz: number;
  worldBounds: unknown;
  tileSize: number;
  /** Carried accumulator from the previous tick (INV-TM-09). */
  accumulatorMs: number;
  players: StateBroadcastPlayer[];
  states: PlantStateSnapshot[];
  /** Crown position per plant, used to bucket each state into its cell. */
  positions: Map<string, { x: number; z: number }>;
  /** The same cell key function InterestManager used for the player cells. */
  cellKeyFor: (x: number, z: number) => string;
  /** Maximum plants per payload; the player's own plant is kept first. */
  entityCap?: number;
}

export interface StateBroadcastResult {
  nextAccumulatorMs: number;
  due: boolean;
  keyframe: boolean;
  /** Writes that landed; a refused socket is not counted as delivered. */
  sent: number;
  skipped: number;
}

/**
 * The STATE / KEYFRAME fanout, per player, by interest cell.
 *
 * The payload is small but it used to go to every connection 20 times a second,
 * including players whose cells contain none of these plants, so the filter and
 * the wire cadence are the two things that matter here. The owner's own plant is
 * always included so a client never loses sight of itself, and a keyframe always
 * sends on its own interval even when the state cadence is slower, so a late
 * joiner and a reconnecting client still get a full snapshot.
 *
 * The previous version did `states.find()` once per player and then scanned the
 * whole state list again for each player, which is O(players x plants) before
 * the cap can help. Here the states are bucketed once per broadcast and each
 * player reads only the cells already computed by InterestManager. The cost is
 * bounded by the visible plant-player pairs plus the per-broadcast bucketing.
 */
export function broadcastPlantStates(
  ports: StateBroadcastPorts,
  input: StateBroadcastInput,
): StateBroadcastResult {
  const keyframe = input.tick % input.keyframeIntervalTicks === 0;
  const stateType = keyframe ? MESSAGE_TYPE.KEYFRAME : MESSAGE_TYPE.STATE;
  const step = stepCadence(input.accumulatorMs, input.dt * 1000, input.clientSendRateHz);
  const due = keyframe || step.due;
  const result: StateBroadcastResult = {
    nextAccumulatorMs: step.nextAccumulatorMs,
    due,
    keyframe,
    sent: 0,
    skipped: 0,
  };
  if (!due) {
    result.skipped = input.players.length;
    return result;
  }

  const cap =
    input.entityCap === undefined || !Number.isFinite(input.entityCap)
      ? Number.POSITIVE_INFINITY
      : Math.max(0, Math.floor(input.entityCap));

  // One pass over the states builds both lookup structures. A state without a
  // crown position is not visible by range; the owner's own state still comes
  // from stateById, preserving the old "never lose sight of yourself" rule.
  const stateById = new Map<string, PlantStateSnapshot>();
  const statesByCell = new Map<string, PlantStateSnapshot[]>();
  for (const state of input.states) {
    if (!stateById.has(state.id)) stateById.set(state.id, state);
    const position = input.positions.get(state.id);
    if (!position) continue;
    const cellKey = input.cellKeyFor(position.x, position.z);
    let bucket = statesByCell.get(cellKey);
    if (!bucket) {
      bucket = [];
      statesByCell.set(cellKey, bucket);
    }
    bucket.push(state);
  }

  for (const player of input.players) {
    const own = player.plantId ? stateById.get(player.plantId) : undefined;
    const plants: PlantStateSnapshot[] = cap > 0 && own ? [own] : [];
    if (plants.length < cap) {
      for (const cellKey of player.cells) {
        const cellStates = statesByCell.get(cellKey);
        if (!cellStates) continue;
        for (const state of cellStates) {
          if (state.id === own?.id) continue;
          plants.push(state);
          if (plants.length >= cap) break;
        }
        if (plants.length >= cap) break;
      }
    }
    const wrote = ports.send(
      player.playerId,
      JSON.stringify({
        type: stateType,
        payload: {
          tick: input.tick,
          plants,
          worldBounds: input.worldBounds,
          tileSize: input.tileSize,
        },
      }),
      stateType,
    );
    // `dev_log_network` reports `sent`, so a backlogged socket that refused the
    // message must not appear there as a delivery.
    if (wrote) result.sent += 1;
  }
  return result;
}
