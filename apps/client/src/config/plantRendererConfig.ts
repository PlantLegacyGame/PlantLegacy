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
  canopySightEnabled: boolean;
  photosynthesisVisualization: boolean;
  waterFlowVisualization: boolean;
  nutrientFlowVisualization: boolean;
  shaderQuality: string;
  maxGpuBuffers: number;
  computeShaderWorkgroupSize: number;
  tubeRingCount: number;
  tubeLengthSegments: number;
  leafCountPerNode: number;
  leafSize: number;
  leafLengthWidthRatio: number;
  petioleLength: number;
  petioleThickness: number;
  l0Distance: number;
  l1Distance: number;
  l2Distance: number;
  triangleBudgetL0: number;
  triangleBudgetL1: number;
  windStrength: number;
  windSpeed: number;
  healthTintStrength: number;
  mutation0Param: number;
  mutation1Param: number;
  mutation2Param: number;
  sminBlendRadius: number;
  maxRaymarchSteps: number;
  raymarchHitEpsilon: number;
  boundingBoxPadding: number;
  l0RaymarchSteps: number;
  l1RaymarchSteps: number;
  l2RaymarchSteps: number;
  l0RaymarchEpsilon: number;
  l1RaymarchEpsilon: number;
  l2RaymarchEpsilon: number;
  rootSides: number;
}

let plantRendererConfig: PlantRendererConfig = {
  maxNodesPerPlant: 1000,
  rootMaxDepth: 50.0,
  canopyMaxHeight: 50.0,
  nodeSpacingMin: 0.5,
  nodeSpacingMax: 2.0,
  branchProbability: 0.15,
  canopySightEnabled: true,
  photosynthesisVisualization: true,
  waterFlowVisualization: true,
  nutrientFlowVisualization: true,
  shaderQuality: 'high',
  maxGpuBuffers: 8,
  computeShaderWorkgroupSize: 64,
  tubeRingCount: 8,
  tubeLengthSegments: 8,
  leafCountPerNode: 1,
  leafSize: 1.2,
  leafLengthWidthRatio: 2.5,
  petioleLength: 0.25,
  petioleThickness: 0.015,
  l0Distance: 50.0,
  l1Distance: 150.0,
  l2Distance: 500.0,
  triangleBudgetL0: 1500,
  triangleBudgetL1: 800,
  windStrength: 0.3,
  windSpeed: 1.0,
  healthTintStrength: 0.5,
  mutation0Param: 0.0,
  mutation1Param: 1.5,
  mutation2Param: 0.3,
  sminBlendRadius: 0.25,
  maxRaymarchSteps: 16,
  raymarchHitEpsilon: 0.01,
  boundingBoxPadding: 1.2,
  l0RaymarchSteps: 16,
  l1RaymarchSteps: 10,
  l2RaymarchSteps: 6,
  l0RaymarchEpsilon: 0.005,
  l1RaymarchEpsilon: 0.012,
  l2RaymarchEpsilon: 0.025,
  rootSides: 4,
};

type ConfigPayload = Record<string, unknown> & {
  values?: Record<string, { value?: unknown }>;
};

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
        tubeRingCount: readValue(payload, 'tube_ring_count', current.tubeRingCount),
        tubeLengthSegments: readValue(payload, 'tube_length_segments', current.tubeLengthSegments),
        leafCountPerNode: readValue(payload, 'leaf_count_per_node', current.leafCountPerNode),
        leafSize: readValue(payload, 'leaf_size', current.leafSize),
        leafLengthWidthRatio: readValue(
          payload,
          'leaf_length_width_ratio',
          current.leafLengthWidthRatio,
        ),
        petioleLength: readValue(payload, 'petiole_length', current.petioleLength),
        petioleThickness: readValue(payload, 'petiole_thickness', current.petioleThickness),
        l0Distance: readValue(payload, 'l0_distance', current.l0Distance),
        l1Distance: readValue(payload, 'l1_distance', current.l1Distance),
        l2Distance: readValue(payload, 'l2_distance', current.l2Distance),
        triangleBudgetL0: readValue(payload, 'triangle_budget_l0', current.triangleBudgetL0),
        triangleBudgetL1: readValue(payload, 'triangle_budget_l1', current.triangleBudgetL1),
        windStrength: readValue(payload, 'wind_strength', current.windStrength),
        windSpeed: readValue(payload, 'wind_speed', current.windSpeed),
        healthTintStrength: readValue(payload, 'health_tint_strength', current.healthTintStrength),
        mutation0Param: readValue(payload, 'mutation_visual_0_param', current.mutation0Param),
        mutation1Param: readValue(payload, 'mutation_visual_1_param', current.mutation1Param),
        mutation2Param: readValue(payload, 'mutation_visual_2_param', current.mutation2Param),
        sminBlendRadius: readValue(payload, 'smin_blend_radius', current.sminBlendRadius),
        maxRaymarchSteps: readValue(payload, 'max_raymarch_steps', current.maxRaymarchSteps),
        raymarchHitEpsilon: readValue(payload, 'raymarch_hit_epsilon', current.raymarchHitEpsilon),
        boundingBoxPadding: readValue(payload, 'bounding_box_padding', current.boundingBoxPadding),
        l0RaymarchSteps: readValue(payload, 'l0_raymarch_steps', current.l0RaymarchSteps),
        l1RaymarchSteps: readValue(payload, 'l1_raymarch_steps', current.l1RaymarchSteps),
        l2RaymarchSteps: readValue(payload, 'l2_raymarch_steps', current.l2RaymarchSteps),
        l0RaymarchEpsilon: readValue(payload, 'l0_raymarch_epsilon', current.l0RaymarchEpsilon),
        l1RaymarchEpsilon: readValue(payload, 'l1_raymarch_epsilon', current.l1RaymarchEpsilon),
        l2RaymarchEpsilon: readValue(payload, 'l2_raymarch_epsilon', current.l2RaymarchEpsilon),
        rootSides: readValue(payload, 'root_sides', current.rootSides),
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
