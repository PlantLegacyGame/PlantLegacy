/**
 * What the client reads is what the routes serve.
 *
 * E19: `clientConfig.ts` read `render.root_aura_radius` after that key had moved
 * to `root_sight.aura_radius`, so the loader silently kept its compiled 3.0 and a
 * tuner editing the file changed nothing. `config:keys` guards one direction (a
 * declared key must be named in code); this guards the other (a key the client
 * reads must be served).
 *
 * The routes are the contract, not the files: `plant_renderer` composes names its
 * file does not have (`root_max_depth`, the plan-wide renderer limits) and
 * `growth` computes per-node step lengths, so the handler is asked rather than
 * the JSON parsed.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { handleConfigRequest } from './configRoutes.ts';

const CONFIG_DIR = fileURLToPath(new URL('../../../../config/', import.meta.url));
const CLIENT_CONFIG_DIR = new URL('../../../client/src/config/', import.meta.url);

/** `data.<snake_case>` — two or more words, so camelCase fields are not reads. */
const DATA_READ = /\bdata\.([a-z][a-z0-9]*(?:_[a-z0-9]+)+)/g;
/** `readValue(payload, '<snake_case>', …)` — the loaders that use a helper. */
const HELPER_READ =
  /\b(?:readValue|readNumber|readInteger|readBoolean|readString)\(\s*\w+\s*,\s*'([a-z][a-z0-9]*(?:_[a-z0-9]+)+)'/g;
const CONFIG_PATH = /\/config\/([a-z][a-z0-9_]*)/g;

function allMatches(source: string, pattern: RegExp): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(new RegExp(pattern.source, 'g'))) found.push(match[1]);
  return found;
}

const SOURCES = new Map<string, string>();
for (const file of readdirSync(CLIENT_CONFIG_DIR)) {
  if (file.endsWith('.ts') && !file.endsWith('.test.ts')) {
    SOURCES.set(file, readFileSync(new URL(file, CLIENT_CONFIG_DIR), 'utf8'));
  }
}

function collectKeys(node: unknown, keys: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  for (const [key, child] of Object.entries(node)) {
    keys.add(key);
    collectKeys(child, keys);
  }
}

async function servedKeys(): Promise<Set<string>> {
  const systems = new Set<string>();
  for (const source of SOURCES.values()) {
    for (const system of allMatches(source, CONFIG_PATH)) systems.add(system);
  }
  const keys = new Set<string>();
  for (const system of systems) {
    const answer = await handleConfigRequest(
      new URL(`http://127.0.0.1:8080/config/${system}`),
      CONFIG_DIR,
    );
    // A system the client loads but no route answers is itself a defect: the
    // loader would fall back to its defaults on every boot.
    assert.ok(answer, `the client loads /config/${system}, which no route serves`);
    if (answer.status === 200) collectKeys(answer.body, keys);
  }
  return keys;
}

describe('a client config loader', () => {
  it('reads only keys a /config route serves', async () => {
    const served = await servedKeys();
    const reads = new Map<string, Set<string>>();
    for (const [file, source] of SOURCES) {
      for (const key of [...allMatches(source, DATA_READ), ...allMatches(source, HELPER_READ)]) {
        const from = reads.get(key) ?? new Set<string>();
        from.add(file);
        reads.set(key, from);
      }
    }

    // Guard the guard: a scan that stopped matching would pass by finding nothing.
    assert.ok(served.size > 300, `the routes only served ${served.size} keys`);
    assert.ok(reads.size > 200, `only ${reads.size} reads were found — check the scan`);

    const missing = [...reads]
      .filter(([key]) => !served.has(key))
      .map(([key, files]) => `${key} (${[...files].sort().join(', ')})`)
      .sort();
    assert.deepEqual(missing, []);
  });

  it('would have caught E19', () => {
    assert.deepEqual(allMatches('aura: data.root_aura_radius ?? 3,', DATA_READ), [
      'root_aura_radius',
    ]);
    assert.deepEqual(allMatches("readValue(payload, 'aura_radius', 3)", HELPER_READ), [
      'aura_radius',
    ]);
  });
});
