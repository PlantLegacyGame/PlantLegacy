import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeItemUse,
  formatAge,
  type PlantStatsSummary,
  plantStatRows,
  prettyItemId,
} from './plantStats.ts';

const stats: PlantStatsSummary = {
  healthFraction: 0.82,
  biomass: 42.25,
  biomassRatePerSecond: 1.5,
  peakBiomass: 50,
  energy: 12.5,
  storedWater: 30,
  waterCapacity: 60,
  storedMinerals: 4,
  mineralCapacity: 20,
  nodeCount: 7,
  peakNodeCount: 9,
  mutationCount: 2,
  mutationUpkeepPerSecond: 0.4,
  ageSeconds: 3661,
  dayNumber: 3,
  clock: '18:40',
};

function row(statsToRead: PlantStatsSummary, label: string): string {
  const found = plantStatRows(statsToRead).find(([name]) => name === label);
  assert.ok(found, `missing row ${label}`);
  return found[1];
}

test('health and growth rate are written as signed, readable values', () => {
  assert.equal(row(stats, 'Health'), '82%');
  assert.equal(row(stats, 'Growth rate'), '+1.5/s');
  assert.equal(
    row({ ...stats, healthFraction: 0.12, biomassRatePerSecond: -0.25 }, 'Health'),
    '12%',
  );
  assert.equal(row({ ...stats, biomassRatePerSecond: -0.25 }, 'Growth rate'), '-0.3/s');
});

test('unknown health and rate say so instead of inventing a number', () => {
  const unknown = { ...stats, healthFraction: null, biomassRatePerSecond: null };
  assert.equal(row(unknown, 'Health'), 'Unknown');
  assert.equal(row(unknown, 'Growth rate'), 'Unknown');
});

test('every row has a label and a non-empty value', () => {
  for (const [label, value] of plantStatRows(stats)) {
    assert.ok(label.length > 0);
    assert.ok(value.length > 0, `${label} had an empty value`);
  }
});

test('age, day and clock share one formatting rule', () => {
  assert.equal(formatAge(0), '0s');
  assert.equal(formatAge(61), '1m 01s');
  assert.equal(formatAge(3661), '1h 01m');
  assert.equal(row(stats, 'Game day'), '3 · 18:40');
});

test('item ids are prettified without changing the underlying id', () => {
  assert.equal(prettyItemId('starter_dung'), 'Starter Dung');
  assert.equal(prettyItemId('heirloom-seed'), 'Heirloom Seed');
  assert.equal(prettyItemId(''), 'Empty');
});

test('an item use line states the exact numbers the server will apply', () => {
  assert.equal(
    describeItemUse({ kind: 'resources', water: 30, minerals: 20, energy: 0 }),
    'Use: +30 water, +20 minerals',
  );
  assert.equal(
    describeItemUse({ kind: 'resources', water: 0, minerals: 50, energy: 0 }),
    'Use: +50 minerals',
  );
  assert.equal(
    describeItemUse({ kind: 'resources', water: 0, minerals: 0, energy: 500 }),
    'Use: +500 energy',
  );
});

test('an unusable item says why instead of offering an effect', () => {
  assert.equal(
    describeItemUse({ kind: 'unavailable', reason: 'Planting is not implemented yet' }),
    'Cannot be used: Planting is not implemented yet',
  );
  assert.equal(describeItemUse({ kind: 'unavailable' }), 'Cannot be used yet');
  assert.equal(describeItemUse(undefined), 'Use: waiting for the server');
});
