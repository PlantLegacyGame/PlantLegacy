import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkConfigKeys, codeText } from './check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures');
const check = (name) => checkConfigKeys({ root: path.join(fixtures, name) });
const deadKey = (errors, key) => errors.some((line) => line.includes(`\`${key}\` is read by no`));

/** The CLI is a separate process on purpose: the gate is its exit code. */
const runCli = (name, ...flags) =>
  spawnSync(
    process.execPath,
    [path.join(here, 'check.mjs'), '--root', path.join(fixtures, name), ...flags],
    {
      encoding: 'utf8',
    },
  );

describe('checkConfigKeys', () => {
  it('accepts a tree where every key is read', () => {
    const result = check('clean');
    assert.deepEqual(result.errors, []);
    // A literal after a regex of comment openers still counts, and a property
    // access counts but is reported as identifier-only.
    assert.deepEqual(result.readAsLiteral, ['chat.quoted_key', 'chat.after_regex_key']);
    assert.deepEqual(result.readAsIdentifierOnly, ['chat.identifier_key']);
  });

  it('rejects a key named only in a line or block comment', () => {
    const { errors } = check('broken');
    assert.ok(deadKey(errors, 'comment_key'), 'line comment');
    assert.ok(deadKey(errors, 'regex_key'), 'block comment');
  });

  it('rejects a key that only appears inside a regex body', () => {
    assert.ok(deadKey(check('broken').errors, 'regex_body_key'));
  });

  it('rejects a key that is only a prefix of a longer identifier or string', () => {
    assert.ok(deadKey(check('broken').errors, 'substring_key'));
  });

  it('honours a listed exemption and fails one that matches no key', () => {
    const result = check('broken');
    assert.equal(result.exemptions, 1);
    assert.ok(!deadKey(result.errors, 'exempt_key'));
    assert.match(result.errors.join('\n'), /chat\.ghost_key.*stale exemption/);
  });

  it('ignores a key that only a test file mentions', () => {
    assert.ok(deadKey(check('broken').errors, 'test_only_key'));
  });

  it('does not report a key that is read', () => {
    const { errors } = check('broken');
    assert.ok(!deadKey(errors, 'identifier_key'));
    assert.equal(errors.length, 6);
  });
});

describe('check.mjs CLI', () => {
  it('exits 0 on a tree with no dead keys', () => {
    const run = runCli('clean');
    assert.equal(run.status, 0, run.stdout);
    assert.match(run.stdout, /every declared key is read or allowlisted/);
  });

  it('exits 1 and names the keys on a tree with dead keys', () => {
    const run = runCli('broken');
    assert.equal(run.status, 1, run.stdout);
    assert.match(run.stdout, /`comment_key` is read by no source file/);
    assert.match(run.stdout, /6 problem\(s\)/);
  });

  it('lists identifier-only reads when asked', () => {
    const run = runCli('clean', '--identifiers');
    assert.equal(run.status, 0, run.stdout);
    assert.match(run.stdout, /chat\.identifier_key/);
  });
});

describe('codeText', () => {
  it('blanks comments and regex bodies while keeping literals and identifiers', () => {
    const source = [
      'const quoted = "quoted_key"; // quoted_key in a comment',
      'const pattern = /ghost_key/;',
      'export { quoted, pattern };',
    ].join('\n');
    const text = codeText(source);
    assert.match(text, /"quoted_key"/);
    assert.doesNotMatch(text, /ghost_key/);
    assert.equal(text.split('\n').length, source.split('\n').length);
  });

  it('keeps a division sign, which is not a regex', () => {
    assert.match(codeText('const half = total / 2;'), /total \/ 2/);
  });
});
