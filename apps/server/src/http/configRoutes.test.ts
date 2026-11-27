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
    join(dir, 'terrain_volume.json'),
    JSON.stringify({ values: { enabled: { value: true }, centre_x_m: { value: 21 } } }),
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

  it('serves the volume region the client builds terrain from', async () => {
    // The route list is hand-maintained, so a system the client fetches has to
    // be named here or it silently runs on compiled-in defaults.
    const result = await handleConfigRequest(req('/config/terrain_volume'), dir);
    assert.equal(result?.status, 200);
    assert.deepEqual(result?.body, { enabled: true, centre_x_m: 21 });
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

  it('answers nothing for a path it does not serve or a file that is missing', async () => {
    assert.equal(await handleConfigRequest(req('/config/not_a_system'), dir), null);
    assert.equal(await handleConfigRequest(req('/config/'), dir), null);
    // A named system with no file is a 404 too, not `{}`: an empty body would
    // read like a config whose every key had been removed.
    assert.equal(await handleConfigRequest(req('/config/daynight'), join(dir, 'empty')), null);
    assert.equal(await handleConfigRequest(req('/health'), dir), null);
  });

  it('fails closed when the onboarding file cannot be read', async () => {
    // INV-CFG-02: a broken onboarding.json used to answer 200 with a third
    // copy of the text, so the game silently ran different onboarding.
    const result = await handleConfigRequest(req('/config/onboarding'), join(dir, 'empty'));
    assert.equal(result?.status, 500);
    assert.deepEqual(result?.body, { error: 'config_unreadable', config: 'onboarding' });
  });

  it('serves a system no route names, so a new config file cannot 404', async () => {
    // The route used to be a hand-maintained list: a file the client fetched but
    // nobody added answered 404 and the client ran on compiled-in defaults.
    await writeFile(
      join(dir, 'unlisted_system.json'),
      JSON.stringify({ values: { answer: { value: 42 } } }),
    );
    const result = await handleConfigRequest(req('/config/unlisted_system'), dir);
    assert.equal(result?.status, 200);
    assert.deepEqual(result?.body, { answer: 42 });
  });
});
