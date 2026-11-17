import * as THREE from 'three';

export type RootSightState =
  | 'surface'
  | 'transitioning_to_underground'
  | 'underground'
  | 'transitioning_to_surface';

export interface RootSightConfig {
  transitionMs: number;
  cutawayRadius: number;
  soilOpacity: number;
  cameraTarget: 'own_plant' | 'camera_position';
}

export interface RootSightContext {
  ownPlantPosition: THREE.Vector3 | null;
  cameraPosition: THREE.Vector3;
  cameraTarget: THREE.Vector3;
}

export interface RootSightStateMachine {
  state: RootSightState;
  progress: number; // 0.0 - 1.0
  config: RootSightConfig;
  target: 'surface' | 'underground';
  context: RootSightContext | null;
}

export function createRootSightStateMachine(config: RootSightConfig): RootSightStateMachine {
  return {
    state: 'surface',
    progress: 0,
    config,
    target: 'surface',
    context: null,
  };
}

/**
 * The state a machine should report for its current target and progress.
 *
 * A transition that is still moving has a direction, and the state has to say
 * which one: the old code only relabelled at the two endpoints, so re-opening
 * during a close kept reporting `transitioning_to_surface` all the way up. Every
 * reader of `rootSightStateMachineIsEnabled` (underground view, root picking,
 * the camera floor) then treated an opening cavity as closed.
 */
function transitionStateFor(machine: RootSightStateMachine): RootSightState {
  if (machine.target === 'underground') {
    return machine.progress >= 1 ? 'underground' : 'transitioning_to_underground';
  }
  return machine.progress <= 0 ? 'surface' : 'transitioning_to_surface';
}

export function rootSightStateMachineToggle(machine: RootSightStateMachine): void {
  const { state } = machine;

  if (state === 'surface' || state === 'transitioning_to_surface') {
    machine.target = 'underground';
  } else if (state === 'underground' || state === 'transitioning_to_underground') {
    machine.target = 'surface';
  }
  machine.state = transitionStateFor(machine);
}

export function rootSightStateMachineUpdate(
  machine: RootSightStateMachine,
  deltaTime: number,
): { progress: number; eased: number; targetPosition: THREE.Vector3 } {
  const { config, target } = machine;
  const duration = config.transitionMs / 1000;
  const goal = target === 'underground' ? 1 : 0;

  if (duration <= 0) {
    machine.progress = goal;
  } else {
    const step = deltaTime / duration;
    if (machine.progress < goal) {
      machine.progress = Math.min(goal, machine.progress + step);
    } else {
      machine.progress = Math.max(goal, machine.progress - step);
    }
  }

  // Update state from where the transition now is, in whichever direction it is
  // moving. Deriving the label instead of only stamping the endpoints is what
  // makes a reversed transition report its new direction immediately.
  machine.state = transitionStateFor(machine);

  // Ease-out for visual blend
  const eased = 1 - (1 - machine.progress) ** 3;

  // Compute target position based on config
  let targetPosition: THREE.Vector3;
  if (config.cameraTarget === 'camera_position') {
    targetPosition = machine.context?.cameraPosition ?? new THREE.Vector3();
  } else {
    targetPosition =
      machine.context?.ownPlantPosition ?? machine.context?.cameraTarget ?? new THREE.Vector3();
  }

  return { progress: machine.progress, eased, targetPosition };
}

export function rootSightStateMachineSetContext(
  machine: RootSightStateMachine,
  context: RootSightContext,
): void {
  machine.context = context;
}

export function rootSightStateMachineGetState(machine: RootSightStateMachine): RootSightState {
  return machine.state;
}

export function rootSightStateMachineGetProgress(machine: RootSightStateMachine): number {
  return machine.progress;
}

export function rootSightStateMachineIsEnabled(machine: RootSightStateMachine): boolean {
  // Any visible cavity counts, including one that is still closing. Gating this
  // on "underground or opening" used to turn the underground plant view and
  // root picking off on the first frame of a close, while the soil was still
  // open, and made a reversed close look like it had not re-opened.
  return machine.state !== 'surface' || machine.progress > 0;
}

export function rootSightStateMachineReset(machine: RootSightStateMachine): void {
  machine.state = 'surface';
  machine.progress = 0;
  machine.target = 'surface';
}

export function rootSightStateMachineSetTarget(
  machine: RootSightStateMachine,
  target: 'surface' | 'underground',
): void {
  machine.target = target;
  machine.state = transitionStateFor(machine);
}
