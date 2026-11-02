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

type ConfigPayload = Record<string, unknown> & {
  values?: Record<string, { value?: unknown }>;
};

/**
 * The server flattens `config/plant_renderer.json` to `{ key: value }`; raw
 * config files use `{ values: { key: { value } } }`. Accept both.
 */
function readValue<T>(payload: ConfigPayload, key: string, fallback: T): T {
  const flat = payload[key];
  if (flat !== undefined) return flat as T;

  const nested = payload.values?.[key]?.value;
  if (nested !== undefined) return nested as T;

  return fallback;
}

export async function loadPlantRendererConfig(serverOrigin: string): Promise<PlantRendererConfig> {
  try {
    const response = await fetch(`${serverOrigin}/config/plant_renderer`, { cache: 'no-store' });
    if (response.ok) {
      const payload = (await response.json()) as ConfigPayload;
      const current = plantRendererConfig;

      plantRendererConfig = {
        maxNodesPerPlant: readValue(payload, 'max_nodes_per_plant', current.maxNodesPerPlant),
        rootMaxDepth: readValue(payload, 'root_max_depth', current.rootMaxDepth),
        canopyMaxHeight: readValue(payload, 'canopy_max_height', current.canopyMaxHeight),
        nodeSpacingMin: readValue(payload, 'node_spacing_min', current.nodeSpacingMin),
        nodeSpacingMax: readValue(payload, 'node_spacing_max', current.nodeSpacingMax),
        branchProbability: readValue(payload, 'branch_probability', current.branchProbability),
        rootSightEnabled: readValue(payload, 'root_sight_enabled', current.rootSightEnabled),
        rootSightOpacity: readValue(payload, 'root_sight_opacity', current.rootSightOpacity),
        canopySightEnabled: readValue(payload, 'canopy_sight_enabled', current.canopySightEnabled),
        photosynthesisVisualization: readValue(
          payload,
          'photosynthesis_visualization',
          current.photosynthesisVisualization,
        ),
        waterFlowVisualization: readValue(
          payload,
          'water_flow_visualization',
          current.waterFlowVisualization,
        ),
        nutrientFlowVisualization: readValue(
          payload,
          'nutrient_flow_visualization',
          current.nutrientFlowVisualization,
        ),
        shaderQuality: readValue(payload, 'shader_quality', current.shaderQuality),
        maxGpuBuffers: readValue(payload, 'max_gpu_buffers', current.maxGpuBuffers),
        computeShaderWorkgroupSize: readValue(
          payload,
          'compute_shader_workgroup_size',
          current.computeShaderWorkgroupSize,
        ),
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
