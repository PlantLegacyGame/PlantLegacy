/**
 * The bolt the server rolled, drawn where it landed.
 *
 * `WEATHER_STRIKE` carries the impact point and the radius that took damage, so
 * the client can show the strike rather than a generic sky flash.
 *
 * The first version built the bolt from four cylinders. Each one was five-sided
 * and thin, but a straight additive column seen from the side is a bright
 * rectangle, and that is exactly what it looked like: a white bar that appeared
 * and vanished. A real bolt is a branching line. This one draws a jagged trunk
 * with forks as camera-facing ribbons - a bright thin core inside a wider, softer
 * glow - over a soft ground flash the size of the hurt area, and it flickers over
 * its short life instead of fading as one flat block.
 */
import * as THREE from 'three';

const TRUNK_SEGMENTS = 14;
const SKY_HEIGHT_M = 90;
/** How far a mid-air joint may wander from the line, in metres. */
const JITTER_M = 2.2;
/** Where along the trunk the forks leave it, as fractions of the climb. */
const FORK_AT = [0.4, 0.58, 0.74];

export interface LightningBolt {
  /**
   * Draw a bolt at the impact point. `eye` is where the flash is seen from: the
   * ribbons are built to face it, because a flat ribbon seen edge-on vanishes.
   */
  strike(x: number, y: number, z: number, radiusM: number, eye: THREE.Vector3): void;
  update(intensity: number): void;
  dispose(): void;
}

/**
 * The joints of a bolt from the ground to `heightM`, in local space.
 *
 * The first point is the impact and the last is in the sky; every joint between
 * them wanders so the column reads as lightning rather than a pillar. Pure, so
 * the placement can be tested without a renderer.
 */
export function boltPoints(
  heightM: number,
  segments: number,
  random: () => number = Math.random,
): THREE.Vector3[] {
  const count = Math.max(1, Math.round(segments));
  const points: THREE.Vector3[] = [];
  let x = 0;
  let z = 0;
  for (let i = 0; i <= count; i += 1) {
    if (i > 0 && i < count) {
      // A random walk, but bounded: an unbounded one drifts several metres off
      // the impact point and the bolt stops reading as landing there.
      x = clampJitter(x + (random() - 0.5) * JITTER_M * 2);
      z = clampJitter(z + (random() - 0.5) * JITTER_M * 2);
    }
    points.push(new THREE.Vector3(x, (heightM * i) / count, z));
  }
  return points;
}

function clampJitter(value: number): number {
  const limit = JITTER_M * 2;
  return Math.max(-limit, Math.min(limit, value));
}

/**
 * A fork leaving `start`, heading out and up at a shallow angle.
 *
 * `heading` is the horizontal unit direction the branch leans towards; the fork
 * climbs `climbM` while wandering sideways, so it reads as the same bolt
 * splitting rather than as a second, smaller bolt beside it.
 */
export function forkPoints(
  start: THREE.Vector3,
  heading: THREE.Vector3,
  climbM: number,
  segments: number,
  random: () => number = Math.random,
): THREE.Vector3[] {
  const count = Math.max(1, Math.round(segments));
  const points: THREE.Vector3[] = [start.clone()];
  const step = climbM / count;
  for (let i = 1; i <= count; i += 1) {
    const previous = points[i - 1];
    const sideways = (0.55 + random() * 0.9) * step;
    const wander = (random() - 0.5) * step * 0.5;
    points.push(
      new THREE.Vector3(
        previous.x + heading.x * sideways - heading.z * wander,
        previous.y + step * (0.72 + random() * 0.35),
        previous.z + heading.z * sideways + heading.x * wander,
      ),
    );
  }
  return points;
}

/**
 * A camera-facing triangle strip along a polyline.
 *
 * Billboarding matters here: a flat ribbon seen edge-on disappears, and the
 * cylinders it replaces were visible from exactly one side. The camera position at
 * the moment of the strike is enough - the whole bolt lives for a tenth of a
 * second, so its ribbons cannot be seen from an angle they were not built for.
 */
function ribbonGeometry(
  points: THREE.Vector3[],
  cameraPosition: THREE.Vector3,
  widthAt: (fraction: number) => number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const dir = new THREE.Vector3();
  const side = new THREE.Vector3();
  const toEye = new THREE.Vector3();
  const fallback = new THREE.Vector3(1, 0, 0);
  const count = points.length;
  for (let i = 0; i < count; i += 1) {
    const point = points[i];
    const previous = points[Math.max(0, i - 1)];
    const next = points[Math.min(count - 1, i + 1)];
    dir.subVectors(next, previous).normalize();
    toEye.subVectors(cameraPosition, point);
    side.crossVectors(dir, toEye);
    if (side.lengthSq() < 1e-8) side.copy(fallback);
    side.normalize().multiplyScalar(widthAt(count === 1 ? 0 : i / (count - 1)));
    positions.push(point.x - side.x, point.y - side.y, point.z - side.z);
    positions.push(point.x + side.x, point.y + side.y, point.z + side.z);
    if (i < count - 1) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

const GROUND_GLOW_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GROUND_GLOW_FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    // A pool of light on the soil, not a ring: the ring read as a white hoop
    // dropped on the ground rather than the flash of a strike landing.
    float radius = length(vUv - vec2(0.5)) * 2.0;
    float glow = pow(max(0.0, 1.0 - radius), 3.0);
    if (glow < 0.004) discard;
    gl_FragColor = vec4(vec3(0.86, 0.93, 1.0), glow * uOpacity);
  }
`;

export function createLightningBolt(scene: THREE.Scene): LightningBolt {
  const group = new THREE.Group();
  group.name = 'lightning-bolt';
  group.visible = false;

  const coreMaterial = new THREE.MeshBasicMaterial({
    color: 0xeef7ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0x7fb8ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });

  const core = new THREE.Mesh(new THREE.BufferGeometry(), coreMaterial);
  const glow = new THREE.Mesh(new THREE.BufferGeometry(), glowMaterial);
  core.frustumCulled = false;
  glow.frustumCulled = false;
  core.renderOrder = 5;
  glow.renderOrder = 4;
  group.add(glow, core);

  const groundGlowMaterial = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 } },
    vertexShader: GROUND_GLOW_VERTEX,
    fragmentShader: GROUND_GLOW_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const groundGlow = new THREE.Mesh(new THREE.CircleGeometry(1, 40), groundGlowMaterial);
  groundGlow.rotation.x = -Math.PI / 2;
  groundGlow.position.y = 0.06;
  group.add(groundGlow);

  scene.add(group);

  let struckAtMs = 0;
  const cameraPosition = new THREE.Vector3();
  const heading = new THREE.Vector3();

  const disposeBoltGeometry = (): void => {
    core.geometry.dispose();
    glow.geometry.dispose();
  };

  return {
    strike(x, y, z, radiusM, eye) {
      group.position.set(x, y, z);
      groundGlow.scale.setScalar(Math.max(1, radiusM));
      // The ribbons are built around the impact point, in the group's local frame.
      cameraPosition.set(eye.x - x, eye.y - y, eye.z - z);
      struckAtMs = performance.now();

      const trunk = boltPoints(SKY_HEIGHT_M, TRUNK_SEGMENTS);
      const paths: Array<{ points: THREE.Vector3[]; core: number; glow: number }> = [
        // Slim, and slimmer with height. A wide glow ribbon is the thing that made
        // the old bolt a white slab: a strike lands a few metres from the eye, and
        // at that range a metre-wide band of additive light fills half the frame.
        { points: trunk, core: 0.13, glow: 0.42 },
      ];
      for (const fraction of FORK_AT) {
        const index = Math.min(trunk.length - 1, Math.round(fraction * (trunk.length - 1)));
        const start = trunk[index];
        const angle = Math.random() * Math.PI * 2;
        heading.set(Math.cos(angle), 0, Math.sin(angle));
        const forkTrunk = forkPoints(start, heading, 10 + Math.random() * 12, 5);
        paths.push({ points: forkTrunk, core: 0.07, glow: 0.24 });
      }

      disposeBoltGeometry();
      const coreParts: THREE.BufferGeometry[] = [];
      const glowParts: THREE.BufferGeometry[] = [];
      for (const path of paths) {
        // Tapered along its length: thick where it leaves the cloud base, thin by
        // the time it reaches the ground, which is how a real channel narrows.
        coreParts.push(
          ribbonGeometry(path.points, cameraPosition, (t) => path.core * (0.55 + 0.45 * t)),
        );
        glowParts.push(
          ribbonGeometry(path.points, cameraPosition, (t) => path.glow * (0.35 + 0.65 * t)),
        );
      }
      const mergeOrFirst = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry =>
        parts.length === 1 ? parts[0] : mergeGeometries(parts);
      core.geometry = mergeOrFirst(coreParts);
      glow.geometry = mergeOrFirst(glowParts);
    },
    update(intensity) {
      const level = Number.isFinite(intensity) ? Math.min(1, Math.max(0, intensity)) : 0;
      group.visible = level > 0.001;
      groundGlowMaterial.uniforms.uOpacity.value = 0;
      if (!group.visible) return;
      // A strike is not one flat brightness: it flickers over its short life, which
      // is most of what makes lightning look like lightning.
      const elapsed = performance.now() - struckAtMs;
      const flicker =
        elapsed < 22 ? 1 : elapsed < 45 ? 0.42 : elapsed < 70 ? 0.94 : elapsed < 95 ? 0.6 : 1;
      // The core outlives the glow a little, so the strike reads as a bright
      // line that fades into a halo.
      coreMaterial.opacity = level * flicker;
      glowMaterial.opacity = level * flicker * 0.3;
      groundGlowMaterial.uniforms.uOpacity.value = level * flicker * 0.35;
    },
    dispose() {
      scene.remove(group);
      disposeBoltGeometry();
      coreMaterial.dispose();
      glowMaterial.dispose();
      groundGlow.geometry.dispose();
      groundGlowMaterial.dispose();
    },
  };
}

/** Merge simple position-only geometries into one, so a bolt is two draw calls. */
function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;
  for (const part of parts) {
    const position = part.getAttribute('position');
    for (let i = 0; i < position.count; i += 1) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
    }
    const index = part.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i += 1) indices.push(index.getX(i) + vertexOffset);
    }
    vertexOffset += position.count;
    part.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (indices.length > 0) merged.setIndex(indices);
  return merged;
}
