import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildRoots,
  HAIR_INSET,
  hairPath,
  ROOT_GRID,
  rootDepth,
  rootsContent,
  rootsMarkup,
  sampleSpine,
  spineOutline,
  truncateSpine,
} from './roots.ts';

/** Distance from a point to a spine, found by sampling it; good enough at 200 units. */
function distanceToSpine(
  spine: ReturnType<typeof buildRoots>[number],
  x: number,
  y: number,
): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= 200; i += 1) {
    const s = sampleSpine(spine, i / 200);
    best = Math.min(best, Math.hypot(s.x - x, s.y - y));
  }
  return best;
}

const SPINES = buildRoots();

describe('title roots', () => {
  it('is deterministic, so the plate is the same on every boot', () => {
    assert.deepEqual(buildRoots(), SPINES);
  });

  it('starts every fork inside the lateral it divides from', () => {
    for (const spine of SPINES) {
      if (spine.gen !== 2) continue;
      const [x, y] = spine.p;
      const host = SPINES.filter((other) => other !== spine).find(
        (other) => distanceToSpine(other, x, y) <= sampleSpine(other, 0.5).half + 2,
      );
      assert.ok(host, `fork ${spine.id} starts in open dirt at (${x}, ${y})`);
    }
    // The six base roots are the plate's connection to the stem: they start in
    // the collar, not on another root.
    for (const spine of SPINES) {
      if (spine.gen !== 1) continue;
      assert.ok(Math.abs(spine.p[0] - 100) < 2.5, `${spine.id} does not leave the collar`);
      assert.ok(spine.p[1] <= 14, `${spine.id} starts too far below the soil line`);
    }
  });

  it('hides the start of every fork inside its parent', () => {
    for (const spine of SPINES) {
      if (spine.gen !== 2) continue;
      // A feeder's parent is the lateral it forks from.
      const parentId = spine.id.replace(/^fork/, 'lateral').slice(0, -1);
      const parent = SPINES.find((other) => other.id === parentId);
      assert.ok(parent, `no parent for ${spine.id}`);
      // Where it leaves, and how wide the parent is there. A root wider than its
      // parent at the junction has its blunt start in the open, which is what read
      // as a root that had been sliced off.
      const start = sampleSpine(spine, 0);
      let nearest = 0;
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i <= 200; i += 1) {
        const s = sampleSpine(parent, i / 200);
        const distance = Math.hypot(s.x - start.x, s.y - start.y);
        if (distance < best) {
          best = distance;
          nearest = i / 200;
        }
      }
      const parentWidth = sampleSpine(parent, nearest).half * 2;
      assert.ok(
        spine.w <= parentWidth + 0.05,
        `${spine.id} is ${spine.w.toFixed(2)} wide where its parent is ${parentWidth.toFixed(2)}`,
      );
    }
  });

  it('joins the stem at the stem', () => {
    const bases = SPINES.filter((root) => root.gen === 1);
    assert.equal(bases.length, 6, 'three laterals leave each side of the collar');
    // The plate starts *under the trunk*: the stem is 11 wide and the trunk's
    // filled flare is 44 at the line, so the crown of base roots belongs between
    // the two. The old single crown root was 24 wide; six overlapping bases now
    // make the same collar without one vertical trunk under the tree.
    let width = 0;
    for (const base of bases) {
      const start = sampleSpine(base, 0);
      width += start.half * 2;
      assert.ok(start.y <= 14, 'a base root has to leave near the soil line');
      assert.ok(Math.abs(start.x - 100) < 2.5, 'a base root has to leave at the trunk');
    }
    assert.ok(width > 11, 'the plate starts as a collar, not as a stem');
    assert.ok(width < 88, 'the collar cannot be wider than the trunk flare doubled');
  });

  it('reaches across the cut, and is not a mirror image', () => {
    let farLeft = 100;
    let farRight = 100;
    for (const spine of SPINES) {
      for (let i = 0; i <= 30; i += 1) {
        const s = sampleSpine(spine, i / 30);
        farLeft = Math.min(farLeft, s.x);
        farRight = Math.max(farRight, s.x);
      }
    }
    // The widest root owns the reach; the plate covers most of the grid's width.
    assert.ok(farRight - farLeft > ROOT_GRID.width * 0.6, 'the plate is a bundle, not a fan');
    // A plate of matched pairs is a bouquet: that symmetry is what read as a
    // tangle, so the two sides must not reach the same distance.
    assert.ok(Math.abs(farRight - 100 - (100 - farLeft)) > 3, 'the plate is mirrored');
  });

  it('tapers from the junction to a point', () => {
    for (const spine of SPINES) {
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
    for (const spine of SPINES) {
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

  it('keeps every root inside the grid, including the skew of an angled cap', () => {
    for (const spine of SPINES) {
      for (let i = 0; i <= 40; i += 1) {
        const s = sampleSpine(spine, i / 40);
        for (const side of [1, -1]) {
          const x = s.x + s.nx * s.half * side;
          const y = s.y + s.ny * s.half * side;
          assert.ok(x > 0 && x < ROOT_GRID.width, `${spine.id} leaves the sides`);
          assert.ok(y < ROOT_GRID.height, `${spine.id} runs past the bottom`);
          assert.ok(y >= -0.02, `${spine.id} pokes above the soil line at y=${y.toFixed(2)}`);
        }
      }
    }
  });

  it('hangs hairs out of a flank, never beside one', () => {
    assert.ok(HAIR_INSET < 1, 'a hair that starts outside its root is a floating tick');
    for (const spine of SPINES) {
      const path = hairPath(spine, 0.5, 1, 4);
      assert.ok(path.startsWith('M'));
      const s = sampleSpine(spine, 0.5);
      const start = /^M([\d.-]+) ([\d.-]+)/.exec(path);
      assert.ok(start);
      const [x, y] = [Number(start[1]), Number(start[2])];
      // The start is within the root's own half-width of its centre line.
      assert.ok(Math.hypot(x - s.x, y - s.y) < s.half);
    }
  });

  it('draws no ground shadow: nothing blurred, offset or cast', () => {
    const markup = rootsMarkup();
    assert.ok(!markup.includes('<ellipse'), 'a blurred ellipse is a ground-plane shadow');
    assert.ok(!markup.includes('filter'), 'no blur belongs in a flat cutout');
    assert.ok(!markup.includes('drop-shadow'));
  });

  it('outlines each spine with a closed shape', () => {
    for (const spine of SPINES) {
      const d = spineOutline(spine);
      assert.ok(d.startsWith('M'), 'outline must start with a move');
      assert.ok(d.endsWith('Z'), 'outline must close');
      assert.ok(d.split(' ').length > 40, 'outline must be sampled, not a stub');
    }
  });

  it('grows along its own curves: truncation keeps the shape and shortens it', () => {
    const spine = SPINES[0];
    assert.ok(spine);
    const cut = truncateSpine(spine, 0.5);
    const mid = sampleSpine(spine, 0.5);
    // The cut starts where the root starts and ends on the same curve.
    assert.ok(Math.abs(cut.p[0] - spine.p[0]) < 1e-9);
    assert.ok(Math.abs(cut.p[1] - spine.p[1]) < 1e-9);
    assert.ok(Math.abs(cut.p[6] - mid.x) < 1e-6 && Math.abs(cut.p[7] - mid.y) < 1e-6);
    // A full truncation is the root itself: no second curve, no drift.
    assert.deepEqual(truncateSpine(spine, 1), spine);
  });

  it('makes a root collar at the trunk, not a central taproot', () => {
    // The old plate had one 24-unit taproot diving down the middle. A mature
    // tree's support is a ring of structural roots leaving the collar, and that
    // centre root read as a triangular tooth under the trunk at every age.
    assert.equal(
      SPINES.find((spine) => spine.id === 'taproot'),
      undefined,
      'a central taproot is not part of the plate',
    );
    const bases = SPINES.filter((spine) => spine.gen === 1);
    assert.equal(bases.length, 6);
    // No base root runs down the centre: each one leaves sideways, and the
    // deepest point of the plate belongs to the laterals, not to a collar spine.
    for (const base of bases) {
      assert.ok(Math.abs(base.p[6] - 100) > 15, `${base.id} runs down the centre`);
    }
    const lowest = Math.max(...SPINES.map((spine) => sampleSpine(spine, 1).y));
    for (const base of bases) {
      assert.ok(sampleSpine(base, 1).y < lowest, `${base.id} is a central spine, not a base root`);
    }
  });

  it('grows with the shoot it hangs from', () => {
    // Growth is a fraction of the plant's own care scale, and it has to be the same
    // kind of fraction: the plate used to move 0.85 to 1 - eighteen percent - while
    // the shoot above it grew by sixty, so the same plant aged into a tree above the
    // soil and stayed a seedling below it.
    assert.equal(rootDepth(0), 0.74);
    assert.ok(rootDepth(2) > rootDepth(0));
    assert.ok(rootDepth(60) > rootDepth(2));
    // A little past 1 at full care is the root crown thickening around an old
    // trunk, which is what a root plate does.
    assert.ok(rootDepth(999) <= 1.05, 'the plate cannot outgrow its drawing');
    assert.ok(rootDepth(999) > 1.02);
    assert.equal(rootDepth(Number.NaN), 0.74);
    // The plate itself does not change with care: it is one drawing, scaled.
    assert.deepEqual(buildRoots(), SPINES);
  });

  it('wraps its content in one svg', () => {
    assert.ok(rootsMarkup().startsWith('<svg'));
    assert.ok(rootsMarkup().endsWith('</svg>'));
    assert.ok(rootsMarkup().includes(rootsContent()));
  });
});
