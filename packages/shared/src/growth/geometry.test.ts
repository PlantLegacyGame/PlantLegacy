import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  clampChildSegmentLength,
  DEFAULT_JOINT_FLARE_RATIO,
  getJointFlareRatio,
  getMaxChildLengthRatio,
  getSegmentTaperExponent,
  getSocketInsetRatio,
  jointStartRadius,
  segmentRadiusAt,
  setGrowthGeometryTunables,
  setMaxChildLengthRatio,
  socketInset,
} from './geometry.ts';

/**
 * These four rules describe a *junction*, not a part, and two renderers plus the
 * Lab draw from them. The tests pin the properties that make a joint look grown:
 * a knuckle a little wider than its own shank, capped by the parent that carries
 * it, and a neck that finishes early so a segment is a branch and not a funnel.
 */
describe('joint geometry', () => {
  afterEach(() => {
    setGrowthGeometryTunables();
  });

  it('draws a woody part as a knuckle 1.25x its own shank', () => {
    const radius = jointStartRadius(0.045, 0.017);
    assert.equal(Math.round((radius / 0.017) * 100) / 100, DEFAULT_JOINT_FLARE_RATIO);
    assert.ok(radius < 0.045, 'a branch base must stay thinner than the trunk carrying it');
  });

  it('never lets a child be wider than the parent at the attach point', () => {
    // A fat tuber on a thin root: the base is the parent's radius, and the
    // body swells past it further along, where nothing has to cover it.
    assert.equal(jointStartRadius(0.012, 0.055), 0.012);
  });

  it('gives a soft organ no knuckle', () => {
    assert.equal(jointStartRadius(0.026, 0.008, true), 0.008);
    assert.equal(jointStartRadius(0.005, 0.008, true), 0.005);
  });

  it('falls back to whichever radius exists instead of returning zero', () => {
    assert.equal(jointStartRadius(0, 0.02), 0.02);
    assert.equal(jointStartRadius(0.02, 0), 0.02);
    assert.equal(jointStartRadius(Number.NaN, 0.02), 0.02);
  });

  it('reads the flare from config, clamped to a sane range', () => {
    setGrowthGeometryTunables({ jointFlareRatio: 1.6 });
    assert.equal(getJointFlareRatio(), 1.6);
    assert.equal(Math.round((jointStartRadius(0.05, 0.02) / 0.02) * 100) / 100, 1.6);
    setGrowthGeometryTunables({ jointFlareRatio: 12 });
    assert.equal(getJointFlareRatio(), 2);
    setGrowthGeometryTunables({ jointFlareRatio: 0.2 });
    assert.equal(getJointFlareRatio(), 1);
    setGrowthGeometryTunables({ jointFlareRatio: Number.NaN });
    assert.equal(getJointFlareRatio(), DEFAULT_JOINT_FLARE_RATIO);
  });

  it('taper exponent shapes the neck but keeps both ends exact', () => {
    const r0 = 0.021;
    const r1 = 0.017;
    assert.equal(segmentRadiusAt(r0, r1, 0), r0);
    assert.equal(segmentRadiusAt(r0, r1, 1), r1);
    assert.equal(segmentRadiusAt(r0, r1, -5), r0);
    assert.equal(segmentRadiusAt(r0, r1, 5), r1);
  });

  it('does most of the necking in the first half of a segment', () => {
    const r0 = 0.045;
    const r1 = 0.017;
    const linearHalf = (r0 + r1) / 2;
    const half = segmentRadiusAt(r0, r1, 0.5);
    const travelled = (r0 - half) / (r0 - r1);
    assert.ok(half < linearHalf, 'a linear cone puts the midpoint halfway; this must not');
    assert.ok(
      travelled > 0.75,
      `expected over 3/4 of the neck done at half length, got ${travelled}`,
    );
  });

  it('stays monotone along the whole segment', () => {
    let previous = segmentRadiusAt(0.03, 0.01, 0);
    for (let t = 0.05; t <= 1.0001; t += 0.05) {
      const radius = segmentRadiusAt(0.03, 0.01, t);
      assert.ok(radius <= previous + 1e-12, `radius grew at t=${t.toFixed(2)}`);
      previous = radius;
    }
  });

  it('honours the configured taper exponent, clamped to a sane range', () => {
    setGrowthGeometryTunables({ segmentTaperExponent: 1 });
    assert.equal(getSegmentTaperExponent(), 1);
    assert.equal(segmentRadiusAt(0.04, 0.02, 0.5), 0.03);
    setGrowthGeometryTunables({ segmentTaperExponent: 9 });
    assert.equal(getSegmentTaperExponent(), 4);
  });

  it('keeps a new segment in proportion to the part it leaves', () => {
    // A size mutation scales the new segment, and the scale is a product of every
    // size mutation and level card the plant holds. Uncapped, a side branch came
    // out at several times the length of the trunk it left: every joint still met,
    // but nothing about it read as a plant.
    assert.equal(clampChildSegmentLength(0.95 * 2.4, 0.5, 1.6), 0.8);
    // Inside the ceiling, the mutation's own scaling is untouched (a branch
    // leaving a 95 cm stem at 1.15x is still 1.09 m).
    assert.equal(clampChildSegmentLength(0.95 * 1.15, 0.95, 1.6), 0.95 * 1.15);
    // A seed has no length to be proportional to yet, so it imposes no ceiling.
    assert.equal(clampChildSegmentLength(0.95, 0, 1.6), 0.95);
    // No ratio configured, no ceiling: this is a config rule, not a constant.
    assert.equal(clampChildSegmentLength(4, 0.5, undefined), 4);
    // A non-finite length is not a length.
    assert.equal(clampChildSegmentLength(Number.NaN, 0.5, 1.6), 0);
    assert.equal(getMaxChildLengthRatio(), 1.6);
    setMaxChildLengthRatio(2.5);
    assert.equal(getMaxChildLengthRatio(), 2.5);
    setMaxChildLengthRatio(0.5);
    assert.equal(getMaxChildLengthRatio(), 2.5);
  });

  it('starts a child just inside its parent, not on its surface', () => {
    assert.equal(Math.round(socketInset(0.02) * 1000) / 1000, 0.003);
    assert.equal(socketInset(0), 0);
    setGrowthGeometryTunables({ socketInsetRatio: 0.9 });
    assert.equal(getSocketInsetRatio(), 0.9);
    setGrowthGeometryTunables({ socketInsetRatio: -1 });
    assert.equal(getSocketInsetRatio(), 0);
  });
});
