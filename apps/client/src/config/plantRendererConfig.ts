/**
 * Plant Renderer Config Loader
 * Loads plant renderer tunables from server config
 */

export interface PlantRendererConfig {
  maxNodesPerPlant: number;
  rootMaxDepth: number;
  canopyMaxHeight: number;
  nodeSpacingMin: number;
  nodeSpacingMax: number;
  branchProbability: number;
  rootSightEnabled: boolean;
  rootSightOpacity: number;
  canopySightEnabled: boolean;
  photosynthesisVisualization: boolean;
  waterFlowVisualization: boolean;
  nutrientFlowVisualization: boolean;
  shaderQuality: string;
  maxGpuBuffers: number;
  computeShaderWorkgroupSize: number;
}

let plantRendererConfig: PlantRendererConfig = {
  maxNodesPerPlant: 1000,
  rootMaxDepth: 50.0,
  canopyMaxHeight: 50.0,
  nodeSpacingMin: 0.5,
  nodeSpacingMax: 2.0,
  branchProbability: 0.15,
  rootSightEnabled: true,
  rootSightOpacity: 0.6,
  canopySightEnabled: true,
  photosynthesisVisualization: true,
  waterFlowVisualization: true,
  nutrientFlowVisualization: true,
  shaderQuality: 'high',
  maxGpuBuffers: 8,
  computeShaderWorkgroupSize: 64,
};

export async function loadPlantRendererConfig(serverOrigin: string): Promise<PlantRendererConfig> {
  try {
    const response = await fetch(`${serverOrigin}/config/plant_renderer`, { cache: 'no-store' });
    if (response.ok) {
      const config = await response.json();
      // Extract values from extended-1 format
      const values = config.values || {};
      plantRendererConfig = {
        maxNodesPerPlant: values.max_nodes_per_plant?.value ?? plantRendererConfig.maxNodesPerPlant,
        rootMaxDepth: values.root_max_depth?.value ?? plantRendererConfig.rootMaxDepth,
        canopyMaxHeight: values.canopy_max_height?.value ?? plantRendererConfig.canopyMaxHeight,
        nodeSpacingMin: values.node_spacing_min?.value ?? plantRendererConfig.nodeSpacingMin,
        nodeSpacingMax: values.node_spacing_max?.value ?? plantRendererConfig.nodeSpacingMax,
        branchProbability:
          values.branch_probability?.value ?? plantRendererConfig.branchProbability,
        rootSightEnabled: values.root_sight_enabled?.value ?? plantRendererConfig.rootSightEnabled,
        rootSightOpacity: values.root_sight_opacity?.value ?? plantRendererConfig.rootSightOpacity,
        canopySightEnabled:
          values.canopy_sight_enabled?.value ?? plantRendererConfig.canopySightEnabled,
        photosynthesisVisualization:
          values.photosynthesis_visualization?.value ??
          plantRendererConfig.photosynthesisVisualization,
        waterFlowVisualization:
          values.water_flow_visualization?.value ?? plantRendererConfig.waterFlowVisualization,
        nutrientFlowVisualization:
          values.nutrient_flow_visualization?.value ??
          plantRendererConfig.nutrientFlowVisualization,
        shaderQuality: values.shader_quality?.value ?? plantRendererConfig.shaderQuality,
        maxGpuBuffers: values.max_gpu_buffers?.value ?? plantRendererConfig.maxGpuBuffers,
        computeShaderWorkgroupSize:
          values.compute_shader_workgroup_size?.value ??
          plantRendererConfig.computeShaderWorkgroupSize,
      };
    }
  } catch {
    // Use defaults
  }
  return plantRendererConfig;
}

export function getPlantRendererConfig(): typeof plantRendererConfig {
  return { ...plantRendererConfig };
}
