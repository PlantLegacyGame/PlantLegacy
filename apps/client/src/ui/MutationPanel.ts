/**
 * T04 mutation readout.
 *
 * Shows what the plant has acquired, what it costs per second, and which growth
 * category the player's recent investment is currently biasing. No strategy
 * text and no tier language: the panel names the mutation and its bill, nothing
 * more (RULE_13, discovery over explanation).
 *
 * Server data only; the panel never edits state. Shedding asks the server.
 */

export interface MutationStateView {
  plantId: string;
  mutations: Array<{
    id: string;
    name: string;
    kind: string;
    visualSignature: number;
    visualParams?: [number, number, number];
    visualTarget?: string;
    energyPerSecond: number;
    biomassPerSecond: number;
    level?: number;
    maxLevel?: number;
    levelCostEnergy?: number;
    levelCostBiomass?: number;
    levelBlocked?: string;
  }>;
  totalUpkeepEnergyPerSecond: number;
  pressure: Record<string, number>;
  signature: number;
  shedCooldownRemainingS: number;
  /** Cards dealt by the server for a level-up the player asked for. */
  levelOffer?: {
    mutationId: string;
    level: number;
    cards: Array<{ id: string; label: string; step: number }>;
  } | null;
}

export interface MutationPanelOptions {
  onShed?: (plantId: string, mutationId: string) => void;
}

export interface MutationPanelAPI {
  update(state: MutationStateView): void;
  clear(): void;
  /** Hide until another plant's mutations arrive (or update() for a new plant). */
  hide(): void;
  readonly panel: HTMLElement;
  dispose(): void;
}

const PRESSURE_ORDER = [
  'root',
  'stem',
  'leaf',
  'flower',
  'spore_sac',
  'vine',
  'defense',
  'storage',
];

export function createMutationPanel(options: MutationPanelOptions = {}): MutationPanelAPI {
  const panel = document.createElement('section');
  panel.id = 'mutation-panel';
  panel.setAttribute('aria-label', 'Mutations');
  Object.assign(panel.style, {
    position: 'fixed',
    left: '12px',
    // Placed above the server-tick card by main.ts, measured at runtime.
    bottom: '12px',
    width: '236px',
    padding: '10px 12px',
    borderRadius: '10px',
    background: 'rgba(12, 20, 14, 0.82)',
    border: '1px solid rgba(140, 190, 150, 0.28)',
    color: '#dceadf',
    font: '12px/1.35 system-ui, sans-serif',
    zIndex: '120',
    display: 'none',
    pointerEvents: 'auto',
    backdropFilter: 'blur(6px)',
  });

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = '\u00D7';
  closeButton.setAttribute('aria-label', 'Close mutations');
  closeButton.title = 'Close (Esc)';
  Object.assign(closeButton.style, {
    position: 'absolute',
    top: '2px',
    right: '4px',
    width: '22px',
    height: '22px',
    padding: '0',
    borderRadius: '6px',
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    font: '14px/1 system-ui, sans-serif',
    opacity: '0.6',
    cursor: 'pointer',
  });
  closeButton.addEventListener('click', () => hide());
  panel.appendChild(closeButton);

  const heading = document.createElement('div');
  heading.textContent = 'Mutations';
  Object.assign(heading.style, {
    fontSize: '11px',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    opacity: '0.7',
    marginBottom: '6px',
  });
  panel.appendChild(heading);

  const list = document.createElement('ul');
  Object.assign(list.style, { listStyle: 'none', margin: '0 0 8px', padding: '0' });
  panel.appendChild(list);

  const upkeepLine = document.createElement('div');
  Object.assign(upkeepLine.style, { opacity: '0.75', marginBottom: '8px' });
  panel.appendChild(upkeepLine);

  const pressureHeading = document.createElement('div');
  pressureHeading.textContent = 'Growth pressure';
  Object.assign(pressureHeading.style, {
    fontSize: '10px',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    opacity: '0.55',
    marginBottom: '4px',
  });
  panel.appendChild(pressureHeading);

  const pressureList = document.createElement('div');
  Object.assign(pressureList.style, { display: 'grid', gap: '3px' });
  panel.appendChild(pressureList);

  const bars = new Map<string, HTMLDivElement>();
  const values = new Map<string, HTMLSpanElement>();
  for (const category of PRESSURE_ORDER) {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'grid',
      gridTemplateColumns: '62px 1fr 42px',
      alignItems: 'center',
      gap: '6px',
      opacity: '0.35',
    });

    const label = document.createElement('span');
    label.textContent = category.replace('_', ' ');
    Object.assign(label.style, { fontSize: '10px', opacity: '0.8' });

    const track = document.createElement('div');
    Object.assign(track.style, {
      height: '4px',
      borderRadius: '2px',
      background: 'rgba(220, 234, 223, 0.14)',
      overflow: 'hidden',
    });
    const fill = document.createElement('div');
    Object.assign(fill.style, {
      height: '100%',
      width: '0%',
      background: 'linear-gradient(90deg, #5f9e6a, #a8d68a)',
      transition: 'width 240ms ease-out',
    });
    track.appendChild(fill);

    // Numbers as well as the bar: the raw pressure and its share of the peak.
    const value = document.createElement('span');
    Object.assign(value.style, {
      fontSize: '10px',
      opacity: '0.7',
      textAlign: 'right',
      fontVariantNumeric: 'tabular-nums',
    });
    values.set(category, value);

    row.append(label, track, value);
    pressureList.appendChild(row);
    bars.set(category, fill);
  }

  let lastState: MutationStateView | null = null;
  // Closing is per plant, not permanent: switching to another plant's mutation
  // set shows the panel again. Without this the panel had no close at all, so
  // it sat over the world for as long as the plant held a mutation.
  let dismissed = false;

  function hide(): void {
    dismissed = true;
    panel.style.display = 'none';
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && panel.style.display !== 'none') {
      hide();
    }
  }
  window.addEventListener('keydown', onKeyDown, true);

  function render(): void {
    list.replaceChildren();
    const state = lastState;
    if (!state || state.mutations.length === 0 || dismissed) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = 'block';

    for (const mutation of state.mutations) {
      const item = document.createElement('li');
      Object.assign(item.style, {
        display: 'grid',
        gridTemplateColumns: '1fr auto auto',
        alignItems: 'center',
        gap: '6px',
        padding: '2px 0',
      });

      const name = document.createElement('span');
      const level = mutation.level ?? 1;
      const maxLevel = mutation.maxLevel ?? 1;
      name.textContent = maxLevel > 1 ? `${mutation.name} · Lv ${level}` : mutation.name;
      name.title = mutation.kind;

      const cost = document.createElement('span');
      const perSecond = mutation.energyPerSecond + mutation.biomassPerSecond;
      cost.textContent = perSecond > 0 ? `${perSecond.toFixed(2)}/s` : 'free';
      Object.assign(cost.style, { fontSize: '10px', opacity: '0.65' });

      const shed = document.createElement('button');
      shed.type = 'button';
      shed.textContent = 'shed';
      const cooling = state.shedCooldownRemainingS > 0;
      shed.disabled = cooling;
      shed.title = cooling ? `Cooling down ${state.shedCooldownRemainingS.toFixed(0)}s` : 'Shed';
      Object.assign(shed.style, {
        font: '10px system-ui, sans-serif',
        padding: '1px 6px',
        borderRadius: '4px',
        border: '1px solid rgba(200, 150, 140, 0.4)',
        background: 'transparent',
        color: cooling ? 'rgba(220,234,223,0.35)' : '#e8c9c0',
        cursor: cooling ? 'default' : 'pointer',
      });
      shed.addEventListener('click', () => {
        options.onShed?.(state.plantId, mutation.id);
      });

      item.append(name, cost, shed);
      list.appendChild(item);
    }

    upkeepLine.textContent = `${state.mutations.length} held · upkeep ${state.totalUpkeepEnergyPerSecond.toFixed(2)} energy/s`;

    let max = 0;
    for (const category of PRESSURE_ORDER) {
      max = Math.max(max, state.pressure[category] ?? 0);
    }
    for (const category of PRESSURE_ORDER) {
      const amount = state.pressure[category] ?? 0;
      const fill = bars.get(category);
      if (!fill) continue;
      const share = max > 0 ? amount / max : 0;
      fill.style.width = `${Math.round(share * 100)}%`;
      const value = values.get(category);
      if (value) {
        value.textContent = amount > 0 ? `${amount.toFixed(1)} · ${Math.round(share * 100)}%` : '0';
      }
      const row = fill.parentElement?.parentElement;
      if (row) row.style.opacity = share > 0.02 ? '1' : '0.3';
    }
  }

  render();

  return {
    update(state: MutationStateView) {
      if (lastState?.plantId !== state.plantId) dismissed = false;
      lastState = state;
      render();
    },
    clear() {
      lastState = null;
      dismissed = false;
      render();
    },
    hide,
    panel,
    dispose() {
      window.removeEventListener('keydown', onKeyDown, true);
      panel.remove();
    },
  };
}
