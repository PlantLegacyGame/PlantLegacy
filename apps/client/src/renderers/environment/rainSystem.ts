/**
 * C03 weather: the falling water or snow itself.
 *
 * One instanced pass, one draw call. **Drops** are thin quads stretched along the
 * fall axis with a round head and a thinning wake; in snow mode the same
 * instances draw six-armed crystals, with a quarter of the fall speed and
 * sideways drift. Every drop reads the real terrain under it (`aGroundY`, baked
 * from the same height function the ground is drawn from), so weather stops on
 * the hillside rather than on a plane at the eye's altitude.
 *
 * What the weather *leaves behind* is no longer geometry here. Puddles and drifts
 * used to be quads laid along the terrain, and a quad is a sheet, not a pool: its
 * rim had to be fenced off from the ground and its circle cut into facets where
 * it met a slope. Standing water is now a field the soil shader reads
 * (`surfaceWaterField.ts`: R water height, G dampness, B depth), so the shoreline
 * is where the drawn ground crosses the water plane, splashes are rain rings in
 * that same surface, and nothing floats above the terrain.
 *
 * Drops are anchored in the **world**, not to the eye: each one owns a home in a
 * torus of the configured box width (`precipitationAnchor.ts`), so walking moves
 * the viewer through standing weather instead of dragging the shower along. Only
 * the copy of a drop that wraps to the far side changes its world position, and
 * that is a jump of exactly one box width.
 */

import { mulberry32 } from '@plant-legacy/shared/math';
import * as THREE from 'three';
import type { RenderConfig } from '../../config/clientConfig.js';
import { worldColour } from '../worldPalette.ts';
import { wrapToVolume } from './precipitationAnchor.ts';

export type PrecipitationMode = 'rain' | 'snow';

export interface RainSystem {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  /** Advance the fall clock while it is precipitating. */
  advance(dt: number): void;
  /** Show or hide the whole field. */
  setVisible(visible: boolean): void;
  /** Keep the field around the viewer. */
  follow(position: THREE.Vector3): void;
  /** Ground height under the eye: the fallback the field stands on. */
  setGround(groundY: number): void;
  /** The opening in the ground, as a plan circle: no drop is drawn inside it. */
  setCutaway(centerX: number, centerZ: number, radiusM: number): void;
  /** Bake the terrain under each drop. Null falls back to a plane. */
  setTerrainSampler(sample: ((x: number, z: number) => number) | null): void;
  /** Water or snow. Snow falls slower, wider, white. */
  setMode(mode: PrecipitationMode): void;
  /** Light the weather with the hour: water is not a light source. */
  setLight(color: THREE.Color, level: number): void;
  /** 1 while it is falling, 0 when dry: how hard the ground is being rained on. */
  intensity(): number;
}

/** Seed for the drop layout. Fixed, so the same field of rain is drawn on every
 * load and in every screenshot; the animation is driven by time, not position. */
const RAIN_SEED = 0x5eed1234;

const NO_GROUND = -1e6;

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
  // World x/z of this drop's copy, and its own place in the fall cycle. The
  // anchors are rewritten on the CPU only when a drop wraps, so the field stands
  // in the world while the eye walks through it.
  attribute vec2 aAnchor;
  attribute float aFall;
  attribute float aSpeed;
  attribute float aLength;
  attribute float aPhase;
  attribute float aDrift;
  attribute float aWidth;
  attribute float aGroundY;
  varying vec2 vUv;
  varying float vFade;

  void main() {
    vec3 p = vec3(aAnchor.x, 0.0, aAnchor.y);
    float fallen = mod(uTime * aSpeed * uFallScale + aFall, uBoxHeight);
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
    // this drop - a hillside, not a plane at the eye's altitude. The anchor is a
    // world position, so the baked height is compared directly.
    //
    // Both numbers have to be in the same space. The drop's column is measured
    // above the mesh origin - local, because the quad is drawn through
    // modelViewMatrix - while aGroundY is a world height. Comparing them
    // straight was a whole eye-height of ground: every drop below the eye's own
    // ground was culled, so at a 19 m ground the shower only existed from 19 to
    // 35 m up and was never seen from the player's head. One offset, and the
    // field stands on the terrain it is falling on.
    float aboveGround = world.y + modelMatrix[3].y - (aGroundY > -1e5 ? aGroundY : uGroundY);
    bool inHole = uHole.z > 0.01 && distance(world.xz, uHole.xy) < uHole.z * 0.86;
    // Snow is drawn fat, so the same count that reads as a shower reads as a
    // swarm: the flakes kept are the ones with a low phase. Three quarters of
    // them: at a bit over half, a snowfall that filled the air in the data read
    // as four crystals against a whole sky.
    bool snowThinned = uSnow > 0.5 && aPhase > 0.74;
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
      // A flake is a six-armed crystal, not a dot. The old round speck was the
      // one thing that made snow read as dust: real flakes are hexagonal plates
      // with six spokes and side branches, and that silhouette is what the eye
      // recognises even at a dozen pixels. Drawn in the quad's own space, so it
      // stays a crystal at every distance.
      vec2 q = vec2(x, (y - 0.5) * 2.0);
      float r = length(q);
      if (r > 1.0) discard;
      float ang = atan(q.y, q.x);
      // Six spokes: |cos(3w)| is 1 on six axes and 0 between them.
      float spokes = pow(max(0.0, abs(cos(3.0 * ang))), 16.0);
      // The spokes thin towards the rim, so the crystal has points, not a hexagon.
      float spokeBody = spokes * (1.0 - smoothstep(0.55, 0.98, r));
      // Side branches at half radius: two short chevrons per spoke.
      float branchAxis = pow(max(0.0, abs(cos(3.0 * (ang - 0.42)))), 44.0);
      float branchBand = exp(-pow((r - 0.58) / 0.13, 2.0));
      float branches = branchAxis * branchBand * 0.75;
      // A small bright core where the arms meet.
      float core = 1.0 - smoothstep(0.0, 0.26, r);
      float crystal = max(max(spokeBody, branches), core * 0.9);
      float alpha = uOpacity * crystal * vFade * uLight;
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
    // The tail is the water already passed through, not a lamp: it fades to a
    // quarter by the top of the quad, so a shower is a field of beads with faint
    // trails instead of a wall of bright stripes.
    float alpha = uOpacity * shape * mix(0.92, 0.22, y) * vFade * uLight;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(uColor * mix(1.0, 0.88, y), alpha);
  }
`;

export function createRainSystem(
  scene: THREE.Scene,
  config: RenderConfig,
  showRain = true,
): RainSystem {
  const count = config.rainParticleCount;
  // Where each drop belongs in the world, relative to the volume's own origin.
  // The wrapping copy (`anchors`) is the world x/z actually drawn, and it only
  // changes when a drop wraps to the far side.
  const homes = new Float32Array(count * 2);
  // NaN until the first anchor pass, so every drop's ground is baked once even
  // when its home happens to sit exactly on the origin.
  const anchors = new Float32Array(count * 2).fill(Number.NaN);
  const fallPhases = new Float32Array(count);
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
    homes[i * 2 + 0] = Math.cos(angle) * radius;
    homes[i * 2 + 1] = Math.sin(angle) * radius;
    fallPhases[i] = rand() * h;
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
  const anchorAttribute = new THREE.InstancedBufferAttribute(anchors, 2);
  anchorAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aAnchor', anchorAttribute);
  geometry.setAttribute('aFall', new THREE.InstancedBufferAttribute(fallPhases, 1));
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
  let visible = false;
  let mode: PrecipitationMode = 'rain';
  let sampler: ((x: number, z: number) => number) | null = null;
  // The eye the field was last anchored to, so a fresh terrain sampler can
  // re-bake around it without waiting for the next frame.
  let lastEyeX = 0;
  let lastEyeZ = 0;

  /**
   * Put the falling field where it belongs for this eye.
   *
   * Every frame, and cheap: a drop whose anchored copy did not wrap keeps the
   * exact world position it had, which is what makes the shower stand still
   * while the player walks through it. Only a drop that crossed the edge is
   * rewritten, and only its own ground is re-sampled.
   */
  const anchorField = (eyeX: number, eyeZ: number): void => {
    let dropsMoved = false;
    for (let i = 0; i < count; i += 1) {
      const x = wrapToVolume(homes[i * 2 + 0] ?? 0, eyeX, w);
      const z = wrapToVolume(homes[i * 2 + 1] ?? 0, eyeZ, w);
      const dx = Math.abs(x - (anchors[i * 2 + 0] ?? Number.NaN));
      const dz = Math.abs(z - (anchors[i * 2 + 1] ?? Number.NaN));
      if (dx < 1e-6 && dz < 1e-6) continue;
      anchors[i * 2 + 0] = x;
      anchors[i * 2 + 1] = z;
      // The ground under the place this drop now stands, not under its home.
      if (sampler) dropGround[i] = sampler(x, z);
      dropsMoved = true;
    }
    if (dropsMoved) {
      anchorAttribute.needsUpdate = true;
      if (sampler) dropGroundAttribute.needsUpdate = true;
    }
  };

  return {
    mesh,
    material,
    advance(dt: number) {
      // The clock only has to move while weather is drawn.
      if (visible) material.uniforms.uTime.value += dt;
    },
    setVisible(next: boolean) {
      visible = next;
      mesh.visible = next;
    },
    setGround(groundY: number) {
      // The mesh stays at the origin horizontally: the drops carry their own
      // world x/z, so there is nothing to follow. Only the vertical extent of the
      // column is set, from the ground under the eye.
      material.uniforms.uGroundY.value = groundY;
      mesh.position.y = groundY;
    },
    setCutaway(centerX: number, centerZ: number, radiusM: number) {
      // A plan circle is enough: the cut is a vertical column of air, so anything
      // over it has nothing to land on.
      const radius = Number.isFinite(radiusM) && radiusM > 0.01 ? radiusM : 0;
      (material.uniforms.uHole.value as THREE.Vector3).set(centerX, centerZ, radius);
    },
    setTerrainSampler(sample: ((x: number, z: number) => number) | null) {
      sampler = sample;
      // New terrain means every drop is standing on something it has never been
      // measured against: reset the anchors and bake all.
      anchors.fill(Number.NaN);
      anchorField(lastEyeX, lastEyeZ);
    },
    setMode(next: PrecipitationMode) {
      mode = next;
      const isSnow = next === 'snow';
      material.uniforms.uSnow.value = isSnow ? 1 : 0;
      material.uniforms.uFallScale.value = isSnow ? 0.26 : 1;
      material.uniforms.uSizeScale.value = isSnow ? 6 : 1;
      // A crystal is a wide, soft shape: at the rain's thin width its arms are
      // sub-pixel even against a bright sky.
      material.uniforms.uOpacity.value = isSnow ? 0.85 : 0.6;
      // Snow is white whatever the hour; rain takes the light.
      (material.uniforms.uColor.value as THREE.Color).copy(worldColour('sky_horizon'));
    },
    follow(position: THREE.Vector3) {
      // The field is world-anchored: wrapping is all this does, and it moves only
      // the drops that crossed the edge. The mesh stays at the origin so nothing
      // in the field slides with the eye.
      lastEyeX = position.x;
      lastEyeZ = position.z;
      anchorField(position.x, position.z);
    },
    setLight(color: THREE.Color, level: number) {
      const dim = Math.max(0.08, Math.min(1, level));
      const drop = material.uniforms.uColor.value as THREE.Color;
      // Snow keeps most of its own colour under moonlight; rain goes with the light.
      if (mode === 'snow') drop.copy(worldColour('sky_horizon')).multiplyScalar(0.55 + 0.45 * dim);
      else drop.copy(color);
      material.uniforms.uLight.value = dim;
    },
    intensity() {
      return visible ? 1 : 0;
    },
  };
}
