/**
 * The clouds are drawn from puffs, and the underside is where that went wrong
 * twice. These tests pin the shape of the fix rather than its pixels: nothing is
 * ever drawn below the base, the base edge is the silhouette's own edge, and the
 * drawing stays inside its viewBox.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cloudArt } from './cloudArt.ts';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const LAYERS = ['bank', 'high'] as const;

const viewBoxOf = (svg: string): { width: number; height: number } => {
  const match = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  assert.ok(match, 'no viewBox');
  return { width: Number(match[1]), height: Number(match[2]) };
};

describe('cloudArt', () => {
  it('is deterministic for a seed', () => {
    for (const seed of SEEDS) {
      assert.equal(cloudArt(seed), cloudArt(seed));
    }
  });

  it('differs between seeds', () => {
    const shapes = new Set(SEEDS.map((seed) => cloudArt(seed)));
    assert.equal(shapes.size, SEEDS.length);
  });

  it('never draws below its own base', () => {
    // The bug was a rounded bar under the puffs putting a straight line five pixels
    // below the silhouette. Now the base is a clip whose trough is the base line:
    // the wave may lift, it may never dip.
    for (const seed of SEEDS) {
      for (const layer of LAYERS) {
        const svg = cloudArt(seed, layer);
        const { width, height } = viewBoxOf(svg);
        const clip = /<clipPath id="[^"]+"><path d="([^"]+)"\/>/.exec(svg);
        assert.ok(clip, 'no clip path');
        const d = clip[1] ?? '';
        assert.ok(d.startsWith(`M0 0 H${width.toFixed(1)}`), `clip does not span the width: ${d}`);
        const waterline = Number(/V([\d.]+)/.exec(d)?.[1]);
        assert.ok(Math.abs(waterline - height) < 0.1, 'clip does not end at the viewBox base');
        for (const match of d.matchAll(/Q([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)/g)) {
          assert.ok(Number(match[2]) <= waterline + 0.01, 'a billow dips below the base');
          assert.ok(Number(match[4]) <= waterline + 0.01, 'the base dips below the waterline');
        }
      }
    }
  });

  it('does not end on a ruler edge', () => {
    // The complaint after the first fix: the bottoms were perfectly level. The
    // underside is a wave now - a bank of puffs with shallow lifts between them.
    // A wisp is the exception: it is a streak whose own puffs are its underside,
    // and its clip sits on the lowest puff so it trims nothing.
    for (const seed of SEEDS.filter((s) => s % 3 !== 2)) {
      const svg = cloudArt(seed);
      const d = /<clipPath id="[^"]+"><path d="([^"]+)"\/>/.exec(svg)?.[1] ?? '';
      assert.ok((d.match(/Q/g) ?? []).length >= 3, `underside is not a wave: ${d}`);
      const lifts = new Set(
        [...d.matchAll(/Q[\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]).toFixed(2)),
      );
      assert.ok(lifts.size >= 2, 'every billow lifts by the same amount');
    }
  });

  it('draws no band, pill or shadow copy outside the silhouette', () => {
    for (const seed of SEEDS) {
      for (const layer of LAYERS) {
        const svg = cloudArt(seed, layer);
        // <rect> is the shape a band is; the only one allowed is the clip rect.
        const outsideDefs = svg.slice(svg.indexOf('</defs>'));
        assert.ok(!outsideDefs.includes('<rect'));
        // A hard offset shadow was the line's other half.
        assert.ok(!outsideDefs.includes('fill="#000"'));
        assert.ok(!svg.includes('feGaussianBlur'));
      }
    }
  });

  it('keeps every puff inside the viewBox', () => {
    for (const seed of SEEDS) {
      for (const layer of LAYERS) {
        const svg = cloudArt(seed, layer);
        const { width } = viewBoxOf(svg);
        const puff = /<ellipse cx="([\d.]+)" cy="([\d.]+)" rx="([\d.]+)" ry="([\d.]+)"\/>/g;
        let count = 0;
        for (const match of svg.matchAll(puff)) {
          const [cx, , rx] = match.slice(1).map(Number);
          assert.ok(cx - rx >= 0, 'puff runs past the left edge');
          assert.ok(cx + rx <= width, 'puff runs past the right edge');
          count += 1;
        }
        assert.ok(count > 0);
      }
    }
  });

  it('shades the whole cloud with one ramp, not one ramp per puff', () => {
    const svg = cloudArt(3);
    assert.ok(svg.includes('gradientUnits="userSpaceOnUse"'));
    assert.equal(svg.match(/url\(#cl\d+b\)/g)?.length, 1);
    assert.equal(svg.match(/<linearGradient /g)?.length, 1);
  });
});
