/**
 * C04 settings panel: Settings and Controls tabs.
 *
 * Settings owns text size and reduced motion; Controls is a read-only view of
 * the bindings the input bus actually loaded, so the panel can never claim a
 * key the game does not use. Rebinding is deliberately not exposed yet.
 */

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
}

export interface SettingsPanelAPI {
  readonly element: HTMLElement;
  readonly isOpen: boolean;
  setOpen(open: boolean): void;
  toggle(): void;
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
  .pl-settings-backdrop.is-open { display: grid; }
  .pl-settings {
    width: min(680px, 94vw); max-height: min(78vh, 640px); display: flex; flex-direction: column;
    border-radius: 16px; overflow: hidden; color: var(--bone-200, #efe9d8);
    border: 1px solid rgba(126, 154, 74, 0.44); border-top-color: rgba(200, 232, 108, 0.4);
    background:
      radial-gradient(100% 60% at 0% 0%, rgba(90, 144, 46, 0.17), transparent 60%),
      linear-gradient(168deg, rgba(33, 39, 23, 0.98), rgba(20, 23, 15, 0.99) 60%, rgba(16, 15, 10, 1));
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.64), inset 0 1px 0 rgba(220, 240, 160, 0.09);
    font-family: "Inter", system-ui, sans-serif; font-size: 0.78rem;
  }
  .pl-settings__head { display: flex; align-items: center; justify-content: space-between;
    padding: 12px 15px; border-bottom: 1px solid rgba(126, 154, 74, 0.28); }
  .pl-settings__title { margin: 0; color: var(--leaf-300, #c8ff80); font-size: 0.82rem;
    letter-spacing: 0.16em; text-transform: uppercase; }
  .pl-settings__close { width: 26px; height: 26px; border-radius: 8px; cursor: pointer;
    border: 1px solid rgba(126, 154, 74, 0.35); background: rgba(44, 52, 30, 0.8);
    color: var(--bone-200, #efe9d8); font: inherit; }
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
    open = next;
    backdrop.classList.toggle('is-open', next);
    if (next) render();
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
    const table = document.createElement('table');
    table.className = 'pl-controls';
    table.innerHTML =
      '<thead><tr><th>Action</th><th>Keys</th><th>Mouse</th><th>Mode</th></tr></thead><tbody></tbody>';
    const tbody = table.querySelector('tbody') as HTMLElement;
    const entries = Object.entries(options.bindings).sort(([a], [b]) => a.localeCompare(b));
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
