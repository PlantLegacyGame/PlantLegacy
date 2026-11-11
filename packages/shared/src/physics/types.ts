export type PhysicsBodyType = 'static' | 'dynamic' | 'kinematic';

export type ColliderShape =
  | { kind: 'sphere'; radius: number }
  | { kind: 'capsule'; height: number; radius: number }
  | { kind: 'cuboid'; halfExtents: { x: number; y: number; z: number } }
  | { kind: 'cylinder'; radius: number; halfHeight: number }
  | { kind: 'soft_body'; vertices: number[]; indices: number[] };

export interface PhysicsBodyDef {
  id: string;
  type: PhysicsBodyType;
  position: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number; w: number };
  linearDamping?: number;
  angularDamping?: number;
  gravityScale?: number;
  canSleep?: boolean;
  colliders: PhysicsColliderDef[];
}

export interface PhysicsColliderDef {
  id: string;
  shape: ColliderShape;
  friction?: number;
  restitution?: number;
  density?: number;
  isSensor?: boolean;
  parentBodyId: string;
}

export interface PhysicsState {
  bodies: Map<string, PhysicsBodyState>;
  colliders: Map<string, PhysicsColliderState>;
  contactEvents: PhysicsContactEvent[];
}

export interface PhysicsBodyState {
  id: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  linearVelocity: { x: number; y: number; z: number };
  angularVelocity: { x: number; y: number; z: number };
  isSleeping: boolean;
}

export interface PhysicsColliderState {
  id: string;
  bodyId: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
}

export interface PhysicsContactEvent {
  type: 'start' | 'stop';
  collider1: string;
  collider2: string;
}

export interface PlantNodePhysicsMapping {
  nodeId: string;
  bodyId: string;
  colliderId: string;
  shape: ColliderShape;
}

export interface SoftBodyLeafDef {
  id: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  vertices: number[];
  indices: number[];
  softness: number;
  particleRadius: number;
  damping: number;
}

export interface WaterDropDef {
  id: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  radius: number;
  mass: number;
}

export const PHYSICS_TICK_RATE = 20;
export const PHYSICS_SUBSTEPS = 4;

export const NODE_PHYSICS_SHAPES: Record<string, ColliderShape> = {
  seed: { kind: 'sphere', radius: 0.25 },
  radicle: { kind: 'capsule', height: 0.6, radius: 0.08 },
  root: { kind: 'capsule', height: 1.0, radius: 0.12 },
  lateral_root: { kind: 'capsule', height: 0.8, radius: 0.09 },
  stem: { kind: 'cylinder', radius: 0.15, halfHeight: 1.0 },
  branch: { kind: 'capsule', height: 0.8, radius: 0.1 },
  vine: { kind: 'capsule', height: 0.6, radius: 0.07 },
  leaf: { kind: 'soft_body', vertices: [], indices: [] },
  cotyledon: { kind: 'soft_body', vertices: [], indices: [] },
  flower: { kind: 'sphere', radius: 0.18 },
  spore_sac: { kind: 'sphere', radius: 0.2 },
};
