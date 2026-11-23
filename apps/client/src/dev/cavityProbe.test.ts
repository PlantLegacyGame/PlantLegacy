import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { createCavityProbe } from './cavityProbe.ts';

function probe() {
  return createCavityProbe({
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    getTarget: () => new THREE.Vector3(),
  });
}

describe('the cavity probe can size the pit outright', () => {
  it('starts with no forced radius, so the plant sizes the cavity', () => {
    assert.equal(probe().forcedRadius(), null);
  });

  it('keeps the cavity and the mouth apart, as the two uniforms are', () => {
    const p = probe();
    assert.deepEqual(p.setRadius({ cavityM: 7, apertureM: 4.9 }), { cavityM: 7, apertureM: 4.9 });
    // A grown mouth is not the cutaway sphere: 7 m of cavity with a 4.9 m hole in
    // it is exactly the pair the shipped config produces at full radius.
    assert.deepEqual(p.forcedRadius(), { cavityM: 7, apertureM: 4.9 });
  });

  it('falls back to the cavity for a mouth it was not given, and floors both', () => {
    const p = probe();
    assert.deepEqual(p.setRadius({ cavityM: 2, apertureM: Number.NaN }), {
      cavityM: 2,
      apertureM: 2,
    });
    assert.deepEqual(p.setRadius({ cavityM: 0, apertureM: -3 }), {
      cavityM: 0.05,
      apertureM: 0.05,
    });
  });

  it('hands the cavity back to the plant when cleared', () => {
    const p = probe();
    p.setRadius({ cavityM: 7, apertureM: 4.9 });
    assert.equal(p.setRadius(null), null);
    assert.equal(p.forcedRadius(), null);
  });

  it('returns copies, so a caller cannot resize the cavity behind its back', () => {
    const p = probe();
    const set = p.setRadius({ cavityM: 7, apertureM: 4.9 });
    assert.ok(set);
    set.apertureM = 100;
    const read = p.forcedRadius();
    assert.ok(read);
    read.cavityM = 100;
    assert.deepEqual(p.forcedRadius(), { cavityM: 7, apertureM: 4.9 });
  });
});
