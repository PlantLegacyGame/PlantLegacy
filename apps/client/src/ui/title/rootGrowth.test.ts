import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ROOT_CROWN, rootRunEnd, rootRunFor, rootRuns } from './rootGrowth.ts';
import { TREASURES } from './treasures.ts';

describe('title root runs', () => {
  it('draws one run per find, each with a unique id', () => {
    const runs = rootRuns();
    assert.equal(runs.length, TREASURES.length);
    assert.equal(new Set(runs.map((run) => run.id)).size, runs.length);
  });

  it('starts every run inside the plate root crown', () => {
    // The plate's own roots fan over the first few units under the trunk, and a run
    // leaves from inside that fan rather than from one point on it: eight paths out
    // of the same pixel read as a bundle of ropes tied to the stem.
    for (const run of rootRuns()) {
      const match = /^M (-?[\d.]+) (-?[\d.]+) /.exec(run.d);
      assert.ok(match, `${run.id} has no start point`);
      const x = Number(match[1]);
      const y = Number(match[2]);
      assert.ok(
        Math.abs(x - ROOT_CROWN.x) <= 6,
        `${run.id} leaves the crown sideways at x ${x}: ${run.d}`,
      );
      assert.ok(y >= 0 && y <= 6, `${run.id} leaves the crown at depth ${y}`);
    }
  });

  it('ends every run on the rim of the find it claims, not through it', () => {
    TREASURES.forEach((treasure, index) => {
      const end = rootRunEnd(treasure, index);
      assert.ok(
        Math.abs(end.x - treasure.x) <= treasure.width / 2,
        `${treasure.id} ends off its piece horizontally`,
      );
      assert.ok(end.y >= treasure.y, `${treasure.id} ends above its piece`);
      // A piece is about 21% of the band tall; a tip three units in is on its rim,
      // where eight to twelve put it through the drawing and out the far side.
      assert.ok(end.y <= treasure.y + 5, `${treasure.id} ends inside its piece body`);
      // The run stops a few units short of the piece: what arrives on the find is
      // its grips, not the end of the main root. A main root ending inside a chest
      // reads as a spike through it.
      const run = rootRunFor(treasure, index);
      const tail = /(-?[\d.]+) (-?[\d.]+)$/.exec(run.d.trimEnd());
      assert.ok(tail, `${treasure.id} has no end point`);
      const gap = Math.hypot(Number(tail[1]) - end.x, Number(tail[2]) - end.y);
      assert.ok(gap > 2 && gap < 7, `${treasure.id} stops ${gap} units from its find`);
      assert.ok(run.laterals.length > 0, `${treasure.id} has no grips on its find`);
    });
  });

  it('does not run through a find to reach another', () => {
    // Each run is sampled and held clear of every piece that is not its own: the
    // lanes outside the columns are what this checks. A piece's box is its centre
    // plus half its width, from its top down one piece height.
    const pieceHeight = 21;
    TREASURES.forEach((treasure, index) => {
      const run = rootRunFor(treasure, index);
      const points = run.d
        .split('L')
        .slice(1)
        .map((part) => part.trim().split(/\s+/).map(Number));
      for (const other of TREASURES) {
        if (other.id === treasure.id) continue;
        for (const point of points) {
          const [x, y] = point as [number, number];
          const inside =
            Math.abs(x - other.x) < other.width / 2 - 0.5 &&
            y > other.y + 1 &&
            y < other.y + pieceHeight - 1;
          assert.ok(!inside, `${treasure.id} passes through ${other.id} at ${x},${y}`);
        }
      }
    });
  });

  it('keeps the tips apart so two reaches do not merge into one stub', () => {
    const runs = rootRuns();
    for (let i = 0; i < runs.length; i += 1) {
      for (let j = i + 1; j < runs.length; j += 1) {
        const a = rootRunEnd(TREASURES[i] as (typeof TREASURES)[number], i);
        const b = rootRunEnd(TREASURES[j] as (typeof TREASURES)[number], j);
        assert.ok(
          Math.hypot(a.x - b.x, a.y - b.y) > 3,
          `${runs[i]?.id} and ${runs[j]?.id} end on top of each other`,
        );
      }
    }
  });

  it('draws a rounded tip, not a flat cut', () => {
    for (const run of rootRuns()) {
      assert.match(run.outline, / Q /, `${run.id} has a straight-cut end`);
      // The ink line is a constant hair outside the body, so it is the same shape at
      // a fixed offset and never scales with the root's own width.
      assert.match(run.ink, / Q /, `${run.id} ink has no rounded tip`);
      assert.notEqual(run.ink, run.outline, `${run.id} ink is the body`);
    }
  });

  it('is deterministic, so a find keeps its curve across loads', () => {
    assert.deepEqual(rootRuns(), rootRuns());
  });

  it('does not draw the same curve for two finds', () => {
    const paths = new Set(rootRuns().map((run) => run.d));
    assert.equal(paths.size, TREASURES.length);
  });

  it('gives a find its run in burial order', () => {
    const runs = rootRuns();
    TREASURES.forEach((treasure, index) => {
      assert.equal(runs[index]?.id, treasure.id);
    });
  });
});

describe('branch names', () => {
  it('names each run a letter, and numbers its branches under that letter', () => {
    const runs = rootRuns();
    assert.deepEqual(
      runs.map((run) => run.name),
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
    );
    for (const run of runs) {
      assert.ok(run.branches.length > 0, `${run.id} has no named branches`);
      run.branches.forEach((branch, i) => {
        assert.equal(branch.name, `${run.name}_${i + 1}`);
      });
    }
  });

  it('draws every grip it names, and only those', () => {
    for (const run of rootRuns()) {
      const drawn = (run.laterals.match(/M /g) ?? []).length;
      assert.equal(
        drawn,
        run.branches.length,
        `${run.id} draws ${drawn} of ${run.branches.length}`,
      );
      assert.ok(run.branches.every((branch) => branch.kind === 'grip'));
    }
  });
});

describe('runs keeping off each other', () => {
  // The bottom two finds on each side had a root lying on a root: measured on the
  // centrelines, g and h came within 0.13 units of each other - the same curve twice.
  // The rule now: beyond the plate's own root crown, no two runs on one side come
  // closer than a root's own width.
  const points = (d: string): Array<{ x: number; y: number }> =>
    [...d.matchAll(/[ML] (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
    }));
  const deep = (d: string) => points(d).filter((p) => p.y > 6);

  it('keeps every pair on one side apart below the crown', () => {
    const runs = rootRuns().map((run) => ({ name: run.name, pts: deep(run.d) }));
    for (let i = 0; i < runs.length; i += 1) {
      for (let j = i + 1; j < runs.length; j += 1) {
        const a = runs[i];
        const b = runs[j];
        if (!a || !b) continue;
        if ((a.pts[0]?.x ?? 0) < 50 !== (b.pts[0]?.x ?? 0) < 50) continue;
        let min = Number.POSITIVE_INFINITY;
        for (const p of a.pts) {
          for (const q of b.pts) min = Math.min(min, Math.hypot(p.x - q.x, p.y - q.y));
        }
        assert.ok(min >= 2.5, `${a.name} and ${b.name} pass within ${min.toFixed(2)} units`);
      }
    }
  });

  it('leaves the crown under the soil line, deeper for a deeper find', () => {
    const runs = rootRuns();
    for (const run of runs) {
      const start = points(run.d)[0];
      assert.ok(start, `${run.id} has no start`);
      assert.ok(start.y >= 1.5, `${run.id} leaves the crown at depth ${start.y}`);
    }
    // The deepest row on a side leaves lower than the top row on that side.
    const top = points(runs[0]?.d ?? '').at(0);
    const deeper = points(runs[3]?.d ?? '').at(0);
    assert.ok(
      (deeper?.y ?? 0) > (top?.y ?? 0),
      'a deep find leaves the crown no lower than a shallow one',
    );
  });
});
