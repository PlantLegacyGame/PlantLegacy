import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { wrappedBetween, wrapToVolume } from './precipitationAnchor.ts';

const SIZE = 40;

describe('world-anchored precipitation', () => {
  it('keeps every copy inside half a volume of the viewer', () => {
    for (let i = 0; i < 500; i += 1) {
      const home = ((i * 7.13) % 90) - 45;
      const centre = ((i * 3.7) % 200) - 100;
      const world = wrapToVolume(home, centre, SIZE);
      assert.ok(Math.abs(world - centre) <= SIZE / 2 + 1e-9, `${world} vs ${centre}`);
    }
  });

  it('does not move a drop when the viewer walks, unless it wraps', () => {
    // The whole point: the eye translates, the rain does not. A drop leaves the
    // volume on one side and enters on the other, and that is the only change.
    const centres = [0, 0.5, 1, 1.25, 3, 7.5, 12, 19.9, 20.1, -6.5];
    const homes = [-19.9, -12.4, -3.3, 0, 4.8, 11.2, 19.4];
    for (const home of homes) {
      const first = wrapToVolume(home, centres[0] as number, SIZE);
      for (const centre of centres.slice(1)) {
        const world = wrapToVolume(home, centre, SIZE);
        const delta = Math.abs(world - first);
        // Either it did not move (to float precision) or it wrapped a whole box.
        assert.ok(delta < 1e-9 || Math.abs(delta - SIZE) < 1e-9, `home ${home} at ${centre}`);
      }
    }
  });

  it('keeps a drop still across a whole half-volume of walking', () => {
    // 19 m of walking out of a 40 m box: nothing about a drop that stays inside
    // the volume changes, so the shower is nailed to the ground, not the camera.
    const home = 4;
    const settled = wrapToVolume(home, 0, SIZE);
    for (let centre = 0; centre <= 19; centre += 0.5) {
      assert.equal(wrapToVolume(home, centre, SIZE), settled, `centre ${centre}`);
    }
  });

  it('wraps a drop to the other side by exactly one volume width', () => {
    const home = 0;
    const before = wrapToVolume(home, 19.5, SIZE); // home is 19.5 behind the centre
    const after = wrapToVolume(home, 20.5, SIZE); // now it is 19.5 ahead
    assert.equal(Math.abs(after - before), SIZE);
  });

  it('reports which drops wrapped so only their ground is re-sampled', () => {
    assert.equal(wrappedBetween(0, 0, 1, SIZE), false);
    assert.equal(wrappedBetween(0, 19.5, 20.5, SIZE), true);
  });

  it('is deterministic and symmetric', () => {
    assert.equal(wrapToVolume(3.25, -8, SIZE), wrapToVolume(3.25, -8, SIZE));
    assert.equal(wrapToVolume(-3.25, 0, SIZE), -3.25);
    assert.equal(wrapToVolume(0, 0, SIZE), 0);
  });

  it('leaves the home alone when there is no usable volume', () => {
    assert.equal(wrapToVolume(5, 100, 0), 5);
    assert.equal(wrapToVolume(5, 100, Number.NaN), 5);
    assert.equal(wrapToVolume(Number.NaN, 0, SIZE), Number.NaN);
  });
});
