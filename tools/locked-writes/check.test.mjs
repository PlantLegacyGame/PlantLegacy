import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkLockedWrites, findDirectWrites } from './check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('findDirectWrites', () => {
  it('flags a purse or pouch assignment, including its compound form', () => {
    const writes = findDirectWrites(
      [
        'player.spores = 10;',
        'player.spores += 3;',
        'inventory.slots[2] = { itemId: "seed", count: 1 };',
        'player.inventory.slots = next;',
        'slots[0] = null;',
      ].join('\n'),
    );
    assert.deepEqual(
      writes.map((write) => write.line),
      [1, 2, 3, 4, 5],
    );
  });

  it('does not flag reads, comparisons or a mention in prose', () => {
    const writes = findDirectWrites(
      [
        'if (player.spores === 0) return;',
        'const balance = player.spores;',
        'const next = player.spores == null ? 0 : player.spores;',
        '// a dead helper once did player.spores = 0 here',
        'const copy = "player.spores = 1";',
        'const pattern = /player\\.spores = 0/;',
      ].join('\n'),
    );
    assert.deepEqual(writes, []);
  });

  it('names the file and line so a finding can be found', () => {
    const [write] = findDirectWrites('\n\nplayer.spores = 1;', 'apps/server/src/ops/new.ts');
    assert.equal(write.file, 'apps/server/src/ops/new.ts');
    assert.equal(write.line, 3);
  });
});

describe('checkLockedWrites', () => {
  it('passes the real server tree, with the allowlisted files still writing', () => {
    const result = checkLockedWrites();
    assert.deepEqual(result.errors, []);
    assert.ok(result.writes.length > 0, 'the scan should find the live adoption writes');
    assert.ok(result.files > 60, 'the scan should cover the server source');
  });

  it('rejects a direct write in a file nobody listed', () => {
    const result = checkLockedWrites({
      files: new Map([
        ['apps/server/src/main.ts', 'player.spores = state.spores;'],
        ['apps/server/src/ops/newHelper.ts', 'player.spores = 99;'],
      ]),
    });
    assert.match(result.errors.join('\n'), /ops\/newHelper\.ts:1: player\.spores = 99/);
    assert.match(result.errors.join('\n'), /PlayerStateStore\.mutate/);
  });

  it('rejects an allowlist entry that no longer matches anything', () => {
    const result = checkLockedWrites({
      files: new Map([['apps/server/src/main.ts', 'player.spores = 1;']]),
      allowed: new Map([
        ['apps/server/src/main.ts', 'adoption'],
        ['apps/server/src/ops/ghost.ts', 'gone'],
      ]),
    });
    assert.match(result.errors.join('\n'), /ghost\.ts.*stale entry/);
  });
});

describe('check.mjs CLI', () => {
  it('exits 0 and reports the scanned writes', () => {
    const run = spawnSync(process.execPath, [path.join(here, 'check.mjs')], {
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /every direct pouch or purse write is in an allowlisted file/);
  });
});
