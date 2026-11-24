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
import type { AtmosphereParams } from './environment/atmosphere.js';
import { MeshPlantRenderer } from './MeshPlantRenderer.js';
import {
  type MutationLook,
  type MutationLookStack,
  NEUTRAL_LOOK,
  signatureStyle,
} from './plant/mutations.js';
import type { PlantNodeData } from './plant/plantNodeData.js';
import {
  buildSdfGeometry,
  NODE_TEXELS,
  packNodes,
  packSegments,
  SEGMENT_TEXELS,
} from './plant/sdfBuffers.js';
import { SDF_FRAGMENT_SHADER, SDF_VERTEX_SHADER } from './plant/sdfShaders.js';
import { worldColour } from './worldPalette.ts';

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
  /** Radial segments around a tube; mirrors `mesh_tube_radial_segments`. */
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
  tubeRingCount: 12,
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
  private lastLook: MutationLook = NEUTRAL_LOOK;
  private useMeshL0L1 = true;
  /** Held until `initialize` builds the mesh pass. */
  private pendingGroundQuery: ((x: number, z: number) => number) | null = null;
  private pendingGroundMesh: THREE.Object3D | null = null;

  /** Every field has a default, so a caller that only cares about the mesh pass
   *  can build one without carrying fifty tunables. */
  constructor(config: Partial<PlantRendererConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.scene = new THREE.Scene();
  }

  /** Terrain height under a plan position, forwarded to the mesh pass. */
  setGroundQuery(query: ((x: number, z: number) => number) | null): void {
    this.meshRenderer?.setGroundQuery(query);
    this.pendingGroundQuery = query;
  }

  /**
   * The drawn surfaces a click can land on, forwarded to the mesh pass.
   * Empty when the mesh pass has not been built yet, which is also when the
   * plant is not on screen.
   */
  pickSurfaces(): ReturnType<MeshPlantRenderer['pickSurfaces']> {
    return this.meshRenderer?.pickSurfaces() ?? [];
  }

  /**
   * A head of one organ type, for the dev capture that measures its width and
   * height against a flat background. Nothing in the game reads it.
   */
  headForCapture(nodeType: string): ReturnType<MeshPlantRenderer['buildHeadForCapture']> {
    return this.meshRenderer?.buildHeadForCapture(nodeType) ?? null;
  }

  /** The drawn ground mesh, forwarded to the mesh pass. */
  setGroundMesh(mesh: THREE.Object3D | null): void {
    this.meshRenderer?.setGroundMesh(mesh);
    this.pendingGroundMesh = mesh;
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
    if (this.pendingGroundQuery) this.meshRenderer.setGroundQuery(this.pendingGroundQuery);
    if (this.pendingGroundMesh) this.meshRenderer.setGroundMesh(this.pendingGroundMesh);
  }

  /**
   * AL-04: the plants, the ground and the sky share one atmosphere model, so a
   * plant at distance fades into the same air as the terrain behind it.
   */
  setAtmosphere(params: AtmosphereParams): void {
    const extinction = this.uniforms.uAtmoExtinction;
    if (!extinction) return;
    (extinction.value as THREE.Vector3).set(
      params.extinction[0],
      params.extinction[1],
      params.extinction[2],
    );
    this.uniforms.uAtmoScaleHeight.value = params.scaleHeightM;
    this.uniforms.uAtmoSunPhaseG.value = params.sunPhaseG;
    this.uniforms.uAtmoInScatter.value = params.inScatter;
    this.uniforms.uAtmoHorizonBoost.value = params.horizonBoost;
    // Near plants are meshes; they need the same air as the raymarched ones.
    this.meshRenderer?.setAtmosphere(params, this.uniforms.uSunDir.value as THREE.Vector3);
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
      // Root Sight SDF aura
      uRootSightAuraEnabled: new THREE.Uniform(false),
      uRootAuraNodeCount: new THREE.Uniform(0),
      uRootAuraTex: new THREE.Uniform(null),
      // The aura is its own tunable (`root_aura_radius`), not a tenth of the
      // cutaway radius. Deriving it meant editing the hole resized the glow.
      uRootAuraRadius: new THREE.Uniform(this.config.rootAuraRadius),
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
      uMutationTint: new THREE.Uniform(new THREE.Color(1, 1, 1)),
      uPhotosynthesisViz: new THREE.Uniform(this.config.photosynthesisViz),
      uWaterFlowViz: new THREE.Uniform(this.config.waterFlowViz),
      uNutrientFlowViz: new THREE.Uniform(this.config.nutrientFlowViz),
      uBoundingBoxPadding: new THREE.Uniform(this.config.boundingBoxPadding),
      // Sun lighting
      uSunDir: new THREE.Uniform(new THREE.Vector3(0.5, 1.0, 0.3).normalize()),
      // AL-04: shared atmosphere, in place of the shader's own fog.
      uAtmoExtinction: new THREE.Uniform(new THREE.Vector3(0.00075, 0.0009, 0.0013)),
      uAtmoScaleHeight: new THREE.Uniform(700),
      uAtmoSunPhaseG: new THREE.Uniform(0.72),
      uAtmoInScatter: new THREE.Uniform(0.6),
      uAtmoHorizonBoost: new THREE.Uniform(0.4),
      uSunColor: new THREE.Uniform(worldColour('sunlight')),
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
    this.updateSdfFrame(nodes);

    // Feed the mesh-based L0/L1 renderer (used when SDF raymarching is disabled).
    this.meshRenderer?.updatePlantData(nodes);

    this.updateRootAura(nodes);
  }

  /**
   * Refresh the raymarched body only.
   *
   * Uprooted poses are interpolated between ticks, and the SDF pass draws
   * straight from node data: the texture has to be re-packed for every eazed
   * frame or the body would step at the tick rate while the ground, camera and
   * Root Sight move smoothly. Rebuilding the mesh geometry per frame is not part
   * of this - that path is not what draws a plant at this range.
   */
  updateSdfFrame(nodes: PlantNodeData[]): void {
    const geometry = buildSdfGeometry(nodes);

    // The mutation state owns the pigment (signature + that mutation's own
    // visual_params); deriving it again from node flags would overwrite the
    // per-mutation look with the bare signature.

    this.uploadSegmentData(geometry.segments);
    this.uploadNodeData(geometry.nodes);
    this.plantCenter.copy(geometry.center);
    this.segmentCount = geometry.segments.length;
    this.nodeCount = geometry.nodes.length;

    this.uniforms.uSegmentCount.value = this.segmentCount;
    this.uniforms.uNodeCount.value = this.nodeCount;
  }

  /**
   * Update the Root Sight aura: a 64x1 texture of subterranean node positions,
   * which the shader blends into one continuous glowing volume.
   */
  private updateRootAura(nodes: PlantNodeData[]): void {
    // Collect subterranean nodes (y < 0 or root layer) of player or rivals
    // Type and layer only: `position.y < -0.01` assumed the soil line is Y = 0,
    // so on the planet it matched every buried root and no surface node (or the
    // reverse near the pole). The flags describe the part; the height frame
    // belongs to the terrain.
    const rootNodes = nodes.filter((n) => n.layer === 'root' || n.type === 0);

    this.rootAuraNodeCount = Math.min(rootNodes.length, ROOT_AURA_CAPACITY);
    this.rootAuraRadius = this.config.rootAuraRadius;

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

  /**
   * The light blades are lit from behind by (`dir` points towards it).
   *
   * Passed separately from `setSunLight` because the two are not the same body: the
   * sun's own intensity is zero at night while the *celestial* light is the moon, so
   * feeding transmission the sun's number left every leaf at zero after sunset.
   */
  setLeafBacklight(dir: THREE.Vector3, color: THREE.Color, intensity: number): void {
    this.meshRenderer?.setSunLight(dir, color, intensity);
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
  setRootSightState(
    enabled: boolean,
    _progress: number,
    _center: THREE.Vector3,
    _radiusM: number,
  ): void {
    // Only the aura is drawn by this pass: the hole itself belongs to the soil
    // shader, and roots are exposed by the plant pass's soil test. The cutaway
    // uniforms this used to write were declared in GLSL and never read.
    this.uniforms.uRootSightAuraEnabled.value = enabled;
    this.uniforms.uRootAuraNodeCount.value = this.rootAuraNodeCount;
    this.uniforms.uRootAuraTex.value = this.rootAuraTexture;
    this.uniforms.uRootAuraRadius.value = this.rootAuraRadius;
  }

  /** Map a T04 signature index onto the shader's three mutation parameters. */
  /** Plant-wide shape parameters from the mutation set (petals, leaf and seed scale). */
  setMutationAppearance(appearance: {
    petalCount: number;
    leafScale: number;
    seedScale: number;
  }): void {
    this.meshRenderer?.setMutationAppearance(appearance);
  }

  /** The pigment currently applied to the drawn plant (own plant). */
  getPlantLook(): MutationLook {
    return this.lastLook;
  }

  /**
   * Pigment for the plant this renderer draws (own plant).
   *
   * The SDF pass draws one organism, so it maps the composed stack onto its
   * three mutation uniforms at lower fidelity (ADR-054); the mesh renderer it
   * feeds gets the full per-organ stack.
   */
  setPlantLook(plantId: string, look: MutationLookStack): void {
    this.lastLook = look.looks.foliage;
    this.applyMutationUniforms(look.looks.foliage);
    this.meshRenderer?.setPlantLook(plantId, look);
    this.meshRenderer?.setPlantLook('own', look);
  }

  /** A rival's pigment: mesh-only, never the global own-plant uniforms. */
  setRivalLook(plantId: string, look: MutationLookStack): void {
    this.meshRenderer?.setPlantLook(plantId, look);
    this.meshRenderer?.setPlantLook('rival', look);
  }

  /** Write one composed look into the SDF pass's three mutation uniforms. */
  private applyMutationUniforms(look: MutationLook): void {
    this.uniforms.uMutation0.value = look.glow;
    this.uniforms.uMutation1.value = look.barkScale;
    this.uniforms.uMutation2.value = look.variegation;
    (this.uniforms.uMutationTint.value as THREE.Color).setRGB(
      look.tint[0],
      look.tint[1],
      look.tint[2],
    );
  }

  /** A rival's own look, from the plant sync payload. */
  setPlantAppearance(
    plantId: string,
    appearance: { petalCount: number; leafScale: number; seedScale: number },
  ): void {
    this.meshRenderer?.setPlantAppearance(plantId, appearance);
  }

  applyMutationSignature(signature: number): void {
    // Legacy entry point: a bare signature becomes a one-mutation stack.
    this.applyMutationUniforms(signatureStyle(signature));
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
    // Mutation uniforms are owned by applyMutationSignature; a config update
    // must not wipe the plant's current signature.
    this.uniforms.uPhotosynthesisViz.value = this.config.photosynthesisViz;
    this.uniforms.uWaterFlowViz.value = this.config.waterFlowViz;
    this.uniforms.uNutrientFlowViz.value = this.config.nutrientFlowViz;
    this.uniforms.uRootAuraRadius.value = this.config.rootAuraRadius;
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

    // Always draw the real mesh, at every distance. The SDF path is a fullscreen
    // quad with depth testing disabled, so its plant was composited over the
    // terrain no matter where it stood: the player could see roots and stems
    // through hills, and the plant always looked like it sat in a layer above
    // the dirt. Mesh geometry is depth-tested by the scene, so terrain, the
    // Root Sight cavity and the plant sort in one 3D buffer. The plant is a
    // handful of instanced meshes even at distance, so the LOD saving is not
    // worth losing correct occlusion.
    if (this.useMeshL0L1 && this.meshRenderer) {
      this.meshRenderer.render(deltaTime);
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
