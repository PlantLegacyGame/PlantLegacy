import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AIM_GENE_HOLD_TOLERANCE_RAD, clampAimToGenes } from './growthAimClamp.ts';

const near = (a: number, b: number, what: string): void => {
  assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} != ${b}`);
};

describe('the genes against the dragged aim', () => {
  it('leaves an aim inside the sector alone and says it is not held', () => {
    // A stem aimed up and slightly across: well inside its own sector.
    const result = clampAimToGenes('stem', { x: 0.2, y: 0.95, z: 0 });
    near(Math.hypot(result.direction.x, result.direction.y, result.direction.z), 1, 'unit');
    assert.equal(result.held, false);
    assert.ok(result.turnedRad < AIM_GENE_HOLD_TOLERANCE_RAD);
  });

  it('reports a radicle dragged upward as held, pointing down', () => {
    // Straight up is the furthest a radicle can be asked to go from its sector.
    const result = clampAimToGenes('radicle', { x: 0, y: 1, z: 0 });
    assert.equal(result.held, true);
    assert.ok(result.direction.y < 0, `radicle y ${result.direction.y}`);
    assert.ok(result.turnedRad > 1, `turned ${result.turnedRad} rad`);
  });

  it('measures how far it was turned, not just that it was', () => {
    const result = clampAimToGenes('stem', { x: 0, y: -1, z: 0 });
    assert.equal(result.held, true);
    // The angle between the request and the answer, by its own vectors.
    const dot = result.direction.x * 0 + result.direction.y * -1 + result.direction.z * 0;
    near(result.turnedRad, Math.acos(Math.max(-1, Math.min(1, dot))), 'angle');
  });

  it('answers a request with no direction at all without claiming it was held', () => {
    const result = clampAimToGenes('leaf', { x: 0, y: 0, z: 0 });
    assert.equal(result.held, false);
    near(result.turnedRad, 0, 'turn');
    near(Math.hypot(result.direction.x, result.direction.y, result.direction.z), 1, 'unit');
  });

  it('holds a leaf pointed at the ground, and answers upward', () => {
    // A blade's sector has a floor on its height; straight down is outside it.
    const result = clampAimToGenes('leaf', { x: 0, y: -1, z: 0 });
    assert.equal(result.held, true);
    assert.ok(result.direction.y > 0, `y ${result.direction.y}`);
  });
});
