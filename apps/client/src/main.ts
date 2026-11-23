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
import { type Binding, createInputBus, type InputBus } from '@plant-legacy/input';
import { appendLedger, type LedgerEntry } from '@plant-legacy/shared/economy';
import {
  clampGrowthDirectionByGene,
  getSeedBodyHeightRatio,
  NODE_GROWTH_CONSTRAINTS,
  type NodeType,
  nodeBelongsToPlant,
  nodeRenderRadius,
  resolveAttachFraction,
  resolveDrawnRadius,
} from '@plant-legacy/shared/growth';
import { MESSAGE_TYPE, PROTOCOL_VERSION } from '@plant-legacy/shared/protocol';
import { validateMessage } from '@plant-legacy/shared/protocol/messageSchemas';
import {
  buildCavityField,
  type CavityField,
  type CavityNodeInput,
} from '@plant-legacy/shared/world';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createAppContext } from './app/appContext.ts';
import { ensureFreshSession, signIn, signOut, signUp } from './auth/authClient.js';
import {
  type ControlsConfig,
  type DayNightConfig,
  type DevSettings,
  type GrowthSegmentConfig,
  loadChatConfig,
  loadControlsConfig,
  loadDayNightConfig,
  loadDevSettings,
  loadGrowthSegmentConfig,
  loadNetworkConfig,
  loadPaletteConfig,
  loadPhysicsConfig,
  loadRenderConfig,
  loadReportsConfig,
  loadResourceTileConfig,
  loadRootSightConfig,
  loadShopConfig,
  loadTerrainConfig,
  loadTerrainVolumeConfig,
  loadUIConfig,
  type PhysicsConfig,
  type RenderConfig,
  type ResourceRates,
  type ResourceTileConfig,
  type RootSightConfig,
  type ShopConfig,
  type SizeClassConfig,
} from './config/clientConfig.js';
import {
  type ControlOverrides,
  loadControlOverrides,
  mergeControlOverrides,
  rebindAction,
  saveControlOverrides,
} from './config/controlOverrides.js';
import { httpOrigin, isDevMode, probeDevTools, wsOrigin } from './config/endpoints.js';
import { loadGrowthGeometryConfig } from './config/growthGeometryConfig.js';
import { loadMutationVisualsConfig } from './config/mutationVisuals.js';
import { loadPlantRendererConfig } from './config/plantRendererConfig.js';
import { loadWaterTuning } from './config/waterConfig.js';
import { type BenchmarkPose, type BenchmarkReport, BenchmarkRunner } from './dev/benchmark.js';
import { type CavityProbe, createCavityProbe } from './dev/cavityProbe.ts';
import {
  createDispatchTable,
  type MessageContext,
  missingServerMessageTypes,
} from './net/dispatch.js';
import { closePingProbe, openPingProbe } from './net/pingProbe.js';
import { fetchWorldTime } from './net/worldTime.js';
import { playerWorldY, spawnPlayer, stepPlayerVertical } from './physics/playerPhysics.js';
import { plantPhysicsSync, rapierWorld } from './physics/RapierPhysicsManager.js';
import { cavityEscapeLiftY, clampToCavity, raiseEyeWithAim } from './player/burrowClamp.ts';
import { aimLiftY } from './player/cameraAim.js';
import { solveGroundCeiling, stepLookUpPitch } from './player/cameraOrbit.js';
import { panMove } from './player/cameraPan.ts';
import { ownBodyNodes, resolveOwnAnchor } from './player/ownPlantAnchor.js';
import { recenterOffset } from './player/recenterView.js';
import { decideAutoOpenRootSight } from './player/rootSightAutoOpen.js';
import { isBelowSoil } from './player/underground.js';
import { createGpuTimer, type GpuTimer } from './render/GpuTimer.js';
import { createGrowthAimGizmo, type GrowthAimGizmo } from './render/growthAimGizmo.ts';
import { interpolationDurationMs, NodeInterpolator } from './render/PlantInterpolation.js';
import { clientNodeHealth, resolveDrawnProgress } from './render/plantProgress.js';
import { createQualityController, type QualityController } from './render/QualityController.js';
import { rivalTagLabel } from './render/rivalTagLabel.js';
import { DrawnGround } from './renderers/drawnGround.js';
import { cavityPaletteFromWorld, EnvironmentRenderer } from './renderers/EnvironmentRenderer.js';
import { apertureSoilHoldRadiusM } from './renderers/environment/apertureSoilMesh.ts';
import {
  APERTURE_FLOOR_MARGIN_M,
  APERTURE_RIM_MARGIN_M,
  apertureVolumeFor,
} from './renderers/environment/cavity/apertureVolume.ts';
import { cavityDepthM } from './renderers/environment/cavity/profile.ts';
import {
  mouthRadiusFor,
  ROOT_CAVITY_SEED_PIT_RADII,
  ROOT_SIGHT_APERTURE_EYE_CLEARANCE,
  rimModeFor,
  rootCavityShape,
} from './renderers/environment/cavity/shape.ts';
import { planetTerrainY, planetUp } from './renderers/environment/planetSurface.js';
import {
  apertureRadiusFor,
  applyRootSightConfig,
  createRootSightUniforms,
} from './renderers/environment/rootSightUniforms.js';
import { aimDirectionFromScreenDrag } from './renderers/growthAimMath.js';
import { applyOrganPalette } from './renderers/MeshPlantRenderer.ts';
import { createPlantLabelLayer } from './renderers/PlantLabels.js';
import { DEFAULT_CONFIG, PlantRenderer } from './renderers/PlantRenderer.js';
import { toClientSpace } from './renderers/plant/clientSpace.js';
import {
  buildTaperedTubeGeometry,
  clampAnchorToNode,
  groundMarkerHeight,
  ringFrameFor,
} from './renderers/plant/growthGizmoGeometry.js';
import {
  configureMutationVisuals,
  lookFromMutations,
  type MutationLook,
  readServerMutationMask,
} from './renderers/plant/mutations.js';
import { type NubReport, nubReport } from './renderers/plant/nubBulge.ts';
import { PlantColliderManager } from './renderers/plant/PlantColliders.js';
import type { PlantNodeData } from './renderers/plant/plantNodeData.js';
import {
  createRootSightStateMachine,
  type RootSightStateMachine,
  rootSightStateMachineGetState,
  rootSightStateMachineIsEnabled,
  rootSightStateMachineSetContext,
  rootSightStateMachineSetTarget,
  rootSightStateMachineToggle,
  rootSightStateMachineUpdate,
} from './renderers/RootSightStateMachine.js';
import {
  plantExtent,
  plantLateralExtent,
  resolveCutawayRadius,
} from './renderers/rootSight/rootSightCutaway.js';
import { configureTerrain, getTerrainParams } from './renderers/terrain/terrainState.js';
import { WorldDrops } from './renderers/WorldDrops.js';
import { resolveDrawnNodePosition } from './renderers/webgpu/PlantMeshBuilder.js';
import { isWebGPUSupported, WebGPUDevice } from './renderers/webgpu/WebGPUDevice.js';
import { WebGPURenderer } from './renderers/webgpu/WebGPURenderer.js';
import { applyWorldPalette } from './renderers/worldPalette.ts';
import { type LocalProfile, loadProfile, saveProfile } from './state/localProfile.js';
import {
  describeLastAction,
  loadJournal,
  markCleanExit,
  previousSessionEnd,
  recordEvent,
} from './state/sessionJournal.js';
import { type ActionBarAPI, createActionBar } from './ui/ActionBar.js';
import { type ContextHintAPI, createContextHint } from './ui/ContextHint.js';
import {
  applyCursorTheme,
  plantCursorsEnabled,
  readCursorTheme,
  setCursorTheme,
} from './ui/cursors.js';
import {
  createDeathScreen,
  createSpectateChip,
  type DeathScreen,
  type SpectateChip,
} from './ui/DeathScreen.js';
import { createDebugOverlay, type DebugOverlay } from './ui/DebugOverlay.js';
import { createDevPanel, type DevPanelAPI } from './ui/DevPanel.js';
import {
  createEntryFlowStateMachine,
  entryFlowAuthenticated,
  entryFlowBack,
  entryFlowBeginRequest,
  entryFlowBoot,
  entryFlowCancelConnect,
  entryFlowChoose,
  entryFlowConnectionFailed,
  entryFlowContinueAsGuest,
  entryFlowPlantLost,
  entryFlowRequestFailed,
  entryFlowReseed,
  entryFlowSignedOut,
  entryFlowWorldReady,
} from './ui/EntryFlowStateMachine.js';
import {
  createGrowthSelectionStateMachine,
  type GrowthSelectionViewData,
  growthSelectionStateMachineCancelDrawing,
  growthSelectionStateMachineGetDrawingData,
  growthSelectionStateMachineGetState,
  growthSelectionStateMachineHide,
  growthSelectionStateMachineIsDrawing,
  growthSelectionStateMachineIsVisible,
  growthSelectionStateMachineRenderOptions,
  growthSelectionStateMachineRequestOptions,
  growthSelectionStateMachineSelectOption,
  growthSelectionStateMachineStartDrawing,
} from './ui/GrowthSelectionStateMachine.js';
import { createHotbar, type HotbarAPI } from './ui/Hotbar.js';
import { MainMenu, type MainMenuAccount, type MainMenuCallbacks } from './ui/MainMenu.js';
import {
  createMutationPanel,
  type MutationPanelAPI,
  type MutationStateView,
} from './ui/MutationPanel.js';
import { createNotificationLog, type NotificationLogAPI } from './ui/NotificationLog.js';
import { pickNodeHit } from './ui/nodePick.js';
import { createPauseMenu, type PauseMenuAPI } from './ui/PauseMenu.js';
import {
  createPlantHoverTip,
  type HoverText,
  type PlantHoverTip,
  plantHoverText,
} from './ui/PlantHoverTip.js';
import { plantNodeInfo } from './ui/PlantNodeInfo.js';
import {
  createPlantStatusHud,
  formatClock,
  type PlantPhase,
  type PlantStatusHudAPI,
  type RerootDirection,
  structureFraction,
  weatherLabel,
} from './ui/PlantStatusHud.js';
import {
  createPlayerPanels,
  type ItemDefinitionView,
  type PlayerPanelsAPI,
} from './ui/PlayerPanels.js';
import type { PlantStatsSummary } from './ui/plantStats.js';
import { refusalCopy } from './ui/refusalCopy.js';
import {
  clockChip,
  DEFAULT_VITAL_THRESHOLDS,
  type VitalThresholds,
  vitalRow,
  weatherChip,
} from './ui/resourceVitals.js';
import { waitForServer } from './ui/ServerUnreachableOverlay.js';
import {
  createSettingsPanel,
  prettyAction,
  prettyKey,
  type SettingsPanelAPI,
} from './ui/SettingsPanel.js';
import { createShopPanel, type ShopPanel } from './ui/ShopPanel.js';
import { createSporeChip, type SporeChipAPI } from './ui/SporeChip.js';
import { formatSeasonRemaining } from './ui/seasonLabel.js';
import { applyPaletteCssVars } from './ui/theme.ts';
import { isPlantSoundEnabled, setPlantSoundEnabled } from './ui/title/plantSound.js';
import { touchHintLines } from './ui/touchCopy.js';
import { createUIShell, type UIShell } from './ui/UIShell.js';
import { setUiScale, uiScaleForPane } from './ui/uiScale.js';
import { FrameBudget, frameStatsOf } from './util/frameBudget.js';
import { shouldIdleRender } from './util/idleThrottle.js';
import './styles.css';

// Server origins and the dev-mode gate live in `config/endpoints.ts`, so the
// socket, the config fetches and the reconnect payload all read one copy.

/**
 * What this session did, and how the last one ended.
 *
 * The avatar reboot was reported and never reproduced, and a crashed tab leaves
 * no console to read: the page simply restarts with nothing to say. Every
 * session therefore leaves a bounded trail in localStorage, and the next one
 * says out loud if the previous one never unloaded. Recorded here rather than in
 * a module of its own so there is one place to see what is instrumented.
 */
const sessionJournalStorage = window.localStorage;
const sessionStart = loadJournal(sessionJournalStorage);
const previousSession = previousSessionEnd(sessionStart);
if (previousSession === 'crashed') {
  console.warn(
    `[PlantLegacy] previous session stopped without unloading (crash or kill) after: ${describeLastAction(sessionStart)}`,
    sessionStart.entries.slice(-8),
  );
}

function memoryHeapMb(): number | undefined {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? Math.round(memory.usedJSHeapSize / 1048576) : undefined;
}

/** One journal line, with the heap size, which is the interesting number here. */
function recordSessionEvent(kind: string, detail?: Record<string, unknown>): void {
  recordEvent(sessionJournalStorage, {
    at: Date.now(),
    kind,
    detail: { ...detail, heapMB: memoryHeapMb() },
  });
}

recordSessionEvent('boot', {
  previous: previousSession,
  after: previousSession === 'crashed' ? describeLastAction(sessionStart) : undefined,
  cores: navigator.hardwareConcurrency,
  gpu: isWebGPUSupported(),
  viewport: `${window.innerWidth}x${window.innerHeight}`,
});
// A tab that leaves on purpose says so; one that is killed writes nothing, and
// that absence is the signal the next boot reads.
window.addEventListener('pagehide', () => markCleanExit(sessionJournalStorage, Date.now()));

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
  /** Server-issued secret required to reclaim this plant after a disconnect. */
  reconnectToken?: string;
  tick: number;
  rootNode: { id: string; x: number; y: number; z: number; type: string; biomass: number };
  totalBiomass: number;
  totalEnergy: number;
  /** Present only when the server had a disconnect snapshot to compare with. */
  away?: {
    seconds: number;
    nodesBefore: number;
    nodesAfter: number;
    biomass: number;
    energy: number;
    water: number;
    minerals: number;
  };
  /** Set when the previous plant died while the player was away. */
  previousPlantDied?: { cause: string; source?: string; secondsAgo: number };
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
    health?: number;
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
    attachFraction?: number;
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
    structure?: { damageHp: number; threshold: number };
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
    totalEnergy?: number;
    totalUpkeep: number;
    structure?: { damageHp: number; threshold: number };
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
  health?: number;
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
  attachFraction?: number;
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
  nutrientCost?: number;
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

// The wire numbers come from the shared package: the client had its own copy,
// so a message added on one side could be unknown to the other.

let ws: WebSocket | null = null;
let playerId: string | null = null;
let serverTick = 0;
// Diagnostics for the dev handle below: how often the authoritative root update
// actually reaches this client, and how fresh it is. A frozen dev readout is
// either "the server stopped sending" or "the panel stopped refreshing", and
// these numbers are what tell the two apart.
let resourceUpdateCount = 0;
let lastResourceUpdateAt = 0;

// The server sends the season and its remaining seconds on join and on every
// rollover; between messages the HUD counts down on its own, so the calendar
// costs one packet per 36 days rather than one per tick.
let seasonNumber = 0;
let seasonEndsAtMs = 0;

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

// Temp reusable objects to avoid per-frame GC pressure in render/update loops
const tempTarget = new THREE.Vector3();
const tempDirection = new THREE.Vector3();
const tempVector = new THREE.Vector3();
const tempCameraOffset = new THREE.Vector3();

let connecting = false;
let plantId: string | null = null;
let plantReady = false;
/**
 * The node the server calls this plant's root crown, and the last position it
 * streamed for it. Space and Root Sight resolve the body through these instead
 * of "the first parentless node in the mirror", which pointed at a spot the
 * plant had already crawled away from (see player/ownPlantAnchor.ts).
 */
let ownRootNodeId: string | null = null;
const lastOwnAnchor = new THREE.Vector3();
let lastOwnAnchorValid = false;
/** Grow mode mirrored for the tick card, outside the grow-mode closure. */
let growModeHud = false;
// A death broadcast can be missed while the tab is background-throttled. STATE
// always includes the owner's plant, so its absence is a second, authoritative
// death signal; a couple of seconds avoids treating a one-frame gap as death.
let ownPlantMissingSince = 0;
// Framing is a first-spawn convenience, not a reconnect behaviour: a socket
// blip re-delivers WELCOME, and re-framing there yanked the camera out and
// centered the plant while the player was orbiting. The camera is re-framed
// only when the plant itself changes (a server restart respawns it elsewhere,
// so the old framing would point at empty ground).
let cameraFramed = false;
let framedPlantId: string | null = null;
let clientInitialized = false;
let welcome: WelcomePayload | null = null;

// Reconnect persistence (ADR-029: explicit dev switch, not implicit)
const RECONNECT_STORAGE_KEY = 'plantlegacy.reconnect.v1';
interface ReconnectData {
  accessToken?: string;
  refreshToken?: string;
  /** Shown in the account chip; survives a reload with the session. */
  displayName?: string;
  /** Account handle, shown as @username next to the display name. */
  username?: string;
  plantId?: string;
  reconnectToken?: string;
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
let backgroundLoopTimer: number | null = null;
/** When the last frame was drawn, whatever drew it. */
let lastFrameAtMs = 0;
/** The renderer is constructed and a frame has been drawn at least once. */
let renderLoopReady = false;
/** `animate()` is re-arming itself. Parked while the title is on screen. */
let renderLoopRunning = false;

/** Start the frame loop after the title hands over to the world. */
function wakeRenderLoop(): void {
  if (renderLoopRunning) return;
  lastFrameAtMs = performance.now();
  animate();
}

/**
 * Draw for a tab that is not receiving animation frames.
 *
 * `requestAnimationFrame` stops completely while the page is hidden, so a hidden
 * tab has to paint from a timer. One frame is drawn immediately as well: entering
 * the world resizes the canvas, and a resize clears the drawing buffer, so waiting
 * for the first timer tick left a cleared - black - buffer on screen.
 */
function startBackgroundLoop(): void {
  if (backgroundLoopTimer) return;
  backgroundLoopTimer = window.setInterval(() => {
    // Measured here too, not only in the animation loop: a hidden tab does not
    // receive animation frames, so this is the only frame cost a background pane
    // can report (`__pl.frameStats().cpuP50Ms`).
    const started = performance.now();
    renderFrame(0.1);
    recordRenderCost(performance.now() - started);
  }, 100);
  renderFrame(0.1);
}

function stopBackgroundLoop(): void {
  if (!backgroundLoopTimer) return;
  window.clearInterval(backgroundLoopTimer);
  backgroundLoopTimer = null;
}

// Dev panel and state
let devPanel: DevPanelAPI | null = null;
let plantRendererConfig: import('./config/plantRendererConfig.js').PlantRendererConfig | null =
  null;

// Growth options request timeout tracking (prevents "loading forever" on lost responses)
let growthOptionsTimeoutId: number | null = null;
const GROWTH_OPTIONS_TIMEOUT_MS = 5000;

function clearGrowthOptionsTimeout(): void {
  if (growthOptionsTimeoutId !== null) {
    window.clearTimeout(growthOptionsTimeoutId);
    growthOptionsTimeoutId = null;
  }
}

function showGrowthOptionsTimeoutError(): void {
  hideGrowthSelection();
  setDetail('Growth options timed out - retrying...');
  uiShell?.toast({ message: 'Growth options timed out', kind: 'error', durationMs: 5000 });
  clearGrowthOptionsTimeout();
}

let growthIntentTick = 0;
let plantBiomass = 0;
let plantEnergy = 0;
// C04: body-state HUD. The phase and structure arrive from the server; the
// biomass rate and the reroot countdown are display-only derivations.
let plantStatusHud: PlantStatusHudAPI | null = null;
let plantPhase: PlantPhase = 'rooted';
let uprootWindowEndsAtMs = 0;
let plantStructure: { damageHp: number; threshold: number } | null = null;
let plantMutationCount = 0;
let plantMutationUpkeep = 0;
let plantMutationEnergyUpkeep = 0;
let plantMutationBiomassUpkeep = 0;
let lastBiomassSample: { value: number; atMs: number } | null = null;
let smoothedBiomassRate: number | null = null;
let lastDamageToastAtMs = 0;
const rerootKeys = new Set<RerootDirection>();
let playerPanels: PlayerPanelsAPI | null = null;
let settingsPanel: SettingsPanelAPI | null = null;
let mutationState: MutationStateView | null = null;
let inventorySlots: Array<{ itemId: string; count: number } | null> = [];
let inventoryMaxSlots = 10;
// Definitions arrive with INVENTORY_SYNC. The dev panel grants items by id, so
// it needs the same list the server uses - a hardcoded menu would drift from
// config/items.json the first time an item is renamed.
let inventoryDefinitions: ItemDefinitionView[] = [];
let lastPanelRefreshAtMs = 0;
let plantFirstSeenAtMs = 0;
let peakBiomass = 0;
let peakNodeCount = 0;
let weatherDayNumber = 1;
let weatherClock = '00:00';
/** The server's day fraction, kept beside the formatted clock for the day part. */
let weatherTimeOfDay = 0;
// Stored water/minerals are what growth actually waits on, so the HUD shows
// them next to their capacity — otherwise a stalled plant looks like a bug.
let plantWater = 0;
let plantMinerals = 0;
let plantWaterCapacity = 0;
let plantMineralCapacity = 0;
// Timestamp of the last shadow-map refresh (see renderFrame).
let lastShadowRefreshMs = 0;
// When the last full resource grid (65k tiles) arrived; 0 means never.
let resourceGridReceivedAt = 0;
// The welcome grid can arrive before the environment renderer exists; holding it
// here means the ground still gets its tile lighting instead of staying unlit.
let pendingResourceGrid: {
  gridBase64: string;
  width: number;
  height: number;
  tileSize: number;
} | null = null;
const RESOURCE_GRID_MAX_AGE_MS = 60_000;
// WebSocket traffic is chatty (state + resource messages every server tick), so
// per-message logging is opt-in via ?wslog=1 instead of flooding the console.
const DEBUG_WS_LOG = new URLSearchParams(window.location.search).has('wslog');
// Last authoritative tile readings, so growth events never zero the HUD.
let tileLight = 0;
let tileWater = 40; // Default base moisture from config (tile_moisture_base)
// Share of the local soil cavity filled with water, from the server's root
// update. Drives the cavity pool and the dev panel's water-table reading.
let localGroundwaterFraction = 0;
let tileMinerals = 0;

// Controls config loaded from server /config/controls endpoint.
// Loaded initially in initC01() before WebSocket connects; reloaded on WELCOME
// so bindings are available even if the server wasn't ready on first fetch.
let controlsConfig: ControlsConfig | null = null;
// Key rebinds belong to this device, not the account: stored beside the other
// local preferences and merged over the config every time the bus is built.
let controlOverrides: ControlOverrides = loadControlOverrides(window.localStorage);

/** The server's binding table with this device's rebinds applied. */
function currentBindings(): Record<string, Binding> {
  return mergeControlOverrides(controlsConfig?.bindings ?? {}, controlOverrides);
}

/** The action-bar pills whose badge is a key from the binding table. */
const ACTION_BAR_KEYS: Record<string, string> = {
  grow: 'grow_mode_toggle',
  rootsight: 'root_sight_toggle',
  inventory: 'inventory_overview_toggle',
  emotes: 'emote_wheel',
  hints: 'hint_card_toggle',
};

/** Keep the on-screen key badges honest after a rebind or a config reload. */
function syncActionBarKeys(): void {
  if (!actionBar) return;
  const table = currentBindings();
  for (const [id, action] of Object.entries(ACTION_BAR_KEYS)) {
    const key = table[action]?.keys[0];
    actionBar.setKey(id, key ? prettyKey(key) : null);
  }
}

// Track which plants have Root Sight already enabled, to avoid resetting
// the state machine (and flickering aura circles) on every new underground node.
const rootSightActivePlants = new Set<string>();
let storedWater = 0;
let storedMinerals = 0;
const plantNodes = new Map<string, PlantNodeData>();
/** T06: plants whose uproot we have already announced, so the toast is once. */
const uprootNotified = new Set<string>();

// Plant mirror state for gap detection and resync (Phase 1.5)
let plantGrowthSeq = 0;
let plantLastResyncAt = 0;
let lastPeriodicResyncAt = 0;
const PLANT_RESYNC_COOLDOWN_MS = 5000;

function requestPlantResync(): void {
  const now = Date.now();
  if (now - plantLastResyncAt < PLANT_RESYNC_COOLDOWN_MS) return;
  plantLastResyncAt = now;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: MESSAGE_TYPE.PLANT_SYNC_REQUEST, payload: {} }));
  }
}

function resetPlantMirror(): void {
  plantGrowthSeq = 0;
  plantLastResyncAt = 0;
  nodeInterpolator.clear();
  interpolatedNodes.clear();
}

/**
 * Keep only nodes of the plant this session belongs to.
 *
 * Node names carry the plant tag (`<tag>:seed.radicle0`), so a leftover from a
 * previous world - or a sibling plant whose events arrived late - is
 * identifiable and can be dropped. Without this a stale node stays in the
 * mirror forever and is drawn as a piece of your plant floating where the old
 * one stood.
 */
function pruneNodesNotFromPlant(): void {
  if (!plantId) return;
  // The tag length is the server's minting rule, not a number copied here. It was
  // copied, at eight characters, and INV-GR-05 had already moved the server to
  // sixteen: `startsWith` then failed for every node the server had made, so the
  // first growth event pruned the entire mirror - the plant vanished, Root Sight's
  // cavity emptied with it, and both returned when the next sync arrived.
  for (const id of [...plantNodes.keys()]) {
    if (!nodeBelongsToPlant(id, plantId)) plantNodes.delete(id);
  }
  pruneStreamedNodeInterpolation();
}

/**
 * Drop interpolation state for nodes that no longer exist.
 *
 * A plant can die or be removed mid-tumble, and its streamed positions would
 * otherwise stay in the interpolator for the rest of the session: the map would
 * keep dead node references alive and every frame would write to a body nobody
 * draws.
 */
function pruneStreamedNodeInterpolation(): void {
  if (interpolatedNodes.size === 0) return;
  const keep = new Set<string>();
  for (const id of plantNodes.keys()) keep.add(id);
  for (const nodes of otherPlayerPlants.values()) {
    for (const id of nodes.keys()) keep.add(id);
  }
  nodeInterpolator.prune(keep);
  for (const id of interpolatedNodes.keys()) {
    if (!keep.has(id)) interpolatedNodes.delete(id);
  }
}

// Two-step growth selection state machine (ADR-018, ADR-028)
const growthSelectionMachine = createGrowthSelectionStateMachine();

// Growth aiming gizmo: the meshes and their overlay canvas live in
// `render/growthAimGizmo.ts`, built on first use. What stays here is the aim
// state (yaw, pitch, drag, commit) and the per-frame transforms it writes onto
// the meshes.
let growthAimGizmoInstance: GrowthAimGizmo | null = null;

function aimGizmo(): GrowthAimGizmo {
  growthAimGizmoInstance ??= createGrowthAimGizmo(appContext, {
    getDrawingData: () => growthSelectionStateMachineGetDrawingData(growthSelectionMachine) ?? null,
    isAnchorOnNodeSurface: () => growthAimAnchorOnNodeSurface,
    ringAnchor: growthAimRingAnchor,
    isDropVisible: () => growthAimDropVisible,
    renderConfig: () => renderConfig,
    visualRadiusOf: (node) => resolveDrawnRadius(node.nodeType, node.radius ?? 0.05, node.biomass),
    drawCentreOf: (node) => growthAimNodeDrawCentre(node),
  });
  return growthAimGizmoInstance;
}

function removeGrowthDirectionLine(): void {
  aimGizmo().hide();
}

/** Draw the aim gizmo above the plant/ground overlay canvas. */
function renderGrowthAimOverlay(): void {
  aimGizmo().render();
}

// Smoothed growth direction dragging state (silky smooth, non-rigid)
const smoothedGrowthDir = new THREE.Vector3(0, -1, 0);
let smoothedGrowthDist = 1.0;
let isGrowthAtMaxReach = false;
let isGrowthAngleClamped = false;
// Optional point on the selected node where the player last placed the ring.
// It is an offset from the drawn node centre, so it follows the node as it grows.
const growthAimSurfaceOffset = new THREE.Vector3();
let growthAimAnchorOnNodeSurface = false;

/** Rebuild the ring and curved arrow for the current aim. */
function updateGrowthDirectionLine(
  start: { x: number; y: number; z: number },
  _end: { x: number; y: number; z: number },
  _isValid: boolean,
): void {
  const { group, ring, tube, head, tip, mouthDisc, tipRing, dropPost, dropDisc } =
    aimGizmo().ensure();
  const drawingData = growthSelectionStateMachineGetDrawingData(growthSelectionMachine);
  if (!drawingData) {
    group.visible = false;
    return;
  }

  // Preview exactly one real growth step: the server moves the new node by the
  // layer's growth distance, so the arrow is drawn at that same length and the
  // plant grows along the arrow instead of somewhere shorter.
  const optionKey = (drawingData.selectedOptionType ?? '').toLowerCase();
  const isRootOption = ROOT_OPTION_TYPES.has(optionKey);
  const reach = Math.max(
    0.02,
    growthSegmentConfig?.nodeLengths?.[optionKey] ??
      (isRootOption
        ? (growthSegmentConfig?.rootSegmentLength ?? 0.85)
        : (growthSegmentConfig?.canopySegmentLength ?? 0.95)),
  );
  growthAimPreviewReach = reach;
  // Anchor on the part as it is actually drawn: the seed mesh sits above the
  // ground by its own radius, everything else is centred on the node.
  const node = plantNodes.get(drawingData.nodeId);
  const visualRadius = node
    ? resolveDrawnRadius(node.nodeType, node.radius ?? 0.05, node.biomass)
    : 0.05;
  const isSeedNode = node ? node.isSeed === true || node.nodeType === 'seed' : false;
  const origin = new THREE.Vector3(start.x, start.y, start.z);
  if (isSeedNode) origin.y += visualRadius * getSeedBodyHeightRatio();
  if (growthAimAnchorOnNodeSurface && node) {
    // The player clicked a spot on the node. Use that exact surface point so the
    // ring can sit on the side, underside or back of the seed instead of always
    // riding the default attachment cap.
    origin.copy(growthAimNodeDrawCentre(node));
    origin.add(growthAimSurfaceOffset);
  }

  // The ring is the cross-section the new segment starts from: the emerging
  // part's own thickness (never fatter than the node it leaves).
  const emergingRadius = resolveDrawnRadius(drawingData.selectedOptionType, node?.radius ?? 0.05);
  const ringRadius = Math.max(
    renderConfig?.growthAimRingMin ?? 0.02,
    Math.min(visualRadius, emergingRadius * (renderConfig?.growthAimRingScale ?? 1.6)),
  );
  growthAimRingRadius = ringRadius;

  // Where the ring sits and which way its plane faces, in one rule. It is the
  // cross-section the new segment leaves from, so its plane is perpendicular to
  // the parent's own drawn axis at the attachment - not to the aim. Orienting by
  // the aim tilted the ring across the arrow on a lateral bud or a clamped aim,
  // which is what read as "not facing the right way in 3D".
  const parentNode = node?.parentId ? plantNodes.get(node.parentId) : undefined;
  const parentTangent =
    node && parentNode ? drawnNodePosition(node).sub(drawnNodePosition(parentNode)) : null;
  const planetRadiusForUp = renderConfig?.planetRadiusM ?? 0;
  const ringFrame = ringFrameFor({
    attach: origin,
    parentTangent,
    aim: smoothedGrowthDir,
    surfaceUp:
      planetRadiusForUp > 0
        ? planetUp(planetRadiusForUp, origin.x, origin.z)
        : new THREE.Vector3(0, 1, 0),
    partRadiusM: visualRadius,
  });
  const surfaceNormal = ringFrame.normal;
  const ringCentre = growthAimAnchorOnNodeSurface
    ? origin.clone().addScaledVector(surfaceNormal, 0.003)
    : ringFrame.center;
  growthAimRingAnchor.copy(ringCentre);
  growthAimRingNormal.copy(surfaceNormal);

  // Visibility against the plant is decided every frame in
  // `updateGrowthAimOcclusion`, where the live camera position is available.

  // Keep the tube a real world thickness: scaling a fat torus down to a small
  // radius would make the ring vanish into a sub-pixel hairline.
  const ringThickness = renderConfig?.growthAimRingThickness ?? 0.004;
  if (Math.abs(growthAimRingBuiltRadius - ringRadius) > 1e-5) {
    ring.geometry.dispose();
    ring.geometry = new THREE.TorusGeometry(1, ringThickness / ringRadius, 8, 64);
    growthAimRingBuiltRadius = ringRadius;
  }

  const normal = growthAimNormal.clone();
  if (normal.lengthSq() < 0.5) normal.set(0, 1, 0);
  normal.normalize();

  aimGizmo().show();

  // The torus lies in its local XY plane, so map +Z onto the surface normal.
  ring.position.copy(ringCentre);
  ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), surfaceNormal);
  ring.scale.setScalar(ringRadius);

  // The arrow bends along the plant's own habit: the player steers a general
  // direction and the exact shape stays a surprise.
  const side = new THREE.Vector3().crossVectors(smoothedGrowthDir, normal);
  if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
  side.normalize();
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const bend = Math.sin(t * Math.PI) * (renderConfig?.growthAimCurveBend ?? 0.24) * reach;
    const wobble = Math.sin(t * Math.PI * 2) * (renderConfig?.growthAimCurveWobble ?? 0.05) * reach;
    points.push(
      ringCentre
        .clone()
        .addScaledVector(smoothedGrowthDir, reach * t)
        .addScaledVector(side, bend + wobble),
    );
  }
  growthAimPath = points;
  tube.geometry.dispose();
  // A tapering tube: fat where it leaves the part, narrow at the point. The
  // silhouette then has a direction even when the arrow is seen end-on, which a
  // constant-width tube never had.
  tube.geometry = buildTaperedTubeGeometry(
    points,
    renderConfig?.growthAimTubeRadius ?? 0.009,
    0.45,
    7,
  );

  const tipPoint = points[points.length - 1];
  const heading = tipPoint
    .clone()
    .sub(points[points.length - 2])
    .normalize();
  // The head scales with the arrow so a one-metre root and a two-metre trunk
  // both get a head you can see, and its size still reads as "this much".
  const headRadius = THREE.MathUtils.clamp(reach * 0.055, 0.022, 0.07);
  const headLength = THREE.MathUtils.clamp(reach * 0.16, 0.05, 0.2);
  if (
    Math.abs(growthAimHeadBuilt.radius - headRadius) > 1e-3 ||
    Math.abs(growthAimHeadBuilt.length - headLength) > 1e-3
  ) {
    head.geometry.dispose();
    head.geometry = new THREE.ConeGeometry(headRadius, headLength, 12);
    growthAimHeadBuilt = { radius: headRadius, length: headLength };
  }
  // Cone apex on the arrow's end: the base sits back along the tube, so the head
  // continues the taper instead of floating in front of it.
  head.position.copy(tipPoint).addScaledVector(heading, -headLength * 0.5);
  head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), heading);
  // Sit the bud dot on the arrow's point, not at the cone's centre.
  tip.position.copy(tipPoint);
  tip.scale.setScalar(Math.max(0.6, headRadius / 0.032));
  mouthDisc.position.copy(ringCentre);
  mouthDisc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), surfaceNormal);
  mouthDisc.scale.setScalar(ringRadius * 0.94);
  tipRing.position.copy(tipPoint);
  tipRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), heading);
  tipRing.scale.setScalar(ringRadius * 1.15);

  // Ground marker: a post from the tip down (or up) to the soil, and a disc on
  // the soil under it. This is the cue that ties the floating arrow to a place
  // in the world, which is exactly what "it points somewhere else" was about.
  {
    // The drawn ground, not a second terrain query: this used the raw terrain
    // field, so after a tunnel edit or on the water skin the post and disc sat
    // above or below the soil the player can actually see.
    const groundY = groundMarkerHeight((x, z) => clientSurfaceY(x, z, 0), tipPoint.x, tipPoint.z);
    const drop = tipPoint.y - groundY;
    growthAimDropVisible = Math.abs(drop) > 0.05;
    if (growthAimDropVisible) {
      const postRadius = Math.max(0.0015, ringRadius * 0.06);
      dropPost.visible = true;
      dropPost.position.set(tipPoint.x, (tipPoint.y + groundY) * 0.5, tipPoint.z);
      dropPost.scale.set(postRadius, Math.abs(drop), postRadius);
      dropPost.quaternion.identity();
      dropDisc.visible = true;
      dropDisc.position.set(tipPoint.x, groundY + 0.004, tipPoint.z);
      dropDisc.rotation.set(-Math.PI / 2, 0, 0);
      dropDisc.scale.setScalar(ringRadius * 1.35);
    } else {
      dropPost.visible = false;
      dropDisc.visible = false;
    }
  }
}

// Growth aiming state. The player never drags a line: picking an option starts
// an aim, the plant proposes a direction from its own growth bias, and dragging
// simply turns that arrow. Commit with the Grow button or Enter.
const growthAimNormal = new THREE.Vector3(0, 1, 0);
let growthAimRingRadius = 0.28;
let growthAimRingBuiltRadius = -1;
// Cached arrow-head size, so a drag rebuilds the cone only when it changes.
let growthAimHeadBuilt = { radius: 0, length: 0 };
// The ground marker is only meaningful when the tip is off the soil.
let growthAimDropVisible = false;
const growthAimRingAnchor = new THREE.Vector3();
const growthAimRingNormal = new THREE.Vector3(0, 1, 0);
let growthAimPath: THREE.Vector3[] = [];
let growthAimPreviewReach = 0;
let growthSegmentConfig: GrowthSegmentConfig | null = null;
// Day/night length and tile ranges, so the client clock and the ground shader
// normalisation both come from the server's config rather than constants.
let dayNightConfig: DayNightConfig = { cycleLengthS: 3600, dayFraction: 0.5 };
let tileConfig: ResourceTileConfig = {
  tileLightBase: 80,
  maxLight: 500,
  maxMoisture: 500,
  maxMinerals: 500,
  rates: {
    photosynthesisRate: 1,
    diffusionRate: 0.03,
    maxAbsorptionPerTick: 1,
    rainGainPerS: 1.5,
    evaporationPerS: 0.025,
    canopyShadeReduction: 0.1,
    groundwaterCapacity: 400,
  },
};
const ROOT_OPTION_TYPES = new Set(['radicle', 'root', 'lateral_root']);
let growthAimYaw = 0;
let growthAimPitch = 0;
let growthAimDragging = false;
let growthAimLastX = 0;
let growthAimLastY = 0;
// A press that starts a growth drag must not also be read as a click on the
// canvas, or releasing the arrow would close the panel it is aiming from.
let suppressGrowthClickUntil = 0;

// A lateral root or branch buds part-way along its parent's own segment, so the
// aim gizmo has to start where the server will attach it, not at the parent's
// tip. The drawn ring/arrow and the drag/pick hit tests all ask this helper, so
// the thing the player aims at is exactly the thing the server grows from.
function branchAttachAnchor(position: THREE.Vector3, nodeId: string): THREE.Vector3 {
  const node = plantNodes.get(nodeId);
  const anchor = position.clone();
  if (!node) return anchor;
  const emergingType =
    growthSelectionStateMachineGetDrawingData(growthSelectionMachine)?.selectedOptionType ?? '';
  const fraction = resolveAttachFraction(emergingType, undefined);
  if (fraction < 1 && node.parentAttachX !== undefined && node.parentAttachY !== undefined) {
    const segmentStart = new THREE.Vector3(
      node.parentAttachX,
      node.parentAttachY,
      node.parentAttachZ ?? node.position.z,
    );
    // Interpolate toward where the part is *drawn right now*, not toward the
    // position it will reach when it finishes growing. A node that is still
    // emerging is drawn at its start; using the target put the ring ahead of the
    // visible tip, which looked like the gizmo had jumped onto another stem.
    anchor.copy(segmentStart.lerp(drawnNodePosition(node), fraction));
  }
  // Keep the ring on the part the player selected, and on its own surface. The
  // old clamp allowed a metre and a half of drift, which is several segments of a
  // seedling: a child root whose attach point was stale, or whose attach fraction
  // was small because it had only just sprouted, had its gizmo parked on the
  // parent it grew out of instead of on itself. The allowance is the node's own
  // drawn size, so the ring can slide over its surface but never onto a sibling.
  return clampAnchorToNode(
    anchor,
    drawnNodePosition(node),
    Math.max(0.1, resolveDrawnRadius(node.nodeType, node.radius ?? 0.05, node.biomass) * 1.25),
  );
}

/**
 * Where a node is drawn at this instant, including its growth animation.
 *
 * Every gizmo anchor goes through this, so the ring, the pick sphere and the
 * arrow all sit on the part as the player sees it rather than on the coordinates
 * the server will eventually fill.
 */
function drawnNodePosition(node: PlantNodeData): THREE.Vector3 {
  const parent = node.parentId ? plantNodes.get(node.parentId) : undefined;
  return resolveDrawnNodePosition(node, parent, plantNodes.values());
}

/** Centre of the drawn node mesh, including the seed's raised body. */
function growthAimNodeDrawCentre(node: PlantNodeData): THREE.Vector3 {
  const centre = drawnNodePosition(node);
  const isSeed = node.isSeed === true || node.nodeType === 'seed';
  if (isSeed) {
    const radius = resolveDrawnRadius(node.nodeType, node.radius ?? 0.05, node.biomass);
    centre.y += radius * getSeedBodyHeightRatio();
  }
  return centre;
}

/**
 * Pick the point under the pointer on the selected node, or null on a miss.
 * The node is approximated by its drawn sphere, which is exact for the seed and
 * conservative for a stem or root segment.
 */
function pickGrowthAimNodePoint(clientX: number, clientY: number): THREE.Vector3 | null {
  const data = growthSelectionStateMachineGetDrawingData(growthSelectionMachine);
  const node = data ? plantNodes.get(data.nodeId) : undefined;
  if (!node) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const radius = Math.max(
    0.025,
    // The seed is drawn as an ovoid taller than its radius; a tight sphere only
    // let the player grab the middle band of it. A slightly generous pick sphere
    // reaches the coat's top and buried base too.
    resolveDrawnRadius(node.nodeType, node.radius ?? 0.05, node.biomass) * 1.6,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(
    new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    ),
    camera,
  );
  const hit = new THREE.Vector3();
  if (
    !raycaster.ray.intersectSphere(new THREE.Sphere(growthAimNodeDrawCentre(node), radius), hit)
  ) {
    return null;
  }
  // A pick is 3D, not a projection: a ray through the front of the plant must not
  // reach a node on its far side. If the drawn plant is hit before the node's own
  // sphere, the pointer is on some other part and this node is behind it.
  const surfaces = plantRenderer?.pickSurfaces() ?? [];
  if (surfaces.length > 0) {
    const surfaceHit = raycaster.intersectObjects(
      surfaces.map((surface) => surface.object),
      false,
    )[0];
    if (surfaceHit && surfaceHit.distance < hit.distanceTo(camera.position) - 0.02) return null;
  }
  return hit;
}

/** Put the aim ring at the point under the pointer on the selected node. */
function placeGrowthAimRingFromScreen(clientX: number, clientY: number): boolean {
  const data = growthSelectionStateMachineGetDrawingData(growthSelectionMachine);
  const node = data ? plantNodes.get(data.nodeId) : undefined;
  const hit = pickGrowthAimNodePoint(clientX, clientY);
  if (!node || !hit) return false;
  growthAimSurfaceOffset.copy(hit).sub(growthAimNodeDrawCentre(node));
  growthAimAnchorOnNodeSurface = true;
  return true;
}

function growthAimDirectionFromAngles(): THREE.Vector3 {
  const cp = Math.cos(growthAimPitch);
  return new THREE.Vector3(
    Math.sin(growthAimYaw) * cp,
    Math.sin(growthAimPitch),
    Math.cos(growthAimYaw) * cp,
  );
}

/** Rebuild the shared growth direction from the current aim angles (gene clamped). */
function applyGrowthAimAngles(): void {
  const data = growthSelectionStateMachineGetDrawingData(growthSelectionMachine);
  const optionType = data?.selectedOptionType ?? 'stem';
  const raw = growthAimDirectionFromAngles();
  const clamped = clampGrowthDirectionByGene(optionType, { x: raw.x, y: raw.y, z: raw.z });
  isGrowthAngleClamped = Math.abs(clamped.y - raw.y) > 0.08;
  smoothedGrowthDir.set(clamped.x, clamped.y, clamped.z).normalize();
  if (data) {
    // Start the gizmo on the attachment point, not the part's tip: a lateral
    // root or branch leaves its parent part-way down that parent's segment.
    // The position comes from the part as drawn (a node still emerging sits at
    // its own start), so the ring is always on something visible.
    const node = plantNodes.get(data.nodeId);
    const anchor = branchAttachAnchor(
      node
        ? drawnNodePosition(node)
        : new THREE.Vector3(data.nodePosition.x, data.nodePosition.y, data.nodePosition.z),
      data.nodeId,
    );
    updateGrowthDirectionLine(
      anchor,
      {
        x: anchor.x + smoothedGrowthDir.x * smoothedGrowthDist,
        y: anchor.y + smoothedGrowthDir.y * smoothedGrowthDist,
        z: anchor.z + smoothedGrowthDir.z * smoothedGrowthDist,
      },
      true,
    );
  }
}

/** Start aiming a new segment from a node: surface ring + curved arrow preview. */
function beginGrowthAiming(nodeId: string, optionType: string, optionLabel: string): boolean {
  // Choosing a root option is already a request to see roots.
  noteUndergroundGrowth(optionType);
  const node = plantNodes.get(nodeId);
  if (!node) return false;
  growthAimSurfaceOffset.set(0, 0, 0);
  growthAimAnchorOnNodeSurface = false;
  const constraints =
    NODE_GROWTH_CONSTRAINTS[optionType as NodeType] ?? NODE_GROWTH_CONSTRAINTS.stem;
  const parent = node.parentId ? plantNodes.get(node.parentId) : undefined;

  // Surface the ring lies on: the soil plane for anything at ground level (a
  // seed or the root crown), otherwise a collar perpendicular to the link the
  // part grew along.
  // "At the surface" is a terrain question, not an absolute-Y one. On a planet
  // a node lying on the soil has a world Y of metres, so `Math.abs(y) < 0.18`
  // called every hillside node off-surface and based its frame on the link
  // instead of the ground.
  const nodeGroundY = clientSurfaceY(node.position.x, node.position.z, 0);
  const atSurface = node.isSeed === true || node.position.y <= nodeGroundY + 0.18;
  if (atSurface || !parent) {
    growthAimNormal.set(0, 1, 0);
  } else {
    growthAimNormal.copy(node.position).sub(parent.position);
    if (growthAimNormal.lengthSq() < 1e-5) growthAimNormal.set(0, 1, 0);
    else growthAimNormal.normalize();
  }

  // "Direction according to its own self": start where the part already points.
  const outward = new THREE.Vector3();
  if (parent) outward.copy(node.position).sub(parent.position);
  outward.y = 0;
  if (outward.lengthSq() < 1e-4) {
    camera.getWorldDirection(outward);
    outward.y = 0;
  }
  if (outward.lengthSq() < 1e-4) outward.set(0, 0, 1);
  growthAimYaw = Math.atan2(outward.x, outward.z);
  growthAimPitch = constraints.downwardPreferred ? -1.0 : constraints.upwardPreferred ? 0.95 : 0.3;

  // Ring size is derived from the part's rendered radius in the gizmo update, so
  // it hugs the stem/node instead of being a fixed halo.
  smoothedGrowthDist = Math.min(1.0, constraints.maxReach * 0.7);
  isGrowthAtMaxReach = false;

  growthSelectionStateMachineStartDrawing(
    growthSelectionMachine,
    nodeId,
    (() => {
      const drawn = drawnNodePosition(node);
      return { x: drawn.x, y: drawn.y, z: drawn.z };
    })(),
    optionType,
    optionLabel,
  );
  // Camera controls stay live: orbiting must never be captured by the aim gizmo.
  // Only a drag that starts on the part itself turns the arrow.
  applyGrowthAimAngles();
  showGrowthAimControls();
  contextHint?.show({
    id: 'grow-aim',
    text: `${optionLabel}: drag to turn the direction, then Grow.`,
    touchText: `${optionLabel}: drag the arrow to turn it, then press Grow.`,
    key: 'Enter',
  });
  return true;
}

/** Turn the aim from a pointer delta (yaw around the part, pitch up/down). */
const growthAimCameraRight = new THREE.Vector3();
const growthAimCameraUp = new THREE.Vector3();

/**
 * Turn the aimed direction from a screen-space drag.
 *
 * The old version subtracted dx from a world yaw and added dy to a world
 * pitch. That is only correct for a camera looking down +Z: from any other
 * orbit, dragging right swung the arrow left and dragging down pushed it up.
 * Mapping the drag through the camera's own right/up vectors makes the arrow
 * follow the cursor from every angle.
 */
function rotateGrowthAim(dx: number, dy: number): void {
  growthAimCameraRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  growthAimCameraUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  const next = aimDirectionFromScreenDrag(
    growthAimDirectionFromAngles(),
    growthAimCameraRight,
    growthAimCameraUp,
    dx,
    dy,
  );
  growthAimYaw = Math.atan2(next.x, next.z);
  growthAimPitch = THREE.MathUtils.clamp(
    Math.asin(THREE.MathUtils.clamp(next.y, -1, 1)),
    -1.45,
    1.45,
  );
  applyGrowthAimAngles();
}

/** Confirm the aimed direction and send the growth intent. */
function commitGrowthAim(): void {
  const data = growthSelectionStateMachineGetDrawingData(growthSelectionMachine);
  if (!data) return;
  const dir = { x: smoothedGrowthDir.x, y: smoothedGrowthDir.y, z: smoothedGrowthDir.z };
  removeGrowthDirectionLine();
  controls.enabled = true;
  controls.enableRotate = true;
  controls.enablePan = true;
  confirmGrowth(data.nodeId, data.selectedOptionType, dir);
}

let growthGrowButton: HTMLButtonElement | null = null;

/**
 * One Grow control for the whole panel. It exists before an option is chosen
 * (disabled), so the player never has to wonder where the action went, and it
 * only becomes active once an available option is being aimed.
 */
function ensureGrowthFooter(): HTMLButtonElement | null {
  const panel = growthSelectionPanel;
  if (!panel) return null;
  let footer = panel.querySelector<HTMLElement>('#growth-aim-controls');
  if (!footer) {
    footer = document.createElement('div');
    footer.id = 'growth-aim-controls';
    const growBtn = document.createElement('button');
    growBtn.type = 'button';
    growBtn.textContent = 'Grow';
    growBtn.className = 'hud-button hud-button--primary';
    growBtn.title = 'Choose a growth option first';
    growBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!growBtn.disabled) commitGrowthAim();
    });
    footer.appendChild(growBtn);
    panel.appendChild(footer);
  }
  growthGrowButton = footer.querySelector<HTMLButtonElement>('button');
  return growthGrowButton;
}

function setGrowthGrowEnabled(enabled: boolean, reason = ''): void {
  const growBtn = ensureGrowthFooter();
  if (!growBtn) return;
  growBtn.disabled = !enabled;
  growBtn.classList.toggle('is-disabled', !enabled);
  growBtn.setAttribute('aria-disabled', String(!enabled));
  growBtn.title = enabled
    ? 'Grow this part along the arrow'
    : reason || 'Choose a growth option first';
}

/** Footer under the option cards while aiming: one plain commit button. */
function showGrowthAimControls(): void {
  setGrowthGrowEnabled(true);
}

// Growth debug readout (dev panel, Debug tab). Covers every growth-side value that decides how a
// new part appears: graph position, radius, the model/visual mapping, the aim
// frame, and how the aim relates to the design's growth bias for that part.
let growthDebugEl: HTMLDivElement | null = null;
let growthDebugVisible = false;

const growthDebugNum = (value: number | undefined, digits = 2): string =>
  (Number.isFinite(value) ? Number(value) : 0).toFixed(digits);

function ensureGrowthDebugPanel(): HTMLDivElement | null {
  if (growthDebugEl) return growthDebugEl;
  const app = document.getElementById('app');
  if (!app) return null;
  const el = document.createElement('div');
  el.id = 'growth-debug';
  el.style.cssText = [
    'position:absolute',
    'left:12px',
    'bottom:130px',
    'z-index:400',
    'background:rgba(10,14,8,0.88)',
    'border:1px solid #3a4a2a',
    'border-radius:6px',
    'padding:8px 10px',
    'color:#dfe9c8',
    'font:11px/1.45 ui-monospace, "JetBrains Mono", monospace',
    'white-space:pre',
    'pointer-events:none',
    'display:none',
    'max-width:min(680px, 62vw)',
    'max-height:56vh',
    'overflow:hidden',
  ].join(';');
  app.appendChild(el);
  growthDebugEl = el;
  return el;
}

function toggleGrowthDebug(): void {
  const el = ensureGrowthDebugPanel();
  if (!el) return;
  growthDebugVisible = !growthDebugVisible;
  el.style.display = growthDebugVisible ? 'block' : 'none';
  if (growthDebugVisible) updateGrowthDebug();
}

function updateGrowthDebug(): void {
  if (!growthDebugVisible) return;
  const el = ensureGrowthDebugPanel();
  if (!el) return;

  const nodes = [...plantNodes.values()].filter((node) => node.isOwnPlant);
  const data = growthSelectionStateMachineGetDrawingData(growthSelectionMachine);
  const lines: string[] = [`GROWTH DEBUG  nodes=${nodes.length}`];

  // Where the plant lands on the canvas versus the canvas centre. This uses the
  // same camera the WebGPU draw path builds its view-projection from, so it is
  // the frame the player actually sees: a mismatch here is a real camera bug,
  // not a stale screenshot.
  const frameRoot = nodes.find((node) => node.parentId === null);
  if (frameRoot) {
    camera.updateMatrixWorld(true);
    const projected = tempCameraOffset
      .set(frameRoot.position.x, frameRoot.position.y, frameRoot.position.z)
      .project(camera);
    const canvasEl = renderer.domElement;
    const px = Math.round((projected.x * 0.5 + 0.5) * canvasEl.clientWidth);
    const py = Math.round((-projected.y * 0.5 + 0.5) * canvasEl.clientHeight);
    const centreX = Math.round(canvasEl.clientWidth / 2);
    const centreY = Math.round(canvasEl.clientHeight / 2);
    lines.push(`view  root px=(${px}, ${py}) centre=(${centreX}, ${centreY})`);
  }

  if (webgpuRenderer) {
    lines.push(
      `mesh verts=${webgpuRenderer.getVertexCount()} plants=${webgpuRenderer.getPlantCount()}`,
    );
    lines.push(
      'rootSight=' +
        (webgpuRenderer.rootSightEnabled ? 'on' : 'off') +
        ' r=' +
        growthDebugNum(webgpuRenderer.rootSightRadius),
    );
  }

  if (data) {
    const type = data.selectedOptionType;
    const c = NODE_GROWTH_CONSTRAINTS[type as NodeType] ?? NODE_GROWTH_CONSTRAINTS.stem;
    const node = plantNodes.get(data.nodeId);
    lines.push('');
    lines.push(`AIM  ${type} "${data.selectedOptionLabel ?? ''}"`);
    lines.push(
      ' state=' +
        growthSelectionStateMachineGetState(growthSelectionMachine) +
        ' dragging=' +
        growthAimDragging,
    );
    lines.push(
      ' origin=(' +
        growthDebugNum(data.nodePosition.x) +
        ', ' +
        growthDebugNum(data.nodePosition.y) +
        ', ' +
        growthDebugNum(data.nodePosition.z) +
        ')',
    );
    lines.push(
      ' normal=(' +
        growthDebugNum(growthAimNormal.x) +
        ', ' +
        growthDebugNum(growthAimNormal.y) +
        ', ' +
        growthDebugNum(growthAimNormal.z) +
        ')',
    );
    lines.push(
      ' dir=(' +
        growthDebugNum(smoothedGrowthDir.x) +
        ', ' +
        growthDebugNum(smoothedGrowthDir.y) +
        ', ' +
        growthDebugNum(smoothedGrowthDir.z) +
        ')',
    );
    lines.push(
      ' yaw=' +
        growthDebugNum(THREE.MathUtils.radToDeg(growthAimYaw), 1) +
        'deg pitch=' +
        growthDebugNum(THREE.MathUtils.radToDeg(growthAimPitch), 1) +
        'deg',
    );
    lines.push(
      ' reach=' +
        growthDebugNum(growthAimPreviewReach) +
        ' ringR=' +
        growthDebugNum(growthAimRingRadius) +
        ' clamped=' +
        (isGrowthAngleClamped ? 'yes' : 'no') +
        ' maxReach=' +
        (isGrowthAtMaxReach ? 'yes' : 'no'),
    );
    lines.push(
      ` gizmo anchor=(${growthDebugNum(growthAimRingAnchor.x)}, ${growthDebugNum(
        growthAimRingAnchor.y,
      )}, ${growthDebugNum(growthAimRingAnchor.z)}) n·dir=${growthDebugNum(
        growthAimRingNormal.dot(smoothedGrowthDir),
      )} grab=${growthDebugNum(renderConfig?.growthAimGrabPx ?? 34, 0)}px`,
    );
    lines.push(
      ' gene minY=' +
        c.minY +
        ' maxY=' +
        c.maxY +
        ' horizontal=[' +
        c.minHorizontal +
        ', ' +
        c.maxHorizontal +
        '] bias=' +
        (c.downwardPreferred ? 'down' : c.upwardPreferred ? 'up' : 'outward'),
    );
    if (node) {
      const parent = node.parentId ? plantNodes.get(node.parentId) : undefined;
      lines.push(
        ' part type=' +
          node.nodeType +
          ' visualType=' +
          node.type +
          ' radius=' +
          growthDebugNum(node.radius) +
          ' biomass=' +
          growthDebugNum(node.biomass),
      );
      lines.push(
        ' part pos=(' +
          growthDebugNum(node.position.x) +
          ', ' +
          growthDebugNum(node.position.y) +
          ', ' +
          growthDebugNum(node.position.z) +
          ') parent=' +
          (parent ? parent.nodeType : 'none') +
          ' prog=' +
          growthDebugNum(node.growthProgress),
      );
      lines.push(
        ' design attachAt=' +
          (parent && parent.nodeType === 'seed' ? 'seed crown/base' : 'parent tip') +
          ' groundLevel=' +
          (Math.abs(node.position.y) < 0.18 ? 'yes' : 'no'),
      );
    }
  } else {
    lines.push('');
    lines.push('AIM  idle (select a part, then an option)');
  }

  lines.push('');
  lines.push('OWN NODES');
  for (const node of nodes.slice(0, 14)) {
    const parent = node.parentId ? plantNodes.get(node.parentId) : undefined;
    lines.push(
      ' ' +
        node.id.slice(-4) +
        ' ' +
        String(node.nodeType).padEnd(10) +
        ' r=' +
        growthDebugNum(node.radius) +
        ' pos=(' +
        growthDebugNum(node.position.x) +
        ', ' +
        growthDebugNum(node.position.y) +
        ', ' +
        growthDebugNum(node.position.z) +
        ') prog=' +
        growthDebugNum(node.growthProgress) +
        ' ' +
        (parent ? `p=${parent.nodeType}` : 'root'),
    );
  }

  el.textContent = lines.join('\n');
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
let targetCameraDistance = -1; // Desired distance from target; smoothly lerps when > 0
/**
 * The orbit floor actually in force, eased towards `currentCameraMinDistance()`.
 *
 * Root Sight raises the floor to the cavity mouth's clearance the instant the
 * cavity exists; applying that in one frame teleported the eye outwards.
 */
let cameraMinDistanceEased = 0;
const CAMERA_MIN_DISTANCE_EASE_S = 0.2;
/** Metres of orbit-floor rise allowed in one frame, whatever the frame took. */
const CAMERA_MIN_DISTANCE_MAX_RISE_M = 0.15;

function focusCameraOnNode(
  nodeData: PlantNodeData,
  lookup: Map<string, PlantNodeData> = plantNodes,
): void {
  // The local framing distance has no meaning while orbiting the whole planet.
  if (planetViewActive) return;
  // Frame the node where it is drawn, not where the model puts it: stubbed
  // nodes (cotyledons, crown stem) are drawn offset from their parent.
  const parentNode = nodeData.parentId ? lookup.get(nodeData.parentId) : undefined;
  const nodePos = resolveDrawnNodePosition(nodeData, parentNode, lookup.values()).clone();
  // If it's a seed, offset to visual seed center
  if (nodeData.isSeed || nodeData.nodeType === 'seed') {
    nodePos.y += (nodeData.radius || 0.08) * 0.25;
  }

  // Frame distance follows the node's own size, floored by the orbit minimum
  // that applies to it. Root nodes are framed much tighter than canopy nodes:
  // a root tip is the thing being inspected, not a whole stem.
  // Ground level decides the view, not the node's layer: the seed is the root
  // crown and carries layer 'root', yet it sits on the surface and must be read
  // from the side above ground, not from below it.
  const underground = nodeData.position.y < 0 || nodeData.type === 0;
  const frameMin = cameraMinDistanceForNode(nodeData);
  const sizeDistance = (nodeData.radius || 0.05) * (underground ? 12 : 25);
  const frameCeiling = underground ? 1.25 : 3.5;
  const frameDist = Math.max(frameMin * 2, Math.min(frameCeiling, sizeDistance));

  // A node focus is a single deterministic camera placement: a side view at a
  // shallow elevation, keeping the azimuth the player was already looking from.
  // It used to lerp the target and the distance instead, which left the framing
  // fighting the player every frame after the click.
  cancelCameraAutoMove();
  const horizontal = camera.position.clone().sub(controls.target);
  horizontal.y = 0;
  if (horizontal.lengthSq() < 1e-6) horizontal.set(0.8, 0, 0.6);
  horizontal.normalize();
  // The elevation the player is already at, not a scripted one. Focusing a part
  // is a pan and a zoom, and the view keeps its tilt: only a root focus is
  // allowed to drop the eye, and only as far as it already is if it is below.
  const currentRise = camera.position.y - controls.target.y;
  const currentDistance = Math.max(0.001, camera.position.distanceTo(controls.target));
  const riseRatio = currentRise / currentDistance;
  horizontal.y = underground
    ? Math.max(-0.55, Math.min(0.25, riseRatio))
    : Math.max(0.06, Math.min(0.9, riseRatio));
  horizontal.normalize();

  // Allow camera to go below the horizon for underground nodes,
  // but do NOT auto-enable Root Sight - that is a manual player toggle (R key).
  // A refit while Root Sight is open must not restore the surface limit: this is
  // the pass that ran when the plant's first nodes arrived or a part finished
  // growing, and it threw the eye back above the ground mid-cavity.
  controls.maxPolarAngle = underground ? Math.PI - 0.05 : rootSightPolarLimit();

  // Ease into the framing instead of teleporting. A jump straight to the new
  // position leaves no cue about which way the view turned, especially between
  // two nodes on opposite sides of a plant; a short eased travel reads as the
  // camera moving rather than the world being replaced.
  const destination = nodePos.clone().addScaledVector(horizontal, frameDist);
  startCameraFocus(nodePos, destination);
}

/**
 * A short eased camera travel, applied in the render loop.
 *
 * Both the orbit target and the eye are interpolated, so the look angle turns
 * with the camera instead of snapping at the end. Any player input cancels it
 * through cancelCameraAutoMove, which keeps the camera from fighting the hand.
 */
interface CameraFocusTween {
  fromTarget: THREE.Vector3;
  fromPosition: THREE.Vector3;
  toTarget: THREE.Vector3;
  toPosition: THREE.Vector3;
  elapsedMs: number;
  durationMs: number;
}
let cameraFocusTween: CameraFocusTween | null = null;
/** Scratch for the tween's eye-to-target offset; the tween rewrites it per frame. */
const cameraFocusOffset = new THREE.Vector3();

function startCameraFocus(toTarget: THREE.Vector3, toPosition: THREE.Vector3): void {
  const travel = camera.position.distanceTo(toPosition) + controls.target.distanceTo(toTarget);
  // Long hops get a little longer, but never so long that the camera feels
  // stuck: 260 ms for a nudge between two leaves, capped at 620 ms.
  const durationMs = Math.min(620, 260 + travel * 14);
  cameraFocusTween = {
    fromTarget: controls.target.clone(),
    fromPosition: camera.position.clone(),
    toTarget: toTarget.clone(),
    toPosition: toPosition.clone(),
    elapsedMs: 0,
    durationMs,
  };
}

function updateCameraFocus(deltaTime: number): void {
  const tween = cameraFocusTween;
  if (!tween) return;
  tween.elapsedMs += deltaTime * 1000;
  const t = Math.min(1, tween.elapsedMs / tween.durationMs);
  // Ease-in-out: the view accelerates away, then settles onto the node.
  const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  // Tween the framing, not the ground contact. The player's vertical physics owns
  // `controls.target.y` and runs before this every frame, so a tween that lerped
  // the target's height was overwritten a frame later and then re-lerped from the
  // new start: pressing Space pumped the whole view up and down for the length of
  // the tween. The target only moves in the plane, and the camera keeps the
  // tweened offset from wherever that target actually is.
  controls.target.x = THREE.MathUtils.lerp(tween.fromTarget.x, tween.toTarget.x, eased);
  controls.target.z = THREE.MathUtils.lerp(tween.fromTarget.z, tween.toTarget.z, eased);
  cameraFocusOffset.subVectors(tween.fromPosition, tween.fromTarget);
  tempCameraOffset.subVectors(tween.toPosition, tween.toTarget);
  cameraFocusOffset.lerp(tempCameraOffset, eased);
  camera.position.copy(controls.target).add(cameraFocusOffset);
  if (t >= 1) cameraFocusTween = null;
}

// Growth animation tracking - nodes with growthProgress < 1.0
const growingNodes = new Map<string, { startTime: number; duration: number }>();
// Growth animation tracking for other players' plants (nodeId -> {plantId, startTime, duration})
const otherGrowingNodes = new Map<
  string,
  { plantId: string; startTime: number; duration: number }
>();
let lastGrowthUpdateTime = 0;
// The mesh pass bakes emergent positions into its vertices, so it has to be fed
// at a cadence the eye reads as motion. 100 ms was ten frames a second: growth
// visibly stopped and then jumped forward. The SDF pass is repacked every frame
// below, so only the mesh needs an interval at all.
const GROWTH_UPDATE_INTERVAL_MS = 33;

// Selection highlight for the growth target (handled by WebGPU renderer).

// Other players' plants (plantId -> nodes)
const otherPlayerPlants = new Map<string, Map<string, PlantNodeData>>();

// Name tags above rival plants: mutation identity for the test gallery and for
// reading other players' builds at a glance.
let plantLabels: ReturnType<typeof createPlantLabelLayer> | null = null;
function plantLabelLayer(): ReturnType<typeof createPlantLabelLayer> | null {
  if (!plantLabels && scene) plantLabels = createPlantLabelLayer(scene);
  return plantLabels;
}

/** Keep each rival's tag above the highest point of its body. */
function updatePlantLabelPositions(): void {
  if (!plantLabels) return;
  for (const [plantId, nodes] of otherPlayerPlants) {
    let topY = -Infinity;
    let sx = 0;
    let sz = 0;
    let count = 0;
    for (const node of nodes.values()) {
      topY = Math.max(topY, node.position.y);
      sx += node.position.x;
      sz += node.position.z;
      count += 1;
    }
    if (count === 0 || !Number.isFinite(topY)) continue;
    const cx = sx / count;
    const cz = sz / count;
    const distance = camera.position.distanceTo(new THREE.Vector3(cx, topY, cz));
    const label = plantLabels;
    if (distance > 90) continue;
    // Size the tag in *screen* pixels rather than in metres. Growing a sprite
    // with distance (the old 0.16 m per metre, floored at 2.2 m) only kept its
    // plate roughly constant: a 16-character name came out under 6 screen pixels
    // per glyph, which is a smear at native resolution and unreadable once the
    // quality band is downscaling. A pixel size is the thing to hold constant.
    const viewportHeightPx = Math.max(1, renderer.domElement.clientHeight);
    const halfFovTan = Math.tan((camera.fov * Math.PI) / 360);
    const metresPerPixel = (2 * halfFovTan * Math.max(0.1, distance)) / viewportHeightPx;
    const tagHeight = label.sizeLabel?.(plantId, metresPerPixel, distance) ?? 0;
    label.place(plantId, cx, topY + 0.25 + tagHeight / 2, cz);
  }
}

// C01: Input abstraction - replaces hardcoded keydown/keyup
let inputBus: InputBus | null = null;
let uiShell: UIShell | null = null;
let mutationPanel: MutationPanelAPI | null = null;
let debugOverlay: DebugOverlay | null = null;
let qualityController: QualityController | null = null;
// One frame after the tab becomes visible is spent without a quality sample.
let skipQualitySample = false;
// AL-03: real GPU frame time when the driver exposes a timer query.
let gpuTimer: GpuTimer | null = null;
// AL-01 / ADR-027: dev-only size class, benchmark poses and pose timing.
let devSettings: DevSettings | null = null;
let benchmarkRunner: BenchmarkRunner | null = null;
let lastBenchmarkReport: BenchmarkReport | null = null;
// P0/2-B: positions the server streams between ticks (uproot/tumble).
const nodeInterpolator = new NodeInterpolator();
const interpolatedNodes = new Map<string, PlantNodeData>();
const interpolationPoint = { x: 0, y: 0, z: 0 };

// WebGPU renderer (C02b) - optional overlay on top of Three.js scene
let plantRenderer: PlantRenderer | null = null;
let webgpuRenderer: WebGPURenderer | null = null;
let webgpuDevice: WebGPUDevice | null = null;
let webgpuCanvas: HTMLCanvasElement | null = null;
let useWebGPU = false;
/**
 * True once a live WebGPU device has been lost.
 *
 * The renderer must not try WebGPU again on the same page after that: the
 * device is gone for this session, and re-initialising it would lose it again
 * (or worse, loop). The WebGL plant renderer takes over instead.
 */
let webgpuRetired = false;
let renderConfig: RenderConfig | null = null;
let shopConfig: ShopConfig = { enabled: true, title: 'Shop', currencyName: '', sections: [] };

/**
 * Server nodes are laid out on the flat simulation grid. On a planet that grid
 * is the surface at the pole, so a node at horizontal distance r has to drop by
 * the sphere's sag at r or it floats above the curved ground.
 */
/**
 * World height a seed's base belongs at.
 *
 * A seed is drawn as an ovoid standing on the soil: its stored height is the
 * contact point and the renderers lift the body by its half-height. On a slope
 * the ground under the uphill edge of the seed's own footprint stands above that
 * point, so the downhill rim of the body sinks into the hill - which is what a
 * seed on a hillside looked half-buried. Stand it on the highest ground under
 * its footprint instead, sampled all the way round because the slope can come
 * from any direction. Every path that turns a server node into drawn data uses
 * this, so the welcome snapshot and a growth event cannot disagree.
 */
function seedFootingY(x: number, z: number, y: number, radius: number): number {
  const planetRadiusM = renderConfig?.planetRadiusM ?? 0;
  const field = getTerrainParams();
  const aboveSurface = Math.max(0, y);
  // The drawn body is a little wider than the node radius (1.05 x), and the
  // terrain between samples can rise above the sample points, so probe a ring
  // rather than four points on it.
  const footprint = Math.max(0.02, radius) * 1.1;
  let footing = planetTerrainY(planetRadiusM, x, z, field) + aboveSurface;
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const ground = planetTerrainY(
      planetRadiusM,
      x + Math.cos(angle) * footprint,
      z + Math.sin(angle) * footprint,
      field,
    );
    if (ground + aboveSurface > footing) footing = ground + aboveSurface;
  }
  return footing;
}

/**
 * Draw position for a server node, with a seed standing on its highest footing.
 *
 * The STRUCTURE resync is authoritative: it replaces every node it carries, so a
 * footing applied only where a node is first seen is overwritten a second later
 * and the seed sinks back into the hillside. Everything that maps a server node
 * into draw space goes through here instead.
 */
function seedNodePosition(
  node: { x: number; z: number; y: number; isSeed?: boolean; type?: string },
  radius: number,
): THREE.Vector3 {
  const position = surfacePosition(node.x, node.z, node.y);
  if (node.isSeed ?? node.type === 'seed') {
    position.y = seedFootingY(node.x, node.z, node.y, radius);
  }
  return position;
}

function surfacePosition(x: number, z: number, y: number): THREE.Vector3 {
  const radius = renderConfig?.planetRadiusM ?? 0;
  return new THREE.Vector3(x, y + planetTerrainY(radius, x, z, getTerrainParams()), z);
}

/** True for a node the soil can open around: roots, the seed and buried parts. */
function isUndergroundNode(node: PlantNodeData): boolean {
  return (
    node.layer === 'root' ||
    node.isSeed === true ||
    node.nodeType === 'seed' ||
    (node.position?.y ?? 0) < -0.01 ||
    node.type === 0
  );
}

/** Server height (metres above the soil) as a client world height. */
function clientSurfaceY(x: number, z: number, y: number): number {
  return y + planetTerrainY(renderConfig?.planetRadiusM ?? 0, x, z, getTerrainParams());
}

/**
 * The ground query the underground tests use: the terrain field the ground mesh
 * is actually drawn from, so "underground" means under the visible soil.
 */
function soilQuery() {
  return { planetRadiusM: renderConfig?.planetRadiusM ?? 0, terrain: getTerrainParams() };
}

/**
 * A node's attach point on its parent, in the space the plant is drawn in.
 *
 * The server sends attach and target points in the same surface-relative frame
 * as node positions. Mapping only the positions left every segment starting
 * wherever the server's origin happened to be, so grown parts hung off the
 * plant instead of joining it.
 */
function clientAttach(x?: number, y?: number, z?: number) {
  const point = toClientSpace({ x, y, z }, clientSurfaceY);
  return point ? { parentAttachX: point.x, parentAttachY: point.y, parentAttachZ: point.z } : {};
}

/** Where a growing node is heading, in the space the plant is drawn in. */
function clientTarget(x?: number, y?: number, z?: number) {
  const point = toClientSpace({ x, y, z }, clientSurfaceY);
  return point ? { targetX: point.x, targetY: point.y, targetZ: point.z } : {};
}

// Fallback drawn radius for payloads that predate the server sending a radius.
// The canonical sizes live in the shared per-type table (`nodeRenderRadius`), so
// this only maps the legacy numeric visual type back to a node type. `y` is kept
// for call-site compatibility; depth/height tapering is the table's job now.
function nodeRadius(biomass: number, type = 1, _y = 0): number {
  const nodeType =
    type === 4 ? 'seed' : type === 3 ? 'leaf' : type === 2 ? 'vine' : type === 0 ? 'root' : 'stem';
  return nodeRenderRadius(nodeType, biomass);
}

// Growth system helpers (ADR-018 two-step gene-gated growth)

// Whole-plant framing distance follows how big the plant actually is. The old
// rule measured the distance from the seed to the furthest node and multiplied
// it by twelve, so a 1 m seedling was clamped to the 6 m start distance and
// read as a speck on the ground. Frame the plant's own bounding sphere instead,
// which is what "fill the view with this plant" means, and keep the start
// distance as the ceiling for mature ones.
function plantFrameDistance(): number {
  const start = renderConfig?.cameraStartDistance ?? 6;
  const min = renderConfig?.cameraMinDistance ?? 1;
  // A whole-plant framing has to fit the whole plant, so it may sit further back
  // than the *starting* distance: that number is where a new plant begins, not a
  // ceiling. Clamping the fit to it framed a 4 m body at 6 m, which cropped the
  // canopy off the top of the screen.
  const furthest = Math.max(min * 2, renderConfig?.cameraMaxDistance ?? 2000);
  const own = ownBodyNodes(
    Array.from(plantNodes.values()).filter((node) => node.isOwnPlant),
    plantId,
  );
  if (own.length === 0) return start;
  const bounds = new THREE.Box3();
  for (const node of own) {
    bounds.expandByPoint(tempTarget.set(node.position.x, node.position.y, node.position.z));
  }
  const radius = Math.max(0.08, bounds.getBoundingSphere(new THREE.Sphere()).radius);
  // Fit the sphere in the frame the player actually has: the vertical field of
  // view limits a tall plant, the horizontal one (from the aspect ratio) limits
  // a wide one, and a low camera looks at the plant along a shallow angle.
  const halfVertical = (camera.fov * Math.PI) / 360;
  const aspect = camera.aspect > 0 ? camera.aspect : 1;
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * aspect);
  const halfAngle = Math.max(0.05, Math.min(halfVertical, halfHorizontal));
  const fitting = radius / Math.tan(halfAngle);
  const fit = fitting * 1.6;
  // A seed is ten centimetres across, so the geometric fit puts the eye at arm's
  // length: the frame is soil, the plant is a smudge at the top edge, and the
  // moment anything grows the new part leaves the picture. The start distance is
  // where a new plant is meant to be seen from, so it is the floor until the
  // plant is big enough to fill that view on its own merit.
  // Half the start distance, not all of it: a seed at 6 m is a speck, at arm's
  // length it is a screen of soil. Half shows the plant, its pit and the horizon
  // in one frame, which is what a part has to grow inside to be watchable.
  const youngFloor = Math.max(min * 1.5, start * 0.5);
  const floor = fit < youngFloor ? youngFloor : min * 1.5;
  return Math.min(furthest, Math.max(floor, fit));
}

// ADR-027: frame the independent camera close to the plant. The plant model
// keeps its normal size; only the camera distance changes.
function frameCameraOnPlant(
  x: number,
  y: number,
  z: number,
  /**
   * Only the automatic framings (spawn, plant switch, the first-node refit) correct
   * a young plant's pitch. A player who asks for a recenter mid-plant - Space, or a
   * double-click on empty ground - is told "same angle, centred on the plant", so
   * their view must not tilt itself upright under them.
   */
  fitYoungPitch = true,
): void {
  // A whole-plant recenter wins over any node focus still animating, otherwise
  // the leftover framing distance would drag the camera back in.
  cancelCameraAutoMove();
  const distance = plantFrameDistance();
  // A framing target may never sit under the visible soil. Relief reaches tens
  // of metres, so a surface-relative point mapped before the terrain config was
  // known (a reload's first WELCOME) put the pivot inside the hill and the whole
  // view under the ground. Root Sight is the one mode that frames a buried
  // point on purpose, so it is exempt.
  const rootSightFraming = rootSightMachine
    ? rootSightStateMachineIsEnabled(rootSightMachine)
    : false;
  let targetY = y;
  if (!rootSightFraming) {
    const groundY = clientSurfaceY(x, z, 0);
    if (Number.isFinite(groundY) && targetY < groundY) targetY = groundY;
  }
  tempTarget.set(x, targetY, z);

  // Shallow side view, not a high orbit. A young plant is only a seed or a
  // seedling, so looking down on it at 40°+ read as a bird's-eye view of a dot;
  // a normal side view shows the whole plant and is what players expect.
  // Elevation is ~15° above the target, azimuth slightly forward and right.
  //
  // Except for a young plant, where the fit puts the eye under a metre from the
  // soil: at 15° that eye sat 0.24 m off the ground, the terrain clamp held it
  // there, and the frame was soil. A sprout is framed from
  // `camera_young_elevation` (~30°) so it reads against the ground, not in it.
  const young = distance <= (renderConfig?.cameraYoungMaxDistance ?? 4);
  // Keep the azimuth the player is already looking along - a fixed one is what
  // made Space spin the view - but reset the elevation to the framing's own.
  // Keeping the pitch meant a right-drag pan upwards left the camera looking
  // down on the plant, and a recenter only moved the target: the plant stayed
  // framed from above, which is exactly the reported "Space goes above" bug.
  // The young elevation is the *automatic* framing's, and only the automatic
  // framing may use it: Space on a seedling is a recenter the player asked for,
  // and answering it with the young fit's 33 degrees put them straight back above
  // the plant, looking at a screen of soil - the reported "Space goes above".
  // The recenter elevation is the side view the command is named after.
  tempDirection.copy(camera.position).sub(controls.target);
  const recentered = recenterOffset({
    offset: tempDirection,
    rise:
      young && fitYoungPitch
        ? (renderConfig?.cameraYoungElevation ?? 0.55)
        : (renderConfig?.cameraRecenterElevation ?? 0.27),
  });
  tempDirection.set(recentered.x, recentered.y, recentered.z);
  // Never recenter from under the soil on a plant that stands on it: the eye may
  // be burrowed after a root inspection, and framing the whole plant from below
  // shows the underside of the ground.
  const minRise = young ? 0.16 : 0.12;
  if (tempDirection.y < minRise) {
    tempDirection.y = minRise;
    tempDirection.normalize();
  }
  // And a young plant may not be framed steeply from above. A seedling is framed
  // from three metres (half the start distance); at the welcome view's 35 degrees
  // that eye is 1.7 m up and looking down 35 degrees, so the ground line sits
  // above the top of the frame and the plant is a dot in a wall of soil - which is
  // exactly what "the camera is not on the plant" looked like. Cap the pitch to a
  // fraction of the vertical field of view so the horizon stays in the picture.
  if (young && fitYoungPitch) {
    // The side view the framing is written around (`y = 0.27`, about 15 degrees),
    // tightened to the frame: keep the azimuth the player has, but never look down
    // on a seedling harder than this.
    const halfVertical = (camera.fov * Math.PI) / 360;
    const maxRise = Math.min(0.2, Math.sin(halfVertical * 0.6));
    if (tempDirection.y > maxRise) {
      tempDirection.y = maxRise;
      tempDirection.normalize();
    }
  }
  const destination = tempTarget.clone().addScaledVector(tempDirection, distance);
  // The eye has to stand on the soil it is over. Three metres from the subject on
  // a steep hill put it inside the slope, and the respawn frame was a wall of
  // brown with the new seed behind it. Lift it until the arm - at its own end and
  // along its length - clears the ground it crosses.
  if (!rootSightFraming) {
    const touch = renderConfig?.cameraGroundTouchM ?? 0.02;
    let lift = 0;
    for (const t of [0.45, 0.7, 1]) {
      const sampleX = tempTarget.x + (destination.x - tempTarget.x) * t;
      const sampleZ = tempTarget.z + (destination.z - tempTarget.z) * t;
      const sampleY = tempTarget.y + (destination.y - tempTarget.y) * t;
      const need = clientSurfaceY(sampleX, sampleZ, 0) + touch - sampleY;
      if (need > 0) lift = Math.max(lift, need / t);
    }
    // A cap, so a camera framed against a cliff rises to look over it instead of
    // climbing the whole wall and losing the plant below the frame.
    if (lift > 0) destination.y += Math.min(lift, 8);
  }
  // The tween below carries the pivot in plan only, because the ground physics
  // owns its height every frame. In the free-camera rig nothing else ever writes
  // that height, so the target stayed at the world origin and the whole rig hung
  // twenty metres under the seedling it had just framed. The framing decides the
  // height here, where the ground clamp above has just worked out where the
  // subject stands.
  controls.target.y = tempTarget.y;
  // Recentring uses the same eased travel as a node focus: a Space press that
  // teleported the view was as disorienting as a node double-click was.
  startCameraFocus(tempTarget.clone(), destination);
}

// The up vector for the current view. Planet view looks at the whole globe, so
// it keeps world up; the local view uses the surface normal where the camera is
// looking. At a 100 km radius this is a 0.34° tilt across the clearing, but it
// is what keeps the horizon level as the play area grows.
function desiredCameraUp(out: THREE.Vector3): THREE.Vector3 {
  const radius = renderConfig?.planetRadiusM ?? 0;
  if (radius <= 0 || planetViewActive) return out.copy(WORLD_UP);
  return out.set(controls.target.x, controls.target.y + radius, controls.target.z).normalize();
}

// OrbitControls takes `object.up` as its orbit axis when it is constructed and
// keeps that frame for the life of the instance. The cached frame is private and
// has moved between three.js releases, so this never touches it: when the
// normal has moved far enough to matter, the controls are replaced with a new
// instance built from the same public constructor. The threshold (1.1 degrees)
// is far below anything visible, so this is a rare event rather than a per-frame
// rebuild.
const CONTROL_UP_EPSILON = 0.02;
const controlFrameUp = new THREE.Vector3(0, 1, 0);

function applyCameraUp(up: THREE.Vector3): void {
  if (camera.up.distanceToSquared(up) < 1e-14) return;
  camera.up.copy(up);
  if (up.angleTo(controlFrameUp) < CONTROL_UP_EPSILON) return;
  rebuildControls();
  controlFrameUp.copy(up);
}

function rebuildControls(): void {
  const previous = controls;
  const target = previous.target.clone();
  const carried = {
    enabled: previous.enabled,
    minDistance: previous.minDistance,
    maxDistance: previous.maxDistance,
    minPolarAngle: previous.minPolarAngle,
    maxPolarAngle: previous.maxPolarAngle,
    dampingFactor: previous.dampingFactor,
    enableDamping: previous.enableDamping,
    enableRotate: previous.enableRotate,
    enablePan: previous.enablePan,
    panSpeed: previous.panSpeed,
    rotateSpeed: previous.rotateSpeed,
    zoomSpeed: previous.zoomSpeed,
  };
  previous.dispose();
  controls = createControls();
  controls.enabled = carried.enabled;
  controls.minDistance = carried.minDistance;
  controls.maxDistance = carried.maxDistance;
  controls.minPolarAngle = carried.minPolarAngle;
  controls.maxPolarAngle = carried.maxPolarAngle;
  controls.dampingFactor = carried.dampingFactor;
  controls.enableDamping = carried.enableDamping;
  controls.enableRotate = carried.enableRotate;
  controls.enablePan = carried.enablePan;
  controls.panSpeed = carried.panSpeed;
  controls.rotateSpeed = carried.rotateSpeed;
  controls.zoomSpeed = carried.zoomSpeed;
  controls.target.copy(target);
  controls.update();
}

// Recenter on the whole plant. Space uses this path.
function recenterCamera(fitYoungPitch = true): void {
  // Only the player's own plant. plantNodes also holds rival and wild plants, so
  // taking the first parentless node in the map framed whichever plant happened
  // to be inserted first: Space jumped the view to a seed metres away from the
  // one being grown.
  const own = ownBodyNodes(
    Array.from(plantNodes.values()).filter((node) => node.isOwnPlant),
    plantId,
  );
  if (own.length === 0) {
    // No body in the mirror yet: the last position the server streamed for the
    // crown is still the truth, and it is better than leaving the view where a
    // previous plant stood.
    if (lastOwnAnchorValid) {
      frameCameraOnPlant(lastOwnAnchor.x, lastOwnAnchor.y, lastOwnAnchor.z, fitYoungPitch);
      return;
    }
    frameCameraOnPlant(controls.target.x, controls.target.y, controls.target.z, fitYoungPitch);
    return;
  }
  // Aim at the middle of the plant rather than its seed: the seed is the lowest
  // node, so centring it left the shoot hanging above the middle of the screen.
  const bounds = new THREE.Box3();
  for (const node of own) {
    bounds.expandByPoint(tempTarget.set(node.position.x, node.position.y, node.position.z));
  }
  const centre = bounds.getCenter(tempTarget);
  frameCameraOnPlant(centre.x, centre.y, centre.z, fitYoungPitch);
}

/**
 * True once the player has driven the camera themselves. The automatic framing
 * below must never fight them, and a first-spawn refit is only allowed while
 * this is false.
 */
let cameraUserMoved = false;
/**
 * The welcome framing runs before the plant's nodes exist, so it can only use
 * the configured start distance (6 m). At 6 m a seedling is four pixels wide in
 * front of a hillside - the first thing a new player saw was dirt. The framing
 * is redone once, when the first own node arrives and the fit can measure it.
 */
let refitFramingOnFirstNodes = false;

// Any deliberate camera input cancels a pending automatic framing, so a
// double-click focus can never keep dragging the view around afterwards.
function cancelCameraAutoMove(): void {
  targetCameraDistance = -1;
  cameraFocusTween = null;
}

// Screen-space pick radius for double-clicking a plant node, in CSS pixels.
const NODE_DOUBLE_CLICK_PICK_PX = 24;
const nodePickVector = new THREE.Vector3();
// Scratch for the hover probe, so a pointer move does not allocate a ray.
const hoverPick = new THREE.Vector2();
const hoverRay = new THREE.Raycaster();

/**
 * The orbit floor while Root Sight holds a cavity, in metres.
 *
 * Half a mouth is the pit's own scale: close enough for the eye to be brought
 * over the hole and dived through it, far enough that the near wall does not
 * fill the frame, and reachable for the smallest pit (a 28 cm mouth asks for
 * 0.14 m, against the 15 cm root-layer floor).
 *
 * One function on purpose. The number used to be written in two places that
 * disagreed: `settlePlayerOnGround` set `mouth * 0.6`, and a few lines later the
 * render loop stamped the eased `currentCameraMinDistance()` over it, which
 * asked for `mouth * 1.25`. The larger floor won every frame, so the eye could
 * never come within 0.9 mouths of the centre, `eyeOverAperture()` was never
 * true, and the dive branch below it was dead code - the camera could not go
 * below the opening at all.
 */
function cavityOrbitFloorM(mouthM: number): number {
  const rootMin = renderConfig?.cameraMinDistanceRoot ?? 0.15;
  return Math.max(rootMin, mouthM * 0.5);
}

// How close the orbit may get depends on what is being inspected. Above ground
// the camera must not enter the plant (camera_min_distance), while the root
// layer needs to reach root tips (camera_min_distance_root): Root Sight makes
// the soil translucent, so the camera also travels below the surface.
function currentCameraMinDistance(): number {
  const surfaceMin = renderConfig?.cameraMinDistance ?? 1.0;
  const rootMin = renderConfig?.cameraMinDistanceRoot ?? surfaceMin;
  const rootSightOn = rootSightMachine ? rootSightStateMachineIsEnabled(rootSightMachine) : false;
  const surface = soilQuery();
  const belowSurface =
    isBelowSoil(camera.position, surface) || isBelowSoil(controls.target, surface);
  const base = rootSightOn || belowSurface ? Math.min(surfaceMin, rootMin) : surfaceMin;
  if (rootSightOn && cavityApertureM > 0) {
    // Root Sight lowers the usable floor into the root layer. While the dive is
    // on offer the floor is the pit's own scale, so the eye can stand over the
    // hole and then down through it (ADR-064); the one-mouth clearance used to
    // sit outside the rim that `eyeOverAperture()` tests, which made the cavity
    // impossible to enter. With the dive turned off there is nothing to enter,
    // and the clearance still keeps the eye outside the bowl rather than inside
    // its far wall.
    if (rootSightConfig?.cameraBurrowEnabled ?? false) {
      return Math.max(base, cavityOrbitFloorM(cavityApertureM));
    }
    return Math.max(base, cavityApertureM * ROOT_SIGHT_APERTURE_EYE_CLEARANCE);
  }
  return base;
}

// The floor that applies to a specific node: underground nodes may be inspected
// from the root-layer minimum even while the camera is still above ground.
function cameraMinDistanceForNode(node: PlantNodeData): number {
  const underground = node.position.y < 0 || node.type === 0;
  if (!underground) return currentCameraMinDistance();
  const surfaceMin = renderConfig?.cameraMinDistance ?? 1.0;
  const rootMin = renderConfig?.cameraMinDistanceRoot ?? surfaceMin;
  return Math.min(surfaceMin, rootMin);
}

/**
 * The camera rig: a free flying eye, or the old ground-following rig.
 *
 * `free` is the plan's items 11 and 12: panning is travel, not a walk. Nothing
 * about the terrain moves the camera - no follow, no pivot, no target floor and
 * no eye clamp - so crossing a hill changes the view by exactly the distance the
 * keys were held. `ground` keeps the old behaviour behind a config switch.
 */
function cameraFliesFree(): boolean {
  return (renderConfig?.cameraMode ?? 'free') === 'free';
}

// WASD / arrows fly the camera in the direction the picture is facing.
// W/ArrowUp    -> forward along the view heading
// S/ArrowDown  -> backward along the view heading
// A/ArrowLeft  -> strafe left   (view heading X camera up)
// D/ArrowRight -> strafe right
//
// The heading is `target - eye`, not the camera's cached rotation: the pan pass
// runs before the controls and the aim lean rebuild the camera for the frame, so
// the rotation is last frame's and a drag could leave W pointing somewhere the
// player never aimed. Ground mode flattens the heading; free mode keeps the whole
// view vector. Nothing on the plant moves, and the orbit pivot is wherever the
// player has looked it (ADR-022).
function applyCameraPan(deltaTime: number): void {
  const baseSpeed = renderConfig?.cameraPanSpeed ?? 0;
  if (baseSpeed <= 0) return;

  // Pan speed follows the current zoom: at arm's length the camera crawls, far
  // out it covers ground quickly. A fixed metres-per-second made close-up work
  // unusable and long shots sluggish.
  const distance = camera.position.distanceTo(controls.target);
  const speed = baseSpeed * Math.max(0.15, distance / 12);

  let forwardAxis = 0; // W / S: along the direction the camera looks
  let strafe = 0; // A / D: strafe perpendicular to it
  if (cameraPanState.forward) forwardAxis += 1;
  if (cameraPanState.backward) forwardAxis -= 1;
  if (cameraPanState.left) strafe -= 1;
  if (cameraPanState.right) strafe += 1;
  if (strafe === 0 && forwardAxis === 0) return;
  cancelCameraAutoMove();

  const move = panMove({
    eye: camera.position,
    target: controls.target,
    up: camera.up,
    forwardAxis,
    strafe,
    free: cameraFliesFree(),
    speed,
    deltaTime,
  });
  if (!move) return;

  // Move both target and camera.position together so panning works even when
  // controls.enabled = false (e.g. while the growth panel is open or drawing).
  // OrbitControls.update() will keep the spherical offset intact.
  controls.target.x += move.x;
  controls.target.y += move.y;
  controls.target.z += move.z;
  camera.position.x += move.x;
  camera.position.y += move.y;
  camera.position.z += move.z;
}

// Simple player physics: the player is a point that falls onto the terrain and
// stops, so the rig spawns in the air instead of starting inside a hill and
// cannot sink when the relief changes underneath it.
let playerVertical = spawnPlayer(0);

/** Drop the player in from the configured spawn height, above the ground. */
function respawnPlayer(): void {
  playerVertical = spawnPlayer(renderConfig?.playerSpawnHeightM ?? 0);
}

/**
 * Integrate the player's vertical physics and move the whole rig with it.
 *
 * Both the orbit target and the camera shift by the same delta, so the orbit
 * offset (including Root Sight's negative one) is preserved while the player
 * falls and lands.
 */
/**
 * Whether Root Sight may take the eye under the soil.
 *
 * The transition alone is not enough. A plant with nothing dug opens no cavity,
 * and an eye let underground anyway sits inside solid dirt: the ground clamp is
 * off, the view is the underside of the terrain, and the orbit pushes the eye in
 * and out of the surface every frame - the up/down shake. The eye only crosses
 * the soil when there is a cavity to be in.
 */
/**
 * The orbit's polar ceiling for the current view mode.
 *
 * Root Sight owns it while the ground is open: the eye has to be able to drop
 * below the surface, or the cavity is seen edge-on from above and reads as shut.
 * Three separate passes used to restore the surface limit (the node refit, the
 * ground floor and the toggle), so any of them could drag the eye back up while
 * the cavity was open - which is why Root Sight appeared to close by itself, most
 * often right after a part finished growing and the camera refit ran.
 */
function rootSightPolarLimit(): number {
  const open = rootSightMachine ? rootSightStateMachineIsEnabled(rootSightMachine) : false;
  return open ? Math.PI - 0.05 : (renderConfig?.cameraMaxPolarAngle ?? Math.PI / 2 - 0.05);
}

function rootSightHoldsACavity(): boolean {
  return (rootSightMachine?.progress ?? 0) > 0.001 && cavityApertureM > 0.001;
}

/**
 * Is the eye standing in the opening's own column?
 *
 * The pit is the only hole in the ground, so it is the only place an eye can be
 * below the surface and still be in a space. Anywhere else under the surface the
 * dirt is real, and the camera lifts the eye back up instead of clamping it
 * sideways into the pit.
 */
/**
 * Is the eye standing in the opening at all, its own wall included?
 *
 * The whole mouth, not most of it. This test used to stop at nine tenths of the
 * radius, on the reasoning that the wall is the last few centimetres - but that
 * last tenth is exactly where a burrowing camera is held by
 * `clampEyeToCavity` (`mouth - cavity_clearance_m`, i.e. 0.9 mouths and a bit
 * with the default 0.2 m clearance on a 1.9 m mouth). Pushing on towards the wall
 * therefore left the answer false: the cavity clamp let go, and
 * `clampEyeToGround` - which exempts only while this is true - threw the eye up
 * to the surface in one frame. That is the teleport out of the pit that should
 * have been a stop against its wall.
 *
 * One clearance past the mouth, because that is the band the wall clamp works
 * in: a single frame of travel can carry the eye over the limit it is pressed
 * back to, and it has to be caught there instead of being handed to the ground
 * clamp on the way.
 */
/**
 * The widest mouth seen since the cavity opened.
 *
 * Growing a root rebuilds the cavity: the mouth can be narrower for a moment, or
 * its centre can shift by a few centimetres, and an eye that was inside it then
 * tested as "outside" - so the ground clamp lifted it to the surface and the
 * player watched Root Sight close on them mid-growth. The mouth only remembers
 * being wide while the cavity stays open; closing it forgets.
 */
let apertureHoldM = 0;

function eyeOverAperture(): boolean {
  if (!rootSightHoldsACavity()) {
    apertureHoldM = 0;
    return false;
  }
  const live = soilCutawayUniforms.uRootSightApertureRadius.value;
  // Widen at once, narrow slowly. A rebuild that loses a root (or moves the mouth
  // a few centimetres) must not lift an eye that was standing in the opening, but
  // the memory cannot be kept until the cavity closes or the eye stays exempt
  // inside solid dirt for as long as the mode is open. It decays towards the live
  // radius instead: about half a second to close most of a gap at 60 Hz.
  apertureHoldM = live > apertureHoldM ? live : apertureHoldM + (live - apertureHoldM) * 0.08;
  const radius = Math.max(live, apertureHoldM);
  if (!(radius > 0.05)) return false;
  const centre = soilCutawayUniforms.uRootSightApertureCenter.value;
  const clearance = rootSightConfig?.cavityClearanceM ?? 0.2;
  return (
    Math.hypot(camera.position.x - centre.x, camera.position.z - centre.z) <= radius + clearance
  );
}

/**
 * The pivot height the last frame stood at, so the camera can follow the ground
 * by the amount it moved. `null` until the first settle: the first frame has no
 * previous height, and framing that happened before it owns the target then.
 */
let lastPivotY: number | null = null;

function settlePlayerOnGround(deltaTime: number): void {
  const planetRadius = renderConfig?.planetRadiusM ?? 0;
  if (planetRadius <= 0) return;
  // The free rig stands on nothing. Every branch below exists to make the camera
  // a passenger of the ground - the pivot follow, the target floor, the orbit
  // ceiling sampled from the terrain - and all of them are exactly the height
  // changes a pan across a hill used to produce (plan item 11).
  if (cameraFliesFree()) {
    lastPivotY = null;
    controls.maxPolarAngle = renderConfig?.cameraMaxPolarAngle ?? Math.PI - 0.05;
    return;
  }
  // The orbit floor is deliberately not set here. It was, at `mouth * 0.6`, and
  // the render loop overwrote it with the eased `currentCameraMinDistance()` a
  // few lines later - which asked for `mouth * 1.25`, outside the rim the dive
  // gate tests. That silent second writer is why the eye could never reach the
  // opening. `currentCameraMinDistance()` owns the floor now, through
  // `cavityOrbitFloorM()`, so the dive and the orbit cannot disagree again.
  const field = getTerrainParams();
  const groundY = planetTerrainY(planetRadius, controls.target.x, controls.target.z, field);
  playerVertical = stepPlayerVertical(
    playerVertical,
    deltaTime,
    renderConfig?.playerGravityMps2 ?? 0,
  );
  const feetY = playerWorldY(groundY, playerVertical);
  // The orbit pivot is the head, not the feet. A pivot on the ground made
  // looking up geometrically impossible: any angle whose eye is below the pivot
  // is also below the surface, so `clampEyeToGround` shortened the arm back and
  // the pitch stopped at horizontal. With the pivot at eye height the eye can
  // drop to the dirt and still look at the sky, which is what standing on the
  // terrain and tilting up is.
  const pivotY = feetY + (renderConfig?.cameraPivotHeightM ?? 1.6);
  // The camera follows the ground, it is not pinned to it. Writing the pivot onto
  // the orbit target every frame forced the target back to head height whatever
  // the player did with it: a pan downwards was undone on the next frame, and the
  // framed plant sat a pivot-height *below* the middle of the screen with no way
  // to bring it up. The follow is now a delta - when the terrain under the player
  // moves, the eye and the target move with it by the same amount, which keeps
  // the view identical while letting a pan stay where the player put it.
  const followY = lastPivotY === null ? 0 : pivotY - lastPivotY;
  lastPivotY = pivotY;
  if (followY !== 0) {
    controls.target.y += followY;
    camera.position.y += followY;
  }
  // The target may be panned down to the soil, not through it. `clampEyeToGround`
  // gives up when the target itself is buried (it has nothing clear to slide
  // towards), so a free downward pan used to leave both the target and the eye
  // under the surface with an empty black frame. The floor is the ground under the
  // target - or the floor of the open cutaway while Root Sight holds one, which is
  // the only case where looking at the target means looking at something below the
  // soil.
  const targetGroundY = planetTerrainY(planetRadius, controls.target.x, controls.target.z, field);
  const targetFloorY =
    rootSightHoldsACavity() && eyeOverAperture() ? Math.min(targetGroundY, feetY) : targetGroundY;
  if (controls.target.y < targetFloorY + 0.15) {
    const lift = targetFloorY + 0.15 - controls.target.y;
    controls.target.y += lift;
    camera.position.y += lift;
  }

  const eyeGroundY = planetTerrainY(planetRadius, camera.position.x, camera.position.z, field);
  // Root Sight is the one mode that may put the eye underground. The floor
  // clamp ran unconditionally, so the camera could never follow the roots it
  // had just opened the ground for. While burrowing, clamp to a configured
  // depth instead and let the cavity shader's sight window keep the view clear.
  // Progress, not the on/off state, decides: while the cutaway is closing the
  // eye is still allowed under the soil, so the ground does not shove it up in
  // the middle of the transition.
  const rootSightEngaged = rootSightHoldsACavity();
  // The orbit may dive into the opening, and only into it. This branch used to run
  // whenever a cavity existed, so a vertical drag anywhere was allowed past the
  // horizon: the eye went under the plant far from the pit, the cavity clamp then
  // pressed it back to the wall every frame, and the view stuck there. It now
  // needs the eye to be standing in the opening's own column - so zoomed in over
  // the pit a downward drag takes the eye through the hole and into the pit, and
  // anywhere else the ground stops the orbit exactly as it does with Root Sight
  // closed. An eye that leaves the column underground is lifted back up.
  const overOpening = eyeOverAperture();
  if (rootSightEngaged && overOpening && (rootSightConfig?.cameraBurrowEnabled ?? false)) {
    // Never below the earth's body. There is no earth under its underside, and
    // an eye down there watched the pit's own shell from outside against open
    // sky - the "cave walls" the underground view showed. The configured depth
    // is a ceiling on how far down the eye may go, not a right to leave the
    // world: whichever is shallower wins.
    // ... and never below the pit's own floor. The configured 12 m is a third
    // of the way through the world, far under a cavity that is two to four
    // metres deep: there the eye is in solid earth, and the air bubble the soil
    // shader cuts around it is a cave with the pit's outside wall as one side.
    // The cavity is the only underground space that exists, so it is the only
    // one the eye may stand in.
    const bodyDepthM = environmentRenderer?.getSoilBodyDepthM() ?? 0;
    const configuredDepthM = Math.max(0, rootSightConfig?.maxBurrowDepthM ?? 12);
    const cavityDepthMNow = cavityDepthM(soilCutawayUniforms.uRootSightApertureRadius.value);
    const allowedDepthM = Math.max(
      0.2,
      Math.min(
        configuredDepthM,
        bodyDepthM > 0 ? Math.max(0.2, bodyDepthM - 0.3) : configuredDepthM,
        Math.max(0.2, cavityDepthMNow - 0.15),
      ),
    );
    const floor = eyeGroundY - allowedDepthM;
    if (camera.position.y < floor) camera.position.y = floor;
    controls.maxPolarAngle = Math.PI - 0.05;
    return;
  }

  // Keep the eye out of the dirt in two halves: this polar limit stops a
  // downward drag before it can put the eye under the soil, and
  // `clampEyeToGround` catches whatever the prediction misses after the
  // controls have moved. The limit alone used to be the whole story, and it is
  // what held the camera metres up: it took the higher of the target's ground
  // and the eye's, so standing on a rise and orbiting to the downhill side kept
  // the eye at the hilltop's height over a valley it was already above.
  const offset = camera.position.clone().sub(controls.target);
  offset.y = 0;
  if (offset.lengthSq() < 1e-8) offset.set(0, 0, 1);
  offset.normalize();
  // The limit comes from the ground the eye is orbiting *over*, sampled where the
  // eye would stand at this azimuth and orbit radius. It used to come from the
  // ground *plane under the player*, which capped the orbit at the player's own
  // elevation: on flat ground the maximum polar angle was exactly horizontal, so
  // the camera could never come down to the soil and look up from it.
  //
  const reach = Math.max(camera.position.distanceTo(controls.target), 1e-4);
  const touch = renderConfig?.cameraGroundTouchM ?? 0.02;
  // The eye stands where its orbit puts it, not at the full radius: at a steep
  // angle its horizontal is radius * sin(polar). Sampling the ground at the full
  // radius instead placed the eye on the height of ground that was further out,
  // which on a slope falling away from the player put it under the surface it
  // was actually standing at. The sample follows the tested angle, so it is the
  // ground the eye would stand over, not the ground at the orbit radius.
  const groundAt = (horizontal: number): number =>
    planetTerrainY(
      planetRadius,
      controls.target.x + offset.x * horizontal,
      controls.target.z + offset.z * horizontal,
      field,
    );
  // The whole orbit ray has to clear the ground, not only its far end: an eye
  // resting on the surface at the far end can still have a hill under the middle
  // of its ray, so all four points are tested at whatever angle is being tried.
  // Uphill of the player the limit comes out above horizontal and downhill below
  // it, which is what lets the eye come down to the soil on the low side of a
  // slope.
  // While the ground is open the orbit is not capped at the surface: the player
  // has to be able to drop the eye into the pit, and the cavity-depth rules above
  // are what keep it out of solid earth. Capping it here meant a stray floor pass
  // could pin the eye at the surface with Root Sight still "on".
  const configuredLimit =
    rootSightMachine && rootSightStateMachineIsEnabled(rootSightMachine)
      ? Math.PI - 0.05
      : (renderConfig?.cameraMaxPolarAngle ?? Math.PI - 0.05);
  const probes = [0.3, 0.55, 0.8, 1];
  // The limit is not seeded at "horizontal". A polar angle of exactly horizontal
  // means the eye can never drop below the target's height - which is precisely
  // the "I can't look up" bug: with the eye on the terrain there was no angle
  // left that pointed at the sky. The probes are the real constraint (the eye
  // must clear the ground at its own position), and they are allowed to answer
  // past horizontal, which is what looking up from the soil needs.
  //
  // The probes are tested in a bisection on the angle (see `solveGroundCeiling`),
  // not in the old closed-form pass. The closed form asked, per probe, "what
  // angle puts the eye above the ground there?" - and past horizontal that
  // question has two answers, because the ray's horizontal is `r sin(polar)` and
  // shrinks again after 90 degrees. Measured on a 0.89 slope it returned 131
  // degrees while the ray was already a centimetre under the hill within the
  // orbit floor, which is what left the spring arm to shorten the camera into
  // the plant (U05). Asking whether the whole ray clears has one answer per
  // direction, so the arm has nothing to correct.
  const clearsAt = (polar: number): boolean => {
    const rise = reach * Math.cos(polar);
    const horizontal = reach * Math.sin(polar);
    for (const fraction of probes) {
      const ground = groundAt(horizontal * fraction);
      // The limit stops the orbit a little short of the dirt (two and a half
      // contact margins) so the spring arm below never has to act. Parking exactly
      // on the margin meant a centimetre of terrain noise put the arm to work, and
      // because the arm shortens the orbit radius it did so permanently: the
      // camera crept in towards the plant a little on every drag.
      if (controls.target.y + rise * fraction < ground + touch * 2.5) return false;
    }
    return true;
  };
  const groundLimit = solveGroundCeiling({
    floorRad: controls.minPolarAngle + 0.001,
    limitRad: configuredLimit,
    clears: clearsAt,
  });
  // Keep the limit above the pole floor. The old post-hoc position clamp fought
  // OrbitControls every frame at the terrain edge: it moved the eye without
  // moving the orbit target, which changed the orbit again on the next frame.
  // The polar limit alone is stable and leaves the camera offset intact.
  const ceilingLimit = Math.min(configuredLimit, groundLimit);
  // While the view is tilted up off the ground, a yaw must not pull the ceiling
  // down under the eye. The limit is solved per azimuth, so turning left or right
  // on a slope lowered it several degrees, which dragged the eye back down and the
  // view with it - the camera ended up looking down at the plant again. Holding the
  // angle already reached keeps the position and the line of sight; the ground
  // clamp still catches an eye that ends up in a hill.
  const heldCeiling =
    lookUpPitchRad > 1e-4 ? Math.max(ceilingLimit, controls.getPolarAngle()) : ceilingLimit;
  controls.maxPolarAngle = Math.max(controls.minPolarAngle + 0.001, heldCeiling);
}

/**
 * Stop the eye crossing the ground when Root Sight is closed.
 *
 * A vertical-only clamp applied after the controls have moved the camera: x/z
 * stay where the orbit put them, so OrbitControls re-derives its sphere from
 * the corrected position on the next frame. Rotating the offset back instead -
 * the old post-hoc clamp - is what made the near-terrain view vibrate.
 *
 * The eye may touch the dirt: `camera_ground_touch_m` is a few centimetres of
 * contact, not a stand-off. Root Sight is exempt by design, since burrowing is
 * how it reaches the roots; `settlePlayerOnGround` gives it the depth floor.
 */
/**
 * Keep a buried eye inside the cavity it opened.
 *
 * The pit is one size - the aperture the soil shader cuts - and outside it the
 * eye is standing in solid earth. The soil shader then cuts an air bubble
 * around the eye, so the view is a private cave with the *outside* of the pit's
 * shell as its wall: the "underground terrain cave walls". The camera keeps its
 * azimuth and slides in along it, so the picture moves inwards instead of
 * jumping, and OrbitControls re-derives its sphere from the corrected position
 * on the next frame (the same rule as the ground clamp).
 */
/** Scratch for the cavity exit check; allocated once, not per frame. */
const cavityLookDirection = new THREE.Vector3();

function clampEyeToCavity(deltaTime: number): void {
  if (!rootSightHoldsACavity()) return;
  if (!(rootSightConfig?.cameraBurrowEnabled ?? false)) return;
  const radius = soilCutawayUniforms.uRootSightApertureRadius.value;
  if (!(radius > 0.05)) return;
  const planetRadius = renderConfig?.planetRadiusM ?? 0;
  const groundY = planetTerrainY(
    planetRadius,
    camera.position.x,
    camera.position.z,
    getTerrainParams(),
  );
  // Only while buried: above the surface the orbit is free, and the aperture is
  // a hole in the ground the player may circle at any distance they like.
  if (camera.position.y >= groundY - 0.02) return;
  const centre = soilCutawayUniforms.uRootSightApertureCenter.value;
  // A buried eye is held inside the aperture soil body's footprint as well, not
  // only inside the opening. The body is the only earth the world draws under the
  // aperture; outside it there is nothing but the ground sheet's back face, so an
  // eye that strayed out there looked at a brown plane at arm's length with the
  // pit somewhere behind it. `apertureSoilHoldRadiusM` is the same number the
  // renderer uses to decide the body is in front of this eye, so the two cannot
  // disagree about where "inside" ends. This runs before the opening's own hold
  // and before its early return, because the eye it catches is by definition not
  // over the opening.
  const bodyHold = clampToCavity(
    { x: camera.position.x, z: camera.position.z },
    { x: centre.x, z: centre.z, radius: apertureSoilHoldRadiusM(radius) },
    0,
  );
  if (bodyHold) {
    camera.position.x = bodyHold.x;
    camera.position.z = bodyHold.z;
  }
  // An eye standing anywhere in the opening - including pressed against its
  // wall - is held at the wall rather than let through it. This used to ask
  // whether the eye was inside the column *minus its clearance*, which is the
  // line the clamp itself enforces: one more centimetre towards the wall and the
  // clamp stopped running, so the dirt was left to the ground clamp and the eye
  // was lifted to the surface. An eye in solid earth outside the opening is
  // still left alone, and `clampEyeToGround` brings that one back up.
  if (!eyeOverAperture()) return;
  // A look up is the way out: the wall stops sideways travel, not the rise.
  //
  // This runs before the wall clamp, not after it. `clampToCavity` returns null
  // when the eye is already inside, and the clamp used to `return` on that - so
  // the lift was skipped in exactly the normal case (an eye standing in the
  // cavity), and looking up did nothing. Browser check caught it: 0.24 m below
  // the surface, looking straight up, still buried.
  const lookUpY = camera.getWorldDirection(cavityLookDirection).y;
  const lifted = cavityEscapeLiftY(
    camera.position.y,
    groundY,
    lookUpY,
    deltaTime,
    rootSightConfig?.cavityEscapeLiftMps ?? 0,
    // How far up the player has to look before the climb starts is config, not a
    // literal: a glance should not lift the eye, a look at the sky should.
    rootSightConfig?.cavityEscapeLookUp ?? 0.35,
  );
  if (lifted !== camera.position.y) {
    // The aim point climbs with the eye; see `raiseEyeWithAim` for why lifting
    // the eye alone made the camera bounce into the seed and back out.
    const raised = raiseEyeWithAim(
      camera.position.y,
      controls.target.y,
      lifted - camera.position.y,
    );
    camera.position.y = raised.eyeY;
    controls.target.y = raised.aimY;
  }
  const clamped = clampToCavity(
    { x: camera.position.x, z: camera.position.z },
    { x: centre.x, z: centre.z, radius },
    rootSightConfig?.cavityClearanceM ?? 0.2,
  );
  if (!clamped) return;
  camera.position.x = clamped.x;
  camera.position.z = clamped.z;
}

/** Scratch for the leaned aim point; allocated once, not per frame. */
const cameraAimPoint = new THREE.Vector3();
const cameraAimOffset = new THREE.Vector3();

/**
 * Lean the view up while the eye is down near the ground.
 *
 * The camera always looks at the orbit target, and the target is the point the
 * player framed - the seed, for a young plant, about 15 cm over the soil. An eye
 * has to be below the target to look up at all, and below 15 cm it is in the
 * dirt, so near the ground there was no upward pitch to be had: on a fresh seed
 * the view sat 19.3 degrees down with an orbit ceiling of 70.7, and dragging up
 * only turned the camera further into the soil. Lifting the target is not an
 * option - a head-height target puts a seed at the bottom edge of the frame -
 * so the eye and the target stay exactly where the player and the clamps put
 * them and only the camera's rotation leans back, by `aimLiftY`.
 *
 * Root Sight is exempt: the eye is deliberately under the soil there, the cavity
 * is read from the aim the player set, and leaning it would tilt the pit out of
 * the view the dive depends on. Planet view keeps world up and aims at the body.
 */
function applyCameraAim(): void {
  if (planetViewActive) return;
  if (rootSightHoldsACavity()) return;
  if (lastPivotY === null) return;
  cameraAimOffset.copy(camera.position).sub(controls.target);
  const lift = aimLiftY({
    eyeY: camera.position.y,
    targetY: controls.target.y,
    headY: lastPivotY,
    horizontalM: Math.hypot(cameraAimOffset.x, cameraAimOffset.z),
    offsetYM: cameraAimOffset.y,
  });
  if (lift <= 0) return;
  cameraAimPoint.copy(controls.target);
  cameraAimPoint.y += lift;
  camera.lookAt(cameraAimPoint);
}

function clampEyeToGround(): void {
  if (planetViewActive) return;
  const planetRadius = renderConfig?.planetRadiusM ?? 0;
  if (planetRadius <= 0) return;
  // Progress, not the on/off flag: while the cutaway opens or closes the eye is
  // still allowed under the soil, so the ground cannot shove it up mid-fade -
  // but only while it is standing in the opening itself. An eye under the
  // surface anywhere else is in solid dirt, and this is how it gets back up.
  if (rootSightHoldsACavity() && eyeOverAperture()) return;
  const touch = renderConfig?.cameraGroundTouchM ?? 0.02;
  const field = getTerrainParams();
  const dir = camera.position.clone().sub(controls.target);
  const reach = dir.length();
  if (reach < 1e-4) return;
  dir.divideScalar(reach);
  // Slide the eye in along its own orbit ray until it clears the ground, instead
  // of lifting it straight up to the floor. A lift kept the visibility but broke
  // the orbit sphere: the eye's horizontal moved towards the player, which moved
  // the ground it was standing over, which changed the height it needed. The
  // closer the zoom, the bigger that step, so zooming in over terrain pumped the
  // camera up and down every frame. Shortening the ray is a spring arm: the
  // answer is a point on the ray the player is looking along, so the next frame
  // starts from the same ray and reaches the same point. Nothing accumulates and
  // nothing oscillates - the view simply stops at the dirt and moves in.
  // Bisect instead of stepping in 30% jumps. The jump size decided where the arm
  // stopped, so a smoothly varying ground height still produced a travel that
  // hopped between those steps, and the camera shivered as it skated along a
  // slope. A bisection lands on the crossing itself: a small change in terrain
  // moves the arm by a small amount.
  // The clearance is the gap between the eye and the soil at its own point on the
  // ray. It is not applied at the target end: the player stands *on* the ground,
  // so `target.y >= ground` there is an equality, and demanding 2 cm of air at
  // travel 0 made this clamp give up before it started - which is how the eye
  // ended up inside the hill at the bottom of a drag.
  const clearAt = (travel: number): boolean => {
    const ground = planetTerrainY(
      planetRadius,
      controls.target.x + dir.x * travel,
      controls.target.z + dir.z * travel,
      field,
    );
    const margin = travel <= 0.05 ? 0 : touch;
    return controls.target.y + dir.y * travel >= ground + margin;
  };
  if (clearAt(reach)) return;
  // Nothing along the ray is clear: the player's own spot is buried, which another
  // clamp owns. Leave the eye alone rather than collapsing it onto the target.
  if (!clearAt(0)) return;
  let near = 0;
  let far = reach;
  for (let step = 0; step < 20; step += 1) {
    const middle = (near + far) / 2;
    if (clearAt(middle)) near = middle;
    else far = middle;
  }
  camera.position.copy(controls.target).addScaledVector(dir, near);
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
/** The player's body anchor for this frame (see player/ownPlantAnchor.ts). */
const ownAnchorVector = new THREE.Vector3();
// The one cavity field Root Sight, the soil cut and plant occlusion share. It
// is rebuilt at `root_sight.rebuild_hz`, not per frame: clustering a thousand
// root nodes every frame was the expensive part of the old per-node upload.
let rootSightCavityField: CavityField = {
  bubbles: [],
  coveringSphere: { x: 0, y: 0, z: 0, radius: 0 },
  dropped: 0,
};
let lastCavityBuildMs = Number.NEGATIVE_INFINITY;
/**
 * Why Root Sight is doing what it is doing, in one place.
 *
 * "I can turn Root Sight on and then cannot find out why nothing opens" is a
 * report you can only answer with numbers: how many root nodes the plant has,
 * how many of them are in the soil, how many bubbles survived clustering, and
 * which of those stopped the aperture. It is updated by the cavity build and
 * shown whenever the toggle runs, and is readable from `__plantLegacy`.
 */
// The hole this frame, metres. Sized from the plant's roots (see
// `cavity/shape.ts`) and kept as one number, because the soil cut, the bowl
// mouth, the cut wall, the water clip and the plant pass all read it.
let cavityApertureM = 0;
let cavityRimMode: 'flat' | 'slope' = 'flat';
// Vertical bounds of the same hole. The soil cut, the water clip and the plant
// pass all read them, so the opening cannot be air for one system and solid for
// another. A plan-view disc with no bounds cut through a hillside and through
// the far side of the planet.
let cavityTopY = 0;
let cavityBottomY = 0;

const rootSightDiagnostic = {
  enabled: false,
  progress: 0,
  roots: 0,
  rootsInSoil: 0,
  usedTypeFallback: false,
  bubbles: 0,
  apertureM: 0,
  /** How far the plant's own roots reach from the crown, metres. */
  rootsRadiusM: 0,
  /** `flat` or `slope`: what the ground under the mouth is doing. */
  rimMode: 'flat' as 'flat' | 'slope',
  /** An air bubble around a buried eye is part of the cut this frame. */
  eyeWindow: false,
  reason: 'idle' as 'idle' | 'off' | 'no_underground_nodes' | 'opening' | 'open',
};

/** One sentence saying whether the cavity should be opening, and why not. */
function describeRootSightStatus(): string {
  const d = rootSightDiagnostic;
  switch (d.reason) {
    case 'no_underground_nodes':
      return d.apertureM > 0
        ? `ON - seed pit: no roots yet, a ${(d.apertureM * 2).toFixed(2)} m hollow of its own`
        : d.roots === 0
          ? 'ON - no underground nodes and no seed to open around'
          : `ON - ${d.roots} root node(s) but none in the soil, so nothing is cut`;
    case 'opening':
      return `ON - opening: ${d.bubbles} bubble(s), aperture ${d.apertureM.toFixed(2)} m, ${cavityRimMode} ground`;
    case 'open':
      return `ON - ${d.bubbles} bubble(s), aperture ${d.apertureM.toFixed(2)} m (roots reach ${d.rootsRadiusM.toFixed(2)} m), ${cavityRimMode} ground, progress ${d.progress.toFixed(2)}`;
    case 'off':
      return 'OFF - Surface view';
    default:
      return 'idle';
  }
}
// Tunnels and voids reported by the server. They are real air in the soil, so
// Root Sight treats them as cavity alongside the root bubbles.
let terrainEdits: Array<{ x: number; y: number; z: number; radiusM: number }> = [];
let terrainRevision = 0;
let lastTerrainRequestMs = Number.NEGATIVE_INFINITY;

// Shared by the soil cutaway shader and the per-frame transition update.
//
// Created closed, then filled from `config/root_sight.json` the moment it loads
// (applyRootSightConfig), so no frame is drawn with a radius the file did not
// ask for.
const soilCutawayUniforms = createRootSightUniforms();

let statusElement: HTMLDivElement | null = null;
// Timestamp of the in-flight PING, used to spot a stalled connection.
let pingSentAt: number | null = null;
// Connection-health thresholds from config/network.json; defaults until loaded.
let networkConfig: { slowRttMs: number; stallMs: number } = { slowRttMs: 1200, stallMs: 12000 };
let detailElement: HTMLDivElement | null = null;
let hintCardElement: HTMLDivElement | null = null;

// T02: Root Sight opens itself when underground growth starts.
//
// Everything underground is drawn only through the cavity, so a player who pays
// for a radicle and cannot see it has no way to tell growth worked; "find the R
// key" is not a discoverable answer. The key remains the owner of the mode: once
// the player closes Root Sight by hand it stays closed until the next new buried
// part starts (which is a new reason to look underground). Each new buried part
// calls noteUndergroundGrowth once, so a hand-close is never undone until the
// player grows something else underground.
/** One entry point: a buried part started growing, so open the ground for it. */
function noteUndergroundGrowth(type: string | undefined, layer?: string | undefined): void {
  if (!rootSightMachine) return;
  const decision = decideAutoOpenRootSight({
    type,
    layer,
    autoOpenEnabled: rootSightConfig?.autoOpenOnRootGrowth ?? true,
    alreadyOpen: rootSightStateMachineIsEnabled(rootSightMachine),
  });
  if (!decision.open) return;
  setRootSightEnabled(true, plantId ?? undefined);
  contextHint?.show({
    id: 'root-sight-open',
    text: 'Root sight opened: a buried part is growing.',
    key: 'R',
  });
}

// T02: Root Sight toggle and transition.
// Root Sight is a silent, player-controlled view mode (R key).
// It activates the soil cutaway shader and allows underground polar angles.
// It does NOT move the camera - the player keeps control at all times.
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
  // move the camera - the player orbits freely at all times. One owner for the
  // ceiling, read from the machine that was just driven.
  controls.maxPolarAngle = rootSightPolarLimit();

  const isEnabled = rootSightStateMachineIsEnabled(rootSightMachine);
  syncRootSightAction();
  setDetail(
    isEnabled ? `Root Sight: ${describeRootSightStatus()}` : 'Root Sight: OFF - Surface view',
  );
}

/**
 * Tell the action bar which way the cavity is.
 *
 * The pill is a finger player's only door into Root Sight, so it has to read as on
 * while the ground is open. Written where the mode is changed as well as from the
 * frame loop, because a tab that is not being drawn stops running frames and the
 * pill would then describe a mode the player had already left.
 */
function syncRootSightAction(): void {
  const machine = rootSightMachine;
  const open = machine ? rootSightStateMachineIsEnabled(machine) : false;
  if (open === rootSightActionShown) return;
  rootSightActionShown = open;
  actionBar?.setActive('rootsight', open);
}

/**
 * The R key's real toggle.
 *
 * Root Sight is driven by the machine's own transition, not by the input bus's
 * latched state. Deriving "open or closed" from either one alone is what made R
 * unreliable: the latch and the machine desynchronise (a press while the window
 * is unfocused is never released, a reconnect resets the machine), and then
 * every press computed the same intent and the cavity never moved. The machine
 * also knows how to reverse a transition that is still running, so a second press
 * mid-animation now cancels it instead of being ignored.
 */
function toggleRootSight(): void {
  const machine = rootSightMachine;
  if (!machine) return;
  rootSightStateMachineToggle(machine);
  syncRootSightAction();
  const state = rootSightStateMachineGetState(machine);
  const opening = state === 'underground' || state === 'transitioning_to_underground';
  controls.maxPolarAngle = rootSightPolarLimit();
  setDetail(
    opening ? `Root Sight: ${describeRootSightStatus()}` : 'Root Sight: OFF - Surface view',
  );
  // The cavity is rebuilt on its own cadence, so refresh the reason once that
  // has run: the number that explains a closed opening comes from that pass.
  window.setTimeout(() => {
    const after = rootSightStateMachineGetState(machine);
    const stillOpening = after === 'underground' || after === 'transitioning_to_underground';
    setDetail(
      stillOpening ? `Root Sight: ${describeRootSightStatus()}` : 'Root Sight: OFF - Surface view',
    );
  }, 250);
}

// T00A: Hint card toggle
/** Last accepted H press, so one physical press cannot toggle twice. */
let lastHintToggleAt = Number.NEGATIVE_INFINITY;

function toggleHintCard(): void {
  // One hint surface now: H asks for the key list and turns hints back on if they
  // were muted. The old card was a permanent overlay that did nothing contextual.
  //
  // The guard is not decoration. A key press can reach this more than once (the
  // keyboard producer and the action it feeds both count as edges), and two
  // toggles in the same press close the card and open it again: H looked like it
  // could show the card but never put it away.
  const now = performance.now();
  if (now - lastHintToggleAt < 220) return;
  lastHintToggleAt = now;
  contextHint?.setEnabled(true);
  showHintList(true);
  hintCardElement?.classList.remove('is-visible');
}

function updateRootSight(deltaTime: number): void {
  if (!rootSightMachine || !rootSightConfig) return;

  // The cavity follows the player's body. Resolving it through the server's
  // root crown (and, failing that, the last streamed crown) is what keeps Root
  // Sight on the plant after an uproot has moved it; "first parentless node"
  // stayed behind at the old spot.
  const anchor = resolveOwnAnchor(
    plantNodes,
    ownRootNodeId,
    lastOwnAnchorValid ? lastOwnAnchor : null,
  );
  const context = {
    ownPlantPosition: anchor ? ownAnchorVector.set(anchor.x, anchor.y, anchor.z) : null,
    cameraPosition: camera.position,
    cameraTarget: controls.target,
  };
  rootSightStateMachineSetContext(rootSightMachine, context);

  const { eased, targetPosition } = rootSightStateMachineUpdate(rootSightMachine, deltaTime);
  rootSightTarget.copy(targetPosition);

  // The pill follows the cavity through its whole transition, including an opening
  // that a buried part started on its own. Written on change only: this is a frame.
  syncRootSightAction();

  // Where the eye actually is, relative to the soil under it. This one answer
  // decides three things: whether the plant pass may hide roots behind the
  // surface, whether the soil around the eye is cut open, and whether the water
  // sheet belongs on screen.
  const planetRadiusForEye = renderConfig?.planetRadiusM ?? 0;
  const groundUnderEye = planetTerrainY(
    planetRadiusForEye,
    camera.position.x,
    camera.position.z,
    getTerrainParams(),
  );
  const eyeUnderSoil = camera.position.y < groundUnderEye - 0.05;
  // Standing inside the pit is not the same as being buried elsewhere in the
  // earth: the ground beyond the rim is above the eye, so the only face of it an
  // eye down here can meet is its underside - a wall of soil across the frame at
  // lip height, with the pit's sky behind it. The flag is the camera's own
  // answer, so an eye buried in solid earth still gets its dirt enclosure.
  // Two centimetres, the same test `EnvironmentRenderer` makes for "the eye is
  // under the sheet". With its own threshold here the two disagreed in a narrow
  // band: three centimetres under the ground the environment called the eye
  // buried while this flag said it was still on the surface, so the dome painted
  // its earth cone and the pit came back as the wall of soil (R23).
  soilCutawayUniforms.uRootSightEyeInPit.value =
    camera.position.y < groundUnderEye - 0.02 && eyeOverAperture() ? 1 : 0;

  // A node only sizes the pit if it is *in the soil*. The node type says a part
  // is a root; the height frame says whether it is buried. A root tip crossing an
  // open tunnel, or one lying on the surface, is a root by type with no soil to
  // open there, and sizing the hole from it widened the pit for a root the player
  // could see in the air. This is the same test the cavity envelope applies below,
  // defined once so the hole and its walls cannot disagree about the roots they
  // are made of.
  const soilMarginM = 0.15;
  const planetRadius = renderConfig?.planetRadiusM ?? 0;
  const terrainField = getTerrainParams();
  const atOrBelowTheSoil = (node: PlantNodeData): boolean => {
    if (planetRadius <= 0) return true;
    const ground = planetTerrainY(planetRadius, node.position.x, node.position.z, terrainField);
    return node.position.y <= ground + soilMarginM;
  };
  // Size the pit to the plant, capped by the configured radius. A fixed 50-unit
  // cutaway around a seed was a crater with a speck in the middle.
  const cutawayRadius = resolveCutawayRadius(
    plantExtent(plantNodes.values(), rootSightConfig, atOrBelowTheSoil),
    eased,
    rootSightConfig.cutawayRadius,
    rootSightConfig,
  );
  // Root Sight belongs to this plant. The cavity is centred on its seed/root
  // crown and sized from its own underground reach; a nearby rival root or an
  // old tunnel must not drag the whole cavity off the player.
  //
  // A dev override (`?dev=1`, `devCavity.setRadius`) replaces both radii with a
  // number. Read here, where they are decided, so the uniform, the cut volume,
  // the bowl, the earth body and the camera's own "inside the opening" test all
  // follow: a second copy of the numbers is how the bowl and the hole came to
  // disagree in the first place.
  const forcedCavity = cavityProbe.forcedRadius();
  const sightRadius = forcedCavity?.cavityM ?? cutawayRadius;
  // The mouth is a circle in plan, so it is sized from the lateral spread. The
  // 3D extent above sizes the cavity, and it counts a deep root's depth as
  // reach: a taproot 1.7 m down under a 0.7 m spread opened a hole 2 m in radius,
  // which put the plant at the edge of a crater instead of in a pit around its
  // roots. Root depth still deepens the cavity, it just no longer widens the
  // opening.
  const lateralRadius = resolveCutawayRadius(
    plantLateralExtent(plantNodes.values(), rootSightConfig, atOrBelowTheSoil),
    eased,
    rootSightConfig.cutawayRadius,
    rootSightConfig,
  );

  // T02 organic envelope: one cavity field feeds the soil cut, plant occlusion
  // and the camera's idea of "inside the opening". Clustering caps the uniform
  // upload, keeps the own plant's roots first and merges nearby nodes so a
  // thousand fine roots describe the same cavity as a few dozen bubbles.
  const envelopeNodes = soilCutawayUniforms.uRootSightNodes.value;
  const nowMs = performance.now();
  const rebuildMs = 1000 / Math.max(1, rootSightConfig.rebuildHz);
  if (nowMs - lastCavityBuildMs >= rebuildMs) {
    lastCavityBuildMs = nowMs;
    const ownAll: CavityNodeInput[] = [];
    const ownInSoil: CavityNodeInput[] = [];
    const rival: CavityNodeInput[] = [];
    const grownFraction = (node: PlantNodeData): number =>
      Math.min(1, Math.max(0, node.growthProgress ?? 1));
    const input = (node: PlantNodeData): CavityNodeInput => {
      const grown = grownFraction(node);
      return {
        id: node.id,
        x: node.position.x,
        y: node.position.y,
        z: node.position.z,
        // A part that has just started is already opening soil. Waiting for the
        // part to emerge (radius × 0 and an early skip) meant Root Sight stayed
        // shut for the whole first growth the player paid for, so it looked as
        // if growing a root did nothing. The floor keeps the opening small but
        // real from the first frame of growth.
        // The floor goes on the result, not on the radius. Applied before the
        // multiplier it came out at 5 mm, and clustering then rounded that to
        // its own 0.12 m floor: the "small but real from the first frame"
        // opening was whatever the merge decided, not a floor this file set.
        radius: Math.max(0.02, (node.radius || 0) * Math.max(0.25, grown)),
      };
    };
    // A node only excavates soil it is actually inside. The node type says a
    // part is a root; the geometry says whether it is in the dirt. A root
    // crossing an open tunnel, or one lying on the surface, has no soil there to
    // remove, and cutting for it opened a cavity over empty air. This is also
    // what keeps a player who is merely underground - standing in a cave with
    // none of their own roots buried nearby - from getting a hole punched in the
    // ceiling above them: with no buried node to back it, `cavityOpen` stays
    // false and the soil stays whole.
    // "At or below the soil" is a surface test, not a depth test. A root running
    // along the soil line is still opening soil, and a strict `y < ground`
    // rejected every shallow root - the cavity closed completely with
    // `uRootSightNodeCount` at 0 and R appeared to do nothing. What must not
    // count is a part that is above the surface: a stem or a leaf passing
    // overhead has no soil to remove, and a player standing in a cave with no
    // roots near them gets no hole punched in the ceiling above.
    // `soilMarginM` and `atOrBelowTheSoil` come from above, where the pit's size
    // is decided: one soil test for the hole and for the bubbles that dig it.
    for (const node of plantNodes.values()) {
      // The seed itself is in the soil but is not a root: on its own it has
      // opened nothing, so it must not excavate a cavity around the player.
      if (node.isSeed) continue;
      if (!isUndergroundNode(node)) continue;
      const bubble = input(node);
      ownAll.push(bubble);
      if (atOrBelowTheSoil(node)) ownInSoil.push(bubble);
    }
    // The fail-safe runs the way the comment always claimed: keep the roots that
    // pass the soil test, and if it rejects *all* of them fall back to every root
    // the plant has. That pattern means the height frame is wrong, not that the
    // plant has no roots. (The old code emptied the list instead, which is what
    // closed the cavity rather than rescuing it.)
    const own = ownInSoil.length > 0 ? ownInSoil : ownAll;
    rootSightDiagnostic.roots = ownAll.length;
    rootSightDiagnostic.rootsInSoil = ownInSoil.length;
    rootSightDiagnostic.usedTypeFallback = ownInSoil.length === 0 && ownAll.length > 0;
    // The hole is sized by what the plant actually dug: the roots' own spread
    // plus a margin that scales with it. The configured aperture is a floor, not
    // a ceiling - the plant pass exposes roots under `uRootSightApertureRadius`,
    // so a mouth narrower than that cylinder would leave roots hanging outside
    // the opening (INV-RS-14).
    const configuredApertureM = apertureRadiusFor(
      forcedCavity?.apertureM ?? Math.min(sightRadius, lateralRadius),
      rootSightConfig,
    );
    // The mouth has to contain the bubbles it cuts; the envelope loop below
    // rejects anything outside it, and a rejected own bubble used to leave the
    // cavity with zero bubbles and shut the soil mid-growth.
    const ownBubbleFloorM = mouthRadiusFor(
      configuredApertureM,
      own,
      rootSightTarget.x,
      rootSightTarget.z,
      rootSightConfig.bubblePaddingM,
    );
    // `clientSurfaceY` takes a *surface-relative* height and adds the ground, so
    // it must be asked for height 0. Passing the crown's own client-space Y (or
    // the previous answer) added the planet radius a second time: the aperture
    // volume's top landed ~18 m above the plant, its floor landed on the water
    // table, and the water clip then left the sheet standing inside the pit.
    const crownSurfaceY = clientSurfaceY(rootSightTarget.x, rootSightTarget.z, 0);
    // A seed stands on the highest ground under its own footprint, which on a
    // slope is a couple of centimetres above the ground at its centre. The
    // mouth used to be the centre ground, so the pit opened just below the seed
    // and the coat appeared to hover over its own hollow. Hang the mouth from
    // the seed's base instead, so the pit starts exactly at its feet.
    const crownNode = ownRootNodeId ? plantNodes.get(ownRootNodeId) : undefined;
    const seedMouthY = crownNode?.isSeed ? crownNode.position.y : crownSurfaceY;
    // A seedling's roots are thinner than its seed. Without the drawn crown
    // radius the mouth is smaller than the coat and the pit is invisible.
    let crownRadiusM = 0;
    for (const node of plantNodes.values()) {
      if (node.isSeed !== true && node.nodeType !== 'seed') continue;
      crownRadiusM = resolveDrawnRadius(node.nodeType, node.radius ?? 0.05, node.biomass);
      break;
    }
    // A plant with nothing dug still has a seed in the soil, and Root Sight has
    // to be able to open *that*: refusing to open until roots exist made the
    // toggle look broken on a fresh plant. The seed's own hollow is the pit, and
    // it is capped to a seed's width - a seed in the middle with a seed's wall
    // on each side - so it can never be mistaken for a dug cavity.
    const seedPitRadiusM = Math.max(0.06, crownRadiusM * ROOT_CAVITY_SEED_PIT_RADII);
    const seedOnly = own.length === 0;
    const cavityBubbles = seedOnly
      ? [
          {
            x: rootSightTarget.x,
            y: crownSurfaceY - Math.max(0.05, crownRadiusM),
            z: rootSightTarget.z,
            radius: Math.max(0.06, crownRadiusM),
          },
        ]
      : own;
    const apertureCapM = seedOnly ? seedPitRadiusM : Number.POSITIVE_INFINITY;
    // A forced mouth is not capped by a seedling's seed pit: it is a number the
    // dev chose, and it is the hole the rest of the frame has to be built around.
    const effectiveApertureM = forcedCavity
      ? forcedCavity.apertureM
      : Math.min(ownBubbleFloorM, apertureCapM);
    // Sample the whole column, not just its rim: the highest soil inside the
    // opening is what the cut has to clear. Sampling only the rim let an uphill
    // rise inside the circle sit above the cut's top, so it stayed as a ceiling
    // over the back of the pit while the aperture's plan circle was cut - the
    // "pit below the rim, see through the ground" view.
    const sampleGround = (radiusM: number): number[] => {
      const samples: number[] = [clientSurfaceY(rootSightTarget.x, rootSightTarget.z, 0)];
      for (const ringFraction of [0.5, 1]) {
        for (let i = 0; i < 8; i += 1) {
          const angle = (i / 8) * Math.PI * 2;
          const radius = radiusM * ringFraction;
          samples.push(
            clientSurfaceY(
              rootSightTarget.x + Math.cos(angle) * radius,
              rootSightTarget.z + Math.sin(angle) * radius,
              0,
            ),
          );
        }
      }
      return samples;
    };
    // Sampled at the mouth the hole will actually have, not at the config floor.
    let groundSamples = sampleGround(effectiveApertureM);
    let ownShape = rootCavityShape({
      bubbles: cavityBubbles,
      crownX: rootSightTarget.x,
      crownZ: rootSightTarget.z,
      surfaceY: seedMouthY,
      configuredApertureM: effectiveApertureM,
      apertureMinM: Math.min(rootSightConfig.apertureMinM, apertureCapM),
      crownRadiusM,
      groundHeights: groundSamples,
    });
    // The mouth can still end up wider than the config floor - the root spread
    // and the crown clearance both size it. A ring sampled at the floor misses
    // the uphill ground inside the wider hole, that ground stays above the
    // cut's top, and on a slope the opening comes out as a crescent with a lid
    // over its uphill half until the plant grows the floor wide enough to
    // catch up (seconds, on a seedling's first roots).
    if (ownShape.apertureM > effectiveApertureM * 1.001) {
      groundSamples = sampleGround(ownShape.apertureM);
      ownShape = { ...ownShape, rimMode: rimModeFor(groundSamples, ownShape.apertureM) };
    }
    cavityApertureM = ownShape.apertureM;
    cavityRimMode = ownShape.rimMode;
    // The cut is a volume: its top is the highest ground under the rim, and its
    // floor comes from the cavity's own depth budget. Both margins are geometry
    // rules exported by `cavity/apertureVolume.ts`, not tuned numbers.
    //
    // The top has to be the highest ground, not the ground at the crown: on a
    // hillside the soil inside the aperture's plan circle stands above the plant,
    // and a cut that stopped at the crown left that uphill soil in place as a
    // brown ceiling over the back half of the hole - you could see the roots
    // hanging into ground that was never removed. The bowl's own mouth plane
    // stays at the crown (`cavity/update.ts`); only the cut reaches the hill.
    let highestGround = crownSurfaceY;
    for (const sample of groundSamples) {
      if (sample > highestGround) highestGround = sample;
    }
    const cavityVolume = apertureVolumeFor({
      centerX: rootSightTarget.x,
      centerZ: rootSightTarget.z,
      groundY: highestGround,
      apertureRadiusM: cavityApertureM,
      depthM: cavityDepthM(cavityApertureM, ownShape.rootsDepthM),
      rimMarginM: APERTURE_RIM_MARGIN_M,
      floorMarginM: APERTURE_FLOOR_MARGIN_M,
    });
    cavityTopY = cavityVolume.topY;
    cavityBottomY = cavityVolume.bottomY;
    rootSightDiagnostic.rootsRadiusM = ownShape.rootsRadiusM;
    rootSightDiagnostic.rimMode = ownShape.rimMode;
    // Only rivals near the opening earn a bubble; a plant on the far side of
    // the planet used to widen the shared sphere until the whole ground was
    // considered "inside" and every buried root became visible through dirt.
    const rivalRangeSq = Math.max(1, rootSightConfig.cutawayRadius) ** 2;
    for (const otherPlant of otherPlayerPlants.values()) {
      for (const node of otherPlant.values()) {
        if (node.isSeed || !isUndergroundNode(node)) continue;
        if (!atOrBelowTheSoil(node)) continue;
        const dx = node.position.x - rootSightTarget.x;
        const dz = node.position.z - rootSightTarget.z;
        if (dx * dx + dz * dz <= rivalRangeSq) rival.push(input(node));
      }
    }
    // Dug tunnels are air too. A root that opened the soil should be visible in
    // that tunnel after a reconnect, not only while the growth event is live.
    for (const edit of terrainEdits) {
      const dx = edit.x - rootSightTarget.x;
      const dz = edit.z - rootSightTarget.z;
      if (dx * dx + dz * dz > rivalRangeSq) continue;
      // Terrain edits carry a height relative to the surface (the server stores
      // negative metres below it); the cavity field works in client world space.
      // Dropping the raw value here put every tunnel several metres below its
      // actual depth and pulled the whole Root Sight cavity down with it.
      rival.push({
        x: edit.x,
        y: clientSurfaceY(edit.x, edit.z, edit.y),
        z: edit.z,
        radius: Math.max(0.12, edit.radiusM * 1.8),
      });
    }
    rootSightCavityField = buildCavityField(cavityBubbles, rival, {
      maxBubbles: rootSightConfig.maxCavityBubbles,
      mergeCellM: rootSightConfig.bubbleMergeCellM,
      paddingM: rootSightConfig.bubblePaddingM,
      rivalBudget: rootSightConfig.rivalBubbleBudget,
      // A single root cannot open a tunnel as wide as the whole configured
      // cutaway. Cap the fused bubbles independently so a thick taproot still
      // reads as a root-sized void.
      maxBubbleRadiusM: Math.min(1.25, Math.max(0.2, rootSightConfig.cutawayRadius * 0.2)),
    });
  }

  let envelopeCount = 0;
  for (const bubble of rootSightCavityField.bubbles) {
    if (envelopeCount >= envelopeNodes.length) break;
    // Keep every bubble whose outer surface is inside the bowl mouth. A bubble
    // outside it would cut a hole in the terrain that the bowl cannot back, so
    // the opening would show sky through a ring of missing dirt.
    const lateralReach =
      Math.hypot(bubble.x - rootSightTarget.x, bubble.z - rootSightTarget.z) + bubble.radius;
    if (lateralReach > cavityApertureM) continue;
    envelopeNodes[envelopeCount].set(bubble.x, bubble.y, bubble.z, bubble.radius);
    envelopeCount += 1;
  }
  for (let i = envelopeCount; i < envelopeNodes.length; i += 1) envelopeNodes[i].w = 0;

  // Nothing dug, nothing drawn. With no underground root bubbles (a seed, or a
  // plant that has not pushed anything down yet) there is no cavity, so the soil
  // must stay whole: the cut and the bowl both hang off this progress. This is
  // decided *before* the eye window is added, because a buried camera on its own
  // must not excavate a cavity the plant never opened.
  const cavityOpen = envelopeCount > 0;

  // The eye window.
  //
  // Root Sight is a hole you look through, and a player who flies the camera
  // down into it ends up buried beside the cavity wall. From in there the soil
  // skin is on every side of the eye, so the view was a brown wall with the pit
  // behind it and no roots at all. A bubble of air around the buried eye - fused
  // into the same envelope as the roots - keeps a window open wherever the eye
  // goes, and the tunnels between it and the cavity are the sightline.
  let eyeBubbleAdded = false;
  const eyeWindowRadius = rootSightConfig.eyeWindowRadius;
  if (cavityOpen && eyeUnderSoil && eyeWindowRadius > 0 && envelopeCount < envelopeNodes.length) {
    envelopeNodes[envelopeCount].set(
      camera.position.x,
      camera.position.y,
      camera.position.z,
      eyeWindowRadius,
    );
    envelopeCount += 1;
    eyeBubbleAdded = true;
  }
  rootSightDiagnostic.eyeWindow = eyeBubbleAdded;
  soilCutawayUniforms.uRootSightNodeCount.value = envelopeCount;
  // Record what is stopping or driving the opening, so the toggle can say it out
  // loud instead of leaving the player with a view mode and no explanation.
  rootSightDiagnostic.enabled = rootSightStateMachineIsEnabled(rootSightMachine);
  rootSightDiagnostic.bubbles = envelopeCount - (eyeBubbleAdded ? 1 : 0);
  rootSightDiagnostic.progress = cavityOpen ? eased : 0;
  rootSightDiagnostic.apertureM = cavityOpen ? cavityApertureM : 0;
  rootSightDiagnostic.reason = !rootSightDiagnostic.enabled
    ? 'off'
    : !cavityOpen
      ? 'no_underground_nodes'
      : eased >= 0.99
        ? 'open'
        : 'opening';
  soilCutawayUniforms.uRootSightProgress.value = cavityOpen ? eased : 0;
  soilCutawayUniforms.uRootSightCenter.value.copy(rootSightTarget);
  // The seed/root crown is where the cavity must reach daylight.
  soilCutawayUniforms.uRootSightApertureCenter.value.copy(rootSightTarget);
  soilCutawayUniforms.uRootSightRadius.value = sightRadius;
  // The one radius the hole and the bowl's mouth both read. It used to be
  // recomputed in two places with different clamps, which is how the bowl ended
  // up wider than the opening and its buried rim showed dirt in the hole.
  soilCutawayUniforms.uRootSightApertureRadius.value = cavityOpen ? cavityApertureM : 0;
  soilCutawayUniforms.uRootSightApertureTopY.value = cavityOpen ? cavityTopY : 0;
  soilCutawayUniforms.uRootSightApertureBottomY.value = cavityOpen ? cavityBottomY : 0;
  soilCutawayUniforms.uRootSightSoilOpacity.value = rootSightConfig.soilOpacity;

  const isEnabled = rootSightStateMachineIsEnabled(rootSightMachine);
  // While the ground is open, refresh the sparse-soil edits so tunnels dug
  // since the last request (by this plant or a nearby rival) are in the cavity.
  if (isEnabled && ws && ws.readyState === WebSocket.OPEN) {
    const now = performance.now();
    if (now - lastTerrainRequestMs > 10_000) {
      lastTerrainRequestMs = now;
      ws.send(
        JSON.stringify({
          type: MESSAGE_TYPE.TERRAIN_REGION_REQUEST,
          payload: {
            worldX: controls.target.x,
            worldZ: controls.target.z,
            radiusM: 60,
            revision: terrainRevision,
          },
        }),
      );
    }
  }
  // Plant occlusion and the root aura use the same player-centred sphere as
  // the soil cut, so a root near the edge cannot disappear from one pass while
  // still opening a hole in the other.
  plantRenderer?.setRootSightState(isEnabled, eased, rootSightTarget, sightRadius);
  // A buried eye is inside the earth, so the plant pass must stop hiding roots
  // behind the analytic surface: from in there, the cavity walls were all a
  // player could see.
  webgpuRenderer?.setCameraUnderSoil(eyeUnderSoil);
  webgpuRenderer?.setRootSight(
    isEnabled,
    eased,
    rootSightTarget,
    sightRadius,
    3.0,
    rootSightConfig.soilOpacity,
    // The hole's actual size. Above ground the plant pass exposes the roots
    // under this radius and hides the rest, instead of the old single sphere
    // around the crown that both leaked buried roots and missed deep ones.
    soilCutawayUniforms.uRootSightApertureRadius.value,
    // The buried-eye bubble: the only air a buried eye may see through the
    // analytic soil test, so the rest of the world still hides what the earth
    // stands in front of.
    rootSightConfig.eyeWindowRadius,
  );
}

// ---- In-world chrome: action bar, contextual hints, pause menu, mode badge ----
//
// Everything a player can do used to be a key they had to already know. The bar
// names the verbs, the pause menu gives Escape somewhere to land, and the mode
// badge makes Grow mode visible without a debug readout.
let actionBar: ActionBarAPI | null = null;
let hotbar: HotbarAPI | null = null;
let sporeChip: SporeChipAPI | null = null;
/** The purse, as the last INVENTORY_SYNC reported it. Never written locally. */
let sporeBalance = 0;
/**
 * Why the purse moved, newest last. The server sends one entry per change, so
 * the panel can explain a balance instead of showing a number that jumped.
 */
let sporeLedger: LedgerEntry[] = [];
/** Last Root Sight state the bar was told about; a frame only writes on change. */
let rootSightActionShown = false;
let contextHint: ContextHintAPI | null = null;
/** The PC-only tip that names a plan part and what a click on it does. */
let plantHoverTip: PlantHoverTip | null = null;
/** The part the pointer is resting on, so a late growth count can re-name it. */
let hoveredNodeId: string | null = null;
let refreshPlantHoverTip: (() => void) | null = null;
/**
 * Available growth options per node, filled by every GROWTH_OPTIONS_RESULT.
 *
 * The panel only ever asked for the node the player clicked, so the tip had no way
 * to know whether a click would find anything and promised growth on every part.
 * A hover now asks once and the answer is kept for the tip and the panel alike.
 */
const growableCounts = new Map<string, number>();
/** When a node's count was last asked for, so a hover cannot spam the server. */
const growableAskedAt = new Map<string, number>();
const GROWABLE_ASK_INTERVAL_MS = 4000;
/** The in-world death card, and the chip that leaves spectating. */
let deathScreen: DeathScreen | null = null;
let spectateChip: SpectateChip | null = null;
/** True while the player stays in the world with no plant after a death. */
let spectating = false;
/** A RESPAWN request is in flight; the next WELCOME answers it. */
let respawnPending = false;
/** What the title card is told when the player finally leaves: one owner. */
let lostReason: string | null = null;
let lostStats: { cause: string; stats: PlantStatsSummary } | null = null;
let pauseMenu: PauseMenuAPI | null = null;
let notificationLog: NotificationLogAPI | null = null;
let growModeBadge: HTMLDivElement | null = null;

const GROW_MODE_CSS = `
  /* Grow mode has to look different from moving around: a tinted edge, a crosshair
     and a badge, not one line of text in a readout nobody reads. */
  #grow-mode-tint {
    position: fixed;
    inset: 0;
    z-index: 140;
    pointer-events: none;
    opacity: 0;
    transition: opacity 200ms ease;
    box-shadow:
      inset 0 0 120px rgba(157, 198, 94, 0.24),
      inset 0 0 0 2px rgba(200, 255, 128, 0.3);
  }
  body.is-grow-mode #grow-mode-tint { opacity: 1; }
  body.is-grow-mode #app { cursor: crosshair; }
  /* The mode badge is a row inside the action bar, so it cannot collide with it
     however the bar wraps. */
  #grow-mode-badge {
    order: -1;
    align-self: stretch;
    display: none;
    align-items: center;
    justify-content: center;
    gap: 6px;
    margin-bottom: 2px;
    padding: 3px 10px;
    border-radius: 999px;
    border: 1px solid var(--leaf-500);
    background: rgba(20, 28, 14, 0.92);
    color: var(--leaf-200);
    font-size: var(--hud-font-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    pointer-events: none;
    white-space: nowrap;
  }
  #grow-mode-badge.is-visible { display: flex; }
  #grow-mode-badge i {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--leaf-300);
    box-shadow: 0 0 8px var(--leaf-300);
  }

  @media (prefers-reduced-motion: reduce) {
    #grow-mode-tint { transition: none; }
  }
`;

function installGrowModeChrome(): void {
  if (document.getElementById('grow-mode-tint')) return;
  const style = document.createElement('style');
  style.id = 'pl-grow-mode-style';
  style.textContent = GROW_MODE_CSS;
  document.head.appendChild(style);

  const tint = document.createElement('div');
  tint.id = 'grow-mode-tint';
  tint.setAttribute('aria-hidden', 'true');
  document.body.appendChild(tint);

  growModeBadge = document.createElement('div');
  growModeBadge.id = 'grow-mode-badge';
  growModeBadge.setAttribute('role', 'status');
  const dot = document.createElement('i');
  dot.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.textContent = 'Grow mode';
  growModeBadge.append(dot, label);
  document.body.appendChild(growModeBadge);
}

/** Grow mode's whole look hangs off one body class and one badge. */
function setGrowModeChrome(enabled: boolean): void {
  document.body.classList.toggle('is-grow-mode', enabled);
  growModeBadge?.classList.toggle('is-visible', enabled);
  actionBar?.setActive('grow', enabled);
}

/** A player-facing message: a toast, and the tick card when an operator has it open. */
function notify(text: string, kind: 'info' | 'state' | 'error' = 'info', durationMs = 2600): void {
  if (detailVisible) setDetail(text);
  uiShell?.toast({ message: text, kind, durationMs });
}

function currentHudMount(): HTMLElement {
  return uiShell?.getLayer('hud') ?? document.body;
}

function createWorldChrome(): void {
  if (actionBar) return;
  installGrowModeChrome();
  const mount = currentHudMount();
  actionBar = createActionBar({
    mount,
    actions: [
      { id: 'grow', label: 'Grow', key: 'G' },
      // Root Sight used to be the R key and nothing else, which left the whole
      // underground half of the game unreachable on a phone. It sits next to Grow
      // because both are modes rather than panels, and it is the same pill on both
      // devices: a key badge where there is a keyboard, a thumb target where there
      // is not.
      { id: 'rootsight', label: 'Root sight', key: 'R' },
      { id: 'inventory', label: 'Inventory', key: 'I' },
      { id: 'chat', label: 'Chat', key: 'T' },
      { id: 'emotes', label: 'Emotes', key: 'E' },
      { id: 'hints', label: 'Hints', key: 'H' },
      { id: 'pause', label: 'Menu', key: 'Esc' },
    ],
    onAction: (id: string) => handleActionBarAction(id),
  });
  syncActionBarKeys();
  actionBar.setVisible(false);
  // The hotbar is the other half of `1`-`0`: the keys address these slots, and
  // before this there was nothing on screen for them to address during play.
  hotbar = createHotbar({
    mount,
    // The hotbar owns its own selection. It used to forward every pick to the
    // inventory panel, so tapping a hotbar slot also moved the inventory's
    // highlight and the two surfaces disagreed about what was selected. The
    // number keys choose a hotbar slot; the inventory panel chooses its own.
    onUse: (index) => useInventorySlot(index),
  });
  hotbar.setVisible(false);
  // The purse, and the way to spend it. The chip is the always-on half of the
  // shop: a currency the player never sees is not one they can plan around.
  sporeChip = createSporeChip({
    mount,
    onOpenShop: () => openShop(),
  });
  sporeChip.setVisible(false);
  // A bar built mid-session inherits the mode it was built in.
  if (rootSightMachine) {
    rootSightActionShown = rootSightStateMachineIsEnabled(rootSightMachine);
    actionBar.setActive('rootsight', rootSightActionShown);
  }
  if (growModeBadge) actionBar.element.insertBefore(growModeBadge, actionBar.element.firstChild);
  // The bar publishes its own height (--pl-bar-offset) and the context hint reads
  // it, so a wrapped or badge-carrying bar never sits under a hint.

  contextHint = createContextHint({
    mount,
    durationMs: resolvedUiConfig?.hintCardDurationMs ?? 5200,
    reducedMotion: resolvedUiConfig?.reducedMotion ?? false,
  });
  // The hover tip lives in the HUD layer so a modal covers it like anything else.
  plantHoverTip = createPlantHoverTip(uiShell?.getLayer('hud') ?? document.body);

  // Every toast the shell shows is also history, so a notice is readable after
  // it has faded. Built once per page, like the rest of the chrome.
  if (!notificationLog) {
    notificationLog = createNotificationLog({ mount: modalMount(uiShell) });
    uiShell?.onToast((options) => notificationLog?.record(options));
  }
  pauseMenu = createPauseMenu({
    mount: modalMount(uiShell),
    onResume: () => {},
    onSettings: () => settingsPanel?.setOpen(true),
    onControls: () => openSettingsControls(),
    onNotifications: () => notificationLog?.open(),
    onLeaveToTitle: () => leaveWorldToTitle(),
  });
}

/**
 * Bound once: Escape opens the pause menu.
 *
 * Nothing else is bound here on purpose. The operator readout used to be F3,
 * which is the browser's find bar in Chrome and quick-find in Firefox: a player
 * pressing it got a search box, and a player pressing the old Shift toggle got a
 * metrics overlay every time they held shift. Both moved to the dev panel.
 */
function bindHudChromeKeys(): void {
  if (hudChromeKeysBound) return;
  hudChromeKeysBound = true;
  window.addEventListener('keydown', handleEscapeKey);
}

/** The operator tick card, switched from the dev panel. */
function setTickReadoutVisible(visible: boolean): void {
  detailVisible = visible;
  if (detailElement) detailElement.style.display = visible ? 'block' : 'none';
}

let hudChromeKeysBound = false;

function handleActionBarAction(id: string): void {
  switch (id) {
    case 'grow':
      worldActions.grow?.();
      break;
    case 'rootsight':
      toggleRootSight();
      break;
    case 'inventory':
      worldActions.inventory?.();
      break;
    case 'chat':
      toggleChat();
      break;
    case 'emotes':
      worldActions.emotes?.();
      break;
    case 'hints':
      showHintList();
      break;
    case 'pause':
      pauseMenu?.open();
      break;
    default:
      break;
  }
}

/** H, and the Hints button: the three core lines, on demand. */
function showHintList(repeat = true): void {
  // H is a toggle, not a show button: a hint the player can see is the thing they
  // are pressing H to get rid of, and waiting for its timeout is not a control.
  if (contextHint?.isVisible()) {
    contextHint.hide();
    return;
  }
  // The finger card is written from the same vocabulary the Controls tab lists,
  // in `ui/touchCopy.ts`; only its closing line - the game's own description of
  // what the player is - comes from the config that owns it for both layouts.
  const lines = isFingerLayout()
    ? touchHintLines(onboardingConfig.hint_card_lines)
    : onboardingConfig.hint_card_lines;
  const text = lines.join('\n');
  contextHint?.show({ id: 'hint-list', text, repeat, durationMs: 7000 });
}

/** Settings, already on the Controls tab: the pause menu's "Controls" entry. */
function openSettingsControls(): void {
  settingsPanel?.setOpen(true);
  settingsPanel?.showTab('controls');
}

/** Leave the world on purpose: no reconnect, no retry, back to the title. */
function leaveWorldToTitle(): void {
  suppressReconnect = true;
  const socket = ws;
  ws = null;
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
  ) {
    socket.close(1000, 'Left to title');
  }
  connecting = false;
  worldActions.setGrow?.(false);
  worldActions.closePanels?.();
  toggleChat(false);
  worldActions.hideEmotes?.();
  hideGrowthSelection();
  hideLossReport();
  plantStatusHud?.setVisible(false);
  if (resourceReadoutElement) resourceReadoutElement.style.display = 'none';
  // The drops belonged to that session; the next welcome brings its own.
  worldDrops.clear();
  actionBar?.setVisible(false);
  hotbar?.setVisible(false);
  sporeChip?.setVisible(false);
  contextHint?.hide();
  setStatus('Offline', 'down');
  entryFlowSignedOut(entryFlow);
  entryScreen.setAccount(menuAccount());
  entryScreen.render(entryFlow);
}

/** Escape: close what is open, otherwise pause. The order matters. */
function handleEscapeKey(event: KeyboardEvent): void {
  // The key check comes first, and it is not decoration: this listener is bound
  // to every keydown in the world, so without it *any* key press closed the chat,
  // dismissed the emote wheel or opened the pause menu. It only stayed hidden
  // while a different bug made the emote branch swallow every press.
  if (event.key !== 'Escape') return;
  if (entryFlow.step !== 'world') return;
  if (pauseMenu?.isOpen) return; // the menu handles its own Escape
  // The death card owns Escape while it is up: opening a pause menu behind a
  // modal leaves the player pressing keys into a screen they cannot see.
  if (deathScreen?.isOpen) return;
  // Chat first, and before the typing guard: the chat input is focused whenever
  // the chat is open, so a guard on "typing" ahead of this branch meant Escape
  // could never close the chat at all. A report dialog owns its own Escape.
  if (chatOpen && !reportDialogEl) {
    event.preventDefault();
    toggleChat(false);
    return;
  }
  const typing =
    document.activeElement instanceof HTMLInputElement ||
    document.activeElement instanceof HTMLTextAreaElement;
  if (typing) return;
  if (growthSelectionStateMachineIsDrawing(growthSelectionMachine)) return;
  if (growthSelectionStateMachineGetState(growthSelectionMachine) === 'option_selected') return;
  if (worldActions.emoteOpen?.()) {
    event.preventDefault();
    worldActions.hideEmotes?.();
    return;
  }
  if (playerPanels?.isOpen) {
    event.preventDefault();
    worldActions.closePanels?.();
    return;
  }
  if (settingsPanel?.isOpen) return; // the panel closes itself on Escape
  event.preventDefault();
  pauseMenu?.open();
}

/**
 * Handlers the world chrome needs but which only exist inside initC01's scope
 * (they close over the socket, the panels and the emote wheel). initC01 fills
 * this in once, and the chrome calls through it.
 */
const worldActions: {
  grow?: () => void;
  inventory?: () => void;
  emotes?: () => void;
  hideEmotes?: () => void;
  emoteOpen?: () => boolean;
  setGrow?: (enabled: boolean) => void;
  closePanels?: () => void;
} = {};

/** True when this server offers dev tools to this environment and account. */
let devToolsAllowed = false;

async function initC01(): Promise<void> {
  // Nothing below can boot without the backend: configs come from `/config/*`
  // and the game arrives over `/ws`. Waiting here with an explanation beats the
  // blank white page a stopped server used to leave behind.
  await waitForServer({
    origin: httpOrigin,
    onAttempt: (attempt, reason) =>
      console.warn(`[PlantLegacy] server unreachable (${reason}), retry ${attempt}`),
  });

  // Start the sky's hour request now. It used to be the last round-trip before
  // the menu could mount, which added a few hundred milliseconds of blank screen
  // to every load; from here it overlaps the config fetches instead.
  const bootTime = fetchBootTime();

  // Load C01 configs
  const [
    loadedRenderConfig,
    loadedControlsConfig,
    uiConfig,
    loadedRootSightConfig,
    loadedMutationVisuals,
    loadedChatConfig,
    loadedReportsConfig,
    loadedNetworkConfig,
    loadedGrowthSegmentConfig,
    loadedDayNightConfig,
    loadedResourceTileConfig,
    loadedTerrainConfig,
    loadedTerrainVolumeConfig,
    loadedPhysicsConfig,
    loadedShopConfig,
    paletteConfig,
  ] = await Promise.all([
    loadRenderConfig(httpOrigin),
    loadControlsConfig(httpOrigin),
    loadUIConfig(httpOrigin),
    loadRootSightConfig(httpOrigin),
    loadMutationVisualsConfig(httpOrigin),
    loadChatConfig(httpOrigin),
    loadReportsConfig(httpOrigin),
    loadNetworkConfig(httpOrigin),
    loadGrowthSegmentConfig(httpOrigin),
    loadDayNightConfig(httpOrigin),
    loadResourceTileConfig(httpOrigin),
    loadTerrainConfig(httpOrigin),
    loadTerrainVolumeConfig(httpOrigin),
    loadPhysicsConfig(httpOrigin),
    loadShopConfig(httpOrigin),
    loadPaletteConfig(httpOrigin),
  ]);

  renderConfig = loadedRenderConfig;
  shopConfig = loadedShopConfig;
  growthSegmentConfig = loadedGrowthSegmentConfig;
  dayNightConfig = loadedDayNightConfig;
  tileConfig = loadedResourceTileConfig;
  controlsConfig = loadedControlsConfig;
  rootSightConfig = loadedRootSightConfig;
  // A8: the file's presentation values reach the shared uniforms before the
  // first frame, not only once `updateRootSight` happens to run.
  applyRootSightConfig(soilCutawayUniforms, rootSightConfig);
  // T04: appearance is data. Install the style table before any plant draws.
  configureMutationVisuals(loadedMutationVisuals.styles, loadedMutationVisuals.caps);
  rootSightMachine = createRootSightStateMachine(rootSightConfig);
  chatConfig = loadedChatConfig;
  reportConfig = loadedReportsConfig;
  networkConfig = loadedNetworkConfig;
  configureTerrain(loadedTerrainConfig, loadedRenderConfig.soilDepthM);
  physicsConfig = loadedPhysicsConfig;

  // Build input bus
  inputBus = createInputBus({ bindings: currentBindings() });
  // An empty binding table is not a subtle failure: every named action - Root
  // Sight, recenter, grow mode, emotes - stops existing and the keys do nothing
  // with no error anywhere. Say so out loud instead of leaving a player (or a
  // probe) to guess.
  if (inputBus.actions.length === 0) {
    console.error(
      '[PlantLegacy] controls config carried no bindings: every keyboard action is dead.',
    );
  }

  // A01: one colour source, published once before the HUD can paint. The
  // palette's steps and roles become --palette-*, and `config/ui.json`'s design
  // tokens resolve through those roles to --pl-theme-*, so the stylesheet names
  // paper or a ladder step and never a hex.
  applyPaletteCssVars(paletteConfig, uiConfig.theme);
  // The plant reads the same file: nine organ materials, painted once before
  // the renderer can build an organ.
  applyOrganPalette(paletteConfig);
  // And the world: the sun, the sky fill and the water, before any of the
  // shaders that use them are built.
  applyWorldPalette(paletteConfig);

  // Build UI shell
  uiShell = createUIShell(uiConfig);
  // The title screen is built after initC01 returns, so the resolved UI config
  // has to survive the function.
  resolvedUiConfig = uiConfig;
  // The title does not need the rest of this function (environment renderer,
  // physics, HUD, dev panel): mount it now, over a world that finishes building
  // behind it. `bootEntryFlow` at the tail enables Play.
  void startEntryFlow(bootTime);
  // Type floors come from config, so they are applied as soon as it is known
  // rather than only when the player nudges the text scale.
  applyHudFontSizes();
  chatHudZIndex = uiConfig?.layers?.hud ?? 100;

  // Create HUD elements early so they're ready when WELCOME arrives
  createResourceReadout();
  createGrowthSelectionUI();
  createChatUI();

  // T04: mutation set, upkeep and the adaptive-pressure readout. It only
  // appears once the server says this plant carries something.
  mutationPanel = createMutationPanel({
    onShed: (shedPlantId, mutationId) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: MESSAGE_TYPE.MUTATION_SHED,
            payload: { plantId: shedPlantId, mutationId },
          }),
        );
      }
    },
  });
  // Mutation details now live in the Inspect panel; the old bottom-left panel
  // is kept in sync but not shown, so there is one place for the list.
  mutationPanel.panel.style.display = 'none';

  plantStatusHud = createPlantStatusHud({
    onReroot: handleRerootControl,
    updateIntervalMs: uiConfig.hudUpdateIntervalMs,
    vignetteDurationMs: uiConfig.damageVignetteMs,
    healthThresholds: {
      healthy: uiConfig.healthHealthyFraction,
      stressed: uiConfig.healthStressedFraction,
      withering: uiConfig.healthWitheringFraction,
    },
  });
  document.body.appendChild(plantStatusHud.element);

  // Debug overlay
  if (renderConfig.debugOverlayEnabled) {
    debugOverlay = createDebugOverlay(uiShell);
  }

  // Dev Panel (C01 - comprehensive dev controls) - D01: only with ?dev=1, and
  // only when this server actually offers dev tools. `?dev=1` is a request, not
  // a grant: the server refuses DEV_ACTION by environment and account, so a
  // player who types the parameter would otherwise get a panel whose every
  // control came back `dev_access_denied`.
  const hudLayer = uiShell.getLayer('hud');
  const devToolsReachable = await probeDevTools();
  // The server is the authority: without it, no dev surface and no dev readout.
  devToolsAllowed = isDevMode && devToolsReachable;
  if (!devToolsAllowed && detailVisible) setTickReadoutVisible(false);
  bindHudChromeKeys();
  if (hudLayer && isDevMode && devToolsReachable) {
    /** Dev actions go to the server; the panel is not the owner of world state. */
    const sendDevAction = (action: Record<string, unknown>): void => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: MESSAGE_TYPE.DEV_ACTION, payload: action }));
      }
    };
    devPanel = createDevPanel({
      diagnostics: {
        metricsOverlay: {
          get: () => debugOverlay?.isVisible() ?? false,
          set: (on) => debugOverlay?.setVisible(on),
        },
        growthReadout: {
          get: () => growthDebugVisible,
          set: (on) => {
            if (on !== growthDebugVisible) toggleGrowthDebug();
          },
        },
        tickReadout: {
          get: () => detailVisible,
          set: (on) => setTickReadoutVisible(on),
        },
      },
      environmentRenderer: {
        // The clock is world state. A local set was reverted by the next weather
        // broadcast and no other player ever saw it, so each of these also moves
        // the server's clock, which re-broadcasts the hour to everyone.
        setTimeOfDay: (t: number) => {
          environmentRenderer?.setTimeOfDay(t);
          sendDevAction({ type: 'dev_set_time', time_of_day: t });
        },
        setTimeFrozen: (frozen: boolean) => {
          environmentRenderer?.setTimeFrozen(frozen);
          sendDevAction({ type: 'dev_set_time', paused: frozen });
        },
        getTimeFrozen: () => environmentRenderer?.isTimeFrozen() ?? false,
        setTimeScale: (scale: number) => {
          environmentRenderer?.setTimeScale(scale);
          sendDevAction({ type: 'dev_set_time', scale });
        },
        getTimeScale: () => environmentRenderer?.getTimeScale() ?? 1,
        setWeatherState: (stateName: string) => {
          // Change the world's weather, not just this screen's. The server
          // broadcasts its own state roughly once a tick, so a client-only
          // change was overwritten immediately - the select did nothing, and
          // no rain ever fell because the authoritative state was still clear.
          environmentRenderer?.setWeatherState(stateName);
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: MESSAGE_TYPE.DEV_ACTION,
                payload: { type: 'dev_set_weather', state: stateName, duration_s: 240 },
              }),
            );
          }
        },
        getTimeOfDay: () => environmentRenderer?.getTimeOfDay() ?? 0,
        getWeatherState: () => environmentRenderer?.getWeatherState() ?? 'clear',
        getSunIntensity: () => environmentRenderer?.getSunIntensity() ?? 1.0,
      },
      resourceWorld: {
        getRates: () =>
          tileConfig?.rates ?? {
            photosynthesisRate: 1,
            diffusionRate: 0.03,
            maxAbsorptionPerTick: 1,
            rainGainPerS: 1.5,
            evaporationPerS: 0.025,
            canopyShadeReduction: 0.1,
            groundwaterCapacity: 400,
          },
        setRate: (key, value) => {
          // Keep the panel's own reading in step with what was just applied, then
          // hand the change to the authoritative simulation.
          if (tileConfig) tileConfig.rates[key] = value;
          const wireKey: Record<keyof ResourceRates, string> = {
            photosynthesisRate: 'photosynthesis_rate',
            diffusionRate: 'diffusion_rate',
            maxAbsorptionPerTick: 'max_absorption_per_tick',
            rainGainPerS: 'rain_gain_per_s',
            evaporationPerS: 'evaporation_per_s',
            canopyShadeReduction: 'canopy_shade_reduction',
            groundwaterCapacity: 'groundwater_capacity',
          };
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          ws.send(
            JSON.stringify({
              type: MESSAGE_TYPE.DEV_ACTION,
              payload: { type: 'dev_set_resources', [wireKey[key]]: value },
            }),
          );
        },
        getGroundwaterFraction: () => localGroundwaterFraction,
        setTileResources: (
          _x: number,
          _z: number,
          _resources: { light?: number; moisture?: number; minerals?: number },
        ) => {
          // Local visual update only; server sync via sendToServer
        },
        // The client only receives coverage for the tiles under its own plant,
        // so the inspector shows those readings instead of fabricated zeros.
        getTileResources: (_x: number, _z: number) => ({
          light: tileLight,
          moisture: tileWater,
          minerals: tileMinerals,
        }),
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
        setPlanetView: (enabled: boolean) => setPlanetView(enabled),
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
          applyHudFontSizes();
        },
      },
      plantState: {
        getPlantId: () => plantId,
        getPlantNodes: () => plantNodes,
      },
      inventory: {
        getDefinitions: () =>
          inventoryDefinitions.map((definition) => ({ id: definition.id, name: definition.name })),
        grant: (itemId: string, count: number) => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: MESSAGE_TYPE.DEV_ACTION,
                payload: { type: 'dev_grant_item', itemId, count },
              }),
            );
          }
        },
      },
      benchmark: {
        start: () => startBenchmark(),
        isRunning: () => benchmarkRunner?.isRunning ?? false,
        getReport: () => lastBenchmarkReport,
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
      void inputState;
      // Toggle bindings fire on both edges; see the note on the gameplay
      // toggles below. Guarding on `toggled` skipped every second press.
      if (actionId === 'debug_toggle') {
        if (debugOverlay) debugOverlay.setVisible(!debugOverlay.isVisible());
      }
    },
  );

  // Dev panel toggle (backtick `) - only available in dev mode
  inputBus.subscribe(
    (actionId, inputState: { pressed: boolean; toggled?: boolean; active?: boolean }) => {
      void inputState;
      if (actionId === 'dev_panel_toggle') {
        if (devPanel) devPanel.toggle();
      }
    },
  );

  // Grow mode state. The mode is not a badge any more: one line at the very
  // bottom of the screen says which key toggles it and shows whether it is on.
  let isGrowMode = false;
  // Quality controller: static tier plus the AL-03 measured-cost band.
  qualityController = createQualityController({
    targetFps: renderConfig.targetFps,
    fpsWarningThreshold: renderConfig.fpsWarningThreshold,
    resolutionFloor: renderConfig.resolutionFloor,
    maxPixelRatio: renderConfig.maxPixelRatio,
    qualityTiers: renderConfig.qualityTiers,
    gpuBandMinMs: renderConfig.gpuBandMinMs,
    gpuBandMaxMs: renderConfig.gpuBandMaxMs,
    holdMs: renderConfig.qualityHoldMs,
    drawDistanceFloor: renderConfig.drawDistanceFloor,
    warmupMs: renderConfig.qualityWarmupMs,
    smoothing: renderConfig.qualitySmoothing,
    // Native, not 1: the band used to clamp estimated mode to a ratio of 1,
    // which on a scaled display is below the screen's own density, so the 3D
    // world - plants included - was drawn permanently soft.
    nativePixelRatio: window.devicePixelRatio || 1,
  });

  // AL-01: the six fixed poses and the size class live in config/dev.json.
  devSettings = await loadDevSettings('');
  gpuTimer = createGpuTimer(renderer.getContext() as WebGL2RenderingContext);
  benchmarkRunner = new BenchmarkRunner({
    poses: devSettings.benchmarkPoses,
    warmupMs: devSettings.benchmarkWarmupMs,
    poseMs: devSettings.benchmarkPoseMs,
    applyPose: applyBenchmarkPose,
    onFinish: (report) => {
      lastBenchmarkReport = report;
      console.table(report.poses);
      uiShell?.toast({
        message: `Benchmark: ${report.overall.p95FrameMs.toFixed(1)} ms p95 across ${report.poses.length} poses.`,
        kind: 'info',
        durationMs: 8000,
      });
    },
  });
  applyCameraRange();

  // Apply the camera and shadow tunables from config/render.json.
  controls.dampingFactor = renderConfig.cameraSmoothing;
  // The orbit limits are the camera's physical range of travel: it may come no
  // closer than camera_min_distance (so it never ends up inside the plant) and
  // no further than the far plane.
  controls.minDistance = renderConfig.cameraMinDistance;
  controls.maxDistance = effectiveCameraMaxDistance();
  controls.maxPolarAngle = renderConfig.cameraMaxPolarAngle;
  sunLight.shadow.mapSize.set(renderConfig.shadowMapSize, renderConfig.shadowMapSize);
  // A shadow texel covers a large patch of the ground, so without these the
  // soil plane self-shadows at low sun angles and the near ground reads as a
  // separate grey slab beneath the dirt.
  sunLight.shadow.bias = renderConfig.shadowBias;
  sunLight.shadow.normalBias = renderConfig.shadowNormalBias;

  // C03: Initialize environment rendering (sky dome, diurnal grading, fog, rain, ground soil tint)
  const waterTuning = await loadWaterTuning('');
  environmentRenderer = new EnvironmentRenderer(
    scene,
    camera,
    renderConfig,
    sunLight,
    ambientLight,
    hemisphereLight,
    soilCutawayUniforms,
    {
      dayLengthSeconds: dayNightConfig.cycleLengthS,
      tiles: tileConfig,
      water: waterTuning,
      // The dug wall's three strata and its sky fill, from
      // config/root_sight.json. Passed here because this renderer builds the
      // cavity shell, and the palette is presentation, not a Root Sight uniform.
      cavity: cavityPaletteFromWorld({
        nightFill: rootSightConfig.cavityNightFill,
        dayFill: rootSightConfig.cavityDayFill,
      }),
      // T56 slice 1: the authored region the volume mesher draws.
      volume: loadedTerrainVolumeConfig,
    },
  );

  // The boot hour was fetched while this renderer did not exist; prime it now
  // so the first world frame is the right hour instead of the default.
  if (bootWorldTime !== null) environmentRenderer.primeTimeOfDay(bootWorldTime);

  // Initialize Rapier physics world (client-side cosmetic simulation)
  try {
    await rapierWorld.init({ x: 0, y: -(physicsConfig?.gravityMps2 ?? 9.81), z: 0 });

    // Static soil collider: the camera is a physical observer, so it cannot
    // pass through the ground. There is no cap on the planet any more, so the
    // collider is the planet itself — the player can walk all the way around it
    // instead of stopping at the edge of a local box. A flat world keeps the
    // box, which is the whole of a flat world.
    const planetRadiusM = renderConfig.planetRadiusM;
    const soilBody = rapierWorld
      .getWorld()
      .createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(0, planetRadiusM > 0 ? -planetRadiusM : -1, 0),
      );
    soilColliderRef.current = rapierWorld
      .getWorld()
      .createCollider(
        planetRadiusM > 0
          ? RAPIER.ColliderDesc.ball(planetRadiusM)
          : RAPIER.ColliderDesc.cuboid(renderConfig.terrainRadius, 1, renderConfig.terrainRadius),
        soilBody,
      );

    // The visible ground is the sphere plus hills, and the sphere alone would
    // leave anything physical standing at the sphere while the hills rise above
    // it — the player ends up buried up to the waist in a mound. Every drawn
    // ground patch is collided exactly: the detail patch near the play area and
    // the coarse patch out to the horizon. The ball stays for the rest of the
    // planet and as the floor under the relief, which is raise-only.
    for (const terrainPatch of environmentRenderer?.terrainMeshes ?? []) {
      const geometry = terrainPatch.geometry;
      const positions = geometry.getAttribute('position');
      const vertices = new Float32Array(positions.count * 3);
      // Patch geometry is authored in patch-local metres and placed by its own
      // transform (it sits at `+radius` inside the planet body). The collider takes
      // the same placement rather than having it baked into its vertices: the
      // trimesh stays patch-local, so its float32 storage does not pay the radius
      // either, and it lands on the same surface the mesh draws.
      for (let i = 0; i < positions.count; i += 1) {
        vertices[i * 3] = positions.getX(i);
        vertices[i * 3 + 1] = positions.getY(i);
        vertices[i * 3 + 2] = positions.getZ(i);
      }
      const index = geometry.getIndex();
      const indices = index
        ? Uint32Array.from(index.array as ArrayLike<number>)
        : Uint32Array.from({ length: positions.count }, (_, i) => i);
      terrainColliderRefs.push(
        rapierWorld
          .getWorld()
          .createCollider(
            RAPIER.ColliderDesc.trimesh(vertices, indices).setTranslation(
              terrainPatch.position.x,
              terrainPatch.position.y,
              terrainPatch.position.z,
            ),
            soilBody,
          ),
      );
    }

    if (physicsConfig) {
      plantColliders = new PlantColliderManager();
      plantColliders.configure(physicsConfig);
    }
    physicsReady = true;
    setDetail('Physics initialized');
  } catch (err) {
    console.error('[PlantLegacy] Failed to initialize Rapier physics:', err);
    physicsReady = false;
    setDetail('Physics unavailable');
  }

  // Grow mode is a mode, and it has to look like one: a tinted edge, a crosshair
  // and a badge, plus the action bar's Grow button held down. It used to be a
  // line inside the tick card, which was not on screen for players at all.
  function setGrowMode(enabled: boolean): void {
    isGrowMode = enabled;
    growModeHud = enabled;
    setGrowModeChrome(enabled);
    if (enabled) {
      uiShell?.toast({ message: 'Grow mode enabled', kind: 'info', durationMs: 1800 });
      contextHint?.show({
        id: 'grow-pick-node',
        text: 'Click a part of your plant to see what it can grow.',
        touchText: 'Tap a part of your plant to see what it can grow.',
        key: 'G',
      });
    } else {
      uiShell?.toast({ message: 'Grow mode disabled', kind: 'info', durationMs: 1800 });
      hideGrowthSelection();
    }
  }

  function toggleGrowMode(): void {
    setGrowMode(!isGrowMode);
  }

  worldActions.grow = toggleGrowMode;
  worldActions.inventory = () => togglePlayerPanels();
  worldActions.emotes = () => showEmoteWheel();
  worldActions.hideEmotes = () => hideEmoteWheel();
  // Whether the wheel is *shown*, not whether its element exists. The wheel is
  // built at world setup, so the existence test was true from the first frame:
  // Escape hit this branch on every press and returned, and the pause menu —
  // now the only route to Settings — could not be opened by keyboard at all.
  worldActions.emoteOpen = () => emoteWheelOpen;
  worldActions.setGrow = (enabled: boolean) => setGrowMode(enabled);
  worldActions.closePanels = () => {
    if (!playerPanels?.isOpen) return;
    playerPanels.setOpen(false);
    restoreOverlappingHud();
  };

  // C04: inspect (left) and inventory (right), opened together with I. The
  // world stays visible between them. Overlapping HUD panels are hidden while
  // these are open, then restored to their previous display value.
  //
  // They are siblings, not one dialog: the key opens both, but from then on the
  // Inventory key and button toggle the pouch only, and closing Inspect on its
  // own leaves the pouch exactly where it was.
  function togglePlayerPanels(): void {
    if (!playerPanels) return;
    const inspectOpen = playerPanels.isPanelOpen('inspect');
    const inventoryOpen = playerPanels.isPanelOpen('inventory');
    if (!inspectOpen && !inventoryOpen) {
      playerPanels.setOpen(true);
      // Opened by the Inventory key or button, so the inventory face comes first on
      // the phone sheet; Inspect is one tap away in the switch.
      playerPanels.showInventory();
      hideOverlappingHud();
      requestInventory();
      refreshPlayerPanels();
      return;
    }
    playerPanels.setPanelOpen('inventory', !inventoryOpen);
    if (!playerPanels.isOpen) {
      restoreOverlappingHud();
      return;
    }
    hideOverlappingHud();
    requestInventory();
    refreshPlayerPanels();
  }

  playerPanels = createPlayerPanels({
    healthThresholds: {
      healthy: uiConfig.healthHealthyFraction,
      stressed: uiConfig.healthStressedFraction,
      withering: uiConfig.healthWitheringFraction,
    },
    onClose: () => restoreOverlappingHud(),
    onUseItem: (slotIndex) => useInventorySlot(slotIndex),
    // Level a mutation: no card asks the server to deal the cards, a card takes
    // one of the cards it dealt. The client never invents the choice.
    onLevelMutation: (mutationId, cardId) => {
      if (!plantId || !ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          type: MESSAGE_TYPE.MUTATION_LEVEL,
          payload: { plantId, mutationId, ...(cardId ? { cardId } : {}) },
        }),
      );
    },
  });
  document.body.appendChild(playerPanels.inspect);
  document.body.appendChild(playerPanels.inventory);

  settingsPanel = createSettingsPanel({
    bindings: currentBindings(),
    initialTextScale: uiConfig.textScale,
    initialReducedMotion:
      uiConfig.reducedMotion ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
    initialSound: isPlantSoundEnabled(),
    initialPlantCursors: plantCursorsEnabled(),
    onPlantCursors: (enabled) => setCursorTheme(enabled ? 'plant' : 'default'),
    onRebind: (action, code) => {
      const result = rebindAction(currentBindings(), action, code);
      if (!result) return;
      // Persist every action that moved, so a key taken from another action
      // stays taken after a reload instead of coming back from the config.
      Object.assign(controlOverrides, result.changes);
      saveControlOverrides(window.localStorage, controlOverrides);
      inputBus?.setBindings(result.bindings);
      settingsPanel?.setBindings(result.bindings);
      syncActionBarKeys();
      if (result.displaced.length > 0) {
        notify(`${result.displaced.map(prettyAction).join(', ')} lost that key.`, 'state', 3000);
      }
    },
    onResetBindings: () => {
      controlOverrides = {};
      saveControlOverrides(window.localStorage, controlOverrides);
      const base = currentBindings();
      inputBus?.setBindings(base);
      settingsPanel?.setBindings(base);
      syncActionBarKeys();
      notify('Bindings reset to the config.', 'info', 2000);
    },
    onTextScale: (scale) => uiShell?.setTextScale(scale),
    onReducedMotion: (enabled) => {
      document.documentElement.dataset.reducedMotion = String(enabled);
    },
    // The title plant's creaks and knocks are the only sound in the game so far,
    // so this switch is the whole sound setting: the sound module owns the
    // preference and every live plant instance mutes with it.
    onSound: (enabled) => setPlantSoundEnabled(enabled),
    // While the panel is up the title's H shortcut must not fire behind it.
    onOpenChange: (open) => entryScreen?.setOverlayOpen(open),
  });
  // The pointer theme is applied once at boot: it is a CSS dataset on the root, so
  // every layer (title, HUD, panels) picks it up without knowing about it.
  applyCursorTheme(readCursorTheme());

  // Mount the panel in the modal layer, not on <body>. On the body it stacked at
  // z-index 380 in the root context, which is *below* the modal layer (400) the
  // title screen lives in: opening Settings from the title did nothing visible,
  // and the panel was still open (and therefore visible) when the world loaded -
  // the click "worked" one screen later. Inside the layer it paints above the
  // title (380 against auto) and still above the HUD.
  if (uiShell) uiShell.attachTo('modal', settingsPanel.element);
  else document.body.appendChild(settingsPanel.element);

  // Action bar, contextual hints and the pause menu: the world's chrome, built
  // once the HUD layers and the settings panel exist.
  createWorldChrome();

  // Emote definitions
  const EMOTES = [
    { id: 'wave', label: 'Wave' },
    { id: 'cheer', label: 'Cheer' },
    { id: 'thumbs_up', label: 'Thumbs Up' },
    { id: 'heart', label: 'Heart' },
    { id: 'think', label: 'Think' },
    { id: 'sleep', label: 'Sleep' },
    { id: 'dance', label: 'Dance' },
    { id: 'sad', label: 'Sad' },
  ] as const;

  let emoteWheelElement: HTMLDivElement | null = null;
  let emoteWheelOpen = false;

  createEmoteWheel();

  function createEmoteWheel(): void {
    const wheel = document.createElement('div');
    wheel.id = 'emote-wheel';
    wheel.className = 'hud-panel';
    wheel.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0.85);
      z-index: 400;
      pointer-events: auto;
      opacity: 0;
      transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1),
                  transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
      display: none;
      width: min(340px, 90vw);
      max-width: 340px;
      padding: 18px;
    `;

    const radius = 110;
    const centerSize = 72;

    // Center close button
    const center = document.createElement('button');
    center.type = 'button';
    center.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: ${centerSize}px;
      height: ${centerSize}px;
      border-radius: 50%;
      background: var(--bark-800);
      border: 1px solid var(--hud-border);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: calc(1.4rem * var(--text-scale));
      color: var(--bone-100);
      cursor: pointer;
      z-index: 10;
      box-shadow: var(--hud-shadow);
      transition: var(--hud-transition);
    `;
    center.textContent = 'X';
    center.title = 'Close (Esc or click away)';
    center.addEventListener('mouseenter', () => {
      center.style.borderColor = 'var(--leaf-400)';
      center.style.background = 'var(--bark-700)';
    });
    center.addEventListener('mouseleave', () => {
      center.style.borderColor = 'var(--hud-border)';
      center.style.background = 'var(--bark-800)';
    });
    center.addEventListener('click', hideEmoteWheel);
    wheel.appendChild(center);

    // Emote buttons in a circle
    EMOTES.forEach((emote, index) => {
      const angle = (index / EMOTES.length) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.emoteId = emote.id;
      btn.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) translate(${x}px, ${y}px);
        width: ${centerSize * 0.75}px;
        height: ${centerSize * 0.75}px;
        border-radius: 50%;
        background: var(--bark-800);
        border: 1px solid var(--hud-border);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        font-size: calc(1.1rem * var(--text-scale));
        font-weight: 700;
        color: var(--bone-100);
        cursor: pointer;
        box-shadow: var(--hud-shadow);
        transition: var(--hud-transition);
        line-height: 1.15;
      `;
      btn.textContent = emote.label;

      btn.addEventListener('mouseenter', () => {
        btn.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(1.15)`;
        btn.style.borderColor = 'var(--leaf-400)';
        btn.style.background = 'var(--bark-700)';
        btn.style.color = 'var(--leaf-300)';
        btn.style.boxShadow = '0 0 0 3px var(--leaf-glow), var(--hud-shadow)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(1)`;
        btn.style.borderColor = 'var(--hud-border)';
        btn.style.background = 'var(--bark-800)';
        btn.style.color = 'var(--bone-100)';
        btn.style.boxShadow = 'var(--hud-shadow)';
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

    emoteWheelOpen = true;
    wheel.style.display = 'block';
    requestAnimationFrame(() => {
      wheel.style.opacity = '1';
      wheel.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    // Escape is owned by handleEscapeKey, which closes the wheel first and only
    // then offers the pause menu. A local Escape listener here had to be removed
    // by itself to avoid leaking one per open, and closing by clicking outside
    // never removed it.
  }

  function hideEmoteWheel(): void {
    if (!emoteWheelElement) return;
    emoteWheelOpen = false;
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
      // Uprooted movement keys drive the crawl instead of the camera.
      if (handleRerootMovementKey(actionId, state.active ?? false)) return;
      if (actionId === 'camera_pan_forward') cameraPanState.forward = state.active ?? false;
      if (actionId === 'camera_pan_backward') cameraPanState.backward = state.active ?? false;
      if (actionId === 'camera_pan_left') cameraPanState.left = state.active ?? false;
      if (actionId === 'camera_pan_right') cameraPanState.right = state.active ?? false;

      if (actionId === 'grow_cancel' && state.pressed) hideGrowthSelection();

      if (actionId === 'camera_recenter' && state.pressed) {
        // The player's own recenter: centred on the plant, at the angle they were
        // already looking from. The pitch correction is for automatic framing only.
        recenterCamera(false);
      }
      // Regenerating the test plant is a dev-panel button, not a key. It used to
      // be a public binding on P, so a player pressing P for any reason (or a
      // player who read the old controls page that said R) replaced their plant
      // with a test specimen. `config/controls.json` has no such action now.
      if (actionId === 'root_sight_toggle' && rootSightMachine) {
        // Toggle from the machine itself. Trusting the input bus's latched
        // `active` flag meant a latch that had drifted from the machine (after a
        // reconnect, or on the first press of a session) asked to *disable* an
        // already-closed Root Sight: R did nothing at all until it was pressed
        // again. The machine is the authority on whether the cavity is open.
        // No `pressed`/`toggled` guard here. A toggle-mode action emits once per
        // press edge, and its *off* edge arrives as pressed:false toggled:false,
        // so guarding on those flags dropped every second press: R opened the
        // cavity and then could never close it again.
        void state;
        toggleRootSight();
      }
      // No `pressed`/`toggled` guard on any of these. A toggle-mode binding
      // emits on both edges: the on edge arrives as { pressed: false, toggled:
      // true } and the off edge as { pressed: false, toggled: false }. Guarding
      // on those flags therefore ran the handler on every other press only - H
      // could open the hint card but never close it, I opened the panels and
      // refused to shut them, G armed grow mode and would not disarm it, and O
      // did the same with settings.
      void state;
      if (actionId === 'hint_card_toggle') toggleHintCard();
      if (actionId === 'grow_mode_toggle') toggleGrowMode();
      if (actionId === 'inventory_overview_toggle') togglePlayerPanels();
      if (actionId === 'settings_toggle') settingsPanel?.toggle();
      if (actionId === 'emote_wheel' && state.pressed) {
        showEmoteWheel();
      }
      // Hotbar slots (1-0). The keys used to select a slot only when the
      // inventory panel was already open, so during play they did nothing at all.
      // Now they select the hotbar slot and use it, which is what the number keys
      // were always advertised to do; with the inventory open they only move the
      // selection, because a key press while reading the pouch should not spend
      // an item by accident.
      if (actionId.startsWith('inventory_slot_') && state.pressed) {
        const slotNum = parseInt(actionId.replace('inventory_slot_', ''), 10);
        if (!Number.isNaN(slotNum)) {
          const index = slotNum - 1;
          // Two surfaces, two selections. With the inventory open the number keys
          // address the pouch only; in the world they address the hotbar only.
          // The keys used to do both at once, which moved the inventory highlight
          // from a key the player pressed to select a hotbar slot.
          if (playerPanels?.isOpen) {
            playerPanels.selectSlot(index);
          } else {
            hotbar?.use(index);
          }
        }
      }
    },
  );

  // Keyboard producer
  window.addEventListener('keydown', (e) => {
    // The entry screen is a modal: until the server has welcomed us, keystrokes
    // belong to the form (or the title), not to the camera, grow mode or chat.
    if (entryFlow.step !== 'world') return;
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
    if (entryFlow.step !== 'world') return;
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

  // Screen-space distance from the pointer to the part being aimed from. A drag
  // that starts further away is a camera gesture, not an aim turn.
  // Same anchor the gizmo uses: the seed mesh is drawn above its node position.
  const aimAnchorFor = (position: THREE.Vector3, nodeId: string): THREE.Vector3 => {
    const node = plantNodes.get(nodeId);
    // Same attach point the gizmo is drawn from (mid-segment for a lateral root
    // or branch), plus the seed's own body lift when the node is the seed. The
    // part is measured where it is drawn, so a node that is still emerging is
    // grabbable at its visible tip instead of at its future position.
    const anchor = branchAttachAnchor(node ? drawnNodePosition(node) : position, nodeId);
    if (!node) return anchor;
    if (node.isSeed === true || node.nodeType === 'seed') {
      anchor.y +=
        resolveDrawnRadius(node.nodeType, node.radius ?? 0.05, node.biomass) *
        getSeedBodyHeightRatio();
    }
    return anchor;
  };

  const aimTargetScreenDistance = (clientX: number, clientY: number): number => {
    const data = growthSelectionStateMachineGetDrawingData(growthSelectionMachine);
    if (!data) return Number.POSITIVE_INFINITY;
    const rect = canvas.getBoundingClientRect();
    const projected = aimAnchorFor(
      new THREE.Vector3(data.nodePosition.x, data.nodePosition.y, data.nodePosition.z),
      data.nodeId,
    ).project(camera);
    if (projected.z > 1) return Number.POSITIVE_INFINITY;
    const sx = rect.left + (projected.x * 0.5 + 0.5) * rect.width;
    const sy = rect.top + (-projected.y * 0.5 + 0.5) * rect.height;
    return Math.hypot(clientX - sx, clientY - sy);
  };

  // How much of the screen the part occupies, so clicking anywhere on the part
  // (not just its centre) starts an aim drag.
  const aimTargetScreenRadius = (): number => {
    const data = growthSelectionStateMachineGetDrawingData(growthSelectionMachine);
    const node = data ? plantNodes.get(data.nodeId) : undefined;
    if (!data || !node) return 0;
    const rect = canvas.getBoundingClientRect();
    const worldRadius = resolveDrawnRadius(node.nodeType, node.radius ?? 0.05, node.biomass);
    const anchor = aimAnchorFor(
      new THREE.Vector3(data.nodePosition.x, data.nodePosition.y, data.nodePosition.z),
      data.nodeId,
    );
    const centre = anchor.clone().project(camera);
    const edge = anchor
      .clone()
      .setX(anchor.x + worldRadius)
      .project(camera);
    return Math.abs(edge.x - centre.x) * 0.5 * rect.width;
  };

  // Screen-space distance to the drawn arrow, so grabbing the arrow anywhere
  // along its length turns the aim instead of orbiting the camera.
  const aimArrowScreenDistance = (clientX: number, clientY: number): number => {
    if (growthAimPath.length < 2) return Number.POSITIVE_INFINITY;
    const rect = canvas.getBoundingClientRect();
    const toScreen = (p: THREE.Vector3) => {
      const v = p.clone().project(camera);
      return {
        x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
      };
    };
    let best = Number.POSITIVE_INFINITY;
    let prev = toScreen(growthAimPath[0]);
    for (let i = 1; i < growthAimPath.length; i++) {
      const cur = toScreen(growthAimPath[i]);
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      const lengthSq = dx * dx + dy * dy;
      const t =
        lengthSq > 1e-6
          ? Math.max(0, Math.min(1, ((clientX - prev.x) * dx + (clientY - prev.y) * dy) / lengthSq))
          : 0;
      best = Math.min(best, Math.hypot(clientX - (prev.x + dx * t), clientY - (prev.y + dy * t)));
      prev = cur;
    }
    return best;
  };

  const startGrowthDragFromEvent = (e: MouseEvent | PointerEvent): boolean => {
    const gState = growthSelectionStateMachineGetState(growthSelectionMachine);
    // Only an active aim can be grabbed. Starting an aim from option_selected
    // used to happen on any canvas press, so clicking off the panel silently
    // re-armed the gizmo instead of closing it.
    if (gState !== 'drawing') return false;
    // Dragging the part or the arrow turns the aim; anywhere else the camera
    // orbits as usual.
    const grabRadiusPx = Math.max(renderConfig?.growthAimGrabPx ?? 34, aimTargetScreenRadius());
    const onPart =
      aimTargetScreenDistance(e.clientX, e.clientY) <= grabRadiusPx ||
      pickGrowthAimNodePoint(e.clientX, e.clientY) !== null;
    const onArrow = aimArrowScreenDistance(e.clientX, e.clientY) <= grabRadiusPx;
    if (!onPart && !onArrow) return false;
    // A press on the node itself also chooses where the golden ring sits. The
    // old gizmo always used the node's cap; this lets the player carry it to the
    // side, underside or back of the selected part before steering the arrow.
    if (onPart) {
      placeGrowthAimRingFromScreen(e.clientX, e.clientY);
      applyGrowthAimAngles();
    }
    growthAimDragging = true;
    growthAimLastX = e.clientX;
    growthAimLastY = e.clientY;
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
        // Swallow just this drag so OrbitControls never sees it; the camera stays
        // enabled, so a drag anywhere else still orbits.
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
    if (performance.now() < suppressGrowthClickUntil) return;

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

    // A drop under the pointer is collected before the plant is considered: a
    // marker often sits on the soil beside a root, and the node sphere would
    // otherwise swallow the click. The reach limit means a click on the horizon
    // collects nothing.
    const dropUnderPointer = worldDrops.pick(raycaster);
    if (dropUnderPointer) {
      collectDrop(dropUnderPointer);
      return;
    }

    // Pick any visible node, own plant or a rival's. The pick sphere has a
    // configurable world radius floor so a tiny seed is still clickable from
    // the close camera.
    const nodeObjects: THREE.Object3D[] = [];
    interface PickTarget {
      plantId: string;
      nodeId: string;
      isOwn: boolean;
      nodes: Map<string, PlantNodeData>;
    }
    const nodeMap = new Map<THREE.Object3D, PickTarget>();
    const cameraBelowGround = isBelowSoil(camera.position, soilQuery());
    const isRootSightEnabled = rootSightMachine
      ? rootSightStateMachineIsEnabled(rootSightMachine)
      : false;
    const addPickable = (
      id: string,
      nodes: Map<string, PlantNodeData>,
      isOwn: boolean,
      onlyOwnNodes: boolean,
    ): void => {
      for (const [nodeId, nodeData] of nodes.entries()) {
        if (onlyOwnNodes && !nodeData.isOwnPlant) continue;
        // Allow picking:
        // - All canopy nodes (type >= 1)
        // - Seed node (isSeed === true) always
        // - Root nodes (type === 0) when in Root Sight mode OR camera is below ground
        if (nodeData.type === 0 && !nodeData.isSeed && !isRootSightEnabled && !cameraBelowGround)
          continue;
        const sphere = new THREE.Mesh(
          // A pick sphere the size of the part, on the part *as drawn*. A flat
          // 0.35 m floor on the server position made a small child root
          // unreachable: its sphere swallowed its parent's, the ray hit whichever
          // came first, and the growth panel then belonged to the parent.
          // Small enough to sit inside its own part rather than swallowing the
          // child growing out of it; the surface fallback still catches clicks on
          // a tube or a leaf between nodes.
          new THREE.SphereGeometry(Math.max(nodeData.radius * 1.15, 0.1), 8, 8),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
        );
        const pickParent = nodeData.parentId ? nodes.get(nodeData.parentId) : undefined;
        sphere.position.copy(resolveDrawnNodePosition(nodeData, pickParent, nodes.values()));
        sphere.updateMatrixWorld(true);
        nodeObjects.push(sphere);
        nodeMap.set(sphere, { plantId: id, nodeId, isOwn, nodes });
      }
    };
    addPickable(plantId ?? 'own', plantNodes, true, true);
    for (const [rivalPlantId, nodes] of otherPlayerPlants.entries()) {
      addPickable(rivalPlantId, nodes, false, false);
    }

    if (nodeObjects.length === 0) {
      hideGrowthSelection();
      return;
    }

    const intersects = raycaster.intersectObjects(nodeObjects);
    // A parent's sphere contains its children, so "first hit" picked the parent
    // for a click on the child. The resolver prefers the nearer sphere and, within
    // a small tie window, the deeper node - the child the player aimed at.
    const candidates = intersects.flatMap((hit) => {
      const target = nodeMap.get(hit.object);
      if (!target) return [];
      return [
        {
          nodeId: target.nodeId,
          parentId: target.nodes.get(target.nodeId)?.parentId ?? null,
          distance: hit.distance,
        },
      ];
    });
    const nodePick = pickNodeHit(candidates, renderConfig?.nodePickTieM ?? 0.02);
    const pickedHit = nodePick.nodeId
      ? intersects.find((hit) => nodeMap.get(hit.object)?.nodeId === nodePick.nodeId)
      : undefined;
    let picked: PickTarget | undefined = pickedHit ? nodeMap.get(pickedHit.object) : undefined;

    if (!picked) {
      // A click that lands on the drawn plant but on no node sphere - the tube
      // between two nodes, a leaf, a thorn - still names a node: the one that
      // owns that surface. Without this, clicking the middle of a branch fell
      // through the plant and closed the panel, which reads as a dead click.
      const surfaces = plantRenderer?.pickSurfaces() ?? [];
      if (surfaces.length > 0) {
        const surfaceByObject = new Map<THREE.Object3D, (typeof surfaces)[number]>();
        for (const surface of surfaces) surfaceByObject.set(surface.object, surface);
        const surfaceHit = raycaster.intersectObjects(
          surfaces.map((surface) => surface.object),
          false,
        )[0];
        const owned = surfaceHit ? surfaceByObject.get(surfaceHit.object) : undefined;
        if (owned) {
          picked = {
            plantId: owned.plantId ?? plantId ?? 'own',
            nodeId: owned.nodeId,
            isOwn: owned.isOwnPlant,
            nodes: owned.isOwnPlant
              ? plantNodes
              : (otherPlayerPlants.get(owned.plantId ?? '') ?? plantNodes),
          };
        }
      }
    }

    if (!picked) {
      // Clicked off-plant (but not on UI) -> close growth panel, and stop reading
      // a rival: the panel goes back to being about your own plant.
      hideGrowthSelection();
      playerPanels?.inspectOther(null);
      return;
    }

    const clickedNodeId = picked.nodeId;

    // Someone else's plant is inspected, never grown and never framed: a single
    // click is a look, and the growth panel belongs to your own plant. Its
    // detailed readout (stored water, minerals, options) is yours alone, so a
    // rival gets the low-detail face of Inspect - parts, biomass and owner, which
    // is everything the mirror actually sends - and never a growth option.
    if (picked && !picked.isOwn) {
      hideGrowthSelection();
      inspectOtherPlant(picked.plantId, picked.nodes);
      return;
    }
    playerPanels?.inspectOther(null);

    const growthState = growthSelectionStateMachineGetState(growthSelectionMachine);
    const selectedNodeId = growthSelectionMachine.selectedNodeId;
    const sameNode = clickedNodeId === selectedNodeId;

    if (growthState === 'option_selected' && sameNode) {
      const optionType =
        growthSelectionMachine.selectedOptionType ??
        growthSelectionMachine.drawingData?.selectedOptionType ??
        '';
      const optionLabel = growthSelectionMachine.selectedOptionLabel ?? optionType;
      if (optionType && beginGrowthAiming(clickedNodeId, optionType, optionLabel)) return;
    }
    if (growthState === 'drawing' && sameNode) return; // Keep the current aim.
    if ((growthState === 'options_visible' || growthState === 'loading') && sameNode) {
      // Clicking the node the panel already belongs to must not re-request its
      // options; that was the flash where the panel closed and re-opened.
      return;
    }

    // A different node starts a fresh selection; clicking off the plant already
    // returned above. Close the old panel/aim before opening the new one.
    if (growthState !== 'hidden' && growthState !== 'options_visible' && !sameNode) {
      hideGrowthSelection();
    }
    if (isGrowMode) {
      requestGrowthOptions(clickedNodeId);
    }
  });

  // Double-click a plant node to recenter on that node; double-click empty
  // ground to recenter on the whole plant (the double_click_ground binding,
  // same framing as Space). Single clicks and growth never move the view.
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
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    const rootSightOn = rootSightMachine ? rootSightStateMachineIsEnabled(rootSightMachine) : false;
    const camBelowGround = isBelowSoil(camera.position, soilQuery());

    // Pick the node whose projected centre is nearest the click, in screen
    // space, so no invisible pick meshes are needed. Rivals are pickable too:
    // double-clicking another player's part frames that part, because a click
    // that visibly lands on it and then frames your own plant reads as a bug.
    let picked: PlantNodeData | null = null;
    let pickedLookup: Map<string, PlantNodeData> = plantNodes;
    let pickedPx = NODE_DOUBLE_CLICK_PICK_PX;
    const consider = (nodes: Map<string, PlantNodeData>, onlyOwnNodes: boolean): void => {
      for (const node of nodes.values()) {
        if (onlyOwnNodes && !node.isOwnPlant) continue;
        // Underground nodes are only visible (and pickable) in the root layer.
        if (node.type === 0 && !node.isSeed && !rootSightOn && !camBelowGround) continue;
        const parent = node.parentId ? nodes.get(node.parentId) : undefined;
        nodePickVector.copy(resolveDrawnNodePosition(node, parent, nodes.values())).project(camera);
        if (nodePickVector.z > 1) continue; // behind the camera
        const px = ((nodePickVector.x + 1) / 2) * rect.width;
        const py = ((-nodePickVector.y + 1) / 2) * rect.height;
        const distancePx = Math.hypot(px - localX, py - localY);
        if (distancePx < pickedPx) {
          pickedPx = distancePx;
          picked = node;
          pickedLookup = nodes;
        }
      }
    };
    consider(plantNodes, true);
    for (const nodes of otherPlayerPlants.values()) consider(nodes, false);

    if (picked) focusCameraOnNode(picked, pickedLookup);
    else recenterCamera(false);
  });

  // Grabbing the camera cancels any automatic framing still in flight.
  canvas.addEventListener('pointerdown', () => {
    cameraUserMoved = true;
    cancelCameraAutoMove();
  });
  canvas.addEventListener(
    'wheel',
    () => {
      cameraUserMoved = true;
    },
    { passive: true },
  );

  // Dragging turns the aimed direction; it never sends growth and never drags a
  // line across the world (that read as a rope rather than a plant growing).
  const handleGrowthDrawMove = (e: MouseEvent | PointerEvent) => {
    if (!growthAimDragging) return;
    if (!growthSelectionStateMachineIsDrawing(growthSelectionMachine)) return;
    const dx = e.clientX - growthAimLastX;
    const dy = e.clientY - growthAimLastY;
    growthAimLastX = e.clientX;
    growthAimLastY = e.clientY;
    if (dx === 0 && dy === 0) return;
    rotateGrowthAim(dx, dy);
    e.preventDefault();
    e.stopPropagation();
  };
  canvas.addEventListener('mousemove', handleGrowthDrawMove);
  canvas.addEventListener('pointermove', handleGrowthDrawMove, { capture: true });

  // Hover a part, read what a click there does. Mouse-only by capability, not by
  // device: a finger has no hover, and the action bar already carries every verb
  // for it. The tip is taught here because it is the only place the core verb is
  // explained where it applies.
  const hoverCapable = window.matchMedia?.('(hover: hover) and (pointer: fine)');
  let hoverTipAt = 0;
  let hoverNodeId: string | null = null;
  let hoverText: HoverText | null = null;
  let hoverTarget: {
    nodeId: string;
    nodes: Map<string, PlantNodeData>;
    isOwnPlant: boolean;
    nodeType: string;
    canGrow: boolean;
  } | null = null;
  const hoverPointer = { x: 0, y: 0 };

  // Everything the tip says about the part under the pointer. The growth count
  // arrives from the server a moment after the hover starts, so this is re-run in
  // place when it does rather than waiting for the pointer to move to another part.
  const describeHoverTarget = (): HoverText | null => {
    const target = hoverTarget;
    if (!target) return null;
    return plantHoverText({
      nodeType: target.nodeType,
      isOwnPlant: target.isOwnPlant,
      growMode: isGrowMode,
      canGrow: target.canGrow,
      info: plantNodeInfo(target.nodeId, target.nodes.values()),
      totalParts: target.nodes.size,
      growable: target.isOwnPlant ? (growableCounts.get(target.nodeId) ?? null) : null,
    });
  };
  refreshPlantHoverTip = () => {
    if (!hoverTarget) return;
    hoverText = describeHoverTarget();
    plantHoverTip?.show(hoverText, hoverPointer.x, hoverPointer.y);
  };
  const handlePlantHover = (e: PointerEvent): void => {
    hoverPointer.x = e.clientX;
    hoverPointer.y = e.clientY;
    if (!hoverCapable?.matches) return;
    if (performance.now() - hoverTipAt < 90) return;
    hoverTipAt = performance.now();
    if (growthAimDragging || growthSelectionStateMachineIsDrawing(growthSelectionMachine)) {
      plantHoverTip?.hide();
      hoverNodeId = null;
      hoveredNodeId = null;
      hoverTarget = null;
      return;
    }
    const rect = canvas.getBoundingClientRect();
    hoverPick.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    hoverRay.setFromCamera(hoverPick, camera);
    const surfaces = plantRenderer?.pickSurfaces() ?? [];
    const hit =
      surfaces.length > 0
        ? hoverRay.intersectObjects(
            surfaces.map((surface) => surface.object),
            false,
          )[0]
        : undefined;
    const surface = hit ? surfaces.find((entry) => entry.object === hit.object) : undefined;
    if (!surface) {
      hoverNodeId = null;
      hoveredNodeId = null;
      hoverTarget = null;
      plantHoverTip?.hide();
      return;
    }
    if (surface.nodeId !== hoverNodeId) {
      hoverNodeId = surface.nodeId;
      hoveredNodeId = surface.nodeId;
      const nodes = surface.isOwnPlant
        ? plantNodes
        : (otherPlayerPlants.get(surface.plantId ?? '') ?? plantNodes);
      const node = nodes.get(surface.nodeId);
      const rootVisible = rootSightMachine
        ? rootSightStateMachineIsEnabled(rootSightMachine)
        : isBelowSoil(camera.position, soilQuery());
      hoverTarget = {
        nodeId: surface.nodeId,
        nodes,
        isOwnPlant: surface.isOwnPlant,
        nodeType: node?.nodeType ?? '',
        canGrow: !(node?.type === 0 && !node?.isSeed && !rootVisible),
      };
      hoverText = describeHoverTarget();
      // One question per part, asked when the pointer arrives on it: the tip can
      // then say that nothing grows here instead of promising a click that finds
      // an empty panel.
      if (surface.isOwnPlant) requestGrowableCount(surface.nodeId);
    }
    plantHoverTip?.show(hoverText, e.clientX, e.clientY);
  };
  canvas.addEventListener('pointermove', handlePlantHover);
  canvas.addEventListener('pointerleave', () => {
    hoverNodeId = null;
    hoveredNodeId = null;
    hoverTarget = null;
    plantHoverTip?.hide();
  });

  // Releasing the mouse only ends the turn gesture. Growth is committed by the
  // Grow button or Enter, so a slip of the hand never plants a segment.
  const handleGrowthDrawEnd = (e: MouseEvent | PointerEvent) => {
    if ((e as MouseEvent).button !== 0) return;
    if (!growthAimDragging) return;
    growthAimDragging = false;
    // The browser follows a drag with a click. Swallow that click so releasing
    // the arrow does not close the growth panel.
    suppressGrowthClickUntil = performance.now() + 350;
    try {
      (e.target as HTMLElement)?.releasePointerCapture?.((e as PointerEvent).pointerId);
    } catch {}
    e.stopPropagation();
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
      const panel = growthSelectionPanel;
      if (panel) panel.style.display = 'none';
      notify('Growth cancelled', 'info', 1600);
    }
  });

  // Escape cancels aiming; Enter/Space commits the aimed direction.
  window.addEventListener('keydown', (e) => {
    if (!growthSelectionStateMachineIsDrawing(growthSelectionMachine)) return;
    if (e.key === 'Escape') {
      growthAimDragging = false;
      growthSelectionStateMachineCancelDrawing(growthSelectionMachine);
      setGrowthGrowEnabled(false, 'Choose a growth option first');
      removeGrowthDirectionLine();
      controls.enabled = true;
      controls.enableRotate = true;
      controls.enablePan = true;
    } else if (e.key === 'Enter' || e.key === ' ') {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      e.preventDefault();
      commitGrowthAim();
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

  // Visibility change: pause render loop & input when hidden. The hidden state is
  // also handled at startup (the tail of this file), because a page can be
  // *loaded* hidden - a preview pane, an occluded window - and then no
  // `visibilitychange` ever fires to start the timer.
  if (renderConfig.pauseOnHidden) {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        startBackgroundLoop();
        setDetail('Tab hidden - background loop');
      } else {
        // Clear background timer, requestAnimationFrame will take over
        stopBackgroundLoop();
        // And take it over now, not on the next animation frame. A page that was
        // hidden long enough for the compositor to drop the canvas comes back to
        // a black rectangle, and a loop that only re-arms can leave it black for
        // as long as it takes the browser to schedule the first frame.
        wakeRenderLoop();
        renderFrame(0.016);
        setDetail('Tab visible - resuming');
        // The band controller must not grade the frame that spans the hidden
        // stretch: its delta is the whole time the tab was away, capped at a
        // quarter second, and one such sample drops the ratio to the floor.
        skipQualitySample = true;
        // Request full plant sync when tab becomes visible again
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: MESSAGE_TYPE.PLANT_SYNC_REQUEST, payload: {} }));
          // The full grid is ~65 000 tiles (megabytes of JSON, a 1 MB texture
          // upload and a long message-handler block). Re-requesting it on every
          // visibility flip flooded the socket and stalled frames; only refetch
          // when we have never received one, or it has genuinely gone stale.
          if (
            resourceGridReceivedAt === 0 ||
            performance.now() - resourceGridReceivedAt > RESOURCE_GRID_MAX_AGE_MS
          ) {
            ws.send(
              JSON.stringify({
                type: MESSAGE_TYPE.RESOURCE_QUERY,
                payload: { fullGrid: true },
              }),
            );
          }
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
  // Seed aspect, radius table and branch attach fraction: the same numbers the
  // server places nodes with, so drawing and aiming cannot drift from the model.
  await loadGrowthGeometryConfig(httpOrigin);

  // Try WebGPU renderer first (with automatic fallback to SDF)
  if (renderConfig?.webgpuEnabled && isWebGPUSupported() && !webgpuRetired) {
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
          // One owner for a drawn tube's radial detail, shared with the
          // Three.js path: this used to read `tubeRingCount`, which came from a
          // `tube_ring_count` key no config file declares, so the shipped pass
          // drew octagons while `mesh_tube_radial_segments` said 12.
          tubeSides: config.meshTubeRadialSegments,
          rootSides: config.rootSides,
          chainRingSpacingM: config.chainRingSpacingM,
          chainSagittaTolM: config.chainSagittaTolM,
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
          mutationBioluminescence:
            config.mutationBioluminescenceStrength ?? DEFAULT_CONFIG.mutation0Param,
          mutationBarkThicknessScale: config.mutationBarkThicknessScale ?? 1.35,
          mutationVariegation: config.mutationVariegationStrength ?? 0.35,
          planetRadius: renderConfig?.planetRadiusM ?? 0,
          ownRootColor: rootSightConfig?.ownRootHighlightColor ?? '#4CAF50',
          rivalRootColor: rootSightConfig?.rivalRootHighlightColor ?? '#FF5722',
          rainStreakLength: renderConfig.rainStreakLength,
          rainStreakWidth: renderConfig.rainStreakWidth,
          rainMaxVelocity: renderConfig.rainMaxVelocity,
          rainParticleCount: renderConfig.rainParticleCount,
          rainBoxWidth: renderConfig.rainBoxWidth,
          rainBoxHeight: renderConfig.rainBoxHeight,
          impostorEnabled: renderConfig.webgpuImpostorEnabled,
          impostorUpdateIntervalMs: renderConfig.webgpuImpostorUpdateIntervalMs,
          vramBudgetBytes: renderConfig.webgpuVramBudgetBytes,
          vramMaxVertexBytes: renderConfig.webgpuVramMaxVertexBytes,
          vramMaxIndexBytes: renderConfig.webgpuVramMaxIndexBytes,
          textureArraySize: renderConfig.webgpuTextureArraySize,
          textureArrayLayers: renderConfig.webgpuTextureArrayLayers,
        });

        const rendererReady = await gpuRenderer.initialize();
        if (rendererReady) {
          gpuRenderer.setCamera(camera);
          const gpuViewport = viewportSize();
          gpuRenderer.resize(gpuViewport.width, gpuViewport.height, renderer.getPixelRatio());
          gpuRenderer.setSunDirection(environmentRenderer?.getSunDirection() ?? sunLight.position);
          device.setDeviceLostCallback((reason) => {
            console.error('WebGPU device lost:', reason);
            recordSessionEvent('device.lost', { reason: String(reason) });
            device.setDeviceLostCallback(() => {});
            // A lost device is a renderer failure, not a world failure. This used
            // to reload the page, which threw away the plant, the camera and the
            // socket: a full reboot in the middle of play, for a driver hiccup or
            // a texture upload the device could not take. Retire WebGPU for this
            // session and let the WebGL plant renderer take over.
            webgpuRetired = true;
            disposeWebGPU();
            notify('Graphics device reset; switched to the fallback renderer', 'info', 5000);
            void initPlantRenderer();
          });
          webgpuDevice = device;
          webgpuRenderer = gpuRenderer;
          webgpuCanvas = canvasEl;
          useWebGPU = true;
          recordSessionEvent('renderer', { backend: 'webgpu' });
          console.log('Using WebGPU plant renderer with compute-driven LOD');
        } else {
          gpuRenderer.destroy();
          device.destroy();
          canvasEl.remove();
          recordSessionEvent('renderer', { backend: 'webgl' });
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
      tubeRingCount: config.meshTubeRadialSegments ?? DEFAULT_CONFIG.tubeRingCount,
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
      // Mesh tessellation for the L0/L1 pass (plant_renderer.json)
      meshTubeRadialSegments:
        config.meshTubeRadialSegments ?? DEFAULT_CONFIG.meshTubeRadialSegments,
      meshTubeLengthSegments:
        config.meshTubeLengthSegments ?? DEFAULT_CONFIG.meshTubeLengthSegments,
      meshLeafSegments: config.meshLeafSegments ?? DEFAULT_CONFIG.meshLeafSegments,
      meshJointWidthSegments:
        config.meshJointWidthSegments ?? DEFAULT_CONFIG.meshJointWidthSegments,
      meshJointHeightSegments:
        config.meshJointHeightSegments ?? DEFAULT_CONFIG.meshJointHeightSegments,
      meshMaxLeavesPerNode: config.meshMaxLeavesPerNode ?? DEFAULT_CONFIG.meshMaxLeavesPerNode,
      meshJointScale: config.meshJointScale ?? DEFAULT_CONFIG.meshJointScale,
      meshMaxLeafSize: config.meshMaxLeafSize ?? DEFAULT_CONFIG.meshMaxLeafSize,
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
    // The mesh pass seats a seed coat on the soil it is drawn over, so it needs
    // the same terrain the ground mesh uses.
    plantRenderer.setGroundQuery((x, z) =>
      planetTerrainY(renderConfig?.planetRadiusM ?? 0, x, z, getTerrainParams()),
    );
    // The drawn soil, not just the field: the seed rests on the triangle on
    // screen, which stands above the field wherever the mesh is coarse.
    const drawnTerrain = scene.getObjectByName('planet-terrain-detail') ?? null;
    plantRenderer.setGroundMesh(drawnTerrain);
    // Drops are seated on the same drawn surface, not on the field under it.
    drawnGround.setMesh(drawnTerrain);
    plantRenderer.setViewportSize(renderer.domElement.width, renderer.domElement.height);

    // Initialize with existing plant nodes (root node from WELCOME, or empty)
    if (plantRenderer) {
      const otherNodes: PlantNodeData[] = [];
      for (const [otherId, nodes] of otherPlayerPlants) {
        for (const node of nodes.values()) {
          node.plantId = otherId;
          otherNodes.push(node);
        }
      }
      for (const node of plantNodes.values()) node.plantId = plantId ?? undefined;
      const allNodes = [...plantNodes.values(), ...otherNodes];
      plantRenderer.updatePlantData(allNodes);
    }
    if (webgpuRenderer) {
      const otherNodes: PlantNodeData[] = [];
      for (const [otherId, nodes] of otherPlayerPlants) {
        for (const node of nodes.values()) {
          node.plantId = otherId;
          otherNodes.push(node);
        }
      }
      for (const node of plantNodes.values()) node.plantId = plantId ?? undefined;
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
// Linear tone mapping exists so `toneMappingExposure` does something: with the
// default NoToneMapping three ignores exposure entirely, which made the hour
// grade a config knob with no effect. At exposure 1 the output is unchanged.
renderer.toneMapping = THREE.LinearToneMapping;
renderer.toneMappingExposure = 1;
renderer.setSize(app.clientWidth || window.innerWidth, app.clientHeight || window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// The sun and the plant move too slowly to need a fresh shadow pass every
// frame; renderFrame refreshes it on a timer instead.
renderer.shadowMap.autoUpdate = false;
app.appendChild(renderer.domElement);
// A GPU context lost while the window was minimised or the driver reset leaves
// the canvas black with no error and no frames, and nothing in the loop notices:
// three keeps calling render() on a dead context. Ask for the context back and
// draw immediately once it returns, so the page recovers on its own instead of
// waiting for a reload the player has no reason to know they need.
renderer.domElement.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  setDetail('Graphics context lost - restoring');
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  lastFrameAtMs = 0;
  wakeRenderLoop();
  renderFrame(0.016);
  setDetail('Graphics context restored');
});

// Cinematic overlay — vignette + film grain for atmospheric depth
const cinematicOverlay = document.createElement('div');
cinematicOverlay.id = 'cinematic-overlay';
app.appendChild(cinematicOverlay);

// UI overlay elements
// Connection dot: a single green/red light that lives in the chat toolbar.
// Green = socket open and ping round-trips are healthy; red = closed or stalled.
statusElement = document.createElement('div');
statusElement.id = 'status';
statusElement.style.cssText = `
    flex: 0 0 auto;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--ink-muted);
    box-shadow: 0 0 0 1px rgba(10, 12, 8, 0.7);
    display: none;
  `;
document.body.appendChild(statusElement);

function setStatus(text: string, state: 'pending' | 'ok' | 'down'): void {
  if (!statusElement) return;
  statusElement.style.display = 'block';
  statusElement.style.background =
    state === 'ok' ? 'var(--leaf-500)' : state === 'down' ? 'var(--ember-500)' : 'var(--ink-muted)';
  statusElement.style.boxShadow =
    state === 'ok'
      ? '0 0 6px rgba(125, 184, 61, 0.75), 0 0 0 1px rgba(10, 12, 8, 0.6)'
      : state === 'down'
        ? '0 0 6px rgba(238, 112, 64, 0.8), 0 0 0 1px rgba(10, 12, 8, 0.6)'
        : '0 0 0 1px rgba(10, 12, 8, 0.6)';
  statusElement.title = text;
  statusElement.setAttribute('aria-label', text);
}

detailElement = document.createElement('div');
detailElement.id = 'detail';
detailElement.className = 'hud-panel';
detailElement.style.cssText = `
    position: fixed;
    /* Bottom-left corner, clear of the plant and its roots at screen centre. */
    bottom: var(--hud-detail-bottom);
    left: var(--hud-corner);
    z-index: 150;
    /* A fixed box, not max-content: an auto-width panel changed size with the
       digits in the tick readout, which made the whole readout jitter. */
    width: min(360px, 60vw);
    pointer-events: none;
    display: none;
  `;
// A debug readout on every player's screen is a dev build, not a game: the tick
// card is off until an operator asks for it in the dev panel, and the server only
// offers those tools to a dev-allowed environment and account.
let detailVisible = false;

const detailBody = document.createElement('div');
detailBody.style.cssText = `
    padding: var(--hud-pad-y) var(--hud-pad-x);
    font-size: var(--hud-font-sm);
    color: var(--warm-ink);
    line-height: 1.3;
    border-left: 2px solid var(--leaf-500);
    /* Tabular digits keep each character cell the same width, so a changing
       number cannot shift the rest of the line around. */
    font-variant-numeric: tabular-nums;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  `;
// Two blocks, not one text node: the live tick readout used to share this panel
// with hints and outcomes, so every update erased whatever it had just said.
// The stats keep their lines and the message keeps its own.
const detailStats = document.createElement('div');
detailStats.id = 'detail-stats';
detailStats.style.cssText = 'font-variant-numeric: tabular-nums; white-space: pre; display: none;';

const detailMessage = document.createElement('div');
detailMessage.id = 'detail-message';
detailMessage.style.cssText = 'white-space: pre-wrap; overflow-wrap: anywhere;';

detailBody.appendChild(detailStats);
detailBody.appendChild(detailMessage);
detailElement.appendChild(detailBody);
document.body.appendChild(detailElement);

function setDetail(text: string): void {
  if (!detailElement) return;
  detailElement.style.display = detailSuppressed || !detailVisible ? 'none' : 'block';
  detailMessage.textContent = text;
  detailMessage.style.marginTop = detailStats.textContent ? '4px' : '0';
}

/** The live numbers, on their own fixed lines so they never reflow the message. */
function updateTickDetail(text: string): void {
  if (!detailElement) return;
  detailStats.textContent = text;
  detailStats.style.display = text ? 'block' : 'none';
  detailMessage.style.marginTop = text && detailMessage.textContent ? '4px' : '0';
  detailElement.style.display = detailSuppressed || !detailVisible ? 'none' : 'block';
  positionMutationPanel();
}

/**
 * Sits the mutation panel directly above the server-tick card, whose height
 * changes with the readout, instead of guessing a fixed offset.
 */
function positionMutationPanel(): void {
  const panel = mutationPanel?.panel;
  if (!panel) return;
  const tickHeight = detailElement?.getBoundingClientRect().height ?? 0;
  const bottom = tickHeight > 0 ? tickHeight + 20 : 12;
  panel.style.bottom = `${Math.round(bottom)}px`;
}

// The growth panel owns the bottom of the screen while it is open. The
// server-tick readout (bottom-left) and the hint card (bottom centre) sit in the
// same band, so both step aside while it is open and return when it closes,
// rather than overlapping it or each other.
let detailSuppressed = false;
function setGrowthPanelOpen(open: boolean): void {
  detailSuppressed = open;
  if (open) actionBar?.setVisible(false);
  else if (entryFlow.step === 'world') actionBar?.setVisible(true);
  hotbar?.setVisible(open ? false : entryFlow.step === 'world');
  sporeChip?.setVisible(!open && entryFlow.step === 'world');
  if (detailElement) {
    detailElement.style.display =
      open || !detailVisible ? 'none' : detailBody.textContent ? 'block' : 'none';
  }
  // `#hint-card` is retired (contextual hints replaced it) and stays hidden for
  // good: un-hiding it here left an empty 12px box on screen after panels closed.
}

hintCardElement = document.createElement('div');
hintCardElement.id = 'hint-card';
hintCardElement.className = 'hud-panel';
hintCardElement.style.cssText = `
      position: fixed;
      bottom: 20vh;
      left: 50%;
      transform: translateX(-50%);
      max-width: min(360px, 86vw);
      pointer-events: none;
      z-index: 120;
      opacity: 0;
      transition: opacity 0.4s ease, transform 0.4s ease;
      transform: translateX(-50%) translateY(8px);
      padding: var(--hud-pad-y) var(--hud-pad-x);
    `;

/* eslint-disable-next-line @typescript-eslint/no-unused-vars -- retired element */
const hintBody = document.createElement('div');
hintBody.style.cssText = `
    font-size: var(--hud-font-sm);
    color: var(--warm-ink);
    text-align: center;
    line-height: 1.4;
  `;
hintCardElement.appendChild(hintBody);
// Retired: contextual hints replaced this card. Kept in the DOM (hidden) because
// the growth panel toggles its display while it is open.
hintCardElement.style.display = 'none';
document.body.appendChild(hintCardElement);

// The vitals card: one home for the resources, the clock and the weather.
//
// This replaced three overlapping readouts (a debug card, the middle of the
// status card, and this one) that each printed the same four numbers at full
// precision. Bars where a capacity exists, plain numbers where it does not, no
// "+0.0/s" when nothing is moving, and a weather line that is worth reading.
let resourceReadoutElement: HTMLDivElement | null = null;
let vitalsRowsEl: HTMLDivElement | null = null;
let vitalsClockMainEl: HTMLSpanElement | null = null;
let vitalsClockSubEl: HTMLSpanElement | null = null;
let vitalsWeatherEl: HTMLDivElement | null = null;
let vitalsWeatherTextEl: HTMLSpanElement | null = null;
let vitalsWeatherEtaEl: HTMLSpanElement | null = null;
let vitalsTickerStarted = false;
const vitalsRowEls = new Map<
  string,
  { row: HTMLDivElement; fill: HTMLDivElement; value: HTMLSpanElement }
>();
let vitalsWeather: {
  state: string;
  label: string;
  nextLabel: string;
  nextState: string;
  secondsUntilNext: number;
  atMs: number;
} | null = null;

const VITALS_CSS = `
  #resource-readout {
    position: fixed;
    /* Top right: the top left corner holds Settings, the bottom holds the action
       bar and, for operators only, the tick card. */
    top: var(--hud-readout-top);
    right: var(--hud-corner);
    z-index: 200;
    display: none;
    flex-direction: column;
    gap: 6px;
    padding: 9px 11px 10px;
    width: clamp(176px, 15vw, 232px);
    max-width: calc(100vw - 2 * var(--hud-corner));
    box-sizing: border-box;
    /* Nothing may paint outside the card: a season name and a weather name are
       both server text, and one long one used to run out over the panel edge. */
    overflow: hidden;
  }
  .pl-vitals__clock {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 2px 8px;
    min-width: 0;
    font-size: var(--hud-font-sm);
    color: var(--bone-100);
    letter-spacing: 0.02em;
    font-variant-numeric: tabular-nums;
  }
  .pl-vitals__clock-main { font-weight: 600; white-space: nowrap; }
  .pl-vitals__clock-sub {
    color: var(--ink-dim);
    font-size: var(--hud-font-xs);
    min-width: 0;
    overflow-wrap: anywhere;
    text-align: right;
  }
  .pl-vitals__weather {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 2px 6px;
    min-width: 0;
    padding: 3px 0 5px;
    border-bottom: 1px solid var(--hud-border-muted);
    font-size: var(--hud-font-sm);
    line-height: 1.35;
    color: var(--ink-muted);
  }
  /* A weather name is server text and can be as long as it likes. It wraps inside
     the card, and the countdown keeps its own line rather than squeezing the name
     out of the panel: the two used to share one nowrap line, so a long condition
     ran straight out of the card. */
  .pl-vitals__weather-label { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
  .pl-vitals__weather-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--leaf-500);
    flex: none;
    align-self: center;
  }
  .pl-vitals__weather[data-tone='notice'] { color: var(--gold-400); }
  .pl-vitals__weather[data-tone='notice'] .pl-vitals__weather-dot { background: var(--gold-400); }
  .pl-vitals__weather[data-tone='warning'] { color: var(--ember-400); }
  .pl-vitals__weather[data-tone='warning'] .pl-vitals__weather-dot {
    background: var(--ember-500);
    box-shadow: 0 0 8px var(--ember-500);
  }
  .pl-vitals__weather.is-urgent .pl-vitals__weather-dot { animation: pl-vitals-pulse 1.4s ease-in-out infinite; }
  @keyframes pl-vitals-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
  .pl-vitals__weather-eta {
    margin-left: auto;
    color: inherit;
    opacity: 0.85;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .pl-vitals__rows { display: flex; flex-direction: column; gap: 5px; }
  .pl-vitals__row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, auto);
    align-items: center;
    gap: 2px 8px;
    min-width: 0;
    font-size: var(--hud-font-sm);
    color: var(--ink-muted);
  }
  .pl-vitals__label {
    color: var(--ink-muted);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* The value is the number the player came for: it never wraps, and it is the
     label that gives up room first. */
  .pl-vitals__value {
    color: var(--bone-100);
    font-variant-numeric: tabular-nums;
    text-align: right;
    white-space: nowrap;
  }
  .pl-vitals__track {
    grid-column: 1 / -1;
    height: 4px;
    border-radius: 2px;
    background: rgba(239, 233, 216, 0.13);
    overflow: hidden;
  }
  .pl-vitals__track[hidden] { display: none; }
  .pl-vitals__fill {
    height: 100%;
    width: 100%;
    transform-origin: left center;
    border-radius: 2px;
    background: linear-gradient(90deg, var(--leaf-700), var(--leaf-300));
    transition: transform 220ms ease-out;
  }
  .pl-vitals__row[data-tone='low'] .pl-vitals__fill { background: linear-gradient(90deg, var(--ember-700), var(--gold-400)); }
  .pl-vitals__row[data-tone='low'] .pl-vitals__value { color: var(--gold-400); }
  .pl-vitals__row[data-tone='critical'] .pl-vitals__fill {
    background: linear-gradient(90deg, var(--ember-800), var(--ember-400));
    animation: pl-vitals-pulse 1.2s ease-in-out infinite;
  }
  .pl-vitals__row[data-tone='critical'] .pl-vitals__value { color: var(--ember-400); }
  /* On a phone the status card owns the top row, so the vitals sit under it and
     use the full width instead of squeezing into the corner next to it.
     A finger layout only. A narrow *desktop* pane keeps the corner card and is
     scaled by --pl-ui-scale instead - full-width chrome in a small pane is what
     left the world visible only in the gaps. */
  @media (max-width: 640px) and (hover: none) and (pointer: coarse) {
    #resource-readout {
      top: calc(var(--hud-corner) + env(safe-area-inset-top, 0px) + 104px);
      left: var(--hud-corner);
      right: var(--hud-corner);
      width: auto;
    }
    .pl-vitals__rows { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px 12px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .pl-vitals__row[data-tone='critical'] .pl-vitals__fill,
    .pl-vitals__weather.is-urgent .pl-vitals__weather-dot { animation: none; }
  }
`;

/**
 * HUD type floors. The stylesheet's clamp bottoms out around 9px, which is
 * unreadable on a laptop and worse on a phone; the floor is a config value so it
 * can be raised without touching CSS.
 */
function applyHudFontSizes(): void {
  const small = resolvedUiConfig?.hudFontSmallPx ?? 12;
  const secondary = resolvedUiConfig?.hudFontSecondaryPx ?? 11;
  const root = document.documentElement.style;
  // The clamp is multiplied by --text-scale, not written in rem: the root font
  // size is already scaled, so a rem floor would be scaled twice, and a bare px
  // floor would ignore the settings slider entirely.
  root.setProperty(
    '--hud-font-sm',
    `calc(clamp(${small}px, ${small - 4}px + 0.32vw, ${small + 3}px) * var(--text-scale))`,
  );
  root.setProperty(
    '--hud-font-xs',
    `calc(clamp(${secondary}px, ${secondary - 3}px + 0.2vw, ${secondary + 2}px) * var(--text-scale))`,
  );
}

function vitalsThresholds(): VitalThresholds {
  return {
    lowFraction: resolvedUiConfig?.vitalsLowFraction ?? DEFAULT_VITAL_THRESHOLDS.lowFraction,
    criticalFraction:
      resolvedUiConfig?.vitalsCriticalFraction ?? DEFAULT_VITAL_THRESHOLDS.criticalFraction,
  };
}

function createResourceReadout(): void {
  const layer = uiShell?.getLayer('hud');
  if (!layer) return;

  if (!document.getElementById('pl-vitals-style')) {
    const style = document.createElement('style');
    style.id = 'pl-vitals-style';
    style.textContent = VITALS_CSS;
    document.head.appendChild(style);
  }

  resourceReadoutElement = document.createElement('div');
  resourceReadoutElement.id = 'resource-readout';
  resourceReadoutElement.className = 'hud-panel';
  resourceReadoutElement.setAttribute('role', 'group');
  resourceReadoutElement.setAttribute('aria-label', 'Plant vitals');
  // Position lives in VITALS_CSS, not here: an inline `top` beats the phone
  // media query, which is how the card ended up overlapping the status card.
  resourceReadoutElement.style.pointerEvents = 'auto';

  // One clock, not two: the day and the hour used to live in the status card
  // while the season countdown lived here.
  const clock = document.createElement('div');
  clock.className = 'pl-vitals__clock';
  vitalsClockMainEl = document.createElement('span');
  vitalsClockMainEl.className = 'pl-vitals__clock-main';
  vitalsClockSubEl = document.createElement('span');
  vitalsClockSubEl.className = 'pl-vitals__clock-sub';
  clock.append(vitalsClockMainEl, vitalsClockSubEl);

  vitalsWeatherEl = document.createElement('div');
  vitalsWeatherEl.className = 'pl-vitals__weather';
  vitalsWeatherEl.dataset.tone = 'calm';
  const weatherDot = document.createElement('i');
  weatherDot.className = 'pl-vitals__weather-dot';
  weatherDot.setAttribute('aria-hidden', 'true');
  vitalsWeatherTextEl = document.createElement('span');
  vitalsWeatherTextEl.className = 'pl-vitals__weather-label';
  vitalsWeatherEtaEl = document.createElement('span');
  vitalsWeatherEtaEl.className = 'pl-vitals__weather-eta';
  vitalsWeatherEl.append(weatherDot, vitalsWeatherTextEl, vitalsWeatherEtaEl);

  vitalsRowsEl = document.createElement('div');
  vitalsRowsEl.className = 'pl-vitals__rows';

  const rows: Array<{ id: string; label: string; title: string }> = [
    { id: 'biomass', label: 'Biomass', title: onboardingConfig.resource_tooltips.biomass },
    {
      id: 'energy',
      label: 'Energy',
      title: 'Energy: spendable currency for growth. Produced by photosynthesis (leaves).',
    },
    { id: 'light', label: 'Light', title: onboardingConfig.resource_tooltips.light },
    { id: 'water', label: 'Water', title: onboardingConfig.resource_tooltips.water },
    { id: 'minerals', label: 'Minerals', title: onboardingConfig.resource_tooltips.minerals },
  ];
  for (const spec of rows) {
    const row = document.createElement('div');
    row.className = 'pl-vitals__row';
    row.dataset.vital = spec.id;
    row.title = spec.title;
    const label = document.createElement('span');
    label.className = 'pl-vitals__label';
    label.textContent = spec.label;
    const value = document.createElement('span');
    value.className = 'pl-vitals__value';
    value.textContent = '0';
    const track = document.createElement('div');
    track.className = 'pl-vitals__track';
    track.hidden = true;
    const fill = document.createElement('div');
    fill.className = 'pl-vitals__fill';
    track.appendChild(fill);
    row.append(label, value, track);
    vitalsRowsEl.appendChild(row);
    vitalsRowEls.set(spec.id, { row, fill, value });
  }

  resourceReadoutElement.append(clock, vitalsWeatherEl, vitalsRowsEl);
  // The layer is `pointer-events: none` and each child opts in; going through
  // the shell is what does the opting in. A direct append left a readout that
  // looked right and could not be hovered (D2's class of bug).
  uiShell?.attachTo('hud', resourceReadoutElement);
  updateVitalsClock();
}

/**
 * Paints one row from its rules. The bar only exists for a store with a
 * capacity; rows without one show the number alone rather than a fake full bar.
 */
function paintVital(id: string, input: Parameters<typeof vitalRow>[0], title?: string): void {
  const els = vitalsRowEls.get(id);
  if (!els) return;
  const row = vitalRow(input, vitalsThresholds());
  els.value.textContent = row.valueText;
  els.row.dataset.tone = row.tone;
  const track = els.row.querySelector<HTMLDivElement>('.pl-vitals__track');
  if (track) track.hidden = row.fraction === null;
  if (row.fraction !== null) els.fill.style.transform = `scaleX(${row.fraction.toFixed(4)})`;
  els.row.title = title ?? row.title;
}

function updateResourceReadout(
  light: number,
  water: number,
  minerals: number,
  biomass: number,
  energy?: number,
  storedWater?: number,
  storedMinerals?: number,
  waterCapacity?: number,
  mineralCapacity?: number,
): void {
  if (!resourceReadoutElement) createResourceReadout();
  if (!resourceReadoutElement) return;
  resourceReadoutElement.style.display = 'flex';

  paintVital('biomass', {
    id: 'biomass',
    label: 'Biomass',
    value: biomass,
    precision: 1,
  });
  if (energy !== undefined) {
    paintVital('energy', { id: 'energy', label: 'Energy', value: energy, precision: 1 });
  }
  // Light is a reading of the sky reaching the leaves, not a store: no bar.
  paintVital('light', { id: 'light', label: 'Light', value: light, precision: 1 });
  // Growth is paid from what the plant itself captured, so the store is shown
  // against its capacity; the ambient tile average stays in the tooltip.
  paintVital(
    'water',
    {
      id: 'water',
      label: 'Water',
      value: storedWater ?? water,
      capacity: storedWater === undefined ? null : (waterCapacity ?? null),
    },
    storedWater === undefined
      ? undefined
      : `Water stored: ${storedWater.toFixed(1)}${waterCapacity !== undefined ? `/${Math.round(waterCapacity)}` : ''}. Soil around the roots: ${water.toFixed(1)}.`,
  );
  paintVital(
    'minerals',
    {
      id: 'minerals',
      label: 'Minerals',
      value: storedMinerals ?? minerals,
      capacity: storedMinerals === undefined ? null : (mineralCapacity ?? null),
    },
    storedMinerals === undefined
      ? undefined
      : `Minerals stored: ${storedMinerals.toFixed(1)}${mineralCapacity !== undefined ? `/${Math.round(mineralCapacity)}` : ''}. Soil around the roots: ${minerals.toFixed(1)}.`,
  );
}

/** The hour leads the chip; season, day and the countdown ride the sub-line. */
function updateVitalsClock(): void {
  if (!vitalsClockMainEl || !vitalsClockSubEl) return;
  const remainingS = seasonNumber > 0 ? (seasonEndsAtMs - performance.now()) / 1000 : null;
  const chip = clockChip(
    {
      season: seasonNumber,
      day: weatherDayNumber,
      time: weatherClock || '--:--',
      // Only when the server has a clock: a chip that has never heard from it
      // would otherwise claim it is night at midnight on a world it cannot see.
      timeOfDay: weatherClock ? weatherTimeOfDay : undefined,
      seasonRemainingS: remainingS,
    },
    formatSeasonRemaining,
  );
  vitalsClockMainEl.textContent = chip.main;
  vitalsClockSubEl.textContent = chip.sub;
  vitalsClockSubEl.style.display = chip.sub ? '' : 'none';
  if (resourceReadoutElement) resourceReadoutElement.title = chip.title;
}

/** The weather is the one live change on screen, so it gets its own line. */
function updateVitalsWeather(): void {
  if (!vitalsWeatherTextEl || !vitalsWeatherEtaEl || !vitalsWeatherEl || !vitalsWeather) return;
  const elapsed = (performance.now() - vitalsWeather.atMs) / 1000;
  const chip = weatherChip({
    state: vitalsWeather.state,
    label: vitalsWeather.label,
    nextLabel: vitalsWeather.nextLabel,
    nextState: vitalsWeather.nextState,
    secondsUntilNext: vitalsWeather.secondsUntilNext - elapsed,
  });
  vitalsWeatherEl.dataset.tone = chip.tone;
  vitalsWeatherEl.classList.toggle('is-urgent', chip.urgent);
  vitalsWeatherTextEl.textContent = chip.label;
  vitalsWeatherEtaEl.textContent = chip.eta;
  vitalsWeatherEl.title = chip.eta ? `${chip.label}. ${chip.eta}.` : chip.label;
}

/**
 * Clock and weather move on their own; the resources only change when a packet
 * arrives. One ticker drives both, once a second, instead of each chip owning a
 * timer that kept running behind a closed panel.
 */
function startVitalsTicker(): void {
  if (vitalsTickerStarted) return;
  vitalsTickerStarted = true;
  // Wake on the countdown's own second, not on the interval's phase.
  //
  // A fixed one-second interval starts at an arbitrary moment, so the chip could
  // hold "0:17" for nearly two seconds and then jump to "0:15": the timer was not
  // wrong, it was sampling a clock that had moved a fraction of a second past each
  // whole second before the frame that would have shown it. Waking just after the
  // next boundary, and re-solving after every wake, keeps the displayed second
  // within a frame or two of the real one.
  const step = (): void => {
    if (resourceReadoutElement && resourceReadoutElement.style.display !== 'none') {
      updateVitalsClock();
      updateVitalsWeather();
    }
    let waitMs = 1000;
    if (vitalsWeather) {
      const elapsedMs = performance.now() - vitalsWeather.atMs;
      const leftMs = Math.max(0, vitalsWeather.secondsUntilNext * 1000 - elapsedMs);
      // Aim just past the next whole second; clamp so a 0-second countdown cannot
      // spin the timer and a stale packet cannot park it for a minute.
      waitMs = Math.min(1000, Math.max(60, 1000 - (leftMs % 1000) + 12));
    }
    window.setTimeout(step, waitMs);
  };
  step();
}

// The readout shows the whole plant id: it is the id players need to quote when
// reporting a plant, and a tail cannot be matched against server logs.
function plantIdLabel(): string {
  return plantId ?? 'none';
}

function updateSeasonChip(): void {
  updateVitalsClock();
  startVitalsTicker();
}

// Basic identity of a plant that is not yours, keyed by world plant id. Filled
// from PLANT_CREATED, which is the message that carries the owner.
const plantOwners = new Map<string, string>();
/**
 * The owner's display name, when the world sent one. The inspect panel used to
 * show `ownerId.slice(0, 12)` - a machine identifier in player-facing text - so
 * a plant signed "owner 9f3a1c07b8e2" named nobody. A name is the only thing a
 * reader can use; a plant whose owner is not connected says "Unnamed plant".
 */
const plantOwnerNames = new Map<string, string>();

/**
 * Inspect a rival plant through the Inspect panel, in low detail.
 *
 * The mirror streams a rival's parts and their biomass and nothing else, so that
 * is the whole readout: parts by type, the body's total, and the owner if the
 * world named one. The stored water, minerals, mutation list and level-up rows
 * belong to the player's own plant and are hidden here rather than invented.
 *
 * This replaced a small floating card on the click: the card answered "what did
 * I just click" but the panel is the same readout the player already knows, and
 * closing it never takes the inventory with it.
 */
function inspectOtherPlant(plantId_: string, nodes: Map<string, PlantNodeData>): void {
  if (!playerPanels) return;
  const parts = new Map<string, { count: number; biomass: number }>();
  let totalBiomass = 0;
  for (const part of nodes.values()) {
    const type = part.nodeType ?? 'part';
    const entry = parts.get(type) ?? { count: 0, biomass: 0 };
    entry.count += 1;
    entry.biomass += part.biomass ?? 0;
    parts.set(type, entry);
    totalBiomass += part.biomass ?? 0;
  }
  playerPanels.inspectOther({
    owner: plantOwners.get(plantId_),
    ownerName: plantOwnerNames.get(plantId_),
    plantId: plantId_,
    parts: [...parts].map(([type, entry]) => ({
      type,
      count: entry.count,
      biomass: entry.biomass,
    })),
    totalBiomass,
    partCount: nodes.size,
  });
  playerPanels.setPanelOpen('inspect', true);
  hideOverlappingHud();
  refreshPlayerPanels();
}

// Two-step growth selection UI (ADR-018)
let growthSelectionPanel: HTMLDivElement | null = null;

function createGrowthSelectionUI(): void {
  const layer = uiShell?.getLayer('hud');
  if (!layer) return;

  const panel = document.createElement('div');
  panel.id = 'growth-selection-panel';
  // No panel chrome: the options are individual floating cards, so the plant
  // and the aim gizmo stay visible behind the gaps between them.
  panel.style.cssText = `
    position: fixed;
    bottom: clamp(56px, 10vh, 96px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 300;
    width: min(660px, 96vw);
    pointer-events: none;
    display: none;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  `;

  panel.addEventListener('click', (e) => e.stopPropagation());

  panel.innerHTML = `
    <div id="growth-options"></div>
  `;

  layer.appendChild(panel);
  growthSelectionPanel = panel;
}

/**
 * Ask how many growth options a node has, without opening the growth panel.
 *
 * The hover tip reads the answer back out of `growableCounts`, so it can say that
 * nothing grows from a part before the player clicks it. Re-asking for the same
 * node is throttled: a node's options only change when resources do, and the
 * panel's own request refreshes the same cache.
 */
function requestGrowableCount(nodeId: string): void {
  if (!ws || ws.readyState !== WebSocket.OPEN || !plantId) return;
  const now = performance.now();
  const last = growableAskedAt.get(nodeId) ?? 0;
  if (now - last < GROWABLE_ASK_INTERVAL_MS) return;
  growableAskedAt.set(nodeId, now);
  ws.send(
    JSON.stringify({
      type: MESSAGE_TYPE.GROWTH_OPTIONS_REQUEST,
      payload: { plantId, nodeId },
    }),
  );
}

function requestGrowthOptions(nodeId: string): void {
  if (!ws || ws.readyState !== WebSocket.OPEN || !plantId) return;

  growthSelectionStateMachineRequestOptions(growthSelectionMachine, nodeId);
  showGrowthPanelMessage(nodeId, '…');

  // Set timeout to prevent "loading forever" if server doesn't respond
  clearGrowthOptionsTimeout();
  growthOptionsTimeoutId = window.setTimeout(
    showGrowthOptionsTimeoutError,
    GROWTH_OPTIONS_TIMEOUT_MS,
  );

  ws.send(
    JSON.stringify({
      type: MESSAGE_TYPE.GROWTH_OPTIONS_REQUEST,
      payload: { plantId, nodeId },
    }),
  );
}

function prepareGrowthPanel(_nodeId: string): {
  optionsEl: HTMLElement;
} | null {
  const panel = growthSelectionPanel;
  const optionsEl = document.getElementById('growth-options');
  if (!panel || !optionsEl) return null;

  panel.style.display = 'flex';
  setGrowthPanelOpen(true);
  return { optionsEl };
}

function showGrowthPanelMessage(nodeId: string, message: string): void {
  const parts = prepareGrowthPanel(nodeId);
  if (!parts) return;
  parts.optionsEl.innerHTML = '';
  const note = document.createElement('div');
  note.className = 'hud-grow-note';
  note.textContent = message;
  parts.optionsEl.appendChild(note);
  setGrowthGrowEnabled(false, 'Choose a growth option first');
}

const GROWTH_PART_INFO: Record<string, string> = {
  radicle: 'The first root. Anchors the seedling and starts drawing water from the soil.',
  root: 'A thick taproot. Holds the plant steady and stores water and minerals.',
  lateral_root: 'A fine side root. Spreads through new soil for water and nutrients.',
  stem: 'The main stem. Lifts new leaves toward the light.',
  branch: 'A side branch. Opens more space for leaves and flowers.',
  cotyledon: 'A seed leaf. Feeds the seedling until true leaves can take over.',
  leaf: 'A true leaf. Turns light, water and minerals into energy.',
  vine: 'A climbing vine. Reaches new light without building a thick trunk.',
  flower: 'A flower. The next step toward seed and a new generation.',
  spore_sac: "A spore sac. Releases the plant's spores when it matures.",
};

function describeGrowthReason(reason?: string): string {
  switch (reason) {
    case 'insufficient_stored_resources':
    case 'insufficient_water':
      return 'Needs more stored water.';
    case 'insufficient_minerals':
      return 'Needs more stored minerals.';
    case 'insufficient_energy':
    case 'insufficient_energy_for_node':
      return 'Needs more energy.';
    case 'insufficient_biomass':
    case 'insufficient_biomass_for_node':
      return 'Needs more biomass.';
    case 'growth_on_cooldown':
      return 'Wait a moment before growing again.';
    case 'max_nodes_reached':
      return 'The plant has reached its part limit.';
    case 'max_cotyledons_reached':
      return 'The seedling already has both seed leaves.';
    case 'out_of_bounds':
      return 'There is no soil or space left in that direction.';
    default:
      return reason ? reason.replace(/_/g, ' ') : 'This part cannot grow yet.';
  }
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

  parts.optionsEl.innerHTML = '';
  setGrowthGrowEnabled(false, 'Choose a growth option first');
  if (result.options.length === 0) {
    setGrowthGrowEnabled(false, 'This node has no growth options');
    const empty = document.createElement('div');
    empty.className = 'hud-grow-empty';
    empty.innerHTML = `
      <div style="font-size: 2rem; line-height: 1; margin-bottom: 8px; opacity: 0.5;">Seed</div>
      <div class="hud-label">No growth available</div>
      <div class="hud-note">This node cannot grow right now.</div>
    `;
    parts.optionsEl.appendChild(empty);
    return;
  }

  // Group options by plant part type for scannable browsing
  const typeOrder: Record<string, number> = {
    radicle: 0,
    root: 1,
    lateral_root: 2,
    stem: 3,
    branch: 4,
    cotyledon: 5,
    leaf: 6,
    vine: 7,
    flower: 8,
    spore_sac: 9,
    seed: 10,
  };
  const sorted = [...result.options].sort(
    (a, b) => (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99),
  );

  // No group headings: each card carries its own type chip, and wrapping at
  // three per row keeps the layout readable without a background panel.
  for (const opt of sorted) {
    const card = document.createElement('div');
    card.className = 'hud-grow-option';
    if (!opt.available) card.classList.add('is-unavailable');
    if (!opt.available) card.title = describeGrowthReason(opt.reason);

    const waterCost = opt.waterCost ?? 0;
    const nutrientCost = opt.nutrientCost ?? 0;
    const mineralCost = opt.mineralCost ?? 0;

    // Type-specific description + upkeep
    const typeChipClass = (() => {
      const tl = opt.type.toLowerCase();
      if (tl === 'radicle' || tl === 'root' || tl === 'lateral_root')
        return 'hud-grow-option__chip-root';
      if (tl === 'stem' || tl === 'branch') return 'hud-grow-option__chip-stem';
      if (tl === 'cotyledon' || tl === 'leaf' || tl === 'vine') return 'hud-grow-option__chip-leaf';
      return '';
    })();

    const requirements = [
      `${opt.energyCost.toFixed(1)} energy`,
      waterCost > 0 ? `${waterCost.toFixed(1)} water` : '',
      nutrientCost > 0 ? `${nutrientCost.toFixed(1)} nutrients` : '',
      mineralCost > 0 ? `${mineralCost.toFixed(1)} minerals` : '',
    ].filter(Boolean);
    const reasonText = !opt.available ? describeGrowthReason(opt.reason) : '';
    card.innerHTML = `
      <div class="hud-grow-option__head">
        <span class="hud-grow-option__chip ${typeChipClass}">${escapeHtml(opt.label)}</span>
      </div>
      <div class="hud-grow-option__cost">
        ${opt.energyCost.toFixed(1)} energy &nbsp;·&nbsp; +${opt.biomassGain.toFixed(1)} biomass &nbsp;·&nbsp; ${opt.expectedSeconds.toFixed(0)} seconds
      </div>
      <div class="hud-grow-option__details">
        <div class="hud-grow-option__requires-label">Requires</div>
        <ul class="hud-grow-option__requires">
          ${requirements.map((requirement) => `<li>${requirement}</li>`).join('')}
        </ul>
        <div class="hud-grow-option__info">${GROWTH_PART_INFO[opt.type] ?? 'A new part for your plant.'}</div>
        ${reasonText ? `<div class="hud-grow-option__warning">${reasonText}</div>` : ''}
      </div>
    `;

    card.onclick = (e) => {
      e.stopPropagation();
      parts.optionsEl.querySelectorAll('.hud-grow-option').forEach((c) => {
        (c as HTMLElement).classList.remove('selected');
      });
      card.classList.add('selected');

      if (!opt.available) {
        setGrowthGrowEnabled(false, reasonText);
        setDetail(`${opt.label}: ${reasonText}`);
        return;
      }

      growthSelectionStateMachineSelectOption(growthSelectionMachine, opt.type, opt.label);
      // Start aiming straight away: ring on the surface, arrow to turn. The
      // persistent Grow button becomes active only now.
      beginGrowthAiming(result.nodeId, opt.type, opt.label);
      uiShell?.toast({
        message: `Aiming ${opt.label} - drag to turn, then Grow`,
        kind: 'info',
        durationMs: 2000,
      });
    };
    parts.optionsEl.appendChild(card);
  }
}

function clearOwnPlantMissing(): void {
  ownPlantMissingSince = 0;
}

function markOwnPlantMissing(): void {
  if (!plantId || !plantReady) return;
  const now = performance.now();
  if (ownPlantMissingSince === 0) {
    ownPlantMissingSince = now;
    return;
  }
  if (now - ownPlantMissingSince < 2500) return;
  handleOwnPlantLoss();
}

let hiddenHudForPanels: Array<{ el: HTMLElement; display: string }> = [];

/** Hide HUD pieces the side panels actually cover, remembering their display. */
function hideOverlappingHud(): void {
  if (hiddenHudForPanels.length > 0) return;
  const panels = [playerPanels?.inspect, playerPanels?.inventory].filter(
    (panel): panel is HTMLElement => panel instanceof HTMLElement,
  );
  if (panels.length === 0) return;
  const panelRects = panels.map((panel) => panel.getBoundingClientRect());
  const overlaps = (el: HTMLElement): boolean => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    return panelRects.some(
      (panel) =>
        rect.left < panel.right &&
        rect.right > panel.left &&
        rect.top < panel.bottom &&
        rect.bottom > panel.top,
    );
  };
  const candidates = [
    chatContainer,
    mutationPanel?.panel ?? null,
    plantStatusHud?.element ?? null,
    document.getElementById('resource-readout'),
    // The hotbar and the purse sit low and to the right, exactly where the
    // inventory and inspect panels end. Both are part of the HUD the panels
    // overlap, so they hide with the rest instead of leaving two slots under a
    // panel's edge.
    hotbar?.element ?? null,
    sporeChip?.element ?? null,
  ];
  for (const el of candidates) {
    if (!el || !overlaps(el)) continue;
    hiddenHudForPanels.push({ el, display: el.style.display });
    el.style.display = 'none';
  }
}

function restoreOverlappingHud(): void {
  for (const entry of hiddenHudForPanels) entry.el.style.display = entry.display;
  hiddenHudForPanels = [];
}

/** Use one pouch slot. The client asks; the server decides what the item does. */
function useInventorySlot(slotIndex: number): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: MESSAGE_TYPE.INVENTORY_SLOT_USE, payload: { slotIndex } }));
}

/** Ask the server for the pouch; the client never owns inventory contents. */
function requestInventory(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: MESSAGE_TYPE.INVENTORY_REQUEST, payload: {} }));
}

/** Build one Inspect/Inventory view from the authoritative client mirrors. */
function refreshPlayerPanels(): void {
  if (!playerPanels?.isOpen) return;
  const now = performance.now();
  if (plantId && plantFirstSeenAtMs === 0) plantFirstSeenAtMs = now;
  const ownNodes = Array.from(plantNodes.values()).filter((node) => node.isOwnPlant);
  peakNodeCount = Math.max(peakNodeCount, ownNodes.length);
  peakBiomass = Math.max(peakBiomass, plantBiomass);
  const fraction = plantStructure ? structureFraction(plantStructure) : null;
  const stats: PlantStatsSummary = {
    healthFraction: fraction,
    biomass: plantBiomass,
    biomassRatePerSecond: smoothedBiomassRate,
    peakBiomass,
    energy: plantEnergy,
    storedWater: plantWater,
    waterCapacity: plantWaterCapacity,
    storedMinerals: plantMinerals,
    mineralCapacity: plantMineralCapacity,
    nodeCount: ownNodes.length,
    peakNodeCount,
    mutationCount: plantMutationCount,
    mutationUpkeepPerSecond: plantMutationUpkeep,
    mutationEnergyUpkeepPerSecond: plantMutationEnergyUpkeep,
    mutationBiomassUpkeepPerSecond: plantMutationBiomassUpkeep,
    ageSeconds: plantFirstSeenAtMs > 0 ? (now - plantFirstSeenAtMs) / 1000 : 0,
    dayNumber: weatherDayNumber,
    clock: weatherClock,
  };
  playerPanels.update({
    stats,
    phase: plantPhase,
    rerootWindowRemainingS: rerootRemainingSeconds(),
    nodes: ownNodes.map((node) => ({
      id: node.id,
      type: node.nodeType ?? String(node.type),
      layer: node.layer ?? (node.type === 0 ? 'root' : 'canopy'),
      biomass: node.biomass,
      health: node.health,
      age: node.age,
      growthProgress: node.growthProgress ?? 1,
      isSeed: node.isSeed === true,
    })),
    pressure: mutationState?.pressure ?? {},
    mutationShedCooldownS: mutationState?.shedCooldownRemainingS ?? 0,
    mutations:
      mutationState?.mutations.map((mutation) => ({
        id: mutation.id,
        name: mutation.name,
        kind: mutation.kind,
        energyPerSecond: mutation.energyPerSecond,
        biomassPerSecond: mutation.biomassPerSecond,
        level: mutation.level ?? 1,
        maxLevel: mutation.maxLevel ?? 1,
        levelCostEnergy: mutation.levelCostEnergy ?? 0,
        levelCostBiomass: mutation.levelCostBiomass ?? 0,
        levelBlocked: mutation.levelBlocked,
      })) ?? [],
    mutationLevelOffer: mutationState?.levelOffer ?? null,
    inventory: inventorySlots,
    maxSlots: inventoryMaxSlots,
    ledger: sporeLedger,
  });
}

/** Seconds left in the reroot window, or null when no window is running. */
function rerootRemainingSeconds(): number | null {
  if (plantPhase === 'rooted' || uprootWindowEndsAtMs <= 0) return null;
  return Math.max(0, (uprootWindowEndsAtMs - performance.now()) / 1000);
}

/**
 * HUD biomass rate. The server sends authoritative totals, not a rate, so derive
 * one from consecutive samples and smooth it; the displayed number must never
 * look like it came from client prediction.
 */
function noteBiomassSample(value: number): void {
  if (!Number.isFinite(value)) return;
  plantBiomass = value;
  peakBiomass = Math.max(peakBiomass, value);
  if (plantId && plantFirstSeenAtMs === 0) plantFirstSeenAtMs = performance.now();
  const now = performance.now();
  if (lastBiomassSample) {
    const dt = (now - lastBiomassSample.atMs) / 1000;
    if (dt >= 0.05 && dt <= 2) {
      const raw = (value - lastBiomassSample.value) / dt;
      smoothedBiomassRate =
        smoothedBiomassRate === null ? raw : smoothedBiomassRate * 0.75 + raw * 0.25;
    } else if (dt > 2) {
      // A tab that was hidden or a reconnect gap is not a rate sample.
      smoothedBiomassRate = null;
    }
  }
  lastBiomassSample = { value, atMs: now };
}

/**
 * One-shot refit for a newly framed plant: the welcome pass cannot measure a
 * plant it has not received yet, and a 6 m view of a seedling is dirt.
 */
function maybeRefitPlantFraming(): void {
  if (!refitFramingOnFirstNodes) return;
  if (cameraUserMoved) {
    refitFramingOnFirstNodes = false;
    return;
  }
  const ownNodes = Array.from(plantNodes.values()).filter((node) => node.isOwnPlant);
  if (ownNodes.length === 0) return;
  refitFramingOnFirstNodes = false;
  // Same eased travel as Space: the view settles onto the seedling instead of
  // teleporting 4.5 m.
  recenterCamera();
}

function updatePlantStatusHud(): void {
  maybeRefitPlantFraming();
  if (playerPanels?.isOpen && performance.now() - lastPanelRefreshAtMs >= 200) {
    lastPanelRefreshAtMs = performance.now();
    refreshPlayerPanels();
  }
  plantStatusHud?.update({
    biomass: plantBiomass,
    biomassRatePerSecond: smoothedBiomassRate,
    phase: plantPhase,
    structure: plantStructure ?? undefined,
    mutationCount: plantMutationCount,
    mutationUpkeepPerSecond: plantMutationUpkeep,
    mutationEnergyUpkeepPerSecond: plantMutationEnergyUpkeep,
    mutationBiomassUpkeepPerSecond: plantMutationBiomassUpkeep,
    energy: plantEnergy,
    storedWater: plantWater,
    waterCapacity: plantWaterCapacity,
    storedMinerals: plantMinerals,
    mineralCapacity: plantMineralCapacity,
    nodeCount: Array.from(plantNodes.values()).filter((node) => node.isOwnPlant).length,
    rerootWindowRemainingS: rerootRemainingSeconds(),
  });
}

/** Camera-relative world direction for one reroot control. */
function cameraRelativeDirection(direction: RerootDirection): { x: number; z: number } {
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  switch (direction) {
    case 'forward':
      return { x: forward.x, z: forward.z };
    case 'back':
      return { x: -forward.x, z: -forward.z };
    case 'left':
      return { x: -right.x, z: -right.z };
    case 'right':
      return { x: right.x, z: right.z };
    default:
      return { x: 0, z: 0 };
  }
}

function sendRerootIntent(x: number, z: number): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (plantPhase === 'rooted') return;
  ws.send(JSON.stringify({ type: MESSAGE_TYPE.REROOT_INTENT, payload: { dirX: x, dirZ: z } }));
}

function handleRerootControl(direction: RerootDirection): void {
  if (direction === 'stop') {
    rerootKeys.clear();
    sendRerootIntent(0, 0);
    return;
  }
  const vector = cameraRelativeDirection(direction);
  sendRerootIntent(vector.x, vector.z);
}

/**
 * While uprooted, the movement keys steer the crawl instead of panning the
 * camera (DESIGN 18.1.2: the movement control belongs to the plant only in that
 * state). Returns true when the action was consumed.
 */
function handleRerootMovementKey(actionId: string, active: boolean): boolean {
  if (plantPhase === 'rooted') return false;
  const directionByAction: Record<string, RerootDirection | undefined> = {
    camera_pan_forward: 'forward',
    camera_pan_backward: 'back',
    camera_pan_left: 'left',
    camera_pan_right: 'right',
  };
  const direction = directionByAction[actionId];
  if (!direction) return false;
  if (active) rerootKeys.add(direction);
  else rerootKeys.delete(direction);
  let x = 0;
  let z = 0;
  for (const key of rerootKeys) {
    const vector = cameraRelativeDirection(key);
    x += vector.x;
    z += vector.z;
  }
  const length = Math.hypot(x, z);
  if (length > 1e-6) sendRerootIntent(x / length, z / length);
  else sendRerootIntent(0, 0);
  return true;
}

/** Show the title's "your plant is gone" card without tearing down the socket. */
function showPlantLostScreen(): void {
  entryFlowPlantLost(entryFlow, lostReason, lostStats ?? undefined);
  entryScreen.render(entryFlow);
}

/**
 * Ask for a new seed on the socket we already hold.
 *
 * The card's first action used to route through the title screen, which meant
 * a fresh connection, a fresh world and - on a reload - a camera framed before
 * the terrain was known. The server answers with a WELCOME for the new plant,
 * and the welcome handler does the rest: adopt it, reframe, show the HUD again.
 * If the socket is gone there is nothing to ask, so the title is the fallback.
 */
function requestNewSeed(): void {
  if (respawnPending) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    exitDeathUi();
    showPlantLostScreen();
    return;
  }
  respawnPending = true;
  ws.send(JSON.stringify({ type: MESSAGE_TYPE.RESPAWN, payload: {} }));
  contextHint?.show({
    id: 'respawn',
    text: 'Planting a new seed...',
    durationMs: 5000,
  });
  // A server that never answers must not leave the player behind a dead card.
  window.setTimeout(() => {
    if (!respawnPending) return;
    respawnPending = false;
    exitDeathUi();
    showPlantLostScreen();
  }, 6000);
}

/** Close the death card and the spectate chip; the plant they describe is gone. */
function exitDeathUi(): void {
  respawnPending = false;
  spectating = false;
  deathScreen?.destroy();
  deathScreen = null;
  spectateChip?.destroy();
  spectateChip = null;
}

/** One reset path for a live death and a missed PLANT_REMOVED. */
function handleOwnPlantLoss(
  cause?: string,
  source?: string,
  /** The death record's own numbers, which are newer than the client mirror. */
  report?: { biomass?: number; nodeCount?: number },
): void {
  const lostPlantId = plantId;
  if (!lostPlantId) return;
  if (playerPanels?.isOpen) {
    playerPanels.setOpen(false);
    restoreOverlappingHud();
  }
  settingsPanel?.setOpen(false);
  uiShell?.setToastsEnabled(false);
  const deathStats: PlantStatsSummary = {
    healthFraction: plantStructure ? structureFraction(plantStructure) : null,
    biomass: report?.biomass ?? plantBiomass,
    biomassRatePerSecond: smoothedBiomassRate,
    peakBiomass,
    energy: plantEnergy,
    storedWater: plantWater,
    waterCapacity: plantWaterCapacity,
    storedMinerals: plantMinerals,
    mineralCapacity: plantMineralCapacity,
    nodeCount:
      report?.nodeCount ?? Array.from(plantNodes.values()).filter((node) => node.isOwnPlant).length,
    peakNodeCount: Math.max(peakNodeCount, report?.nodeCount ?? 0),
    mutationCount: plantMutationCount,
    mutationUpkeepPerSecond: plantMutationUpkeep,
    mutationEnergyUpkeepPerSecond: plantMutationEnergyUpkeep,
    mutationBiomassUpkeepPerSecond: plantMutationBiomassUpkeep,
    ageSeconds: plantFirstSeenAtMs > 0 ? (performance.now() - plantFirstSeenAtMs) / 1000 : 0,
    dayNumber: weatherDayNumber,
    clock: weatherClock,
  };
  const deathCause = cause && cause !== 'removed' ? cause : 'unknown';
  plantNodes.clear();
  otherPlayerPlants.clear();
  plantId = null;
  plantReady = false;
  ownRootNodeId = null;
  lastOwnAnchorValid = false;
  clearOwnPlantMissing();
  resetPlantMirror();
  clearPlantIdentity();
  hideGrowthSelection();
  setRootSightEnabled(false, lostPlantId);
  hideLossReport();
  plantBiomass = 0;
  plantEnergy = 0;
  plantMutationCount = 0;
  plantMutationUpkeep = 0;
  plantMutationEnergyUpkeep = 0;
  plantMutationBiomassUpkeep = 0;
  mutationState = null;
  plantPhase = 'rooted';
  uprootWindowEndsAtMs = 0;
  plantStructure = null;
  rerootKeys.clear();
  plantStatusHud?.setVisible(false);
  actionBar?.setVisible(false);
  hotbar?.setVisible(false);
  sporeChip?.setVisible(false);
  contextHint?.hide();
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
  setDetail('Your plant died.');
  const reason = cause && cause !== 'removed' ? describeDeathCause(cause, source) : null;
  const died = cause !== 'removed';
  // The stats row keeps the machine code but names what did it, so "damage" is
  // never the whole story the player is given.
  lostReason = reason;
  lostStats = { cause: source ? `${deathCause} · ${source}` : deathCause, stats: deathStats };

  // A death that was not a removal gets a card in the world, and the first thing
  // it offers is to stay: the player who spent an hour on this plant is allowed to
  // watch the weather over the place it stood instead of being cut to a menu.
  if (died) {
    // The death card is the only thing to answer: a pause menu, Settings or a
    // side panel opened a frame before death must not sit on top of it.
    pauseMenu?.close();
    settingsPanel?.setOpen(false);
    playerPanels?.setOpen(false);
    deathScreen?.destroy();
    deathScreen = createDeathScreen(
      {
        cause: deathCause,
        ...(source ? { source } : {}),
        stats: deathStats,
        reason: reason ?? 'It died.',
      },
      {
        mount: uiShell?.getLayer('modal') ?? document.body,
        onSpectate: () => enterSpectate(),
        onNewSeed: () => requestNewSeed(),
      },
    );
    return;
  }
  showPlantLostScreen();
}

/**
 * Stay in the world after the plant is gone.
 *
 * Not a separate mode with its own rules: the same world, no plant, a free camera
 * and one chip that leaves. Everything that needed a plant is already closed by
 * the time this runs, so what is left is the place.
 */
function enterSpectate(): void {
  // The card's button and its Escape key can both land here; the second one has
  // nothing left to enter.
  if (spectating) return;
  deathScreen?.destroy();
  deathScreen = null;
  spectating = true;
  plantStatusHud?.setVisible(false);
  actionBar?.setVisible(false);
  hotbar?.setVisible(false);
  sporeChip?.setVisible(false);
  setGrowModeChrome(false);
  hideGrowthSelection();
  spectateChip?.destroy();
  // The chip's seed button asks the live server, exactly as the card's does.
  // Routing it through the title closed a healthy socket for no reason.
  spectateChip = createSpectateChip(uiShell?.getLayer('hud') ?? document.body, () =>
    requestNewSeed(),
  );
  contextHint?.show({
    id: 'spectate',
    text: 'Your plant is gone. The world is still running.',
    durationMs: 6000,
  });
}

function hideGrowthSelection(): void {
  growthSelectionStateMachineHide(growthSelectionMachine);
  growthAimDragging = false;
  suppressGrowthClickUntil = 0;
  growthSelectionPanel?.querySelector('#growth-aim-controls')?.remove();
  removeGrowthDirectionLine();
  controls.enabled = true;
  controls.enableRotate = true;
  controls.enablePan = true;
  const panel = growthSelectionPanel;
  if (panel) panel.style.display = 'none';
  setGrowthPanelOpen(false);
}

// Chat UI
let chatContainer: HTMLElement | null = null;
let chatMessages: HTMLElement | null = null;
let chatInput: HTMLInputElement | null = null;
let chatOpen = false;
/** Lines that arrived while the panel was closed; shown on the Chat button. */
let chatUnread = 0;
const MAX_CHAT_MESSAGES = 50;
let chatHudZIndex = 200;

// T05 Communication state
let chatConfig: { proximityRangePx: number; worldRateMsgPerMin: number; logSize: number } | null =
  null;
let reportConfig: {
  reportReasons: Array<{ id: string; label: string; category: string }>;
  contextLineCount: number;
  reportFreeTextMax: number;
  reportRateLimitPerMin: number;
} | null = null;
let chatMode: 'proximity' | 'world' = 'world';
const blockedPlayerIds = new Set<string>();
const chatRateTimestamps: number[] = [];
const recentChatLines: Array<{ playerName: string; message: string; timestamp: number }> = [];
let reportDialogEl: HTMLElement | null = null;
let reportTarget: { playerId?: string; playerName?: string; message?: string } | null = null;

function createChatUI(): void {
  const hudLayer = uiShell?.getLayer('hud');
  if (!hudLayer) return;

  chatContainer = document.createElement('div');
  chatContainer.id = 'chat-container';
  chatContainer.style.cssText = `
    background: linear-gradient(180deg, rgba(18, 22, 13, 0.9) 0%, rgba(24, 30, 20, 0.85) 100%);
    border: 1px solid var(--hud-border);
    display: none;
    flex-direction: column;
    font-family: inherit;
    font-size: var(--hud-font-sm);
    color: var(--warm-ink);
    z-index: ${chatHudZIndex};
    overflow: hidden;
    box-shadow: var(--hud-shadow-sm);
    /* The hud layer is pointer-events: none, so an interactive child must opt
       in or every click falls through to the canvas underneath. */
    pointer-events: auto;
    box-sizing: border-box;
  `;

  // No title bar: the tabs and the close button share one compact row.
  const chatCloseBtn = document.createElement('button');
  chatCloseBtn.id = 'chat-close';
  chatCloseBtn.type = 'button';
  chatCloseBtn.textContent = 'X';
  chatCloseBtn.style.cssText = `
    background: none;
    border: none;
    color: var(--bark-300);
    cursor: pointer;
    font-size: 0.8rem;
    line-height: 1;
    padding: 3px 7px;
    border-radius: 8px;
  `;
  chatCloseBtn.addEventListener('click', () => toggleChat(false));

  // Proximity / World tabs plus the close button in a single row.
  const tabBar = document.createElement('div');
  tabBar.style.cssText = `
    display: flex;
    align-items: center;
    padding: 5px 8px;
    border-bottom: 1px solid rgba(94, 122, 53, 0.12);
    gap: 6px;
  `;

  const proximityBtn = document.createElement('button');
  proximityBtn.type = 'button';
  proximityBtn.textContent = 'Proximity';
  proximityBtn.style.cssText = `
    flex: 1;
    background: ${chatMode === 'proximity' ? 'var(--leaf-900)' : 'transparent'};
    border: 1px solid var(--hud-border);
    border-radius: 8px;
    color: var(--bone-100);
    font-family: inherit;
    font-size: calc(11px * var(--text-scale, 1));
    padding: 4px 8px;
    cursor: pointer;
  `;
  proximityBtn.addEventListener('click', () => {
    chatMode = 'proximity';
    proximityBtn.style.background = 'var(--leaf-900)';
    worldBtn.style.background = 'transparent';
  });

  const worldBtn = document.createElement('button');
  worldBtn.type = 'button';
  worldBtn.textContent = 'World';
  worldBtn.style.cssText = `
    flex: 1;
    background: ${chatMode === 'world' ? 'var(--leaf-900)' : 'transparent'};
    border: 1px solid var(--hud-border);
    border-radius: 8px;
    color: var(--bone-100);
    font-family: inherit;
    font-size: calc(11px * var(--text-scale, 1));
    padding: 4px 8px;
    cursor: pointer;
  `;
  worldBtn.addEventListener('click', () => {
    chatMode = 'world';
    worldBtn.style.background = 'var(--leaf-900)';
    proximityBtn.style.background = 'transparent';
  });

  tabBar.appendChild(proximityBtn);
  tabBar.appendChild(worldBtn);
  tabBar.appendChild(chatCloseBtn);
  // Connection light sits at the head of the toolbar row.
  if (statusElement) tabBar.insertBefore(statusElement, proximityBtn);
  chatContainer.appendChild(tabBar);

  // Messages area
  chatMessages = document.createElement('div');
  chatMessages.id = 'chat-messages';
  chatMessages.style.cssText = `
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: var(--hud-gap);
  `;
  chatContainer.appendChild(chatMessages);

  // Input area
  const inputWrapper = document.createElement('div');
  inputWrapper.style.cssText = `
    padding: 6px 8px;
    border-top: 1px solid rgba(94, 122, 53, 0.15);
    display: flex;
    align-items: center;
    gap: 6px;
    /* Fixed row: the message list is what shrinks when the panel is short, so
       the Send button can never be clipped by the panel's rounded edge. */
    flex: 0 0 auto;
    box-sizing: border-box;
  `;
  chatInput = document.createElement('input');
  chatInput.type = 'text';
  chatInput.id = 'chat-input';
  chatInput.placeholder = 'Type a message...';
  chatInput.style.cssText = `
    flex: 1 1 auto;
    /* Without this a flex item refuses to shrink below its placeholder width
       and pushes the Send button outside the panel. */
    min-width: 0;
    background: var(--loam-800);
    border: 1px solid var(--bark-600);
    border-radius: 10px;
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
  sendBtn.type = 'button';
  sendBtn.style.cssText = `
    background: linear-gradient(180deg, var(--leaf-500) 0%, var(--leaf-600) 100%);
    border: 1px solid var(--leaf-400);
    border-radius: var(--hud-radius-sm);
    padding: clamp(3px, 0.5vh, 6px) clamp(8px, 1vw, 14px);
    color: var(--loam-900);
    font-family: inherit;
    font-size: var(--hud-font-md);
    font-weight: 700;
    letter-spacing: 0.02em;
    line-height: 1.2;
    cursor: pointer;
    align-self: stretch;
    flex: 0 0 auto;
    box-sizing: border-box;
  `;
  sendBtn.onclick = () => {
    if (chatInput?.value.trim()) {
      sendChatMessage(chatInput.value.trim());
      chatInput.value = '';
    }
  };
  inputWrapper.appendChild(sendBtn);
  chatContainer.appendChild(inputWrapper);

  // Box model lives in one place: desktop is a corner column, a phone gets the
  // full width above the action bar (a 200px column was unreadable on a phone).
  if (!document.getElementById('chat-layout-style')) {
    const chatStyle = document.createElement('style');
    chatStyle.id = 'chat-layout-style';
    chatStyle.textContent = `
      #chat-container {
        position: fixed;
        top: var(--hud-top);
        left: var(--hud-corner);
        width: var(--hud-chat-w);
        height: var(--hud-chat-h);
        max-height: var(--hud-chat-h);
        border-radius: var(--hud-radius);
      }
      /* A finger layout only, like the vitals card and the player panels: a narrow
         *desktop* pane keeps the corner column and is scaled by --pl-ui-scale
         instead of being replaced by a sheet over the world. */
      @media (max-width: 560px) and (hover: none) and (pointer: coarse), (max-width: 480px) {
        /* Bottom sheet, not a top overlay: the vitals card and the status card own
           the top of a phone screen, and a chat box over them hid both. */
        #chat-container {
          top: auto;
          bottom: calc(var(--pl-bar-offset, 45px) + 26px + env(safe-area-inset-bottom, 0px));
          left: var(--hud-corner);
          right: var(--hud-corner);
          width: auto;
          height: min(42vh, 320px);
          max-height: min(42vh, 320px);
        }
      }
    `;
    document.head.appendChild(chatStyle);
  }
  // Same opt-in as every other HUD child: appended through the shell, not
  // straight onto a `pointer-events: none` layer.
  uiShell?.attachTo('hud', chatContainer);
}

function toggleChat(open?: boolean): void {
  if (!chatContainer) return;
  chatOpen = open ?? !chatOpen;
  chatContainer.style.display = chatOpen ? 'flex' : 'none';
  if (chatOpen) {
    chatUnread = 0;
    actionBar?.setBadge('chat', 0);
    chatInput?.focus();
  }
}

function addChatMessage(
  playerId: string | null,
  playerName: string,
  message: string,
  isOwn: boolean,
): void {
  if (!chatMessages) return;

  // T05: block hides blocked players' chat
  if (playerId && blockedPlayerIds.has(playerId)) return;

  // T05: track recent lines for report context snapshots
  recentChatLines.push({ playerName, message, timestamp: Date.now() });
  const maxLines = reportConfig?.contextLineCount ?? 50;
  while (recentChatLines.length > maxLines) recentChatLines.shift();

  const msgEl = document.createElement('div');
  msgEl.style.cssText = `
    padding: 5px 9px;
    background: ${isOwn ? 'var(--leaf-900)' : 'var(--bark-800)'};
    border-radius: 10px 10px 10px 2px;
    max-width: 85%;
    align-self: ${isOwn ? 'flex-end' : 'flex-start'};
    overflow-wrap: break-word;
    font-size: 0.7rem;
    line-height: 1.3;
    color: var(--warm-ink);
    box-shadow: var(--hud-shadow-sm);
    position: relative;
  `;
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const nameColor = isOwn ? 'var(--leaf-300)' : 'var(--bark-200)';
  msgEl.innerHTML = `
    <span style="font-weight: bold; color: ${nameColor}; margin-right: 6px;">${escapeHtml(playerName)}</span>
    <span>${escapeHtml(message)}</span>
    <span style="font-size: 0.75em; color: var(--bark-400); margin-left: 8px;">${time}</span>
  `;

  // T05: right-click context menu for report/block
  msgEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showChatContextMenu(e.clientX, e.clientY, playerId, playerName, message);
  });

  chatMessages.appendChild(msgEl);

  // Limit message count
  while (chatMessages.children.length > MAX_CHAT_MESSAGES) {
    const firstChild = chatMessages.firstChild;
    if (firstChild) chatMessages.removeChild(firstChild);
  }

  // Auto-scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;

  // Do not open the panel. It used to appear for five seconds on every message,
  // which covered the vitals on a phone and stole the cursor on a desktop. The
  // action bar's Chat button counts what is waiting instead.
  if (!chatOpen) {
    chatUnread += 1;
    actionBar?.setBadge('chat', chatUnread);
  }
}

function showChatContextMenu(
  x: number,
  y: number,
  playerId: string | null,
  playerName: string,
  message: string,
): void {
  // Remove existing context menu
  const existing = document.getElementById('chat-context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.id = 'chat-context-menu';
  menu.style.cssText = `
    position: fixed;
    left: ${x}px;
    top: ${y}px;
    z-index: 600;
    background: var(--bark-800);
    border: 1px solid var(--hud-border);
    border-radius: var(--hud-radius);
    box-shadow: var(--hud-shadow);
    padding: 6px 0;
    min-width: 160px;
    pointer-events: auto;
    font-family: inherit;
    font-size: calc(12px * var(--text-scale, 1));
  `;

  const isBlocked = playerId ? blockedPlayerIds.has(playerId) : false;

  const blockItem = document.createElement('div');
  blockItem.textContent = isBlocked ? 'Unblock player' : 'Block player';
  blockItem.style.cssText = `
    padding: 8px 14px;
    color: var(--bone-100);
    cursor: pointer;
  `;
  blockItem.addEventListener('mouseenter', () => {
    blockItem.style.background = 'var(--bark-700)';
  });
  blockItem.addEventListener('mouseleave', () => {
    blockItem.style.background = 'transparent';
  });
  blockItem.addEventListener('click', () => {
    toggleBlockPlayer(playerId, playerName);
    menu.remove();
  });
  menu.appendChild(blockItem);

  const reportItem = document.createElement('div');
  reportItem.textContent = 'Report message';
  reportItem.style.cssText = `
    padding: 8px 14px;
    color: var(--bone-100);
    border-top: 1px solid var(--hud-border);
    cursor: pointer;
  `;
  reportItem.addEventListener('mouseenter', () => {
    reportItem.style.background = 'var(--bark-700)';
  });
  reportItem.addEventListener('mouseleave', () => {
    reportItem.style.background = 'transparent';
  });
  reportItem.addEventListener('click', () => {
    openReportDialog({ playerId: playerId ?? undefined, playerName, message });
    menu.remove();
  });
  menu.appendChild(reportItem);

  document.body.appendChild(menu);

  // Close on click away
  const close = () => {
    menu.remove();
    document.removeEventListener('click', close);
  };
  document.addEventListener('click', close);
}

function toggleBlockPlayer(playerId: string | null, playerName: string): void {
  if (!playerId) return;
  const blocked = !blockedPlayerIds.has(playerId);
  if (blocked) {
    blockedPlayerIds.add(playerId);
    uiShell?.toast({ message: `Blocked ${playerName}`, kind: 'state', durationMs: 3000 });
  } else {
    blockedPlayerIds.delete(playerId);
    uiShell?.toast({ message: `Unblocked ${playerName}`, kind: 'info', durationMs: 3000 });
  }

  // The server keeps its own mute list so blocked messages never reach us.
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: MESSAGE_TYPE.BLOCK,
        payload: { targetPlayerId: playerId, blocked },
      }),
    );
  }
}

function openReportDialog(target: {
  playerId?: string;
  playerName?: string;
  message?: string;
}): void {
  reportTarget = target;
  createReportDialog();
}

function createReportDialog(): void {
  if (reportDialogEl) {
    reportDialogEl.style.display = 'flex';
    return;
  }

  if (!reportConfig) return;

  const modalLayer = uiShell?.getLayer('modal');
  if (!modalLayer) return;

  const dialog = document.createElement('div');
  dialog.id = 'report-dialog';
  dialog.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: auto;
  `;

  const backdrop = document.createElement('div');
  backdrop.style.cssText = `
    inset: 0;
    background: rgba(10, 12, 8, 0.72);
  `;
  backdrop.addEventListener('click', closeReportDialog);
  dialog.appendChild(backdrop);

  const card = document.createElement('div');
  card.style.cssText = `
    background: var(--bark-800);
    border: 1px solid var(--hud-border);
    border-radius: var(--hud-radius);
    padding: 16px;
    width: min(380px, 92vw);
    max-height: 85vh;
    overflow-y: auto;
    box-shadow: var(--hud-shadow);
    pointer-events: auto;
  `;

  const title = document.createElement('div');
  title.textContent = 'Report';
  title.style.cssText = `
    font-weight: 700;
    color: var(--bone-100);
    margin-bottom: 12px;
    font-size: calc(14px * var(--text-scale, 1));
  `;
  card.appendChild(title);

  // Target info (pre-filled, read-only)
  const targetLabel = document.createElement('div');
  const who = reportTarget?.playerName ?? 'Unknown player';
  const what = reportTarget?.message ? `"${escapeHtml(reportTarget.message)}"` : 'player';
  targetLabel.textContent = `Reporting ${who} for ${what}`;
  targetLabel.style.cssText = `
    color: var(--bone-300);
    font-size: calc(12px * var(--text-scale, 1));
    margin-bottom: 12px;
  `;
  card.appendChild(targetLabel);

  // Reason dropdown
  const reasonLabel = document.createElement('div');
  reasonLabel.textContent = 'Reason';
  reasonLabel.style.cssText = `
    color: var(--bone-100);
    font-size: calc(11px * var(--text-scale, 1));
    margin-bottom: 6px;
  `;
  card.appendChild(reasonLabel);

  const reasonSelect = document.createElement('select');
  reasonSelect.style.cssText = `
    width: 100%;
    background: var(--loam-800);
    border: 1px solid var(--bark-600);
    border-radius: 8px;
    color: var(--bone-100);
    font-family: inherit;
    font-size: calc(12px * var(--text-scale, 1));
    padding: 6px 10px;
    margin-bottom: 12px;
  `;
  for (const reason of reportConfig.reportReasons) {
    const opt = document.createElement('option');
    opt.value = reason.id;
    opt.textContent = reason.label;
    reasonSelect.appendChild(opt);
  }
  card.appendChild(reasonSelect);

  // Additional info
  const infoLabel = document.createElement('div');
  infoLabel.textContent = 'Additional info';
  infoLabel.style.cssText = `
    color: var(--bone-100);
    font-size: calc(11px * var(--text-scale, 1));
    margin-bottom: 6px;
  `;
  card.appendChild(infoLabel);

  const infoText = document.createElement('textarea');
  infoText.placeholder = 'Any additional details...';
  infoText.style.cssText = `
    width: 100%;
    background: var(--loam-800);
    border: 1px solid var(--bark-600);
    border-radius: 8px;
    color: var(--bone-100);
    font-family: inherit;
    font-size: calc(12px * var(--text-scale, 1));
    padding: 8px 10px;
    margin-bottom: 12px;
    resize: vertical;
    min-height: 80px;
  `;
  infoText.maxLength = reportConfig.reportFreeTextMax;
  card.appendChild(infoText);

  // Block checkbox
  const blockRow = document.createElement('div');
  blockRow.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 14px;
  `;
  const blockCheckbox = document.createElement('input');
  blockCheckbox.type = 'checkbox';
  blockCheckbox.checked = true;
  blockCheckbox.style.cssText = `accent-color: var(--leaf-500);`;
  const blockLabel = document.createElement('label');
  blockLabel.textContent = 'Block this player';
  blockLabel.style.cssText = `
    color: var(--bone-100);
    font-size: calc(12px * var(--text-scale, 1));
    cursor: pointer;
  `;
  blockRow.appendChild(blockCheckbox);
  blockRow.appendChild(blockLabel);
  card.appendChild(blockRow);

  // Buttons
  const btnRow = document.createElement('div');
  btnRow.style.cssText = `
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  `;

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = `
    background: transparent;
    border: 1px solid var(--hud-border);
    border-radius: 8px;
    color: var(--bone-100);
    font-family: inherit;
    font-size: calc(12px * var(--text-scale, 1));
    padding: 6px 14px;
    cursor: pointer;
  `;
  cancelBtn.addEventListener('click', closeReportDialog);
  btnRow.appendChild(cancelBtn);

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.textContent = 'Submit';
  submitBtn.style.cssText = `
    background: var(--ember-600);
    border: 1px solid var(--ember-500);
    border-radius: 8px;
    color: var(--loam-900);
    font-family: inherit;
    font-size: calc(12px * var(--text-scale, 1));
    font-weight: 700;
    padding: 6px 14px;
    cursor: pointer;
  `;
  submitBtn.addEventListener('click', () => {
    submitReport(reasonSelect.value, infoText.value, blockCheckbox.checked);
    closeReportDialog();
  });
  btnRow.appendChild(submitBtn);
  card.appendChild(btnRow);

  dialog.appendChild(card);
  uiShell?.attachTo('modal', dialog);
  reportDialogEl = dialog;
}

function closeReportDialog(): void {
  if (reportDialogEl) {
    reportDialogEl.remove();
    reportDialogEl = null;
  }
  reportTarget = null;
}

async function submitReport(
  reasonId: string,
  freeText: string,
  shouldBlock: boolean,
): Promise<void> {
  if (!reportTarget?.playerId) return;

  // T05: rate limit reports
  const now = Date.now();
  const reportWindow = now - 60000; // last 60 seconds
  const recentReports = chatRateTimestamps.filter((t) => t > reportWindow);
  const rateLimit = reportConfig ? reportConfig.reportRateLimitPerMin : 5;
  if (recentReports.length >= rateLimit) {
    uiShell?.toast({
      message: 'Report rate limit reached. Try again later.',
      kind: 'error',
      durationMs: 4000,
    });
    return;
  }

  // Build context snapshot from recent chat lines
  const contextLineCount = reportConfig ? reportConfig.contextLineCount : 20;
  const contextSnapshot = recentChatLines.slice(-contextLineCount);

  if (ws && ws.readyState === WebSocket.OPEN) {
    const payload = JSON.stringify({
      // 29 = REPORT. It must not reuse 10, which is WELCOME.
      type: 29,
      payload: {
        targetPlayerId: reportTarget.playerId ?? '',
        targetPlayerName: reportTarget.playerName,
        reason: reasonId,
        freeText: freeText.slice(0, reportConfig ? reportConfig.reportFreeTextMax : 500),
        block: shouldBlock,
        contextSnapshot,
        timestamp: now,
      },
    });
    ws.send(payload);
    chatRateTimestamps.push(now);
    uiShell?.toast({ message: 'Report submitted', kind: 'info', durationMs: 3000 });

    if (shouldBlock && reportTarget.playerId) {
      blockedPlayerIds.add(reportTarget.playerId);
    }
  }
}

function checkChatRateLimit(): boolean {
  const now = Date.now();
  const windowStart = now - 60000;
  while (chatRateTimestamps.length > 0 && chatRateTimestamps[0] < windowStart) {
    chatRateTimestamps.shift();
  }
  const limit = chatConfig?.worldRateMsgPerMin ?? 12;
  if (chatRateTimestamps.length >= limit) return false;
  chatRateTimestamps.push(now);
  return true;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

const EMOTE_LABELS: Record<string, string> = {
  wave: 'Wave',
  cheer: 'Cheer',
  thumbs_up: 'Thumbs Up',
  heart: 'Heart',
  think: 'Think',
  sleep: 'Sleep',
  dance: 'Dance',
  sad: 'Sad',
};

function showEmoteAbovePlant(fromPlayerId: string, playerName: string, emoteId: string): void {
  const emoteLabel = EMOTE_LABELS[emoteId] ?? 'Emote';
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
    font-size: calc(0.95em * var(--text-scale));
    font-weight: 600;
    line-height: 1;
    transform: translate(-50%, -100%);
    animation: emote-pop 0.2s ease-out, emote-float 2s ease-out forwards;
    color: var(--bone-100);
    background: rgba(20, 24, 15, 0.85);
    border: 1px solid var(--bark-700);
    border-radius: 12px;
    padding: 6px 12px;
    white-space: nowrap;
    text-shadow: none;
    filter: none;
  `;
  bubble.textContent = emoteLabel;

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
    border-radius: 10px;
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

  // T05: rate limit outgoing chat messages
  if (!checkChatRateLimit()) {
    uiShell?.toast({
      message: 'Chat rate limit reached. Slow down.',
      kind: 'error',
      durationMs: 4000,
    });
    return;
  }

  const payload = JSON.stringify({
    type: MESSAGE_TYPE.CHAT_MESSAGE,
    payload: {
      message: message.slice(0, 500),
      mode: chatMode,
    },
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
    notify('Not connected: growth not sent', 'error');
    uiShell?.toast({ message: 'Growth not sent: not connected', kind: 'error', durationMs: 3000 });
    hideGrowthSelection();
    return;
  }
  if (!plantId || !plantReady) {
    notify('Plant is not ready yet: growth not sent', 'error');
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
/**
 * The visible half of the server's world drops.
 *
 * Built with the scene so a `DROP_SPAWN` that arrives before the first frame
 * still has somewhere to go. The ground sampler is lazy: the render config is
 * loaded after this point, and a drop is placed when it spawns, not at boot.
 */
/**
 * The soil as it is drawn, for the things that rest on it. Seating them on the
 * height field instead put a drop's contact shadow up to a few centimetres above
 * the triangle the player is looking at - the shadow that hovers.
 */
const drawnGround = new DrawnGround();
drawnGround.setFallback((x, z) =>
  planetTerrainY(renderConfig?.planetRadiusM ?? 0, x, z, getTerrainParams()),
);
const worldDrops = new WorldDrops({
  scene,
  groundY: (x, z) => drawnGround.height(x, z),
  // A drop's shadow lies in the drawn ground it sits on: on a slope a flat disc
  // cuts into the hill on one side and floats over it on the other.
  groundNormal: (x, z) => drawnGround.sample(x, z).normal,
  pickDistanceM: () => renderConfig?.dropPickDistanceM ?? 6,
});
// Sky-coloured background/fog so the world is never pitched into near-black.
// EnvironmentRenderer tints both toward the live horizon colour each frame,
// so this is the neutral starting colour before weather takes over.
scene.background = new THREE.Color('#C8D6D4');
scene.fog = new THREE.Fog('#C8D6D4', 60, 260);

// The far plane must clear the sky dome (max(300, terrain_radius * 1.5)) and
// the ground disc, otherwise the dome's far side is clipped and its cut edge
// shows as a faceted wall above the horizon.
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2500);
camera.position.set(0, 18, 26);
camera.lookAt(0, 0, 0);

/**
 * Smallest polar angle the orbit may reach.
 *
 * At exactly zero the view direction and the camera up vector are parallel, so
 * OrbitControls has no stable roll and a drag over the pole flips the view. The
 * singularity only needs to be missed by a hair, though, and it used to be
 * dodged by 3.4 degrees: at the 2 m orbit a young plant is framed from, that
 * parks the eye 12 cm short of the point straight above the target, which is a
 * hard stop you can see - the camera would not look directly down. A fortieth of
 * a degree is below what the viewport can show and still leaves the azimuth
 * defined.
 */
const CAMERA_MIN_POLAR_ANGLE = 0.0005;

/**
 * Ceiling on the pitch a blocked orbit may spend looking up, radians (~75°).
 * At that angle the sky is overhead and the plant is out of frame.
 */
const LOOK_UP_PITCH_MAX_RAD = 1.31;
/** How fast that pitch unwinds once it is released, radians/second. */
const LOOK_UP_PITCH_RETURN_RAD_PER_S = 4;
/**
 * How far the framing point has to move before the look-up pitch eases back, in
 * metres.
 *
 * A timer was wrong: the pitch held a pose and then re-aimed it with no input, so
 * the camera appeared to correct itself whenever the player let go near the plant
 * and looked up. Waiting for a downward drag was wrong the other way - walking
 * away left the view stuck at the sky. The pitch belongs to the framing it was
 * set for, so it gives back once that framing has actually moved this far.
 */
const LOOK_UP_PITCH_RELEASE_TRAVEL_M = 1;
/** Where the orbit target stood when the look-up pitch was last given back. */
let lookUpPitchAnchorX = 0;
let lookUpPitchAnchorZ = 0;
/**
 * How much of a blocked drag the pitch takes. Handing over the whole drag made
 * looking up race compared with the orbit that led into it; a little over half
 * keeps it a deliberate second control.
 */
const LOOK_UP_PITCH_GAIN = 0.55;
/** Extra pitch currently spent looking up off the ground, radians. */
let lookUpPitchTargetRad = 0;
/** The pitch actually drawn, eased toward the target like the orbit is. */
let lookUpPitchRad = 0;

/** Settings every OrbitControls instance starts with, including rebuilt ones. */
function createControls(): OrbitControls {
  const created = new OrbitControls(camera, renderer.domElement);
  // OrbitControls writes `cursor: auto` straight onto the canvas, and an inline
  // declaration beats the themed `html[data-pl-cursor] canvas` rule, so the leaf
  // theme never reached the scene. The canvas owns no cursor of its own: CSS does.
  renderer.domElement.style.removeProperty('cursor');
  created.enableDamping = true;
  created.dampingFactor = 0.05;
  created.enablePan = true;
  // Ground-plane pan, not screen-plane. A screen-space pan slides the whole rig
  // along the camera's tilted plane, so a right-drag towards the soil drove the
  // eye into the terrain, where the ground clamp held it and the drag stopped
  // doing anything. Panning across the ground keeps the eye's height, so the
  // right-drag answers everywhere, including from ground level.
  created.screenSpacePanning = false;
  // Mouse: left-drag orbits, middle-drag orbits, right-drag pans (left click
  // still selects). Touch: one-finger drag pans world, two-finger orbits/zooms.
  created.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.ROTATE,
    RIGHT: THREE.MOUSE.PAN,
  };
  created.touches = {
    ONE: THREE.TOUCH.PAN,
    TWO: THREE.TOUCH.DOLLY_ROTATE,
  };
  // Provisional limits before config/render.json is applied; the configured
  // camera_min_distance / camera_max_distance take over during init.
  created.minDistance = 1;
  created.maxDistance = camera.far * 0.9;
  created.minPolarAngle = CAMERA_MIN_POLAR_ANGLE;
  created.maxPolarAngle = Math.PI / 2 - 0.05;
  return created;
}

let controls = createControls();

/**
 * Vertical drag in radians of orbit pitch, positive when the player drags up.
 *
 * The look-up pitch needs the part of a drag the polar ceiling swallowed, and
 * OrbitControls only publishes the clamped angle. Its mapping is no secret
 * (`2π · dy / clientHeight · rotateSpeed`), so this records the drag from the
 * pointer itself instead of reading the controls' private spherical delta: a
 * private field is what a three.js release renames without warning, and the
 * feature would then fail silently.
 */
let orbitUpDragRad = 0;
let orbitDragPointer: number | null = null;
let orbitDragLastY = 0;

function trackOrbitUpDrag(): void {
  const element = renderer.domElement;
  element.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse') return;
    // Only the buttons OrbitControls rotates with; right-drag pans (see
    // `createControls`), so it must not tilt the view.
    if (event.button !== 0 && event.button !== 1) return;
    orbitDragPointer = event.pointerId;
    orbitDragLastY = event.clientY;
  });
  element.addEventListener('pointermove', (event) => {
    if (orbitDragPointer !== event.pointerId) return;
    const dy = event.clientY - orbitDragLastY;
    orbitDragLastY = event.clientY;
    // Dragging up raises the polar angle, which is the eye dropping towards the
    // soil and the view rising: `-dy` is the request to look up.
    orbitUpDragRad +=
      (-dy * 2 * Math.PI * controls.rotateSpeed) / Math.max(1, element.clientHeight);
  });
  const release = (event: PointerEvent) => {
    if (orbitDragPointer === event.pointerId) orbitDragPointer = null;
  };
  element.addEventListener('pointerup', release);
  element.addEventListener('pointercancel', release);
}

trackOrbitUpDrag();

/**
 * Note real input, so the loop can drop to its idle cadence and wake from it.
 *
 * `pointermove` counts on purpose: a hand on the mouse is not an idle machine
 * even when no button is down. The listeners are in the capture phase, so a
 * handler that stops propagation cannot make a busy game look idle.
 */
function trackActivityForIdle(): void {
  const note = (): void => {
    lastInputAtMs = performance.now();
    if (idleRenderTimer === null) return;
    // Resume at display rate now rather than on the next idle tick: waiting the
    // tenth of a second would put a visible delay on the first drag or keypress.
    window.clearTimeout(idleRenderTimer);
    idleRenderTimer = null;
    animate();
  };
  for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const) {
    window.addEventListener(type, note, { capture: true, passive: true });
  }
}

trackActivityForIdle();

// The explicit handles every extracted subsystem is given, instead of reaching
// into this module's 250-odd bindings. Getters for anything that is replaced
// during a session (the controls are rebuilt when the surface normal moves).
const appContext = createAppContext({
  camera,
  scene,
  canvas: renderer.domElement,
  controls: () => controls,
  plantNodes,
  socket: () => ws,
});

// Dev-only handle for on-screen verification (`?dev=1`). The game is normally
// driven by mouse and keys; placing the camera exactly over, beside and under a
// cavity is impossible to do repeatably that way, and reading the water table
// needs the same numbers the HUD uses rather than a screenshot guess.
if (isDevMode) {
  (
    window as unknown as {
      __pl: {
        camera: THREE.PerspectiveCamera;
        controls: OrbitControls;
        /** The scene, for inspecting a named mesh (the cavity bowl, the soil). */
        scene: THREE.Scene;
        setCamera: (px: number, py: number, pz: number, tx: number, ty: number, tz: number) => void;
        rootSight: (on: boolean) => void;
        /** Why Root Sight is open or shut: counts plus a one-line summary. */
        rootSightStatus: () => {
          enabled: boolean;
          progress: number;
          roots: number;
          rootsInSoil: number;
          usedTypeFallback: boolean;
          bubbles: number;
          apertureM: number;
          reason: string;
          summary: string;
        };
        weather: (state: string) => void;
        stats: () => Record<string, number | boolean | null>;
        rain: () => Record<string, number | boolean> | null;
        /** What the weather has left on the ground in the world, 0..1 each. */
        groundCover: () => { water: number; snow: number } | null;
        nodes: () => Array<{ id: string; type: string; x: number; y: number; z: number }>;
        /** The ground height the camera clamps use, at a plan position. */
        groundY: (x: number, z: number) => number;
        /**
         * The camera's live pose and orbit limits, with the ground under the eye
         * and under the target. Pitch is only meaningful next to those two
         * numbers: "the eye cannot go below the target" is geometry when the
         * ground under the eye is already above the target.
         */
        cameraProbe: () => Record<string, number>;
        /** Extra pitch the camera is spending looking up off the ground. */
        lookUpPitch: number;
        /** Where that pitch is heading: it eases toward this like the orbit does. */
        lookUpPitchTarget: number;
        /** What this session has done, and how the last one ended. */
        journal: () => Array<{ at: number; kind: string; detail?: Record<string, unknown> }>;
        /** The one frame readout: pacing and how much of a frame is our own work. */
        frameStats: () => import('./util/frameBudget.js').FrameStats;
        /** The three.js renderer, for `info.render` when a frame is expensive. */
        renderer: import('three').WebGLRenderer;
        /**
         * Draw one frame on demand. A hidden tab is throttled to about one frame a
         * second, so this is how a frame's real cost is measured: call it in a loop
         * and time the calls instead of waiting for vsync that never comes.
         */
        renderFrame: (deltaTime: number) => void;
      };
    }
  ).__pl = {
    camera,
    // A getter, not a snapshot: `controls` is rebuilt when the surface normal
    // moves (`rebuildControls`), and the old handle kept pointing at the
    // instance the render loop had abandoned - a dev check could then read a
    // camera pose that no longer existed.
    get controls() {
      return controls;
    },
    get lookUpPitch() {
      return lookUpPitchRad;
    },
    get lookUpPitchTarget() {
      return lookUpPitchTargetRad;
    },
    journal: () => loadJournal(sessionJournalStorage).entries,
    frameStats: () => frameStatsOf(frameBudget, lastGpuMs),
    renderFrame: (deltaTime) => renderFrame(deltaTime),
    renderer,
    scene,
    setCamera: (px, py, pz, tx, ty, tz) => {
      cameraFocusTween = null;
      camera.position.set(px, py, pz);
      controls.target.set(tx, ty, tz);
      controls.update();
    },
    rootSight: (on) => setRootSightEnabled(on),
    // Why Root Sight is open or shut, for anyone (or any script) looking in.
    rootSightStatus: () => ({ ...rootSightDiagnostic, summary: describeRootSightStatus() }),
    weather: (state) => environmentRenderer?.setWeatherState(state),
    rain: () => environmentRenderer?.getRainDebug() ?? null,
    groundCover: () => environmentRenderer?.groundCover() ?? null,
    stats: () => ({
      serverTick,
      resourceUpdates: resourceUpdateCount,
      lastResourceUpdateAgeMs:
        lastResourceUpdateAt === 0 ? -1 : Math.round(performance.now() - lastResourceUpdateAt),
      groundwaterFraction: localGroundwaterFraction,
      tileLight,
      tileWater,
      tileMinerals,
      cameraX: camera.position.x,
      cameraY: camera.position.y,
      cameraZ: camera.position.z,
      rootSight: rootSightMachine ? rootSightStateMachineIsEnabled(rootSightMachine) : false,
      plantNodes: plantNodes.size,
      apertureRadius: soilCutawayUniforms.uRootSightApertureRadius.value,
      cutawayRadius: soilCutawayUniforms.uRootSightRadius.value,
    }),
    nodes: () =>
      [...plantNodes.values()].map((node) => ({
        id: node.id,
        type: String(node.nodeType ?? node.type),
        x: node.position.x,
        y: node.position.y,
        z: node.position.z,
      })),
    groundY: (x, z) => planetTerrainY(renderConfig?.planetRadiusM ?? 0, x, z, getTerrainParams()),
    cameraProbe: () => {
      const radius = renderConfig?.planetRadiusM ?? 0;
      const field = getTerrainParams();
      const offset = camera.position.clone().sub(controls.target);
      const distance = offset.length();
      const rise = distance > 1e-6 ? offset.y / distance : 0;
      return {
        eyeX: camera.position.x,
        eyeY: camera.position.y,
        eyeZ: camera.position.z,
        targetX: controls.target.x,
        targetY: controls.target.y,
        targetZ: controls.target.z,
        targetGroundY: planetTerrainY(radius, controls.target.x, controls.target.z, field),
        eyeGroundY: planetTerrainY(radius, camera.position.x, camera.position.z, field),
        pivotY: lastPivotY ?? Number.NaN,
        distance,
        elevationDeg: (Math.asin(Math.max(-1, Math.min(1, rise))) * 180) / Math.PI,
        maxPolarDeg: (controls.maxPolarAngle * 180) / Math.PI,
        minPolarDeg: (controls.minPolarAngle * 180) / Math.PI,
        minDistance: controls.minDistance,
      };
    },
  };
}

// Planet view pulls the camera out to orbit the whole body. The normal camera
// is a local observer standing at the pole: it is clamped to a few hundred
// metres and the sky fog hides anything at planet scale.
let planetViewActive = false;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const cameraUpTarget = new THREE.Vector3();
let planetViewSavedFog: THREE.Fog | null = null;
let planetViewSavedFar = camera.far;
let planetViewSavedNear = camera.near;

function setPlanetView(enabled: boolean): void {
  const radius = renderConfig?.planetRadiusM ?? 0;
  if (radius <= 0) return;
  planetViewActive = enabled;
  const distanceMultiplier = renderConfig?.planetViewDistanceMultiplier ?? 3;
  const farMultiplier = renderConfig?.planetViewFarMultiplier ?? 12;
  const minMultiplier = renderConfig?.planetViewMinDistanceMultiplier ?? 1.4;
  const nearMultiplier = renderConfig?.planetViewNearMultiplier ?? 0.01;

  if (enabled) {
    if (scene.fog instanceof THREE.Fog) planetViewSavedFog = scene.fog;
    scene.fog = null;
    planetViewSavedFar = camera.far;
    planetViewSavedNear = camera.near;
    // A 100 km body needs a near plane in the kilometres and a far plane past
    // the camera; both scale with the radius so any planet size works.
    camera.near = Math.max(planetViewSavedNear, radius * nearMultiplier);
    camera.far = Math.max(camera.far, radius * farMultiplier);
    camera.updateProjectionMatrix();
    controls.minDistance = radius * minMultiplier;
    controls.maxDistance = radius * (distanceMultiplier + 2);
    controls.maxPolarAngle = Math.PI * 0.98;
    controls.target.set(0, -radius, 0);
    // Frame the globe from slightly above its equator, at the configured
    // distance from the centre.
    camera.position
      .set(0, -radius, 0)
      .addScaledVector(new THREE.Vector3(0, 0.45, 1).normalize(), radius * distanceMultiplier);
    controls.update();
  } else {
    if (planetViewSavedFog) scene.fog = planetViewSavedFog;
    camera.far = planetViewSavedFar;
    camera.near = planetViewSavedNear;
    camera.updateProjectionMatrix();
    controls.minDistance = renderConfig?.cameraMinDistance ?? 0.5;
    controls.maxDistance = effectiveCameraMaxDistance();
    controls.maxPolarAngle = renderConfig?.cameraMaxPolarAngle ?? 1.52;
    controls.target.set(0, 0, 0);
    camera.position.set(0, 18, 26);
    controls.update();
  }
}

// Physics (Rapier) - client-side cosmetic simulation, server-authoritative state
let physicsReady = false;
let physicsConfig: PhysicsConfig | null = null;
let plantColliders: PlantColliderManager | null = null;
// The ground collider, kept so the spring arm can ignore it: the camera orbits a
// target that sits on that surface, so treating the ground as an obstruction
// only ever produced grazing hits that yanked the camera in and out.
const soilColliderRef: { current: unknown } = { current: null };
// Relief colliders are ground too: the camera is not pulled in by a hill it
// orbits over, for the same reason it is not pulled in by the sphere.
const terrainColliderRefs: unknown[] = [];

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

async function handleWelcome(payload: unknown): Promise<void> {
  // Already schema-validated before dispatch (INV-NET-08).
  const message = payload as WelcomePayload;
  // The session this socket connected with; connect() stored it before HELLO.
  const reconnectData = loadReconnectData();
  uiShell?.setToastsEnabled(true);
  console.log('[PlantLegacy] WELCOME received:', {
    playerId: message.playerId,
    plantId: message.plantId,
    tick: message.tick,
    hasRootNode: !!message.rootNode,
    nodeCount: message.nodes?.length ?? 0,
    totalBiomass: message.totalBiomass,
    totalEnergy: message.totalEnergy,
  });
  welcome = message;
  // A WELCOME on an open socket is how a live respawn arrives, and a reconnect
  // after a death lands here too: the card and the chip describe a plant that
  // no longer exists, so they go before the new one is adopted.
  exitDeathUi();
  lostReason = null;
  lostStats = null;

  playerId = welcome.playerId;
  plantId = welcome.plantId;
  plantReady = true;
  ownRootNodeId = welcome.rootNode?.id ?? null;
  if (welcome.rootNode) {
    lastOwnAnchor.set(
      welcome.rootNode.x,
      clientSurfaceY(welcome.rootNode.x, welcome.rootNode.z, welcome.rootNode.y),
      welcome.rootNode.z,
    );
    lastOwnAnchorValid = true;
  }
  clearOwnPlantMissing();
  serverTick = welcome.tick;
  // Pull the soil edits around the spawn so a restart shows the tunnels
  // that were dug before it.
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: MESSAGE_TYPE.TERRAIN_REGION_REQUEST,
        payload: {
          worldX: welcome.rootNode?.x ?? 0,
          worldZ: welcome.rootNode?.z ?? 0,
          radiusM: 60,
          revision: 0,
        },
      }),
    );
  }

  // Reload controls config now that the server is reachable.
  // initC01() fetches /config/controls before WebSocket connects;
  // if the server wasn't ready, bindings fell back to {}.
  try {
    const reloaded = await loadControlsConfig(httpOrigin);
    if (reloaded.bindings && Object.keys(reloaded.bindings).length > 0) {
      controlsConfig = reloaded;
      const next = currentBindings();
      inputBus?.setBindings(next);
      settingsPanel?.setBindings(next);
      syncActionBarKeys();
      console.debug('[PlantLegacy] Controls config reloaded from server', {
        actionCount: Object.keys(reloaded.bindings).length,
      });
    }
  } catch {
    // Keep existing bindings (may be empty from initC01 fallback).
  }
  // Persist the plant id with the server-issued reclaim secret. The id
  // alone is public (it is in broadcasts); the token is what proves this
  // client owns the plant. The access token is preserved here too - this
  // used to overwrite the stored session and silently demote a signed-in
  // client to anonymous on its next reconnect.
  saveReconnectData({
    accessToken: reconnectData?.accessToken,
    refreshToken: reconnectData?.refreshToken,
    displayName: reconnectData?.displayName,
    plantId: welcome.plantId,
    reconnectToken: welcome.reconnectToken,
  });
  entryFlowWorldReady(entryFlow);
  entryScreen.render(entryFlow);
  // The title parked the render loop; the world's first frame starts here.
  wakeRenderLoop();
  // Whatever the welcome framing did or skipped (no root node, a plant that
  // arrived only through the node list, a re-framed reconnect), the first own
  // node is the first moment the fit can actually measure the plant. Ask for it
  // here, not inside the framing branch: a session that took the other branch
  // kept the configured 6 m start or, worse, the neutral rig pose 18 m above the
  // target, which is a hillside with no plant in it.
  refitFramingOnFirstNodes = true;
  // Belt and braces: the node-triggered refit fires on the next state packet,
  // but a session whose packets arrive before the flag was set would skip it.
  // One delayed attempt covers that, and stands down if the player has grabbed
  // the camera or a refit already happened.
  window.setTimeout(() => {
    if (!refitFramingOnFirstNodes) return;
    refitFramingOnFirstNodes = false;
    if (cameraUserMoved) return;
    recenterCamera();
  }, 1200);
  plantStatusHud?.setVisible(true);
  actionBar?.setVisible(true);
  hotbar?.setVisible(true);
  sporeChip?.setVisible(true);
  sporeChip?.setBalance(sporeBalance);
  // Whatever the title left open belongs to the title. A panel opened from the menu
  // used to stay open across Play and be the first thing the player saw in the
  // world, which is how a Settings click that appeared to do nothing "worked" one
  // screen later.
  settingsPanel?.setOpen(false);
  closeShop();
  // The core verb, said once where it applies. A returning player does not get a
  // tutorial they already finished, and a new one is told the two facts that are
  // not discoverable by looking: the plant is clickable, and G arms the click.
  if (!localProfile.tutorialSeen) {
    localProfile = saveProfile(window.localStorage, { tutorialSeen: true });
    contextHint?.show({
      id: 'first-look',
      text: 'Drag to orbit. Scroll to zoom.',
      touchText: 'Drag to orbit. Pinch to zoom.',
      durationMs: 4200,
    });
    window.setTimeout(() => {
      contextHint?.show({
        id: 'first-grow',
        text: 'Press G, then click a part of your plant to see what it can grow.',
        touchText: 'Tap Grow, then tap a part of your plant to see what it can grow.',
        key: 'G',
        durationMs: 7200,
      });
    }, 4600);
  } else {
    contextHint?.show({
      id: 'first-look',
      text: 'Click your plant to see what it can grow. The bar below has the rest.',
      touchText: 'Tap your plant to see what it can grow. The bar below has the rest.',
    });
  }
  updateAccountChip();
  showAwayReport(welcome.away);
  if (welcome.previousPlantDied) {
    showLossReport(
      welcome.previousPlantDied.cause,
      welcome.previousPlantDied.secondsAgo,
      welcome.previousPlantDied.source,
    );
  }
  // A reconnect can hand us a different plant (new world, new seed). Any
  // node kept from the previous session would be drawn as if it belonged
  // to this plant, which is exactly how parts ended up floating far from
  // the seed. Start from nothing and let the server refill the mirror.
  plantNodes.clear();
  growingNodes.clear();
  otherGrowingNodes.clear();
  otherPlayerPlants.clear();
  pruneNodesNotFromPlant();
  // Initialize with full node set from server (ADR-021).
  // WELCOME now carries all nodes for the player's own plant.
  if (welcome.nodes && welcome.nodes.length > 0) {
    for (const node of welcome.nodes) {
      try {
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
        const health = clientNodeHealth(node);

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

        // Same footing rule as a growth event: the welcome snapshot is the first
        // time most players see their seed, and it must not be the one path that
        // draws it sunk into a hillside.
        const welcomePosition = surfacePosition(node.x, node.z, node.y);
        if (node.isSeed ?? node.type === 'seed') {
          welcomePosition.y = seedFootingY(node.x, node.z, node.y, radius);
        }
        const nodeData: PlantNodeData = {
          id: node.id,
          position: welcomePosition,
          type: nodeTypeNum,
          radius,
          parentId: node.parentId,
          age: node.age,
          health,
          mutationFlags: readServerMutationMask(node),
          biomass: node.biomass,
          isOwnPlant: true,
          isSeed: node.isSeed ?? node.type === 'seed',
          nodeType: node.type,
          spawnTime,
          growthProgress,
          ...clientAttach(node.parentAttachX, node.parentAttachY, node.parentAttachZ),
          attachFraction: node.attachFraction,
          ...clientTarget(node.targetX, node.targetY, node.targetZ),
        };
        plantNodes.set(node.id, nodeData);
      } catch (err) {
        console.warn('[PlantLegacy] Skipping malformed node in WELCOME:', {
          nodeId: node.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
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
    const fallbackRadius = nodeRadius(welcome.rootNode.biomass, 0, welcome.rootNode.y);
    const fallbackPosition = surfacePosition(
      welcome.rootNode.x,
      welcome.rootNode.z,
      welcome.rootNode.y,
    );
    if (welcome.rootNode.type === 'seed') {
      fallbackPosition.y = seedFootingY(
        welcome.rootNode.x,
        welcome.rootNode.z,
        welcome.rootNode.y,
        fallbackRadius,
      );
    }
    const fallbackRoot: PlantNodeData = {
      id: welcome.rootNode.id,
      position: fallbackPosition,
      type: 0, // root
      radius: nodeRadius(welcome.rootNode.biomass, 0, welcome.rootNode.y),
      parentId: null,
      age: 10,
      health: 0.9,
      mutationFlags: readServerMutationMask(welcome.rootNode),
      biomass: welcome.rootNode.biomass,
      isOwnPlant: true,
      isSeed: welcome.rootNode.type === 'seed',
      nodeType: welcome.rootNode.type,
      spawnTime: performance.now(),
    };
    plantNodes.set(welcome.rootNode.id, fallbackRoot);
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

  // Camera framing stays with the gated block at the end of this
  // handler: it runs only when the plant actually changed, so a
  // same-plant reconnect leaves the view where the player put it.
  // Focusing here unconditionally snapped the camera back on every
  // WELCOME, including reconnects.

  // Request the pouch immediately so the Inventory panel has data the
  // first time it opens.
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: MESSAGE_TYPE.INVENTORY_REQUEST, payload: {} }));
  }
  plantFirstSeenAtMs = performance.now();
  peakBiomass = welcome.totalBiomass;
  // The node set WELCOME carries is this plant's, not whatever the mirror still
  // held from the plant that just died.
  peakNodeCount = welcome.nodes?.length ?? 0;

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
}

function handleLedgerEntry(payload: unknown): void {
  const entry = payload as Partial<LedgerEntry>;
  const kind = entry.kind;
  if (kind !== 'purchase' && kind !== 'use' && kind !== 'award' && kind !== 'drop') return;
  if (typeof entry.label !== 'string' || entry.label.length === 0) return;
  sporeLedger = appendLedger(sporeLedger, {
    kind,
    label: entry.label,
    itemId: typeof entry.itemId === 'string' ? entry.itemId : null,
    count: typeof entry.count === 'number' ? entry.count : 0,
    amount: typeof entry.amount === 'number' ? entry.amount : 0,
    balance: typeof entry.balance === 'number' ? entry.balance : 0,
  });
  refreshPlayerPanels();
}

function handleInventorySync(payload: unknown): void {
  const sync = payload as {
    slots?: Array<{ itemId?: string | null; count?: number | null } | null>;
    maxSlots?: number;
    definitions?: ItemDefinitionView[];
    sporeBalance?: number;
  };
  if (typeof sync.sporeBalance === 'number' && Number.isFinite(sync.sporeBalance)) {
    sporeBalance = Math.max(0, Math.round(sync.sporeBalance));
    sporeChip?.setBalance(sporeBalance);
    shopPanel?.setBalance(sporeBalance);
  }
  const maxSlots = Math.max(0, Math.floor(sync.maxSlots ?? 10));
  inventorySlots = Array.from({ length: maxSlots }, (_, index) => {
    const slot = sync.slots?.[index];
    if (!slot?.itemId || !slot.count || slot.count <= 0) return null;
    return { itemId: slot.itemId, count: Math.floor(slot.count) };
  });
  inventoryMaxSlots = maxSlots;
  // Names, descriptions and the exact use come from the server with the
  // slots; the panel shows these instead of inventing a name from the id
  // and showing no description at all.
  if (Array.isArray(sync.definitions)) {
    inventoryDefinitions = sync.definitions;
    playerPanels?.setDefinitions(sync.definitions);
    hotbar?.setDefinitions(sync.definitions);
  }
  playerPanels?.setInventory(inventorySlots, inventoryMaxSlots);
  hotbar?.setSlots(inventorySlots, inventoryMaxSlots);
  refreshPlayerPanels();
}

function handleInventorySlotUpdate(payload: unknown): void {
  const update = payload as {
    slotIndex?: number;
    itemId?: string | null;
    count?: number | null;
  };
  const index = update.slotIndex;
  if (typeof index !== 'number' || index < 0 || index >= inventoryMaxSlots) return;
  inventorySlots[index] =
    update.itemId && typeof update.count === 'number' && update.count > 0
      ? { itemId: update.itemId, count: Math.floor(update.count) }
      : null;
  playerPanels?.setInventory(inventorySlots, inventoryMaxSlots);
  hotbar?.setSlots(inventorySlots, inventoryMaxSlots);
  if (inventoryDefinitions.length > 0) hotbar?.setDefinitions(inventoryDefinitions);
  refreshPlayerPanels();
}

function handleState(payload: unknown, ctx: MessageContext): void {
  const state = payload as StatePayload | KeyframePayload;
  // Guard against stale/out-of-order STATE jumping serverTick backward
  if (serverTick !== 0 && state.tick < serverTick - 1000) {
    console.debug('[PlantLegacy] Ignoring stale STATE/KEYFRAME tick', {
      stateTick: state.tick,
      serverTick,
    });
    return;
  }
  serverTick = state.tick;
  // STATE/KEYFRAME is authoritative for the owner's totals. RESOURCE_UPDATE
  // is throttled to changes, so after a dormant resume the HUD could keep
  // showing its placeholder 0 biomass while the plant was still alive.
  const ownState = state.plants?.find((plant) => plant.id === plantId);
  if (ownState) {
    clearOwnPlantMissing();
    if (Number.isFinite(ownState.totalBiomass)) noteBiomassSample(ownState.totalBiomass);
    const stateEnergy = (ownState as { totalEnergy?: number }).totalEnergy;
    if (stateEnergy !== undefined && Number.isFinite(stateEnergy)) plantEnergy = stateEnergy;
    if (ownState.structure) plantStructure = ownState.structure;
    plantStatusHud?.setVisible(true);
    updateResourceReadout(
      tileLight,
      tileWater,
      tileMinerals,
      plantBiomass,
      plantEnergy,
      plantWater,
      plantMinerals,
      plantWaterCapacity,
      plantMineralCapacity,
    );
    updatePlantStatusHud();
  } else {
    markOwnPlantMissing();
  }
  if (DEBUG_WS_LOG)
    console.debug('[PlantLegacy] STATE/KEYFRAME received:', {
      type: ctx.type,
      tick: state.tick,
      plantCount: state.plants?.length ?? 0,
    });
  if (debugOverlay) {
    debugOverlay.recordBytes(0, ctx.byteLength);
  }
  // The server sends STATE at its full 20 Hz tick rate. Show the exact
  // tick from every packet instead of only redrawing every fourth one:
  // the old gate made the readout jump 4, 8, then 12 ticks at a time
  // even though no server ticks were missed. The readout uses tabular
  // numerals, so the extra updates do not reflow the panel.
  updateTickDetail(
    `Server tick: ${serverTick}\n` +
      `Biomass: ${plantBiomass.toFixed(1)} | Energy: ${plantEnergy.toFixed(1)}\n` +
      `Water: ${plantWater.toFixed(1)}/${plantWaterCapacity.toFixed(0)} | ` +
      `Minerals: ${plantMinerals.toFixed(1)}/${plantMineralCapacity.toFixed(0)}\n` +
      `Mode: ${growModeHud ? 'grow' : 'view'} | Plants: ${state.plants?.length ?? 0}\n` +
      `Own plant: ${plantIdLabel()}`,
  );
}

function handleResourceUpdate(payload: unknown, ctx: MessageContext): void {
  resourceUpdateCount += 1;
  lastResourceUpdateAt = performance.now();
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
    waterCapacity?: number;
    mineralCapacity?: number;
    /** Tiles any part of the plant occupies, root or canopy. */
    coveredTileCount?: number;
    tileAvgLight?: number;
    tileAvgMoisture?: number;
    tileAvgMinerals?: number;
    /** Share of the local soil cavity filled with water, 0..1. */
    groundwaterFraction?: number;
    /** Coarse water-table height field from the server. */
    waterTable?: {
      originX: number;
      originZ: number;
      cellSizeM: number;
      cells: number;
      heightsBase64: string;
    };
    /** One covered tile, for the dev panel readout. */
    coverageTileX?: number;
    coverageTileZ?: number;
    fullGrid?: boolean;
    delta?: boolean;
    gridBase64?: string;
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
    debugOverlay.recordBytes(0, ctx.byteLength);
  }
  if (DEBUG_WS_LOG)
    console.debug('[PlantLegacy] RESOURCE_UPDATE received:', {
      tick: update.tick,
      tileCount: update.tiles?.length ?? 0,
      totalEnergy: update.totalEnergy,
      totalBiomass: update.totalBiomass,
    });
  // Compact whole-grid updates carry no tile objects, only `gridBase64`.
  const tile = update.tiles?.[0];
  // The per-player update carries precomputed averages over every tile
  // any part of the plant occupies; `tiles` is only present from older
  // servers or the single-tile RESOURCE_QUERY reply.
  const hasTileAverages =
    update.tileAvgLight !== undefined &&
    update.tileAvgMoisture !== undefined &&
    update.tileAvgMinerals !== undefined;
  if (tile || hasTileAverages) {
    if (DEBUG_WS_LOG && tile)
      console.debug('[PlantLegacy] Processing tile:', {
        light: tile.light,
        moisture: tile.moisture,
        minerals: tile.minerals,
        tileX: tile.tileX,
        tileZ: tile.tileZ,
        storedWater: update.storedWater,
        storedMinerals: update.storedMinerals,
        coveredTileCount: update.coveredTileCount,
      });
    if (update.totalEnergy !== undefined) plantEnergy = update.totalEnergy;
    if (update.totalBiomass !== undefined) noteBiomassSample(update.totalBiomass);
    if (update.storedWater !== undefined) plantWater = update.storedWater;
    if (update.storedMinerals !== undefined) plantMinerals = update.storedMinerals;
    if (update.waterCapacity !== undefined) plantWaterCapacity = update.waterCapacity;
    if (update.mineralCapacity !== undefined) plantMineralCapacity = update.mineralCapacity;

    // Delta broadcasts contain arbitrary dirty tiles and full-grid
    // responses contain the whole world; neither represents the light
    // reaching this plant. Only the per-player root-tile update does.
    const isLocalTileUpdate = update.delta !== true && update.fullGrid !== true;
    if (isLocalTileUpdate) {
      if (hasTileAverages) {
        tileLight = update.tileAvgLight ?? 0;
        tileWater = update.tileAvgMoisture ?? 0;
        tileMinerals = update.tileAvgMinerals ?? 0;
      } else if (update.tiles && update.tiles.length > 0) {
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
    }

    // Use plant's stored resources for growth panel
    storedWater = update.storedWater ?? 0;
    storedMinerals = update.storedMinerals ?? 0;
    // Refresh on every update that carries plant totals: a seed with no
    // root tiles receives no local-tile packet, and gating on that left
    // the whole readout stuck at its placeholder zeros.
    updateResourceReadout(
      tileLight,
      tileWater,
      tileMinerals,
      plantBiomass,
      plantEnergy,
      plantWater,
      plantMinerals,
      plantWaterCapacity,
      plantMineralCapacity,
    );
    updatePlantStatusHud();
    if (isLocalTileUpdate) {
      // Sky grade follows the light reaching the local tiles.
      environmentRenderer?.setLocalTileLight(tileLight);
      // The cavity's water table follows the same soil the roots are in.
      if (typeof update.groundwaterFraction === 'number') {
        localGroundwaterFraction = update.groundwaterFraction;
        environmentRenderer?.setGroundwaterLevel(update.groundwaterFraction);
      }
      if (update.waterTable) {
        const raw = atob(update.waterTable.heightsBase64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
        environmentRenderer?.setWaterTable({
          originX: update.waterTable.originX,
          originZ: update.waterTable.originZ,
          cellSizeM: update.waterTable.cellSizeM,
          cells: update.waterTable.cells,
          heights: new Float32Array(bytes.buffer),
        });
      }
      // Update dev panel tile info
      if (devPanel?.updateTileInfo) {
        devPanel.updateTileInfo(
          update.coverageTileX ?? tile?.tileX ?? 0,
          update.coverageTileZ ?? tile?.tileZ ?? 0,
          {
            light: tileLight,
            moisture: tileWater,
            minerals: tileMinerals,
            storedWater,
            storedMinerals,
            coveredTileCount: update.coveredTileCount ?? 1,
          },
        );
      }
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
        // Info display removed - growth panel is minimal now
      }
    }
  }

  // Ground grid updates are handled for every variant, including the
  // compact ones that carry no tile objects at all (`tiles` absent).
  if (update.width && update.height) {
    if (update.fullGrid) {
      resourceGridReceivedAt = performance.now();
      if (update.gridBase64) {
        pendingResourceGrid = {
          gridBase64: update.gridBase64,
          width: update.width,
          height: update.height,
          tileSize: update.tileSize,
        };
      } else if (update.tiles) {
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
    } else if (update.gridBase64) {
      // One decode + one texture upload instead of 65 000 tile objects.
      environmentRenderer?.updateResourceGridQuantized(
        update.gridBase64,
        update.width,
        update.height,
        update.tileSize,
      );
    } else if (update.delta && update.tiles) {
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
  }
}

function handleTerrainRegion(payload: unknown): void {
  // The height/moisture payload is the authoritative soil snapshot. The
  // renderer derives its base surface from the same shared field, so
  // only the revision is needed here until the chunk texture path lands.
  const region = payload as { revision?: number };
  terrainRevision = Math.max(terrainRevision, Number(region.revision ?? 0));
}

function handleTerrainEdits(payload: unknown): void {
  const update = payload as {
    revision?: number;
    edits?: Array<{
      id?: number;
      x?: number;
      y?: number;
      z?: number;
      radiusM?: number;
      kind?: string;
    }>;
  };
  for (const edit of update.edits ?? []) {
    if (typeof edit.x !== 'number' || typeof edit.y !== 'number' || typeof edit.z !== 'number') {
      continue;
    }
    terrainEdits.push({
      x: edit.x,
      y: edit.y,
      z: edit.z,
      radiusM: Math.max(0.1, Number(edit.radiusM ?? 0.2)),
    });
  }
  // Tunnels are small and bounded; keep the newest few hundred so a
  // long session cannot grow the cavity input without limit.
  if (terrainEdits.length > 256) terrainEdits = terrainEdits.slice(-256);
  terrainRevision = Math.max(terrainRevision, Number(update.revision ?? 0));
}

function handleSeasonUpdate(payload: unknown): void {
  const season = payload as {
    season: number;
    remainingSeconds: number;
    calamity?: boolean;
  };
  seasonNumber = season.season;
  seasonEndsAtMs = performance.now() + Math.max(0, season.remainingSeconds) * 1000;
  updateSeasonChip();
  if (season.calamity) notify(`Season ${season.season} begins.`, 'state', 4000);
}

function handleMutationState(payload: unknown): void {
  const state = payload as Parameters<MutationPanelAPI['update']>[0] & {
    appearance?: { petalCount: number; leafScale: number; seedScale: number };
  };
  mutationState = state;
  mutationPanel?.update(state);
  plantMutationCount = state.mutations?.length ?? 0;
  plantMutationEnergyUpkeep = state.mutations.reduce(
    (sum, mutation) => sum + (mutation.energyPerSecond ?? 0),
    0,
  );
  plantMutationBiomassUpkeep = state.mutations.reduce(
    (sum, mutation) => sum + (mutation.biomassPerSecond ?? 0),
    0,
  );
  plantMutationUpkeep = state.totalUpkeepEnergyPerSecond ?? plantMutationEnergyUpkeep;
  updatePlantStatusHud();
  if (state.appearance) {
    plantRenderer?.setMutationAppearance(state.appearance);
    if (plantId) webgpuRenderer?.setPlantAppearance(plantId, state.appearance);
  }
  // Mutations are plant-wide and the server stamps every node, so a
  // state change repaints without waiting for the next PLANT_SYNC. The
  // state carries the mutation list, not a `signature` field: derive the
  // strongest index the way the node reader does, or every node keeps
  // flag 0 and the plant draws unmutated.
  const look = lookFromMutations(state.mutations ?? []);
  if (plantId) {
    plantRenderer?.setPlantLook(plantId, look);
    webgpuRenderer?.setPlantLook(plantId, look);
  }
  for (const node of plantNodes.values()) node.mutationFlags = look.signature;
  if (plantNodes.size > 0) plantRenderer?.updatePlantData([...plantNodes.values()]);
}

function handlePlantUproot(payload: unknown): void {
  const uproot = payload as {
    plantId: string;
    phase: 'rooted' | 'uprooted' | 'tumbling' | 'rerooting';
    cause?: string;
    windowRemainingS?: number;
    x?: number;
    y?: number;
    z?: number;
    nodes?: Array<{
      id: string;
      x: number;
      y: number;
      z: number;
      parentAttachX?: number;
      parentAttachY?: number;
      parentAttachZ?: number;
    }>;
  };
  if (!uproot?.plantId) return;
  const targetNodes =
    uproot.plantId === plantId ? plantNodes : otherPlayerPlants.get(uproot.plantId);
  const byId = new Map((uproot.nodes ?? []).map((node) => [node.id, node]));
  if (targetNodes && uproot.nodes) {
    // A crawl moves the whole body rigidly, and its joints are part of
    // that body: the server rewrites `parentAttachX/Y/Z` in the same pose
    // as the positions. Both are therefore interpolated together - the
    // pose is eased to the packet over one tick, and the attachment is
    // re-derived each frame as a fixed offset from the parent's drawn
    // position. Snapping the attachment while the positions eased is what
    // opened a gap at every joint once per tick.
    const targetOf = new Map<string, { x: number; y: number; z: number }>();
    for (const [nodeId] of targetNodes) {
      const moved = byId.get(nodeId);
      if (!moved) continue;
      targetOf.set(nodeId, surfacePosition(moved.x, moved.z, moved.y));
    }
    for (const [nodeId, data] of targetNodes) {
      const moved = byId.get(nodeId);
      const target = targetOf.get(nodeId);
      if (!moved || !target) continue;
      const attach = clientAttach(moved.parentAttachX, moved.parentAttachY, moved.parentAttachZ);
      if (attach.parentAttachX !== undefined) {
        const parentTarget = data.parentId ? targetOf.get(data.parentId) : undefined;
        // A joint is an offset on the rigid body, so it is measured
        // against the parent's authoritative pose, then hung off the
        // parent's *drawn* pose.
        const origin = parentTarget ?? target;
        data.parentAttachOffsetX = attach.parentAttachX - origin.x;
        data.parentAttachOffsetY = attach.parentAttachY - origin.y;
        data.parentAttachOffsetZ = attach.parentAttachZ - origin.z;
        const parentNow = data.parentId ? targetNodes.get(data.parentId)?.position : undefined;
        const drawnParent = parentNow ?? origin;
        data.parentAttachX = drawnParent.x + data.parentAttachOffsetX;
        data.parentAttachY = drawnParent.y + data.parentAttachOffsetY;
        data.parentAttachZ = drawnParent.z + data.parentAttachOffsetZ;
      }
      if (uproot.phase === 'rooted') {
        // The final message of a move is the authoritative pose. It used
        // to be handed to the interpolator and then forgotten in the same
        // handler, so the body (and every camera anchor that reads it)
        // stayed at the previous packet's position - the spot the plant
        // had already crawled away from. Land on it exactly, then drop
        // the segment so nothing can drag the body back.
        data.position.copy(target);
        nodeInterpolator.forget(nodeId);
        interpolatedNodes.delete(nodeId);
      } else {
        // P0/2-B: the body is streamed every tick. Draw the move over one
        // tick instead of snapping to it, so tumbling reads as motion.
        nodeInterpolator.capture(
          nodeId,
          target.x,
          target.y,
          target.z,
          performance.now(),
          interpolationDurationMs(20),
        );
        interpolatedNodes.set(nodeId, data);
      }
    }
    const others: PlantNodeData[] = [];
    for (const nodes of otherPlayerPlants.values()) others.push(...nodes.values());
    plantRenderer?.updatePlantData([...plantNodes.values(), ...others]);
    webgpuRenderer?.updatePlants([...plantNodes.values(), ...others], performance.now());
  }
  if (uproot.plantId === plantId) {
    // The crown is the body anchor for Space and Root Sight, and the
    // server repeats its position on every transform (x/y/z, in the
    // same surface frame as the node list).
    const anchorX = uproot.x;
    const anchorY = uproot.y;
    const anchorZ = uproot.z;
    if (typeof anchorX === 'number' && typeof anchorY === 'number' && typeof anchorZ === 'number') {
      lastOwnAnchor.copy(surfacePosition(anchorX, anchorZ, anchorY));
      lastOwnAnchorValid = true;
    }
    plantPhase = uproot.phase;
    if (uproot.phase === 'rooted') {
      uprootWindowEndsAtMs = 0;
      requestPlantResync();
      rerootKeys.clear();
      cameraPanState.forward = false;
      cameraPanState.backward = false;
      cameraPanState.left = false;
      cameraPanState.right = false;
    } else if (uproot.windowRemainingS !== undefined) {
      uprootWindowEndsAtMs = performance.now() + Math.max(0, uproot.windowRemainingS) * 1000;
    }
    plantStatusHud?.setVisible(true);
    updatePlantStatusHud();
  }
  if (uproot.phase === 'rooted') {
    uprootNotified.delete(uproot.plantId);
    if (uproot.plantId === plantId) {
      uiShell?.toast({ message: 'Rooted again.', kind: 'info', durationMs: 3000 });
    }
  } else if (uproot.phase === 'uprooted' && !uprootNotified.has(uproot.plantId)) {
    uprootNotified.add(uproot.plantId);
    uiShell?.toast({
      message: `Plant uprooted (${uproot.cause ?? 'damage'}).`,
      kind: 'error',
      durationMs: 5000,
    });
  }
}

function handlePlantDamage(payload: unknown): void {
  const damage = payload as {
    plantId: string;
    source?: string;
    amount?: number;
    totalBiomass?: number;
    damageHp?: number;
    structuralThreshold?: number;
  };
  if (damage.plantId !== plantId) return;
  if (typeof damage.damageHp === 'number' && typeof damage.structuralThreshold === 'number') {
    plantStructure = {
      damageHp: damage.damageHp,
      threshold: damage.structuralThreshold,
    };
  }
  if (typeof damage.totalBiomass === 'number') noteBiomassSample(damage.totalBiomass);
  plantStatusHud?.pulseDamage();
  updatePlantStatusHud();
  const amount = typeof damage.amount === 'number' ? damage.amount : 0;
  if (amount > 0 && Date.now() - lastDamageToastAtMs > 2500) {
    lastDamageToastAtMs = Date.now();
    const sourceLabels: Record<string, string> = {
      weather: 'weather',
      tool: 'a tool',
      herbivore: 'herbivores',
      terrain: 'terrain',
    };
    uiShell?.toast({
      message: `Took ${amount.toFixed(1)} biomass damage (${sourceLabels[damage.source ?? ''] ?? 'damage'}).`,
      kind: 'error',
      durationMs: 2500,
    });
  }
}

function handleDropSpawn(payload: unknown): void {
  const drop = payload as {
    id?: string;
    kind?: 'fragment' | 'remains' | 'dung';
    x?: number;
    y?: number;
    z?: number;
    expiresAtMs?: number;
  };
  if (!drop?.id || typeof drop.x !== 'number' || typeof drop.z !== 'number') return;
  worldDrops.spawn({
    id: drop.id,
    kind: drop.kind ?? 'fragment',
    x: drop.x,
    y: typeof drop.y === 'number' ? drop.y : 0,
    z: drop.z,
    expiresAtMs: drop.expiresAtMs,
  });
}

function handleKillCredit(payload: unknown): void {
  // The wire has always carried this; nobody read it. A kill that pays spores is
  // worth one line of text, or the reward looks like a bug in the purse.
  const credit = (payload as { credit?: { kind?: string; playerId?: string | null } } | null)
    ?.credit;
  if (credit?.kind !== 'player' || !credit.playerId) return;
  if (credit.playerId !== playerId) return;
  notify('Kill credited: spores added', 'info', 2600);
}

function handleDropExpired(payload: unknown): void {
  const id = (payload as { id?: string } | null)?.id;
  if (id) worldDrops.remove(id);
}

/** Ask the server to give us a drop. The reward and the removal are its call. */
function collectDrop(id: string): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: MESSAGE_TYPE.DROP_COLLECT, payload: { id } }));
}

function handleFaunaEvent(payload: unknown): void {
  const fauna = payload as { phase?: string };
  if (fauna?.phase === 'start') {
    uiShell?.toast({
      message: 'A swarm is browsing nearby.',
      kind: 'state',
      durationMs: 4000,
    });
  }
}

function handleWeatherUpdate(payload: unknown, ctx: MessageContext): void {
  const weather = payload as {
    dayNumber?: number;
    timeOfDay: number;
    isDay: boolean;
    sunIntensity: number;
    lightMultiplier?: number;
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

  // C03: EnvironmentRenderer dynamically drives sky dome, sun/moon arcs, lights, fog, and rain.
  // There is deliberately no fallback that writes the lights: `applyCelestialLighting` is
  // their only owner. Before the renderer exists nothing is drawn yet, and the old
  // fallback re-applied 1.4/0.7 to an already weather-multiplied `sunIntensity`, so the
  // handover from it to the renderer was a visible brightness step.
  environmentRenderer?.handleWeatherUpdate(weather);
  weatherDayNumber = weather.dayNumber ?? weatherDayNumber;
  weatherTimeOfDay = weather.timeOfDay;
  weatherClock = formatClock(weather.timeOfDay);
  // Weather is displayed in one place: the vitals chip.
  vitalsWeather = {
    state: weather.weatherState,
    label: weatherLabel(weather.weatherState),
    nextLabel: weatherLabel(weather.forecast.nextWeatherState),
    nextState: weather.forecast.nextWeatherState,
    // The packet is a snapshot: keep its arrival time so the chip can count down
    // between broadcasts instead of freezing until the next one.
    secondsUntilNext: weather.forecast.timeUntilNextStateS,
    atMs: performance.now(),
  };
  updateVitalsWeather();
  refreshPlayerPanels();

  if (debugOverlay) {
    debugOverlay.recordBytes(0, ctx.byteLength);
  }
}

/**
 * A bolt the server rolled. The strike carries its landing point and the radius
 * it hurt, so the bolt is drawn where it fell rather than as a sky flash; the
 * client no longer times its own lightning.
 */
function handleWeatherStrike(payload: unknown): void {
  const strike = payload as { x?: number; z?: number; radiusM?: number };
  if (typeof strike?.x !== 'number' || typeof strike?.z !== 'number') return;
  environmentRenderer?.flashLightning(strike.x, strike.z, strike.radiusM);
}

function handleGrowthEvent(payload: unknown): void {
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
      // Never derived by hand here: the rule that keeps a packet from un-growing
      // the whole plant lives in one place (render/plantProgress.ts).
      growthProgress = resolveDrawnProgress({
        serverProgress: node.growthProgress,
        serverTick,
        growthStartTick: node.growthStartTick,
        growthTimeSeconds: node.growthTimeSeconds,
        previousProgress: existing?.growthProgress,
        tickRateHz: SERVER_TICK_RATE_HZ,
      });
      const totalMs = node.growthTimeSeconds * 1000;

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

    // A seed is drawn as an ovoid standing on the soil: its stored height is the
    // contact point and the renderers lift the body by its half-height. On a
    // slope the uphill side of that footprint stands above the contact point, so
    // the seed sank into the hill - and a half-buried seed let the eye sit inside
    // the ground beside it. Stand the seed on the highest ground under its own
    // radius instead, so an uphill contact can never swallow the downhill rim.
    const seedNode = node.isSeed ?? node.type === 'seed';
    const nodePosition = surfacePosition(node.x, node.z, node.y);
    if (seedNode) {
      nodePosition.y = seedFootingY(node.x, node.z, node.y, node.radius ?? 0.05);
    }

    return {
      id: node.id,
      position: nodePosition,
      type: nodeTypeNum,
      // Use server-authoritative radius (Murray's law) if available
      radius: node.radius ?? nodeRadius(node.biomass, nodeTypeNum, node.y),
      parentId: node.parentId,
      children: node.children ?? existing?.children ?? [],
      age: node.age,
      health: clientNodeHealth(node),
      mutationFlags: readServerMutationMask(node),
      biomass: node.biomass,
      isOwnPlant,
      isSeed: node.isSeed ?? node.type === 'seed',
      nodeType: node.type,
      layer: node.layer === 'canopy' ? 'canopy' : node.layer === 'root' ? 'root' : undefined,
      spawnTime,
      growthProgress,
      // Server-authoritative attachment and target, mapped into draw space.
      ...clientAttach(node.parentAttachX, node.parentAttachY, node.parentAttachZ),
      attachFraction: node.attachFraction,
      ...clientTarget(node.targetX, node.targetY, node.targetZ),
    };
  };

  if (growth.plantId === plantId) {
    // Local player's plant - apply every new node, then replace the
    // seed with the root when germination reports an updated parent.
    const now = performance.now();
    for (const node of incomingNodes) {
      const nodeData = toNodeData(node, true);
      plantNodes.set(node.id, nodeData);
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
    // Gap detection has to run BEFORE the mirror adopts the new
    // sequence number: assigning first set the two equal, so a skipped
    // event (e.g. both cotyledons while the client was busy) could
    // never be seen and the client kept a plant with fewer parts than
    // the server had. Any jump of more than one means events went
    // missing, and one resync fills the mirror back in.
    const serverGrowthSeq = growth.growthSeq ?? 0;
    if (plantGrowthSeq > 0 && serverGrowthSeq > plantGrowthSeq + 1) {
      requestPlantResync();
    }
    plantGrowthSeq = Math.max(plantGrowthSeq, serverGrowthSeq);
    pruneNodesNotFromPlant();
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
    for (const grown of incomingNodes) {
      noteUndergroundGrowth(grown.type, grown.layer);
    }
    // Growing while the ground is open must not close it. The cavity is rebuilt
    // around the new part on the same tick, and that rebuild used to be able to
    // leave the mode half-closed: the state machine's target is re-asserted here
    // so the player keeps the view they were looking through. Only when it was
    // already open - this never opens the ground for a player who closed it.
    if (rootSightMachine && rootSightStateMachineIsEnabled(rootSightMachine)) {
      rootSightStateMachineSetTarget(rootSightMachine, 'underground');
    }
    if (lastNode) {
      setDetail(
        `Grew ${lastNode.type} #${plantNodes.size} at (${lastNode.x.toFixed(1)}, ${lastNode.y.toFixed(1)}, ${lastNode.z.toFixed(1)}) - Biomass: ${plantBiomass.toFixed(1)}, Energy: ${plantEnergy.toFixed(1)}`,
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
}

function handleGrowthOptionsResult(payload: unknown): void {
  clearGrowthOptionsTimeout();
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
  // Keep the answer for every node, not only the one the panel is showing: the
  // hover tip asked, and it re-describes the part the pointer is still resting on.
  if (response.nodeId && response.options) {
    growableCounts.set(
      response.nodeId,
      response.options.filter((option) => option.available).length,
    );
    if (hoveredNodeId === response.nodeId) refreshPlantHoverTip?.();
  }
  console.log('[PlantLegacy] GROWTH_OPTIONS_RESULT received:', response);
  if (!growthSelectionStateMachineIsVisible(growthSelectionMachine)) return;
  if (
    response.nodeId &&
    growthSelectionMachine.selectedNodeId &&
    response.nodeId !== growthSelectionMachine.selectedNodeId
  ) {
    return; // Stale response for a previous selection
  }
  if (response.error || !response.options) {
    const reason = response.error ? refusalCopy(response.error) : 'Could not load growth options.';
    hideGrowthSelection();
    setDetail(reason);
    uiShell?.toast({ message: reason, kind: 'error', durationMs: 5000 });
    return;
  }
  renderGrowthOptions({
    nodeId: response.nodeId ?? '',
    nodeType: response.nodeType ?? 'seed',
    isSeed: response.isSeed ?? true,
    energy: response.energy ?? 0,
    biomass: response.biomass ?? 0,
    options: response.options ?? [],
  });
}

/**
 * The two germination refusals quote the tile the seed was asked to sprout in.
 * Every other reason is in `ui/refusalCopy.ts`, including the growth ones.
 */
function germinationNotice(reason: string): string {
  const conditions = growthSelectionMachine.conditions;
  const numbers = conditions
    ? ` (tile moisture ${conditions.moisture.toFixed(1)} / needs ${conditions.minMoisture}, light ${conditions.light.toFixed(1)} / needs ${conditions.minLight})`
    : '';
  const died = reason === 'germination_failed_conditions' ? ' - the seed died' : '';
  return `Germination failed: light or moisture was below the threshold${numbers}${died}.`;
}

function handleReject(payload: unknown): void {
  const reject = payload as RejectPayload;
  const readableReason =
    reject.reason === 'germination_failed_conditions' ||
    reject.reason === 'germination_conditions_not_met'
      ? germinationNotice(reject.reason)
      : refusalCopy(reject.reason);
  console.warn('[PlantLegacy] REJECT received:', reject);
  notify(readableReason, 'error', 5000);
}

function handleError(payload: unknown): void {
  const error = payload as ErrorPayload;
  console.log('[PlantLegacy] ERROR received:', error);
  // The server's message is already a sentence; the code is an operator detail.
  // `report_received` arrives as ERROR on purpose (a confirmation), so it must
  // not be shown in the error colour.
  const message = error.message?.trim() || refusalCopy(error.code);
  notify(message, error.code === 'report_received' ? 'info' : 'error', 4000);
  if (error.code === 'SESSION_REPLACED') {
    // The same account opened somewhere else and the server kicked this
    // socket. Reconnecting would quietly come back as a guest.
    suppressReconnect = true;
    clearReconnectData();
    updateAccountChip();
    entryFlowConnectionFailed(entryFlow, 'Signed in on another device. Sign in again to continue.');
    entryScreen.render(entryFlow);
  }
  if (error.code === 'AUTH_FAILED') {
    // The socket is about to close with 4001; the stored session is dead.
    clearReconnectData();
    updateAccountChip();
    entryFlowConnectionFailed(entryFlow, 'Your session expired. Sign in again.');
    entryScreen.render(entryFlow);
  }
}

function handleDevResponse(payload: unknown): void {
  const response = payload as {
    action?: string;
    ok?: boolean;
    success?: boolean;
    error?: string;
    message?: string;
    [key: string]: unknown;
  };
  console.log('[PlantLegacy] DEV_RESPONSE received:', response);
  // The server answers `{ ok, error }`. Reading `success`/`message`
  // instead labelled every successful dev action a failure.
  const ok = response.ok ?? response.success ?? true;
  const failure = response.error ?? response.message;
  const msg = ok ? 'Dev command applied' : refusalCopy(String(failure ?? 'unknown'));
  notify(msg, ok ? 'state' : 'error', 3000);
}

function handlePlantSync(payload: unknown): void {
  const sync = payload as {
    plants: Array<{
      id: string;
      ownerId: string;
      /** The owner's display name, when the owner is connected. */
      ownerName?: string;
      appearance?: { petalCount: number; leafScale: number; seedScale: number };
      pigment?: {
        visualSignature: number;
        visualParams: [number, number, number];
        visualTarget: string;
      };
      /** Display names of the mutations this plant expresses. */
      mutations?: string[];
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
        attachFraction?: number;
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
    if (plant.appearance) {
      plantRenderer?.setPlantAppearance(plant.id, plant.appearance);
      webgpuRenderer?.setPlantAppearance(plant.id, plant.appearance);
    }
    // Rivals are drawn with their own pigment, not the neutral default.
    if (plant.pigment) {
      const rivalLook = lookFromMutations([plant.pigment]);
      plantRenderer?.setRivalLook(plant.id, rivalLook);
      webgpuRenderer?.setPlantLook(plant.id, rivalLook);
    }
  }
  for (const plant of sync.plants) {
    const isOwn =
      (plantId !== null && plant.id === plantId) ||
      (playerId !== null && plant.ownerId === playerId) ||
      (welcome?.plantId !== undefined && plant.id === welcome.plantId);
    // Tag rivals with what makes them different. The gallery is built
    // for exactly this: one mutation per plant, readable from the body
    // and named above the head.
    if (isOwn) {
      plantLabels?.remove(plant.id);
    } else {
      plantLabelLayer()?.setLabel(
        plant.id,
        rivalTagLabel(plant.ownerId, plant.ownerName, plant.mutations),
      );
      if (plant.ownerName?.trim()) plantOwnerNames.set(plant.id, plant.ownerName.trim());
    }
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
        attachFraction?: number;
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
      const health = clientNodeHealth(node);
      const existing = isOwn ? plantNodes.get(node.id) : undefined;

      // Server-authoritative growth timing
      let spawnTime: number;
      let growthProgress: number;

      if (node.growthTimeSeconds !== undefined && node.growthStartTick !== undefined) {
        growthProgress = resolveDrawnProgress({
          serverProgress: node.growthProgress,
          serverTick,
          growthStartTick: node.growthStartTick,
          growthTimeSeconds: node.growthTimeSeconds,
          previousProgress: existing?.growthProgress,
          tickRateHz: SERVER_TICK_RATE_HZ,
        });
        const totalMs = node.growthTimeSeconds * 1000;
        spawnTime = performance.now() - growthProgress * totalMs;
      } else {
        spawnTime = existing?.spawnTime ?? performance.now();
        growthProgress = node.growthProgress ?? 1.0;
      }

      target.set(node.id, {
        id: node.id,
        position: seedNodePosition(node, radius),
        type: nodeTypeNum,
        radius,
        parentId: node.parentId,
        age: node.age,
        health,
        mutationFlags: readServerMutationMask(node),
        biomass: node.biomass,
        isOwnPlant: isOwn,
        isSeed: node.isSeed ?? node.type === 'seed',
        nodeType: node.type,
        spawnTime,
        growthProgress,
        // Server-authoritative attachment and target, mapped into draw space.
        ...clientAttach(node.parentAttachX, node.parentAttachY, node.parentAttachZ),
        attachFraction: node.attachFraction,
        ...clientTarget(node.targetX, node.targetY, node.targetZ),
        growthTimeSeconds: node.growthTimeSeconds,
      });
    }
    if (isOwn) {
      plantNodes.clear();
      for (const [id, node] of target) {
        plantNodes.set(id, node);
      }
      ownRootNodeId = plant.rootNodeId ?? ownRootNodeId;
      const crown = ownRootNodeId ? target.get(ownRootNodeId) : undefined;
      if (crown) {
        lastOwnAnchor.copy(crown.position);
        lastOwnAnchorValid = true;
      }
      plantBiomass = plant.totalBiomass;
      plantEnergy = plant.totalEnergy;
      // Reset growth sequence on full sync (Phase 1.5)
      resetPlantMirror();
      // Track growing nodes from sync. A sync arriving mid-growth must not
      // restart a part's clock: the local animation has been running between
      // packets, so re-deriving the start from the server's quantised progress
      // made the part stop for a beat and then jump. Keep the clock already
      // running, and stamp one only for a part we were not animating yet.
      const priorGrowth = new Map(growingNodes);
      growingNodes.clear();
      const now = performance.now();
      for (const node of target.values()) {
        if ((node.growthProgress ?? 1.0) < 1.0) {
          // Use server-authoritative growthTimeSeconds for duration
          const durationMs = Math.max(1, (node.growthTimeSeconds ?? 5) * 1000);
          const progress = node.growthProgress ?? 0;
          const existingClock = priorGrowth.get(node.id);
          growingNodes.set(node.id, {
            startTime: existingClock?.startTime ?? now - progress * durationMs,
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
}

function handlePlantCreated(payload: unknown): void {
  const created = payload as {
    plant: {
      id: string;
      ownerId: string;
      /** The owner's display name, when the owner is connected. */
      ownerName?: string;
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
        /** Server-authoritative drawn radius, in metres. */
        radius?: number;
      }>;
    };
  };

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
  if (created.plant.id === plantId) return; // Skip own plant
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
    const radius = node.radius ?? nodeRadius(node.biomass, nodeTypeNum);
    const health = clientNodeHealth(node);
    otherPlant.set(node.id, {
      id: node.id,
      position: surfacePosition(node.x, node.z, node.y),
      type: nodeTypeNum,
      radius,
      parentId: node.parentId,
      age: node.age,
      health,
      mutationFlags: readServerMutationMask(node),
      biomass: node.biomass,
      isOwnPlant: false,
      isSeed: node.isSeed ?? node.type === 'seed',
      nodeType: node.type,
    });
  }
  otherPlayerPlants.set(created.plant.id, otherPlant);
  if (created.plant.ownerId) plantOwners.set(created.plant.id, created.plant.ownerId);
  if (created.plant.ownerName?.trim()) {
    plantOwnerNames.set(created.plant.id, created.plant.ownerName.trim());
  }
  // Tag it now, not at the next full sync: a rival that sprouts beside the
  // player used to stand there nameless for up to the sync interval.
  plantLabelLayer()?.setLabel(
    created.plant.id,
    rivalTagLabel(created.plant.ownerId, created.plant.ownerName, undefined),
  );
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
  notify('Another plant has sprouted nearby', 'info', 2200);
}

function handlePlantRemoved(payload: unknown): void {
  const removed = payload as {
    plantId: string;
    cause?: string;
    source?: string;
    biomass?: number;
    nodeCount?: number;
  };
  console.log('[PlantLegacy] PLANT_REMOVED received:', {
    plantId: removed.plantId,
    isOwnPlant: removed.plantId === plantId,
  });
  if (removed.plantId === plantId) {
    // Failed germination or removal with persistence off. There is no
    // implicit restore: the player reloads to start a fresh seed.
    handleOwnPlantLoss(removed.cause, removed.source, {
      biomass: removed.biomass,
      nodeCount: removed.nodeCount,
    });
    pruneStreamedNodeInterpolation();
    return;
  }
  plantLabels?.remove(removed.plantId);
  if (otherPlayerPlants.delete(removed.plantId)) {
    // Removal can land mid-tumble: its nodes have just left the mirror,
    // so forget their streamed positions too.
    pruneStreamedNodeInterpolation();
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
    notify('A player left the world', 'info', 2000);
  }
}

function handlePong(): void {
  const rtt = closePingProbe(pingSentAt, performance.now());
  if (rtt === null) return;
  pingSentAt = null;
  // Round-trips above the configured threshold feel like a bad link.
  if (rtt > networkConfig.slowRttMs) setStatus(`Slow connection (${rtt} ms)`, 'down');
  else setStatus(`Connected (${rtt} ms)`, 'ok');
}

function handleChatBroadcast(payload: unknown): void {
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
    addChatMessage(chat.playerId, chat.playerName, chat.message, chat.playerId === playerId);
  }
}

/**
 * Server message handlers, one entry per protocol type.
 *
 * This replaced a 1,700-line switch inside `connect()`: adding a protocol
 * message is now a function plus one line here, and a type nobody handles is
 * reported at startup instead of being dropped with a console warning.
 */
const messageHandlers = createDispatchTable([
  [MESSAGE_TYPE.WELCOME, handleWelcome],
  [MESSAGE_TYPE.INVENTORY_SYNC, handleInventorySync],
  [MESSAGE_TYPE.INVENTORY_SLOT_UPDATE, handleInventorySlotUpdate],
  [MESSAGE_TYPE.LEDGER_ENTRY, handleLedgerEntry],
  [MESSAGE_TYPE.STATE, handleState],
  [MESSAGE_TYPE.KEYFRAME, handleState],
  [MESSAGE_TYPE.RESOURCE_UPDATE, handleResourceUpdate],
  [MESSAGE_TYPE.TERRAIN_REGION, handleTerrainRegion],
  [MESSAGE_TYPE.TERRAIN_EDITS, handleTerrainEdits],
  [MESSAGE_TYPE.SEASON_UPDATE, handleSeasonUpdate],
  [MESSAGE_TYPE.MUTATION_STATE, handleMutationState],
  [MESSAGE_TYPE.PLANT_UPROOT, handlePlantUproot],
  [MESSAGE_TYPE.PLANT_DAMAGE, handlePlantDamage],
  [MESSAGE_TYPE.DROP_SPAWN, handleDropSpawn],
  [MESSAGE_TYPE.DROP_EXPIRED, handleDropExpired],
  [MESSAGE_TYPE.KILL_CREDIT, handleKillCredit],
  [MESSAGE_TYPE.FAUNA_EVENT, handleFaunaEvent],
  [MESSAGE_TYPE.WEATHER_UPDATE, handleWeatherUpdate],
  [MESSAGE_TYPE.WEATHER_STRIKE, handleWeatherStrike],
  [MESSAGE_TYPE.GROWTH_EVENT, handleGrowthEvent],
  [MESSAGE_TYPE.GROWTH_OPTIONS_RESULT, handleGrowthOptionsResult],
  [MESSAGE_TYPE.REJECT, handleReject],
  [MESSAGE_TYPE.ERROR, handleError],
  [MESSAGE_TYPE.DEV_RESPONSE, handleDevResponse],
  [MESSAGE_TYPE.PLANT_SYNC, handlePlantSync],
  [MESSAGE_TYPE.PLANT_CREATED, handlePlantCreated],
  [MESSAGE_TYPE.PLANT_REMOVED, handlePlantRemoved],
  [MESSAGE_TYPE.PONG, handlePong],
  [MESSAGE_TYPE.CHAT_BROADCAST, handleChatBroadcast],
]);

// INV-NET-13: a server message the client cannot handle must be visible, not
// silently ignored. This runs once, at startup.
const unhandledServerTypes = missingServerMessageTypes(messageHandlers);
if (unhandledServerTypes.length > 0) {
  console.error('[PlantLegacy] No handler for server message types:', unhandledServerTypes);
}

async function connect(): Promise<void> {
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
  setStatus('Connecting...', 'pending');
  setDetail(`Connecting to ${wsOrigin}...`);

  // Refresh a stale access token before HELLO. The server treats an unusable
  // token as an anonymous connection, so sending an expired one would silently
  // drop the account - and the plant that account owns - on every reconnect.
  const stored = loadReconnectData();
  const refreshed = await ensureFreshSession(fetch, httpOrigin, stored, Date.now());
  if (refreshed) {
    saveReconnectData({
      ...stored,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      displayName: refreshed.displayName ?? stored?.displayName,
    });
  } else if (stored?.accessToken) {
    // The refresh was refused. The server answers a HELLO carrying an unusable
    // token with AUTH_FAILED and closes, rather than falling back to guest, so
    // drop the dead tokens and keep only the anonymous reclaim identity.
    saveReconnectData({ plantId: stored.plantId, reconnectToken: stored.reconnectToken });
  }

  ws = new WebSocket(`${wsOrigin}/ws`);

  // Load stored reconnect data (accessToken for auth, plantId for anonymous reclaim)
  const reconnectData = loadReconnectData();

  ws.onopen = () => {
    connecting = false;
    // A probe from the previous connection must not be timed against this one:
    // a ping sent before a drop left `pingSentAt` set, and twelve seconds later
    // the dot claimed "Connection unstable" on a link that had just reconnected
    // cleanly.
    pingSentAt = null;
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
        reconnectToken: reconnectData?.reconnectToken,
        // The name the menu shows. The server sanitizes and caps it; the menu is
        // the only place a player chooses it.
        displayName: currentDisplayName(),
      },
    });
    console.log('[PlantLegacy] Sending HELLO:', hello);
    ws?.send(hello);
  };

  ws.onmessage = async (event) => {
    try {
      const message = JSON.parse(event.data);
      const { type, payload } = message;

      // Guard against missing message type
      if (typeof type !== 'number') {
        console.warn('PlantLegacy: received message without valid type', {
          type,
          payloadKeys: payload && typeof payload === 'object' ? Object.keys(payload) : null,
        });
        return;
      }

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

      const handler = messageHandlers.get(type);
      if (!handler) {
        console.warn('Unknown message type:', type);
      } else {
        const result: unknown = handler(payload, { type, byteLength: event.data.length });
        // Only the handler that reloads config is async; awaiting a sync result
        // would put a microtask between a message and the framing block below.
        if (result instanceof Promise) await result;
      }

      // Frame camera on first spawn (after WELCOME), and again only when the
      // plant itself changed. A same-plant reconnect leaves the view alone.
      // ADR-027: close framing on the normal-sized plant model; the model itself
      // is not enlarged.
      // Guard on `welcome` (not `welcome.rootNode`) so initPlantRenderer() runs
      // even when all nodes arrive via welcome.nodes (ADR-021 fast-path).
      const plantChanged = welcome !== null && welcome.plantId !== framedPlantId;
      if (welcome && (!cameraFramed || plantChanged)) {
        cameraFramed = true;
        framedPlantId = welcome.plantId;
        // A new plant is a new subject. A camera the player dragged around the
        // old hill must not veto the automatic refit for this one, which is how
        // a respawn could keep the view it had over a plant that had died.
        cameraUserMoved = false;
        // No nodes in the mirror yet: the fit below is a guess at the start
        // distance, so ask for one refit when the first own node lands.
        refitFramingOnFirstNodes = true;
        if (welcome.rootNode) {
          // rootNode.y is surface-relative (usually 0); framing on it directly
          // put the initial camera inside the hill. Map it to the drawn surface
          // exactly as the plant nodes are mapped.
          frameCameraOnPlant(
            welcome.rootNode.x,
            clientSurfaceY(welcome.rootNode.x, welcome.rootNode.z, welcome.rootNode.y),
            welcome.rootNode.z,
          );
        } else {
          // Frame on the first own node (seed/root) when rootNode is omitted
          const firstNode = Array.from(plantNodes.values()).find((n) => n.isOwnPlant);
          if (firstNode) {
            frameCameraOnPlant(firstNode.position.x, firstNode.position.y, firstNode.position.z);
          }
        }
        // Spawn high above the ground and let the player fall in, rather than
        // starting the rig embedded in the terrain it is standing on.
        respawnPlayer();

        setDetail(
          `Welcome! Player ID: …${(playerId ?? '').slice(-8)}\nServer tick: ${serverTick}\nClick your plant to grow. Press H for hints.`,
        );
        // T00A: Load onboarding config and init renderer once per page load
        if (!clientInitialized) {
          clientInitialized = true;
          await loadOnboardingConfig();
          await initPlantRenderer();
        }
      }
    } catch (error) {
      console.error('Failed to parse message:', error);
      if (error instanceof Error && error.stack) {
        console.error(error.stack);
      }
    }
  };

  ws.onclose = (event) => {
    // No pong can arrive for a probe sent on this socket any more.
    pingSentAt = null;
    if (suppressReconnect) {
      // Signing out closes the socket on purpose. The retry below would connect
      // straight back as a guest, which looks exactly like being signed in.
      suppressReconnect = false;
      connecting = false;
      setStatus('Offline', 'down');
      return;
    }
    connecting = false;
    plantId = null;
    plantReady = false;
    // Deliberately NOT reset: the player keeps their chosen framing across a
    // dropped socket (server restart, tunnel blip). Space / double-click still
    // recenter on demand.
    hideGrowthSelection();
    rootSightActivePlants.clear();
    otherPlayerPlants.clear();
    otherGrowingNodes.clear();
    clearGrowthOptionsTimeout();
    setRootSightEnabled(false);
    setStatus('Disconnected', 'down');
    setDetail(`Connection closed: code=${event.code}, reason=${event.reason || 'none'}`);
    if (entryFlow.step === 'connecting') {
      entryFlowConnectionFailed(entryFlow, 'Could not reach the server.');
      entryScreen.render(entryFlow);
    }
    setTimeout(connect, 3000);
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    setDetail('WebSocket error');
  };
}

/**
 * Whether the pane is being driven by fingers rather than a pointer.
 *
 * This is the same query the stylesheet uses to choose its finger layout, read here
 * because the scale depends on it: a layout that exists to make targets big enough
 * for a thumb must not be shrunk. It is the *finger* query and not "is there a fine
 * pointer", because a touchscreen laptop has both and is used with a mouse - it
 * reports hover, so it scales - while an automation browser that reports no pointer
 * capability at all is not a phone and must not be treated as one.
 */
function isFingerLayout(): boolean {
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

/** The size the game is actually seen at: the element it fills, not the window. */
function viewportSize(): { width: number; height: number } {
  return {
    width: Math.max(1, app?.clientWidth || window.innerWidth),
    height: Math.max(1, app?.clientHeight || window.innerHeight),
  };
}

/**
 * Resize the camera and both renderers to the area the canvas occupies.
 *
 * This used to read `window.innerWidth/innerHeight`. When the game is embedded -
 * the desktop browser panel, an iframe, any container smaller than the window -
 * the canvas is laid out at the container's size while the buffer stayed at the
 * window's, so the game kept rendering (and reading input) at a resolution the
 * panel never showed. The element's own box is the only size that is true.
 */
function applyViewportSize(): void {
  const { width, height } = viewportSize();
  // The overlay scales with the pane, so a small pane shows the whole interface
  // smaller rather than switching to a sheet that covers the world.
  setUiScale(
    document.documentElement.style,
    uiScaleForPane({ paneW: width, paneH: height, finePointer: !isFingerLayout() }),
  );
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  // Resizing clears the drawing buffer. A tab that is not receiving animation
  // frames would show that cleared, black buffer until something else drew, so
  // paint the new size at once.
  if (renderLoopReady && document.hidden) renderFrame(0.016);
  if (plantRenderer) {
    plantRenderer.setViewportSize(renderer.domElement.width, renderer.domElement.height);
    plantRenderer.onResize();
  }
  webgpuRenderer?.resize(width, height, renderer.getPixelRatio());
}

// Resize handler
window.addEventListener('resize', applyViewportSize);

// Plugging in a mouse changes which layout is right, without resizing anything.
if (typeof window.matchMedia === 'function') {
  const pointerQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
  const onPointerCapability = (): void => applyViewportSize();
  if (typeof pointerQuery.addEventListener === 'function') {
    pointerQuery.addEventListener('change', onPointerCapability);
  } else if (typeof pointerQuery.addListener === 'function') {
    pointerQuery.addListener(onPointerCapability);
  }
}

// A container can change size without the window resizing (a resized panel, a
// sidebar opening), which left the buffer at the old size. The element is the
// authority, so watch it directly.
if (typeof ResizeObserver !== 'undefined' && app) {
  let observerSize = `${app.clientWidth}x${app.clientHeight}`;
  // The observer's first callback reports the size it already had and returns
  // early, so the opening frame would keep the stylesheet's default scale.
  applyViewportSize();
  new ResizeObserver(() => {
    const next = `${app.clientWidth}x${app.clientHeight}`;
    if (next === observerSize) return;
    observerSize = next;
    applyViewportSize();
  }).observe(app);
}

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

// If the window loses focus mid-press the matching keyup never arrives, which
// used to leave the camera dollying (or panning) on its own. Release every held
// camera input so the view stays wherever the player left it.
function releaseHeldCameraInput(): void {
  keyboardZoomState.in = false;
  keyboardZoomState.out = false;
  cameraPanState.forward = false;
  cameraPanState.backward = false;
  cameraPanState.left = false;
  cameraPanState.right = false;
}
window.addEventListener('blur', releaseHeldCameraInput);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) releaseHeldCameraInput();
});

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
/** Last real input; anchors the configured idle drop. */
let lastInputAtMs = performance.now();
/** Pending idle-cadence tick, so any input resumes the loop immediately. */
let idleRenderTimer: number | null = null;
/** Idle cadence: 10 fps, the rate `config/render.json`'s note names. */
const IDLE_FRAME_INTERVAL_MS = 1000 / 10;
/** The last four seconds of frame pacing, so "it stutters" can be measured. */
const frameBudget = new FrameBudget(240);
/** Last GPU time the driver reported, milliseconds; 0 until a query completes. */
let lastGpuMs = 0;
/**
 * The cost side of that one budget. Recorded from both loops, because a hidden
 * tab only draws on a timer - and drawing is what costs, whether or not anything
 * is animating.
 */
function recordRenderCost(cpuMs: number): void {
  frameBudget.recordCost(cpuMs);
}

/**
 * Spring-arm collision: when the line from the orbit target to the camera
 * crosses a solid collider (the terrain), pull the camera in front of the
 * obstruction instead of letting it clip through the ground.
 */
function resolveCameraCollision(): void {
  if (planetViewActive) return;
  if (!physicsReady || !rapierWorld.isReady) return;
  if (!renderConfig?.cameraCollisionEnabled) return;

  const target = controls.target;
  // Going below the surface is deliberate (Root Sight, inspecting roots). The
  // spring arm used to treat the ground as an obstruction the moment the camera
  // sank into it: with the root-layer minimum distance it clamped the camera to
  // a few centimetres from the target and then chased the changing hit every
  // frame, which is the spasming that shoved the view back up. Underground, the
  // ground is the subject, not an obstruction.
  const surface = soilQuery();
  if (isBelowSoil(camera.position, surface) || isBelowSoil(target, surface)) return;
  tempCameraOffset.copy(camera.position).sub(target);
  const distance = tempCameraOffset.length();
  if (distance <= 1e-4) return;
  tempCameraOffset.divideScalar(distance);

  // The player's own canopy never obstructs the camera. Looking up sends the
  // target-to-eye ray through the plant's own leaves, and treating that as a
  // collider pulled the eye in and read as the camera colliding with the plant.
  // Terrain and rival plants still block.
  const ownBody = plantColliders?.ownRigidBody() ?? null;
  const ray = new RAPIER.Ray(target, tempCameraOffset);
  const hit = rapierWorld
    .getWorld()
    .castRay(ray, distance, true, undefined, undefined, undefined, ownBody ?? undefined);
  if (!hit) return;

  const hitRecord = hit as unknown as {
    timeOfImpact?: number;
    toi?: number;
    collider?: unknown;
  };
  // The ground never blocks the view: it is a surface the orbit target sits on,
  // not an obstacle between the eye and the subject.
  if (soilColliderRef.current && hitRecord.collider === soilColliderRef.current) return;
  if (terrainColliderRefs.includes(hitRecord.collider)) return;
  const travel = hitRecord.timeOfImpact ?? hitRecord.toi ?? distance;
  if (travel >= distance) return;

  const minDistance = currentCameraMinDistance();
  const margin = renderConfig.cameraCollisionMargin;
  // A hit this close to the target cannot be avoided by pulling the camera in:
  // it would land inside the target. The orbit target sits on the ground the
  // plant grows from, so the spring-arm ray grazes that ground every frame; the
  // old unconditional clamp to cameraMinDistance therefore pinned the camera at
  // arm's length and made the view feel locked. Grazing hits are ignored.
  if (travel <= minDistance + margin) return;

  const clamped = Math.max(minDistance, travel - margin);
  camera.position.copy(target).addScaledVector(tempCameraOffset, clamped);
}

/** ADR-027: one size class, resolved from config/render.json. */
function sizeClassConfig(): SizeClassConfig | null {
  const classes = renderConfig?.sizeClasses ?? [];
  const id = devSettings?.seedSizeClass ?? 'normal';
  return classes.find((entry) => entry.id === id) ?? classes[0] ?? null;
}

/** Framing is presentation: the class scales the camera, never the world. */
function sizeClassCameraMultiplier(): number {
  return sizeClassConfig()?.cameraMaxDistanceMultiplier ?? 1;
}

function effectiveCameraMaxDistance(): number {
  const base = renderConfig?.cameraMaxDistance ?? 200;
  return Math.min(camera.far * 0.9, base * sizeClassCameraMultiplier());
}

/**
 * A giant is framed from four times further away, which needs a deeper far
 * plane. Near is raised with it so the depth ratio stays usable.
 */
function applyCameraRange(): void {
  if (!renderConfig) return;
  const wantedFar = Math.max(
    camera.far,
    (renderConfig.cameraMaxDistance * sizeClassCameraMultiplier()) / 0.9,
  );
  camera.near = Math.max(0.1, wantedFar / 25000);
  camera.far = wantedFar;
  camera.updateProjectionMatrix();
  if (!planetViewActive) controls.maxDistance = effectiveCameraMaxDistance();
}

const benchmarkFocusPoint = new THREE.Vector3();

/** The player plant's centroid, lifted to the canopy if it has one. */
function benchmarkFocus(target: THREE.Vector3): THREE.Vector3 {
  let x = 0;
  let y = 0;
  let z = 0;
  let count = 0;
  for (const node of plantNodes.values()) {
    x += node.position.x;
    y += node.position.y;
    z += node.position.z;
    count += 1;
  }
  if (count === 0) return target.set(0, 1, 0);
  return target.set(x / count, y / count + 1, z / count);
}

/** Places the camera at one of the six AL-01 poses. */
function applyBenchmarkPose(pose: BenchmarkPose): void {
  benchmarkFocus(benchmarkFocusPoint);
  benchmarkFocusPoint.y += pose.targetLiftM;
  const azimuth = THREE.MathUtils.degToRad(pose.azimuthDeg);
  const elevation = THREE.MathUtils.degToRad(pose.elevationDeg);
  const horizontal = Math.cos(elevation);
  tempVector.set(
    Math.cos(azimuth) * horizontal,
    Math.sin(elevation),
    Math.sin(azimuth) * horizontal,
  );
  camera.position.copy(benchmarkFocusPoint).addScaledVector(tempVector, pose.distanceM);
  controls.target.copy(benchmarkFocusPoint);
  targetCameraDistance = -1;
  controls.update();
}

function startBenchmark(): void {
  if (!benchmarkRunner || benchmarkRunner.isRunning) return;
  benchmarkRunner.start(performance.now());
}

/** Put the view on one AL-01 pose without running a measurement pass. */
function applyBenchmarkPoseId(id: string): boolean {
  const pose = devSettings?.benchmarkPoses.find((entry) => entry.id === id);
  if (!pose) return false;
  applyBenchmarkPose(pose);
  return true;
}

/** P0/2-B: draw streamed node positions at the render clock, not the tick. */
function applyStreamedNodeInterpolation(nowMs: number): void {
  if (interpolatedNodes.size === 0) return;
  let changed = false;
  for (const [id, node] of interpolatedNodes) {
    if (nodeInterpolator.sample(id, nowMs, interpolationPoint)) {
      node.position.set(interpolationPoint.x, interpolationPoint.y, interpolationPoint.z);
      changed = true;
    }
  }
  if (!changed) return;
  // The joints ride the same body. Each attachment is a fixed offset from its
  // parent, so it is re-derived from the parent's drawn position this frame -
  // that keeps the weld closed while the pose eases toward the packet, instead of
  // snapping the attachment ahead of the nodes it belongs to.
  for (const [, node] of interpolatedNodes) {
    const parentId = node.parentId;
    if (!parentId || node.parentAttachOffsetX === undefined) continue;
    const parent =
      plantNodes.get(parentId) ??
      (node.plantId ? otherPlayerPlants.get(node.plantId)?.get(parentId) : undefined);
    if (!parent) continue;
    node.parentAttachX = parent.position.x + node.parentAttachOffsetX;
    node.parentAttachY = parent.position.y + (node.parentAttachOffsetY ?? 0);
    node.parentAttachZ = parent.position.z + (node.parentAttachOffsetZ ?? 0);
  }
  // The raymarched body is uploaded from node data, so it is refreshed with the
  // interpolated pose; the mesh renderer keeps its packet-time geometry.
  const others: PlantNodeData[] = [];
  for (const nodes of otherPlayerPlants.values()) others.push(...nodes.values());
  plantRenderer?.updateSdfFrame([...plantNodes.values(), ...others]);
}

// Shared render frame logic (used by both requestAnimationFrame and background setInterval)
function renderFrame(deltaTime: number): void {
  // The entry screen paints its own opaque 2D world over the canvas, so nothing of
  // this scene is on screen while it is up. Rendering it anyway is a full scene
  // pass, a shadow pass and a plant rebuild every frame for an image that is then
  // covered - and it competes with the title's own drawing for the same budget,
  // which is what made the title screen stutter. The stamp keeps the stalled-loop
  // watchdog quiet while the frame is deliberately skipped.
  if (entryFlow.step !== 'world') {
    lastFrameAtMs = performance.now();
    return;
  }
  lastFrameAtMs = performance.now();
  // AL-03: frame timing starts here and closes after the last draw call.
  gpuTimer?.begin();
  applyStreamedNodeInterpolation(performance.now());
  // WASD / arrows pan the camera and its target together (ADR-022).
  applyCameraPan(deltaTime);
  // Gravity and ground contact for the player. Runs every frame, after the pan,
  // so the terrain under the new position is what the player stands on.
  settlePlayerOnGround(deltaTime);

  // - and + dolly the camera backwards and forwards along its own view axis.
  // The camera is a physical object here: the distance to the orbit target
  // changes by cameraZoomSpeed metres per second, the field of view never does.
  if (keyboardZoomState.in || keyboardZoomState.out) {
    const currentDist = camera.position.distanceTo(controls.target);
    const dollySpeed = renderConfig?.cameraZoomSpeed ?? 2.0;
    let delta = 0;
    if (keyboardZoomState.in) delta -= dollySpeed * deltaTime;
    if (keyboardZoomState.out) delta += dollySpeed * deltaTime;

    // Bounded by the orbit limits, so the camera stops at arm's length instead
    // of ending up inside the plant.
    const minD = Math.max(0.05, currentCameraMinDistance());
    const maxD = effectiveCameraMaxDistance();
    const newDist = Math.max(minD, Math.min(maxD, currentDist + delta));

    tempVector.copy(camera.position).sub(controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(tempVector, newDist);
    targetCameraDistance = -1; // Manual zoom takes precedence
  }

  // Smooth camera distance framing
  if (targetCameraDistance > 0 && !keyboardZoomState.in && !keyboardZoomState.out) {
    const currentDist = camera.position.distanceTo(controls.target);
    const distT = Math.min(1.0, deltaTime * 3.5);
    const newDist = THREE.MathUtils.lerp(currentDist, targetCameraDistance, distT);
    tempVector.copy(camera.position).sub(controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(tempVector, newDist);
    if (Math.abs(currentDist - targetCameraDistance) < 0.02) {
      targetCameraDistance = -1;
    }
  }

  // An eased node focus owns the camera until it settles or a hand moves it.
  updateCameraFocus(deltaTime);

  // Camera up follows the surface normal at the look-at point. The orbit/pan
  // math is kept in that frame too, otherwise the controls rotate around world
  // Y while the camera looks along the normal and the two fight each other.
  applyCameraUp(desiredCameraUp(cameraUpTarget));

  // The orbit floor follows what is being inspected: plant-sized above ground,
  // root-tip-sized in the root layer. Planet view sets its own floors.
  if (!planetViewActive) {
    // Ease the floor instead of stamping it. The aperture clearance jumps from a
    // metre to the width of the cavity the moment Root Sight opens, and pushing
    // the camera out to it in one frame read as R setting the view by hand rather
    // than just opening a hole. The floor still rises; it takes a fifth of a
    // second, and OrbitControls does the pushing from the eased value.
    const wantedMinDistance = currentCameraMinDistance();
    const ease = Math.min(1, deltaTime / CAMERA_MIN_DISTANCE_EASE_S);
    if (cameraMinDistanceEased <= 0) {
      cameraMinDistanceEased = wantedMinDistance;
    } else {
      // The ease alone is proportional to dt, so one long frame (a shader
      // compile the moment the cavity appears) took the whole rise at once and
      // the floor still looked stamped. Cap the change per frame as well, in
      // both directions: the floor must fall again when Root Sight closes.
      const gap = wantedMinDistance - cameraMinDistanceEased;
      const step = Math.min(CAMERA_MIN_DISTANCE_MAX_RISE_M, Math.abs(gap) * ease) * Math.sign(gap);
      cameraMinDistanceEased += step;
    }
    controls.minDistance = cameraMinDistanceEased;
  }
  // An orbit camera always looks at its target, and the target sits on the
  // ground: once the eye is down on the soil no polar angle is left that points
  // at the sky, so the ground ceiling stopped an upward drag dead and the view
  // could not rise any further. Spend that drag as pitch on the camera itself,
  // so the view keeps tilting up from the soil.
  const upDragRad = orbitUpDragRad;
  orbitUpDragRad = 0;
  const orbitAtCeiling = controls.getPolarAngle() >= controls.maxPolarAngle - 0.02;
  // The pose the pitch belongs to. While no pitch is held, the anchor follows the
  // framing, so the next look-up is measured from wherever the player stands. A
  // held pitch keeps its anchor: standing still (or only yawing) moves nothing, so
  // the view stays exactly as it was left, while walking or panning the framing a
  // metre gives it back.
  if (lookUpPitchRad <= 1e-4 && lookUpPitchTargetRad <= 1e-4) {
    lookUpPitchAnchorX = controls.target.x;
    lookUpPitchAnchorZ = controls.target.z;
  }
  const lookUpTravelM = Math.hypot(
    controls.target.x - lookUpPitchAnchorX,
    controls.target.z - lookUpPitchAnchorZ,
  );
  const lookUp = stepLookUpPitch({
    targetRad: lookUpPitchTargetRad,
    appliedRad: lookUpPitchRad,
    upDragRad,
    atCeiling: orbitAtCeiling,
    maxRad: LOOK_UP_PITCH_MAX_RAD,
    gain: LOOK_UP_PITCH_GAIN,
    decayPerSecond: LOOK_UP_PITCH_RETURN_RAD_PER_S,
    travelM: lookUpTravelM,
    releaseAfterM: LOOK_UP_PITCH_RELEASE_TRAVEL_M,
    // The controls' own glide, so the handover from orbit to pitch has the same
    // weight as the rotation that preceded it.
    dampingFactor: controls.dampingFactor,
    deltaTimeS: deltaTime,
  });
  lookUpPitchTargetRad = lookUp.targetRad;
  lookUpPitchRad = lookUp.appliedRad;
  controls.update();
  resolveCameraCollision();
  // Drops bob and fade on their own clock; the server still owns their life.
  worldDrops.update(performance.now());
  // OrbitControls only applies minDistance while dollies are in progress, so
  // enforce the floor here too: after leaving the root layer the camera must be
  // pushed back out of the plant instead of staying inside it.
  if (!planetViewActive) {
    const orbitMinDistance = cameraMinDistanceEased;
    const orbitDistance = camera.position.distanceTo(controls.target);
    if (orbitDistance < orbitMinDistance - 1e-4) {
      tempVector.copy(camera.position).sub(controls.target).normalize();
      camera.position.copy(controls.target).addScaledVector(tempVector, orbitMinDistance);
    }
  }
  // Last, so the ground has the final say: a pose that clears the plant but is
  // inside a hill still has to move in.
  // A free camera is not clamped out of the ground or out of a cavity: flying
  // through a hill is the point of item 12, and the near-side cut that keeps the
  // inside readable is Wave C's volume terrain. The aim lean is a ground-rig
  // device too - it exists because an orbit camera cannot look up from the soil.
  const freeCamera = cameraFliesFree();
  if (!freeCamera) {
    clampEyeToGround();
    clampEyeToCavity(deltaTime);
  }
  // Lean the view up when the eye is down on the soil (see `applyCameraAim`),
  // after every clamp has placed the eye and before the dev pose, which owns its
  // own look direction.
  if (!cavityProbe.held() && !freeCamera) {
    applyCameraAim();
    // A camera looks along its local -Z: a positive turn about its own X lifts
    // that direction towards +Y, which is up.
    if (lookUpPitchRad > 1e-4) camera.rotateX(lookUpPitchRad);
  }
  // ... and a held dev pose after that, because the point of holding one is to
  // look from places the rig exists to prevent, such as inside the earth.
  cavityProbe.applyHold();

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
      // A zero or non-finite duration would divide to NaN, and a NaN progress
      // poisons the whole plant's drawn bounds: the body leaves the frame until
      // the server reports the part finished. One bad tick must finish a part,
      // never blank a plant.
      const duration =
        Number.isFinite(growthInfo.duration) && growthInfo.duration > 0 ? growthInfo.duration : 1;
      const elapsed = Math.max(0, growNow - growthInfo.startTime);
      const raw = Number.isFinite(elapsed) ? elapsed / duration : 1;
      const progress = Math.min(1.0, Math.max(0, raw));
      if (progress >= 1.0) {
        node.growthProgress = 1.0;
        growingNodes.delete(nodeId);
        // The server owns the final position of a finished segment. Pull it now,
        // otherwise the node keeps the position it had when growth started and
        // the new part looks detached from the plant.
        requestPlantResync();
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
      const duration =
        Number.isFinite(growthInfo.duration) && growthInfo.duration > 0 ? growthInfo.duration : 1;
      const elapsed = Math.max(0, growNow - growthInfo.startTime);
      const raw = Number.isFinite(elapsed) ? elapsed / duration : 1;
      const progress = Math.min(1.0, Math.max(0, raw));
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
      const sunDir = environmentRenderer.getSunDirection();
      plantRenderer.setSunLight(
        sunDir,
        environmentRenderer.getSunColor(),
        environmentRenderer.getSunIntensity(),
      );
      // Light through the blades follows the light that is actually in the sky:
      // `sunLight` is the moon after sunset, where `getSunIntensity()` is the
      // sun's own number and reads zero. Not the sun's uniforms - those are the
      // raymarcher's, and its night look is tuned around them.
      plantRenderer.setLeafBacklight(sunDir, sunLight.color, sunLight.intensity);
    }
    plantRenderer.render(deltaTime);
  }
  if (webgpuRenderer) {
    const allPlants: PlantNodeData[] = [...plantNodes.values()];
    for (const nodes of otherPlayerPlants.values()) allPlants.push(...nodes.values());
    webgpuRenderer.updatePlants(allPlants, performance.now());
    webgpuRenderer.update(deltaTime);
  }

  // Apply a full grid that arrived before the environment renderer was ready.
  if (pendingResourceGrid && environmentRenderer) {
    const grid = pendingResourceGrid;
    pendingResourceGrid = null;
    environmentRenderer.updateResourceGridQuantized(
      grid.gridBase64,
      grid.width,
      grid.height,
      grid.tileSize,
    );
  }

  // C03: Update environment renderer (sky dome, fog, rain particles, lightning)
  if (environmentRenderer) {
    // Underground Root Sight view: no sky, no surface sheet, dark earth instead.
    const undergroundView =
      isBelowSoil(camera.position, soilQuery(), 0.05) &&
      (rootSightMachine ? rootSightStateMachineIsEnabled(rootSightMachine) : false);
    webgpuRenderer?.setUndergroundView(undergroundView);
    // Puddles and snow belong to the ground under the player, not to the camera:
    // a zoom step moves the eye but not the soil.
    environmentRenderer.setGroundAnchor(controls.target.x, controls.target.z);
    environmentRenderer.update(deltaTime);
    updatePlantLabelPositions();
    updateGrowthDebug();
    // Keep WebGPU plant/ground lighting in sync with the visual sun every frame.
    webgpuRenderer?.setSunDirection(environmentRenderer.getSunDirection());
    webgpuRenderer?.setSunWarmth(environmentRenderer.getSunWarmth());
    // Exposure grade: a lift at golden hour, a crush at night, from render.json.
    renderer.toneMappingExposure = environmentRenderer.getExposureGrade();
  }

  // Plant colliders follow the drawn skeleton, not a biomass guess. The
  // manager does real work at the configured rebuild rate and rebuilds only a
  // plant whose node signature changed.
  if (physicsReady && plantColliders) {
    plantColliders.sync(plantId, plantNodes, otherPlayerPlants, camera.position, performance.now());
  }

  // Step Rapier physics and sync body transforms to Three.js meshes
  if (physicsReady && rapierWorld.isReady) {
    rapierWorld.step();
    plantPhysicsSync.syncTransforms();
  }

  // Safety net: a dropped growth event would otherwise leave the mirror short of
  // nodes until the next reconnect (a plant stuck at seed + radicle while the
  // server has a seedling). A cheap periodic sync repairs any gap.
  if (ws && ws.readyState === WebSocket.OPEN && performance.now() - lastPeriodicResyncAt > 10000) {
    lastPeriodicResyncAt = performance.now();
    requestPlantResync();
  }

  // Periodically notify the SDF renderer of updated growthProgress (it doesn't
  // rebuild every frame unlike the WebGPU renderer which does joint matrices).
  if (growingNodes.size > 0 || otherGrowingNodes.size > 0) {
    const growNow2 = performance.now();
    const otherNodes: PlantNodeData[] = [];
    for (const nodes of otherPlayerPlants.values()) otherNodes.push(...nodes.values());
    const allNodes = [...plantNodes.values(), ...otherNodes];
    // Repack the raymarched body every frame: it is a buffer upload, not a
    // rebuild, and it is the only way the emergent tube moves with the camera
    // instead of stepping ten times a second.
    plantRenderer?.updateSdfFrame(allNodes);
    if (growNow2 - lastGrowthUpdateTime >= GROWTH_UPDATE_INTERVAL_MS) {
      if (plantRenderer) plantRenderer.updatePlantData(allNodes);
      // The WebGPU pass bakes the emerging positions into its vertices, so it
      // only moves when it is given the new progress. It used to be fed on state
      // packets alone - twice a second - while the progress advanced every frame,
      // which is why growth visibly stalled and then jumped forward in steps.
      if (webgpuRenderer) webgpuRenderer.updatePlants(allNodes, growNow2);
      lastGrowthUpdateTime = growNow2;
    }
  }

  // AL-03: one band decision per frame from measured costs. GPU time is only
  // present when the driver exposes a timer query; otherwise the vsync-clamped
  // CPU frame time drives the same loop.
  const frameCostMs = Math.max(0.1, deltaTime * 1000);
  const gpuCostMs = gpuTimer ? gpuTimer.readMs() : null;
  // Reported by `__pl.frameStats()`: the frame's GPU time next to our own CPU time
  // is what says which side owns the missing frames.
  if (gpuCostMs !== null) lastGpuMs = gpuCostMs;
  // Only frames the player is actually shown may grade quality. The hidden-tab
  // loop steps `renderFrame(0.1)` itself and Chromium throttles that timer to a
  // couple of hertz, so each hidden frame reported ~100-500 ms of cost, the band
  // read it as a slow GPU and the pixel ratio fell to the resolution floor. The
  // tab then went on drawing at half resolution - soft in exactly the window a
  // background tab lives in - until enough visible frames had climbed back.
  //
  // Only the sample is withheld. The band's decision still has to be applied
  // every frame, and the LOD scale and the plants' atmosphere are state the
  // scene needs whether or not anyone is grading it - starving them on the
  // frames where the tab is least able to recover would leave the picture
  // wrong long after the sample itself stops mattering.
  if (qualityController) {
    if (!document.hidden && !skipQualitySample) {
      qualityController.update(
        {
          frameMs: frameCostMs,
          gpuMs: gpuCostMs,
          triangles: renderer.info.render.triangles ?? 0,
        },
        performance.now(),
      );
    }
    const ratio = qualityController.pixelRatio;
    if (Number.isFinite(ratio) && Math.abs(renderer.getPixelRatio() - ratio) > 0.001) {
      renderer.setPixelRatio(ratio);
      // The plant raymarchs at a resolution of its own, and it read the drawing
      // buffer only on a window resize. A quality step changes the buffer
      // without one, so the plants went on computing rays for the size the
      // window had when it last resized - measured at 1018x820 inside a
      // 1161x934 buffer, permanently coarser than the screen they were drawn on.
      plantRenderer?.setViewportSize(renderer.domElement.width, renderer.domElement.height);
      plantRenderer?.onResize();
      // Both canvases composite over each other; the WebGPU one has to follow
      // the same resolution or half the frame keeps its full pixel cost.
      const viewport = viewportSize();
      webgpuRenderer?.resize(viewport.width, viewport.height, ratio);
    }
    // Draw distance is the band's second lever, before the tier is dropped.
    webgpuRenderer?.setLodThresholdScale(qualityController.drawDistanceScale);
    // AL-04: plants and ground share one atmosphere model, so a plant fades
    // into exactly the air in front of the terrain behind it.
    if (plantRenderer && environmentRenderer) {
      plantRenderer.setAtmosphere(environmentRenderer.getAtmosphere());
    }
  }
  // Same rule for the flag: a hidden frame is not the frame it was waiting for.
  if (!document.hidden) skipQualitySample = false;

  // AL-01: the benchmark consumes the same numbers the band controller sees, so
  // its report describes the frame the player is actually getting.
  if (benchmarkRunner?.isRunning) {
    benchmarkRunner.tick(performance.now(), {
      frameMs: frameCostMs,
      gpuMs: gpuCostMs,
      triangles: renderer.info.render.triangles ?? 0,
      drawCalls: renderer.info.render.calls ?? 0,
    });
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

  // Shadow map refresh: ~8 Hz normally, ~4 Hz when the frame budget is already
  // tight. This removes a full extra scene pass from most frames.
  const shadowIntervalMs = measuredFps < 50 ? 250 : 125;
  const shadowNow = performance.now();
  if (renderer.shadowMap.enabled && shadowNow - lastShadowRefreshMs >= shadowIntervalMs) {
    renderer.shadowMap.needsUpdate = true;
    lastShadowRefreshMs = shadowNow;
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

  // Growth aim gizmo last, on its own canvas above the plant/ground layer.
  renderGrowthAimOverlay();
  // AL-03: close the GPU timing query after the last draw call of the frame.
  gpuTimer?.end();
}

function animate(): void {
  // On the title the loop does not re-arm. An empty callback is not free: it asks
  // the compositor for sixty frames a second, every second, of a page whose only
  // moving parts are two CSS animations. On a software-composited browser that is
  // a permanent load on the whole application - the title screen was making the
  // editor around it stutter - and it starves the very animations it was meant to
  // serve. Parking is safe: `wakeRenderLoop` is called wherever the world can
  // begin (the welcome, a visibility flip, a restored graphics context, the pause
  // menu's resume), the animation loop is started there, and the watchdog below
  // still draws a frame a second if it ever finds the canvas stale.
  if (entryFlow.step !== 'world') {
    renderLoopRunning = false;
    lastFrameAtMs = performance.now();
    return;
  }
  const now = performance.now();
  const idleDropEnabledMs = renderConfig?.idleDropTimeoutMs ?? 0;
  if (shouldIdleRender(now, lastInputAtMs, idleDropEnabledMs)) {
    // One frame, a tenth of a second apart: the "throttles to 10 fps" that
    // `config/render.json` and the C01 record have promised since the client
    // foundation. Asking the compositor for sixty frames a second of a still
    // picture is a permanent load for a frame that does not change.
    //
    // A hidden tab is drawn by its own timer instead; stopping here keeps the two
    // from both drawing, and visibility calls `wakeRenderLoop` on the way back.
    if (document.hidden) {
      renderLoopRunning = false;
      lastFrameAtMs = now;
      return;
    }
    renderLoopRunning = true;
    lastFrameAtMs = now;
    const idleIntervalMs = Math.max(1, now - lastUpdateTime);
    lastUpdateTime = now;
    measuredFps = 1000 / idleIntervalMs;
    // The band must not grade a frame whose delta is the idle gap: it would read
    // as a 100 ms frame and spend detail on a world that is not moving.
    skipQualitySample = true;
    const idleStart = performance.now();
    try {
      renderFrame(Math.min(0.25, idleIntervalMs / 1000));
    } catch (error) {
      console.error('[PlantLegacy] Render frame error:', error);
    }
    recordRenderCost(performance.now() - idleStart);
    frameBudget.record(idleIntervalMs);
    idleRenderTimer = window.setTimeout(() => {
      idleRenderTimer = null;
      animate();
    }, IDLE_FRAME_INTERVAL_MS);
    return;
  }

  requestAnimationFrame(animate);
  renderLoopRunning = true;

  const frameIntervalMs = now - lastUpdateTime;
  const deltaTime = Math.min(0.25, frameIntervalMs / 1000);
  lastUpdateTime = now;
  if (deltaTime > 0) measuredFps = 1 / deltaTime;

  const frameStart = performance.now();
  try {
    renderFrame(deltaTime);
  } catch (error) {
    console.error('[PlantLegacy] Render frame error:', error);
    // Continue animation loop even if one frame fails
  }
  recordRenderCost(performance.now() - frameStart);
  // Interval and our own work in that interval: a long frame with little of our
  // code in it is the GPU (see `__pl.frameStats()`), not the loop.
  frameBudget.record(frameIntervalMs);
}

// ---- Account presence ----------------------------------------------------
// The logout endpoint existed with no way to reach it from the game, so a
// signed-in player could neither see their session nor end it. This chip is the
// only in-world account surface until the C05 menu lands.
let accountChip: HTMLDivElement | null = null;
let suppressReconnect = false;

function storedSession(): ReconnectData {
  return loadReconnectData() ?? {};
}

let chipConfirmTimer: ReturnType<typeof setTimeout> | null = null;

function chipButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hud-btn';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

/**
 * Two-step sign out. Logging out is not a pause button (RULE_11), so the chip
 * says so before it does anything, and "Stay" is one click away.
 */
function renderAccountChip(confirming: boolean): void {
  if (!accountChip) return;
  const session = storedSession();
  accountChip.replaceChildren();

  const dot = document.createElement('span');
  dot.setAttribute('aria-hidden', 'true');
  dot.style.cssText = `width: 7px; height: 7px; border-radius: 50%;
    background: var(--leaf-400); box-shadow: 0 0 8px rgba(157, 198, 94, 0.6);`;
  const name = document.createElement('span');
  name.style.cssText = `font-size: var(--hud-font-sm); color: var(--bone-300);
    letter-spacing: 0.02em; max-width: 16ch; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap;`;
  name.textContent = session.displayName ?? 'Signed in';
  accountChip.append(dot, name);
  if (session.username) {
    const handle = document.createElement('span');
    handle.style.cssText = `font-size: var(--hud-font-sm); color: var(--ink-dim);
      letter-spacing: 0.02em; max-width: 14ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
    handle.textContent = `@${session.username}`;
    accountChip.append(handle);
  }

  if (!confirming) {
    accountChip.append(chipButton('Sign out', () => renderAccountChip(true)));
    return;
  }

  const warning = document.createElement('span');
  warning.textContent = 'The world keeps running.';
  warning.style.cssText = `font-size: var(--hud-font-sm); color: var(--ink-muted);`;
  accountChip.append(
    warning,
    chipButton('Sign out', () => {
      void handleSignOut();
    }),
    chipButton('Stay', () => renderAccountChip(false)),
  );

  if (chipConfirmTimer) clearTimeout(chipConfirmTimer);
  chipConfirmTimer = setTimeout(() => renderAccountChip(false), 8000);
}

function updateAccountChip(): void {
  const session = storedSession();
  if (!session.accessToken) {
    if (chipConfirmTimer) clearTimeout(chipConfirmTimer);
    chipConfirmTimer = null;
    accountChip?.remove();
    accountChip = null;
    return;
  }

  if (!accountChip) {
    accountChip = document.createElement('div');
    accountChip.id = 'account-chip';
    accountChip.className = 'hud-panel';
    accountChip.style.cssText = `
      position: fixed;
      right: var(--hud-corner);
      bottom: var(--hud-corner);
      z-index: 210;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 6px 5px 10px;
      pointer-events: auto;
    `;
    if (uiShell) uiShell.attachTo('hud', accountChip);
    else document.body.appendChild(accountChip);
  }

  renderAccountChip(false);
}

// ---- While you were away -------------------------------------------------
// The server sends deltas from a disconnect snapshot. The panel is terse data,
// never commentary (RULE_13), and it is the only place a player can see what the
// world did without them.
let awayPanel: HTMLDivElement | null = null;
let awayPanelTimer: ReturnType<typeof setTimeout> | null = null;

function formatAway(seconds: number): string {
  if (seconds >= 86_400) {
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3600);
    return `${days} d ${hours} h`;
  }
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours} h ${minutes} m`;
  }
  return `${Math.max(1, Math.round(seconds / 60))} m`;
}

function signed(value: number, digits = 1): string {
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return '0';
  return `${rounded > 0 ? '+' : '\u2212'}${Math.abs(rounded)}`;
}

function hideAwayReport(): void {
  if (awayPanelTimer) clearTimeout(awayPanelTimer);
  awayPanelTimer = null;
  awayPanel?.remove();
  awayPanel = null;
}

function showAwayReport(away: WelcomePayload['away']): void {
  if (!away) return;
  hideAwayReport();

  const panel = document.createElement('div');
  panel.id = 'away-report';
  panel.className = 'hud-panel';
  panel.style.cssText = `
    position: fixed;
    left: 50%;
    top: var(--hud-top);
    transform: translateX(-50%);
    z-index: 205;
    width: min(340px, 88vw);
    padding: 10px 12px;
    display: grid;
    gap: 6px;
    pointer-events: auto;
  `;

  const title = document.createElement('div');
  title.textContent = `Away ${formatAway(away.seconds)}`;
  title.style.cssText = `font-size: var(--hud-font-sm); font-weight: 700;
    letter-spacing: 0.07em; text-transform: uppercase; color: var(--leaf-300);`;
  panel.appendChild(title);

  const rows: Array<[string, string]> = [
    ['Nodes', `${away.nodesBefore} \u2192 ${away.nodesAfter}`],
    ['Biomass', signed(away.biomass)],
    ['Energy', signed(away.energy)],
    ['Water', signed(away.water)],
    ['Minerals', signed(away.minerals)],
  ];
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    row.style.cssText = `display: flex; justify-content: space-between; gap: 12px;
      font-size: var(--hud-font-sm); color: var(--bone-300);`;
    const left = document.createElement('span');
    left.textContent = label;
    left.style.color = 'var(--ink-muted)';
    const right = document.createElement('span');
    right.textContent = value;
    right.style.color =
      value.startsWith('\u2212') || value.startsWith('-')
        ? 'var(--ember-400)'
        : 'var(--sprout-300)';
    row.append(left, right);
    panel.appendChild(row);
  }

  const dismiss = chipButton('Dismiss', hideAwayReport);
  dismiss.style.marginTop = '2px';
  panel.appendChild(dismiss);

  if (uiShell) uiShell.attachTo('panel', panel);
  else document.body.appendChild(panel);
  awayPanel = panel;
  awayPanelTimer = setTimeout(hideAwayReport, 20_000);
}

let lossPanel: HTMLDivElement | null = null;
let lossPanelTimer: ReturnType<typeof setTimeout> | null = null;

function hideLossReport(): void {
  if (lossPanelTimer) clearTimeout(lossPanelTimer);
  lossPanelTimer = null;
  lossPanel?.remove();
  lossPanel = null;
}

/**
 * What did it, in words. `cause` is the coarse server code; `source` says which
 * store ran dry, which tool, which weather - so a player is never told only
 * "damage" when they are trying to learn what went wrong.
 */
function killedByLabel(source: string | undefined): string | null {
  switch (source) {
    case 'tool':
      return "another player's tool";
    case 'weather':
      return 'the weather';
    case 'herbivore':
      return 'something eating it';
    case 'terrain':
      return 'the ground giving way';
    case 'uprooted':
      return 'being torn free and draining dry';
    case 'thirst':
      return 'stored water running out';
    case 'minerals':
      return 'stored minerals running out';
    case 'no_energy':
      return 'stored energy running out';
    case 'malnutrition':
      return 'water and minerals running out';
    default:
      return null;
  }
}

function describeDeathCause(cause: string, source?: string): string {
  let sentence: string;
  switch (cause) {
    case 'starvation':
      return `It starved: ${killedByLabel(source) ?? 'the stores ran out'}.`;
    case 'dehydration':
      return 'It ran out of water.';
    case 'germination_failed':
      return 'The seed never sprouted.';
    case 'damage':
      sentence = 'It was damaged past saving';
      break;
    case 'mutation_upkeep':
      return 'Its mutations cost more than it could pay.';
    case 'reconnect_timeout':
      return 'It was left unattended for too long.';
    case 'competition':
      return 'Another plant took its ground.';
    case 'calamity':
      return 'The season turned and took it with it.';
    default:
      return cause.replace(/_/g, ' ');
  }
  const label = killedByLabel(source);
  return label ? `${sentence} by ${label}.` : `${sentence}.`;
}

/**
 * The replacement seed used to arrive silently, which read as if nothing had
 * happened. A death away from the screen is still a death.
 */
function showLossReport(cause: string, secondsAgo: number, source?: string): void {
  hideLossReport();
  const panel = document.createElement('div');
  panel.id = 'loss-report';
  panel.className = 'hud-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Your plant died');
  panel.style.cssText = `
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 400;
    width: min(360px, 90vw);
    padding: 18px;
    display: grid;
    gap: 10px;
    border-left: 3px solid var(--ember-500);
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55);
    pointer-events: auto;
  `;

  const title = document.createElement('div');
  title.textContent = 'Your plant died';
  title.style.cssText = `font-size: 1.05rem; font-weight: 700;
    letter-spacing: 0.04em; color: var(--ember-400);`;
  const body = document.createElement('div');
  body.textContent = `${describeDeathCause(cause, source)} It died ${formatAway(secondsAgo)} ago.`;
  body.style.cssText = `font-size: var(--hud-font-sm); color: var(--bone-300); line-height: 1.5;`;
  const next = document.createElement('div');
  next.textContent = 'A new seed is ready in the soil. Take it and begin again.';
  next.style.cssText = `font-size: var(--hud-font-sm); color: var(--leaf-300); line-height: 1.45;`;
  panel.append(title, body, next, chipButton('Continue with new seed', hideLossReport));

  if (uiShell) uiShell.attachTo('panel', panel);
  else document.body.appendChild(panel);
  lossPanel = panel;
  lossPanelTimer = setTimeout(hideLossReport, 25_000);
}

async function handleSignOut(): Promise<void> {
  const session = storedSession();
  suppressReconnect = true;
  // Revoking the refresh session server-side matters even after the local tokens
  // are gone: the session stays valid for its full lifetime otherwise. A failed
  // revoke must not trap the player in a session they asked to end.
  if (session.refreshToken) await signOut(fetch, httpOrigin, session.refreshToken);
  clearReconnectData();
  updateAccountChip();

  const socket = ws;
  ws = null;
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
  ) {
    socket.close(1000, 'Signed out');
  }
  connecting = false;
  entryFlowSignedOut(entryFlow);
  entryScreen.setAccount(null);
  entryScreen.render(entryFlow);
}

// Entry flow. Until now the client had no auth UI and never called /auth/*,
// so an access token could not be obtained at all: accounts and account-owned
// plants were unreachable from the game. Nothing connects until the player
// chooses, and the overlay stays up until the server has welcomed us.
const entryFlow = createEntryFlowStateMachine();

function saveSession(session: {
  accessToken: string;
  refreshToken: string;
  displayName?: string;
  username?: string;
}): void {
  saveReconnectData(session);
}

/**
 * Forget which plant this tab holds while keeping the account session. Used when
 * a plant dies or is replaced: the player keeps their identity and simply gets a
 * new seed, instead of being demoted to a guest without being told.
 */
function clearPlantIdentity(): void {
  const stored = loadReconnectData();
  saveReconnectData({
    accessToken: stored?.accessToken,
    refreshToken: stored?.refreshToken,
    displayName: stored?.displayName,
    username: stored?.username,
  });
}

async function handleSignIn(username: string, password: string): Promise<void> {
  if (!entryFlowBeginRequest(entryFlow)) return;
  entryScreen.render(entryFlow);
  try {
    const session = await signIn(fetch, httpOrigin, { username, password });
    saveSession({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      displayName: session.displayName ?? username,
      username: session.username ?? username,
    });
    entryFlowAuthenticated(entryFlow, session.displayName ?? username);
    entryScreen.setAccount({
      displayName: session.displayName ?? username,
      username: session.username ?? username,
    });
    entryScreen.setDisplayName(session.displayName ?? username);
    entryScreen.render(entryFlow);
    void connect();
  } catch (error) {
    entryFlowRequestFailed(entryFlow, error instanceof Error ? error.message : String(error));
    entryScreen.render(entryFlow);
  }
}

async function handleSignUp(
  username: string,
  displayName: string,
  password: string,
): Promise<void> {
  if (!entryFlowBeginRequest(entryFlow)) return;
  entryScreen.render(entryFlow);
  try {
    const session = await signUp(fetch, httpOrigin, { username, displayName, password });
    saveSession({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      displayName: session.displayName ?? displayName,
      username: session.username ?? username,
    });
    entryFlowAuthenticated(entryFlow, session.displayName ?? displayName);
    entryScreen.setAccount({
      displayName: session.displayName ?? displayName,
      username: session.username ?? username,
    });
    entryScreen.setDisplayName(session.displayName ?? displayName);
    entryScreen.render(entryFlow);
    void connect();
  } catch (error) {
    entryFlowRequestFailed(entryFlow, error instanceof Error ? error.message : String(error));
    entryScreen.render(entryFlow);
  }
}

/**
 * Layer for the entry screen. The shell owns the stack: modal (400) keeps
 * toasts (500) and the debug overlay (700) above it and the HUD (120-200)
 * below it, which is exactly where a blocking title should sit.
 */
function modalMount(shell: UIShell | null): HTMLElement {
  return shell?.getLayer('modal') ?? document.body;
}

// Declared here, built in startEntryFlow(): the shell and its modal layer only
// exist after initC01(), and an overlay mounted before that lands on <body> with
// an ad-hoc z-index instead of in the layer stack.
let entryScreen!: MainMenu;

const entryCallbacks: MainMenuCallbacks = {
  // Play is the only way in now: with a stored session it resumes the account,
  // without one it starts a guest plant. The name comes from the box.
  onPlay: (displayName) => {
    rememberDisplayName(displayName);
    if (entryFlow.hasSession) {
      entryFlowAuthenticated(entryFlow, displayName);
    } else {
      entryFlowContinueAsGuest(entryFlow);
    }
    entryScreen.render(entryFlow);
    void connect();
  },
  onSignInForm: () => {
    entryFlowChoose(entryFlow, 'sign_in');
    entryScreen.render(entryFlow);
  },
  onSignUpForm: () => {
    entryFlowChoose(entryFlow, 'sign_up');
    entryScreen.render(entryFlow);
  },
  onSignIn: (username, password) => {
    void handleSignIn(username, password);
  },
  onSignUp: (username, displayName, password) => {
    void handleSignUp(username, displayName, password);
  },
  onReseed: () => {
    entryFlowReseed(entryFlow);
    entryScreen.render(entryFlow);
    // A signed-in player keeps their account and gets a fresh plant for it.
    clearPlantIdentity();
    void connect();
  },
  onBack: () => {
    entryFlowBack(entryFlow);
    entryScreen.render(entryFlow);
  },
  onCancelConnect: () => {
    entryFlowCancelConnect(entryFlow);
    entryScreen.render(entryFlow);
    // A hung handshake has no timeout of its own, so the socket is closed here.
    // Without this the connection could still complete and drop the player into
    // the world they just backed out of.
    const socket = ws;
    suppressReconnect = true;
    ws = null;
    if (
      socket &&
      (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
    ) {
      socket.close(1000, 'Cancelled');
    }
    connecting = false;
    setStatus('Offline', 'down');
  },
  onSignOut: () => {
    void handleSignOut();
  },
  onSettings: () => {
    settingsPanel?.setOpen(true);
  },
  onShop: () => {
    openShop();
  },
};

/** The name the menu will send with HELLO. */
function currentDisplayName(): string {
  return entryFlow.displayName || menuAccount()?.displayName || localProfile.displayName || '';
}

/** The account, when this tab holds a session. */
function menuAccount(): MainMenuAccount | null {
  const stored = loadReconnectData();
  if (!stored?.accessToken && !stored?.refreshToken) return null;
  return { displayName: stored.displayName ?? 'Plant Keeper', username: stored.username };
}

let localProfile: LocalProfile = { displayName: '', avatar: null, tutorialSeen: false };
/** Set by initC01; the title screen is built after it returns. */
let resolvedUiConfig: import('./config/clientConfig.js').UIConfig | null = null;

function rememberDisplayName(displayName: string): void {
  localProfile = saveProfile(window.localStorage, { displayName });
}

function rememberAvatar(avatar: string | null): void {
  localProfile = saveProfile(window.localStorage, { avatar });
}

let shopPanel: ShopPanel | null = null;

function openShop(): void {
  if (shopPanel) return;
  const layer = uiShell?.getLayer('modal') ?? document.body;
  entryScreen?.setOverlayOpen(true);
  // Ask for the pouch first: the shop's balance and the item counts are the
  // server's, and a panel that opens with a stale purse invites a refusal.
  requestInventory();
  shopPanel = createShopPanel({
    config: shopConfig,
    mount: layer,
    balance: sporeBalance,
    onBuy: (itemId) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: MESSAGE_TYPE.SHOP_PURCHASE, payload: { itemId } }));
    },
    onClose: () => {
      shopPanel?.destroy();
      shopPanel = null;
      entryScreen?.setOverlayOpen(false);
    },
  });
}

/** Close the shop from outside it: entering the world, or leaving the menu. */
function closeShop(): void {
  if (!shopPanel) return;
  shopPanel.destroy();
  shopPanel = null;
  entryScreen?.setOverlayOpen(false);
}

function startEntryFlow(bootTime: Promise<number | null> | null = null): void {
  localProfile = loadProfile(window.localStorage);
  // Read the world's hour before the first frame. The menu used to paint its own
  // cycle start and then snap to the server time a moment later, which read as a
  // day-to-night flash on every reload. The request is started at the top of the
  // boot, so by the time the shell exists it has usually answered already.
  void (bootTime ?? fetchBootTime()).then((timeOfDay) => {
    if (entryScreen) return;
    mountMenu(timeOfDay);
  });
}

/**
 * The 3D world, its physics and the rest of the HUD have finished building.
 *
 * The title is mounted before this point on purpose: it is a 2D scene that needs
 * only the UI config and the world's hour, while the boot also compiles shaders,
 * builds the environment and initialises Rapier. Waiting for all of that left
 * the app showing nothing for seconds; now the first thing on screen is the
 * picture, and Play stays disabled until the world behind it is ready.
 */
let entryBooted = false;
function bootEntryFlow(): void {
  entryBooted = true;
  if (!entryScreen) return;
  const stored = loadReconnectData();
  entryFlowBoot(entryFlow, Boolean(stored?.accessToken || stored?.refreshToken));
  entryScreen.render(entryFlow);
}

/** The world's hour as of boot, reused by the game world's first frame. */
let bootWorldTime: number | null = null;

/** The world's time of day at boot, or null if it could not be read in time. */
async function fetchBootTime(): Promise<number | null> {
  const request = fetchWorldTime(window.fetch.bind(window), httpOrigin);
  const budget = new Promise<null>((resolve) => {
    window.setTimeout(() => resolve(null), 900);
  });
  const time = await Promise.race([request, budget]);
  bootWorldTime = time ? time.timeOfDay : null;
  // No estimate means no priming: the renderer's own default is no worse than a
  // guess, and the first broadcast corrects it anyway.
  if (bootWorldTime !== null) environmentRenderer?.primeTimeOfDay(bootWorldTime);
  return bootWorldTime;
}

function mountMenu(initialTimeOfDay: number | null): void {
  if (entryScreen) return;
  entryScreen = new MainMenu({
    mount: modalMount(uiShell),
    callbacks: entryCallbacks,
    ui:
      resolvedUiConfig ??
      (() => {
        throw new Error('UI config must load before the title screen');
      })(),
    // The menu shows the world's sky, not a sky of its own.
    initialTimeOfDay,
    cycleLengthS: dayNightConfig.cycleLengthS,
    // The title's verge and its flowers follow the world's calendar, which the
    // season update in this file keeps current.
    season: () => seasonNumber,
    fetchWorldTime: () => fetchWorldTime(window.fetch.bind(window), httpOrigin),
    account: menuAccount(),
    displayName: menuAccount()?.displayName ?? localProfile.displayName,
    avatar: localProfile.avatar,
    onProfileChange: (profile) => {
      if (profile.avatar !== undefined) rememberAvatar(profile.avatar);
      if (profile.displayName !== undefined) rememberDisplayName(profile.displayName);
    },
    // Avatar uploads are recorded because the one report we never reproduced
    // was "choosing a picture reboots the game". If it happens, the journal says
    // what the session had just done when it stopped.
    onDiagnostic: (kind, detail) => recordSessionEvent(kind, detail),
  });
  // The machine may already be past booting: the title can mount after a slow
  // `/world/time` while the rest of the world has finished. Render it in
  // whatever state the flow is in, and let the boot finish it if it is ready.
  entryScreen.render(entryFlow);
  if (entryBooted) bootEntryFlow();
}

// Start
await initC01();
// The title mounted inside initC01 when its own config was ready. Now the world
// behind it is built, so the button can work.
bootEntryFlow();

// Ping every 5 seconds
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const probe = openPingProbe(pingSentAt, performance.now(), networkConfig.stallMs);
    if (probe.stalled) setStatus('Connection unstable', 'down');
    pingSentAt = probe.sentAt;
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

interface PlantLegacyDebugHandle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  plantNodes: typeof plantNodes;
  otherPlayerPlants: typeof otherPlayerPlants;
  readonly inputBus: InputBus | null;
  readonly socket: WebSocket | null;
  readonly plantId: string | null;
  readonly drawnPositionOf: (node: PlantNodeData) => THREE.Vector3;
  /** The plant as drawn, for browser checks that need an exact click point. */
  readonly devNodes: () => Array<{
    id: string;
    parentId: string | null;
    type: PlantNodeData['nodeType'];
    isSeed: boolean;
    world: [number, number, number];
    radius: number;
  }>;
  readonly plantRenderer: PlantRenderer | null;
  readonly webgpuRenderer: WebGPURenderer | null;
  readonly mutationLook: MutationLook | null;
  readonly plantLabels: { count(): number } | null;
  readonly environmentRenderer: EnvironmentRenderer | null;
  /** Why the camera is where it is: automatic framing state. */
  readonly cameraStatus: () => {
    userMoved: boolean;
    refitPending: boolean;
    easing: boolean;
    framing: boolean;
  };
  /** Why Root Sight is open or shut: counts and a one-line summary. */
  readonly rootSightStatus: () => {
    enabled: boolean;
    progress: number;
    roots: number;
    rootsInSoil: number;
    usedTypeFallback: boolean;
    bubbles: number;
    apertureM: number;
    reason: string;
    summary: string;
  };
  readonly plantEnergy: number;
  readonly plantBiomass: number;
  /**
   * Dev probes for the Root Sight cavity: hold an eye the rig cannot move, tint
   * the soil body against the cavity shell, and rebuild the earth with and
   * without its cavity hole.
   */
  readonly devCavity: CavityProbe;
  /** How many nodes carry a nub, and by how much: the same rule the meshes use. */
  readonly devNubs: () => NubReport;
  /** Terrain height under a world x/z. The camera floor's datum, in metres. */
  readonly groundAt: (x: number, z: number) => number;
  /** AL-01 benchmark: start a run, poll it, read the last report. */
  readonly benchmark: {
    start: () => void;
    report: () => BenchmarkReport | null;
    running: () => boolean;
    /** Fixed pose ids, in report order. */
    poses: () => string[];
    /** Put the camera and time of day on one pose without running a full run. */
    applyPose: (id: string) => boolean;
  };
}

/**
 * Dev probes, built once the scene, camera and controls exist.
 *
 * Declared above the handle rather than inside it: `renderFrame` stamps a held
 * pose every frame, and it needs the same instance the console calls.
 */
const cavityProbe = createCavityProbe({
  scene,
  camera,
  getTarget: () => controls.target,
});

// Started only now, not at the top of this tail section: `animate()` runs
// `renderFrame` synchronously on its first call, and that frame reads
// `cavityProbe`. Calling it before the probe existed made the first frame throw
// a temporal-dead-zone `ReferenceError` into the catch and log it as a render
// failure, on every load.
animate();

// A page that loaded hidden never gets its `visibilitychange`: start the timer
// loop from the state the page is actually in, so a preview pane or an occluded
// window draws the world instead of leaving the canvas black.
//
// Read through a function: `renderConfig` is assigned inside the loader, so at
// module tail flow analysis still believes it is null and the property read is
// rejected.
function pauseRendersWhenHidden(): boolean {
  return renderConfig?.pauseOnHidden === true;
}
if (pauseRendersWhenHidden() && document.hidden) startBackgroundLoop();
renderLoopReady = true;

// A stalled animation loop must not leave the last thing on screen a cleared
// buffer. `requestAnimationFrame` stops entirely for a hidden page, and its
// timers are throttled, so the world could sit black through a whole season of
// panel focus changes. One cheap check a second: if no frame has been drawn for
// half a second, draw one here. On a visible page the loop is healthy and this
// never fires; a stalled one gets a frame a second, which is a still picture
// rather than a black one.
window.setInterval(() => {
  if (!renderLoopReady) return;
  // A parked loop is only correct while the title is up. If the world is on screen
  // and nothing is re-arming, start it here: that is the invariant the parking
  // relies on, checked once a second, so a world entered by a path that forgot to
  // wake it cannot sit frozen.
  if (entryFlow.step === 'world' && !renderLoopRunning) {
    wakeRenderLoop();
    return;
  }
  if (performance.now() - lastFrameAtMs < 500) return;
  renderFrame(0.1);
}, 1000);

// Development handle for inspecting the live scene from the browser console.
if (import.meta.env.DEV) {
  (window as Window & { __plantLegacy?: PlantLegacyDebugHandle }).__plantLegacy = {
    renderer,
    scene,
    camera,
    // A getter, not a captured reference: the controls are rebuilt when the
    // surface normal moves, and the handle must follow the live instance.
    get controls() {
      return controls;
    },
    cameraStatus: () => ({
      userMoved: cameraUserMoved,
      refitPending: refitFramingOnFirstNodes,
      easing: targetCameraDistance > 0,
      framing: cameraFocusTween !== null,
    }),
    plantNodes,
    otherPlayerPlants,
    get inputBus() {
      return inputBus;
    },
    get socket() {
      return ws;
    },
    get plantId() {
      return plantId;
    },
    drawnPositionOf: (node: PlantNodeData) =>
      resolveDrawnNodePosition(
        node,
        node.parentId ? plantNodes.get(node.parentId) : undefined,
        plantNodes.values(),
      ),
    get plantRenderer() {
      return plantRenderer;
    },
    get webgpuRenderer() {
      return webgpuRenderer;
    },
    get mutationLook() {
      return plantRenderer?.getPlantLook() ?? null;
    },
    get environmentRenderer() {
      return environmentRenderer;
    },
    get plantLabels() {
      return plantLabels;
    },
    rootSightStatus: () => ({ ...rootSightDiagnostic, summary: describeRootSightStatus() }),
    get benchmark() {
      return {
        start: () => startBenchmark(),
        report: () => lastBenchmarkReport,
        running: () => benchmarkRunner?.isRunning ?? false,
        poses: () => (devSettings?.benchmarkPoses ?? []).map((pose) => pose.id),
        applyPose: (id: string) => applyBenchmarkPoseId(id),
      };
    },
    get plantEnergy() {
      return plantEnergy;
    },
    get plantBiomass() {
      return plantBiomass;
    },
    devCavity: cavityProbe,
    /**
     * The plant as it is drawn, for browser checks that need an exact click point.
     * Read-only; nothing in the game reads it.
     */
    devNodes: () =>
      [...plantNodes.values()].map((node) => {
        const drawn = drawnNodePosition(node);
        return {
          id: node.id,
          parentId: node.parentId ?? null,
          type: node.nodeType,
          isSeed: node.isSeed === true,
          world: [drawn.x, drawn.y, drawn.z] as [number, number, number],
          radius: resolveDrawnRadius(node.nodeType, node.radius ?? 0.05, node.biomass),
        };
      }),
    // The nub swell is a few per cent of a tube: too small to check by eye, so the
    // count and the range come from the same rule the mesh builders apply.
    devNubs: () => nubReport(plantNodes.values()),
    groundAt: (x: number, z: number) =>
      planetTerrainY(renderConfig?.planetRadiusM ?? 0, x, z, getTerrainParams()),
  };
}
