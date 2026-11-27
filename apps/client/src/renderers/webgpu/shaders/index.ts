import common from './common.wgsl?raw';
import cull from './cull.wgsl?raw';
import groundMap from './groundMap.wgsl?raw';
import impostor from './impostor.wgsl?raw';
import mesh from './mesh.wgsl?raw';
import rain from './rain.wgsl?raw';
import skinning from './skinning.wgsl?raw';

export const cullShader = `${common}\n${cull}`;
// The impostor ray is hidden behind a ridge as well as behind the planet, so it
// traces the same ground map the mesh pass does.
export const impostorShader = `${common}\n${groundMap}\n${impostor}`;
// The ground march binds a texture the cull layout does not declare, so it
// reaches only the passes that occlude against the terrain.
export const meshShader = `${common}\n${skinning}\n${groundMap}\n${mesh}`;
export const rainShader = `${common}\n${groundMap}\n${rain}`;
