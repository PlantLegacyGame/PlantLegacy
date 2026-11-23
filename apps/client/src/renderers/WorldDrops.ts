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
  /**
   * Unit surface normal at a world position. A contact shadow lies in the ground
   * it sits on; a flat disc on a slope cuts into the hill on one side and floats
   * over it on the other, which is what every shadow in the world looked like.
   */
  groundNormal?: (x: number, z: number) => { x: number; y: number; z: number };
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
  // A collapsed husk is wider and flatter than a bead, so it needs more room in
  // its own shadow and less in the air.
  remains: 0.13,
  fragment: 0.125,
};

/** Height above the anchor when the drop is at rest, metres. */
const HOVER_M = 0.26;
/**
 * A corpse does not hover. Remains rest a few centimetres off the soil - enough
 * that the ground does not z-fight through the husk - instead of bobbing a
 * quarter of a metre up like something waiting to be collected.
 */
const REST_HOVER_M = 0.008;
/** The contact disc is a CircleGeometry in its local XY plane: its normal is +Z. */
const CIRCLE_NORMAL = new THREE.Vector3(0, 0, 1);

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
  kind: WorldDropKind;
  /** Fixed heading for a remains marker: it must not turn like a collectable. */
  spinRad: number;
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

/** A stable 0..1 from an id, so a drop's lean and shadow survive a re-spawn. */
function hashUnit(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

/** A usable unit ground normal, defaulting to flat ground. */
function unitNormal(value: { x: number; y: number; z: number } | undefined): THREE.Vector3 {
  const normal = new THREE.Vector3(value?.x ?? 0, value?.y ?? 1, value?.z ?? 0);
  const finite =
    Number.isFinite(normal.x) && Number.isFinite(normal.y) && Number.isFinite(normal.z);
  if (!finite || normal.lengthSq() < 1e-9) return new THREE.Vector3(0, 1, 0);
  return normal.normalize();
}

/**
 * The three shapes.
 *
 * Each one is a small group of primitives rather than a sphere with a colour: at
 * this size the silhouette is all the player sees, so a heap, a shard and a husk
 * have to be different outlines and not just different tints.
 */
/** Remains closer than this to another corpse are pieces of it, not new bodies. */
const REMAINS_CLUSTER_M = 0.6;

function buildModel(
  kind: WorldDropKind,
  /** A broken-off piece of a corpse rather than the body itself. */
  piece = false,
): { model: THREE.Group; materials: THREE.Material[] } {
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
    // A plant that died the way a plant dies: the stem that held it up has let
    // go, and the body lies where it fell. The torn root plate stays on the
    // soil, the stalk leaves it in three connected joints and settles flat, and
    // both leaves are still joined to the joint they grew from - a corpse with
    // pieces floating beside it is not a body, and this game is a plant.
    const husk = new THREE.Group();
    // Dry plant matter, not bone: the pale value this used to have read as an
    // animal skeleton, which is the one thing a plant's corpse is not.
    const dry = modelMaterial(0x8a7550, 0x2f2716);
    const dryLeaf = modelMaterial(0x9c855a, 0x332a18);
    materials.push(dry, dryLeaf);

    if (!piece) {
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.048, 0.018, 9), dry);
      plate.name = 'husk-plate';
      plate.position.y = 0.011;
      plate.rotation.set(0.03, 0.4, 0.02);
      husk.add(plate);
    }

    // Each joint starts where the last one ended, so the pieces cannot drift
    // apart. The first joint is already near the soil - that fall is what killed
    // it - and the rest lie along the ground. A broken piece is only the first
    // two joints, with no root plate: it is part of a body, not a body.
    let attach = new THREE.Vector3(0, 0.016, 0);
    let yaw = 0.35;
    const joints: Array<{ joint: THREE.Group; length: number }> = [];
    const segments: ReadonlyArray<readonly [number, number, number]> = piece
      ? [[0.09, 1.2, 0.4]]
      : [
          [0.11, 1.32, 0.18],
          [0.1, 0.16, 0.42],
          [0.08, 0.24, 0.3],
        ];
    for (const [length, bend, turn] of segments) {
      const joint = new THREE.Group();
      joint.name = 'husk-joint';
      joint.position.copy(attach);
      joint.rotation.set(0, yaw, -bend);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.013, length, 6), dry);
      shaft.position.y = length / 2;
      joint.add(shaft);
      husk.add(joint);
      joints.push({ joint, length });
      // The tip, in the husk's own frame, becomes the next joint's origin.
      attach = attach.clone().add(new THREE.Vector3(0, length, 0).applyEuler(joint.rotation));
      yaw += turn;
    }

    // Dried leaves, each a child of the joint it budded from, hanging down to
    // the soil: attached at three quarters of the shaft and drooping past it.
    const leaves: ReadonlyArray<readonly [number, number, number, number]> = piece
      ? [[0, 1.1, 1.5, 0.06]]
      : [
          [0, 0.5, 1.49, 0.09],
          [1, 2.4, 1.27, 0.07],
        ];
    for (const [index, turn, droop, reach] of leaves) {
      const budded = joints[index];
      if (!budded) continue;
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), dryLeaf);
      leaf.name = 'husk-leaf';
      leaf.scale.set(reach, 0.006, 0.02);
      leaf.position.set(0, budded.length * 0.75, 0);
      leaf.rotation.set(0, turn, -droop);
      budded.joint.add(leaf);
    }

    // A full plant's corpse is a hand long, not a twig; a broken piece is a
    // smaller offcut. Scaling about the husk's origin keeps its plate on the soil.
    husk.scale.setScalar(piece ? 0.55 : 1.45);
    husk.rotation.set(0, 0.7, 0.06);
    model.add(husk);
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
    // A death leaves several remains; the first at a spot is the body, and the
    // rest are pieces of it. Four full husks stacked on one point was a heap of
    // corpses, which is not what the world spawned.
    const piece =
      kind === 'remains' &&
      [...this.markers.values()].some(
        (other) =>
          other.kind === 'remains' &&
          Math.hypot(other.root.position.x - drop.x, other.root.position.z - drop.z) <
            REMAINS_CLUSTER_M,
      );
    const { model, materials } = buildModel(kind, piece);
    if (piece) model.scale.setScalar(0.8);
    const root = new THREE.Group();
    root.name = `drop-${drop.id}`;
    root.add(model);
    // Stable per-drop heading, so a re-spawned marker keeps its lean and its
    // shadow's turn rather than looking freshly randomised every time.
    const spinRad = hashUnit(drop.id) * Math.PI * 2;

    // The soil line under the drop, then the drop's own height from it. This is
    // the whole "no resurfacing" rule: nothing here ever clips to the surface.
    const surfaceY = this.options.groundY(drop.x, drop.z);
    const hover = kind === 'remains' ? REST_HOVER_M : HOVER_M;
    // The husk is built with its root plate on y = 0, so it rests at the anchor;
    // the other two are built around their centres and need their half-height.
    const restY = surfaceY + drop.y + (kind === 'remains' ? 0 : SIZE[kind]) + hover;
    root.position.set(drop.x, restY, drop.z);
    // Its heading is set before the first frame, so a husk never appears facing
    // one way and then turns on the next update.
    root.rotation.y = spinRad;

    let shadow: THREE.Mesh | null = null;
    // A piece of a corpse sits inside the body's own shade; a second disc there
    // only darkens the puddle.
    if (drop.y > -0.05 && !piece) {
      const normal = unitNormal(this.options.groundNormal?.(drop.x, drop.z));
      shadow = new THREE.Mesh(
        this.shadowGeometry,
        new THREE.MeshBasicMaterial({
          color: 0x120c05,
          transparent: true,
          opacity: 0.26,
          depthWrite: false,
        }),
      );
      // Lie in the ground plane. The disc's normal is +Z, so mapping it onto the
      // surface normal tilts the shadow with the slope instead of through it.
      shadow.quaternion.setFromUnitVectors(CIRCLE_NORMAL, normal);
      // Turned inside that plane and stretched along one axis, so a field of
      // drops does not read as the same rubber stamp under every one.
      shadow.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(CIRCLE_NORMAL, spinRad));
      // A husk is wide and flat, so its shade sits closer to its own footprint
      // than a bead's does; four overlapping discs made one black puddle.
      const spread = kind === 'remains' ? 1.15 : 1.7;
      const depth = kind === 'remains' ? 0.95 : 1.45;
      const body = kind === 'remains' ? 1.9 : 1;
      shadow.scale.set(
        SIZE[kind] * spread * body * (1 + hashUnit(drop.id) * 0.12),
        SIZE[kind] * depth * body,
        1,
      );
      // A whisker along the normal keeps it off the soil without a squat lift.
      shadow.position.set(drop.x, surfaceY, drop.z).addScaledVector(normal, 0.02);
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
      kind,
      spinRad,
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
      if (marker.kind === 'remains') {
        // A dead plant does not hover or turn on a turntable. It lies where it
        // fell, with only the faintest settle as the air moves over it.
        marker.root.position.y = marker.restY;
        marker.root.rotation.y = marker.spinRad;
        marker.model.rotation.z = Math.sin(t * 0.31) * 0.012;
        marker.model.rotation.x = Math.sin(t * 0.23) * 0.008;
      } else {
        marker.root.position.y = marker.restY + Math.sin(t * 1.5) * BOB_M;
        marker.root.rotation.y = t * SPIN_RAD_PER_S;
        // A slow tilt off both axes: a model that only spins reads as a turntable.
        marker.model.rotation.z = Math.sin(t * 0.63) * 0.07;
        marker.model.rotation.x = Math.cos(t * 0.51) * 0.05;
      }

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
