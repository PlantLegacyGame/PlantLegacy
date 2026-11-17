import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  broadcastRootReadouts,
  type ReadoutPlant,
  type RootCoverage,
  type RootReadoutInput,
  type RootReadoutPorts,
  type RootResourceSnapshot,
} from './rootReadout.ts';

const plant: ReadoutPlant = {
  id: 'p1',
  totalEnergy: 12,
  totalBiomass: 40,
  storedWater: 3,
  storedMinerals: 2,
  rootPosition: { x: 5, z: -5 },
};

const coverage: RootCoverage = {
  count: 4,
  avgLight: 0.8,
  avgMoisture: 0.5,
  avgMinerals: 0.25,
  avgGroundwater: 5,
  sample: { tileX: 2, tileZ: 3 },
};

function createPorts(overrides: Partial<RootReadoutPorts> = {}) {
  const events: string[] = [];
  const sent: Array<{
    playerId: string;
    body: { type: number; payload: Record<string, unknown> };
  }> = [];
  const revisions = new Map<string, number>();
  const remembered = new Map<string, RootResourceSnapshot>();
  const ports: RootReadoutPorts = {
    plant: (playerId) => {
      events.push(`plant:${playerId}`);
      return plant;
    },
    coverage: () => coverage,
    capacity: () => ({ water: 40, minerals: 20 }),
    groundwaterCapacity: () => 10,
    waterTable: (x, z) => {
      events.push(`table:${x},${z}`);
      return { cells: 4 };
    },
    waterTableRevisionSent: (playerId) => revisions.get(playerId),
    rememberWaterTableRevision: (playerId, revision) => revisions.set(playerId, revision),
    unchanged: () => false,
    send: (playerId, message) => {
      sent.push({ playerId, body: JSON.parse(message) });
      return true;
    },
    remember: (playerId, snapshot) => remembered.set(playerId, snapshot),
    grid: () => ({ width: 9, height: 9, tileSize: 2 }),
    ...overrides,
  };
  return { ports, events, sent, revisions, remembered };
}

const input = (overrides: Partial<RootReadoutInput> = {}): RootReadoutInput => ({
  tick: 42,
  sendNow: true,
  players: [{ playerId: 'a', plantId: 'p1' }],
  ...overrides,
});

describe('broadcastRootReadouts', () => {
  it('sends the stores, the averages and the sample tile', () => {
    const { ports, sent, remembered } = createPorts();
    const result = broadcastRootReadouts(ports, input());
    const payload = sent[0]?.body.payload;
    assert.equal(result.skipped, 0);
    assert.equal(payload?.totalEnergy, 12);
    assert.equal(payload?.coveredTileCount, 4);
    assert.equal(payload?.coverageTileX, 2);
    assert.equal(payload?.groundwaterFraction, 0.5);
    assert.equal(payload?.waterCapacity, 40);
    assert.equal(payload?.width, 9);
    assert.equal(remembered.get('a')?.totalEnergy, 12);
  });

  it('counts a player skipped while the state cadence has not elapsed', () => {
    const { ports, sent, events } = createPorts();
    const result = broadcastRootReadouts(ports, input({ sendNow: false }));
    assert.equal(result.skipped, 1);
    assert.deepEqual(sent, []);
    assert.deepEqual(events, []);
  });

  it('says nothing for a plant with no covered tiles', () => {
    const { ports, sent } = createPorts({ coverage: () => ({ ...coverage, count: 0 }) });
    broadcastRootReadouts(ports, input());
    assert.deepEqual(sent, []);
  });

  it('says nothing when the player has no plant, and does not count it as skipped', () => {
    const { ports, sent } = createPorts();
    const result = broadcastRootReadouts(
      ports,
      input({ players: [{ playerId: 'a', plantId: null }] }),
    );
    assert.equal(result.skipped, 0);
    assert.deepEqual(sent, []);
  });

  it('builds the water table only when the slow revision changes', () => {
    const { ports, events, revisions } = createPorts();
    broadcastRootReadouts(ports, input({ tick: 40 }));
    assert.deepEqual(
      events.filter((e) => e.startsWith('table:')),
      ['table:5,-5'],
    );
    assert.equal(revisions.get('a'), 4);

    events.length = 0;
    broadcastRootReadouts(ports, input({ tick: 45 }));
    assert.deepEqual(
      events.filter((e) => e.startsWith('table:')),
      [],
    );
  });

  it('skips a bit-identical repeat', () => {
    const { ports, sent } = createPorts({ unchanged: () => true });
    broadcastRootReadouts(ports, input());
    assert.deepEqual(sent, []);
  });

  it('does not remember a payload the writer skipped', () => {
    let attempts = 0;
    const { ports, remembered } = createPorts({
      send: () => {
        attempts += 1;
        return false;
      },
    });
    broadcastRootReadouts(ports, input());
    assert.equal(attempts, 1);
    assert.equal(remembered.size, 0);
  });

  it('handles several players independently', () => {
    const { ports, sent } = createPorts();
    broadcastRootReadouts(
      ports,
      input({
        players: [
          { playerId: 'a', plantId: 'p1' },
          { playerId: 'b', plantId: null },
          { playerId: 'c', plantId: 'p2' },
        ],
      }),
    );
    assert.deepEqual(
      sent.map((s) => s.playerId),
      ['a', 'c'],
    );
  });
});
