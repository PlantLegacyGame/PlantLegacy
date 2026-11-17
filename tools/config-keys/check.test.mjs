import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkConfigKeys, codeText } from './check.mjs';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const check = (name) => checkConfigKeys({ root: path.join(fixtures, name) });

describe('checkConfigKeys', () => {
  it('accepts a key quoted as a string literal', () => {
    const result = check('literal');
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.readAsLiteral, ['chat.probe_key']);
    assert.deepEqual(result.readAsIdentifierOnly, []);
  });

  it('rejects a key named only in a line or block comment', () => {
    const result = check('comment-only');
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /`probe_key` is read by no source file/);
  });

  it('rejects a key that only appears inside a regex body', () => {
    const result = check('regex-body');
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /`probe_key` is read by no source file/);
  });

  it('does not let a regex of comment openers swallow the rest of the file', () => {
    // `/[/*]/` is a regex, not the start of a comment: the literal after it must
    // still count as a read.
    const result = check('regex-guard');
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.readAsLiteral, ['chat.probe_key']);
  });

  it('rejects a key that is only a prefix of a longer identifier or string', () => {
    const result = check('substring');
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /`probe_key` is read by no source file/);
  });

  it('accepts an identifier-only read but reports it separately', () => {
    const result = check('identifier-only');
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.readAsLiteral, []);
    assert.deepEqual(result.readAsIdentifierOnly, ['chat.probe_key']);
  });

  it('fails an allowlist entry that matches no key', () => {
    const result = check('stale-allowlist');
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /chat\.ghost_key.*stale exemption/);
    // The valid exemption is honoured rather than reported as dead.
    assert.equal(result.exemptions, 1);
  });
});

describe('codeText', () => {
  it('blanks comments and regex bodies while keeping literals and identifiers', () => {
    const source = [
      'const quoted = "probe_key"; // probe_key in a comment',
      'const pattern = /probe_ghost/;',
      'export { quoted, pattern };',
    ].join('\n');
    const text = codeText(source);
    assert.match(text, /"probe_key"/);
    assert.doesNotMatch(text, /probe_ghost/);
    assert.equal(text.split('\n').length, source.split('\n').length);
  });

  it('keeps a division sign, which is not a regex', () => {
    const text = codeText('const half = total / 2;');
    assert.match(text, /total \/ 2/);
  });
});
