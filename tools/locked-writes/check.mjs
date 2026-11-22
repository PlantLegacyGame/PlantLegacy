#!/usr/bin/env node
/**
 * Locked-write guardrail.
 *
 * The pouch and the purse belong to `PlayerStateStore`: a mutation reads the
 * account's row inside its lock and writes the row back, and the live object is
 * only adopted from what the store committed. A helper that assigns
 * `player.spores` or `inventory.slots` on its own is a second write path, and a
 * duplication audit that is repeated by hand rots the moment nobody repeats it —
 * the shop's old `awardSpores` had already lost its last caller and survived
 * exactly because nothing checked.
 *
 * This scans the server source for direct assignments to a `.spores` field or a
 * `.slots` array element (including a bare `slots[i] =` used to build a local
 * copy). Comments, regex bodies and string literals are blanked first, so a
 * documented example is not a finding. Test files are skipped: setting up a live
 * player is what a test does.
 *
 * The files that may still hold a live copy are listed in `ALLOWED` with the
 * reason each one is safe and the number of writes pinned for it. An assignment
 * in any other file fails; so does a different count in a listed file (a new
 * write, or a removed one); so does an entry that no longer matches. The list
 * cannot grow or go stale quietly. Aliasing (`const inv = player.inventory; inv.slots[0] = …`) is out of
 * reach of a text scan; the file-level list is the backstop for that.
 *
 * Wired into `pnpm test` through `check.test.mjs`; run it alone with
 * `node tools/locked-writes/check.mjs`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeText } from '../config-keys/check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '../..');
export const SOURCE_DIR = 'apps/server/src';

/**
 * Files that may touch a live pouch or purse, why each is not a bypass, and how
 * many direct assignments the audit found there. The count is pinned so a new
 * write in an already-allowed file still fails and has to be looked at.
 */
export const ALLOWED = new Map([
  [
    'apps/server/src/main.ts',
    {
      count: 3,
      reason: 'adopts the committed row after COMMIT and builds the starting kit on a new player',
    },
  ],
  ['apps/server/src/ops/inventory.ts', { count: 5, reason: 'the pouch primitives themselves' }],
  [
    'apps/server/src/ops/persistence/playerStatePersistence.ts',
    { count: 1, reason: 'builds a local array while converting a row, never a live player' },
  ],
  [
    'apps/server/src/ops/inventoryHandlers.ts',
    { count: 2, reason: 'the guest / no-store fallback when a session has no row to lock' },
  ],
  [
    'apps/server/src/ops/shop.ts',
    { count: 1, reason: 'the guest / unavailable-row purchase fallback' },
  ],
  [
    'apps/server/src/ops/persistence/playerStateAudit.ts',
    { count: 9, reason: 'the Postgres audit builds its own players' },
  ],
]);

/**
 * One assignment to a purse or a pouch.
 *
 * Every writing operator counts: plain `=`, the compound forms including
 * `**=`, `??=`, `&&=` and `||=`, and the update forms `++`/`--`. A comparison
 * (`==`, `===`, `!=`, `<=`) and a plain `.spores` mention are reads. The
 * receiver and operator may be split across lines: `player.spores` newline
 * `= 1` is the same write, and the scan is on the whole blanked file, not one
 * line at a time.
 */
const DIRECT_WRITE =
  /(?:\.spores\b|\.slots\b(?:\[[^\]\n]*\])?|\bslots\[[^\]\n]*\])\s*(?:(?:\*\*|<<|>>>?|&&|\|\||\?\?|[-+*/%|&^])\s*=\s*|=(?!=)|\+\+|--)/;

/** Blank quoted text in already-comment-free code, keeping every line break. */
function blankLiterals(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c !== '"' && c !== "'" && c !== '`') {
      out.push(c);
      i += 1;
      continue;
    }
    const quote = c;
    out.push(' ');
    i += 1;
    while (i < text.length) {
      const inner = text[i];
      if (inner === '\\') {
        out.push(' ', ' ');
        i += 2;
        continue;
      }
      if (inner === quote) {
        out.push(' ');
        i += 1;
        break;
      }
      out.push(inner === '\n' ? '\n' : ' ');
      i += 1;
    }
  }
  return out.join('');
}

/** Every direct pouch or purse assignment in one source file. */
export function findDirectWrites(source, file = '<source>') {
  const text = blankLiterals(codeText(source));
  const writes = [];
  const pattern = new RegExp(DIRECT_WRITE.source, 'g');
  let match = pattern.exec(text);
  while (match !== null) {
    const lineStart = text.lastIndexOf('\n', match.index) + 1;
    const lineEnd = text.indexOf('\n', match.index);
    const line = text.slice(0, match.index).split('\n').length;
    // Report the original line, so a finding can be read as it was written.
    const shown = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);
    writes.push({ file, line, text: shown.trim() });
    match = pattern.exec(text);
  }
  return writes;
}

function walk(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...walk(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Scan the tree (or an explicit `files` map) and report every write outside the
 * allowlist, plus every allowlist entry that no longer matches anything.
 */
export function checkLockedWrites({ root = repoRoot, allowed = ALLOWED, files } = {}) {
  const sources =
    files ??
    new Map(
      walk(path.join(root, SOURCE_DIR)).map((full) => [
        path.relative(root, full).split(path.sep).join('/'),
        fs.readFileSync(full, 'utf8'),
      ]),
    );

  const writes = [];
  const perFile = new Map();
  for (const [file, source] of sources) {
    for (const write of findDirectWrites(source, file)) {
      writes.push(write);
      perFile.set(file, (perFile.get(file) ?? 0) + 1);
    }
  }

  const errors = [];
  for (const write of writes) {
    if (allowed.has(write.file)) continue;
    errors.push(
      `${write.file}:${write.line}: ${write.text} — pouch and purse writes belong in ` +
        'PlayerStateStore.mutate (docs/tasks/T08A.md §6)',
    );
  }
  for (const [file, rule] of allowed) {
    if (!sources.has(file)) {
      errors.push(`allowlist entry "${file}" names no scanned source file (stale entry)`);
      continue;
    }
    const actual = perFile.get(file) ?? 0;
    if (actual === 0) {
      errors.push(`allowlist entry "${file}" writes no pouch or purse directly (stale entry)`);
    } else if (actual !== rule.count) {
      errors.push(
        `${file} has ${actual} direct pouch or purse write(s); the allowlist pins ` +
          `${rule.count} for "${rule.reason}". A new direct write belongs in ` +
          'PlayerStateStore.mutate (docs/tasks/T08A.md §6); if it is a legitimate ' +
          'live-object touch, raise the pin and say why.',
      );
    }
  }

  return { files: sources.size, writes, errors };
}

function report(result) {
  const lines = [
    '',
    `locked writes: ${result.writes.length} direct write(s) in ${result.files} source file(s), ` +
      `${ALLOWED.size} allowlisted file(s) at their pinned counts`,
  ];
  lines.push(...result.errors.map((entry) => `  ${entry}`));
  lines.push(
    result.errors.length > 0
      ? `\nlocked writes: ${result.errors.length} problem(s)\n`
      : 'locked writes: every direct pouch or purse write is in an allowlisted file\n',
  );
  return lines.join('\n');
}

function main() {
  const rootFlag = process.argv.indexOf('--root');
  const root = rootFlag >= 0 ? path.resolve(process.argv[rootFlag + 1] ?? repoRoot) : repoRoot;
  const result = checkLockedWrites({ root });
  console.log(report(result));
  process.exit(result.errors.length > 0 ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
