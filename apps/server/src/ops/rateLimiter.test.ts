import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTokenBucket, tokenBucketAllow } from './rateLimiter.ts';

describe('tokenBucketAllow', () => {
  it('allows a full burst, then refuses until time refills it', () => {
    const bucket = createTokenBucket(3, 0);
    assert.equal(tokenBucketAllow(bucket, 0, 2, 3), true);
    assert.equal(tokenBucketAllow(bucket, 0, 2, 3), true);
    assert.equal(tokenBucketAllow(bucket, 0, 2, 3), true);
    assert.equal(tokenBucketAllow(bucket, 0, 2, 3), false, 'burst is spent');

    // 2/s: half a second restores one token.
    assert.equal(tokenBucketAllow(bucket, 500, 2, 3), true);
    assert.equal(tokenBucketAllow(bucket, 500, 2, 3), false);
  });

  it('refills no further than the burst, however long the idle period', () => {
    const bucket = createTokenBucket(4, 0);
    for (let i = 0; i < 4; i++) tokenBucketAllow(bucket, 0, 10, 4);
    assert.equal(tokenBucketAllow(bucket, 0, 10, 4), false);

    // An hour later: capacity is 4, not 36,000.
    let allowed = 0;
    for (let i = 0; i < 10; i++) {
      if (tokenBucketAllow(bucket, 3_600_000, 10, 4)) allowed += 1;
    }
    assert.equal(allowed, 4);
  });

  it('does not mint tokens when the clock goes backwards', () => {
    const bucket = createTokenBucket(2, 5_000);
    tokenBucketAllow(bucket, 5_000, 1, 2);
    tokenBucketAllow(bucket, 5_000, 1, 2);
    assert.equal(tokenBucketAllow(bucket, 5_000, 1, 2), false);

    // Time running backwards must not refill anything.
    assert.equal(tokenBucketAllow(bucket, 1_000, 1, 2), false);
  });

  it('always allows the first message, even with a zero rate or capacity', () => {
    const zeroRate = createTokenBucket(1, 0);
    assert.equal(tokenBucketAllow(zeroRate, 0, 0, 1), true);
    assert.equal(tokenBucketAllow(zeroRate, 1_000, 0, 1), false);

    const zeroCapacity = createTokenBucket(0, 0);
    assert.equal(tokenBucketAllow(zeroCapacity, 0, 5, 0), true);
  });
});
