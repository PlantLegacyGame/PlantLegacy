/**
 * The action rail: the game's verbs as one column of drawn buttons.
 *
 * Everything except movement used to be keyboard-only (G, I, T, E, H), with the
 * only list of keys buried in a debug readout. A player who never opens that
 * readout has no way to find the inventory, and a touch player has no way to use
 * it at all. The rail is the same set of verbs on both devices.
 *
 * It was a capsule of labelled pills along the bottom, under the hotbar: seven
 * words with key badges stacked in a bar that read as one lump of chrome, sitting
 * exactly where the pouch belongs (play-test 2026-11-26: "everything is in one
 * place which doesn't make it fun and inventory is supposed to be down there not
 * those buttons in a capsule"). The verbs are now a slim rail on the left edge,
 * out of the bottom strip the hotbar owns, and each one is a drawing it takes a
 * glance to read instead of a word it takes a second to. The words stay for
 * assistive tech and for a hovering mouse, in the label and the tooltip.
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
  /** Replace the key badge after a rebind (`null` hides it). */
  setKey(id: string, key: string | null): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

/**
 * One drawing per verb, in the same 24-unit line language as the item icons.
 *
 * Ids are the action ids `main.ts` builds the rail from; an id with no drawing
 * gets the dot, so a new verb is visible before it is illustrated rather than
 * invisible because it is not.
 */
const GLYPHS: Record<string, string> = {
  // A seedling with the arrow it will grow along.
  grow:
    '<path d="M12 20.4v-6.2"/><path d="M12 14.2c0-3.4 2.4-5.6 5.6-5.6 0 3.4-2.4 5.6-5.6 5.6Z"/>' +
    '<path d="M12 14.2c0-2.6-1.9-4.4-4.4-4.4 0 2.6 1.9 4.4 4.4 4.4Z" opacity=".7"/>' +
    '<path d="M12 4.2 9.6 6.6M12 4.2l2.4 2.4M12 4.2v3.4" opacity=".8"/>',
  // A root fork, for the sight that goes under the soil.
  rootsight:
    '<path d="M12 3.6v6.6"/>' +
    '<path d="M12 10.2c0 3.2-2.2 5-4.6 6.4"/><path d="M12 10.2c0 3.2 2.2 5 4.6 6.4"/>' +
    '<path d="M7.4 16.6c-1.2.9-1.8 2-1.9 3.4"/><path d="M16.6 16.6c1.2.9 1.8 2 1.9 3.4"/>' +
    '<path d="M12 10.2v9.6" opacity=".55"/>',
  // A satchel, for the pouch.
  inventory:
    '<path d="M5.6 8.6h12.8v10a2 2 0 0 1-2 2H7.6a2 2 0 0 1-2-2Z"/>' +
    '<path d="M9 8.6V6.8a3 3 0 0 1 6 0v1.8"/>' +
    '<path d="M9.4 13.2h5.2" opacity=".55"/>',
  // A speech bubble.
  chat:
    '<path d="M4.4 6.6h15.2v9.2H11l-4.4 3.6v-3.6H4.4Z"/>' +
    '<path d="M8.4 11.2h7.2" opacity=".55"/>',
  // A face, for the emote wheel.
  emotes:
    '<circle cx="12" cy="12" r="8.4"/>' +
    '<circle cx="9.4" cy="10.2" r=".9"/><circle cx="14.6" cy="10.2" r=".9"/>' +
    '<path d="M8.8 14.4c.8 1.2 1.9 1.8 3.2 1.8s2.4-.6 3.2-1.8"/>',
  // A lamp, for hints.
  hints:
    '<path d="M12 3.6a5.6 5.6 0 0 1 3.1 10.3v2.3H8.9v-2.3A5.6 5.6 0 0 1 12 3.6Z"/>' +
    '<path d="M9.9 19h4.2" opacity=".7"/><path d="M10.6 21.2h2.8" opacity=".45"/>',
  // Two bars, for the menu.
  pause: '<path d="M9.4 5.6v12.8"/><path d="M14.6 5.6v12.8"/>',
};

const DOT_GLYPH = '<circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/>';

function glyphFor(id: string): string {
  return GLYPHS[id] ?? DOT_GLYPH;
}

const STYLE = `
  .pl-actionbar {
    position: fixed;
    left: calc(var(--hud-corner, 12px) + env(safe-area-inset-left, 0px));
    top: 50%;
    transform: translateY(-50%);
    z-index: 210;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    padding: 6px;
    box-sizing: border-box;
    border: 1px solid var(--hud-border);
    border-radius: 16px;
    background: linear-gradient(180deg, rgba(18, 23, 14, 0.86), rgba(10, 13, 8, 0.92));
    box-shadow: var(--hud-shadow-sm);
    pointer-events: auto;
    transition: opacity 160ms ease;
  }
  .pl-actionbar[hidden] { display: none; }
  /* A column, not a row: the bottom strip belongs to the hotbar and the pouch, so
     the verbs stand where a thumb already rests on a phone and out of the way of
     the ground the player is reading. */
  .pl-actionbar__row {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
  }
  .pl-actionbar__btn {
    position: relative;
    display: grid;
    place-items: center;
    width: 42px;
    height: 42px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 12px;
    background: rgba(42, 52, 30, 0.5);
    color: var(--bone-200);
    font: inherit;
    cursor: pointer;
    transition: background 140ms ease, border-color 140ms ease, transform 120ms ease, color 140ms ease;
  }
  .pl-actionbar__btn:hover {
    background: rgba(90, 144, 46, 0.26);
    border-color: var(--leaf-500);
    color: var(--leaf-200);
  }
  .pl-actionbar__btn:active { transform: scale(0.94); }
  .pl-actionbar__btn:focus-visible {
    outline: 2px solid var(--leaf-300);
    outline-offset: 2px;
  }
  .pl-actionbar__btn[aria-pressed='true'] {
    background: linear-gradient(180deg, var(--leaf-400), var(--leaf-600));
    border-color: var(--leaf-300);
    color: #0d1408;
  }
  .pl-actionbar__glyph { display: block; width: 21px; height: 21px; }
  .pl-actionbar__key {
    position: absolute;
    right: -3px;
    bottom: -3px;
    min-width: 13px;
    padding: 0 3px;
    border-radius: 4px;
    border: 1px solid rgba(239, 233, 216, 0.18);
    background: rgba(8, 11, 6, 0.86);
    color: var(--bone-300);
    font-size: 9px;
    line-height: 12px;
    text-align: center;
    letter-spacing: 0;
    pointer-events: none;
  }
  .pl-actionbar__key[hidden] { display: none; }
  .pl-actionbar__btn[aria-pressed='true'] .pl-actionbar__key {
    border-color: rgba(13, 20, 8, 0.3);
    background: rgba(13, 20, 8, 0.55);
    color: var(--leaf-100);
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
  /* A finger has no keyboard: drop the key badges and grow the target. This is
     the only place the touch layout is chosen - by pointer capability, never by
     window width - so a desktop keeps its key badges however narrow the window
     is, and only a device with no hovering pointer gets thumb buttons. */
  @media (hover: none) and (pointer: coarse) {
    .pl-actionbar__btn { width: 48px; height: 48px; }
    .pl-actionbar__glyph { width: 24px; height: 24px; }
    .pl-actionbar__key { display: none; }
  }
  @media (max-height: 520px) {
    .pl-actionbar { gap: 3px; padding: 4px; }
    .pl-actionbar__row { gap: 3px; }
    .pl-actionbar__btn { width: 34px; height: 34px; border-radius: 10px; }
    .pl-actionbar__glyph { width: 17px; height: 17px; }
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
  const keyBadges = new Map<string, HTMLElement>();
  const labels = new Map<string, string>();
  for (const action of options.actions) labels.set(action.id, action.label);
  for (const action of options.actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pl-actionbar__btn';
    button.dataset.action = action.id;
    button.setAttribute(
      'aria-label',
      action.key ? `${action.label} (${action.key})` : action.label,
    );
    // The drawing, not the word. It is built here rather than set as innerHTML on
    // the button so the key badge and the unread dot keep their own nodes.
    const glyph = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    glyph.setAttribute('class', 'pl-actionbar__glyph');
    glyph.setAttribute('viewBox', '0 0 24 24');
    glyph.setAttribute('aria-hidden', 'true');
    glyph.setAttribute('focusable', 'false');
    glyph.setAttribute('fill', 'none');
    glyph.setAttribute('stroke', 'currentColor');
    glyph.setAttribute('stroke-width', '1.6');
    glyph.setAttribute('stroke-linecap', 'round');
    glyph.setAttribute('stroke-linejoin', 'round');
    glyph.innerHTML = glyphFor(action.id);
    button.appendChild(glyph);
    // The word is still one hover away, and it is the whole tooltip: a player who
    // does not recognise the drawing can find out without clicking it.
    button.title = action.key ? `${action.label} (${action.key})` : action.label;
    const key = document.createElement('kbd');
    key.className = 'pl-actionbar__key';
    key.textContent = action.key ?? '';
    key.hidden = !action.key;
    button.appendChild(key);
    keyBadges.set(action.id, key);
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

  // The rail is a column on the left now, so it no longer owns the bottom
  // offset the hint and the pouch stack against: the hotbar publishes that
  // (`--pl-bar-offset`), because the hotbar is what sits on the bottom edge.

  return {
    element: bar,
    setActive: (id, active) => {
      const button = buttons.get(id);
      if (button) button.setAttribute('aria-pressed', active ? 'true' : 'false');
    },
    setKey: (id, key) => {
      const badge = keyBadges.get(id);
      const button = buttons.get(id);
      if (!badge || !button) return;
      badge.textContent = key ?? '';
      badge.hidden = !key;
      const label = labels.get(id) ?? '';
      button.setAttribute('aria-label', key ? `${label} (${key})` : label);
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
    },
    destroy: () => {
      bar.remove();
      buttons.clear();
      badges.clear();
      keyBadges.clear();
    },
  };
}
