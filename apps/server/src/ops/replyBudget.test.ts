import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allowReply, createReplyBudget } from './replyBudget.ts';

describe('allowReply', () => {
  it('allows one reply per interval and refuses inside it', () => {
    const budget = createReplyBudget();
    assert.equal(allowReply(budget, 'grid', 10_000, 5_000), true);
    assert.equal(allowReply(budget, 'grid', 14_999, 5_000), false);
    assert.equal(allowReply(budget, 'grid', 15_000, 5_000), true);
  });

  it('keeps request kinds independent', () => {
    const budget = createReplyBudget();
    assert.equal(allowReply(budget, 'grid', 1_000, 5_000), true);
    assert.equal(allowReply(budget, 'plants', 1_000, 2_000), true);
    assert.equal(allowReply(budget, 'grid', 2_000, 5_000), false);
    assert.equal(allowReply(budget, 'plants', 3_000, 2_000), true);
  });

  it('does not turn a backwards clock into a burst', () => {
    const budget = createReplyBudget();
    assert.equal(allowReply(budget, 'terrain', 10_000, 2_000), true);
    assert.equal(allowReply(budget, 'terrain', 9_000, 2_000), false);
  });

  it('treats a zero interval as no cooldown', () => {
    const budget = createReplyBudget();
    assert.equal(allowReply(budget, 'grid', 0, 0), true);
    assert.equal(allowReply(budget, 'grid', 0, 0), true);
  });
});
