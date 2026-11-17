import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import {
  buildTaperedTubeGeometry,
  clampAnchorToNode,
  groundMarkerHeight,
  ringFrameFor,
  taperedTubeRadius,
} from './growthGizmoGeometry.ts';

describe('growth aim arrow geometry', () => {
  it('tapers from the mouth to the tip', () => {
    const base = taperedTubeRadius(0, 0.01, 0.45);
    const middle = taperedTubeRadius(0.5, 0.01, 0.45);
    const tip = taperedTubeRadius(1, 0.01, 0.45);
    assert.equal(base, 0.01);
    assert.ok(middle < base && middle > tip, `not monotone: ${base} ${middle} ${tip}`);
    assert.ok(Math.abs(tip - 0.0045) < 1e-9);
  });

  it('never collapses to a zero-width hairline', () => {
    assert.ok(taperedTubeRadius(1, 0.01, 0) > 0);
    assert.ok(taperedTubeRadius(2, 0.01, 0.45) > 0);
    assert.ok(taperedTubeRadius(-1, 0.01, 0.45) > 0);
  });

  it('builds a closed tube with a ring per point', () => {
    const points = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0.4, 0),
      new THREE.Vector3(0.1, 0.8, 0),
    ];
    const geometry = buildTaperedTubeGeometry(points, 0.02, 0.4, 6);
    const position = geometry.getAttribute('position');
    assert.equal(position.count, points.length * 6);
    assert.equal(geometry.getIndex()?.count, (points.length - 1) * 6 * 6);
    geometry.dispose();
  });

  it('puts the wide end at the start of the path', () => {
    const points = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 2, 0),
    ];
    const geometry = buildTaperedTubeGeometry(points, 0.02, 0.4, 8);
    const position = geometry.getAttribute('position');
    const ringRadiusAt = (ring: number): number => {
      let sum = 0;
      for (let i = 0; i < 8; i += 1) {
        const index = ring * 8 + i;
        sum += Math.hypot(position.getX(index), position.getZ(index));
      }
      return sum / 8;
    };
    const first = ringRadiusAt(0);
    const last = ringRadiusAt(2);
    assert.ok(first > last, `start radius ${first} should exceed tip radius ${last}`);
    geometry.dispose();
  });
});

describe('growth aim ground marker', () => {
  it('stands on the terrain under the tip', () => {
    assert.equal(
      groundMarkerHeight(() => 3.5, 10, -2),
      3.5,
    );
  });

  it('falls back to the soil line rather than to NaN', () => {
    assert.equal(
      groundMarkerHeight(() => Number.NaN, 0, 0),
      0,
    );
  });
});

describe('growth aim ring frame', () => {
  const up = new THREE.Vector3(0, 1, 0);

  it('lies across the stem it leaves, not across the aim', () => {
    // A branch leaving a vertical stem at 45 degrees: the ring is the stem's
    // cross-section, so its plane is horizontal and the arrow leaves through it.
    const aim = new THREE.Vector3(0.7, 0.7, 0).normalize();
    const frame = ringFrameFor({
      attach: new THREE.Vector3(0, 1, 0),
      parentTangent: new THREE.Vector3(0, 1, 0),
      aim,
      surfaceUp: up,
      partRadiusM: 0.05,
    });
    assert.ok(frame.normal.distanceTo(up) < 1e-6, 'the ring turned to face the aim');
    assert.deepEqual(frame.center.toArray(), [0, 1, 0]);
  });

  it('sits on a seed coat at the point the part leaves, facing the aim', () => {
    const aim = new THREE.Vector3(0, -1, 0);
    const frame = ringFrameFor({
      attach: new THREE.Vector3(0, 0.4, 0),
      parentTangent: null,
      aim,
      surfaceUp: up,
      partRadiusM: 0.1,
    });
    assert.ok(Math.abs(frame.center.y - 0.3) < 1e-9, 'the mouth is not on the coat');
    assert.ok(frame.normal.distanceTo(aim) < 1e-6);
  });

  it('uses planet up when a part has no aim or parent axis', () => {
    const frame = ringFrameFor({
      attach: new THREE.Vector3(0, 0, 0),
      parentTangent: null,
      aim: new THREE.Vector3(),
      surfaceUp: new THREE.Vector3(0.6, 0.8, 0),
      partRadiusM: 0.2,
    });
    assert.ok(frame.normal.y > 0.79 && frame.normal.x > 0.59);
  });

  it('stays a unit normal for a degenerate parent tangent', () => {
    const frame = ringFrameFor({
      attach: new THREE.Vector3(1, 1, 1),
      parentTangent: new THREE.Vector3(0, 0, 0),
      aim: up,
      surfaceUp: up,
      partRadiusM: 0.1,
    });
    assert.ok(Math.abs(frame.normal.length() - 1) < 1e-9);
  });
});

describe('growth aim anchor', () => {
  const centre = new THREE.Vector3(1, 2, 3);

  it('leaves an anchor on its own part alone', () => {
    const anchor = new THREE.Vector3(1.4, 2.3, 3);
    assert.deepEqual(clampAnchorToNode(anchor, centre, 1.6).toArray(), anchor.toArray());
  });

  it('pulls an anchor from another stem back onto the selected part', () => {
    const elsewhere = new THREE.Vector3(9, 2, 3);
    const clamped = clampAnchorToNode(elsewhere, centre, 1.6);
    assert.ok(clamped.distanceTo(centre) < 1.6001);
    // Pulled along the same bearing, so the ring keeps the side the server meant.
    assert.ok(clamped.x > centre.x);
    assert.ok(Math.abs(clamped.y - centre.y) < 1e-6);
  });

  it('never clamps to a zero radius', () => {
    const elsewhere = new THREE.Vector3(5, 2, 3);
    assert.ok(clampAnchorToNode(elsewhere, centre, 0).distanceTo(centre) > 0.04);
  });
});
