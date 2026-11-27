/**
 * C04 inspect + inventory side panels.
 *
 * Pressing I opens both at once: inspect on the left, inventory on the right,
 * with the world left visible between them. Inspect is the plant's body and
 * history (health, resources, mutations, every growth node); inventory is the
 * server-owned pouch. Nothing here edits plant state; item use is an intent.
 */

import { type LedgerEntry, ledgerEntryText } from '@plant-legacy/shared/economy';
import { ownerCaption } from '../render/rivalTagLabel.ts';
import { itemIconSvg } from './itemIcons.ts';
import { mutationShedControl } from './mutationState.js';
import { ownerPresence } from './ownerPresence.ts';
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

/**
 * Someone else's plant, looked at through the same panel.
 *
 * Low detail on purpose: the server streams a rival's parts and their biomass
 * for the mirror, and nothing else. There are no stored resources, no mutation
 * list and no level-up here, because none of it is ours to see - and a rival's
 * panel is not a place to invent numbers we were never sent.
 */
export interface InspectOtherView {
  owner?: string;
  /** The owner's display name, when the world sent one. */
  ownerName?: string;
  /**
   * Whether the owner is connected. Absent from an older server, in which case
   * the panel says nothing rather than guessing from the missing name.
   */
  ownerOnline?: boolean;
  /** World id, so two rivals with no owner streamed can still be told apart. */
  plantId: string;
  parts: Array<{ type: string; count: number; biomass: number }>;
  totalBiomass: number;
  /** Nodes the mirror holds for this plant, filtered to what may be picked. */
  partCount: number;
}

export interface PlayerPanelsView {
  stats: PlantStatsSummary;
  phase: PlantPhase;
  /** T12 seed identity, when the server sent it on WELCOME. */
  archetype?: { id: string; name: string };
  /** Where the seed was planted, as the player-faced geographic label. */
  spawn?: { label: string };
  spawnLatitudeDeg?: number;
  spawnLongitudeDeg?: number;
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
  /** Why the purse moved, newest last. Absent until the server has sent one. */
  ledger?: LedgerEntry[];
}

export interface PlayerPanelsOptions {
  healthThresholds?: HealthThresholds;
  onUseItem?: (slotIndex: number) => void;
  /**
   * Ask to raise a mutation. Without `cardId` the server deals the cards;
   * with one, that card is taken and the level is applied.
   */
  onLevelMutation?: (mutationId: string, cardId?: string) => void;
  /**
   * Ask the server to shed a mutation, stopping its upkeep. This list is the
   * only place that can: the retired bottom-left panel that used to carry the
   * shed button was never mounted (D3).
   */
  onShed?: (mutationId: string) => void;
  /** Called after either panel closes, so the HUD can be restored. */
  onClose?: () => void;
}

export type PlayerPanelId = 'inspect' | 'inventory';

export interface PlayerPanelsAPI {
  readonly inspect: HTMLElement;
  readonly inventory: HTMLElement;
  /** True while either panel is up. */
  readonly isOpen: boolean;
  update(view: PlayerPanelsView): void;
  /**
   * One panel at a time. The two are siblings on screen, not one dialog: closing
   * Inspect leaves the inventory where it was, and the other way round.
   */
  setPanelOpen(panel: PlayerPanelId, open: boolean): void;
  isPanelOpen(panel: PlayerPanelId): boolean;
  /**
   * Point Inspect at another player's plant (low detail), or back at yours with
   * null. Independent of the periodic own-plant refresh.
   */
  inspectOther(other: InspectOtherView | null): void;
  setInventory(slots: Array<InventorySlotView | null>, maxSlots: number): void;
  /**
   * Item definitions from the server, keyed by id. Until they arrive the panel
   * can only show an id-derived name, so it says it is waiting instead of
   * pretending the item has no description.
   */
  setDefinitions(definitions: ReadonlyArray<ItemDefinitionView>): void;
  setOpen(open: boolean): void;
  /** Bring the inventory face of the phone sheet forward (no-op on desktop). */
  showInventory(): void;
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
    position: relative;
    display: flex; align-items: center; justify-content: space-between;
    gap: 8px; padding: 10px 42px 9px 12px;
    border-bottom: 1px solid rgba(126, 154, 74, 0.26);
    background: rgba(22, 27, 16, 0.72);
  }
  .pl-panel__title {
    margin: 0; font-size: 0.74rem; font-weight: 700; letter-spacing: 0.16em;
    text-transform: uppercase; color: var(--leaf-300, #c8ff80);
  }
  .pl-panel__sub { color: var(--ink-dim, #9a937a); font-size: 0.66rem; }
  /* Corner close: 28px target in the panel's top right, like every other panel. */
  .pl-panel__close {
    position: absolute; top: 6px; right: 6px;
    width: 28px; height: 28px; display: grid; place-items: center;
    border-radius: 8px; cursor: pointer; font-size: 1rem; line-height: 1;
    border: 1px solid rgba(126, 154, 74, 0.35);
    background: rgba(44, 52, 30, 0.8); color: var(--bone-200, #efe9d8);
    font: inherit;
    transition: background 140ms ease, border-color 140ms ease, transform 140ms ease;
  }
  .pl-panel__close:hover { background: rgba(90, 144, 46, 0.28); border-color: var(--leaf-400, #9ed95c); }
  .pl-panel__close:active { transform: scale(0.94); }
  .pl-panel__close:focus-visible { outline: 2px solid var(--leaf-300, #c8ff80); outline-offset: 2px; }
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
  /* The fill is one colour band, not a red-to-green ramp: at full health a ramp
     left a red third sitting in the bar, which read as damage on a plant that
     had none. The band's colour is the status; its length is the fraction. */
  .pl-health__fill { position: absolute; inset: 0; transform-origin: left center;
    background: linear-gradient(90deg, #4e7a24, #9ed95c 62%, #c8ff80);
    transition: transform 160ms ease-out, background-color 200ms ease; }
  .pl-health__fill[data-tone='warn'] { background: linear-gradient(90deg, #8a6a1e, #f0c05b); }
  .pl-health__fill[data-tone='critical'] { background: linear-gradient(90deg, #7a2a18, #ff8c5f); }

  .pl-section { display: grid; gap: 4px; }
  /* Inspect shows one plant at a time: the player's own body, or a rival's parts
     in low detail. The sections that only exist for your own plant are hidden
     rather than emptied, so the panel never shows a rival a blank Mutations
     heading and an empty level-up row. */
  .pl-section--other { display: none; }
  #pl-inspect-panel[data-other='true'] .pl-health,
  #pl-inspect-panel[data-other='true'] .pl-section--own {
    display: none;
  }
  #pl-inspect-panel[data-other='true'] .pl-section--other { display: grid; }
  .pl-other__row { display: grid; grid-template-columns: 1fr auto auto; gap: 8px;
    align-items: baseline; padding: 3px 0;
    border-bottom: 1px solid rgba(126, 154, 74, 0.12); }
  .pl-other__row:last-child { border-bottom: none; }
  /* Asleep or awake: the one fact about a rival's *player* the world shares.
     A dot rather than a word alone, because it is read at a glance from across
     the garden; the words carry the meaning, the colour only repeats it. */
  .pl-other__state { display: none; align-items: center; gap: 8px;
    padding: 4px 0 9px; margin-bottom: 5px;
    border-bottom: 1px solid rgba(126, 154, 74, 0.16);
    color: var(--ink-muted, #c9c2ad); }
  #pl-inspect-panel[data-other='true'] .pl-other__state[data-state='awake'],
  #pl-inspect-panel[data-other='true'] .pl-other__state[data-state='asleep'] {
    display: flex;
  }
  .pl-other__dot { width: 7px; height: 7px; border-radius: 50%; flex: none;
    background: var(--ink-dim, #9a937a); }
  .pl-other__state[data-state='awake'] .pl-other__dot {
    background: var(--sprout-300, #c8e86c);
    box-shadow: 0 0 7px rgba(200, 232, 108, 0.75);
  }
  .pl-other__state[data-state='asleep'] .pl-other__dot {
    background: var(--ink-dim, #9a937a);
    box-shadow: inset 0 0 0 1px rgba(154, 147, 122, 0.5);
  }
  .pl-other__type { color: var(--ink-muted, #c9c2ad); text-transform: capitalize; }
  .pl-other__count { color: var(--ink-dim, #9a937a); font-variant-numeric: tabular-nums; }
  .pl-other__biomass { color: var(--bone-100, #f7f4ed); font-variant-numeric: tabular-nums; }
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
  /* The same 44x28 target as a shed button: a row's actions are one size
     whether or not one of them is the dangerous one, and the panel's close is
     28 CSS px tall. */
  .pl-mutation__levelup { min-height: 28px; min-width: 44px; padding: 4px 10px;
    font: 0.64rem system-ui, sans-serif; border-radius: 5px;
    border: 1px solid rgba(200, 255, 128, 0.4); background: transparent;
    color: #dff3a0; cursor: pointer; }
  .pl-mutation__levelup:disabled { opacity: 0.4; cursor: default; }
  .pl-mutation__shed { grid-column: 1 / -1; justify-self: start; margin-top: 3px;
    min-height: 28px; min-width: 44px; padding: 4px 10px;
    font: 0.64rem system-ui, sans-serif; border-radius: 5px;
    border: 1px solid rgba(200, 150, 140, 0.4); background: transparent;
    color: #e8c9c0; cursor: pointer; }
  .pl-mutation__shed:disabled { opacity: 0.4; cursor: default; }
  .pl-card-deal { margin-top: 8px; padding-top: 6px; border-top: 1px dashed rgba(126, 154, 74, 0.16); }
  .pl-card-deal h4 { margin: 0 0 2px; font-size: 0.66rem; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--ink-dim, #9a937a); font-weight: 600; }
  .pl-card { display: block; width: 100%; text-align: left; margin-top: 4px; padding: 6px 8px;
    border-radius: 6px; border: 1px solid rgba(200, 255, 128, 0.35);
    background: rgba(24, 32, 16, 0.92); color: inherit; cursor: pointer; font: inherit; }
  .pl-card:hover { border-color: rgba(200, 255, 128, 0.7); }
  .pl-card b { display: block; color: #dff3a0; font-weight: 600; }
  .pl-card span { display: block; font-size: 0.62rem; color: var(--ink-dim, #9a937a); }

  /* The empty message is not a column: it used to wrap inside the 64px label cell. */
  .pl-pressure > .pl-empty { grid-column: 1 / -1; }
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
    background: linear-gradient(90deg, #4e7a24, #9ed95c 62%, #c8ff80); }
  .pl-node__bar > i[data-tone='warn'] { background: linear-gradient(90deg, #8a6a1e, #f0c05b); }
  .pl-node__bar > i[data-tone='critical'] { background: linear-gradient(90deg, #7a2a18, #ff8c5f); }
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
    color: var(--leaf-200, #dfee8e);
    border: 1px solid rgba(126, 154, 74, 0.28);
    background: linear-gradient(160deg, rgba(44, 52, 30, 0.72), rgba(25, 30, 19, 0.85));
    color: var(--bone-200, #efe9d8); text-align: left; font: inherit;
  }
  .pl-slot:hover { border-color: var(--leaf-400, #9ed95c); background: rgba(90, 144, 46, 0.2); }
  .pl-slot.is-selected { border-color: var(--leaf-300, #c8ff80); box-shadow: 0 0 0 1px rgba(200, 255, 128, 0.35) inset; }
  .pl-slot.is-empty { color: var(--ink-dim, #9a937a); cursor: default; }
  .pl-slot__key { position: absolute; top: 4px; right: 6px; font-size: 0.6rem; color: var(--ink-dim, #9a937a); }
  .pl-slot__icon { position: absolute; top: 6px; left: 7px; display: grid; place-items: center; opacity: 0.9; }
  .pl-slot__icon:empty { display: none; }
  .pl-slot__name { margin-top: 20px; }
  .pl-slot__count { position: absolute; bottom: 5px; right: 7px; font-size: 0.72rem; }
  .pl-slot__name { font-weight: 600; overflow-wrap: anywhere; padding-right: 12px; }
  .pl-slot__count { color: var(--leaf-200, #dfee8e); font-variant-numeric: tabular-nums; }

  .pl-ledger-label { margin-top: 8px; color: var(--ink-dim, #9a937a); font-size: 0.62rem;
    letter-spacing: 0.08em; text-transform: uppercase; }
  .pl-ledger { display: grid; gap: 2px; margin-top: 3px; max-height: 8.2rem; overflow-y: auto; }
  .pl-ledger__row { padding: 3px 5px; border-radius: 6px; font-size: 0.7rem;
    color: var(--bone-200, #efe9d8); background: rgba(34, 42, 24, 0.35);
    font-variant-numeric: tabular-nums; }
  .pl-ledger__row[data-kind='award'], .pl-ledger__row[data-kind='drop'] {
    color: var(--leaf-200, #dfee8e); }
  .pl-ledger__empty { color: var(--ink-dim, #9a937a); font-size: 0.7rem; }
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

  .pl-sheet-tabs {
    position: fixed;
    display: none;
    top: calc(var(--hud-corner, 8px) + 56px);
    left: calc(var(--hud-corner, 8px) + env(safe-area-inset-left, 0px));
    right: calc(var(--hud-corner, 8px) + env(safe-area-inset-right, 0px));
    z-index: 341;
    gap: 6px;
    padding: 5px;
    border-radius: 12px;
    border: 1px solid var(--hud-border, rgba(126, 154, 74, 0.4));
    background: linear-gradient(180deg, rgba(20, 26, 16, 0.94), rgba(11, 15, 9, 0.96));
    pointer-events: auto;
  }
  .pl-sheet-tabs__btn {
    flex: 1;
    min-height: 36px;
    padding: 6px 10px;
    border: 1px solid transparent;
    border-radius: 9px;
    background: transparent;
    color: var(--ink-muted, #c9c2ad);
    font: inherit;
    font-size: var(--hud-font-sm, 0.8rem);
    font-weight: 700;
    letter-spacing: 0.04em;
    cursor: pointer;
  }
  .pl-sheet-tabs__btn[aria-selected='true'] {
    background: rgba(90, 144, 46, 0.3);
    border-color: var(--leaf-500, #7db83d);
    color: var(--bone-100, #f7f4ed);
  }
  .pl-sheet-tabs__btn:focus-visible { outline: 2px solid var(--leaf-300, #c8ff80); outline-offset: 2px; }

  @keyframes pl-panel-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  @media (max-width: 900px) {
    /* A share of the pane, in the overlay's own units: inside the zoomed layer a
       length is multiplied by the zoom, so the share is divided by it to keep the
       panel the size it should be on screen. */
    .pl-side-panel {
      width: min(calc(44vw / var(--pl-ui-scale, 1)), 300px);
      top: calc(var(--hud-corner, 12px) + 58px);
    }
  }
  /* Phone: two 171px columns side by side was unreadable, so the panels become
     one full-width sheet with a switch at the top. The second condition is the
     narrow pane itself: under 480px two panels cannot fit however they are sized,
     so the sheet is the answer there even with a mouse. Above it, a narrow browser
     pane has the room for two panels and needs to keep seeing the game, so it
     scales them with the rest of the overlay instead (styles.css,
     --pl-ui-scale). */
  @media (max-width: 560px) and (hover: none) and (pointer: coarse), (max-width: 480px) {
    .pl-sheet-tabs.is-visible { display: flex; }
    .pl-side-panel {
      left: calc(var(--hud-corner, 8px) + env(safe-area-inset-left, 0px));
      right: calc(var(--hud-corner, 8px) + env(safe-area-inset-right, 0px));
      width: auto;
      top: calc(var(--hud-corner, 8px) + 100px);
      bottom: calc(var(--pl-bar-offset, 62px) + 26px);
      border-radius: 14px;
    }
    .pl-side-panel.is-open:not(.is-sheet-active) { display: none; }
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
  // Two panels, two states. They share a ticker and a stylesheet, not a lifespan.
  let openInspect = false;
  let openInventory = false;
  /** Set while Inspect is pointed at someone else's plant. */
  let otherView: InspectOtherView | null = null;
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
      <section class="pl-section pl-section--own"><h3 class="pl-section__title">Body</h3><div id="pl-stat-body"></div></section>
      <section class="pl-section pl-section--own"><h3 class="pl-section__title">Mutations</h3><div id="pl-mutation-summary" class="pl-panel__sub"></div><div id="pl-mutations"></div><div id="pl-pressure" class="pl-pressure"></div></section>
      <section class="pl-section pl-section--own"><h3 class="pl-section__title">Growth nodes</h3><div id="pl-nodes" class="pl-node-list"></div></section>
      <section class="pl-section pl-section--other">
        <h3 class="pl-section__title">Parts seen</h3>
        <div id="pl-other-state" class="pl-other__state">
          <span class="pl-other__dot"></span><span id="pl-other-state-text"></span>
        </div>
        <div id="pl-other-rows" class="pl-other"></div>
        <div id="pl-other-summary" class="pl-panel__sub"></div>
      </section>
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
      <div class="pl-ledger-label">Spore ledger</div>
      <div id="pl-ledger" class="pl-ledger"></div>
      <div class="pl-panel__sub">Click a slot \u00B7 Use \u00B7 Esc closes panels</div>
    </div>`;

  // Phone switch: one sheet, two faces. On a wide screen both panels show and
  // this stays hidden, so the same component serves both layouts.
  const sheetTabs = document.createElement('nav');
  sheetTabs.className = 'pl-sheet-tabs';
  sheetTabs.setAttribute('role', 'tablist');
  sheetTabs.setAttribute('aria-label', 'Plant panels');
  const tabButton = (id: 'inspect' | 'inventory', label: string): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pl-sheet-tabs__btn';
    btn.setAttribute('role', 'tab');
    btn.dataset.sheet = id;
    btn.textContent = label;
    btn.addEventListener('click', () => setSheetTab(id));
    return btn;
  };
  const inspectTab = tabButton('inspect', 'Inspect');
  const inventoryTab = tabButton('inventory', 'Inventory');
  sheetTabs.append(inspectTab, inventoryTab);
  document.body.appendChild(sheetTabs);

  let sheetTab: 'inspect' | 'inventory' = 'inspect';

  /** Which face of the sheet is showing; a no-op on a wide screen. */
  function setSheetTab(next: 'inspect' | 'inventory'): void {
    sheetTab = next;
    inspect.classList.toggle('is-sheet-active', next === 'inspect');
    inventory.classList.toggle('is-sheet-active', next === 'inventory');
    inspectTab.setAttribute('aria-selected', String(next === 'inspect'));
    inventoryTab.setAttribute('aria-selected', String(next === 'inventory'));
    // Selecting an item lives in the inventory; switching to Inspect must not
    // leave a stale Use button armed.
    if (next === 'inspect') selectedSlot = null;
  }
  setSheetTab('inspect');

  // Delegated on each panel, not bound to the button: a re-render that replaced
  // the header used to leave the visible close button without a handler. Each
  // close button closes its own panel - they used to share one close path, so
  // shutting the inventory also took the plant you were reading with it.
  for (const panel of [inspect, inventory]) {
    panel.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-close]');
      if (!target) return;
      setPanelOpen(target.dataset.close === 'inventory' ? 'inventory' : 'inspect', false);
    });
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && (openInspect || openInventory)) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };
  document.addEventListener('keydown', onKeyDown);

  const anyOpen = (): boolean => openInspect || openInventory;

  function syncTicker(): void {
    if (anyOpen()) {
      if (!timer) timer = setInterval(render, 250);
      return;
    }
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  /** One panel up or down, leaving the other exactly as it was. */
  function setPanelOpen(panel: PlayerPanelId, next: boolean): void {
    const wasOpen = anyOpen();
    if (panel === 'inspect') openInspect = next;
    else openInventory = next;
    // Closing Inspect drops the rival it was pointed at: a stale snapshot of
    // someone else's plant is worse than none when it reopens later.
    if (panel === 'inspect' && !next && otherView) {
      otherView = null;
      inspect.removeAttribute('data-other');
    }
    inspect.classList.toggle('is-open', openInspect);
    inventory.classList.toggle('is-open', openInventory);
    sheetTabs.classList.toggle('is-visible', anyOpen());
    if (next) {
      // On a phone the sheet shows one face at a time: opening a panel makes it
      // the face you are looking at, or it would open behind the other one.
      if (panel === 'inventory' && !openInspect) setSheetTab('inventory');
      if (panel === 'inspect' && !openInventory) setSheetTab('inspect');
      render();
    }
    syncTicker();
    if (wasOpen && !anyOpen()) options.onClose?.();
  }

  function setOpen(next: boolean): void {
    const wasOpen = anyOpen();
    openInspect = next;
    openInventory = next;
    inspect.classList.toggle('is-open', next);
    inventory.classList.toggle('is-open', next);
    sheetTabs.classList.toggle('is-visible', next);
    if (next) {
      setSheetTab(sheetTab);
      render();
    } else {
      otherView = null;
      inspect.removeAttribute('data-other');
    }
    syncTicker();
    if (wasOpen && !next) options.onClose?.();
  }

  // The panel refreshes every 200 ms while it is open, and the mutation rows used
  // to be rebuilt on every pass: the button under the pointer was replaced between
  // a press's down and up (so no click), and a focused row control lost focus five
  // times a second. Rows are rebuilt only when the set they show changes, and the
  // key that says so lives on the list itself: in a variable it could outlive the
  // rows (after a dispose or an emptied list) and leave the block stale forever.

  function render(): void {
    if (!anyOpen()) return;

    // Someone else's plant: the same panel, the low-detail face.
    if (otherView) {
      inspect.dataset.other = 'true';
      text('#pl-inspect-sub', 'Another plant');
      // Awake or asleep. The words first, so the state survives a colourblind
      // read and a screenshot with the dot out of frame.
      const presence = ownerPresence(otherView.ownerOnline);
      const state = must<HTMLElement>(inspect, '#pl-other-state');
      state.dataset.state = presence.state;
      text('#pl-other-state-text', presence.text);
      const box = must<HTMLElement>(inspect, '#pl-other-rows');
      box.innerHTML = '';
      const parts = [...otherView.parts].sort((a, b) => b.biomass - a.biomass);
      if (parts.length === 0) {
        box.innerHTML = '<div class="pl-empty">No parts streamed yet.</div>';
      } else {
        for (const part of parts) {
          const row = document.createElement('div');
          row.className = 'pl-other__row';
          row.innerHTML =
            '<span class="pl-other__type"></span>' +
            '<span class="pl-other__count"></span>' +
            '<span class="pl-other__biomass"></span>';
          (row.children[0] as HTMLElement).textContent = part.type.replace(/_/g, ' ');
          (row.children[1] as HTMLElement).textContent = `\u00D7${part.count}`;
          (row.children[2] as HTMLElement).textContent = part.biomass.toFixed(1);
          box.appendChild(row);
        }
      }
      text(
        '#pl-other-summary',
        `${otherView.partCount} part${otherView.partCount === 1 ? '' : 's'} \u00B7 ` +
          `${otherView.totalBiomass.toFixed(1)} biomass \u00B7 ` +
          `${ownerCaption(otherView.ownerName)}`,
      );
      renderInventory();
      return;
    }
    inspect.removeAttribute('data-other');

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
    if (fill) {
      fill.style.transform = `scaleX(${Math.max(0, Math.min(1, fraction)).toFixed(4)})`;
      fill.dataset.tone = health === 'healthy' ? 'ok' : health === 'stressed' ? 'warn' : 'critical';
    }
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
    if (view.archetype) {
      const row = document.createElement('div');
      row.className = 'pl-stat-row';
      row.innerHTML = '<span></span><b></b>';
      (row.firstElementChild as HTMLElement).textContent = 'Seed';
      (row.lastElementChild as HTMLElement).textContent = view.archetype.name;
      body.appendChild(row);
    }
    if (view.spawn?.label) {
      const row = document.createElement('div');
      row.className = 'pl-stat-row';
      row.innerHTML = '<span></span><b></b>';
      (row.firstElementChild as HTMLElement).textContent = 'Planted';
      (row.lastElementChild as HTMLElement).textContent = view.spawn.label;
      body.appendChild(row);
    }
    for (const [label, value] of plantStatRows(stats)) {
      const row = document.createElement('div');
      row.className = 'pl-stat-row';
      row.innerHTML = `<span></span><b></b>`;
      (row.firstElementChild as HTMLElement).textContent = label;
      (row.lastElementChild as HTMLElement).textContent = value;
      body.appendChild(row);
    }

    const mutationBox = must<HTMLElement>(inspect, '#pl-mutations');
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
    const rowsKey = JSON.stringify([view.mutations, view.mutationLevelOffer ?? null]);
    if (mutationBox.dataset.rowsKey !== rowsKey) {
      mutationBox.dataset.rowsKey = rowsKey;
      mutationBox.replaceChildren();
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
          (row.querySelector('.pl-mutation__kind') as HTMLElement).textContent =
            mutation.kind ?? '';
          (row.querySelector('.pl-mutation__numbers') as HTMLElement).textContent =
            `${(mutation.biomassPerSecond ?? 0).toFixed(3)} B/s \u00B7 ${(mutation.energyPerSecond ?? 0).toFixed(3)} E/s`;
          const bar = row.querySelector<HTMLElement>('.pl-mutation__bar > i');
          if (bar) {
            const share =
              mutationTotal > 0
                ? ((mutation.energyPerSecond ?? 0) + (mutation.biomassPerSecond ?? 0)) /
                  mutationTotal
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

          // Shedding is the only way to stop paying a mutation's upkeep (E6), and
          // this list is the only place it can be asked for.
          const shed = mutationShedControl(mutation.id, view.mutationShedCooldownS ?? 0);
          if (shed) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'pl-mutation__shed';
            button.textContent = 'shed';
            button.disabled = shed.disabled;
            button.title = shed.title;
            button.addEventListener('click', () => options.onShed?.(shed.id));
            button.dataset.mutationId = shed.id;
            row.appendChild(button);
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
    }

    // The cooldown moves between server packets; write it onto the buttons that
    // are already in the list rather than replacing them under the pointer. The
    // buttons carry their own mutation id, so this holds no second list to fall
    // out of step with them.
    for (const button of mutationBox.querySelectorAll<HTMLButtonElement>('.pl-mutation__shed')) {
      const id = button.dataset.mutationId;
      if (!id) continue;
      const control = mutationShedControl(id, view.mutationShedCooldownS ?? 0);
      if (!control) continue;
      button.disabled = control.disabled;
      button.title = control.title;
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
          // The bar says the same thing as the word beside it, in colour: a
          // healthy part is green, a damaged one gold, a dying one ember.
          const health = Math.max(0, Math.min(1, node.health));
          bar.style.transform = `scaleX(${health.toFixed(3)})`;
          bar.dataset.tone = health >= 0.85 ? 'ok' : health >= 0.5 ? 'warn' : 'critical';
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
        '<span class="pl-slot__icon"></span>' +
        `<span class="pl-slot__name"></span><span class="pl-slot__count"></span>`;
      // The server's item name wins over the pretty id (`essence_growth` is
      // "Growth Essence", not "Essence Growth"), matching the hotbar and detail.
      const gridDefinition = slot ? definitions.get(slot.itemId) : undefined;
      // The slot shows the item's own drawing, the same one the shop sells: an
      // item you bought in the shop and can find in the pouch has to look like
      // one thing, and a name alone asks the player to read every slot.
      const icon = button.querySelector<HTMLElement>('.pl-slot__icon');
      if (icon) icon.innerHTML = slot ? itemIconSvg(slot.itemId) : '';
      (button.querySelector('.pl-slot__name') as HTMLElement).textContent = slot
        ? (gridDefinition?.name ?? prettyItemId(slot.itemId))
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

    // The ledger lists the newest change first: the line the player just caused is
    // the one they are looking for, and it should not be at the bottom of a list.
    const ledgerBox = must<HTMLElement>(inventory, '#pl-ledger');
    ledgerBox.innerHTML = '';
    const entries = [...(view.ledger ?? [])].reverse();
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'pl-ledger__empty';
      empty.textContent = 'No spore changes yet.';
      ledgerBox.appendChild(empty);
    } else {
      for (const entry of entries) {
        const row = document.createElement('div');
        row.className = 'pl-ledger__row';
        row.dataset.kind = entry.kind;
        row.textContent = ledgerEntryText(entry);
        ledgerBox.appendChild(row);
      }
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
      return anyOpen();
    },
    update(next) {
      view = next;
      selectedSlot = selectedSlot !== null && selectedSlot < next.maxSlots ? selectedSlot : null;
      if (anyOpen()) render();
    },
    setPanelOpen,
    isPanelOpen(panel) {
      return panel === 'inspect' ? openInspect : openInventory;
    },
    inspectOther(other) {
      otherView = other;
      if (!other) inspect.removeAttribute('data-other');
      if (anyOpen()) render();
    },
    setDefinitions(next) {
      definitions = new Map(next.map((definition) => [definition.id, definition]));
      definitionsLoaded = true;
      if (openInventory) renderInventory();
    },
    showInventory() {
      setSheetTab('inventory');
      // Pressing Inventory two panels in should bring that face forward rather
      // than do nothing.
      if (!openInventory) setPanelOpen('inventory', true);
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
      if (openInventory) renderInventory();
    },
    setOpen,
    selectSlot(index) {
      const max = view?.maxSlots ?? 0;
      if (!openInventory || index < 0 || index >= max) return;
      selectedSlot = index;
      renderInventory();
    },
    toggle() {
      setOpen(!anyOpen());
    },
    dispose() {
      if (timer) clearInterval(timer);
      timer = null;
      document.removeEventListener('keydown', onKeyDown);
      inspect.remove();
      sheetTabs.remove();
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
