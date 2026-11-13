/**
 * C02 SDF Procedural Plant Renderer
 *
 * Raymarched Signed Distance Field organism rendering with organic fusion,
 * Murray's law tapering, thin-lamina foliage, Root Sight and emergence.
 *
 * The pieces live beside this file so each one can be read on its own:
 *
 * - `plant/plantNodeData.ts`  the node payload the client receives
 * - `plant/sdfNodeVisuals.ts` node type -> primitive, colour, thickness
 * - `plant/sdfBuffers.ts`     node graph -> GPU geometry and texel packing
 * - `plant/sdfShaders.ts`     the GLSL programs
 *
 * This class owns the GL state, the uniforms and the render order.
 */
import * as THREE from 'three';
import { MeshPlantRenderer } from './MeshPlantRenderer.js';
import type { PlantNodeData } from './plant/plantNodeData.js';
import {
  buildSdfGeometry,
  NODE_TEXELS,
  packNodes,
  packSegments,
  SEGMENT_TEXELS,
} from './plant/sdfBuffers.js';
import { SDF_FRAGMENT_SHADER, SDF_VERTEX_SHADER } from './plant/sdfShaders.js';

export type { PlantNodeData } from './plant/plantNodeData.js';

// Reusable temp vector to avoid per-frame allocation in updateCameraUniforms.
const tempCameraDir = new THREE.Vector3();

/**
 * PlantRendererConfig tunables loaded from config/plant_renderer.json.
 * Includes the legacy mesh-based fields for backward compatibility.
 */
export interface PlantRendererConfig {
  // Legacy mesh-based config
  maxNodesPerPlant: number;
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
  rootSightEnabled: boolean;
  rootSightOpacity: number;
  canopySightEnabled: boolean;
  photosynthesisViz: boolean;
  waterFlowViz: boolean;
  nutrientFlowViz: boolean;
  nodeSize: number;
  // C02 SDF Organism Fusion Tunables
  sminBlendRadius: number;
  maxRaymarchSteps: number;
  raymarchHitEpsilon: number;
  boundingBoxPadding: number;
  // LOD-specific raymarch settings
  l0RaymarchSteps: number;
  l1RaymarchSteps: number;
  l2RaymarchSteps: number;
  l0RaymarchEpsilon: number;
  l1RaymarchEpsilon: number;
  l2RaymarchEpsilon: number;
  // T02: Root Sight specific
  rootSightCutawayRadius: number;
  rootAuraRadius: number;
  rootSightSoilOpacity: number;
  ownRootHighlightColor: string;
  rivalRootHighlightColor: string;
  // Visual (new SDF-specific)
  emergenceDuration: number;
  // Mesh tessellation for the L0/L1 mesh pass (config/plant_renderer.json)
  meshTubeRadialSegments: number;
  meshTubeLengthSegments: number;
  meshLeafSegments: number;
  meshJointWidthSegments: number;
  meshJointHeightSegments: number;
  meshMaxLeavesPerNode: number;
  meshJointScale: number;
  meshMaxLeafSize: number;
}

export const DEFAULT_CONFIG: PlantRendererConfig = {
  // Legacy mesh-based config
  maxNodesPerPlant: 1000,
  tubeRingCount: 8,
  tubeLengthSegments: 8,
  leafCountPerNode: 1,
  leafSize: 0.25,
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
  rootSightEnabled: false,
  rootSightOpacity: 0.6,
  canopySightEnabled: true,
  photosynthesisViz: true,
  waterFlowViz: true,
  nutrientFlowViz: true,
  nodeSize: 1.0,
  // C02 SDF Organism Fusion Tunables
  sminBlendRadius: 0.08,
  maxRaymarchSteps: 32,
  raymarchHitEpsilon: 0.005,
  boundingBoxPadding: 1.2,
  // LOD-specific raymarch settings
  l0RaymarchSteps: 128,
  l1RaymarchSteps: 64,
  l2RaymarchSteps: 32,
  l0RaymarchEpsilon: 0.0005,
  l1RaymarchEpsilon: 0.001,
  l2RaymarchEpsilon: 0.002,
  // T02: Root Sight specific
  rootSightCutawayRadius: 50.0,
  rootAuraRadius: 3.0,
  rootSightSoilOpacity: 0.3,
  ownRootHighlightColor: '#4CAF50',
  rivalRootHighlightColor: '#FF5722',
  // Visual
  emergenceDuration: 0.9,
  // Mesh tessellation
  meshTubeRadialSegments: 12,
  meshTubeLengthSegments: 6,
  meshLeafSegments: 4,
  meshJointWidthSegments: 12,
  meshJointHeightSegments: 10,
  meshMaxLeavesPerNode: 6,
  meshJointScale: 0.55,
  meshMaxLeafSize: 0.45,
};

/** Root aura samples the shader reads from its 64x1 texture. */
const ROOT_AURA_CAPACITY = 64;

class PlantRenderer {
  private config: PlantRendererConfig;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera | null = null;

  private sdfMaterial: THREE.ShaderMaterial | null = null;
  private fullscreenQuad: THREE.Mesh | null = null;

  // Data buffers
  private segmentBuffer: THREE.DataTexture | null = null;
  private nodeBuffer: THREE.DataTexture | null = null;
  private segmentCount = 0;
  private nodeCount = 0;

  // Drawing-buffer size used for the raymarch camera ray setup.
  private viewportWidth = 0;
  private viewportHeight = 0;

  // Animation
  private emergenceStartTime = 0;
  private isEmerging = false;
  private deltaTimeAccumulator = 0;
  private rootSightEnabled = false;
  /** Centre of the drawn plant, for LOD distance. */
  private readonly plantCenter = new THREE.Vector3();
  // Root Sight SDF aura
  private rootAuraTexture: THREE.DataTexture | null = null;
  private rootAuraNodeCount = 0;
  private rootAuraRadius = 3.0;

  // Uniforms
  private uniforms: Record<string, THREE.Uniform> = {};

  // LOD
  private currentLOD = 0;

  // Mesh-based L0/L1 renderer (replaces SDF raymarch for close plants)
  private meshRenderer: MeshPlantRenderer | null = null;
  private useMeshL0L1 = true;

  constructor(config: PlantRendererConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.scene = new THREE.Scene();
  }

  /** Initialize the SDF renderer with scene and camera. */
  initialize(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.scene = scene;
    this.camera = camera;
    this.createSDFShader();
    this.createFullscreenQuad();
    this.setupEmergenceAnimation();
    // Mesh-based L0/L1 renderer replaces expensive SDF raymarching up close.
    this.meshRenderer = new MeshPlantRenderer(scene, {
      tubeRadialSegments: this.config.meshTubeRadialSegments,
      tubeLengthSegments: this.config.meshTubeLengthSegments,
      leafSegments: this.config.meshLeafSegments,
      jointWidthSegments: this.config.meshJointWidthSegments,
      jointHeightSegments: this.config.meshJointHeightSegments,
      maxLeavesPerNode: this.config.meshMaxLeavesPerNode,
      jointScale: this.config.meshJointScale,
      maxLeafSize: this.config.meshMaxLeafSize,
    });
  }

  /** Create the SDF raymarching shader material and its uniforms. */
  private createSDFShader(): void {
    this.uniforms = {
      uTime: new THREE.Uniform(0),
      uResolution: new THREE.Uniform(new THREE.Vector2()),
      uCameraPos: new THREE.Uniform(new THREE.Vector3()),
      uCameraDir: new THREE.Uniform(new THREE.Vector3()),
      uCameraUp: new THREE.Uniform(new THREE.Vector3()),
      uFov: new THREE.Uniform(1.0),
      uAspect: new THREE.Uniform(1.0),
      uNear: new THREE.Uniform(0.1),
      uFar: new THREE.Uniform(800),
      uMaxSteps: new THREE.Uniform(this.config.maxRaymarchSteps),
      uHitEpsilon: new THREE.Uniform(this.config.raymarchHitEpsilon),
      uSminRadius: new THREE.Uniform(this.config.sminBlendRadius),
      uWindStrength: new THREE.Uniform(this.config.windStrength),
      uWindSpeed: new THREE.Uniform(this.config.windSpeed),
      uWindTime: new THREE.Uniform(0),
      uSegmentCount: new THREE.Uniform(0),
      uNodeCount: new THREE.Uniform(0),
      uSegments: new THREE.Uniform(null),
      uNodes: new THREE.Uniform(null),
      uRootSightEnabled: new THREE.Uniform(false),
      uRootSightProgress: new THREE.Uniform(0),
      uRootSightCenter: new THREE.Uniform(new THREE.Vector3()),
      uRootSightRadius: new THREE.Uniform(0),
      uRootSightCutawayRadius: new THREE.Uniform(this.config.rootSightCutawayRadius),
      uRootSightSoilOpacity: new THREE.Uniform(this.config.rootSightSoilOpacity),
      // Root Sight SDF aura
      uRootSightAuraEnabled: new THREE.Uniform(false),
      uRootAuraNodeCount: new THREE.Uniform(0),
      uRootAuraTex: new THREE.Uniform(null),
      uRootAuraRadius: new THREE.Uniform(this.config.rootSightCutawayRadius * 0.1),
      uOwnRootHighlightColor: new THREE.Uniform(new THREE.Color(this.config.ownRootHighlightColor)),
      uRivalRootHighlightColor: new THREE.Uniform(
        new THREE.Color(this.config.rivalRootHighlightColor),
      ),
      uEmergenceProgress: new THREE.Uniform(0),
      uEmergenceDuration: new THREE.Uniform(this.config.emergenceDuration),
      uHealthTintStrength: new THREE.Uniform(this.config.healthTintStrength),
      uMutation0: new THREE.Uniform(this.config.mutation0Param),
      uMutation1: new THREE.Uniform(this.config.mutation1Param),
      uMutation2: new THREE.Uniform(this.config.mutation2Param),
      uPhotosynthesisViz: new THREE.Uniform(this.config.photosynthesisViz),
      uWaterFlowViz: new THREE.Uniform(this.config.waterFlowViz),
      uNutrientFlowViz: new THREE.Uniform(this.config.nutrientFlowViz),
      uBoundingBoxPadding: new THREE.Uniform(this.config.boundingBoxPadding),
      // Sun lighting
      uSunDir: new THREE.Uniform(new THREE.Vector3(0.5, 1.0, 0.3).normalize()),
      uSunColor: new THREE.Uniform(new THREE.Color(0xffffee)),
      uSunIntensity: new THREE.Uniform(1.4),
    };

    this.sdfMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: this.uniforms,
      vertexShader: SDF_VERTEX_SHADER,
      fragmentShader: SDF_FRAGMENT_SHADER,
      // Missed rays output alpha 0, so the quad must blend over the sky/ground
      // instead of writing depth across the whole screen.
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
  }

  /** Fullscreen quad the raymarcher draws into the scene. */
  private createFullscreenQuad(): void {
    const geometry = new THREE.PlaneGeometry(2, 2);
    if (!this.sdfMaterial) return;
    this.fullscreenQuad = new THREE.Mesh(geometry, this.sdfMaterial);
    this.fullscreenQuad.frustumCulled = false;
    this.scene.add(this.fullscreenQuad);
  }

  /** Start the emergence animation. */
  private setupEmergenceAnimation(): void {
    // Reference the client delta-time accumulator so emergence runs from now.
    // Previous versions compared the accumulator against a wall-clock timestamp,
    // which made elapsed hugely negative and the sprouting reveal never played.
    this.emergenceStartTime = this.deltaTimeAccumulator;
    this.isEmerging = true;
  }

  // ==================== PUBLIC API ====================

  /**
   * Update plant data from the server.
   * Accepts both the legacy format (type: number) and the typed format.
   */
  updatePlantData(nodes: PlantNodeData[]): void {
    const geometry = buildSdfGeometry(nodes);

    this.uploadSegmentData(geometry.segments);
    this.uploadNodeData(geometry.nodes);
    this.plantCenter.copy(geometry.center);
    this.segmentCount = geometry.segments.length;
    this.nodeCount = geometry.nodes.length;

    this.uniforms.uSegmentCount.value = this.segmentCount;
    this.uniforms.uNodeCount.value = this.nodeCount;

    // Feed the mesh-based L0/L1 renderer (used when SDF raymarching is disabled).
    this.meshRenderer?.updatePlantData(nodes);

    this.updateRootAura(nodes);
  }

  /**
   * Update the Root Sight aura: a 64x1 texture of subterranean node positions,
   * which the shader blends into one continuous glowing volume.
   */
  private updateRootAura(nodes: PlantNodeData[]): void {
    // Collect subterranean nodes (y < 0 or root layer) of player or rivals
    const rootNodes = nodes.filter(
      (n) => n.layer === 'root' || (n.position && n.position.y < -0.01) || n.type === 0,
    );

    this.rootAuraNodeCount = Math.min(rootNodes.length, ROOT_AURA_CAPACITY);
    this.rootAuraRadius = this.config.rootSightCutawayRadius * 0.1;

    const data = new Float32Array(ROOT_AURA_CAPACITY * 4);
    for (let i = 0; i < this.rootAuraNodeCount; i++) {
      const node = rootNodes[i];
      data[i * 4 + 0] = node.position.x;
      data[i * 4 + 1] = node.position.y;
      data[i * 4 + 2] = node.position.z;
      data[i * 4 + 3] = 1.0; // valid flag
    }

    if (!this.rootAuraTexture) {
      this.rootAuraTexture = new THREE.DataTexture(
        data,
        ROOT_AURA_CAPACITY,
        1,
        THREE.RGBAFormat,
        THREE.FloatType,
      );
      this.rootAuraTexture.minFilter = THREE.NearestFilter;
      this.rootAuraTexture.magFilter = THREE.NearestFilter;
      this.rootAuraTexture.needsUpdate = true;
    } else {
      this.rootAuraTexture.image.data = data;
      this.rootAuraTexture.needsUpdate = true;
    }
  }

  /** Set sun lighting uniforms. */
  setSunLight(dir: THREE.Vector3, color: THREE.Color, intensity: number): void {
    this.uniforms.uSunDir.value.copy(dir);
    this.uniforms.uSunColor.value.copy(color);
    this.uniforms.uSunIntensity.value = intensity;
  }

  /** Advance animation state. */
  update(deltaTime: number): void {
    this.deltaTimeAccumulator += deltaTime;
    if (this.isEmerging) {
      const elapsed = this.deltaTimeAccumulator - this.emergenceStartTime;
      const progress = Math.min(elapsed / this.config.emergenceDuration, 1.0);
      this.uniforms.uEmergenceProgress.value = progress;
      if (progress >= 1.0) this.isEmerging = false;
    }
  }

  /** Set the drawing-buffer size used to build the raymarch camera rays. */
  setViewportSize(width: number, height: number): void {
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    this.viewportWidth = Math.max(1, Math.floor(width));
    this.viewportHeight = Math.max(1, Math.floor(height));
  }

  /** Update camera uniforms and resolution for rendering. */
  updateCameraUniforms(): void {
    if (!this.camera || !this.sdfMaterial) return;

    const resolution = this.sdfMaterial.uniforms.uResolution?.value;
    if (resolution instanceof THREE.Vector2) {
      // Prefer the renderer's drawing buffer; fall back to the window size.
      const pixelRatio = window.devicePixelRatio || 1;
      const width = this.viewportWidth > 0 ? this.viewportWidth : window.innerWidth * pixelRatio;
      const height =
        this.viewportHeight > 0 ? this.viewportHeight : window.innerHeight * pixelRatio;
      resolution.set(width, height);
    }

    this.uniforms.uCameraPos.value.copy(this.camera.position);

    tempCameraDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
    this.uniforms.uCameraDir.value.copy(tempCameraDir);
    this.uniforms.uCameraUp.value.copy(this.camera.up);
    this.uniforms.uFov.value = this.camera.fov * (Math.PI / 180);
    this.uniforms.uAspect.value = this.camera.aspect;
  }

  /** Handle window resize. */
  onResize(): void {
    this.updateCameraUniforms();
  }

  /** Set Root Sight mode. */
  setRootSightState(enabled: boolean, progress: number, center: THREE.Vector3): void {
    this.rootSightEnabled = enabled;

    this.uniforms.uRootSightEnabled.value = enabled;
    this.uniforms.uRootSightProgress.value = progress;
    this.uniforms.uRootSightCenter.value.copy(center);
    this.uniforms.uRootSightRadius.value = this.config.rootSightCutawayRadius;
    // Enable aura when root sight is active
    this.uniforms.uRootSightAuraEnabled.value = enabled;
    this.uniforms.uRootAuraNodeCount.value = this.rootAuraNodeCount;
    this.uniforms.uRootAuraTex.value = this.rootAuraTexture;
    this.uniforms.uRootAuraRadius.value = this.rootAuraRadius;
  }

  /** Update configuration. */
  setConfig(config: Partial<PlantRendererConfig>): void {
    this.config = { ...this.config, ...config };
    // Update uniforms that depend on config
    this.uniforms.uSminRadius.value = this.config.sminBlendRadius;
    this.uniforms.uMaxSteps.value = this.config.maxRaymarchSteps;
    this.uniforms.uHitEpsilon.value = this.config.raymarchHitEpsilon;
    this.uniforms.uWindStrength.value = this.config.windStrength;
    this.uniforms.uWindSpeed.value = this.config.windSpeed;
    this.uniforms.uHealthTintStrength.value = this.config.healthTintStrength;
    this.uniforms.uMutation0.value = this.config.mutation0Param;
    this.uniforms.uMutation1.value = this.config.mutation1Param;
    this.uniforms.uMutation2.value = this.config.mutation2Param;
    this.uniforms.uPhotosynthesisViz.value = this.config.photosynthesisViz;
    this.uniforms.uWaterFlowViz.value = this.config.waterFlowViz;
    this.uniforms.uNutrientFlowViz.value = this.config.nutrientFlowViz;
    this.uniforms.uRootSightCutawayRadius.value = this.config.rootSightCutawayRadius;
    this.uniforms.uRootSightSoilOpacity.value = this.config.rootSightSoilOpacity;
    this.uniforms.uOwnRootHighlightColor.value.set(this.config.ownRootHighlightColor);
    this.uniforms.uRivalRootHighlightColor.value.set(this.config.rivalRootHighlightColor);
    this.uniforms.uEmergenceDuration.value = this.config.emergenceDuration;
  }

  /** Get current configuration. */
  getConfig(): PlantRendererConfig {
    return { ...this.config };
  }

  /** Rebuild renderer (legacy no-op; data arrives through updatePlantData). */
  rebuild(): void {
    this.setupEmergenceAnimation();
  }

  /** Generate a test plant for development. */
  generateTestPlant(seed = 0): PlantNodeData[] {
    const nodes: PlantNodeData[] = [];
    const mulberry32 = (a: number): (() => number) => {
      return () => {
        a += 0x6d2b79f5;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };
    const rand = mulberry32(seed);

    const rootId = `test_root_${seed}`;
    nodes.push({
      id: rootId,
      position: new THREE.Vector3(0, 0, 0),
      type: 0, // root
      nodeType: 'root',
      radius: 0.5,
      parentId: null,
      age: 10,
      health: 1.0,
      mutationFlags: 0,
      biomass: 10,
      isOwnPlant: true,
      spawnTime: 0,
      growthProgress: 1.0,
      isSeed: false,
    });

    for (let i = 1; i <= 5; i++) {
      nodes.push({
        id: `test_stem_${seed}_${i}`,
        position: new THREE.Vector3(0, i * 0.8, 0),
        type: 1, // stem
        nodeType: 'stem',
        radius: 0.4 - i * 0.03,
        parentId: i === 1 ? rootId : `test_stem_${seed}_${i - 1}`,
        age: 5,
        health: 1.0,
        mutationFlags: 0,
        biomass: 5,
        isOwnPlant: true,
        spawnTime: i * 1000,
        growthProgress: 1.0,
        isSeed: false,
      });
    }

    for (let i = 0; i < 3; i++) {
      nodes.push({
        id: `test_leaf_${seed}_${i}`,
        position: new THREE.Vector3((rand() - 0.5) * 2, 4 + i * 0.5, (rand() - 0.5) * 2),
        type: 2, // leaf
        nodeType: 'leaf',
        radius: 0.3,
        parentId: `test_stem_${seed}_5`,
        age: 2,
        health: 1.0,
        mutationFlags: 0,
        biomass: 2,
        isOwnPlant: true,
        spawnTime: 5000 + i * 1000,
        growthProgress: 1.0,
        isSeed: false,
      });
    }

    return nodes;
  }

  /** Render the SDF plant. */
  render(deltaTime: number): void {
    if (!this.camera) return;

    this.update(deltaTime);
    this.updateCameraUniforms();

    const time = performance.now() / 1000;

    this.uniforms.uTime.value = time;
    this.uniforms.uWindTime.value = time * this.config.windSpeed;

    this.updateLOD(this.camera.position);

    // The mesh renderer is the plant's primary visual for close plants. Root
    // Sight always forces the mesh path so the player's plant never disappears
    // while the underground view is active.
    const useMesh =
      this.useMeshL0L1 &&
      this.meshRenderer &&
      (this.currentLOD === 0 || this.currentLOD === 1 || this.rootSightEnabled);
    if (useMesh) {
      this.meshRenderer?.render(deltaTime);
      if (this.fullscreenQuad) {
        this.fullscreenQuad.visible = false;
      }
    } else {
      // SDF raymarch path for L2 or when the mesh renderer is disabled.
      if (this.fullscreenQuad) {
        this.fullscreenQuad.visible = true;
        this.fullscreenQuad.renderOrder = 0;
      }
      this.meshRenderer?.setVisible(false);
    }
  }

  /**
   * Update LOD from the camera's distance to the plant.
   *
   * The mesh renderer draws L0/L1; the raymarcher is reserved for L2, where the
   * plant is far enough that organic fusion matters more than detail. The
   * step/epsilon budgets come from plant_renderer.json for each tier.
   */
  private updateLOD(cameraPos: THREE.Vector3): void {
    const distance = cameraPos.distanceTo(this.plantCenter);
    this.currentLOD =
      distance <= this.config.l0Distance ? 0 : distance <= this.config.l1Distance ? 1 : 2;

    if (this.currentLOD === 0) {
      this.uniforms.uMaxSteps.value = this.config.l0RaymarchSteps;
      this.uniforms.uHitEpsilon.value = this.config.l0RaymarchEpsilon;
    } else if (this.currentLOD === 1) {
      this.uniforms.uMaxSteps.value = this.config.l1RaymarchSteps;
      this.uniforms.uHitEpsilon.value = this.config.l1RaymarchEpsilon;
    } else {
      this.uniforms.uMaxSteps.value = this.config.l2RaymarchSteps;
      this.uniforms.uHitEpsilon.value = this.config.l2RaymarchEpsilon;
    }
  }

  /** Dispose GPU resources. */
  dispose(): void {
    if (this.sdfMaterial) {
      this.sdfMaterial.dispose();
      this.sdfMaterial = null;
    }
    if (this.fullscreenQuad) {
      this.scene.remove(this.fullscreenQuad);
      this.fullscreenQuad.geometry.dispose();
      this.fullscreenQuad = null;
    }
    if (this.segmentBuffer) {
      this.segmentBuffer.dispose();
      this.segmentBuffer = null;
    }
    if (this.nodeBuffer) {
      this.nodeBuffer.dispose();
      this.nodeBuffer = null;
    }
    if (this.meshRenderer) {
      this.meshRenderer.dispose();
      this.meshRenderer = null;
    }
  }

  // ==================== PRIVATE HELPERS ====================

  /**
   * Upload a 1-row float texture, reusing the existing texture when the width
   * is unchanged: a growth update must not reallocate GPU memory.
   */
  private uploadFloatTexture(
    existing: THREE.DataTexture | null,
    data: Float32Array,
    texWidth: number,
  ): THREE.DataTexture {
    if (existing && existing.image.width === texWidth && existing.image.height === 1) {
      existing.image.data = data;
      existing.needsUpdate = true;
      return existing;
    }
    if (existing) existing.dispose();
    const texture = new THREE.DataTexture(data, texWidth, 1, THREE.RGBAFormat, THREE.FloatType);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }

  private uploadSegmentData(segments: Parameters<typeof packSegments>[0]): void {
    const data = packSegments(segments);
    const texWidth = Math.max(1, segments.length * SEGMENT_TEXELS);
    this.segmentBuffer = this.uploadFloatTexture(this.segmentBuffer, data, texWidth);
    this.uniforms.uSegments.value = this.segmentBuffer;
  }

  private uploadNodeData(nodes: Parameters<typeof packNodes>[0]): void {
    const data = packNodes(nodes);
    const texWidth = Math.max(1, nodes.length * NODE_TEXELS);
    this.nodeBuffer = this.uploadFloatTexture(this.nodeBuffer, data, texWidth);
    this.uniforms.uNodes.value = this.nodeBuffer;
  }
}

export { PlantRenderer };
