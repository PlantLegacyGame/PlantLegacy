import billboard from './billboard.wgsl?raw';
import common from './common.wgsl?raw';
import cull from './cull.wgsl?raw';
import ground from './ground.wgsl?raw';
import mesh from './mesh.wgsl?raw';
import rain from './rain.wgsl?raw';

export const cullShader = `${common}\n${cull}`;
export const groundShader = `${common}\n${ground}`;
export const meshShader = `${common}\n${mesh}`;
export const billboardShader = `${common}\n${billboard}`;
export const rainShader = `${common}\n${rain}`;
