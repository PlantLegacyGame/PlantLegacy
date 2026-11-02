/**
 * C01 Client - Vite + Three.js foundation.
 *
 * Replaces the Phase 0 canvas client with a proper Three.js scene.
 * Connects via WebSocket, renders cubes in 3D, sends input.
 * No client-side authority - server validates all movement.
 *
 * T00A: First-spawn hint card (3 lines) + resource readout tooltips (RULE_13).
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const serverOrigin =
  document.querySelector('meta[name="server-origin"]')?.getAttribute('content') ?? '';

const isLocalDev = location.hostname === '127.0.0.1' && location.port === '4173';
const wsOrigin = isLocalDev ? 'ws://127.0.0.1:8080' : serverOrigin.replace(/^http/, 'ws');

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
}

interface WelcomePayload {
  playerId: string;
  cubeId: string;
  tick: number;
  cubes: CubeState[];
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

const MESSAGE_TYPE = {
  HELLO: 1,
  INPUT: 2,
  PING: 3,
  WELCOME: 10,
  STATE: 11,
  KEYFRAME: 12,
  REJECT: 13,
  PONG: 14,
  ERROR: 15,
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
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

// Initial resource readout
updateResourceReadout();

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
controls.maxDistance = 100;
controls.maxPolarAngle = Math.PI / 2 - 0.05;

const cubeMeshes = new Map<string, THREE.Mesh>();

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

// Ground plane
const groundGeometry = new THREE.PlaneGeometry(400, 400);
const groundMaterial = new THREE.MeshStandardMaterial({
  color: 0x2a281f,
  roughness: 0.9,
  metalness: 0.1,
});
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Grid helper
const gridHelper = new THREE.GridHelper(400, 80, 0x3a382f, 0x2a281f);
scene.add(gridHelper);

// Axes helper
const axesHelper = new THREE.AxesHelper(20);
scene.add(axesHelper);

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

function createCubeMesh(cube: CubeState): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const material = new THREE.MeshStandardMaterial({
    color: cube.color,
    roughness: 0.7,
    metalness: 0.2,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(cube.x, 1, cube.z);
  mesh.rotation.y = -cube.rotation;

  // Direction indicator (small cone on top)
  const coneGeometry = new THREE.ConeGeometry(0.3, 0.8, 4);
  const coneMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x333333 });
  const cone = new THREE.Mesh(coneGeometry, coneMaterial);
  cone.position.y = 1.5;
  mesh.add(cone);

  // Label
  const sprite = makeTextSprite(cube.id === myCubeId ? 'YOU' : cube.id.slice(0, 8), {
    fontsize: 24,
    backgroundColor: { r: 0, g: 0, b: 0, a: 0.7 },
    textColor: { r: 255, g: 255, b: 255, a: 1 },
  });
  sprite.position.y = 3;
  mesh.add(sprite);

  return mesh;
}

interface TextSpriteParams {
  fontface?: string;
  fontsize?: number;
  borderThickness?: number;
  borderColor?: { r: number; g: number; b: number; a: number };
  backgroundColor?: { r: number; g: number; b: number; a: number };
  textColor?: { r: number; g: number; b: number; a: number };
}

function makeTextSprite(text: string, params: TextSpriteParams = {}): THREE.Sprite {
  const fontface = params.fontface || 'monospace';
  const fontsize = params.fontsize || 24;
  const borderThickness = params.borderThickness || 4;
  const borderColor = params.borderColor || { r: 0, g: 0, b: 0, a: 1 };
  const backgroundColor = params.backgroundColor || { r: 255, g: 255, b: 255, a: 1 };
  const textColor = params.textColor || { r: 0, g: 0, b: 0, a: 1 };

  const canvas = document.createElement('canvas');
  const rawContext = canvas.getContext('2d');
  if (!rawContext) throw new Error('Failed to get 2d context');
  const context = rawContext;
  context.font = `${fontsize}px ${fontface}`;
  const metrics = context.measureText(text);
  const textWidth = metrics.width;

  canvas.width = textWidth + borderThickness * 2;
  canvas.height = fontsize * 1.4 + borderThickness * 2;

  context.fillStyle = `rgba(${backgroundColor.r}, ${backgroundColor.g}, ${backgroundColor.b}, ${backgroundColor.a})`;
  context.strokeStyle = `rgba(${borderColor.r}, ${borderColor.g}, ${borderColor.b}, ${borderColor.a})`;
  context.lineWidth = borderThickness;
  roundRect(
    context,
    borderThickness / 2,
    borderThickness / 2,
    textWidth + borderThickness,
    fontsize * 1.4 + borderThickness,
    8,
  );
  context.fill();
  context.stroke();

  context.fillStyle = `rgba(${textColor.r}, ${textColor.g}, ${textColor.b}, ${textColor.a})`;
  context.font = `${fontsize}px ${fontface}`;
  context.textBaseline = 'middle';
  context.fillText(text, borderThickness, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(spriteMaterial);
  sprite.scale.set(canvas.width / 10, canvas.height / 10, 1);
  return sprite;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function updateCubeMesh(cube: CubeState): void {
  let mesh = cubeMeshes.get(cube.id);
  if (!mesh) {
    mesh = createCubeMesh(cube);
    cubeMeshes.set(cube.id, mesh);
    scene.add(mesh);
  }

  // Smooth interpolation to authoritative position
  mesh.position.x += (cube.x - mesh.position.x) * 0.3;
  mesh.position.z += (cube.z - mesh.position.z) * 0.3;
  mesh.position.y = 1;

  const targetRotation = -cube.rotation;
  let rotationDiff = targetRotation - mesh.rotation.y;
  rotationDiff = ((rotationDiff + Math.PI) % (2 * Math.PI)) - Math.PI;
  mesh.rotation.y += rotationDiff * 0.3;

  // Update label
  const sprite = mesh.children.find((c) => c instanceof THREE.Sprite) as THREE.Sprite | undefined;
  if (sprite && sprite.material instanceof THREE.SpriteMaterial && sprite.material.map) {
    const canvas = (sprite.material.map as THREE.CanvasTexture).image as HTMLCanvasElement;
    const rawContext = canvas.getContext('2d');
    if (!rawContext) return;
    const context = rawContext;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const newText = cube.id === myCubeId ? 'YOU' : cube.id.slice(0, 8);
    context.font = '24px monospace';
    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    roundRect(context, 2, 2, canvas.width - 4, canvas.height - 4, 8);
    context.fill();
    context.fillStyle = 'white';
    context.textBaseline = 'middle';
    context.fillText(newText, 2, canvas.height / 2);
    (sprite.material.map as THREE.CanvasTexture).needsUpdate = true;
  }
}

function removeCubeMesh(cubeId: string): void {
  const mesh = cubeMeshes.get(cubeId);
  if (mesh) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    if (Array.isArray(mesh.material)) {
      for (const m of mesh.material) m.dispose();
    } else {
      mesh.material.dispose();
    }
    for (const child of mesh.children) {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          for (const m of child.material) m.dispose();
        } else {
          child.material.dispose();
        }
      } else if (child instanceof THREE.Sprite) {
        if (child.material instanceof THREE.SpriteMaterial && child.material.map) {
          (child.material.map as THREE.Texture).dispose();
        }
        child.material.dispose();
      }
    }
    cubeMeshes.delete(cubeId);
  }
}

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

function connect(): void {
  if (connecting || (ws && ws.readyState === WebSocket.OPEN)) return;

  connecting = true;
  setStatus('Connecting…', 'pending');
  setDetail(`Connecting to ${wsOrigin}...`);

  ws = new WebSocket(wsOrigin);

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
          serverTick = welcome.tick;
          cubes.clear();
          for (const id of cubeMeshes.keys()) removeCubeMesh(id);
          for (const cube of welcome.cubes) {
            cubes.set(cube.id, cube);
            updateCubeMesh(cube);
          }
          setDetail(
            `Welcome! You are ${myCubeId}\nPlayer ID: ${playerId}\nCubes: ${cubes.size}\nServer tick: ${serverTick}`,
          );
          // T00A: Load onboarding config and show hint card on first spawn
          await loadOnboardingConfig();
          showHintCard();
          break;
        }

        case MESSAGE_TYPE.STATE:
        case MESSAGE_TYPE.KEYFRAME: {
          const state = payload as StatePayload | KeyframePayload;
          serverTick = state.tick;

          const receivedIds = new Set<string>();
          for (const cube of state.cubes) {
            cubes.set(cube.id, cube);
            updateCubeMesh(cube);
            receivedIds.add(cube.id);
          }

          // Remove cubes not in state (for STATE deltas, but KEYFRAME has all)
          if (type === MESSAGE_TYPE.KEYFRAME) {
            for (const id of cubes.keys()) {
              if (!receivedIds.has(id)) {
                cubes.delete(id);
                removeCubeMesh(id);
              }
            }
          }
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
  renderer.render(scene, camera);
}

// Start
connect();
animate();
