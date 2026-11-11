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

import RAPIER from '@dimforge/rapier3d-compat';
import { createInputBus, type InputBus } from '@plant-legacy/input';
import {
  clampGrowthDirectionByGene,
  NODE_GROWTH_CONSTRAINTS,
  type NodeType,
} from '@plant-legacy/shared/growth';
import { nodeTypeToPhysicsShape } from '@plant-legacy/shared/physics';
import { PROTOCOL_VERSION } from '@plant-legacy/shared/protocol';
import { validateMessage } from '@plant-legacy/shared/protocol/messageSchemas';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  type ControlsConfig,
  loadControlsConfig,
  loadRenderConfig,
  loadRootSightConfig,
  loadUIConfig,
  type RenderConfig,
  type RootSightConfig,
} from './config/clientConfig.js';
import { loadPlantRendererConfig } from './config/plantRendererConfig.js';
import { plantPhysicsSync, rapierWorld } from './physics/RapierPhysicsManager.js';
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

// Use the meta tag if present (production/staging deployment sets it).
// In local dev the Vite server proxies /config, /ws, /health → :8080, so we
// use the same origin as the page (empty string = relative URLs) rather than
// pointing directly at :8080, which breaks when the browser is on a different
// port or the server hasn't started yet.
const isLocalDev =
  !serverOrigin &&
  (location.hostname === '127.0.0.1' || location.hostname === 'localhost') &&
  location.port !== '8080'; // already on the game server port — no proxy needed

const httpOrigin = serverOrigin || (isLocalDev ? '' : location.origin);

// WebSocket: in local dev, go through the Vite proxy (/ws path on same port).
// The proxy config in vite.config.ts forwards ws://localhost:4173/ws → ws://127.0.0.1:8080/ws.
const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsOrigin = serverOrigin
  ? serverOrigin.replace(/^http/, 'ws')
  : isLocalDev
    ? `${wsProtocol}//${location.hostname}:${location.port}`
    : `${wsProtocol}//${location.host}`;

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
    'WASD/Arrows: Pan camera  |  Left/Middle-drag: Orbit  |  Right-drag/1-finger: Pan  |  Scroll: Zoom',
    'Left-click: Select (Normal: focus, Grow: options)  |  G: Grow Mode  |  R: Root Sight  |  E: Emotes  |  I: Inventory',
    'You are a plant. Grow roots down, canopy up. Read light, water, minerals.',
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
    // Server-authoritative fields for client sync
    radius?: number;
    growthTimeSeconds?: number;
    growthStartTick?: number;
    parentAttachX?: number;
    parentAttachY?: number;
    parentAttachZ?: number;
    // Server-authoritative target position for connected growth rendering
    targetX?: number;
    targetY?: number;
    targetZ?: number;
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
  // Server-authoritative growth timing for client sync
  radius?: number;
  growthTimeSeconds?: number;
  growthStartTick?: number;
  // Server-authoritative parent attachment position for client sync
  parentAttachX?: number;
  parentAttachY?: number;
  parentAttachZ?: number;
  // Server-authoritative target position where a growing node ends up
  targetX?: number;
  targetY?: number;
  targetZ?: number;
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
  DEV_ACTION: 8,
  CHAT_MESSAGE: 9,
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
  CHAT_BROADCAST: 23,
  DEV_RESPONSE: 99,
} as const;

let ws: WebSocket | null = null;
let playerId: string | null = null;
let serverTick = 0;

// Per-node-type emergence delay (ms) for staggered growth animation.
// Roots/radicles emerge first, then stems, then leaves/cotyledons.
const EMERGENCE_DELAY_MS: Record<string, number> = {
  radicle: 0,
  root: 0,
  lateral_root: 80,
  seed: 0,
  stem: 40,
  branch: 40,
  cotyledon: 160,
  leaf: 200,
  flower: 240,
  spore_sac: 240,
};

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

// Controls config loaded from server /config/controls endpoint.
// Loaded initially in initC01() before WebSocket connects; reloaded on WELCOME
// so bindings are available even if the server wasn't ready on first fetch.
let controlsConfig: ControlsConfig | null = null;

// Track which plants have Root Sight already enabled, to avoid resetting
// the state machine (and flickering aura circles) on every new underground node.
const rootSightActivePlants = new Set<string>();
let storedWater = 0;
let storedMinerals = 0;
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

// Smoothed growth direction dragging state (silky smooth, non-rigid)
const smoothedGrowthDir = new THREE.Vector3(0, -1, 0);
let smoothedGrowthDist = 1.0;
let isGrowthAtMaxReach = false;
let isGrowthAngleClamped = false;

// Visual preview: draw the gene-constrained 3D growth vector, reach guide, and legible constraints HUD.
function updateGrowthDirectionLine(
  _start: { x: number; y: number; z: number },
  _end: { x: number; y: number; z: number },
  isValid: boolean,
): void {
  ensureGrowthDirectionOverlay();
  if (!growthDirectionOverlay || !growthDirectionOverlayCtx) return;
  const drawingData = growthSelectionStateMachineGetDrawingData(growthSelectionMachine);
  const nodeType = drawingData?.selectedOptionType ?? 'radicle';
  const constraints = NODE_GROWTH_CONSTRAINTS[nodeType as NodeType] ?? NODE_GROWTH_CONSTRAINTS.stem;

  const reach = Math.max(0.35, Math.min(smoothedGrowthDist, constraints.maxReach));
  const endPos = {
    x: _start.x + smoothedGrowthDir.x * reach,
    y: _start.y + smoothedGrowthDir.y * reach,
    z: _start.z + smoothedGrowthDir.z * reach,
  };

  const w = window.innerWidth;
  const h = window.innerHeight;
  if (growthDirectionOverlay.width !== w) growthDirectionOverlay.width = w;
  if (growthDirectionOverlay.height !== h) growthDirectionOverlay.height = h;
  const ctx = growthDirectionOverlayCtx;
  ctx.clearRect(0, 0, w, h);

  // Project start node to screen
  const vStart = new THREE.Vector3(_start.x, _start.y, _start.z).project(camera);
  if (vStart.z > 1 || vStart.z < -1) return;
  const sx = (vStart.x * 0.5 + 0.5) * w;
  const sy = (-vStart.y * 0.5 + 0.5) * h;

  // Project end tip to screen
  const vEnd = new THREE.Vector3(endPos.x, endPos.y, endPos.z).project(camera);
  if (vEnd.z > 1 || vEnd.z < -1) return;
  const ex = (vEnd.x * 0.5 + 0.5) * w;
  const ey = (-vEnd.y * 0.5 + 0.5) * h;

  ctx.save();

  // 1. Draw Allowed Growth Sector / Cone Guide (Gene angle & reach boundary)
  const guidePts: { x: number; y: number }[] = [];
  const sampleAngles = 16;
  const midY = (constraints.minY + constraints.maxY) * 0.5;
  const maxR = constraints.maxReach;
  const horizRadius = Math.sqrt(Math.max(0.01, 1 - midY * midY)) * maxR;

  for (let i = 0; i <= sampleAngles; i++) {
    const theta = (i / sampleAngles) * Math.PI * 2;
    const gx = _start.x + Math.cos(theta) * horizRadius;
    const gy = _start.y + midY * maxR;
    const gz = _start.z + Math.sin(theta) * horizRadius;
    const vp = new THREE.Vector3(gx, gy, gz).project(camera);
    if (vp.z <= 1 && vp.z >= -1) {
      guidePts.push({ x: (vp.x * 0.5 + 0.5) * w, y: (-vp.y * 0.5 + 0.5) * h });
    }
  }

  if (guidePts.length >= 3) {
    ctx.beginPath();
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = 'rgba(129, 199, 132, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.moveTo(guidePts[0].x, guidePts[0].y);
    for (let i = 1; i < guidePts.length; i++) {
      ctx.lineTo(guidePts[i].x, guidePts[i].y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 2. Draw Trajectory Vector Line with gradient and glow
  const isClamped = isGrowthAtMaxReach || isGrowthAngleClamped;
  const strokeColor = !isValid ? '#f44336' : isClamped ? '#ffb74d' : '#4caf50';
  const glowColor = !isValid
    ? 'rgba(244, 67, 54, 0.4)'
    : isClamped
      ? 'rgba(255, 183, 77, 0.4)'
      : 'rgba(76, 175, 80, 0.4)';

  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 10;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // 3. Arrowhead at tip
  const dx = ex - sx;
  const dy = ey - sy;
  const angle = Math.atan2(dy, dx);
  const headLen = 14;
  ctx.fillStyle = strokeColor;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(
    ex - headLen * Math.cos(angle - Math.PI / 7),
    ey - headLen * Math.sin(angle - Math.PI / 7),
  );
  ctx.lineTo(
    ex - headLen * Math.cos(angle + Math.PI / 7),
    ey - headLen * Math.sin(angle + Math.PI / 7),
  );
  ctx.closePath();
  ctx.fill();

  // 4. Ghost Bud Preview at tip (concentric glowing circles)
  ctx.beginPath();
  ctx.arc(ex, ey, 9, 0, Math.PI * 2);
  ctx.fillStyle = isClamped ? 'rgba(255, 183, 77, 0.25)' : 'rgba(129, 199, 132, 0.25)';
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(ex, ey, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // 5. Origin Marker at node
  ctx.beginPath();
  ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2;
  ctx.stroke();

  // 6. Legible Status Badge / Constraints Tooltip
  const label = drawingData?.selectedOptionLabel ?? nodeType;
  let badgeText = `${label} • ${reach.toFixed(2)}m`;
  if (isGrowthAtMaxReach) {
    badgeText = `${label} • ${reach.toFixed(2)}m (Max Reach)`;
  } else if (isGrowthAngleClamped) {
    badgeText = `${label} • ${reach.toFixed(2)}m (Gene Angle Clamped)`;
  }

  ctx.font = '600 12px system-ui, -apple-system, sans-serif';
  const textMetrics = ctx.measureText(badgeText);
  const badgeW = textMetrics.width + 16;
  const badgeH = 24;
  const badgeX = Math.min(w - badgeW - 12, Math.max(12, ex + 14));
  const badgeY = Math.min(h - badgeH - 12, Math.max(12, ey - 28));

  // Badge background
  ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 12);
  ctx.fill();
  ctx.stroke();

  // Badge text
  ctx.fillStyle = isClamped ? '#ffe0b2' : '#e8f5e9';
  ctx.textBaseline = 'middle';
  ctx.fillText(badgeText, badgeX + 8, badgeY + badgeH / 2);

  ctx.restore();
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

  // Allow camera to go below the horizon for underground nodes,
  // but do NOT auto-enable Root Sight — that is a manual player toggle (R key).
  if (nodePos.y < -0.05 || nodeData.layer === 'root' || nodeData.type === 0) {
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
// Growth animation tracking for other players' plants (nodeId -> {plantId, startTime, duration})
const otherGrowingNodes = new Map<
  string,
  { plantId: string; startTime: number; duration: number }
>();
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

// WASD / arrows move the camera and its orbit target together.
// W/ArrowUp   → camera UP   (+Y world axis)
// S/ArrowDown → camera DOWN (-Y world axis)
// A/ArrowLeft → pan left  (screen-right Ã— camera-up cross product)
// D/ArrowRight → pan right
// Nothing on the plant moves (ADR-022).
function applyCameraPan(deltaTime: number): void {
  const speed = renderConfig?.cameraPanSpeed ?? 0;
  if (speed <= 0) return;

  let x = 0; // left / right pan
  let y = 0; // up / down (W/S, ArrowUp/Down)
  if (cameraPanState.forward) y += 1; // W / ArrowUp   → camera UP
  if (cameraPanState.backward) y -= 1; // S / ArrowDown → camera DOWN
  if (cameraPanState.left) x -= 1;
  if (cameraPanState.right) x += 1;
  if (x === 0 && y === 0) return;

  const right = new THREE.Vector3()
    .crossVectors(camera.getWorldDirection(new THREE.Vector3()), camera.up)
    .normalize();

  const move = new THREE.Vector3()
    .addScaledVector(right, x)
    .addScaledVector(new THREE.Vector3(0, 1, 0), y)
    .normalize()
    .multiplyScalar(speed * deltaTime);

  // Move both target and camera.position together so panning works even when
  // controls.enabled = false (e.g. while the growth panel is open or drawing).
  // OrbitControls.update() will keep the spherical offset intact.
  controls.target.add(move);
  camera.position.add(move);
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

// T02: Root Sight toggle and transition.
// Root Sight is a silent, player-controlled view mode (R key).
// It activates the soil cutaway shader and allows underground polar angles.
// It does NOT move the camera — the player keeps control at all times.
function setRootSightEnabled(enabled: boolean, plantId?: string): void {
  if (!rootSightMachine) return;

  if (enabled) {
    // Drive the state machine toward underground whenever enabling.
    // plantId tracking is used only to coordinate multi-plant deactivation.
    if (plantId) rootSightActivePlants.add(plantId);
    rootSightStateMachineSetTarget(rootSightMachine, 'underground');
  } else {
    if (plantId) rootSightActivePlants.delete(plantId);
    // Only drive to surface if no plant still needs Root Sight active,
    // OR if called without a plantId (explicit global disable, e.g. disconnect).
    if (!plantId || rootSightActivePlants.size === 0) {
      rootSightStateMachineSetTarget(rootSightMachine, 'surface');
    }
  }

  // Adjust polar angle limits so underground nodes are reachable, but do NOT
  // move the camera — the player orbits freely at all times.
  if (enabled) {
    controls.maxPolarAngle = Math.PI - 0.05;
  } else {
    controls.maxPolarAngle = renderConfig?.cameraMaxPolarAngle ?? Math.PI / 2 - 0.05;
  }

  const isEnabled = rootSightStateMachineIsEnabled(rootSightMachine);
  setDetail(
    isEnabled ? 'Root Sight: ON — Underground view active' : 'Root Sight: OFF — Surface view',
  );
}

function toggleRootSight(): void {
  if (!rootSightMachine) return;
  rootSightStateMachineToggle(rootSightMachine);
  const isEnabled = rootSightStateMachineIsEnabled(rootSightMachine);

  // Adjust polar angle limits silently — no camera movement.
  if (isEnabled) {
    controls.maxPolarAngle = Math.PI - 0.05;
  } else {
    controls.maxPolarAngle = renderConfig?.cameraMaxPolarAngle ?? Math.PI / 2 - 0.05;
  }

  setDetail(
    isEnabled ? 'Root Sight: ON — Underground view active' : 'Root Sight: OFF — Surface view',
  );
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
  if (isEnabled && eased > 0.01) {
    const allNodes = Array.from(plantNodes.values());
    webgpuRenderer?.updateRootAura(allNodes);
  }
}

async function initC01(): Promise<void> {
  // Load C01 configs
  const [loadedRenderConfig, loadedControlsConfig, uiConfig, loadedRootSightConfig] =
    await Promise.all([
      loadRenderConfig(httpOrigin),
      loadControlsConfig(httpOrigin),
      loadUIConfig(httpOrigin),
      loadRootSightConfig(httpOrigin),
    ]);

  renderConfig = loadedRenderConfig;
  controlsConfig = loadedControlsConfig;
  rootSightConfig = loadedRootSightConfig;
  rootSightMachine = createRootSightStateMachine(rootSightConfig);

  // Build input bus
  inputBus = createInputBus({ bindings: controlsConfig.bindings });

  // Build UI shell
  uiShell = createUIShell(uiConfig);
  chatHudZIndex = uiConfig?.layers?.hud ?? 100;

  // Create HUD elements early so they're ready when WELCOME arrives
  createResourceReadout();
  createGrowthSelectionUI();
  createChatUI();

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
            ws.send(
              JSON.stringify({
                type: MESSAGE_TYPE.DEV_ACTION,
                payload: { type: 'dev_regenerate_plant' },
              }),
            );
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

  // Debug overlay toggle (Shift) - works regardless of dev mode
  inputBus.subscribe(
    (actionId, inputState: { pressed: boolean; toggled?: boolean; active?: boolean }) => {
      if (actionId === 'debug_toggle' && (inputState.pressed || inputState.toggled)) {
        if (debugOverlay) debugOverlay.setVisible(!debugOverlay.isVisible());
      }
    },
  );

  // Dev panel toggle (backtick `) - only available in dev mode
  inputBus.subscribe(
    (actionId, inputState: { pressed: boolean; toggled?: boolean; active?: boolean }) => {
      if (actionId === 'dev_panel_toggle' && (inputState.pressed || inputState.toggled)) {
        if (devPanel) devPanel.toggle();
      }
    },
  );

  // Grow mode state
  let isGrowMode = false;
  let growModeIndicator: HTMLDivElement | null = null;

  function createGrowModeIndicator(): void {
    const indicator = document.createElement('div');
    indicator.id = 'grow-mode-indicator';
    indicator.style.cssText = `
      position: fixed;
      top: 90px;
      left: 16px;
      z-index: 1000;
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      font-size: calc(13px * var(--text-scale));
      font-weight: 600;
      color: var(--leaf-400);
      background: rgba(20, 24, 15, 0.85);
      border: 1px solid var(--bark-700);
      border-radius: 4px;
      padding: 6px 12px;
      pointer-events: none;
      transition: opacity 0.2s ease;
    `;
    indicator.textContent = 'Mode: Normal (G to toggle)';
    document.body.appendChild(indicator);
    growModeIndicator = indicator;
  }

  // Create grow mode indicator
  createGrowModeIndicator();

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

  // Initialize Rapier physics world (client-side cosmetic simulation)
  try {
    await rapierWorld.init({ x: 0, y: -9.81, z: 0 });
    physicsReady = true;
    setDetail('Physics initialized');
  } catch (err) {
    console.error('[PlantLegacy] Failed to initialize Rapier physics:', err);
    physicsReady = false;
    setDetail('Physics unavailable');
  }

  // Grow mode functions
  function updateGrowModeIndicator(): void {
    if (growModeIndicator) {
      growModeIndicator.textContent = isGrowMode
        ? 'Mode: GROW (G to toggle)'
        : 'Mode: Normal (G to toggle)';
      growModeIndicator.style.color = isGrowMode ? 'var(--ember-500)' : 'var(--leaf-400)';
      growModeIndicator.style.borderColor = isGrowMode ? 'var(--ember-500)' : 'var(--bark-700)';
    }
  }

  function setGrowMode(enabled: boolean): void {
    isGrowMode = enabled;
    updateGrowModeIndicator();
    if (enabled) {
      setDetail('Grow Mode ON — Click a node to grow');
      uiShell?.toast({ message: 'Grow Mode enabled', kind: 'info', durationMs: 2000 });
    } else {
      setDetail('Grow Mode OFF — Click a node to focus');
      uiShell?.toast({ message: 'Grow Mode disabled', kind: 'info', durationMs: 2000 });
      hideGrowthSelection();
    }
  }

  function toggleGrowMode(): void {
    setGrowMode(!isGrowMode);
  }

  // Inventory/Overview panel stub
  let inventoryOverviewPanel: HTMLDivElement | null = null;

  function createInventoryOverviewPanel(): void {
    const layer = uiShell?.getLayer('panel');
    if (!layer) return;

    const panel = document.createElement('div');
    panel.id = 'inventory-overview-panel';
    panel.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 200;
      background: rgba(20, 24, 15, 0.98);
      border: 1px solid var(--bark-700);
      border-radius: 8px;
      padding: 16px 24px;
      color: var(--bone-100);
      font-family: ui-monospace, "JetBrains Mono", monospace;
      font-size: calc(13px * var(--text-scale));
      min-width: 360px;
      max-width: 500px;
      max-height: 70vh;
      overflow-y: auto;
      pointer-events: auto;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6);
      display: none;
    `;

    panel.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--bark-700);">
        <h2 style="margin: 0; color: var(--leaf-400);">Inventory & Plant Overview</h2>
        <button id="inventory-close" style="background: none; border: none; color: var(--bark-300); cursor: pointer; font-size: 1.5em; line-height: 1;">Ã—</button>
      </div>
      <div id="plant-overview" style="margin-bottom: 16px;">
        <h3 style="margin: 0 0 8px; color: var(--sprout-300);">Your Plant</h3>
        <div id="plant-stats" style="font-size: 0.9em; color: var(--bark-300);">Loading...</div>
      </div>
      <div id="inventory-slots">
        <h3 style="margin: 0 0 8px; color: var(--sprout-300);">Inventory (1-0 to select)</h3>
        <div id="inventory-grid" style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px;"></div>
      </div>
    `;

    layer.appendChild(panel);
    inventoryOverviewPanel = panel;

    panel.querySelector('#inventory-close')?.addEventListener('click', () => {
      toggleInventoryOverview();
    });

    // Close on Escape
    const handleInventoryEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && inventoryOverviewPanel?.style.display !== 'none') {
        toggleInventoryOverview();
        window.removeEventListener('keydown', handleInventoryEscape);
      }
    };
    window.addEventListener('keydown', handleInventoryEscape);

    // Prevent clicks inside panel from bubbling
    panel.addEventListener('click', (e) => e.stopPropagation());
  }

  function toggleInventoryOverview(): void {
    if (!inventoryOverviewPanel) {
      createInventoryOverviewPanel();
    }
    if (!inventoryOverviewPanel) return;
    const isOpen = inventoryOverviewPanel.style.display !== 'none';
    inventoryOverviewPanel.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
      updateInventoryOverview();
    }
  }

  function updateInventoryOverview(): void {
    if (!inventoryOverviewPanel) return;

    // Update plant stats
    const plantStats = document.getElementById('plant-stats');
    if (plantStats && plantId) {
      const ownNodes = Array.from(plantNodes.values()).filter((n) => n.isOwnPlant);
      const totalBiomass = ownNodes.reduce((sum, n) => sum + (n.biomass || 0), 0);
      const nodeCount = ownNodes.length;
      const rootNodes = ownNodes.filter((n) => n.layer === 'root' || n.type === 0).length;
      const canopyNodes = ownNodes.filter((n) => n.layer === 'canopy' || n.type >= 1).length;
      plantStats.innerHTML = `
        <div>Plant ID: ${plantId.slice(0, 12)}...</div>
        <div>Total Biomass: ${totalBiomass.toFixed(1)}</div>
        <div>Nodes: ${nodeCount} (Roots: ${rootNodes}, Canopy: ${canopyNodes})</div>
        <div>Energy: ${plantEnergy.toFixed(1)} / ${plantBiomass ? (plantBiomass * 10).toFixed(0) : '—'}</div>
        <div>Light: ${tileLight.toFixed(0)} | Water: ${tileWater.toFixed(0)} | Minerals: ${tileMinerals.toFixed(0)}</div>
        <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--bark-700); color: var(--sprout-300);">
          Growth: ${isGrowMode ? 'ACTIVE' : 'Idle'} | Root Sight: ${rootSightMachine && rootSightStateMachineIsEnabled(rootSightMachine) ? 'ON' : 'OFF'}
        </div>
      `;
    }

    // Update inventory grid (stub - 10 slots)
    const inventoryGrid = document.getElementById('inventory-grid');
    if (inventoryGrid) {
      inventoryGrid.innerHTML = '';
      for (let i = 1; i <= 10; i++) {
        const slot = document.createElement('div');
        slot.style.cssText = `
          aspect-ratio: 1;
          background: var(--bark-800);
          border: 1px solid var(--bark-600);
          border-radius: 4px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          font-size: 0.75em;
          color: var(--bark-300);
          position: relative;
          transition: border-color 0.1s ease, background 0.1s ease;
        `;
        const keyLabel = i === 10 ? '0' : String(i);
        slot.innerHTML = `
          <div style="position: absolute; top: 2px; left: 4px; font-size: 0.65em; font-weight: bold; color: var(--bone-300); opacity: 0.7;">${keyLabel}</div>
          <div style="font-size: 2em; line-height: 1;">ðŸ“¦</div>
          <div style="margin-top: 4px; font-size: 0.7em;">Empty</div>
        `;
        // Highlight on hover
        slot.addEventListener('mouseenter', () => {
          slot.style.borderColor = 'var(--leaf-400)';
          slot.style.background = 'rgba(20, 24, 15, 0.95)';
        });
        slot.addEventListener('mouseleave', () => {
          slot.style.borderColor = 'var(--bark-600)';
          slot.style.background = 'var(--bark-800)';
        });
        inventoryGrid.appendChild(slot);
      }
    }
  }

  // Emote definitions
  const EMOTES = [
    { id: 'wave', label: 'Wave', emoji: 'ðŸ‘‹' },
    { id: 'cheer', label: 'Cheer', emoji: 'ðŸŽ‰' },
    { id: 'thumbs_up', label: 'Thumbs Up', emoji: 'ðŸ‘' },
    { id: 'heart', label: 'Heart', emoji: 'â¤ï¸' },
    { id: 'think', label: 'Think', emoji: 'ðŸ¤”' },
    { id: 'sleep', label: 'Sleep', emoji: 'ðŸ˜´' },
    { id: 'dance', label: 'Dance', emoji: 'ðŸ’ƒ' },
    { id: 'sad', label: 'Sad', emoji: 'ðŸ˜¢' },
  ] as const;

  let emoteWheelElement: HTMLDivElement | null = null;

  function createEmoteWheel(): void {
    const wheel = document.createElement('div');
    wheel.id = 'emote-wheel';
    wheel.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0.8);
      z-index: 400;
      pointer-events: auto;
      opacity: 0;
      transition: opacity 0.15s ease, transform 0.15s ease;
      display: none;
    `;

    const radius = 120;
    const centerSize = 80;
    const buttonSize = 64;

    // Center close button
    const center = document.createElement('div');
    center.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: ${centerSize}px;
      height: ${centerSize}px;
      border-radius: 50%;
      background: rgba(20, 24, 15, 0.95);
      border: 2px solid var(--bark-700);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.5em;
      color: var(--bone-100);
      cursor: pointer;
      z-index: 10;
      box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    `;
    center.textContent = 'âœ•';
    center.title = 'Close (Esc or click away)';
    center.addEventListener('click', hideEmoteWheel);
    wheel.appendChild(center);

    // Emote buttons in a circle
    EMOTES.forEach((emote, index) => {
      const angle = (index / EMOTES.length) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;

      const btn = document.createElement('button');
      btn.dataset.emoteId = emote.id;
      btn.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) translate(${x}px, ${y}px);
        width: ${buttonSize}px;
        height: ${buttonSize}px;
        border-radius: 50%;
        background: rgba(20, 24, 15, 0.95);
        border: 2px solid var(--bark-700);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        font-size: 1.8em;
        color: var(--bone-100);
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        transition: transform 0.1s ease, border-color 0.1s ease, background 0.1s ease;
        padding: 0;
        gap: 2px;
      `;
      btn.innerHTML = `
        <span>${emote.emoji}</span>
        <span style="font-size: 0.5em; font-weight: 600; text-transform: capitalize;">${emote.label}</span>
      `;

      btn.addEventListener('mouseenter', () => {
        btn.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(1.15)`;
        btn.style.borderColor = 'var(--leaf-400)';
        btn.style.background = 'rgba(20, 24, 15, 0.98)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(1)`;
        btn.style.borderColor = 'var(--bark-700)';
        btn.style.background = 'rgba(20, 24, 15, 0.95)';
      });
      btn.addEventListener('click', () => {
        sendEmote(emote.id);
        hideEmoteWheel();
      });

      wheel.appendChild(btn);
    });

    // Click outside to close
    wheel.addEventListener('click', (e) => {
      if (e.target === wheel) hideEmoteWheel();
    });

    document.body.appendChild(wheel);
    emoteWheelElement = wheel;
  }

  function showEmoteWheel(): void {
    if (!emoteWheelElement) createEmoteWheel();
    const wheel = emoteWheelElement;
    if (!wheel) return;

    wheel.style.display = 'block';
    requestAnimationFrame(() => {
      wheel.style.opacity = '1';
      wheel.style.transform = 'translate(-50%, -50%) scale(1)';
    });

    // Close on Escape
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        hideEmoteWheel();
        window.removeEventListener('keydown', handleEscape);
      }
    };
    window.addEventListener('keydown', handleEscape);
  }

  function hideEmoteWheel(): void {
    if (!emoteWheelElement) return;
    emoteWheelElement.style.opacity = '0';
    emoteWheelElement.style.transform = 'translate(-50%, -50%) scale(0.8)';
    setTimeout(() => {
      if (emoteWheelElement) emoteWheelElement.style.display = 'none';
    }, 150);
  }

  function sendEmote(emoteId: string): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        type: MESSAGE_TYPE.CHAT_MESSAGE,
        payload: { message: `/emote ${emoteId}` },
      }),
    );
    console.log('[PlantLegacy] Sent emote:', emoteId);
  }

  // Input handlers
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
        if (plantRenderer) {
          const testNodes = plantRenderer.generateTestPlant();
          plantRenderer.rebuild();
          plantRenderer.updatePlantData(testNodes);
          if (webgpuRenderer) webgpuRenderer.updatePlants(testNodes, performance.now());
          controls.target.set(0, 0, 0);
          camera.position.set(0, 20, 30);
          controls.update();
          setDetail(
            `Generated test plant at origin (${testNodes.length} nodes). Orbit camera to inspect.`,
          );
        }
      }
      if (actionId === 'root_sight_toggle' && rootSightMachine) {
        if (typeof state.active === 'boolean') {
          setRootSightEnabled(state.active);
        } else if (state.pressed || state.toggled) {
          toggleRootSight();
        }
      }
      if (actionId === 'hint_card_toggle' && (state.pressed || state.toggled)) {
        toggleHintCard();
      }
      if (actionId === 'grow_mode_toggle' && (state.pressed || state.toggled)) {
        toggleGrowMode();
      }
      if (actionId === 'inventory_overview_toggle' && (state.pressed || state.toggled)) {
        toggleInventoryOverview();
      }
      if (actionId === 'emote_wheel' && state.pressed) {
        showEmoteWheel();
      }
      // Inventory slot selection (1-0)
      if (actionId.startsWith('inventory_slot_') && state.pressed) {
        const slotNum = parseInt(actionId.replace('inventory_slot_', ''), 10);
        if (!Number.isNaN(slotNum)) {
          console.log(`[PlantLegacy] Inventory slot ${slotNum} selected`);
          uiShell?.toast({
            message: `Slot ${slotNum} selected (inventory UI not yet implemented)`,
            kind: 'info',
            durationMs: 1500,
          });
        }
      }
    },
  );

  // Keyboard producer
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      if (e.code === 'Enter')
        inputBus?.handleKeyDown(e.code, {
          shift: e.shiftKey,
          ctrl: e.ctrlKey,
          alt: e.altKey,
          meta: e.metaKey,
        });
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

    // Don't prevent default for browser shortcuts (Ctrl/Alt/Meta combos)
    // Shift alone is allowed for debug_toggle
    if (e.ctrlKey || e.altKey || e.metaKey) {
      inputBus?.handleKeyDown(e.code, {
        shift: e.shiftKey,
        ctrl: e.ctrlKey,
        alt: e.altKey,
        meta: e.metaKey,
      });
      return;
    }
    inputBus?.handleKeyDown(e.code, {
      shift: e.shiftKey,
      ctrl: e.ctrlKey,
      alt: e.altKey,
      meta: e.metaKey,
    });
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

    // Don't prevent default for browser shortcuts (Ctrl/Alt/Meta combos)
    // Shift alone is allowed for debug_toggle
    if (e.ctrlKey || e.altKey || e.metaKey) {
      inputBus?.handleKeyUp(e.code, {
        shift: e.shiftKey,
        ctrl: e.ctrlKey,
        alt: e.altKey,
        meta: e.metaKey,
      });
      return;
    }
    inputBus?.handleKeyUp(e.code, {
      shift: e.shiftKey,
      ctrl: e.ctrlKey,
      alt: e.altKey,
      meta: e.metaKey,
    });
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

    const initConstraints =
      NODE_GROWTH_CONSTRAINTS[optionType as NodeType] ?? NODE_GROWTH_CONSTRAINTS.stem;
    const initialClamped = clampGrowthDirectionByGene(
      optionType,
      initConstraints.downwardPreferred ? { x: 0, y: -1, z: 0 } : { x: 0.05, y: 0.998, z: 0.05 },
    );
    smoothedGrowthDir.set(initialClamped.x, initialClamped.y, initialClamped.z);
    smoothedGrowthDist = Math.min(1.0, initConstraints.maxReach * 0.7);
    isGrowthAtMaxReach = false;
    isGrowthAngleClamped = false;

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
    if (gState === 'option_selected') {
      // Clicking on canvas while an option is selected cancels growth and re-enables controls
      hideGrowthSelection();
      return;
    }
    if (gState === 'drawing') return;

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
      console.log('[Click] option_selected state, starting drawing for node:', clickedNodeId);
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
      // Single-click does NOT zoom into the node — double-click (dblclick) handles zooming.
      // Only request growth options in Grow Mode
      if (isGrowMode) {
        requestGrowthOptions(clickedNodeId);
      }
    }
  });

  // Double-click on a node zooms in (focusCameraOnNode). Single click only opens growth options.
  canvas.addEventListener('dblclick', (e) => {
    if (e.button !== 0) return;
    if (growthSelectionStateMachineGetState(growthSelectionMachine) === 'drawing') return;
    if (
      e.target instanceof HTMLElement &&
      e.target.closest(
        'button, input, select, textarea, [role="dialog"], #growth-selection-panel, #resource-readout, #hint-card',
      )
    )
      return;

    const rect = canvas.getBoundingClientRect();
    const dblMouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const dblRaycaster = new THREE.Raycaster();
    dblRaycaster.setFromCamera(dblMouse, camera);
    const dblObjects: THREE.Object3D[] = [];
    const dblMap = new Map<THREE.Object3D, string>();
    const isRSEnabled = rootSightMachine ? rootSightStateMachineIsEnabled(rootSightMachine) : false;
    const camBelowGround = camera.position.y < 0;
    for (const [id, nodeData] of plantNodes.entries()) {
      if (!nodeData.isOwnPlant) continue;
      if (nodeData.type === 0 && !nodeData.isSeed && !isRSEnabled && !camBelowGround) continue;
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(nodeData.radius * 1.5, 0.35), 8, 8),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      );
      sphere.position.copy(nodeData.position);
      sphere.updateMatrixWorld(true);
      dblObjects.push(sphere);
      dblMap.set(sphere, id);
    }
    const dblIntersects = dblRaycaster.intersectObjects(dblObjects);
    if (dblIntersects.length > 0) {
      const nodeId = dblMap.get(dblIntersects[0].object);
      if (nodeId) {
        const nodeData = plantNodes.get(nodeId);
        if (nodeData) focusCameraOnNode(nodeData);
      }
    }
  });

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
    const rawDist = Math.hypot(dx, dy, dz);

    const nodeType = drawingData.selectedOptionType;
    const constraints =
      NODE_GROWTH_CONSTRAINTS[nodeType as NodeType] ?? NODE_GROWTH_CONSTRAINTS.stem;

    let targetDir = { x: dx, y: dy, z: dz };
    if (rawDist > 0.05) {
      targetDir = { x: dx / rawDist, y: dy / rawDist, z: dz / rawDist };
    } else {
      targetDir = constraints.downwardPreferred
        ? { x: 0, y: -1, z: 0 }
        : { x: 0.05, y: 0.998, z: 0.05 };
    }

    const clamped = clampGrowthDirectionByGene(nodeType, targetDir);
    const targetDist = Math.max(0.35, Math.min(rawDist, constraints.maxReach));

    isGrowthAtMaxReach = rawDist >= constraints.maxReach - 0.05;
    isGrowthAngleClamped = Math.abs(clamped.y - targetDir.y) > 0.08;

    // Smooth exponential damping (alpha = 0.35) makes the 3D line silky smooth and responsive
    smoothedGrowthDir.lerp(new THREE.Vector3(clamped.x, clamped.y, clamped.z), 0.35).normalize();
    smoothedGrowthDist += (targetDist - smoothedGrowthDist) * 0.35;

    return {
      isValid: true,
      distance: smoothedGrowthDist,
      clampedDirection: { x: smoothedGrowthDir.x, y: smoothedGrowthDir.y, z: smoothedGrowthDir.z },
    };
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

    // Camera-facing drag plane through the node
    // Provides 1-to-1 linear screen drag without singularities or horizon jumps
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    const nodePos = new THREE.Vector3(
      drawingData.nodePosition.x,
      drawingData.nodePosition.y,
      drawingData.nodePosition.z,
    );
    const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      camDir.clone().negate(),
      nodePos,
    );
    const hit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(dragPlane, hit)) {
      return hit;
    }
    return nodePos.clone().add(camDir.multiplyScalar(2));
  };

  const handleGrowthDrawMove = (e: MouseEvent | PointerEvent) => {
    if (!growthSelectionStateMachineIsDrawing(growthSelectionMachine)) return;
    console.log('[GrowthDrawMove] drawing...');

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
    console.log(
      '[GrowthDrawEnd] state:',
      gState,
      'drawingData:',
      growthSelectionStateMachineGetDrawingData(growthSelectionMachine),
    );
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
    if (!result && drawingData) {
      const node = plantNodes.get(drawingData.nodeId);
      const t = drawingData.selectedOptionType;
      const dir = {
        x: smoothedGrowthDir.x,
        y: smoothedGrowthDir.y,
        z: smoothedGrowthDir.z,
      };
      if (node) {
        result = {
          nodeId: drawingData.nodeId,
          optionType: t,
          direction: dir,
          distance: smoothedGrowthDist,
        };
        console.log('[PlantLegacy] Using smoothed growth direction', {
          optionType: t,
          dir,
        });
      }
    }
    if (result) {
      // Send raw drawn direction; server is authoritative for clamping/validation
      const rawDirection = {
        x: smoothedGrowthDir.x,
        y: smoothedGrowthDir.y,
        z: smoothedGrowthDir.z,
      };
      confirmGrowth(result.nodeId, result.optionType, rawDirection);
      uiShell?.toast({
        message: `Sent ${result.optionType} growth...`,
        kind: 'info',
        durationMs: 1500,
      });
      console.log('[PlantLegacy] Growth drawing confirmed', {
        ...result,
        rawDirection: {
          x: smoothedGrowthDir.x,
          y: smoothedGrowthDir.y,
          z: smoothedGrowthDir.z,
        },
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

  // Toggle chat with T key (when not typing in input)
  window.addEventListener('keydown', (e) => {
    if (e.key === 't' || e.key === 'T') {
      const activeEl = document.activeElement;
      const isTyping =
        activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement;
      if (!isTyping && !growthSelectionStateMachineIsDrawing(growthSelectionMachine)) {
        e.preventDefault();
        toggleChat();
      }
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
          // Request full resource grid for ground rendering
          ws.send(
            JSON.stringify({
              type: MESSAGE_TYPE.RESOURCE_QUERY,
              payload: { fullGrid: true },
            }),
          );
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
    let canvasEl: HTMLCanvasElement | null = null;
    try {
      canvasEl = document.createElement('canvas');
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
          rainStreakLength: renderConfig.rainStreakLength,
          rainStreakWidth: renderConfig.rainStreakWidth,
          rainMaxVelocity: renderConfig.rainMaxVelocity,
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
      canvasEl?.remove();
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
    plantRenderer.setViewportSize(renderer.domElement.width, renderer.domElement.height);

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
  biomassEl.innerHTML = `<span style="color: var(--leaf-400);">ðŸŒ¿</span> Biomass: <span id="res-biomass">0</span>`;
  const energyEl = document.createElement('div');
  energyEl.innerHTML = `<span style="color: var(--gold-400);">âš¡</span> Energy: <span id="res-energy">0</span>`;
  const lightEl = document.createElement('div');
  lightEl.innerHTML = `<span style="color: var(--gold-400);">â˜€</span> Light: <span id="res-light">0</span>`;
  const waterEl = document.createElement('div');
  waterEl.innerHTML = `<span style="color: var(--water-400);">ðŸ’§</span> Water: <span id="res-water">0</span>`;
  const mineralsEl = document.createElement('div');
  mineralsEl.innerHTML = `<span style="color: var(--mineral-400);">â›</span> Minerals: <span id="res-minerals">0</span>`;

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
        ? `<div style="font-size: 0.8em; color: #e08a7a; margin-top: 4px;">âœ— ${opt.reason}</div>`
        : '';
    const riskHtml = opt.risk
      ? `<div style="font-size: 0.8em; color: #ffb26b; margin-top: 4px;">âš  ${opt.risk}</div>`
      : '';

    // Build requirements display - show both germination (tile) and growth (stored) requirements
    let requirementsHtml = '';
    if (result.conditions) {
      const c = result.conditions;
      // Germination requirements (tile-based)
      const lightStatus = c.light >= c.minLight ? 'âœ“' : 'âœ—';
      const moistureStatus = c.moisture >= c.minMoisture ? 'âœ“' : 'âœ—';

      // Growth requirements (stored-based) - only show for non-seed nodes
      let growthReqHtml = '';
      if (!result.isSeed && c.storedWater !== undefined && c.storedMinerals !== undefined) {
        const waterStatus =
          c.growthOk !== false && c.storedWater >= (c.growthMinWater ?? 0) ? 'âœ“' : 'âœ—';
        const mineralStatus =
          c.growthOk !== false && c.storedMinerals >= (c.growthMinMinerals ?? 0) ? 'âœ“' : 'âœ—';
        growthReqHtml = `
          <div>Growth: ${waterStatus} Stored Water ${c.storedWater.toFixed(1)}/${c.growthMinWater?.toFixed(1) ?? 0} | ${mineralStatus} Stored Minerals ${c.storedMinerals.toFixed(1)}/${c.growthMinMinerals?.toFixed(1) ?? 0}</div>`;
      }

      // Per-option resource costs
      const optionCostHtml =
        opt.waterCost !== undefined || opt.mineralCost !== undefined
          ? `<div>Cost: ${opt.waterCost?.toFixed(1) ?? 0} ðŸ’§ | ${opt.mineralCost?.toFixed(1) ?? 0} â›ï¸</div>`
          : '';

      requirementsHtml = `
        <div style="font-size: 0.75em; color: var(--bark-300); margin-top: 6px; padding: 6px; background: var(--bark-900); border-radius: 3px;">
          <div>Germination: ${lightStatus} Light ${c.light.toFixed(0)}/${c.minLight.toFixed(0)} | ${moistureStatus} Tile Water ${c.moisture.toFixed(0)}/${c.minMoisture.toFixed(0)}</div>
          ${growthReqHtml}
          ${optionCostHtml}
        </div>`;
    }

    // Detailed per-option info: upkeep, efficiency, photosynthesis, water/mineral
    const typeLower = opt.type.toLowerCase();
    const isLeafish = typeLower === 'leaf' || typeLower === 'cotyledon' || typeLower === 'vine';
    const isRootish =
      typeLower === 'radicle' || typeLower === 'root' || typeLower === 'lateral_root';
    const isStemish = typeLower === 'stem' || typeLower === 'branch';
    const isFlowerish = typeLower === 'flower' || typeLower === 'spore_sac';
    const biomassPerEnergy =
      opt.energyCost > 0 ? (opt.biomassGain / opt.energyCost).toFixed(2) : 'âˆž';

    // Estimated per-second upkeep (positive = consumes, negative = produces via photosynthesis)
    let upkeepEnergy = 0;
    let upkeepWater = 0;
    let upkeepMinerals = 0;
    let doesPhotosynthesize = false;
    let partDescription = '';

    if (isLeafish) {
      doesPhotosynthesize = true;
      if (typeLower === 'cotyledon') {
        upkeepEnergy = -0.8; // Cotyledons: strong early photosynthesis
        upkeepWater = 0.15;
        upkeepMinerals = 0.03;
        partDescription =
          'Cotyledon (seed leaf): initial photosynthetic organ, unfolds toward light.';
      } else if (typeLower === 'vine') {
        upkeepEnergy = -0.6;
        upkeepWater = 0.15;
        upkeepMinerals = 0.05;
        partDescription = 'Vine: flexible climbing stem with leaves.';
      } else {
        upkeepEnergy = -1.2; // Mature leaves: strong photosynthesis
        upkeepWater = 0.2;
        upkeepMinerals = 0.08;
        partDescription = 'Leaf: photosynthesizes sunlight into energy for the plant.';
      }
    } else if (isRootish) {
      if (typeLower === 'radicle') {
        upkeepEnergy = 0.05;
        upkeepWater = 0.5; // Radicle: absorbs lots of moisture early
        upkeepMinerals = 0.4;
        partDescription = 'Radicle: first root, anchors seed and absorbs moisture.';
      } else if (typeLower === 'lateral_root') {
        upkeepEnergy = 0.03;
        upkeepWater = 0.3;
        upkeepMinerals = 0.25;
        partDescription = 'Lateral root: branches from main root, increases absorption.';
      } else {
        upkeepEnergy = 0.08;
        upkeepWater = 0.4;
        upkeepMinerals = 0.35;
        partDescription = 'Root: absorbs water and minerals from soil, anchors plant.';
      }
    } else if (isStemish) {
      if (typeLower === 'stem') {
        upkeepEnergy = 0.1;
        upkeepWater = 0.05;
        upkeepMinerals = 0.03;
      } else {
        upkeepEnergy = 0.08;
        upkeepWater = 0.04;
        upkeepMinerals = 0.02;
      }
      partDescription =
        'Stem/Branch: structural support, transports nutrients between root and leaves.';
    } else if (isFlowerish) {
      if (typeLower === 'flower') {
        upkeepEnergy = 0.2;
        upkeepWater = 0.15;
        upkeepMinerals = 0.1;
        partDescription = 'Flower: reproductive organ, attracts pollinators.';
      } else {
        upkeepEnergy = 0.25;
        upkeepWater = 0.18;
        upkeepMinerals = 0.12;
        partDescription = 'Spore sac: reproductive organ, releases spores for dispersal.';
      }
    } else if (typeLower === 'seed') {
      partDescription = 'Seed: dormant embryonic plant, germinates when conditions are right.';
    }

    const upkeepEnergyHtml =
      upkeepEnergy !== 0
        ? `<div>Upkeep: ${upkeepEnergy > 0 ? '+' : ''}${upkeepEnergy.toFixed(2)} âš¡/s | ${upkeepWater > 0 ? '+' : ''}${upkeepWater.toFixed(2)} ðŸ’§/s | ${upkeepMinerals > 0 ? '+' : ''}${upkeepMinerals.toFixed(2)} â›ï¸/s</div>`
        : '';
    const photosynthesisHtml = doesPhotosynthesize
      ? '<div>Photosynthesis: âœ“ converts light into energy</div>'
      : '';
    const efficiencyHtml = `
      <div>Efficiency: +${opt.biomassGain.toFixed(1)} biomass per ${opt.energyCost.toFixed(1)} energy (ratio: ${biomassPerEnergy})</div>
    `;
    const descriptionHtml = partDescription
      ? `<div style="font-size: 0.75em; color: var(--leaf-300); margin-top: 2px;">${partDescription}</div>`
      : '';

    btn.innerHTML = `
      <div style="font-weight: bold; font-size: 0.95em;">${opt.label}</div>
      <div style="font-size: 0.8em; color: var(--bark-300); margin-top: 4px;">
        Cost: ${opt.energyCost.toFixed(1)} âš¡ | Gain: +${opt.biomassGain.toFixed(1)} ðŸŒ¿ | ~${opt.expectedSeconds.toFixed(1)}s
      </div>
      ${efficiencyHtml}
      ${upkeepEnergyHtml}
      ${photosynthesisHtml}
      ${descriptionHtml}
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
          setRootSightEnabled(true, plantId ?? undefined);
        }
        controls.enabled = false;
        controls.enableRotate = false;
        controls.enablePan = false;
        parts.optionsEl.querySelectorAll('button').forEach((b) => {
          (b as HTMLButtonElement).style.outline = 'none';
        });
        btn.style.outline = '2px solid var(--leaf-400)';

        // Immediately initialize smoothed direction and preview vector at the node
        const nodeData = plantNodes.get(result.nodeId);
        if (nodeData) {
          const initConstraints =
            NODE_GROWTH_CONSTRAINTS[opt.type as NodeType] ?? NODE_GROWTH_CONSTRAINTS.stem;
          const initialClamped = clampGrowthDirectionByGene(
            opt.type,
            initConstraints.downwardPreferred
              ? { x: 0, y: -1, z: 0 }
              : { x: 0.05, y: 0.998, z: 0.05 },
          );
          smoothedGrowthDir.set(initialClamped.x, initialClamped.y, initialClamped.z);
          smoothedGrowthDist = Math.min(1.0, initConstraints.maxReach * 0.7);
          isGrowthAtMaxReach = false;
          isGrowthAngleClamped = false;
          updateGrowthDirectionLine(
            { x: nodeData.position.x, y: nodeData.position.y, z: nodeData.position.z },
            {
              x: nodeData.position.x + smoothedGrowthDir.x * smoothedGrowthDist,
              y: nodeData.position.y + smoothedGrowthDir.y * smoothedGrowthDist,
              z: nodeData.position.z + smoothedGrowthDir.z * smoothedGrowthDist,
            },
            true,
          );
        }

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

// Chat UI
let chatContainer: HTMLElement | null = null;
let chatMessages: HTMLElement | null = null;
let chatInput: HTMLInputElement | null = null;
let chatOpen = false;
const MAX_CHAT_MESSAGES = 50;
let chatHudZIndex = 100;

function createChatUI(): void {
  const hudLayer = uiShell?.getLayer('hud');
  if (!hudLayer) return;

  chatContainer = document.createElement('div');
  chatContainer.id = 'chat-container';
  chatContainer.style.cssText = `
    position: fixed;
    bottom: 120px;
    left: 16px;
    width: 320px;
    max-height: 300px;
    background: var(--loam-900, #14180f);
    border: 1px solid var(--bark-700, #2a281f);
    border-radius: 8px;
    display: none;
    flex-direction: column;
    font-family: inherit;
    font-size: calc(13px * var(--text-scale, 1));
    color: var(--bone-100, #efe9d8);
    z-index: ${chatHudZIndex};
    overflow: hidden;
  `;

  // Chat header
  const header = document.createElement('div');
  header.style.cssText = `
    padding: 8px 12px;
    border-bottom: 1px solid var(--bark-700);
    font-weight: bold;
    display: flex;
    justify-content: space-between;
    align-items: center;
  `;
  header.innerHTML = `
    <span>Chat</span>
    <button id="chat-close" style="background: none; border: none; color: var(--bark-300); cursor: pointer; font-size: 1.2em; line-height: 1;">Ã—</button>
  `;
  chatContainer.appendChild(header);

  // Messages area
  chatMessages = document.createElement('div');
  chatMessages.id = 'chat-messages';
  chatMessages.style.cssText = `
    flex: 1;
    overflow-y: auto;
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 200px;
  `;
  chatContainer.appendChild(chatMessages);

  // Input area
  const inputWrapper = document.createElement('div');
  inputWrapper.style.cssText = `
    padding: 8px 12px;
    border-top: 1px solid var(--bark-700);
    display: flex;
    gap: 8px;
  `;
  chatInput = document.createElement('input');
  chatInput.type = 'text';
  chatInput.id = 'chat-input';
  chatInput.placeholder = 'Type a message...';
  chatInput.style.cssText = `
    flex: 1;
    background: var(--loam-800);
    border: 1px solid var(--bark-600);
    border-radius: 4px;
    padding: 6px 10px;
    color: var(--bone-100);
    font-family: inherit;
    font-size: calc(13px * var(--text-scale, 1));
    outline: none;
  `;
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && chatInput?.value.trim()) {
      sendChatMessage(chatInput.value.trim());
      chatInput.value = '';
    } else if (e.key === 'Escape') {
      toggleChat(false);
    }
  });
  inputWrapper.appendChild(chatInput);

  const sendBtn = document.createElement('button');
  sendBtn.textContent = 'Send';
  sendBtn.style.cssText = `
    background: var(--leaf-600);
    border: none;
    border-radius: 4px;
    padding: 6px 12px;
    color: var(--loam-900);
    font-weight: bold;
    cursor: pointer;
  `;
  sendBtn.onclick = () => {
    if (chatInput?.value.trim()) {
      sendChatMessage(chatInput.value.trim());
      chatInput.value = '';
    }
  };
  inputWrapper.appendChild(sendBtn);
  chatContainer.appendChild(inputWrapper);

  // Close button handler
  header.querySelector('#chat-close')?.addEventListener('click', () => toggleChat(false));

  hudLayer.appendChild(chatContainer);
}

function toggleChat(open?: boolean): void {
  if (!chatContainer) return;
  chatOpen = open ?? !chatOpen;
  chatContainer.style.display = chatOpen ? 'flex' : 'none';
  if (chatOpen) {
    chatInput?.focus();
  }
}

function addChatMessage(playerName: string, message: string, isOwn: boolean): void {
  if (!chatMessages) return;

  const msgEl = document.createElement('div');
  msgEl.style.cssText = `
    padding: 4px 8px;
    background: ${isOwn ? 'var(--leaf-900)' : 'var(--bark-800)'};
    border-radius: 4px;
    max-width: 90%;
    align-self: ${isOwn ? 'flex-end' : 'flex-start'};
    word-wrap: break-word;
  `;
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const nameColor = isOwn ? 'var(--leaf-300)' : 'var(--bark-200)';
  msgEl.innerHTML = `
    <span style="font-weight: bold; color: ${nameColor}; margin-right: 6px;">${playerName}</span>
    <span>${escapeHtml(message)}</span>
    <span style="font-size: 0.75em; color: var(--bark-400); margin-left: 8px;">${time}</span>
  `;

  chatMessages.appendChild(msgEl);

  // Limit message count
  while (chatMessages.children.length > MAX_CHAT_MESSAGES) {
    const firstChild = chatMessages.firstChild;
    if (firstChild) chatMessages.removeChild(firstChild);
  }

  // Auto-scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;

  // Show chat briefly if not open
  if (!chatOpen && chatContainer) {
    chatContainer.style.display = 'flex';
    setTimeout(() => {
      if (!chatOpen && chatContainer) chatContainer.style.display = 'none';
    }, 5000);
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

const EMOTE_EMOJIS: Record<string, string> = {
  wave: 'ðŸ‘‹',
  cheer: 'ðŸŽ‰',
  thumbs_up: 'ðŸ‘',
  heart: 'â¤ï¸',
  think: 'ðŸ¤”',
  sleep: 'ðŸ˜´',
  dance: 'ðŸ’ƒ',
  sad: 'ðŸ˜¢',
};

function showEmoteAbovePlant(fromPlayerId: string, playerName: string, emoteId: string): void {
  const emoji = EMOTE_EMOJIS[emoteId] ?? 'âœ¨';
  let targetPlantId: string | null = null;

  // Find the plant for this player
  if (fromPlayerId === playerId) {
    targetPlantId = plantId;
  } else {
    // Check other players' plants - map key is plantId
    for (const [pid, nodes] of otherPlayerPlants.entries()) {
      if (nodes.size > 0) {
        targetPlantId = pid;
        break;
      }
    }
  }

  if (!targetPlantId) return;

  // Get the root node position for this plant
  let rootNode: PlantNodeData | undefined;
  if (targetPlantId === plantId) {
    const rootNodeId = Array.from(plantNodes.values()).find((n) => n.parentId === null)?.id;
    if (rootNodeId) rootNode = plantNodes.get(rootNodeId);
  } else {
    const otherPlant = otherPlayerPlants.get(targetPlantId);
    if (otherPlant) {
      const rootNodeId = Array.from(otherPlant.values()).find((n) => n.parentId === null)?.id;
      if (rootNodeId) rootNode = otherPlant.get(rootNodeId);
    }
  }

  if (!rootNode) return;

  // Create emote bubble above plant
  const bubble = document.createElement('div');
  bubble.style.cssText = `
    position: fixed;
    pointer-events: none;
    z-index: 300;
    font-size: 2.5em;
    line-height: 1;
    transform: translate(-50%, -100%);
    animation: emote-pop 0.2s ease-out, emote-float 2s ease-out forwards;
    text-shadow: 0 2px 8px rgba(0,0,0,0.6);
    filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));
  `;
  bubble.textContent = emoji;

  // Add name label
  const nameLabel = document.createElement('div');
  nameLabel.style.cssText = `
    position: absolute;
    bottom: -1.5em;
    left: 50%;
    transform: translateX(-50%);
    font-size: 0.35em;
    font-weight: 600;
    color: var(--bone-100);
    background: rgba(20, 24, 15, 0.85);
    padding: 2px 6px;
    border-radius: 4px;
    white-space: nowrap;
    text-shadow: none;
    filter: none;
  `;
  nameLabel.textContent = playerName;
  bubble.appendChild(nameLabel);

  document.body.appendChild(bubble);

  // Project 3D position to screen
  const projectAndPosition = () => {
    if (!bubble.isConnected) return;
    const v = new THREE.Vector3(
      rootNode.position.x,
      rootNode.position.y + 3,
      rootNode.position.z,
    ).project(camera);
    if (v.z >= 1 || v.z <= -1) {
      bubble.style.opacity = '0';
      return;
    }
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    bubble.style.left = `${x}px`;
    bubble.style.top = `${y}px`;
    bubble.style.opacity = '1';
  };

  projectAndPosition();

  // Update position each frame for 2 seconds
  const startTime = performance.now();
  const animate = () => {
    if (!bubble.isConnected) return;
    const elapsed = performance.now() - startTime;
    if (elapsed > 2000) {
      bubble.remove();
      return;
    }
    projectAndPosition();
    requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);

  // Add CSS animations if not already added
  if (!document.getElementById('emote-animations')) {
    const style = document.createElement('style');
    style.id = 'emote-animations';
    style.textContent = `
      @keyframes emote-pop {
        0% { transform: translate(-50%, -100%) scale(0); opacity: 0; }
        50% { transform: translate(-50%, -100%) scale(1.2); opacity: 1; }
        100% { transform: translate(-50%, -100%) scale(1); opacity: 1; }
      }
      @keyframes emote-float {
        0% { transform: translate(-50%, -100%) scale(1); opacity: 1; }
        100% { transform: translate(-50%, -150%) scale(1); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }
}

function sendChatMessage(message: string): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const payload = JSON.stringify({
    type: MESSAGE_TYPE.CHAT_MESSAGE,
    payload: { message: message.slice(0, 500) },
  });
  ws.send(payload);
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
  // Server is authoritative for clamping/validation - send raw direction
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

  // Server is authoritative for clamping/validation - send raw direction
  const finalDir = drawnDirection ?? { x: dir.x, y: dir.y, z: dir.z };

  const intent: GrowthIntent = {
    plantId,
    nodeId,
    direction: finalDir,
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
controls.screenSpacePanning = true;
// Mouse: left-drag orbits, middle-drag orbits, right-drag pans (left click still selects).
// Touch: one-finger drag pans world, two-finger gesture orbits/zooms.
controls.mouseButtons = {
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.ROTATE,
  RIGHT: THREE.MOUSE.PAN,
};
controls.touches = {
  ONE: THREE.TOUCH.PAN,
  TWO: THREE.TOUCH.DOLLY_ROTATE,
};
controls.minDistance = 1;
controls.maxDistance = 200;
controls.maxPolarAngle = Math.PI / 2 - 0.05;

// Physics (Rapier) - client-side cosmetic simulation, server-authoritative state
let physicsReady = false;

function registerNodePhysics(node: PlantNodeData): void {
  if (!physicsReady || !rapierWorld.isReady) return;
  const shape = nodeTypeToPhysicsShape(node.nodeType ?? 'stem', node.biomass ?? 0);
  const scale = Math.min(1.0, Math.sqrt(node.biomass ?? 0 / 5.0));

  let radius = 0.1;
  let height = 0.5;
  let halfHeight = 0.5;
  if (shape.kind === 'sphere') radius = shape.radius * scale;
  else if (shape.kind === 'capsule') {
    height = shape.height * scale;
    radius = shape.radius * scale;
  } else if (shape.kind === 'cylinder') {
    halfHeight = shape.halfHeight * scale;
    radius = shape.radius * scale;
  }

  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(node.position.x, node.position.y, node.position.z)
    .setLinearDamping(0.5)
    .setAngularDamping(0.5)
    .setCanSleep(true);
  const body = rapierWorld.getWorld().createRigidBody(bodyDesc);

  let colliderDesc: RAPIER.ColliderDesc;
  switch (shape.kind) {
    case 'sphere':
      colliderDesc = RAPIER.ColliderDesc.ball(radius);
      break;
    case 'capsule':
      colliderDesc = RAPIER.ColliderDesc.capsule(height / 2, radius);
      break;
    case 'cylinder':
      colliderDesc = RAPIER.ColliderDesc.cylinder(halfHeight, radius);
      break;
    default:
      colliderDesc = RAPIER.ColliderDesc.ball(0.1);
  }
  colliderDesc.setFriction(0.6).setRestitution(0.2);
  rapierWorld.getWorld().createCollider(colliderDesc, body);
}

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

          // Reload controls config now that the server is reachable.
          // initC01() fetches /config/controls before WebSocket connects;
          // if the server wasn't ready, bindings fell back to {}.
          try {
            const reloaded = await loadControlsConfig(httpOrigin);
            if (reloaded.bindings && Object.keys(reloaded.bindings).length > 0) {
              controlsConfig = reloaded;
              inputBus?.setBindings(reloaded.bindings);
              console.debug('[PlantLegacy] Controls config reloaded from server', {
                actionCount: Object.keys(reloaded.bindings).length,
              });
            }
          } catch {
            // Keep existing bindings (may be empty from initC01 fallback).
          }
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
              // Use server-authoritative radius (Murray's law) if available
              const radius = node.radius ?? nodeRadius(node.biomass, nodeTypeNum, node.y);
              const health = Math.min(1, node.biomass / 10);

              // Server-authoritative growth timing for nodes that are still growing
              const SERVER_TICK_RATE_HZ = 20;
              let spawnTime = performance.now();
              let growthProgress = node.growthProgress ?? 1.0;

              if (
                node.growthTimeSeconds !== undefined &&
                node.growthStartTick !== undefined &&
                growthProgress < 1.0
              ) {
                const elapsedTicks = Math.max(0, serverTick - node.growthStartTick);
                const serverProgress = Math.min(
                  1,
                  elapsedTicks / (node.growthTimeSeconds * SERVER_TICK_RATE_HZ),
                );
                growthProgress = node.growthProgress ?? serverProgress;
                const totalMs = node.growthTimeSeconds * 1000;
                spawnTime = performance.now() - growthProgress * totalMs;
                // Back-date startTime so animation continues from server-reported progress, not 0.
                growingNodes.set(node.id, {
                  startTime: performance.now() - growthProgress * totalMs,
                  duration: totalMs,
                });
              }

              const nodeData: PlantNodeData = {
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
                spawnTime,
                growthProgress,
                parentAttachX: node.parentAttachX,
                parentAttachY: node.parentAttachY,
                parentAttachZ: node.parentAttachZ,
                targetX: node.targetX,
                targetY: node.targetY,
                targetZ: node.targetZ,
              };
              plantNodes.set(node.id, nodeData);
              registerNodePhysics(nodeData);
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
            const fallbackRoot: PlantNodeData = {
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
            };
            plantNodes.set(welcome.rootNode.id, fallbackRoot);
            registerNodePhysics(fallbackRoot);
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

          // Focus camera on the player's plant (root/seed node)
          const focusNode = Array.from(plantNodes.values()).find((n) => n.parentId === null);
          if (focusNode) {
            focusCameraOnNode(focusNode, true); // immediate = true for initial focus
          }

          // Clear other players' plants to avoid stale data on reconnect
          otherPlayerPlants.clear();
          // Request full plant sync to discover other existing players in the world
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: MESSAGE_TYPE.PLANT_SYNC_REQUEST, payload: {} }));
          }
          // Request full resource grid for ground rendering
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: MESSAGE_TYPE.RESOURCE_QUERY,
                payload: { fullGrid: true },
              }),
            );
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
          // Guard against stale/out-of-order STATE jumping serverTick backward
          if (serverTick !== 0 && state.tick < serverTick - 1000) {
            console.debug('[PlantLegacy] Ignoring stale STATE/KEYFRAME tick', {
              stateTick: state.tick,
              serverTick,
            });
            break;
          }
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
            fullGrid?: boolean;
            delta?: boolean;
          };
          if (serverTick !== 0 && Math.abs(update.tick - serverTick) > 1000) {
            console.warn('[PlantLegacy] Ignoring stale RESOURCE_UPDATE', {
              updateTick: update.tick,
              serverTick,
              diff: Math.abs(update.tick - serverTick),
            });
            return;
          }
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

            // Delta broadcasts contain arbitrary dirty tiles and full-grid
            // responses contain the whole world; neither represents the light
            // reaching this plant. Only the per-player root-tile update does.
            const isLocalTileUpdate = update.delta !== true && update.fullGrid !== true;
            if (isLocalTileUpdate && update.tiles.length > 0) {
              let lightSum = 0;
              let moistureSum = 0;
              let mineralsSum = 0;
              for (const t of update.tiles) {
                lightSum += t.light;
                moistureSum += t.moisture;
                mineralsSum += t.minerals;
              }
              const count = update.tiles.length;
              tileLight = lightSum / count;
              tileWater = moistureSum / count;
              tileMinerals = mineralsSum / count;
            }

            // Use plant's stored resources for growth panel
            storedWater = update.storedWater ?? 0;
            storedMinerals = update.storedMinerals ?? 0;
            if (isLocalTileUpdate) {
              updateResourceReadout(
                tileLight,
                tileWater,
                tileMinerals,
                plantBiomass,
                plantEnergy,
                storedWater,
                storedMinerals,
              );
              // Sky grade follows the light reaching the local tiles.
              environmentRenderer?.setLocalTileLight(tileLight);
              // Update dev panel tile info
              if (devPanel?.updateTileInfo) {
                devPanel.updateTileInfo(tile.tileX ?? 0, tile.tileZ ?? 0, {
                  light: tileLight,
                  moisture: tileWater,
                  minerals: tileMinerals,
                  storedWater,
                  storedMinerals,
                  rootTileCount: update.rootTileCount ?? 1,
                });
              }
            }

            // Handle full resource grid for ground rendering
            if (update.fullGrid && update.width && update.height) {
              environmentRenderer?.setResourceGrid(
                update.tiles as Array<{
                  tileX: number;
                  tileZ: number;
                  light: number;
                  moisture: number;
                  minerals: number;
                }>,
                update.width,
                update.height,
                update.tileSize,
              );
            }
            // Handle delta (dirty tiles) - merge into existing grid
            if (update.delta && update.width && update.height) {
              environmentRenderer?.updateResourceGrid(
                update.tiles as Array<{
                  tileX: number;
                  tileZ: number;
                  light: number;
                  moisture: number;
                  minerals: number;
                }>,
              );
            }
            // Update growth panel if visible with live resource values
            if (
              isLocalTileUpdate &&
              growthSelectionStateMachineIsVisible(growthSelectionMachine) &&
              growthSelectionStateMachineGetState(growthSelectionMachine) === 'options_visible' &&
              growthSelectionMachine.selectedNodeId &&
              growthSelectionMachine.conditions
            ) {
              growthSelectionMachine.conditions.light = tileLight;
              growthSelectionMachine.conditions.moisture = tileWater;
              growthSelectionMachine.conditions.storedWater = storedWater;
              growthSelectionMachine.conditions.storedMinerals = storedMinerals;
              const parts = prepareGrowthPanel(growthSelectionMachine.selectedNodeId);
              if (parts) {
                const infoLines = [
                  `Biomass: ${plantBiomass.toFixed(1)} | Energy: ${plantEnergy.toFixed(1)}`,
                  `Light: ${tileLight.toFixed(0)} / ${growthSelectionMachine.conditions.minLight.toFixed(0)} | Moisture: ${tileWater.toFixed(0)} / ${growthSelectionMachine.conditions.minMoisture.toFixed(0)}`,
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

            // Server-authoritative growth timing: use growthTimeSeconds and growthStartTick
            // Server runs at 20 Hz (50ms per tick)
            const SERVER_TICK_RATE_HZ = 20;

            let spawnTime: number;
            let growthProgress: number;

            if (node.growthTimeSeconds !== undefined && node.growthStartTick !== undefined) {
              // Compute spawnTime from server timeline
              // elapsed server ticks since growth started
              const elapsedTicks = Math.max(0, serverTick - node.growthStartTick);
              const totalMs = node.growthTimeSeconds * 1000;
              // Server's spawnTime = now - elapsedMs (where now is client's performance.now())
              // But we need to account for network latency - use client's current time as reference
              // For new nodes (progress ~0), spawnTime should be in the future from client perspective
              // For existing growing nodes, we compute based on server progress
              const serverProgress = Math.min(
                1,
                elapsedTicks / (node.growthTimeSeconds * SERVER_TICK_RATE_HZ),
              );
              growthProgress = node.growthProgress ?? serverProgress;

              // Compute spawnTime so that growthProgress = smoothstep((now - spawnTime) / totalMs)
              // => now - spawnTime = growthProgress * totalMs (approximately, using linear for spawnTime calc)
              // => spawnTime = now - growthProgress * totalMs
              // But we want the full smoothstep curve to match, so:
              // growthProgress = smoothstep(elapsed / totalMs) => elapsed = smoothstepInv(growthProgress) * totalMs
              // For smoothstep(t) = t*t*(3-2t), the inverse is complex.
              // Approximation: use linear for spawnTime calculation, smoothstep will be applied in renderer
              spawnTime = performance.now() - growthProgress * totalMs;
            } else {
              // Fallback to existing behavior
              spawnTime = existing?.spawnTime ?? performance.now();
              growthProgress = node.growthProgress ?? 1.0;
            }

            return {
              id: node.id,
              position: new THREE.Vector3(node.x, node.y, node.z),
              type: nodeTypeNum,
              // Use server-authoritative radius (Murray's law) if available
              radius: node.radius ?? nodeRadius(node.biomass, nodeTypeNum, node.y),
              parentId: node.parentId,
              children: node.children ?? existing?.children ?? [],
              age: node.age,
              health: Math.min(1, node.biomass / 10),
              mutationFlags: 0,
              biomass: node.biomass,
              isOwnPlant,
              isSeed: node.isSeed ?? node.type === 'seed',
              nodeType: node.type,
              layer:
                node.layer === 'canopy' ? 'canopy' : node.layer === 'root' ? 'root' : undefined,
              spawnTime,
              growthProgress,
              // Server-authoritative parent attachment position
              parentAttachX: node.parentAttachX,
              parentAttachY: node.parentAttachY,
              parentAttachZ: node.parentAttachZ,
              // Server-authoritative target position for connected growth rendering
              targetX: node.targetX,
              targetY: node.targetY,
              targetZ: node.targetZ,
            };
          };

          if (growth.plantId === plantId) {
            // Local player's plant - apply every new node, then replace the
            // seed with the root when germination reports an updated parent.
            const now = performance.now();
            for (const node of incomingNodes) {
              const nodeData = toNodeData(node, true);
              plantNodes.set(node.id, nodeData);
              registerNodePhysics(nodeData);
              // Track growing nodes for client-side animation.
              // Use server-authoritative growthTimeSeconds for duration.
              // Staggered emergence per node type (roots first, leaves last).
              // Back-date startTime so the animation continues from the
              // server-reported growthProgress, not from zero.
              if ((nodeData.growthProgress ?? 1.0) < 1.0) {
                const durationMs = (node.growthTimeSeconds ?? 5) * 1000;
                const startDelayMs = EMERGENCE_DELAY_MS[node.type ?? ''] ?? 0;
                const alreadyElapsedMs = (nodeData.growthProgress ?? 0) * durationMs;
                growingNodes.set(node.id, {
                  startTime: now + startDelayMs - alreadyElapsedMs,
                  duration: durationMs,
                });
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
              const updatedNode = plantNodes.get(updatedParent.id);
              if (updatedNode) registerNodePhysics(updatedNode);
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
              storedWater,
              storedMinerals,
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
            const otherNow = performance.now();
            for (const node of incomingNodes) {
              const nodeData = toNodeData(node, false);
              otherPlant.set(node.id, nodeData);
              registerNodePhysics(nodeData);
              // Track growing animation for other players' newly grown nodes
              if ((nodeData.growthProgress ?? 1.0) < 1.0 && node.growthTimeSeconds) {
                const durationMs = node.growthTimeSeconds * 1000;
                const startDelayMs = EMERGENCE_DELAY_MS[node.type ?? ''] ?? 0;
                // Back-date startTime by already-elapsed server progress so the
                // animation continues from the server-reported fraction, not from 0.
                const alreadyElapsedMs = (nodeData.growthProgress ?? 0) * durationMs;
                otherGrowingNodes.set(node.id, {
                  plantId: growth.plantId,
                  startTime: otherNow + startDelayMs - alreadyElapsedMs,
                  duration: durationMs,
                });
              }
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
              const updatedNode = otherPlant.get(updatedParent.id);
              if (updatedNode) registerNodePhysics(updatedNode as PlantNodeData);
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
                                  : reject.reason === 'parent_node_not_found'
                                    ? 'Parent node not found — plant may have changed'
                                    : reject.reason === 'out_of_bounds'
                                      ? 'Growth would go out of world bounds'
                                      : reject.reason === 'invalid_direction'
                                        ? 'Growth direction is invalid for this node type'
                                        : reject.reason === 'max_nodes_reached'
                                          ? 'Plant has reached maximum node limit'
                                          : reject.reason === 'invalid_parent_for_cotyledon'
                                            ? 'Cotyledons can only grow from seed crown or root crown'
                                            : reject.reason === 'radicle_only_from_seed'
                                              ? 'Radicle can only grow from a seed'
                                              : reject.reason ===
                                                  'radicle_required_before_cotyledon'
                                                ? 'Must sprout a radicle before adding cotyledons'
                                                : reject.reason === 'establish_seed_before_stem'
                                                  ? 'Must establish seed (radicle + 2 cotyledons) before growing stem'
                                                  : reject.reason === 'max_cotyledons_reached'
                                                    ? 'Maximum cotyledons (2) already reached'
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
            ? 'âœ“ Dev command succeeded'
            : `âœ— Dev command failed: ${response.message ?? 'unknown'}`;
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
                // Server-authoritative fields for client sync
                radius?: number;
                growthTimeSeconds?: number;
                growthStartTick?: number;
                parentAttachX?: number;
                parentAttachY?: number;
                parentAttachZ?: number;
                // Server-authoritative target position for connected growth rendering
                targetX?: number;
                targetY?: number;
                targetZ?: number;
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
          otherGrowingNodes.clear(); // Reset other-player animation state on full sync
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
                // Server-authoritative fields for client sync
                parentAttachX?: number;
                parentAttachY?: number;
                parentAttachZ?: number;
                growthTimeSeconds?: number;
                // Server-authoritative target position for connected growth rendering
                targetX?: number;
                targetY?: number;
                targetZ?: number;
              }
            >();
            const SERVER_TICK_RATE_HZ = 20;

            for (const node of plant.nodes) {
              const nodeTypeNum = typeMap[node.type] ?? 0;
              // Use server-authoritative radius (Murray's law) if available
              const radius = node.radius ?? nodeRadius(node.biomass, nodeTypeNum, node.y);
              const health = Math.min(1, node.biomass / 10);
              const existing = isOwn ? plantNodes.get(node.id) : undefined;

              // Server-authoritative growth timing
              let spawnTime: number;
              let growthProgress: number;

              if (node.growthTimeSeconds !== undefined && node.growthStartTick !== undefined) {
                const elapsedTicks = Math.max(0, serverTick - node.growthStartTick);
                const serverProgress = Math.min(
                  1,
                  elapsedTicks / (node.growthTimeSeconds * SERVER_TICK_RATE_HZ),
                );
                growthProgress = node.growthProgress ?? serverProgress;
                const totalMs = node.growthTimeSeconds * 1000;
                spawnTime = performance.now() - growthProgress * totalMs;
              } else {
                spawnTime = existing?.spawnTime ?? performance.now();
                growthProgress = node.growthProgress ?? 1.0;
              }

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
                spawnTime,
                growthProgress,
                // Server-authoritative parent attachment position
                parentAttachX: node.parentAttachX,
                parentAttachY: node.parentAttachY,
                parentAttachZ: node.parentAttachZ,
                // Server-authoritative target position for connected growth rendering
                targetX: node.targetX,
                targetY: node.targetY,
                targetZ: node.targetZ,
                growthTimeSeconds: node.growthTimeSeconds,
              });
            }
            if (isOwn) {
              plantNodes.clear();
              for (const [id, node] of target) {
                plantNodes.set(id, node);
                registerNodePhysics(node);
              }
              plantBiomass = plant.totalBiomass;
              plantEnergy = plant.totalEnergy;
              // Reset growth sequence on full sync (Phase 1.5)
              resetPlantMirror();
              // Track growing nodes from sync
              growingNodes.clear();
              const now = performance.now();
              for (const node of target.values()) {
                if ((node.growthProgress ?? 1.0) < 1.0) {
                  // Use server-authoritative growthTimeSeconds for duration
                  const durationMs = (node.growthTimeSeconds ?? 5) * 1000;
                  const progress = node.growthProgress ?? 0;
                  const elapsed = progress * durationMs;
                  growingNodes.set(node.id, {
                    startTime: now - elapsed,
                    duration: durationMs,
                  });
                }
              }
              // Don't call updateResourceReadout with zeros - wait for RESOURCE_UPDATE
            } else {
              // Track growing nodes for other players from sync
              const syncNow = performance.now();
              for (const node of target.values()) {
                if ((node.growthProgress ?? 1.0) < 1.0 && node.growthTimeSeconds) {
                  const durationMs = node.growthTimeSeconds * 1000;
                  const progress = node.growthProgress ?? 0;
                  const elapsed = progress * durationMs;
                  otherGrowingNodes.set(node.id, {
                    plantId: plant.id,
                    startTime: syncNow - elapsed,
                    duration: durationMs,
                  });
                }
              }
              otherPlayerPlants.set(plant.id, target);
              for (const node of target.values()) {
                registerNodePhysics(node);
              }
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
          for (const node of otherPlant.values()) {
            registerNodePhysics(node);
          }
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
            setRootSightEnabled(false, removed.plantId);
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
            // Clean up growing-node tracking for the removed plant
            for (const [nodeId, info] of otherGrowingNodes.entries()) {
              if (info.plantId === removed.plantId) otherGrowingNodes.delete(nodeId);
            }
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

        case MESSAGE_TYPE.CHAT_BROADCAST: {
          const chat = payload as {
            playerId: string;
            playerName: string;
            message?: string;
            emoteId?: string;
            type?: string;
            timestamp: number;
          };
          if (chat.type === 'emote' && chat.emoteId) {
            showEmoteAbovePlant(chat.playerId, chat.playerName, chat.emoteId);
          } else if (chat?.message) {
            addChatMessage(chat.playerName, chat.message, chat.playerId === playerId);
          }
          break;
        }

        default:
          console.warn('Unknown message type:', type);
      }

      // Frame camera on first spawn (after WELCOME). ADR-027: close framing on
      // the normal-sized plant model; the model itself is not enlarged.
      // Guard on `welcome` (not `welcome.rootNode`) so initPlantRenderer() runs
      // even when all nodes arrive via welcome.nodes (ADR-021 fast-path).
      if (welcome && !cameraFramed) {
        cameraFramed = true;
        if (welcome.rootNode) {
          frameCameraOnPlant(welcome.rootNode.x, welcome.rootNode.y, welcome.rootNode.z);
        } else {
          // Frame on the first own node (seed/root) when rootNode is omitted
          const firstNode = Array.from(plantNodes.values()).find((n) => n.isOwnPlant);
          if (firstNode) {
            frameCameraOnPlant(firstNode.position.x, firstNode.position.y, firstNode.position.z);
          }
        }
        setDetail(
          `Welcome! Player ID: ${playerId}\nServer tick: ${serverTick}\nClick your plant to grow. Press H for hints.`,
        );
        // T00A: Load onboarding config and init renderer on first spawn
        await loadOnboardingConfig();
        await initPlantRenderer();
      }
    } catch (error) {
      console.error('Failed to parse message:', error);
      if (error instanceof Error && error.stack) {
        console.error(error.stack);
      }
    }
  };

  ws.onclose = (event) => {
    connecting = false;
    plantId = null;
    plantReady = false;
    cameraFramed = false;
    hideGrowthSelection();
    rootSightActivePlants.clear();
    setRootSightEnabled(false);
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
    plantRenderer.setViewportSize(renderer.domElement.width, renderer.domElement.height);
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
    // Zoom rate from config; scales by current distance for smooth logarithmic feel
    const zoomRate = renderConfig?.cameraZoomSpeed ?? 2.0;
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

  // Client-side growth animation: advance growthProgress FIRST so renderers
  // always receive current-frame values (not one-frame-stale values).
  if (growingNodes.size > 0 || otherGrowingNodes.size > 0) {
    const growNow = performance.now();

    // Own plant's growing nodes
    for (const [nodeId, growthInfo] of growingNodes.entries()) {
      const node = plantNodes.get(nodeId);
      if (!node) {
        growingNodes.delete(nodeId);
        continue;
      }
      const elapsed = Math.max(0, growNow - growthInfo.startTime);
      const progress = Math.min(1.0, elapsed / growthInfo.duration);
      if (progress >= 1.0) {
        node.growthProgress = 1.0;
        growingNodes.delete(nodeId);
      } else {
        node.growthProgress = progress;
      }
    }

    // Other players' growing nodes
    for (const [nodeId, growthInfo] of otherGrowingNodes.entries()) {
      const otherPlant = otherPlayerPlants.get(growthInfo.plantId);
      const node = otherPlant?.get(nodeId);
      if (!node) {
        otherGrowingNodes.delete(nodeId);
        continue;
      }
      const elapsed = Math.max(0, growNow - growthInfo.startTime);
      const progress = Math.min(1.0, elapsed / growthInfo.duration);
      if (progress >= 1.0) {
        node.growthProgress = 1.0;
        otherGrowingNodes.delete(nodeId);
      } else {
        node.growthProgress = progress;
      }
    }
  }

  // Update plant renderers with fresh growthProgress values.
  // The SDF renderer (plantRenderer) throttles rebuilds internally;
  // the WebGPU renderer re-writes joint matrices every frame.
  if (plantRenderer) {
    // Update sun lighting from environment
    if (environmentRenderer) {
      plantRenderer.setSunLight(
        environmentRenderer.getSunDirection(),
        environmentRenderer.getSunColor(),
        environmentRenderer.getSunIntensity(),
      );
    }
    plantRenderer.render(deltaTime);
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

  // Step Rapier physics and sync body transforms to Three.js meshes
  if (physicsReady && rapierWorld.isReady) {
    rapierWorld.step();
    plantPhysicsSync.syncTransforms();
  }

  // Periodically notify the SDF renderer of updated growthProgress (it doesn't
  // rebuild every frame unlike the WebGPU renderer which does joint matrices).
  if (growingNodes.size > 0 || otherGrowingNodes.size > 0) {
    const growNow2 = performance.now();
    if (growNow2 - lastGrowthUpdateTime >= GROWTH_UPDATE_INTERVAL_MS) {
      const otherNodes: PlantNodeData[] = [];
      for (const nodes of otherPlayerPlants.values()) otherNodes.push(...nodes.values());
      const allNodes = [...plantNodes.values(), ...otherNodes];
      if (plantRenderer) plantRenderer.updatePlantData(allNodes);
      lastGrowthUpdateTime = growNow2;
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
  readonly environmentRenderer: EnvironmentRenderer | null;
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
    get environmentRenderer() {
      return environmentRenderer;
    },
    get plantEnergy() {
      return plantEnergy;
    },
    get plantBiomass() {
      return plantBiomass;
    },
  };
}
