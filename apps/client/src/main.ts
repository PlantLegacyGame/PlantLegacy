/**
 * C01 Client - Vite + Three.js foundation.
 *
 * Replaces the Phase 0 canvas client with a proper Three.js scene.
 * Connects via WebSocket, renders procedural plants with Root Sight shader.
 * No client-side authority - server validates all movement.
 *
 * T00A: First-spawn hint card (3 lines) + resource readout tooltips (RULE_13).
 * T01: Procedural Plant Renderer (Root Sight Shader).
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  loadControlsConfig,
  loadRenderConfig,
  loadRootSightConfig,
  loadUIConfig,
  type RootSightConfig,
} from './config/clientConfig.js';
import { loadPlantRendererConfig } from './config/plantRendererConfig.js';
import { createInputBus, type InputBus } from './input/InputBus.js';
import { createQualityController, type QualityController } from './render/QualityController.js';
import { type PlantNodeData, PlantRenderer } from './renderers/PlantRenderer.js';
import { createDebugOverlay, type DebugOverlay } from './ui/DebugOverlay.js';
import { createUIShell, type UIShell } from './ui/UIShell.js';
import './styles.css';

const serverOrigin =
  document.querySelector('meta[name="server-origin"]')?.getAttribute('content') ?? '';

const isLocalDev =
  (location.hostname === '127.0.0.1' || location.hostname === 'localhost') &&
  (location.port === '4173' || location.port === '4174');
const httpOrigin = serverOrigin || (isLocalDev ? 'http://127.0.0.1:8080' : location.origin);
// Use proxy path for WebSocket in dev (goes through Vite proxy to server)
// The proxy is at root level, so connect to /ws from the root
const wsOrigin = isLocalDev
  ? `${location.protocol}//${location.host}`
  : httpOrigin.replace(/^http/, 'ws');

// T00A: Onboarding config types
interface OnboardingConfig {
  hint_card_lines: string[];
  show_hint_card_duration_ms: number;
  resource_tooltips: {
    light: string;
    water: string;
    minerals: string;
  };
}

let onboardingConfig: OnboardingConfig = {
  hint_card_lines: [
    'WASD / Arrows: Move  |  Mouse: Orbit camera  |  Scroll: Zoom',
    'You are a plant. Grow roots down, canopy up. Read light, water, minerals.',
    'Other players are other plants. Compete, ally, or parasitize. The world simulates offline.',
  ],
  show_hint_card_duration_ms: 10000,
  resource_tooltips: {
    light: 'Light: canopy exposure. Higher = faster photosynthesis.',
    water: 'Water: root access to moisture. Depletes near other roots.',
    minerals: 'Minerals: root access to nutrients. Concentrated in soil layers.',
  },
};

async function loadOnboardingConfig(): Promise<void> {
  try {
    const response = await fetch(`${httpOrigin}/config/onboarding`, { cache: 'no-store' });
    if (response.ok) {
      const config = await response.json();
      onboardingConfig = config;
    }
  } catch {
    // Use defaults
  }
}

interface CubeState {
  id: string;
  x: number;
  z: number;
  rotation: number;
  color: number;
  lastInputTick: number;
  nodeType?: number;
}

interface WelcomePayload {
  playerId: string;
  cubeId: string;
  plantId: string;
  tick: number;
  cubes: CubeState[];
  rootNode: { id: string; x: number; y: number; z: number; type: string; biomass: number };
  totalBiomass: number;
}

interface StatePayload {
  tick: number;
  cubes: CubeState[];
}

interface KeyframePayload {
  tick: number;
  cubes: CubeState[];
}

interface RejectPayload {
  reason: string;
  originalType: number;
}

interface ErrorPayload {
  code: string;
  message: string;
}

interface GrowthIntent {
  plantId: string;
  nodeId: string;
  direction: { x: number; y: number; z: number };
  nodeType: string;
  isAttack: boolean;
  tick: number;
}

interface GrowthEventPayload {
  plantId: string;
  newNode: {
    id: string;
    plantId: string;
    type: string;
    layer: string;
    x: number;
    y: number;
    z: number;
    biomass: number;
    age: number;
    parentId: string | null;
  };
  damageDealt?: number;
  totalBiomass?: number;
}

const MESSAGE_TYPE = {
  HELLO: 1,
  INPUT: 2,
  PING: 3,
  GROWTH_INTENT: 4,
  RESOURCE_QUERY: 5,
  PLANT_SYNC_REQUEST: 6,
  WELCOME: 10,
  STATE: 11,
  KEYFRAME: 12,
  REJECT: 13,
  PONG: 14,
  ERROR: 15,
  GROWTH_EVENT: 16,
  RESOURCE_UPDATE: 17,
  PLANT_SYNC: 18,
  PLANT_CREATED: 19,
  PLANT_REMOVED: 20,
} as const;

interface PlayerInput {
  moveForward: boolean;
  moveBackward: boolean;
  moveLeft: boolean;
  moveRight: boolean;
  tick: number;
}

let ws: WebSocket | null = null;
let playerId: string | null = null;
let myCubeId: string | null = null;
let serverTick = 0;
const cubes = new Map<string, CubeState>();
let inputTick = 0;
let connecting = false;
let plantId: string | null = null;
let cameraFramed = false;
let welcome: WelcomePayload | null = null;

// Persistent plant ID for reconnect/reclaim
const STORAGE_KEY = 'plant-legacy-plant-id';
function getStoredPlantId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function setStoredPlantId(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

let growthIntentTick = 0;
let plantBiomass = 0;
const plantNodes = new Map<string, PlantNodeData>();

// Other players' plants (plantId -> nodes)
const otherPlayerPlants = new Map<string, Map<string, PlantNodeData>>();

// C01: Input abstraction - replaces hardcoded keydown/keyup
let inputBus: InputBus | null = null;
let uiShell: UIShell | null = null;
let debugOverlay: DebugOverlay | null = null;
let qualityController: QualityController | null = null;

// Node radii are derived from biomass and tree height/depth with botanical Murray allometry:
// Sturdy, thick trunk at base, gracefully tapering toward apical leader, slender fibrous roots,
// and thin delicate lateral branchlets.
function nodeRadius(biomass: number, type = 1, y = 0): number {
  if (type === 0) {
    // Root: taproot is firm near crown (0.05 - 0.08m), deep/lateral roots slenderize to 0.02 - 0.035m
    const depth = Math.max(0, -y);
    const depthTaper = 1.0 / (1.0 + depth * 0.35);
    return Math.max(
      0.018,
      (0.035 + Math.min(0.07, Math.sqrt(Math.max(0, biomass)) * 0.012)) * depthTaper,
    );
  }
  if (type === 3) {
    // Leaf / foliage: delicate thin lamina (1.5cm - 4cm)
    return 0.015 + Math.min(0.04, Math.sqrt(Math.max(0, biomass)) * 0.006);
  }
  // Stem / shoot / trunk:
  // Height-based allometric tapering (Murray's Law / Pipe Model):
  // At base (y near 0), thick sturdy trunk (up to 0.16m - 0.22m).
  // At height (y > 2m), slender branches and twigs (0.03m - 0.05m).
  const height = Math.max(0, y);
  const heightTaper = 1.0 / (1.0 + height * 0.4);
  const baseTrunkBonus = Math.max(0.0, 0.08 * (1.0 - Math.min(1.0, height / 1.5)));
  return Math.max(
    0.025,
    (0.05 + baseTrunkBonus + Math.min(0.12, Math.sqrt(Math.max(0, biomass)) * 0.015)) * heightTaper,
  );
}

// T01: Plant Renderer
let plantRenderer: PlantRenderer | null = null;
let lastUpdateTime = performance.now();

// T02: Root Sight state. Surface and underground are two modes of the same
// independent camera; toggling never moves or mutates the plant.
let rootSightConfig: RootSightConfig | null = null;
let rootSightEnabled = false;
let rootSightProgress = 0;
const rootSightTarget = new THREE.Vector3();

// Shared by the soil cutaway shader and the per-frame transition update.
const soilCutawayUniforms = {
  uRootSightProgress: { value: 0 },
  uRootSightCenter: { value: new THREE.Vector3() },
  uRootSightRadius: { value: 50 },
  uRootSightSoilOpacity: { value: 0.3 },
};

let statusElement: HTMLDivElement | null = null;
let detailElement: HTMLDivElement | null = null;
let hintCardElement: HTMLDivElement | null = null;

function setStatus(text: string, state: 'pending' | 'ok' | 'down'): void {
  if (!statusElement) return;
  statusElement.textContent = text;
  statusElement.dataset.state = state;
}

function setDetail(text: string): void {
  if (!detailElement) return;
  detailElement.textContent = text;
}

// T02: Root Sight toggle and transition
function toggleRootSight(): void {
  if (!rootSightConfig) return;

  rootSightEnabled = !rootSightEnabled;
  setDetail(
    rootSightEnabled
      ? 'Root Sight: ON — Underground view active'
      : 'Root Sight: OFF — Surface view',
  );
}

/**
 * The cutaway follows the configured camera target reference. `own_plant`
 * (the default) keeps the cutaway on the viewer's root while the independent
 * camera orbits; `camera_position` makes the cutaway follow the camera.
 */
function getRootSightTarget(out: THREE.Vector3): THREE.Vector3 {
  if (rootSightConfig?.cameraTarget === 'camera_position') {
    return out.copy(camera.position);
  }
  const ownRoot = Array.from(plantNodes.values()).find((node) => node.parentId === null);
  return out.copy(ownRoot?.position ?? controls.target);
}

function updateRootSight(deltaTime: number): void {
  if (!rootSightConfig) return;

  const duration = rootSightConfig.transitionMs / 1000;
  const goal = rootSightEnabled ? 1 : 0;
  if (duration <= 0) {
    rootSightProgress = goal;
  } else {
    const step = deltaTime / duration;
    rootSightProgress =
      rootSightProgress < goal
        ? Math.min(goal, rootSightProgress + step)
        : Math.max(goal, rootSightProgress - step);
  }

  // Ease-out for the visual blend while the state itself stays linear, so a
  // toggle mid-transition reverses cleanly.
  const eased = 1 - (1 - rootSightProgress) ** 3;
  getRootSightTarget(rootSightTarget);

  soilCutawayUniforms.uRootSightProgress.value = eased;
  soilCutawayUniforms.uRootSightCenter.value.copy(rootSightTarget);
  soilCutawayUniforms.uRootSightRadius.value = rootSightConfig.cutawayRadius;
  soilCutawayUniforms.uRootSightSoilOpacity.value = rootSightConfig.soilOpacity;

  gridMaterial.opacity = 1 - 0.85 * eased;

  plantRenderer?.setRootSightState(rootSightEnabled, eased, rootSightTarget);
}

async function initC01(): Promise<void> {
  // Load C01 configs
  const [renderConfig, controlsConfig, uiConfig, loadedRootSightConfig] = await Promise.all([
    loadRenderConfig(httpOrigin),
    loadControlsConfig(httpOrigin),
    loadUIConfig(httpOrigin),
    loadRootSightConfig(httpOrigin),
  ]);

  rootSightConfig = loadedRootSightConfig;

  // Build input bus
  inputBus = createInputBus({ bindings: controlsConfig.bindings });

  // Build UI shell
  uiShell = createUIShell(uiConfig);

  // Debug overlay
  const debugLayer = uiShell.getLayer('debug');
  if (debugLayer && renderConfig.debugOverlayEnabled) {
    debugOverlay = createDebugOverlay(debugLayer, renderConfig.debugOverlayKey);
    inputBus.subscribe((actionId, state) => {
      if (actionId === 'debug_toggle' && state.pressed && debugOverlay) {
        debugOverlay.setVisible(!debugOverlay.isVisible());
      }
    });
  }

  // Quality controller
  qualityController = createQualityController({
    targetFps: renderConfig.targetFps,
    fpsWarningThreshold: renderConfig.fpsWarningThreshold,
    resolutionFloor: renderConfig.resolutionFloor,
    maxPixelRatio: renderConfig.maxPixelRatio,
    qualityTiers: renderConfig.qualityTiers,
  });

  // Apply the camera and shadow tunables from config/render.json.
  controls.dampingFactor = renderConfig.cameraSmoothing;
  controls.minDistance = renderConfig.cameraMinDistance;
  controls.maxDistance = renderConfig.cameraMaxDistance;
  controls.maxPolarAngle = renderConfig.cameraMaxPolarAngle;
  sunLight.shadow.mapSize.set(renderConfig.shadowMapSize, renderConfig.shadowMapSize);

  // Growth intent action
  inputBus.subscribe((actionId: string, state: { pressed: boolean }) => {
    if (actionId === 'growth_intent' && state.pressed) {
      sendGrowthIntent();
    }
    if (actionId === 'camera_recenter' && state.pressed) {
      const rootNode = plantNodes.size > 0 ? Array.from(plantNodes.values())[0] : null;
      if (rootNode) {
        const target = new THREE.Vector3(
          rootNode.position.x,
          rootNode.position.y,
          rootNode.position.z,
        );
        controls.target.copy(target);

        // Dolly camera closer to target (distance ~20)
        const direction = new THREE.Vector3().subVectors(camera.position, target).normalize();
        const desiredDistance = 20;
        camera.position.copy(target).add(direction.multiplyScalar(desiredDistance));
        controls.update();
      }
    }
    if (import.meta.env.DEV && actionId === 'plant_regenerate' && state.pressed) {
      // Generate a test plant at origin for visual critique
      if (plantRenderer) {
        const testNodes = plantRenderer.generateTestPlant();
        plantRenderer.rebuild();
        plantRenderer.updatePlantData(testNodes);
        // Center camera on origin
        controls.target.set(0, 0, 0);
        camera.position.set(0, 20, 30);
        controls.update();
        setDetail(
          `Generated test plant at origin (${testNodes.length} nodes). Orbit camera to inspect.`,
        );
      }
    }
    if (actionId === 'root_sight_toggle' && state.pressed && rootSightConfig) {
      toggleRootSight();
    }
  });

  // Keyboard producer
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      if (e.code === 'Enter') inputBus?.handleKeyDown(e.code);
      return;
    }
    // Don't prevent default for browser shortcuts (Ctrl/Shift/Alt/Meta combos)
    if (e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) {
      inputBus?.handleKeyDown(e.code);
      return;
    }
    inputBus?.handleKeyDown(e.code);
    e.preventDefault();
  });

  window.addEventListener('keyup', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) {
      inputBus?.handleKeyUp(e.code);
      return;
    }
    inputBus?.handleKeyUp(e.code);
    e.preventDefault();
  });

  // Mouse producer
  const canvas = document.querySelector('canvas');
  if (canvas) {
    canvas.addEventListener('mousedown', (e) => inputBus?.handleMouseDown(e.button));
    canvas.addEventListener('mouseup', (e) => inputBus?.handleMouseUp(e.button));
    canvas.addEventListener('wheel', (e) => inputBus?.handleWheel(e.deltaY), { passive: false });
  }

  // Visibility change: pause render loop & input when hidden
  if (renderConfig.pauseOnHidden) {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // Could throttle WS or pause render; for now just note it
        setDetail('Tab hidden — pausing');
      } else {
        setDetail('Tab visible — resuming');
        // Request full plant sync when tab becomes visible again
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: MESSAGE_TYPE.PLANT_SYNC_REQUEST, payload: {} }));
        }
      }
    });
  }
}

async function initPlantRenderer(): Promise<void> {
  // Reconnects create a fresh plant; dispose the previous renderer so its
  // meshes and GPU buffers do not pile up.
  if (plantRenderer) {
    plantRenderer.dispose();
    plantRenderer = null;
  }

  const config = await loadPlantRendererConfig(httpOrigin);

  plantRenderer = new PlantRenderer(renderer, scene, camera, {
    maxNodesPerPlant: config.maxNodesPerPlant,
    tubeRingCount: config.tubeRingCount,
    tubeLengthSegments: config.tubeLengthSegments,
    leafCountPerNode: config.leafCountPerNode,
    leafSize: config.leafSize,
    leafLengthWidthRatio: config.leafLengthWidthRatio,
    petioleLength: config.petioleLength,
    petioleThickness: config.petioleThickness,
    l0Distance: config.l0Distance,
    l1Distance: config.l1Distance,
    l2Distance: config.l2Distance,
    triangleBudgetL0: config.triangleBudgetL0,
    triangleBudgetL1: config.triangleBudgetL1,
    windStrength: config.windStrength,
    windSpeed: config.windSpeed,
    healthTintStrength: config.healthTintStrength,
    mutation0Param: config.mutation0Param,
    mutation1Param: config.mutation1Param,
    mutation2Param: config.mutation2Param,
    sminBlendRadius: config.sminBlendRadius,
    maxRaymarchSteps: config.maxRaymarchSteps,
    raymarchHitEpsilon: config.raymarchHitEpsilon,
    boundingBoxPadding: config.boundingBoxPadding,
    rootSightEnabled,
    canopySightEnabled: config.canopySightEnabled,
    photosynthesisViz: config.photosynthesisVisualization,
    waterFlowViz: config.waterFlowVisualization,
    nutrientFlowViz: config.nutrientFlowVisualization,
    nodeSize: 1.0,
    // T02: Root Sight specific
    rootSightCutawayRadius: rootSightConfig?.cutawayRadius ?? 50.0,
    ownRootHighlightColor: rootSightConfig?.ownRootHighlightColor ?? '#4CAF50',
    rivalRootHighlightColor: rootSightConfig?.rivalRootHighlightColor ?? '#FF5722',
  });

  // Initialize with existing plant nodes (root node from WELCOME, or empty)
  if (plantRenderer) {
    const otherNodes: PlantNodeData[] = [];
    for (const nodes of otherPlayerPlants.values()) {
      otherNodes.push(...nodes.values());
    }
    const allNodes = [...plantNodes.values(), ...otherNodes];
    plantRenderer.updatePlantData(allNodes);
  }
}

// Three.js setup
const app = document.getElementById('app');
if (!app) throw new Error('App element not found');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
app.appendChild(renderer.domElement);

// UI overlay elements
statusElement = document.createElement('div');
statusElement.id = 'status';
statusElement.style.cssText = `
    position: fixed;
    top: 16px;
    left: 16px;
    z-index: 1000;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: calc(14px * var(--text-scale));
    font-weight: 600;
    color: var(--leaf-500);
    pointer-events: none;
  `;
document.body.appendChild(statusElement);

detailElement = document.createElement('div');
detailElement.id = 'detail';
detailElement.style.cssText = `
    position: fixed;
    top: 40px;
    left: 16px;
    z-index: 1000;
    font-family: ui-monospace, "JetBrains Mono", monospace;
    font-size: calc(12px * var(--text-scale));
    color: var(--bone-300);
    white-space: pre-wrap;
    max-width: 400px;
    pointer-events: none;
  `;
document.body.appendChild(detailElement);

hintCardElement = document.createElement('div');
hintCardElement.id = 'hint-card';
hintCardElement.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(20, 24, 15, 0.95);
      border: 1px solid var(--bark-700);
      border-radius: 8px;
      padding: 16px 24px;
      color: var(--bone-100);
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      font-size: calc(14px * var(--text-scale));
      line-height: 1.6;
      text-align: center;
      max-width: 90vw;
      z-index: 100;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      opacity: 0;
      transition: opacity 0.3s ease;
      pointer-events: none;
    `;
document.body.appendChild(hintCardElement);

// T00A: Resource readout element (HUD layer)
let resourceReadoutElement: HTMLDivElement | null = null;
let resourceTooltipElements: {
  light: HTMLSpanElement;
  water: HTMLSpanElement;
  minerals: HTMLSpanElement;
} | null = null;

function createResourceReadout(): void {
  const layer = uiShell?.getLayer('hud');
  if (!layer) return;

  resourceReadoutElement = document.createElement('div');
  resourceReadoutElement.id = 'resource-readout';
  resourceReadoutElement.style.cssText = `
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 200;
      background: rgba(20, 24, 15, 0.9);
      border: 1px solid var(--bark-700);
      border-radius: 8px;
      padding: 12px 16px;
      color: var(--bone-100);
      font-family: ui-monospace, "JetBrains Mono", monospace;
      font-size: calc(12px * var(--text-scale));
      line-height: 1.8;
      min-width: 180px;
      pointer-events: auto;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    `;

  const lightEl = document.createElement('div');
  lightEl.innerHTML = `<span style="color: var(--gold-400);">☀</span> Light: <span id="res-light">0</span>`;
  const waterEl = document.createElement('div');
  waterEl.innerHTML = `<span style="color: var(--water-400);">💧</span> Water: <span id="res-water">0</span>`;
  const mineralsEl = document.createElement('div');
  mineralsEl.innerHTML = `<span style="color: var(--mineral-400);">⛏</span> Minerals: <span id="res-minerals">0</span>`;

  resourceReadoutElement.appendChild(lightEl);
  resourceReadoutElement.appendChild(waterEl);
  resourceReadoutElement.appendChild(mineralsEl);
  layer.appendChild(resourceReadoutElement);

  // Store tooltip references
  resourceTooltipElements = {
    light: document.getElementById('res-light') as HTMLSpanElement,
    water: document.getElementById('res-water') as HTMLSpanElement,
    minerals: document.getElementById('res-minerals') as HTMLSpanElement,
  };

  // Add hover tooltips
  if (resourceTooltipElements) {
    lightEl.title = onboardingConfig.resource_tooltips.light;
    waterEl.title = onboardingConfig.resource_tooltips.water;
    mineralsEl.title = onboardingConfig.resource_tooltips.minerals;
  }
}

function updateResourceReadout(light: number, water: number, minerals: number): void {
  if (!resourceTooltipElements) return;
  resourceTooltipElements.light.textContent = light.toFixed(1);
  resourceTooltipElements.water.textContent = water.toFixed(1);
  resourceTooltipElements.minerals.textContent = minerals.toFixed(1);
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14180f);
scene.fog = new THREE.Fog(0x14180f, 60, 260);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 800);
camera.position.set(0, 18, 26);
camera.lookAt(0, 0, 0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enablePan = true;
controls.minDistance = 10;
controls.maxDistance = 200;
controls.maxPolarAngle = Math.PI / 2 - 0.05;

// World ground. T02 owns the Root Sight soil cutaway shader: the ground turns
// semi-transparent inside the cutaway sphere so roots are revealed, then C03
// reuses/refines the same technique for general environment cutaways.
const groundMaterial = new THREE.MeshStandardMaterial({
  color: 0x2f3824,
  roughness: 1,
  metalness: 0,
  transparent: true,
});
groundMaterial.onBeforeCompile = (shader) => {
  shader.uniforms.uRootSightProgress = soilCutawayUniforms.uRootSightProgress;
  shader.uniforms.uRootSightCenter = soilCutawayUniforms.uRootSightCenter;
  shader.uniforms.uRootSightRadius = soilCutawayUniforms.uRootSightRadius;
  shader.uniforms.uRootSightSoilOpacity = soilCutawayUniforms.uRootSightSoilOpacity;

  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vSoilWorldPos;')
    .replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvSoilWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;',
    );

  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
varying vec3 vSoilWorldPos;
uniform float uRootSightProgress;
uniform vec3 uRootSightCenter;
uniform float uRootSightRadius;
uniform float uRootSightSoilOpacity;`,
    )
    .replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
float soilDist = distance(vSoilWorldPos, uRootSightCenter);
float soilCut = 1.0 - smoothstep(uRootSightRadius * 0.85, uRootSightRadius, soilDist);
gl_FragColor.a = mix(1.0, uRootSightSoilOpacity, soilCut * uRootSightProgress);`,
    );
};
groundMaterial.customProgramCacheKey = () => 'root-sight-soil-v1';

const ground = new THREE.Mesh(new THREE.CircleGeometry(300, 64), groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.03;
ground.receiveShadow = true;
scene.add(ground);

const gridHelper = new THREE.GridHelper(400, 80, 0x555544, 0x3a3a2c);
const gridMaterial = gridHelper.material as THREE.LineBasicMaterial;
gridMaterial.transparent = true;
gridHelper.position.y = 0.01;
scene.add(gridHelper);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffffee, 1.4);
sunLight.position.set(50, 100, 50);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 1024;
sunLight.shadow.mapSize.height = 1024;
sunLight.shadow.camera.near = 10;
sunLight.shadow.camera.far = 200;
sunLight.shadow.camera.left = -100;
sunLight.shadow.camera.right = 100;
sunLight.shadow.camera.top = 100;
sunLight.shadow.camera.bottom = -100;
scene.add(sunLight);

const hemisphereLight = new THREE.HemisphereLight(0x87ceeb, 0x8b4513, 0.3);
scene.add(hemisphereLight);

function sendInput(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  inputTick++;
  const input: PlayerInput = {
    moveForward: inputBus?.isActive('move_forward') ?? false,
    moveBackward: inputBus?.isActive('move_backward') ?? false,
    moveLeft: inputBus?.isActive('move_left') ?? false,
    moveRight: inputBus?.isActive('move_right') ?? false,
    tick: inputTick,
  };

  const message = JSON.stringify({
    type: MESSAGE_TYPE.INPUT,
    payload: { input },
  });
  ws.send(message);
}

function sendGrowthIntent(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN || !plantId) return;

  growthIntentTick++;

  const isRootSight = rootSightEnabled;
  const allNodes = Array.from(plantNodes.values());
  const seedNode = allNodes.length > 0 ? allNodes[0] : null;
  if (!seedNode) return;

  // Separate true root branches from the origin seed node
  const rootBranches = allNodes.filter((n) => n.type === 0 && n.id !== seedNode.id);
  const stems = allNodes.filter((n) => n.type >= 1);

  let parentNode: PlantNodeData | null = null;
  let nodeType: 'root' | 'stem' = 'stem';
  let dir = new THREE.Vector3(0, 1, 0);

  const camDir = new THREE.Vector3(0, 0, -1);
  camDir.applyQuaternion(camera.quaternion);
  camDir.normalize();

  if (isRootSight) {
    // Mode 1: Underground Root Sight -> Branching radial root architecture
    nodeType = 'root';
    if (rootBranches.length === 0) {
      // Primary radicle taproot down
      parentNode = seedNode;
      dir = new THREE.Vector3(0, -0.95, 0);
      setDetail('Anchoring primary taproot into deep soil strata...');
    } else {
      // Lateral fibrous root branching spreading into soil with phyllotaxis
      const rootAngle = rootBranches.length * 2.39996; // ~137.5° golden angle
      parentNode =
        rootBranches.length % 2 === 0
          ? seedNode
          : rootBranches[Math.floor(rootBranches.length / 3)];
      dir = new THREE.Vector3(
        Math.cos(rootAngle) * 0.72 + camDir.x * 0.15,
        -0.62,
        Math.sin(rootAngle) * 0.72 + camDir.z * 0.15,
      ).normalize();
      setDetail('Spreading lateral fibrous root network into the soil...');
    }
  } else {
    // Mode 2: Canopy / Surface Mode -> Real Botanical Morphogenesis
    if (stems.length === 0) {
      // Stage 0: Embryo Germination - seed sprouts upward
      parentNode = seedNode;
      nodeType = 'stem';
      dir = new THREE.Vector3(0, 1.0, 0);
      setDetail('The seed germinates! An apical sprout shoots upward toward the light.');
    } else if (stems.length === 1 && rootBranches.length === 0) {
      // Stage 1: Radicle Anchor - seed splits and anchors primary taproot into soil
      parentNode = seedNode;
      nodeType = 'root';
      dir = new THREE.Vector3(0, -0.95, 0);
      setDetail('The seed splits! A primary radicle taproot anchors into the earth.');
    } else if (stems.length === 1 && rootBranches.length === 1) {
      // Stage 2: Shoot Internode 2 - stem grows taller, unfurling foliage
      parentNode = stems[0];
      nodeType = 'stem';
      dir = new THREE.Vector3(0.06, 0.95, -0.04).normalize();
      setDetail('The sprout grows taller, unfurling young foliage.');
    } else if (rootBranches.length < Math.floor(stems.length / 2)) {
      // Stage 3: Lateral Root Crown - spread anchor roots into topsoil
      parentNode = seedNode;
      nodeType = 'root';
      const rootAngle = rootBranches.length * 2.39996;
      dir = new THREE.Vector3(
        Math.cos(rootAngle) * 0.72,
        -0.6,
        Math.sin(rootAngle) * 0.72,
      ).normalize();
      setDetail('A lateral anchor root spreads into topsoil for moisture and stability.');
    } else if (stems.length >= 3 && stems.length % 3 === 0) {
      // Stage 4: Lateral Canopy Branching - branch outward with phyllotaxis and leaves
      const branchParentIndex = Math.max(0, stems.length - 2);
      parentNode = stems[branchParentIndex];
      nodeType = 'stem';
      const branchAngle = stems.length * 2.39996;
      dir = new THREE.Vector3(
        Math.cos(branchAngle) * 0.72,
        0.62,
        Math.sin(branchAngle) * 0.72,
      ).normalize();
      setDetail('A lateral branch emerges with lush young leaves.');
    } else {
      // Stage 5: Apical Leader Growth - main shoot grows taller toward sun
      const highestStem = stems.reduce(
        (prev, curr) => (curr.position.y > prev.position.y ? curr : prev),
        stems[0],
      );
      parentNode = highestStem;
      nodeType = 'stem';
      const swayAngle = stems.length * 2.39996;
      dir = new THREE.Vector3(
        Math.cos(swayAngle) * 0.12,
        0.95,
        Math.sin(swayAngle) * 0.12,
      ).normalize();
      setDetail('Apical leader reaches upward with new internodes and foliage.');
    }
  }

  if (!parentNode) return;

  const isAttack = false;

  const intent: GrowthIntent = {
    plantId,
    nodeId: parentNode.id,
    direction: { x: dir.x, y: dir.y, z: dir.z },
    nodeType,
    isAttack,
    tick: growthIntentTick,
  };

  const message = JSON.stringify({
    type: MESSAGE_TYPE.GROWTH_INTENT,
    payload: { intent },
  });
  ws.send(message);
}

function connect(): void {
  if (connecting || (ws && ws.readyState === WebSocket.OPEN)) return;

  connecting = true;
  setStatus('Connecting…', 'pending');
  setDetail(`Connecting to ${wsOrigin}...`);

  ws = new WebSocket(`${wsOrigin}/ws`);

  ws.onopen = () => {
    connecting = false;
    setStatus('Connected', 'ok');
    setDetail('WebSocket connected. Waiting for welcome...');

    const hello = JSON.stringify({
      type: MESSAGE_TYPE.HELLO,
      payload: { clientVersion: 1, plantId: getStoredPlantId() },
    });
    ws?.send(hello);
  };

  ws.onmessage = async (event) => {
    try {
      const message = JSON.parse(event.data);
      const { type, payload } = message;

      if (debugOverlay) {
        debugOverlay.recordBytes(event.data.length, 0);
      }

      switch (type) {
        case MESSAGE_TYPE.WELCOME: {
          welcome = payload as WelcomePayload;
          const isReconnect = getStoredPlantId() !== null && getStoredPlantId() !== welcome.plantId;

          playerId = welcome.playerId;
          myCubeId = welcome.cubeId;
          plantId = welcome.plantId;
          setStoredPlantId(plantId);
          serverTick = welcome.tick;
          cubes.clear();
          // Populate initial cubes from welcome
          for (const cube of welcome.cubes) {
            cubes.set(cube.id, cube);
          }
          plantNodes.clear();
          // Initialize with root node from server
          if (welcome.rootNode) {
            plantNodes.set(welcome.rootNode.id, {
              id: welcome.rootNode.id,
              position: new THREE.Vector3(
                welcome.rootNode.x,
                welcome.rootNode.y,
                welcome.rootNode.z,
              ),
              type: 0, // root
              radius: nodeRadius(welcome.rootNode.biomass, 0, welcome.rootNode.y),
              parentId: null,
              age: 10,
              health: 0.9,
              mutationFlags: 0,
              biomass: welcome.rootNode.biomass,
              isOwnPlant: true,
              spawnTime: performance.now(),
            });
            plantBiomass = welcome.totalBiomass;
            if (plantRenderer) {
              plantRenderer.updatePlantData(Array.from(plantNodes.values()));
            }
          }

          // Request full plant sync on reconnect to get all nodes
          if (isReconnect && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: MESSAGE_TYPE.PLANT_SYNC_REQUEST, payload: {} }));
            setDetail('Reconnected — syncing plant state...');
          }
          // Clear other players' plants to avoid stale data on reconnect
          otherPlayerPlants.clear();
          break;
        }

        case MESSAGE_TYPE.STATE:
        case MESSAGE_TYPE.KEYFRAME: {
          const state = payload as StatePayload | KeyframePayload;
          serverTick = state.tick;
          if (debugOverlay) {
            debugOverlay.recordBytes(0, event.data.length);
          }
          // Update cubes from server state
          for (const cube of state.cubes) {
            cubes.set(cube.id, cube);
          }
          break;
        }

        case MESSAGE_TYPE.RESOURCE_UPDATE: {
          const update = payload as {
            tick: number;
            tiles: Array<{ light: number; moisture: number; minerals: number }>;
            width: number;
            height: number;
            tileSize: number;
          };
          serverTick = update.tick;
          if (debugOverlay) {
            debugOverlay.recordBytes(0, event.data.length);
          }
          // Use center tile for now (TODO: use actual plant root position)
          const centerTileX = Math.floor(update.width / 2);
          const centerTileZ = Math.floor(update.height / 2);
          const tileIndex = centerTileZ * update.width + centerTileX;
          if (tileIndex >= 0 && tileIndex < update.tiles.length) {
            const tile = update.tiles[tileIndex];
            updateResourceReadout(tile.light, tile.moisture, tile.minerals);
          }
          break;
        }

        case MESSAGE_TYPE.GROWTH_EVENT: {
          const growth = payload as GrowthEventPayload;
          const node = growth.newNode;
          const typeMap: Record<string, number> = {
            root: 0,
            stem: 1,
            vine: 2,
            leaf: 3,
            flower: 3,
            spore_sac: 3,
          };
          const nodeTypeNum = typeMap[node.type] ?? 0;
          const radius = nodeRadius(node.biomass, nodeTypeNum, node.y);
          const health = Math.min(1, node.biomass / 10);
          const nodeData = {
            id: node.id,
            position: new THREE.Vector3(node.x, node.y, node.z),
            type: nodeTypeNum,
            radius,
            parentId: node.parentId,
            age: node.age,
            health,
            mutationFlags: 0,
            biomass: node.biomass,
            isOwnPlant: false, // Will be set to true below for own plant
            spawnTime: performance.now(), // Trigger 0.9s real-time growth emergence animation
          };

          if (growth.plantId === plantId) {
            // Local player's plant
            nodeData.isOwnPlant = true;
            plantNodes.set(node.id, nodeData);
            plantBiomass = growth.totalBiomass ?? plantBiomass;
            if (plantRenderer) {
              const otherNodes: PlantNodeData[] = [];
              for (const nodes of otherPlayerPlants.values()) {
                otherNodes.push(...nodes.values());
              }
              const allNodes = [...plantNodes.values(), ...otherNodes];
              plantRenderer.updatePlantData(allNodes);
            }
            setDetail(
              `Grew ${node.type} #${plantNodes.size} at (${node.x.toFixed(1)}, ${node.y.toFixed(1)}, ${node.z.toFixed(1)}) — Biomass: ${plantBiomass.toFixed(1)}`,
            );
          } else {
            // Other player's plant
            let otherPlant = otherPlayerPlants.get(growth.plantId);
            if (!otherPlant) {
              otherPlant = new Map();
              otherPlayerPlants.set(growth.plantId, otherPlant);
            }
            otherPlant.set(node.id, nodeData);
          }
          break;
        }

        case MESSAGE_TYPE.REJECT: {
          const reject = payload as RejectPayload;
          const readableReason =
            reject.reason === 'growth_on_cooldown'
              ? 'Cooldown (0.5s) — wait a moment to grow'
              : reject.reason === 'insufficient_biomass' ||
                  reject.reason === 'insufficient_biomass_for_node'
                ? 'Insufficient biomass to grow'
                : reject.reason === 'cannot_cross_layer'
                  ? 'Cannot cross layer directly'
                  : reject.reason;
          setDetail(`Growth Notice: ${readableReason}`);
          break;
        }

        case MESSAGE_TYPE.ERROR: {
          const error = payload as ErrorPayload;
          setDetail(`ERROR: ${error.code} - ${error.message}`);
          break;
        }

        case MESSAGE_TYPE.PLANT_SYNC: {
          const sync = payload as {
            plants: Array<{
              id: string;
              ownerId: string;
              rootNodeId: string | null;
              totalBiomass: number;
              totalUpkeep: number;
              nodes: Array<{
                id: string;
                plantId: string;
                type: string;
                layer: string;
                x: number;
                y: number;
                z: number;
                biomass: number;
                age: number;
                parentId: string | null;
                children: string[];
                statModifiers: Record<string, number>;
                resourceDrawWater: number;
                resourceDrawNutrients: number;
                upkeepBiomassPerSecond: number;
                growthDirectionBias: string;
                lastGrowthTick: number;
              }>;
            }>;
          };
          const typeMap: Record<string, number> = {
            root: 0,
            stem: 1,
            vine: 2,
            leaf: 3,
            flower: 3,
            spore_sac: 3,
          };
          for (const plant of sync.plants) {
            if (plant.id === plantId) continue; // Skip own plant (already loaded from WELCOME)
            const otherPlant = new Map<
              string,
              {
                id: string;
                position: THREE.Vector3;
                type: number;
                radius: number;
                parentId: string | null;
                age: number;
                health: number;
                mutationFlags: number;
                biomass: number;
                isOwnPlant: boolean;
              }
            >();
            for (const node of plant.nodes) {
              const nodeTypeNum = typeMap[node.type] ?? 0;
              const radius = nodeRadius(node.biomass, nodeTypeNum, node.y);
              const health = Math.min(1, node.biomass / 10);
              otherPlant.set(node.id, {
                id: node.id,
                position: new THREE.Vector3(node.x, node.y, node.z),
                type: nodeTypeNum,
                radius,
                parentId: node.parentId,
                age: node.age,
                health,
                mutationFlags: 0,
                biomass: node.biomass,
                isOwnPlant: false,
              });
            }
            otherPlayerPlants.set(plant.id, otherPlant);
          }
          // Update renderer with all plants
          if (plantRenderer) {
            const otherNodes: Array<{
              id: string;
              position: THREE.Vector3;
              type: number;
              radius: number;
              parentId: string | null;
              age: number;
              health: number;
              mutationFlags: number;
              biomass: number;
            }> = [];
            for (const nodes of otherPlayerPlants.values()) {
              otherNodes.push(...nodes.values());
            }
            const allNodes = [...plantNodes.values(), ...otherNodes];
            plantRenderer.updatePlantData(allNodes);
          }
          setDetail(`Synced ${sync.plants.length} plants from server`);
          break;
        }

        case MESSAGE_TYPE.PLANT_CREATED: {
          const created = payload as {
            plant: {
              id: string;
              ownerId: string;
              rootNodeId: string | null;
              totalBiomass: number;
              totalUpkeep: number;
              nodes: Array<{
                id: string;
                plantId: string;
                type: string;
                layer: string;
                x: number;
                y: number;
                z: number;
                biomass: number;
                age: number;
                parentId: string | null;
                children: string[];
                statModifiers: Record<string, number>;
                resourceDrawWater: number;
                resourceDrawNutrients: number;
                upkeepBiomassPerSecond: number;
                growthDirectionBias: string;
                lastGrowthTick: number;
              }>;
            };
          };
          const typeMap: Record<string, number> = {
            root: 0,
            stem: 1,
            vine: 2,
            leaf: 3,
            flower: 3,
            spore_sac: 3,
          };
          if (created.plant.id === plantId) break; // Skip own plant
          const otherPlant = new Map<
            string,
            {
              id: string;
              position: THREE.Vector3;
              type: number;
              radius: number;
              parentId: string | null;
              age: number;
              health: number;
              mutationFlags: number;
              biomass: number;
              isOwnPlant: boolean;
            }
          >();
          for (const node of created.plant.nodes) {
            const nodeTypeNum = typeMap[node.type] ?? 0;
            const radius = nodeRadius(node.biomass, nodeTypeNum);
            const health = Math.min(1, node.biomass / 10);
            otherPlant.set(node.id, {
              id: node.id,
              position: new THREE.Vector3(node.x, node.y, node.z),
              type: nodeTypeNum,
              radius,
              parentId: node.parentId,
              age: node.age,
              health,
              mutationFlags: 0,
              biomass: node.biomass,
              isOwnPlant: false,
            });
          }
          otherPlayerPlants.set(created.plant.id, otherPlant);
          // Update renderer with all plants
          if (plantRenderer) {
            const otherNodes: PlantNodeData[] = [];
            for (const nodes of otherPlayerPlants.values()) {
              otherNodes.push(...nodes.values());
            }
            const allNodes = [...plantNodes.values(), ...otherNodes];
            plantRenderer.updatePlantData(allNodes);
          }
          setDetail(`New player joined: ${created.plant.id}`);
          break;
        }

        case MESSAGE_TYPE.PLANT_REMOVED: {
          const removed = payload as { plantId: string };
          if (otherPlayerPlants.delete(removed.plantId)) {
            // Update renderer with remaining plants
            if (plantRenderer) {
              const otherNodes: PlantNodeData[] = [];
              for (const nodes of otherPlayerPlants.values()) {
                otherNodes.push(...nodes.values());
              }
              const allNodes = [...plantNodes.values(), ...otherNodes];
              plantRenderer.updatePlantData(allNodes);
            }
            setDetail(`Player left: ${removed.plantId}`);
          }
          break;
        }

        case MESSAGE_TYPE.PONG:
          break;

        default:
          console.warn('Unknown message type:', type);
      }

      // Frame camera on first spawn (after WELCOME)
      if (welcome?.rootNode && !cameraFramed) {
        cameraFramed = true;
        const target = new THREE.Vector3(
          welcome.rootNode.x,
          welcome.rootNode.y,
          welcome.rootNode.z,
        );
        controls.target.copy(target);
        camera.position.set(target.x + 12, target.y + 14, target.z + 20);
        controls.update();
        setDetail(
          `Welcome! You are ${myCubeId}\nPlayer ID: ${playerId}\nServer tick: ${serverTick}\nT01: Growth Active — Press 'G' to grow stem from root`,
        );
        // T00A: Load onboarding config and show hint card on first spawn
        await loadOnboardingConfig();
        await initPlantRenderer();
        createResourceReadout();
        // T00A: Show hint card (3 lines per RULE_13)
        if (hintCardElement) {
          hintCardElement.innerHTML = onboardingConfig.hint_card_lines
            .map((line) => `<div>${line}</div>`)
            .join('');
          hintCardElement.style.opacity = '1';
          setTimeout(() => {
            hintCardElement.style.opacity = '0';
          }, onboardingConfig.show_hint_card_duration_ms);
        }
      }
    } catch (error) {
      console.error('Failed to parse message:', error);
    }
  };

  ws.onclose = (event) => {
    connecting = false;
    setStatus('Disconnected', 'down');
    setDetail(`Connection closed: code=${event.code}, reason=${event.reason || 'none'}`);
    setTimeout(connect, 3000);
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    setDetail('WebSocket error');
  };
}

// Resize handler
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Render loop
let measuredFps = 60;
function animate(): void {
  requestAnimationFrame(animate);
  controls.update();

  const now = performance.now();
  const deltaTime = Math.min(0.25, (now - lastUpdateTime) / 1000);
  lastUpdateTime = now;
  if (deltaTime > 0) measuredFps = 1 / deltaTime;

  // T02: Update Root Sight transition and cutaway state
  if (rootSightConfig) {
    updateRootSight(deltaTime);
  }

  // Update plant renderer
  if (plantRenderer) {
    plantRenderer.update(deltaTime);
  }

  // Quality controller: adjust pixel ratio based on the measured frame rate.
  if (qualityController) {
    qualityController.adjust(measuredFps, renderer.info.render.triangles ?? 0);
    const ratio = qualityController.pixelRatio;
    if (Number.isFinite(ratio) && Math.abs(renderer.getPixelRatio() - ratio) > 0.001) {
      renderer.setPixelRatio(ratio);
    }
  }

  // Sample debug metrics once per frame so the overlay reports the real fps.
  if (debugOverlay) {
    const info = renderer.info.render;
    debugOverlay.update({ triangles: info.triangles, drawCalls: info.calls });
  }

  renderer.render(scene, camera);
}

// Start
await initC01();
connect();

// Send input at 20Hz (after input bus is initialized)
setInterval(sendInput, 50);

// Ping every 5 seconds
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: MESSAGE_TYPE.PING, payload: {} }));
  }
}, 5000);

animate();

declare global {
  interface ImportMeta {
    readonly env: { readonly DEV: boolean };
  }
}

interface PlantLegacyDebugHandle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  plantNodes: typeof plantNodes;
  readonly plantRenderer: PlantRenderer | null;
}

// Development handle for inspecting the live scene from the browser console.
if (import.meta.env.DEV) {
  (window as Window & { __plantLegacy?: PlantLegacyDebugHandle }).__plantLegacy = {
    renderer,
    scene,
    camera,
    controls,
    plantNodes,
    get plantRenderer() {
      return plantRenderer;
    },
  };
}
