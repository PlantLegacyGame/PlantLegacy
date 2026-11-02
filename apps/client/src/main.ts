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
import { loadPlantRendererConfig } from './config/plantRendererConfig.js';
import { PlantRenderer } from './renderers/PlantRenderer.js';

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
    const response = await fetch(`${serverOrigin}/config/onboarding`, { cache: 'no-store' });
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
  WELCOME: 10,
  STATE: 11,
  KEYFRAME: 12,
  REJECT: 13,
  PONG: 14,
  ERROR: 15,
  GROWTH_EVENT: 16,
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

const keys = {
  forward: false,
  backward: false,
  left: false,
  right: false,
};

// Three.js setup
const app = document.getElementById('app');
if (!app) throw new Error('App element not found');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
app.appendChild(renderer.domElement);

// T00A: Hint card overlay (3 lines per RULE_13)
const hintCard = document.createElement('div');
hintCard.id = 'hint-card';
hintCard.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(20, 24, 15, 0.95);
    border: 1px solid #2a281f;
    border-radius: 8px;
    padding: 16px 24px;
    color: #efe9d8;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 14px;
    line-height: 1.6;
    text-align: center;
    max-width: 90vw;
    z-index: 100;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    opacity: 0;
    transition: opacity 0.3s ease;
    pointer-events: none;
  `;
document.body.appendChild(hintCard);

// T00A: Resource readout overlay
const resourceReadout = document.createElement('div');
resourceReadout.id = 'resource-readout';
resourceReadout.style.cssText = `
    position: fixed;
    top: 20px;
    left: 20px;
    background: rgba(20, 24, 15, 0.9);
    border: 1px solid #2a281f;
    border-radius: 8px;
    padding: 12px 16px;
    color: #efe9d8;
    font-family: ui-monospace, "JetBrains Mono", monospace;
    font-size: 12px;
    line-height: 1.8;
    z-index: 100;
    min-width: 180px;
  `;
document.body.appendChild(resourceReadout);

function updateResourceReadout(): void {
  // Placeholder values - in real game these come from server
  resourceReadout.innerHTML = `
      <div>LIGHT: <span id="res-light">0.00</span> <span class="tooltip" data-tip="light">ⓘ</span></div>
      <div>WATER: <span id="res-water">0.00</span> <span class="tooltip" data-tip="water">ⓘ</span></div>
      <div>MINERALS: <span id="res-minerals">0.00</span> <span class="tooltip" data-tip="minerals">ⓘ</span></div>
      <div>BIOMASS: <span id="res-biomass">${plantBiomass.toFixed(1)}</span> <span class="tooltip" data-tip="biomass">ⓘ</span></div>
    `;

  // Add tooltip listeners
  document.querySelectorAll('.tooltip').forEach((el) => {
    el.addEventListener('mouseenter', (e) => {
      const tip = (e.target as HTMLElement).dataset.tip;
      if (
        tip &&
        onboardingConfig.resource_tooltips[tip as keyof typeof onboardingConfig.resource_tooltips]
      ) {
        showTooltip(
          e.target as HTMLElement,
          onboardingConfig.resource_tooltips[
            tip as keyof typeof onboardingConfig.resource_tooltips
          ],
        );
      }
    });
    el.addEventListener('mouseleave', hideTooltip);
  });
}

let tooltipEl: HTMLDivElement | null = null;
function showTooltip(target: HTMLElement, text: string): void {
  tooltipEl = document.createElement('div');
  tooltipEl.style.cssText = `
    position: fixed;
    background: rgba(20, 24, 15, 0.98);
    border: 1px solid #2a281f;
    border-radius: 4px;
    padding: 8px 12px;
    color: #efe9d8;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 12px;
    line-height: 1.4;
    max-width: 280px;
    z-index: 200;
    pointer-events: none;
    box-shadow: 0 2px 10px rgba(0,0,0,0.4);
  `;
  tooltipEl.textContent = text;
  document.body.appendChild(tooltipEl);

  const rect = target.getBoundingClientRect();
  tooltipEl.style.left = `${rect.left + rect.width / 2 - tooltipEl.offsetWidth / 2}px`;
  tooltipEl.style.top = `${rect.top - tooltipEl.offsetHeight - 8}px`;
}

function hideTooltip(): void {
  if (tooltipEl) {
    tooltipEl.remove();
    tooltipEl = null;
  }
}

function showHintCard(): void {
  hintCard.innerHTML = onboardingConfig.hint_card_lines
    .map((line) => `<div>${line}</div>`)
    .join('');
  hintCard.style.opacity = '1';

  setTimeout(() => {
    hintCard.style.opacity = '0';
  }, onboardingConfig.show_hint_card_duration_ms);
}

const statusElement = document.getElementById('status');
const detailElement = document.getElementById('detail');

function setStatus(text: string, state: 'pending' | 'ok' | 'down'): void {
  if (!statusElement) return;
  statusElement.textContent = text;
  statusElement.dataset.state = state;
}

function setDetail(text: string): void {
  if (!detailElement) return;
  detailElement.textContent = text;
}

// T01: Plant Renderer
let plantRenderer: PlantRenderer | null = null;
let lastUpdateTime = 0;

async function initPlantRenderer(): Promise<void> {
  const config = await loadPlantRendererConfig(serverOrigin);

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

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14180f);
scene.fog = new THREE.Fog(0x14180f, 50, 200);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, 30, 40);
camera.lookAt(0, 0, 0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enablePan = true;
controls.minDistance = 10;
controls.maxDistance = 200;
controls.maxPolarAngle = Math.PI / 2 - 0.05;

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffffee, 1.2);
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

// Remove old ground plane - PlantRenderer handles ground now

// Grid helper
const gridHelper = new THREE.GridHelper(400, 80, 0x3a382f, 0x2a281f);
scene.add(gridHelper);

// Axes helper
const axesHelper = new THREE.AxesHelper(20);
scene.add(axesHelper);

// Initial resource readout
updateResourceReadout();

function sendInput(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  inputTick++;
  const input: PlayerInput = {
    moveForward: keys.forward,
    moveBackward: keys.backward,
    moveLeft: keys.left,
    moveRight: keys.right,
    tick: inputTick,
  };

  const message = JSON.stringify({
    type: MESSAGE_TYPE.INPUT,
    payload: { input },
  });
  ws.send(message);
}

function sendGrowthIntent(): void {
  console.log('GROWTH_INTENT sending:', { plantId, plantNodesSize: plantNodes.size });
  if (!ws || ws.readyState !== WebSocket.OPEN || !plantId) return;

  growthIntentTick++;
  const rootNode = plantNodes.size > 0 ? Array.from(plantNodes.values())[0] : null;
  if (!rootNode) return;

  // Grow stems upward (canopy) with camera direction mixed in
  const camDir = new THREE.Vector3(0, 0, -1);
  camDir.applyQuaternion(camera.quaternion);
  camDir.normalize();
  const dir = new THREE.Vector3(camDir.x * 0.7, 0.7, camDir.z * 0.7).normalize();

  // Bias toward growing down for roots, up for stems
  const nodeType = 'stem';
  const isAttack = false;

  const intent: GrowthIntent = {
    plantId,
    nodeId: rootNode.id,
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
              radius: 0.05 + welcome.rootNode.biomass * 0.15,
              parentId: null,
              age: 10,
              health: 0.9,
              mutationFlags: 0,
              biomass: welcome.rootNode.biomass,
            });
            plantBiomass = welcome.totalBiomass;
            updateResourceReadout();
          }
          // PlantRenderer handles its own objects
          setDetail(
            `Welcome! You are ${myCubeId}\nPlayer ID: ${playerId}\nServer tick: ${serverTick}\nT01: Growth Active — Press 'G' to grow stem from root`,
          );
          // T00A: Load onboarding config and show hint card on first spawn
          await loadOnboardingConfig();
          await initPlantRenderer();
          showHintCard();
          break;
        }

        case MESSAGE_TYPE.STATE:
        case MESSAGE_TYPE.KEYFRAME: {
          const state = payload as StatePayload | KeyframePayload;
          serverTick = state.tick;
          break;
        }

        case MESSAGE_TYPE.GROWTH_EVENT: {
          const growth = payload as GrowthEventPayload;
          console.log('GROWTH_EVENT:', {
            plantId: growth.plantId,
            myPlantId: plantId,
            nodeId: growth.newNode.id,
            nodeType: growth.newNode.type,
            pos: [growth.newNode.x, growth.newNode.y, growth.newNode.z],
            biomass: growth.newNode.biomass,
            totalBiomass: growth.totalBiomass,
          });
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
          const radius = 0.05 + node.biomass * 0.15;
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
          updateResourceReadout();
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

// Input handling
window.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'KeyW':
    case 'ArrowUp':
      keys.forward = true;
      e.preventDefault();
      break;
    case 'KeyS':
    case 'ArrowDown':
      keys.backward = true;
      e.preventDefault();
      break;
    case 'KeyA':
    case 'ArrowLeft':
      keys.left = true;
      e.preventDefault();
      break;
    case 'KeyD':
    case 'ArrowRight':
      keys.right = true;
      e.preventDefault();
      break;
    case 'KeyG':
      sendGrowthIntent();
      break;
  }
});

window.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW':
    case 'ArrowUp':
      keys.forward = false;
      e.preventDefault();
      break;
    case 'KeyS':
    case 'ArrowDown':
      keys.backward = false;
      e.preventDefault();
      break;
    case 'KeyA':
    case 'ArrowLeft':
      keys.left = false;
      e.preventDefault();
      break;
    case 'KeyD':
    case 'ArrowRight':
      keys.right = false;
      e.preventDefault();
      break;
  }
});

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
function animate(): void {
  requestAnimationFrame(animate);
  controls.update();

  // Update plant renderer
  if (plantRenderer) {
    const now = Date.now();
    const deltaTime = (now - lastUpdateTime) / 1000;
    lastUpdateTime = now;
    plantRenderer.update(deltaTime);
  }

  renderer.render(scene, camera);
}

// Start
connect();
animate();
