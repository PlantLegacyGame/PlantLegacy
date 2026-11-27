import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import {
  buildInkHullGeometry,
  buildLiveInkHullGeometry,
  buildLiveTubeGeometry,
  buildTubeGeometry,
  collarSpinePoint,
  elbowSpinePoint,
  tubeGeometryCacheSize,
} from './tubeShape.ts';

const quality = { tubeRadialSegments: 8, tubeLengthSegments: 4 };

/** A ring's radius from the tube's own axis, for a tube standing on +Y. */
function radiusAt(geometry: THREE.BufferGeometry, y: number): number {
  const position = geometry.getAttribute('position');
  const radii: number[] = [];
  for (let i = 0; i < position.count; i += 1) {
    if (Math.abs(position.getY(i) - y) < 1e-4) {
      radii.push(Math.hypot(position.getX(i), position.getZ(i)));
    }
  }
  return Math.max(...radii);
}

function triangles(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  return index ? index.count / 3 : geometry.getAttribute('position').count / 3;
}

function verticalNormals(geometry: THREE.BufferGeometry): number {
  const normal = geometry.getAttribute('normal');
  let count = 0;
  for (let i = 0; i < normal.count; i += 1) {
    if (Math.abs(normal.getY(i)) > 0.99) count += 1;
  }
  return count;
}

describe('the line round a part', () => {
  it('is the part’s own tube without its end caps', () => {
    // A cap's normal runs along the tube, so the hull shader would push it the
    // ink's width past the part's end - and at a joint that disc cut a dark band
    // across the part it grew into.
    const body = buildTubeGeometry(0.02, 0.015, 0.4, quality);
    const hull = buildInkHullGeometry(0.02, 0.015, 0.4, quality);
    const sides = quality.tubeRadialSegments * quality.tubeLengthSegments * 2;
    const caps = quality.tubeRadialSegments * 2;
    assert.equal(triangles(body), sides + caps, 'the body lost its caps');
    assert.equal(triangles(hull), sides, 'the hull still carries a cap');
    assert.equal(verticalNormals(hull), 0, 'a cap survived in the hull');
    assert.ok(verticalNormals(body) > 0, 'the body should still be capped');
  });

  it('ends where the part ends, so it cannot reach into the next part', () => {
    const length = 0.4;
    const hull = buildInkHullGeometry(0.02, 0.015, length, quality);
    const position = hull.getAttribute('position');
    let lowest = Number.POSITIVE_INFINITY;
    let highest = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < position.count; i += 1) {
      lowest = Math.min(lowest, position.getY(i));
      highest = Math.max(highest, position.getY(i));
    }
    assert.ok(Math.abs(lowest) < 1e-6, `the line starts above the base: ${lowest}`);
    assert.ok(Math.abs(highest - length) < 1e-6, `the line runs past the tip: ${highest}`);
  });

  it('has the part’s own silhouette, so only the ink width separates them', () => {
    const body = buildTubeGeometry(0.02, 0.01, 0.3, quality);
    const hull = buildInkHullGeometry(0.02, 0.01, 0.3, quality);
    // The tube's own rings: 0.3 m split into four length segments.
    for (const y of [0.075, 0.15, 0.225]) {
      assert.ok(
        Math.abs(radiusAt(body, y) - radiusAt(hull, y)) < 1e-6,
        `the hull is not the body at y=${y}`,
      );
    }
  });

  it('follows a bend the same way the body does', () => {
    const body = buildTubeGeometry(0.02, 0.02, 0.5, quality, 0.08);
    const hull = buildInkHullGeometry(0.02, 0.02, 0.5, quality, 0.08);
    const positions = (g: THREE.BufferGeometry) => {
      const position = g.getAttribute('position');
      const out: string[] = [];
      for (let i = 0; i < position.count; i += 1) {
        out.push(`${position.getX(i).toFixed(5)},${position.getY(i).toFixed(5)}`);
      }
      return out.sort();
    };
    // The hull's own vertices are the body's side, so its shape is a subset: a
    // bowed tube must stay bowed in its line, or the ink drifts off the part.
    const bodySet = new Set(positions(body).filter((v) => Number(v.split(',')[1]) >= 0));
    const missing = positions(hull).filter((v) => !bodySet.has(v));
    assert.deepEqual(missing, []);
  });
});

describe('the elbow a part turns into at its tip', () => {
  const length = 0.5;
  const angle = Math.PI / 4;

  it('leaves the joint exactly where the part put it', () => {
    // The child leaving this joint starts at the joint, not where the parent's
    // body went: what bends is the parent, never the coordinate.
    const tip = elbowSpinePoint(1, length, angle, 0);
    assert.ok(tip.position.distanceTo(new THREE.Vector3(0, length, 0)) < 1e-9);
    const radius = 0.02;
    const geometry = buildTubeGeometry(radius, radius, length, quality, 0, undefined, {
      tip: { angle, azimuth: 0 },
    });
    const position = geometry.getAttribute('position');
    const cap = new THREE.Vector3();
    let capVertices = 0;
    for (let i = 0; i < position.count; i += 1) {
      if (position.getY(i) > length - 1e-6) {
        cap.x += position.getX(i);
        cap.y += position.getY(i);
        cap.z += position.getZ(i);
        capVertices += 1;
      }
    }
    assert.ok(capVertices > 0, 'the bent tube has no tip at all');
    cap.divideScalar(capVertices);
    assert.ok(cap.distanceTo(new THREE.Vector3(0, length, 0)) < radius * 1.5, cap.toArray().join());
  });

  it('arrives along the direction the next part leaves in', () => {
    const tip = elbowSpinePoint(1, length, angle, 0);
    // A child leaving at 45 degrees towards +X.
    const expected = new THREE.Vector3(Math.sin(angle), Math.cos(angle), 0);
    assert.ok(tip.tangent.distanceTo(expected) < 1e-9, tip.tangent.toArray().join());
    // And it leaves from the axis, straight: the bend is at the far end only.
    const base = elbowSpinePoint(0, length, angle, 0);
    assert.ok(base.position.length() < 1e-9);
    assert.ok(base.tangent.distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-9);
  });

  it('turns the way the elbow says, not always the same way', () => {
    // The joint is pinned, so the body leans to the side the child leaves on and
    // arrives from the other one: that lean is what fills the notch.
    const towardsX = buildTubeGeometry(0.02, 0.02, length, quality, 0, undefined, {
      tip: { angle, azimuth: 0 },
    });
    const towardsZ = buildTubeGeometry(0.02, 0.02, length, quality, 0, undefined, {
      tip: { angle, azimuth: Math.PI / 2 },
    });
    const lean = (g: THREE.BufferGeometry, axis: 'x' | 'z') => {
      const position = g.getAttribute('position');
      let away = 0;
      let other = 0;
      for (let i = 0; i < position.count; i += 1) {
        away = Math.min(away, axis === 'x' ? position.getX(i) : position.getZ(i));
        other = Math.max(other, axis === 'x' ? position.getZ(i) : position.getX(i));
      }
      return { away, other };
    };
    const x = lean(towardsX, 'x');
    const z = lean(towardsZ, 'z');
    assert.ok(x.away < -0.02, 'the tube never left the axis: ' + x.away);
    assert.ok(Math.abs(x.other) < 0.02, 'the bend went off its own plane');
    assert.ok(z.away < -0.02);
  });

  it('ends its line at the joint, so the ink cannot run past it', () => {
    const radius = 0.015;
    const hull = buildInkHullGeometry(0.02, radius, length, quality, 0, undefined, {
      tip: { angle, azimuth: 0 },
    });
    const position = hull.getAttribute('position');
    let highest = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < position.count; i += 1) {
      highest = Math.max(highest, position.getY(i));
    }
    // The open end's rim is square to the joint, so it spreads round it by the
    // tube's own radius - and no further.
    assert.ok(highest <= length + radius, `the line runs past the joint: ${highest}`);
  });

  it('shares one tube per angle and side, and keeps angles apart', () => {
    const a = buildTubeGeometry(0.02, 0.02, length, quality, 0, undefined, {
      tip: { angle, azimuth: 0 },
    });
    const b = buildTubeGeometry(0.02, 0.02, length, quality, 0, undefined, {
      tip: { angle, azimuth: 0 },
    });
    const other = buildTubeGeometry(0.02, 0.02, length, quality, 0, undefined, {
      tip: { angle: angle * 2, azimuth: 0 },
    });
    assert.equal(a, b);
    assert.notEqual(a, other);
  });
});

describe('the collar a part grows where it leaves its parent', () => {
  const length = 0.5;
  const angle = Math.PI / 5;
  const parentLine = new THREE.Vector3(Math.sin(angle), Math.cos(angle), 0);

  it('leaves along the parent’s own line, then arrives on its own', () => {
    // The base is the joint: it stays at the origin, and it starts out along the
    // parent rather than at its own angle, which is what fills the crease.
    const base = collarSpinePoint(0, length, angle, 0);
    assert.ok(base.position.length() < 1e-9);
    assert.ok(base.tangent.distanceTo(parentLine) < 1e-9, base.tangent.toArray().join());
    const tip = collarSpinePoint(1, length, angle, 0);
    assert.ok(tip.position.distanceTo(new THREE.Vector3(0, length, 0)) < 1e-9);
    assert.ok(tip.tangent.distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-9);
  });

  it('stands the far end square to its own axis, because that end is still its own', () => {
    const radius = 0.02;
    const geometry = buildTubeGeometry(radius, radius, length, quality, 0, undefined, {
      base: { angle, azimuth: 0 },
    });
    const position = geometry.getAttribute('position');
    const cap = new THREE.Vector3();
    let count = 0;
    for (let i = 0; i < position.count; i += 1) {
      if (position.getY(i) > length - 1e-6) {
        cap.add(new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i)));
        count += 1;
      }
    }
    assert.ok(count > 0, 'the collar has no tip at all');
    cap.divideScalar(count);
    assert.ok(cap.distanceTo(new THREE.Vector3(0, length, 0)) < radius * 0.5, cap.toArray().join());
  });

  it('is its own tube, never the tip elbow of the same angle', () => {
    const collar = buildTubeGeometry(0.02, 0.02, length, quality, 0, undefined, {
      base: { angle, azimuth: 0 },
    });
    const twin = buildTubeGeometry(0.02, 0.02, length, quality, 0, undefined, {
      base: { angle, azimuth: 0 },
    });
    const tip = buildTubeGeometry(0.02, 0.02, length, quality, 0, undefined, {
      tip: { angle, azimuth: 0 },
    });
    assert.equal(collar, twin);
    assert.notEqual(collar, tip);
  });
});

describe('the shape cache', () => {
  it('hands the same tube to every caller of one shape', () => {
    const a = buildTubeGeometry(0.01, 0.008, 0.05, quality);
    const b = buildTubeGeometry(0.01, 0.008, 0.05, quality);
    assert.equal(a, b);
    const hullA = buildInkHullGeometry(0.01, 0.008, 0.05, quality);
    const hullB = buildInkHullGeometry(0.01, 0.008, 0.05, quality);
    assert.equal(hullA, hullB);
    // The body and its line are different shapes, not one entry under two names.
    assert.notEqual(a, hullA);
  });

  it('shares across a growth step, so a caller must not dispose it', () => {
    // The key rounds to a millimetre: a segment growing by a tenth of a
    // millimetre reuses the geometry it already had, and so does a twin
    // segment. That is why neither the growth update nor a segment's removal
    // disposes a tube: the cache is the owner, and one shape is one entry.
    const before = buildTubeGeometry(0.01, 0.008, 0.05, quality);
    const after = buildTubeGeometry(0.01, 0.008, 0.0501, quality);
    assert.equal(before, after);
  });

  it('never keeps the shape of a part that is still growing', () => {
    // A growing part asks for a new shape every frame. Caching those filled the
    // table with thousands of entries nothing would ask for again and kept every
    // one of them alive, which is what made growth slow the game down.
    const before = tubeGeometryCacheSize();
    const first = buildLiveTubeGeometry(0.01, 0.008, 0.05, quality);
    const second = buildLiveTubeGeometry(0.01, 0.008, 0.05, quality);
    const firstHull = buildLiveInkHullGeometry(0.01, 0.008, 0.05, quality);
    const secondHull = buildLiveInkHullGeometry(0.01, 0.008, 0.05, quality);
    assert.equal(tubeGeometryCacheSize(), before, 'a live shape was cached');
    // One owner per shape: two frames must not be handed the same buffers,
    // because the frame that built one disposes it.
    assert.notEqual(first, second);
    assert.notEqual(firstHull, secondHull);
    // The live shape is the same silhouette as the shared one, or a part would
    // twitch the moment it finished growing. The shared key is the same shape,
    // so compare the vertex counts and the rings.
    const shared = buildTubeGeometry(0.01, 0.008, 0.05, quality);
    assert.equal(first.getAttribute('position').count, shared.getAttribute('position').count);
    assert.equal(
      firstHull.getAttribute('position').count,
      buildInkHullGeometry(0.01, 0.008, 0.05, quality).getAttribute('position').count,
    );
  });
});
