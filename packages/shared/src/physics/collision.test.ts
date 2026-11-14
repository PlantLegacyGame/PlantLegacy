import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  capsuleCapsuleDistance,
  capsuleHalfHeightForSpan,
  capsuleIntersectsSphere,
  capsulesIntersect,
  closestPointOnSegment,
  closestPointsBetweenSegments,
  makeCapsule,
} from './collision.ts';

const v = (x: number, y: number, z: number) => ({ x, y, z });

describe('capsule collision', () => {
  it('projects a point onto a segment and clamps at the ends', () => {
    const a = v(0, 0, 0);
    const b = v(10, 0, 0);
    assert.deepEqual(closestPointOnSegment(v(5, 0, 0), a, b), v(5, 0, 0));
    assert.deepEqual(closestPointOnSegment(v(-5, 3, 0), a, b), v(0, 0, 0));
    assert.deepEqual(closestPointOnSegment(v(20, 3, 0), a, b), v(10, 0, 0));
  });

  it('finds the closest points of parallel segments', () => {
    const { pointA, pointB } = closestPointsBetweenSegments(
      v(0, 0, 0),
      v(10, 0, 0),
      v(0, 2, 0),
      v(10, 2, 0),
    );
    assert.ok(Math.abs(pointA.y) < 1e-9);
    assert.ok(Math.abs(pointB.y - 2) < 1e-9);
    assert.ok(Math.abs(pointA.x - pointB.x) < 1e-9);
  });

  it('finds the crossing point of perpendicular segments', () => {
    const { pointA, pointB } = closestPointsBetweenSegments(
      v(-5, 0, 0),
      v(5, 0, 0),
      v(0, -5, 0),
      v(0, 5, 0),
    );
    assert.ok(Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y, pointA.z - pointB.z) < 1e-9);
  });

  it('reports negative distance for overlapping capsules', () => {
    const a = makeCapsule(v(0, 0, 0), v(0, 0, 1), 0.2);
    const b = makeCapsule(v(0.1, 0, 0.5), v(0.1, 0, 0.6), 0.2);
    assert.ok(capsuleCapsuleDistance(a, b).distance < 0);
    assert.equal(capsulesIntersect(a, b), true);
  });

  it('reports positive distance for separated capsules', () => {
    const a = makeCapsule(v(0, 0, 0), v(0, 0, 1), 0.1);
    const b = makeCapsule(v(2, 0, 0), v(2, 0, 1), 0.1);
    const result = capsuleCapsuleDistance(a, b);
    assert.ok(Math.abs(result.distance - 1.8) < 1e-6);
    assert.equal(capsulesIntersect(a, b), false);
  });

  it('handles point capsules (a seed) as spheres', () => {
    const seed = makeCapsule(v(0, 0, 0), v(0, 0, 0), 0.5);
    assert.equal(capsuleIntersectsSphere(seed, v(0.6, 0, 0), 0.2), true);
    assert.equal(capsuleIntersectsSphere(seed, v(0.8, 0, 0), 0.2), false);
  });

  it('converts a span to a Rapier half-height without inverting', () => {
    assert.equal(capsuleHalfHeightForSpan(2, 0.2), 0.8);
    assert.equal(capsuleHalfHeightForSpan(0.1, 0.2), 0);
  });

  it('does not blow up on zero-length directions', () => {
    const a = makeCapsule(v(1, 1, 1), v(1, 1, 1), 0.1);
    const b = makeCapsule(v(1, 1, 1), v(1, 1, 1), 0.1);
    assert.ok(capsuleCapsuleDistance(a, b).distance <= 0);
  });
});
