import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsBodyDef, PhysicsColliderDef } from '@plant-legacy/shared';
import type * as THREE from 'three';

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
        throw new Error('Soft bodies not yet implemented in this build');
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
}

export class PlantPhysicsSync {
  private bodies = new Map<string, BodyRef>();

  registerRigidBody(nodeId: string, body: RAPIER.RigidBody, mesh: THREE.Object3D): void {
    this.bodies.set(nodeId, { body, mesh, nodeId });
  }

  unregister(nodeId: string): void {
    const ref = this.bodies.get(nodeId);
    if (ref) {
      rapierWorld.destroyBody(ref.body);
      this.bodies.delete(nodeId);
    }
  }

  syncTransforms(): void {
    for (const [, ref] of this.bodies) {
      const pos = ref.body.translation();
      const rot = ref.body.rotation();
      ref.mesh.position.set(pos.x, pos.y, pos.z);
      ref.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
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

  dispose(): void {
    for (const ref of this.bodies.values()) {
      rapierWorld.destroyBody(ref.body);
    }
    this.bodies.clear();
  }
}

export const plantPhysicsSync = new PlantPhysicsSync();
