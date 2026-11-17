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
  /** `messageType` is STATE or KEYFRAME, so the writer records the right one. */
  send(playerId: string, message: string, messageType: number): void;
  isInRange(playerId: string, x: number, z: number): boolean;
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
  players: Array<{ playerId: string; plantId: string | null }>;
  states: PlantStateSnapshot[];
  /** Crown position per plant, used for the interest-cell test. */
  positions: Map<string, { x: number; z: number }>;
}

export interface StateBroadcastResult {
  nextAccumulatorMs: number;
  due: boolean;
  keyframe: boolean;
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

  for (const player of input.players) {
    const plants = input.states.filter((state) => {
      if (state.id === player.plantId) return true;
      const position = input.positions.get(state.id);
      return position ? ports.isInRange(player.playerId, position.x, position.z) : false;
    });
    ports.send(
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
    result.sent += 1;
  }
  return result;
}
