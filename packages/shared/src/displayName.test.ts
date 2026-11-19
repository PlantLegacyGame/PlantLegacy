import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  hasDisallowedCharacters,
  sanitizeDisplayName,
  validateDisplayName,
} from './displayName.ts';

describe('display names', () => {
  it('accepts a plain name', () => {
    assert.deepEqual(validateDisplayName('Mossy Fern'), { ok: true, value: 'Mossy Fern' });
  });

  it('trims and collapses whitespace instead of rejecting it', () => {
    assert.equal(validateDisplayName('  Dewy   Vine ').value, 'Dewy Vine');
  });

  it('rejects an empty or whitespace-only name', () => {
    assert.equal(validateDisplayName('   ').error, 'empty');
    assert.equal(validateDisplayName('').ok, false);
  });

  it('caps the length at the configured limit', () => {
    const result = validateDisplayName('a'.repeat(40), 32);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'too_long');
    assert.equal(result.value.length, 32);
  });

  it('keeps names in other scripts', () => {
    assert.equal(validateDisplayName('Νεαρό Φυτό').value, 'Νεαρό Φυτό');
    assert.equal(validateDisplayName('小苗').value, '小苗');
  });

  it('drops characters a name may not contain', () => {
    assert.equal(sanitizeDisplayName('Fern<script>'), 'Fernscript');
    assert.equal(sanitizeDisplayName('Dewy\u200BVine'), 'DewyVine');
    assert.equal(hasDisallowedCharacters('Fern<script>'), true);
    assert.equal(hasDisallowedCharacters('Fern'), false);
  });

  it('turns a newline into a single space rather than a second name', () => {
    assert.equal(sanitizeDisplayName('Fern\nVine'), 'Fern Vine');
  });

  it('counts characters, not UTF-16 units, for the limit', () => {
    // A family emoji is multiple code points and is stripped; an accented letter
    // written as one code point must count as one.
    const value = 'é'.repeat(32);
    assert.equal(validateDisplayName(value, 32).ok, true);
  });
});
