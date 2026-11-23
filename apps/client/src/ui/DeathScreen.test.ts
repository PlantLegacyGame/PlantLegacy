/**
 * The death card's numbers.
 *
 * The card used to reuse the live inspect panel's rows, so a dead plant was
 * reported with `Water 0 / 0`, `Health 0%` and a growth rate from its last
 * second of life. None of those are history; they are live vitals that stopped
 * meaning anything the moment the plant did. The old test asserting the card was
 * a copy of `plantStatRows` is now the opposite requirement, and is replaced
 * below by one that pins the divergence.
 */
import assert from 'node:assert/strict';
import { describe, it, test } from 'node:test';

import { deathStatRows } from './DeathScreen.ts';
import { type PlantStatsSummary, plantStatRows } from './plantStats.ts';

const stats: PlantStatsSummary = {
  healthFraction: 0,
  biomass: 12.5,
  biomassRatePerSecond: -0.4,
  peakBiomass: 30.25,
  energy: 0,
  storedWater: 0,
  waterCapacity: 40,
  storedMinerals: 0,
  mineralCapacity: 40,
  nodeCount: 14,
  peakNodeCount: 21,
  mutationCount: 0,
  mutationUpkeepPerSecond: 0,
  ageSeconds: 3_725,
  dayNumber: 4,
  clock: '23:48',
};

const byLabel = (rows: Array<[string, string]>, label: string) =>
  rows.find(([key]) => key === label)?.[1];

test('the death card leads with what killed the plant', () => {
  const rows = deathStatRows({ cause: 'dehydration', reason: 'The soil dried out.', stats });
  assert.equal(rows[0][0], 'Cause');
  assert.equal(rows[0][1], 'Dehydration');
});

describe('death card rows', () => {
  it('reports the death record, not the live vitals', () => {
    const rows = deathStatRows({
      cause: 'starvation',
      source: 'no_energy',
      stats,
      reason: 'It starved.',
    });
    const labels = rows.map(([label]) => label);
    assert.deepEqual(labels, [
      'Cause',
      'Killed by',
      'Age',
      'Died on',
      'Biomass',
      'Peak biomass',
      'Nodes',
      'Peak nodes',
    ]);
    assert.equal(byLabel(rows, 'Cause'), 'Starvation');
    assert.equal(byLabel(rows, 'Killed by'), 'No energy left');
    assert.equal(byLabel(rows, 'Age'), '1h 02m');
    assert.equal(byLabel(rows, 'Died on'), 'Day 4 · 23:48');
    assert.equal(byLabel(rows, 'Biomass'), '12.5');
    assert.equal(byLabel(rows, 'Peak biomass'), '30.3');
    assert.equal(byLabel(rows, 'Nodes'), '14');
    assert.equal(byLabel(rows, 'Peak nodes'), '21');
    for (const label of ['Water', 'Minerals', 'Energy', 'Health', 'Growth rate']) {
      assert.equal(byLabel(rows, label), undefined, `${label} is not history`);
    }
  });

  it('is deliberately not the live panel, whose rows describe a running plant', () => {
    const rows = deathStatRows({ cause: 'dehydration', reason: '', stats });
    const liveLabels = plantStatRows(stats).map(([label]) => label);
    assert.notEqual(rows.length, liveLabels.length + 1, 'the card is its own set now');
    for (const live of ['Water', 'Minerals', 'Energy', 'Health', 'Growth rate']) {
      assert.ok(liveLabels.includes(live), `${live} must still be a live-panel row`);
      assert.equal(byLabel(rows, live), undefined, `${live} must not be on the card`);
    }
  });

  it('keeps an unknown kill source readable instead of dropping it', () => {
    const rows = deathStatRows({ cause: 'damage', source: 'acid_spray', stats, reason: '' });
    assert.equal(byLabel(rows, 'Killed by'), 'Acid spray');
  });

  it('shows mutation upkeep only when there were mutations', () => {
    const none = deathStatRows({ cause: 'damage', stats, reason: '' });
    assert.equal(byLabel(none, 'Mutations'), undefined);
    assert.equal(byLabel(none, 'Killed by'), undefined);

    const mutated = deathStatRows({
      cause: 'mutation_upkeep',
      stats: {
        ...stats,
        mutationCount: 3,
        mutationEnergyUpkeepPerSecond: 0.04,
        mutationBiomassUpkeepPerSecond: 0.012,
      },
      reason: '',
    });
    assert.equal(byLabel(mutated, 'Mutations'), '3 · 0.040 E/s · 0.012 B/s');
  });
});
