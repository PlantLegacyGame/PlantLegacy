import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type ChatLimits, consumeChatBudget, resolveChatIntent } from './chatService.ts';

const limits: ChatLimits = { messageMaxChars: 200, emoteIds: ['wave', 'nod'] };
const tightLimits: ChatLimits = { messageMaxChars: 10, emoteIds: ['wave'] };

describe('resolveChatIntent', () => {
  it('trims and clips the message to the configured length', () => {
    const intent = resolveChatIntent({ message: '  hello there world  ' }, tightLimits);
    assert.deepEqual(intent, { mode: 'world', text: 'hello ther' });
  });

  it('clips before it looks for an emote, so a clipped command is plain text', () => {
    assert.equal(resolveChatIntent({ message: '/emote wave' }, tightLimits)?.emoteId, undefined);
    assert.equal(resolveChatIntent({ message: '/emote wave' }, limits)?.emoteId, 'wave');
  });

  it('keeps the proximity mode and defaults everything else to world', () => {
    assert.equal(
      resolveChatIntent({ message: 'hi', mode: 'proximity' }, limits)?.mode,
      'proximity',
    );
    assert.equal(resolveChatIntent({ message: 'hi', mode: 'shout' }, limits)?.mode, 'world');
    assert.equal(resolveChatIntent({ message: 'hi' }, limits)?.mode, 'world');
  });

  it('has nothing to send for a missing or blank message', () => {
    assert.equal(resolveChatIntent({}, limits), null);
    assert.equal(resolveChatIntent({ message: '' }, limits), null);
    assert.equal(resolveChatIntent({ message: '   ' }, limits), null);
  });

  it('reads /emote case-insensitively when the id is configured', () => {
    assert.deepEqual(resolveChatIntent({ message: '/emote WAVE' }, limits), {
      mode: 'world',
      text: '/emote WAVE',
      emoteId: 'wave',
    });
  });

  it('leaves an unconfigured or malformed emote as ordinary text', () => {
    assert.equal(resolveChatIntent({ message: '/emote shrug' }, limits)?.emoteId, undefined);
    assert.equal(resolveChatIntent({ message: '/emote' }, limits)?.emoteId, undefined);
  });
});

describe('consumeChatBudget', () => {
  it('allows messages up to the limit and refuses the one after it', () => {
    const now = 1_000_000;
    let state = consumeChatBudget([], now, 2);
    assert.equal(state.allowed, true);
    state = consumeChatBudget(state.timestamps, now + 1, 2);
    assert.equal(state.allowed, true);
    state = consumeChatBudget(state.timestamps, now + 2, 2);
    assert.equal(state.allowed, false);
    assert.equal(state.timestamps.length, 2);
  });

  it('forgets timestamps older than the one-minute window, even when refusing', () => {
    const now = 5_000_000;
    const stale = [now - 90_000, now - 61_000];
    const refused = consumeChatBudget([...stale, now - 1_000, now - 500], now, 2);
    assert.equal(refused.allowed, false);
    assert.deepEqual(refused.timestamps, [now - 1_000, now - 500]);

    const fresh = consumeChatBudget(stale, now, 2);
    assert.equal(fresh.allowed, true);
    assert.deepEqual(fresh.timestamps, [now]);
  });
});
