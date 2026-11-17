/**
 * The bolt the server rolled, drawn where it landed.
 *
 * `WEATHER_STRIKE` carries the impact point and the radius that took damage, so
 * the client can show the strike rather than a generic sky flash: a jagged
 * column from the ground point to the sky, and a ring on the ground the size of
 * the hurt area. Both are additive and fade with the same intensity the ambient
 * flash uses, so the light and the bolt are one event.
 */
import * as THREE from 'three';

const SEGMENTS = 4;
const SKY_HEIGHT_M = 70;
/** How far a mid-air joint may wander from the line, in metres. */
const JITTER_M = 2.2;

export interface LightningBolt {
  strike(x: number, y: number, z: number, radiusM: number): void;
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

export function createLightningBolt(scene: THREE.Scene): LightningBolt {
  const group = new THREE.Group();
  group.name = 'lightning-bolt';
  group.visible = false;

  const core = new THREE.MeshBasicMaterial({
    color: 0xe6f4ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const glow = new THREE.MeshBasicMaterial({
    color: 0x8fd0ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });

  // One unit-height cylinder per joint; each is scaled and turned to span its
  // two points on a strike.
  const geometry = new THREE.CylinderGeometry(0.16, 0.3, 1, 5, 1, true);
  const segments: THREE.Mesh[] = [];
  for (let i = 0; i < SEGMENTS; i += 1) {
    const mesh = new THREE.Mesh(geometry, core);
    if (i % 2 === 1) mesh.material = glow;
    segments.push(mesh);
    group.add(mesh);
  }

  const ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 1, 32), glow);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.08;
  group.add(ring);

  scene.add(group);

  const up = new THREE.Vector3(0, 1, 0);
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const span = new THREE.Vector3();

  return {
    strike(x, y, z, radiusM) {
      group.position.set(x, y, z);
      ring.scale.setScalar(Math.max(1, radiusM));
      const points = boltPoints(SKY_HEIGHT_M, SEGMENTS);
      for (let i = 0; i < SEGMENTS; i += 1) {
        from.copy(points[i]);
        to.copy(points[i + 1]);
        span.subVectors(to, from);
        const length = span.length();
        const mesh = segments[i];
        mesh.position.addVectors(from, to).multiplyScalar(0.5);
        mesh.scale.set(1, length, 1);
        mesh.quaternion.setFromUnitVectors(up, span.normalize());
      }
    },
    update(intensity) {
      const level = Number.isFinite(intensity) ? Math.min(1, Math.max(0, intensity)) : 0;
      group.visible = level > 0.001;
      if (!group.visible) return;
      // The core outlives the glow a little, so the strike reads as a bright
      // line that fades into a halo.
      core.opacity = level;
      glow.opacity = level * 0.55;
    },
    dispose() {
      scene.remove(group);
      geometry.dispose();
      core.dispose();
      glow.dispose();
      ring.geometry.dispose();
    },
  };
}
