/**
 * WGSL smoke checks.
 *
 * The shaders are only compiled by a browser, so a typo in a shader is invisible
 * to `pnpm verify` and fails only when someone opens the game. These checks do
 * not compile WGSL, but they do catch the mistakes this module actually makes:
 * a function that is called but never defined (or defined twice), a binding
 * referenced without being declared, duplicate decorators, unbalanced braces,
 * and a storage struct whose WGSL layout drifted from the JS writer.
 *
 * Two more came out of the WebGPU pass being dead for months behind a silent
 * three.js fallback (E28/E29 in `docs/bug-inventory.md`): a `let` that is
 * assigned again, which WGSL rejects because `let` is immutable, and an
 * assignment to a struct field the struct does not declare. Neither is a real
 * WGSL parser - there is no GPU in the test runner - but they are the exact
 * two faults that stopped `plant-cull` and `rain` from compiling, and a shader
 * that cannot compile should fail here rather than quietly disappear.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { plantTextureArrayBindings } from '../plantTextureBindings.ts';

const DIR = dirname(fileURLToPath(import.meta.url));

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /\/\/[^\n]*/g;

/** Source without comments: prose mentions words that look like code. */
function stripComments(source: string): string {
  return source.replace(BLOCK_COMMENT, ' ').replace(LINE_COMMENT, ' ');
}

function read(name: string): string {
  return stripComments(readFileSync(join(DIR, `${name}.wgsl`), 'utf8'));
}

const COMMON = read('common');

/** The same concatenation `shaders/index.ts` performs for Vite. */
const MODULES: Record<string, string> = {
  mesh: `${COMMON}\n${read('skinning')}\n${read('mesh')}`,
  billboard: `${COMMON}\n${read('billboard')}`,
  impostor: `${COMMON}\n${read('impostor')}`,
  cull: `${COMMON}\n${read('cull')}`,
  rain: `${COMMON}\n${read('rain')}`,
};

/** Functions the shader source defines (a module can define one twice). */
function definedFunctions(source: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of source.matchAll(/fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  return counts;
}

/**
 * `let` names that are assigned again somewhere in the module.
 *
 * WGSL's `let` is immutable, so any second assignment fails validation. The
 * declaration itself (`let x = ...`) is skipped by looking at what precedes the
 * match; `==`, `<=`, `>=` and `!=` are excluded by the trailing `(?!=)`.
 */
function reassignedLets(source: string): string[] {
  const names = new Set(
    [...source.matchAll(/\blet\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=]+)?=/g)].map((m) => m[1]),
  );
  const offenders: string[] = [];
  for (const name of names) {
    const assignment = new RegExp(`(?<![\\w.])${name}\\s*=(?!=)`, 'g');
    for (const match of source.matchAll(assignment)) {
      const before = source.slice(Math.max(0, (match.index ?? 0) - 4), match.index);
      if (/\blet\s+$/.test(before)) continue;
      offenders.push(name);
      break;
    }
  }
  return offenders;
}

/** Fields each struct declares, keyed by struct name. */
function structFields(source: string): Map<string, Set<string>> {
  const structs = new Map<string, Set<string>>();
  for (const match of source.matchAll(/struct\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)\n\}/g)) {
    structs.set(
      match[1],
      new Set(
        [...match[2].matchAll(/^\s*(?:@[^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map(
          (field) => field[1],
        ),
      ),
    );
  }
  return structs;
}

/**
 * Assignments that name a field their struct does not have.
 *
 * Only `var x: SomeStruct;` locals are followed: that is the shape a vertex
 * output takes, and it is where `output.worldPosition = ...` slipped through.
 */
function unknownStructFields(source: string): string[] {
  const structs = structFields(source);
  const offenders: string[] = [];
  for (const local of source.matchAll(
    /\bvar\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*;/g,
  )) {
    const [, variable, type] = local;
    const fields = structs.get(type ?? '');
    if (!fields) continue;
    const assignment = new RegExp(
      `(?<![\\w.])${variable}\\.([A-Za-z_][A-Za-z0-9_]*)\\s*=(?!=)`,
      'g',
    );
    for (const match of source.matchAll(assignment)) {
      const field = match[1] ?? '';
      if (!fields.has(field)) offenders.push(`${variable}.${field} (${type} has no ${field})`);
    }
  }
  return offenders;
}

/** Names called as bare functions, excluding declarations and builtins. */
const BUILTINS = new Set([
  'abs',
  'acos',
  'all',
  'any',
  'arrayLength',
  'asin',
  'atan2',
  'atan',
  'ceil',
  'clamp',
  'cos',
  'cosh',
  'cross',
  'distance',
  'dot',
  'exp',
  'exp2',
  'faceForward',
  'floor',
  'fma',
  'fract',
  'length',
  'log',
  'log2',
  'max',
  'min',
  'mix',
  'modf',
  'normalize',
  'pow',
  'reflect',
  'refract',
  'round',
  'select',
  'sign',
  'sin',
  'sinh',
  'smoothstep',
  'sqrt',
  'step',
  'tan',
  'tanh',
  'transpose',
  'trunc',
  'textureSample',
  'textureSampleLevel',
  'textureSampleCompare',
  'textureLoad',
  'textureDimensions',
  'vec2f',
  'vec3f',
  'vec4f',
  'mat2x2f',
  'mat3x3f',
  'mat4x4f',
  'vec2',
  'vec3',
  'vec4',
  'mat4x4',
  'f32',
  'u32',
  'i32',
  'bool',
  'array',
  'bitcast',
]);

for (const [name, source] of Object.entries(MODULES)) {
  test(`${name}: braces and parentheses balance`, () => {
    const counts: Record<string, number> = { '{': 0, '}': 0, '(': 0, ')': 0 };
    for (const character of source) {
      if (character in counts) counts[character] += 1;
    }
    assert.equal(counts['{'], counts['}'], 'unbalanced braces');
    assert.equal(counts['('], counts[')'], 'unbalanced parentheses');
  });

  test(`${name}: every function is defined once`, () => {
    for (const [fn, count] of definedFunctions(source)) {
      assert.equal(count, 1, `${fn} is defined ${count} times`);
    }
  });

  test(`${name}: every call has a definition`, () => {
    // Struct constructors look like calls too; collect the struct names locally.
    const structs = new Set(
      [...source.matchAll(/struct\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g)].map((match) => match[1]),
    );
    const defined = definedFunctions(source);
    for (const match of source.matchAll(/(?<![\w.@])([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
      const fn = match[1];
      if (BUILTINS.has(fn) || structs.has(fn) || defined.has(fn)) continue;
      if (['if', 'for', 'while', 'switch', 'return', 'case'].includes(fn)) continue;
      assert.fail(`${name} calls undefined function ${fn}()`);
    }
  });

  test(`${name}: no let is assigned twice`, () => {
    assert.deepEqual(reassignedLets(source), [], `${name} reassigns an immutable let`);
  });

  test(`${name}: every struct field assignment names a declared field`, () => {
    assert.deepEqual(unknownStructFields(source), [], `${name} writes an undeclared struct field`);
  });

  test(`${name}: every declared binding has a unique group and binding`, () => {
    const seen = new Set<string>();
    for (const match of source.matchAll(/@group\((\d+)\)\s*@binding\((\d+)\)/g)) {
      const key = `${match[1]}:${match[2]}`;
      assert.ok(!seen.has(key), `binding ${key} is declared twice`);
      seen.add(key);
    }
  });

  test(`${name}: every storage/texture binding in the body is declared`, () => {
    const declared = new Set(
      [...source.matchAll(/var(?:<[^>]+>)?\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]),
    );
    for (const binding of ['plantLooks', 'plantLooks_billboard', 'renderData', 'frame']) {
      const used = new RegExp(`(?<![\\w.])${binding}(?![\\w])`).test(source);
      if (!used) continue;
      assert.ok(declared.has(binding), `${binding} is used but never declared`);
    }
  });
}

/** Texture-array declarations a shader module makes, in source order. */
function declaredTextureArrays(source: string): Array<{ binding: number; name: string }> {
  return [
    ...source.matchAll(
      /@group\(0\)\s*@binding\((\d+)\)\s*var\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*texture_2d_array/g,
    ),
  ].map((match) => ({ binding: Number(match[1]), name: match[2] }));
}

test('the texture arrays sit at the bindings the JS layouts declare', () => {
  // The mesh and billboard passes put the five arrays at 3-7; the impostor baker
  // spends binding 3 on its view uniforms and starts at 4. Both sides are
  // generated from one order now, but the shader is the authority.
  const layouts: Array<[string, number]> = [
    ['mesh', 3],
    ['billboard', 3],
    ['impostor', 4],
  ];
  for (const [name, firstBinding] of layouts) {
    const declared = declaredTextureArrays(MODULES[name]);
    assert.deepEqual(
      declared.map((entry) => entry.binding),
      plantTextureArrayBindings(firstBinding),
      `${name} declares its texture arrays at other bindings`,
    );
    assert.deepEqual(
      declared.map((entry) => entry.name.toLowerCase().replace('texturearray', '')),
      ['bark', 'leaf', 'flower', 'sporesac', 'seed'],
      `${name} reads the arrays in another order`,
    );
  }
});

test('the look record on the wire matches the WGSL struct', () => {
  // PlantMeshBuilder/WebGPURenderer write five organ records of four vec4f.
  const common = COMMON;
  const plantLook = common.slice(common.indexOf('struct PlantLook {'));
  const body = plantLook.slice(0, plantLook.indexOf('}'));
  const organs = [...body.matchAll(/(\w+):\s*LookOrgan/g)].map((match) => match[1]);
  assert.deepEqual(organs, ['foliage', 'woody', 'seed', 'bloom', 'disc']);
  const organ = common.slice(common.indexOf('struct LookOrgan {'));
  const organBody = organ.slice(0, organ.indexOf('}'));
  const fields = [...organBody.matchAll(/(\w+):\s*vec4f/g)].map((match) => match[1]);
  assert.deepEqual(fields, ['tintPlus', 'varPlus', 'glowPlus', 'patternPlus']);
});
