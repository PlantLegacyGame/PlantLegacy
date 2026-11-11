/**
 * @plant-legacy/input - InputBus action dispatcher.
 *
 * Gameplay code never reads raw keys. Keyboard, mouse and touch are
 * *producers*; a controls config maps physical inputs to named actions.
 * This module owns the action state and dispatches it to subscribers.
 *
 * Dependency-free: no Three.js, no Vite, no DOM. Works in any JS/TS runtime.
 */

export type ActionMode = 'press' | 'toggle' | 'hold';

export interface Binding {
  keys: string[];
  mouse: string;
  mode: ActionMode;
  context: string;
  modifiers?: ('shift' | 'ctrl' | 'alt' | 'meta')[];
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
} from './InputActionStateMachine.ts';

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

  /** Which actions are valid in the current context. */
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

  handleKeyDown(
    code: string,
    modifiers: { shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean } = {},
  ): void {
    this.produce('keyboard', code, true, modifiers);
  }

  handleKeyUp(
    code: string,
    modifiers: { shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean } = {},
  ): void {
    this.produce('keyboard', code, false, modifiers);
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
    this.produce('mouse', 'wheel', deltaY !== 0);
  }

  // ---- Core producer -------------------------------------------------

  private produce(
    kind: 'keyboard' | 'mouse',
    input: string,
    down: boolean,
    modifiers: { shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean } = {},
  ): void {
    if (this.modalOpen) return;

    for (const [action, binding] of this.bindings) {
      if (binding.context && binding.context !== this.activeContext) continue;
      const keyMatched = kind === 'keyboard' && binding.keys.includes(input);
      const mouseMatched = kind === 'mouse' && binding.mouse === input;
      if (!keyMatched && !mouseMatched) continue;

      if (binding.modifiers && binding.modifiers.length > 0) {
        const requiredModifiers = binding.modifiers;
        const hasAllModifiers = requiredModifiers.every((mod) => modifiers[mod] === true);
        if (!hasAllModifiers) continue;
      }

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

/** Build a default InputBus from a controls config bindings object. */
export function createInputBus(config: { bindings: Record<string, Binding> }): InputBus {
  return new InputBus(config);
}
