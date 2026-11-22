/**
 * What the player sees when their plant dies, in the world rather than on the
 * title screen.
 *
 * Death used to send the player straight back to the title: the world they had
 * been tending was replaced by a card before they could see anything. The card
 * now comes up over the place it happened, and its first action is to stay.
 * Spectating is not a mode with its own rules — it is the same world with the
 * plant gone, a free camera and one chip that says how to leave.
 */

import { escapeHtml } from './escape.ts';
import { type PlantStatsSummary, plantStatRows } from './plantStats.ts';

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
  /** Stay in the world. */
  onSpectate: () => void;
  /** Leave the world and offer a new seed. */
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
    background: radial-gradient(120% 90% at 50% 45%, rgba(6, 8, 5, 0.42), rgba(4, 5, 3, 0.74));
    animation: pl-death-in 240ms ease;
    /* The modal UI layer is a pass-through; without this the scrim and both
       buttons inherit pointer-events: none and cannot be clicked. */
    pointer-events: auto;
  }
  .pl-death {
    width: min(420px, 92vw);
    max-height: 86vh;
    overflow-y: auto;
    display: grid;
    gap: 12px;
    padding: 20px;
    border-left: 3px solid var(--ember-500, #c96a3a);
    border-radius: 14px;
    background: linear-gradient(180deg, rgba(26, 22, 17, 0.98), rgba(14, 12, 9, 0.99));
    box-shadow: 0 28px 90px rgba(0, 0, 0, 0.6);
    color: var(--warm-ink, #f0ead6);
  }
  @keyframes pl-death-in { from { opacity: 0; } to { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) {
    .pl-death-scrim { animation: none; }
  }
  .pl-death__title {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: var(--ember-400, #e08a5a);
  }
  .pl-death__reason { margin: 0; font-size: var(--hud-font-sm, 0.8rem); line-height: 1.5; }
  .pl-death__stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
  .pl-death__stat {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 6px 8px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.04);
    font-size: var(--hud-font-xs, 0.7rem);
  }
  .pl-death__stat span { color: var(--ink-dim, #9a937a); }
  .pl-death__stat b { font-weight: 700; }
  .pl-death__row { display: flex; flex-wrap: wrap; gap: 8px; }
  .pl-death__btn {
    flex: 1 1 140px;
    min-height: 44px;
    padding: 10px 16px;
    border: 1px solid rgba(239, 233, 216, 0.18);
    border-radius: 10px;
    background: rgba(42, 52, 30, 0.6);
    color: inherit;
    font: inherit;
    font-size: var(--hud-font-sm, 0.8rem);
    cursor: pointer;
  }
  .pl-death__btn:hover { border-color: var(--leaf-500, #5a902e); }
  .pl-death__btn:focus-visible { outline: 2px solid var(--leaf-300, #c8ff80); outline-offset: 2px; }
  .pl-death__btn--primary {
    background: linear-gradient(180deg, var(--leaf-500, #5a902e), var(--leaf-700, #33601a));
    border-color: var(--leaf-300, #c8ff80);
    color: #0d1408;
    font-weight: 700;
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

/** The stat grid, built from the one owner of those rows. */
export function deathStatRows(input: DeathScreenInput): Array<[string, string]> {
  const words = input.cause.replace(/_/g, ' ').trim();
  const cause = words ? words[0].toUpperCase() + words.slice(1) : words;
  return [['Cause', cause], ...plantStatRows(input.stats)];
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

  const title = document.createElement('h2');
  title.className = 'pl-death__title';
  title.id = 'pl-death-title';
  title.textContent = 'Your plant died';

  const reason = document.createElement('p');
  reason.className = 'pl-death__reason';
  reason.textContent = input.reason;

  const stats = document.createElement('div');
  stats.className = 'pl-death__stats';
  stats.innerHTML = deathStatRows(input)
    .map(
      ([label, value]) =>
        `<div class="pl-death__stat"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`,
    )
    .join('');

  const row = document.createElement('div');
  row.className = 'pl-death__row';
  const spectate = document.createElement('button');
  spectate.className = 'pl-death__btn pl-death__btn--primary';
  spectate.type = 'button';
  spectate.textContent = 'Spectate';
  spectate.addEventListener('click', () => options.onSpectate());
  const reseed = document.createElement('button');
  reseed.className = 'pl-death__btn';
  reseed.type = 'button';
  reseed.textContent = 'New seed';
  reseed.addEventListener('click', () => options.onNewSeed());
  row.append(spectate, reseed);

  card.append(title, reason, stats, row);
  scrim.appendChild(card);
  options.mount.appendChild(scrim);
  // Offering to stay is the point, so the offer gets the focus.
  spectate.focus();

  let open = true;
  // Escape is the primary action, not a dismissal: staying is the safer choice
  // and the chip below still leaves. Capture so the world's Escape order never
  // opens the pause menu behind this card.
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    options.onSpectate();
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
  button.textContent = 'New seed';
  button.addEventListener('click', onNewSeed);
  chip.append(label, button);
  mount.appendChild(chip);
  return { element: chip, destroy: () => chip.remove() };
}
