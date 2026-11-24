import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  captureHalfExtent,
  HEAD_CAPTURE_MARGIN,
  HEAD_CAPTURE_THRESHOLD,
  headCaptureNotice,
  measureSilhouette,
  metresPerPixel,
} from './headCapture.ts';

/** A frame of `width` x `height` with one lit rectangle drawn into it. */
function frameWithRect(
  width: number,
  height: number,
  rect: { x: number; y: number; w: number; h: number },
): number[] {
  const luma = new Array<number>(width * height).fill(0);
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) luma[y * width + x] = 255;
  }
  return luma;
}

describe('framing a head capture', () => {
  it('takes the larger half-size and leaves the margin around it', () => {
    assert.equal(captureHalfExtent(0.01, 0.03), 0.03 * HEAD_CAPTURE_MARGIN);
    assert.equal(captureHalfExtent(0.04, 0.01, 2), 0.08);
  });

  it('refuses a frame with no head in it', () => {
    assert.throws(() => captureHalfExtent(0, 0), /needs a drawn head/);
    assert.throws(() => captureHalfExtent(0.02, Number.NaN), /needs a drawn head/);
  });

  it('refuses a margin that would clip the head', () => {
    assert.throws(() => captureHalfExtent(0.02, 0.02, 0.9), /room to fit/);
  });

  it('reports metres per pixel from the frame it shares', () => {
    assert.equal(metresPerPixel(0.05, 500), 0.0002);
    assert.throws(() => metresPerPixel(0), /half-extent/);
    assert.throws(() => metresPerPixel(0.05, 0), /frame size/);
  });
});

describe('saying which head a capture measured', () => {
  it('stays quiet when the head was planted', () => {
    assert.equal(headCaptureNotice('planted', 'spore_sac'), null);
  });

  it('says so when the fallback specimen stood in for a planted head', () => {
    // The fallback is how a number describing the specimen once reached the doc
    // as if it described the plant, so it cannot be silent.
    const notice = headCaptureNotice('specimen', 'spore_sac');
    assert.ok(notice, 'a specimen capture must say so');
    assert.match(notice, /specimen/);
    assert.match(notice, /spore_sac/);
    assert.match(notice, /not a planted head/);
  });
});

describe('measuring a head silhouette', () => {
  it('reads the box off a lit rectangle and nothing else', () => {
    const extents = measureSilhouette(frameWithRect(20, 10, { x: 3, y: 2, w: 5, h: 4 }), 20, 10);
    assert.deepEqual(extents, { left: 3, top: 2, width: 5, height: 4, pixels: 20 });
  });

  it('calls an empty frame a failed capture, not a head of no size', () => {
    assert.equal(measureSilhouette(new Array<number>(20 * 10).fill(0), 20, 10), null);
  });

  it('ignores anything under the threshold', () => {
    const luma = new Array<number>(4 * 4).fill(0);
    luma[0] = HEAD_CAPTURE_THRESHOLD - 1;
    luma[5] = HEAD_CAPTURE_THRESHOLD;
    assert.deepEqual(measureSilhouette(luma, 4, 4), {
      left: 1,
      top: 1,
      width: 1,
      height: 1,
      pixels: 1,
    });
  });

  it('refuses a buffer that is not the frame it claims', () => {
    assert.throws(() => measureSilhouette([255], 4, 4), /not 4x4/);
  });

  it('measures a narrow tall silhouette and a wide short one differently', () => {
    // The two shapes the growth rule asks for: a bud standing up, and the head
    // it opens into. Same frame, so the boxes are comparable.
    const bud = measureSilhouette(
      frameWithRect(100, 100, { x: 45, y: 20, w: 10, h: 60 }),
      100,
      100,
    );
    const open = measureSilhouette(
      frameWithRect(100, 100, { x: 30, y: 45, w: 40, h: 15 }),
      100,
      100,
    );
    assert.ok(bud && open);
    assert.ok(bud.height > bud.width * 4, `bud ${bud.width}x${bud.height}`);
    assert.ok(open.width > open.height * 2, `open ${open.width}x${open.height}`);
  });
});
