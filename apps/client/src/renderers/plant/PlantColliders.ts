/**
 * Client plant colliders.
 *
 * One fixed Rapier body per plant, carrying a capsule per drawn segment, a ball
 * for the root node and a thin box for near leaves. The shapes come from
 * `planPlantColliders` in the shared physics package, which is also what the
 * server's analytic collision uses, so the camera, rain and debris agree with
 * the renderer about the plant's body.
 *
 * Colliders are cosmetic: they never feed gameplay state back to the server.
 * The budget and LOD rules keep the layer cheap — only the nearest plants get
 * colliders, and beyond the LOD distance a plant's segments merge into chains.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import {
  type ColliderNodeInput,
  type ColliderPlanOptions,
  planPlantColliders,
} from '@plant-legacy/shared/physics';
import * as THREE from 'three';
import type { PhysicsConfig } from '../../config/clientConfig.js';
import { rapierWorld } from '../../physics/RapierPhysicsManager.js';
import type { PlantNodeData } from './plantNodeData.js';

/** Collision-group bits. Plants do not collide with plants (both are static). */
export const COLLISION_GROUP = {
  ground: 0x0001,
  plant: 0x0002,
  debris: 0x0004,
  probe: 0x0008,
} as const;

/** Rapier packs membership in the high 16 bits and the filter in the low 16. */
function collisionGroups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

const UP = new THREE.Vector3(0, 1, 0);
const tempDir = new THREE.Vector3();
const tempQuat = new THREE.Quaternion();

interface PlantEntry {
  body: RAPIER.RigidBody;
  signature: string;
  colliderCount: number;
}

interface PlantSource {
  id: string;
  nodes: Map<string, PlantNodeData>;
  center: THREE.Vector3;
}

export interface PlantColliderCounts {
  plants: number;
  colliders: number;
  skipped: number;
}

export class PlantColliderManager {
  private entries = new Map<string, PlantEntry>();
  private options: ColliderPlanOptions = {
    maxColliders: 192,
    inflationM: 0.005,
    minRadiusM: 0.004,
    includeLeafBlades: true,
    minGrowthProgress: 0.35,
  };
  private maxPlants = 24;
  private lodDistanceM = 70;
  private rebuildIntervalMs = 100;
  private lastSyncMs = 0;
  private counts: PlantColliderCounts = { plants: 0, colliders: 0, skipped: 0 };
  /** Entry key of the player's own plant, so the camera can ignore its body. */
  private ownEntryKey: string | null = null;

  configure(config: PhysicsConfig): void {
    this.maxPlants = Math.max(1, Math.round(config.maxColliderPlants));
    this.lodDistanceM = Math.max(1, config.colliderLodDistanceM);
    this.rebuildIntervalMs = 1000 / Math.max(1, config.colliderRebuildHz);
    this.options = {
      maxColliders: Math.max(1, Math.round(config.maxCollidersPerPlant)),
      inflationM: Math.max(0, config.colliderInflationM),
      minRadiusM: 0.004,
      includeLeafBlades: config.leafColliderMode !== 'none',
      minGrowthProgress: 0.35,
    };
  }

  getCounts(): PlantColliderCounts {
    return { ...this.counts };
  }

  /**
   * The player's own plant body, so the camera can ignore its own canopy.
   *
   * A ray from the orbit target to the eye crosses the player's own leaves the
   * moment the view looks up through them. Treating that hit as an obstruction
   * pulled the eye in and made looking up read as the camera colliding with the
   * plant. Terrain and rival plants still block the camera.
   */
  ownRigidBody(): RAPIER.RigidBody | null {
    if (!this.ownEntryKey) return null;
    return this.entries.get(this.ownEntryKey)?.body ?? null;
  }

  /**
   * Synchronise colliders with the frame's plant data.
   *
   * Only the nearest `maxColliderPlants` are considered, own plant first, and a
   * plant is rebuilt only when its node signature changes. This is called from
   * the render loop but does real work at `collider_rebuild_hz`.
   */
  sync(
    ownPlantId: string | null,
    ownNodes: Map<string, PlantNodeData>,
    otherPlants: Map<string, Map<string, PlantNodeData>>,
    cameraPosition: THREE.Vector3,
    nowMs: number,
  ): void {
    if (!rapierWorld.isReady) return;
    if (nowMs - this.lastSyncMs < this.rebuildIntervalMs) return;
    this.lastSyncMs = nowMs;

    const sources: PlantSource[] = [];
    if (ownNodes.size > 0) {
      sources.push({
        id: ownPlantId ?? '__own__',
        nodes: ownNodes,
        center: centerOf(ownNodes),
      });
    }
    for (const [id, nodes] of otherPlants) {
      if (nodes.size === 0) continue;
      sources.push({ id, nodes, center: centerOf(nodes) });
    }

    // Own plant first, then nearest rivals. A plant with no nodes cannot be
    // planned; dropping it here also retires its old body below.
    const kept = new Set<string>();
    const own = sources.find((source) => source.id === (ownPlantId ?? '__own__'));
    if (own) kept.add(own.id);
    this.ownEntryKey = own ? own.id : null;
    const rivals = sources
      .filter((source) => source.id !== own?.id)
      .sort(
        (a, b) =>
          a.center.distanceToSquared(cameraPosition) - b.center.distanceToSquared(cameraPosition),
      );
    for (const rival of rivals) {
      if (kept.size >= this.maxPlants) break;
      if (rival.center.distanceTo(cameraPosition) > this.lodDistanceM * 4) continue;
      kept.add(rival.id);
    }

    for (const [id, entry] of this.entries) {
      if (kept.has(id)) continue;
      this.destroyEntry(entry);
      this.entries.delete(id);
    }

    let totalColliders = 0;
    let skipped = 0;
    for (const source of sources) {
      if (!kept.has(source.id)) continue;
      const signature = signatureOf(source.nodes);
      const existing = this.entries.get(source.id);
      if (existing && existing.signature === signature) {
        totalColliders += existing.colliderCount;
        continue;
      }
      if (existing) {
        this.destroyEntry(existing);
        this.entries.delete(source.id);
      }
      const distance = source.center.distanceTo(cameraPosition);
      const plan = planPlantColliders(toInputs(source.nodes), {
        ...this.options,
        // Past the LOD distance, merge harder: a distant plant only needs its
        // silhouette for debris and the camera.
        maxColliders:
          distance > this.lodDistanceM
            ? Math.min(48, this.options.maxColliders)
            : this.options.maxColliders,
      });
      if (plan.colliders.length === 0) {
        skipped += 1;
        continue;
      }
      const entry = this.createEntry(plan.colliders);
      this.entries.set(source.id, { ...entry, signature });
      totalColliders += entry.colliderCount;
    }

    this.counts = { plants: this.entries.size, colliders: totalColliders, skipped };
  }

  private createEntry(colliders: ReturnType<typeof planPlantColliders>['colliders']): {
    body: RAPIER.RigidBody;
    colliderCount: number;
  } {
    const world = rapierWorld.getWorld();
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const groups = collisionGroups(
      COLLISION_GROUP.plant,
      COLLISION_GROUP.ground | COLLISION_GROUP.debris | COLLISION_GROUP.probe,
    );

    for (const collider of colliders) {
      let desc: RAPIER.ColliderDesc | null = null;
      if (collider.kind === 'capsule') {
        tempDir.set(
          collider.b.x - collider.a.x,
          collider.b.y - collider.a.y,
          collider.b.z - collider.a.z,
        );
        const length = tempDir.length();
        const halfHeight = Math.max(0, length / 2 - collider.radius);
        desc = RAPIER.ColliderDesc.capsule(halfHeight, Math.max(0.001, collider.radius));
        desc.setTranslation(
          (collider.a.x + collider.b.x) * 0.5,
          (collider.a.y + collider.b.y) * 0.5,
          (collider.a.z + collider.b.z) * 0.5,
        );
        if (length > 1e-6) {
          tempDir.multiplyScalar(1 / length);
          tempQuat.setFromUnitVectors(UP, tempDir);
          desc.setRotation({ x: tempQuat.x, y: tempQuat.y, z: tempQuat.z, w: tempQuat.w });
        }
      } else if (collider.kind === 'ball') {
        desc = RAPIER.ColliderDesc.ball(Math.max(0.001, collider.radius));
        desc.setTranslation(collider.center.x, collider.center.y, collider.center.z);
      } else {
        desc = RAPIER.ColliderDesc.cuboid(
          Math.max(0.001, collider.halfExtents.x),
          Math.max(0.001, collider.halfExtents.y),
          Math.max(0.001, collider.halfExtents.z),
        );
        desc.setTranslation(collider.center.x, collider.center.y, collider.center.z);
        tempDir.set(collider.axis.x, collider.axis.y, collider.axis.z);
        if (tempDir.lengthSq() > 1e-9) {
          tempDir.normalize();
          tempQuat.setFromUnitVectors(UP, tempDir);
          desc.setRotation({ x: tempQuat.x, y: tempQuat.y, z: tempQuat.z, w: tempQuat.w });
        }
      }
      if (!desc) continue;
      desc.setFriction(0.6).setRestitution(0.05).setCollisionGroups(groups);
      world.createCollider(desc, body);
    }

    return { body, colliderCount: colliders.length };
  }

  private destroyEntry(entry: PlantEntry): void {
    if (!rapierWorld.isReady) return;
    try {
      rapierWorld.getWorld().removeRigidBody(entry.body);
    } catch {
      // The world may already be torn down (page unload); nothing to remove.
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) this.destroyEntry(entry);
    this.entries.clear();
    this.counts = { plants: 0, colliders: 0, skipped: 0 };
  }
}

function centerOf(nodes: Map<string, PlantNodeData>): THREE.Vector3 {
  const center = new THREE.Vector3();
  let count = 0;
  for (const node of nodes.values()) {
    center.add(node.position);
    count += 1;
  }
  if (count === 0) return center;
  return center.multiplyScalar(1 / count);
}

function toInputs(nodes: Map<string, PlantNodeData>): ColliderNodeInput[] {
  const inputs: ColliderNodeInput[] = [];
  for (const node of nodes.values()) {
    inputs.push({
      id: node.id,
      parentId: node.parentId,
      x: node.position.x,
      y: node.position.y,
      z: node.position.z,
      radius: node.radius,
      type: node.nodeType,
      parentAttachX: node.parentAttachX,
      parentAttachY: node.parentAttachY,
      parentAttachZ: node.parentAttachZ,
      growthProgress: node.growthProgress,
    });
  }
  return inputs;
}

/**
 * Cheap structural signature. Growth changes node count and progress; a
 * rebuild is only needed when either moves.
 */
function signatureOf(nodes: Map<string, PlantNodeData>): string {
  let progress = 0;
  let biomass = 0;
  for (const node of nodes.values()) {
    progress += Math.round((node.growthProgress ?? 1) * 20);
    biomass += Math.round((node.biomass ?? 0) * 10);
  }
  return `${nodes.size}:${progress}:${biomass}`;
}
