import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deathStatRows } from './DeathScreen.ts';
import { type PlantStatsSummary, plantStatRows } from './plantStats.ts';

const stats: PlantStatsSummary = {
  healthFraction: 0,
  biomass: 0,
  biomassRatePerSecond: -0.4,
  peakBiomass: 32,
  energy: 0,
  storedWater: 0,
  waterCapacity: 40,
  storedMinerals: 0,
  mineralCapacity: 40,
  nodeCount: 0,
  peakNodeCount: 14,
  mutationCount: 1,
  mutationUpkeepPerSecond: 0,
  mutationEnergyUpkeepPerSecond: 0,
  mutationBiomassUpkeepPerSecond: 0,
  ageSeconds: 3600,
  dayNumber: 3,
  clock: '14:20',
};

test('the death card leads with what killed the plant', () => {
  const rows = deathStatRows({ cause: 'dehydration', reason: 'The soil dried out.', stats });
  assert.equal(rows[0][0], 'Cause');
  assert.equal(rows[0][1], 'dehydration');
});

test('the rows come from the shared stat owner, not a second copy', () => {
  const rows = deathStatRows({ cause: 'cold', reason: 'Frost.', stats });
  // One row per shared row plus the cause: a card that invents its own numbers
  // drifts from the title card that reports the same death.
  assert.equal(rows.length, plantStatRows(stats).length + 1);
  const labels = rows.map(([label]) => label);
  assert.ok(labels.includes('Peak biomass') || labels.some((label) => /biomass/i.test(label)));
});
