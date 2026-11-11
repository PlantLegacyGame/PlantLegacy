import type { ColliderShape } from './types.ts';
import { NODE_PHYSICS_SHAPES, PHYSICS_SUBSTEPS, PHYSICS_TICK_RATE } from './types.ts';

export type {
  ColliderShape,
  PhysicsBodyDef,
  PhysicsBodyState,
  PhysicsBodyType,
  PhysicsColliderDef,
  PhysicsColliderState,
  PhysicsContactEvent,
  PhysicsState,
  PlantNodePhysicsMapping,
  SoftBodyLeafDef,
  WaterDropDef,
} from './types.ts';
export { NODE_PHYSICS_SHAPES, PHYSICS_SUBSTEPS, PHYSICS_TICK_RATE };

export function nodeTypeToPhysicsShape(nodeType: string, biomass: number): ColliderShape {
  const base = NODE_PHYSICS_SHAPES[nodeType];
  if (!base) return { kind: 'sphere', radius: 0.1 };

  const scale = Math.min(1.0, Math.sqrt(biomass / 5.0));

  switch (base.kind) {
    case 'sphere':
      return { kind: 'sphere', radius: base.radius * scale };
    case 'capsule':
      return { kind: 'capsule', height: base.height * scale, radius: base.radius * scale };
    case 'cuboid':
      return {
        kind: 'cuboid',
        halfExtents: {
          x: base.halfExtents.x * scale,
          y: base.halfExtents.y * scale,
          z: base.halfExtents.z * scale,
        },
      };
    case 'cylinder':
      return { kind: 'cylinder', radius: base.radius * scale, halfHeight: base.halfHeight * scale };
    case 'soft_body':
      return base;
    default:
      return { kind: 'sphere', radius: 0.1 };
  }
}
