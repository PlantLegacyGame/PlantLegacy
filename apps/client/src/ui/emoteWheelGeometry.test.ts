import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  annularSectorPath,
  normalizeAngle,
  sectorAngles,
  sectorAtOffset,
  sectorLabelPoint,
  TAU,
} from './emoteWheelGeometry.ts';

describe('emote wheel geometry', () => {
  it('maps the eight pointer directions to the sector under them', () => {
    const cases: Array<[number, number, number]> = [
      [0, -100, 0],
      [70.71, -70.71, 1],
      [100, 0, 2],
      [70.71, 70.71, 3],
      [0, 100, 4],
      [-70.71, 70.71, 5],
      [-100, 0, 6],
      [-70.71, -70.71, 7],
    ];
    for (const [dx, dy, expected] of cases) {
      assert.equal(sectorAtOffset(dx, dy, 8, 20), expected, `(${dx}, ${dy})`);
    }
  });

  it('does not select an emote in the centre dead zone', () => {
    assert.equal(sectorAtOffset(0, 0, 8, 20), -1);
    assert.equal(sectorAtOffset(12, 12, 8, 20), -1);
    assert.equal(sectorAtOffset(0, -21, 8, 20), 0);
  });

  it('hands a boundary direction to the sector it enters clockwise', () => {
    const justBefore = 100 * Math.tan((22 * Math.PI) / 180);
    const justAfter = 100 * Math.tan((23 * Math.PI) / 180);
    assert.equal(sectorAtOffset(justBefore, -100, 8, 0), 0);
    assert.equal(sectorAtOffset(justAfter, -100, 8, 0), 1);
  });

  it('scales to four sectors', () => {
    assert.equal(sectorAtOffset(0, -100, 4, 0), 0);
    assert.equal(sectorAtOffset(100, 0, 4, 0), 1);
    assert.equal(sectorAtOffset(0, 100, 4, 0), 2);
    assert.equal(sectorAtOffset(-100, 0, 4, 0), 3);
  });

  it('wraps angles instead of trusting the caller', () => {
    assert.equal(normalizeAngle(0), 0);
    assert.equal(normalizeAngle(TAU), 0);
    assert.equal(normalizeAngle(-Math.PI / 2), (3 * Math.PI) / 2);
    assert.equal(sectorAtOffset(100, 0, 8, 0), 2);
    assert.equal(sectorAtOffset(100, 0.0001, 8, 0), 2);
  });

  it('returns no sector for unusable input', () => {
    assert.equal(sectorAtOffset(Number.NaN, 0, 8, 20), -1);
    assert.equal(sectorAtOffset(0, 0, 0, 20), -1);
    assert.equal(sectorAtOffset(0, -100, 8, 0), 0);
  });

  it('builds sector angles with the first sector centred on the top', () => {
    const top = sectorAngles(0, 8);
    assert.equal(top.mid, 0);
    assert.ok(top.start < 0 && top.end > 0);
    const right = sectorAngles(2, 8);
    assert.ok(Math.abs(right.mid - Math.PI / 2) < 1e-9);
  });

  it('paints a closed annular sector without NaN', () => {
    const first = sectorAngles(0, 8);
    const path = annularSectorPath(210, 210, 74, 200, first.start, first.end, 0.035);
    assert.match(path, /^M /u);
    assert.match(path, / A 200 200 0 0 1 /u);
    assert.match(path, / A 74 74 0 0 0 /u);
    assert.ok(path.endsWith(' Z'));
    assert.ok(!path.includes('NaN'));
  });

  it('places the top label above the centre', () => {
    const point = sectorLabelPoint(210, 210, 140, 0, 8);
    assert.ok(Math.abs(point.x - 210) < 1e-9);
    assert.ok(point.y < 210);
  });
});
