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

export function createInputActionStateMachine(config: InputActionConfig): InputActionStateMachine {
  return {
    state: 'inactive',
    config,
  };
}

export interface InputActionEvent {
  kind: 'keyboard' | 'mouse';
  down: boolean;
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
    // Key/button pressed
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
    // Key/button released
    switch (mode) {
      case 'press':
        if (state === 'active') {
          machine.state = 'inactive';
          return { state: 'inactive', edge: 'released' };
        }
        break;
      case 'toggle':
        // Toggle mode ignores release
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
