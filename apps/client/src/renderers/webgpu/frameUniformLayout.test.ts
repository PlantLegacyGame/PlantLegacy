import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/**
 * The frame uniform buffer is written by float index, so a field added to the
 * WGSL struct and not to the writer (or the other way round) shifts every value
 * after it: the sun ends up in the camera position and nothing complains until
 * the world looks wrong. There is no GPU in the test runner, and importing the
 * renderer pulls the whole WebGPU chain, so the two sides are compared as text.
 */
const writer = readFileSync(new URL('./WebGPURenderer.ts', import.meta.url), 'utf8');
const shader = readFileSync(new URL('./shaders/common.wgsl', import.meta.url), 'utf8');

function fieldsFromWriter(): string[] {
  const start = writer.indexOf('export const FRAME_UNIFORM_FIELDS = [');
  assert.ok(start >= 0, 'writer declares FRAME_UNIFORM_FIELDS');
  const end = writer.indexOf('] as const;', start);
  const body = writer.slice(start, end);
  return [...body.matchAll(/'([a-zA-Z0-9_]+)'/g)].map((m) => m[1] as string);
}

function fieldsFromShader(): string[] {
  const structStart = shader.indexOf('struct FrameUniforms {');
  assert.ok(structStart >= 0, 'shader declares FrameUniforms');
  const structEnd = shader.indexOf('\n}', structStart);
  return shader
    .slice(structStart, structEnd)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('//') && !line.startsWith('struct'))
    .map((line) => line.replace(/,$/, '').split(':')[0]?.trim())
    .filter((name): name is string => Boolean(name));
}

describe('FrameUniforms layout', () => {
  it('declares the same fields, in the same order, as the writer', () => {
    assert.deepEqual(fieldsFromShader(), fieldsFromWriter());
  });

  it('sizes the buffer for every field it writes', () => {
    const floats = Number(/const FRAME_FLOATS = (\d+);/.exec(writer)?.[1]);
    const fields = fieldsFromWriter();
    assert.ok(Number.isFinite(floats), 'FRAME_FLOATS is a number');
    // Matrices and colours occupy several floats each, so the buffer is larger
    // than the field count; it can never be smaller.
    assert.ok(floats >= fields.length, `${floats} floats for ${fields.length} fields`);
  });
});
