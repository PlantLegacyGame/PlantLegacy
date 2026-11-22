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
    // below the silhouette. There is no clip now: the puffs that reach the base are
    // shortened to it, so no ellipse can cross its own viewBox, and at least one
    // does touch it, so a cloud never floats above a strip of empty sky.
    for (const seed of SEEDS) {
      for (const layer of LAYERS) {
        const svg = cloudArt(seed, layer);
        const { height } = viewBoxOf(svg);
        const bottoms: number[] = [];
        for (const match of svg.matchAll(
          /<ellipse cx="([\d.]+)" cy="([\d.]+)" rx="([\d.]+)" ry="([\d.]+)"\/>/g,
        )) {
          const [, cy, , ry] = match.slice(1).map(Number);
          assert.ok(cy + ry <= height + 0.05, 'a puff hangs below the base');
          bottoms.push(Number((cy + ry).toFixed(1)));
        }
        const deepest = Math.max(...bottoms);
        assert.ok(deepest >= height - 0.6, 'the base is drawn below the lowest puff');
      }
    }
  });

  it('has no clip region to blend over the sky', () => {
    // The light rectangle in the sky was the clip path's own box: the browser
    // blended the clip region as one shape, so it showed wherever the cloud was
    // thin. Geometry does the trimming now, and there is no clip left to leak.
    for (const seed of SEEDS) {
      for (const layer of LAYERS) {
        const svg = cloudArt(seed, layer);
        assert.ok(!svg.includes('clipPath'), 'a clip path is still drawn');
        assert.ok(!svg.includes('clip-path'), 'a clip is still applied');
        assert.ok(!svg.includes('mask'), 'a mask came back');
      }
    }
  });

  it('does not end on a ruler edge', () => {
    // The complaint after the first fix: the bottoms were perfectly level. Now the
    // base is the scalloped union of several narrow puffs, with different radii, so
    // the underside rolls instead of ruling.
    for (const seed of SEEDS.filter((s) => s % 3 !== 2)) {
      const svg = cloudArt(seed);
      const { height } = viewBoxOf(svg);
      const touching: number[] = [];
      for (const match of svg.matchAll(
        /<ellipse cx="[\d.]+" cy="([\d.]+)" rx="([\d.]+)" ry="([\d.]+)"\/>/g,
      )) {
        const [cy, rx, ry] = match.slice(1).map(Number);
        if (Math.abs(cy + ry - height) < 0.6) touching.push(rx);
      }
      assert.ok(touching.length >= 3, 'fewer than three puffs form the base');
      assert.ok(new Set(touching.map((r) => r.toFixed(1))).size >= 2, 'the base is one width');
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

  it('has no shading geometry of its own', () => {
    // Two rectangle-shaped bugs came from shading the underside separately: a
    // masked band, then a gradient path with its own straight edges and a top line
    // that crossed thinner parts of the cloud. The underside is the bottom of the
    // body's ramp now, so there is nothing left to leak: no path or rect outside
    // <defs>, one gradient, and it is the body's own.
    for (const seed of SEEDS) {
      for (const layer of LAYERS) {
        const svg = cloudArt(seed, layer);
        const outside = svg.slice(svg.indexOf('</defs>'));
        assert.ok(!outside.includes('<path'), 'a path is drawn outside the clip');
        assert.ok(!outside.includes('<rect'), 'a rect is drawn outside the clip');
        assert.equal((svg.match(/<linearGradient /g) ?? []).length, 1);
        assert.ok(!svg.includes('stop-opacity'), 'no second, translucent ramp');
      }
    }
  });
});
