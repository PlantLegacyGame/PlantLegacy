#!/usr/bin/env node
/**
 * Documentation guardrail.
 *
 * Checks the four things that silently rot in this repo:
 *   1. every relative markdown link resolves;
 *   2. the config count/population quoted in docs/tunables.md matches config/;
 *   3. docs/protocol.md lists exactly the message types in MESSAGE_TYPE;
 *   4. the same long prose line does not live in two documents;
 *   5. a task record's quoted config default equals `values[key].value`.
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
let populated = 0;
for (const file of configFiles) {
  const json = JSON.parse(fs.readFileSync(path.join(root, 'config', file), 'utf8'));
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

// 3 — protocol table. The message numbers live in the shared package now, so
// the guardrail reads the one table the server and client both import.
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

// 4 — duplicated long prose
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
