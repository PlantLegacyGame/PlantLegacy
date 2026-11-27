import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { jointElbow, MAX_ELBOW_ANGLE, MIN_ELBOW_ANGLE } from './jointElbow.ts';

const up = new THREE.Vector3(0, 1, 0);
const direction = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).normalize();

describe('the elbow where a part leaves its parent', () => {
  it('is no elbow while the child runs on in the same direction', () => {
    const elbow = jointElbow(up, [{ direction: direction(0, 1, 0), weight: 1 }]);
    assert.equal(elbow, null);
    // A drift smaller than the limit is not a bend either: a plant at rest
    // would otherwise tremble with every mirror.
    const nearly = jointElbow(up, [
      { direction: direction(Math.sin(0.01), Math.cos(0.01), 0), weight: 1 },
    ]);
    assert.equal(nearly, null);
    assert.ok(MIN_ELBOW_ANGLE > 0.01);
  });

  it('turns the tip through the angle the child leaves at', () => {
    const elbow = jointElbow(up, [{ direction: direction(1, 1, 0), weight: 1 }]);
    assert.ok(elbow);
    assert.ok(Math.abs(elbow.angle - Math.PI / 4) < 1e-6, 'angle ' + elbow.angle);
    assert.ok(elbow.lateral.x > 0.999, 'lateral ' + elbow.lateral.toArray());
  });

  it('bends towards the side the child leaves on', () => {
    const elbow = jointElbow(up, [{ direction: direction(0.6, 0.8, 0), weight: 2 }]);
    assert.ok(elbow);
    assert.ok(Math.abs(elbow.angle - Math.acos(0.8)) < 1e-6);
    // The turn is in the plane of the two parts, not off to one side.
    assert.ok(Math.abs(elbow.lateral.z) < 1e-6);
    assert.ok(elbow.lateral.x > 0.999);
  });

  it('lets the fatter child pull the tip further', () => {
    const elbow = jointElbow(up, [
      { direction: direction(1, 0, 0), weight: 3 },
      { direction: direction(0, 0, 1), weight: 1 },
    ]);
    assert.ok(elbow);
    assert.ok(elbow.lateral.x > 0.7, 'lateral ' + elbow.lateral.toArray());
    assert.ok(elbow.lateral.z > 0);
  });

  it('cancels when two children leave opposite ways', () => {
    const elbow = jointElbow(up, [
      { direction: direction(1, 0, 0), weight: 1 },
      { direction: direction(-1, 0, 0), weight: 1 },
    ]);
    assert.equal(elbow, null);
  });

  it('never folds the parent back past its own limit', () => {
    const back = jointElbow(up, [
      { direction: direction(Math.sin(2.9), Math.cos(2.9), 0), weight: 1 },
    ]);
    assert.ok(back);
    assert.ok(Math.abs(back.angle - MAX_ELBOW_ANGLE) < 1e-9, 'angle ' + back.angle);
  });

  it('has nothing to bend when the child folds straight back', () => {
    const elbow = jointElbow(up, [{ direction: direction(0, -1, 0), weight: 1 }]);
    assert.equal(elbow, null);
  });

  it("does not care how long the child's vector is", () => {
    const long = jointElbow(up, [{ direction: new THREE.Vector3(4, 0, 0), weight: 0.02 }]);
    const unit = jointElbow(up, [{ direction: new THREE.Vector3(1, 0, 0), weight: 0.02 }]);
    assert.ok(long && unit);
    assert.ok(Math.abs(long.angle - unit.angle) < 1e-9);
  });
});
