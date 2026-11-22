/**
 * The action bar: the game's verbs in one reachable row.
 *
 * Everything except movement used to be keyboard-only (G, I, T, E, H), with the
 * only list of keys buried in a debug readout. A player who never opens that
 * readout has no way to find the inventory, and a touch player has no way to use
 * it at all. The bar is the same set of verbs on both: a labelled pill with its
 * key badge on a desktop, a larger badge-less pill on a touch screen.
 */

export interface ActionBarAction {
  id: string;
  label: string;
  /** Key that also triggers it, shown as a badge on pointer devices. */
  key?: string;
}

export interface ActionBarOptions {
  mount: HTMLElement;
  actions: ActionBarAction[];
  onAction: (id: string) => void;
}

export interface ActionBarAPI {
  readonly element: HTMLElement;
  /** Marks a toggle-like action as on. */
  setActive(id: string, active: boolean): void;
  /** Unread count for an action (chat). 0 hides the badge. */
  setBadge(id: string, count: number): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

const STYLE = `
  .pl-actionbar {
    position: fixed;
    left: 50%;
    bottom: calc(var(--hud-corner) + env(safe-area-inset-bottom, 0px));
    transform: translateX(-50%);
    z-index: 210;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 6px;
    box-sizing: border-box;
    width: max-content;
    max-width: calc(100vw - 2 * var(--hud-corner));
    flex-wrap: nowrap;
    justify-content: center;
    border: 1px solid var(--hud-border);
    border-radius: 14px;
    background: linear-gradient(180deg, rgba(18, 23, 14, 0.9), rgba(10, 13, 8, 0.94));
    box-shadow: var(--hud-shadow-sm);
    pointer-events: auto;
    transition: opacity 160ms ease;
  }
  .pl-actionbar[hidden] { display: none; }
  .pl-actionbar__row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    flex-wrap: nowrap;
  }
  .pl-actionbar__btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 34px;
    padding: 6px 12px;
    border: 1px solid transparent;
    border-radius: 10px;
    background: rgba(42, 52, 30, 0.55);
    color: var(--bone-200);
    font: inherit;
    font-size: var(--hud-font-sm);
    letter-spacing: 0.01em;
    cursor: pointer;
    white-space: nowrap;
    transition: background 140ms ease, border-color 140ms ease, transform 120ms ease;
  }
  .pl-actionbar__btn:hover {
    background: rgba(90, 144, 46, 0.28);
    border-color: var(--leaf-500);
  }
  .pl-actionbar__btn:active { transform: scale(0.96); }
  .pl-actionbar__btn:focus-visible {
    outline: 2px solid var(--leaf-300);
    outline-offset: 2px;
  }
  .pl-actionbar__btn[aria-pressed='true'] {
    background: linear-gradient(180deg, var(--leaf-500), var(--leaf-700));
    border-color: var(--leaf-300);
    color: #0d1408;
    font-weight: 700;
  }
  .pl-actionbar__key {
    min-width: 16px;
    padding: 0 4px;
    border-radius: 4px;
    border: 1px solid rgba(239, 233, 216, 0.22);
    background: rgba(8, 11, 6, 0.55);
    color: var(--bone-300);
    font-size: var(--hud-font-xs);
    line-height: 15px;
    text-align: center;
  }
  .pl-actionbar__badge {
    position: absolute;
    top: -5px;
    right: -5px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--ember-500, #ee7040);
    color: #180b06;
    font-size: 10px;
    font-weight: 800;
    line-height: 16px;
    text-align: center;
    box-shadow: 0 0 0 2px rgba(10, 13, 8, 0.9);
    pointer-events: none;
  }
  .pl-actionbar__badge[hidden] { display: none; }
  .pl-actionbar__btn[aria-pressed='true'] .pl-actionbar__key {
    border-color: rgba(13, 20, 8, 0.35);
    background: rgba(13, 20, 8, 0.18);
    color: #0d1408;
  }
  /* A finger has no keyboard: drop the badges and grow the target. This is the
     only place the touch layout is chosen - by pointer capability, never by
     window width - so a desktop keeps its key badges however narrow the window
     is, and only a device with no hovering pointer gets the thumb buttons. */
  @media (hover: none) and (pointer: coarse) {
    .pl-actionbar__btn { min-height: 48px; padding: 10px 16px; font-size: 0.86rem; }
    .pl-actionbar__key { display: none; }
    /* Seven thumb-sized verbs are wider than a phone held upright, and a row that
       overflows the pane is a verb nobody can reach. The row wraps instead, and
       each line shares its width; a landscape phone still fits one row, so the
       bar only grows tall where it has to. */
    .pl-actionbar__row { flex-wrap: wrap; gap: 4px; }
    .pl-actionbar__btn { flex: 1 1 auto; justify-content: center; }
  }
  @media (max-width: 560px) {
    .pl-actionbar { gap: 3px; padding: 5px; }
    .pl-actionbar__row { gap: 3px; }
    .pl-actionbar__btn { padding: 6px 8px; font-size: 0.78rem; }
    /* The key badges stay: a narrow window is still a desktop. Only the coarse
       pointer block above drops them. */
  }
  /* Only the very narrowest screens have to stack. */
  @media (max-width: 380px) {
    .pl-actionbar__row { flex-wrap: wrap; }
  }
  @media (prefers-reduced-motion: reduce) {
    .pl-actionbar__btn { transition: none; }
  }
`;

export function createActionBar(options: ActionBarOptions): ActionBarAPI {
  if (!document.getElementById('pl-actionbar-style')) {
    const style = document.createElement('style');
    style.id = 'pl-actionbar-style';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  const bar = document.createElement('div');
  bar.className = 'pl-actionbar';
  bar.id = 'action-bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Actions');

  const row = document.createElement('div');
  row.className = 'pl-actionbar__row';
  bar.appendChild(row);

  const buttons = new Map<string, HTMLButtonElement>();
  const badges = new Map<string, HTMLSpanElement>();
  for (const action of options.actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pl-actionbar__btn';
    button.dataset.action = action.id;
    button.setAttribute(
      'aria-label',
      action.key ? `${action.label} (${action.key})` : action.label,
    );
    const label = document.createElement('span');
    label.textContent = action.label;
    button.appendChild(label);
    if (action.key) {
      const key = document.createElement('kbd');
      key.className = 'pl-actionbar__key';
      key.textContent = action.key;
      button.appendChild(key);
    }
    // A badge, not an auto-opening panel: chat used to pop open for five seconds
    // on every message, which on a phone meant a full-width panel over the HUD.
    const badge = document.createElement('span');
    badge.className = 'pl-actionbar__badge';
    badge.hidden = true;
    button.appendChild(badge);
    badges.set(action.id, badge);
    button.addEventListener('click', (event) => {
      // A pointer click must not leave focus on the pill. A focused button is what
      // Space and Enter activate, so the next in-game key press re-ran the HUD verb
      // (Menu reopened the pause menu, Grow re-toggled grow mode) instead of the
      // action the player meant. Keyboard activation reports detail 0 and keeps
      // focus, which is what a keyboard user needs to keep tabbing.
      if ((event as MouseEvent).detail > 0) button.blur();
      options.onAction(action.id);
    });
    row.appendChild(button);
    buttons.set(action.id, button);
  }

  options.mount.appendChild(bar);

  // Publish our own height: the context hint stacks above the bar and reads this
  // instead of guessing. A hidden bar reports 0, a wrapped one its new height.
  const publishHeight = (): void => {
    document.documentElement.style.setProperty(
      '--pl-bar-offset',
      `${bar.hidden ? 0 : Math.round(bar.getBoundingClientRect().height)}px`,
    );
  };
  const observer = new ResizeObserver(publishHeight);
  observer.observe(bar);
  publishHeight();

  return {
    element: bar,
    setActive: (id, active) => {
      const button = buttons.get(id);
      if (button) button.setAttribute('aria-pressed', active ? 'true' : 'false');
    },
    setBadge: (id, count) => {
      const badge = badges.get(id);
      if (!badge) return;
      const shown = Math.max(0, Math.round(count));
      badge.hidden = shown === 0;
      badge.textContent = shown > 9 ? '9+' : String(shown);
      const button = buttons.get(id);
      if (button) {
        const label = button.getAttribute('aria-label') ?? '';
        // The old pattern was `/ (d+ new)$/`: `d` is a letter, so it never
        // matched and every update appended another "(N new)" to the label the
        // screen reader announced.
        const base = label.replace(/ \(\d+ new\)$/, '');
        button.setAttribute('aria-label', shown > 0 ? `${base} (${shown} new)` : base);
      }
    },
    setVisible: (visible) => {
      bar.hidden = !visible;
      // A hidden element has no height, so measure again on the way back rather
      // than waiting for a size change that may never come.
      publishHeight();
    },
    destroy: () => {
      observer.disconnect();
      bar.remove();
      buttons.clear();
    },
  };
}
