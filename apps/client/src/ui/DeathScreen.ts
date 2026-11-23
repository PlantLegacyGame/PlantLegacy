/**
 * What the player sees when their plant dies, in the world rather than on the
 * title screen.
 *
 * Death used to send the player straight back to the title: the world they had
 * been tending was replaced by a card before they could see anything. The card
 * now comes up over the place it happened, and its first action is to grow
 * again in that world - not to leave it. The server starts the new seed on the
 * same socket, so the camera, the pouch and the player's identity survive.
 * Spectating is not a mode with its own rules - it is the same world with the
 * plant gone, a free camera and one chip that says how to leave.
 *
 * The numbers are the death record's, not the live panel's. Half of the inspect
 * panel is meaningless once the plant is gone anyway: water shows `0 / 0`,
 * health is always zero, and a growth rate sampled a second before death says
 * nothing. What is worth knowing is what it was and how long it lasted.
 */

import { escapeHtml } from './escape.ts';
import {
  formatAge,
  formatCount,
  formatDecimal,
  formatRate,
  type PlantStatsSummary,
} from './plantStats.ts';

export interface DeathScreenInput {
  /** Machine cause, e.g. `dehydration`. */
  cause: string;
  /** The named thing that did it, when the server knows. */
  source?: string;
  stats: PlantStatsSummary;
  /** Human sentence, from the same describer the title card uses. */
  reason: string;
}

export interface DeathScreenOptions {
  mount: HTMLElement;
  /** Stay in the world with no plant. */
  onSpectate: () => void;
  /** Ask the server for a fresh seed here, without leaving the world. */
  onNewSeed: () => void;
}

export interface DeathScreen {
  element: HTMLElement;
  destroy(): void;
  /** Keep the card open until an explicit choice; no timeout, no auto-dismiss. */
  readonly isOpen: boolean;
}

const STYLE_ID = 'pl-death-style';
const STYLE = `
  .pl-death-scrim {
    position: fixed;
    inset: 0;
    z-index: 396;
    display: grid;
    place-items: center;
    padding: 18px;
    background: radial-gradient(120% 90% at 50% 45%, rgba(6, 8, 5, 0.42), rgba(4, 5, 3, 0.78));
    animation: pl-death-in 240ms ease;
    /* The modal UI layer is a pass-through; without this the scrim and both
       buttons inherit pointer-events: none and cannot be clicked. */
    pointer-events: auto;
  }
  .pl-death {
    width: min(520px, 94vw);
    max-height: 88vh;
    overflow-y: auto;
    display: grid;
    gap: 16px;
    padding: 22px 24px 20px;
    border: 1px solid color-mix(in srgb, var(--ember-500, #c96a3a) 30%, transparent);
    border-left: 4px solid var(--ember-500, #c96a3a);
    border-radius: 16px;
    background: linear-gradient(180deg, rgba(26, 22, 17, 0.985), rgba(13, 11, 8, 0.995));
    box-shadow: 0 32px 100px rgba(0, 0, 0, 0.66);
    color: var(--warm-ink, #f0ead6);
  }
  @keyframes pl-death-in { from { opacity: 0; } to { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) {
    .pl-death-scrim { animation: none; }
  }
  .pl-death__eyebrow {
    margin: 0;
    font-size: var(--hud-font-xs, 0.66rem);
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--ember-400, #e08a5a) 80%, transparent);
  }
  .pl-death__title {
    margin: 0;
    font-size: 1.45rem;
    line-height: 1.15;
    font-weight: 700;
    letter-spacing: 0.01em;
    color: var(--warm-ink, #f0ead6);
  }
  .pl-death__reason {
    margin: 0;
    font-size: var(--hud-font-sm, 0.84rem);
    line-height: 1.55;
    color: var(--bone-300, #cfc8b2);
  }
  .pl-death__rule {
    height: 1px;
    background: linear-gradient(90deg, color-mix(in srgb, var(--ember-500, #c96a3a) 40%, transparent), transparent);
  }
  .pl-death__stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));
    gap: 8px;
  }
  .pl-death__stat {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 8px 10px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.045);
    border: 1px solid rgba(255, 255, 255, 0.05);
  }
  .pl-death__stat span {
    font-size: var(--hud-font-xs, 0.64rem);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-dim, #9a937a);
  }
  .pl-death__stat b {
    font-size: 0.98rem;
    font-weight: 700;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
  }
  .pl-death__note {
    margin: 0;
    font-size: var(--hud-font-xs, 0.68rem);
    line-height: 1.5;
    color: var(--ink-dim, #9a937a);
  }
  .pl-death__row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 2px;
  }
  .pl-death__btn {
    flex: 1 1 160px;
    min-height: 46px;
    padding: 11px 16px;
    border: 1px solid rgba(239, 233, 216, 0.18);
    border-radius: 11px;
    background: rgba(42, 52, 30, 0.6);
    color: inherit;
    font: inherit;
    font-size: var(--hud-font-sm, 0.82rem);
    cursor: pointer;
    transition: border-color 140ms ease, background 140ms ease;
  }
  .pl-death__btn:hover { border-color: var(--leaf-500, #5a902e); }
  .pl-death__btn:focus-visible { outline: 2px solid var(--leaf-300, #c8ff80); outline-offset: 2px; }
  .pl-death__btn small {
    display: block;
    margin-top: 2px;
    font-size: var(--hud-font-xs, 0.66rem);
    font-weight: 400;
    letter-spacing: 0.02em;
    opacity: 0.72;
  }
  .pl-death__btn--primary {
    background: linear-gradient(180deg, var(--leaf-500, #5a902e), var(--leaf-700, #33601a));
    border-color: var(--leaf-300, #c8ff80);
    color: #0d1408;
    font-weight: 700;
  }
  .pl-death__btn--primary small { opacity: 0.85; }
  @media (max-width: 420px) {
    .pl-death { padding: 18px; gap: 14px; }
    .pl-death__btn { flex-basis: 100%; }
  }
  .pl-spectate-chip {
    position: fixed;
    top: calc(14px + env(safe-area-inset-top));
    left: 50%;
    transform: translateX(-50%);
    z-index: 213;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 12px;
    border: 1px solid var(--hud-border, rgba(239, 233, 216, 0.18));
    border-radius: 999px;
    background: rgba(12, 15, 9, 0.92);
    color: var(--bone-200, #e8e2cf);
    font-size: var(--hud-font-sm, 0.76rem);
    letter-spacing: 0.04em;
  }
  .pl-spectate-chip__btn {
    min-height: 30px;
    padding: 4px 12px;
    border: 1px solid rgba(239, 233, 216, 0.22);
    border-radius: 999px;
    background: rgba(42, 52, 30, 0.7);
    color: inherit;
    font: inherit;
    font-size: inherit;
    cursor: pointer;
  }
  .pl-spectate-chip__btn:hover { border-color: var(--leaf-500, #5a902e); }
`;

function installStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}

function words(token: string): string {
  const text = token.replace(/_/g, ' ').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/**
 * What the server's `killedBy` tokens mean in a sentence.
 *
 * These are the coarse causes the death record splits itself into; a token the
 * table does not know stays readable through `words()` rather than being
 * dropped, so a new source cannot vanish from the card.
 */
const KILLED_BY: Record<string, string> = {
  tool: 'Another plant’s tool',
  weather: 'The weather',
  uprooted: 'Torn loose from the soil',
  thirst: 'No water left',
  minerals: 'No minerals left',
  no_energy: 'No energy left',
  starvation: 'The stores ran out',
};

/**
 * The death card's rows, in the order they are read.
 *
 * Deliberately not `plantStatRows`: the live panel's water, minerals, energy and
 * growth-rate rows describe a running plant. On a dead one they print `0 / 0`
 * and a rate from the last second of life, which reads as wrong numbers rather
 * than as history. Biomass and node counts are the death record's own (the
 * client passes them in), so they are current to the moment it died.
 */
export function deathStatRows(input: DeathScreenInput): Array<[string, string]> {
  const stats: PlantStatsSummary = input.stats;
  const rows: Array<[string, string]> = [['Cause', words(input.cause)]];
  if (input.source) {
    rows.push(['Killed by', KILLED_BY[input.source] ?? words(input.source)]);
  }
  rows.push(['Age', formatAge(stats.ageSeconds)]);
  rows.push(['Died on', `Day ${formatCount(stats.dayNumber)} · ${stats.clock}`]);
  rows.push(['Biomass', formatDecimal(stats.biomass)]);
  rows.push(['Peak biomass', formatDecimal(stats.peakBiomass)]);
  rows.push(['Nodes', formatCount(stats.nodeCount)]);
  rows.push(['Peak nodes', formatCount(stats.peakNodeCount)]);
  if (stats.mutationCount > 0) {
    const energy = stats.mutationEnergyUpkeepPerSecond ?? stats.mutationUpkeepPerSecond;
    const biomass = stats.mutationBiomassUpkeepPerSecond ?? 0;
    rows.push([
      'Mutations',
      `${formatCount(stats.mutationCount)} · ${formatRate(energy)} E/s · ${formatRate(biomass)} B/s`,
    ]);
  }
  return rows;
}

export function createDeathScreen(
  input: DeathScreenInput,
  options: DeathScreenOptions,
): DeathScreen {
  installStyles();
  const scrim = document.createElement('div');
  scrim.className = 'pl-death-scrim';

  const card = document.createElement('div');
  card.className = 'pl-death';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'pl-death-title');

  const eyebrow = document.createElement('p');
  eyebrow.className = 'pl-death__eyebrow';
  eyebrow.textContent = 'Life ended';

  const title = document.createElement('h2');
  title.className = 'pl-death__title';
  title.id = 'pl-death-title';
  title.textContent = 'Your plant died';

  const reason = document.createElement('p');
  reason.className = 'pl-death__reason';
  reason.textContent = input.reason;

  const rule = document.createElement('div');
  rule.className = 'pl-death__rule';

  const stats = document.createElement('div');
  stats.className = 'pl-death__stats';
  stats.innerHTML = deathStatRows(input)
    .map(
      ([label, value]) =>
        `<div class="pl-death__stat"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`,
    )
    .join('');

  const note = document.createElement('p');
  note.className = 'pl-death__note';
  note.textContent = 'A new seed starts with no mutations. The soil keeps what it took.';

  const row = document.createElement('div');
  row.className = 'pl-death__row';
  const reseed = document.createElement('button');
  reseed.className = 'pl-death__btn pl-death__btn--primary';
  reseed.type = 'button';
  reseed.innerHTML = 'Grow a new seed<small>stay in this world</small>';
  reseed.addEventListener('click', () => options.onNewSeed());
  const spectate = document.createElement('button');
  spectate.className = 'pl-death__btn';
  spectate.type = 'button';
  spectate.textContent = 'Spectate';
  spectate.addEventListener('click', () => options.onSpectate());
  row.append(reseed, spectate);

  card.append(eyebrow, title, reason, rule, stats, note, row);
  scrim.appendChild(card);
  options.mount.appendChild(scrim);
  // Growing again is the action most players want, so it holds the focus.
  reseed.focus();

  let open = true;
  // Escape is the primary action, as it is on every other card: the focused
  // button and the key do the same thing. Spectating is still one click away.
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    options.onNewSeed();
  };
  window.addEventListener('keydown', onKey, true);

  return {
    element: scrim,
    get isOpen() {
      return open;
    },
    destroy: () => {
      open = false;
      window.removeEventListener('keydown', onKey, true);
      scrim.remove();
    },
  };
}

export interface SpectateChip {
  element: HTMLElement;
  destroy(): void;
}

/** The one control that leaves spectating, so the world is never a trap. */
export function createSpectateChip(mount: HTMLElement, onNewSeed: () => void): SpectateChip {
  installStyles();
  const chip = document.createElement('div');
  chip.className = 'pl-spectate-chip';
  chip.setAttribute('role', 'status');
  const label = document.createElement('span');
  label.textContent = 'Spectating';
  const button = document.createElement('button');
  button.className = 'pl-spectate-chip__btn';
  button.type = 'button';
  button.textContent = 'Grow a new seed';
  button.addEventListener('click', onNewSeed);
  chip.append(label, button);
  mount.appendChild(chip);
  return { element: chip, destroy: () => chip.remove() };
}
