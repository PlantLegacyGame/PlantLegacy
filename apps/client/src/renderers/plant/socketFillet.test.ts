import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { buildSocketFilletGeometry, socketFilletFor } from './socketFillet.ts';

describe('the socket fillet', () => {
  it('blends a fat parent down to a thin child', () => {
    const fillet = socketFilletFor(0.12, 0.025, 0.3);
    assert.ok(fillet.startRadius > fillet.endRadius);
    assert.ok(Math.abs(fillet.startRadius - 0.045) < 1e-9);
    assert.equal(fillet.endRadius, 0.025);
  });

  it('blends a thin parent out to a thicker child', () => {
    const fillet = socketFilletFor(0.018, 0.04, 0.3);
    assert.ok(fillet.startRadius < fillet.endRadius);
    assert.equal(fillet.startRadius, 0.018);
    assert.equal(fillet.endRadius, 0.04);
  });

  it('builds the same swept cone for 30, 90 and 150 degree joints', () => {
    const parent = 0.08;
    const child = 0.03;
    for (const angleDeg of [30, 90, 150]) {
      // The blend is a function of the two radii, not of the turn: a 150
      // degree lateral must not be capped with a different ball.
      const fillet = socketFilletFor(parent, child, 0.2);
      const geometry = buildSocketFilletGeometry(fillet, 10);
      const position = geometry.getAttribute('position');
      assert.ok(position.count > 0);
      geometry.computeBoundingBox();
      const height = (geometry.boundingBox?.max.y ?? 0) - (geometry.boundingBox?.min.y ?? 0);
      assert.ok(Math.abs(height - fillet.length) < 1e-6, `${angleDeg} degree fillet height`);
      assert.ok(geometry instanceof THREE.BufferGeometry);
      geometry.dispose();
    }
  });

  it('keeps the blend short relative to its parent segment', () => {
    const fillet = socketFilletFor(0.1, 0.02, 2);
    assert.ok(fillet.length <= 0.7);
    assert.ok(fillet.length >= 0.018);
  });
});
