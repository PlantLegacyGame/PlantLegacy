import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  HAIR_INSET,
  hairPath,
  ROOT_HAIRS,
  ROOT_SPINES,
  rootsMarkup,
  sampleSpine,
  spineOutline,
} from './roots.ts';

/** Distance from a point to a spine, found by sampling it; good enough at 200 units. */
function distanceToSpine(spine: (typeof ROOT_SPINES)[number], x: number, y: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= 200; i += 1) {
    const s = sampleSpine(spine, i / 200);
    best = Math.min(best, Math.hypot(s.x - x, s.y - y));
  }
  return best;
}

describe('title roots', () => {
  it('starts every root inside another one, so nothing is a detached stick', () => {
    const taproot = ROOT_SPINES.find((root) => root.id === 'taproot');
    assert.ok(taproot);
    for (const spine of ROOT_SPINES) {
      if (spine === taproot) continue;
      const [x, y] = spine.p;
      const host = ROOT_SPINES.filter((other) => other !== spine).find(
        (other) => distanceToSpine(other, x, y) <= sampleSpine(other, 0.5).half + 2,
      );
      assert.ok(host, `root ${spine.id} starts in open dirt at (${x}, ${y})`);
    }
  });

  it('joins the stem at the stem', () => {
    const taproot = ROOT_SPINES.find((root) => root.id === 'taproot');
    assert.ok(taproot);
    const start = sampleSpine(taproot, 0);
    // The shoot's stem is 11 wide and its box bottom is the soil line: the roots
    // start at exactly that width, on that line, or the joint shows a step.
    assert.equal(start.half * 2, 11);
    assert.equal(start.y, 0);
  });

  it('tapers from the junction to a point', () => {
    for (const spine of ROOT_SPINES) {
      const start = sampleSpine(spine, 0).half;
      const end = sampleSpine(spine, 1).half;
      assert.ok(end < start / 3, `${spine.id} barely tapers (${start} to ${end})`);
      let previous = Number.POSITIVE_INFINITY;
      for (let i = 0; i <= 20; i += 1) {
        const half = sampleSpine(spine, i / 20).half;
        assert.ok(half <= previous + 1e-9, `${spine.id} widens at t=${i / 20}`);
        previous = half;
      }
    }
  });

  it('sags away from its own chord, so no root is a beam', () => {
    for (const spine of ROOT_SPINES) {
      const [x0, y0, , , , , x3, y3] = spine.p;
      const mid = sampleSpine(spine, 0.5);
      const sag = Math.hypot(mid.x - (x0 + x3) / 2, mid.y - (y0 + y3) / 2);
      // Proportional to length: a stub is allowed a small bow, a long root is not.
      const chord = Math.hypot(x3 - x0, y3 - y0);
      assert.ok(
        sag > Math.max(0.5, chord * 0.04),
        `${spine.id} is within ${sag.toFixed(2)} units of straight`,
      );
    }
  });

  it('keeps every root inside the viewBox, including the skew of an angled cap', () => {
    for (const spine of ROOT_SPINES) {
      for (let i = 0; i <= 40; i += 1) {
        const s = sampleSpine(spine, i / 40);
        const ax = s.x + s.nx * s.half;
        const ay = s.y + s.ny * s.half;
        const bx = s.x - s.nx * s.half;
        const by = s.y - s.ny * s.half;
        for (const [x, y] of [
          [ax, ay],
          [bx, by],
        ]) {
          assert.ok(x > 0 && x < 200, `${spine.id} leaves the sides`);
          assert.ok(y < 58, `${spine.id} runs past the bottom`);
          assert.ok(y >= -0.02, `${spine.id} pokes above the soil line at y=${y.toFixed(2)}`);
        }
      }
    }
  });

  it('attaches every hair to a root and starts it inside that root', () => {
    for (const hair of ROOT_HAIRS) {
      const spine = ROOT_SPINES.find((root) => root.id === hair.root);
      assert.ok(spine, `hair on unknown root ${hair.root}`);
      // The start is HAIR_INSET of the half-width from the centre line: inside.
      assert.ok(sampleSpine(spine, hair.t).half > 0);
      assert.ok(HAIR_INSET < 1, 'a hair that starts outside its root is a floating tick');
      assert.ok(Math.abs(hair.side) === 1);
      assert.ok(hairPath(hair).startsWith('M'));
    }
  });

  it('draws no ground shadow: nothing blurred, offset or cast', () => {
    const markup = rootsMarkup();
    assert.ok(!markup.includes('<ellipse'), 'a blurred ellipse is a ground-plane shadow');
    assert.ok(!markup.includes('filter'), 'no blur belongs in a flat cutout');
    assert.ok(!markup.includes('drop-shadow'));
  });

  it('is deterministic, so the shot is the same on every boot', () => {
    assert.equal(rootsMarkup(), rootsMarkup());
  });

  it('outlines each spine with a closed shape', () => {
    for (const spine of ROOT_SPINES) {
      const d = spineOutline(spine);
      assert.ok(d.startsWith('M'), 'outline must start with a move');
      assert.ok(d.endsWith('Z'), 'outline must close');
      assert.ok(d.split(' ').length > 40, 'outline must be sampled, not a stub');
    }
  });
});
