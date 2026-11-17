/**
 * The client's long-lived handles, passed explicitly.
 *
 * `main.ts` grew to 9.4k lines with 256 module-scope bindings, so every function
 * silently depended on a mutable namespace: you could not tell from a signature
 * whether something needed the camera, the socket, or both. This is the seam
 * that lets subsystems move out one at a time. It starts with the handles the
 * first extracted module needs and grows only when a module actually asks for
 * more - a context that predicts its future needs is just the namespace again.
 *
 * Rules for anything added here:
 * - a handle, not a behaviour: no side effects, no derived state;
 * - a getter when the underlying thing is replaced during a session (controls are
 *   rebuilt when the surface normal moves; the socket is reconnected);
 * - types only, so importing this file pulls in no code.
 */
import type * as THREE from 'three';
import type { PlantNodeData } from '../renderers/plant/plantNodeData.ts';

/** Anything that can answer "where is the player looking". */
export interface OrbitLike {
  target: THREE.Vector3;
  update(): void;
}

export interface AppContext {
  readonly camera: THREE.PerspectiveCamera;
  readonly scene: THREE.Scene;
  /** The main WebGL canvas; overlays size themselves from it. */
  readonly canvas: HTMLCanvasElement;
  /** Rebuilt when the surface normal changes, so read it, never capture it. */
  readonly controls: () => OrbitLike;
  readonly plantNodes: Map<string, PlantNodeData>;
  readonly socket: () => WebSocket | null;
}

/** Build the context from the live instances. Called once, after they exist. */
export function createAppContext(parts: AppContext): AppContext {
  return parts;
}
