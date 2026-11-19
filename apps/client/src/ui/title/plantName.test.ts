import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { autoDisplayName, resolveDisplayName } from './plantName.ts';

const lists = {
  prefixes: ['Mossy', 'Dewy'],
  nouns: ['Fern', 'Vine'],
};

describe('title nickname', () => {
  it('builds a readable name from the configured words and a number', () => {
    // The same random source twice: always the first word, then the last digit.
    const name = autoDisplayName(lists, () => 0);
    assert.equal(name, 'Mossy Fern 10');
    assert.match(name, /^[A-Za-z]+ [A-Za-z]+ \d+$/);
  });

  it('uses every word list entry, not just the first', () => {
    assert.equal(
      autoDisplayName(lists, () => 0.99),
      'Dewy Vine 901',
    );
  });

  it('returns nothing rather than a bare number when no words are configured', () => {
    assert.equal(autoDisplayName({ prefixes: [], nouns: [] }), '');
    assert.equal(autoDisplayName({ prefixes: ['Mossy'], nouns: [] }), 'Mossy');
  });

  it('keeps a typed name and strips what is not allowed', () => {
    const result = resolveDisplayName('  Dewy   <Vine> ', lists, 32);
    assert.equal(result.value, 'Dewy Vine');
    assert.equal(result.generated, false);
    assert.equal(result.ok, true);
  });

  it('generates a name when the box is left empty', () => {
    const result = resolveDisplayName('   ', lists, 32, () => 0);
    assert.equal(result.generated, true);
    assert.equal(result.ok, true);
    assert.equal(result.value, 'Mossy Fern 10');
  });

  it('refuses a typed name longer than the limit instead of silently cutting it', () => {
    const result = resolveDisplayName('a'.repeat(40), lists, 32);
    assert.equal(result.ok, false);
    assert.equal(result.generated, false);
    assert.equal(result.value.length, 32);
  });
});
