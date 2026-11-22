import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyBlock, readPalette, renderBlock, renderSvg } from './build.mjs';
import { oklchToHex } from './oklch.mjs';

const nearChannel = (hex, expected, tolerance = 2) => {
  const actual = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  return actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance);
};

describe('OKLCH to sRGB', () => {
  it('renders black and white', () => {
    assert.equal(oklchToHex({ l: 0, c: 0, h: 0 }).hex, '#000000');
    assert.equal(oklchToHex({ l: 1, c: 0, h: 0 }).hex, '#ffffff');
  });

  it('renders the OKLCH primaries', () => {
    // Ottosson's sRGB red and blue corners, to a couple of 8-bit steps.
    assert.ok(nearChannel(oklchToHex({ l: 0.628, c: 0.2577, h: 29.23 }).hex, [255, 0, 0]));
    assert.ok(nearChannel(oklchToHex({ l: 0.452, c: 0.3132, h: 264.05 }).hex, [0, 0, 255]));
  });

  it('reports a chroma the display cannot show', () => {
    assert.equal(oklchToHex({ l: 0.6, c: 0.4, h: 30 }).outOfGamut, true);
    assert.equal(oklchToHex({ l: 0.6, c: 0.05, h: 30 }).outOfGamut, false);
  });

  it('rejects a step that is not a colour', () => {
    assert.throws(() => oklchToHex({ l: Number.NaN, c: 0, h: 0 }));
    assert.throws(() => oklchToHex({ l: 1.2, c: 0, h: 0 }));
    assert.throws(() => oklchToHex({ l: 0.5, c: -0.1, h: 0 }));
  });
});

describe('the palette config', () => {
  it('loads, and every step is inside sRGB', () => {
    const palette = readPalette();
    assert.ok(palette.ramps.length >= 5, `ramps ${palette.ramps.length}`);
    assert.ok(palette.roles.length >= 10, `roles ${palette.roles.length}`);
  });

  it('gives every role a real step', () => {
    const palette = readPalette();
    for (const role of palette.roles) {
      assert.match(palette.hexOf(role.ramp, role.step), /^#[0-9a-f]{6}$/, role.name);
    }
  });

  it('renders every ramp and role into the block', () => {
    const palette = readPalette();
    const block = renderBlock(palette);
    for (const ramp of palette.ramps) assert.ok(block.includes(`\`${ramp.name}\``), ramp.name);
    for (const role of palette.roles) assert.ok(block.includes(`\`${role.name}\``), role.name);
  });

  it('draws one cell per step in the sheet', () => {
    const palette = readPalette();
    const svg = renderSvg(palette);
    const cells = svg.match(/<rect /g) ?? [];
    assert.equal(cells.length, palette.ramps.length * palette.ladder.length + 1);
    assert.ok(svg.includes('<title id="palette-title">'));
  });

  it('replaces only the marked block', () => {
    const document = `before\n<!-- palette:start -->\nold\n<!-- palette:end -->\nafter\n`;
    const applied = applyBlock(document, 'new');
    assert.equal(applied, 'before\n<!-- palette:start -->\nnew\n<!-- palette:end -->\nafter\n');
    assert.throws(() => applyBlock('no markers here', 'new'));
  });
});
