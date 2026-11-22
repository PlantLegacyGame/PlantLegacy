import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PaletteConfig } from '../config/clientConfig.js';
import { applyPaletteCssVars, paletteCssVars } from './theme.ts';

const palette: PaletteConfig = {
  ramps: [
    {
      name: 'soil',
      // The palette's own soil steps, so the expected hex is the one the art
      // bible prints for `paper`.
      steps: [
        { step: 100, l: 0.92, c: 0.019, h: 62 },
        { step: 500, l: 0.6, c: 0.075, h: 58 },
        { step: 900, l: 0.25, c: 0.026, h: 54 },
      ],
    },
    { name: 'ink', steps: [{ step: 900, l: 0.25, c: 0.01, h: 70 }] },
  ],
  roles: [
    { name: 'paper', ramp: 'soil', step: 100 },
    { name: 'ui_ground', ramp: 'soil', step: 900 },
  ],
};

const theme = { paper: 'paper', ground: 'ui_ground' };

describe('the palette publisher', () => {
  it('publishes every step as --palette-<ramp>-<step>', () => {
    const vars = paletteCssVars(palette, {});
    assert.equal(vars['--palette-soil-100'], '#eee2d8');
    assert.equal(vars['--palette-soil-500'], '#a27553');
    assert.match(vars['--palette-ink-900'], /^#[0-9a-f]{6}$/);
    assert.deepEqual(Object.keys(vars).sort(), [
      '--palette-ink-900',
      '--palette-paper',
      '--palette-soil-100',
      '--palette-soil-500',
      '--palette-soil-900',
      '--palette-ui-ground',
    ]);
  });

  it('publishes roles under their own dashed names', () => {
    const vars = paletteCssVars(palette, {});
    assert.equal(vars['--palette-paper'], vars['--palette-soil-100']);
    assert.equal(vars['--palette-ui-ground'], vars['--palette-soil-900']);
  });

  it('publishes design tokens with the prefix that keeps them off the ramps', () => {
    const vars = paletteCssVars(palette, theme);
    assert.equal(vars['--pl-theme-paper'], vars['--palette-paper']);
    assert.equal(vars['--pl-theme-ground'], vars['--palette-ui-ground']);
    // The bug this prefix exists for: an unprefixed token named `paper` would
    // have been published over the sheet's own `--paper`-shaped variables.
    assert.equal(vars['--paper'], undefined);
  });

  it('skips a role or token whose step is missing instead of inventing a colour', () => {
    const vars = paletteCssVars(
      { ...palette, roles: [{ name: 'ghost', ramp: 'soil', step: 700 }] },
      { missing: 'ghost' },
    );
    assert.deepEqual(Object.keys(vars), [
      '--palette-soil-100',
      '--palette-soil-500',
      '--palette-soil-900',
      '--palette-ink-900',
    ]);
  });

  it('publishes nothing from an empty palette, so the sheet keeps nothing stale', () => {
    assert.deepEqual(paletteCssVars({ ramps: [], roles: [] }, theme), {});
    assert.deepEqual(paletteCssVars({ ramps: [], roles: [] }, undefined), {});
  });

  it('writes the properties onto the root it is given', () => {
    const written: Record<string, string> = {};
    const root = {
      style: {
        setProperty: (name: string, value: string) => {
          written[name] = value;
        },
      },
    } as unknown as HTMLElement;
    const vars = applyPaletteCssVars(palette, theme, root);
    assert.equal(written['--pl-theme-paper'], '#eee2d8');
    assert.deepEqual(written, vars);
  });
});
