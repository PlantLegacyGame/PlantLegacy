import * as THREE from 'three';
import type { PlantNodeData } from '../PlantRenderer.js';
import { buildPlantMesh, type PlantRenderPlant } from './PlantMeshBuilder.js';
import {
  billboardShader,
  cullShader,
  groundShader,
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

const FRAME_FLOATS = 92;
const FRAME_BYTES = FRAME_FLOATS * 4;
const PLANT_FLOATS = 12;
const PLANT_STRIDE = PLANT_FLOATS * 4;
const RENDER_STRIDE = 16;
const WORKGROUP_SIZE = 64;
const VERTEX_STRIDE = 36;

/** Mesh growth easing in PlantMeshBuilder lasts 0.9 s; keep rebuilding a little longer. */
const GROWTH_ACTIVE_MS = 1100;
const GROWTH_REBUILD_INTERVAL_MS = 100;

export interface WebGPURendererConfig {
  maxPlants: number;
  leafSize: number;
  leafCountPerNode: number;
  tubeSides: number;
  rootSides: number;
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
  ownRootColor: string;
  rivalRootColor: string;
  pointSizeScale: number;
}

export const DEFAULT_WEBGPU_RENDERER_CONFIG: WebGPURendererConfig = {
  maxPlants: 10000,
  leafSize: 1.2,
  leafCountPerNode: 1,
  tubeSides: 8,
  rootSides: 4,
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
  ownRootColor: '#4CAF50',
  rivalRootColor: '#FF5722',
  pointSizeScale: 1.0,
};

export class WebGPURenderer {
  private readonly device: WebGPUDevice;
  private readonly config: WebGPURendererConfig;

  private initialized = false;
  private camera: THREE.PerspectiveCamera | null = null;

  private frameUniformBuffer: GPUBuffer | null = null;
  private plantBuffer: GPUBuffer | null = null;
  private renderBuffer: GPUBuffer | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private indexBuffer: GPUBuffer | null = null;
  private depthTexture: GPUTexture | null = null;

  private computePipeline: GPUComputePipeline | null = null;
  private meshPipeline: GPURenderPipeline | null = null;
  private outlinePipeline: GPURenderPipeline | null = null;
  private sharedPipelineLayout: GPUPipelineLayout | null = null;
  private billboardPipeline: GPURenderPipeline | null = null;
  private groundPipeline: GPURenderPipeline | null = null;
  private rainPipeline: GPURenderPipeline | null = null;

  private computeBindGroup: GPUBindGroup | null = null;
  private meshBindGroup: GPUBindGroup | null = null;
  private billboardBindGroup: GPUBindGroup | null = null;
  private groundBindGroup: GPUBindGroup | null = null;
  private rainBindGroup: GPUBindGroup | null = null;

  private groundVertexBuffer: GPUBuffer | null = null;
  private rainVertexBuffer: GPUBuffer | null = null;
  private rainInstanceBuffer: GPUBuffer | null = null;
  private rainUniformBuffer: GPUBuffer | null = null;

  // Root Sight aura texture (stores up to 64 root positions for per-root highlights)
  private rootAuraTexture: GPUTexture | null = null;
  private rootAuraSampler: GPUSampler | null = null;

  private vertexCapacityBytes = 0;
  private indexCapacityBytes = 0;
  private vertexCount = 0;
  private indexCount = 0;
  private plantCount = 0;
  private outlineIndexOffset = 0;
  private outlineIndexCount = 0;
  private rainParticleCount = 0;

  private pendingNodes: PlantNodeData[] = [];
  private pendingNowMs = 0;
  private lastBuildTimeMs = Number.NEGATIVE_INFINITY;
  private lastBuildNodeCount = -1;

  private readonly frameData = new Float32Array(FRAME_FLOATS);
  private readonly frameU32 = new Uint32Array(this.frameData.buffer);
  private readonly viewProjection = new THREE.Matrix4();
  private readonly sunDirection = new THREE.Vector3(0.45, 1, 0.35);
  private readonly rootSightCenter = new THREE.Vector3();
  private readonly ownRootColor = new THREE.Color(DEFAULT_WEBGPU_RENDERER_CONFIG.ownRootColor);
  private readonly rivalRootColor = new THREE.Color(DEFAULT_WEBGPU_RENDERER_CONFIG.rivalRootColor);

  private rootSightEnabled = false;
  private rootSightProgress = 0;
  private rootSightRadius = 6;
  private rootSightAuraRadius = 3.0;
  private rootAuraNodeCount = 0;
  private time = 0;
  private deltaTime = 0;

  // Selected node for outline highlight
  private selectedNodeId: string | null = null;

  constructor(device: WebGPUDevice, config: Partial<WebGPURendererConfig> = {}) {
    this.device = device;
    this.config = { ...DEFAULT_WEBGPU_RENDERER_CONFIG, ...config };
    this.ownRootColor.set(this.config.ownRootColor);
    this.rivalRootColor.set(this.config.rivalRootColor);
  }

  async initialize(): Promise<boolean> {
    const device = this.device.getDevice();
    if (!device) {
      return false;
    }

    try {
      const cullModule = await this.createShaderModule(device, cullShader, 'plant-cull');
      const meshModule = await this.createShaderModule(device, meshShader, 'plant-mesh');
      const billboardModule = await this.createShaderModule(
        device,
        billboardShader,
        'plant-billboard',
      );
      const groundModule = await this.createShaderModule(device, groundShader, 'ground-plane');
      const rainModule = await this.createShaderModule(device, rainShader, 'rain');

      this.createBuffers(device);
      this.createGroundVertexBuffer(device);
      this.createRainVertexBuffer(device);
      this.createPipelines(
        device,
        cullModule,
        meshModule,
        billboardModule,
        groundModule,
        rainModule,
      );
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
    this.frameUniformBuffer = device.createBuffer({
      label: 'WebGPU frame uniforms',
      size: FRAME_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.plantBuffer = device.createBuffer({
      label: 'WebGPU plant data',
      size: this.config.maxPlants * PLANT_STRIDE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.renderBuffer = device.createBuffer({
      label: 'WebGPU render data',
      size: this.config.maxPlants * RENDER_STRIDE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });

    // Rain uniform buffer
    const RAIN_UNIFORM_BYTES = 32; // 8 f32s = 32 bytes
    this.rainUniformBuffer = device.createBuffer({
      label: 'WebGPU rain uniforms',
      size: RAIN_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Root aura texture (64 nodes max, RGBA32Float, 1D texture)
    this.rootAuraTexture = device.createTexture({
      label: 'Root aura texture',
      size: { width: 64, height: 1, depthOrArrayLayers: 1 },
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    this.rootAuraSampler = device.createSampler({
      label: 'Root aura sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

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

  private createPipelines(
    device: GPUDevice,
    cullModule: GPUShaderModule,
    meshModule: GPUShaderModule,
    billboardModule: GPUShaderModule,
    groundModule: GPUShaderModule,
    rainModule: GPUShaderModule,
  ): void {
    const presentationFormat = this.device.getPresentationFormat();

    this.computePipeline = device.createComputePipeline({
      label: 'Plant cull pipeline',
      layout: 'auto',
      compute: { module: cullModule, entryPoint: 'main' },
    });

    // Create shared pipeline layout for mesh and outline pipelines
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
            { binding: 8, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
            { binding: 9, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
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
        buffers: [
          {
            arrayStride: VERTEX_STRIDE,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x3' },
              { shaderLocation: 2, offset: 24, format: 'float32x2' },
              { shaderLocation: 3, offset: 32, format: 'uint32' },
            ],
          },
        ],
      },
      fragment: {
        module: meshModule,
        entryPoint: 'fs_main',
        targets: [{ format: presentationFormat }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    // Outline pipeline (for selected node highlight) - transparent, renders in pass 2
    this.outlinePipeline = device.createRenderPipeline({
      label: 'Plant outline pipeline',
      layout: this.sharedPipelineLayout,
      vertex: {
        module: meshModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: VERTEX_STRIDE,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x3' },
              { shaderLocation: 2, offset: 24, format: 'float32x2' },
              { shaderLocation: 3, offset: 32, format: 'uint32' },
            ],
          },
        ],
      },
      fragment: {
        module: meshModule,
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

    this.billboardPipeline = device.createRenderPipeline({
      label: 'Plant billboard pipeline',
      layout: 'auto',
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

    // Ground plane pipeline (opaque, renders first so plants depth-test against it)
    this.groundPipeline = device.createRenderPipeline({
      label: 'Ground plane pipeline',
      layout: 'auto',
      vertex: {
        module: groundModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 20, // position(12) + uv(8)
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x2' },
            ],
          },
        ],
      },
      fragment: {
        module: groundModule,
        entryPoint: 'fs_main',
        targets: [{ format: presentationFormat }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
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

    // The mesh shader reads the frame uniform and render data only; plants are
    // not referenced there, so the auto layout does not expose binding 2.
    this.meshBindGroup = device.createBindGroup({
      label: 'Plant mesh bind group',
      layout: this.meshPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: frameBinding },
        { binding: 1, resource: renderBinding },
        {
          binding: 8,
          resource:
            this.rootAuraTexture?.createView() ??
            device
              .createTexture({
                size: [1, 1],
                format: 'rgba16float',
                usage: GPUTextureUsage.TEXTURE_BINDING,
              })
              .createView(),
        },
        { binding: 9, resource: this.rootAuraSampler ?? device.createSampler() },
      ],
    });

    // Ground pipeline bind group (uses frame uniforms and root aura for organic cutaways)
    this.groundBindGroup = device.createBindGroup({
      label: 'Ground plane bind group',
      layout: this.groundPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: frameBinding },
        {
          binding: 8,
          resource:
            this.rootAuraTexture?.createView() ??
            device
              .createTexture({
                size: [1, 1],
                format: 'rgba16float',
                usage: GPUTextureUsage.TEXTURE_BINDING,
              })
              .createView(),
        },
        { binding: 9, resource: this.rootAuraSampler ?? device.createSampler() },
      ],
    });

    this.billboardBindGroup = device.createBindGroup({
      label: 'Plant billboard bind group',
      layout: this.billboardPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: frameBinding },
        { binding: 1, resource: renderBinding },
        { binding: 2, resource: plantBinding },
        {
          binding: 8,
          resource:
            this.rootAuraTexture?.createView() ??
            device
              .createTexture({
                size: [1, 1],
                format: 'rgba16float',
                usage: GPUTextureUsage.TEXTURE_BINDING,
              })
              .createView(),
        },
        { binding: 9, resource: this.rootAuraSampler ?? device.createSampler() },
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

  setRootSight(
    enabled: boolean,
    progress: number,
    center: THREE.Vector3,
    radius: number,
    auraRadius = 3.0,
  ): void {
    this.rootSightEnabled = enabled;
    this.rootSightProgress = THREE.MathUtils.clamp(progress, 0, 1);
    this.rootSightCenter.copy(center);
    this.rootSightRadius = Math.max(0.1, radius);
    this.rootSightAuraRadius = Math.max(0.1, auraRadius);
  }

  /** Set the node ID to highlight with an outline. */
  setSelectedNode(nodeId: string | null): void {
    if (this.selectedNodeId === nodeId) return;
    this.selectedNodeId = nodeId;
    // Force mesh rebuild on next frame to include outline
    this.lastBuildTimeMs = Number.NEGATIVE_INFINITY;
  }

  /**
   * Update root aura texture from plant nodes (called from main.ts updateRootSight and updatePlants).
   * Stores up to 64 subterranean positions for organic cutaways and subterranean visibility.
   */
  updateRootAura(nodes: PlantNodeData[]): void {
    if (!this.rootAuraTexture || !this.initialized) return;

    const device = this.device.getDevice();
    if (!device) return;

    const subterranean = nodes.filter(
      (n) =>
        n.type === 0 ||
        (n.position && n.position.y < -0.01) ||
        n.nodeType === 'radicle' ||
        n.nodeType === 'root' ||
        n.nodeType === 'lateral_root',
    );
    this.rootAuraNodeCount = Math.min(subterranean.length, 64);

    if (this.rootAuraNodeCount === 0) return;

    const auraData = new Float32Array(64 * 4);
    for (let i = 0; i < this.rootAuraNodeCount; i++) {
      const r = subterranean[i];
      auraData[i * 4 + 0] = r.position.x;
      auraData[i * 4 + 1] = r.position.y;
      auraData[i * 4 + 2] = r.position.z;
      auraData[i * 4 + 3] = Math.max(0.25, r.radius || 0.35); // organic bubble radius scale
    }

    device.queue.writeTexture(
      { texture: this.rootAuraTexture },
      auraData,
      { bytesPerRow: 64 * 16, rowsPerImage: 1 },
      { width: 64, height: 1, depthOrArrayLayers: 1 },
    );
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
    this.updateRootAura(nodes);

    const countChanged = nodes.length !== this.lastBuildNodeCount;
    let latestSpawn = Number.NEGATIVE_INFINITY;
    for (const node of nodes) {
      if (node.spawnTime !== undefined && node.spawnTime > latestSpawn) {
        latestSpawn = node.spawnTime;
      }
    }

    const growing = latestSpawn > this.pendingNowMs - GROWTH_ACTIVE_MS;
    const intervalElapsed = this.pendingNowMs - this.lastBuildTimeMs >= GROWTH_REBUILD_INTERVAL_MS;

    if (countChanged || (growing && intervalElapsed)) {
      this.rebuildMesh();
    }
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
      now: this.pendingNowMs,
      selectedNodeId: this.selectedNodeId,
    });

    this.uploadVertices(device, built.vertices);
    this.uploadIndices(device, built.indices);
    this.uploadPlantData(device, built.plantData);

    this.vertexCount = built.vertices.byteLength / VERTEX_STRIDE;
    this.indexCount = built.indices.length;
    this.outlineIndexOffset = built.outlineIndexOffset;
    this.outlineIndexCount = built.outlineIndexCount;
    this.plantCount = Math.min(built.plantData.length, this.config.maxPlants);

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
      const size = Math.max(data.byteLength, VERTEX_STRIDE * 4096);
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

  private createGroundVertexBuffer(device: GPUDevice): void {
    // Large ground plane at y = 0.0 (matching Three.js ground plane position)
    const size = 500;
    const y = 0.0;
    const half = size / 2;

    // 2 triangles = 6 vertices
    // Each vertex: position(3) + uv(2) = 5 floats = 20 bytes
    const vertices = new Float32Array([
      // Triangle 1
      -half,
      y,
      -half,
      0,
      0,
      half,
      y,
      -half,
      1,
      0,
      -half,
      y,
      half,
      0,
      1,
      // Triangle 2
      half,
      y,
      -half,
      1,
      0,
      half,
      y,
      half,
      1,
      1,
      -half,
      y,
      half,
      0,
      1,
    ]);

    this.groundVertexBuffer = device.createBuffer({
      label: 'Ground plane vertices',
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.groundVertexBuffer.getMappedRange()).set(vertices);
    this.groundVertexBuffer.unmap();
  }

  private createRainVertexBuffer(device: GPUDevice): void {
    // Rain particles: each is a quad (4 vertices) with position + velocity + seed
    // We'll use instancing: base quad geometry + per-instance data
    const particleCount = 2000;

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
    const boxWidth = 60;
    const boxHeight = 35;
    for (let i = 0; i < particleCount; i++) {
      const base = i * 4;
      instanceData[base] = (Math.random() - 0.5) * boxWidth; // x
      instanceData[base + 1] = Math.random() * boxHeight; // y
      instanceData[base + 2] = (Math.random() - 0.5) * boxWidth; // z
      instanceData[base + 3] = 0.85 + Math.random() * 0.3; // velocity
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
      dataU32[offset + 11] = 0;
    }

    device.queue.writeBuffer(this.plantBuffer, 0, data);
  }

  update(deltaTime: number): void {
    this.deltaTime = Math.max(0, deltaTime);
    this.time += this.deltaTime;
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

    // 1. Ground plane (opaque, renders first so plants depth-test against it)
    if (this.groundPipeline && this.groundVertexBuffer && this.groundBindGroup) {
      renderPass.setPipeline(this.groundPipeline);
      renderPass.setBindGroup(0, this.groundBindGroup);
      renderPass.setVertexBuffer(0, this.groundVertexBuffer);
      renderPass.draw(6); // 2 triangles = 6 vertices
    }

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

    // 4. Outline for selected node - transparent, renders on top
    if (
      this.outlinePipeline &&
      this.meshBindGroup &&
      this.vertexBuffer &&
      this.indexBuffer &&
      this.outlineIndexCount > 0
    ) {
      renderPass.setPipeline(this.outlinePipeline);
      renderPass.setBindGroup(0, this.meshBindGroup);
      renderPass.setVertexBuffer(0, this.vertexBuffer);
      renderPass.setIndexBuffer(this.indexBuffer, 'uint32');
      renderPass.drawIndexed(this.outlineIndexCount, 1, this.outlineIndexOffset);
    }

    // 5. Rain (transparent, renders last on top)
    if (
      this.rainPipeline &&
      this.rainVertexBuffer &&
      this.rainInstanceBuffer &&
      this.rainBindGroup &&
      this.rainUniformBuffer &&
      this.rainParticleCount > 0
    ) {
      // Update rain uniforms
      const rainData = new Float32Array(8);
      rainData[0] = 25.0; // streakLength
      rainData[1] = 0.02; // streakWidth
      rainData[2] = 35.0; // maxVelocity
      rainData[3] = this.rainParticleCount;
      rainData[4] = 60.0; // boxWidth
      rainData[5] = 35.0; // boxHeight
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
  }

  private writeFrameUniforms(device: GPUDevice, viewportHeight: number): void {
    if (!this.frameUniformBuffer || !this.camera) {
      return;
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
    data[36] = world[0];
    data[37] = world[1];
    data[38] = world[2];
    data[39] = 0;

    data[40] = world[4];
    data[41] = world[5];
    data[42] = world[6];
    data[43] = 0;

    data[44] = this.sunDirection.x;
    data[45] = this.sunDirection.y;
    data[46] = this.sunDirection.z;
    data[47] = 0;

    data[48] = this.ownRootColor.r;
    data[49] = this.ownRootColor.g;
    data[50] = this.ownRootColor.b;
    data[51] = 1;

    data[52] = this.rivalRootColor.r;
    data[53] = this.rivalRootColor.g;
    data[54] = this.rivalRootColor.b;
    data[55] = 1;

    data[56] = this.rootSightCenter.x;
    data[57] = this.rootSightCenter.y;
    data[58] = this.rootSightCenter.z;
    data[59] = 1;

    data[60] = this.time;
    data[61] = this.config.windStrength;
    data[62] = this.config.windSpeed;
    data[63] = this.config.healthTintStrength;
    data[64] = this.config.mutation0Param;
    data[65] = this.config.mutation1Param;
    data[66] = this.config.mutation2Param;
    data[67] = viewportHeight;
    this.frameU32[68] = this.rootSightEnabled ? 1 : 0;
    data[69] = this.rootSightProgress;
    data[70] = this.rootSightRadius;
    data[71] = this.rootSightAuraRadius;
    this.frameU32[72] = this.rootAuraNodeCount;
    data[73] = this.config.tierThresholds[0];
    data[74] = this.config.tierThresholds[1];
    data[75] = this.config.tierThresholds[2];
    data[76] = this.config.tierThresholds[3];
    data[77] = this.config.hysteresisPromote;
    data[78] = this.config.hysteresisDemote;
    data[79] = this.config.minDwellTime;
    data[80] = this.config.pointSizeScale;
    data[81] = camera.projectionMatrix.elements[5];
    data[82] = this.deltaTime;
    data[83] = 0;
    data[84] = 0;
    data[85] = 0;
    data[86] = 0;
    data[87] = 0;

    device.queue.writeBuffer(this.frameUniformBuffer, 0, data);
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

    await staging.mapAsync(GPUMapMode.READ);
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

  destroy(): void {
    this.frameUniformBuffer?.destroy();
    this.plantBuffer?.destroy();
    this.renderBuffer?.destroy();
    this.vertexBuffer?.destroy();
    this.indexBuffer?.destroy();
    this.depthTexture?.destroy();

    this.frameUniformBuffer = null;
    this.plantBuffer = null;
    this.renderBuffer = null;
    this.vertexBuffer = null;
    this.indexBuffer = null;
    this.depthTexture = null;
    this.computePipeline = null;
    this.meshPipeline = null;
    this.billboardPipeline = null;
    this.computeBindGroup = null;
    this.meshBindGroup = null;
    this.billboardBindGroup = null;

    this.vertexCapacityBytes = 0;
    this.indexCapacityBytes = 0;
    this.vertexCount = 0;
    this.indexCount = 0;
    this.plantCount = 0;
    this.pendingNodes = [];
    this.lastBuildNodeCount = -1;
    this.initialized = false;
  }

  /** Handle window resize - update canvas and uniform buffers */
  onResize(): void {
    if (!this.initialized) return;
    const device = this.device.getDevice();
    if (!device) return;
    const canvas = this.device.getCanvas();
    if (!canvas) return;
    const context = this.device.getContext();
    if (!context) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    context.configure({
      device,
      format: navigator.gpu.getPreferredCanvasFormat(),
      alphaMode: 'premultiplied',
    });
    // Frame uniform buffer will be updated on next frame with new aspect ratio
    this.lastBuildTimeMs = -1; // Force rebuild on next frame
  }
}
