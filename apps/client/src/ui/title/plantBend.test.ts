import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bendArcPath,
  bendArcSegment,
  bendPlacement,
  bendPoint,
  bendTension,
  limbBaseWidth,
} from './plantBend.ts';

const LENGTH = 140;

describe('bent stem arc', () => {
  it('is exactly straight at rest', () => {
    for (const t of [0, 0.25, 0.5, 1]) {
      const point = bendPoint(0, t, LENGTH);
      assert.equal(point.x, 0);
      assert.equal(point.y, -t * LENGTH);
      assert.equal(point.turnDeg, 0);
    }
  });

  it('keeps its length: every point stays an arc length from the foot', () => {
    const bend = 60;
    const point = bendPoint(bend, 1, LENGTH);
    const chord = Math.hypot(point.x, point.y);
    // A chord is shorter than its arc, and never by more than a radius or so.
    assert.ok(chord < LENGTH);
    assert.ok(chord > LENGTH * 0.85);
    // The tip has turned by the full bend, the foot not at all.
    assert.ok(Math.abs(point.turnDeg - bend) < 1e-9);
    assert.equal(bendPoint(bend, 0, LENGTH).turnDeg, 0);
  });

  it('turns further along the stem, monotonically, in the drag direction', () => {
    let previous = 0;
    for (let t = 0.1; t <= 1.0001; t += 0.1) {
      const turn = bendPoint(40, t, LENGTH).turnDeg;
      assert.ok(turn > previous);
      previous = turn;
    }
    const right = bendPoint(40, 1, LENGTH);
    const left = bendPoint(-40, 1, LENGTH);
    assert.ok(right.x > 0);
    assert.ok(left.x < 0);
    assert.ok(Math.abs(right.x + left.x) < 1e-9);
    assert.ok(Math.abs(right.y - left.y) < 1e-9);
  });

  it('bends mostly above the middle, where a rooted stem gives', () => {
    // Half way up, well under half the bend has happened; almost all of it is in
    // the top third, which is what brings the canopy down instead of swinging the
    // whole stalk sideways.
    const halfway = bendPoint(80, 0.5, LENGTH).turnDeg;
    assert.ok(halfway < 80 * 0.46, `expected under 37 degrees, got ${halfway}`);
    // But it is not all at the top either: the visible lower stem has to curve.
    assert.ok(bendPoint(80, 0.25, LENGTH).turnDeg > 80 * 0.1);
    assert.ok(bendPoint(80, 0.85, LENGTH).turnDeg > 80 * 0.7);
    // The foot stays where it is: a rooted stem does not lean from the ground.
    const low = bendPoint(80, 0.08, LENGTH);
    assert.ok(Math.abs(low.x) < LENGTH * 0.02);
  });

  it('places a part by its distance up the stem, not its screen height', () => {
    // A leaf attached two thirds of the way up follows the curve there.
    const placement = bendPlacement(50, 224 - LENGTH * (2 / 3), 224, LENGTH);
    const point = bendPoint(50, 2 / 3, LENGTH);
    assert.ok(Math.abs(placement.dx - point.x) < 1e-9);
    // The placement is a delta from where the part is drawn, so adding it to the
    // original offset from the foot is where the part ends up on the arc.
    const drawnOffset = -LENGTH * (2 / 3);
    assert.ok(Math.abs(drawnOffset + placement.dy - point.y) < 1e-9);
    assert.ok(Math.abs(placement.turnDeg - point.turnDeg) < 1e-9);
    // At rest the placement is nothing at all, so the art is untouched.
    assert.deepEqual(bendPlacement(0, 130, 224, LENGTH), { dx: 0, dy: 0, turnDeg: 0 });
  });

  it('draws a path that starts at the foot and ends at the tip', () => {
    const path = bendArcPath(70, LENGTH, 100, 224);
    assert.ok(path.startsWith('M100.00 224.00'));
    const tip = bendPoint(70, 1, LENGTH);
    assert.ok(path.includes(`${(100 + tip.x).toFixed(2)} ${(224 + tip.y).toFixed(2)}`));
    assert.ok(path.includes('Q'));
    // A shift moves the whole path sideways without changing where it starts
    // vertically, which is how the highlight and shadow strokes are drawn.
    const shifted = bendArcPath(70, LENGTH, 100, 224, 14, 3);
    assert.ok(!shifted.startsWith('M100.00 224.00'));
  });

  it('draws any part of the same arc, so the trunk is the stem', () => {
    // The tree's bark is the bottom of this arc, not a second curve beside it. A
    // segment has to start and end exactly where the spine does at those fractions,
    // and the whole range has to be the plain path.
    const segment = bendArcSegment(60, LENGTH, 100, 224, 0, 0.62, 10);
    const start = bendPoint(60, 0, LENGTH);
    const end = bendPoint(60, 0.62, LENGTH);
    assert.ok(segment.startsWith(`M${(100 + start.x).toFixed(2)} ${(224 + start.y).toFixed(2)}`));
    assert.ok(
      segment.endsWith(`${(100 + end.x).toFixed(2)} ${(224 + end.y).toFixed(2)}`),
      'the segment does not end on the spine at its own fraction',
    );
    assert.equal(bendArcSegment(60, LENGTH, 100, 224, 0, 1, 14), bendArcPath(60, LENGTH, 100, 224));
    // A segment's last point is the tip: a trunk must not overshoot the stem.
    const whole = bendArcSegment(60, LENGTH, 100, 224, 0, 1, 6);
    const tip = bendPoint(60, 1, LENGTH);
    assert.ok(whole.endsWith(`${(100 + tip.x).toFixed(2)} ${(224 + tip.y).toFixed(2)}`));
  });

  it('strains late: the first third of the bend is barely any strain', () => {
    assert.equal(bendTension(0, 80), 0);
    assert.ok(bendTension(10, 80) < 0.02);
    assert.ok(bendTension(40, 80) < bendTension(60, 80));
    assert.equal(bendTension(80, 80), 1);
    assert.equal(bendTension(-80, 80), 1, 'either direction strains the same');
    assert.equal(bendTension(80, 0), 0, 'no range means no strain, not a divide by zero');
  });
});

describe('arm thickness', () => {
  it('is the same on both sides at the same height, and never upside down', () => {
    // The complaint this answers: an arm higher up came out thicker than one lower
    // down on the other side. Width is a function of height and reach only, so two
    // arms at the same t cannot disagree, and thickness is monotonic in t.
    let previous = Infinity;
    for (let t = 0.42; t <= 0.8601; t += 0.02) {
      const here = limbBaseWidth(Number(t.toFixed(3)), 80);
      const other = limbBaseWidth(Number(t.toFixed(3)), 80);
      assert.equal(here, other);
      assert.ok(here <= previous + 1e-9, `an arm at t ${t} was thicker than a lower one`);
      previous = here;
    }
  });

  it('keeps reach from outbidding height between neighbouring arms', () => {
    // Neighbouring arms are at least 0.04 apart in t; the longest arm may not be
    // thicker than the shortest arm one step below it.
    const lower = limbBaseWidth(0.42, 34);
    const higher = limbBaseWidth(0.46, 100);
    assert.ok(lower > higher, `low short ${lower} vs high long ${higher}`);
  });

  it('tapers the crown: thick at the bottom of it, thin at the top', () => {
    assert.ok(limbBaseWidth(0.42, 96) >= 15);
    assert.ok(limbBaseWidth(0.86, 46) <= 9);
  });
});
