import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type PlayerVerticalState,
  playerWorldY,
  spawnPlayer,
  stepPlayerVertical,
} from './playerPhysics.ts';

const GRAVITY = 9.81;

function simulate(
  start: PlayerVerticalState,
  seconds: number,
  gravity = GRAVITY,
): PlayerVerticalState {
  let state = start;
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    state = stepPlayerVertical(state, dt, gravity);
  }
  return state;
}

describe('player vertical physics', () => {
  it('spawns in the air and falls', () => {
    const start = spawnPlayer(3.5);
    assert.equal(start.altitude, 3.5);
    assert.equal(start.grounded, false);

    const afterOneFrame = stepPlayerVertical(start, 1 / 60, GRAVITY);
    assert.ok(afterOneFrame.altitude < 3.5, 'player did not start falling');
    assert.ok(afterOneFrame.velocity < 0, 'velocity should point down');
  });

  it('follows the free-fall distance while airborne', () => {
    const t = 0.3;
    const state = simulate(spawnPlayer(10), t);
    const expected = 10 - 0.5 * GRAVITY * t * t;
    assert.ok(
      Math.abs(state.altitude - expected) < 0.05,
      `altitude ${state.altitude} vs ${expected}`,
    );
  });

  it('lands exactly on the ground and stays there', () => {
    const landed = simulate(spawnPlayer(3.5), 3);
    assert.equal(landed.altitude, 0);
    assert.equal(landed.velocity, 0);
    assert.equal(landed.grounded, true);

    // A grounded player does not drift or accumulate fall speed.
    const later = simulate(landed, 1);
    assert.deepEqual(later, landed);
  });

  it('never reports a negative altitude, even with a huge timestep', () => {
    // A long frame is clamped rather than integrated in one leap, so the player
    // cannot tunnel through the ground and come out underneath it.
    const once = stepPlayerVertical(spawnPlayer(3.5), 5, GRAVITY);
    assert.ok(once.altitude > 0 && once.altitude <= 3.5, `altitude ${once.altitude}`);
    assert.equal(once.grounded, false);

    const landed = simulate(spawnPlayer(3.5), 5);
    assert.equal(landed.altitude, 0);
    assert.equal(landed.grounded, true);
  });

  it('ignores bad input rather than producing NaN', () => {
    const spawned = spawnPlayer(Number.NaN);
    assert.equal(spawned.altitude, 0);

    const state = stepPlayerVertical(spawned, 1 / 60, Number.NaN);
    assert.ok(Number.isFinite(state.altitude));
    assert.equal(state.altitude, 0);
    assert.equal(state.grounded, true);
  });

  it('places the feet on the ground height plus the altitude', () => {
    assert.equal(playerWorldY(-1.2, spawnPlayer(0)), -1.2);
    assert.equal(playerWorldY(-1.2, spawnPlayer(2)), 0.8);
  });
});
