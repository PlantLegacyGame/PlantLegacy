import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BLADE_WIDTH_FLOOR,
  bladeEmergence,
  HEAD_BUD_SPREAD,
  HEAD_BUD_STAGE,
  HEAD_BUD_STAND,
  headEmergence,
} from './organEmergence.ts';

describe('a blade coming out of its petiole', () => {
  it('starts at the petiole with no length, and only a stub of width', () => {
    const start = bladeEmergence(0);
    assert.equal(start.length, 0);
    assert.equal(start.width, BLADE_WIDTH_FLOOR);
    assert.ok(start.width < 0.4, `width ${start.width}`);
  });

  it('arrives at the full blade', () => {
    assert.deepEqual(bladeEmergence(1), { length: 1, width: 1 });
  });

  it('only ever grows, in length and in width', () => {
    let previous = bladeEmergence(0);
    for (let t = 0.05; t <= 1; t += 0.05) {
      const next = bladeEmergence(t);
      assert.ok(next.length >= previous.length, `length fell at ${t}`);
      assert.ok(next.width >= previous.width, `width fell at ${t}`);
      previous = next;
    }
  });

  it('reaches before it opens: halfway along, the blade is a spear', () => {
    const mid = bladeEmergence(0.5);
    assert.ok(mid.length > mid.width, `length ${mid.length} width ${mid.width}`);
    assert.ok(mid.width < 0.5, `width ${mid.width}`);
  });

  it('opens most of its width by the time it has nearly arrived', () => {
    const late = bladeEmergence(0.9);
    assert.ok(late.width > 0.8, `width ${late.width}`);
    assert.ok(late.length > late.width, 'the blade opens before it stops reaching');
  });

  it('clamps a progress that is not a progress', () => {
    assert.equal(bladeEmergence(-2).length, 0);
    assert.equal(bladeEmergence(4).length, 1);
    assert.equal(bladeEmergence(Number.NaN).length, 1);
  });
});

describe('a seed head coming out of its stem', () => {
  it('starts at nothing on the stem, not as a small open head', () => {
    assert.deepEqual(headEmergence(0), { spread: 0, alongStem: 0 });
  });

  it('is a narrow tall bud before it opens, taller than the open head is thick', () => {
    const bud = headEmergence(HEAD_BUD_STAGE);
    assert.equal(bud.alongStem, HEAD_BUD_STAND);
    assert.equal(Math.round(bud.spread * 100) / 100, HEAD_BUD_SPREAD);
    assert.ok(bud.alongStem / bud.spread > 3, 'a bud is a gathered, lifted head');
  });

  it('is still a bud at half growth, not a small open flower', () => {
    const half = headEmergence(0.5);
    assert.ok(half.spread < 0.75, `spread ${half.spread}`);
    assert.ok(half.alongStem > 1.2, `stand-off ${half.alongStem}`);
    assert.ok(half.alongStem / half.spread > 1.5, 'it opens before it flattens');
  });

  it('arrives at the open head', () => {
    assert.deepEqual(headEmergence(1), { spread: 1, alongStem: 1 });
  });

  it('only ever spreads, and settles its stand-off as it opens', () => {
    let previous = headEmergence(0);
    for (let t = 0.05; t <= 1; t += 0.05) {
      const next = headEmergence(t);
      assert.ok(next.spread >= previous.spread, `spread fell at ${t}`);
      assert.ok(next.spread <= 1, `head past its width at ${t}`);
      // The bud is the tallest it ever is; from there it flattens into the flower.
      assert.ok(next.alongStem <= Math.max(HEAD_BUD_STAND, previous.alongStem) + 1e-9);
      previous = next;
    }
    assert.equal(headEmergence(1).alongStem, 1);
  });

  it('clamps a progress that is not a progress', () => {
    assert.equal(headEmergence(-1).spread, 0);
    assert.deepEqual(headEmergence(9), { spread: 1, alongStem: 1 });
    assert.equal(headEmergence(Number.NaN).spread, 1);
  });
});
