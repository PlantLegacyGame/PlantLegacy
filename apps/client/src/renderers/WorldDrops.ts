/**
 * World drops, drawn.
 *
 * The server has always broadcast `DROP_SPAWN` / `DROP_EXPIRED`; the client had a
 * handler that did nothing, so a plant that died left remains nobody could see and
 * a swarm left dung nobody could take. That made the death loop's reward path and
 * one of the spore sources dead ends.
 *
 * This owns the visible half only: a small model per live drop, a hover and a
 * slow spin, a soft shadow on the surface beneath it, a fade before it decays, and
 * a raycast that names which drop the pointer is on. The drop's life, its expiry
 * and its reward stay on the server; collecting it is a `DROP_COLLECT` request,
 * and the marker disappears when the server says so.
 *
 * Height is soil-relative, exactly as the server measures a node's height: the
 * marker is placed at `groundY(x, z) + drop.y`, never at the surface. A drop that
 * died in a tunnel, a metre down, is drawn a metre down - it does not float up to
 * the grass, and under water it stays where it was dropped instead of rising out
 * of the pond. Only the hover height of its own anchor is added, which is the
 * couple of centimetres that make it read as floating rather than nailed down.
 */
import * as THREE from 'three';

export type WorldDropKind = 'fragment' | 'remains' | 'dung';

export interface WorldDropView {
  id: string;
  kind: WorldDropKind;
  x: number;
  y: number;
  z: number;
  expiresAtMs?: number;
}

export interface WorldDropsOptions {
  scene: THREE.Scene;
  /** Height of the soil at a world position; the drop's own y is relative to it. */
  groundY: (x: number, z: number) => number;
  /** How far the pointer may reach to pick a drop up, metres. A getter, because
   * the render config is loaded after the scene is built. */
  pickDistanceM: () => number;
}

const COLOUR: Record<WorldDropKind, number> = {
  // Soil-brown dung, a paler remains pile, and a green fragment: three things a
  // player can tell apart at a glance without reading a label.
  dung: 0x6f4c22,
  remains: 0xd8c8ac,
  fragment: 0x9ec96a,
};

/** Roughly the half-height of each model, so it rests on its anchor point. */
const SIZE: Record<WorldDropKind, number> = {
  dung: 0.085,
  remains: 0.085,
  fragment: 0.125,
};

/** Height above the anchor when the drop is at rest, metres. */
const HOVER_M = 0.26;

/** How far it bobs off its rest height, metres. Never larger than HOVER_M. */
const BOB_M = 0.04;

const SPIN_RAD_PER_S = 0.85;
const FADE_WINDOW_MS = 10_000;

interface Marker {
  /** Hover anchor and spin: its y is the drop's rest height. */
  root: THREE.Group;
  /** The model itself, so it can tilt without moving its shadow. */
  model: THREE.Group;
  /** Shadow on the surface; null for a drop that is underground. */
  shadow: THREE.Mesh | null;
  restY: number;
  expiresAtMs: number | null;
  phase: number;
  materials: THREE.Material[];
}

/** A small deterministic generator, so a dung lump keeps its shape every frame. */
function jitterRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/** One lumpy ball, used for dung: a sphere reads as a bead, a lump reads as dung. */
function lumpyGeometry(seed: number, detail = 1): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, detail);
  const position = geometry.getAttribute('position');
  const random = jitterRandom(seed);
  const seen = new Map<string, number>();
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    // Shared vertices of the icosahedron must move together or the shell splits.
    const key = `${x.toFixed(3)}:${y.toFixed(3)}:${z.toFixed(3)}`;
    let scale = seen.get(key);
    if (scale === undefined) {
      scale = 0.82 + random() * 0.32;
      seen.set(key, scale);
    }
    position.setXYZ(i, x * scale, y * scale, z * scale);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function modelMaterial(colour: number, emissive: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: colour,
    emissive,
    emissiveIntensity: 0.35,
    roughness: 0.72,
    metalness: 0.04,
    transparent: true,
  });
}

/**
 * The three shapes.
 *
 * Each one is a small group of primitives rather than a sphere with a colour: at
 * this size the silhouette is all the player sees, so a heap, a shard and a bone
 * have to be different outlines and not just different tints.
 */
function buildModel(kind: WorldDropKind): { model: THREE.Group; materials: THREE.Material[] } {
  const model = new THREE.Group();
  const materials: THREE.Material[] = [];
  const add = (mesh: THREE.Mesh): void => {
    model.add(mesh);
    materials.push(mesh.material as THREE.Material);
  };

  if (kind === 'dung') {
    const body = new THREE.Mesh(lumpyGeometry(0x51f3, 1), modelMaterial(COLOUR.dung, 0x2a1a08));
    body.scale.set(0.095, 0.066, 0.086);
    add(body);
    // Two pale seeds lying in the heap: the one clue that this is worth spores.
    for (const [sx, sy, sz, r] of [
      [0.028, 0.052, 0.014, 0.019],
      [-0.03, 0.045, -0.02, 0.015],
    ] as const) {
      const seed = new THREE.Mesh(
        new THREE.SphereGeometry(r, 7, 6),
        modelMaterial(0xe2cf9a, 0x6b5320),
      );
      seed.position.set(sx, sy, sz);
      add(seed);
    }
  } else if (kind === 'fragment') {
    // A shard of root: an octahedron drawn out along one axis, leaning slightly.
    const shard = new THREE.Mesh(
      new THREE.OctahedronGeometry(1, 0),
      modelMaterial(COLOUR.fragment, 0x3f6b24),
    );
    shard.scale.set(0.062, 0.125, 0.062);
    shard.rotation.set(0.18, 0.5, 0.22);
    add(shard);
    // A pale cut face, so the shard catches light on one side.
    const facet = new THREE.Mesh(
      new THREE.OctahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({
        color: 0xd9efb4,
        emissive: 0x6d9c3c,
        emissiveIntensity: 0.45,
        roughness: 0.35,
        transparent: true,
      }),
    );
    facet.scale.set(0.03, 0.08, 0.03);
    facet.position.set(0.012, 0.01, 0.012);
    facet.rotation.set(0.18, 0.5, 0.22);
    add(facet);
  } else {
    // A bone: a tapered shaft with two knobbed ends.
    const bone = new THREE.Group();
    const shaft = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.026, 0.11, 4, 8),
      modelMaterial(COLOUR.remains, 0x4a3d2a),
    );
    shaft.rotation.z = Math.PI / 2;
    bone.add(shaft);
    for (const side of [-1, 1]) {
      const knob = new THREE.Mesh(
        new THREE.SphereGeometry(0.034, 8, 6),
        modelMaterial(COLOUR.remains, 0x4a3d2a),
      );
      knob.position.x = side * 0.075;
      bone.add(knob);
    }
    bone.rotation.z = 0.35;
    model.add(bone);
    for (const child of bone.children)
      materials.push((child as THREE.Mesh).material as THREE.Material);
  }

  return { model, materials };
}

export class WorldDrops {
  private readonly group = new THREE.Group();
  private readonly markers = new Map<string, Marker>();
  private readonly shadowGeometry = new THREE.CircleGeometry(1, 18);

  private readonly options: WorldDropsOptions;

  constructor(options: WorldDropsOptions) {
    this.options = options;
    this.group.name = 'world-drops';
    this.options.scene.add(this.group);
  }

  spawn(drop: WorldDropView): void {
    if (this.markers.has(drop.id)) return;
    const kind = COLOUR[drop.kind] ? drop.kind : 'fragment';
    const { model, materials } = buildModel(kind);
    const root = new THREE.Group();
    root.name = `drop-${drop.id}`;
    root.add(model);

    // The soil line under the drop, then the drop's own height from it. This is
    // the whole "no resurfacing" rule: nothing here ever clips to the surface.
    const surfaceY = this.options.groundY(drop.x, drop.z);
    const restY = surfaceY + drop.y + SIZE[kind] + HOVER_M;
    root.position.set(drop.x, restY, drop.z);

    let shadow: THREE.Mesh | null = null;
    if (drop.y > -0.05) {
      shadow = new THREE.Mesh(
        this.shadowGeometry,
        new THREE.MeshBasicMaterial({
          color: 0x120c05,
          transparent: true,
          opacity: 0.26,
          depthWrite: false,
        }),
      );
      // Flat on the ground, just above it, so it cannot z-fight with the soil.
      shadow.rotation.x = -Math.PI / 2;
      shadow.scale.setScalar(SIZE[kind] * 1.7);
      shadow.position.set(drop.x, surfaceY + 0.02, drop.z);
    }

    root.userData.dropId = drop.id;
    root.traverse((object) => {
      object.userData.dropId = drop.id;
    });
    // A drop can spawn between frames; raycasting reads matrixWorld, so set it
    // now instead of waiting for the next render.
    root.updateMatrixWorld(true);
    this.group.add(root);
    // The shadow follows the marker in the tree so the first child of the group is
    // always a drop, which is what tests and the debug overlay count.
    if (shadow) this.group.add(shadow);
    this.markers.set(drop.id, {
      root,
      model,
      shadow,
      restY,
      expiresAtMs: typeof drop.expiresAtMs === 'number' ? drop.expiresAtMs : null,
      phase: (this.markers.size * 1.7) % (Math.PI * 2),
      materials,
    });
  }

  remove(id: string): void {
    const marker = this.markers.get(id);
    if (!marker) return;
    this.markers.delete(id);
    this.group.remove(marker.root);
    if (marker.shadow) {
      this.group.remove(marker.shadow);
      (marker.shadow.material as THREE.Material).dispose();
    }
    marker.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    for (const material of marker.materials) material.dispose();
  }

  clear(): void {
    for (const id of [...this.markers.keys()]) this.remove(id);
  }

  /** Hover, spin, and fade out the last seconds so an expiry is legible. */
  update(nowMs: number): void {
    for (const marker of this.markers.values()) {
      const t = nowMs / 1000 + marker.phase;
      marker.root.position.y = marker.restY + Math.sin(t * 1.5) * BOB_M;
      marker.root.rotation.y = t * SPIN_RAD_PER_S;
      // A slow tilt off both axes: a model that only spins reads as a turntable.
      marker.model.rotation.z = Math.sin(t * 0.63) * 0.07;
      marker.model.rotation.x = Math.cos(t * 0.51) * 0.05;

      const left = marker.expiresAtMs === null ? Infinity : marker.expiresAtMs - nowMs;
      const fade = left >= FADE_WINDOW_MS ? 1 : Math.max(0, left / FADE_WINDOW_MS);
      const opacity = 0.4 + 0.6 * fade;
      for (const material of marker.materials) {
        const standard = material as THREE.MeshStandardMaterial;
        standard.opacity = opacity;
        standard.emissiveIntensity = 0.18 + 0.45 * fade;
      }
      if (marker.shadow) {
        (marker.shadow.material as THREE.MeshBasicMaterial).opacity = 0.26 * fade;
      }
    }
  }

  /**
   * The drop under the pointer, or null. Distance is bounded so a marker across
   * the field cannot be collected by clicking the horizon.
   */
  pick(raycaster: THREE.Raycaster): string | null {
    if (this.markers.size === 0) return null;
    const objects = [...this.markers.values()].map((marker) => marker.root);
    const hit = raycaster.intersectObjects(objects, true)[0];
    if (!hit) return null;
    if (hit.distance > this.options.pickDistanceM()) return null;
    const id = hit.object.userData.dropId;
    return typeof id === 'string' ? id : null;
  }

  /** How many markers are drawn, for tests and the debug overlay. */
  size(): number {
    return this.markers.size;
  }

  dispose(): void {
    this.clear();
    this.shadowGeometry.dispose();
    this.options.scene.remove(this.group);
  }
}
