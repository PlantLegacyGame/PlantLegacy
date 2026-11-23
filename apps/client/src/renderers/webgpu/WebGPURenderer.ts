import { mulberry32 } from '@plant-legacy/shared/math';
import * as THREE from 'three';
import { type MutationLookStack, NEUTRAL_STACK } from '../plant/mutations.ts';
import type { PlantNodeData } from '../plant/plantNodeData.js';
import { ImpostorAtlasSlots } from './impostorAtlasSlots.js';
import { jointMatrixFor } from './jointMatrix.js';
import { buildPlantMesh, type PlantRenderPlant } from './PlantMeshBuilder.js';
import {
  PLANT_TEXTURE_ARRAY_ORDER,
  PLANT_TEXTURE_TYPE_NAMES,
  PlantTextureType,
  plantTextureArrayBindGroupEntries,
  plantTextureArrayLayoutEntries,
} from './plantTextureBindings.js';
import { PLANT_VERTEX_BUFFER_LAYOUT, PLANT_VERTEX_STRIDE } from './plantVertexLayout.js';
import {
  billboardShader,
  cullShader,
  impostorShader,
  meshShader,
  rainShader,
} from './shaders/index.js';
import type { WebGPUDevice } from './WebGPUDevice.js';

/**
 * WebGPU plant renderer (v1).
 *
 * The WebGL2 renderer keeps ownership of the environment (sky, terrain,
 * weather). This renderer draws plants into a transparent WebGPU canvas layered
 * over it. Plants are uploaded as one merged mesh; a compute pass culls and
 * assigns each plant a LOD tier, then the mesh pass draws close plants and the
 * billboard pass draws distant ones.
 */

const FRAME_FLOATS = 96;
/**
 * The f32 fields of `FrameUniforms` in `shaders/common.wgsl`, in order.
 *
 * The frame buffer is written by index, so a field added to one side and not the
 * other silently shifts every value after it. This list is asserted against the
 * WGSL source in a test, which is the only way to catch that without a GPU.
 */
export const FRAME_UNIFORM_FIELDS = [
  'viewProjection',
  'projection',
  'cameraPos',
  'cameraRight',
  'cameraUp',
  'cameraForward',
  'sunDirection',
  'ownRootColor',
  'rivalRootColor',
  'rootSightCenter',
  'time',
  'windStrength',
  'windSpeed',
  'healthTintStrength',
  'mutation0Param',
  'mutation1Param',
  'mutation2Param',
  'viewportHeight',
  'rootSightEnabled',
  'rootSightProgress',
  'rootSightRadius',
  'rootSightAuraRadius',
  'rootAuraNodeCount',
  'tierThreshold0',
  'tierThreshold1',
  'tierThreshold2',
  'tierThreshold3',
  'hysteresisPromote',
  'hysteresisDemote',
  'minDwellTime',
  'pointSizeScale',
  'proj11',
  'deltaTime',
  'rootSightSoilOpacity',
  'planetCenterX',
  'planetCenterY',
  'planetCenterZ',
  'planetRadius',
  'cameraUnderSoil',
  'rootSightApertureRadius',
  'rootSightEyeWindow',
  'sunWarmth',
] as const;
const FRAME_BYTES = FRAME_FLOATS * 4;
const PLANT_FLOATS = 12;
const PLANT_STRIDE = PLANT_FLOATS * 4;
const RENDER_STRIDE = 16;
const WORKGROUP_SIZE = 64;
const MAX_JOINTS_PER_PLANT = 64;
const JOINT_MATRIX_STRIDE = 64; // 16 floats = 64 bytes per mat4x4
const JOINT_BUFFER_STRIDE = MAX_JOINTS_PER_PLANT * JOINT_MATRIX_STRIDE; // 64 * 64 = 4096 bytes per plant

/** Impostor baking configuration */
const IMPOSTOR_ATLAS_SIZE = 1024;
const IMPOSTOR_VIEWS_HORIZONTAL = 8; // 8 horizontal angles (0-360)
const IMPOSTOR_VIEWS_VERTICAL = 2; // 2 vertical angles (top, side)
const IMPOSTOR_VIEWS = IMPOSTOR_VIEWS_HORIZONTAL * IMPOSTOR_VIEWS_VERTICAL; // 16 views per plant
const IMPOSTOR_TILE_SIZE = IMPOSTOR_ATLAS_SIZE / IMPOSTOR_VIEWS_HORIZONTAL; // 128x128 per view

/**
 * Scratch for the impostor view matrices.
 *
 * They depend only on a plant's radius, but a bake used to rebuild them with
 * fresh vectors, matrices and a 1KB Float32Array for every plant it touched.
 */
const IMPOSTOR_EYE = new THREE.Vector3();
const IMPOSTOR_TARGET = new THREE.Vector3(0, 0, 0);
const IMPOSTOR_UP = new THREE.Vector3(0, 1, 0);
const IMPOSTOR_VIEW_MATRIX = new THREE.Matrix4();
const IMPOSTOR_PROJECTION_MATRIX = new THREE.Matrix4();
const IMPOSTOR_VIEW_PROJECTION = new THREE.Matrix4();

/** `Matrix4.makePerspective` exists at runtime but not in three's types. */
function makePerspectiveMatrix(
  matrix: THREE.Matrix4,
  fov: number,
  aspect: number,
  near: number,
  far: number,
): THREE.Matrix4 {
  return (
    matrix as unknown as {
      makePerspective: (fov: number, aspect: number, near: number, far: number) => THREE.Matrix4;
    }
  ).makePerspective(fov, aspect, near, far);
}

/**
 * One plant look record: five organ families (foliage, woody, seed, bloom,
 * disc), each four vec4f. Mirrors `PlantLook` in common.wgsl.
 */
const LOOK_ORGAN_VEC4S = 4;
const LOOK_ORGAN_COUNT = 5;
const LOOK_VEC4_BYTES = 16;
const LOOK_BYTES_PER_PLANT = LOOK_ORGAN_COUNT * LOOK_ORGAN_VEC4S * LOOK_VEC4_BYTES;
const LOOK_FLOATS_PER_PLANT = LOOK_ORGAN_COUNT * LOOK_ORGAN_VEC4S * 4;

/** Pattern ids the shader understands (0 = none). */
const LOOK_PATTERN_ID: Record<string, number> = {
  none: 0,
  mottle: 1,
  spots: 2,
  stripes: 3,
  veins: 4,
  sheen: 5,
  glow: 6,
};

/**
 * Write one composed look into the storage layout the shaders read.
 *
 * Every value was composed and clamped in `plant/mutations.ts`; this only packs
 * it. Keeping the packing in one place is what lets the shader stay a painter.
 */
function writePlantLook(data: Float32Array, offset: number, stack: MutationLookStack): void {
  const families = [
    stack.looks.foliage,
    stack.looks.woody,
    stack.looks.seed,
    stack.looks.bloom,
    stack.disc,
  ];
  for (let organ = 0; organ < families.length; organ += 1) {
    const look = families[organ];
    const base = offset + organ * LOOK_ORGAN_VEC4S * 4;
    const pattern = LOOK_PATTERN_ID[look.pattern] ?? 0;
    data[base + 0] = look.tint[0];
    data[base + 1] = look.tint[1];
    data[base + 2] = look.tint[2];
    data[base + 3] = look.tintStrength;
    data[base + 4] = look.variegationColor[0];
    data[base + 5] = look.variegationColor[1];
    data[base + 6] = look.variegationColor[2];
    data[base + 7] = look.variegation;
    data[base + 8] = look.glowColor[0];
    data[base + 9] = look.glowColor[1];
    data[base + 10] = look.glowColor[2];
    data[base + 11] = look.glow;
    data[base + 12] = pattern;
    data[base + 13] = look.patternScale;
    data[base + 14] = look.barkDarken;
    data[base + 15] = 0;
  }
}

/** Mesh growth easing in PlantMeshBuilder lasts 0.9 s; keep rebuilding a little longer. */
const GROWTH_ACTIVE_MS = 1100;
const GROWTH_REBUILD_INTERVAL_MS = 100;

export interface WebGPURendererConfig {
  maxPlants: number;
  leafSize: number;
  leafCountPerNode: number;
  tubeSides: number;
  rootSides: number;
  /** Ring every this many metres along a drawn tube. */
  chainRingSpacingM: number;
  /** How far a drawn tube's polyline may sag off its curve, in metres. */
  chainSagittaTolM: number;
  tierThresholds: [number, number, number, number];
  hysteresisPromote: number;
  hysteresisDemote: number;
  minDwellTime: number;
  windStrength: number;
  windSpeed: number;
  healthTintStrength: number;
  mutation0Param: number;
  mutation1Param: number;
  mutation2Param: number;
  /** C02b mutation signature strengths (config/plant_renderer.json). */
  mutationBioluminescence: number;
  mutationBarkThicknessScale: number;
  mutationVariegation: number;
  /** Radius of the body the world sits on; 0 disables planet occlusion. */
  planetRadius: number;
  ownRootColor: string;
  rivalRootColor: string;
  pointSizeScale: number;
  // C02b: Rain rendering
  rainStreakLength: number;
  rainStreakWidth: number;
  rainMaxVelocity: number;
  rainParticleCount: number;
  rainBoxWidth: number;
  rainBoxHeight: number;
  // C02b: Impostor baking
  impostorEnabled: boolean;
  impostorUpdateIntervalMs: number;
  // C02b: VRAM budgeting
  vramBudgetBytes: number;
  vramMaxVertexBytes: number;
  vramMaxIndexBytes: number;
  /** Variation layers in the plant texture array. */
  textureArrayLayers: number;
  /** Edge length of one texture-array layer, in texels. */
  textureArraySize: number;
}

export const DEFAULT_WEBGPU_RENDERER_CONFIG: WebGPURendererConfig = {
  maxPlants: 10000,
  leafSize: 0.25,
  leafCountPerNode: 1,
  tubeSides: 8,
  // Roots read as faceted spikes below eight sides; they taper to a point.
  rootSides: 8,
  chainRingSpacingM: 0.05,
  chainSagittaTolM: 0.0015,
  tierThresholds: [300, 80, 12, 2],
  hysteresisPromote: 1.15,
  hysteresisDemote: 0.85,
  minDwellTime: 0.5,
  windStrength: 0.3,
  windSpeed: 1.0,
  healthTintStrength: 0.5,
  mutation0Param: 0,
  mutation1Param: 1.5,
  mutation2Param: 0.3,
  mutationBioluminescence: 0.55,
  mutationBarkThicknessScale: 1.35,
  mutationVariegation: 0.35,
  planetRadius: 0,
  ownRootColor: '#4CAF50',
  rivalRootColor: '#FF5722',
  pointSizeScale: 1.0,
  // C02b: Rain rendering
  rainStreakLength: 25.0,
  rainStreakWidth: 0.02,
  rainMaxVelocity: 35.0,
  rainParticleCount: 1500,
  rainBoxWidth: 60.0,
  rainBoxHeight: 35.0,
  // C02b: Impostor baking
  impostorEnabled: true,
  impostorUpdateIntervalMs: 5000,
  // C02b: VRAM budgeting
  vramBudgetBytes: 256 * 1024 * 1024,
  vramMaxVertexBytes: 64 * 1024 * 1024,
  vramMaxIndexBytes: 16 * 1024 * 1024,
  textureArrayLayers: 16,
  textureArraySize: 256,
};

/** C02b: Simple VRAM pool allocator for buffer management */
class VRAMPool {
  private device: GPUDevice;
  private budgetBytes: number;
  private allocatedBytes = 0;
  private allocations = new Map<string, { buffer: GPUBuffer; size: number; label: string }>();

  constructor(device: GPUDevice, budgetBytes: number) {
    this.device = device;
    this.budgetBytes = budgetBytes;
  }

  allocate(label: string, size: number, usage: GPUBufferUsageFlags): GPUBuffer | null {
    if (this.allocatedBytes + size > this.budgetBytes) {
      console.warn(
        `[VRAMPool] Allocation ${label} (${(size / 1024 / 1024).toFixed(2)} MB) would exceed budget`,
      );
      return null;
    }

    const buffer = this.device.createBuffer({
      label,
      size,
      usage,
    });

    this.allocations.set(label, { buffer, size, label });
    this.allocatedBytes += size;
    return buffer;
  }

  free(label: string): void {
    const alloc = this.allocations.get(label);
    if (alloc) {
      alloc.buffer.destroy();
      this.allocatedBytes -= alloc.size;
      this.allocations.delete(label);
    }
  }

  getAllocatedBytes(): number {
    return this.allocatedBytes;
  }

  getBudgetBytes(): number {
    return this.budgetBytes;
  }

  getUsagePercent(): number {
    return this.allocatedBytes / this.budgetBytes;
  }

  destroy(): void {
    for (const alloc of this.allocations.values()) {
      alloc.buffer.destroy();
    }
    this.allocations.clear();
    this.allocatedBytes = 0;
  }
}

export class WebGPURenderer {
  private readonly device: WebGPUDevice;
  private readonly config: WebGPURendererConfig;
  private readonly appearanceByPlant = new Map<
    string,
    { petalCount: number; leafScale: number; seedScale: number }
  >();
  // T04 appearance: the composed look per plant, keyed by plant id ('own' and
  // 'rival' stand in for a plant the client has no id for).
  private readonly lookByPlant = new Map<string, MutationLookStack>();
  /** Per-plant look records the mesh and billboard passes read. */
  private plantLookBuffer: GPUBuffer | null = null;

  private initialized = false;
  private camera: THREE.PerspectiveCamera | null = null;

  private frameUniformBuffer: GPUBuffer | null = null;
  // Ground palette + moisture: 3 vec4 colours, moisture, padding = 16 floats.
  /**
   * AL-03 draw-distance lever: multiplies the projected-size tier thresholds.
   * Below 1 a plant must be closer before it earns a detailed tier, so the
   * band controller spends draw distance before it drops the whole tier.
   */
  private lodThresholdScale = 1;
  private plantBuffer: GPUBuffer | null = null;
  private renderBuffer: GPUBuffer | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private indexBuffer: GPUBuffer | null = null;
  private jointBuffer: GPUBuffer | null = null;
  private depthTexture: GPUTexture | null = null;

  private computePipeline: GPUComputePipeline | null = null;
  private meshPipeline: GPURenderPipeline | null = null;
  private sharedPipelineLayout: GPUPipelineLayout | null = null;
  private billboardPipeline: GPURenderPipeline | null = null;
  private rainPipeline: GPURenderPipeline | null = null;

  private computeBindGroup: GPUBindGroup | null = null;
  private meshBindGroup: GPUBindGroup | null = null;
  private billboardBindGroup: GPUBindGroup | null = null;
  private rainBindGroup: GPUBindGroup | null = null;

  private rainVertexBuffer: GPUBuffer | null = null;
  private rainInstanceBuffer: GPUBuffer | null = null;
  private rainUniformBuffer: GPUBuffer | null = null;

  // C02b: Texture arrays for plant variation
  private textureArrays: Map<PlantTextureType, GPUTexture> | null = null;
  private textureArraySampler: GPUSampler | null = null;

  // C02b: Billboard impostor baking
  private impostorAtlasTexture: GPUTexture | null = null;
  private impostorAtlasSampler: GPUSampler | null = null;
  private impostorDepthTexture: GPUTexture | null = null;
  private impostorPipeline: GPURenderPipeline | null = null;
  private impostorBindGroup: GPUBindGroup | null = null;
  private impostorViewsUniformBuffer: GPUBuffer | null = null;
  private impostorTargetBuffer: GPUBuffer | null = null;
  private impostorSlotsBuffer: GPUBuffer | null = null;
  private lastImpostorBakeTime = Number.NEGATIVE_INFINITY;
  /**
   * A bake is running from its readback to its submit.
   *
   * `lastImpostorBakeTime` is only stamped at the *end* of a bake, so the
   * interval check alone let every frame during the readback start another bake
   * of the same plants: each one allocated its own staging buffer, baked the
   * same plant into a second atlas slot (the first slot is then permanently
   * unreachable, because `nextImpostorSlot` already moved past it), and
   * submitted an extra command buffer.
   */
  private impostorBakeInFlight = false;
  /** Atlas tiles, keyed by plant id; see `impostorAtlasSlots.ts` for why. */
  private readonly impostorSlots = new ImpostorAtlasSlots(
    Math.floor(IMPOSTOR_ATLAS_SIZE / IMPOSTOR_TILE_SIZE),
    Math.floor(IMPOSTOR_ATLAS_SIZE / IMPOSTOR_TILE_SIZE),
  );
  /** One 16-layer bake target, reused; a bake used to allocate and destroy one. */
  private impostorViewTexture: GPUTexture | null = null;
  private readonly impostorViewMatrices = new Float32Array(IMPOSTOR_VIEWS * 16);
  /** The radius the matrices above were built for; they depend on nothing else. */
  private impostorViewDistance = Number.NaN;
  private impostorSlotData: Uint32Array<ArrayBuffer> | null = null;

  // C02b: VRAM pool for budgeting
  private vramPool: VRAMPool | null = null;

  private vertexCapacityBytes = 0;
  private indexCapacityBytes = 0;
  private vertexCount = 0;
  private indexCount = 0;
  private plantCount = 0;
  private rainParticleCount = 0;

  private pendingNodes: PlantNodeData[] = [];
  private pendingNowMs = 0;
  private lastBuildTimeMs = Number.NEGATIVE_INFINITY;
  private lastBuildNodeCount = -1;
  // Store plant render data (center, radius, etc.) for impostor baking
  private plantRenderData: PlantRenderPlant[] = [];

  private readonly frameData = new Float32Array(FRAME_FLOATS);
  private readonly frameU32 = new Uint32Array(this.frameData.buffer);
  private readonly viewProjection = new THREE.Matrix4();
  private readonly sunDirection = new THREE.Vector3(0.45, 1, 0.35);
  /** Golden-hour warmth from the environment, 0..1 (see `setSunWarmth`). */
  private sunWarmth = 0;
  private readonly rootSightCenter = new THREE.Vector3();
  private readonly ownRootColor = new THREE.Color(DEFAULT_WEBGPU_RENDERER_CONFIG.ownRootColor);
  private readonly rivalRootColor = new THREE.Color(DEFAULT_WEBGPU_RENDERER_CONFIG.rivalRootColor);
  // Pre-allocated per-frame uniform buffers to avoid GC pressure in the render loop
  private readonly rainUniformData = new Float32Array(8);
  private jointData: Float32Array;

  public rootSightEnabled = false;
  private rootSightProgress = 0;
  public rootSightRadius = 6;

  /** Camera is under the surface with Root Sight open: hide the surface sheet. */
  public undergroundView = false;

  public setUndergroundView(enabled: boolean): void {
    this.undergroundView = enabled;
  }
  private rootSightAuraRadius = 3.0;
  /** Radius of the hole cut in the soil, in plan view (0 = unknown). */
  private rootSightApertureRadius = 0;
  /** Air bubble around a buried eye, metres (`eye_window_radius_m`). */
  private rootSightEyeWindow = 0;
  /** The eye is below the soil surface while Root Sight is open. */
  private cameraUnderSoil = false;
  private rootSightSoilOpacity = 0.45;
  // Shader time base. Vertex spawnTime values come from performance.now()/1000,
  // so anchor frame.time to the same clock instead of starting at zero.
  private time = performance.now() / 1000;
  private deltaTime = 0;

  constructor(device: WebGPUDevice, config: Partial<WebGPURendererConfig> = {}) {
    this.device = device;
    this.config = { ...DEFAULT_WEBGPU_RENDERER_CONFIG, ...config };
    this.ownRootColor.set(this.config.ownRootColor);
    this.rivalRootColor.set(this.config.rivalRootColor);
    // Pre-allocate joint matrix buffer to avoid per-frame GC pressure
    this.jointData = new Float32Array((this.config.maxPlants * JOINT_BUFFER_STRIDE) / 4);
  }

  async initialize(): Promise<boolean> {
    const device = this.device.getDevice();
    if (!device) {
      return false;
    }

    try {
      // C02b: Initialize VRAM pool for budgeting
      this.vramPool = new VRAMPool(device, this.config.vramBudgetBytes);

      const cullModule = await this.createShaderModule(device, cullShader, 'plant-cull');
      const meshModule = await this.createShaderModule(device, meshShader, 'plant-mesh');
      const billboardModule = await this.createShaderModule(
        device,
        billboardShader,
        'plant-billboard',
      );
      const rainModule = await this.createShaderModule(device, rainShader, 'rain');

      this.createBuffers(device);
      this.createRainVertexBuffer(device);
      await this.createPipelines(device, cullModule, meshModule, billboardModule, rainModule);
      this.recreateDepthTexture();

      this.initialized = true;
      console.log('WebGPU plant renderer initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize WebGPU plant renderer:', error);
      this.destroy();
      return false;
    }
  }

  private async createShaderModule(
    device: GPUDevice,
    code: string,
    label: string,
  ): Promise<GPUShaderModule> {
    const module = device.createShaderModule({ label, code });
    if (typeof module.getCompilationInfo !== 'function') {
      return module;
    }

    const info = await module.getCompilationInfo();
    const errors = info.messages.filter((message) => message.type === 'error');
    if (errors.length > 0) {
      const detail = errors
        .map((message) => `${message.lineNum}:${message.linePos} ${message.message}`)
        .join('\n');
      throw new Error(`WGSL compilation failed for ${label}:\n${detail}`);
    }

    for (const message of info.messages) {
      if (message.type === 'warning') {
        console.warn(`WGSL warning in ${label} (${message.lineNum}): ${message.message}`);
      }
    }

    return module;
  }

  private createBuffers(device: GPUDevice): void {
    if (!this.vramPool) {
      throw new Error('VRAM pool not initialized');
    }

    const allocateOrThrow = (
      label: string,
      size: number,
      usage: GPUBufferUsageFlags,
    ): GPUBuffer => {
      const buffer = this.vramPool?.allocate(label, size, usage);
      if (!buffer) {
        throw new Error(
          `VRAM allocation failed for ${label} (${(size / 1024 / 1024).toFixed(2)} MB)`,
        );
      }
      return buffer;
    };

    this.frameUniformBuffer = allocateOrThrow(
      'WebGPU frame uniforms',
      FRAME_BYTES,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );

    this.plantBuffer = allocateOrThrow(
      'WebGPU plant data',
      this.config.maxPlants * PLANT_STRIDE,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );

    this.renderBuffer = allocateOrThrow(
      'WebGPU render data',
      this.config.maxPlants * RENDER_STRIDE,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    );

    // T04 appearance: one composed look per plant, read by the mesh and
    // billboard passes. Allocated for the full plant budget so the bind group
    // never has to be rebuilt mid-session.
    this.plantLookBuffer = allocateOrThrow(
      'WebGPU plant looks',
      this.config.maxPlants * LOOK_BYTES_PER_PLANT,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );

    // Rain uniform buffer
    const RAIN_UNIFORM_BYTES = 32; // 8 f32s = 32 bytes
    this.rainUniformBuffer = allocateOrThrow(
      'WebGPU rain uniforms',
      RAIN_UNIFORM_BYTES,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );

    // C02b: Texture arrays for plant variation
    // Create procedural texture arrays for different plant part types
    this.textureArrays = new Map<PlantTextureType, GPUTexture>();
    this.textureArraySampler = device.createSampler({
      label: 'Texture array sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'repeat',
      addressModeV: 'repeat',
    });
    this.createTextureArrays(device);

    // C02b: Impostor atlas texture for billboard baking
    // 2D texture array: 16 views per plant, max 10000 plants = 160k layers (too many)
    // Instead use a 2D atlas: 1024x1024 with 8x2 tiles = 16 views, each plant gets a row
    // For maxPlants=10000, we'd need 10000 rows = too large
    // Practical approach: bake impostors only for visible plants in billboard tiers (2-4)
    // Use a smaller atlas with LRU eviction
    this.impostorAtlasTexture = device.createTexture({
      label: 'Impostor atlas',
      size: { width: IMPOSTOR_ATLAS_SIZE, height: IMPOSTOR_ATLAS_SIZE, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST,
    });

    this.impostorAtlasSampler = device.createSampler({
      label: 'Impostor atlas sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    // Impostor uniform buffer for per-view projection matrices (16 views * 64 bytes)
    const IMPOSTOR_UNIFORM_BYTES = 16 * 64;
    this.impostorViewsUniformBuffer = allocateOrThrow(
      'Impostor view uniforms',
      IMPOSTOR_UNIFORM_BYTES,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );

    // Impostor target plant index uniform (16 bytes = 4 u32)
    this.impostorTargetBuffer = allocateOrThrow(
      'Impostor target plant index',
      16,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );

    // Impostor slots buffer (plant index -> atlas slot x,y)
    // 2 u32 per plant = 8 bytes per plant
    const IMPOSTOR_SLOTS_BYTES = this.config.maxPlants * 8;
    this.impostorSlotsBuffer = allocateOrThrow(
      'Impostor slots',
      IMPOSTOR_SLOTS_BYTES,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );

    // C02b: GPU skinning - joint buffer for bone matrices
    // Each plant has up to MAX_JOINTS_PER_PLANT joints, each joint is a mat4x4 (64 bytes)
    const JOINT_BUFFER_BYTES = this.config.maxPlants * JOINT_BUFFER_STRIDE;
    this.jointBuffer = allocateOrThrow(
      'Joint matrices',
      JOINT_BUFFER_BYTES,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );

    // Start every plant at the lowest tier with a full dwell timer so the first
    // compute dispatch is allowed to promote it immediately.
    const initial = new Float32Array(this.config.maxPlants * PLANT_FLOATS);
    const initialU32 = new Uint32Array(initial.buffer);
    for (let i = 0; i < this.config.maxPlants; i += 1) {
      initialU32[i * PLANT_FLOATS + 8] = 4;
      initial[i * PLANT_FLOATS + 9] = 1;
    }
    device.queue.writeBuffer(this.plantBuffer, 0, initial);
  }

  private async createPipelines(
    device: GPUDevice,
    cullModule: GPUShaderModule,
    meshModule: GPUShaderModule,
    billboardModule: GPUShaderModule,
    rainModule: GPUShaderModule,
  ): Promise<void> {
    const presentationFormat = this.device.getPresentationFormat();

    this.computePipeline = device.createComputePipeline({
      label: 'Plant cull pipeline',
      layout: 'auto',
      compute: { module: cullModule, entryPoint: 'main' },
    });

    // Create the shared pipeline layout for the mesh pipelines
    // Both use the same shader module with the same bind group layout
    this.sharedPipelineLayout = device.createPipelineLayout({
      label: 'Plant shared pipeline layout',
      bindGroupLayouts: [
        device.createBindGroupLayout({
          label: 'Plant shared bind group layout',
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: { type: 'uniform' },
            },
            {
              binding: 1,
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: { type: 'read-only-storage' },
            },
            {
              binding: 2,
              visibility: GPUShaderStage.VERTEX,
              buffer: { type: 'read-only-storage' },
            },
            // C02b: texture arrays for plant variation (bindings 3-7).
            ...plantTextureArrayLayoutEntries(3),
            { binding: 8, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
            // T04 appearance: composed looks, one record per plant.
            {
              binding: 9,
              visibility: GPUShaderStage.FRAGMENT,
              buffer: { type: 'read-only-storage' },
            },
          ],
        }),
      ],
    });

    this.meshPipeline = device.createRenderPipeline({
      label: 'Plant mesh pipeline',
      layout: this.sharedPipelineLayout,
      vertex: {
        module: meshModule,
        entryPoint: 'vs_main',
        buffers: [PLANT_VERTEX_BUFFER_LAYOUT],
      },
      fragment: {
        module: meshModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format: presentationFormat,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              // Straight-alpha color blending already stores premultiplied RGB in
              // the framebuffer, so alpha must accumulate as srcAlpha * 1 + dst * (1-a).
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    // Explicit layout for billboards: the shader declares all plant texture
    // arrays plus the impostor atlas, and some of them are not statically used
    // on every code path, so "auto" would omit bindings the bind group provides.
    const billboardBindGroupLayout = device.createBindGroupLayout({
      label: 'Plant billboard bind group layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'read-only-storage' },
        },
        ...plantTextureArrayLayoutEntries(3),
        { binding: 8, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 9, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 10, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        {
          binding: 11,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 12,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'read-only-storage' },
        },
      ],
    });

    this.billboardPipeline = device.createRenderPipeline({
      label: 'Plant billboard pipeline',
      layout: device.createPipelineLayout({
        label: 'Plant billboard pipeline layout',
        bindGroupLayouts: [billboardBindGroupLayout],
      }),
      vertex: { module: billboardModule, entryPoint: 'vs_main', buffers: [] },
      fragment: {
        module: billboardModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format: presentationFormat,
            blend: {
              color: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
      },
    });

    // C02b: Impostor baking pipeline - renders plants to atlas from multiple views
    const impostorModule = await this.createShaderModule(device, impostorShader, 'plant-impostor');

    this.impostorPipeline = device.createRenderPipeline({
      label: 'Plant impostor pipeline',
      layout: 'auto',
      vertex: {
        module: impostorModule,
        entryPoint: 'vs_main',
        buffers: [PLANT_VERTEX_BUFFER_LAYOUT],
      },
      fragment: {
        module: impostorModule,
        entryPoint: 'fs_main',
        targets: [{ format: 'rgba8unorm' }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    // Rain pipeline (transparent, renders after plants)
    this.rainPipeline = device.createRenderPipeline({
      label: 'Rain pipeline',
      layout: 'auto',
      vertex: {
        module: rainModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 16, // position(12) + velocity(4)
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32' },
            ],
          },
          {
            arrayStride: 16, // instance data: position(12) + velocity(4)
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 2, offset: 0, format: 'float32x3' }, // instance position
              { shaderLocation: 3, offset: 12, format: 'float32' }, // instance velocity
            ],
          },
        ],
      },
      fragment: {
        module: rainModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format: presentationFormat,
            blend: {
              color: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
      },
    });

    if (!this.frameUniformBuffer || !this.plantBuffer || !this.renderBuffer) {
      throw new Error('WebGPU buffers were not created');
    }
    const frameBinding = { buffer: this.frameUniformBuffer };
    const plantBinding = { buffer: this.plantBuffer };
    const renderBinding = { buffer: this.renderBuffer };

    this.computeBindGroup = device.createBindGroup({
      label: 'Plant cull bind group',
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: frameBinding },
        { binding: 1, resource: plantBinding },
        { binding: 2, resource: renderBinding },
      ],
    });

    // The mesh shader reads the frame uniform, render data, and joint matrices
    this.meshBindGroup = device.createBindGroup({
      label: 'Plant mesh bind group',
      layout: this.meshPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: frameBinding },
        { binding: 1, resource: renderBinding },
        {
          binding: 2,
          resource: this.jointBuffer
            ? { buffer: this.jointBuffer }
            : { buffer: device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE }) },
        },
        // C02b: texture arrays for plant variation (bindings 3-7).
        ...plantTextureArrayBindGroupEntries(device, this.textureArrays, 3),
        { binding: 8, resource: this.textureArraySampler ?? device.createSampler() },
        {
          binding: 9,
          resource: {
            buffer:
              this.plantLookBuffer ??
              device.createBuffer({ size: 320, usage: GPUBufferUsage.STORAGE }),
          },
        },
      ],
    });

    // Rain pipeline bind group
    if (!this.rainUniformBuffer) {
      throw new Error('Rain uniform buffer not created');
    }

    this.rainBindGroup = device.createBindGroup({
      label: 'Rain bind group',
      layout: this.rainPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: frameBinding },
        { binding: 1, resource: { buffer: this.rainUniformBuffer } },
      ],
    });

    // C02b: Impostor bind group for baking
    if (!this.impostorPipeline || !this.impostorViewsUniformBuffer || !this.impostorTargetBuffer) {
      throw new Error('Impostor pipeline or uniform buffer not created');
    }
    if (!this.frameUniformBuffer || !this.renderBuffer) {
      return;
    }
    this.impostorBindGroup = device.createBindGroup({
      label: 'Impostor bind group',
      layout: this.impostorPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.frameUniformBuffer } },
        { binding: 1, resource: { buffer: this.renderBuffer } },
        { binding: 2, resource: { buffer: this.impostorTargetBuffer } },
        { binding: 3, resource: { buffer: this.impostorViewsUniformBuffer } },
        // C02b: texture arrays for plant variation (bindings 4-8).
        ...plantTextureArrayBindGroupEntries(device, this.textureArrays, 4),
        { binding: 9, resource: this.textureArraySampler ?? device.createSampler() },
        {
          binding: 10,
          resource: {
            buffer:
              this.plantLookBuffer ??
              device.createBuffer({ size: 320, usage: GPUBufferUsage.STORAGE }),
          },
        },
      ],
    });

    // Billboard bind group (with impostor atlas for C02b)
    this.billboardBindGroup = device.createBindGroup({
      label: 'Plant billboard bind group',
      layout: this.billboardPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: frameBinding },
        { binding: 1, resource: renderBinding },
        { binding: 2, resource: plantBinding },
        // C02b: texture arrays for plant variation (bindings 3-7).
        ...plantTextureArrayBindGroupEntries(device, this.textureArrays, 3),
        { binding: 8, resource: this.textureArraySampler ?? device.createSampler() },
        {
          binding: 9,
          resource:
            this.impostorAtlasTexture?.createView() ??
            device
              .createTexture({
                size: [1, 1],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING,
              })
              .createView(),
        },
        { binding: 10, resource: this.impostorAtlasSampler ?? device.createSampler() },
        {
          binding: 11,
          resource: this.impostorSlotsBuffer
            ? { buffer: this.impostorSlotsBuffer }
            : { buffer: device.createBuffer({ size: 8, usage: GPUBufferUsage.STORAGE }) },
        },
        {
          binding: 12,
          resource: {
            buffer:
              this.plantLookBuffer ??
              device.createBuffer({ size: 320, usage: GPUBufferUsage.STORAGE }),
          },
        },
      ],
    });
  }

  private recreateDepthTexture(): void {
    const device = this.device.getDevice();
    if (!device) {
      return;
    }

    this.depthTexture?.destroy();
    const canvas = this.device.getCanvas();
    this.depthTexture = device.createTexture({
      label: 'WebGPU plant depth',
      size: {
        width: Math.max(1, canvas.width),
        height: Math.max(1, canvas.height),
      },
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  setCamera(camera: THREE.PerspectiveCamera): void {
    this.camera = camera;
  }

  setSunDirection(direction: THREE.Vector3): void {
    if (direction.lengthSq() > 1e-8) {
      this.sunDirection.copy(direction).normalize();
    }
  }

  /** Warmth of the light, 0 (high sun) to 1 (on the horizon). Drives backlight. */
  setSunWarmth(warmth: number): void {
    this.sunWarmth = Math.min(1, Math.max(0, warmth));
  }

  setRootSight(
    enabled: boolean,
    progress: number,
    center: THREE.Vector3,
    radius: number,
    auraRadius = 3.0,
    soilOpacity = 0.45,
    apertureRadius = 0,
    eyeWindowRadius = 0,
  ): void {
    this.rootSightEnabled = enabled;
    this.rootSightProgress = THREE.MathUtils.clamp(progress, 0, 1);
    this.rootSightCenter.copy(center);
    this.rootSightRadius = Math.max(0.1, radius);
    this.rootSightAuraRadius = Math.max(0.1, auraRadius);
    this.rootSightSoilOpacity = THREE.MathUtils.clamp(soilOpacity, 0, 1);
    this.rootSightApertureRadius = Math.max(0, apertureRadius);
    this.rootSightEyeWindow = Math.max(0, eyeWindowRadius);
  }

  /**
   * Whether the eye is under the soil surface.
   *
   * Told, not inferred: the soil occlusion test in the plant passes hides every
   * fragment the planet stands in front of, which is right for a camera above
   * ground and wrong for one inside the ground. A buried camera shares the
   * medium with the roots it is inspecting.
   */
  setCameraUnderSoil(under: boolean): void {
    this.cameraUnderSoil = under;
  }

  /** AL-03: scale every projected-size tier threshold (1 = untouched). */
  setLodThresholdScale(scale: number): void {
    this.lodThresholdScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  }

  /**
   * Queue a plant upload. Rebuilds are throttled while new nodes are growing so
   * the mesh follows the 0.9 s emergence animation without rebuilding every
   * frame.
   */
  updatePlants(nodes: PlantNodeData[], nowMs = performance.now()): void {
    // console.log('[WebGPURenderer] updatePlants called with', nodes.length, 'nodes');
    // console.log('[WebGPURenderer] Sample nodes:', nodes.slice(0, 3).map(n => ({ id: n.id, type: n.type, parentId: n.parentId, position: n.position })));
    if (!this.initialized) {
      return;
    }

    this.pendingNodes = nodes;
    this.pendingNowMs = nowMs;

    const countChanged = nodes.length !== this.lastBuildNodeCount;
    let latestSpawn = Number.NEGATIVE_INFINITY;
    for (const node of nodes) {
      if (node.spawnTime !== undefined && node.spawnTime > latestSpawn) {
        latestSpawn = node.spawnTime;
      }
    }

    const growing = latestSpawn > this.pendingNowMs - GROWTH_ACTIVE_MS;
    const anyGrowing = nodes.some((n) => (n.growthProgress ?? 1) < 1);
    const intervalElapsed = this.pendingNowMs - this.lastBuildTimeMs >= GROWTH_REBUILD_INTERVAL_MS;

    if (countChanged || ((growing || anyGrowing) && intervalElapsed)) {
      this.rebuildMesh();
    }
  }

  /** One plant's mutation appearance; other plants keep their own or default. */
  setPlantAppearance(
    plantId: string,
    appearance: { petalCount: number; leafScale: number; seedScale: number },
  ): void {
    this.appearanceByPlant.set(plantId, { ...appearance });
    this.rebuildMesh();
  }

  /** A plant's composed mutation look (own plant or a rival). */
  setPlantLook(plantId: string, look: MutationLookStack): void {
    this.lookByPlant.set(plantId, look);
    this.rebuildMesh();
  }

  /**
   * Upload one composed look per plant.
   *
   * The layout mirrors `PlantLook` in common.wgsl: five organ records of four
   * vec4f each. Everything is already clamped in JS, so the shader only applies
   * it (ADR-059).
   */
  private uploadPlantLooks(device: GPUDevice, looks: readonly MutationLookStack[]): void {
    if (!this.plantLookBuffer) return;
    const count = Math.min(this.config.maxPlants, Math.max(1, looks.length));
    const data = new Float32Array(count * LOOK_FLOATS_PER_PLANT);
    for (let index = 0; index < count; index += 1) {
      writePlantLook(data, index * LOOK_FLOATS_PER_PLANT, looks[index] ?? NEUTRAL_STACK);
    }
    device.queue.writeBuffer(
      this.plantLookBuffer,
      0,
      data.buffer as ArrayBuffer,
      0,
      data.byteLength,
    );
  }

  private rebuildMesh(): void {
    // console.log('[WebGPURenderer] rebuildMesh with', this.pendingNodes.length, 'nodes');
    const device = this.device.getDevice();
    if (!device) {
      return;
    }

    const built = buildPlantMesh(this.pendingNodes, {
      leafSize: this.config.leafSize,
      leafCountPerNode: this.config.leafCountPerNode,
      tubeSides: this.config.tubeSides,
      rootSides: this.config.rootSides,
      chainRingSpacingM: this.config.chainRingSpacingM,
      chainSagittaTolM: this.config.chainSagittaTolM,
      now: this.pendingNowMs,
      sunDirection: this.sunDirection,
      appearanceForPlant: (plantId) => this.appearanceByPlant.get(plantId),
      lookForPlant: (plantId, isOwn) =>
        this.lookByPlant.get(plantId) ?? this.lookByPlant.get(isOwn ? 'own' : 'rival'),
    });

    this.uploadPlantLooks(device, built.plantLooks);

    this.uploadVertices(device, built.vertices);
    this.uploadIndices(device, built.indices);
    this.uploadPlantData(device, built.plantData);

    this.vertexCount = built.vertices.byteLength / PLANT_VERTEX_STRIDE;
    this.indexCount = built.indices.length;
    this.plantCount = Math.min(built.plantData.length, this.config.maxPlants);
    this.plantRenderData = built.plantData;

    this.lastBuildTimeMs = this.pendingNowMs;
    this.lastBuildNodeCount = this.pendingNodes.length;
  }

  private uploadVertices(device: GPUDevice, data: Float32Array): void {
    if (data.byteLength === 0) {
      this.vertexCount = 0;
      return;
    }

    if (!this.vertexBuffer || this.vertexCapacityBytes < data.byteLength) {
      this.vertexBuffer?.destroy();
      const size = Math.max(data.byteLength, PLANT_VERTEX_STRIDE * 4096);
      this.vertexBuffer = device.createBuffer({
        label: 'WebGPU plant vertices',
        size,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.vertexCapacityBytes = size;
    }

    device.queue.writeBuffer(
      this.vertexBuffer,
      0,
      data.buffer as ArrayBuffer,
      data.byteOffset,
      data.byteLength,
    );
  }

  private uploadIndices(device: GPUDevice, data: Uint32Array): void {
    if (data.byteLength === 0) {
      this.indexCount = 0;
      return;
    }

    if (!this.indexBuffer || this.indexCapacityBytes < data.byteLength) {
      this.indexBuffer?.destroy();
      const size = Math.max(data.byteLength, 4096 * 3 * 4);
      this.indexBuffer = device.createBuffer({
        label: 'WebGPU plant indices',
        size,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      });
      this.indexCapacityBytes = size;
    }

    device.queue.writeBuffer(
      this.indexBuffer,
      0,
      data.buffer as ArrayBuffer,
      data.byteOffset,
      data.byteLength,
    );
  }

  /** C02b: Create procedural texture arrays for plant variation */
  private createTextureArrays(device: GPUDevice): void {
    for (const texType of PLANT_TEXTURE_ARRAY_ORDER) {
      const texture = device.createTexture({
        label: `Texture array: ${PLANT_TEXTURE_TYPE_NAMES[texType]}`,
        size: {
          width: this.config.textureArraySize,
          height: this.config.textureArraySize,
          depthOrArrayLayers: this.config.textureArrayLayers,
        },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        mipLevelCount: 1,
      });
      this.textureArrays?.set(texType, texture);
      this.generateProceduralTexture(device, texType);
    }
  }

  /** C02b: Generate procedural textures for a plant part type */
  private generateProceduralTexture(device: GPUDevice, type: PlantTextureType): void {
    const texture = this.textureArrays?.get(type);
    if (!texture) return;

    const layers = this.config.textureArrayLayers;
    const size = this.config.textureArraySize;
    const bytesPerLayer = size * size * 4;

    for (let layer = 0; layer < layers; layer++) {
      const data = new Uint8Array(bytesPerLayer);
      this.fillTextureLayer(data, size, type, layer);
      device.queue.writeTexture(
        { texture, origin: { x: 0, y: 0, z: layer } },
        data,
        { bytesPerRow: size * 4, rowsPerImage: size },
        { width: size, height: size, depthOrArrayLayers: 1 },
      );
    }
    // Note: WebGPU doesn't have built-in mipmap generation.
    // Using single mip level (base) with linear filtering.
    // For production, mipmaps would be generated via compute shader with
    // per-mip-level texture views, but that requires multiple bind groups
    // and dispatch calls. Skipping for now to avoid complexity.
  }

  /** C02b: Fill a single texture layer with procedural content */
  private fillTextureLayer(
    data: Uint8Array,
    size: number,
    type: PlantTextureType,
    layer: number,
  ): void {
    switch (type) {
      case PlantTextureType.Bark: {
        // Bark: clean vertical gradient with subtle streaks, no random noise
        for (let y = 0; y < size; y++) {
          const uy = y / size;
          const streak = Math.sin(uy * 8.0) * 0.15 + 0.85; // gentle vertical variation
          for (let x = 0; x < size; x++) {
            const idx = (y * size + x) * 4;
            const baseR = 0.38 + layer * 0.02;
            const baseG = 0.28 + layer * 0.015;
            const baseB = 0.18 + layer * 0.01;
            const intensity = 0.85 + streak * 0.15;
            data[idx] = Math.floor(255 * baseR * intensity);
            data[idx + 1] = Math.floor(255 * baseG * intensity);
            data[idx + 2] = Math.floor(255 * baseB * intensity);
            data[idx + 3] = 255;
          }
        }
        break;
      }
      case PlantTextureType.Leaf: {
        // Leaf: clean green with central vein, no noisy patterns
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const idx = (y * size + x) * 4;
            const ux = x / size;
            // Central vein (vertical), fades toward edges
            const vein = Math.exp(-((ux - 0.5) ** 2) * 40);
            const baseG = 0.45 + layer * 0.03;
            const baseR = 0.15 + layer * 0.01;
            const baseB = 0.15 + layer * 0.005;
            const intensity = 0.75 + vein * 0.25;
            data[idx] = Math.floor(255 * baseR * intensity);
            data[idx + 1] = Math.floor(255 * baseG * intensity);
            data[idx + 2] = Math.floor(255 * baseB * intensity);
            data[idx + 3] = 255;
          }
        }
        break;
      }
      case PlantTextureType.Flower: {
        // Flower: simple radial gradient petal, no petal-edge noise
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const idx = (y * size + x) * 4;
            const ux = (x - size / 2) / (size / 2);
            const uyCentered = (y - size / 2) / (size / 2);
            const dist = Math.sqrt(ux * ux + uyCentered * uyCentered);
            const falloff = Math.max(0, 1 - dist * 1.3);
            const baseR = 0.85 + layer * 0.02;
            const baseG = 0.25 + layer * 0.02;
            const baseB = 0.35 + layer * 0.01;
            const intensity = falloff * 0.9 + 0.1;
            data[idx] = Math.floor(255 * baseR * intensity);
            data[idx + 1] = Math.floor(255 * baseG * intensity);
            data[idx + 2] = Math.floor(255 * baseB * intensity);
            data[idx + 3] = Math.floor(255 * falloff);
          }
        }
        break;
      }
      case PlantTextureType.SporeSac: {
        // Spore sac: smooth organic gradient, no bumpy sine noise
        for (let y = 0; y < size; y++) {
          const uy = y / size;
          for (let x = 0; x < size; x++) {
            const idx = (y * size + x) * 4;
            const ux = x / size;
            const dist = Math.sqrt((ux - 0.5) ** 2 + (uy - 0.5) ** 2);
            const falloff = Math.max(0, 1 - dist * 1.4);
            const baseR = 0.65 + layer * 0.02;
            const baseG = 0.35 + layer * 0.015;
            const baseB = 0.15 + layer * 0.01;
            const intensity = falloff * 0.8 + 0.2;
            data[idx] = Math.floor(255 * baseR * intensity);
            data[idx + 1] = Math.floor(255 * baseG * intensity);
            data[idx + 2] = Math.floor(255 * baseB * intensity);
            data[idx + 3] = 255;
          }
        }
        break;
      }
      case PlantTextureType.Seed: {
        // Seed: clean teardrop gradient, no per-pixel random grain
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const idx = (y * size + x) * 4;
            const ux = (x - size / 2) / (size / 2);
            const uyCentered = (y - size / 2) / (size / 2);
            const dist = Math.sqrt(ux * ux + uyCentered * uyCentered * 1.5);
            const falloff = Math.max(0, 1 - dist * 1.1);
            const baseR = 0.52 + layer * 0.02;
            const baseG = 0.36 + layer * 0.015;
            const baseB = 0.21 + layer * 0.008;
            const intensity = falloff * 0.8 + 0.2;
            data[idx] = Math.floor(255 * baseR * intensity);
            data[idx + 1] = Math.floor(255 * baseG * intensity);
            data[idx + 2] = Math.floor(255 * baseB * intensity);
            data[idx + 3] = Math.floor(255 * falloff);
          }
        }
        break;
      }
    }
  }

  private createRainVertexBuffer(device: GPUDevice): void {
    // Rain particles: each is a quad (4 vertices) with position + velocity + seed
    // We'll use instancing: base quad geometry + per-instance data
    const particleCount = this.config.rainParticleCount;

    // Base quad vertices for instancing
    const quadVertices = new Float32Array([
      // Bottom-left
      -0.5, -0.5, 0.0, 0.0,
      // Bottom-right
      0.5, -0.5, 0.0, 0.0,
      // Top-left
      -0.5, 0.5, 0.0, 0.0,
      // Top-right
      0.5, 0.5, 0.0, 0.0,
    ]);

    this.rainVertexBuffer = device.createBuffer({
      label: 'Rain base quad vertices',
      size: quadVertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.rainVertexBuffer.getMappedRange()).set(quadVertices);
    this.rainVertexBuffer.unmap();

    // Instance data buffer (position, velocity, seed) per particle
    // stride: pos(3) + velocity(1) = 4 floats = 16 bytes per instance
    const instanceData = new Float32Array(particleCount * 4);
    const boxWidth = this.config.rainBoxWidth;
    const boxHeight = this.config.rainBoxHeight;
    // Same fixed seed as the WebGL2 rain field, so both paths lay the drops out
    // identically and a screenshot is reproducible.
    const rand = mulberry32(0x5eed1234);
    for (let i = 0; i < particleCount; i++) {
      const base = i * 4;
      instanceData[base] = (rand() - 0.5) * boxWidth; // x
      instanceData[base + 1] = rand() * boxHeight; // y
      instanceData[base + 2] = (rand() - 0.5) * boxWidth; // z
      instanceData[base + 3] = 0.85 + rand() * 0.3; // velocity
    }

    this.rainInstanceBuffer = device.createBuffer({
      label: 'Rain instance data',
      size: instanceData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.rainInstanceBuffer.getMappedRange()).set(instanceData);
    this.rainInstanceBuffer.unmap();

    this.rainParticleCount = particleCount;
  }

  private uploadPlantData(device: GPUDevice, plantData: PlantRenderPlant[]): void {
    if (!this.plantBuffer || plantData.length === 0) {
      return;
    }

    const count = Math.min(plantData.length, this.config.maxPlants);
    const data = new Float32Array(count * PLANT_FLOATS);
    const dataU32 = new Uint32Array(data.buffer);

    for (let i = 0; i < count; i += 1) {
      const plant = plantData[i];
      const offset = i * PLANT_FLOATS;
      data[offset] = plant.center.x;
      data[offset + 1] = plant.center.y;
      data[offset + 2] = plant.center.z;
      data[offset + 3] = plant.radius;
      data[offset + 4] = plant.color[0];
      data[offset + 5] = plant.color[1];
      data[offset + 6] = plant.color[2];
      data[offset + 7] = plant.isOwn ? 1 : 0;
      dataU32[offset + 8] = 4;
      data[offset + 9] = 1;
      data[offset + 10] = plant.nodeCount;
      // Spare PlantData word carries the plant's mutation mask to billboards.
      dataU32[offset + 11] = plant.mutationMask & 0x7;
    }

    device.queue.writeBuffer(this.plantBuffer, 0, data);
  }

  update(deltaTime: number): void {
    this.deltaTime = Math.max(0, deltaTime);
    // Keep the shader clock on the same timeline as performance.now()-derived
    // spawnTime values even if the frame loop is throttled.
    this.time = performance.now() / 1000;
  }

  resize(width: number, height: number, pixelRatio: number): void {
    const canvas = this.device.getCanvas();
    const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
    const targetWidth = Math.max(1, Math.floor(width * ratio));
    const targetHeight = Math.max(1, Math.floor(height * ratio));

    if (canvas.width !== targetWidth) {
      canvas.width = targetWidth;
    }
    if (canvas.height !== targetHeight) {
      canvas.height = targetHeight;
    }
    canvas.style.width = `${Math.floor(width)}px`;
    canvas.style.height = `${Math.floor(height)}px`;

    if (this.initialized) {
      this.recreateDepthTexture();
    }
  }

  /** C02b: Bake impostors for billboard-tier plants into atlas texture */
  private async bakeImpostors(device: GPUDevice, encoder: GPUCommandEncoder): Promise<void> {
    if (
      !this.impostorAtlasTexture ||
      !this.impostorViewsUniformBuffer ||
      !this.impostorTargetBuffer ||
      this.plantCount === 0
    ) {
      return;
    }

    const now = performance.now();
    if (now - this.lastImpostorBakeTime < this.config.impostorUpdateIntervalMs) {
      return;
    }

    // Read render data to find plants in billboard tiers (2-4)
    const renderData = await this.readRenderData(this.plantCount);
    // Guard: renderer may have been destroyed while we awaited the GPU readback.
    if (!this.initialized) return;
    const billboardPlants: Array<{ index: number; projectedSize: number }> = [];
    for (let i = 0; i < renderData.length; i++) {
      if (renderData[i].tier >= 2 && renderData[i].visible > 0) {
        billboardPlants.push({ index: i, projectedSize: renderData[i].projectedSize });
      }
    }

    if (billboardPlants.length === 0) {
      return;
    }

    // Sort by projected size (closest first) to prioritize visible plants
    billboardPlants.sort((a, b) => b.projectedSize - a.projectedSize);

    // Bake up to max plants per frame
    const plantsToBake = Math.min(4, billboardPlants.length);
    let baked = 0;

    // Hand back the tiles of plants that are gone before taking new ones: a tile
    // held by a dead plant was never released, so the atlas filled with ghosts
    // and then evicted plants that were still on screen.
    this.impostorSlots.retain(this.plantIdsInFrame());
    const bakeNow = performance.now();

    // Create/reuse depth texture for impostor rendering
    if (!this.impostorDepthTexture) {
      this.impostorDepthTexture = device.createTexture({
        label: 'Impostor depth',
        size: { width: IMPOSTOR_TILE_SIZE, height: IMPOSTOR_TILE_SIZE },
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
    const impostorDepthTexture = this.impostorDepthTexture;

    // Frustum culling: compute view-projection matrix for main camera
    // We'll cull plants that are outside the main camera view
    const frustumPlanes = this.computeFrustumPlanes();

    for (let i = 0; i < plantsToBake; i++) {
      const plantInfo = billboardPlants[i];
      const plantIdx = plantInfo.index;

      // Get plant data for baking and frustum culling
      const plantRenderInfo = this.plantRenderData[plantIdx];
      if (!plantRenderInfo) continue;

      // Frustum culling: skip plants not in view
      if (!this.isSphereInFrustum(plantRenderInfo.center, plantRenderInfo.radius, frustumPlanes)) {
        continue;
      }
      // Atlas tiles are keyed by plant id, so a plant that shifted down the list
      // (another plant died or left interest) cannot inherit its neighbour's
      // impostor, and a tile is never leaked to a plant that is gone.
      const grant = this.impostorSlots.acquire(plantRenderInfo.id, bakeNow);
      if (!grant) continue;

      // The view matrices depend on the plant's radius alone (the shader applies
      // its position), so they are rebuilt only when the radius changes.
      this.writeImpostorViews(device, plantRenderInfo.radius);

      // Write target plant index
      const targetData = new Uint32Array([plantIdx, 0, 0, 0]);
      device.queue.writeBuffer(this.impostorTargetBuffer, 0, targetData);

      const impostorViewTexture = this.ensureImpostorViewTexture(device);

      // Single render pass with 16 instances (one per view/layer)
      const renderPass = encoder.beginRenderPass({
        label: `Impostor bake plant ${plantIdx} all views`,
        colorAttachments: [
          {
            view: impostorViewTexture.createView({ dimension: '2d-array' }),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
        depthStencilAttachment: {
          view: impostorDepthTexture.createView(),
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });

      if (
        this.impostorPipeline &&
        this.impostorBindGroup &&
        this.vertexBuffer &&
        this.indexBuffer &&
        this.indexCount > 0
      ) {
        renderPass.setPipeline(this.impostorPipeline);
        renderPass.setBindGroup(0, this.impostorBindGroup);
        renderPass.setVertexBuffer(0, this.vertexBuffer);
        renderPass.setIndexBuffer(this.indexBuffer, 'uint32');
        // Draw 16 instances, each instance uses a different view matrix and renders to a different layer
        renderPass.drawIndexed(this.indexCount, IMPOSTOR_VIEWS, 0, 0, 0);
      }
      renderPass.end();

      // Copy each layer from the view texture to the atlas sub-rectangle
      for (let viewIdx = 0; viewIdx < IMPOSTOR_VIEWS; viewIdx++) {
        const h = viewIdx % IMPOSTOR_VIEWS_HORIZONTAL;
        const v = Math.floor(viewIdx / IMPOSTOR_VIEWS_HORIZONTAL);
        const atlasX = grant.column * IMPOSTOR_TILE_SIZE + h * IMPOSTOR_TILE_SIZE;
        const atlasY = grant.row * IMPOSTOR_TILE_SIZE + v * IMPOSTOR_TILE_SIZE;

        encoder.copyTextureToTexture(
          { texture: impostorViewTexture, origin: { x: 0, y: 0, z: viewIdx } },
          { texture: this.impostorAtlasTexture, origin: { x: atlasX, y: atlasY, z: 0 } },
          { width: IMPOSTOR_TILE_SIZE, height: IMPOSTOR_TILE_SIZE, depthOrArrayLayers: 1 },
        );
      }

      baked += 1;
    }

    // Rewriting the whole index -> tile table once per bake is what makes a
    // removal self-healing: an index that now belongs to another plant cannot
    // keep pointing at a tile from a previous frame.
    if (baked > 0) {
      this.writeImpostorSlotBuffer(device);
      this.lastImpostorBakeTime = performance.now();
    }
  }

  /** One 16-layer bake target for every bake, created on first use. */
  private ensureImpostorViewTexture(device: GPUDevice): GPUTexture {
    if (!this.impostorViewTexture) {
      this.impostorViewTexture = device.createTexture({
        label: 'Impostor bake views',
        size: {
          width: IMPOSTOR_TILE_SIZE,
          height: IMPOSTOR_TILE_SIZE,
          depthOrArrayLayers: IMPOSTOR_VIEWS,
        },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
    }
    return this.impostorViewTexture;
  }

  /** Uploads the 16 view-projection matrices a plant of `radius` is baked from. */
  private writeImpostorViews(device: GPUDevice, radius: number): void {
    if (!this.impostorViewsUniformBuffer) return;
    const distance = Math.max(5, radius * 2);
    if (!(Math.abs(distance - this.impostorViewDistance) <= 1e-4)) {
      for (let viewIdx = 0; viewIdx < IMPOSTOR_VIEWS; viewIdx += 1) {
        const h = viewIdx % IMPOSTOR_VIEWS_HORIZONTAL;
        const v = Math.floor(viewIdx / IMPOSTOR_VIEWS_HORIZONTAL);
        const angle = (h / IMPOSTOR_VIEWS_HORIZONTAL) * Math.PI * 2;
        const elevation = v === 0 ? Math.PI / 4 : Math.PI / 6; // 45 deg top, 30 deg side

        IMPOSTOR_EYE.set(
          Math.cos(angle) * Math.cos(elevation) * distance,
          Math.sin(elevation) * distance,
          Math.sin(angle) * Math.cos(elevation) * distance,
        );
        IMPOSTOR_VIEW_MATRIX.lookAt(IMPOSTOR_EYE, IMPOSTOR_TARGET, IMPOSTOR_UP);
        makePerspectiveMatrix(
          IMPOSTOR_PROJECTION_MATRIX,
          Math.PI / 4, // 90 deg FOV
          1, // aspect
          0.1,
          100,
        );
        IMPOSTOR_VIEW_PROJECTION.multiplyMatrices(IMPOSTOR_PROJECTION_MATRIX, IMPOSTOR_VIEW_MATRIX);
        this.impostorViewMatrices.set(IMPOSTOR_VIEW_PROJECTION.elements, viewIdx * 16);
      }
      this.impostorViewDistance = distance;
    }
    device.queue.writeBuffer(this.impostorViewsUniformBuffer, 0, this.impostorViewMatrices);
  }

  /** Uploads the whole plant index -> atlas tile table for the billboard shader. */
  private writeImpostorSlotBuffer(device: GPUDevice): void {
    if (!this.impostorSlotsBuffer) return;
    const needed = this.plantCount * 2;
    if (!this.impostorSlotData || this.impostorSlotData.length < needed) {
      this.impostorSlotData = new Uint32Array(this.config.maxPlants * 2);
    }
    const data = this.impostorSlotData;
    // 0xffffffff means "no impostor": the billboard pass falls back to the mesh
    // for that plant rather than sampling a tile someone else owns.
    data.fill(0xffffffff, 0, needed);
    for (let index = 0; index < this.plantCount; index += 1) {
      const slot = this.impostorSlots.slotOf(this.plantRenderData[index].id);
      if (!slot) continue;
      data[index * 2] = slot.column;
      data[index * 2 + 1] = slot.row;
    }
    device.queue.writeBuffer(this.impostorSlotsBuffer, 0, data, 0, needed);
  }

  /** Ids of the plants this frame can bake, for releasing their tiles. */
  private plantIdsInFrame(): ReadonlySet<string> {
    const ids = new Set<string>();
    const count = Math.min(this.plantCount, this.plantRenderData.length);
    for (let index = 0; index < count; index += 1) {
      ids.add(this.plantRenderData[index].id);
    }
    return ids;
  }

  render(): void {
    const device = this.device.getDevice();
    const context = this.device.getContext();
    if (!device || !context || !this.initialized || !this.camera) {
      return;
    }

    const canvas = this.device.getCanvas();
    if (
      !this.depthTexture ||
      this.depthTexture.width !== Math.max(1, canvas.width) ||
      this.depthTexture.height !== Math.max(1, canvas.height)
    ) {
      this.recreateDepthTexture();
    }

    this.writeFrameUniforms(device, canvas.height);

    const encoder = device.createCommandEncoder({ label: 'WebGPU plant frame' });

    if (this.plantCount > 0 && this.computePipeline && this.computeBindGroup) {
      const computePass = encoder.beginComputePass({ label: 'Plant cull pass' });
      computePass.setPipeline(this.computePipeline);
      computePass.setBindGroup(0, this.computeBindGroup);
      computePass.dispatchWorkgroups(Math.ceil(this.plantCount / WORKGROUP_SIZE));
      computePass.end();
    }

    const colorView = context.getCurrentTexture().createView();
    const depthView = this.depthTexture?.createView();
    if (!depthView) {
      return;
    }

    // ===== PASS 1: Opaque geometry (Ground + Plant mesh tier 0/1) =====
    // Writes depth for proper occlusion
    let renderPass = encoder.beginRenderPass({
      label: 'Plant opaque pass',
      colorAttachments: [
        {
          view: colorView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: depthView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    // 1. Plant mesh (tier 0/1) - opaque. Drawn before the ground so the ground's
    //    translucent bubble can reveal the roots underneath it.
    // 2. Plant mesh (tier 0/1) - opaque
    if (
      this.meshPipeline &&
      this.meshBindGroup &&
      this.vertexBuffer &&
      this.indexBuffer &&
      this.indexCount > 0
    ) {
      renderPass.setPipeline(this.meshPipeline);
      renderPass.setBindGroup(0, this.meshBindGroup);
      renderPass.setVertexBuffer(0, this.vertexBuffer);
      renderPass.setIndexBuffer(this.indexBuffer, 'uint32');
      renderPass.drawIndexed(this.indexCount);
    }

    renderPass.end();

    // ===== PASS 2: Transparent geometry (Billboards + Rain) =====
    // Loads color from pass 1, doesn't write depth (depthWriteEnabled: false)
    // Uses depthCompare: 'less-equal' to test against opaque depth
    renderPass = encoder.beginRenderPass({
      label: 'Plant transparent pass',
      colorAttachments: [
        {
          view: colorView,
          loadOp: 'load', // Load color from opaque pass
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: depthView,
        depthLoadOp: 'load', // Load depth from opaque pass
        depthStoreOp: 'discard', // Don't write depth
      },
    });

    // 3. Plant billboards (tier 2/3/4) - transparent
    if (this.billboardPipeline && this.billboardBindGroup && this.plantCount > 0) {
      renderPass.setPipeline(this.billboardPipeline);
      renderPass.setBindGroup(0, this.billboardBindGroup);
      renderPass.draw(6, this.plantCount);
    }

    // 5. No soil dome. It was a second sphere under the surface whose rings
    //    read as radial bands and which hid the roots from every angle except
    //    straight above. Root Sight now cuts a corridor through the terrain
    //    along the view line instead, so the background shows through.

    // 6. No ground plane here. The environment renderer owns the ground and
    //    now draws the planet's curved cap; this layer used to stamp a flat
    //    500 m sheet at y = 0 on top of it, which hid the curvature and hung a
    //    grey slab under the dirt wherever the cap fell away. The cap's soil
    //    shader runs the same Root Sight cutaway, so the bubble still reveals
    //    the roots.

    // 7. Rain (transparent, renders last on top)
    if (
      this.rainPipeline &&
      this.rainVertexBuffer &&
      this.rainInstanceBuffer &&
      this.rainBindGroup &&
      this.rainUniformBuffer &&
      this.rainParticleCount > 0
    ) {
      // Update rain uniforms from config (pre-allocated buffer to avoid GC pressure)
      const rainData = this.rainUniformData;
      rainData[0] = this.config.rainStreakLength;
      rainData[1] = this.config.rainStreakWidth;
      rainData[2] = this.config.rainMaxVelocity;
      rainData[3] = this.rainParticleCount;
      rainData[4] = this.config.rainBoxWidth;
      rainData[5] = this.config.rainBoxHeight;
      // pad
      device.queue.writeBuffer(this.rainUniformBuffer, 0, rainData);

      renderPass.setPipeline(this.rainPipeline);
      renderPass.setBindGroup(0, this.rainBindGroup);
      renderPass.setVertexBuffer(0, this.rainVertexBuffer);
      renderPass.setVertexBuffer(1, this.rainInstanceBuffer);
      renderPass.draw(4, this.rainParticleCount); // 4 vertices per particle
    }

    renderPass.end();
    device.queue.submit([encoder.finish()]);

    // Schedule impostor baking asynchronously (after frame submission)
    if (this.config.impostorEnabled && this.impostorPipeline && this.impostorBindGroup) {
      this.scheduleImpostorBake(device);
    }
  }

  private scheduleImpostorBake(device: GPUDevice): void {
    // One bake at a time: the bake awaits a GPU readback, and the frame loop
    // still calls this every frame while it is pending.
    if (this.impostorBakeInFlight) return;
    this.impostorBakeInFlight = true;
    // Use setTimeout instead of queueMicrotask to avoid potential race with device loss
    // and to yield to the event loop for better responsiveness
    setTimeout(() => {
      if (!this.initialized) {
        this.impostorBakeInFlight = false;
        return;
      }
      this.bakeImpostorsAsync(device)
        .catch((err) => {
          console.warn('[WebGPURenderer] Impostor bake failed:', err);
        })
        .finally(() => {
          this.impostorBakeInFlight = false;
        });
    }, 0);
  }

  private async bakeImpostorsAsync(device: GPUDevice): Promise<void> {
    // Create a separate command encoder for impostor baking
    const encoder = device.createCommandEncoder({ label: 'Impostor bake' });
    await this.bakeImpostors(device, encoder);
    // Guard: renderer may have been destroyed while awaiting the readback.
    if (!this.initialized) return;
    device.queue.submit([encoder.finish()]);
  }

  private writeFrameUniforms(device: GPUDevice, viewportHeight: number): void {
    if (!this.frameUniformBuffer || !this.camera) {
      return;
    }

    // Validate frame uniform struct size matches WGSL definition
    const expectedFloats = 96; // FRAME_FLOATS
    if (this.frameData.length !== expectedFloats) {
      throw new Error(
        `Frame uniform size mismatch: expected ${expectedFloats} floats (${expectedFloats * 4} bytes), got ${this.frameData.length}`,
      );
    }

    const camera = this.camera;
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

    const data = this.frameData;
    data.set(this.viewProjection.elements, 0);
    data.set(camera.projectionMatrix.elements, 16);

    const position = camera.position;
    data[32] = position.x;
    data[33] = position.y;
    data[34] = position.z;
    data[35] = 1;

    const world = camera.matrixWorld.elements;
    // cameraRight (X axis)
    data[36] = world[0];
    data[37] = world[1];
    data[38] = world[2];
    data[39] = 0;
    // cameraUp (Y axis)
    data[40] = world[4];
    data[41] = world[5];
    data[42] = world[6];
    data[43] = 0;
    // cameraForward (negative Z axis - camera looks down -Z)
    data[44] = -world[8];
    data[45] = -world[9];
    data[46] = -world[10];
    data[47] = 0;

    data[48] = this.sunDirection.x;
    data[49] = this.sunDirection.y;
    data[50] = this.sunDirection.z;
    data[51] = 0;

    data[52] = this.ownRootColor.r;
    data[53] = this.ownRootColor.g;
    data[54] = this.ownRootColor.b;
    data[55] = 1;

    data[56] = this.rivalRootColor.r;
    data[57] = this.rivalRootColor.g;
    data[58] = this.rivalRootColor.b;
    data[59] = 1;

    data[60] = this.rootSightCenter.x;
    data[61] = this.rootSightCenter.y;
    data[62] = this.rootSightCenter.z;
    data[63] = 1;

    data[64] = this.time;
    data[65] = this.config.windStrength;
    data[66] = this.config.windSpeed;
    data[67] = this.config.healthTintStrength;
    data[68] = this.config.mutationBioluminescence;
    data[69] = this.config.mutationBarkThicknessScale;
    data[70] = this.config.mutationVariegation;
    data[71] = viewportHeight;
    this.frameU32[72] = this.rootSightEnabled ? 1 : 0;
    data[73] = this.rootSightProgress;
    data[74] = this.rootSightRadius;
    data[75] = this.rootSightAuraRadius;
    const lodScale = this.lodThresholdScale;
    data[77] = this.config.tierThresholds[0] * lodScale;
    data[78] = this.config.tierThresholds[1] * lodScale;
    data[79] = this.config.tierThresholds[2] * lodScale;
    data[80] = this.config.tierThresholds[3] * lodScale;
    data[81] = this.config.hysteresisPromote;
    data[82] = this.config.hysteresisDemote;
    data[83] = this.config.minDwellTime;
    data[84] = this.config.pointSizeScale;
    data[85] = camera.projectionMatrix.elements[5];
    data[86] = this.deltaTime;
    data[87] = this.rootSightSoilOpacity;
    // Planet body for the cull pass: centre is one radius below the pole.
    const planetRadius = Math.max(0, this.config.planetRadius);
    data[88] = 0;
    data[89] = -planetRadius;
    data[90] = 0;
    data[91] = planetRadius;
    this.frameU32[92] = this.cameraUnderSoil ? 1 : 0;
    data[93] = this.rootSightApertureRadius;
    // The frame struct's last slot is the buried-eye bubble, so the occlusion
    // test can be limited to the air the eye is standing in.
    data[94] = this.rootSightEyeWindow;
    // The struct's last slot: warm light intensity for leaf backlight.
    data[95] = this.sunWarmth;

    device.queue.writeBuffer(this.frameUniformBuffer, 0, data);

    // C02b: GPU skinning - compute and upload joint matrices for each plant
    this.writeJointMatrices(device);
  }

  /** C02b: GPU skinning - compute joint matrices for plant growth animation */
  private writeJointMatrices(device: GPUDevice): void {
    if (!this.jointBuffer || this.plantCount === 0) {
      return;
    }

    // Group nodes by plant (same logic as PlantMeshBuilder)
    const plantGroups = this.groupNodesByPlant(this.pendingNodes);

    const jointData = this.jointData;

    for (let plantIdx = 0; plantIdx < this.plantCount; plantIdx++) {
      const plantNodes = plantGroups[plantIdx];
      if (!plantNodes || plantNodes.length === 0) {
        // Fill with identity matrices
        const baseOffset = plantIdx * MAX_JOINTS_PER_PLANT * 16;
        this.fillIdentityMatrices(jointData, baseOffset);
        continue;
      }

      const baseOffset = plantIdx * MAX_JOINTS_PER_PLANT * 16;

      // Compute joint matrices for each node in this plant
      for (let jointIdx = 0; jointIdx < MAX_JOINTS_PER_PLANT; jointIdx++) {
        const matrixOffset = baseOffset + jointIdx * 16;

        if (jointIdx < plantNodes.length) {
          const node = plantNodes[jointIdx];
          const matrix = jointMatrixFor(node);

          // Write column-major matrix
          jointData[matrixOffset + 0] = matrix.elements[0];
          jointData[matrixOffset + 1] = matrix.elements[1];
          jointData[matrixOffset + 2] = matrix.elements[2];
          jointData[matrixOffset + 3] = matrix.elements[3];
          jointData[matrixOffset + 4] = matrix.elements[4];
          jointData[matrixOffset + 5] = matrix.elements[5];
          jointData[matrixOffset + 6] = matrix.elements[6];
          jointData[matrixOffset + 7] = matrix.elements[7];
          jointData[matrixOffset + 8] = matrix.elements[8];
          jointData[matrixOffset + 9] = matrix.elements[9];
          jointData[matrixOffset + 10] = matrix.elements[10];
          jointData[matrixOffset + 11] = matrix.elements[11];
          jointData[matrixOffset + 12] = matrix.elements[12];
          jointData[matrixOffset + 13] = matrix.elements[13];
          jointData[matrixOffset + 14] = matrix.elements[14];
          jointData[matrixOffset + 15] = matrix.elements[15];
        } else {
          // Identity for unused joints
          jointData[matrixOffset + 0] = 1;
          jointData[matrixOffset + 1] = 0;
          jointData[matrixOffset + 2] = 0;
          jointData[matrixOffset + 3] = 0;
          jointData[matrixOffset + 4] = 0;
          jointData[matrixOffset + 5] = 1;
          jointData[matrixOffset + 6] = 0;
          jointData[matrixOffset + 7] = 0;
          jointData[matrixOffset + 8] = 0;
          jointData[matrixOffset + 9] = 0;
          jointData[matrixOffset + 10] = 1;
          jointData[matrixOffset + 11] = 0;
          jointData[matrixOffset + 12] = 0;
          jointData[matrixOffset + 13] = 0;
          jointData[matrixOffset + 14] = 0;
          jointData[matrixOffset + 15] = 1;
        }
      }
    }

    device.queue.writeBuffer(
      this.jointBuffer,
      0,
      jointData as unknown as GPUAllowSharedBufferSource,
    );
  }

  /** Group nodes by plant root (copied from PlantMeshBuilder logic) */
  private groupNodesByPlant(nodes: PlantNodeData[]): PlantNodeData[][] {
    const byId = new Map<string, PlantNodeData>();
    for (const node of nodes) {
      byId.set(node.id, node);
    }

    const groups = new Map<string, PlantNodeData[]>();
    for (const node of nodes) {
      let root = node;
      const seen = new Set<string>();
      while (root.parentId !== null) {
        if (seen.has(root.id)) break;
        seen.add(root.id);
        const parent = byId.get(root.parentId);
        if (!parent) break;
        root = parent;
      }

      let group = groups.get(root.id);
      if (!group) {
        group = [];
        groups.set(root.id, group);
      }
      group.push(node);
    }

    return [...groups.values()];
  }

  /** Fill identity matrices for a plant's joint slots */
  private fillIdentityMatrices(jointData: Float32Array, baseOffset: number): void {
    for (let jointIdx = 0; jointIdx < MAX_JOINTS_PER_PLANT; jointIdx++) {
      const matrixOffset = baseOffset + jointIdx * 16;
      jointData[matrixOffset + 0] = 1;
      jointData[matrixOffset + 1] = 0;
      jointData[matrixOffset + 2] = 0;
      jointData[matrixOffset + 3] = 0;
      jointData[matrixOffset + 4] = 0;
      jointData[matrixOffset + 5] = 1;
      jointData[matrixOffset + 6] = 0;
      jointData[matrixOffset + 7] = 0;
      jointData[matrixOffset + 8] = 0;
      jointData[matrixOffset + 9] = 0;
      jointData[matrixOffset + 10] = 1;
      jointData[matrixOffset + 11] = 0;
      jointData[matrixOffset + 12] = 0;
      jointData[matrixOffset + 13] = 0;
      jointData[matrixOffset + 14] = 0;
      jointData[matrixOffset + 15] = 1;
    }
  }

  /**
   * Read the compute pass's per-plant LOD output. Intended for development
   * diagnostics and automated renderer checks.
   */
  async readRenderData(
    limit = this.plantCount,
  ): Promise<Array<{ tier: number; visible: number; projectedSize: number }>> {
    const device = this.device.getDevice();
    if (!device || !this.renderBuffer || this.plantCount === 0) {
      return [];
    }

    const count = Math.min(Math.max(0, limit), this.plantCount);
    if (count === 0) {
      return [];
    }

    const byteLength = count * RENDER_STRIDE;
    const staging = device.createBuffer({
      label: 'WebGPU render data readback',
      size: byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const encoder = device.createCommandEncoder({ label: 'WebGPU render data readback' });
    encoder.copyBufferToBuffer(this.renderBuffer, 0, staging, 0, byteLength);
    device.queue.submit([encoder.finish()]);

    try {
      await staging.mapAsync(GPUMapMode.READ);
    } catch {
      // AbortError: device was destroyed before the mapping resolved.
      // Silently discard the readback; the renderer is being torn down.
      staging.destroy();
      return [];
    }
    // Guard: renderer may have been destroyed while awaiting the GPU readback
    // (device.destroy() causes mapAsync to reject with AbortError).
    if (!this.initialized) {
      staging.destroy();
      return [];
    }
    const mapped = staging.getMappedRange().slice(0);
    const words = new Uint32Array(mapped);
    const floats = new Float32Array(mapped);
    staging.unmap();
    staging.destroy();

    const result: Array<{ tier: number; visible: number; projectedSize: number }> = [];
    for (let i = 0; i < count; i += 1) {
      const offset = i * (RENDER_STRIDE / 4);
      result.push({
        tier: words[offset],
        visible: words[offset + 1],
        projectedSize: floats[offset + 2],
      });
    }
    return result;
  }

  getPlantCount(): number {
    return this.plantCount;
  }

  getVertexCount(): number {
    return this.vertexCount;
  }

  getIndexCount(): number {
    return this.indexCount;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /** Compute frustum planes from view-projection matrix for culling */
  private computeFrustumPlanes(): THREE.Plane[] {
    const planes: THREE.Plane[] = [];
    const m = this.viewProjection.elements;

    // Left plane: m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]
    planes.push(
      new THREE.Plane().setFromNormalAndCoplanarPoint(
        new THREE.Vector3(m[3] + m[0], m[7] + m[4], m[11] + m[8]).normalize(),
        new THREE.Vector3(0, 0, 0),
      ),
    );

    // Right plane: m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]
    planes.push(
      new THREE.Plane().setFromNormalAndCoplanarPoint(
        new THREE.Vector3(m[3] - m[0], m[7] - m[4], m[11] - m[8]).normalize(),
        new THREE.Vector3(0, 0, 0),
      ),
    );

    // Bottom plane: m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]
    planes.push(
      new THREE.Plane().setFromNormalAndCoplanarPoint(
        new THREE.Vector3(m[3] + m[1], m[7] + m[5], m[11] + m[9]).normalize(),
        new THREE.Vector3(0, 0, 0),
      ),
    );

    // Top plane: m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]
    planes.push(
      new THREE.Plane().setFromNormalAndCoplanarPoint(
        new THREE.Vector3(m[3] - m[1], m[7] - m[5], m[11] - m[9]).normalize(),
        new THREE.Vector3(0, 0, 0),
      ),
    );

    // Near plane: m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]
    planes.push(
      new THREE.Plane().setFromNormalAndCoplanarPoint(
        new THREE.Vector3(m[3] + m[2], m[7] + m[6], m[11] + m[10]).normalize(),
        new THREE.Vector3(0, 0, 0),
      ),
    );

    // Far plane: m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]
    planes.push(
      new THREE.Plane().setFromNormalAndCoplanarPoint(
        new THREE.Vector3(m[3] - m[2], m[7] - m[6], m[11] - m[10]).normalize(),
        new THREE.Vector3(0, 0, 0),
      ),
    );

    return planes;
  }

  /** Check if sphere intersects frustum */
  private isSphereInFrustum(center: THREE.Vector3, radius: number, planes: THREE.Plane[]): boolean {
    for (const plane of planes) {
      if (plane.distanceToPoint(center) < -radius) {
        return false;
      }
    }
    return true;
  }

  destroy(): void {
    this.frameUniformBuffer?.destroy();
    this.plantBuffer?.destroy();
    this.renderBuffer?.destroy();
    this.vertexBuffer?.destroy();
    this.indexBuffer?.destroy();
    this.jointBuffer?.destroy();
    this.depthTexture?.destroy();
    this.impostorDepthTexture?.destroy();
    this.impostorViewTexture?.destroy();

    // C02b: Destroy texture arrays
    if (this.textureArrays) {
      for (const texture of this.textureArrays.values()) {
        texture.destroy();
      }
    }
    this.rainVertexBuffer?.destroy();
    this.rainInstanceBuffer?.destroy();
    this.rainUniformBuffer?.destroy();
    this.impostorViewsUniformBuffer?.destroy();

    this.frameUniformBuffer = null;
    this.plantBuffer = null;
    this.renderBuffer = null;
    this.vertexBuffer = null;
    this.indexBuffer = null;
    this.jointBuffer = null;
    this.depthTexture = null;
    this.impostorAtlasTexture = null;
    this.impostorAtlasSampler = null;
    this.impostorViewTexture = null;
    this.impostorSlots.clear();
    this.textureArrays = null;
    this.textureArraySampler = null;
    this.rainVertexBuffer = null;
    this.rainInstanceBuffer = null;
    this.rainUniformBuffer = null;
    this.impostorViewsUniformBuffer = null;
    this.computePipeline = null;
    this.meshPipeline = null;
    this.billboardPipeline = null;
    this.rainPipeline = null;
    this.impostorPipeline = null;
    this.computeBindGroup = null;
    this.meshBindGroup = null;
    this.billboardBindGroup = null;
    this.rainBindGroup = null;
    this.impostorBindGroup = null;
    this.sharedPipelineLayout = null;

    // C02b: Destroy VRAM pool
    this.vramPool?.destroy();
    this.vramPool = null;

    this.vertexCapacityBytes = 0;
    this.indexCapacityBytes = 0;
    this.vertexCount = 0;
    this.indexCount = 0;
    this.plantCount = 0;
    this.rainParticleCount = 0;
    this.pendingNodes = [];
    this.lastBuildNodeCount = -1;
    this.initialized = false;
  }

  /** Handle a resize - update canvas and uniform buffers */
  onResize(): void {
    if (!this.initialized) return;
    const device = this.device.getDevice();
    if (!device) return;
    const canvas = this.device.getCanvas();
    if (!canvas) return;
    const context = this.device.getContext();
    if (!context) return;
    // The canvas's own box, not the window: the two differ whenever the game is
    // embedded in a container (the desktop browser panel, an iframe), and the
    // WebGPU layer then covered a different area than the WebGL one below it.
    canvas.width = canvas.clientWidth || window.innerWidth;
    canvas.height = canvas.clientHeight || window.innerHeight;
    context.configure({
      device,
      format: navigator.gpu.getPreferredCanvasFormat(),
      alphaMode: 'premultiplied',
    });
    // Frame uniform buffer will be updated on next frame with new aspect ratio
    this.lastBuildTimeMs = -1; // Force rebuild on next frame
  }
}
