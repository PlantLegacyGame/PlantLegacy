import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_BEND_DEG } from './plantReaction.ts';
import {
  creakForce,
  MAX_SLIP_HZ,
  STATIC_FORCE,
  slipAmplitude,
  slipDecaySeconds,
  slipRateHz,
} from './plantSound.ts';

/**
 * The creak model is arithmetic, so it can be pinned: a stem that is held still
 * must be silent, a faster pull must creak faster (the slip rate is the pitch),
 * and the event envelope must stay inside the model's square-root pair.
 */
describe('plant creak model', () => {
  it('is silent below the static threshold, however far the stem is bent', () => {
    assert.equal(slipRateHz(0), 0);
    assert.equal(slipRateHz(STATIC_FORCE), 0);
    assert.equal(slipRateHz(STATIC_FORCE - 0.01), 0);
    // A deep bend at rest: depth alone reaches the threshold and no further.
    assert.ok(creakForce(0, MAX_BEND_DEG) <= STATIC_FORCE);
    assert.equal(slipRateHz(creakForce(0, MAX_BEND_DEG)), 0);
  });

  it('creaks faster the faster the stem is pulled', () => {
    const slow = slipRateHz(creakForce(40, 0));
    const medium = slipRateHz(creakForce(160, 0));
    const fast = slipRateHz(creakForce(900, 0));
    assert.ok(slow > 0);
    assert.ok(medium > slow);
    assert.ok(fast > medium);
    // A pull well past the full-force speed is the ceiling, not beyond it.
    assert.equal(slipRateHz(1), MAX_SLIP_HZ);
  });

  it('grows with force and stays inside 0..1', () => {
    assert.equal(creakForce(Number.NaN, Number.NaN), 0);
    assert.equal(
      creakForce(-500, -MAX_BEND_DEG),
      creakForce(500, MAX_BEND_DEG),
      'a pull is a pull in either direction',
    );
    assert.ok(creakForce(110, MAX_BEND_DEG) > 0.3);
    assert.ok(creakForce(5000, MAX_BEND_DEG * 10) <= 1);
    assert.equal(creakForce(5000, MAX_BEND_DEG * 10), 1);
  });

  it('makes each slip louder and longer as the built-up force rises', () => {
    assert.equal(slipAmplitude(0), 0);
    assert.equal(slipAmplitude(1), 1);
    const quiet = slipAmplitude(0.2);
    const loud = slipAmplitude(0.8);
    assert.ok(loud > quiet);
    // Square roots, not squares: the model's dynamic range shaping.
    assert.ok(Math.abs(quiet - Math.sqrt(0.2)) < 1e-9);
    assert.ok(slipDecaySeconds(0) >= 0.003);
    assert.ok(slipDecaySeconds(0.2) < slipDecaySeconds(1));
    assert.ok(slipDecaySeconds(1) <= 0.014);
  });
});
