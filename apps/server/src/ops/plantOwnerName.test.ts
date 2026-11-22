import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { plantOwnerName } from './plantOwnerName.ts';

const players = new Map([
  ['p_named', { displayName: 'Fern Test' }],
  ['p_blank', { displayName: '   ' }],
  ['p_empty', { displayName: '' }],
  ['p_absent', {}],
]);

describe('the owner name a plant payload carries', () => {
  it("is the connected owner's display name, so the tag is readable", () => {
    assert.equal(plantOwnerName(players, 'p_named'), 'Fern Test');
  });

  it('is trim()ed, because the wire should not carry padding', () => {
    assert.equal(plantOwnerName(new Map([['p', { displayName: '  Moss  ' }]]), 'p'), 'Moss');
  });

  it('is absent for an owner who is not connected, so the client falls back to the id', () => {
    // An offline plant's row has no player behind it. Sending a placeholder
    // would be worse than sending nothing: the tag would claim a name.
    assert.equal(plantOwnerName(players, 'p_offline'), undefined);
  });

  it('is absent for a blank or missing display name', () => {
    assert.equal(plantOwnerName(players, 'p_blank'), undefined);
    assert.equal(plantOwnerName(players, 'p_empty'), undefined);
    assert.equal(plantOwnerName(players, 'p_absent'), undefined);
  });
});
