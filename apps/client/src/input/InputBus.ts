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

export class InputBus {
  private readonly bindings = new Map<string, Binding>();
  private readonly state = new Map<string, ActionState>();
  private readonly subscribers = new Set<ActionSubscriber>();
  private activeContext = '';
  private modalOpen = false;
  private textInputActive = false;

  constructor(config: { bindings: Record<string, Binding> }) {
    for (const [action, binding] of Object.entries(config.bindings)) {
      this.bindings.set(action, binding);
      this.state.set(action, { active: false, pressed: false, toggled: false });
    }
  }

  /** Replace the binding table at runtime (rebinding screen). */
  setBindings(bindings: Record<string, Binding>): void {
    this.bindings.clear();
    this.state.clear();
    for (const [action, binding] of Object.entries(bindings)) {
      this.bindings.set(action, binding);
      this.state.set(action, { active: false, pressed: false, toggled: false });
    }
  }

  /** All action ids currently bound. */
  get actions(): string[] {
    return Array.from(this.bindings.keys());
  }

  /** Current state of one action. */
  getAction(actionId: string): ActionState | undefined {
    return this.state.get(actionId);
  }

  /** Is this action active right now? */
  isActive(actionId: string): boolean {
    return this.state.get(actionId)?.active ?? false;
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

      const state = this.state.get(action);
      if (!state) continue;

      if (binding.mode === 'press') {
        if (down && !state.active) {
          state.active = true;
          state.pressed = true;
          this.emit(action, state);
        } else if (!down && state.active) {
          state.active = false;
          state.pressed = false;
          this.emit(action, state);
        }
      } else if (binding.mode === 'toggle') {
        if (down && !state.pressed) {
          state.toggled = !state.toggled;
          state.active = state.toggled;
          state.pressed = true;
          this.emit(action, state);
        } else if (!down) {
          state.pressed = false;
        }
      } else if (binding.mode === 'hold') {
        state.active = down;
        state.pressed = down;
        this.emit(action, state);
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
