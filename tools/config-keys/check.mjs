#!/usr/bin/env node
/**
 * Dead-tunable guardrail.
 *
 * A config key that no source file names is a lie: it looks like a knob, the
 * docs quote a default for it, and turning it changes nothing. Eleven of those
 * had accumulated (an emote range nothing enforced, a dev panel switch that was
 * really `import.meta.env.DEV`, a move speed for a server with no movement), and
 * two more turned out to be stale copies of `config/root_sight.json`.
 *
 * A key counts as read only when it appears in application code as a whole word —
 * a string literal, a property access or a declared field, but never a piece of a
 * longer identifier: `root_sight_cutaway` must not be kept alive by
 * `root_sight_cutaway_radius_m`. Comments are skipped (a key explained in prose is
 * still unread) and regex literals are skipped (their bodies are not code).
 *
 * Literal-only matching was tried and is wrong for this tree: the keys reach code
 * through TypeScript field names and payload mapping (`data.max_pixel_ratio`,
 * `values.bindings_desktop`, `max_pixel_ratio?: number`), so requiring quotes
 * flagged 202 keys that are genuinely read.
 *
 * Tests are excluded on purpose: a test that mentions a key usually just restates
 * the fixture and would hide the very rot this is looking for. Intentional
 * exceptions live in `allowlist.json` with a reason, and an exemption that
 * matches no key is itself an error, so the list cannot go stale quietly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const configDir = path.join(root, 'config');
const allowlistPath = path.join(root, 'tools', 'config-keys', 'allowlist.json');

const sourceDirs = ['apps', 'packages'];
const sourceExtensions = /\.(ts|mts|tsx)$/;

/** Keywords after which a `/` opens a regex literal rather than dividing. */
const REGEX_KEYWORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);
const REGEX_PRECEDERS = new Set([
  '',
  '(',
  '[',
  '{',
  ',',
  ';',
  ':',
  '=',
  '!',
  '&',
  '|',
  '?',
  '+',
  '-',
  '*',
  '%',
  '^',
  '~',
  '<',
  '>',
]);

/**
 * The file's code with comments and regex bodies blanked out; string literals and
 * every identifier are left untouched, so a whole-word search sees exactly what
 * the compiler sees.
 *
 * A single pass keeps the three contexts apart: `//` and `/*` are comments, a `/`
 * in expression position opens a regex (so `/[/*]/` is not a comment), and quoted
 * text is copied through rather than treated as a comment or regex.
 */
function codeText(source) {
  let out = '';
  let i = 0;
  let prevChar = '';
  let prevWord = '';

  /** Copied through verbatim: a quoted key is code, not a comment. */
  const readQuoted = (start) => {
    const quote = source[start];
    let j = start + 1;
    while (j < source.length) {
      const c = source[j];
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (c === quote) return j + 1;
      if (c === '\n' && quote !== '`') return j;
      j += 1;
    }
    return j;
  };

  const skipRegex = (start) => {
    let j = start + 1;
    let inClass = false;
    while (j < source.length) {
      const c = source[j];
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (c === '\n') return j;
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) {
        j += 1;
        while (j < source.length && /[a-z]/i.test(source[j])) j += 1;
        return j;
      }
      j += 1;
    }
    return j;
  };

  const blank = (start, end) => {
    for (let k = start; k < end; k += 1) out += source[k] === '\n' ? '\n' : ' ';
  };

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '/' && next === '/') {
      const start = i;
      while (i < source.length && source[i] !== '\n') i += 1;
      blank(start, i);
      continue;
    }
    if (ch === '/' && next === '*') {
      const start = i;
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i = Math.min(i + 2, source.length);
      blank(start, i);
      continue;
    }
    if (ch === '/' && (REGEX_PRECEDERS.has(prevChar) || REGEX_KEYWORDS.has(prevWord))) {
      const start = i;
      i = skipRegex(i);
      blank(start, i);
      prevChar = '/';
      prevWord = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const start = i;
      i = readQuoted(i);
      out += source.slice(start, i);
      prevChar = ch;
      prevWord = '';
      continue;
    }
    if (/[A-Za-z0-9_$]/.test(ch)) {
      let word = '';
      while (i < source.length && /[A-Za-z0-9_$]/.test(source[i])) {
        word += source[i];
        i += 1;
      }
      out += word;
      prevChar = word[word.length - 1];
      prevWord = word;
      continue;
    }
    out += ch;
    if (!/\s/.test(ch)) {
      prevChar = ch;
      prevWord = '';
    }
    i += 1;
  }

  return out;
}

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

const sources = sourceDirs.flatMap((dir) =>
  walk(path.join(root, dir), (file) => sourceExtensions.test(file) && !isTestFile(file)),
);
const code = sources.map((file) => codeText(fs.readFileSync(file, 'utf8'))).join('\n');

/** Whole-word test: a key inside a longer identifier or string is not a read. */
function isRead(key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`).test(code);
}

const allowlist = fs.existsSync(allowlistPath)
  ? JSON.parse(fs.readFileSync(allowlistPath, 'utf8'))
  : [];
const allowed = (system, key) =>
  allowlist.find((entry) => {
    const [systemPattern, keyPattern] = String(entry.key).split('.');
    if (systemPattern !== system || !keyPattern) return false;
    return keyPattern.endsWith('*') ? key.startsWith(keyPattern.slice(0, -1)) : keyPattern === key;
  });

const errors = [];
let keys = 0;
let exemptions = 0;

for (const file of fs.readdirSync(configDir).filter((name) => name.endsWith('.json'))) {
  const system = file.replace(/\.json$/, '');
  const parsed = JSON.parse(fs.readFileSync(path.join(configDir, file), 'utf8'));
  for (const key of Object.keys(parsed.values ?? {})) {
    keys += 1;
    if (isRead(key)) continue;
    if (allowed(system, key)) {
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
