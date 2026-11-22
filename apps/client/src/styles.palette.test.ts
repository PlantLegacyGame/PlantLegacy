/**
 * Guards the HUD's half of A01: `styles.css` names palette steps and roles, never
 * a colour value of its own.
 *
 * The palette is the one place a colour lives, so a hex in the stylesheet is a
 * second source that will drift. The same applies to a `var(--palette-*)` that
 * names a step or role the palette does not have: it would silently paint
 * nothing, which is why the names are checked against the real config file here
 * rather than trusted.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const css = read('./styles.css');
const paletteConfig = JSON.parse(read('../../../config/palette.json')) as {
  values: {
    ramps: { value: { name: string; steps: { step: number }[] }[] };
    roles: { value: { name: string }[] };
  };
};
const uiConfig = JSON.parse(read('../../../config/ui.json')) as {
  values: { theme: { value: Record<string, string> } };
};

/** The root block, up to its closing brace: every colour the sheet declares. */
function rootBlock(): string {
  const start = css.indexOf(':root {');
  assert.notEqual(start, -1, 'styles.css has no :root block');
  return css.slice(start, css.indexOf('\n}', start));
}

const paletteNames = new Set<string>([
  ...paletteConfig.values.ramps.value.flatMap((ramp) =>
    ramp.steps.map((step) => `--palette-${ramp.name}-${step.step}`),
  ),
  ...paletteConfig.values.roles.value.map((role) => `--palette-${role.name.replaceAll('_', '-')}`),
]);

const themeNames = new Set(
  Object.keys(uiConfig.values.theme.value).map(
    (token) => `--pl-theme-${token.replaceAll('_', '-')}`,
  ),
);

describe('the HUD stylesheet', () => {
  it('declares no hex colour of its own, in the root block or anywhere else', () => {
    // `%23` is the film-grain data URI's encoded `#`, not a colour.
    const hexes = (css.replaceAll('%23', '').match(/#[0-9a-f]{3,8}\b/gi) ?? []).filter(Boolean);
    assert.deepEqual(hexes, [], `styles.css still carries ${hexes.join(', ')}`);
    assert.ok(
      rootBlock().includes('--palette-foliage-900'),
      'the root block should be palette-led',
    );
  });

  it('defines the HUD tokens once, so a later :root cannot silently win', () => {
    const roots = [...css.matchAll(/:root\s*\{/g)].length;
    const hudBg = [...css.matchAll(/--hud-bg:/g)].length;
    assert.equal(hudBg, 1);
    // Three more :root blocks are the responsive metrics, which set no colours.
    assert.ok(roots <= 4, `expected at most four :root blocks, found ${roots}`);
  });

  it('only names palette steps and roles the palette actually has', () => {
    const named = [...css.matchAll(/var\((--palette-[a-z0-9-]+)/g)].map((match) => match[1]);
    assert.ok(named.length > 20, 'expected the ramps to be palette-backed');
    const unknown = [...new Set(named)].filter((name) => !paletteNames.has(name));
    assert.deepEqual(unknown, [], `unknown palette variables: ${unknown.join(', ')}`);
  });

  it('only names design tokens config/ui.json declares', () => {
    const named = [...css.matchAll(/var\((--pl-theme-[a-z0-9-]+)/g)].map((match) => match[1]);
    assert.ok(named.length > 0, 'expected the HUD to use the design tokens');
    const unknown = [...new Set(named)].filter((name) => !themeNames.has(name));
    assert.deepEqual(unknown, [], `unknown design tokens: ${unknown.join(', ')}`);
  });
});
