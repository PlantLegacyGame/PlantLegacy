import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ownerPresence } from './ownerPresence.ts';

test('a connected owner is awake, and the words say what that means', () => {
  const presence = ownerPresence(true);
  assert.equal(presence.state, 'awake');
  assert.match(presence.text, /^Awake/);
  assert.match(presence.text, /tending their plant/);
});

test('a disconnected owner is asleep, and the plant keeps growing', () => {
  const presence = ownerPresence(false);
  assert.equal(presence.state, 'asleep');
  assert.match(presence.text, /^Asleep/);
  assert.match(presence.text, /grows on its own/);
});

test('an older server that never said is blank, not guessed', () => {
  const presence = ownerPresence(undefined);
  assert.equal(presence.state, 'unknown');
  assert.equal(presence.text, '');
});
