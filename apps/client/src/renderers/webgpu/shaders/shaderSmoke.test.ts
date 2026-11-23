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
import { PLANT_VERTEX_BUFFER_LAYOUT } from '../plantVertexLayout.ts';

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
  'vec2u',
  'vec2i',
  'vec3u',
  'vec3i',
  'vec4u',
  'vec4i',
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

/* ── Vertex attributes: the shader's @location list against the pipeline's ──
 *
 * The rain pass drew nothing for months because its pipeline put the instance
 * buffer at locations 2/3 while the shader read `instanceData` from location 1.
 * Neither side is wrong alone, which is why nothing caught it.
 */

/** The renderer that owns the pipelines; the shader side is read from disk. */
const RENDERER = stripComments(readFileSync(join(DIR, '..', 'WebGPURenderer.ts'), 'utf8'));

/**
 * Vertex layouts the renderer names instead of writing out inline.
 *
 * The mesh and impostor pipelines share one layout object, so the pipeline source
 * only names it; the check reads its attributes from the module itself.
 */
const LAYOUT_CONSTANTS: Record<
  string,
  Array<{ attributes: Array<{ shaderLocation: number; format: string }> }>
> = {
  PLANT_VERTEX_BUFFER_LAYOUT: [
    PLANT_VERTEX_BUFFER_LAYOUT as unknown as {
      attributes: Array<{ shaderLocation: number; format: string }>;
    },
  ],
};

/** Component count of a WGSL vertex input type. */
const WGSL_WIDTHS: Record<string, number> = {
  f32: 1,
  u32: 1,
  i32: 1,
  vec2f: 2,
  vec3f: 3,
  vec4f: 4,
  'vec2<f32>': 2,
  'vec3<f32>': 3,
  'vec4<f32>': 4,
  'vec2<u32>': 2,
  'vec3<u32>': 3,
  'vec4<u32>': 4,
};

/** Component count of a `GPUVertexFormat`. */
const FORMAT_WIDTHS: Record<string, number> = {
  float32: 1,
  float32x2: 2,
  float32x3: 3,
  float32x4: 4,
  uint32: 1,
  uint32x2: 2,
  uint32x3: 3,
  uint32x4: 4,
  sint32: 1,
  sint32x2: 2,
  sint32x3: 3,
  sint32x4: 4,
};

interface VertexInput {
  location: number;
  width: number;
  name: string;
}

/** The inputs of the struct a module's `@vertex` entry point takes. */
function vertexInputs(source: string): VertexInput[] {
  const entry = source.match(/@vertex\s*\n\s*fn\s+\w+\s*\(\s*\w+\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/);
  if (!entry) return [];
  const structName = entry[1];
  const start = source.indexOf(`struct ${structName} {`);
  assert.ok(start >= 0, `@vertex takes ${structName}, which the module does not declare`);
  const body = source.slice(start, source.indexOf('\n}', start));
  const inputs: VertexInput[] = [];
  for (const match of body.matchAll(/@location\((\d+)\)\s+(\w+)\s*:\s*([A-Za-z0-9_<>, ]+?),/g)) {
    const type = match[3].trim();
    const width = WGSL_WIDTHS[type];
    assert.ok(width, `vertex input ${match[2]} has type ${type}, which this check does not know`);
    inputs.push({ location: Number(match[1]), width, name: match[2] });
  }
  return inputs;
}

/** The attributes of one `buffers: [...]` entry list. */
function layoutAttributes(block: string): Array<{ location: number; width: number }> {
  const constant = block.match(/\b([A-Z][A-Z0-9_]{3,})\b/);
  if (constant && !block.includes('shaderLocation')) {
    const buffers = LAYOUT_CONSTANTS[constant[1]];
    assert.ok(buffers, `pipeline buffers use ${constant[1]}, which this check does not know`);
    return buffers.flatMap((buffer) =>
      (buffer.attributes ?? []).map((attribute) => ({
        location: attribute.shaderLocation,
        width: FORMAT_WIDTHS[attribute.format] ?? -1,
      })),
    );
  }
  const attributes: Array<{ location: number; width: number }> = [];
  for (const object of block.matchAll(/\{[^{}]*shaderLocation[^{}]*\}/g)) {
    const location = object[0].match(/shaderLocation:\s*(\d+)/);
    const format = object[0].match(/format:\s*'([a-z0-9]+)'/);
    assert.ok(location && format, `unreadable vertex attribute ${object[0]}`);
    attributes.push({
      location: Number(location[1]),
      width: FORMAT_WIDTHS[format[1]] ?? -1,
    });
  }
  return attributes;
}

/** Every `createRenderPipeline` call: its label, module and vertex attributes. */
function pipelineLayouts(source: string): Array<{
  label: string;
  module: string;
  attributes: Array<{ location: number; width: number }>;
}> {
  const pipelines: Array<{
    label: string;
    module: string;
    attributes: Array<{ location: number; width: number }>;
  }> = [];
  for (const chunk of source.split('device.createRenderPipeline({').slice(1)) {
    const label = chunk.match(/label:\s*'([^']+)'/);
    const vertexStart = chunk.indexOf('vertex: {');
    const fragmentStart = chunk.indexOf('fragment:');
    if (vertexStart < 0 || fragmentStart < 0) continue;
    const vertex = chunk.slice(vertexStart, fragmentStart);
    const moduleMatch = vertex.match(/module:\s*([A-Za-z_][A-Za-z0-9_]*)/);
    assert.ok(moduleMatch, `${label?.[1] ?? 'unnamed'} has no shader module`);
    const buffersStart = vertex.indexOf('buffers: [');
    let block = '';
    if (buffersStart >= 0) {
      let depth = 0;
      for (let i = buffersStart + 'buffers: '.length; i < vertex.length; i += 1) {
        const character = vertex[i];
        if (character === '[') depth += 1;
        if (character === ']') depth -= 1;
        block += character;
        if (depth === 0) break;
      }
    }
    pipelines.push({
      label: label?.[1] ?? 'unnamed',
      module: moduleMatch[1],
      attributes: layoutAttributes(block),
    });
  }
  return pipelines;
}

/** What is wrong between a shader's inputs and the layout its pipeline declares. */
function layoutMismatches(
  moduleName: string,
  attributes: Array<{ location: number; width: number }>,
): string[] {
  const shader = vertexInputs(MODULES[moduleName]);
  const shaderLocations = shader.map((input) => input.location);
  const declaredLocations = attributes.map((attribute) => attribute.location);
  const problems: string[] = [];

  const missing = shaderLocations.filter((location) => !declaredLocations.includes(location));
  if (missing.length > 0) {
    problems.push(`the shader reads @location ${missing.join(', ')} the pipeline does not provide`);
  }
  const extra = declaredLocations.filter((location) => !shaderLocations.includes(location));
  if (extra.length > 0) {
    problems.push(`the pipeline provides @location ${extra.join(', ')} the shader does not read`);
  }
  for (const input of shader) {
    const declared = attributes.find((attribute) => attribute.location === input.location);
    if (declared && declared.width !== input.width) {
      problems.push(
        `@location(${input.location}) ${input.name} is ${input.width} components but the pipeline supplies ${declared.width}`,
      );
    }
  }
  return problems;
}

test('every vertex pipeline provides exactly the attributes its shader reads', () => {
  const pipelines = pipelineLayouts(RENDERER);
  // Mesh, billboard, impostor and rain all create a render pipeline.
  assert.ok(pipelines.length >= 4, `found only ${pipelines.length} render pipelines`);
  const checked: string[] = [];
  for (const pipeline of pipelines) {
    const moduleName = pipeline.module.replace(/Module$/, '');
    if (!(moduleName in MODULES)) continue;
    assert.deepEqual(
      layoutMismatches(moduleName, pipeline.attributes),
      [],
      `${pipeline.label} (${moduleName}) does not match its shader`,
    );
    checked.push(moduleName);
  }
  assert.deepEqual(checked.sort(), ['billboard', 'impostor', 'mesh', 'rain']);
});

test('the layout check catches the rain pipeline that drew nothing', () => {
  // The pipeline as it stood while rain was invisible: a per-vertex quad at
  // locations 0/1 plus the instance buffer at 2/3, against a shader that read
  // `vec4f instanceData` from location 1.
  const broken = [
    { location: 0, width: 3 },
    { location: 1, width: 1 },
    { location: 2, width: 3 },
    { location: 3, width: 1 },
  ];
  const problems = layoutMismatches('rain', broken);
  assert.ok(
    problems.some((problem) => problem.includes('@location 3')),
    `the old rain layout was not caught: ${problems.join('; ') || 'no problems'}`,
  );
  // The layout the pipeline declares now passes the same check.
  assert.deepEqual(
    layoutMismatches('rain', [
      { location: 0, width: 3 },
      { location: 1, width: 1 },
      { location: 2, width: 1 },
    ]),
    [],
  );
});
test('the render-data stride matches the WGSL struct it describes', () => {
  // `readRenderData` reads this struct back per plant, and the cull pass writes
  // it; a field added on one side and not the other shifts every value after it.
  const body = COMMON.slice(COMMON.indexOf('struct PlantRenderData {'));
  const fields = [...body.slice(0, body.indexOf('}')).matchAll(/^\s*(\w+):\s*(\w+),/gm)].map(
    (match) => match[1],
  );
  assert.deepEqual(fields, ['tier', 'visible', 'projectedSize', 'blendFactor', 'groundY']);
  const stride = RENDERER.match(/const RENDER_STRIDE = (\d+);/);
  assert.ok(stride, 'the renderer does not declare RENDER_STRIDE');
  assert.equal(Number(stride[1]), fields.length * 4, 'RENDER_STRIDE is not four bytes a field');
});
