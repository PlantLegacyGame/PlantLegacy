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

import {
  clampGrowthDirectionByGene,
  NODE_GROWTH_CONSTRAINTS,
  type NodeType,
} from '@plant-legacy/shared/growth';
import { PROTOCOL_VERSION } from '@plant-legacy/shared/protocol';
import { validateMessage } from '@plant-legacy/shared/protocol/messageSchemas';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  loadControlsConfig,
  loadRenderConfig,
  loadRootSightConfig,
  loadUIConfig,
  type RenderConfig,
  type RootSightConfig,
} from './config/clientConfig.js';
import { loadPlantRendererConfig } from './config/plantRendererConfig.js';
import { createInputBus, type InputBus } from './input/InputBus.js';
import { createQualityController, type QualityController } from './render/QualityController.js';
import { EnvironmentRenderer } from './renderers/EnvironmentRenderer.js';
import { DEFAULT_CONFIG, type PlantNodeData, PlantRenderer } from './renderers/PlantRenderer.js';
import {
  createRootSightStateMachine,
  type RootSightStateMachine,
  rootSightStateMachineIsEnabled,
  rootSightStateMachineSetContext,
  rootSightStateMachineSetTarget,
  rootSightStateMachineToggle,
  rootSightStateMachineUpdate,
} from './renderers/RootSightStateMachine.js';
import { isWebGPUSupported, WebGPUDevice } from './renderers/webgpu/WebGPUDevice.js';
import { WebGPURenderer } from './renderers/webgpu/WebGPURenderer.js';
import { createDebugOverlay, type DebugOverlay } from './ui/DebugOverlay.js';
import { createDevPanel, type DevPanelAPI } from './ui/DevPanel.js';
import {
  createGrowthSelectionStateMachine,
  type GrowthDrawingData,
  type GrowthSelectionViewData,
  growthSelectionStateMachineCancelDrawing,
  growthSelectionStateMachineConfirmDrawing,
  growthSelectionStateMachineGetDrawingData,
  growthSelectionStateMachineGetState,
  growthSelectionStateMachineHide,
  growthSelectionStateMachineIsDrawing,
  growthSelectionStateMachineIsVisible,
  growthSelectionStateMachineRenderOptions,
  growthSelectionStateMachineRequestOptions,
  growthSelectionStateMachineSelectOption,
  growthSelectionStateMachineStartDrawing,
  growthSelectionStateMachineUpdateDrawing,
} from './ui/GrowthSelectionStateMachine.js';
import { createUIShell, type UIShell } from './ui/UIShell.js';
import './styles.css';

const serverOrigin =
  document.querySelector('meta[name="server-origin"]')?.getAttribute('content') ?? '';

const isLocalDev = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
const defaultServerPort = '8080';
const httpOrigin =
  serverOrigin ||
  (isLocalDev
    ? `${location.protocol}//${location.hostname}:${defaultServerPort}`
    : location.origin);
// In dev, connect directly to server WebSocket to avoid Vite proxy issues
const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsOrigin = isLocalDev
  ? `${wsProtocol}//${location.hostname}:${defaultServerPort}`
  : httpOrigin.replace(/^http/, 'ws');

// D01: Dev mode gate - only enable dev features with ?dev=1 query param
const isDevMode = new URLSearchParams(location.search).has('dev');

// T00A: Onboarding config types
interface OnboardingConfig {
  hint_card_lines: string[];
  show_hint_card_duration_ms: number;
  resource_tooltips: {
    biomass: string;
    light: string;
    water: string;
    minerals: string;
  };
}

let onboardingConfig: OnboardingConfig = {
  hint_card_lines: [
    'WASD / Arrows: Pan camera  |  Right-drag: Orbit  |  Scroll: Zoom  |  Click plant: Grow',
    'You are a plant. Grow roots down, canopy up. Read light, water, minerals.',
    'Other players are other plants. Compete, ally, or parasitize. The world simulates offline.',
  ],
  show_hint_card_duration_ms: 10000,
  resource_tooltips: {
    biomass:
      'Biomass: plant energy reserve. Spend to grow nodes. Gain via photosynthesis (leaves) and mineral absorption (roots).',
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

interface WelcomePayload {
  playerId: string;
  plantId: string;
  tick: number;
  rootNode: { id: string; x: number; y: number; z: number; type: string; biomass: number };
  totalBiomass: number;
  totalEnergy: number;
  // Full node set for immediate client render (ADR-021)
  nodes?: Array<{
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
    growthProgress: number;
    isSeed: boolean;
  }>;
}

interface StatePayload {
  tick: number;
  plants: Array<{
    id: string;
    totalBiomass: number;
    totalEnergy: number;
    totalUpkeep: number;
  }>;
  worldBounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
  tileSize: number;
}

interface KeyframePayload {
  tick: number;
  plants: Array<{
    id: string;
    totalBiomass: number;
    totalUpkeep: number;
  }>;
  worldBounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
  tileSize: number;
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

interface GrowthEventNode {
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
  isSeed?: boolean;
  growthProgress?: number;
}

interface GrowthEventPayload {
  plantId: string;
  /** Normal single-node growth. */
  newNode?: GrowthEventNode;
  /** Multi-node germination. */
  newNodes?: GrowthEventNode[];
  /** Germination replaces the seed node with the root under the same id. */
  updatedParentNode?: GrowthEventNode;
  damageDealt?: number;
  totalBiomass?: number;
  totalEnergy?: number;
  /** Server growth sequence number for client mirror gap detection. */
  growthSeq?: number;
}

// ADR-028: the server owns the growth option list. These mirror the shared
// `GrowthOption`/`GrowthOptionsResult` types and are rendered verbatim.
interface GrowthOptionView {
  type: string;
  label: string;
  energyCost: number;
  biomassGain: number;
  expectedSeconds: number;
  available: boolean;
  reason?: string;
  risk?: string;
  waterCost?: number;
  mineralCost?: number;
}

interface GrowthConditionsView {
  // Tile-based (for germination)
  light: number;
  moisture: number;
  minLight: number;
  minMoisture: number;
  // Plant storage-based (for growth)
  storedWater?: number;
  storedMinerals?: number;
  growthMinWater?: number;
  growthMinMinerals?: number;
  ok: boolean;
  growthOk?: boolean;
}

interface GrowthOptionsView {
  nodeId: string;
  nodeType: string;
  isSeed: boolean;
  energy: number;
  biomass: number;
  options: GrowthOptionView[];
  conditions?: GrowthConditionsView;
}

const MESSAGE_TYPE = {
  HELLO: 1,
  INPUT: 2,
  PING: 3,
  GROWTH_INTENT: 4,
  RESOURCE_QUERY: 5,
  PLANT_SYNC_REQUEST: 6,
  GROWTH_OPTIONS_REQUEST: 7,
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
  WEATHER_UPDATE: 21,
  GROWTH_OPTIONS_RESULT: 22,
  DEV_RESPONSE: 99,
} as const;

let ws: WebSocket | null = null;
let playerId: string | null = null;
let serverTick = 0;
let connecting = false;
let plantId: string | null = null;
let plantReady = false;
let cameraFramed = false;
let welcome: WelcomePayload | null = null;

// Reconnect persistence (ADR-029: explicit dev switch, not implicit)
const RECONNECT_STORAGE_KEY = 'plantlegacy.reconnect.v1';
interface ReconnectData {
  accessToken?: string;
  plantId?: string;
  timestamp?: number;
}
function loadReconnectData(): ReconnectData | null {
  try {
    // Purge legacy cross-tab key from localStorage to prevent tab collision (ADR-029)
    try {
      localStorage.removeItem(RECONNECT_STORAGE_KEY);
    } catch {}

    const raw = sessionStorage.getItem(RECONNECT_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as ReconnectData;
    // Expire after 7 days
    if (data.timestamp && Date.now() - data.timestamp > 7 * 24 * 60 * 60 * 1000) {
      sessionStorage.removeItem(RECONNECT_STORAGE_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}
function saveReconnectData(data: ReconnectData): void {
  try {
    sessionStorage.setItem(
      RECONNECT_STORAGE_KEY,
      JSON.stringify({ ...data, timestamp: Date.now() }),
    );
  } catch {
    // Ignore quota/storage errors
  }
}
function clearReconnectData(): void {
  try {
    sessionStorage.removeItem(RECONNECT_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

// Background render loop timer (for hidden tabs)
let backgroundLoopTimer: ReturnType<typeof setInterval> | null = null;

// Dev panel and state
let devPanel: DevPanelAPI | null = null;
let plantRendererConfig: import('./config/plantRendererConfig.js').PlantRendererConfig | null =
  null;

let growthIntentTick = 0;
let plantBiomass = 0;
let plantEnergy = 0;
// Last authoritative tile readings, so growth events never zero the HUD.
let tileLight = 0;
let tileWater = 40; // Default base moisture from config (tile_moisture_base)
let tileMinerals = 0;
const plantNodes = new Map<string, PlantNodeData>();

// Plant mirror state for gap detection and resync (Phase 1.5)
let plantGrowthSeq = 0;
let plantLastResyncAt = 0;
const PLANT_MAX_GAP_BEFORE_RESYNC = 3;
const PLANT_RESYNC_COOLDOWN_MS = 5000;

function requestPlantResync(): void {
  const now = Date.now();
  if (now - plantLastResyncAt < PLANT_RESYNC_COOLDOWN_MS) return;
  plantLastResyncAt = now;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: MESSAGE_TYPE.PLANT_SYNC_REQUEST, payload: {} }));
  }
}

function checkPlantGrowthGap(expectedSeq: number): boolean {
  if (expectedSeq > plantGrowthSeq + PLANT_MAX_GAP_BEFORE_RESYNC) {
    requestPlantResync();
    return true;
  }
  return false;
}

function resetPlantMirror(): void {
  plantGrowthSeq = 0;
  plantLastResyncAt = 0;
}

// Two-step growth selection state machine (ADR-018, ADR-028)
const growthSelectionMachine = createGrowthSelectionStateMachine();

// Visual indicator for growth direction drawing.
// Screen-projected 3D line: projects world-space segment through the active camera
// and draws on a 2D canvas above the WebGPU plant layer (reliable compositing).
let growthDirectionOverlay: HTMLCanvasElement | null = null;
let growthDirectionOverlayCtx: CanvasRenderingContext2D | null = null;

function ensureGrowthDirectionOverlay(): void {
  if (growthDirectionOverlay && growthDirectionOverlayCtx) return;
  const app = document.getElementById('app');
  if (!app) return;
  const c = document.createElement('canvas');
  c.id = 'growth-direction-overlay';
  c.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:60;';
  app.appendChild(c);
  growthDirectionOverlay = c;
  growthDirectionOverlayCtx = c.getContext('2d');
}

function removeGrowthDirectionLine(): void {
  if (growthDirectionOverlayCtx && growthDirectionOverlay) {
    growthDirectionOverlayCtx.clearRect(
      0,
      0,
      growthDirectionOverlay.width,
      growthDirectionOverlay.height,
    );
  }
}

// Click/drag tracking to distinguish click from camera orbit drag
let clickStartTime = 0;
let clickStartPos = { x: 0, y: 0 };
const CLICK_MAX_DURATION = 200; // ms
const CLICK_MAX_DISTANCE = 5; // pixels

// WASD / arrow camera pan state (ADR-022: the camera is the only thing that moves)
const cameraPanState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
};

// Smooth keyboard zoom state (- / + keys)
const keyboardZoomState = {
  in: false,
  out: false,
};

// Smooth camera focus and zoom animation
const cameraFocusTarget = new THREE.Vector3();
let isCameraFocusing = false;
const CAMERA_FOCUS_LERP_SPEED = 4.5; // Lerp rate per second for smooth arrival
let targetCameraDistance = -1; // Desired distance from target; smoothly lerps when > 0

function focusCameraOnNode(nodeData: PlantNodeData, immediate = false): void {
  const nodePos = nodeData.position.clone();
  // If it's a seed, offset to visual seed center
  if (nodeData.isSeed || nodeData.nodeType === 'seed') {
    nodePos.y += (nodeData.radius || 0.08) * 0.25;
  }

  cameraFocusTarget.copy(nodePos);
  isCameraFocusing = true;

  // Frame distance: 1.8m to 3.5m based on node size so it is centered and seen in its entirety
  const frameDist = Math.max(1.8, Math.min(3.5, (nodeData.radius || 0.05) * 25));
  targetCameraDistance = frameDist;

  // Subterranean nodes: open Root Sight cutaway and allow underground camera elevation
  if (nodePos.y < -0.05 || nodeData.layer === 'root' || nodeData.type === 0) {
    setRootSightEnabled(true);
    controls.maxPolarAngle = Math.PI - 0.05;
    // If camera is high above ground, smoothly guide its position down towards subterranean angle
    if (camera.position.y > 0.8) {
      const offset = camera.position.clone().sub(controls.target);
      offset.y = Math.max(-0.4, Math.min(0.6, offset.y * 0.4));
      if (offset.lengthSq() < 1e-4) offset.set(0.5, 0.2, 0.8);
      offset.normalize().multiplyScalar(frameDist);
      camera.position.copy(nodePos).add(offset);
    }
  } else {
    // Canopy node: reset to standard surface maxPolarAngle
    controls.maxPolarAngle = renderConfig?.cameraMaxPolarAngle ?? Math.PI / 2 - 0.05;
  }

  if (immediate) {
    controls.target.copy(nodePos);
    isCameraFocusing = false;
  }
}

// Growth animation tracking - nodes with growthProgress < 1.0
const growingNodes = new Map<string, { startTime: number; duration: number }>();
const DEFAULT_GROWTH_DURATION_MS = 5000; // 5 seconds default
let lastGrowthUpdateTime = 0;
const GROWTH_UPDATE_INTERVAL_MS = 100; // Update plant renderer every 100ms when growing

// Selection highlight for the growth target (handled by WebGPU renderer).

// Other players' plants (plantId -> nodes)
const otherPlayerPlants = new Map<string, Map<string, PlantNodeData>>();

// C01: Input abstraction - replaces hardcoded keydown/keyup
let inputBus: InputBus | null = null;
let uiShell: UIShell | null = null;
let debugOverlay: DebugOverlay | null = null;
let qualityController: QualityController | null = null;

// WebGPU renderer (C02b) - optional overlay on top of Three.js scene
let plantRenderer: PlantRenderer | null = null;
let webgpuRenderer: WebGPURenderer | null = null;
let webgpuDevice: WebGPUDevice | null = null;
let webgpuCanvas: HTMLCanvasElement | null = null;
let useWebGPU = false;
let renderConfig: RenderConfig | null = null;

// Node radii are derived from biomass and tree height/depth with botanical Murray allometry:
// Sturdy, thick trunk at base, gracefully tapering toward apical leader, slender fibrous roots,
// and thin delicate lateral branchlets.
// Based on botanical allometry: trunk diameter ~ 10-30cm at base, tapering to 2-5cm at crown
// Leaves: 1.5-4cm radius (delicate lamina)
// Roots: 2-8cm radius, tapering with depth
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
  if (type === 4) {
    // Seed: 6-12cm botanical teardrop seed radius
    return Math.max(0.07, Math.min(0.12, 0.07 + Math.sqrt(Math.max(0, biomass)) * 0.01));
  }
  if (type === 3) {
    // Leaf / foliage: delicate thin lamina (1.5cm - 4cm)
    return 0.015 + Math.min(0.04, Math.sqrt(Math.max(0, biomass)) * 0.006);
  }
  // Stem / shoot / trunk:
  // Height-based allometric tapering (Murray's Law / Pipe Model):
  // At base (y near 0), sturdy trunk ~0.05-0.08m radius (5-8cm).
  // At height (y > 2m), slender branches and twigs (0.02-0.05m).
  const height = Math.max(0, y);
  const heightTaper = 1.0 / (1.0 + height * 0.4);
  const baseTrunkBonus = Math.max(0.0, 0.04 * (1.0 - Math.min(1.0, height / 1.5)));
  return Math.max(
    0.018,
    (0.03 + baseTrunkBonus + Math.min(0.08, Math.sqrt(Math.max(0, biomass)) * 0.01)) * heightTaper,
  );
}

// Growth system helpers (ADR-018 two-step gene-gated growth)
function getNodeTypeName(type: number): string {
  const names = [
    'seed',
    'radicle',
    'root',
    'lateral_root',
    'stem',
    'branch',
    'vine',
    'leaf',
    'cotyledon',
    'flower',
    'spore_sac',
  ];
  return names[type] ?? 'unknown';
}

function nodeTypeLabel(node: PlantNodeData): string {
  return node.nodeType ?? getNodeTypeName(node.type);
}

// ADR-027: frame the independent camera close to the plant. The plant model
// keeps its normal size; only the camera distance changes.
function frameCameraOnPlant(x: number, y: number, z: number): void {
  const distance = renderConfig?.cameraStartDistance ?? 6;
  const target = new THREE.Vector3(x, y, z);
  controls.target.copy(target);

  // Use a fixed angle looking down at the plant from above (positive y)
  // Direction: slightly forward, slightly down, slightly right
  const direction = new THREE.Vector3(0.3, 0.7, 0.6).normalize();
  camera.position.copy(target).addScaledVector(direction, distance);
  controls.update();
}

// WASD / arrows move the camera and its orbit target together on the ground
// plane. Nothing on the plant moves (ADR-022).
function applyCameraPan(deltaTime: number): void {
  const speed = renderConfig?.cameraPanSpeed ?? 0;
  if (speed <= 0) return;

  let x = 0;
  let z = 0;
  if (cameraPanState.forward) z -= 1;
  if (cameraPanState.backward) z += 1;
  if (cameraPanState.left) x -= 1;
  if (cameraPanState.right) x += 1;
  if (x === 0 && z === 0) return;

  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();

  const move = new THREE.Vector3()
    .addScaledVector(forward, -z)
    .addScaledVector(right, x)
    .normalize()
    .multiplyScalar(speed * deltaTime);

  // Only modify controls.target; OrbitControls.update() will compute the
  // new camera position from the updated target + current spherical coords.
  controls.target.add(move);
}

// T01: Plant Renderer
let lastUpdateTime = performance.now();

// C03: Environment Renderer
let environmentRenderer: EnvironmentRenderer | null = null;

// T02: Root Sight state machine. Surface and underground are two modes of the same
// independent camera; toggling never moves or mutates the plant.
let rootSightConfig: RootSightConfig | null = null;
let rootSightMachine: RootSightStateMachine | null = null;
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
function setRootSightEnabled(enabled: boolean): void {
  if (!rootSightMachine) return;

  rootSightStateMachineSetTarget(rootSightMachine, enabled ? 'underground' : 'surface');
  const isEnabled = rootSightStateMachineIsEnabled(rootSightMachine);
  setDetail(
    isEnabled ? 'Root Sight: ON — Underground view active' : 'Root Sight: OFF — Surface view',
  );

  if (enabled) {
    controls.maxPolarAngle = Math.PI - 0.05;
    // Find lowest root node (or radicle) to focus and center on
    const ownNodes = Array.from(plantNodes.values()).filter((n) => n.isOwnPlant);
    const rootNodes = ownNodes.filter(
      (n) => n.layer === 'root' || n.type === 0 || n.position.y < -0.01,
    );
    if (rootNodes.length > 0) {
      rootNodes.sort((a, b) => a.position.y - b.position.y); // Lowest y first
      focusCameraOnNode(rootNodes[0]);
    }
  } else {
    controls.maxPolarAngle = renderConfig?.cameraMaxPolarAngle ?? Math.PI / 2 - 0.05;
    // Return camera focus smoothly to crown / seed / stem
    const crownNode =
      Array.from(plantNodes.values()).find((n) => n.isOwnPlant && n.parentId === null) ??
      Array.from(plantNodes.values()).find((n) => n.isOwnPlant);
    if (crownNode) {
      focusCameraOnNode(crownNode);
    }
  }
}

function toggleRootSight(): void {
  if (!rootSightMachine) return;
  rootSightStateMachineToggle(rootSightMachine);
  const isEnabled = rootSightStateMachineIsEnabled(rootSightMachine);
  setDetail(
    isEnabled ? 'Root Sight: ON — Underground view active' : 'Root Sight: OFF — Surface view',
  );

  if (isEnabled) {
    controls.maxPolarAngle = Math.PI - 0.05;
    const ownNodes = Array.from(plantNodes.values()).filter((n) => n.isOwnPlant);
    const rootNodes = ownNodes.filter(
      (n) => n.layer === 'root' || n.type === 0 || n.position.y < -0.01,
    );
    if (rootNodes.length > 0) {
      rootNodes.sort((a, b) => a.position.y - b.position.y);
      focusCameraOnNode(rootNodes[0]);
    }
  } else {
    controls.maxPolarAngle = renderConfig?.cameraMaxPolarAngle ?? Math.PI / 2 - 0.05;
    const crownNode =
      Array.from(plantNodes.values()).find((n) => n.isOwnPlant && n.parentId === null) ??
      Array.from(plantNodes.values()).find((n) => n.isOwnPlant);
    if (crownNode) {
      focusCameraOnNode(crownNode);
    }
  }
}

// T00A: Hint card toggle
function toggleHintCard(): void {
  if (!hintCardElement) return;
  const isVisible = hintCardElement.style.opacity === '1';
  hintCardElement.style.opacity = isVisible ? '0' : '1';
  setDetail(isVisible ? 'Hint card hidden (H to show)' : 'Hint card shown (H to hide)');
}

function updateRootSight(deltaTime: number): void {
  if (!rootSightMachine || !rootSightConfig) return;

  const context = {
    ownPlantPosition:
      Array.from(plantNodes.values()).find((node) => node.parentId === null)?.position ?? null,
    cameraPosition: camera.position,
    cameraTarget: controls.target,
  };
  rootSightStateMachineSetContext(rootSightMachine, context);

  const { eased, targetPosition } = rootSightStateMachineUpdate(rootSightMachine, deltaTime);
  rootSightTarget.copy(targetPosition);

  soilCutawayUniforms.uRootSightProgress.value = eased;
  soilCutawayUniforms.uRootSightCenter.value.copy(rootSightTarget);
  soilCutawayUniforms.uRootSightRadius.value = rootSightConfig.cutawayRadius;
  soilCutawayUniforms.uRootSightSoilOpacity.value = rootSightConfig.soilOpacity;

  const isEnabled = rootSightStateMachineIsEnabled(rootSightMachine);
  plantRenderer?.setRootSightState(isEnabled, eased, rootSightTarget);
  webgpuRenderer?.setRootSight(
    isEnabled,
    eased,
    rootSightTarget,
    rootSightConfig.cutawayRadius,
    3.0,
  );
}

async function initC01(): Promise<void> {
  // Load C01 configs
  const [loadedRenderConfig, controlsConfig, uiConfig, loadedRootSightConfig] = await Promise.all([
    loadRenderConfig(httpOrigin),
    loadControlsConfig(httpOrigin),
    loadUIConfig(httpOrigin),
    loadRootSightConfig(httpOrigin),
  ]);

  renderConfig = loadedRenderConfig;
  rootSightConfig = loadedRootSightConfig;
  rootSightMachine = createRootSightStateMachine(rootSightConfig);

  // Build input bus
  inputBus = createInputBus({ bindings: controlsConfig.bindings });

  // Build UI shell
  uiShell = createUIShell(uiConfig);

  // Create HUD elements early so they're ready when WELCOME arrives
  createResourceReadout();
  createGrowthSelectionUI();

  // Debug overlay
  const debugLayer = uiShell.getLayer('debug');
  if (debugLayer && renderConfig.debugOverlayEnabled) {
    debugOverlay = createDebugOverlay(debugLayer, renderConfig.debugOverlayKey);
  }

  // Dev Panel (C01 - comprehensive dev controls) - D01: only with ?dev=1
  const hudLayer = uiShell.getLayer('hud');
  if (hudLayer && isDevMode) {
    devPanel = createDevPanel({
      environmentRenderer: {
        setTimeOfDay: (t: number) => {
          if (environmentRenderer) {
            environmentRenderer.setTimeOfDay(t);
          }
        },
        setWeatherState: (stateName: string) => {
          if (environmentRenderer) {
            environmentRenderer.handleWeatherUpdate({
              weatherState: stateName,
              timeOfDay: environmentRenderer.getTimeOfDay(),
              sunIntensity: environmentRenderer.getSunIntensity(),
              isDay:
                environmentRenderer.getTimeOfDay() > 0.2 &&
                environmentRenderer.getTimeOfDay() < 0.8,
              conditionToken: '',
              stateTimeRemainingS: 300,
            });
          }
        },
        getTimeOfDay: () => environmentRenderer?.getTimeOfDay() ?? 0,
        getWeatherState: () => environmentRenderer?.getWeatherState() ?? 'clear',
        getSunIntensity: () => environmentRenderer?.getSunIntensity() ?? 1.0,
      },
      resourceWorld: {
        setTileResources: (
          _x: number,
          _z: number,
          _resources: { light?: number; moisture?: number; minerals?: number },
        ) => {
          // Local visual update only; server sync via sendToServer
        },
        getTileResources: (_x: number, _z: number) => ({ light: 0, moisture: 0, minerals: 0 }),
        getTileSize: () => 1,
        getGridWidth: () => 256,
        getGridHeight: () => 256,
      },
      plantRenderer: {
        setLODDistances: (_l0: number, _l1: number, _l2: number) => {
          /* plantRenderer?.setLODDistances?.(_l0, _l1, _l2); webgpuRenderer?.setLODDistances?.(_l0, _l1, _l2); */
        },
        setQuality: (_quality: 'low' | 'medium' | 'high' | 'ultra') => {
          /* plantRenderer?.setQuality?.(_quality); */
        },
        setRaymarchSteps: (_l0: number, _l1: number, _l2: number) => {
          /* plantRenderer?.setRaymarchSteps?.(_l0, _l1, _l2); webgpuRenderer?.setRaymarchSteps?.(_l0, _l1, _l2); */
        },
        setWindStrength: (_strength: number) => {
          /* plantRenderer?.setWindStrength?.(_strength); webgpuRenderer?.setWindStrength?.(_strength); */
        },
        setWindSpeed: (_speed: number) => {
          /* plantRenderer?.setWindSpeed?.(_speed); webgpuRenderer?.setWindSpeed?.(_speed); */
        },
        setHealthTint: (_strength: number) => {
          /* plantRenderer?.setHealthTint?.(_strength); webgpuRenderer?.setHealthTint?.(_strength); */
        },
        getConfig: () =>
          plantRendererConfig ??
          ({} as import('./config/plantRendererConfig.js').PlantRendererConfig),
      },
      plantWorld: {
        setGrowthSpeed: (_root: number, _canopy: number) => {
          /* send to server */
        },
        setPhotosynthesisRate: (_rate: number) => {
          /* send to server */
        },
        setEnergyUpkeep: (_perBiomass: number) => {
          /* send to server */
        },
        setMaxEnergy: (_max: number) => {
          /* send to server */
        },
        regeneratePlant: () => {
          if (ws?.readyState === WebSocket.OPEN && plantId) {
            ws.send(JSON.stringify({ type: 99, payload: { type: 'dev_regenerate_plant' } }));
          }
        },
      },
      camera: {
        setDistance: (dist: number) => {
          controls.minDistance = dist;
          controls.maxDistance = dist;
        },
        setSmoothing: (s: number) => {
          controls.dampingFactor = s;
        },
        setBounds: (min: number, max: number) => {
          controls.minDistance = min;
          controls.maxDistance = max;
        },
      },
      ui: {
        setTextScale: (scale: number) => {
          document.documentElement.style.setProperty('--text-scale', String(scale));
        },
      },
      plantState: {
        getPlantId: () => plantId,
        getPlantNodes: () => plantNodes,
      },
      sendToServer: (type: number, payload: unknown) => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type, payload }));
        }
      },
    });
    devPanel.panel.style.marginTop = '0';
    document.body.appendChild(devPanel.panel);
  }

  // Debug/Dev panel toggle (backtick `) - works regardless of debugOverlayEnabled
  inputBus.subscribe(
    (actionId, inputState: { pressed: boolean; toggled?: boolean; active?: boolean }) => {
      if (actionId === 'debug_toggle' && (inputState.pressed || inputState.toggled)) {
        if (debugOverlay) debugOverlay.setVisible(!debugOverlay.isVisible());
        if (devPanel) devPanel.toggle();
      }
    },
  );

  // Dev command handlers (time/weather)
  inputBus.subscribe((actionId: string, inputState: { pressed: boolean }) => {
    if (!inputState.pressed) return;
    switch (actionId) {
      case 'dev_weather_clear':
        environmentRenderer?.handleWeatherUpdate({
          weatherState: 'clear',
          timeOfDay: environmentRenderer.getTimeOfDay(),
          sunIntensity: 1.0,
          isDay: true,
          conditionToken: 'sun',
          stateTimeRemainingS: 300,
          forecast: { nextWeatherState: 'clear', timeUntilNextStateS: 300 },
        });
        break;
      case 'dev_weather_rain':
        environmentRenderer?.handleWeatherUpdate({
          weatherState: 'rain',
          timeOfDay: environmentRenderer.getTimeOfDay(),
          sunIntensity: 0.65,
          isDay: true,
          conditionToken: 'rain',
          stateTimeRemainingS: 300,
          forecast: { nextWeatherState: 'rain', timeUntilNextStateS: 300 },
        });
        break;
      case 'dev_weather_storm_telegraph':
        environmentRenderer?.handleWeatherUpdate({
          weatherState: 'thunderstorm_telegraph',
          timeOfDay: environmentRenderer.getTimeOfDay(),
          sunIntensity: 0.5,
          isDay: true,
          conditionToken: 'overcast',
          stateTimeRemainingS: 45,
          forecast: { nextWeatherState: 'thunderstorm_telegraph', timeUntilNextStateS: 45 },
        });
        break;
      case 'dev_weather_storm_active':
        environmentRenderer?.handleWeatherUpdate({
          weatherState: 'thunderstorm_active',
          timeOfDay: environmentRenderer.getTimeOfDay(),
          sunIntensity: 0.35,
          isDay: true,
          conditionToken: 'storm',
          stateTimeRemainingS: 90,
          forecast: { nextWeatherState: 'thunderstorm_active', timeUntilNextStateS: 90 },
        });
        break;
      case 'dev_weather_storm_aftermath':
        environmentRenderer?.handleWeatherUpdate({
          weatherState: 'thunderstorm_aftermath',
          timeOfDay: environmentRenderer.getTimeOfDay(),
          sunIntensity: 0.65,
          isDay: true,
          conditionToken: 'mist',
          stateTimeRemainingS: 60,
          forecast: { nextWeatherState: 'thunderstorm_aftermath', timeUntilNextStateS: 60 },
        });
        break;
      case 'dev_time_dawn':
        if (environmentRenderer) {
          environmentRenderer.setTimeOfDay(0.25);
        }
        break;
      case 'dev_time_noon':
        if (environmentRenderer) {
          environmentRenderer.setTimeOfDay(0.5);
        }
        break;
      case 'dev_time_dusk':
        if (environmentRenderer) {
          environmentRenderer.setTimeOfDay(0.75);
        }
        break;
      case 'dev_time_night':
        if (environmentRenderer) {
          environmentRenderer.setTimeOfDay(0.0);
        }
        break;
      case 'dev_weather_info':
        console.log(
          '[Dev] Weather:',
          environmentRenderer?.getWeatherState(),
          'Time:',
          environmentRenderer?.getTimeOfDay().toFixed(3),
          'Sun:',
          environmentRenderer?.getSunIntensity().toFixed(2),
        );
        break;
      case 'dev_panel_toggle':
        if (devPanel) devPanel.toggle();
        break;
      case 'plant_regenerate':
        if (ws?.readyState === WebSocket.OPEN && plantId) {
          ws.send(JSON.stringify({ type: 99, payload: { type: 'dev_regenerate_plant' } }));
        }
        break;
    }
  });

  // Growth actions (two-step: select node, then confirm)
  inputBus.subscribe((actionId: string, state: { pressed: boolean; active?: boolean }) => {
    if (actionId === 'grow_select' && state.pressed) {
      // Left-click on a node is handled by canvas click handler
      // This action can be used for keyboard alternative
      const nodeId = Array.from(plantNodes.keys())[0]; // fallback
      if (nodeId) requestGrowthOptions(nodeId);
    }
    if (actionId === 'grow_confirm' && state.pressed) {
      if (growthSelectionStateMachineIsVisible(growthSelectionMachine)) {
        const selectedNodeId = growthSelectionMachine.selectedNodeId;
        const options = growthSelectionMachine.options;
        if (selectedNodeId && options.length > 0) {
          // Auto-select first available option
          const option = options.find((o) => o.available);
          if (option) confirmGrowth(selectedNodeId, option.type);
        }
      }
    }
    if (actionId === 'grow_cancel' && state.pressed) {
      hideGrowthSelection();
    }
  });

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

  // C03: Initialize environment rendering (sky dome, diurnal grading, fog, rain, ground soil tint)
  environmentRenderer = new EnvironmentRenderer(
    scene,
    camera,
    renderConfig,
    sunLight,
    ambientLight,
    hemisphereLight,
    soilCutawayUniforms,
  );

  // Growth intent action - removed auto-growth; now click-to-select (ADR-018)
  inputBus.subscribe(
    (actionId: string, state: { pressed: boolean; toggled?: boolean; active?: boolean }) => {
      if (actionId === 'camera_pan_forward') cameraPanState.forward = state.active ?? false;
      if (actionId === 'camera_pan_backward') cameraPanState.backward = state.active ?? false;
      if (actionId === 'camera_pan_left') cameraPanState.left = state.active ?? false;
      if (actionId === 'camera_pan_right') cameraPanState.right = state.active ?? false;

      if (actionId === 'grow_cancel' && state.pressed) hideGrowthSelection();

      if (actionId === 'camera_recenter' && state.pressed) {
        const rootNode = Array.from(plantNodes.values()).find((node) => node.parentId === null);
        const target = rootNode?.position ?? controls.target;
        frameCameraOnPlant(target.x, target.y, target.z);
      }
      if (import.meta.env.DEV && actionId === 'plant_regenerate' && state.pressed) {
        // Generate a test plant at origin for visual critique
        if (plantRenderer) {
          const testNodes = plantRenderer.generateTestPlant();
          plantRenderer.rebuild();
          plantRenderer.updatePlantData(testNodes);
          if (webgpuRenderer) webgpuRenderer.updatePlants(testNodes, performance.now());
          // Center camera on origin
          controls.target.set(0, 0, 0);
          camera.position.set(0, 20, 30);
          controls.update();
          setDetail(
            `Generated test plant at origin (${testNodes.length} nodes). Orbit camera to inspect.`,
          );
        }
      }
      if (actionId === 'root_sight_toggle' && rootSightConfig) {
        // Hold mode: state.active is true while held, false when released
        // Toggle mode: state.pressed/state.toggled for edge triggers
        if (typeof state.active === 'boolean') {
          setRootSightEnabled(state.active);
        } else if (state.pressed || state.toggled) {
          toggleRootSight();
        }
      }
      if (actionId === 'hint_card_toggle' && (state.pressed || state.toggled)) {
        toggleHintCard();
      }
      // Dev weather/time controls (1-9, 0 keys)
      if (actionId.startsWith('dev_weather_') && state.pressed) {
        const weatherState = actionId.replace('dev_weather_', '');
        if (environmentRenderer) {
          environmentRenderer.handleWeatherUpdate({
            weatherState,
            timeOfDay: environmentRenderer.getTimeOfDay(),
            sunIntensity: environmentRenderer.getSunIntensity(),
            isDay:
              environmentRenderer.getTimeOfDay() > 0.2 && environmentRenderer.getTimeOfDay() < 0.8,
            conditionToken: '',
            stateTimeRemainingS: 300,
          });
          setDetail(`Weather set to: ${weatherState}`);
        }
      }
      if (actionId.startsWith('dev_time_') && state.pressed) {
        const timePreset = actionId.replace('dev_time_', '');
        const timeMap: Record<string, number> = {
          dawn: 0.25,
          noon: 0.5,
          dusk: 0.75,
          night: 0.0,
        };
        if (timeMap[timePreset] !== undefined && environmentRenderer) {
          environmentRenderer.setTimeOfDay(timeMap[timePreset]);
          setDetail(`Time set to: ${timePreset}`);
        }
      }
      if (actionId === 'dev_weather_info' && state.pressed) {
        console.log(
          '[Dev] Weather:',
          environmentRenderer?.getWeatherState(),
          'Time:',
          environmentRenderer?.getTimeOfDay().toFixed(3),
          'Sun:',
          environmentRenderer?.getSunIntensity().toFixed(2),
        );
      }
    },
  );

  // Keyboard producer
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      if (e.code === 'Enter') inputBus?.handleKeyDown(e.code);
      return;
    }

    // Block accidental browser page zoom (Ctrl + + / - / 0 / Wheel)
    if (e.ctrlKey || e.metaKey) {
      if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_' || e.key === '0') {
        e.preventDefault();
        if (e.key === '0') {
          targetCameraDistance = renderConfig?.cameraStartDistance ?? 6;
        }
        return;
      }
    }

    // Smooth keyboard 3D camera zoom with - and + keys
    if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') {
      e.preventDefault();
      keyboardZoomState.in = true;
      return;
    }
    if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') {
      e.preventDefault();
      keyboardZoomState.out = true;
      return;
    }

    // Support Tab for Root Sight toggle (documented standard key)
    if (e.code === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      toggleRootSight();
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

    if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') {
      e.preventDefault();
      keyboardZoomState.in = false;
      return;
    }
    if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') {
      e.preventDefault();
      keyboardZoomState.out = false;
      return;
    }

    if (e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) {
      inputBus?.handleKeyUp(e.code);
      return;
    }
    inputBus?.handleKeyUp(e.code);
    e.preventDefault();
  });

  // Mouse producer - use Three.js renderer's canvas, not the WebGPU canvas
  // (WebGPU canvas has pointer-events: none and sits on top)
  const canvas = renderer.domElement;
  // Ensure canvas can receive focus for keyboard events
  canvas.setAttribute('tabindex', '0');
  const startGrowthDragFromEvent = (e: MouseEvent | PointerEvent): boolean => {
    const gState = growthSelectionStateMachineGetState(growthSelectionMachine);
    if (gState !== 'option_selected' && gState !== 'drawing') return false;
    if (gState === 'drawing') return true; // move/up handlers own it
    const selectedNodeId = growthSelectionMachine.selectedNodeId;
    if (!selectedNodeId) return false;
    const nodeData = plantNodes.get(selectedNodeId);
    if (!nodeData) {
      console.warn('[PlantLegacy] Growth drag: selected node not found locally', {
        selectedNodeId,
      });
      setDetail('Selected growth node not found. Click the node again.');
      return false;
    }
    const optionType =
      growthSelectionMachine.selectedOptionType ??
      growthSelectionMachine.drawingData?.selectedOptionType ??
      '';
    const optionLabel = growthSelectionMachine.selectedOptionLabel ?? optionType;
    if (!optionType) {
      console.warn('[PlantLegacy] Growth drag: no selected option type');
      return false;
    }

    growthSelectionStateMachineStartDrawing(
      growthSelectionMachine,
      selectedNodeId,
      { x: nodeData.position.x, y: nodeData.position.y, z: nodeData.position.z },
      optionType,
      optionLabel,
    );
    // Seed direction from pointer hit so a quick click/release still sends.
    const drawingData = growthSelectionStateMachineGetDrawingData(growthSelectionMachine);
    if (drawingData) {
      const hit = getGrowthDrawHitPoint(e, drawingData);
      const v = validateGrowthDirection(drawingData, { x: hit.x, y: hit.y, z: hit.z });
      growthSelectionStateMachineUpdateDrawing(
        growthSelectionMachine,
        { x: hit.x, y: hit.y, z: hit.z },
        { isValid: v.isValid, reason: v.reason, distance: v.distance },
      );
      updateGrowthDirectionLine(
        drawingData.startPosition,
        { x: hit.x, y: hit.y, z: hit.z },
        v.isValid,
      );
    } else {
      updateGrowthDirectionLine(
        { x: nodeData.position.x, y: nodeData.position.y, z: nodeData.position.z },
        { x: nodeData.position.x, y: nodeData.position.y + 0.5, z: nodeData.position.z },
        true,
      );
    }
    webgpuRenderer?.setSelectedNode(selectedNodeId);
    controls.enabled = false;
    controls.enableRotate = false;
    controls.enablePan = false;
    setDetail(`Drag to set ${optionType} direction, then release.`);
    console.log('[PlantLegacy] Growth drawing started', {
      nodeId: selectedNodeId,
      optionType,
      state: growthSelectionStateMachineGetState(growthSelectionMachine),
    });
    try {
      (e.target as HTMLElement)?.setPointerCapture?.((e as PointerEvent).pointerId);
    } catch {}
    return true;
  };

  canvas.addEventListener(
    'mousedown',
    (e) => {
      inputBus?.handleMouseDown(e.button);
      clickStartTime = performance.now();
      clickStartPos = { x: e.clientX, y: e.clientY };
      canvas.focus();
      if (e.button === 0 && startGrowthDragFromEvent(e)) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    },
    { capture: true },
  );
  canvas.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button === 0 && startGrowthDragFromEvent(e)) {
        controls.enabled = false;
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    },
    { capture: true },
  );
  canvas.addEventListener('mouseup', (e) => {
    inputBus?.handleMouseUp(e.button);
  });
  canvas.addEventListener('wheel', (e) => inputBus?.handleWheel(e.deltaY), { passive: false });

  // Click to select node for growth (ADR-018 two-step growth)
  canvas.addEventListener('click', (e) => {
    if (e.button !== 0) return; // Left click only

    // Ignore if growth drawing is/was active or an option is selected (handled by pointer handlers)
    const gState = growthSelectionStateMachineGetState(growthSelectionMachine);
    if (gState === 'drawing' || gState === 'option_selected') return;

    // Ignore clicks on UI elements (buttons, inputs, etc.)
    if (
      e.target instanceof HTMLElement &&
      e.target.closest(
        'button, input, select, textarea, [role="dialog"], #growth-selection-panel, #resource-readout, #hint-card',
      )
    ) {
      return;
    }

    // Ignore if this was a drag (orbit/pan) not a click
    const clickDuration = performance.now() - clickStartTime;
    const clickDistance = Math.hypot(e.clientX - clickStartPos.x, e.clientY - clickStartPos.y);
    if (clickDuration > CLICK_MAX_DURATION || clickDistance > CLICK_MAX_DISTANCE) {
      return; // Was a drag, not a click
    }

    const rect = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    // Find closest own plant node. The pick sphere has a configurable world
    // radius floor so a tiny seed is still clickable from the close camera.
    const nodeObjects: THREE.Object3D[] = [];
    const nodeMap = new Map<THREE.Object3D, string>();
    const cameraBelowGround = camera.position.y < 0;
    const isRootSightEnabled = rootSightMachine
      ? rootSightStateMachineIsEnabled(rootSightMachine)
      : false;
    for (const [id, nodeData] of plantNodes.entries()) {
      if (!nodeData.isOwnPlant) continue;
      // Allow picking:
      // - All canopy nodes (type >= 1)
      // - Seed node (isSeed === true) always
      // - Root nodes (type === 0) when in Root Sight mode OR camera is below ground
      if (nodeData.type === 0 && !nodeData.isSeed && !isRootSightEnabled && !cameraBelowGround)
        continue;
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(nodeData.radius * 1.5, 0.35), 8, 8),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      );
      sphere.position.copy(nodeData.position);
      sphere.updateMatrixWorld(true);
      nodeObjects.push(sphere);
      nodeMap.set(sphere, id);
    }

    console.debug(
      '[Click] plantNodes:',
      plantNodes.size,
      'own nodes for picking:',
      nodeObjects.length,
      'rootSightEnabled:',
      isRootSightEnabled,
    );

    if (nodeObjects.length === 0) {
      console.debug('[Click] No nodes to pick');
      hideGrowthSelection();
      return;
    }

    const intersects = raycaster.intersectObjects(nodeObjects);
    console.debug('[Click] intersects:', intersects.length);
    if (intersects.length === 0) {
      // Clicked off-plant (but not on UI) -> close growth panel
      hideGrowthSelection();
      return;
    }

    const clickedNodeId = nodeMap.get(intersects[0].object);
    console.debug('[Click] clicked node:', clickedNodeId);

    // If we have a growth option selected, start drawing from this node on click/drag
    const growthState = growthSelectionStateMachineGetState(growthSelectionMachine);
    if (growthState === 'option_selected') {
      const selectedNodeId = growthSelectionMachine.selectedNodeId;
      if (clickedNodeId && selectedNodeId && clickedNodeId === selectedNodeId) {
        const nodeData = plantNodes.get(clickedNodeId);
        const optionType =
          growthSelectionMachine.selectedOptionType ??
          growthSelectionMachine.drawingData?.selectedOptionType ??
          '';
        const optionLabel = growthSelectionMachine.selectedOptionLabel ?? optionType;
        if (nodeData && optionType) {
          growthSelectionStateMachineStartDrawing(
            growthSelectionMachine,
            clickedNodeId,
            { x: nodeData.position.x, y: nodeData.position.y, z: nodeData.position.z },
            optionType,
            optionLabel,
          );
          webgpuRenderer?.setSelectedNode(clickedNodeId);
          controls.enabled = false; // disable orbit while drawing direction
          setDetail(
            `Drag to set growth direction, then release to ${nodeData.isSeed ? 'germinate' : 'grow'}.`,
          );
          return;
        }
      }
      // Click elsewhere while waiting for drag cancels the pending option selection
      growthSelectionStateMachineHide(growthSelectionMachine);
      removeGrowthDirectionLine();
      controls.enabled = true;
      return;
    }

    if (clickedNodeId) {
      const clickedNode = plantNodes.get(clickedNodeId);
      if (clickedNode) {
        focusCameraOnNode(clickedNode);
      }
      requestGrowthOptions(clickedNodeId);
    }
  });

  // Client-side gene-based growth direction clamping & validation
  function clampGrowthDirectionForOption(
    optionType: string,
    dir: { x: number; y: number; z: number },
  ): { x: number; y: number; z: number } {
    return clampGrowthDirectionByGene(optionType as NodeType, dir);
  }

  function validateGrowthDirection(
    drawingData: GrowthDrawingData,
    targetPosition: { x: number; y: number; z: number },
  ): {
    isValid: boolean;
    reason?: string;
    distance: number;
    clampedDirection?: { x: number; y: number; z: number };
  } {
    const start = drawingData.nodePosition;
    const dx = targetPosition.x - start.x;
    const dy = targetPosition.y - start.y;
    const dz = targetPosition.z - start.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Get the node and its type
    const node = plantNodes.get(drawingData.nodeId);
    if (!node) return { isValid: false, reason: 'Node not found', distance };

    const nodeType = drawingData.selectedOptionType;
    const constraints =
      NODE_GROWTH_CONSTRAINTS[nodeType as NodeType] ?? NODE_GROWTH_CONSTRAINTS.stem;

    // Use end-tangent of traced path (matches intent direction) when available.
    const path = drawingData.path ?? [];
    let tdx = dx,
      tdy = dy,
      tdz = dz,
      tdist = distance;
    if (path.length >= 2) {
      for (let i = path.length - 1; i >= 1; i--) {
        const a = path[i - 1],
          b = path[i];
        const lx = b.x - a.x,
          ly = b.y - a.y,
          lz = b.z - a.z;
        const ll = Math.hypot(lx, ly, lz);
        if (ll > 0.03) {
          tdx = lx;
          tdy = ly;
          tdz = lz;
          tdist = ll;
          break;
        }
      }
    }

    if (tdist < 0.001) {
      const fallback = clampGrowthDirectionByGene(
        nodeType,
        constraints.downwardPreferred ? { x: 0, y: -1, z: 0 } : { x: 0, y: 1, z: 0 },
      );
      return { isValid: true, distance: constraints.maxReach * 0.7, clampedDirection: fallback };
    }

    const rawDir = { x: tdx / tdist, y: tdy / tdist, z: tdz / tdist };
    const clampedDirection = clampGrowthDirectionByGene(nodeType, rawDir);
    const clampedDistance = Math.max(0.3, Math.min(distance, constraints.maxReach));

    return {
      isValid: true,
      distance: clampedDistance,
      clampedDirection,
      reason: distance < 0.02 ? 'Drag to trace a growth path' : undefined,
    };
  }

  // Visual preview: draw the gene-constrained 3D growth vector with arrowhead at tip.
  function updateGrowthDirectionLine(
    _start: { x: number; y: number; z: number },
    _end: { x: number; y: number; z: number },
    isValid: boolean,
  ): void {
    ensureGrowthDirectionOverlay();
    if (!growthDirectionOverlay || !growthDirectionOverlayCtx) return;
    const drawingData = growthSelectionStateMachineGetDrawingData(growthSelectionMachine);
    const nodeType = drawingData?.selectedOptionType ?? 'radicle';
    const constraints =
      NODE_GROWTH_CONSTRAINTS[nodeType as NodeType] ?? NODE_GROWTH_CONSTRAINTS.stem;

    let endPos = _end;
    if (drawingData?.direction) {
      const reach = Math.max(
        0.4,
        Math.min(drawingData.distance || constraints.maxReach, constraints.maxReach),
      );
      endPos = {
        x: _start.x + drawingData.direction.x * reach,
        y: _start.y + drawingData.direction.y * reach,
        z: _start.z + drawingData.direction.z * reach,
      };
    }

    const path3 = [{ x: _start.x, y: _start.y, z: _start.z }, endPos];

    const w = window.innerWidth;
    const h = window.innerHeight;
    if (growthDirectionOverlay.width !== w) growthDirectionOverlay.width = w;
    if (growthDirectionOverlay.height !== h) growthDirectionOverlay.height = h;
    const ctx = growthDirectionOverlayCtx;
    ctx.clearRect(0, 0, w, h);

    const pts: { x: number; y: number }[] = [];
    for (const p of path3) {
      const v = new THREE.Vector3(p.x, p.y, p.z).project(camera);
      if (v.z > 1 || v.z < -1) continue;
      pts.push({ x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h });
    }
    if (pts.length < 2) return;

    const color = isValid ? '#4caf50' : '#f44336';
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Arrowhead at path tip, oriented by last visible segment.
    const tip = pts[pts.length - 1];
    let prev = pts[pts.length - 2];
    for (let i = pts.length - 2; i >= 0; i--) {
      const dx = tip.x - pts[i].x;
      const dy = tip.y - pts[i].y;
      if (dx * dx + dy * dy > 9) {
        prev = pts[i];
        break;
      }
    }
    const angle = Math.atan2(tip.y - prev.y, tip.x - prev.x);
    const headLen = 14;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(
      tip.x - headLen * Math.cos(angle - Math.PI / 7),
      tip.y - headLen * Math.sin(angle - Math.PI / 7),
    );
    ctx.lineTo(
      tip.x - headLen * Math.cos(angle + Math.PI / 7),
      tip.y - headLen * Math.sin(angle + Math.PI / 7),
    );
    ctx.closePath();
    ctx.fill();

    // Origin marker
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Growth direction drawing: mousemove/pointermove and mouseup/pointerup handlers
  const getGrowthDrawHitPoint = (
    e: MouseEvent | PointerEvent,
    drawingData: GrowthDrawingData,
  ): THREE.Vector3 => {
    const rect = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    const optionType = drawingData.selectedOptionType;
    const isRootLike =
      optionType === 'root' || optionType === 'radicle' || optionType === 'lateral_root';
    // For roots/germination, intersect a plane below the node so dragging produces a clear downward direction.
    if (isRootLike) {
      const depth = Math.min(-0.25, drawingData.nodePosition.y - 0.8);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -depth);
      const p = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, p)) return p;
    }

    // Primary: plane at the node's Y (good for canopy drag in screen space)
    const nodePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -drawingData.nodePosition.y);
    const pNode = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(nodePlane, pNode)) return pNode;

    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const intersectPoint = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(groundPlane, intersectPoint)) return intersectPoint;

    // Fallback: point along ray at fixed distance from camera
    return raycaster.ray.origin.clone().add(raycaster.ray.direction.clone().multiplyScalar(8));
  };

  const handleGrowthDrawMove = (e: MouseEvent | PointerEvent) => {
    if (!growthSelectionStateMachineIsDrawing(growthSelectionMachine)) return;

    const drawingData = growthSelectionStateMachineGetDrawingData(growthSelectionMachine);
    if (!drawingData) return;

    const hit = getGrowthDrawHitPoint(e, drawingData);
    const validation = validateGrowthDirection(drawingData, hit);
    growthSelectionStateMachineUpdateDrawing(growthSelectionMachine, hit, validation);
    if (validation.clampedDirection) {
      drawingData.direction = validation.clampedDirection;
      drawingData.distance = validation.distance;
    }
    updateGrowthDirectionLine(drawingData.nodePosition, hit, validation.isValid);
    e.preventDefault();
    e.stopPropagation();
  };
  canvas.addEventListener('mousemove', handleGrowthDrawMove);
  canvas.addEventListener('pointermove', handleGrowthDrawMove, { capture: true });

  const handleGrowthDrawEnd = (e: MouseEvent | PointerEvent) => {
    if ((e as MouseEvent).button !== 0) return;
    const gState = growthSelectionStateMachineGetState(growthSelectionMachine);
    if (gState !== 'drawing' && gState !== 'option_selected') return;
    if (gState === 'option_selected') {
      // Click without drag capture starting: treat as a send attempt using selected option.
      const selectedNodeId = growthSelectionMachine.selectedNodeId;
      const optionType = growthSelectionMachine.selectedOptionType;
      const nodeData = selectedNodeId ? plantNodes.get(selectedNodeId) : null;
      if (selectedNodeId && optionType && nodeData) {
        growthSelectionStateMachineStartDrawing(
          growthSelectionMachine,
          selectedNodeId,
          { x: nodeData.position.x, y: nodeData.position.y, z: nodeData.position.z },
          optionType,
          growthSelectionMachine.selectedOptionLabel ?? optionType,
        );
      } else {
        return;
      }
    }

    const drawingData = growthSelectionStateMachineGetDrawingData(growthSelectionMachine);
    let result = growthSelectionStateMachineConfirmDrawing(growthSelectionMachine);
    // Derive direction from drag even if client-side validation rejected (server is authoritative for final rules).
    if (!result && drawingData) {
      const node = plantNodes.get(drawingData.nodeId);
      const t = drawingData.selectedOptionType;
      const end = drawingData.currentEndPosition;
      let dir: { x: number; y: number; z: number } | null = null;
      if (node && end) {
        const dx = end.x - drawingData.nodePosition.x;
        const dy = end.y - drawingData.nodePosition.y;
        const dz = end.z - drawingData.nodePosition.z;
        const len = Math.hypot(dx, dy, dz);
        if (len > 0.001) {
          dir = clampGrowthDirectionForOption(t, { x: dx / len, y: dy / len, z: dz / len });
        }
      }
      if (!dir) {
        dir = clampGrowthDirectionForOption(
          t,
          t === 'root' || t === 'radicle' || t === 'lateral_root'
            ? { x: 0, y: -1, z: 0 }
            : t === 'leaf' || t === 'cotyledon'
              ? { x: 0.45, y: 0.45, z: 0.1 }
              : t === 'vine'
                ? { x: 0.7, y: 0.15, z: 0.2 }
                : { x: 0.1, y: 1, z: 0.05 },
        );
      }
      if (node) {
        result = { nodeId: drawingData.nodeId, optionType: t, direction: dir, distance: 1 };
        console.log('[PlantLegacy] Using drag/fallback growth direction', {
          optionType: t,
          dir,
          reason: drawingData.validationReason,
        });
      }
    }
    if (result) {
      // Clamp final direction too, to satisfy server rules while preserving drag bias
      const clamped = clampGrowthDirectionForOption(result.optionType, result.direction);
      confirmGrowth(result.nodeId, result.optionType, clamped);
      uiShell?.toast({
        message: `Sent ${result.optionType} growth...`,
        kind: 'info',
        durationMs: 1500,
      });
      console.log('[PlantLegacy] Growth drawing confirmed', {
        ...result,
        clampedDirection: clamped,
      });
    } else {
      console.warn('[PlantLegacy] Growth drawing: no drawingData/result', { drawingData, gState });
      setDetail('Growth not sent (no drag data). Select option and drag again.');
      uiShell?.toast({ message: 'Growth not sent: drag again', kind: 'error', durationMs: 3000 });
      hideGrowthSelection();
    }
    removeGrowthDirectionLine();
    controls.enabled = true;
    controls.enableRotate = true;
    controls.enablePan = true;
    e.stopImmediatePropagation();
    e.preventDefault();
  };
  canvas.addEventListener('mouseup', handleGrowthDrawEnd);
  canvas.addEventListener('pointerup', handleGrowthDrawEnd, { capture: true });
  window.addEventListener('mouseup', (e) => {
    if (growthSelectionStateMachineIsDrawing(growthSelectionMachine)) handleGrowthDrawEnd(e);
  });

  canvas.addEventListener('contextmenu', (e) => {
    if (
      growthSelectionStateMachineIsDrawing(growthSelectionMachine) ||
      growthSelectionStateMachineGetState(growthSelectionMachine) === 'option_selected'
    ) {
      e.preventDefault();
      growthSelectionStateMachineHide(growthSelectionMachine);
      removeGrowthDirectionLine();
      controls.enabled = true;
      controls.enableRotate = true;
      controls.enablePan = true;
      webgpuRenderer?.setSelectedNode(null);
      const panel = growthSelectionPanel;
      if (panel) panel.style.display = 'none';
      setDetail('Growth cancelled.');
    }
  });

  // Escape key cancels drawing mode
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && growthSelectionStateMachineIsDrawing(growthSelectionMachine)) {
      growthSelectionStateMachineCancelDrawing(growthSelectionMachine);
      removeGrowthDirectionLine();
      controls.enabled = true;
    }
  });

  // Visibility change: pause render loop & input when hidden
  if (renderConfig.pauseOnHidden) {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // Switch to low-rate timer-based loop when hidden
        if (!backgroundLoopTimer) {
          backgroundLoopTimer = window.setInterval(() => renderFrame(0.1), 100); // 10 FPS when hidden
        }
        setDetail('Tab hidden — background loop');
      } else {
        // Clear background timer, requestAnimationFrame will take over
        if (backgroundLoopTimer) {
          window.clearInterval(backgroundLoopTimer);
          backgroundLoopTimer = null;
        }
        setDetail('Tab visible — resuming');
        // Request full plant sync when tab becomes visible again
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: MESSAGE_TYPE.PLANT_SYNC_REQUEST, payload: {} }));
          // Also request current resource tile for own plant (light/moisture/minerals)
          // Use the local plant's root/seed node (parentId === null) for accurate position
          const ownRootNode = Array.from(plantNodes.values()).find((n) => n.parentId === null);
          if (ownRootNode) {
            ws.send(
              JSON.stringify({
                type: MESSAGE_TYPE.RESOURCE_QUERY,
                payload: { worldX: ownRootNode.position.x, worldZ: ownRootNode.position.z },
              }),
            );
          } else if (welcome?.rootNode) {
            // Fallback to welcome data
            ws.send(
              JSON.stringify({
                type: MESSAGE_TYPE.RESOURCE_QUERY,
                payload: { worldX: welcome.rootNode.x, worldZ: welcome.rootNode.z },
              }),
            );
          }
        }
      }
    });
  }

  // Global click handler to close growth panel when clicking outside
  document.addEventListener('click', (e) => {
    if (!growthSelectionStateMachineIsVisible(growthSelectionMachine)) return;
    const gState = growthSelectionStateMachineGetState(growthSelectionMachine);
    if (gState === 'drawing' || gState === 'option_selected') return; // drawing flow owns interaction
    // Ignore clicks inside the growth panel
    if (growthSelectionPanel?.contains(e.target as Node)) return;
    // Ignore clicks on canvas (handled by canvas click handler which does its own check)
    if (canvas?.contains(e.target as Node)) return;
    hideGrowthSelection();
  });
}

async function initPlantRenderer(): Promise<void> {
  // Reconnects create a fresh plant; dispose the previous renderer so its
  // meshes and GPU buffers do not pile up.
  if (plantRenderer) {
    plantRenderer.dispose();
    plantRenderer = null;
  }
  if (webgpuRenderer) {
    webgpuRenderer.destroy();
    webgpuRenderer = null;
  }
  if (webgpuDevice) {
    webgpuDevice.destroy();
    webgpuDevice = null;
  }
  if (webgpuCanvas) {
    webgpuCanvas.remove();
    webgpuCanvas = null;
  }
  useWebGPU = false;

  const config = await loadPlantRendererConfig(httpOrigin);
  plantRendererConfig = config;

  // Try WebGPU renderer first (with automatic fallback to SDF)
  if (renderConfig?.webgpuEnabled && isWebGPUSupported()) {
    try {
      const canvasEl = document.createElement('canvas');
      canvasEl.id = 'webgpu-canvas';
      canvasEl.style.cssText =
        'position:absolute; inset:0; width:100%; height:100%; pointer-events:none;';
      document.getElementById('app')?.appendChild(canvasEl);

      const device = new WebGPUDevice(canvasEl);
      const deviceReady = await device.initialize();
      if (deviceReady && device.getDevice() && device.getContext()) {
        const gpuRenderer = new WebGPURenderer(device, {
          maxPlants: renderConfig.webgpuMaxPlants,
          leafSize: config.leafSize,
          leafCountPerNode: config.leafCountPerNode,
          tubeSides: config.tubeRingCount,
          rootSides: config.rootSides,
          tierThresholds: [
            renderConfig.webgpuTier0Threshold,
            renderConfig.webgpuTier1Threshold,
            renderConfig.webgpuTier2Threshold,
            renderConfig.webgpuTier3Threshold,
          ],
          hysteresisPromote: renderConfig.webgpuHysteresisPromote,
          hysteresisDemote: renderConfig.webgpuHysteresisDemote,
          minDwellTime: renderConfig.webgpuMinDwellTime,
          windStrength: config.windStrength,
          windSpeed: config.windSpeed,
          healthTintStrength: config.healthTintStrength,
          mutation0Param: config.mutation0Param,
          mutation1Param: config.mutation1Param,
          mutation2Param: config.mutation2Param,
          ownRootColor: rootSightConfig?.ownRootHighlightColor ?? '#4CAF50',
          rivalRootColor: rootSightConfig?.rivalRootHighlightColor ?? '#FF5722',
        });

        const rendererReady = await gpuRenderer.initialize();
        if (rendererReady) {
          gpuRenderer.setCamera(camera);
          gpuRenderer.resize(window.innerWidth, window.innerHeight, renderer.getPixelRatio());
          gpuRenderer.setSunDirection(sunLight.position);
          device.setDeviceLostCallback((reason) => {
            console.error('WebGPU device lost:', reason);
            device.setDeviceLostCallback(() => {});
            disposeWebGPU();
            window.location.reload();
          });
          webgpuDevice = device;
          webgpuRenderer = gpuRenderer;
          webgpuCanvas = canvasEl;
          useWebGPU = true;
          console.log('Using WebGPU plant renderer with compute-driven LOD');
        } else {
          gpuRenderer.destroy();
          device.destroy();
          canvasEl.remove();
        }
      } else {
        device.destroy();
        canvasEl.remove();
      }
    } catch (error) {
      console.error('WebGPU initialization failed:', error);
      if (webgpuDevice) {
        webgpuDevice.destroy();
        webgpuDevice = null;
      }
      if (webgpuRenderer) {
        webgpuRenderer.destroy();
        webgpuRenderer = null;
      }
      if (webgpuCanvas) {
        webgpuCanvas.remove();
        webgpuCanvas = null;
      }
    }
  }

  // Fallback to SDF renderer if WebGPU not available or failed
  if (!useWebGPU) {
    plantRenderer = new PlantRenderer({
      ...DEFAULT_CONFIG,
      // Override with values from loaded configs
      maxNodesPerPlant: config.maxNodesPerPlant ?? DEFAULT_CONFIG.maxNodesPerPlant,
      tubeRingCount: config.tubeRingCount ?? DEFAULT_CONFIG.tubeRingCount,
      tubeLengthSegments: config.tubeLengthSegments ?? DEFAULT_CONFIG.tubeLengthSegments,
      leafCountPerNode: config.leafCountPerNode ?? DEFAULT_CONFIG.leafCountPerNode,
      leafSize: config.leafSize ?? DEFAULT_CONFIG.leafSize,
      leafLengthWidthRatio: config.leafLengthWidthRatio ?? DEFAULT_CONFIG.leafLengthWidthRatio,
      petioleLength: config.petioleLength ?? DEFAULT_CONFIG.petioleLength,
      petioleThickness: config.petioleThickness ?? DEFAULT_CONFIG.petioleThickness,
      l0Distance: config.l0Distance ?? DEFAULT_CONFIG.l0Distance,
      l1Distance: config.l1Distance ?? DEFAULT_CONFIG.l1Distance,
      l2Distance: config.l2Distance ?? DEFAULT_CONFIG.l2Distance,
      triangleBudgetL0: config.triangleBudgetL0 ?? DEFAULT_CONFIG.triangleBudgetL0,
      triangleBudgetL1: config.triangleBudgetL1 ?? DEFAULT_CONFIG.triangleBudgetL1,
      windStrength: config.windStrength ?? DEFAULT_CONFIG.windStrength,
      windSpeed: config.windSpeed ?? DEFAULT_CONFIG.windSpeed,
      healthTintStrength: config.healthTintStrength ?? DEFAULT_CONFIG.healthTintStrength,
      mutation0Param: config.mutation0Param ?? DEFAULT_CONFIG.mutation0Param,
      mutation1Param: config.mutation1Param ?? DEFAULT_CONFIG.mutation1Param,
      mutation2Param: config.mutation2Param ?? DEFAULT_CONFIG.mutation2Param,
      rootSightEnabled: rootSightMachine ? rootSightStateMachineIsEnabled(rootSightMachine) : false,
      rootSightOpacity: DEFAULT_CONFIG.rootSightOpacity,
      canopySightEnabled: config.canopySightEnabled ?? DEFAULT_CONFIG.canopySightEnabled,
      photosynthesisViz: config.photosynthesisVisualization ?? DEFAULT_CONFIG.photosynthesisViz,
      waterFlowViz: config.waterFlowVisualization ?? DEFAULT_CONFIG.waterFlowViz,
      nutrientFlowViz: config.nutrientFlowVisualization ?? DEFAULT_CONFIG.nutrientFlowViz,
      nodeSize: DEFAULT_CONFIG.nodeSize,
      // C02 SDF Organism Fusion Tunables
      sminBlendRadius: DEFAULT_CONFIG.sminBlendRadius,
      maxRaymarchSteps: DEFAULT_CONFIG.maxRaymarchSteps,
      raymarchHitEpsilon: DEFAULT_CONFIG.raymarchHitEpsilon,
      boundingBoxPadding: DEFAULT_CONFIG.boundingBoxPadding,
      // LOD-specific raymarch settings
      l0RaymarchSteps: DEFAULT_CONFIG.l0RaymarchSteps,
      l1RaymarchSteps: DEFAULT_CONFIG.l1RaymarchSteps,
      l2RaymarchSteps: DEFAULT_CONFIG.l2RaymarchSteps,
      l0RaymarchEpsilon: DEFAULT_CONFIG.l0RaymarchEpsilon,
      l1RaymarchEpsilon: DEFAULT_CONFIG.l1RaymarchEpsilon,
      l2RaymarchEpsilon: DEFAULT_CONFIG.l2RaymarchEpsilon,
      // T02: Root Sight specific
      rootSightCutawayRadius:
        rootSightConfig?.cutawayRadius ?? DEFAULT_CONFIG.rootSightCutawayRadius,
      rootAuraRadius: DEFAULT_CONFIG.rootAuraRadius,
      rootSightSoilOpacity: rootSightConfig?.soilOpacity ?? DEFAULT_CONFIG.rootSightSoilOpacity,
      ownRootHighlightColor:
        rootSightConfig?.ownRootHighlightColor ?? DEFAULT_CONFIG.ownRootHighlightColor,
      rivalRootHighlightColor:
        rootSightConfig?.rivalRootHighlightColor ?? DEFAULT_CONFIG.rivalRootHighlightColor,
      // Visual
      emergenceDuration: DEFAULT_CONFIG.emergenceDuration,
    });

    plantRenderer.initialize(scene, camera);

    // Initialize with existing plant nodes (root node from WELCOME, or empty)
    if (plantRenderer) {
      const otherNodes: PlantNodeData[] = [];
      for (const nodes of otherPlayerPlants.values()) {
        otherNodes.push(...nodes.values());
      }
      const allNodes = [...plantNodes.values(), ...otherNodes];
      plantRenderer.updatePlantData(allNodes);
    }
    if (webgpuRenderer) {
      const otherNodes: PlantNodeData[] = [];
      for (const nodes of otherPlayerPlants.values()) {
        otherNodes.push(...nodes.values());
      }
      const allNodes = [...plantNodes.values(), ...otherNodes];
      webgpuRenderer.updatePlants(allNodes, performance.now());
    }
  }
}

// Dispose WebGPU resources
function disposeWebGPU(): void {
  if (webgpuRenderer) {
    webgpuRenderer.destroy();
    webgpuRenderer = null;
  }
  if (webgpuDevice) {
    webgpuDevice.destroy();
    webgpuDevice = null;
  }
  if (webgpuCanvas) {
    webgpuCanvas.remove();
    webgpuCanvas = null;
  }
  useWebGPU = false;
}

// Three.js setup
const app = document.getElementById('app');
if (!app) throw new Error('App element not found');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.autoClear = false; // We manage clearing manually for WebGPU compositing
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
  biomass: HTMLSpanElement;
  energy: HTMLSpanElement;
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

  const biomassEl = document.createElement('div');
  biomassEl.innerHTML = `<span style="color: var(--leaf-400);">🌿</span> Biomass: <span id="res-biomass">0</span>`;
  const energyEl = document.createElement('div');
  energyEl.innerHTML = `<span style="color: var(--gold-400);">⚡</span> Energy: <span id="res-energy">0</span>`;
  const lightEl = document.createElement('div');
  lightEl.innerHTML = `<span style="color: var(--gold-400);">☀</span> Light: <span id="res-light">0</span>`;
  const waterEl = document.createElement('div');
  waterEl.innerHTML = `<span style="color: var(--water-400);">💧</span> Water: <span id="res-water">0</span>`;
  const mineralsEl = document.createElement('div');
  mineralsEl.innerHTML = `<span style="color: var(--mineral-400);">⛏</span> Minerals: <span id="res-minerals">0</span>`;

  resourceReadoutElement.appendChild(biomassEl);
  resourceReadoutElement.appendChild(energyEl);
  resourceReadoutElement.appendChild(lightEl);
  resourceReadoutElement.appendChild(waterEl);
  resourceReadoutElement.appendChild(mineralsEl);
  layer.appendChild(resourceReadoutElement);

  // Store tooltip references
  resourceTooltipElements = {
    biomass: document.getElementById('res-biomass') as HTMLSpanElement,
    energy: document.getElementById('res-energy') as HTMLSpanElement,
    light: document.getElementById('res-light') as HTMLSpanElement,
    water: document.getElementById('res-water') as HTMLSpanElement,
    minerals: document.getElementById('res-minerals') as HTMLSpanElement,
  };

  // Add hover tooltips
  if (resourceTooltipElements) {
    biomassEl.title = onboardingConfig.resource_tooltips.biomass;
    energyEl.title = 'Energy: spendable currency for growth. Produced by photosynthesis (leaves).';
    lightEl.title = onboardingConfig.resource_tooltips.light;
    waterEl.title = onboardingConfig.resource_tooltips.water;
    mineralsEl.title = onboardingConfig.resource_tooltips.minerals;
  }
}

function updateResourceReadout(
  light: number,
  water: number,
  minerals: number,
  biomass: number,
  energy?: number,
  storedWater?: number,
  storedMinerals?: number,
): void {
  console.log('[PlantLegacy] updateResourceReadout called with:', {
    light,
    water,
    minerals,
    biomass,
    energy,
    storedWater,
    storedMinerals,
  });
  if (!resourceTooltipElements) {
    console.warn('[PlantLegacy] resourceTooltipElements not initialized!');
    return;
  }
  resourceTooltipElements.biomass.textContent = biomass.toFixed(1);
  if (energy !== undefined) resourceTooltipElements.energy.textContent = energy.toFixed(1);
  resourceTooltipElements.light.textContent = light.toFixed(1);
  // Show average tile water/minerals with stored amount in tooltip
  resourceTooltipElements.water.textContent = water.toFixed(1);
  if (storedWater !== undefined) {
    resourceTooltipElements.water.title = `Tile avg: ${water.toFixed(1)} | Stored: ${storedWater.toFixed(1)}`;
  }
  resourceTooltipElements.minerals.textContent = minerals.toFixed(1);
  if (storedMinerals !== undefined) {
    resourceTooltipElements.minerals.title = `Tile avg: ${minerals.toFixed(1)} | Stored: ${storedMinerals.toFixed(1)}`;
  }
}

// Two-step growth selection UI (ADR-018)
let growthSelectionPanel: HTMLDivElement | null = null;

function createGrowthSelectionUI(): void {
  const layer = uiShell?.getLayer('hud');
  if (!layer) return;

  const panel = document.createElement('div');
  panel.id = 'growth-selection-panel';
  panel.style.cssText = `
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 200;
    background: rgba(20, 24, 15, 0.95);
    border: 1px solid var(--bark-700);
    border-radius: 8px;
    padding: 12px 16px;
    color: var(--bone-100);
    font-family: ui-monospace, "JetBrains Mono", monospace;
    font-size: calc(12px * var(--text-scale));
    min-width: 280px;
    max-width: 400px;
    pointer-events: auto;
    box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    display: none;
  `;

  // Prevent clicks inside panel from bubbling to canvas
  panel.addEventListener('click', (e) => e.stopPropagation());

  panel.innerHTML = `
    <div id="growth-title" style="font-weight: bold; margin-bottom: 8px; color: var(--leaf-400);">
      Select growth for node <span id="growth-node-id"></span>
    </div>
    <div id="growth-options" style="display: flex; flex-direction: column; gap: 6px;"></div>
    <div id="growth-node-info" style="margin-top: 8px; font-size: 0.9em; color: var(--bark-300);"></div>
    <div style="margin-top: 10px; display: flex; gap: 8px;">
      <button id="growth-cancel" style="
        flex: 1; padding: 6px 12px; background: var(--bark-800); border: 1px solid var(--bark-600);
        border-radius: 4px; color: var(--bone-100); cursor: pointer; font-family: inherit;
      ">Cancel (Esc)</button>
    </div>
  `;

  layer.appendChild(panel);
  growthSelectionPanel = panel;
}

function requestGrowthOptions(nodeId: string): void {
  if (!ws || ws.readyState !== WebSocket.OPEN || !plantId) return;

  growthSelectionStateMachineRequestOptions(growthSelectionMachine, nodeId);
  // WebGPU selection outline
  webgpuRenderer?.setSelectedNode(nodeId);
  showGrowthPanelMessage(nodeId, 'Loading growth options…');

  ws.send(
    JSON.stringify({
      type: MESSAGE_TYPE.GROWTH_OPTIONS_REQUEST,
      payload: { plantId, nodeId },
    }),
  );
}

function prepareGrowthPanel(nodeId: string): {
  title: HTMLElement;
  optionsEl: HTMLElement;
  infoEl: HTMLElement;
} | null {
  const panel = growthSelectionPanel;
  const title = document.getElementById('growth-title');
  const optionsEl = document.getElementById('growth-options');
  const infoEl = document.getElementById('growth-node-info');
  if (!panel || !title || !optionsEl || !infoEl) return null;

  const node = plantNodes.get(nodeId);
  title.textContent = node ? `Grow from ${nodeTypeLabel(node)} (${node.id.slice(0, 8)})` : 'Grow';

  const cancelBtn = document.getElementById('growth-cancel');
  if (cancelBtn) cancelBtn.onclick = hideGrowthSelection;

  panel.style.display = 'block';
  return { title, optionsEl, infoEl };
}

function showGrowthPanelMessage(nodeId: string, message: string): void {
  const parts = prepareGrowthPanel(nodeId);
  if (!parts) return;
  parts.optionsEl.innerHTML = '';
  const note = document.createElement('div');
  note.style.cssText = 'color: var(--bark-300);';
  note.textContent = message;
  parts.optionsEl.appendChild(note);
  parts.infoEl.textContent = '';
}

function renderGrowthOptions(result: GrowthOptionsView): void {
  const data: GrowthSelectionViewData = {
    nodeId: result.nodeId,
    options: result.options,
    conditions: result.conditions ?? null,
    isSeed: result.isSeed,
    nodeType: result.nodeType,
    biomass: result.biomass,
    energy: result.energy,
  };
  growthSelectionStateMachineRenderOptions(growthSelectionMachine, data);

  const parts = prepareGrowthPanel(result.nodeId);
  if (!parts) return;

  const infoLines = [`Biomass: ${result.biomass.toFixed(1)} | Energy: ${result.energy.toFixed(1)}`];
  if (result.conditions) {
    const c = result.conditions;
    infoLines.push(
      `Light: ${c.light.toFixed(0)} / ${c.minLight.toFixed(0)} | ` +
        `Moisture: ${c.moisture.toFixed(0)} / ${c.minMoisture.toFixed(0)}`,
    );
  }
  parts.infoEl.innerHTML = infoLines.map((line) => `<div>${line}</div>`).join('');

  parts.optionsEl.innerHTML = '';
  if (result.options.length === 0) {
    const note = document.createElement('div');
    note.style.cssText = 'color: var(--bark-300);';
    note.textContent = 'No growth is available from this node.';
    parts.optionsEl.appendChild(note);
    return;
  }

  for (const opt of result.options) {
    const btn = document.createElement('button');
    btn.style.cssText = `
      padding: 10px 12px; background: var(--bark-800); border: 1px solid var(--bark-600);
      border-radius: 4px; color: var(--bone-100); font-family: inherit;
      text-align: left; transition: background 0.1s;
      cursor: ${opt.available ? 'pointer' : 'default'};
      opacity: ${opt.available ? '1' : '0.55'};
      margin-bottom: 6px;
    `;
    btn.disabled = !opt.available;

    const reasonHtml =
      !opt.available && opt.reason
        ? `<div style="font-size: 0.8em; color: #e08a7a; margin-top: 4px;">✗ ${opt.reason}</div>`
        : '';
    const riskHtml = opt.risk
      ? `<div style="font-size: 0.8em; color: #ffb26b; margin-top: 4px;">⚠ ${opt.risk}</div>`
      : '';

    // Build requirements display - show both germination (tile) and growth (stored) requirements
    let requirementsHtml = '';
    if (result.conditions) {
      const c = result.conditions;
      // Germination requirements (tile-based)
      const lightStatus = c.light >= c.minLight ? '✓' : '✗';
      const moistureStatus = c.moisture >= c.minMoisture ? '✓' : '✗';

      // Growth requirements (stored-based) - only show for non-seed nodes
      let growthReqHtml = '';
      if (!result.isSeed && c.storedWater !== undefined && c.storedMinerals !== undefined) {
        const waterStatus =
          c.growthOk !== false && c.storedWater >= (c.growthMinWater ?? 0) ? '✓' : '✗';
        const mineralStatus =
          c.growthOk !== false && c.storedMinerals >= (c.growthMinMinerals ?? 0) ? '✓' : '✗';
        growthReqHtml = `
          <div>Growth: ${waterStatus} Stored Water ${c.storedWater.toFixed(1)}/${c.growthMinWater?.toFixed(1) ?? 0} | ${mineralStatus} Stored Minerals ${c.storedMinerals.toFixed(1)}/${c.growthMinMinerals?.toFixed(1) ?? 0}</div>`;
      }

      // Per-option resource costs
      const optionCostHtml =
        opt.waterCost !== undefined || opt.mineralCost !== undefined
          ? `<div>Cost: ${opt.waterCost?.toFixed(1) ?? 0} 💧 | ${opt.mineralCost?.toFixed(1) ?? 0} ⛏️</div>`
          : '';

      requirementsHtml = `
        <div style="font-size: 0.75em; color: var(--bark-300); margin-top: 6px; padding: 6px; background: var(--bark-900); border-radius: 3px;">
          <div>Germination: ${lightStatus} Light ${c.light.toFixed(0)}/${c.minLight.toFixed(0)} | ${moistureStatus} Tile Water ${c.moisture.toFixed(0)}/${c.minMoisture.toFixed(0)}</div>
          ${growthReqHtml}
          ${optionCostHtml}
        </div>`;
    }

    btn.innerHTML = `
      <div style="font-weight: bold; font-size: 0.95em;">${opt.label}</div>
      <div style="font-size: 0.8em; color: var(--bark-300); margin-top: 4px;">
        Cost: ${opt.energyCost.toFixed(1)} ⚡ | Gain: +${opt.biomassGain.toFixed(1)} 🌿 | ~${opt.expectedSeconds.toFixed(1)}s
      </div>
      ${requirementsHtml}
      ${reasonHtml}
      ${riskHtml}
    `;
    if (opt.available) {
      btn.onmouseenter = () => (btn.style.background = 'var(--bark-700)');
      btn.onmouseleave = () => (btn.style.background = 'var(--bark-800)');
      btn.onclick = (e) => {
        e.stopPropagation();
        // Select this growth option, then drag from the selected node to set direction
        growthSelectionStateMachineSelectOption(growthSelectionMachine, opt.type, opt.label);
        // If player selects a subterranean root option (radicle, root, lateral_root),
        // automatically enable Root Sight so the player can see underground growth!
        if (opt.type === 'radicle' || opt.type === 'root' || opt.type === 'lateral_root') {
          setRootSightEnabled(true);
        }
        controls.enabled = false;
        controls.enableRotate = false;
        controls.enablePan = false;
        parts.optionsEl.querySelectorAll('button').forEach((b) => {
          (b as HTMLButtonElement).style.outline = 'none';
        });
        btn.style.outline = '2px solid var(--leaf-400)';
        console.log('[PlantLegacy] Growth option selected', {
          nodeId: result.nodeId,
          optionType: opt.type,
          state: growthSelectionStateMachineGetState(growthSelectionMachine),
        });
        setDetail(
          `Selected ${opt.label}. Click+drag on the plant/canvas to set direction, then release.`,
        );
        uiShell?.toast({
          message: `Selected ${opt.label} — drag to grow`,
          kind: 'info',
          durationMs: 2000,
        });
      };
    }
    parts.optionsEl.appendChild(btn);
  }
}

function hideGrowthSelection(): void {
  growthSelectionStateMachineHide(growthSelectionMachine);
  removeGrowthDirectionLine();
  controls.enabled = true;
  controls.enableRotate = true;
  controls.enablePan = true;
  // Clear WebGPU selection outline
  webgpuRenderer?.setSelectedNode(null);
  const panel = growthSelectionPanel;
  if (panel) panel.style.display = 'none';
}

function confirmGrowth(
  nodeId: string,
  nodeType: string,
  drawnDirection?: { x: number; y: number; z: number },
): void {
  console.log('[PlantLegacy] confirmGrowth called', {
    nodeId,
    nodeType,
    drawnDirection,
    ws: !!ws,
    ready: ws?.readyState,
    plantId,
    plantReady,
  });
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    setDetail(`Growth not sent: WebSocket not open (${ws?.readyState ?? 'none'})`);
    uiShell?.toast({ message: 'Growth not sent: not connected', kind: 'error', durationMs: 3000 });
    hideGrowthSelection();
    return;
  }
  if (!plantId || !plantReady) {
    setDetail(`Growth not sent: plant not ready (plantId=${String(plantId)}, ready=${plantReady})`);
    uiShell?.toast({
      message: 'Growth not sent: plant not ready',
      kind: 'error',
      durationMs: 3000,
    });
    hideGrowthSelection();
    return;
  }

  growthIntentTick++;
  hideGrowthSelection();

  // Use drawn direction if provided, otherwise fall back to automatic direction
  const dir = new THREE.Vector3(0, 1, 0);
  if (drawnDirection) {
    dir.set(drawnDirection.x, drawnDirection.y, drawnDirection.z);
  } else {
    const camDir = new THREE.Vector3(0, 0, -1);
    camDir.applyQuaternion(camera.quaternion);
    camDir.normalize();

    if (nodeType === 'root' || nodeType === 'radicle' || nodeType === 'lateral_root') {
      dir.set(0, -1, 0);
    } else if (nodeType === 'vine') {
      dir.set(camDir.x, 0.1, camDir.z).normalize();
    } else {
      const horizontalDir = new THREE.Vector3(camDir.x, 0, camDir.z);
      if (horizontalDir.length() > 0.1) {
        horizontalDir.normalize();
        if (nodeType === 'stem') {
          dir.set(horizontalDir.x * 0.3, 0.9, horizontalDir.z * 0.3).normalize();
        } else {
          dir.copy(horizontalDir);
        }
      }
    }
  }

  const intent: GrowthIntent = {
    plantId,
    nodeId,
    direction: { x: dir.x, y: dir.y, z: dir.z },
    nodeType,
    isAttack: false,
    tick: growthIntentTick,
  };

  const message = JSON.stringify({
    type: MESSAGE_TYPE.GROWTH_INTENT,
    payload: { intent },
  });
  console.log('[PlantLegacy] Sending GROWTH_INTENT:', intent);
  ws.send(message);
  setDetail(`Growth sent (${nodeType}). Waiting for server...`);
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
controls.minDistance = 1;
controls.maxDistance = 200;
controls.maxPolarAngle = Math.PI / 2 - 0.05;

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

function connect(): void {
  // Clean up existing connection if any
  if (ws) {
    // Remove all event listeners to prevent memory leaks
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    // Close the connection if it's still open
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(1000, 'Reconnecting');
    }
    ws = null;
  }

  if (connecting) return;

  connecting = true;
  setStatus('Connecting…', 'pending');
  setDetail(`Connecting to ${wsOrigin}...`);

  ws = new WebSocket(`${wsOrigin}/ws`);

  // Load stored reconnect data (accessToken for auth, plantId for anonymous reclaim)
  const reconnectData = loadReconnectData();

  ws.onopen = () => {
    connecting = false;
    console.log('[PlantLegacy] WebSocket OPEN - connected to server');
    setStatus('Connected', 'ok');
    setDetail('WebSocket connected, sending HELLO...');
    // Send HELLO
    const hello = JSON.stringify({
      type: MESSAGE_TYPE.HELLO,
      payload: {
        clientVersion: PROTOCOL_VERSION,
        accessToken: reconnectData?.accessToken,
        plantId: reconnectData?.plantId,
      },
    });
    console.log('[PlantLegacy] Sending HELLO:', hello);
    ws?.send(hello);
  };

  ws.onmessage = async (event) => {
    try {
      const message = JSON.parse(event.data);
      const { type, payload } = message;

      console.log(
        '[PlantLegacy] Received message type:',
        type,
        'payload keys:',
        Object.keys(payload || {}),
      );

      // Phase 2: validate message schemas before acting on payloads. Malformed
      // server broadcasts are skipped with a warning instead of being
      // `as`-cast into shape (INV-NET-08).
      const validation = validateMessage(type, payload);
      if (!validation.ok) {
        console.warn('PlantLegacy: skipping malformed server message', {
          type,
          issues: validation.issues,
          payloadKeys: Object.keys(payload || {}),
          payloadSample: JSON.stringify(payload).slice(0, 500),
        });
        // Extra debug for specific message types
        if (type === 18 || type === 19) {
          console.log(
            '[PlantLegacy] PLANT_SYNC/CREATED full payload:',
            JSON.stringify(payload, null, 2),
          );
        }
        return;
      }

      if (debugOverlay) {
        debugOverlay.recordBytes(event.data.length, 0);
      }

      if (debugOverlay) {
        debugOverlay.recordBytes(event.data.length, 0);
      }

      switch (type) {
        case MESSAGE_TYPE.WELCOME: {
          console.log('[PlantLegacy] WELCOME received:', {
            playerId: payload.playerId,
            plantId: payload.plantId,
            tick: payload.tick,
            hasRootNode: !!payload.rootNode,
            nodeCount: payload.nodes?.length ?? 0,
            totalBiomass: payload.totalBiomass,
            totalEnergy: payload.totalEnergy,
          });
          welcome = payload as WelcomePayload;

          playerId = welcome.playerId;
          plantId = welcome.plantId;
          plantReady = true;
          serverTick = welcome.tick;
          // Persist plantId for anonymous reconnect (ADR-029: dev switch)
          saveReconnectData({ plantId: welcome.plantId });
          plantNodes.clear();
          // Initialize with full node set from server (ADR-021).
          // WELCOME now carries all nodes for the player's own plant.
          if (welcome.nodes && welcome.nodes.length > 0) {
            for (const node of welcome.nodes) {
              const typeMap: Record<string, number> = {
                seed: 4,
                radicle: 0,
                root: 0,
                lateral_root: 0,
                stem: 1,
                branch: 1,
                vine: 2,
                leaf: 3,
                cotyledon: 3,
                flower: 3,
                spore_sac: 3,
              };
              const nodeTypeNum = typeMap[node.type] ?? 0;
              const radius = nodeRadius(node.biomass, nodeTypeNum, node.y);
              const health = Math.min(1, node.biomass / 10);
              plantNodes.set(node.id, {
                id: node.id,
                position: new THREE.Vector3(node.x, node.y, node.z),
                type: nodeTypeNum,
                radius,
                parentId: node.parentId,
                age: node.age,
                health,
                mutationFlags: 0,
                biomass: node.biomass,
                isOwnPlant: true,
                isSeed: node.isSeed ?? node.type === 'seed',
                nodeType: node.type,
                spawnTime: performance.now(),
              });
            }
            plantBiomass = welcome.totalBiomass;
            plantEnergy = welcome.totalEnergy;
            // Don't call updateResourceReadout with zeros - wait for first RESOURCE_UPDATE
            if (plantRenderer) {
              plantRenderer.updatePlantData(Array.from(plantNodes.values()));
            }
            if (webgpuRenderer) {
              webgpuRenderer.updatePlants(Array.from(plantNodes.values()), performance.now());
            }
          } else if (welcome.rootNode) {
            // Fallback for older server without nodes in WELCOME
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
              isSeed: welcome.rootNode.type === 'seed',
              nodeType: welcome.rootNode.type,
              spawnTime: performance.now(),
            });
            plantBiomass = welcome.totalBiomass;
            plantEnergy = welcome.totalEnergy;
            // Don't call updateResourceReadout with zeros - wait for first RESOURCE_UPDATE
            if (plantRenderer) {
              plantRenderer.updatePlantData(Array.from(plantNodes.values()));
            }
            if (webgpuRenderer) {
              webgpuRenderer.updatePlants(Array.from(plantNodes.values()), performance.now());
            }
          }

          // Clear other players' plants to avoid stale data on reconnect
          otherPlayerPlants.clear();
          // Request full plant sync to discover other existing players in the world
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: MESSAGE_TYPE.PLANT_SYNC_REQUEST, payload: {} }));
          }
          // Request initial resource tile for own plant
          // Use the local plant's root/seed node (parentId === null) for accurate position
          const ownRootNode = Array.from(plantNodes.values()).find((n) => n.parentId === null);
          if (ws && ws.readyState === WebSocket.OPEN && ownRootNode) {
            ws.send(
              JSON.stringify({
                type: MESSAGE_TYPE.RESOURCE_QUERY,
                payload: { worldX: ownRootNode.position.x, worldZ: ownRootNode.position.z },
              }),
            );
          } else if (ws && ws.readyState === WebSocket.OPEN && welcome.rootNode) {
            // Fallback to welcome data
            ws.send(
              JSON.stringify({
                type: MESSAGE_TYPE.RESOURCE_QUERY,
                payload: { worldX: welcome.rootNode.x, worldZ: welcome.rootNode.z },
              }),
            );
          }
          break;
        }

        case MESSAGE_TYPE.STATE:
        case MESSAGE_TYPE.KEYFRAME: {
          const state = payload as StatePayload | KeyframePayload;
          serverTick = state.tick;
          console.debug('[PlantLegacy] STATE/KEYFRAME received:', {
            type,
            tick: state.tick,
            plantCount: state.plants?.length ?? 0,
          });
          if (debugOverlay) {
            debugOverlay.recordBytes(0, event.data.length);
          }
          // Update detail element with current server tick so UI shows live tick
          setDetail(
            `Server tick: ${serverTick}\n` +
              `Biomass: ${plantBiomass.toFixed(1)} | Energy: ${plantEnergy.toFixed(1)}\n` +
              `Plants: ${state.plants?.length ?? 0} | Own plant: ${plantId ?? 'none'}`,
          );
          break;
        }

        case MESSAGE_TYPE.RESOURCE_UPDATE: {
          const update = payload as {
            tick: number;
            tiles: Array<{
              tileX?: number;
              tileZ?: number;
              light: number;
              moisture: number;
              minerals: number;
            }>;
            width: number;
            height: number;
            tileSize: number;
            totalEnergy?: number;
            totalBiomass?: number;
            storedWater?: number;
            storedMinerals?: number;
            rootTileCount?: number;
          };
          serverTick = update.tick;
          if (debugOverlay) {
            debugOverlay.recordBytes(0, event.data.length);
          }
          console.debug('[PlantLegacy] RESOURCE_UPDATE received:', {
            tick: update.tick,
            tileCount: update.tiles?.length ?? 0,
            totalEnergy: update.totalEnergy,
            totalBiomass: update.totalBiomass,
          });
          // Ignore stale RESOURCE_UPDATE from old server connections (tick too far from current serverTick)
          if (serverTick !== 0 && Math.abs(update.tick - serverTick) > 1000) {
            console.warn('[PlantLegacy] Ignoring stale RESOURCE_UPDATE', {
              updateTick: update.tick,
              serverTick,
              diff: Math.abs(update.tick - serverTick),
            });
            return;
          }
          const tile = update.tiles[0];
          if (tile) {
            console.debug('[PlantLegacy] Processing tile:', {
              light: tile.light,
              moisture: tile.moisture,
              minerals: tile.minerals,
              tileX: tile.tileX,
              tileZ: tile.tileZ,
              storedWater: update.storedWater,
              storedMinerals: update.storedMinerals,
              rootTileCount: update.rootTileCount,
            });
            if (update.totalEnergy !== undefined) plantEnergy = update.totalEnergy;
            if (update.totalBiomass !== undefined) plantBiomass = update.totalBiomass;
            // Use average tile resources for display
            tileLight = tile.light;
            tileWater = tile.moisture;
            tileMinerals = tile.minerals;
            // Use plant's stored resources for growth panel
            const storedWater = update.storedWater ?? 0;
            const storedMinerals = update.storedMinerals ?? 0;
            updateResourceReadout(
              tile.light,
              tile.moisture,
              tile.minerals,
              plantBiomass,
              plantEnergy,
              storedWater,
              storedMinerals,
            );
            // Update dev panel tile info
            if (devPanel?.updateTileInfo) {
              devPanel.updateTileInfo(tile.tileX ?? 0, tile.tileZ ?? 0, {
                light: tile.light,
                moisture: tile.moisture,
                minerals: tile.minerals,
                storedWater,
                storedMinerals,
                rootTileCount: update.rootTileCount ?? 1,
              });
            }
            // Update growth panel if visible with live resource values
            if (
              growthSelectionStateMachineIsVisible(growthSelectionMachine) &&
              growthSelectionStateMachineGetState(growthSelectionMachine) === 'options_visible' &&
              growthSelectionMachine.selectedNodeId &&
              growthSelectionMachine.conditions
            ) {
              growthSelectionMachine.conditions.light = tile.light;
              growthSelectionMachine.conditions.moisture = tile.moisture;
              growthSelectionMachine.conditions.storedWater = storedWater;
              growthSelectionMachine.conditions.storedMinerals = storedMinerals;
              const parts = prepareGrowthPanel(growthSelectionMachine.selectedNodeId);
              if (parts) {
                const infoLines = [
                  `Biomass: ${plantBiomass.toFixed(1)} | Energy: ${plantEnergy.toFixed(1)}`,
                  `Light: ${tile.light.toFixed(0)} / ${growthSelectionMachine.conditions.minLight.toFixed(0)} | Moisture: ${tile.moisture.toFixed(0)} / ${growthSelectionMachine.conditions.minMoisture.toFixed(0)}`,
                  `Stored Water: ${storedWater.toFixed(1)} | Stored Minerals: ${storedMinerals.toFixed(1)}`,
                ];
                parts.infoEl.innerHTML = infoLines.map((line) => `<div>${line}</div>`).join('');
              }
            }
          }
          break;
        }

        case MESSAGE_TYPE.WEATHER_UPDATE: {
          const weather = payload as {
            timeOfDay: number;
            isDay: boolean;
            sunIntensity: number;
            weatherState: string;
            conditionToken: string;
            stateTimeRemainingS: number;
            forecast: {
              nextWeatherState: string;
              timeUntilNextStateS: number;
            };
          };

          // Suppress verbose weather logs - only log state changes
          // console.log('[PlantLegacy] WEATHER_UPDATE received:', { weatherState: weather.weatherState, timeOfDay: weather.timeOfDay, isDay: weather.isDay });

          // C03: EnvironmentRenderer dynamically drives sky dome, sun/moon arcs, lights, fog, and rain
          if (environmentRenderer) {
            environmentRenderer.handleWeatherUpdate(weather);
          } else {
            sunLight.intensity = Math.max(0.05, 1.4 * weather.sunIntensity);
            ambientLight.intensity = Math.max(0.12, 0.7 * weather.sunIntensity + 0.1);
          }

          if (debugOverlay) {
            debugOverlay.recordBytes(0, event.data.length);
          }
          break;
        }

        case MESSAGE_TYPE.GROWTH_EVENT: {
          const growth = payload as GrowthEventPayload;
          const incomingNodes: GrowthEventNode[] =
            growth.newNodes && growth.newNodes.length > 0
              ? growth.newNodes
              : growth.newNode
                ? [growth.newNode]
                : [];
          const updatedParent = growth.updatedParentNode;

          console.log('[PlantLegacy] GROWTH_EVENT received:', {
            plantId: growth.plantId,
            nodeCount: incomingNodes.length,
            updatedParentId: updatedParent?.id,
            totalBiomass: growth.totalBiomass,
            totalEnergy: growth.totalEnergy,
          });

          const typeMap: Record<string, number> = {
            seed: 4,
            radicle: 0,
            root: 0,
            lateral_root: 0,
            stem: 1,
            branch: 1,
            vine: 2,
            leaf: 3,
            cotyledon: 3,
            flower: 3,
            spore_sac: 3,
          };

          const toNodeData = (node: GrowthEventNode, isOwnPlant: boolean): PlantNodeData => {
            const nodeTypeNum = typeMap[node.type] ?? 0;
            const existing = isOwnPlant
              ? plantNodes.get(node.id)
              : otherPlayerPlants.get(growth.plantId)?.get(node.id);
            return {
              id: node.id,
              position: new THREE.Vector3(node.x, node.y, node.z),
              type: nodeTypeNum,
              radius: nodeRadius(node.biomass, nodeTypeNum, node.y),
              parentId: node.parentId,
              age: node.age,
              health: Math.min(1, node.biomass / 10),
              mutationFlags: 0,
              biomass: node.biomass,
              isOwnPlant,
              isSeed: node.isSeed ?? node.type === 'seed',
              nodeType: node.type,
              spawnTime: existing?.spawnTime ?? performance.now(),
              growthProgress: node.growthProgress ?? 1.0,
            };
          };

          if (growth.plantId === plantId) {
            // Local player's plant - apply every new node, then replace the
            // seed with the root when germination reports an updated parent.
            const now = performance.now();
            for (const node of incomingNodes) {
              const nodeData = toNodeData(node, true);
              plantNodes.set(node.id, nodeData);
              // If new node is subterranean (radicle or root), engage Root Sight
              // so the player immediately watches the new root sprout and grow!
              if (
                node.type === 'radicle' ||
                node.type === 'root' ||
                node.type === 'lateral_root' ||
                node.layer === 'root'
              ) {
                setRootSightEnabled(true);
              }
              // Focus camera on growing node to center it smoothly in the middle of the screen
              focusCameraOnNode(nodeData);
              // Track growing nodes for client-side animation
              if ((nodeData.growthProgress ?? 1.0) < 1.0) {
                growingNodes.set(node.id, { startTime: now, duration: DEFAULT_GROWTH_DURATION_MS });
              }
              // Update parent's children array (INV-NET-09)
              if (node.parentId) {
                const parent = plantNodes.get(node.parentId);
                if (parent && !(parent.children ?? []).includes(node.id)) {
                  parent.children = [...(parent.children ?? []), node.id];
                }
              }
            }
            if (updatedParent) {
              plantNodes.set(updatedParent.id, toNodeData(updatedParent, true));
              // For germination, the updated parent (seed->root) should have the new children
              if (updatedParent.children) {
                const parentNode = plantNodes.get(updatedParent.id);
                if (parentNode) {
                  parentNode.children = updatedParent.children;
                }
              }
            }
            plantBiomass = growth.totalBiomass ?? plantBiomass;
            plantEnergy = growth.totalEnergy ?? plantEnergy;
            // Track growth sequence from server for gap detection (Phase 1.5)
            const serverGrowthSeq = growth.growthSeq ?? 0;
            if (serverGrowthSeq > plantGrowthSeq) {
              plantGrowthSeq = serverGrowthSeq;
            } else if (serverGrowthSeq < plantGrowthSeq) {
              // Server sequence behind - potential desync, request resync
              checkPlantGrowthGap(serverGrowthSeq + PLANT_MAX_GAP_BEFORE_RESYNC);
            }
            // Check for gap in growth sequence
            checkPlantGrowthGap(plantGrowthSeq);
            // Keep the last tile readings; growth must not blank the HUD.
            updateResourceReadout(
              tileLight,
              tileWater,
              tileMinerals,
              plantBiomass,
              plantEnergy,
              undefined,
              undefined,
            );
            if (plantRenderer) {
              const otherNodes: PlantNodeData[] = [];
              for (const nodes of otherPlayerPlants.values()) {
                otherNodes.push(...nodes.values());
              }
              const allNodes = [...plantNodes.values(), ...otherNodes];
              plantRenderer.updatePlantData(allNodes);
            }
            if (webgpuRenderer) {
              const otherNodes: PlantNodeData[] = [];
              for (const nodes of otherPlayerPlants.values()) {
                otherNodes.push(...nodes.values());
              }
              const allNodes = [...plantNodes.values(), ...otherNodes];
              webgpuRenderer.updatePlants(allNodes, performance.now());
            }
            const lastNode = incomingNodes[incomingNodes.length - 1] ?? updatedParent;
            if (lastNode) {
              setDetail(
                `Grew ${lastNode.type} #${plantNodes.size} at (${lastNode.x.toFixed(1)}, ${lastNode.y.toFixed(1)}, ${lastNode.z.toFixed(1)}) — Biomass: ${plantBiomass.toFixed(1)}, Energy: ${plantEnergy.toFixed(1)}`,
              );
            }
          } else {
            // Other player's plant
            let otherPlant = otherPlayerPlants.get(growth.plantId);
            if (!otherPlant) {
              otherPlant = new Map();
              otherPlayerPlants.set(growth.plantId, otherPlant);
            }
            for (const node of incomingNodes) {
              otherPlant.set(node.id, toNodeData(node, false));
              // Update parent's children array (INV-NET-09)
              if (node.parentId) {
                const parent = otherPlant.get(node.parentId);
                if (parent && !(parent.children ?? []).includes(node.id)) {
                  parent.children = [...(parent.children ?? []), node.id];
                }
              }
            }
            if (updatedParent) {
              otherPlant.set(updatedParent.id, toNodeData(updatedParent, false));
              // For germination, the updated parent should have the new children
              if (updatedParent.children) {
                const parentNode = otherPlant.get(updatedParent.id);
                if (parentNode) {
                  parentNode.children = updatedParent.children;
                }
              }
            }
            // Update renderers with other player's newly grown nodes
            if (plantRenderer) {
              const otherNodes: PlantNodeData[] = [];
              for (const nodes of otherPlayerPlants.values()) {
                otherNodes.push(...nodes.values());
              }
              const allNodes = [...plantNodes.values(), ...otherNodes];
              plantRenderer.updatePlantData(allNodes);
            }
            if (webgpuRenderer) {
              const otherNodes: PlantNodeData[] = [];
              for (const nodes of otherPlayerPlants.values()) {
                otherNodes.push(...nodes.values());
              }
              const allNodes = [...plantNodes.values(), ...otherNodes];
              webgpuRenderer.updatePlants(allNodes, performance.now());
            }
          }
          break;
        }

        case MESSAGE_TYPE.GROWTH_OPTIONS_RESULT: {
          const response = payload as {
            nodeId?: string;
            nodeType?: string;
            isSeed?: boolean;
            energy?: number;
            biomass?: number;
            options?: Array<{
              type: string;
              label: string;
              energyCost: number;
              biomassGain: number;
              expectedSeconds: number;
              available: boolean;
              reason?: string;
              risk?: string;
            }>;
            error?: string;
          };
          console.log('[PlantLegacy] GROWTH_OPTIONS_RESULT received:', response);
          if (!growthSelectionStateMachineIsVisible(growthSelectionMachine)) break;
          if (
            response.nodeId &&
            growthSelectionMachine.selectedNodeId &&
            response.nodeId !== growthSelectionMachine.selectedNodeId
          ) {
            break; // Stale response for a previous selection
          }
          if (response.error || !response.options) {
            const reason =
              response.error === 'node_not_found'
                ? 'That node is no longer part of your plant.'
                : response.error === 'plant_mismatch'
                  ? 'Plant mismatch — refresh to sync.'
                  : 'Could not load growth options.';
            hideGrowthSelection();
            setDetail(reason);
            uiShell?.toast({ message: reason, kind: 'error', durationMs: 5000 });
            break;
          }
          renderGrowthOptions({
            nodeId: response.nodeId ?? '',
            nodeType: response.nodeType ?? 'seed',
            isSeed: response.isSeed ?? true,
            energy: response.energy ?? 0,
            biomass: response.biomass ?? 0,
            options: response.options ?? [],
          });
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
                  : reject.reason === 'insufficient_energy_for_node' ||
                      reject.reason === 'insufficient_energy'
                    ? 'Not enough energy — grow leaves to photosynthesize'
                    : reject.reason === 'insufficient_energy_for_germination'
                      ? 'Not enough energy to germinate'
                      : reject.reason === 'Roots must grow mostly downward' ||
                          reject.reason === 'Roots must grow downward' ||
                          reject.reason ===
                            'Root growth must trend below the selected node (can arc near surface, but not mostly upward)' ||
                          reject.reason === 'Root growth direction too horizontal'
                        ? 'Root direction too shallow/horizontal — trace a route that ends clearly below the node (it can arc near the surface)'
                        : reject.reason === 'Cotyledons must grow upward'
                          ? 'Cotyledon direction too low — drag upward/outward'
                          : reject.reason === 'germination_failed_conditions'
                            ? 'Germination failed: light or moisture was below the threshold — the seed died.'
                            : reject.reason === 'germination_conditions_not_met'
                              ? 'Germination failed: light or moisture was below the threshold.'
                              : reject.reason === 'plant_not_found'
                                ? 'Plant not found — refresh to get a new seed'
                                : reject.reason === 'plant_mismatch'
                                  ? 'Plant mismatch — refresh to sync'
                                  : reject.reason;
          console.warn('[PlantLegacy] REJECT received:', reject);
          setDetail(`Growth Notice: ${readableReason}`);
          uiShell?.toast({ message: readableReason, kind: 'error', durationMs: 5000 });
          break;
        }

        case MESSAGE_TYPE.ERROR: {
          const error = payload as ErrorPayload;
          console.log('[PlantLegacy] ERROR received:', error);
          setDetail(`ERROR: ${error.code} - ${error.message}`);
          break;
        }

        case MESSAGE_TYPE.DEV_RESPONSE: {
          const response = payload as {
            success?: boolean;
            message?: string;
            [key: string]: unknown;
          };
          console.log('[PlantLegacy] DEV_RESPONSE received:', response);
          const msg = response.success
            ? '✓ Dev command succeeded'
            : `✗ Dev command failed: ${response.message ?? 'unknown'}`;
          setDetail(msg);
          uiShell?.toast({
            message: msg,
            kind: response.success ? 'state' : 'error',
            durationMs: 3000,
          });
          break;
        }

        case MESSAGE_TYPE.PLANT_SYNC: {
          const sync = payload as {
            plants: Array<{
              id: string;
              ownerId: string;
              rootNodeId: string | null;
              totalBiomass: number;
              totalEnergy: number;
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
                isSeed?: boolean;
                growthProgress?: number;
              }>;
            }>;
          };
          console.log('[PlantLegacy] PLANT_SYNC received:', {
            plantCount: sync.plants?.length ?? 0,
            plants: sync.plants?.map((p) => ({
              id: p.id,
              ownerId: p.ownerId,
              nodeCount: p.nodes?.length ?? 0,
              biomass: p.totalBiomass,
              energy: p.totalEnergy,
            })),
          });
          const typeMap: Record<string, number> = {
            seed: 4,
            radicle: 0,
            root: 0,
            lateral_root: 0,
            stem: 1,
            branch: 1,
            vine: 2,
            leaf: 3,
            cotyledon: 3,
            flower: 3,
            spore_sac: 3,
          };
          // A sync is authoritative for every active plant, including our own.
          // Rebuild it wholesale so reconnect restores the saved node graph
          // instead of keeping the one-node seed from WELCOME.
          otherPlayerPlants.clear();
          for (const plant of sync.plants) {
            const isOwn =
              (plantId !== null && plant.id === plantId) ||
              (playerId !== null && plant.ownerId === playerId) ||
              (welcome?.plantId !== undefined && plant.id === welcome.plantId);
            if (isOwn && !plantId) {
              plantId = plant.id;
              plantReady = true;
            }
            const target = new Map<
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
                isSeed: boolean;
                nodeType: string;
                spawnTime?: number;
                growthProgress?: number;
              }
            >();
            for (const node of plant.nodes) {
              const nodeTypeNum = typeMap[node.type] ?? 0;
              const radius = nodeRadius(node.biomass, nodeTypeNum, node.y);
              const health = Math.min(1, node.biomass / 10);
              const existing = isOwn ? plantNodes.get(node.id) : undefined;
              target.set(node.id, {
                id: node.id,
                position: new THREE.Vector3(node.x, node.y, node.z),
                type: nodeTypeNum,
                radius,
                parentId: node.parentId,
                age: node.age,
                health,
                mutationFlags: 0,
                biomass: node.biomass,
                isOwnPlant: isOwn,
                isSeed: node.isSeed ?? node.type === 'seed',
                nodeType: node.type,
                spawnTime: existing?.spawnTime ?? performance.now(),
                growthProgress: node.growthProgress ?? 1.0,
              });
            }
            if (isOwn) {
              plantNodes.clear();
              for (const [id, node] of target) plantNodes.set(id, node);
              plantBiomass = plant.totalBiomass;
              plantEnergy = plant.totalEnergy;
              // Reset growth sequence on full sync (Phase 1.5)
              resetPlantMirror();
              // Track growing nodes from sync
              growingNodes.clear();
              const now = performance.now();
              for (const node of target.values()) {
                if ((node.growthProgress ?? 1.0) < 1.0) {
                  // Estimate remaining time based on current progress
                  const progress = node.growthProgress ?? 0;
                  const elapsed = progress * DEFAULT_GROWTH_DURATION_MS;
                  growingNodes.set(node.id, {
                    startTime: now - elapsed,
                    duration: DEFAULT_GROWTH_DURATION_MS,
                  });
                }
              }
              // Don't call updateResourceReadout with zeros - wait for RESOURCE_UPDATE
            } else {
              otherPlayerPlants.set(plant.id, target);
            }
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
          if (webgpuRenderer) {
            const otherNodes: PlantNodeData[] = [];
            for (const nodes of otherPlayerPlants.values()) {
              otherNodes.push(...nodes.values());
            }
            const allNodes = [...plantNodes.values(), ...otherNodes];
            webgpuRenderer.updatePlants(allNodes, performance.now());
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
                isSeed?: boolean;
              }>;
            };
          };
          console.log('[PlantLegacy] PLANT_CREATED received:', {
            plantId: created.plant.id,
            ownerId: created.plant.ownerId,
            nodeCount: created.plant.nodes?.length ?? 0,
            biomass: created.plant.totalBiomass,
          });
          const typeMap: Record<string, number> = {
            seed: 4,
            radicle: 0,
            root: 0,
            lateral_root: 0,
            stem: 1,
            branch: 1,
            vine: 2,
            leaf: 3,
            cotyledon: 3,
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
              isSeed: boolean;
              nodeType: string;
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
              isSeed: node.isSeed ?? node.type === 'seed',
              nodeType: node.type,
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
          if (webgpuRenderer) {
            const otherNodes: PlantNodeData[] = [];
            for (const nodes of otherPlayerPlants.values()) {
              otherNodes.push(...nodes.values());
            }
            const allNodes = [...plantNodes.values(), ...otherNodes];
            webgpuRenderer.updatePlants(allNodes, performance.now());
          }
          setDetail(`New player joined: ${created.plant.id}`);
          break;
        }

        case MESSAGE_TYPE.PLANT_REMOVED: {
          const removed = payload as { plantId: string };
          console.log('[PlantLegacy] PLANT_REMOVED received:', {
            plantId: removed.plantId,
            isOwnPlant: removed.plantId === plantId,
          });
          if (removed.plantId === plantId) {
            // Failed germination or removal with persistence off. There is no
            // implicit restore: the player reloads to start a fresh seed.
            plantNodes.clear();
            otherPlayerPlants.clear();
            plantId = null;
            plantReady = false;
            // Reset plant mirror (Phase 1.5)
            resetPlantMirror();
            clearReconnectData();
            hideGrowthSelection();
            plantBiomass = 0;
            plantEnergy = 0;
            updateResourceReadout(
              tileLight,
              tileWater,
              tileMinerals,
              plantBiomass,
              plantEnergy,
              undefined,
              undefined,
            );
            if (plantRenderer) plantRenderer.updatePlantData([]);
            if (webgpuRenderer) webgpuRenderer.updatePlants([], performance.now());
            setDetail('Your plant died. Reload to plant a new seed.');
            break;
          }
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
            if (webgpuRenderer) {
              const otherNodes: PlantNodeData[] = [];
              for (const nodes of otherPlayerPlants.values()) {
                otherNodes.push(...nodes.values());
              }
              const allNodes = [...plantNodes.values(), ...otherNodes];
              webgpuRenderer.updatePlants(allNodes, performance.now());
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

      // Frame camera on first spawn (after WELCOME). ADR-027: close framing on
      // the normal-sized plant model; the model itself is not enlarged.
      if (welcome?.rootNode && !cameraFramed) {
        cameraFramed = true;
        frameCameraOnPlant(welcome.rootNode.x, welcome.rootNode.y, welcome.rootNode.z);
        setDetail(
          `Welcome! Player ID: ${playerId}\nServer tick: ${serverTick}\nClick your plant to grow. Press H for hints.`,
        );
        // T00A: Load onboarding config and init renderer on first spawn
        await loadOnboardingConfig();
        await initPlantRenderer();
      }
    } catch (error) {
      console.error('Failed to parse message:', error);
    }
  };

  ws.onclose = (event) => {
    connecting = false;
    plantId = null;
    plantReady = false;
    cameraFramed = false;
    hideGrowthSelection();
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
  if (growthDirectionOverlay) {
    growthDirectionOverlay.width = window.innerWidth;
    growthDirectionOverlay.height = window.innerHeight;
  }
  if (plantRenderer) {
    plantRenderer.onResize();
  }
  if (webgpuRenderer) {
    webgpuRenderer.resize(window.innerWidth, window.innerHeight, renderer.getPixelRatio());
  }
});

// Prevent browser zoom (pinch, double-tap, ctrl+wheel)
window.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey || e.metaKey) e.preventDefault();
  },
  { passive: false },
);

let lastTouchEnd = 0;
window.addEventListener(
  'touchend',
  (e) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) e.preventDefault();
    lastTouchEnd = now;
  },
  { passive: false },
);

window.addEventListener(
  'touchmove',
  (e) => {
    if (e.touches.length > 1) e.preventDefault();
  },
  { passive: false },
);

window.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });

// Aggressive zoom reset: if page somehow gets zoomed, force reset to 1.0
let zoomCheckTimer: number | null = null;
function enforceNoZoom(): void {
  const vv = window.visualViewport;
  if (vv && vv.scale > 1.01) {
    console.warn('Zoom detected, scale:', vv.scale);
  }
  const docEl = document.documentElement;
  if (docEl.clientWidth < window.innerWidth * 0.95) {
    console.warn('Zoom detected via clientWidth mismatch');
  }
}
zoomCheckTimer = window.setInterval(enforceNoZoom, 500);

// Cleanup on unload
window.addEventListener('beforeunload', () => {
  if (zoomCheckTimer) window.clearInterval(zoomCheckTimer);
  if (backgroundLoopTimer) window.clearInterval(backgroundLoopTimer);
});

// Render loop
let measuredFps = 60;

// Shared render frame logic (used by both requestAnimationFrame and background setInterval)
function renderFrame(deltaTime: number): void {
  // WASD / arrows pan the camera and its target together (ADR-022).
  applyCameraPan(deltaTime);

  // Smooth keyboard camera zoom (- and + keys)
  if (keyboardZoomState.in || keyboardZoomState.out) {
    const currentDist = camera.position.distanceTo(controls.target);
    const zoomRate = 2.0; // Scaled by current distance for smooth logarithmic feel
    let delta = 0;
    if (keyboardZoomState.in) delta -= currentDist * zoomRate * deltaTime;
    if (keyboardZoomState.out) delta += currentDist * zoomRate * deltaTime;

    const minD = controls.minDistance || 0.5;
    const maxD = controls.maxDistance || 100;
    const newDist = Math.max(minD, Math.min(maxD, currentDist + delta));

    const dir = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, newDist);
    targetCameraDistance = -1; // Manual zoom takes precedence
  }

  // Smooth camera target recenter/focus on selected or growing node
  if (isCameraFocusing) {
    const t = Math.min(1.0, deltaTime * CAMERA_FOCUS_LERP_SPEED);
    controls.target.lerp(cameraFocusTarget, t);
    if (controls.target.distanceTo(cameraFocusTarget) < 0.005) {
      controls.target.copy(cameraFocusTarget);
      isCameraFocusing = false;
    }
  }

  // Smooth camera distance framing
  if (targetCameraDistance > 0 && !keyboardZoomState.in && !keyboardZoomState.out) {
    const currentDist = camera.position.distanceTo(controls.target);
    const distT = Math.min(1.0, deltaTime * 3.5);
    const newDist = THREE.MathUtils.lerp(currentDist, targetCameraDistance, distT);
    const dir = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, newDist);
    if (Math.abs(currentDist - targetCameraDistance) < 0.02) {
      targetCameraDistance = -1;
    }
  }

  controls.update();

  // Update selection marker orientation to face camera (billboard)
  // T02: Update Root Sight transition and cutaway state
  if (rootSightConfig) {
    updateRootSight(deltaTime);
  }

  // Update plant renderers
  if (plantRenderer) {
    // Update sun lighting from environment
    if (environmentRenderer) {
      plantRenderer.setSunLight(
        environmentRenderer.getSunDirection(),
        environmentRenderer.getSunColor(),
        environmentRenderer.getSunIntensity(),
      );
    }
    plantRenderer.update(deltaTime);
  }
  if (webgpuRenderer) {
    const allPlants: PlantNodeData[] = [...plantNodes.values()];
    for (const nodes of otherPlayerPlants.values()) allPlants.push(...nodes.values());
    webgpuRenderer.updatePlants(allPlants, performance.now());
    webgpuRenderer.update(deltaTime);
  }

  // C03: Update environment renderer (sky dome, fog, rain particles, lightning)
  if (environmentRenderer) {
    environmentRenderer.update(deltaTime);
  }

  // Client-side growth animation for Three.js SDF renderer
  // Animate growthProgress for nodes that are still growing
  if (plantRenderer && growingNodes.size > 0) {
    const now = performance.now();
    let hasGrowing = false;
    for (const [nodeId, growthInfo] of growingNodes.entries()) {
      const node = plantNodes.get(nodeId);
      if (!node) {
        growingNodes.delete(nodeId);
        continue;
      }
      const elapsed = now - growthInfo.startTime;
      const progress = Math.min(1.0, elapsed / growthInfo.duration);
      if (progress >= 1.0) {
        node.growthProgress = 1.0;
        growingNodes.delete(nodeId);
      } else {
        node.growthProgress = progress;
        hasGrowing = true;
      }
    }
    // Periodically update plant renderer with new growth progress
    if (hasGrowing && now - lastGrowthUpdateTime >= GROWTH_UPDATE_INTERVAL_MS) {
      const otherNodes: PlantNodeData[] = [];
      for (const nodes of otherPlayerPlants.values()) {
        otherNodes.push(...nodes.values());
      }
      const allNodes = [...plantNodes.values(), ...otherNodes];
      plantRenderer.updatePlantData(allNodes);
      lastGrowthUpdateTime = now;
    }
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
    const gpuTriangles = webgpuRenderer ? Math.floor(webgpuRenderer.getIndexCount() / 3) : 0;
    debugOverlay.update({
      triangles: info.triangles + gpuTriangles,
      drawCalls: info.calls + (useWebGPU ? 2 : 0),
    });
  }

  if (useWebGPU && webgpuRenderer) {
    // 1. Clear and render environment (sky, fog, rain)
    renderer.clear();
    renderer.render(scene, camera);
    // 2. WebGPU renders plants (clears to transparent alpha)
    webgpuRenderer.render();
  } else {
    renderer.clear();
    renderer.render(scene, camera);
  }
}

function animate(): void {
  requestAnimationFrame(animate);

  const now = performance.now();
  const deltaTime = Math.min(0.25, (now - lastUpdateTime) / 1000);
  lastUpdateTime = now;
  if (deltaTime > 0) measuredFps = 1 / deltaTime;

  renderFrame(deltaTime);
}

// Start
await initC01();
connect();

// Ping every 5 seconds
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: MESSAGE_TYPE.PING, payload: {} }));
  }
}, 5000);

// Request resource tile for own plant every 10 seconds
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const ownRootNode = Array.from(plantNodes.values()).find((n) => n.parentId === null);
    if (ownRootNode) {
      ws.send(
        JSON.stringify({
          type: MESSAGE_TYPE.RESOURCE_QUERY,
          payload: { worldX: ownRootNode.position.x, worldZ: ownRootNode.position.z },
        }),
      );
    } else if (welcome?.rootNode) {
      ws.send(
        JSON.stringify({
          type: MESSAGE_TYPE.RESOURCE_QUERY,
          payload: { worldX: welcome.rootNode.x, worldZ: welcome.rootNode.z },
        }),
      );
    }
  }
}, 10000);

animate();

interface PlantLegacyDebugHandle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  plantNodes: typeof plantNodes;
  readonly plantRenderer: PlantRenderer | null;
  readonly webgpuRenderer: WebGPURenderer | null;
  readonly plantEnergy: number;
  readonly plantBiomass: number;
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
    get webgpuRenderer() {
      return webgpuRenderer;
    },
    get plantEnergy() {
      return plantEnergy;
    },
    get plantBiomass() {
      return plantBiomass;
    },
  };
}
