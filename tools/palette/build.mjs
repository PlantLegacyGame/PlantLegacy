#!/usr/bin/env node
/**
 * Renders the palette into the art bible.
 *
 * `config/palette.json` is the source of truth (RULE_3), authored in OKLCH. The
 * swatch tables and the sheet in `docs/assets/palette.svg` are generated from it
 * so the colours an artist reads are the colours a renderer will ask for, and
 * the doc cannot drift from the config one hex at a time.
 *
 * Usage:
 *   node tools/palette/build.mjs            write both files
 *   node tools/palette/build.mjs --check    exit 1 if either is stale
 *
 * Exit 2 means the palette itself is invalid (out of gamut, a role naming a step
 * that does not exist): that is an authoring error, not a stale doc.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLightStep, oklchToHex } from './oklch.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

const PALETTE_PATH = path.join(repoRoot, 'config', 'palette.json');
const ART_BIBLE_PATH = path.join(repoRoot, 'docs', 'art-bible.md');
const SVG_PATH = path.join(repoRoot, 'docs', 'assets', 'palette.svg');

const BLOCK_START = '<!-- palette:start -->';
const BLOCK_END = '<!-- palette:end -->';

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/** The parsed palette, checked hard enough that a typo cannot reach the docs. */
export function readPalette(file = PALETTE_PATH) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ramps = raw.values?.ramps?.value;
  const roles = raw.values?.roles?.value;
  if (!Array.isArray(ramps) || ramps.length === 0) {
    throw new Error('values.ramps needs a non-empty value array');
  }
  if (!Array.isArray(roles) || roles.length === 0) {
    throw new Error('values.roles needs a non-empty value array');
  }

  const names = new Set();
  const ladders = new Set();
  const byName = new Map();
  const colors = new Map();

  for (const ramp of ramps) {
    if (!NAME_PATTERN.test(String(ramp?.name ?? ''))) {
      throw new Error(`ramp name ${JSON.stringify(ramp?.name)} is not lower_snake_case`);
    }
    if (names.has(ramp.name)) throw new Error(`ramp "${ramp.name}" is declared twice`);
    names.add(ramp.name);
    if (typeof ramp.use !== 'string' || ramp.use.trim() === '') {
      throw new Error(`ramp "${ramp.name}" needs a use`);
    }
    if (!Array.isArray(ramp.steps) || ramp.steps.length < 2) {
      throw new Error(`ramp "${ramp.name}" needs at least two steps`);
    }
    const steps = [...ramp.steps].sort((a, b) => a.step - b.step);
    const ladder = steps.map((step) => step.step).join('/');
    ladders.add(ladder);
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      if (!Number.isInteger(step.step) || step.step < 0) {
        throw new Error(`ramp "${ramp.name}" has a non-integer step ${JSON.stringify(step.step)}`);
      }
      const previous = steps[index - 1];
      if (previous && !(step.l < previous.l)) {
        throw new Error(
          `ramp "${ramp.name}" step ${step.step} is not darker than ${previous.step}`,
        );
      }
      const { hex, outOfGamut } = oklchToHex(step);
      if (outOfGamut) {
        throw new Error(
          `ramp "${ramp.name}" step ${step.step} (${step.l} ${step.c} ${step.h}) is outside sRGB: lower the chroma`,
        );
      }
      colors.set(`${ramp.name}.${step.step}`, hex);
    }
    byName.set(ramp.name, { ...ramp, steps });
  }

  if (ladders.size > 1) {
    throw new Error(
      `ramps must share one step ladder; found ${[...ladders].map((l) => `[${l}]`).join(' and ')}`,
    );
  }

  const roleNames = new Set();
  for (const role of roles) {
    if (!NAME_PATTERN.test(String(role?.name ?? ''))) {
      throw new Error(`role name ${JSON.stringify(role?.name)} is not lower_snake_case`);
    }
    if (roleNames.has(role.name)) throw new Error(`role "${role.name}" is declared twice`);
    roleNames.add(role.name);
    if (!byName.has(role.ramp)) {
      throw new Error(`role "${role.name}" names the unknown ramp "${role.ramp}"`);
    }
    if (!colors.has(`${role.ramp}.${role.step}`)) {
      throw new Error(`role "${role.name}" names ${role.ramp}.${role.step}, which is not a step`);
    }
    if (typeof role.use !== 'string' || role.use.trim() === '') {
      throw new Error(`role "${role.name}" needs a use`);
    }
  }

  const ladder = [...byName.values()][0].steps.map((step) => step.step);
  return {
    ramps: [...byName.values()],
    roles,
    ladder,
    colors,
    hexOf: (rampName, step) => colors.get(`${rampName}.${step}`),
  };
}

const escapeCell = (text) => String(text).replaceAll('|', '\\|');

/** The Markdown between the art bible's markers. */
export function renderBlock(palette) {
  const { ramps, roles, ladder, hexOf } = palette;
  const lines = [];

  lines.push('### Ramps', '');
  lines.push(
    'One lightness ladder (0.92 / 0.78 / 0.60 / 0.42 / 0.25) across every material:',
    'step 100 is the lightest, 900 the darkest, and the hue drifts toward the warm',
    'end at the top of the ramp and the cool end in shadow. The hexes are derived,',
    'never authored.',
    '',
  );
  lines.push(`| Ramp | Use | ${ladder.join(' | ')} |`);
  lines.push(`|---|---|${ladder.map(() => '---').join('|')}|`);
  for (const ramp of ramps) {
    const cells = ramp.steps.map((step) => `\`${hexOf(ramp.name, step.step)}\``);
    lines.push(`| \`${ramp.name}\` | ${escapeCell(ramp.use)} | ${cells.join(' | ')} |`);
  }

  lines.push('', '### Roles', '');
  lines.push('The name a surface should ask for, so no material quotes a step directly.', '');
  lines.push('| Role | Step | Hex | Use |');
  lines.push('|---|---|---|---|');
  for (const role of roles) {
    lines.push(
      `| \`${role.name}\` | \`${role.ramp}.${role.step}\` | \`${hexOf(role.ramp, role.step)}\` | ${escapeCell(role.use)} |`,
    );
  }

  return lines.join('\n');
}

const escapeXml = (text) =>
  String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** The swatch sheet: one row per ramp, one cell per step. */
export function renderSvg(palette) {
  const { ramps, ladder, hexOf } = palette;
  const labelWidth = 104;
  const cellWidth = 104;
  const cellHeight = 58;
  const gap = 8;
  const pad = 12;
  const width = pad * 2 + labelWidth + ladder.length * (cellWidth + gap) - gap;
  const height = pad * 2 + ramps.length * (cellHeight + gap) - gap;

  const rows = [];
  ramps.forEach((ramp, rowIndex) => {
    const y = pad + rowIndex * (cellHeight + gap);
    rows.push(
      `<text x="${pad}" y="${y + cellHeight / 2 + 4}" fill="#efe9d8" font-family="ui-monospace, monospace" font-size="12">${escapeXml(ramp.name)}</text>`,
    );
    ramp.steps.forEach((step, stepIndex) => {
      const x = pad + labelWidth + stepIndex * (cellWidth + gap);
      const ink = isLightStep(step) ? '#14180f' : '#efe9d8';
      rows.push(
        `<rect x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" rx="3" fill="${hexOf(ramp.name, step.step)}" stroke="#efe9d8" stroke-opacity="0.18"/>`,
        `<text x="${x + 8}" y="${y + 18}" fill="${ink}" font-family="ui-monospace, monospace" font-size="12">${step.step}</text>`,
        `<text x="${x + 8}" y="${y + 46}" fill="${ink}" font-family="ui-monospace, monospace" font-size="12">${hexOf(ramp.name, step.step)}</text>`,
      );
    });
  });

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"',
    '     viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-labelledby="palette-title">',
    '  <title id="palette-title">Plant Legacy palette ramps (OKLCH, hexes derived)</title>',
    '  <rect width="100%" height="100%" fill="#14180f"/>',
    ...rows.map((line) => `  ${line}`),
    '</svg>',
    '',
  ].join('\n');
}

/** Replaces the marked block; the prose around it stays authored. */
export function applyBlock(document, block) {
  const start = document.indexOf(BLOCK_START);
  const end = document.indexOf(BLOCK_END);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`the art bible needs ${BLOCK_START} ... ${BLOCK_END}`);
  }
  return document.slice(0, start + BLOCK_START.length) + '\n' + block + '\n' + document.slice(end);
}

const normalise = (text) => text.replaceAll('\r\n', '\n');

function main() {
  const check = process.argv.includes('--check');
  let palette;
  let block;
  let svg;
  let document;
  try {
    palette = readPalette();
    block = renderBlock(palette);
    svg = renderSvg(palette);
    document = fs.readFileSync(ART_BIBLE_PATH, 'utf8');
  } catch (error) {
    console.error(`palette: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }

  const wanted = applyBlock(document, block);
  const summary = `palette: ${palette.ramps.length} ramps x ${palette.ladder.length} steps, ${palette.roles.length} roles`;

  if (check) {
    const stale = [];
    if (normalise(wanted) !== normalise(document)) stale.push('docs/art-bible.md');
    const currentSvg = fs.existsSync(SVG_PATH) ? fs.readFileSync(SVG_PATH, 'utf8') : '';
    if (normalise(svg) !== normalise(currentSvg)) stale.push('docs/assets/palette.svg');
    if (stale.length > 0) {
      console.error(`${summary}`);
      for (const file of stale) console.error(`  ${file} is stale`);
      console.error('  run `pnpm palette:write` and commit the result');
      process.exit(1);
    }
    console.log(`${summary} - art bible and sheet are current`);
    return;
  }

  fs.mkdirSync(path.dirname(SVG_PATH), { recursive: true });
  if (normalise(wanted) !== normalise(document)) fs.writeFileSync(ART_BIBLE_PATH, wanted);
  if (
    normalise(svg) !== normalise(fs.existsSync(SVG_PATH) ? fs.readFileSync(SVG_PATH, 'utf8') : '')
  ) {
    fs.writeFileSync(SVG_PATH, svg);
  }
  console.log(`${summary} - wrote docs/art-bible.md and docs/assets/palette.svg`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
