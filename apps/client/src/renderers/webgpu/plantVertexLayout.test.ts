import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PLANT_VERTEX_BUFFER_LAYOUT, PLANT_VERTEX_STRIDE } from './plantVertexLayout.ts';

const FORMAT_BYTES: Record<string, number> = {
  float32: 4,
  float32x2: 8,
  float32x3: 12,
  float32x4: 16,
  uint32: 4,
  uint32x4: 16,
};

describe('plant vertex layout', () => {
  it('declares the stride the mesh builder writes', () => {
    assert.equal(PLANT_VERTEX_BUFFER_LAYOUT.arrayStride, PLANT_VERTEX_STRIDE);
    assert.equal(PLANT_VERTEX_STRIDE, 76);
  });

  it('keeps every attribute inside one stride', () => {
    for (const attribute of PLANT_VERTEX_BUFFER_LAYOUT.attributes) {
      const size = FORMAT_BYTES[String(attribute.format)];
      assert.equal(size !== undefined, true, `unknown vertex format ${attribute.format}`);
      assert.ok(
        attribute.offset + size <= PLANT_VERTEX_STRIDE,
        `shaderLocation ${attribute.shaderLocation} runs past the stride`,
      );
    }
  });

  it('ends the last attribute exactly at the stride', () => {
    const attributes = [...PLANT_VERTEX_BUFFER_LAYOUT.attributes];
    const last = attributes[attributes.length - 1];
    assert.equal(last.offset + FORMAT_BYTES[String(last.format)], PLANT_VERTEX_STRIDE);
  });

  it('gives every attribute its own shader location', () => {
    const locations = [...PLANT_VERTEX_BUFFER_LAYOUT.attributes].map((a) => a.shaderLocation);
    assert.deepEqual(locations, [0, 1, 2, 3, 4, 5, 6, 7]);
  });
});
