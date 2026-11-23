import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_TAG_SCALE, tagTextPx } from './tagScale.ts';

describe('name-tag scale', () => {
  it('is the authored size at the reference distance', () => {
    assert.equal(
      tagTextPx(DEFAULT_TAG_SCALE.referenceDistanceM),
      DEFAULT_TAG_SCALE.referenceTextPx,
    );
  });

  it('shrinks with distance instead of holding a constant screen size', () => {
    const near = tagTextPx(5);
    const mid = tagTextPx(20);
    const far = tagTextPx(60);
    assert.ok(near > mid, `${near} should be larger than ${mid}`);
    assert.ok(mid > far, `${mid} should be larger than ${far}`);
  });

  it('stays inside the readable bounds at both ends', () => {
    assert.equal(tagTextPx(0.1), DEFAULT_TAG_SCALE.maxTextPx);
    assert.equal(tagTextPx(5000), DEFAULT_TAG_SCALE.minTextPx);
    assert.ok(tagTextPx(90) >= DEFAULT_TAG_SCALE.minTextPx);
    assert.ok(tagTextPx(1) <= DEFAULT_TAG_SCALE.maxTextPx);
  });

  it('treats a missing distance as the reference rather than as infinite', () => {
    assert.equal(tagTextPx(Number.NaN), DEFAULT_TAG_SCALE.referenceTextPx);
    assert.equal(tagTextPx(-5), DEFAULT_TAG_SCALE.maxTextPx);
  });
});
