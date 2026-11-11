import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsBodyDef, PhysicsColliderDef } from '@plant-legacy/shared';
import * as THREE from 'three';

interface RapierInitStatus {
  initialized: boolean;
  promise: Promise<void> | null;
}

const initStatus: RapierInitStatus = { initialized: false, promise: null };

export function ensureRapierInitialized(): Promise<void> {
  if (initStatus.initialized) return Promise.resolve();
  if (initStatus.promise) return initStatus.promise;
  initStatus.promise = (async () => {
    await RAPIER.init();
    initStatus.initialized = true;
  })();
  return initStatus.promise;
}

export class RapierWorld {
  private world: RAPIER.World | null = null;
  private initialized = false;

  async init(gravity = { x: 0, y: -9.81, z: 0 }): Promise<void> {
    await ensureRapierInitialized();
    this.world = new RAPIER.World(gravity);
    this.world.timestep = 1 / 60;
    this.initialized = true;
  }

  get isReady(): boolean {
    return this.initialized && this.world !== null;
  }

  getWorld(): RAPIER.World {
    if (!this.world) throw new Error('Rapier world not initialized');
    return this.world;
  }

  step(): void {
    if (!this.world) return;
    this.world.step();
  }

  createRigidBody(def: PhysicsBodyDef): RAPIER.RigidBody {
    const world = this.getWorld();
    const desc =
      def.type === 'static'
        ? RAPIER.RigidBodyDesc.fixed()
        : def.type === 'kinematic'
          ? RAPIER.RigidBodyDesc.kinematicPositionBased()
          : RAPIER.RigidBodyDesc.dynamic();

    desc.setTranslation(def.position.x, def.position.y, def.position.z);
    if (def.rotation) {
      desc.setRotation({
        x: def.rotation.x,
        y: def.rotation.y,
        z: def.rotation.z,
        w: def.rotation.w,
      });
    }
    if (def.linearDamping !== undefined) desc.setLinearDamping(def.linearDamping);
    if (def.angularDamping !== undefined) desc.setAngularDamping(def.angularDamping);
    if (def.gravityScale !== undefined) desc.setGravityScale(def.gravityScale);
    if (def.canSleep !== undefined) desc.setCanSleep(def.canSleep);

    const body = world.createRigidBody(desc);

    for (const colliderDef of def.colliders) {
      this.createCollider(colliderDef, body);
    }

    return body;
  }

  createCollider(def: PhysicsColliderDef, body: RAPIER.RigidBody): RAPIER.Collider {
    const world = this.getWorld();
    let shapeDesc: RAPIER.ColliderDesc;

    switch (def.shape.kind) {
      case 'sphere':
        shapeDesc = RAPIER.ColliderDesc.ball(def.shape.radius);
        break;
      case 'capsule':
        shapeDesc = RAPIER.ColliderDesc.capsule(def.shape.height / 2, def.shape.radius);
        break;
      case 'cuboid': {
        const he = def.shape.halfExtents;
        shapeDesc = RAPIER.ColliderDesc.cuboid(he.x, he.y, he.z);
        break;
      }
      case 'cylinder':
        shapeDesc = RAPIER.ColliderDesc.cylinder(def.shape.halfHeight, def.shape.radius);
        break;
      case 'soft_body':
        // Soft bodies not exposed in Rapier JS bindings v0.12.0.
        // Leaf physics uses rigid-body collision + visual deformation instead.
        throw new Error('Soft bodies not available in Rapier 0.12.0 JS bindings');
      default:
        shapeDesc = RAPIER.ColliderDesc.ball(0.1);
    }

    if (def.friction !== undefined) shapeDesc.setFriction(def.friction);
    if (def.restitution !== undefined) shapeDesc.setRestitution(def.restitution);
    if (def.density !== undefined) shapeDesc.setDensity(def.density);
    if (def.isSensor !== undefined) shapeDesc.setSensor(def.isSensor);

    return world.createCollider(shapeDesc, body);
  }

  destroyBody(body: RAPIER.RigidBody): void {
    const world = this.getWorld();
    world.removeRigidBody(body);
  }

  destroyCollider(collider: RAPIER.Collider): void {
    const world = this.getWorld();
    world.removeCollider(collider, true);
  }
}

export const rapierWorld = new RapierWorld();

interface BodyRef {
  body: RAPIER.RigidBody;
  mesh: THREE.Object3D;
  nodeId: string;
  collider?: RAPIER.Collider;
}

interface LeafRef {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
  nodeId: string;
  collider?: RAPIER.Collider;
  // Visual deformation state (soft body simulation via visual trickery)
  droopAngle: number;
  droopTarget: number;
  droopRecoverySpeed: number;
  originalRotation: THREE.Quaternion;
}

interface WaterDropRef {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
  id: string;
  collider?: RAPIER.Collider;
  lifetime: number;
  maxLifetime: number;
}

export class PlantPhysicsSync {
  private bodies = new Map<string, BodyRef>();
  private leaves = new Map<string, LeafRef>();
  private waterDrops = new Map<string, WaterDropRef>();
  // water drop collider -> drop id, for contact matching
  private waterDropColliders = new Map<RAPIER.Collider, string>();
  // leaf collider -> leaf node id, for contact matching
  private leafColliders = new Map<RAPIER.Collider, string>();

  registerRigidBody(
    nodeId: string,
    body: RAPIER.RigidBody,
    mesh: THREE.Object3D,
    collider?: RAPIER.Collider,
  ): void {
    this.bodies.set(nodeId, { body, mesh, nodeId, collider });
  }

  registerLeaf(
    nodeId: string,
    body: RAPIER.RigidBody,
    mesh: THREE.Mesh,
    collider?: RAPIER.Collider,
  ): void {
    const originalRotation = mesh.quaternion.clone();
    this.leaves.set(nodeId, {
      body,
      mesh,
      nodeId,
      collider,
      droopAngle: 0,
      droopTarget: 0,
      droopRecoverySpeed: 2.0,
      originalRotation,
    });
    if (collider) {
      this.leafColliders.set(collider, nodeId);
    }
  }

  registerWaterDrop(
    id: string,
    body: RAPIER.RigidBody,
    mesh: THREE.Mesh,
    collider?: RAPIER.Collider,
  ): void {
    this.waterDrops.set(id, {
      body,
      mesh,
      id,
      collider,
      lifetime: 0,
      maxLifetime: 3.0, // Water drops evaporate after 3 seconds
    });
    if (collider) {
      this.waterDropColliders.set(collider, id);
    }
  }

  unregister(nodeId: string): void {
    const ref = this.bodies.get(nodeId);
    if (ref) {
      rapierWorld.destroyBody(ref.body);
      this.bodies.delete(nodeId);
    }
    const leaf = this.leaves.get(nodeId);
    if (leaf) {
      if (leaf.collider) this.leafColliders.delete(leaf.collider);
      rapierWorld.destroyBody(leaf.body);
      this.leaves.delete(nodeId);
    }
  }

  unregisterWaterDrop(id: string): void {
    const drop = this.waterDrops.get(id);
    if (drop) {
      if (drop.collider) this.waterDropColliders.delete(drop.collider);
      rapierWorld.destroyBody(drop.body);
      this.waterDrops.delete(id);
    }
  }

  /**
   * Called when a water drop collides with a leaf. Triggers visual droop deformation.
   */
  onWaterDropHitLeaf(_waterDropId: string, leafNodeId: string): void {
    const leaf = this.leaves.get(leafNodeId);
    if (!leaf) return;
    // Set droop target based on impact - heavier drops droop more
    leaf.droopTarget = Math.min(leaf.droopTarget + 0.4, 1.2);
    leaf.droopAngle = leaf.droopTarget;
  }

  /**
   * Check for contacts between water drop colliders and leaf colliders.
   * Uses Rapier's contactPairsWith to find touching pairs.
   */
  checkContacts(): void {
    const world = rapierWorld.getWorld();
    for (const [collider, dropId] of this.waterDropColliders) {
      world.contactPairsWith(collider, (otherCollider) => {
        const leafNodeId = this.leafColliders.get(otherCollider);
        if (leafNodeId) {
          this.onWaterDropHitLeaf(dropId, leafNodeId);
        }
      });
    }
  }

  syncTransforms(): void {
    // Check contacts before syncing transforms
    this.checkContacts();

    for (const [, ref] of this.bodies) {
      const pos = ref.body.translation();
      const rot = ref.body.rotation();
      ref.mesh.position.set(pos.x, pos.y, pos.z);
      ref.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    }

    // Leaf visual deformation (soft body simulation via visual trickery)
    const deltaTime = 1 / 60;
    for (const [, leaf] of this.leaves) {
      // Recover droop over time
      if (leaf.droopAngle > 0) {
        leaf.droopAngle = Math.max(0, leaf.droopAngle - leaf.droopRecoverySpeed * deltaTime);
      }
      if (leaf.droopTarget > leaf.droopAngle) {
        leaf.droopAngle = Math.min(
          leaf.droopTarget,
          leaf.droopAngle + leaf.droopRecoverySpeed * deltaTime,
        );
      }

      // Apply droop rotation around leaf's local X axis (bend downward)
      const droopQuat = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        leaf.droopAngle,
      );
      leaf.mesh.quaternion.copy(leaf.originalRotation).multiply(droopQuat);
    }

    // Water drops
    const dropsToRemove: string[] = [];
    for (const [id, drop] of this.waterDrops) {
      drop.lifetime += deltaTime;
      const pos = drop.body.translation();
      const rot = drop.body.rotation();
      drop.mesh.position.set(pos.x, pos.y, pos.z);
      drop.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
      if (drop.lifetime >= drop.maxLifetime) {
        dropsToRemove.push(id);
      }
    }
    for (const id of dropsToRemove) {
      this.unregisterWaterDrop(id);
    }
  }

  applyImpulse(nodeId: string, impulse: { x: number; y: number; z: number }): void {
    const ref = this.bodies.get(nodeId);
    if (ref) {
      ref.body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
    }
  }

  getBody(nodeId: string): RAPIER.RigidBody | undefined {
    return this.bodies.get(nodeId)?.body;
  }

  getLeaf(nodeId: string): LeafRef | undefined {
    return this.leaves.get(nodeId);
  }

  dispose(): void {
    for (const ref of this.bodies.values()) {
      rapierWorld.destroyBody(ref.body);
    }
    this.bodies.clear();
    for (const leaf of this.leaves.values()) {
      rapierWorld.destroyBody(leaf.body);
    }
    this.leaves.clear();
    this.leafColliders.clear();
    for (const drop of this.waterDrops.values()) {
      rapierWorld.destroyBody(drop.body);
    }
    this.waterDrops.clear();
    this.waterDropColliders.clear();
  }
}

export const plantPhysicsSync = new PlantPhysicsSync();

/**
 * Create a water drop rigid body + mesh.
 * The drop falls under gravity and collides with leaves/stems.
 */
export function createWaterDrop(
  _id: string,
  position: { x: number; y: number; z: number },
  velocity: { x: number; y: number; z: number },
  radius: number = 0.03,
  mass: number = 0.001,
): { body: RAPIER.RigidBody; mesh: THREE.Mesh; collider: RAPIER.Collider } {
  const world = rapierWorld.getWorld();

  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(position.x, position.y, position.z)
    .setLinearDamping(0.05)
    .setAngularDamping(0.05)
    .setCanSleep(false);

  const body = world.createRigidBody(bodyDesc);
  body.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);

  const colliderDesc = RAPIER.ColliderDesc.ball(radius)
    .setRestitution(0.4)
    .setFriction(0.3)
    .setDensity(mass / ((4 / 3) * Math.PI * radius ** 3))
    .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

  const collider = world.createCollider(colliderDesc, body);

  // Three.js mesh for visual
  const geometry = new THREE.SphereGeometry(radius, 8, 8);
  const material = new THREE.MeshStandardMaterial({ color: 0x4da6ff, emissive: 0x1a4d80 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position.x, position.y, position.z);

  return { body, mesh, collider };
}

/**
 * Create a leaf rigid body + mesh attached to a parent stem.
 * Leaf uses rigid body physics with visual droop deformation on impact.
 */
export function createLeaf(
  _nodeId: string,
  position: { x: number; y: number; z: number },
  rotation: { x: number; y: number; z: number; w: number },
  size: { width: number; height: number },
  mass: number = 0.01,
): { body: RAPIER.RigidBody; mesh: THREE.Mesh; collider: RAPIER.Collider } {
  const world = rapierWorld.getWorld();

  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(position.x, position.y, position.z)
    .setRotation({
      x: rotation.x,
      y: rotation.y,
      z: rotation.z,
      w: rotation.w,
    })
    .setLinearDamping(0.5)
    .setAngularDamping(0.5)
    .setCanSleep(true);

  const body = world.createRigidBody(bodyDesc);

  // Leaf collider - thin cuboid
  const colliderDesc = RAPIER.ColliderDesc.cuboid(size.width / 2, size.height / 2, 0.005)
    .setRestitution(0.1)
    .setFriction(0.6)
    .setDensity(mass / (size.width * size.height * 0.01))
    .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

  const collider = world.createCollider(colliderDesc, body);

  // Three.js mesh for visual
  const geometry = new THREE.PlaneGeometry(size.width, size.height, 4, 4);
  const material = new THREE.MeshStandardMaterial({ color: 0x4a7c59, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position.x, position.y, position.z);
  mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);

  return { body, mesh, collider };
}
