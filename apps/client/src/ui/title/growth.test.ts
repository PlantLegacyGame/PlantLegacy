import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  GROWTH_POINTS,
  GROWTH_STAGES,
  GROWTH_TIERS,
  growthProfile,
  growthStageFromPoints,
  growthTierAt,
} from './growth.ts';

const stageOf = (points: number): number => Math.round(growthStageFromPoints(points));

describe('title growth ladder', () => {
  it('keeps an existing save on the stage it looked like before', () => {
    // Pinned, not incidental: the ladder was lengthened from twenty waterings to
    // sixty, and the whole point of the curve is that a plant with the fifteen
    // points old saves carry is still the adult tree, stage 75 of 100.
    assert.equal(stageOf(15), 75);
    assert.equal(growthTierAt(75).id, 'adult');
  });

  it('starts at the seed and climbs with every care point', () => {
    assert.equal(stageOf(0), 0);
    let previous = -1;
    for (let points = 0; points <= GROWTH_POINTS; points += 1) {
      const stage = stageOf(points);
      assert.ok(stage >= previous, `stage went backwards at ${points} points`);
      previous = stage;
    }
    assert.equal(stageOf(GROWTH_POINTS), GROWTH_STAGES - 1);
    // Strictly bigger for as long as the ladder has room: the near-saturated top
    // can land two waterings on the same stage, and that is the only place it may.
    let strict = -1;
    for (let points = 0; points <= 24; points += 1) {
      const stage = stageOf(points);
      assert.ok(stage > strict, `no growth at ${points} points`);
      strict = stage;
    }
  });

  it('still gives the first waterings something to show', () => {
    // Early growth is fast on purpose: a plant that has been watered twice is a
    // visible change, not a rounding error.
    assert.ok(stageOf(1) >= 6, `one point only reached stage ${stageOf(1)}`);
    assert.ok(stageOf(3) >= 18, `three points only reached stage ${stageOf(3)}`);
    // ...and the last stretch is slow, so the top of the ladder is a long climb.
    assert.ok(stageOf(45) >= 98, `45 points only reached stage ${stageOf(45)}`);
  });

  it('clamps past the end of the ladder and ignores nonsense', () => {
    assert.equal(stageOf(400), GROWTH_STAGES - 1);
    assert.equal(stageOf(-5), 0);
    assert.equal(stageOf(Number.NaN), 0);
  });

  it('names every stage, with contiguous tiers covering the ladder', () => {
    assert.equal(GROWTH_TIERS[0].from, 0);
    assert.equal(GROWTH_TIERS[GROWTH_TIERS.length - 1].to, GROWTH_STAGES);
    for (let i = 1; i < GROWTH_TIERS.length; i += 1) {
      assert.equal(GROWTH_TIERS[i].from, GROWTH_TIERS[i - 1].to);
      assert.ok(GROWTH_TIERS[i].to > GROWTH_TIERS[i].from);
    }
    for (let stage = 0; stage < GROWTH_STAGES; stage += 1) {
      const tier = growthTierAt(stage);
      assert.ok(stage >= tier.from && stage < tier.to, `stage ${stage} fell outside its tier`);
    }
  });

  it('only ever grows: no stage undoes the one before it', () => {
    let previous = growthProfile(0);
    for (let stage = 1; stage < GROWTH_STAGES; stage += 1) {
      const next = growthProfile(stage);
      assert.ok(next.scale >= previous.scale, `scale dropped at ${stage}`);
      assert.ok(next.trunkWidth >= previous.trunkWidth, `trunk shrank at ${stage}`);
      assert.ok(next.trunkOpacity >= previous.trunkOpacity, `wood vanished at ${stage}`);
      assert.ok(next.treeOpacity >= previous.treeOpacity, `crown vanished at ${stage}`);
      assert.ok(next.leafReveal >= previous.leafReveal, `a leaf closed at ${stage}`);
      assert.ok(next.limbReveal >= previous.limbReveal, `a limb vanished at ${stage}`);
      assert.ok(next.limbLength >= previous.limbLength, `the crown shrank at ${stage}`);
      assert.ok(next.limbSpreadDeg >= previous.limbSpreadDeg, `an arm closed in at ${stage}`);
      assert.ok(next.crownDensity >= previous.crownDensity, `the crown thinned at ${stage}`);
      previous = next;
    }
  });

  it('changes the shape of the crown between tiers, not just a leaf nudge', () => {
    const young = growthProfile(30);
    const adult = growthProfile(75);
    const ancient = growthProfile(GROWTH_STAGES - 1);
    // Reach: the old tree's arms are half again as long as the young tree's.
    assert.ok(
      ancient.limbLength / young.limbLength >= 1.35,
      `reach only went ${young.limbLength} -> ${ancient.limbLength}`,
    );
    // Spread: it visibly opens out, which is what changes the silhouette.
    assert.ok(
      ancient.limbSpreadDeg - young.limbSpreadDeg >= 3,
      `spread only went ${young.limbSpreadDeg} -> ${ancient.limbSpreadDeg}`,
    );
    // Density: the old crown carries leaves the young one does not have at all.
    assert.ok(ancient.crownDensity > adult.crownDensity);
    assert.ok(adult.crownDensity > growthProfile(10).crownDensity);
  });

  it('draws a seed first and a full tree last', () => {
    const seed = growthProfile(0);
    assert.equal(seed.tier.id, 'seed');
    assert.equal(seed.trunkOpacity, 0);
    assert.equal(seed.treeOpacity, 0);
    // A seed is not a bare stick: the stem's six leaves open at (i + 1) / 6, so a
    // reveal under the first threshold (1/6) hid every one of them and the bottom
    // of the ladder was a green line. The pair has to be out at stage zero.
    assert.ok(seed.leafReveal >= 1 / 3, `a seed opened a share of ${seed.leafReveal}`);
    const ancient = growthProfile(GROWTH_STAGES - 1);
    assert.equal(ancient.tier.id, 'ancient');
    assert.equal(ancient.trunkWidth, 1);
    assert.equal(ancient.leafReveal, 1);
    assert.equal(ancient.limbReveal, 1);
    assert.ok(ancient.scale > growthProfile(75).scale);
  });
});
