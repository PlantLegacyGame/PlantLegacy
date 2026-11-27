import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import {
  AIM_RING_BEHIND_INK,
  AIM_RING_INK,
  aimGauge,
  aimPartVisibility,
  overlayCanvasPlan,
  paintRingOcclusion,
  ringOcclusionFactors,
} from './growthAimGizmo.ts';

const at = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** A drawn tube from `a` to `b` with one radius: what the plant's body is. */
const tube = (
  a: THREE.Vector3,
  b: THREE.Vector3,
  radius = 0.12,
): { from: THREE.Vector3; to: THREE.Vector3; radius: number } => ({
  from: a,
  to: b,
  radius,
});

describe('the aim gizmo ring against the plant', () => {
  const cameraPosition = at(0, 0, 10);
  /** The ring's own vertices: a hoop of radius 1 round the anchor, at z = 0. */
  const hoop = (count = 64): THREE.Vector3[] =>
    Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2;
      return at(Math.cos(angle), Math.sin(angle), 0);
    });
  const factors = (occluders: ReturnType<typeof tube>[], points: THREE.Vector3[] = hoop()) =>
    ringOcclusionFactors({ cameraPosition, points, occluders });
  const marked = (values: Float32Array): number => [...values].filter((value) => value > 0).length;

  it('leaves the whole ring its own ink while nothing is in front of it', () => {
    for (const factor of factors([])) assert.equal(factor, 0);
  });

  it('marks only the arc a tube stands in front of', () => {
    // A thin stem crossing the hoop's left side, between it and the eye.
    const hidden = factors([tube(at(-0.6, 0, 4), at(-0.6, 0.6, 4), 0.12)]);
    assert.ok(marked(hidden) > 0, 'the tube in front hid nothing');
    assert.ok(marked(hidden) < hidden.length / 2, 'the tube painted the whole ring');
  });

  it('never counts a tube behind the ring', () => {
    const behind = factors([tube(at(0, 0, -4), at(0, 1, -4))]);
    assert.equal(marked(behind), 0);
  });

  it('leaves the near side of the hoop alone where the body the ring wraps ends', () => {
    // The host's tube stops at the hoop's centre: it is behind the hoop, not in
    // front of it, so nothing is hidden by the part the ring is drawn round.
    const host = factors([tube(at(0, 0, -3), at(0, 0, 0), 0.12)]);
    assert.equal(marked(host), 0);
  });

  it('hides the far half of a hoop the host body passes through', () => {
    // A hoop narrower than the tube it wraps sits on that tube's far side: the
    // body between the eye and those vertices is exactly what should go orange.
    const wraps = factors([tube(at(0, 0, -2), at(0, 0, 2), 1.5)]);
    assert.ok(marked(wraps) > 0, 'the body round the hoop hid nothing');
  });

  it('has nothing to say about a ring with no vertices', () => {
    assert.equal(factors([tube(at(0, 0, 4), at(0, 0, 5))], []).length, 0);
  });

  it('paints the hidden vertices orange and keeps the rest in ring ink', () => {
    const geometry = new THREE.TorusGeometry(1, 0.02, 4, 8);
    const count = geometry.getAttribute('position').count;
    const marked = new Float32Array(count);
    marked[0] = 1;
    marked[1] = 1;
    paintRingOcclusion(geometry, marked);
    const colors = geometry.getAttribute('color');
    assert.ok(colors, 'the ring has no colours to draw with');
    const hex = (i: number) =>
      new THREE.Color(colors.getX(i), colors.getY(i), colors.getZ(i)).getHex();
    assert.equal(hex(0), AIM_RING_BEHIND_INK);
    assert.equal(hex(1), AIM_RING_BEHIND_INK);
    assert.equal(hex(2), AIM_RING_INK);
    // Painting again reuses the attribute rather than growing a second one.
    paintRingOcclusion(geometry, marked);
    assert.equal(geometry.getAttribute('color'), colors);
  });

  it('keeps the ring, the fill and the ghost while a part covers them', () => {
    const covered = aimPartVisibility({ tipClearOfGround: true, crossesSoil: true });
    // The ring used to disappear here, which took the aim's own shape with it.
    assert.equal(covered.ring, true);
    assert.equal(covered.mouthDisc, true);
    assert.equal(covered.ghost, true);
    assert.equal(covered.bud, true);
    assert.equal(covered.pierce, true);
    assert.equal(covered.tipRing, true);
  });

  it('keeps the aim readable from behind, on the soil as well as in the air', () => {
    const air = aimPartVisibility({ tipClearOfGround: true, crossesSoil: false });
    assert.equal(air.trail, true, 'a shoot in the air has a path on the soil to show');
    assert.equal(air.landing, true);
    assert.equal(air.drop, true, 'a bud in the air has a height above the ground');
    const buried = aimPartVisibility({ tipClearOfGround: false, crossesSoil: true });
    assert.equal(buried.trail, true, 'a buried shoot still has a way to go on the soil');
    assert.equal(buried.landing, true, 'the marker still says where the end is, above the soil');
    assert.equal(buried.drop, true, 'a bud under the soil still hangs off the surface');
  });

  it('sizes a stroke from the eye, with a floor and a ceiling', () => {
    // At arm's length over a seed the gauge is a couple of millimetres: 2 px at
    // 1080p, which is the smallest that still reads as a line.
    assert.ok(aimGauge(2) > 0.008);
    assert.ok(aimGauge(2) < 0.02);
    assert.ok(Math.abs(aimGauge(10) - 0.075) < 1e-9);
    // Twenty metres back still sizes the strokes from the eye rather than leaving
    // a hairline, but a metre-wide hoop stopped being a gauge, so it is capped.
    assert.equal(aimGauge(1000), 0.14);
    assert.equal(aimGauge(0), 0.008);
    assert.equal(aimGauge(Number.NaN), 0.02);
    let previous = 0;
    for (const d of [1, 3, 8, 20, 60]) {
      const gauge = aimGauge(d);
      assert.ok(gauge >= previous, 'the gauge never shrinks as the eye pulls back');
      previous = gauge;
    }
  });

  it('draws each soil hoop only where it has something to say', () => {
    // A sprout leaving the seed upwards: the tip is in the air, nothing crosses.
    const sprout = aimPartVisibility({ tipClearOfGround: true, crossesSoil: false });
    assert.equal(sprout.tipRing, true);
    assert.equal(sprout.pierce, false);
    // A radicle aimed down: it crosses the soil at the seed's base and ends under
    // it. A landing hoop there would be a ring of paint lying on the dirt, metres
    // from the bud it is supposed to ring.
    const radicle = aimPartVisibility({ tipClearOfGround: false, crossesSoil: true });
    assert.equal(radicle.tipRing, false);
    assert.equal(radicle.pierce, true);
    // A branch that ends in the air without dipping: neither hoop applies.
    const level = aimPartVisibility({ tipClearOfGround: false, crossesSoil: false });
    assert.equal(level.tipRing, false);
    assert.equal(level.pierce, false);
  });
});

describe('the aim overlay canvas', () => {
  it('draws at the density of the main renderer, not of the display', () => {
    // The band had stepped the main buffer down to 0.85x its CSS size on a 2x
    // display; the overlay still asked for 2x (G9).
    const plan = overlayCanvasPlan({
      bufferWidth: 692.75,
      cssWidth: 815,
      cssHeight: 656,
      devicePixelRatio: 2,
    });
    assert.ok(Math.abs(plan.pixelRatio - 0.85) < 1e-9, `overlay ratio ${plan.pixelRatio}`);
    assert.equal(plan.width, 815);
    assert.equal(plan.height, 656);
  });

  it('falls back to the display density before the canvas is sized', () => {
    const plan = overlayCanvasPlan({
      bufferWidth: 0,
      cssWidth: 0,
      cssHeight: 0,
      devicePixelRatio: 3,
    });
    assert.equal(plan.pixelRatio, 2);
    assert.ok(plan.width > 0 && plan.height > 0);
  });
});
