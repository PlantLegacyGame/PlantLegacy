import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// Node has no WebGPU globals. These mirror the spec values the module reads; the
// assertions only compare binding numbers and view descriptors.
Object.assign(globalThis, {
  GPUShaderStage: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 },
  GPUTextureUsage: { TEXTURE_BINDING: 4, RENDER_ATTACHMENT: 16, COPY_DST: 2 },
});

import {
  PLANT_TEXTURE_ARRAY_ORDER,
  PlantTextureType,
  plantTextureArrayBindGroupEntries,
  plantTextureArrayLayoutEntries,
} from './plantTextureBindings.ts';

function fakeDevice(onCreate?: () => void): GPUDevice {
  return {
    createTexture: () => {
      onCreate?.();
      return { createView: () => ({}) as GPUTextureView } as GPUTexture;
    },
  } as unknown as GPUDevice;
}

describe('plant texture array bindings', () => {
  it('lists each texture type once', () => {
    assert.deepEqual([...PLANT_TEXTURE_ARRAY_ORDER].sort(), [
      PlantTextureType.Bark,
      PlantTextureType.Leaf,
      PlantTextureType.Flower,
      PlantTextureType.SporeSac,
      PlantTextureType.Seed,
    ]);
  });

  it('puts the arrays at consecutive bindings from the first one', () => {
    assert.deepEqual(
      plantTextureArrayLayoutEntries(3).map((entry) => entry.binding),
      [3, 4, 5, 6, 7],
    );
    assert.deepEqual(
      plantTextureArrayBindGroupEntries(fakeDevice(), null, 4).map((entry) => entry.binding),
      [4, 5, 6, 7, 8],
    );
  });

  it('feeds every layout binding from the bind group at the same number', () => {
    for (const firstBinding of [3, 4]) {
      const layout = plantTextureArrayLayoutEntries(firstBinding).map((entry) => entry.binding);
      const bindings = plantTextureArrayBindGroupEntries(fakeDevice(), null, firstBinding).map(
        (entry) => entry.binding,
      );
      assert.deepEqual(bindings, layout);
    }
  });

  it('views each real array as a 2d-array, in the declared order', () => {
    const requested: string[] = [];
    const textures = new Map(
      PLANT_TEXTURE_ARRAY_ORDER.map((type) => [
        type,
        {
          createView: (descriptor?: GPUTextureViewDescriptor) => {
            requested.push(`${type}:${descriptor?.dimension}`);
            return {} as GPUTextureView;
          },
        } as unknown as GPUTexture,
      ]),
    );

    plantTextureArrayBindGroupEntries(fakeDevice(), textures, 3);

    assert.deepEqual(requested, [
      '0:2d-array',
      '1:2d-array',
      '2:2d-array',
      '3:2d-array',
      '4:2d-array',
    ]);
  });

  it('reuses one stand-in texture for every missing array on a device', () => {
    let created = 0;
    const device = fakeDevice(() => {
      created += 1;
    });

    plantTextureArrayBindGroupEntries(device, null, 3);
    plantTextureArrayBindGroupEntries(device, null, 4);

    assert.equal(created, 1);
  });
});
