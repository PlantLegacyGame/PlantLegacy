import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addBlockedPlayer } from './blockList.ts';

describe('addBlockedPlayer', () => {
  it('adds a new target and treats a repeat as success', () => {
    const blocked = new Set<string>();
    assert.equal(addBlockedPlayer(blocked, 'p2', 2), true);
    assert.equal(addBlockedPlayer(blocked, 'p2', 2), true);
    assert.equal(blocked.size, 1);
  });

  it('refuses a new target at the cap without evicting an existing block', () => {
    const blocked = new Set(['p2', 'p3']);
    assert.equal(addBlockedPlayer(blocked, 'p4', 2), false);
    assert.deepEqual([...blocked], ['p2', 'p3']);
    assert.equal(addBlockedPlayer(blocked, 'p2', 2), true, 'existing ids stay removable');
  });

  it('never becomes unbounded for a zero or broken cap', () => {
    const blocked = new Set<string>();
    assert.equal(addBlockedPlayer(blocked, 'p2', 0), true);
    assert.equal(addBlockedPlayer(blocked, 'p3', 0), false);
    assert.equal(addBlockedPlayer(blocked, 'p4', Number.NaN), false);
  });
});
