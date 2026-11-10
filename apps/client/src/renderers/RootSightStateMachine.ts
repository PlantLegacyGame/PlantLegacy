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

export function rootSightStateMachineToggle(machine: RootSightStateMachine): void {
  const { state } = machine;

  if (state === 'surface' || state === 'transitioning_to_surface') {
    machine.target = 'underground';
    if (state === 'surface') {
      machine.state = 'transitioning_to_underground';
    }
  } else if (state === 'underground' || state === 'transitioning_to_underground') {
    machine.target = 'surface';
    if (state === 'underground') {
      machine.state = 'transitioning_to_surface';
    }
  }
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

  // Update state based on progress
  if (machine.progress >= 1) {
    machine.state = 'underground';
  } else if (machine.progress <= 0) {
    machine.state = 'surface';
  }

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
  return machine.state === 'underground' || machine.state === 'transitioning_to_underground';
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
  if (target === 'underground') {
    if (machine.state === 'surface') {
      machine.state = 'transitioning_to_underground';
    }
  } else {
    if (machine.state === 'underground') {
      machine.state = 'transitioning_to_surface';
    }
  }
}
