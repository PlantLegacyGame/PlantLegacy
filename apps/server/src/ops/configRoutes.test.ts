import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { readConfigValues, readFlatConfig } from './configRoutes.ts';

let dir = '';

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pl-config-routes-'));
  await writeFile(
    join(dir, 'ui.json'),
    JSON.stringify({
      _meta: { system: 'ui', version: '0.1.0' },
      values: {
        text_scale: { type: 'number', value: 1.25 },
        layers: { type: 'object', value: { hud: 100 } },
        no_value_key: { type: 'boolean' },
      },
    }),
  );
  await writeFile(join(dir, 'broken.json'), '{ not json');
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('readFlatConfig', () => {
  it('flattens the values map and keeps an entry that has no value field', () => {
    return readFlatConfig(dir, 'ui').then((flat) => {
      assert.deepEqual(flat, {
        text_scale: 1.25,
        layers: { hud: 100 },
        no_value_key: { type: 'boolean' },
      });
    });
  });

  it('returns null for a missing file, a malformed file, or a name that is a path', async () => {
    assert.equal(await readFlatConfig(dir, 'missing'), null);
    assert.equal(await readFlatConfig(dir, 'broken'), null);
    assert.equal(await readFlatConfig(dir, '../ui'), null);
  });
});

describe('readConfigValues', () => {
  it('returns the entries still wrapped, so a route can apply its own defaults', async () => {
    const entries = await readConfigValues(dir, 'ui');
    assert.ok(entries);
    assert.equal(entries.text_scale?.value, 1.25);
    assert.deepEqual(entries.layers?.value, { hud: 100 });
    assert.equal(entries.absent?.value, undefined);
  });

  it('returns null instead of throwing for a missing or malformed file', async () => {
    assert.equal(await readConfigValues(dir, 'missing'), null);
    assert.equal(await readConfigValues(dir, 'broken'), null);
  });

  it('treats a file with no values map as empty rather than missing', async () => {
    await writeFile(join(dir, 'bare.json'), JSON.stringify({ _meta: { system: 'bare' } }));
    assert.deepEqual(await readConfigValues(dir, 'bare'), {});
    assert.deepEqual(await readFlatConfig(dir, 'bare'), {});
  });
});
