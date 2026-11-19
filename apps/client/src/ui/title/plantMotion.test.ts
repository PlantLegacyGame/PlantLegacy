import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  advanceSway,
  createPlantMotion,
  reactionProgress,
  reactionScale,
  reactToTouch,
  swayOffset,
} from './plantMotion.ts';

describe('title plant motion', () => {
  it('wraps the sway phase instead of growing forever', () => {
    const state = createPlantMotion();
    advanceSway(state, 2600, 5200);
    assert.ok(Math.abs(state.phase - 0.5) < 1e-9);
    advanceSway(state, 5200, 5200);
    assert.ok(Math.abs(state.phase - 0.5) < 1e-9);
  });

  it('sways symmetrically around rest', () => {
    const state = createPlantMotion();
    assert.equal(swayOffset(state), 0);
    state.phase = 0.25;
    assert.ok(Math.abs(swayOffset(state) - 1) < 1e-9);
    state.phase = 0.75;
    assert.ok(Math.abs(swayOffset(state) + 1) < 1e-9);
  });

  it('reacts to a touch and then refuses a second one during its cooldown', () => {
    const state = createPlantMotion();
    const first = reactToTouch(state, 1000, 700, 600);
    assert.equal(first.reacted, true);
    assert.equal(first.state.reactCount, 1);

    const second = reactToTouch(first.state, 1100, 700, 600);
    assert.equal(second.reacted, false);
    assert.equal(second.state.reactCount, 1);
  });

  it('allows another reaction once the cooldown has passed', () => {
    const first = reactToTouch(createPlantMotion(), 1000, 700, 600);
    const later = reactToTouch(first.state, 1800, 700, 600);
    assert.equal(later.reacted, true);
    assert.equal(later.state.reactCount, 2);
  });

  it('fades the reaction out without exceeding its peak', () => {
    const state = reactToTouch(createPlantMotion(), 0, 700, 700).state;
    assert.equal(reactionProgress(state, 0, 700), 1);
    assert.equal(reactionProgress(state, 700, 700), 0);
    const peak = reactionScale(state, 0, 700);
    assert.ok(peak >= 1 && peak <= 1.06, `peak out of range: ${peak}`);
    assert.equal(reactionScale(state, 900, 700), 1);
  });
});
