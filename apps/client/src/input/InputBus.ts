/**
 * C01 input abstraction.
 *
 * Gameplay code never reads raw keys. Keyboard, mouse and touch are
 * *producers*; `controls.json` maps physical inputs to named actions.
 * This module owns the action state and dispatches it to subscribers.
 *
 * DESIGN.md 17.2-17.4. Context rules (17.3): conflicting inputs resolve by
 * priority modal > text input > context actions > camera.
 */

export type ActionMode = 'press' | 'toggle' | 'hold';

export interface Binding {
  keys: string[];
  mouse: string;
  mode: ActionMode;
  context: string;
}

export interface ActionState {
  active: boolean;
  pressed: boolean; // edge trigger for press-mode actions
  toggled: boolean; // latched state for toggle-mode actions
}

export type ActionSubscriber = (actionId: string, state: ActionState) => void;

const MOUSE_BUTTONS: Record<number, string> = {
  0: 'left_click',
  1: 'middle_drag',
  2: 'right_drag',
  3: 'back',
  4: 'forward',
};

import {
  createInputActionStateMachines,
  type InputActionStateMachine,
  inputActionStateMachineGetState,
  inputActionStateMachineIsActive,
  inputActionStateMachineProcess,
} from './InputActionStateMachine';

export class InputBus {
  private readonly bindings = new Map<string, Binding>();
  private machines = new Map<string, InputActionStateMachine>();
  private readonly subscribers = new Set<ActionSubscriber>();
  private activeContext = '';
  private modalOpen = false;
  private textInputActive = false;

  constructor(config: { bindings: Record<string, Binding> }) {
    for (const [action, binding] of Object.entries(config.bindings)) {
      this.bindings.set(action, binding);
    }
    this.machines = createInputActionStateMachines(
      Object.fromEntries(
        Array.from(this.bindings.entries()).map(([action, binding]) => [
          action,
          { mode: binding.mode, context: binding.context },
        ]),
      ),
    );
  }

  /** Replace the binding table at runtime (rebinding screen). */
  setBindings(bindings: Record<string, Binding>): void {
    this.bindings.clear();
    this.machines.clear();
    for (const [action, binding] of Object.entries(bindings)) {
      this.bindings.set(action, binding);
    }
    this.machines = createInputActionStateMachines(
      Object.fromEntries(
        Array.from(this.bindings.entries()).map(([action, binding]) => [
          action,
          { mode: binding.mode, context: binding.context },
        ]),
      ),
    );
  }

  /** All action ids currently bound. */
  get actions(): string[] {
    return Array.from(this.bindings.keys());
  }

  /** Current state of one action. */
  getAction(actionId: string): ActionState | undefined {
    const machine = this.machines.get(actionId);
    if (!machine) return undefined;
    const state = inputActionStateMachineGetState(machine);
    return {
      active: inputActionStateMachineIsActive(machine),
      pressed: state === 'pressed',
      toggled: state === 'toggled',
    };
  }

  /** Is this action active right now? */
  isActive(actionId: string): boolean {
    const machine = this.machines.get(actionId);
    if (!machine) return false;
    return inputActionStateMachineIsActive(machine);
  }

  /** Subscribe to action-state changes. Returns an unsubscribe fn. */
  subscribe(subscriber: ActionSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  /** Current context name. Empty string means "always available". */
  setContext(context: string): void {
    this.activeContext = context;
  }

  /** Modal dialog open blocks context actions and camera. */
  setModalOpen(open: boolean): void {
    this.modalOpen = open;
  }

  /** Text input (chat) active blocks context actions. */
  setTextInputActive(active: boolean): void {
    this.textInputActive = active;
  }

  /** Which actions are valid in the current context (D-15). */
  get validActions(): string[] {
    const out: string[] = [];
    for (const [action, binding] of this.bindings) {
      if (this.modalOpen) continue;
      if (this.textInputActive && action !== 'chat_open' && action !== 'grow_cancel') continue;
      if (binding.context && binding.context !== this.activeContext) continue;
      out.push(action);
    }
    return out;
  }

  // ---- Keyboard producer ---------------------------------------------

  handleKeyDown(code: string): void {
    this.produce('keyboard', code, true);
  }

  handleKeyUp(code: string): void {
    this.produce('keyboard', code, false);
  }

  // ---- Mouse producer ------------------------------------------------

  handleMouseDown(button: number): void {
    const kind = MOUSE_BUTTONS[button];
    if (kind) this.produce('mouse', kind, true);
  }

  handleMouseUp(button: number): void {
    const kind = MOUSE_BUTTONS[button];
    if (kind) this.produce('mouse', kind, false);
  }

  handleWheel(deltaY: number): void {
    // Wheel is a continuous axis, not a press; emit as active/inactive.
    this.produce('mouse', 'wheel', deltaY !== 0);
  }

  // ---- Core producer -------------------------------------------------

  private produce(kind: 'keyboard' | 'mouse', input: string, down: boolean): void {
    if (this.modalOpen) return;

    for (const [action, binding] of this.bindings) {
      if (binding.context && binding.context !== this.activeContext) continue;
      const matched =
        (kind === 'keyboard' && binding.keys.includes(input)) ||
        (kind === 'mouse' && binding.mouse === input);

      if (!matched) continue;

      const machine = this.machines.get(action);
      if (!machine) continue;

      const result = inputActionStateMachineProcess(machine, { kind, down });

      if (result.edge !== 'none') {
        const state = inputActionStateMachineGetState(machine);
        this.emit(action, {
          active: inputActionStateMachineIsActive(machine),
          pressed: state === 'pressed',
          toggled: state === 'toggled',
        });
      }
    }
  }

  private emit(actionId: string, state: ActionState): void {
    for (const subscriber of this.subscribers) {
      subscriber(actionId, { ...state });
    }
  }
}

/** Build a default InputBus from the C01 controls config. */
export function createInputBus(config: { bindings: Record<string, Binding> }): InputBus {
  return new InputBus(config);
}
