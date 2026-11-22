/**
 * C03 weather: falling water or snow, and what it leaves on the ground.
 *
 * Three instanced passes, each one draw call:
 *
 * - **Drops** are thin quads stretched along the fall axis with a round head and
 *   a thinning wake. In snow mode the same instances draw round flakes, with a
 *   quarter of the fall speed and sideways drift.
 * - **Impact rings** open where water lands and throw no spray: one short-lived
 *   quad per ring, born and dead on its own clock.
 * - **Wet patches** are what the weather leaves behind: shallow puddles that fill
 *   while it rains and dry out afterwards, or white drifts that settle and melt
 *   slowly while it snows.
 *
 * Every drop and every patch reads the real terrain under it (`aGroundY`, baked
 * from the same height function the ground is drawn from), so weather stops on
 * the hillside rather than on a plane at the eye's altitude.
 */
import { mulberry32 } from '@plant-legacy/shared/math';
import { stepSurfaceCover } from '@plant-legacy/shared/weather';
import * as THREE from 'three';
import type { RenderConfig } from '../../config/clientConfig.js';
import { worldColour } from '../worldPalette.ts';

export type PrecipitationMode = 'rain' | 'snow';

export interface RainSystem {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  /** Advance the fall clock, and fill or dry the ground, while it is precipitating. */
  advance(dt: number): void;
  /** Show or hide the whole field. */
  setVisible(visible: boolean): void;
  /** Keep the field around the viewer. */
  follow(position: THREE.Vector3): void;
  /**
   * Anchor the water and snow lying on the ground to a world point.
   *
   * The cover used to follow the eye, so every zoom step (which moves the camera
   * several metres back) re-baked all of it at once: the puddles jumped along the
   * slope instead of staying where they had formed. The cover belongs to the
   * ground under the player, which does not move when the camera zooms.
   */
  setGroundAnchor(x: number, z: number): void;
  /** Ground height under the eye: the height the field stands on. */
  setGround(groundY: number, position: THREE.Vector3): void;
  /**
   * The opening in the ground, as a plan circle: no drop, ring or patch is drawn
   * inside it. The pit is air, not soil, so weather crossing it reads as a mesh
   * sliding over the cut.
   */
  setCutaway(centerX: number, centerZ: number, radiusM: number): void;
  /**
   * Draw the impact rings or skip the pass entirely.
   *
   * Hiding the mesh still costs the draw call, so an A/B that only sets
   * `visible = false` measures nothing: this removes the pass from the frame.
   */
  setSplashEnabled(enabled: boolean): void;
  /** Bake the terrain under each drop and patch. Null falls back to a plane. */
  setTerrainSampler(sample: ((x: number, z: number) => number) | null): void;
  /** Water or snow. Snow falls slower, wider, white, and settles. */
  setMode(mode: PrecipitationMode): void;
  /**
   * Light the weather with the hour.
   *
   * Water is not a light source: tinting every drop cyan and adding it to the
   * frame made rain glow at midnight. Drops take the colour of the light they
   * fall through and dim with it.
   */
  setLight(color: THREE.Color, level: number): void;
  /** How much water is lying on the ground, and how much snow, 0..1 each. */
  groundCover(): { water: number; snow: number };
}

const RAIN_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uBoxHeight;
  uniform float uWidth;
  uniform float uSlant;
  uniform float uGroundY;
  uniform float uFallScale;
  uniform float uSizeScale;
  uniform float uSnow;
  uniform vec3 uHole;
  attribute vec3 aOffset;
  attribute float aSpeed;
  attribute float aLength;
  attribute float aPhase;
  attribute float aDrift;
  attribute float aWidth;
  attribute float aGroundY;
  varying vec2 vUv;
  varying float vFade;

  void main() {
    vec3 p = aOffset;
    float fallen = mod(uTime * aSpeed * uFallScale + aOffset.y, uBoxHeight);
    p.y = uBoxHeight - fallen;
    // Wind is a gust, not a constant lean. Each drop has its own lean and its own
    // sway, so the field moves like weather instead of sliding down as one rigid
    // texture - one slant for every drop is what made a shower look like ruled
    // lines rather than water.
    float gust = uSlant + aDrift + sin(uTime * 0.31 + aPhase * 6.2831) * 0.06;
    p.x += gust * fallen;

    // Build the streak in world space along the fall direction and give it a
    // screen-facing width. The old shader stretched the quad in view-space XY,
    // so from above a streak became a horizontal bar and from the side it was a
    // long cyan stripe. A world fall axis projects to a short dash overhead and
    // a vertical streak from the side, which is what falling water does.
    vec3 fall = normalize(vec3(gust, 1.0, 0.0));
    // The mesh sits at the eye's column, so local space is not world space. Both
    // the view direction and the ground comparison have to be taken in the same
    // space or the field fades out and culls against a plane that is not there.
    vec3 toEye = cameraPosition - modelMatrix[3].xyz - p;
    float dist = length(toEye);
    vec3 side = cross(fall, toEye);
    if (dot(side, side) < 1e-6) side = vec3(1.0, 0.0, 0.0);
    side = normalize(side);
    // A flake is a round dot facing the eye, never a streak: stretching snow
    // along the fall axis drew white smears across the whole sky.
    vec3 world;
    if (uSnow > 0.5) {
      float size = uWidth * uSizeScale * aWidth;
      vec3 right = vec3(modelViewMatrix[0][0], modelViewMatrix[1][0], modelViewMatrix[2][0]);
      vec3 up = vec3(modelViewMatrix[0][1], modelViewMatrix[1][1], modelViewMatrix[2][1]);
      world = p + right * (position.x * size) + up * (position.y * size);
    } else {
      world = p + fall * (position.y * aLength) + side * (position.x * uWidth * aWidth);
    }

    // Weather ends where the ground is, and the ground is the real terrain under
    // this drop - a hillside, not a plane at the eye's altitude. Ground heights
    // are world heights, so bring them into the mesh's local space first.
    float groundWorld = aGroundY > -1e5 ? aGroundY : uGroundY;
    float aboveGround = world.y - (groundWorld - modelMatrix[3].y);
    bool inHole = uHole.z > 0.01 && distance(world.xz, uHole.xy) < uHole.z * 0.86;
    // Snow is drawn fat, so the same count that reads as a shower reads as a
    // swarm: the flakes that show are the ones with a low phase.
    bool snowThinned = uSnow > 0.5 && aPhase > 0.42;
    if (aboveGround < 0.0 || inHole || snowThinned) {
      vUv = uv;
      vFade = 0.0;
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    // Fade over the last centimetres so the field does not pop out of the sky at
    // the soil line.
    float landing = smoothstep(0.0, 0.14, aboveGround);

    vUv = uv;
    // A field of drops should thin out with distance rather than stack into a
    // wall, and a drop a hand's width from the eye is a blur, not a bright bar.
    float near = smoothstep(0.35, 2.2, dist);
    float far = 1.0 - smoothstep(16.0, 42.0, dist);
    vFade = (0.4 + 0.6 * aPhase) * near * far * landing;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
  }
`;

const RAIN_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uLight;
  uniform float uSnow;
  varying vec2 vUv;
  varying float vFade;

  void main() {
    float x = (vUv.x - 0.5) * 2.0;
    float y = vUv.y;
    if (uSnow > 0.5) {
      // A flake is a round, soft dot with a bright core: no wake, no stretch.
      float d = length(vec2(x, (y - 0.5) * 2.0));
      float flake = 1.0 - smoothstep(0.45, 1.0, d);
      float alpha = uOpacity * flake * vFade * uLight;
      if (alpha < 0.004) discard;
      gl_FragColor = vec4(uColor, alpha);
      return;
    }
    // A drop is a round head with the water it has already fallen through
    // trailing above it. The head is a circle in the quad's own space, so it
    // stays round at every distance; the tail narrows as it climbs.
    float head = 1.0 - smoothstep(0.55, 1.0, length(vec2(x, (y - 0.12) * 4.0)));
    float girth = mix(0.62, 0.14, y);
    float tail = (1.0 - smoothstep(0.0, girth, abs(x))) * smoothstep(0.02, 0.24, y);
    float shape = clamp(max(head, tail * 0.7), 0.0, 1.0);
    float alpha = uOpacity * shape * mix(0.95, 0.4, y) * vFade * uLight;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(uColor * mix(1.0, 0.88, y), alpha);
  }
`;

/**
 * Impact rings. A shower with no splash is water passing through the world: the
 * ground never answers it. One instanced quad per ring, laid flat, born and dead
 * on its own clock so the ground speckles instead of pulsing in step.
 */
const SPLASH_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uSpread;
  uniform vec3 uHole;
  attribute vec2 aGround;
  attribute float aPhase;
  attribute float aRate;
  attribute float aGroundY;
  varying vec2 vUv;
  varying float vAge;

  void main() {
    float age = fract(uTime * aRate + aPhase);
    // A drop hits a point and the water leaves it: the ring widens as it fades.
    float radius = mix(0.035, uSpread, age);
    vec3 local = vec3(aGround.x + position.x * radius, aGroundY + 0.04, aGround.y + position.y * radius);
    // A ring inside the opening is a ring on air: the ground is cut away there.
    vec4 world = modelMatrix * vec4(local, 1.0);
    if (uHole.z > 0.01 && distance(world.xz, uHole.xy) < uHole.z * 0.9) {
      vUv = uv;
      vAge = 1.0;
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vUv = uv;
    vAge = age;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(local, 1.0);
  }
`;

const SPLASH_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uLight;
  varying vec2 vUv;
  varying float vAge;

  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float d = length(p);
    // A ring that widens and thins, never a filled disc: a disc reads as a puddle
    // appearing and vanishing rather than water spreading.
    float ring = smoothstep(0.42 + 0.26 * vAge, 0.92, d) * (1.0 - smoothstep(0.92, 1.0, d));
    float alpha = uOpacity * ring * (1.0 - vAge) * uLight;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

/**
 * What the weather left lying on the ground.
 *
 * A patch is a flat, soft-edged disc on the terrain. Its fill is driven on the
 * CPU by one number: how wet the world is. Rain fills the shallow ones first and
 * the deep ones last, so the ground turns patchy instead of uniformly darker -
 * which was the grey wash this replaces. Snow uses the same discs, white, slower
 * to fill and much slower to melt, which is what "settling" looks like.
 */
const PATCH_VERTEX_SHADER = /* glsl */ `
  uniform vec3 uHole;
  uniform float uSnow;
  attribute vec3 aPos;
  attribute vec3 aTanU;
  attribute vec3 aTanV;
  attribute vec2 aScale;
  attribute float aFill;
  attribute float aSeed;
  varying vec2 vUv;
  varying float vFill;
  varying float vSeed;

  void main() {
    // Lying on the ground, along the ground's own slope: a disc laid flat on a
    // hillside is buried by the uphill half of itself. Water and snow follow the
    // surface they sit on.
    // A drift is smaller and softer than a puddle: snow lies in the hollows
    // rather than spreading across the whole slope.
    float sizeMul = uSnow > 0.5 ? 0.66 : 1.0;
    vec3 local =
      aPos +
      aTanU * (position.x * aScale.x * sizeMul) +
      aTanV * (position.y * aScale.y * sizeMul);
    if (uHole.z > 0.01 && distance(local.xz, uHole.xy) < uHole.z * 0.88) {
      vUv = uv;
      vFill = 0.0;
      vSeed = aSeed;
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vUv = uv;
    vFill = aFill;
    vSeed = aSeed;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(local, 1.0);
  }
`;

const PATCH_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uWaterColor;
  uniform vec3 uSnowColor;
  uniform float uSnow;
  uniform float uLight;
  varying vec2 vUv;
  varying float vFill;
  varying float vSeed;

  void main() {
    if (vFill < 0.01) discard;
    vec2 p = (vUv - 0.5) * 2.0;
    float d = length(p);
    // An irregular edge: water lying in the dirt has a shore, not a circle.
    float wobble = sin(p.x * 5.3 + vSeed * 6.28) * 0.04 + sin(p.y * 4.1 - vSeed * 4.4) * 0.04;
    // A pool has a shore; a drift has a shoulder. Water's edge is a hard smoothstep
    // two fifths of the way out, snow's feathers from a third and never reaches a
    // border at all - the flat white ellipses with cut edges were discs of paper
    // lying on the ground.
    float edgeWater = 1.0 - smoothstep(0.74 + wobble, 1.0, d);
    float edgeSnow = 1.0 - smoothstep(0.3 + wobble, 1.0, d);
    float edge = mix(edgeWater, edgeSnow, uSnow);
    // A thin, quiet meniscus at the shore. A thick bright ring made every puddle
    // look like a saucer standing on the dirt.
    float rim = smoothstep(0.84, 0.95, d) * (1.0 - smoothstep(0.95, 1.0, d));
    vec3 waterColour =
      mix(uWaterColor, uWaterColor * 1.1, 1.0 - d) + vec3(0.3, 0.34, 0.37) * rim * 0.3;
    // The drift is a mound: its crown catches the sky and its shoulder falls into
    // the soil, so the shape has volume instead of one flat white value.
    vec3 snowColour = mix(uSnowColor * 0.74, uSnowColor, pow(max(0.0, 1.0 - d), 0.55));
    vec3 colour = mix(waterColour, snowColour, uSnow);
    float alpha = vFill * edge * mix(0.58, 0.5, uSnow) * uLight;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(colour, alpha);
  }
`;

/**
 * Seed for the drop layout. Fixed, so the same field of rain is drawn on every
 * load and in every screenshot; the animation is driven by time, not position.
 */
const RAIN_SEED = 0x5eed1234;
const SPLASH_SEED = 0x51a55;
const PATCH_SEED = 0x9a71;

/** Metres the eye must move before the ground under the field is re-sampled. */
const BAKE_MOVE_M = 2.5;

const NO_GROUND = -1e6;

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
  const drifts = new Float32Array(count);
  const widths = new Float32Array(count);
  const dropGround = new Float32Array(count).fill(NO_GROUND);
  const h = config.rainBoxHeight;
  const w = config.rainBoxWidth;

  const rand = mulberry32(RAIN_SEED);
  for (let i = 0; i < count; i++) {
    // Bias the field towards the viewer. A uniform 60 m box put most drops far
    // enough away to be sub-pixel, so rain looked like it was not falling at
    // all. The stronger pull keeps the rain where it is read as rain.
    const radius = rand() ** 0.5 * 0.5 * w;
    const angle = rand() * Math.PI * 2;
    offsets[i * 3 + 0] = Math.cos(angle) * radius;
    offsets[i * 3 + 1] = rand() * h;
    offsets[i * 3 + 2] = Math.sin(angle) * radius;
    speeds[i] = config.rainParticleSpeed * (0.85 + rand() * 0.3);
    lengths[i] = config.rainStreakLength * (0.35 + rand() * 0.55);
    // A different lean and a different girth per drop: a shower where every drop
    // falls along the same line is a texture, not weather.
    drifts[i] = (rand() - 0.5) * 0.3;
    widths[i] = 0.6 + rand() * 0.95;
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
  geometry.setAttribute('aDrift', new THREE.InstancedBufferAttribute(drifts, 1));
  geometry.setAttribute('aWidth', new THREE.InstancedBufferAttribute(widths, 1));
  const dropGroundAttribute = new THREE.InstancedBufferAttribute(dropGround, 1);
  dropGroundAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aGroundY', dropGroundAttribute);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBoxHeight: { value: h },
      // Twice the configured width: 2 cm at a few metres subtends a fraction
      // of a pixel, which is why the rain read as invisible even when it ran.
      uWidth: { value: config.rainStreakWidth * 2 },
      // A cool grey, tinted by the light the drops fall through: water is not a
      // cyan light source, and adding it to the frame made every shower glow.
      uColor: { value: worldColour('sky_horizon') },
      uOpacity: { value: 0.6 },
      uLight: { value: 1 },
      uSlant: { value: config.rainSlant },
      // Fallback when no terrain sampler is connected, plus the cut in the ground.
      uGroundY: { value: 0 },
      uFallScale: { value: 1 },
      uSizeScale: { value: 1 },
      uSnow: { value: 0 },
      uHole: { value: new THREE.Vector3(0, 0, 0) },
    },
    vertexShader: RAIN_VERTEX_SHADER,
    fragmentShader: RAIN_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    // Normal alpha blending, not additive: drops darken what is behind them as
    // much as they brighten it, and additive water only ever glows.
    blending: THREE.NormalBlending,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.visible = false;
  if (showRain) scene.add(mesh);

  // Splashes share the drop count's budget at a twelfth of it: rings are cheap but
  // they are not the weather, the drops are.
  const splashCount = Math.max(64, Math.round(count * 0.12));
  const groundXZ = new Float32Array(splashCount * 2);
  const splashGround = new Float32Array(splashCount);
  const splashPhases = new Float32Array(splashCount);
  const splashRates = new Float32Array(splashCount);
  const splashRand = mulberry32(SPLASH_SEED);
  for (let i = 0; i < splashCount; i += 1) {
    // Rings only where they can be seen: within a dozen metres of the eye.
    const radius = splashRand() ** 0.6 * 12;
    const angle = splashRand() * Math.PI * 2;
    groundXZ[i * 2 + 0] = Math.cos(angle) * radius;
    groundXZ[i * 2 + 1] = Math.sin(angle) * radius;
    splashPhases[i] = splashRand();
    splashRates[i] = 0.9 + splashRand() * 0.9;
  }

  const splashQuad = new THREE.PlaneGeometry(1, 1);
  const splashGeometry = new THREE.InstancedBufferGeometry();
  splashGeometry.index = splashQuad.index;
  splashGeometry.setAttribute('position', splashQuad.getAttribute('position'));
  splashGeometry.setAttribute('uv', splashQuad.getAttribute('uv'));
  splashGeometry.instanceCount = splashCount;
  splashGeometry.setAttribute('aGround', new THREE.InstancedBufferAttribute(groundXZ, 2));
  splashGeometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(splashPhases, 1));
  splashGeometry.setAttribute('aRate', new THREE.InstancedBufferAttribute(splashRates, 1));
  const splashGroundAttribute = new THREE.InstancedBufferAttribute(splashGround, 1);
  splashGroundAttribute.setUsage(THREE.DynamicDrawUsage);
  splashGeometry.setAttribute('aGroundY', splashGroundAttribute);

  const splashMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSpread: { value: 0.17 },
      uColor: { value: worldColour('sky_horizon') },
      uOpacity: { value: 0.5 },
      uLight: { value: 1 },
      uHole: { value: new THREE.Vector3(0, 0, 0) },
    },
    vertexShader: SPLASH_VERTEX_SHADER,
    fragmentShader: SPLASH_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const splashMesh = new THREE.Mesh(splashGeometry, splashMaterial);
  splashMesh.frustumCulled = false;
  splashMesh.visible = false;
  let splashesRequested = true;
  let splashesAllowed = false;
  if (showRain) scene.add(splashMesh);

  // Wet patches: enough of them to break the ground into puddles, few enough
  // that filling them every frame is free.
  const patchCount = 90;
  const patchPos = new Float32Array(patchCount * 3);
  const patchTanU = new Float32Array(patchCount * 3);
  const patchTanV = new Float32Array(patchCount * 3);
  const patchScale = new Float32Array(patchCount * 2);
  const patchFill = new Float32Array(patchCount);
  const patchSeed = new Float32Array(patchCount);
  const patchThreshold = new Float32Array(patchCount);
  // Offsets from the eye, and the size of the patch they belong to.
  const patchLocalX = new Float32Array(patchCount);
  const patchLocalZ = new Float32Array(patchCount);
  // ------------------------------------------------------------------ landings
  // Where the water actually comes down.
  //
  // The drop field's own layout is the only evidence the client has of where on
  // the ground the rain is heaviest: every drop has a fixed plan position, so a
  // coarse histogram of those positions is a map of landings per square metre.
  // The pools are placed and sized from it, instead of each patch rolling its own
  // dice next to a shower that never touched it.
  const LANDING_BINS = 9;
  const landingSpanM = Math.max(6, w * 0.45);
  const landing = new Float32Array(LANDING_BINS * LANDING_BINS);
  const landingBin = (value: number): number => {
    const t = ((value / landingSpanM) * 0.5 + 0.5) * LANDING_BINS;
    return Math.min(LANDING_BINS - 1, Math.max(0, Math.floor(t)));
  };
  for (let i = 0; i < count; i += 1) {
    const bx = landingBin(offsets[i * 3 + 0] ?? 0);
    const bz = landingBin(offsets[i * 3 + 2] ?? 0);
    landing[bz * LANDING_BINS + bx] = (landing[bz * LANDING_BINS + bx] ?? 0) + 1;
  }
  let landingPeak = 0;
  for (const value of landing) landingPeak = Math.max(landingPeak, value);
  /** Rain per square metre here, relative to the heaviest square in the field. */
  const landingDensity = (x: number, z: number): number => {
    if (landingPeak <= 0) return 0;
    const value = landing[landingBin(z) * LANDING_BINS + landingBin(x)] ?? 0;
    return Math.min(1, value / landingPeak);
  };

  const patchRand = mulberry32(PATCH_SEED);
  const placedX: number[] = [];
  const placedZ: number[] = [];
  const placedR: number[] = [];
  for (let i = 0; i < patchCount; i += 1) {
    // A puddle is one pool, not a stack of stains. Overlapping translucent discs
    // blend twice where they cross, so the ground read as a dark patchwork with
    // visible disc edges. Every patch is now placed with its rim clear of every
    // patch already placed, and its size follows the rain over it: a corner the
    // shower barely reached holds a small pool, the middle of the fall a wide one.
    let placed = false;
    for (let attempt = 0; attempt < 26 && !placed; attempt += 1) {
      const angle = patchRand() * Math.PI * 2;
      const spread = patchRand() ** 0.55 * 13;
      const x = Math.cos(angle) * spread;
      const z = Math.sin(angle) * spread;
      const density = landingDensity(x, z);
      // Below a quarter of the peak the ground stays dry - a puddle there is water
      // lying where no rain fell.
      if (density < 0.24) continue;
      const radius = 0.32 + density * 1.6 * (0.8 + patchRand() * 0.45);
      let clear = true;
      for (let j = 0; j < placedX.length; j += 1) {
        const gap = radius + (placedR[j] ?? 0) + 0.06;
        const dx = x - (placedX[j] ?? 0);
        const dz = z - (placedZ[j] ?? 0);
        if (dx * dx + dz * dz < gap * gap) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      placedX.push(x);
      placedZ.push(z);
      placedR.push(radius);
      patchLocalX[i] = x;
      patchLocalZ[i] = z;
      patchScale[i * 2 + 0] = radius;
      patchScale[i * 2 + 1] = radius * (0.72 + patchRand() * 0.55);
      patchSeed[i] = patchRand();
      // Heavy rain fills its pool sooner and fuller than a drizzle fills one in a
      // hollow it only skirted.
      patchThreshold[i] = 0.72 - density * 0.52;
      placed = true;
    }
    if (!placed) {
      // No room left in the field: this instance stays empty rather than sitting
      // on top of another pool.
      patchLocalX[i] = 0;
      patchLocalZ[i] = 0;
      patchScale[i * 2 + 0] = 0.01;
      patchScale[i * 2 + 1] = 0.01;
      patchSeed[i] = patchRand();
      patchThreshold[i] = 2;
    }
    patchPos[i * 3 + 0] = patchLocalX[i];
    patchPos[i * 3 + 1] = 0;
    patchPos[i * 3 + 2] = patchLocalZ[i];
    // Flat until the terrain is sampled.
    patchTanU[i * 3 + 0] = 1;
    patchTanV[i * 3 + 2] = 1;
  }

  const patchGeometry = new THREE.InstancedBufferGeometry();
  patchGeometry.index = quad.index;
  patchGeometry.setAttribute('position', quad.getAttribute('position'));
  patchGeometry.setAttribute('uv', quad.getAttribute('uv'));
  patchGeometry.instanceCount = patchCount;
  const patchPosAttribute = new THREE.InstancedBufferAttribute(patchPos, 3);
  patchPosAttribute.setUsage(THREE.DynamicDrawUsage);
  patchGeometry.setAttribute('aPos', patchPosAttribute);
  const patchTanUAttribute = new THREE.InstancedBufferAttribute(patchTanU, 3);
  patchTanUAttribute.setUsage(THREE.DynamicDrawUsage);
  patchGeometry.setAttribute('aTanU', patchTanUAttribute);
  const patchTanVAttribute = new THREE.InstancedBufferAttribute(patchTanV, 3);
  patchTanVAttribute.setUsage(THREE.DynamicDrawUsage);
  patchGeometry.setAttribute('aTanV', patchTanVAttribute);
  patchGeometry.setAttribute('aScale', new THREE.InstancedBufferAttribute(patchScale, 2));
  const patchFillAttribute = new THREE.InstancedBufferAttribute(patchFill, 1);
  patchFillAttribute.setUsage(THREE.DynamicDrawUsage);
  patchGeometry.setAttribute('aFill', patchFillAttribute);
  patchGeometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(patchSeed, 1));

  const patchMaterial = new THREE.ShaderMaterial({
    uniforms: {
      // Puddle water is the sky it reflects, pulled toward the soil it sits in, so
      // it never reads as a grey sticker on brown dirt.
      uWaterColor: { value: worldColour('water_deep') },
      uSnowColor: { value: worldColour('sky_horizon') },
      uSnow: { value: 0 },
      uLight: { value: 1 },
      uHole: { value: new THREE.Vector3(0, 0, 0) },
    },
    vertexShader: PATCH_VERTEX_SHADER,
    fragmentShader: PATCH_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    // The quad is laid along the terrain's tangents, whose cross product points
    // down into the ground; without this every puddle was culled as a back face.
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });

  const patchMesh = new THREE.Mesh(patchGeometry, patchMaterial);
  patchMesh.frustumCulled = false;
  patchMesh.visible = false;
  if (showRain) scene.add(patchMesh);

  let sampler: ((x: number, z: number) => number) | null = null;
  let mode: PrecipitationMode = 'rain';
  let water = 0;
  let snow = 0;
  let visible = false;
  let lastBakeX = Number.POSITIVE_INFINITY;
  let lastBakeZ = Number.POSITIVE_INFINITY;
  let eyeGroundY = 0;
  // The ground cover's anchor (the player's feet). NaN until the world tells us,
  // which falls back to the eye so a test scene still gets puddles.
  let groundAnchorX = Number.NaN;
  let groundAnchorZ = Number.NaN;

  /** Re-sample the terrain under every drop, ring and patch around the eye. */
  const bakeGround = (eyeX: number, eyeZ: number): void => {
    // `eyeX/eyeZ` is the cover's anchor (the player's feet), not necessarily the
    // camera: see `setGroundAnchor`.
    lastBakeX = eyeX;
    lastBakeZ = eyeZ;
    if (!sampler) {
      // No terrain field (a flat test world): everything sits on the plane under
      // the eye, which is what the old build did everywhere.
      for (let i = 0; i < patchCount; i += 1) {
        patchPos[i * 3 + 0] = eyeX + patchLocalX[i];
        patchPos[i * 3 + 2] = eyeZ + patchLocalZ[i];
        patchPos[i * 3 + 1] = eyeGroundY + 0.05;
      }
      patchPosAttribute.needsUpdate = true;
      return;
    }
    for (let i = 0; i < count; i += 1) {
      const x = eyeX + offsets[i * 3 + 0];
      const z = eyeZ + offsets[i * 3 + 2];
      dropGround[i] = sampler(x, z);
    }
    dropGroundAttribute.needsUpdate = true;
    for (let i = 0; i < splashCount; i += 1) {
      const x = eyeX + groundXZ[i * 2 + 0];
      const z = eyeZ + groundXZ[i * 2 + 1];
      // Rings sit a centimetre proud of the patch's own ground.
      splashGround[i] = sampler(x, z);
    }
    splashGroundAttribute.needsUpdate = true;
    for (let i = 0; i < patchCount; i += 1) {
      const x = eyeX + patchLocalX[i];
      const z = eyeZ + patchLocalZ[i];
      const y = sampler(x, z);
      // Slope of the ground here, so the patch can lie along it instead of
      // being cut in half by it. A metre either side is the scale of a puddle.
      const step = 0.7;
      const dx = (sampler(x + step, z) - sampler(x - step, z)) / (2 * step);
      const dz = (sampler(x, z + step) - sampler(x, z - step)) / (2 * step);
      const lenU = Math.hypot(1, dx) || 1;
      const lenV = Math.hypot(1, dz) || 1;
      patchPos[i * 3 + 0] = x;
      patchPos[i * 3 + 2] = z;
      // Above the drawn skin, not on it: a puddle two centimetres off the ground
      // fights the terrain for the depth test and loses half of itself.
      patchPos[i * 3 + 1] = y + 0.05;
      patchTanU[i * 3 + 0] = 1 / lenU;
      patchTanU[i * 3 + 1] = dx / lenU;
      patchTanV[i * 3 + 1] = dz / lenV;
      patchTanV[i * 3 + 2] = 1 / lenV;
    }
    patchPosAttribute.needsUpdate = true;
    patchTanUAttribute.needsUpdate = true;
    patchTanVAttribute.needsUpdate = true;
  };

  const writeFill = (dt: number): void => {
    let any = false;
    // Frame-rate independent: 0.18 per frame was twice as fast at 120 Hz as at 60.
    const rate = 1 - Math.exp(-dt * 6);
    for (let i = 0; i < patchCount; i += 1) {
      const cover = mode === 'snow' ? snow : water;
      // A patch is full where the ground is wetter than its own threshold, and
      // its rim soaks in over a short band.
      const target =
        cover <= patchThreshold[i] ? 0 : Math.min(1, (cover - patchThreshold[i]) / 0.22);
      const next = patchFill[i] + (target - patchFill[i]) * rate;
      if (Math.abs(next - patchFill[i]) > 0.002) {
        patchFill[i] = next;
        any = true;
      }
    }
    if (any) patchFillAttribute.needsUpdate = true;
    let alive = false;
    for (let i = 0; i < patchCount; i += 1) {
      if (patchFill[i] > 0.01) {
        alive = true;
        break;
      }
    }
    // The cover stays up while it dries or melts. Hiding it the instant the rain
    // stopped was the whole reason the ground never looked wet afterwards.
    patchMesh.visible = alive;
  };

  return {
    mesh,
    material,
    advance(dt: number) {
      // The clock only has to move while weather is drawn; the ground still
      // fills and dries after the shower has stopped, so it runs every frame.
      if (visible) {
        material.uniforms.uTime.value += dt;
        splashMaterial.uniforms.uTime.value += dt;
      }
      // What the ground holds, from the shared rules (see
      // `packages/shared/src/weather/surfaceCover.ts`): water fills from the rain
      // reaching it and drains whenever the rain is below full, snow settles slowly
      // and melts slower, and rain washes snow away. The title screen's pools and
      // drifts run the same rules with the same numbers, so the two skies leave the
      // same ground. Neither is instant, which is what makes the ground look like it
      // is holding the weather rather than being tinted by it.
      const falling = visible ? mode : null;
      const cover = stepSurfaceCover(
        { water, snow },
        { rain: falling === 'rain' ? 1 : 0, snow: falling === 'snow' ? 1 : 0 },
        dt,
      );
      water = cover.water;
      snow = cover.snow;
      // Always: what is already lying on the ground keeps filling or drying
      // whether or not anything is still falling, and a covering layer that is not
      // updated cannot fade out.
      writeFill(dt);
    },
    setVisible(next: boolean) {
      visible = next;
      mesh.visible = next;
      splashMesh.visible = next && splashesRequested && mode === 'rain';
      splashesAllowed = next;
      // The ground cover is not hidden with the fall: it is what the shower left
      // behind, and it dries over the next half minute (see advance).
    },
    setSplashEnabled(enabled: boolean) {
      splashesRequested = enabled;
      splashMesh.visible = enabled && splashesAllowed && mode === 'rain';
    },
    setGroundAnchor(x: number, z: number) {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return;
      groundAnchorX = x;
      groundAnchorZ = z;
    },
    setGround(groundY: number, position: THREE.Vector3) {
      splashMesh.position.set(position.x, 0, position.z);
      material.uniforms.uGroundY.value = groundY;
      mesh.position.y = groundY;
      eyeGroundY = groundY;
    },
    setCutaway(centerX: number, centerZ: number, radiusM: number) {
      // A plan circle is enough: the cut is a vertical column of air, so anything
      // over it has nothing to land on.
      const radius = Number.isFinite(radiusM) && radiusM > 0.01 ? radiusM : 0;
      for (const uniforms of [material.uniforms, splashMaterial.uniforms, patchMaterial.uniforms]) {
        (uniforms.uHole.value as THREE.Vector3).set(centerX, centerZ, radius);
      }
    },
    setTerrainSampler(sample: ((x: number, z: number) => number) | null) {
      sampler = sample;
      lastBakeX = Number.POSITIVE_INFINITY;
      bakeGround(mesh.position.x, mesh.position.z);
    },
    setMode(next: PrecipitationMode) {
      mode = next;
      const isSnow = next === 'snow';
      material.uniforms.uSnow.value = isSnow ? 1 : 0;
      material.uniforms.uFallScale.value = isSnow ? 0.26 : 1;
      material.uniforms.uSizeScale.value = isSnow ? 7 : 1;
      // A flake is a fat, soft dot: at the rain's thin width it is a sub-pixel
      // speck even against a bright sky.
      material.uniforms.uOpacity.value = isSnow ? 0.85 : 0.6;
      patchMaterial.uniforms.uSnow.value = isSnow ? 1 : 0;
      splashMesh.visible = visible && splashesRequested && !isSnow;
      // Snow is white whatever the hour; rain takes the light.
      (material.uniforms.uColor.value as THREE.Color).copy(worldColour('sky_horizon'));
      (splashMaterial.uniforms.uColor.value as THREE.Color).copy(worldColour('sky_horizon'));
    },
    follow(position: THREE.Vector3) {
      // Follow the eye horizontally; the vertical span is set from the ground in
      // setGround. Centring the box on the eye put half of it underground.
      mesh.position.x = position.x;
      mesh.position.z = position.z;
      splashMesh.position.x = position.x;
      splashMesh.position.z = position.z;
      // The cover is baked around the ground anchor, never around the eye. Zooming
      // or orbiting moves the camera several metres and used to rebuild every
      // puddle at a new spot; the ground under the player is what it belongs to.
      const anchorX = Number.isFinite(groundAnchorX) ? groundAnchorX : position.x;
      const anchorZ = Number.isFinite(groundAnchorZ) ? groundAnchorZ : position.z;
      // Snapped to a world lattice: the puddles then belong to a place, not to the
      // walk. A bake every metre re-randomised the whole set under the player and
      // read as water sliding uphill.
      const snappedX = Math.round(anchorX / BAKE_MOVE_M) * BAKE_MOVE_M;
      const snappedZ = Math.round(anchorZ / BAKE_MOVE_M) * BAKE_MOVE_M;
      if (Math.hypot(snappedX - lastBakeX, snappedZ - lastBakeZ) > 0.01) {
        bakeGround(snappedX, snappedZ);
      }
      if (sampler) {
        // The column stands on the ground under the eye, not at its altitude.
        mesh.position.y = eyeGroundY;
      }
    },
    setLight(color: THREE.Color, level: number) {
      const dim = Math.max(0.08, Math.min(1, level));
      const drop = material.uniforms.uColor.value as THREE.Color;
      // Snow keeps most of its own colour under moonlight; rain goes with the light.
      if (mode === 'snow') drop.copy(worldColour('sky_horizon')).multiplyScalar(0.55 + 0.45 * dim);
      else drop.copy(color);
      material.uniforms.uLight.value = dim;
      (splashMaterial.uniforms.uColor.value as THREE.Color).copy(color);
      splashMaterial.uniforms.uLight.value = dim;
      // A puddle is sky-coloured water: it lightens with the sky and goes dark at
      // night rather than staying a bright disc.
      // Water is the colour of the sky above it, deepened towards a wet blue so a
      // puddle reads as water on brown earth instead of a grey smear.
      // Water is *lighter* than the soil it lies on, not darker: a pool reflects
      // the sky, so on sunlit earth it reads as a pale blue lens. At 0.4 of the
      // light the pools were dark discs punched into the ground.
      (patchMaterial.uniforms.uWaterColor.value as THREE.Color)
        .copy(color)
        .lerp(worldColour('water_shallow'), 0.42)
        .multiplyScalar(0.62 + 0.38 * dim);
      patchMaterial.uniforms.uLight.value = Math.max(0.25, dim);
    },
    groundCover() {
      return { water, snow };
    },
  };
}
