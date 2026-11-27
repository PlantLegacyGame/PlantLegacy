#!/usr/bin/env node
/**
 * Documentation guardrail.
 *
 * Checks the five things that silently rot in this repo:
 *   1. every relative markdown link resolves;
 *   2. the config count/population quoted in docs/tunables.md matches config/;
 *   3. docs/protocol.md lists exactly the message types in MESSAGE_TYPE;
 *   4. the same long prose line does not live in two documents;
 *   5. a task record's quoted config default equals `values[key].value`;
 *   6. any prose table's Default and Range cells agree with that key in config/.
 *
 * Exit 1 on any failure. Warnings never fail the run.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const warnings = [];

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    // Scratch directories hold working notes and screenshots, not documentation.
    // A temporary .md written there during a sweep was walked and failed the link
    // check on its own relative links, which is a false alarm about a file that
    // is about to be deleted.
    if (entry.isDirectory() && (entry.name === '.tmp' || entry.name === '.tmp-dev')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
};

const docs = walk(root);
const rel = (p) => path.relative(root, p).replaceAll('\\', '/');

// 1 — links
let links = 0;
for (const doc of docs) {
  const text = fs.readFileSync(doc, 'utf8');
  for (const match of text.matchAll(/\]\(([^)\s]+\.md)(#[^)]*)?\)/g)) {
    const target = match[1];
    if (/^[a-z]+:/i.test(target)) continue;
    links++;
    if (!fs.existsSync(path.resolve(path.dirname(doc), target))) {
      errors.push(`broken link: ${rel(doc)} -> ${target}`);
    }
  }
}

// 2 — config counts
const configFiles = fs.readdirSync(path.join(root, 'config')).filter((f) => f.endsWith('.json'));
const configValues = new Map(); // system -> values
let populated = 0;
for (const file of configFiles) {
  const json = JSON.parse(fs.readFileSync(path.join(root, 'config', file), 'utf8'));
  configValues.set(file.replace(/\.json$/, ''), json.values ?? {});
  if (json.values && Object.keys(json.values).length > 0) populated++;
}
const tunables = fs.readFileSync(path.join(root, 'docs', 'tunables.md'), 'utf8');
const claimed = tunables.match(/Total: \*\*(\d+) files\*\*; (\d+) populated and (\d+) stubs/);
if (!claimed) errors.push('docs/tunables.md: count line not found');
else {
  const [files, pop, stubs] = claimed.slice(1).map(Number);
  if (files !== configFiles.length)
    errors.push(`tunables says ${files} files, config/ has ${configFiles.length}`);
  if (pop !== populated) errors.push(`tunables says ${pop} populated, config/ has ${populated}`);
  if (stubs !== configFiles.length - populated)
    errors.push(`tunables says ${stubs} stubs, config/ has ${configFiles.length - populated}`);
  const rows = (tunables.match(/^\| `[a-z_]+` \|/gm) ?? []).length;
  if (rows !== configFiles.length)
    errors.push(`tunables index has ${rows} file rows, config/ has ${configFiles.length}`);
}
// 2a — the index row itself: owner, status and value count must match `_meta`
// and `values`. `render` said 136 entries against 137, and `ui` 35 against 36,
// which no total can see because both files were already populated.
for (const line of tunables.split(/\r?\n/)) {
  const row = line.match(/^\| `([a-z0-9_]+)` \| ([^|]+) \| ([^|]+) \| (\d+) \|$/);
  if (!row) continue;
  const [, name, owner, status, count] = row;
  const values = configValues.get(name);
  if (!values) {
    errors.push(`tunables row \`${name}\` has no config/${name}.json`);
    continue;
  }
  const meta =
    JSON.parse(fs.readFileSync(path.join(root, 'config', `${name}.json`), 'utf8'))._meta ?? {};
  const expectedOwner = meta.owner_task ?? '—';
  const expectedStatus = meta.status ?? '—';
  const expectedCount = Object.keys(values).length;
  if (owner.trim() !== expectedOwner)
    errors.push(`tunables says ${name} is owned by ${owner.trim()}, _meta says ${expectedOwner}`);
  if (status.trim() !== expectedStatus)
    errors.push(`tunables says ${name} is ${status.trim()}, _meta says ${expectedStatus}`);
  if (Number(count) !== expectedCount)
    errors.push(`tunables says ${name} has ${count} values, config has ${expectedCount}`);
}

// 2b — defaults quoted in a task document's `## Config: config/<file>.json`
// table. Counts and the tunables index can be right while every number in the
// table is stale (T02 quoted cutaway 50 / soil 0.3 for a file that says 7 /
// 0.45), so compare the quoted Default cell with `values[key].value`.
//
// Errors, not warnings. The inventory in docs/tasks/DOC-01.md is clear, and a
// record that quotes a default the code does not read is a defect.
const splitRow = (line) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
const configDrift = [];
let quotedDefaults = 0;
for (const doc of docs) {
  const lines = fs.readFileSync(doc, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const heading = lines[i].match(/^##\s+Config:\s+`(config\/[^`]+\.json)`/);
    if (!heading) continue;
    const configRel = heading[1];
    const configPath = path.join(root, configRel);
    if (!fs.existsSync(configPath)) {
      configDrift.push(`${rel(doc)}: heading names missing ${configRel}`);
      continue;
    }
    const values = JSON.parse(fs.readFileSync(configPath, 'utf8')).values ?? {};
    let row = i + 1;
    while (row < lines.length && !lines[row].trim().startsWith('|')) row += 1;
    if (row >= lines.length) continue;
    const defaultColumn = splitRow(lines[row]).findIndex(
      (cell) => cell.toLowerCase() === 'default',
    );
    if (defaultColumn < 0) continue;
    for (row += 2; row < lines.length && lines[row].trim().startsWith('|'); row += 1) {
      const cells = splitRow(lines[row]);
      const key = (cells[0].match(/`([^`]+)`/) ?? [])[1];
      if (!key) continue;
      if (!(key in values)) {
        configDrift.push(`${rel(doc)}: ${configRel} has no key \`${key}\``);
        continue;
      }
      const expected = values[key].value;
      if (expected !== null && typeof expected === 'object') continue;
      const quoted = (cells[defaultColumn] ?? '').replace(/\\`/g, '`').replace(/^`|`$/g, '').trim();
      quotedDefaults += 1;
      if (typeof expected === 'number') {
        const value = Number(quoted);
        if (!Number.isFinite(value) || Math.abs(value - expected) > 1e-9) {
          configDrift.push(`${rel(doc)}: ${key} default is ${quoted}, config says ${expected}`);
        }
      } else if (typeof expected === 'boolean') {
        if (quoted.toLowerCase() !== String(expected)) {
          configDrift.push(`${rel(doc)}: ${key} default is ${quoted}, config says ${expected}`);
        }
      } else if (
        typeof expected === 'string' &&
        /^[\w.#:/-]+$/.test(expected) &&
        /^[\w.#:/-]+$/.test(quoted) &&
        quoted.toLowerCase() !== expected.toLowerCase()
      ) {
        configDrift.push(`${rel(doc)}: ${key} default is ${quoted}, config says ${expected}`);
      }
    }
  }
}
for (const entry of configDrift) errors.push(`config default drift: ${entry}`);
if (configDrift.length > 0) {
  console.log(
    `\nconfig defaults: ${configDrift.length} mismatch(es) in ${quotedDefaults} quoted rows`,
  );
}

// 2b — a task record's `## Config: config/<file>.json (status \`x\`)` heading
// must declare the status the file itself carries. T00A swapped its two files,
// and T01 called an `active` file `draft` while the correction paragraph three
// lines below said so in prose -- a record that names the wrong lifecycle stage
// is worse than a stale number, because a `draft` file reads as "not yet
// shipped" in a record whose whole job is to prove it shipped.
{
  const declaredStatus = new Map();
  for (const file of configFiles) {
    const json = JSON.parse(fs.readFileSync(path.join(root, 'config', file), 'utf8'));
    if (json._meta?.status) declaredStatus.set(file.replace(/\.json$/, ''), json._meta.status);
  }
  for (const doc of docs) {
    const lines = fs.readFileSync(doc, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const m = line.match(/^##\s+Config:\s+`config\/([a-z0-9_]+)\.json`\s*\(status `([a-z]+)`\)/);
      if (!m) return;
      const live = declaredStatus.get(m[1]);
      if (live && live !== m[2])
        errors.push(
          `${rel(doc)}:${i + 1} documents config/${m[1]}.json as ${m[2]}, its _meta says ${live}`,
        );
    });
  }
}

// 2c — a prose claim about how many keys a config file has. `docs/tunables.md`
// owns the counts, but other documents quote them too, and `docs/ui-inventory.md`
// still said 35 keys for a file that had grown to 36 (the same drift the tunables
// table showed). Only the explicit "`config/<system>.json` (N keys)" shape is
// checked, so a number next to a file name that means something else is left
// alone.
{
  const valueCounts = new Map(
    [...configValues].map(([system, values]) => [system, Object.keys(values).length]),
  );
  for (const doc of docs) {
    const lines = fs.readFileSync(doc, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const m of line.matchAll(
        /`config\/([a-z0-9_]+)\.json`\s*\((\d+)\s*(?:keys|values)?\)\s*:/g,
      )) {
        const [system, claimed] = [m[1], Number(m[2])];
        const live = valueCounts.get(system);
        if (live === undefined || live === claimed) continue;
        errors.push(
          `${rel(doc)}:${i + 1} says ${claimed} keys in config/${system}.json, file has ${live}`,
        );
      }
    });
  }
}

// 2d — how many mutations exist. The catalogue is `config/mutations.json`, where a
// definition is a `mutation_*` entry whose type is `object` and whose value carries
// an `id` (the rule `loadMutationsConfig` applies, because the tunables share the
// prefix). Four documents quoted three different numbers — 27, 36 and 45 — and only
// 45 was true. DESIGN.md is exempt: it specifies what a task should build
// ("Add ... 12 mutations.", cut-list items), while a record reports what shipped.
{
  const mutations = JSON.parse(
    fs.readFileSync(path.join(root, 'config', 'mutations.json'), 'utf8'),
  );
  const definitions = Object.entries(mutations.values ?? {}).filter(
    ([key, entry]) =>
      key.startsWith('mutation_') &&
      entry?.type === 'object' &&
      typeof entry.value?.id === 'string',
  ).length;
  for (const doc of [...docs, path.join(root, 'README.md'), path.join(root, 'CONTEXT.md')]) {
    if (!fs.existsSync(doc) || rel(doc) === 'DESIGN.md') continue;
    const lines = fs.readFileSync(doc, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const m of line.matchAll(
        /(\d+)\s+(?:mutation\s+)?definitions?\b|(\d+)\s+mutations\b/g,
      )) {
        const claimed = Number(m[1] ?? m[2]);
        if (claimed === definitions) continue;
        errors.push(
          `${rel(doc)}:${i + 1} says ${claimed} mutation ${m[1] ? 'definitions' : 'mutations'}, config/mutations.json has ${definitions}`,
        );
      }
    });
  }
}

// 2e — a `## Config (`config/x.json`)` section that names one file lists *every*
// key in it. Rules 2b and 3b check the values a table quotes, never whether the
// table is complete, so a section could quietly document two thirds of a file:
// `docs/protocol.md` listed 9 of 14 `net_proto` keys and the five it had lost
// were the abuse limits (backlog ceiling, inbound budget, HELLO deadline), which
// is exactly the part a reader comes to the page for. A heading that names more
// than one file, or adds a qualifier after the path, is a deliberate subset and
// is left alone — say in the heading what the subset is.
{
  const headingPattern = /^##\s+Config\s+\(`config\/([a-z0-9_]+)\.json`\)\s*$/;
  for (const doc of docs) {
    const lines = fs.readFileSync(doc, 'utf8').split(/\r?\n/);
    let sectionName = null;
    let sectionLine = 0;
    let listed = null;
    const flush = () => {
      if (!sectionName || !listed) return;
      const values = configValues.get(sectionName);
      if (!values) {
        errors.push(
          `${rel(doc)}:${sectionLine} documents config/${sectionName}.json, which does not exist`,
        );
      } else {
        const missing = Object.keys(values).filter((key) => !listed.has(key));
        if (missing.length > 0)
          errors.push(
            `${rel(doc)}:${sectionLine} config/${sectionName}.json table omits ${missing.length} key(s): ${missing.join(', ')}`,
          );
      }
      sectionName = null;
      listed = null;
    };
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) {
        flush();
        const heading = line.match(headingPattern);
        if (heading) {
          sectionName = heading[1];
          sectionLine = i + 1;
          listed = new Set();
        }
        return;
      }
      if (!sectionName || !trimmed.startsWith('|')) return;
      for (const m of trimmed.matchAll(/^\|\s*`([a-z0-9_]+)`\s*\|/g)) listed.add(m[1]);
    });
    flush();
  }
}

// 3 — protocol table. The message numbers live in the shared package now, so
const protocolSource = fs.readFileSync(
  path.join(root, 'packages/shared/src/protocol/index.ts'),
  'utf8',
);
const enumStart = protocolSource.indexOf('export const MESSAGE_TYPE');
if (enumStart < 0) errors.push('MESSAGE_TYPE not found in packages/shared/src/protocol/index.ts');
const enumBlock = protocolSource.slice(enumStart, protocolSource.indexOf('} as const', enumStart));
const codeTypes = new Map(
  [...enumBlock.matchAll(/^\s*([A-Z_]+):\s*(\d+)/gm)].map((m) => [m[1], Number(m[2])]),
);
const protocol = fs.readFileSync(path.join(root, 'docs/protocol.md'), 'utf8');
const docTypes = new Map(
  [...protocol.matchAll(/^\|\s*(\d+)\s*\|\s*`([A-Z_]+)`/gm)].map((m) => [m[2], Number(m[1])]),
);
for (const [name, id] of codeTypes) {
  if (!docTypes.has(name)) errors.push(`protocol.md missing ${name} (${id})`);
  else if (docTypes.get(name) !== id)
    errors.push(`protocol.md: ${name} is ${docTypes.get(name)}, code says ${id}`);
}
for (const name of docTypes.keys())
  if (!codeTypes.has(name)) errors.push(`protocol.md documents ${name}, not in MESSAGE_TYPE`);

// 3b — prose tables that quote a config value. Rule 2b only reads `## Config:`
// sections, so a tunables table under any other heading drifted silently (T07
// quoted an 1800 s day for a file that says 3600; C02 quoted 0.08 for 0.15).
// A literal Default or Range cell is compared with config/, scoped to the file
// named in the nearest heading when the heading names one.
const keyIndex = new Map(); // key -> [{ system, entry }]
for (const [system, values] of configValues) {
  for (const [key, entry] of Object.entries(values)) {
    if (!keyIndex.has(key)) keyIndex.set(key, []);
    keyIndex.get(key).push({ system, entry });
  }
}
const asLiteral = (cell) => (cell ?? '').replace(/`/g, '').trim();
let proseRows = 0;
let tableRows = 0;
const proseDrift = [];
for (const doc of docs) {
  const lines = fs.readFileSync(doc, 'utf8').split(/\r?\n/);
  let header = null;
  let owner = null;
  let official = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
      header = null;
      const named = line.match(/`config\/([a-z0-9_]+)\.json`/);
      owner = named ? named[1] : null;
      official = /^##\s+Config:/.test(trimmed);
      continue;
    }
    if (!trimmed.startsWith('|')) {
      header = null;
      continue;
    }
    const cells = splitRow(trimmed);
    if (!header) {
      header = cells.map((cell) => cell.toLowerCase());
      continue;
    }
    if (official) continue;
    const defaultColumn = header.indexOf('default');
    if (defaultColumn < 0) continue;
    const key = (cells[0].match(/^`([a-z0-9_]+)`$/) ?? [])[1];
    if (!key) continue;
    const candidates = (keyIndex.get(key) ?? []).filter((c) => !owner || c.system === owner);
    if (candidates.length === 0) continue;
    const cell = asLiteral(cells[defaultColumn]);
    const number = Number(cell);
    const isNumber = cell !== '' && Number.isFinite(number);
    const isBoolean = cell === 'true' || cell === 'false';
    const isHex = /^#[0-9a-f]{6}$/i.test(cell);
    if (!isNumber && !isBoolean && !isHex) continue;
    proseRows += 1;
    const agrees = candidates.some(({ entry }) => {
      if (isNumber) return typeof entry.value === 'number' && Math.abs(entry.value - number) < 1e-9;
      if (isBoolean) return String(entry.value) === cell;
      return typeof entry.value === 'string' && entry.value.toLowerCase() === cell.toLowerCase();
    });
    if (!agrees) {
      const actual = candidates
        .map(({ system, entry }) => `${system}=${JSON.stringify(entry.value)}`)
        .join(', ');
      proseDrift.push(`${rel(doc)}:${i + 1} ${key} is ${cell}, config says ${actual}`);
    }
    const rangeColumn = header.findIndex((c) => c === 'range' || c.startsWith('range /'));
    if (rangeColumn < 0) continue;
    const range = asLiteral(cells[rangeColumn]).match(
      /^\[?(-?\d+(?:\.\d+)?)\s*[,\u2013-]\s*(-?\d+(?:\.\d+)?)\]?$/,
    );
    if (!range) continue;
    const [lo, hi] = [Number(range[1]), Number(range[2])];
    const ranges = candidates.map(({ entry }) => entry.range).filter(Boolean);
    if (ranges.length === 0) continue;
    if (ranges.some(([a, b]) => Math.abs(a - lo) < 1e-9 && Math.abs(b - hi) < 1e-9)) continue;
    const actual = candidates
      .map(({ system, entry }) => `${system}=${JSON.stringify(entry.range)}`)
      .join(', ');
    proseDrift.push(`${rel(doc)}:${i + 1} ${key} range is ${lo}..${hi}, config says ${actual}`);
  }
}
for (const entry of proseDrift) errors.push(`prose default drift: ${entry}`);

// 3c — every top-level document is linked from the front door. A document
// nobody can find is the quietest kind of dead weight (`docs/ui-inventory.md`
// described the whole interface and was linked from nowhere).
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
for (const entry of fs.readdirSync(path.join(root, 'docs'), { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
  if (!readme.includes(`docs/${entry.name}`))
    errors.push(`docs/${entry.name} is not linked from README.md`);
}

// 3d — a document may not cite a `pnpm <script>` this repo does not have. A
// renamed script leaves every runbook pointing at a command that exits with
// "Missing script", and CI never notices because the citation is prose.
const rootScripts = new Set(
  Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts ?? {}),
);
const pnpmNotScript = new Set(['install', 'add', 'exec', 'dlx', 'why', 'store']);
for (const doc of [...docs, path.join(root, 'README.md'), path.join(root, 'DESIGN.md')]) {
  if (!fs.existsSync(doc)) continue;
  const text = fs.readFileSync(doc, 'utf8');
  for (const span of text.matchAll(/`([^`\n]+)`/g)) {
    for (const m of span[1].matchAll(/\bpnpm (?:--filter \S+ |run )?([a-z][a-z0-9:_-]*)/g)) {
      const script = m[1];
      if (pnpmNotScript.has(script) || rootScripts.has(script)) continue;
      errors.push(`${rel(doc)} cites \`pnpm ${script}\`, which is not a package.json script`);
    }
  }
}

// 3e — prose claims about the wire version. `PROTOCOL_VERSION` is a single
// number in code, and four documents quoted it as 4 while the wire was 5, each
// time in a sentence a reader would trust ("the wire is v4 today"). Only the
// present-tense forms are checked; `protocol v4` in a history entry is a record
// of when a message landed, not a claim about today.
const wireVersion = Number(
  (protocolSource.match(/export const PROTOCOL_VERSION\s*=\s*(\d+)/) ?? [])[1],
);
if (!Number.isFinite(wireVersion)) errors.push('PROTOCOL_VERSION not found in the protocol source');
else {
  // Task records, ADRs and the fix plans quote the number they found on the day
  // they were written ("`PROTOCOL_VERSION = 3`" in a 2026-11-14 pass is a
  // record, not a claim about today). Only the documents a reader trusts for the
  // present are checked.
  const historical = new Set([
    'docs/decisions.md',
    'docs/history.md',
    'docs/bugfix-plan.md',
    'docs/improvement-plan.md',
    'docs/state-machines-and-invariants.md',
    'docs/partitioning-lod.md',
    'docs/procedural-systems.md',
  ]);
  for (const doc of docs) {
    if (historical.has(rel(doc)) || rel(doc).startsWith('docs/tasks/')) continue;
    const lines = fs.readFileSync(doc, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const m of line.matchAll(
        /PROTOCOL_VERSION\s*=\s*(\d+)|\bwire is v(\d+)\b|\bsay? (\d+) today\b/gi,
      )) {
        if (m[3] !== undefined && !/protocol/i.test(line)) continue;
        const claimed = Number(m[1] ?? m[2] ?? m[3]);
        if (claimed !== wireVersion)
          errors.push(
            `${rel(doc)}:${i + 1} says the wire is v${claimed}, code says ${wireVersion}`,
          );
      }
    });
  }
}

// 3f — a prose claim about how many config files exist. The count is printed by
// the validator and owned by `docs/tunables.md`, but the checklists quote it too
// and both said 80 while the folder held 83 -- in a line whose own parenthetical
// promised the number was kept current. Lines that mark themselves as a record
// of an earlier run ("at T00", "Observed at", "at the time") are exempt: they
// are history, not a claim about today.
{
  const live = configFiles.length;
  const records = /at T00|Observed at|at the time|Observed:|shipped with|--dir|<temp>/i;
  for (const doc of [...docs, path.join(root, 'README.md'), path.join(root, 'CONTEXT.md')]) {
    // A task record quotes the count it saw the day it ran.
    if (rel(doc).startsWith('docs/tasks/')) continue;
    if (!fs.existsSync(doc)) continue;
    const lines = fs.readFileSync(doc, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (records.test(line)) return;
      for (const m of line.matchAll(
        /config: (\d+) file|Today: (\d+) files?|Expected: (\d+) file/g,
      )) {
        const claimed = Number(m[1] ?? m[2] ?? m[3]);
        if (claimed !== live)
          errors.push(`${rel(doc)}:${i + 1} says ${claimed} config files, config/ holds ${live}`);
      }
    });
  }
}

// 3g — every declared third-party dependency is attributed. ATTRIBUTION.md is
// the licence manifest the project is obliged to keep ("every asset added to the
// project must be recorded here before it is used"), and it said "Status:
// current" while `@dimforge/rapier3d-compat` — a runtime dependency of both the
// client and the server — had no row at all. Workspace packages are first-party
// and are skipped.
{
  const manifest = fs.readFileSync(path.join(root, 'ATTRIBUTION.md'), 'utf8');
  const attributed = new Set(
    [...manifest.matchAll(/^\|\s*`([@a-z0-9/._-]+)`\s*\|/gm)].map((m) => m[1]),
  );
  const packages = [path.join(root, 'package.json')];
  for (const area of ['apps', 'packages', 'tools']) {
    const dir = path.join(root, area);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) packages.push(path.join(dir, entry.name, 'package.json'));
    }
  }
  const declared = new Set();
  for (const pkg of packages) {
    if (!fs.existsSync(pkg)) continue;
    const json = JSON.parse(fs.readFileSync(pkg, 'utf8'));
    for (const field of ['dependencies', 'devDependencies']) {
      for (const name of Object.keys(json[field] ?? {})) {
        if (name.startsWith('@plant-legacy/')) continue;
        declared.add(name);
      }
    }
  }
  for (const name of declared) {
    if (!attributed.has(name))
      errors.push(
        `ATTRIBUTION.md has no licence row for \`${name}\`, which a workspace package declares`,
      );
  }
}

// 3h — the compliance policy is a legal floor written twice: five numbered lines
// in docs/compliance-policy.md and the same five strings in
// `config/compliance.json` → `values.policy_lines`. Only one of them can be the
// one a payment provider reads, so they have to stay word for word identical.
{
  const compliance = JSON.parse(
    fs.readFileSync(path.join(root, 'config', 'compliance.json'), 'utf8'),
  );
  const lines = compliance.values?.policy_lines?.value;
  const policyDoc = path.join(root, 'docs', 'compliance-policy.md');
  if (Array.isArray(lines) && fs.existsSync(policyDoc)) {
    const text = fs.readFileSync(policyDoc, 'utf8').split(/\r?\n/);
    // A numbered item may wrap; join its continuation lines before comparing.
    const numbered = [];
    for (const line of text) {
      if (/^\d+\.\s+\S/.test(line)) numbered.push(line.replace(/^\d+\.\s+/, '').trim());
      else if (/^\s{2,}\S/.test(line) && numbered.length)
        numbered[numbered.length - 1] += ` ${line.trim()}`;
    }
    for (const line of numbered) {
      if (!lines.includes(line))
        errors.push(`compliance-policy.md lists a line config/compliance.json does not: "${line}"`);
    }
    if (numbered.length !== lines.length)
      errors.push(
        `compliance-policy.md lists ${numbered.length} policy lines, config/compliance.json has ${lines.length}`,
      );
  }
}

// 3i — a file cited in a document that describes *today* must exist. This is the
// narrow version of a rule that was measured and rejected once: a repo-wide
// "backticked path exists" check produced 118 hits, almost all shorthand
// (`growth/rules.test.ts` for `ops/growth/`) or files a future task will create.
// Scoped to the documents a reader trusts for the present, and allowing a bare
// filename or a longer path that ends with the citation, it found real rot
// (`apps/server/src/ops/weatherStateMachine.ts` had moved to the relay package,
// `inputActionStateMachine.ts` to `InputActionStateMachine.ts`) and nothing else.
{
  const currentDocs = [
    'README.md',
    'CONTEXT.md',
    'docs/what-works-now.md',
    'docs/ui-inventory.md',
    'docs/partitioning-lod.md',
    'docs/tick-budget.md',
    'docs/data-model.md',
    'docs/controls.md',
    'docs/state-machines-and-invariants.md',
  ];
  const walkFiles = [];
  const collect = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git', '.freebuff'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(full);
      else walkFiles.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  for (const area of ['apps', 'packages', 'tools', 'config']) {
    const dir = path.join(root, area);
    if (fs.existsSync(dir)) collect(dir);
  }
  // A line that is describing something that does not exist yet is exempt.
  const future =
    /\b(planned|future|not built|will (?:create|add|be)|new file|to be added|does not exist|there is no|deleted|unused|removed|gone)\b/i;
  for (const doc of currentDocs) {
    const file = path.join(root, doc);
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      // The exemption is a property of the sentence, and a sentence wraps.
      if (future.test(lines.slice(Math.max(0, i - 1), i + 2).join(' '))) return;
      for (const m of line.matchAll(/`([A-Za-z0-9_./-]+\.(?:ts|tsx|mjs|wgsl|json|sql|css))`/g)) {
        const ref = m[1];
        if (ref.startsWith('http') || ref.startsWith('.')) continue;
        if (walkFiles.some((f) => f === ref || f.endsWith(`/${ref}`))) continue;
        errors.push(`${doc}:${i + 1} cites \`${ref}\`, which does not exist`);
      }
    });
  }
}

// 3j — every task record is reachable from the task index. `docs/tasks/README.md`
// is the status table; a record file nothing links to is invisible, which is how
// AL-01, AL-03, AL-04, DOC-01 and W6-water came to sit in the directory unlisted
// while the table claimed to be the list. The reverse direction is allowed: the
// table names tasks that have no record yet, with `[ ]` and the reason.
{
  const tasksDir = path.join(root, 'docs/tasks');
  const indexFile = path.join(tasksDir, 'README.md');
  if (fs.existsSync(tasksDir) && fs.existsSync(indexFile)) {
    const index = fs.readFileSync(indexFile, 'utf8');
    for (const name of fs.readdirSync(tasksDir)) {
      if (!name.endsWith('.md') || name === 'README.md') continue;
      if (index.includes(`(./${name})`)) continue;
      errors.push(
        `docs/tasks/README.md: no link to ${name}; a record nobody can reach is not part of the index`,
      );
    }
  }
}

// 3k — a feature row's owning task has to exist. The inventory is the index the
// bug work hangs off, so a row pointing at a task id that DESIGN.md never defines
// sends a reader looking for scope that was never written. Set membership against
// every T/C/O/H id in DESIGN, headings and tables alike; phase tokens (P0-P3) are
// allowed because a feature can be owned by a phase rather than a task.
{
  const designFile = path.join(root, 'DESIGN.md');
  const inventoryFile = path.join(root, 'docs/feature-inventory.md');
  if (fs.existsSync(designFile) && fs.existsSync(inventoryFile)) {
    const design = fs.readFileSync(designFile, 'utf8');
    const known = new Set();
    for (const m of design.matchAll(/\b([TCOH]\d{2}[A-Z]?)\b/g)) known.add(m[1]);
    const lines = fs.readFileSync(inventoryFile, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const row = line.match(/^\| (F\d+) \|(.*)$/);
      if (!row) return;
      const cells = row[2].split('|');
      const taskCell = (cells[1] ?? '').trim();
      for (const m of taskCell.matchAll(/\b([TCOH]\d{2}[A-Z]?)\b/g)) {
        if (known.has(m[1])) continue;
        errors.push(
          `docs/feature-inventory.md:${i + 1} ${row[1]} is owned by ${m[1]}, which DESIGN.md does not define`,
        );
      }
    });
  }
}

// 3l — every environment variable the code reads is documented in `.env.example`.
// The template is the only place a fresh checkout learns a variable exists; four
// tooling knobs (`PL_SERVER_PORT`, `CLIENT_PORT`, `PROXY_ORIGIN`, `PROBE_PORT`) had
// been read by scripts for months while appearing nowhere, so `pnpm dev` working
// and nothing explaining why was the only evidence they existed. Commented lines
// count: a knob that is deliberately not set by default is still documented.
{
  const exampleFile = path.join(root, '.env.example');
  if (fs.existsSync(exampleFile)) {
    const example = fs.readFileSync(exampleFile, 'utf8');
    const found = new Set();
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', 'dist', '.git', 'dist-server'].includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(?:ts|mts|tsx|mjs)$/.test(entry.name)) continue;
        const text = fs.readFileSync(full, 'utf8');
        for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) found.add(m[1]);
        for (const m of text.matchAll(/process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g))
          found.add(m[1]);
      }
    };
    for (const area of ['apps', 'packages', 'tools']) {
      const dir = path.join(root, area);
      if (fs.existsSync(dir)) walk(dir);
    }
    for (const name of [...found].sort()) {
      if (example.includes(name)) continue;
      errors.push(`.env.example: \`${name}\` is read by code but not documented in the template`);
    }
  }
}

// 3m — every state-machine module is named in the state-machine document. The
// document's premise is that it inventories the machines, so a `*StateMachine.ts`
// that appears in no `SM-nn` section is a machine the audit never saw — which is
// how three of them (plant tier, client entry flow, Root Sight camera) stayed
// undocumented while the list looked complete. Tests are skipped: they describe
// the machine they test.
{
  const docFile = path.join(root, 'docs/state-machines-and-invariants.md');
  if (fs.existsSync(docFile)) {
    const doc = fs.readFileSync(docFile, 'utf8');
    const found = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (/StateMachine\.ts$/.test(entry.name)) found.push(entry.name.replace(/\.ts$/, ''));
      }
    };
    for (const area of ['apps', 'packages']) {
      const dir = path.join(root, area);
      if (fs.existsSync(dir)) walk(dir);
    }
    for (const name of found.sort()) {
      if (doc.includes(name)) continue;
      errors.push(
        `docs/state-machines-and-invariants.md: \`${name}\` has no SM section or mention`,
      );
    }
  }
}

// 3n — a file cited in a task record must exist, unless the sentence says it does
// not. Records are the evidence for a shipped task, so a "Files touched" entry
// that names a path nobody can open reads as a file the change created. This rule
// found five: `apps/client/src/input/InputBus.ts` (moved into `packages/input`),
// `packages/shared/growth/health.ts` (missing `src/`), and three citations of
// `config/plant_world.json`, a file that never existed. Records also legitimately
// discuss deleted files and corrections, so the sentence-level exemption is the
// same shape rule 3i uses, widened with "never existed" and "renamed".
{
  const tasksDir = path.join(root, 'docs/tasks');
  if (fs.existsSync(tasksDir)) {
    const tree = [];
    const collect = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', 'dist', '.git', '.tmp', '.tmp-dev'].includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collect(full);
        else tree.push(path.relative(root, full).split(path.sep).join('/'));
      }
    };
    collect(root);
    const gone =
      /\b(deleted|removed|renamed|moved|no longer|does not exist|never existed|there is no|gone|retired|once|used to|was |were |previously)\b/i;
    for (const name of fs.readdirSync(tasksDir)) {
      if (!name.endsWith('.md') || name === 'README.md') continue;
      const rel = `docs/tasks/${name}`;
      const lines = fs.readFileSync(path.join(tasksDir, name), 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        if (gone.test(lines.slice(Math.max(0, i - 1), i + 2).join(' '))) return;
        for (const m of line.matchAll(
          /`([A-Za-z0-9_./-]+\.(?:ts|tsx|mjs|wgsl|json|sql|css|html))`/g,
        )) {
          const ref = m[1];
          if (ref.startsWith('http')) continue;
          if (tree.some((f) => f === ref || f.endsWith(`/${ref}`))) continue;
          errors.push(`${rel}:${i + 1} cites \`${ref}\`, which does not exist`);
        }
      });
    }
  }
}

// 4b — a table row that does not have the header's cell count. An unescaped `|`
// in the middle of prose (a union type, `a || b`, a sentence separator) splits the
// row into a phantom column, and the text after it renders in the wrong place —
// thirty rows across five documents were doing this, including one in
// `protocol.md` where a `GrowthIntent` union spilled a whole sentence into a
// column that does not exist. A pipe that belongs to the text is written `\|`.
{
  const BACKSLASH = String.fromCharCode(92);
  const pipesOf = (line) => {
    const positions = [];
    for (let i = 0; i < line.length; i += 1) {
      if (line[i] === BACKSLASH && line[i + 1] === '|') {
        i += 1;
        continue;
      }
      if (line[i] === '|') positions.push(i);
    }
    return positions;
  };
  let rows = 0;
  for (const doc of docs) {
    const lines = fs.readFileSync(doc, 'utf8').split(/\r?\n/);
    let inFence = false;
    let header = null;
    let headerLine = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('```')) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      if (!trimmed.startsWith('|')) {
        header = null;
        continue;
      }
      const count = pipesOf(trimmed).length - 1;
      if (header === null) {
        header = count;
        headerLine = i + 1;
        continue;
      }
      if (/^\|[\s:|-]+\|$/.test(trimmed)) continue;
      rows += 1;
      if (count !== header)
        errors.push(
          `${rel(doc)}:${i + 1} table row has ${count} cell(s), header at :${headerLine} has ${header}`,
        );
    }
  }
  tableRows = rows;
}

// 4 — duplicated long prose. A paragraph copied between two documents is
// two things to maintain and one of them will go stale.
const seen = new Map();
for (const doc of docs) {
  const text = fs.readFileSync(doc, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.length < 100 || t.startsWith('|') || t.startsWith('#') || t.startsWith('```')) continue;
    const key = t.toLowerCase();
    const where = seen.get(key);
    if (where && where !== rel(doc)) warnings.push(`duplicated prose: ${rel(doc)} and ${where}`);
    else if (!where) seen.set(key, rel(doc));
  }
}

console.log(`docs: ${docs.length} files, ${links} relative links`);
console.log(
  `config: ${configFiles.length} files, ${populated} populated, ${configFiles.length - populated} stubs`,
);
console.log(`protocol: ${codeTypes.size} message types, ${docTypes.size} documented rows`);
console.log(`prose: ${proseRows} config cell(s) quoted in tables checked`);
console.log(`tables: ${tableRows} row(s) match their header`);
if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings.slice(0, 20)) console.log(`  ~ ${w}`);
}
if (errors.length) {
  console.log(`\n${errors.length} error(s):`);
  for (const e of errors) console.log(`  x ${e}`);
  process.exit(1);
}
console.log('\ndocs:check OK');
