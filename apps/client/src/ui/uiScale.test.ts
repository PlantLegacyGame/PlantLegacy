import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UI_SCALE_MAX, UI_SCALE_MIN, uiScaleForPane } from './uiScale.ts';

describe('interface scale', () => {
  it('leaves a pane that is big enough alone', () => {
    assert.equal(uiScaleForPane({ paneW: 1280, paneH: 800 }), 1);
    assert.equal(uiScaleForPane({ paneW: 1920, paneH: 1080 }), 1);
    assert.equal(uiScaleForPane({ paneW: 1000, paneH: 760 }), 1);
  });

  it('scales a small pane down instead of rearranging it', () => {
    // The measured case: a 531x653 preview pane. It used to take the phone
    // arrangement and cover the world; it now draws the desktop HUD at 0.72.
    const scale = uiScaleForPane({ paneW: 531, paneH: 653 });
    assert.equal(scale, UI_SCALE_MIN);
    // A pane just under the reference scales by the axis that is short.
    assert.equal(uiScaleForPane({ paneW: 900, paneH: 900 }), 0.9);
    assert.ok(Math.abs(uiScaleForPane({ paneW: 1200, paneH: 608 }) - 0.8) < 1e-9);
  });

  it('never goes below the floor, and never above one', () => {
    assert.equal(uiScaleForPane({ paneW: 320, paneH: 240 }), UI_SCALE_MIN);
    assert.equal(uiScaleForPane({ paneW: 4000, paneH: 3000 }), UI_SCALE_MAX);
  });

  it('does not shrink a finger layout', () => {
    // A phone keeps its targets and its sheet: the sheet is the right answer
    // there, and a smaller copy of a desktop HUD is not.
    assert.equal(uiScaleForPane({ paneW: 390, paneH: 844, finePointer: false }), 1);
    assert.equal(uiScaleForPane({ paneW: 531, paneH: 653, finePointer: false }), 1);
  });

  it('says nothing about a pane it cannot measure', () => {
    // Before layout there is no size, and 0 is not "very small": a scale of 0.72
    // written at boot would make the whole HUD invisible for a frame.
    assert.equal(uiScaleForPane({ paneW: 0, paneH: 0 }), 1);
    assert.equal(uiScaleForPane({ paneW: Number.NaN, paneH: 800 }), 1);
    assert.equal(uiScaleForPane({ paneW: -10, paneH: -10 }), 1);
  });
});
