import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  GROWTH_POINTS,
  GROWTH_STAGES,
  GROWTH_TIERS,
  growthProfile,
  growthStageAlong,
  growthStageFromPoints,
  growthTierAt,
  growthTransitionMs,
  limbGrowAlong,
  resumeGrowth,
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
      assert.ok(next.leafReveal >= previous.leafReveal, `a leaf closed at ${stage}`);
      assert.ok(next.limbReveal >= previous.limbReveal, `a limb vanished at ${stage}`);
      assert.ok(next.limbLength >= previous.limbLength, `the crown shrank at ${stage}`);
      assert.ok(next.limbSpreadDeg >= previous.limbSpreadDeg, `an arm closed in at ${stage}`);
      assert.ok(next.crownDensity >= previous.crownDensity, `the crown thinned at ${stage}`);
      previous = next;
    }
  });

  it('spreads a growth run over time, longer for a bigger move', () => {
    assert.equal(growthTransitionMs(0), 0);
    assert.equal(growthTransitionMs(Number.NaN), 0);
    assert.ok(growthTransitionMs(1) >= 1200);
    assert.ok(growthTransitionMs(6) > growthTransitionMs(2));
    assert.ok(growthTransitionMs(100) <= 2800);
  });

  it('walks from the old stage to the new one without overshooting', () => {
    const from = 12;
    const to = 18;
    assert.equal(growthStageAlong(from, to, 0), from);
    assert.equal(growthStageAlong(from, to, 1), to);
    // The stage follows the stream, which climbs at a constant speed: half way
    // through the run is half the growth, not most of it.
    assert.equal(growthStageAlong(from, to, 0.25), 13.5);
    assert.equal(growthStageAlong(from, to, 0.5), 15);
    assert.equal(growthStageAlong(from, to, 0.75), 16.5);
    let previous = from;
    for (let step = 1; step <= 20; step += 1) {
      const stage = growthStageAlong(from, to, step / 20);
      assert.ok(stage >= previous, `the stage went backwards at step ${step}`);
      assert.ok(stage <= to, `the stage overshot at step ${step}`);
      previous = stage;
    }
    // A clock that arrives early, late or broken cannot move the plant outside
    // the run it belongs to.
    assert.equal(growthStageAlong(from, to, -1), from);
    assert.equal(growthStageAlong(from, to, 2), to);
    assert.equal(growthStageAlong(from, to, Number.NaN), from);
  });

  it('adds care without sending the light back to the root', () => {
    // A second care halfway up a run keeps the same light front. The resumed
    // timeline starts lower so the stage under that front is exactly what is
    // already drawn, not a jump forward or a reset to the base.
    const shown = 15;
    const target = 30;
    const progress = 0.5;
    const resumed = resumeGrowth(shown, target, progress);
    assert.equal(resumed.fromStage, 0);
    assert.equal(resumed.remainingShare, 0.5);
    assert.equal(growthStageAlong(resumed.fromStage, target, progress), shown);
    // The same holds at any point in the run, including a care that arrives late.
    for (const point of [0.05, 0.2, 0.4, 0.7, 0.95]) {
      const next = resumeGrowth(shown, target, point);
      assert.ok(
        Math.abs(growthStageAlong(next.fromStage, target, point) - shown) < 1e-9,
        `the drawing jumped at front ${point}`,
      );
      assert.ok(next.remainingShare > 0, 'no run left');
    }
    assert.equal(resumeGrowth(12, 30, 0).fromStage, 12);
    assert.equal(resumeGrowth(12, 30, 0).remainingShare, 1);
  });

  it('sends the light up the trunk and grows arms from the bottom up', () => {
    // The lower arm begins when the stream passes its socket, and is finished well
    // before the run ends; the top arm starts late and only just reaches its target
    // when the stream does.
    assert.equal(limbGrowAlong(0.42, 0, 1, 0), 0);
    assert.ok(limbGrowAlong(0.42, 0, 1, 0.41) > 0, 'the lower arm never started at its socket');
    assert.ok(limbGrowAlong(0.42, 0, 1, 0.5) > 0, 'the lower arm never started');
    assert.equal(limbGrowAlong(0.42, 0, 1, 0.65), 1);
    assert.equal(limbGrowAlong(0.93, 0, 1, 0.7), 0);
    assert.ok(limbGrowAlong(0.93, 0, 1, 0.95) > 0, 'the top arm never started');
    // Exact endpoints: care always leaves an arm on the stage's predetermined shape.
    assert.equal(limbGrowAlong(0.93, 0, 1, 1), 1);
    assert.equal(limbGrowAlong(0.42, 0.3, 0.8, 1), 0.8);
    // An arm the stage does not grow stays closed, and a growing arm never shrinks.
    assert.equal(limbGrowAlong(0.42, 0, 0, 0.8), 0);
    assert.equal(limbGrowAlong(0.42, 0.6, 0.2, 0.8), 0.6);
    let previous = 0;
    for (let step = 0; step <= 20; step += 1) {
      const grow = limbGrowAlong(0.42, 0, 1, step / 20);
      assert.ok(grow >= previous, `the arm shrank at step ${step}`);
      previous = grow;
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

  it('keeps a sapling green and hardens it into bark as it ages', () => {
    const sapling = growthProfile(12);
    const young = growthProfile(30);
    const adult = growthProfile(60);
    assert.ok(sapling.woodTone < 0.2, `a sapling was already ${sapling.woodTone} bark`);
    assert.ok(young.woodTone > sapling.woodTone, 'the young tree did not brown');
    assert.ok(adult.woodTone > 0.8, `an adult was only ${adult.woodTone} bark`);
    let previous = -1;
    for (let stage = 0; stage < GROWTH_STAGES; stage += 1) {
      const tone = growthProfile(stage).woodTone;
      assert.ok(tone >= previous, `the wood went backwards at ${stage}`);
      previous = tone;
    }
  });

  it('draws a seed first and a full tree last', () => {
    const seed = growthProfile(0);
    assert.equal(seed.tier.id, 'seed');
    assert.equal(seed.trunkOpacity, 0);
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
    // The last tiers keep climbing in size instead of flattening out: taller wood,
    // a wider reach, and smaller leaves against both. These floors are deliberately
    // near the current profile: an ancient tree is the thing the title is showing.
    assert.ok(ancient.scale > 2.2, `the ancient tree only reached ${ancient.scale}x`);
    assert.ok(ancient.limbLength > 1.5, `the ancient crown only reached ${ancient.limbLength}`);
    assert.ok(ancient.leafScale < 0.5, `the ancient leaves were still ${ancient.leafScale}`);
    assert.ok(ancient.budScale < 0.5, `the ancient tip bud was still ${ancient.budScale}`);
  });
});
