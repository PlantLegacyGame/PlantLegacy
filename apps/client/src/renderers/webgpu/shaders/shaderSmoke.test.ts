/**
 * WGSL smoke checks.
 *
 * The shaders are only compiled by a browser, so a typo in a shader is invisible
 * to `pnpm verify` and fails only when someone opens the game. These checks do
 * not compile WGSL, but they do catch the mistakes this module actually makes:
 * a function that is called but never defined (or defined twice), a binding
 * referenced without being declared, duplicate decorators, unbalanced braces,
 * and a storage struct whose WGSL layout drifted from the JS writer.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

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
