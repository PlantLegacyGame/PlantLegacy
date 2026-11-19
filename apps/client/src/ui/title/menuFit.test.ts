import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  horizonForPane,
  MENU_FIT_MIN_SCALE,
  MENU_FOOT_RESERVE_PX,
  MENU_MIN_TOP_PX,
  mascotMaxWidthPx,
  menuFit,
  PLANT_ART_ASPECT,
} from './menuFit.ts';

const scaleOf = (input: Parameters<typeof menuFit>[0]): number => menuFit(input).scale;

/**
 * These numbers are the panes the defect was measured in. The column is about
 * 460px tall in a wide pane and starts at 448px (54% of 800 + the soil band), so
 * a tall pane fits it and a short one does not.
 */
describe('title menu fit', () => {
  it('leaves a menu that fits at full size', () => {
    assert.equal(scaleOf({ viewportPx: 800, topPx: 448, naturalPx: 260 }), 1);
    // Never enlarges: a column that fits is not stretched to fill the screen.
    assert.equal(scaleOf({ viewportPx: 2000, topPx: 1080, naturalPx: 260 }), 1);
  });

  it('shrinks the column until its foot is inside the pane', () => {
    // 1200x300: the measured failure. Top 162, foot reserve 64, so 74px of room
    // for a 183px column. The floor wins here (0.40 would be unreadable), so the
    // promise that holds is the one that matters: the foot stays inside the pane.
    const scale = scaleOf({ viewportPx: 300, topPx: 162, naturalPx: 183 });
    assert.ok(scale < 1);
    assert.equal(scale, MENU_FIT_MIN_SCALE);
    assert.ok(162 + 183 * scale <= 300, 'the column must not run off the bottom');
    // Where the floor does not bind, the foot reserve is honoured too.
    const eased = scaleOf({ viewportPx: 360, topPx: 162, naturalPx: 183 });
    assert.ok(162 + 183 * eased <= 360 - MENU_FOOT_RESERVE_PX + 0.001);
    // 900x420 as measured: Settings and Shop sat 18px below the pane.
    const short = scaleOf({ viewportPx: 420, topPx: 236, naturalPx: 202 });
    assert.ok(236 + 202 * short <= 420 - MENU_FOOT_RESERVE_PX + 0.001);
  });

  it('stops at the floor instead of collapsing to nothing', () => {
    assert.equal(scaleOf({ viewportPx: 100, topPx: 90, naturalPx: 400 }), MENU_FIT_MIN_SCALE);
    assert.equal(scaleOf({ viewportPx: 100, topPx: 90, naturalPx: 400, minScale: 0.4 }), 0.4);
  });

  it('answers when a measurement is missing rather than guessing', () => {
    // Before layout there is no height to fit, and a scale invented from nothing
    // would hide the menu on the first frame.
    assert.equal(scaleOf({ viewportPx: 800, topPx: 400, naturalPx: 0 }), 1);
    assert.equal(scaleOf({ viewportPx: 0, topPx: 0, naturalPx: 300 }), 1);
    assert.equal(
      scaleOf({
        viewportPx: Number.NaN,
        topPx: Number.NaN,
        naturalPx: Number.NaN,
      }),
      1,
    );
  });

  it('lifts what the floor cannot scale away', () => {
    // 1200x300 measured: at the floor the column's foot was still 25px below the
    // bottom of the pane, and Shop was unreachable. The remainder comes out of the
    // top offset, so the column moves up over the plant rather than off the screen.
    const fit = menuFit({ viewportPx: 300, topPx: 162, naturalPx: 224 });
    assert.equal(fit.scale, MENU_FIT_MIN_SCALE);
    assert.ok(fit.liftPx < 0, 'a column that still overflows has to be lifted');
    assert.ok(162 + 224 * fit.scale + fit.liftPx <= 300 - MENU_FOOT_RESERVE_PX + 0.001);
    // It never lifts past the top of the pane, even when the pane cannot hold it.
    const tiny = menuFit({ viewportPx: 240, topPx: 148, naturalPx: 185 });
    assert.ok(148 + tiny.liftPx >= MENU_MIN_TOP_PX - 0.001);
    // And a pane with room is never lifted.
    assert.equal(menuFit({ viewportPx: 800, topPx: 448, naturalPx: 260 }).liftPx, 0);
  });

  it('keeps the guest line and the key hint out of the column', () => {
    // The reserve is the point: a column that fills the pane exactly would sit on
    // top of the two lines of small text at the foot.
    const full = scaleOf({ viewportPx: 800, topPx: 448, naturalPx: 288 });
    assert.ok(448 + 288 * full <= 800 - MENU_FOOT_RESERVE_PX);
  });
});

describe('ground line', () => {
  it('stays where the config puts it while the pane is tall', () => {
    // 800 tall, a 217px plant, 96px of ground: the configured 54% line already
    // leaves the plant room, so it is used as given.
    assert.equal(horizonForPane({ viewportPx: 800, fraction: 0.54, plantPx: 217 }), 432);
  });

  it('drops the line only as far as the plant needs', () => {
    // 300 tall: the configured 54% line (162) already leaves room for a 108px
    // plant, so it is untouched. A plant that is taller than that pushes the line
    // down - which is the 1200x300 case that had the art above the top of the pane.
    assert.equal(horizonForPane({ viewportPx: 300, fraction: 0.54, plantPx: 108 }), 162);
    const tall = horizonForPane({ viewportPx: 300, fraction: 0.54, plantPx: 183 });
    assert.equal(tall, 193);
    assert.ok(300 - tall >= 96, 'the ground band must survive');
  });

  it('keeps the ground band when the pane cannot hold both', () => {
    // A 240px pane cannot give a 200px plant plus ground. The line stops at the
    // ceiling: the top of the art is what gives way, never the menu.
    const line = horizonForPane({ viewportPx: 240, fraction: 0.54, plantPx: 200 });
    assert.equal(line, 240 - 96);
  });

  it('answers before layout instead of placing the line at zero', () => {
    assert.equal(horizonForPane({ viewportPx: 0, fraction: 0.54, plantPx: 100 }), 0);
    assert.equal(horizonForPane({ viewportPx: 600, fraction: Number.NaN, plantPx: 0 }), 324);
    // A nonsense fraction is clamped, and the ground band still wins.
    assert.equal(horizonForPane({ viewportPx: 600, fraction: 3, plantPx: 0 }), 504);
  });

  it('shrinks the mascot to the band above the line', () => {
    // 240 tall with 96 of ground: 144px of art height, so 128px wide.
    const width = mascotMaxWidthPx(240, 96);
    assert.ok(Math.abs(width * PLANT_ART_ASPECT - 144) < 0.001);
    // Never below the floor, and no pane means no opinion beyond the floor.
    assert.equal(mascotMaxWidthPx(120, 96), 84);
    assert.equal(mascotMaxWidthPx(0, 96), 84);
  });
});
