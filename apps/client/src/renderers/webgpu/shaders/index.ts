import billboard from './billboard.wgsl?raw';
import common from './common.wgsl?raw';
import cull from './cull.wgsl?raw';
import groundMap from './groundMap.wgsl?raw';
import impostor from './impostor.wgsl?raw';
import mesh from './mesh.wgsl?raw';
import rain from './rain.wgsl?raw';
import skinning from './skinning.wgsl?raw';

export const cullShader = `${common}\n${cull}`;
export const impostorShader = `${common}\n${impostor}`;
// The ground march binds a texture the impostor and billboard layouts do not
// declare, so it reaches only the two passes that occlude against the terrain.
export const meshShader = `${common}\n${skinning}\n${groundMap}\n${mesh}`;
export const billboardShader = `${common}\n${billboard}`;
export const rainShader = `${common}\n${groundMap}\n${rain}`;
