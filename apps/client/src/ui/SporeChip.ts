/**
 * The spore balance, and the way to get more.
 *
 * A currency the player cannot see is not a currency. The shop panel can show a
 * balance for the duration of one visit; this chip keeps it on screen during
 * play, next to the pouch, with a `+` that opens the shop. The number is the
 * server's (`INVENTORY_SYNC.sporeBalance`), never a local count.
 */

export interface SporeChipOptions {
  mount: HTMLElement;
  /** Open the shop: the `+` is a shortcut to the place spores are spent. */
  onOpenShop: () => void;
}

export interface SporeChipAPI {
  readonly element: HTMLElement;
  setBalance(balance: number): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

const STYLE_ID = 'pl-spore-chip-style';

const STYLE = `
  .pl-spores {
    position: fixed;
    top: calc(var(--hud-corner, 12px) + env(safe-area-inset-top, 0px));
    right: calc(var(--hud-corner, 12px) + env(safe-area-inset-right, 0px));
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 6px 5px 10px;
    border-radius: 999px;
    border: 1px solid rgba(160, 140, 96, 0.45);
    background: rgba(24, 20, 14, 0.82);
    color: var(--bone-100, #f7f4ed);
    font: inherit;
    font-variant-numeric: tabular-nums;
    z-index: 41;
    pointer-events: auto;
  }
  .pl-spores[hidden] { display: none; }
  .pl-spores__mark { color: #cfe68a; font-size: 13px; line-height: 1; }
  .pl-spores__value { min-width: 3ch; text-align: right; }
  .pl-spores__add {
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    border: 1px solid rgba(207, 230, 138, 0.5);
    background: rgba(207, 230, 138, 0.12);
    color: inherit;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
    /* A phone thumb still has to hit it: the visual is small, the target is not. */
    position: relative;
  }
  .pl-spores__add::after {
    content: '';
    position: absolute;
    inset: -9px;
  }
  .pl-spores__add:focus-visible { outline: 2px solid var(--pl-focus, #ffd27a); outline-offset: 2px; }
`;

function installStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}

export function createSporeChip(options: SporeChipOptions): SporeChipAPI {
  installStyles();
  const element = document.createElement('div');
  element.className = 'pl-spores';
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  element.innerHTML =
    '<span class="pl-spores__mark" aria-hidden="true">✦</span>' +
    '<span class="pl-spores__value">0</span>' +
    '<button type="button" class="pl-spores__add" aria-label="Get more spores">+</button>';
  const value = element.querySelector<HTMLElement>('.pl-spores__value');
  const add = element.querySelector<HTMLButtonElement>('.pl-spores__add');
  add?.addEventListener('click', () => options.onOpenShop());
  options.mount.appendChild(element);
  element.hidden = true;

  let balance = 0;
  let shown = 0;
  const paint = (): void => {
    // The role is a polite live region: writing the same text every sync makes a
    // screen reader repeat it, so only a real change touches the DOM.
    if (shown === balance) return;
    shown = balance;
    if (value) value.textContent = String(Math.max(0, Math.round(balance)));
    element.setAttribute('aria-label', `${Math.max(0, Math.round(balance))} spores`);
  };
  paint();

  return {
    element,
    setBalance(next) {
      balance = Number.isFinite(next) ? next : 0;
      paint();
    },
    setVisible(visible) {
      element.hidden = !visible;
    },
    destroy() {
      element.remove();
    },
  };
}
