#!/usr/bin/env node
/**
 * Dead-tunable guardrail.
 *
 * A config key that no source file names is a lie: it looks like a knob, the
 * docs quote a default for it, and turning it changes nothing. Eleven of those
 * had accumulated (an emote range nothing enforced, a dev panel switch that was
 * really `import.meta.env.DEV`, a move speed for a server with no movement).
 *
 * This check reads every `values` key in `config/`, looks for its exact name in
 * the application sources, and fails on any key nothing reads. Intentional
 * exceptions live in `allowlist.json` with the reason they are not dead.
 *
 * Sources are application code only: tests are excluded on purpose, because a
 * test that mentions a key usually just restates the fixture and would hide the
 * very rot this is looking for. Comments are blanked before the search, because a
 * key named only in prose is still unread — several tunables survived for a while
 * precisely because a comment explained what they were meant to do.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const configDir = path.join(root, 'config');
const allowlistPath = path.join(root, 'tools', 'config-keys', 'allowlist.json');

const sourceDirs = ['apps', 'packages'];
const sourceExtensions = /\.(ts|mts|tsx)$/;

const walk = (dir, filter, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.ignored')
      continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, filter, out);
    else if (filter(full)) out.push(full);
  }
  return out;
};

const isTestFile = (file) =>
  /\.test\.(ts|mts|tsx)$/.test(file) || file.includes(`${path.sep}test${path.sep}`);

/**
 * Blank out comments while leaving strings and template literals intact, so a key
 * quoted in code counts and a key named in a comment does not. Both comment forms
 * are replaced by spaces rather than removed, which keeps offsets (and therefore
 * reported line numbers) untouched.
 */
function stripComments(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      out += '  ';
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < source.length) {
        out += '  ';
        i += 2;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < source.length) {
        const c = source[i];
        out += c;
        if (c === '\\') {
          out += source[i + 1] ?? '';
          i += 2;
          continue;
        }
        i += 1;
        if (c === quote) break;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

const sources = sourceDirs.flatMap((dir) =>
  walk(path.join(root, dir), (file) => sourceExtensions.test(file) && !isTestFile(file)),
);
const haystack = sources.map((file) => stripComments(fs.readFileSync(file, 'utf8'))).join('\n');

const allowlist = fs.existsSync(allowlistPath)
  ? JSON.parse(fs.readFileSync(allowlistPath, 'utf8'))
  : [];
const allowed = (system, key) =>
  allowlist.find((entry) => {
    const [systemPattern, keyPattern] = String(entry.key).split('.');
    const systemMatch = systemPattern === system;
    const keyMatch = keyPattern.endsWith('*')
      ? key.startsWith(keyPattern.slice(0, -1))
      : keyPattern === key;
    return systemMatch && keyMatch;
  });

const errors = [];
let keys = 0;
let exemptions = 0;

for (const file of fs.readdirSync(configDir).filter((name) => name.endsWith('.json'))) {
  const system = file.replace(/\.json$/, '');
  const parsed = JSON.parse(fs.readFileSync(path.join(configDir, file), 'utf8'));
  for (const key of Object.keys(parsed.values ?? {})) {
    keys += 1;
    if (haystack.includes(key)) continue;
    const exemption = allowed(system, key);
    if (exemption) {
      exemptions += 1;
      continue;
    }
    errors.push(
      `config/${file}: \`${key}\` is read by no source file — delete it, or add it to tools/config-keys/allowlist.json with the reason it is not dead`,
    );
  }
}

for (const entry of allowlist) {
  const [systemPattern, keyPattern] = String(entry.key).split('.');
  const file = path.join(configDir, `${systemPattern}.json`);
  if (!keyPattern || !fs.existsSync(file)) {
    errors.push(`allowlist entry "${entry.key}" names no config file`);
    continue;
  }
  if (!entry.reason) errors.push(`allowlist entry "${entry.key}" has no reason`);
  const values = JSON.parse(fs.readFileSync(file, 'utf8')).values ?? {};
  const matches = Object.keys(values).filter((key) =>
    keyPattern.endsWith('*') ? key.startsWith(keyPattern.slice(0, -1)) : key === keyPattern,
  );
  if (matches.length === 0) {
    errors.push(`allowlist entry "${entry.key}" matches no key (stale exemption)`);
  }
}

console.log(
  `\nconfig keys: ${keys} declared, ${exemptions} allowlisted, ${keys - exemptions} read by source`,
);
for (const entry of errors) console.log(`  ${entry}`);

if (errors.length > 0) {
  console.log(`\nconfig keys: ${errors.length} problem(s)\n`);
  process.exit(1);
}
console.log('config keys: every declared key is read or allowlisted\n');
