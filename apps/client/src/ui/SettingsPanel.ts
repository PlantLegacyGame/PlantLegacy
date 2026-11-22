/**
 * C04 settings panel: Settings and Controls tabs.
 *
 * Settings owns text size and reduced motion; Controls lists the bindings the
 * input bus actually loaded, so the panel can never claim a key the game does
 * not use, and lets a player change one. A rebind is a key press, not a text
 * field: click Change, press the key, and the table redraws from the new table.
 *
 * On a finger layout the Controls tab lists the touch gestures instead: those
 * have no binding table to quote, so their words come from `touchCopy.ts`.
 */

import { TOUCH_GESTURES } from './touchCopy.ts';

export interface BindingView {
  keys: string[];
  mouse: string;
  mode: string;
  context: string;
}

export interface SettingsPanelOptions {
  bindings: Record<string, BindingView>;
  initialTextScale: number;
  initialReducedMotion: boolean;
  /** The title plant's creaks and knocks; remembered by the sound module. */
  initialSound?: boolean;
  /** Plant-shaped cursors instead of the system pointer. */
  initialPlantCursors?: boolean;
  onTextScale?: (scale: number) => void;
  onReducedMotion?: (enabled: boolean) => void;
  onSound?: (enabled: boolean) => void;
  onPlantCursors?: (enabled: boolean) => void;
  /** A key chosen for an action in the Controls tab (`KeyJ`, `ArrowUp`, …). */
  onRebind?: (action: string, code: string) => void;
  /** Put every action back on the config's key. */
  onResetBindings?: () => void;
  /** Told whenever the panel opens or closes, so the title can stand down. */
  onOpenChange?: (open: boolean) => void;
}

export interface SettingsPanelAPI {
  readonly element: HTMLElement;
  readonly isOpen: boolean;
  setOpen(open: boolean): void;
  toggle(): void;
  /** Open straight to a tab: the pause menu's Controls entry lands here. */
  showTab(tab: 'settings' | 'controls'): void;
  /** Replace the displayed table after a rebind or a config reload. */
  setBindings(bindings: Record<string, BindingView>): void;
  dispose(): void;
}

const STYLE_ID = 'pl-settings-style';

const STYLE = `
  .pl-settings-backdrop {
    position: fixed; inset: 0; z-index: 380; display: none;
    place-items: center; padding: 18px;
    background: radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--palette-foliage-900) 66%, transparent), color-mix(in srgb, var(--palette-ink-900) 88%, transparent));
    pointer-events: auto;
  }
  .pl-settings {
    position: relative;
    width: min(760px, 94vw); max-height: min(74vh, 620px); display: flex; flex-direction: column;
    border-radius: 16px; overflow: hidden; color: var(--bone-200);
    border: 1px solid color-mix(in srgb, var(--palette-foliage-700) 44%, transparent); border-top-color: color-mix(in srgb, var(--palette-foliage-300) 40%, transparent);
    background:
      radial-gradient(100% 60% at 0% 0%, color-mix(in srgb, var(--palette-foliage-500) 17%, transparent), transparent 60%),
      linear-gradient(168deg, color-mix(in srgb, var(--palette-foliage-900) 98%, transparent), color-mix(in srgb, var(--palette-foliage-900) 99%, transparent) 60%, color-mix(in srgb, var(--palette-ink-900) 100%, transparent));
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.64), inset 0 1px 0 color-mix(in srgb, var(--palette-foliage-100) 9%, transparent);
    font-family: "Inter", system-ui, sans-serif; font-size: 0.78rem;
  }
  @keyframes pl-settings-in {
    from { opacity: 0; transform: translateY(10px) scale(0.985); }
    to { opacity: 1; transform: none; }
  }
  .pl-settings-backdrop.is-open .pl-settings {
    animation: pl-settings-in 200ms cubic-bezier(0.22, 0.9, 0.3, 1);
  }
  @media (prefers-reduced-motion: reduce) {
    .pl-settings-backdrop.is-open .pl-settings { animation: none; }
  }
  /* A01: the open state had no display rule at all, so a panel that setOpen
     reported as visible stayed at display:none. */
  .pl-settings-backdrop.is-open { display: grid; }
  .pl-settings__head { display: flex; align-items: baseline; gap: 10px;
    padding: 14px 56px 12px 16px; border-bottom: 1px solid color-mix(in srgb, var(--palette-foliage-700) 28%, transparent); }
  .pl-settings__title { margin: 0; color: var(--leaf-300); font-size: 0.82rem;
    letter-spacing: 0.16em; text-transform: uppercase; }
  .pl-settings__sub { color: var(--ink-dim); font-size: 0.7rem; }
  /* Standard corner close: pinned to the panel's top right, a 30px target, and it
     reads as a button on hover instead of a glyph floating in the header. */
  .pl-settings__close {
    position: absolute; top: 10px; right: 10px;
    width: 30px; height: 30px; display: grid; place-items: center;
    border-radius: 9px; cursor: pointer; font-size: 1.05rem; line-height: 1;
    border: 1px solid color-mix(in srgb, var(--palette-foliage-700) 35%, transparent); background: color-mix(in srgb, var(--palette-foliage-900) 80%, transparent);
    color: var(--bone-200);
    transition: background 140ms ease, border-color 140ms ease, transform 140ms ease;
  }
  .pl-settings__close:hover {
    background: color-mix(in srgb, var(--palette-foliage-500) 32%, transparent);
    border-color: var(--leaf-400);
  }
  .pl-settings__close:active { transform: scale(0.94); }
  .pl-settings__close:focus-visible {
    outline: 2px solid var(--leaf-300); outline-offset: 2px;
  }
  .pl-settings__tabs { display: flex; gap: 4px; padding: 8px 14px 0; }
  .pl-settings__tab { padding: 6px 14px; border-radius: 8px 8px 0 0; cursor: pointer;
    border: 1px solid transparent; border-bottom: none; background: transparent;
    color: var(--ink-muted); font: inherit; font-weight: 600; }
  .pl-settings__tab[aria-selected="true"] { color: var(--bone-100);
    background: color-mix(in srgb, var(--palette-foliage-900) 55%, transparent); border-color: color-mix(in srgb, var(--palette-foliage-700) 34%, transparent); }
  .pl-settings__body { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 16px 18px;
    border-top: 1px solid color-mix(in srgb, var(--palette-foliage-700) 26%, transparent); }
  .pl-settings__section { display: grid; gap: 10px; }
  /* Settings, dense:
     Two rows of full-width label/hint lines was most of the panel's height for two
     controls. The same information now sits in a card grid - label, control, and
     the one-line explanation under it - two cards to a row wherever the panel is
     wide enough, with the current state repeated in a chip strip that answers
     "what is it set to?" without reading the controls. */
  .pl-settings__chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 16px 0; }
  .pl-settings__chip {
    display: inline-flex; align-items: baseline; gap: 5px;
    padding: 3px 9px; border-radius: 999px; font-size: 0.68rem;
    border: 1px solid color-mix(in srgb, var(--palette-foliage-700) 26%, transparent);
    background: color-mix(in srgb, var(--palette-ink-900) 42%, transparent); color: var(--ink-dim);
  }
  .pl-settings__chip b { color: var(--leaf-200); font-weight: 600; }
  .pl-settings__grid { display: grid; gap: 8px; }
  @media (min-width: 560px) { .pl-settings__grid { grid-template-columns: 1fr 1fr; } }
  .pl-settings__card {
    display: grid; grid-template-columns: 1fr auto; grid-template-rows: auto auto;
    gap: 2px 12px; align-items: center;
    padding: 8px 10px; border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--palette-foliage-700) 18%, transparent);
    background: color-mix(in srgb, var(--palette-ink-900) 34%, transparent);
  }
  .pl-settings__card > .pl-settings__label { grid-column: 1; grid-row: 1; }
  .pl-settings__card > .pl-settings__hint { grid-column: 1 / -1; grid-row: 2; }
  .pl-settings__card > :not(.pl-settings__label):not(.pl-settings__hint) {
    grid-column: 2; grid-row: 1 / span 2;
  }
  .pl-settings__row { display: flex; align-items: center; justify-content: space-between;
    gap: 16px; padding: 8px 0; border-bottom: 1px solid color-mix(in srgb, var(--palette-foliage-700) 12%, transparent); }
  .pl-settings__row:last-child { border-bottom: none; }
  .pl-settings__label { color: var(--bone-100); font-weight: 600; }
  .pl-settings__hint { color: var(--ink-dim); font-size: 0.7rem; line-height: 1.3; }
  .pl-settings input[type="range"] { width: 132px; accent-color: var(--leaf-400); }
  .pl-settings input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--leaf-400); }
  /* The pane's own numbers. They are here because they are the ones that explain a
     layout the player does not expect: a zoomed browser is reported as a bigger
     pane at the same pixel ratio, which is what the interface is sizing against. */
  .pl-settings__facts {
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 16px;
    margin-top: 2px; padding-top: 8px; border-top: 1px dashed color-mix(in srgb, var(--palette-foliage-700) 18%, transparent);
  }
  .pl-settings__fact { display: flex; align-items: baseline; justify-content: space-between;
    gap: 10px; font-size: 0.68rem; }
  .pl-settings__fact span { color: var(--ink-dim); }
  .pl-settings__fact b { color: var(--bone-100); font-weight: 600;
    font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; }
  @media (max-width: 480px) { .pl-settings__facts { grid-template-columns: 1fr; } }
  .pl-settings__value { min-width: 46px; text-align: right; color: var(--leaf-200);
    font-variant-numeric: tabular-nums; }
  .pl-controls { width: 100%; border-collapse: collapse; }
  .pl-controls th { text-align: left; padding: 6px 8px; color: var(--sprout-300);
    font-size: 0.64rem; letter-spacing: 0.12em; text-transform: uppercase;
    border-bottom: 1px solid color-mix(in srgb, var(--palette-foliage-700) 30%, transparent); }
  .pl-controls td { padding: 5px 8px; border-bottom: 1px solid color-mix(in srgb, var(--palette-foliage-700) 10%, transparent);
    vertical-align: top; }
  .pl-controls tr:hover td { background: color-mix(in srgb, var(--palette-foliage-500) 12%, transparent); }
  /* A group heading: a rule and a name, so the table reads as sections rather
     than one list of thirty rows. */
  .pl-controls__section th {
    padding-top: 12px; color: var(--ink-dim); font-size: 0.6rem;
    border-bottom: 1px solid color-mix(in srgb, var(--palette-foliage-700) 22%, transparent);
  }
  .pl-controls__action { color: var(--bone-100); }
  .pl-controls__key { color: var(--leaf-200); font-family: ui-monospace, monospace; }
  .pl-controls__context { color: var(--ink-dim); }
  .pl-controls__bar {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 0 0 8px;
  }
  .pl-controls__hint { color: var(--ink-dim); font-size: 0.68rem; }
  .pl-controls__reset, .pl-controls__change {
    min-height: 28px; padding: 4px 10px; border-radius: 8px; cursor: pointer;
    border: 1px solid color-mix(in srgb, var(--palette-foliage-700) 34%, transparent);
    background: color-mix(in srgb, var(--palette-foliage-900) 60%, transparent);
    color: var(--bone-200); font: inherit; font-size: 0.68rem;
  }
  .pl-controls__reset:hover, .pl-controls__change:hover { border-color: var(--leaf-400); }
  .pl-controls__change.is-capturing {
    border-color: var(--leaf-300); color: var(--leaf-200);
  }
  .pl-controls__change:focus-visible, .pl-controls__reset:focus-visible {
    outline: 2px solid var(--leaf-300); outline-offset: 2px;
  }
  /* The touch layout of the same controls. A phone reading a table of keys is
     reading a manual for a device it is not holding. */
  .pl-controls-touch { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .pl-controls-touch li {
    display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
    padding: 8px 10px; border-radius: 9px;
    border: 1px solid color-mix(in srgb, var(--palette-foliage-700) 18%, transparent); background: color-mix(in srgb, var(--palette-ink-900) 40%, transparent);
  }
  .pl-controls-touch__gesture { color: var(--leaf-200); text-align: right; }

  html[data-reduced-motion="true"] *,
  html[data-reduced-motion="true"] *::before,
  html[data-reduced-motion="true"] *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
  @media (max-width: 620px) {
    .pl-settings { max-height: 88vh; }
    .pl-settings__row { align-items: flex-start; flex-direction: column; gap: 6px; }
  }
  /* A 30px corner close is a mouse target. A thumb gets the same floor as every
     other control in the game. */
  @media (hover: none) and (pointer: coarse) {
    .pl-settings__close { width: 44px; height: 44px; font-size: 1.25rem; }
    .pl-settings__head { padding-right: 64px; }
  }
`;

function installStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}

/**
 * The order the controls are read in, taken from the controls file.
 *
 * The table used to be sorted by action id, which put `inventory_slot_1`,
 * `inventory_slot_10`, `inventory_slot_2` ... in that order - the tenth slot
 * between the first and the second, and every camera action after every slot.
 * The bindings record arrives in the order `config/controls.json` declares, which
 * is the order a player learns them in, so the file owns the order now. Within
 * the numbered slots the numeric order is restored explicitly.
 */
function controlEntries(bindings: Record<string, BindingView>): Array<[string, BindingView]> {
  const entries = Object.entries(bindings).filter(
    ([, binding]) => binding.keys.length > 0 || binding.mouse !== '',
  );
  const slotIndex = (action: string): number => {
    const match = /^inventory_slot_(\d+)$/.exec(action);
    return match ? Number(match[1]) : 0;
  };
  return entries.sort((a, b) => {
    const aSlot = slotIndex(a[0]);
    const bSlot = slotIndex(b[0]);
    if (aSlot && bSlot) return aSlot - bSlot;
    return 0;
  });
}

/** The groups the Control tab reads in, and which actions belong to each. */
const CONTROL_SECTIONS: ReadonlyArray<{ label: string; test: (action: string) => boolean }> = [
  { label: 'Camera', test: (action) => action.startsWith('camera_') },
  {
    label: 'Growth',
    test: (action) =>
      [
        'select_part',
        'grow_mode_toggle',
        'root_sight_toggle',
        'grow_cancel',
        'plant_regenerate',
      ].includes(action),
  },
  {
    label: 'Interface',
    test: (action) =>
      ['emote_wheel', 'inventory_overview_toggle', 'settings_toggle', 'hint_card_toggle'].includes(
        action,
      ),
  },
  { label: 'Hotbar', test: (action) => action.startsWith('inventory_slot_') },
  { label: 'Developer', test: (action) => action.startsWith('dev_') || action === 'debug_toggle' },
];

function controlSection(action: string): string {
  return CONTROL_SECTIONS.find((section) => section.test(action))?.label ?? 'Other';
}

export function prettyAction(action: string): string {
  const slot = /^inventory_slot_(\d+)$/.exec(action);
  if (slot) return `Hotbar slot ${slot[1]}`;
  return action
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** The overlay's current scale, as the stylesheet has it (`ui/uiScale.ts`). */
function overlayScale(): number {
  if (typeof getComputedStyle !== 'function') return 1;
  const raw = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--pl-ui-scale'),
  );
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

/** Same query the stylesheet uses for its finger layout. */
function isFingerLayout(): boolean {
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

export function prettyKey(key: string): string {
  const map: Record<string, string> = {
    ArrowUp: '\u2191',
    ArrowDown: '\u2193',
    ArrowLeft: '\u2190',
    ArrowRight: '\u2192',
    Space: 'Space',
    Escape: 'Esc',
    Backquote: '`',
    ShiftLeft: 'Shift',
    ShiftRight: 'Shift',
  };
  if (map[key]) return map[key];
  return key.replace(/^Key/, '').replace(/^Digit/, '');
}

export function createSettingsPanel(options: SettingsPanelOptions): SettingsPanelAPI {
  installStyles();
  document.documentElement.dataset.reducedMotion = String(options.initialReducedMotion);
  let open = false;
  let tab: 'settings' | 'controls' = 'settings';
  let currentTextScale = options.initialTextScale;
  let currentReducedMotion = options.initialReducedMotion;
  let currentSound = options.initialSound ?? true;
  let currentPlantCursors = options.initialPlantCursors ?? true;
  let bindings = options.bindings;
  let capturing: string | null = null;

  const backdrop = document.createElement('div');
  backdrop.className = 'pl-settings-backdrop';
  backdrop.innerHTML = `
    <section class="pl-settings" role="dialog" aria-modal="true" aria-label="Settings">
      <header class="pl-settings__head">
        <h2 class="pl-settings__title">Settings</h2>
        <button type="button" class="pl-settings__close" aria-label="Close settings">\u00D7</button>
      </header>
      <div class="pl-settings__chips" aria-live="polite"></div>
      <div class="pl-settings__tabs" role="tablist">
        <button type="button" class="pl-settings__tab" role="tab" data-tab="settings" aria-selected="true">Settings</button>
        <button type="button" class="pl-settings__tab" role="tab" data-tab="controls" aria-selected="false">Controls</button>
      </div>
      <div class="pl-settings__body"></div>
    </section>`;

  const body = backdrop.querySelector('.pl-settings__body') as HTMLElement;
  const close = (): void => setOpen(false);
  backdrop.querySelector('.pl-settings__close')?.addEventListener('click', close);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  for (const tabEl of backdrop.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
    tabEl.addEventListener('click', () => {
      tab = tabEl.dataset.tab === 'controls' ? 'controls' : 'settings';
      render();
    });
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && open && capturing === null) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };
  document.addEventListener('keydown', onKeyDown);

  /** While a row is listening, the next real key is the answer. */
  const onRebindKey = (event: KeyboardEvent): void => {
    if (!open || capturing === null) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      capturing = null;
      render();
      return;
    }
    // A modifier or Tab cannot be the answer: one is held around another key,
    // the other has to keep moving focus.
    if (['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(event.key)) return;
    if (!event.code) return;
    event.preventDefault();
    event.stopPropagation();
    const action = capturing;
    capturing = null;
    options.onRebind?.(action, event.code);
  };
  document.addEventListener('keydown', onRebindKey, true);

  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    backdrop.classList.toggle('is-open', next);
    if (next) {
      // Come to the front of the layer it shares. The title screen is mounted on
      // the same layer and *after* this panel, so opening Settings from the menu
      // put it behind the menu: nothing appeared to happen, and the panel was
      // still open (and therefore visible) after Play. Re-appending moves it to
      // the end of the layer, which is where "in front" lives.
      backdrop.parentElement?.appendChild(backdrop);
      render();
    }
    options.onOpenChange?.(next);
  }

  /** How many actions actually answer to a key or a mouse button. */
  const boundActionCount = (): number =>
    Object.values(bindings).filter((binding) => binding.keys.length > 0 || binding.mouse !== '')
      .length;

  /**
   * The state strip: what the panel is currently set to, in one line, so the
   * answer to "is motion on?" does not cost a read of every control.
   */
  function renderChips(): void {
    const chips = backdrop.querySelector<HTMLElement>('.pl-settings__chips');
    if (!chips) return;
    chips.innerHTML = '';
    const items: Array<[string, string]> = [
      ['Text', `${Math.round(currentTextScale * 100)}%`],
      ['Motion', currentReducedMotion ? 'reduced' : 'full'],
      ['Input', isFingerLayout() ? 'touch' : 'mouse + keys'],
      ['Sound', currentSound ? 'on' : 'off'],
      ['Cursor', currentPlantCursors ? 'leaf' : 'system'],
      ['Actions', String(boundActionCount())],
    ];
    for (const [label, value] of items) {
      const chip = document.createElement('span');
      chip.className = 'pl-settings__chip';
      chip.innerHTML = '<span></span><b></b>';
      (chip.firstElementChild as HTMLElement).textContent = label;
      (chip.lastElementChild as HTMLElement).textContent = value;
      chips.appendChild(chip);
    }
  }

  function render(): void {
    for (const tabEl of backdrop.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
      tabEl.setAttribute('aria-selected', String(tabEl.dataset.tab === tab));
    }
    renderChips();
    body.innerHTML = '';
    if (tab === 'controls') {
      renderControls();
    } else {
      renderSettings();
    }
  }

  function renderSettings(): void {
    const section = document.createElement('div');
    section.className = 'pl-settings__section';
    const rows: Array<{ label: string; hint: string; control: HTMLElement }> = [];

    const scaleValue = document.createElement('span');
    scaleValue.className = 'pl-settings__value';
    scaleValue.textContent = `${Math.round(currentTextScale * 100)}%`;
    const scale = document.createElement('input');
    scale.type = 'range';
    scale.min = '80';
    scale.max = '150';
    scale.step = '5';
    scale.value = String(Math.round(currentTextScale * 100));
    scale.addEventListener('input', () => {
      const percent = Number(scale.value);
      currentTextScale = percent / 100;
      scaleValue.textContent = `${percent}%`;
      options.onTextScale?.(currentTextScale);
    });
    const scaleWrap = document.createElement('div');
    scaleWrap.append(scale, scaleValue);
    rows.push({
      label: 'Text size',
      hint: 'Scales HUD, panels and menus.',
      control: scaleWrap,
    });

    const reduced = document.createElement('input');
    reduced.type = 'checkbox';
    reduced.checked = currentReducedMotion;
    reduced.addEventListener('change', () => {
      currentReducedMotion = reduced.checked;
      document.documentElement.dataset.reducedMotion = String(currentReducedMotion);
      options.onReducedMotion?.(currentReducedMotion);
    });
    rows.push({
      label: 'Reduce motion',
      hint: 'Removes panel and camera motion. Also follows the OS preference.',
      control: reduced,
    });

    const sound = document.createElement('input');
    sound.type = 'checkbox';
    sound.checked = currentSound;
    sound.addEventListener('change', () => {
      currentSound = sound.checked;
      options.onSound?.(currentSound);
      renderChips();
    });
    rows.push({
      label: 'Sound',
      hint: 'The title plant\u2019s creaks, knocks and rustles.',
      control: sound,
    });

    const plantCursors = document.createElement('input');
    plantCursors.type = 'checkbox';
    plantCursors.checked = currentPlantCursors;
    plantCursors.addEventListener('change', () => {
      currentPlantCursors = plantCursors.checked;
      options.onPlantCursors?.(currentPlantCursors);
      renderChips();
    });
    rows.push({
      label: 'Leaf cursor',
      hint: 'Plant-shaped pointer. Turn off to keep your own system cursor.',
      control: plantCursors,
    });

    const grid = document.createElement('div');
    grid.className = 'pl-settings__grid';
    for (const row of rows) {
      const card = document.createElement('div');
      card.className = 'pl-settings__card';
      const label = document.createElement('div');
      label.className = 'pl-settings__label';
      label.textContent = row.label;
      const hint = document.createElement('div');
      hint.className = 'pl-settings__hint';
      hint.textContent = row.hint;
      card.append(label, hint, row.control);
      grid.appendChild(card);
    }
    section.appendChild(grid);

    // The pane's own numbers, read when the panel opens: this is the part that
    // says which layout the interface is currently being sized for.
    const facts = document.createElement('div');
    facts.className = 'pl-settings__facts';
    const pane = `${Math.round(window.innerWidth)}\u00D7${Math.round(window.innerHeight)}`;
    const rowsData: Array<[string, string]> = [
      ['Pane', `${pane} CSS px`],
      ['Pixel ratio', (window.devicePixelRatio || 1).toFixed(2)],
      ['Overlay scale', `${Math.round(overlayScale() * 100)}%`],
      ['Bindings loaded', String(Object.keys(bindings).length)],
    ];
    for (const [label, value] of rowsData) {
      const fact = document.createElement('div');
      fact.className = 'pl-settings__fact';
      fact.innerHTML = '<span></span><b></b>';
      (fact.firstElementChild as HTMLElement).textContent = label;
      (fact.lastElementChild as HTMLElement).textContent = value;
      facts.appendChild(fact);
    }
    section.appendChild(facts);
    body.appendChild(section);
  }

  function renderControls(): void {
    if (isFingerLayout()) {
      const list = document.createElement('ul');
      list.className = 'pl-controls-touch';
      for (const row of TOUCH_GESTURES) {
        const item = document.createElement('li');
        const label = document.createElement('span');
        label.className = 'pl-controls__action';
        label.textContent = row.action;
        const gesture = document.createElement('span');
        gesture.className = 'pl-controls-touch__gesture';
        gesture.textContent = row.gesture;
        item.append(label, gesture);
        list.appendChild(item);
      }
      body.appendChild(list);
      return;
    }
    if (options.onRebind || options.onResetBindings) {
      const bar = document.createElement('div');
      bar.className = 'pl-controls__bar';
      const hint = document.createElement('span');
      hint.className = 'pl-controls__hint';
      hint.textContent = capturing
        ? `Press a key for ${prettyAction(capturing)}. Esc cancels.`
        : 'Change a key, or reset every action to the config.';
      bar.appendChild(hint);
      if (options.onResetBindings) {
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'pl-controls__reset';
        reset.textContent = 'Reset to defaults';
        reset.addEventListener('click', () => {
          capturing = null;
          options.onResetBindings?.();
        });
        bar.appendChild(reset);
      }
      body.appendChild(bar);
    }
    const table = document.createElement('table');
    table.className = 'pl-controls';
    table.innerHTML =
      '<thead><tr><th>Action</th><th>Keys</th><th>Mouse</th><th>Mode</th><th></th></tr></thead><tbody></tbody>';
    const tbody = table.querySelector('tbody') as HTMLElement;
    // A binding with no key and no mouse button is not a control: it is an action
    // waiting for a producer (the metrics overlay, for one, is a dev-panel switch
    // with no binding on purpose). Listing it as a row of dashes was noise in the
    // one screen a player opens to find out what they can press.
    let section = '';
    for (const [action, binding] of controlEntries(bindings)) {
      const heading = controlSection(action);
      if (heading !== section) {
        section = heading;
        const header = document.createElement('tr');
        header.className = 'pl-controls__section';
        header.innerHTML = '<th colspan="5"></th>';
        (header.firstElementChild as HTMLElement).textContent = heading;
        tbody.appendChild(header);
      }
      const row = document.createElement('tr');
      const keys = [...binding.keys.map(prettyKey), binding.mouse].filter(Boolean).join(' / ');
      row.innerHTML =
        '<td class="pl-controls__action"></td><td class="pl-controls__key"></td>' +
        '<td class="pl-controls__key"></td><td class="pl-controls__context"></td>' +
        '<td class="pl-controls__rebind"></td>';
      (row.children[0] as HTMLElement).textContent = prettyAction(action);
      (row.children[1] as HTMLElement).textContent =
        binding.keys.map(prettyKey).join(' / ') || '\u2014';
      (row.children[2] as HTMLElement).textContent = binding.mouse || '\u2014';
      (row.children[3] as HTMLElement).textContent = binding.mode;
      row.title = keys;
      if (options.onRebind) {
        const change = document.createElement('button');
        change.type = 'button';
        change.className = 'pl-controls__change';
        change.classList.toggle('is-capturing', capturing === action);
        change.textContent = capturing === action ? 'Press a key\u2026' : 'Change';
        change.setAttribute('aria-label', `Change the key for ${prettyAction(action)}`);
        change.addEventListener('click', () => {
          capturing = capturing === action ? null : action;
          render();
        });
        (row.children[4] as HTMLElement).appendChild(change);
      }
      tbody.appendChild(row);
    }
    body.appendChild(table);
  }

  return {
    element: backdrop,
    showTab: (next) => {
      tab = next;
      render();
    },
    setBindings: (next) => {
      bindings = next;
      if (capturing !== null && !(capturing in next)) capturing = null;
      if (open) render();
    },
    get isOpen() {
      return open;
    },
    setOpen,
    toggle() {
      setOpen(!open);
    },
    dispose() {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keydown', onRebindKey, true);
      backdrop.remove();
    },
  };
}
