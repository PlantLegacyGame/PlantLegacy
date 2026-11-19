import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BEND_LOWER_SHARE,
  BEND_TIP_SHARE,
  bendDegrees,
  GUST_DURATION_MS,
  GUST_MAX_MS,
  GUST_MIN_MS,
  GUST_PEAK_DEG,
  gustAngle,
  leafSwingSign,
  leanTowardPointer,
  MAX_BEND_DEG,
  MAX_LEAN_DEG,
  nextGustAt,
  partFromDataset,
  releaseAngle,
  swingAngle,
  tapResponse,
} from './plantReaction.ts';

describe('title plant reactions', () => {
  it('answers for the part that was touched', () => {
    // A leaf shivers faster and further than the stem, which moves the whole
    // canopy; the bud nods; a root barely moves.
    const leaf = tapResponse('leaf');
    const stem = tapResponse('stem');
    const bud = tapResponse('bud');
    const root = tapResponse('root');
    assert.ok(leaf.swingDeg > stem.swingDeg);
    assert.ok(leaf.periodMs < stem.periodMs, 'a leaf is lighter than a stem');
    assert.ok(bud.durationMs < stem.durationMs);
    assert.ok(root.swingDeg < bud.swingDeg);
    // An unknown part is not a crash: it answers as the plant itself.
    assert.equal(tapResponse('nonsense' as never).part, 'stem');
  });

  it('starts at rest, swings, and is exactly still when it is over', () => {
    const response = tapResponse('leaf');
    assert.equal(swingAngle(0, response), 0);
    assert.equal(swingAngle(-5, response), 0);
    assert.equal(swingAngle(response.durationMs, response), 0);
    assert.equal(swingAngle(response.durationMs + 500, response), 0);
    // It really does swing: both directions, and the first peak is the biggest.
    const samples: number[] = [];
    for (let t = 0; t < response.durationMs; t += 10) samples.push(swingAngle(t, response));
    assert.ok(
      samples.some((v) => v > 1),
      'should swing one way',
    );
    assert.ok(
      samples.some((v) => v < -1),
      'and back the other way',
    );
    const peak = Math.max(...samples.map(Math.abs));
    assert.ok(peak <= response.swingDeg + 1e-9);
  });

  it('alternates which way neighbouring leaves flick', () => {
    assert.equal(leafSwingSign(0), -1);
    assert.equal(leafSwingSign(1), 1);
    assert.equal(leafSwingSign(2), -1);
  });

  it('bends with the drag, and stops at the limit', () => {
    assert.equal(bendDegrees(0, 60), 0);
    assert.equal(bendDegrees(30, 60), MAX_BEND_DEG / 2);
    assert.equal(bendDegrees(60, 60), MAX_BEND_DEG);
    assert.equal(bendDegrees(1000, 60), MAX_BEND_DEG);
    assert.equal(bendDegrees(-1000, 60), -MAX_BEND_DEG);
    // A zero-width span is a divide-by-zero, not an infinite bend.
    assert.equal(bendDegrees(30, 0), MAX_BEND_DEG);
    assert.equal(bendDegrees(Number.NaN, 60), 0);
    assert.ok(BEND_LOWER_SHARE > 0 && BEND_LOWER_SHARE < BEND_TIP_SHARE);
  });

  it('springs back past straight, then settles', () => {
    const from = 12;
    assert.equal(releaseAngle(0, from), from);
    // It crosses zero on the way through, so the plant passes straight and
    // overshoots the other way before it rests.
    const samples: number[] = [];
    for (let t = 0; t < 1600; t += 16) samples.push(releaseAngle(t, from));
    const firstSign = Math.sign(samples[0]);
    assert.ok(
      samples.some((v) => Math.sign(v) === -firstSign && Math.abs(v) > 0.5),
      'must overshoot to the other side',
    );
    assert.ok(Math.abs(samples[samples.length - 1]) < 0.2, 'and come back to nearly straight');
    assert.equal(releaseAngle(1600, from), 0);
    assert.equal(releaseAngle(5000, from), 0);
    // Letting go when already straight does nothing.
    assert.equal(releaseAngle(100, 0), 0);
    assert.equal(releaseAngle(100, Number.NaN), 0);
  });

  it('reads the part from the drawing rather than guessing', () => {
    assert.deepEqual(partFromDataset({ part: 'leaf', leaf: '3' }), { part: 'leaf', index: 3 });
    assert.deepEqual(partFromDataset({ part: 'bud' }), { part: 'bud', index: 0 });
    assert.deepEqual(partFromDataset({ part: 'ROOT' }), { part: 'root', index: 0 });
    // A tap on the plant that misses the annotations is still a tap on the plant.
    assert.deepEqual(partFromDataset({}), { part: 'stem', index: 0 });
    assert.deepEqual(partFromDataset({ part: 'leaf', leaf: 'x' }), { part: 'leaf', index: 0 });
  });
});

describe('a plant that notices', () => {
  it('leans toward a pointer that is over it, never further than it can', () => {
    assert.equal(leanTowardPointer(100, 100, 50), 0, 'straight above is no lean');
    assert.ok(leanTowardPointer(150, 100, 50) > 0, 'to the right leans right');
    assert.ok(leanTowardPointer(50, 100, 50) < 0, 'to the left leans left');
    // Past the edge of the drawing the lean is capped rather than extrapolated.
    assert.equal(leanTowardPointer(900, 100, 50), MAX_LEAN_DEG);
    assert.equal(leanTowardPointer(-900, 100, 50), -MAX_LEAN_DEG);
    // A pointer we do not know about, or a box we cannot measure, is no lean at
    // all: a NaN would be written into the transform and freeze the whole drawing.
    assert.equal(leanTowardPointer(Number.NaN, 100, 50), 0);
    assert.equal(leanTowardPointer(120, 100, 0), 0);
  });

  it('gusts between 9 and 21 seconds apart', () => {
    assert.equal(
      nextGustAt(1000, () => 0),
      1000 + GUST_MIN_MS,
    );
    assert.equal(
      nextGustAt(1000, () => 1),
      1000 + GUST_MAX_MS,
    );
    const middle = nextGustAt(1000, () => 0.5);
    assert.ok(middle > 1000 + GUST_MIN_MS && middle < 1000 + GUST_MAX_MS);
    // A random source that misbehaves still schedules something sane.
    assert.equal(
      nextGustAt(0, () => Number.NaN),
      (GUST_MIN_MS + GUST_MAX_MS) / 2,
    );
  });

  it('starts and ends a gust at rest, and rocks twice through it', () => {
    assert.equal(gustAngle(1000, 1000), 0, 'a gust begins at rest');
    assert.equal(gustAngle(1000 + GUST_DURATION_MS, 1000), 0, 'and settles at rest');
    assert.equal(gustAngle(999, 1000), 0, 'nothing before it starts');

    let peak = 0;
    let crossings = 0;
    let previous = 0;
    for (let t = 1; t < GUST_DURATION_MS; t += 20) {
      const angle = gustAngle(1000 + t, 1000);
      peak = Math.max(peak, Math.abs(angle));
      if (previous !== 0 && Math.sign(angle) !== Math.sign(previous)) crossings += 1;
      previous = angle;
    }
    assert.ok(peak <= GUST_PEAK_DEG + 1e-9, 'a gust is a breeze, not a shake');
    assert.ok(peak > GUST_PEAK_DEG * 0.8, 'and it must actually move the canopy');
    // One swell that swings out, through, and back: two sign changes, not a shove.
    assert.equal(crossings, 2, 'it rocks back and forth, it does not push once');
  });
});
