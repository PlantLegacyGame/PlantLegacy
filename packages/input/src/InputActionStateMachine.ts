/**
 * @plant-legacy/input - Input action state machine.
 *
 * Dependency-free finite state machine for mapping raw keyboard/mouse inputs
 * to named actions with configurable modes: press (edge), toggle (latch), hold
 * (continuous while down). Reusable across any project needing input abstraction.
 */

export type ActionMode = 'press' | 'toggle' | 'hold';

export type InputActionState = 'inactive' | 'pressed' | 'active' | 'toggled';

export interface InputActionConfig {
  mode: ActionMode;
  context: string;
}

export interface InputActionStateMachine {
  state: InputActionState;
  config: InputActionConfig;
}

export interface InputActionEvent {
  kind: 'keyboard' | 'mouse';
  down: boolean;
}

export function createInputActionStateMachine(config: InputActionConfig): InputActionStateMachine {
  return {
    state: 'inactive',
    config,
  };
}

export function inputActionStateMachineProcess(
  machine: InputActionStateMachine,
  event: InputActionEvent,
): {
  state: InputActionState;
  edge: 'pressed' | 'released' | 'toggled_on' | 'toggled_off' | 'none';
} {
  const { state, config } = machine;
  const { mode } = config;

  if (event.down) {
    switch (mode) {
      case 'press':
        if (state === 'inactive') {
          machine.state = 'active';
          return { state: 'active', edge: 'pressed' };
        }
        break;
      case 'toggle':
        if (state === 'inactive') {
          machine.state = 'toggled';
          return { state: 'toggled', edge: 'toggled_on' };
        } else if (state === 'toggled') {
          machine.state = 'inactive';
          return { state: 'inactive', edge: 'toggled_off' };
        }
        break;
      case 'hold':
        if (state === 'inactive' || state === 'pressed') {
          machine.state = 'active';
          return { state: 'active', edge: 'pressed' };
        }
        break;
    }
  } else {
    switch (mode) {
      case 'press':
        if (state === 'active') {
          machine.state = 'inactive';
          return { state: 'inactive', edge: 'released' };
        }
        break;
      case 'toggle':
        break;
      case 'hold':
        if (state === 'active') {
          machine.state = 'inactive';
          return { state: 'inactive', edge: 'released' };
        }
        break;
    }
  }

  return { state: machine.state, edge: 'none' };
}

export function inputActionStateMachineGetState(
  machine: InputActionStateMachine,
): InputActionState {
  return machine.state;
}

export function inputActionStateMachineIsActive(machine: InputActionStateMachine): boolean {
  return machine.state === 'active' || machine.state === 'toggled';
}

export function inputActionStateMachineReset(machine: InputActionStateMachine): void {
  machine.state = 'inactive';
}

export function createInputActionStateMachines(
  configs: Record<string, InputActionConfig>,
): Map<string, InputActionStateMachine> {
  const machines = new Map<string, InputActionStateMachine>();
  for (const [action, config] of Object.entries(configs)) {
    machines.set(action, createInputActionStateMachine(config));
  }
  return machines;
}
