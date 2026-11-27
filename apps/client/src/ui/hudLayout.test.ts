import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { uiScaleForPane } from './uiScale.ts';

/**
 * The overlay is zoomed, and `100vw` is not: a width cap written against the
 * viewport comes out a whole scale too small inside it. These pin the escape
 * hatch (`--pl-hud-vw`) and the arithmetic that made the action bar's buttons
 * hang out of their frame.
 */
const read = (name: string): string => readFileSync(new URL(name, import.meta.url), 'utf8');

const ZOOMED_SOURCES: Record<string, string> = {
  'ActionBar.ts': read('./ActionBar.ts'),
  'ContextHint.ts': read('./ContextHint.ts'),
  'PlantStatusHud.ts': read('./PlantStatusHud.ts'),
};

describe('the width of the zoomed overlay', () => {
  it('is published as its own unit, not the viewport', () => {
    const styles = read('../styles.css');
    assert.match(styles, /--pl-hud-vw:\s*calc\(100vw \/ var\(--pl-ui-scale, 1\)\)/);
  });

  it('is what every width cap inside the overlay measures', () => {
    for (const [name, source] of Object.entries(ZOOMED_SOURCES)) {
      // The rule, not the prose that explains it.
      const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
      const withoutFallback = text.split('var(--pl-hud-vw, 100vw)').join('');
      assert.equal(
        withoutFallback.includes('100vw'),
        false,
        `${name} still caps a width at 100vw, which is a scale too small inside the zoom`,
      );
    }
  });

  it('is wider than the viewport, which is why the old cap overflowed', () => {
    // A 530x652 pane - the dev preview - at the 0.72 floor.
    const scale = uiScaleForPane({ paneW: 530, paneH: 652 });
    assert.equal(scale, 0.72);
    const layoutWidth = 530 / scale;
    assert.ok(Math.abs(layoutWidth - 736.1) < 0.2);
    // The action row measured 542 layout px with every label on it. The old cap
    // (100vw - 2 * corner) allowed 514, so 28 px of buttons hung outside the
    // frame; the pane's real layout width holds it with room to spare.
    assert.ok(530 - 2 * 8 < 542);
    assert.ok(layoutWidth - 2 * 8 > 542);
  });
});
