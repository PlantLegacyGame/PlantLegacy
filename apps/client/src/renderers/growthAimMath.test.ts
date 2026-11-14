import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { aimDirectionFromScreenDrag } from './growthAimMath.ts';

const FORWARD = new THREE.Vector3(0, 0, 1);
const RIGHT = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

describe('growth aim screen drag', () => {
  it('turns toward screen-right and screen-down instead of away from the cursor', () => {
    const right = aimDirectionFromScreenDrag(FORWARD, RIGHT, UP, 60, 0);
    assert.ok(right.x > 0.2, `expected +x, got ${right.x}`);

    const down = aimDirectionFromScreenDrag(FORWARD, RIGHT, UP, 0, 60);
    assert.ok(down.y < -0.2, `expected -y, got ${down.y}`);
  });

  it('uses the camera axes after the camera turns around', () => {
    // Camera on the other side of the plant: screen-right is world -x.
    const next = aimDirectionFromScreenDrag(FORWARD, new THREE.Vector3(-1, 0, 0), UP, 60, 0);
    assert.ok(next.x < -0.2, `expected -x, got ${next.x}`);
  });
});
