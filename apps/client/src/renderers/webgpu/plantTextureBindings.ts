/**
 * The five plant texture arrays, as bind group layout entries and as bind group
 * entries.
 *
 * The arrays appear in five different bind groups (mesh layout, billboard
 * layout, and the mesh, impostor and billboard bind groups), and each copy
 * spelled out its own binding numbers and its own way of inventing a 1x1 stand
 * in when an array was missing. One order, one generator: a binding added to a
 * layout cannot be missing from the bind group that feeds it.
 */

/**
 * Plant part types that use texture arrays.
 *
 * A const object rather than a `tsc` enum: this module is imported by a test,
 * and Node's type stripping refuses `enum`.
 */
export const PlantTextureType = {
  Bark: 0, // Stems, branches, vines, roots
  Leaf: 1, // Leaves, cotyledons
  Flower: 2, // Flowers
  SporeSac: 3, // Spore sacs
  Seed: 4, // Seeds
} as const;

export type PlantTextureType = (typeof PlantTextureType)[keyof typeof PlantTextureType];

/** Names for logs and texture labels. */
export const PLANT_TEXTURE_TYPE_NAMES: Record<PlantTextureType, string> = {
  [PlantTextureType.Bark]: 'Bark',
  [PlantTextureType.Leaf]: 'Leaf',
  [PlantTextureType.Flower]: 'Flower',
  [PlantTextureType.SporeSac]: 'SporeSac',
  [PlantTextureType.Seed]: 'Seed',
};

/** The order the arrays occupy, at consecutive bindings, in every bind group. */
export const PLANT_TEXTURE_ARRAY_ORDER: readonly PlantTextureType[] = [
  PlantTextureType.Bark,
  PlantTextureType.Leaf,
  PlantTextureType.Flower,
  PlantTextureType.SporeSac,
  PlantTextureType.Seed,
];

/**
 * The binding numbers the arrays occupy, starting at `firstBinding`.
 *
 * Pure numbers so the check against the WGSL sources does not need a GPU global.
 */
export function plantTextureArrayBindings(firstBinding: number): number[] {
  return PLANT_TEXTURE_ARRAY_ORDER.map((_type, index) => firstBinding + index);
}

/** Layout entries for the arrays, starting at `firstBinding`. */
export function plantTextureArrayLayoutEntries(firstBinding: number): GPUBindGroupLayoutEntry[] {
  return plantTextureArrayBindings(firstBinding).map(
    (binding): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.FRAGMENT,
      texture: { sampleType: 'float', viewDimension: '2d-array' },
    }),
  );
}

/**
 * A bind group still needs a resource when an array is absent (a tier that never
 * built them). One 1x1 texture per device is enough for every such slot.
 */
const fallbackTextures = new WeakMap<GPUDevice, GPUTexture>();

function fallbackArrayView(device: GPUDevice): GPUTextureView {
  let texture = fallbackTextures.get(device);
  if (!texture) {
    texture = device.createTexture({
      label: 'Missing plant texture array',
      size: [1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING,
    });
    fallbackTextures.set(device, texture);
  }
  return texture.createView({ dimension: '2d-array' });
}

/** Bind group entries for the arrays, starting at `firstBinding`. */
export function plantTextureArrayBindGroupEntries(
  device: GPUDevice,
  textures: ReadonlyMap<PlantTextureType, GPUTexture> | null | undefined,
  firstBinding: number,
): GPUBindGroupEntry[] {
  return plantTextureArrayBindings(firstBinding).map(
    (binding, index): GPUBindGroupEntry => ({
      binding,
      resource:
        textures?.get(PLANT_TEXTURE_ARRAY_ORDER[index])?.createView({ dimension: '2d-array' }) ??
        fallbackArrayView(device),
    }),
  );
}
