/**
 * The hotbar: the ten slots the number keys address.
 *
 * The inventory panel and the hotbar read the same server-authoritative pouch.
 * Before this, `1`-`0` called `selectSlot`, which returns unless the inventory
 * panel is open - so the advertised number keys did nothing during play - and
 * there was no on-screen slot to press on a phone at all. This is the missing
 * half of the control: a bar that is always up in the world, and the same
 * selection the keys move.
 *
 * It owns no item data. `main.ts` feeds it the slots and definitions that arrive
 * with INVENTORY_SYNC, exactly as it feeds the inventory panel.
 */

export interface HotbarSlot {
  itemId: string;
  count: number;
}

export interface HotbarDefinition {
  id: string;
  name: string;
  /** A short glyph or emoji from the server's definition, when it has one. */
  icon?: string;
}

export interface HotbarOptions {
  mount: HTMLElement;
  /** The slot the player picked. */
  onSelect?: (index: number) => void;
  /** Use the slot that was picked. */
  onUse?: (index: number) => void;
}

export interface HotbarAPI {
  readonly element: HTMLElement;
  setSlots(slots: ReadonlyArray<HotbarSlot | null>, maxSlots: number): void;
  setDefinitions(definitions: ReadonlyArray<HotbarDefinition>): void;
  select(index: number): void;
  /** Select and use one slot, the way a number key does. */
  use(index: number): void;
  readonly selected: number;
  setVisible(visible: boolean): void;
  destroy(): void;
}

const STYLE_ID = 'pl-hotbar-style';

const STYLE = `
  .pl-hotbar {
    position: fixed;
    left: 50%;
    bottom: calc(var(--pl-hotbar-bottom, 84px) + env(safe-area-inset-bottom, 0px));
    transform: translateX(-50%);
    display: flex;
    gap: 6px;
    padding: 6px;
    border-radius: 14px;
    background: color-mix(in srgb, var(--pl-panel, #1c1710) 82%, transparent);
    border: 1px solid color-mix(in srgb, var(--pl-line, #6b5c42) 55%, transparent);
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.35);
    z-index: 40;
    pointer-events: auto;
    user-select: none;
    -webkit-user-select: none;
    touch-action: manipulation;
  }
  .pl-hotbar[hidden] { display: none; }
  .pl-hotbar__slot {
    position: relative;
    width: 46px;
    height: 46px;
    min-width: 44px;
    min-height: 44px;
    padding: 0;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--pl-line, #6b5c42) 45%, transparent);
    background: color-mix(in srgb, var(--pl-slot, #2a2318) 88%, transparent);
    color: var(--pl-ink, #efe6d2);
    font: inherit;
    cursor: pointer;
    display: grid;
    place-items: center;
    overflow: hidden;
  }
  .pl-hotbar__slot:focus-visible {
    outline: 2px solid var(--pl-focus, #ffd27a);
    outline-offset: 2px;
  }
  .pl-hotbar__slot[aria-pressed="true"] {
    border-color: var(--pl-focus, #ffd27a);
    box-shadow: inset 0 0 0 1px var(--pl-focus, #ffd27a), 0 0 10px rgba(255, 210, 122, 0.3);
    background: color-mix(in srgb, var(--pl-focus, #ffd27a) 16%, var(--pl-slot, #2a2318));
  }
  .pl-hotbar__slot.is-empty { opacity: 0.55; cursor: default; }
  .pl-hotbar__icon { font-size: 18px; line-height: 1; }
  .pl-hotbar__count {
    position: absolute;
    right: 3px;
    bottom: 2px;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    color: var(--pl-ink-dim, #cbbfa4);
    text-shadow: 0 1px 0 rgba(0, 0, 0, 0.6);
  }
  .pl-hotbar__key {
    position: absolute;
    left: 4px;
    top: 2px;
    font-size: 9px;
    color: var(--pl-ink-dim, #cbbfa4);
    opacity: 0.85;
  }
  /* Phones: above the thumb's resting place, and above the action bar. */
  @media (hover: none) and (pointer: coarse) {
    .pl-hotbar { --pl-hotbar-bottom: 96px; gap: 3px; padding: 4px; }
    /* Ten slots at 44 px plus gaps is 478 px: it fits a 480 px phone edge to
       edge, and the bar is capped so it never overflows a narrower one. */
    .pl-hotbar {
      max-width: calc(100vw - 12px);
      overflow-x: auto;
      scrollbar-width: none;
    }
    .pl-hotbar::-webkit-scrollbar { display: none; }
    .pl-hotbar__slot { width: 44px; height: 44px; min-width: 44px; min-height: 44px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .pl-hotbar__slot { transition: none; }
  }
`;

function installStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}

/** The digit a slot answers to: 1..9, then 0 for the tenth. */
export function hotbarKeyLabel(index: number): string {
  return index === 9 ? '0' : String(index + 1);
}

export function createHotbar(options: HotbarOptions): HotbarAPI {
  installStyles();
  const element = document.createElement('div');
  element.className = 'pl-hotbar';
  element.setAttribute('role', 'toolbar');
  element.setAttribute('aria-label', 'Hotbar');
  // A toolbar of toggle buttons: one tab stop for the bar, arrows between slots,
  // so the number keys and the keyboard never fight over the same focus.
  element.setAttribute('aria-orientation', 'horizontal');

  let slots: ReadonlyArray<HotbarSlot | null> = [];
  let definitions = new Map<string, HotbarDefinition>();
  let selected = -1;
  let buttons: HTMLButtonElement[] = [];

  const paint = (): void => {
    for (let index = 0; index < buttons.length; index += 1) {
      const button = buttons[index];
      const slot = slots[index] ?? null;
      const definition = slot ? definitions.get(slot.itemId) : undefined;
      const icon = button.querySelector<HTMLElement>('.pl-hotbar__icon');
      const count = button.querySelector<HTMLElement>('.pl-hotbar__count');
      const name = definition?.name ?? slot?.itemId ?? 'Empty';
      button.classList.toggle('is-empty', !slot);
      button.setAttribute('aria-pressed', String(index === selected));
      // The key is drawn in the corner; this is the same fact for assistive tech,
      // which does not read the decorative span.
      button.setAttribute('aria-keyshortcuts', hotbarKeyLabel(index));
      button.setAttribute('aria-label', `${name} - slot ${index + 1}`);
      button.title = slot
        ? `${name} (${hotbarKeyLabel(index)})`
        : `Empty (${hotbarKeyLabel(index)})`;
      if (icon) icon.textContent = slot ? (definition?.icon ?? '◆') : '';
      if (count) count.textContent = slot && slot.count > 1 ? String(slot.count) : '';
      // Roving tab stop: the bar is one stop in the page's tab order, and the
      // arrows walk it. Ten tab stops between the canvas and the next control
      // would trap a keyboard player in the hotbar.
      button.tabIndex = index === (selected >= 0 ? selected : 0) ? 0 : -1;
    }
  };

  const build = (maxSlots: number): void => {
    element.replaceChildren();
    buttons = [];
    for (let index = 0; index < maxSlots; index += 1) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pl-hotbar__slot is-empty';
      button.dataset.slot = String(index);
      button.innerHTML =
        `<span class="pl-hotbar__key" aria-hidden="true">${hotbarKeyLabel(index)}</span>` +
        '<span class="pl-hotbar__icon" aria-hidden="true"></span>' +
        '<span class="pl-hotbar__count" aria-hidden="true"></span>';
      button.addEventListener('click', () => {
        api.use(index);
      });
      element.appendChild(button);
      buttons.push(button);
    }
  };

  build(10);
  element.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const from = selected >= 0 ? selected : 0;
    const next = (from + step + buttons.length) % buttons.length;
    api.select(next);
    buttons[next]?.focus();
  });
  options.mount.appendChild(element);
  paint();

  const api: HotbarAPI = {
    element,
    setSlots(next, maxSlots) {
      const wanted = Math.max(0, Math.min(10, Math.floor(maxSlots)));
      if (wanted !== buttons.length) build(wanted);
      slots = next;
      if (selected >= buttons.length) selected = -1;
      paint();
    },
    setDefinitions(next) {
      definitions = new Map(next.map((definition) => [definition.id, definition]));
      paint();
    },
    select(index) {
      if (index < 0 || index >= buttons.length) return;
      selected = index;
      paint();
      options.onSelect?.(index);
    },
    use(index) {
      if (index < 0 || index >= buttons.length) return;
      api.select(index);
      // An empty slot still selects, so the player can see which key it is, but
      // there is nothing to ask the server to use.
      if (!slots[index]) return;
      options.onUse?.(index);
    },
    get selected() {
      return selected;
    },
    setVisible(visible) {
      element.hidden = !visible;
    },
    destroy() {
      element.remove();
      buttons = [];
    },
  };
  return api;
}
