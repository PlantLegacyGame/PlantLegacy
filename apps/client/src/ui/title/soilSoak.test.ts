import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  addSoak,
  createSoakPatch,
  gatherSoak,
  SOAK,
  soakFertility,
  soakMoisture,
} from './soilSoak.ts';

describe('soil soak', () => {
  it('starts a water patch that darkens and descends from the soil line', () => {
    const patch = createSoakPatch(1, 200, 'water');
    assert.equal(patch.water, 1);
    assert.equal(patch.feed, 0);
    assert.ok(soakMoisture(patch) > 0);
    assert.ok(patch.waterDepth > SOAK.water.baseDepth);
    assert.ok(patch.width > SOAK.water.baseWidth);
    assert.equal(patch.feedDepth, SOAK.feed.baseDepth);
  });

  it('gathers a nearby landing into one patch instead of starting a second', () => {
    const patch = createSoakPatch(1, 200, 'water');
    const gathered = gatherSoak([patch], 200 + SOAK.gatherRadius - 4);
    assert.equal(gathered?.id, 1);
    const apart = gatherSoak([patch], 200 + SOAK.gatherRadius * 4);
    assert.equal(apart, undefined);
  });

  it('darker water stops at saturation; extra water spreads into the soil beside it', () => {
    let patch = createSoakPatch(1, 200, 'water');
    for (let i = 0; i < SOAK.water.capacity - 1; i += 1) {
      patch = addSoak(patch, 'water');
    }
    const atCap = patch;
    assert.equal(soakMoisture(atCap), 1);

    for (let i = 0; i < 12; i += 1) {
      patch = addSoak(patch, 'water');
    }
    assert.equal(soakMoisture(patch), 1, 'extra water cannot darken past saturated');
    assert.equal(
      patch.waterDepth,
      atCap.waterDepth,
      'extra water moves sideways instead of drilling deeper once saturated',
    );
    assert.ok(patch.width > atCap.width, 'extra water widens into the drier soil');
    assert.ok(patch.width <= SOAK.water.maxWidth);
    assert.ok(patch.waterDepth <= SOAK.water.maxDepth);
  });

  it('feed gathers and sinks, but is shallower and narrower than the same amount of water', () => {
    let feed = createSoakPatch(1, 200, 'feed');
    let water = createSoakPatch(2, 200, 'water');
    for (let i = 0; i < 6; i += 1) {
      feed = addSoak(feed, 'feed');
      water = addSoak(water, 'water');
    }
    assert.ok(soakFertility(feed) > 0);
    assert.equal(soakMoisture(feed), 0, 'feed is not a water puddle');
    assert.ok(feed.feedDepth > SOAK.feed.baseDepth);
    assert.ok(feed.feedDepth < water.waterDepth);
    assert.ok(feed.width < water.width);
  });

  it('can hold water and feed in one patch because they are the same soil', () => {
    const patch = addSoak(addSoak(createSoakPatch(1, 200, 'water'), 'feed'), 'water', 2);
    assert.equal(patch.water, 3);
    assert.equal(patch.feed, 1);
    assert.ok(patch.waterDepth > 0);
    assert.ok(patch.feedDepth > 0);
  });

  it('does not mutate the previous patch', () => {
    const before = createSoakPatch(1, 200, 'water');
    const after = addSoak(before, 'water', 2);
    assert.equal(before.water, 1);
    assert.equal(after.water, 3);
  });
});
