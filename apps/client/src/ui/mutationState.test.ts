import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cooldownRemainingS, mutationShedControl } from './mutationState.ts';

describe('the mutation shed control', () => {
  it('offers a button that sends the id it validated', () => {
    assert.deepEqual(mutationShedControl('photosynthesis_boost', 0), {
      id: 'photosynthesis_boost',
      disabled: false,
      title: 'Shed it: stop paying its upkeep',
    });
  });

  it('draws nothing for a row with no id to send', () => {
    assert.equal(mutationShedControl(undefined, 0), null);
    assert.equal(mutationShedControl('', 0), null);
    assert.equal(mutationShedControl('   ', 0), null);
  });

  it('holds the button through the server cooldown and says how long', () => {
    const control = mutationShedControl('photosynthesis_boost', 8.2);
    assert.equal(control?.disabled, true);
    assert.equal(control?.title, 'Cooling down 9s');
  });

  it('treats a finished or unusable cooldown as ready', () => {
    assert.equal(mutationShedControl('m', 0)?.disabled, false);
    assert.equal(mutationShedControl('m', -3)?.disabled, false);
    assert.equal(mutationShedControl('m', Number.NaN)?.disabled, false);
  });
});

describe('a cooldown snapshot between packets', () => {
  it('counts down from the moment the state arrived', () => {
    assert.equal(cooldownRemainingS(56, 0), 56);
    assert.equal(cooldownRemainingS(56, 20), 36);
    assert.equal(cooldownRemainingS(56, 55.5), 0.5);
  });

  it('reaches zero instead of going negative, which re-enables the button', () => {
    assert.equal(cooldownRemainingS(56, 56), 0);
    assert.equal(cooldownRemainingS(56, 90), 0);
    assert.equal(mutationShedControl('m', cooldownRemainingS(30, 31))?.disabled, false);
  });

  it('leaves the snapshot alone without a usable clock', () => {
    assert.equal(cooldownRemainingS(30, Number.NaN), 30);
    assert.equal(cooldownRemainingS(30, -5), 30);
    assert.equal(cooldownRemainingS(Number.NaN, 5), 0);
    assert.equal(cooldownRemainingS(-4, 5), 0);
  });
});
