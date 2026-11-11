/**
 * @plant-legacy/input - Input action abstraction package.
 *
 * Provides InputBus (action dispatcher) and InputActionStateMachine
 * (per-action finite state machine). Dependency-free and reusable
 * across any JS/TS project needing keyboard/mouse input abstraction.
 */

export type ActionMode = 'press' | 'toggle' | 'hold';
export type InputActionState = 'inactive' | 'pressed' | 'active' | 'toggled';

export interface Binding {
  keys: string[];
  mouse: string;
  mode: ActionMode;
  context: string;
  modifiers?: ('shift' | 'ctrl' | 'alt' | 'meta')[];
}

export interface ActionState {
  active: boolean;
  pressed: boolean;
  toggled: boolean;
}

export interface InputActionStateMachine {
  state: InputActionState;
  config: InputActionConfig;
}

export interface InputActionEvent {
  kind: 'keyboard' | 'mouse';
  down: boolean;
}

export type ActionSubscriber = (actionId: string, state: ActionState) => void;

export interface InputActionConfig {
  mode: ActionMode;
  context: string;
}

export {
  createInputActionStateMachine,
  createInputActionStateMachines,
  inputActionStateMachineGetState,
  inputActionStateMachineIsActive,
  inputActionStateMachineProcess,
  inputActionStateMachineReset,
} from './InputActionStateMachine.ts';
export {
  createInputBus,
  InputBus,
} from './InputBus.ts';
