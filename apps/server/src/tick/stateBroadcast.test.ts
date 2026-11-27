import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MESSAGE_TYPE } from '@plant-legacy/shared/protocol';
import {
  broadcastPlantStates,
  type PlantStateSnapshot,
  type StateBroadcastInput,
} from './stateBroadcast.ts';

const CELL_SIZE = 10;
const cellKeyFor = (x: number, z: number): string =>
  `${Math.floor(x / CELL_SIZE)},${Math.floor(z / CELL_SIZE)}`;

function cellsAround(x: number, z: number, radius = 1): Set<string> {
  const centre = {
    x: Math.floor(x / CELL_SIZE),
    z: Math.floor(z / CELL_SIZE),
  };
  const cells = new Set<string>();
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dz = -radius; dz <= radius; dz += 1) {
      cells.add(`${centre.x + dx},${centre.z + dz}`);
    }
  }
  return cells;
}

const state = (id: string): PlantStateSnapshot => ({
  id,
  totalBiomass: 10,
  totalEnergy: 5,
  totalUpkeep: 1,
});

function input(overrides: Partial<StateBroadcastInput> = {}): StateBroadcastInput {
  return {
    tick: 21,
    dt: 1 / 20,
    keyframeIntervalTicks: 60,
    clientSendRateHz: 20,
    worldBounds: { minX: -64, maxX: 64 },
    tileSize: 2,
    accumulatorMs: 0,
    players: [{ playerId: 'p1', plantId: 'own', cells: cellsAround(0, 0) }],
    states: [state('own'), state('near'), state('far')],
    positions: new Map([
      ['own', { x: 0, z: 0 }],
      ['near', { x: 1, z: 1 }],
      ['far', { x: 40, z: 40 }],
    ]),
    cellKeyFor,
    ...overrides,
  };
}

function createPorts() {
  const sent: Array<{
    playerId: string;
    body: { type: number; payload: Record<string, unknown> };
  }> = [];
  return {
    sent,
    ports: {
      send: (playerId: string, message: string) => {
        sent.push({ playerId, body: JSON.parse(message) });
        return true;
      },
    },
  };
}

function sentIds(sent: ReturnType<typeof createPorts>['sent']): string[] {
  return (sent[0]?.body.payload.plants as PlantStateSnapshot[] | undefined)?.map((p) => p.id) ?? [];
}

describe('broadcastPlantStates', () => {
  it('sends the owner their own plant and the plants in subscribed cells, not the far ones', () => {
    const { ports, sent } = createPorts();
    const result = broadcastPlantStates(ports, input());
    assert.equal(result.sent, 1);
    assert.deepEqual(sentIds(sent), ['own', 'near']);
    assert.equal(sent[0]?.body.payload.tileSize, 2);
  });

  it('keeps the owner’s own plant when its cell is not subscribed', () => {
    const { ports, sent } = createPorts();
    broadcastPlantStates(
      ports,
      input({
        positions: new Map([
          ['own', { x: 100, z: 100 }],
          ['near', { x: 1, z: 1 }],
          ['far', { x: 40, z: 40 }],
        ]),
      }),
    );
    assert.deepEqual(sentIds(sent), ['own', 'near']);
  });

  it('keeps the own plant first and stops at the entity cap', () => {
    const { ports, sent } = createPorts();
    broadcastPlantStates(
      ports,
      input({
        players: [{ playerId: 'p1', plantId: 'own', cells: new Set(['0,0', '4,4']) }],
        entityCap: 2,
      }),
    );
    assert.deepEqual(sentIds(sent), ['own', 'near']);
  });

  it('sends no plant when the entity cap is zero', () => {
    const { ports, sent } = createPorts();
    broadcastPlantStates(ports, input({ entityCap: 0 }));
    assert.deepEqual(sentIds(sent), []);
  });

  it('marks a keyframe on its interval and sends it even when the cadence is not due', () => {
    const { ports, sent } = createPorts();
    const result = broadcastPlantStates(ports, input({ tick: 60, accumulatorMs: 0 }));
    assert.equal(result.keyframe, true);
    assert.equal(result.due, true);
    assert.equal(sent[0]?.body.type, MESSAGE_TYPE.KEYFRAME);
  });

  it('skips every player while the wire cadence has not elapsed', () => {
    const { ports, sent } = createPorts();
    // 10 ms into a 50 ms interval: nothing is due, and no payload is built.
    const result = broadcastPlantStates(ports, input({ dt: 0.01 }));
    assert.equal(result.due, false);
    assert.equal(result.sent, 0);
    assert.equal(result.skipped, 1);
    assert.deepEqual(sent, []);
    assert.equal(result.nextAccumulatorMs, 10);
  });

  it('does not count a refused write as sent', () => {
    const { ports } = createPorts();
    const result = broadcastPlantStates({ ...ports, send: () => false }, input());
    assert.equal(result.due, true);
    assert.equal(result.sent, 0);
  });

  it('banks the remainder so a faster tick still sends at the configured rate', () => {
    const { ports } = createPorts();
    let accumulator = 0;
    let sends = 0;
    for (let tick = 1; tick <= 30; tick += 1) {
      const result = broadcastPlantStates(
        ports,
        input({ tick, dt: 1 / 30, accumulatorMs: accumulator }),
      );
      accumulator = result.nextAccumulatorMs;
      sends += result.sent;
    }
    // 30 ticks at 30 Hz is 1 s of wire at 20 Hz: 20 sends, not 30 and not 15.
    assert.equal(sends, 20);
  });

  it('fans out to 10k players without a per-player scan of all states', () => {
    const players = Array.from({ length: 10_000 }, (_, index) => ({
      playerId: `p${index}`,
      plantId: `plant${index}`,
      cells: new Set<string>(['empty,cell']),
    }));
    const states = Array.from({ length: 10_000 }, (_, index) => state(`plant${index}`));
    const positions = new Map(
      states.map((entry, index) => [entry.id, { x: index * CELL_SIZE, z: 0 }]),
    );
    let bucketingCalls = 0;
    const countedCellKey = (x: number, z: number): string => {
      bucketingCalls += 1;
      return cellKeyFor(x, z);
    };
    const { ports } = createPorts();
    const result = broadcastPlantStates(ports, {
      ...input(),
      players,
      states,
      // Every player still gets their own state through stateById; the players
      // themselves subscribe to no cell, so only the one bucketing pass runs.
      positions,
      cellKeyFor: countedCellKey,
      entityCap: 1000,
    });
    assert.equal(result.sent, 10_000);
    assert.equal(bucketingCalls, 10_000, 'states are bucketed once, not once per player');
  });
});
