/**
 * C02 SDF Procedural Plant Renderer - Complete Rewrite (Backward Compatible)
 *
 * Uses Raymarching with Signed Distance Fields (SDF) for procedural organism rendering.
 * Features:
 * - Organic fusion with smooth minimum (smin) blending
 * - Murray's law allometric tapering
 * - Distinct SDF primitives for each node type
 * - Thin lamina foliage (leaves, petals)
 * - No spheres between segments - proper smin blending
 * - Root Sight mode with cutaway and highlights
 * - Emergence animation (0.9s)
 * - Full backward compatibility with old mesh-based API
 */
import * as THREE from 'three';
import { MeshPlantRenderer } from './MeshPlantRenderer.js';

/**
 * PlantNodeData represents a single node in a plant's graph.
 * Supports legacy (type: number) format for backward compatibility.
 */
export interface PlantNodeData {
  id: string;
  position: THREE.Vector3;
  /** Legacy: 0 = root, 1 = stem/trunk/branch, 2 = leaf */
  type: number;
  /** New: exact server node type (e.g., 'seed', 'radicle', 'root', 'stem', 'leaf', etc.) */
  nodeType?: string;
  radius: number;
  parentId: string | null;
  children?: string[];
  age: number;
  health: number;
  mutationFlags: number;
  biomass: number;
  isOwnPlant?: boolean;
  spawnTime?: number;
  growthProgress?: number;
  isSeed?: boolean;
  layer?: 'root' | 'canopy';
  // Server-authoritative parent attachment position for growth animation sync
  parentAttachX?: number;
  parentAttachY?: number;
  parentAttachZ?: number;
  // Server-authoritative target position where a growing node ends up.
  // When present and growthProgress < 1, the connector tube/segment runs from
  // the parent to this target (scaled by growthProgress), so new growth is
  // drawn connected to its parent instead of as a zero-length blob.
  targetX?: number;
  targetY?: number;
  targetZ?: number;
}

/**
 * PlantRendererConfig tunables loaded from config/plant_renderer.json
 * Includes all legacy fields for backward compatibility.
 * Each property defined exactly once.
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
}

export const DEFAULT_CONFIG: PlantRendererConfig = {
  // Legacy mesh-based config
  maxNodesPerPlant: 1000,
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
};

/**
 * SDF Primitive types for each node type
 */
enum SDFPrimitive {
  CAPSULE = 0, // stem, branch, vine, root, radicle, lateral_root
  ELIPSOID = 1, // seed, flower bud
  DISK = 2, // leaf, cotyledon, petal
  CONE = 3, // flower, spore_sac
  TORUS = 4, // branch collar / fusion zone
}

/**
 * Legacy type number to node type string mapping
 */
function legacyTypeToString(type: number): string {
  switch (type) {
    case 0:
      return 'root';
    case 1:
      return 'stem';
    case 2:
      return 'leaf';
    default:
      return 'stem';
  }
}

/**
 * Get normalized node type string from PlantNodeData
 */
function getNodeTypeString(node: PlantNodeData): string {
  if (node.nodeType) return node.nodeType;
  return legacyTypeToString(node.type);
}

/**
 * Node type to SDF primitive mapping
 */
function getSDFPrimitive(nodeType: string): SDFPrimitive {
  switch (nodeType) {
    case 'stem':
    case 'branch':
    case 'vine':
    case 'root':
    case 'radicle':
    case 'lateral_root':
      return SDFPrimitive.CAPSULE;
    case 'seed':
      return SDFPrimitive.ELIPSOID;
    case 'leaf':
    case 'cotyledon':
      return SDFPrimitive.DISK;
    case 'flower':
    case 'spore_sac':
      return SDFPrimitive.CONE;
    default:
      return SDFPrimitive.CAPSULE;
  }
}

/**
 * Node type to color mapping (procedural, no textures)
 */
function getNodeColor(nodeType: string, health: number): THREE.Vector3 {
  const baseColors: Record<string, THREE.Vector3> = {
    seed: new THREE.Vector3(0.55, 0.35, 0.2),
    radicle: new THREE.Vector3(0.65, 0.45, 0.3),
    root: new THREE.Vector3(0.55, 0.4, 0.28),
    lateral_root: new THREE.Vector3(0.6, 0.42, 0.3),
    stem: new THREE.Vector3(0.45, 0.3, 0.2),
    branch: new THREE.Vector3(0.5, 0.35, 0.22),
    vine: new THREE.Vector3(0.35, 0.45, 0.2),
    leaf: new THREE.Vector3(0.2, 0.65, 0.15),
    cotyledon: new THREE.Vector3(0.25, 0.6, 0.2),
    flower: new THREE.Vector3(0.95, 0.75, 0.85),
    spore_sac: new THREE.Vector3(0.7, 0.55, 0.4),
  };

  const color = baseColors[nodeType] ?? new THREE.Vector3(0.5, 0.5, 0.5);
  const healthTint = new THREE.Vector3(1.0, health, health);
  return color.multiply(healthTint);
}

/**
 * Murray's law tapering: radius scales with distance from root
 * r_child = r_parent * (n)^(-1/3) where n is number of children
 * For binary branching: r_child ≈ 0.79 * r_parent
 */
function calculateMurrayTaper(
  parentRadius: number,
  childIndex: number,
  numChildren: number,
): number {
  if (numChildren <= 1) return parentRadius * 0.85;
  const factor = numChildren ** (-1 / 3);
  return parentRadius * factor * (0.9 + 0.1 * childIndex);
}

/**
 * Build SDF segment data for GPU upload
 */
interface SDFSegment {
  p0: THREE.Vector3;
  p1: THREE.Vector3;
  r0: number;
  r1: number;
  primitive: number;
  color: THREE.Vector3;
  growthProgress: number;
  spawnTime: number;
  nodeType: string;
  layer: number;
  isOwnPlant: boolean;
}

interface SDFNode {
  position: THREE.Vector3;
  radius: number;
  primitive: number;
  color: THREE.Vector3;
  growthProgress: number;
  spawnTime: number;
  nodeType: string;
  layer: number;
  isOwnPlant: boolean;
}

class PlantRenderer {
  private config: PlantRendererConfig;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera | null = null;

  // SDF Render targets
  private sdfRenderTarget: THREE.WebGLRenderTarget | null = null;
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
  private rootSightCenter = new THREE.Vector3();
  private rootSightEnabled = false;
  private rootSightProgress = 0;
  private testPlantSeed = 0;
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
    // Suppress unused private field warnings - fields are used in methods
    void this.rootSightEnabled;
    void this.rootSightProgress;
    void this.testPlantSeed;
  }

  /**
   * Initialize the SDF renderer with scene and camera
   */
  initialize(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.scene = scene;
    this.camera = camera;
    this.createSDFShader();
    this.createFullscreenQuad();
    this.setupEmergenceAnimation();
    // Create mesh-based L0/L1 renderer to replace expensive SDF raymarching
    this.meshRenderer = new MeshPlantRenderer(scene);
  }

  /**
   * Create the SDF raymarching shader material
   */
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

  /**
   * Create fullscreen quad for raymarching
   */
  private createFullscreenQuad(): void {
    const geometry = new THREE.PlaneGeometry(2, 2);
    if (!this.sdfMaterial) return;
    this.fullscreenQuad = new THREE.Mesh(geometry, this.sdfMaterial);
    this.fullscreenQuad.frustumCulled = false;
    this.scene.add(this.fullscreenQuad);
  }

  /**
   * Setup emergence animation
   */
  private setupEmergenceAnimation(): void {
    this.emergenceStartTime = performance.now() / 1000;
    this.isEmerging = true;
  }

  // ==================== PUBLIC API (Backward Compatible) ====================

  /**
   * Update plant data from server - builds SDF segments and nodes
   * Accepts both legacy format (type: number) and new format (type: string)
   */
  updatePlantData(nodes: PlantNodeData[]): void {
    const segments: SDFSegment[] = [];
    const sdfNodes: SDFNode[] = [];

    // Build maps
    const nodeMap = new Map<string, PlantNodeData>();
    const childrenMap = new Map<string, string[]>();

    for (const node of nodes) {
      if (!node.isOwnPlant) continue; // Only render own plant for now
      nodeMap.set(node.id, node);
      if (node.parentId) {
        const children = childrenMap.get(node.parentId) || [];
        children.push(node.id);
        childrenMap.set(node.parentId, children);
      }
    }

    // Build segments and nodes
    for (const node of nodes) {
      if (!node.isOwnPlant) continue;
      if ((node.growthProgress ?? 1.0) < 0.001) continue;

      const nodeTypeStr = getNodeTypeString(node);
      const primitive = getSDFPrimitive(nodeTypeStr);
      const color = getNodeColor(nodeTypeStr, node.health);

      // Add node for endpoints and junctions
      const nodePos = node.position.clone();
      if (nodeTypeStr === 'seed' || node.isSeed) {
        nodePos.y += node.radius;
      }
      sdfNodes.push({
        position: nodePos,
        radius: node.radius,
        primitive,
        color,
        growthProgress: node.growthProgress ?? 1.0,
        spawnTime: node.spawnTime ?? 0,
        nodeType: nodeTypeStr,
        layer: node.layer === 'canopy' ? 1 : 0,
        isOwnPlant: node.isOwnPlant ?? true,
      });

      // Build segment from parent to this node
      if (node.parentId && nodeMap.has(node.parentId)) {
        const parent = nodeMap.get(node.parentId);
        if (!parent) continue;
        const children = childrenMap.get(node.id) || [];

        // Murray's law taper
        const childIndex = children.indexOf(node.id);
        const taperedRadius = calculateMurrayTaper(
          parent.radius,
          childIndex,
          Math.max(1, children.length),
        );

        // Use the server-authoritative target position as the segment end so
        // new growth is drawn as a connector extending from the parent toward
        // where the node is growing, not as a zero-length segment at the parent.
        const hasTarget =
          node.targetX !== undefined && node.targetY !== undefined && node.targetZ !== undefined;
        const segmentEnd = hasTarget
          ? new THREE.Vector3(node.targetX, node.targetY, node.targetZ)
          : node.position.clone();

        segments.push({
          p0: parent.position.clone(),
          p1: segmentEnd,
          r0: parent.radius,
          r1: taperedRadius,
          primitive,
          color,
          growthProgress: Math.min(parent.growthProgress ?? 1.0, node.growthProgress ?? 1.0),
          spawnTime: Math.max(parent.spawnTime ?? 0, node.spawnTime ?? 0),
          nodeType: nodeTypeStr,
          layer: node.layer === 'canopy' ? 1 : 0,
          isOwnPlant: node.isOwnPlant ?? true,
        });
      }
    }

    // Upload to GPU
    this.uploadSegmentData(segments);
    this.uploadNodeData(sdfNodes);
    this.segmentCount = segments.length;
    this.nodeCount = sdfNodes.length;

    // Update uniforms
    this.uniforms.uSegmentCount.value = this.segmentCount;
    this.uniforms.uNodeCount.value = this.nodeCount;

    // Feed mesh-based L0/L1 renderer (used when SDF raymarching is disabled for close plants)
    if (this.meshRenderer) {
      this.meshRenderer.updatePlantData(nodes);
    }

    // Update Root Sight SDF aura texture from root nodes
    this.updateRootAura(nodes);
  }

  /**
   * Update Root Sight SDF aura texture from plant nodes
   * Creates a 64x1 texture with root node positions for SDF aura blending
   */
  private updateRootAura(nodes: PlantNodeData[]): void {
    // Collect subterranean nodes (y < 0 or root layer) of player or rivals
    const rootNodes = nodes.filter(
      (n) => n.layer === 'root' || (n.position && n.position.y < -0.01) || n.type === 0,
    );

    this.rootAuraNodeCount = Math.min(rootNodes.length, 64);
    this.rootAuraRadius = this.config.rootSightCutawayRadius * 0.1;

    // Create or update aura texture (64x1 RGBA)
    const data = new Float32Array(64 * 4);
    for (let i = 0; i < this.rootAuraNodeCount; i++) {
      const node = rootNodes[i];
      data[i * 4 + 0] = node.position.x;
      data[i * 4 + 1] = node.position.y;
      data[i * 4 + 2] = node.position.z;
      data[i * 4 + 3] = 1.0; // valid flag
    }

    if (!this.rootAuraTexture) {
      this.rootAuraTexture = new THREE.DataTexture(data, 64, 1, THREE.RGBAFormat, THREE.FloatType);
      this.rootAuraTexture.minFilter = THREE.NearestFilter;
      this.rootAuraTexture.magFilter = THREE.NearestFilter;
      this.rootAuraTexture.needsUpdate = true;
    } else {
      this.rootAuraTexture.image.data = data;
      this.rootAuraTexture.needsUpdate = true;
    }
  }

  /**
   * Set sun lighting uniforms
   */
  setSunLight(dir: THREE.Vector3, color: THREE.Color, intensity: number): void {
    this.uniforms.uSunDir.value.copy(dir);
    this.uniforms.uSunColor.value.copy(color);
    this.uniforms.uSunIntensity.value = intensity;
  }

  /**
   * Update animation state
   */
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

  /**
   * Update camera uniforms and resolution for rendering
   */
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

    const cameraDir = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(this.camera.quaternion)
      .normalize();
    this.uniforms.uCameraDir.value.copy(cameraDir);
    this.uniforms.uCameraUp.value.copy(this.camera.up);
    this.uniforms.uFov.value = this.camera.fov * (Math.PI / 180);
    this.uniforms.uAspect.value = this.camera.aspect;
  }

  /**
   * Handle window resize
   */
  onResize(): void {
    this.updateCameraUniforms();
  }

  /**
   * Set Root Sight mode
   */
  setRootSightState(enabled: boolean, progress: number, center: THREE.Vector3): void {
    this.rootSightEnabled = enabled;
    this.rootSightProgress = progress;
    this.rootSightCenter.copy(center);

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

  /**
   * Update configuration
   */
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

  /**
   * Get current configuration
   */
  getConfig(): PlantRendererConfig {
    return { ...this.config };
  }

  /**
   * Rebuild renderer (legacy no-op for compatibility)
   */
  rebuild(): void {
    // No-op for SDF renderer - data is updated via updatePlantData
    this.setupEmergenceAnimation();
  }

  /**
   * Generate test plant for development
   */
  generateTestPlant(seed = 0): PlantNodeData[] {
    this.testPlantSeed = seed;
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

    // Create a simple test plant
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

    // Add some stem nodes
    for (let i = 1; i <= 5; i++) {
      const id = `test_stem_${seed}_${i}`;
      nodes.push({
        id,
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

    // Add leaf nodes
    for (let i = 0; i < 3; i++) {
      const id = `test_leaf_${seed}_${i}`;
      nodes.push({
        id,
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

  /**
   * Render the SDF plant
   */
  render(deltaTime: number): void {
    if (!this.camera) return;

    this.update(deltaTime);
    this.updateCameraUniforms();

    const time = performance.now() / 1000;

    // Update time uniforms
    this.uniforms.uTime.value = time;
    this.uniforms.uWindTime.value = time * this.config.windSpeed;

    // Update LOD
    this.updateLOD(this.camera.position);

    // Use mesh-based renderer for L0/L1 (close plants) to avoid expensive SDF raymarching
    // SDF raymarching is reserved for L2 (distant) where organic fusion detail is less critical
    // Root Sight mode requires SDF cutaway, so disable mesh renderer when active
    const useMesh =
      this.useMeshL0L1 &&
      this.meshRenderer &&
      !this.rootSightEnabled &&
      (this.currentLOD === 0 || this.currentLOD === 1);
    if (useMesh) {
      this.meshRenderer?.render(deltaTime);
      // Hide SDF fullscreen quad when mesh renderer is active
      if (this.fullscreenQuad) {
        this.fullscreenQuad.visible = false;
      }
    } else {
      // SDF raymarch path for L2 or when mesh renderer disabled
      if (this.fullscreenQuad) {
        this.fullscreenQuad.visible = true;
        this.fullscreenQuad.renderOrder = 0;
      }
      if (this.meshRenderer) {
        this.meshRenderer.setVisible(false);
      }
    }
  }

  /**
   * Update LOD based on camera distance
   */
  private updateLOD(_cameraPos: THREE.Vector3): void {
    // Use mesh-based rendering for L0/L1 to avoid expensive SDF raymarching
    // (128 steps/pixel causes lag when zoomed in)
    this.currentLOD = 0;

    // SDF raymarch steps: reduced drastically for L0/L1 since mesh renderer handles them
    // SDF is reserved for L2 (distant) or extreme close-ups where organic fusion matters
    if (this.currentLOD === 0) {
      this.uniforms.uMaxSteps.value = 16; // Was 128 - mesh handles L0
      this.uniforms.uHitEpsilon.value = this.config.l0RaymarchEpsilon;
    } else if (this.currentLOD === 1) {
      this.uniforms.uMaxSteps.value = 24; // Was 64 - mesh handles L1
      this.uniforms.uHitEpsilon.value = this.config.l1RaymarchEpsilon;
    } else {
      this.uniforms.uMaxSteps.value = this.config.l2RaymarchSteps;
      this.uniforms.uHitEpsilon.value = this.config.l2RaymarchEpsilon;
    }
  }

  /**
   * Set selected node for highlight
   */
  setSelectedNode(_nodeId: string | null): void {
    // TODO: Implement node highlight in shader
  }

  /**
   * Dispose resources
   */
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
    if (this.sdfRenderTarget) {
      this.sdfRenderTarget.dispose();
      this.sdfRenderTarget = null;
    }
    if (this.meshRenderer) {
      this.meshRenderer.dispose();
      this.meshRenderer = null;
    }
  }

  // ==================== PRIVATE HELPERS ====================

  private uploadSegmentData(segments: SDFSegment[]): void {
    const count = segments.length;
    const texWidth = Math.max(1, count * 7); // 7 texels (vec4) per segment
    const data = new Float32Array(texWidth * 4);

    for (let i = 0; i < count; i++) {
      const s = segments[i];
      const base = i * 28;

      data[base + 0] = s.p0.x;
      data[base + 1] = s.p0.y;
      data[base + 2] = s.p0.z;
      data[base + 3] = s.r0;

      data[base + 4] = s.p1.x;
      data[base + 5] = s.p1.y;
      data[base + 6] = s.p1.z;
      data[base + 7] = s.r1;

      data[base + 8] = s.color.x;
      data[base + 9] = s.color.y;
      data[base + 10] = s.color.z;
      data[base + 11] = s.primitive;

      data[base + 12] = s.growthProgress;
      data[base + 13] = s.spawnTime;
      data[base + 14] = s.layer;
      data[base + 15] = s.isOwnPlant ? 1.0 : 0.0;

      const dir = new THREE.Vector3().subVectors(s.p1, s.p0).normalize();
      data[base + 16] = dir.x;
      data[base + 17] = dir.y;
      data[base + 18] = dir.z;
      data[base + 19] = s.nodeType.length;

      data[base + 20] = 0;
      data[base + 21] = 0;
      data[base + 22] = 0;
      data[base + 23] = 0;
      data[base + 24] = 0;
      data[base + 25] = 0;
      data[base + 26] = 0;
      data[base + 27] = 0;
    }

    if (this.segmentBuffer) {
      this.segmentBuffer.dispose();
    }
    this.segmentBuffer = new THREE.DataTexture(
      data,
      texWidth,
      1,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.segmentBuffer.minFilter = THREE.NearestFilter;
    this.segmentBuffer.magFilter = THREE.NearestFilter;
    this.segmentBuffer.generateMipmaps = false;
    this.segmentBuffer.needsUpdate = true;
    this.uniforms.uSegments.value = this.segmentBuffer;
  }

  private uploadNodeData(nodes: SDFNode[]): void {
    const count = nodes.length;
    const texWidth = Math.max(1, count * 4); // 4 texels (vec4) per node
    const data = new Float32Array(texWidth * 4);

    for (let i = 0; i < count; i++) {
      const n = nodes[i];
      const base = i * 16;

      data[base + 0] = n.position.x;
      data[base + 1] = n.position.y;
      data[base + 2] = n.position.z;
      data[base + 3] = n.radius;

      data[base + 4] = n.color.x;
      data[base + 5] = n.color.y;
      data[base + 6] = n.color.z;
      data[base + 7] = n.primitive;

      data[base + 8] = n.growthProgress;
      data[base + 9] = n.spawnTime;
      data[base + 10] = n.layer;
      data[base + 11] = n.isOwnPlant ? 1.0 : 0.0;

      data[base + 12] = 0;
      data[base + 13] = 0;
      data[base + 14] = 0;
      data[base + 15] = 0;
    }

    if (this.nodeBuffer) {
      this.nodeBuffer.dispose();
    }
    this.nodeBuffer = new THREE.DataTexture(data, texWidth, 1, THREE.RGBAFormat, THREE.FloatType);
    this.nodeBuffer.minFilter = THREE.NearestFilter;
    this.nodeBuffer.magFilter = THREE.NearestFilter;
    this.nodeBuffer.generateMipmaps = false;
    this.nodeBuffer.needsUpdate = true;
    this.uniforms.uNodes.value = this.nodeBuffer;
  }
}

/**
 * SDF Vertex Shader - Fullscreen quad
 */
const SDF_VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

/**
 * SDF Fragment Shader - Raymarching with organic fusion
 *
 * Implements:
 * - Capsule SDF for stems/branches/roots
 * - Ellipsoid SDF for seeds/flowers
 * - Disk SDF for leaves/cotyledons
 * - Cone SDF for flowers/spore sacs
 * - Smooth minimum (smin) blending for organic fusion
 * - Murray's law tapering
 * - Root Sight cutaway
 * - Emergence animation
 */
const SDF_FRAGMENT_SHADER = `
precision highp float;

varying vec2 vUv;

// Fragment output
layout(location = 0) out vec4 outColor;

// Uniforms
uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uCameraPos;
uniform vec3 uCameraDir;
uniform vec3 uCameraUp;
uniform float uFov;
uniform float uAspect;
uniform float uNear;
uniform float uFar;
uniform int uMaxSteps;
uniform float uHitEpsilon;
uniform float uSminRadius;
uniform float uWindStrength;
uniform float uWindSpeed;
uniform float uWindTime;
uniform int uSegmentCount;
uniform int uNodeCount;
uniform sampler2D uSegments;
uniform sampler2D uNodes;
uniform bool uRootSightEnabled;
uniform float uRootSightProgress;
uniform vec3 uRootSightCenter;
uniform float uRootSightRadius;
uniform float uRootSightCutawayRadius;
uniform float uRootSightSoilOpacity;
uniform vec3 uOwnRootHighlightColor;
uniform vec3 uRivalRootHighlightColor;
// Root Sight SDF aura
uniform bool uRootSightAuraEnabled;
uniform int uRootAuraNodeCount;
uniform sampler2D uRootAuraTex;
uniform float uRootAuraRadius;
uniform float uEmergenceProgress;
uniform float uEmergenceDuration;
uniform float uHealthTintStrength;
uniform float uMutation0;
uniform float uMutation1;
uniform float uMutation2;
uniform bool uPhotosynthesisViz;
uniform bool uWaterFlowViz;
uniform bool uNutrientFlowViz;
uniform float uBoundingBoxPadding;
// Sun lighting
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;

// Segment data layout (7 vec4 per segment):
// 0: p0.x, p0.y, p0.z, r0
// 1: p1.x, p1.y, p1.z, r1
// 2: color.r, color.g, color.b, primitive
// 3: growthProgress, spawnTime, layer, isOwnPlant
// 4: dir.x, dir.y, dir.z, nodeTypeHash
// 5-6: reserved

// Node data layout (4 vec4 per node):
// 0: position.x, position.y, position.z, radius
// 1: color.r, color.g, color.b, primitive
// 2: growthProgress, spawnTime, layer, isOwnPlant
// 3: reserved

#define PI 3.14159265359
#define SMIN_K 0.5

// Smooth minimum for organic blending
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// SDF-based unified root aura sampling
// Blends individual root node capsules into one continuous volume using smooth minimum
float sampleRootAuraSDF(vec3 worldPos) {
  if (!uRootSightAuraEnabled || uRootAuraNodeCount == 0) {
    return 0.0;
  }
  
  int count = min(uRootAuraNodeCount, 64);
  float sdfDist = 1000.0;
  float auraRadius = uRootAuraRadius;
  float capsuleRadius = auraRadius * 0.5;
  
  for (int i = 0; i < 64; i++) {
    if (i >= count) break;
    vec2 texCoord = vec2((float(i) + 0.5) / 64.0, 0.5);
    vec4 nodeData = texture2D(uRootAuraTex, texCoord);
    vec3 nodePos = nodeData.xyz;
    float valid = nodeData.w;
    
    if (valid < 0.5) continue;
    
    // Capsule SDF for vertical root segment
    float segmentHeight = auraRadius;
    vec3 segmentCenter = nodePos + vec3(0.0, segmentHeight * 0.5, 0.0);
    vec3 toCenter = worldPos - segmentCenter;
    float dy = abs(toCenter.y) - segmentHeight * 0.5;
    float dxz = length(toCenter.xz);
    float capsuleDist = max(dxz - capsuleRadius, dy);
    capsuleDist = min(capsuleDist, max(dxz, dy));
    
    // Smooth minimum (smin) to blend capsules into one continuous volume
    float k = auraRadius * 0.3;
    float h = clamp(0.5 + 0.5 * (capsuleDist - sdfDist) / k, 0.0, 1.0);
    sdfDist = mix(capsuleDist, sdfDist, h) - k * h * (1.0 - h);
  }
  
  // Convert SDF distance to strength (1 at surface, 0 at radius)
  float strength = 1.0 - smoothstep(0.0, auraRadius, max(sdfDist, 0.0));
  return strength;
}

// SDF: Capsule (tapered)
float sdCapsule(vec3 p, vec3 a, vec3 b, float ra, float rb) {
  vec3 ba = b - a;
  vec3 pa = p - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  float r = mix(ra, rb, h);
  return length(pa - ba * h) - r;
}

// SDF: Ellipsoid
float sdEllipsoid(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / k1;
}

// SDF: Disk (thin leaf)
float sdDisk(vec3 p, float r, float h) {
  vec2 d = vec2(length(p.xz) - r, abs(p.y) - h);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

// SDF: Cone
float sdCone(vec3 p, float r, float h) {
  vec2 q = vec2(length(p.xz), p.y);
  float k1 = h / r;
  float k2 = 1.0 / sqrt(1.0 + k1 * k1);
  vec2 w = q - vec2(r, h) * clamp((q.x * k1 - q.y) / (r * k1 * k1 + h), 0.0, 1.0);
  return length(max(vec2(w.x, 0.0), w)) * sign(max(w.x, w.y));
}

// Wind displacement
vec3 windDisplacement(vec3 p, float time, float strength, float speed, vec3 dir) {
  float freq = 2.0;
  float phase = time * speed + p.y * 3.0;
  float amp = strength * (1.0 - smoothstep(0.0, 10.0, p.y)) * 0.1;
  vec3 perp = normalize(cross(dir, vec3(0.0, 1.0, 0.0)));
  return perp * sin(phase) * amp * (1.0 - p.y * 0.05);
}

// Get segment data from texture (1D row, 7 texels per segment)
vec4 getSegment(int index, int field) {
  int texel = index * 7 + field;
  return texelFetch(uSegments, ivec2(texel, 0), 0);
}

// Get node data from texture (1D row, 4 texels per node)
vec4 getNode(int index, int field) {
  int texel = index * 4 + field;
  return texelFetch(uNodes, ivec2(texel, 0), 0);
}

// Main SDF scene function
float map(vec3 p) {
  float dist = 1000.0;
  bool hitOwnPlant = false;
  bool hitRivalPlant = false;
  
  // Raymarch through segments
  for (int i = 0; i < 2000; i++) {
    if (i >= uSegmentCount) break;
    
    vec4 seg0 = getSegment(i, 0); // p0, r0
    vec4 seg1 = getSegment(i, 1); // p1, r1
    vec4 seg2 = getSegment(i, 2); // color, primitive
    vec4 seg3 = getSegment(i, 3); // growthProgress, spawnTime, layer, isOwnPlant
    vec4 seg4 = getSegment(i, 4); // dir, nodeTypeHash
    
    float growth = seg3.x;
    if (growth < 0.01) continue;
    
    vec3 p0 = seg0.xyz;
    vec3 p1 = seg1.xyz;
    float r0 = seg0.w;
    float r1 = seg1.w;
    int primitive = int(seg2.w);
    bool isOwn = seg3.w > 0.5;
    
    // Apply growth progress scaling
    float prog = growth;
    vec3 gp0 = p0;
    vec3 gp1 = mix(p0, p1, prog);
    float gr0 = r0;
    float gr1 = mix(r0, r1, prog);
    
    // Apply wind
    vec3 windDir = normalize(seg4.xyz);
    gp0 += windDisplacement(gp0, uWindTime, uWindStrength, uWindSpeed, windDir);
    gp1 += windDisplacement(gp1, uWindTime, uWindStrength, uWindSpeed, windDir);
    
    float d = 1000.0;
    if (primitive == 0) { // CAPSULE
      d = sdCapsule(p, gp0, gp1, gr0, gr1);
    } else if (primitive == 1) { // ELIPSOID
      vec3 center = (gp0 + gp1) * 0.5;
      vec3 r = vec3(gr0, length(gp1 - gp0) * 0.5, gr0);
      d = sdEllipsoid(p - center, r);
    } else if (primitive == 2) { // DISK
      vec3 center = (gp0 + gp1) * 0.5;
      vec3 up = normalize(gp1 - gp0);
      mat3 rot = mat3(vec3(1,0,0), vec3(0,1,0), vec3(0,0,1));
      d = sdDisk((p - center) * rot, gr0, 0.02);
    } else if (primitive == 3) { // CONE
      vec3 center = (gp0 + gp1) * 0.5;
      float h = length(gp1 - gp0);
      d = sdCone(p - center, gr0, h);
    }
    
    // Organic fusion with smooth minimum
    if (dist > 1000.0) {
      dist = d;
      hitOwnPlant = isOwn;
      hitRivalPlant = !isOwn;
    } else {
      float k = uSminRadius * 0.5;
      dist = smin(dist, d, k);
      hitOwnPlant = hitOwnPlant || isOwn;
      hitRivalPlant = hitRivalPlant || !isOwn;
    }
  }
  
  // Nodes for junctions and endpoints
  for (int i = 0; i < 2000; i++) {
    if (i >= uNodeCount) break;
    
    vec4 node0 = getNode(i, 0); // position, radius
    vec4 node1 = getNode(i, 1); // color, primitive
    vec4 node2 = getNode(i, 2); // growthProgress, spawnTime, layer, isOwnPlant
    
    float growth = node2.x;
    if (growth < 0.01) continue;
    
    vec3 pos = node0.xyz;
    float r = node0.w * growth;
    int primitive = int(node1.w);
    bool isOwn = node2.w > 0.5;
    
    float d = 1000.0;
    if (primitive == 0) { // CAPSULE - sphere at junction
      d = length(p - pos) - r;
    } else if (primitive == 1) { // ELIPSOID
      d = sdEllipsoid(p - pos, vec3(r));
    } else if (primitive == 2) { // DISK
      d = sdDisk(p - pos, r, 0.02);
    } else if (primitive == 3) { // CONE
      d = sdCone(p - pos, r, r * 2.0);
    }
    
    // Blend with existing
    if (dist > 1000.0) {
      dist = d;
      hitOwnPlant = isOwn;
      hitRivalPlant = !isOwn;
    } else {
      float k = uSminRadius * 0.5;
      dist = smin(dist, d, k);
      hitOwnPlant = hitOwnPlant || isOwn;
      hitRivalPlant = hitRivalPlant || !isOwn;
    }
  }
  
  // Root Sight cutaway
  if (uRootSightEnabled) {
    vec3 toCenter = p - uRootSightCenter;
    float distToCenter = length(toCenter.xz);
    float height = toCenter.y;
    
    // Cutaway sphere
    if (distToCenter < uRootSightCutawayRadius && height < uRootSightCenter.y) {
      dist = max(dist, 0.001);
    }
  }
  
  return dist;
}

// Raymarching
vec3 raymarch(vec3 ro, vec3 rd) {
  float t = uNear;
  float d = 0.0;
  
  for (int i = 0; i < 128; i++) {
    if (i >= uMaxSteps) break;
    vec3 p = ro + rd * t;
    d = map(p);
    if (d < uHitEpsilon) break;
    t += d;
    if (t > uFar) break;
  }
  
  return ro + rd * t;
}

// Normal calculation
vec3 calcNormal(vec3 p) {
  float eps = 0.001;
  vec2 h = vec2(eps, 0);
  return normalize(vec3(
    map(p + h.xyy) - map(p - h.xyy),
    map(p + h.yxy) - map(p - h.yxy),
    map(p + h.yyx) - map(p - h.yyx)
  ));
}

// Main
void main() {
  // Camera ray
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  float aspect = uResolution.x / uResolution.y;
  vec3 rd = normalize(vec3(uv.x * aspect, uv.y, -1.0 / tan(uFov * 0.5)));
  rd = rd.x * normalize(cross(uCameraUp, uCameraDir)) + rd.y * uCameraUp + rd.z * uCameraDir;
  
  vec3 ro = uCameraPos;
  
  // Raymarch
  vec3 p = raymarch(ro, rd);
  float d = map(p);
  
  // Background color (used for fog on hits)
  vec3 bgColor = vec3(0.08, 0.10, 0.06);
  vec3 col = bgColor;
  float alpha = 0.0;
  
  if (d < uHitEpsilon) {
    // Hit plant - calculate normal and lighting
    vec3 n = calcNormal(p);
    
    // Simple lighting
    vec3 lightDir = normalize(uSunDir);
    float diff = max(dot(n, lightDir), 0.0);
    float amb = 0.3;
    vec3 lightColor = uSunColor * uSunIntensity;
    
    // Determine color based on hit type
    if (p.y < 0.0) {
      col = vec3(0.55, 0.40, 0.28) * (amb + diff * 0.7); // root
    } else if (p.y < 2.0) {
      col = vec3(0.45, 0.30, 0.20) * (amb + diff * 0.8); // stem
    } else {
      col = vec3(0.20, 0.65, 0.15) * (amb + diff * 0.9); // leaves
    }
    
    // Apply light color
    col *= lightColor;
    
    // Emergence animation
    if (uEmergenceProgress < 1.0) {
      float emergeAlpha = smoothstep(0.0, 1.0, uEmergenceProgress);
      float yProgress = smoothstep(-5.0, 10.0, p.y);
      col *= emergeAlpha * yProgress;
    }
    
    // Root Sight highlighting with SDF unified aura
    if (uRootSightEnabled) {
      float auraStrength = sampleRootAuraSDF(p);
      float baseStrength = 0.0;
      
      // Also check if within the global cutaway radius
      vec3 toCenter = p - uRootSightCenter;
      float distToCenter = length(toCenter.xz);
      baseStrength = 1.0 - smoothstep(uRootSightCutawayRadius * 0.85, uRootSightCutawayRadius, distToCenter);
      
      // Combine global cutaway with SDF aura
      float strength = max(baseStrength, auraStrength) * uRootSightProgress;
      
      // Regular root sight: keep natural botanical bark/soil colors
      // Peeling back soil reveals roots without artificial neon recoloring
    }
    
    alpha = 1.0;
  }
  
  // Fog (only applied to hit pixels, missed rays are transparent)
  if (alpha > 0.0) {
    float fogDensity = 0.002;
    float dist = length(p - uCameraPos);
    float fog = exp(-fogDensity * dist * dist);
    col = mix(col, bgColor, 1.0 - fog);
  }
  
  // Gamma correction
  col = pow(col, vec3(1.0/2.2));
  
  outColor = vec4(col, alpha);
}
`;

export { PlantRenderer };
