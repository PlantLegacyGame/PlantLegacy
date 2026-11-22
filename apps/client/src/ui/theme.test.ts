import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type PaletteConfig, resolveTheme, roleHexes } from './theme.ts';

const palette: PaletteConfig = {
  ramps: [
    {
      name: 'soil',
      steps: [
        // The palette's own soil steps, so the expected hex is the one the art
        // bible prints for `paper`.
        { step: 100, l: 0.92, c: 0.019, h: 62 },
        { step: 500, l: 0.6, c: 0.075, h: 58 },
        { step: 900, l: 0.25, c: 0.026, h: 54 },
      ],
    },
    { name: 'ink', steps: [{ step: 900, l: 0.25, c: 0.01, h: 70 }] },
  ],
  roles: [
    { name: 'paper', ramp: 'soil', step: 100 },
    { name: 'accent_life', ramp: 'soil', step: 500 },
    { name: 'ui_ground', ramp: 'soil', step: 900 },
  ],
};

describe('the palette resolver', () => {
  it('resolves a role to the hex of the step it names', () => {
    const roles = roleHexes(palette);
    assert.equal(roles.paper, '#eee2d8');
    assert.match(roles.accent_life, /^#[0-9a-f]{6}$/);
    assert.match(roles.ui_ground, /^#[0-9a-f]{6}$/);
  });

  it('reaches the right step when two ramps share a step number', () => {
    const roles = roleHexes({
      ...palette,
      roles: [...palette.roles, { name: 'ink_deep', ramp: 'ink', step: 900 }],
    });
    assert.notEqual(roles.ink_deep, roles.ui_ground);
  });

  it('skips a role whose step is missing instead of inventing a colour', () => {
    assert.deepEqual(
      roleHexes({ ...palette, roles: [{ name: 'ghost', ramp: 'soil', step: 700 }] }),
      {},
    );
  });

  it('resolves every theme token, keyed by the token the shell publishes', () => {
    const theme = resolveTheme({ loam_900: 'ui_ground', bone_100: 'paper' }, palette);
    assert.deepEqual(Object.keys(theme).sort(), ['bone_100', 'loam_900']);
    assert.equal(theme.bone_100, '#eee2d8');
    assert.equal(theme.loam_900, roleHexes(palette).ui_ground);
  });

  it('leaves a token out when its role does not resolve, so the CSS fallback wins', () => {
    assert.deepEqual(resolveTheme({ sky_400: 'accent_sky' }, palette), {});
    assert.deepEqual(resolveTheme({}, palette), {});
    assert.deepEqual(resolveTheme(undefined, palette), {});
  });

  it('resolves against nothing into nothing rather than throwing', () => {
    assert.deepEqual(resolveTheme({ bone_100: 'paper' }, { ramps: [], roles: [] }), {});
  });
});
