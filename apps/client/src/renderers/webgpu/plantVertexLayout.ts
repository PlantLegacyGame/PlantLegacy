/**
 * The vertex layout of a built plant mesh.
 *
 * Every pipeline that consumes `buildPlantMesh` output has to declare the same
 * strides and offsets, or the shader reads positions out of the joint weights.
 * It used to be written out twice, once for the mesh pipeline and once for the
 * impostor baker, so a change to one silently misread the other.
 */

/** Bytes per vertex: 19 floats (position3 + normal3 + uv2 + packed1 + emergence2 + joints4 + weights4). */
export const PLANT_VERTEX_STRIDE = 76;

export const PLANT_VERTEX_BUFFER_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: PLANT_VERTEX_STRIDE,
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' }, // position
    { shaderLocation: 1, offset: 12, format: 'float32x3' }, // normal
    { shaderLocation: 2, offset: 24, format: 'float32x2' }, // uv
    { shaderLocation: 3, offset: 32, format: 'uint32' }, // packed
    { shaderLocation: 4, offset: 36, format: 'float32' }, // spawnTime
    { shaderLocation: 5, offset: 40, format: 'float32' }, // growthProgress
    { shaderLocation: 6, offset: 44, format: 'uint32x4' }, // jointIndices
    { shaderLocation: 7, offset: 60, format: 'float32x4' }, // jointWeights
  ],
};
