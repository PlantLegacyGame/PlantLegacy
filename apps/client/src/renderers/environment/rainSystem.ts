/**
 * C03 rain: one instanced draw call of stretched quads.
 *
 * Each instance is a thin quad stretched along the fall axis with a soft tail,
 * so drops read as falling water rather than round billboards. The fall itself
 * happens in the vertex shader, so the CPU only advances a clock and keeps the
 * field centred on the camera.
 */
import { mulberry32 } from '@plant-legacy/shared/math';
import * as THREE from 'three';
import type { RenderConfig } from '../../config/clientConfig.js';

export interface RainSystem {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  /** Advance the fall clock while it is raining. */
  advance(dt: number): void;
  /** Show or hide the whole field. */
  setVisible(visible: boolean): void;
  /** Keep the field around the viewer. */
  follow(position: THREE.Vector3): void;
}

const RAIN_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uBoxHeight;
  uniform float uWidth;
  uniform float uSlant;
  attribute vec3 aOffset;
  attribute float aSpeed;
  attribute float aLength;
  attribute float aPhase;
  varying vec2 vUv;
  varying float vFade;

  void main() {
    vec3 p = aOffset;
    float fallen = mod(uTime * aSpeed + aOffset.y, uBoxHeight);
    p.y = uBoxHeight - fallen;
    p.x += uSlant * fallen;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    mv.xy += vec2(position.x * uWidth + position.y * aLength * uSlant, position.y * aLength);

    vUv = uv;
    vFade = 0.45 + 0.55 * aPhase;
    gl_Position = projectionMatrix * mv;
  }
`;

const RAIN_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vFade;

  void main() {
    float acrossEdge = smoothstep(0.0, 0.4, vUv.x) * smoothstep(1.0, 0.6, vUv.x);
    float tail = smoothstep(0.0, 0.7, vUv.y);
    float alpha = uOpacity * acrossEdge * tail * vFade;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

/**
 * Seed for the drop layout. Fixed, so the same field of rain is drawn on every
 * load and in every screenshot; the animation is driven by time, not position.
 */
const RAIN_SEED = 0x5eed1234;

export function createRainSystem(
  scene: THREE.Scene,
  config: RenderConfig,
  showRain = true,
): RainSystem {
  const count = config.rainParticleCount;
  const offsets = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const lengths = new Float32Array(count);
  const phases = new Float32Array(count);
  const h = config.rainBoxHeight;
  const w = config.rainBoxWidth;

  const rand = mulberry32(RAIN_SEED);
  for (let i = 0; i < count; i++) {
    offsets[i * 3 + 0] = (rand() - 0.5) * w;
    offsets[i * 3 + 1] = rand() * h;
    offsets[i * 3 + 2] = (rand() - 0.5) * w;
    speeds[i] = config.rainParticleSpeed * (0.85 + rand() * 0.3);
    lengths[i] = config.rainStreakLength * (0.5 + rand() * 0.7);
    phases[i] = rand();
  }

  const quad = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.getAttribute('position'));
  geometry.setAttribute('uv', quad.getAttribute('uv'));
  geometry.instanceCount = count;
  geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
  geometry.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(speeds, 1));
  geometry.setAttribute('aLength', new THREE.InstancedBufferAttribute(lengths, 1));
  geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBoxHeight: { value: h },
      uWidth: { value: config.rainStreakWidth },
      uColor: { value: new THREE.Color(0xa8c2d4) },
      uOpacity: { value: 0.5 },
      uSlant: { value: config.rainSlant },
    },
    vertexShader: RAIN_VERTEX_SHADER,
    fragmentShader: RAIN_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.visible = false;
  if (showRain) scene.add(mesh);

  return {
    mesh,
    material,
    advance(dt: number) {
      material.uniforms.uTime.value += dt;
    },
    setVisible(visible: boolean) {
      mesh.visible = visible;
    },
    follow(position: THREE.Vector3) {
      mesh.position.set(position.x, 0, position.z);
    },
  };
}
