import { MESSAGE_TYPE } from '@plant-legacy/shared/protocol';

/**
 * Everything the per-tick root-resource update tells a player.
 *
 * Constant size, however large the plant: the averages cover every tile any of
 * the plant's parts occupy, and one sample tile keeps the dev readout anchored
 * to a real tile.
 */
export interface RootResourceSnapshot {
  totalEnergy: number;
  totalBiomass: number;
  storedWater: number;
  storedMinerals: number;
  waterCapacity: number;
  mineralCapacity: number;
  coveredTileCount: number;
  tileAvgLight: number;
  tileAvgMoisture: number;
  tileAvgMinerals: number;
  /** Share of the local soil cavity filled with water, 0..1. */
  groundwaterFraction: number;
  coverageTileX: number;
  coverageTileZ: number;
  /** Slow-moving water-table field revision; the grid is resent when it changes. */
  waterTableRevision: number;
}

/** The tiles a plant overlaps, summarised. */
export interface RootCoverage {
  count: number;
  avgLight: number;
  avgMoisture: number;
  avgMinerals: number;
  avgGroundwater: number;
  sample: { tileX: number; tileZ: number } | null;
}

/** The plant stores the readout reports, plus where its crown sits. */
export interface ReadoutPlant {
  id: string;
  totalEnergy: number;
  totalBiomass: number;
  storedWater: number;
  storedMinerals: number;
  rootPosition: { x: number; z: number } | null;
}

export interface RootReadoutPorts {
  plant(playerId: string): ReadoutPlant | null;
  coverage(plantId: string): RootCoverage;
  capacity(plantId: string): { water: number; minerals: number };
  groundwaterCapacity(): number;
  /** Built only when the revision changes, so this is not on the hot path. */
  waterTable(x: number, z: number): unknown;
  waterTableRevisionSent(playerId: string): number | undefined;
  rememberWaterTableRevision(playerId: string, revision: number): void;
  unchanged(playerId: string, snapshot: RootResourceSnapshot): boolean;
  /** True when the message was written (not skipped by backpressure). */
  send(playerId: string, message: string): boolean;
  remember(playerId: string, snapshot: RootResourceSnapshot): void;
  grid(): { width: number; height: number; tileSize: number };
}

export interface RootReadoutInput {
  tick: number;
  /** The state cadence: the readout cannot be used faster than the state. */
  sendNow: boolean;
  players: Array<{ playerId: string; plantId: string | null }>;
}

export interface RootReadoutResult {
  /** Players skipped because the state cadence was not due. */
  skipped: number;
  /** Readouts written to a socket; a refused write is not counted as sent. */
  sent: number;
}

/**
 * The per-player root readout: stores, capacities and the tiles the plant sits on.
 *
 * Two rules live here. The water-table grid is rebuilt only when the slow-moving
 * revision changes, and a repeat payload is skipped only when every field is
 * bit-identical to what was last written — the cache is updated after a
 * successful write, so a backpressure skip is retried next tick instead of being
 * remembered as delivered.
 */
export function broadcastRootReadouts(
  ports: RootReadoutPorts,
  input: RootReadoutInput,
): RootReadoutResult {
  const result: RootReadoutResult = { skipped: 0, sent: 0 };
  for (const player of input.players) {
    if (!player.plantId) continue;
    if (!input.sendNow) {
      result.skipped += 1;
      continue;
    }
    const plant = ports.plant(player.playerId);
    if (!plant) continue;

    // Every tile any part of the plant overlaps, summarised. A node touching a
    // tile by even a sliver counts that tile in the average, whether it sits
    // below the soil or over it.
    const coverage = ports.coverage(plant.id);
    if (coverage.count === 0) continue;

    const capacity = ports.capacity(plant.id);
    const snapshot: RootResourceSnapshot = {
      totalEnergy: plant.totalEnergy,
      totalBiomass: plant.totalBiomass,
      storedWater: plant.storedWater,
      storedMinerals: plant.storedMinerals,
      waterCapacity: capacity.water,
      mineralCapacity: capacity.minerals,
      coveredTileCount: coverage.count,
      tileAvgLight: coverage.avgLight,
      tileAvgMoisture: coverage.avgMoisture,
      tileAvgMinerals: coverage.avgMinerals,
      groundwaterFraction: coverage.avgGroundwater / Math.max(1e-6, ports.groundwaterCapacity()),
      coverageTileX: coverage.sample?.tileX ?? 0,
      coverageTileZ: coverage.sample?.tileZ ?? 0,
      // The table moves on a slower clock than plant stores, so the grid is
      // rebuilt twice a second and the revision is what makes the snapshot
      // differ enough to be sent.
      waterTableRevision: Math.floor(input.tick / 10),
    };

    const root = plant.rootPosition;
    const waterTable =
      snapshot.waterTableRevision !== ports.waterTableRevisionSent(player.playerId) && root
        ? ports.waterTable(root.x, root.z)
        : undefined;
    if (waterTable) {
      ports.rememberWaterTableRevision(player.playerId, snapshot.waterTableRevision);
    }

    if (ports.unchanged(player.playerId, snapshot)) continue;
    const grid = ports.grid();
    const sent = ports.send(
      player.playerId,
      JSON.stringify({
        type: MESSAGE_TYPE.RESOURCE_UPDATE,
        payload: {
          tick: input.tick,
          ...snapshot,
          waterTable,
          width: grid.width,
          height: grid.height,
          tileSize: grid.tileSize,
        },
      }),
    );
    if (sent) {
      ports.remember(player.playerId, snapshot);
      result.sent += 1;
    }
  }
  return result;
}
