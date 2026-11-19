/**
 * C04 settings panel: Settings and Controls tabs.
 *
 * Settings owns text size and reduced motion; Controls is a read-only view of
 * the bindings the input bus actually loaded, so the panel can never claim a
 * key the game does not use. Rebinding is deliberately not exposed yet.
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
  onTextScale?: (scale: number) => void;
  onReducedMotion?: (enabled: boolean) => void;
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
  dispose(): void;
}

const STYLE_ID = 'pl-settings-style';

const STYLE = `
  .pl-settings-backdrop {
    position: fixed; inset: 0; z-index: 380; display: none;
    place-items: center; padding: 18px;
    background: radial-gradient(circle at 50% 42%, rgba(10, 14, 8, 0.55), rgba(5, 7, 4, 0.82));
    pointer-events: auto;
  }
  .pl-settings-backdrop.is-open { display: grid; backdrop-filter: blur(3px); }
  .pl-settings {
    position: relative;
    width: min(680px, 94vw); max-height: min(78vh, 640px); display: flex; flex-direction: column;
    border-radius: 16px; overflow: hidden; color: var(--bone-200, #efe9d8);
    border: 1px solid rgba(126, 154, 74, 0.44); border-top-color: rgba(200, 232, 108, 0.4);
    background:
      radial-gradient(100% 60% at 0% 0%, rgba(90, 144, 46, 0.17), transparent 60%),
      linear-gradient(168deg, rgba(33, 39, 23, 0.98), rgba(20, 23, 15, 0.99) 60%, rgba(16, 15, 10, 1));
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.64), inset 0 1px 0 rgba(220, 240, 160, 0.09);
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
  .pl-settings__head { display: flex; align-items: baseline; gap: 10px;
    padding: 14px 56px 12px 16px; border-bottom: 1px solid rgba(126, 154, 74, 0.28); }
  .pl-settings__title { margin: 0; color: var(--leaf-300, #c8ff80); font-size: 0.82rem;
    letter-spacing: 0.16em; text-transform: uppercase; }
  .pl-settings__sub { color: var(--ink-dim, #9a937a); font-size: 0.7rem; }
  /* Standard corner close: pinned to the panel's top right, a 30px target, and it
     reads as a button on hover instead of a glyph floating in the header. */
  .pl-settings__close {
    position: absolute; top: 10px; right: 10px;
    width: 30px; height: 30px; display: grid; place-items: center;
    border-radius: 9px; cursor: pointer; font-size: 1.05rem; line-height: 1;
    border: 1px solid rgba(126, 154, 74, 0.35); background: rgba(44, 52, 30, 0.8);
    color: var(--bone-200, #efe9d8);
    transition: background 140ms ease, border-color 140ms ease, transform 140ms ease;
  }
  .pl-settings__close:hover {
    background: rgba(90, 144, 46, 0.32);
    border-color: var(--leaf-400, #9ed95c);
  }
  .pl-settings__close:active { transform: scale(0.94); }
  .pl-settings__close:focus-visible {
    outline: 2px solid var(--leaf-300, #c8ff80); outline-offset: 2px;
  }
  .pl-settings__tabs { display: flex; gap: 4px; padding: 8px 14px 0; }
  .pl-settings__tab { padding: 6px 14px; border-radius: 8px 8px 0 0; cursor: pointer;
    border: 1px solid transparent; border-bottom: none; background: transparent;
    color: var(--ink-muted, #c9c2ad); font: inherit; font-weight: 600; }
  .pl-settings__tab[aria-selected="true"] { color: var(--bone-100, #f7f4ed);
    background: rgba(54, 66, 34, 0.55); border-color: rgba(126, 154, 74, 0.34); }
  .pl-settings__body { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 16px 18px;
    border-top: 1px solid rgba(126, 154, 74, 0.26); }
  .pl-settings__section { display: grid; gap: 10px; }
  .pl-settings__row { display: flex; align-items: center; justify-content: space-between;
    gap: 16px; padding: 8px 0; border-bottom: 1px solid rgba(126, 154, 74, 0.12); }
  .pl-settings__row:last-child { border-bottom: none; }
  .pl-settings__label { color: var(--bone-100, #f7f4ed); font-weight: 600; }
  .pl-settings__hint { color: var(--ink-dim, #9a937a); font-size: 0.7rem; }
  .pl-settings input[type="range"] { width: 180px; accent-color: #9ed95c; }
  .pl-settings input[type="checkbox"] { width: 16px; height: 16px; accent-color: #9ed95c; }
  .pl-settings__value { min-width: 46px; text-align: right; color: var(--leaf-200, #dfee8e);
    font-variant-numeric: tabular-nums; }
  .pl-controls { width: 100%; border-collapse: collapse; }
  .pl-controls th { text-align: left; padding: 6px 8px; color: var(--sprout-300, #c8e86c);
    font-size: 0.64rem; letter-spacing: 0.12em; text-transform: uppercase;
    border-bottom: 1px solid rgba(126, 154, 74, 0.3); }
  .pl-controls td { padding: 5px 8px; border-bottom: 1px solid rgba(126, 154, 74, 0.1);
    vertical-align: top; }
  .pl-controls tr:hover td { background: rgba(90, 144, 46, 0.12); }
  .pl-controls__action { color: var(--bone-100, #f7f4ed); }
  .pl-controls__key { color: var(--leaf-200, #dfee8e); font-family: ui-monospace, monospace; }
  .pl-controls__context { color: var(--ink-dim, #9a937a); }
  /* The touch layout of the same controls. A phone reading a table of keys is
     reading a manual for a device it is not holding. */
  .pl-controls-touch { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .pl-controls-touch li {
    display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
    padding: 8px 10px; border-radius: 9px;
    border: 1px solid rgba(126, 154, 74, 0.18); background: rgba(8, 11, 8, 0.4);
  }
  .pl-controls-touch__gesture { color: var(--leaf-200, #dfee8e); text-align: right; }

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

function prettyAction(action: string): string {
  return action
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Same query the stylesheet uses for its finger layout. */
function isFingerLayout(): boolean {
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

function prettyKey(key: string): string {
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

  const backdrop = document.createElement('div');
  backdrop.className = 'pl-settings-backdrop';
  backdrop.innerHTML = `
    <section class="pl-settings" role="dialog" aria-modal="true" aria-label="Settings">
      <header class="pl-settings__head">
        <h2 class="pl-settings__title">Settings</h2>
        <button type="button" class="pl-settings__close" aria-label="Close settings">\u00D7</button>
      </header>
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
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };
  document.addEventListener('keydown', onKeyDown);

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

  function render(): void {
    for (const tabEl of backdrop.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
      tabEl.setAttribute('aria-selected', String(tabEl.dataset.tab === tab));
    }
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

    for (const row of rows) {
      const el = document.createElement('div');
      el.className = 'pl-settings__row';
      el.innerHTML =
        '<div><div class="pl-settings__label"></div><div class="pl-settings__hint"></div></div>';
      (el.querySelector('.pl-settings__label') as HTMLElement).textContent = row.label;
      (el.querySelector('.pl-settings__hint') as HTMLElement).textContent = row.hint;
      el.appendChild(row.control);
      section.appendChild(el);
    }
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
    const table = document.createElement('table');
    table.className = 'pl-controls';
    table.innerHTML =
      '<thead><tr><th>Action</th><th>Keys</th><th>Mouse</th><th>Mode</th></tr></thead><tbody></tbody>';
    const tbody = table.querySelector('tbody') as HTMLElement;
    // A binding with no key and no mouse button is not a control: it is an action
    // waiting for a producer (the metrics overlay, for one, is a dev-panel switch
    // with no binding on purpose). Listing it as a row of dashes was noise in the
    // one screen a player opens to find out what they can press.
    const entries = Object.entries(options.bindings)
      .filter(([, binding]) => binding.keys.length > 0 || binding.mouse !== '')
      .sort(([a], [b]) => a.localeCompare(b));
    for (const [action, binding] of entries) {
      const row = document.createElement('tr');
      const keys = [...binding.keys.map(prettyKey), binding.mouse].filter(Boolean).join(' / ');
      row.innerHTML =
        '<td class="pl-controls__action"></td><td class="pl-controls__key"></td>' +
        '<td class="pl-controls__key"></td><td class="pl-controls__context"></td>';
      (row.children[0] as HTMLElement).textContent = prettyAction(action);
      (row.children[1] as HTMLElement).textContent =
        binding.keys.map(prettyKey).join(' / ') || '\u2014';
      (row.children[2] as HTMLElement).textContent = binding.mouse || '\u2014';
      (row.children[3] as HTMLElement).textContent = binding.mode;
      row.title = keys;
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
    get isOpen() {
      return open;
    },
    setOpen,
    toggle() {
      setOpen(!open);
    },
    dispose() {
      document.removeEventListener('keydown', onKeyDown);
      backdrop.remove();
    },
  };
}
