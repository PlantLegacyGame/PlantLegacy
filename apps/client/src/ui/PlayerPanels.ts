/**
 * C04 inspect + inventory side panels.
 *
 * Pressing I opens both at once: inspect on the left, inventory on the right,
 * with the world left visible between them. Inspect is the plant's body and
 * history (health, resources, mutations, every growth node); inventory is the
 * server-owned pouch. Nothing here edits plant state; item use is an intent.
 */

import type { PlantPhase } from './PlantStatusHud.js';
import {
  type HealthThresholds,
  nodeHealthLabel,
  nodeHealthStatus,
  plantHealthLabel,
  plantHealthStatus,
} from './plantHealth.js';
import {
  describeItemUse,
  type ItemUseSummary,
  type PlantStatsSummary,
  plantStatRows,
  prettyItemId,
} from './plantStats.js';

export interface InspectNodeView {
  id: string;
  type: string;
  layer: string;
  biomass: number;
  health: number;
  age: number;
  growthProgress: number;
  isSeed: boolean;
}

export interface InspectMutationView {
  id?: string;
  name: string;
  kind?: string;
  energyPerSecond: number;
  biomassPerSecond: number;
  level?: number;
  maxLevel?: number;
  levelCostEnergy?: number;
  levelCostBiomass?: number;
  /** Why the next level is refused right now, when it is. */
  levelBlocked?: string;
}

/** A card the server dealt for the mutation the player chose to raise. */
export interface MutationCardView {
  id: string;
  label: string;
  step: number;
}

export interface MutationLevelOfferView {
  mutationId: string;
  level: number;
  cards: MutationCardView[];
}

export interface InventorySlotView {
  itemId: string;
  count: number;
}

/** One item definition, as the server sent it with the inventory. */
export interface ItemDefinitionView {
  id: string;
  name: string;
  description: string;
  category: string;
  stackLimit: number;
  use: ItemUseSummary;
}

export interface PlayerPanelsView {
  stats: PlantStatsSummary;
  phase: PlantPhase;
  rerootWindowRemainingS: number | null;
  nodes: InspectNodeView[];
  mutations: InspectMutationView[];
  /** Seconds before the mutation set can be shed. */
  mutationShedCooldownS?: number;
  /** Cards dealt for a level-up, shown as a choice while they are open. */
  mutationLevelOffer?: MutationLevelOfferView | null;
  /** Growth pressure per category, 0..n. */
  pressure?: Record<string, number>;
  inventory: Array<InventorySlotView | null>;
  maxSlots: number;
}

export interface PlayerPanelsOptions {
  healthThresholds?: HealthThresholds;
  onUseItem?: (slotIndex: number) => void;
  /**
   * Ask to raise a mutation. Without `cardId` the server deals the cards;
   * with one, that card is taken and the level is applied.
   */
  onLevelMutation?: (mutationId: string, cardId?: string) => void;
  /** Called after either panel closes, so the HUD can be restored. */
  onClose?: () => void;
}

export interface PlayerPanelsAPI {
  readonly inspect: HTMLElement;
  readonly inventory: HTMLElement;
  readonly isOpen: boolean;
  update(view: PlayerPanelsView): void;
  setInventory(slots: Array<InventorySlotView | null>, maxSlots: number): void;
  /**
   * Item definitions from the server, keyed by id. Until they arrive the panel
   * can only show an id-derived name, so it says it is waiting instead of
   * pretending the item has no description.
   */
  setDefinitions(definitions: ReadonlyArray<ItemDefinitionView>): void;
  setOpen(open: boolean): void;
  selectSlot(index: number): void;
  toggle(): void;
  dispose(): void;
}

const STYLE_ID = 'pl-player-panels-style';

const STYLE = `
  .pl-side-panel {
    position: fixed;
    top: calc(var(--hud-corner, 12px) + 54px);
    bottom: clamp(78px, 12vh, 128px);
    width: clamp(240px, 23vw, 320px);
    display: none;
    flex-direction: column;
    z-index: 340;
    pointer-events: auto;
    color: var(--bone-200, #efe9d8);
    font-family: "Inter", system-ui, sans-serif;
    font-size: var(--hud-font-sm, 0.72rem);
    border-radius: 14px;
    border: 1px solid rgba(126, 154, 74, 0.42);
    border-top-color: rgba(200, 232, 108, 0.38);
    background:
      radial-gradient(120% 70% at 0% 0%, rgba(90, 144, 46, 0.16), transparent 62%),
      linear-gradient(168deg, rgba(31, 36, 22, 0.97), rgba(20, 23, 15, 0.98) 58%, rgba(17, 15, 10, 0.99));
    box-shadow: 0 20px 54px rgba(0, 0, 0, 0.52), inset 0 1px 0 rgba(220, 240, 160, 0.08);
    overflow: hidden;
  }
  .pl-side-panel.is-open { display: flex; animation: pl-panel-in 220ms cubic-bezier(0.22, 0.9, 0.3, 1); }
  #pl-inspect-panel { left: var(--hud-corner, 12px); }
  #pl-inventory-panel { right: var(--hud-corner, 12px); }

  .pl-panel__head {
    display: flex; align-items: center; justify-content: space-between;
    gap: 8px; padding: 9px 12px 8px;
    border-bottom: 1px solid rgba(126, 154, 74, 0.26);
    background: rgba(22, 27, 16, 0.72);
  }
  .pl-panel__title {
    margin: 0; font-size: 0.74rem; font-weight: 700; letter-spacing: 0.16em;
    text-transform: uppercase; color: var(--leaf-300, #c8ff80);
  }
  .pl-panel__sub { color: var(--ink-dim, #9a937a); font-size: 0.66rem; }
  .pl-panel__close {
    width: 22px; height: 22px; border-radius: 7px; cursor: pointer;
    border: 1px solid rgba(126, 154, 74, 0.35);
    background: rgba(44, 52, 30, 0.8); color: var(--bone-200, #efe9d8);
    font: inherit; line-height: 1;
  }
  .pl-panel__close:hover { background: rgba(90, 144, 46, 0.28); border-color: var(--leaf-400, #9ed95c); }
  .pl-panel__body {
    flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
    padding: 10px 12px 14px; display: flex; flex-direction: column; gap: 10px;
  }

  .pl-health { display: grid; gap: 5px; padding: 8px 9px; border-radius: 10px;
    background: rgba(54, 66, 34, 0.35); border: 1px solid rgba(126, 154, 74, 0.22); }
  .pl-health__row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .pl-health__label { font-weight: 700; color: var(--leaf-200, #dfee8e); letter-spacing: 0.04em; }
  .pl-health__value { color: var(--bone-100, #f7f4ed); font-variant-numeric: tabular-nums; }
  .pl-health__track { position: relative; height: 6px; border-radius: 4px; overflow: hidden;
    background: rgba(12, 16, 9, 0.7); }
  .pl-health__fill { position: absolute; inset: 0; transform-origin: left center;
    background: linear-gradient(90deg, #7a3020, #9ed95c 55%, #c8ff80); transition: transform 160ms ease-out; }

  .pl-section { display: grid; gap: 4px; }
  .pl-section__title {
    margin: 0; font-size: 0.64rem; font-weight: 700; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--sprout-300, #c8e86c); opacity: 0.9;
  }
  .pl-stat-row { display: flex; justify-content: space-between; gap: 10px;
    padding: 2px 0; border-bottom: 1px solid rgba(126, 154, 74, 0.1); }
  .pl-stat-row:last-child { border-bottom: none; }
  .pl-stat-row span:first-child { color: var(--ink-muted, #c9c2ad); }
  .pl-stat-row b { color: var(--bone-100, #f7f4ed); font-weight: 600; font-variant-numeric: tabular-nums; }

  .pl-mutation { display: grid; grid-template-columns: 1fr auto; gap: 1px 8px; padding: 4px 0;
    border-bottom: 1px dashed rgba(126, 154, 74, 0.16); }
  .pl-mutation:last-child { border-bottom: none; }
  .pl-mutation__head { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
  .pl-mutation b { color: var(--leaf-200, #dfee8e); font-weight: 600; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; }
  .pl-mutation__kind { color: var(--ink-dim, #9a937a); font-size: 0.6rem; text-transform: uppercase;
    letter-spacing: 0.06em; }
  .pl-mutation__numbers { color: var(--ink-dim, #9a937a); font-size: 0.66rem;
    text-align: right; font-variant-numeric: tabular-nums; }
  .pl-mutation__bar { grid-column: 1 / -1; height: 3px; margin-top: 2px; border-radius: 2px;
    overflow: hidden; background: rgba(12, 16, 9, 0.72); }
  .pl-mutation__bar > i { display: block; height: 100%; transform-origin: left center;
    background: linear-gradient(90deg, #7a6a20, #c8ff80); }
  .pl-mutation__level { grid-column: 1 / -1; display: flex; align-items: center; gap: 6px;
    margin-top: 2px; }
  .pl-mutation__level span { color: var(--ink-dim, #9a937a); font-size: 0.62rem; }
  .pl-mutation__levelup { font: 0.64rem system-ui, sans-serif; padding: 2px 8px;
    border-radius: 5px; border: 1px solid rgba(200, 255, 128, 0.4); background: transparent;
    color: #dff3a0; cursor: pointer; }
  .pl-mutation__levelup:disabled { opacity: 0.4; cursor: default; }
  .pl-card-deal { margin-top: 8px; padding-top: 6px; border-top: 1px dashed rgba(126, 154, 74, 0.16); }
  .pl-card-deal h4 { margin: 0 0 2px; font-size: 0.66rem; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--ink-dim, #9a937a); font-weight: 600; }
  .pl-card { display: block; width: 100%; text-align: left; margin-top: 4px; padding: 6px 8px;
    border-radius: 6px; border: 1px solid rgba(200, 255, 128, 0.35);
    background: rgba(24, 32, 16, 0.92); color: inherit; cursor: pointer; font: inherit; }
  .pl-card:hover { border-color: rgba(200, 255, 128, 0.7); }
  .pl-card b { display: block; color: #dff3a0; font-weight: 600; }
  .pl-card span { display: block; font-size: 0.62rem; color: var(--ink-dim, #9a937a); }

  .pl-pressure { display: grid; grid-template-columns: 64px 1fr 48px; gap: 3px 6px;
    margin-top: 6px; padding-top: 5px; border-top: 1px dashed rgba(126, 154, 74, 0.16); }
  .pl-pressure__label { color: var(--ink-dim, #9a937a); font-size: 0.62rem; text-transform: capitalize; }
  .pl-pressure__track { height: 3px; margin-top: 4px; border-radius: 2px; overflow: hidden;
    background: rgba(12, 16, 9, 0.72); }
  .pl-pressure__track > i { display: block; height: 100%; transform-origin: left center;
    background: linear-gradient(90deg, #426520, #c8e86c); }
  .pl-pressure__value { color: var(--ink-dim, #9a937a); font-size: 0.62rem; text-align: right;
    font-variant-numeric: tabular-nums; }

  .pl-node-list { display: grid; gap: 2px; }
  .pl-node { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; align-items: baseline;
    padding: 3px 5px; border-radius: 6px; background: rgba(34, 42, 24, 0.35); }
  .pl-node:hover { background: rgba(90, 144, 46, 0.18); }
  .pl-node__bar { grid-column: 1 / -1; height: 3px; margin-top: 1px; border-radius: 2px;
    overflow: hidden; background: rgba(12, 16, 9, 0.72); }
  .pl-node__bar > i { display: block; height: 100%; transform-origin: left center;
    background: linear-gradient(90deg, #7a3020, #9ed95c 58%, #c8ff80); }
  .pl-node__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pl-node__type { color: var(--ink-muted, #c9c2ad); text-transform: capitalize; }
  .pl-node__bio { color: var(--bone-100, #f7f4ed); font-variant-numeric: tabular-nums; }
  .pl-node__status { min-width: 52px; text-align: right; }
  .pl-node__status[data-status="intact"] { color: var(--leaf-300, #c8ff80); }
  .pl-node__status[data-status="growing"] { color: var(--sprout-300, #c8e86c); }
  .pl-node__status[data-status="fading"] { color: var(--gold-400, #f0c05b); }
  .pl-node__status[data-status="depleted"],
  .pl-node__status[data-status="gone"] { color: var(--ember-400, #ff8c5f); }

  .pl-inventory-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
  .pl-slot {
    position: relative; display: grid; gap: 2px; min-height: 54px;
    padding: 7px 8px; border-radius: 9px; cursor: pointer;
    border: 1px solid rgba(126, 154, 74, 0.28);
    background: linear-gradient(160deg, rgba(44, 52, 30, 0.72), rgba(25, 30, 19, 0.85));
    color: var(--bone-200, #efe9d8); text-align: left; font: inherit;
  }
  .pl-slot:hover { border-color: var(--leaf-400, #9ed95c); background: rgba(90, 144, 46, 0.2); }
  .pl-slot.is-selected { border-color: var(--leaf-300, #c8ff80); box-shadow: 0 0 0 1px rgba(200, 255, 128, 0.35) inset; }
  .pl-slot.is-empty { color: var(--ink-dim, #9a937a); cursor: default; }
  .pl-slot__key { position: absolute; top: 4px; right: 6px; font-size: 0.6rem; color: var(--ink-dim, #9a937a); }
  .pl-slot__name { font-weight: 600; overflow-wrap: anywhere; padding-right: 12px; }
  .pl-slot__count { color: var(--leaf-200, #dfee8e); font-variant-numeric: tabular-nums; }

  .pl-item-detail { margin-top: 4px; padding: 8px 9px; border-radius: 9px;
    border: 1px solid rgba(126, 154, 74, 0.24); background: rgba(34, 42, 24, 0.42);
    display: grid; gap: 6px; }
  .pl-item-detail__name { font-weight: 700; color: var(--bone-100, #f7f4ed); }
  .pl-item-detail__desc { color: var(--ink-muted, #c9c2ad); line-height: 1.4; }
  .pl-item-detail__use { color: var(--leaf-200, #dfee8e); font-weight: 600; }
  .pl-item-detail__meta { color: var(--ink-muted, #c9c2ad); }
  .pl-action {
    justify-self: start; padding: 5px 12px; border-radius: 7px; cursor: pointer;
    border: 1px solid rgba(126, 154, 74, 0.45);
    background: linear-gradient(160deg, rgba(90, 144, 46, 0.55), rgba(66, 101, 32, 0.72));
    color: var(--bone-50, #fdfbf6); font: inherit; font-weight: 700;
  }
  .pl-action:hover { background: linear-gradient(160deg, rgba(126, 188, 61, 0.7), rgba(90, 144, 46, 0.85)); }
  .pl-action:disabled { opacity: 0.45; cursor: default; }
  .pl-empty { color: var(--ink-dim, #9a937a); padding: 4px 0; }

  @keyframes pl-panel-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  @media (max-width: 900px) {
    .pl-side-panel { width: min(44vw, 300px); top: calc(var(--hud-corner, 12px) + 58px); }
  }
  @media (prefers-reduced-motion: reduce) { .pl-side-panel.is-open { animation: none; } }
`;

function installStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}

export function createPlayerPanels(options: PlayerPanelsOptions = {}): PlayerPanelsAPI {
  installStyles();
  const thresholds = options.healthThresholds;
  let view: PlayerPanelsView | null = null;
  let selectedSlot: number | null = null;
  let open = false;
  let definitions = new Map<string, ItemDefinitionView>();
  let definitionsLoaded = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const inspect = document.createElement('section');
  inspect.id = 'pl-inspect-panel';
  inspect.className = 'pl-side-panel';
  inspect.setAttribute('aria-label', 'Inspect plant');
  inspect.innerHTML = `
    <header class="pl-panel__head">
      <div><h2 class="pl-panel__title">Inspect</h2><div class="pl-panel__sub" id="pl-inspect-sub"></div></div>
      <button type="button" class="pl-panel__close" data-close="inspect" aria-label="Close inspect">\u00D7</button>
    </header>
    <div class="pl-panel__body">
      <section class="pl-health">
        <div class="pl-health__row"><span class="pl-health__label" id="pl-health-label">Healthy</span><span class="pl-health__value" id="pl-health-value">100%</span></div>
        <div class="pl-health__track"><div class="pl-health__fill" id="pl-health-fill"></div></div>
        <div class="pl-health__row"><span id="pl-phase" class="pl-panel__sub"></span><span id="pl-reroot" class="pl-panel__sub"></span></div>
      </section>
      <section class="pl-section"><h3 class="pl-section__title">Body</h3><div id="pl-stat-body"></div></section>
      <section class="pl-section"><h3 class="pl-section__title">Mutations</h3><div id="pl-mutation-summary" class="pl-panel__sub"></div><div id="pl-mutations"></div><div id="pl-pressure" class="pl-pressure"></div></section>
      <section class="pl-section"><h3 class="pl-section__title">Growth nodes</h3><div id="pl-nodes" class="pl-node-list"></div></section>
    </div>`;

  const inventory = document.createElement('section');
  inventory.id = 'pl-inventory-panel';
  inventory.className = 'pl-side-panel';
  inventory.setAttribute('aria-label', 'Inventory');
  inventory.innerHTML = `
    <header class="pl-panel__head">
      <div><h2 class="pl-panel__title">Inventory</h2><div class="pl-panel__sub" id="pl-inventory-sub"></div></div>
      <button type="button" class="pl-panel__close" data-close="inventory" aria-label="Close inventory">\u00D7</button>
    </header>
    <div class="pl-panel__body">
      <div id="pl-inventory-grid" class="pl-inventory-grid"></div>
      <div id="pl-item-detail" class="pl-item-detail"></div>
      <div class="pl-panel__sub">Click a slot \u00B7 Use \u00B7 I closes both panels</div>
    </div>`;

  const close = (): void => setOpen(false);
  inspect.querySelector('[data-close="inspect"]')?.addEventListener('click', close);
  inventory.querySelector('[data-close="inventory"]')?.addEventListener('click', close);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };
  document.addEventListener('keydown', onKeyDown);

  function setOpen(next: boolean): void {
    const wasOpen = open;
    open = next;
    inspect.classList.toggle('is-open', next);
    inventory.classList.toggle('is-open', next);
    if (next) {
      render();
      if (!timer) timer = setInterval(render, 250);
    } else if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (!next) {
      if (wasOpen) options.onClose?.();
    }
  }

  function render(): void {
    if (!open) return;
    if (!view) {
      must<HTMLElement>(inspect, '#pl-stat-body').innerHTML =
        '<div class="pl-empty">Waiting for the server.</div>';
      return;
    }
    const stats = view.stats;
    const fraction = stats.healthFraction ?? 1;
    const health = plantHealthStatus(fraction, thresholds);
    text('#pl-health-label', plantHealthLabel(health));
    text('#pl-health-value', `${Math.round(fraction * 100)}%`);
    const fill = inspect.querySelector<HTMLElement>('#pl-health-fill');
    if (fill) fill.style.transform = `scaleX(${Math.max(0, Math.min(1, fraction)).toFixed(4)})`;
    text('#pl-inspect-sub', view.phase === 'rooted' ? 'Rooted' : view.phase);
    text('#pl-phase', view.phase === 'rooted' ? '' : `State: ${view.phase}`);
    text(
      '#pl-reroot',
      view.rerootWindowRemainingS === null
        ? ''
        : `Reroot window: ${Math.max(0, Math.ceil(view.rerootWindowRemainingS))}s`,
    );

    const body = must<HTMLElement>(inspect, '#pl-stat-body');
    body.innerHTML = '';
    for (const [label, value] of plantStatRows(stats)) {
      const row = document.createElement('div');
      row.className = 'pl-stat-row';
      row.innerHTML = `<span></span><b></b>`;
      (row.firstElementChild as HTMLElement).textContent = label;
      (row.lastElementChild as HTMLElement).textContent = value;
      body.appendChild(row);
    }

    const mutationBox = must<HTMLElement>(inspect, '#pl-mutations');
    mutationBox.innerHTML = '';
    const mutationEnergy = view.mutations.reduce(
      (sum, mutation) => sum + (mutation.energyPerSecond ?? 0),
      0,
    );
    const mutationBiomass = view.mutations.reduce(
      (sum, mutation) => sum + (mutation.biomassPerSecond ?? 0),
      0,
    );
    const mutationTotal = mutationEnergy + mutationBiomass;
    const mutationShare = stats.biomass > 0 ? (mutationBiomass / stats.biomass) * 100 : 0;
    text(
      '#pl-mutation-summary',
      view.mutations.length === 0
        ? 'None held'
        : `${view.mutations.length} held \u00B7 ${mutationEnergy.toFixed(2)} E/s \u00B7 ${mutationBiomass.toFixed(2)} B/s \u00B7 ${mutationShare.toFixed(2)}% biomass/s${
            (view.mutationShedCooldownS ?? 0) > 0
              ? ` \u00B7 shed cooldown ${Math.ceil(view.mutationShedCooldownS ?? 0)}s`
              : ''
          }`,
    );
    if (view.mutations.length === 0) {
      mutationBox.innerHTML = '<div class="pl-empty">None</div>';
    } else {
      for (const mutation of view.mutations) {
        const row = document.createElement('div');
        row.className = 'pl-mutation';
        row.innerHTML =
          '<span class="pl-mutation__head"><b></b><span class="pl-mutation__kind"></span></span>' +
          '<span class="pl-mutation__numbers"></span>' +
          '<span class="pl-mutation__bar"><i></i></span>';
        (row.querySelector('.pl-mutation__head b') as HTMLElement).textContent = mutation.name;
        (row.querySelector('.pl-mutation__kind') as HTMLElement).textContent = mutation.kind ?? '';
        (row.querySelector('.pl-mutation__numbers') as HTMLElement).textContent =
          `${(mutation.biomassPerSecond ?? 0).toFixed(3)} B/s \u00B7 ${(mutation.energyPerSecond ?? 0).toFixed(3)} E/s`;
        const bar = row.querySelector<HTMLElement>('.pl-mutation__bar > i');
        if (bar) {
          const share =
            mutationTotal > 0
              ? ((mutation.energyPerSecond ?? 0) + (mutation.biomassPerSecond ?? 0)) / mutationTotal
              : 0;
          bar.style.transform = `scaleX(${Math.max(0, Math.min(1, share)).toFixed(3)})`;
        }

        // Levels: the player spends stored energy and biomass to raise a
        // mutation, and picks the card themselves when the deal opens.
        const level = mutation.level ?? 1;
        const maxLevel = mutation.maxLevel ?? 1;
        if (maxLevel > 1) {
          const levelRow = document.createElement('div');
          levelRow.className = 'pl-mutation__level';
          const label = document.createElement('span');
          label.textContent = `Level ${level}/${maxLevel}`;
          levelRow.appendChild(label);
          if (level < maxLevel) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'pl-mutation__levelup';
            const costEnergy = mutation.levelCostEnergy ?? 0;
            const costBiomass = mutation.levelCostBiomass ?? 0;
            button.textContent = `Level up \u00B7 ${costEnergy.toFixed(0)} E + ${costBiomass.toFixed(0)} biomass`;
            button.disabled = Boolean(mutation.levelBlocked);
            button.title = mutation.levelBlocked
              ? `Not now: ${mutation.levelBlocked.replace(/_/g, ' ')}`
              : 'Spend stored resources and choose a card';
            const id = mutation.id;
            button.addEventListener('click', () => {
              if (id) options.onLevelMutation?.(id);
            });
            levelRow.appendChild(button);
          } else {
            const done = document.createElement('span');
            done.textContent = 'max';
            levelRow.appendChild(done);
          }
          row.appendChild(levelRow);
        }
        mutationBox.appendChild(row);
      }
    }

    // The deal, when the server has one open: three (or fewer) cards for the
    // mutation the player asked to raise. Nothing is applied until a pick.
    const offer = view.mutationLevelOffer;
    if (offer && offer.cards.length > 0) {
      const deal = document.createElement('div');
      deal.className = 'pl-card-deal';
      const heading = document.createElement('h4');
      const target = view.mutations.find((mutation) => mutation.id === offer.mutationId);
      heading.textContent = `Choose a card for ${target?.name ?? offer.mutationId}`;
      deal.appendChild(heading);
      for (const card of offer.cards) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pl-card';
        const title = document.createElement('b');
        title.textContent = card.label;
        const detail = document.createElement('span');
        detail.textContent =
          card.id === 'energyUpkeepMultiplier'
            ? `\u00D7${card.step.toFixed(2)} upkeep`
            : `\u00D7${card.step.toFixed(2)} ${card.id.replace(/([A-Z])/g, ' $1').toLowerCase()}`;
        button.append(title, detail);
        button.addEventListener('click', () =>
          options.onLevelMutation?.(offer.mutationId, card.id),
        );
        deal.appendChild(button);
      }
      mutationBox.appendChild(deal);
    }

    const pressureBox = must<HTMLElement>(inspect, '#pl-pressure');
    pressureBox.innerHTML = '';
    const pressureEntries = Object.entries(view.pressure ?? {})
      .filter(([, amount]) => amount > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6);
    if (pressureEntries.length === 0) {
      pressureBox.innerHTML = '<div class="pl-empty">No growth pressure yet.</div>';
    } else {
      const peak = Math.max(...pressureEntries.map(([, amount]) => amount));
      for (const [category, amount] of pressureEntries) {
        const label = document.createElement('span');
        label.className = 'pl-pressure__label';
        label.textContent = category.replace(/_/g, ' ');
        const track = document.createElement('span');
        track.className = 'pl-pressure__track';
        track.innerHTML = '<i></i>';
        const fill = track.querySelector('i') as HTMLElement;
        fill.style.transform = `scaleX(${(amount / Math.max(1, peak)).toFixed(3)})`;
        const value = document.createElement('span');
        value.className = 'pl-pressure__value';
        value.textContent = `${amount.toFixed(1)} \u00B7 ${Math.round((amount / Math.max(1, peak)) * 100)}%`;
        pressureBox.append(label, track, value);
      }
    }

    const nodeBox = must<HTMLElement>(inspect, '#pl-nodes');
    nodeBox.innerHTML = '';
    if (view.nodes.length === 0) {
      nodeBox.innerHTML = '<div class="pl-empty">No nodes.</div>';
    } else {
      // Root tissue first, then the canopy, biggest parts first.
      const nodes = [...view.nodes].sort((a, b) => {
        if (a.layer !== b.layer) return a.layer === 'root' ? -1 : 1;
        return b.biomass - a.biomass;
      });
      for (const node of nodes) {
        const status = nodeHealthStatus(node.health, node.growthProgress);
        const row = document.createElement('div');
        row.className = 'pl-node';
        row.title = `${node.id} \u00B7 ${node.layer} \u00B7 ${nodeHealthLabel(status)}`;
        row.innerHTML =
          '<span class="pl-node__name"><span class="pl-node__type"></span></span>' +
          '<span class="pl-node__bio"></span>' +
          '<span class="pl-node__status"></span>' +
          '<span class="pl-node__bar"><i></i></span>';
        const typeEl = row.querySelector('.pl-node__type') as HTMLElement;
        typeEl.textContent = node.isSeed ? 'seed' : node.type.replace(/_/g, ' ');
        (row.querySelector('.pl-node__bio') as HTMLElement).textContent = node.biomass.toFixed(1);
        const statusEl = row.querySelector('.pl-node__status') as HTMLElement;
        statusEl.textContent = nodeHealthLabel(status);
        statusEl.dataset.status = status;
        const bar = row.querySelector<HTMLElement>('.pl-node__bar > i');
        if (bar) {
          const health = Math.max(0, Math.min(1, node.health));
          bar.style.transform = `scaleX(${health.toFixed(3)})`;
        }
        nodeBox.appendChild(row);
      }
    }

    renderInventory();
  }

  function renderInventory(): void {
    if (!view) return;
    const grid = must<HTMLElement>(inventory, '#pl-inventory-grid');
    grid.innerHTML = '';
    const slots = view.inventory;
    text('#pl-inventory-sub', `${slots.filter((slot) => slot !== null).length} / ${view.maxSlots}`);
    for (let i = 0; i < view.maxSlots; i += 1) {
      const slot = slots[i] ?? null;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `pl-slot${slot ? '' : ' is-empty'}${selectedSlot === i ? ' is-selected' : ''}`;
      button.innerHTML =
        `<span class="pl-slot__key">${i === 9 ? '0' : i + 1}</span>` +
        `<span class="pl-slot__name"></span><span class="pl-slot__count"></span>`;
      (button.querySelector('.pl-slot__name') as HTMLElement).textContent = slot
        ? prettyItemId(slot.itemId)
        : 'Empty';
      (button.querySelector('.pl-slot__count') as HTMLElement).textContent = slot
        ? `\u00D7${slot.count}`
        : '';
      if (slot) {
        button.addEventListener('click', () => {
          selectedSlot = i;
          renderInventory();
        });
      }
      grid.appendChild(button);
    }

    const detail = must<HTMLElement>(inventory, '#pl-item-detail');
    const slot = selectedSlot === null ? null : (slots[selectedSlot] ?? null);
    if (!slot) {
      detail.innerHTML = '<div class="pl-empty">Select a slot.</div>';
      return;
    }
    const definition = definitions.get(slot.itemId);
    const useText = describeItemUse(definition?.use);
    // The button reflects the server's own declaration: an item it cannot use
    // is disabled and says why, instead of clicking into a silent no-op.
    const canUse = definition?.use.kind === 'resources';
    detail.innerHTML =
      '<div class="pl-item-detail__name"></div>' +
      '<div class="pl-item-detail__desc"></div>' +
      '<div class="pl-item-detail__use"></div>' +
      '<div class="pl-item-detail__meta"></div>' +
      '<button type="button" class="pl-action" data-use></button>';
    (detail.querySelector('.pl-item-detail__name') as HTMLElement).textContent =
      definition?.name ?? prettyItemId(slot.itemId);
    (detail.querySelector('.pl-item-detail__desc') as HTMLElement).textContent =
      definition?.description ??
      (definitionsLoaded
        ? 'No definition for this item.'
        : 'Waiting for item details from the server.');
    (detail.querySelector('.pl-item-detail__use') as HTMLElement).textContent = useText;
    (detail.querySelector('.pl-item-detail__meta') as HTMLElement).textContent =
      `${slot.count} in slot ${(selectedSlot ?? 0) + 1} \u00B7 ${slot.itemId}${
        definition ? ` \u00B7 ${definition.category} \u00B7 stacks to ${definition.stackLimit}` : ''
      }`;
    const useButton = detail.querySelector('[data-use]') as HTMLButtonElement;
    useButton.textContent = canUse ? 'Use' : definitionsLoaded ? 'Unavailable' : 'Loading\u2026';
    useButton.disabled = !canUse;
    useButton.title = useText;
    useButton.addEventListener('click', () => {
      if (selectedSlot !== null) options.onUseItem?.(selectedSlot);
    });
  }

  return {
    inspect,
    inventory,
    get isOpen() {
      return open;
    },
    update(next) {
      view = next;
      selectedSlot = selectedSlot !== null && selectedSlot < next.maxSlots ? selectedSlot : null;
      if (open) render();
    },
    setDefinitions(next) {
      definitions = new Map(next.map((definition) => [definition.id, definition]));
      definitionsLoaded = true;
      if (open) renderInventory();
    },
    setInventory(slots, maxSlots) {
      if (!view) {
        view = {
          stats: {
            healthFraction: null,
            biomass: 0,
            biomassRatePerSecond: null,
            peakBiomass: 0,
            energy: 0,
            storedWater: 0,
            waterCapacity: 0,
            storedMinerals: 0,
            mineralCapacity: 0,
            nodeCount: 0,
            peakNodeCount: 0,
            mutationCount: 0,
            mutationUpkeepPerSecond: 0,
            ageSeconds: 0,
            dayNumber: 0,
            clock: '00:00',
          },
          phase: 'rooted',
          rerootWindowRemainingS: null,
          nodes: [],
          mutations: [],
          pressure: {},
          inventory: slots,
          maxSlots,
        };
      } else {
        view.inventory = slots;
        view.maxSlots = maxSlots;
      }
      if (open) renderInventory();
    },
    setOpen,
    selectSlot(index) {
      const max = view?.maxSlots ?? 0;
      if (!open || index < 0 || index >= max) return;
      selectedSlot = index;
      renderInventory();
    },
    toggle() {
      setOpen(!open);
    },
    dispose() {
      if (timer) clearInterval(timer);
      timer = null;
      document.removeEventListener('keydown', onKeyDown);
      inspect.remove();
      inventory.remove();
    },
  };
}

function text(selector: string, value: string): void {
  const el = document.querySelector(selector);
  if (el) el.textContent = value;
}

/** The markup is built in this module, so a missing node is a programming error. */
function must<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`PlayerPanels: missing ${selector}`);
  return element;
}
