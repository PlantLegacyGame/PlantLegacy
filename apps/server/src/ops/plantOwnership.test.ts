import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canAdoptGuestPlant, isAnonymousOwner } from './plantOwnership.ts';

describe('plant ownership', () => {
  it('treats ephemeral player ids as anonymous and account ids as not', () => {
    assert.equal(isAnonymousOwner('player_1750000000000_ab12cd'), true);
    assert.equal(isAnonymousOwner('9f1c2c1e-1f0e-4a6b-9f4e-2b1f0f0e9a11'), false);
  });

  it('adopts a guest plant when the token is valid and nobody is tending it', () => {
    assert.equal(
      canAdoptGuestPlant({
        plantOwnerId: 'player_1750000000000_ab12cd',
        tokenValid: true,
        ownerAttached: false,
      }),
      true,
    );
  });

  it('refuses without a valid reconnect token', () => {
    assert.equal(
      canAdoptGuestPlant({
        plantOwnerId: 'player_1750000000000_ab12cd',
        tokenValid: false,
        ownerAttached: false,
      }),
      false,
      'a public plant id must never be enough to take a plant',
    );
  });

  it('refuses while the guest is still connected', () => {
    assert.equal(
      canAdoptGuestPlant({
        plantOwnerId: 'player_1750000000000_ab12cd',
        tokenValid: true,
        ownerAttached: true,
      }),
      false,
      'two players must never share one plant',
    );
  });

  it('never adopts a plant that already belongs to an account', () => {
    assert.equal(
      canAdoptGuestPlant({
        plantOwnerId: '9f1c2c1e-1f0e-4a6b-9f4e-2b1f0f0e9a11',
        tokenValid: true,
        ownerAttached: false,
      }),
      false,
      'another account plant is not adoptable even with a leaked token',
    );
  });
});
