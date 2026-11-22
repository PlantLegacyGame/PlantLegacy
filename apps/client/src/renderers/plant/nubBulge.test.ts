import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NUB_MAX_SWELL,
  NUB_MIN_SWELL,
  NUB_PRIMED_SHARE,
  nubPriming,
  nubSwell,
} from './nubBulge.ts';

const node = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  nodeType: 'stem',
  biomass: 1,
  health: 1,
  ...overrides,
});

test('a nub is a small swell, never a second shape', () => {
  const ids = Array.from({ length: 400 }, (_, i) => `n${i}`);
  const swells = ids.map((id) => nubSwell(node(id)));
  const primed = swells.filter((s) => s > 1);
  assert.ok(primed.length > 0, 'some nodes are primed');
  assert.ok(
    primed.every((s) => s >= 1 + NUB_MIN_SWELL - 1e-9 && s <= 1 + NUB_MAX_SWELL + 1e-9),
    `every swell stays between ${NUB_MIN_SWELL} and ${NUB_MAX_SWELL} of the radius`,
  );
  // Roughly the primed share, not "most nodes": the site is recommended, not
  // guaranteed, and a stem covered in bumps reads as diseased.
  const share = primed.length / ids.length;
  assert.ok(Math.abs(share - NUB_PRIMED_SHARE) < 0.1, `primed share ${share.toFixed(2)}`);
});

test('the same node keeps its nub, and only woody organs can carry one', () => {
  const id = 'node-42';
  assert.equal(nubSwell(node(id)), nubSwell(node(id)));
  assert.equal(nubSwell(node(id, { nodeType: 'leaf' })), 1);
  assert.equal(nubSwell(node(id, { nodeType: 'flower' })), 1);
  assert.equal(nubPriming(node(id, { nodeType: 'leaf' })), 0);
});

test('condition decides how much of the recommendation is taken', () => {
  const starved = Array.from({ length: 200 }, (_, i) =>
    nubPriming(node(`p${i}`, { health: 0.05, biomass: 0.05 })),
  ).reduce((a, b) => a + b, 0);
  const thriving = Array.from({ length: 200 }, (_, i) =>
    nubPriming(node(`p${i}`, { health: 1, biomass: 2 })),
  ).reduce((a, b) => a + b, 0);
  assert.ok(
    thriving > starved * 2,
    `thriving ${thriving.toFixed(1)} vs starved ${starved.toFixed(1)}`,
  );
});
