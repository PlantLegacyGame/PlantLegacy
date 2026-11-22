import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { handleConfigRequest } from './configRoutes.ts';

let dir = '';

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pl-http-config-'));
  await writeFile(
    join(dir, 'daynight.json'),
    JSON.stringify({ values: { day_length_s: { value: 600 }, season_length_days: { value: 4 } } }),
  );
  await writeFile(
    join(dir, 'palette.json'),
    JSON.stringify({
      values: {
        ramps: { value: [{ name: 'soil', steps: [{ step: 500, l: 0.6, c: 0.07, h: 58 }] }] },
        roles: { value: [{ name: 'accent_soil', ramp: 'soil', step: 500 }] },
      },
    }),
  );
  await writeFile(
    join(dir, 'ui.json'),
    JSON.stringify({
      values: {
        text_scale: { value: 1.25 },
        layers: { value: { hud: 100 } },
        essence: { value: { hud: 50 } },
      },
    }),
  );
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

const req = (path: string) => new URL(`http://127.0.0.1${path}`);

describe('handleConfigRequest', () => {
  it('serves a flat system as the client expects it', async () => {
    const result = await handleConfigRequest(req('/config/daynight'), dir);
    assert.equal(result?.status, 200);
    assert.deepEqual(result?.body, { day_length_s: 600, season_length_days: 4 });
  });

  it('serves the palette the UI tokens resolve against', async () => {
    const result = await handleConfigRequest(req('/config/palette'), dir);
    assert.equal(result?.status, 200);
    const body = result?.body as { ramps: { name: string }[]; roles: { name: string }[] };
    assert.equal(body.ramps[0]?.name, 'soil');
    assert.equal(body.roles[0]?.name, 'accent_soil');
  });

  it('serves a shaped system with its config values merged over the defaults', async () => {
    const result = await handleConfigRequest(req('/config/ui'), dir);
    const body = result?.body as {
      text_scale: number;
      layers: Record<string, number>;
      essence: { hud: number };
    };
    // The explicit fields win, and every other entry in the file rides along.
    assert.equal(body.text_scale, 1.25);
    assert.deepEqual(body.layers, { hud: 100 });
    assert.deepEqual(body.essence, { hud: 50 });
  });

  it('answers nothing for a path it does not serve, so the caller can 404', async () => {
    assert.equal(await handleConfigRequest(req('/config/not_a_system'), dir), null);
    assert.equal(await handleConfigRequest(req('/config/'), dir), null);
    assert.equal(await handleConfigRequest(req('/health'), dir), null);
  });

  it('falls back to the route default when a system file is missing', async () => {
    const result = await handleConfigRequest(req('/config/daynight'), join(dir, 'empty'));
    assert.equal(result?.status, 200);
    assert.deepEqual(result?.body, {});
  });
});
