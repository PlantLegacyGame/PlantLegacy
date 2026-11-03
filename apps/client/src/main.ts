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
import { loadControlsConfig, loadRenderConfig, loadUIConfig } from './config/clientConfig.js';
import { loadPlantRendererConfig } from './config/plantRendererConfig.js';
import { createInputBus, type InputBus } from './input/InputBus.js';
import { createQualityController, type QualityController } from './render/QualityController.js';
import { PlantRenderer } from './renderers/PlantRenderer.js';
import { createDebugOverlay, type DebugOverlay } from './ui/DebugOverlay.js';
import { createUIShell, type UIShell } from './ui/UIShell.js';
import './styles.css';

const serverOrigin =
  document.querySelector('meta[name="server-origin"]')?.getAttribute('content') ?? '';

const isLocalDev =
  (location.hostname === '127.0.0.1' || location.hostname === 'localhost') &&
  location.port === '4173';
const httpOrigin = serverOrigin || (isLocalDev ? 'http://127.0.0.1:8080' : location.origin);
const wsOrigin = isLocalDev ? 'ws://127.0.0.1:8080' : httpOrigin.replace(/^http/, 'ws');

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
  WELCOME: 10,
  STATE: 11,
  KEYFRAME: 12,
  REJECT: 13,
  PONG: 14,
  ERROR: 15,
  GROWTH_EVENT: 16,
  RESOURCE_UPDATE: 17,
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
let growthIntentTick = 0;
let lastGrownNodeId: string | null = null;
let plantBiomass = 0;
const plantNodes = new Map<
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
  }
>();

// C01: Input abstraction - replaces hardcoded keydown/keyup
let inputBus: InputBus | null = null;
let uiShell: UIShell | null = null;
let debugOverlay: DebugOverlay | null = null;
let qualityController: QualityController | null = null;

// Node radii are derived from biomass but kept inside a readable range so a
// newly grown stem is visible next to the much heavier root node.
function nodeRadius(biomass: number): number {
  return 0.18 + Math.min(1.2, Math.sqrt(Math.max(0, biomass)) * 0.07);
}

// T01: Plant Renderer
let plantRenderer: PlantRenderer | null = null;
let lastUpdateTime = performance.now();

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

async function initC01(): Promise<void> {
  // Load C01 configs
  const [renderConfig, controlsConfig, uiConfig] = await Promise.all([
    loadRenderConfig(httpOrigin),
    loadControlsConfig(httpOrigin),
    loadUIConfig(httpOrigin),
  ]);

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
    rootSightEnabled: config.rootSightEnabled,
    rootSightOpacity: config.rootSightOpacity,
    canopySightEnabled: config.canopySightEnabled,
    photosynthesisViz: config.photosynthesisVisualization,
    waterFlowViz: config.waterFlowVisualization,
    nutrientFlowViz: config.nutrientFlowVisualization,
    nodeSize: 1.0,
  });

  // Initialize with existing plant nodes (root node from WELCOME, or empty)
  if (plantRenderer) {
    plantRenderer.updatePlantData(Array.from(plantNodes.values()));
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

// World ground. The previous build removed the ground plane assuming the
// plant renderer drew one, which left the scene with only the clear colour.
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(300, 64),
  new THREE.MeshStandardMaterial({ color: 0x2f3824, roughness: 1, metalness: 0 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.03;
ground.receiveShadow = true;
scene.add(ground);

const gridHelper = new THREE.GridHelper(400, 80, 0x555544, 0x3a3a2c);
gridHelper.position.y = 0.01;
scene.add(gridHelper);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffffee, 1.4);
sunLight.position.set(50, 100, 50);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
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
    moveForward: inputBus?.isActive('camera_pan') ?? false,
    moveBackward: inputBus?.isActive('camera_pan') ?? false,
    moveLeft: inputBus?.isActive('camera_pan') ?? false,
    moveRight: inputBus?.isActive('camera_pan') ?? false,
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
  // Grow from the most recently added node so stems chain, not all from root
  const growFrom = lastGrownNodeId ? plantNodes.get(lastGrownNodeId) : null;
  const rootNode = plantNodes.size > 0 ? Array.from(plantNodes.values())[0] : null;
  const parentNode = growFrom ?? rootNode;
  if (!parentNode) return;

  // Grow stems upward (canopy) with camera direction mixed in
  const camDir = new THREE.Vector3(0, 0, -1);
  camDir.applyQuaternion(camera.quaternion);
  camDir.normalize();
  const dir = new THREE.Vector3(camDir.x * 0.7, 0.7, camDir.z * 0.7).normalize();

  const nodeType = 'stem';
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
      payload: { clientVersion: 1 },
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
          const welcome = payload as WelcomePayload;
          playerId = welcome.playerId;
          myCubeId = welcome.cubeId;
          plantId = welcome.plantId;
          serverTick = welcome.tick;
          cubes.clear();
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
              radius: nodeRadius(welcome.rootNode.biomass),
              parentId: null,
              age: 10,
              health: 0.9,
              mutationFlags: 0,
              biomass: welcome.rootNode.biomass,
            });
            plantBiomass = welcome.totalBiomass;
            lastGrownNodeId = welcome.rootNode.id;

            // Frame the player's plant on spawn so the root is not a speck in
            // the distance.
            const target = new THREE.Vector3(
              welcome.rootNode.x,
              welcome.rootNode.y,
              welcome.rootNode.z,
            );
            controls.target.copy(target);
            camera.position.set(target.x + 12, target.y + 14, target.z + 20);
            controls.update();
          }
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
          break;
        }

        case MESSAGE_TYPE.STATE:
        case MESSAGE_TYPE.KEYFRAME: {
          const state = payload as StatePayload | KeyframePayload;
          serverTick = state.tick;
          if (debugOverlay) {
            debugOverlay.recordBytes(0, event.data.length);
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
          if (growth.plantId !== plantId) break;
          const node = growth.newNode;
          const typeMap: Record<string, number> = {
            root: 0,
            stem: 1,
            vine: 2,
            leaf: 3,
            flower: 3,
            spore_sac: 3,
          };
          const radius = nodeRadius(node.biomass);
          const health = Math.min(1, node.biomass / 10);
          plantNodes.set(node.id, {
            id: node.id,
            position: new THREE.Vector3(node.x, node.y, node.z),
            type: typeMap[node.type] ?? 0,
            radius,
            parentId: node.parentId,
            age: node.age,
            health,
            mutationFlags: 0,
            biomass: node.biomass,
          });
          plantBiomass = growth.totalBiomass ?? plantBiomass;
          lastGrownNodeId = node.id;
          if (plantRenderer) {
            plantRenderer.updatePlantData(Array.from(plantNodes.values()));
          }
          setDetail(
            `Grew ${node.type} at (${node.x.toFixed(1)}, ${node.y.toFixed(1)}, ${node.z.toFixed(1)})`,
          );
          break;
        }

        case MESSAGE_TYPE.REJECT: {
          const reject = payload as RejectPayload;
          setDetail(`REJECTED: ${reject.reason}\n${detailElement?.textContent || ''}`);
          break;
        }

        case MESSAGE_TYPE.ERROR: {
          const error = payload as ErrorPayload;
          setDetail(`ERROR: ${error.code} - ${error.message}`);
          break;
        }

        case MESSAGE_TYPE.PONG:
          break;

        default:
          console.warn('Unknown message type:', type);
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

// Send input at 20Hz
setInterval(sendInput, 50);

// Ping every 5 seconds
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: MESSAGE_TYPE.PING, payload: {} }));
  }
}, 5000);

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

  // Update plant renderer
  if (plantRenderer) {
    const now = performance.now();
    const deltaTime = Math.min(0.25, (now - lastUpdateTime) / 1000);
    lastUpdateTime = now;
    if (deltaTime > 0) measuredFps = 1 / deltaTime;
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
