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
 * reason each one is safe. An assignment in any other file fails, and an entry
 * that no longer matches anything is itself an error, so the list cannot go stale
 * quietly. Aliasing (`const inv = player.inventory; inv.slots[0] = …`) is out of
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

/** Files that may touch a live pouch or purse, and why each is not a bypass. */
export const ALLOWED = new Map([
  [
    'apps/server/src/main.ts',
    'adopts the committed row after COMMIT and builds the starting kit on a new player',
  ],
  ['apps/server/src/ops/inventory.ts', 'the pouch primitives themselves'],
  [
    'apps/server/src/ops/persistence/playerStatePersistence.ts',
    'builds a local array while converting a row, never a live player',
  ],
  [
    'apps/server/src/ops/inventoryHandlers.ts',
    'the guest / no-store fallback when a session has no row to lock',
  ],
  ['apps/server/src/ops/shop.ts', 'the guest / unavailable-row purchase fallback'],
  [
    'apps/server/src/ops/persistence/playerStateAudit.ts',
    'the Postgres audit builds its own players',
  ],
]);

/**
 * One assignment to a purse or a pouch.
 *
 * `=` only: `==`, `===`, `!=` and `<=` are reads, and so is a plain `.spores`
 * mention. Compound assignments (`+=`) count, because they write too.
 */
const DIRECT_WRITE =
  /(?:\.spores\b|\.slots\b(?:\[[^\]\n]*\])?|\bslots\[[^\]\n]*\])\s*(?:[+\-*/%|&^]|<<|>>>?)?\s*=(?!=)/;

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
  text.split('\n').forEach((line, index) => {
    if (DIRECT_WRITE.test(line)) {
      writes.push({ file, line: index + 1, text: line.trim() });
    }
  });
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
  const seen = new Set();
  for (const [file, source] of sources) {
    for (const write of findDirectWrites(source, file)) {
      writes.push(write);
      seen.add(file);
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
  for (const file of allowed.keys()) {
    if (!sources.has(file)) {
      errors.push(`allowlist entry "${file}" names no scanned source file (stale entry)`);
    } else if (!seen.has(file)) {
      errors.push(`allowlist entry "${file}" writes no pouch or purse directly (stale entry)`);
    }
  }

  return { files: sources.size, writes, errors };
}

function report(result) {
  const lines = [
    '',
    `locked writes: ${result.writes.length} direct write(s) in ${result.files} source file(s)`,
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
