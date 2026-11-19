/**
 * The shop surface.
 *
 * Same panel from the title screen and from in game, because a shop that looks
 * different depending on where it was opened is two shops. What it sells comes
 * from `config/shop.json`; nothing here knows a price or an item name, so adding
 * stock is a config edit.
 *
 * There is no currency yet: `shop_currency_name` is empty, so the balance row is
 * hidden rather than showing a number the game cannot back. Buying is refused
 * until a caller supplies `onBuy`, which keeps the button honest.
 */

import { escapeHtml } from './escape.ts';

export interface ShopItemView {
  id: string;
  name: string;
  description?: string;
  price: number;
  /** Optional glyph or emoji used as the item mark. */
  icon?: string;
}

export interface ShopSectionView {
  id: string;
  label: string;
  items: ShopItemView[];
}

export interface ShopConfigView {
  enabled: boolean;
  title: string;
  currencyName: string;
  sections: ShopSectionView[];
}

export interface ShopPanelOptions {
  config: ShopConfigView;
  mount: HTMLElement;
  /** Balance of `currencyName`, when the game has one. */
  balance?: number | null;
  /** Called with the item id. Without it, buy buttons stay disabled. */
  onBuy?: (itemId: string) => void;
  onClose: () => void;
}

export interface ShopPanel {
  element: HTMLElement;
  destroy(): void;
}

const STYLE_ID = 'pl-shop-style';

const STYLE = `
  .pl-shop-scrim {
    position: absolute;
    inset: 0;
    background: rgba(6, 9, 6, 0.6);
    backdrop-filter: blur(2px);
    display: grid;
    place-items: center;
    padding: 16px;
    z-index: 5;
    /* The scrim is mounted in a UI layer, and layers are pointer-events: none so
       the world stays draggable. Without this opt-in every click (the corner X,
       the tabs, Buy) fell through to the canvas underneath. */
    pointer-events: auto;
  }
  .pl-shop {
    position: relative;
    width: min(720px, 100%);
    max-height: min(86vh, 680px);
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 12px;
    background: linear-gradient(180deg, rgba(20, 26, 18, 0.99) 0%, rgba(12, 17, 11, 0.99) 100%);
    border: 2px solid var(--hud-border, rgba(94, 122, 53, 0.35));
    border-radius: 18px;
    box-shadow: var(--hud-shadow);
    padding: 18px;
    color: var(--warm-ink, #f0ead6);
    overflow: hidden;
  }
  @keyframes pl-shop-in {
    from { opacity: 0; transform: translateY(10px) scale(0.985); }
    to { opacity: 1; transform: none; }
  }
  .pl-shop { animation: pl-shop-in 200ms cubic-bezier(0.22, 0.9, 0.3, 1); }
  @media (prefers-reduced-motion: reduce) {
    .pl-shop { animation: none; }
  }
  .pl-shop__head {
    display: flex; align-items: baseline; gap: 12px;
    padding-right: 46px; /* room for the corner close at every width */
    border-bottom: 1px solid rgba(94, 122, 53, 0.22);
    padding-bottom: 12px;
  }
  .pl-shop__title { margin: 0; font-size: 1.2rem; letter-spacing: 0.02em; }
  .pl-shop__balance {
    margin-left: auto;
    font-size: 0.82rem;
    color: var(--sprout-200, #dcf0a0);
    font-variant-numeric: tabular-nums;
  }
  /* Corner close, same shape and behaviour as the settings panel's. */
  .pl-shop__close {
    position: absolute; top: 14px; right: 14px;
    display: grid; place-items: center;
    background: rgba(10, 14, 10, 0.8);
    border: 2px solid var(--hud-border, rgba(94, 122, 53, 0.35));
    color: var(--bone-200, #efe9d8);
    border-radius: 11px;
    width: 34px; height: 34px;
    font-size: 1.05rem;
    cursor: pointer;
    font: inherit;
    line-height: 1;
    transition: background 140ms ease, border-color 140ms ease, transform 140ms ease;
  }
  .pl-shop__close:hover {
    border-color: var(--leaf-500, #7db83d);
    background: rgba(90, 144, 46, 0.28);
  }
  .pl-shop__close:active { transform: scale(0.94); }
  .pl-shop__close:focus-visible { outline: 2px solid var(--leaf-300, #c8ff80); outline-offset: 2px; }
  .pl-shop__empty {
    grid-column: 1 / -1;
    margin: 0; padding: 28px 12px;
    text-align: center;
    color: var(--ink-dim, #9a937a);
    border: 1px dashed rgba(94, 122, 53, 0.28);
    border-radius: 14px;
  }
  .pl-shop__tabs { display: flex; gap: 8px; flex-wrap: wrap; }
  .pl-shop__tab {
    font: inherit; font-size: 0.78rem;
    padding: 7px 12px;
    border-radius: 999px;
    border: 2px solid var(--hud-border-muted, rgba(50, 58, 40, 0.5));
    background: rgba(8, 11, 8, 0.7);
    color: var(--ink-muted, #c9c2ad);
    cursor: pointer;
  }
  .pl-shop__tab[aria-selected="true"] {
    border-color: var(--leaf-400, #9ed95c);
    color: var(--bone-100, #f7f4ed);
  }
  .pl-shop__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 10px;
    overflow: auto;
    padding: 2px;
  }
  .pl-shop__item {
    display: flex; flex-direction: column; gap: 6px;
    background: rgba(8, 11, 8, 0.6);
    border: 2px solid var(--hud-border-muted, rgba(50, 58, 40, 0.5));
    border-radius: 12px;
    padding: 12px;
  }
  .pl-shop__item-mark {
    width: 44px; height: 44px; border-radius: 10px;
    display: grid; place-items: center;
    background: rgba(94, 122, 53, 0.12);
    font-size: 1.3rem;
  }
  .pl-shop__item-name { font-size: 0.88rem; font-weight: 600; }
  .pl-shop__item-desc { font-size: 0.74rem; color: var(--ink-muted, #c9c2ad); line-height: 1.45; }
  .pl-shop__item-buy {
    margin-top: auto;
    font: inherit; font-size: 0.8rem; font-weight: 600;
    padding: 9px 12px;
    border-radius: 10px;
    border: 2px solid transparent;
    background: linear-gradient(180deg, var(--leaf-500, #7db83d) 0%, var(--leaf-700, #426520) 100%);
    color: #0d1408;
    cursor: pointer;
    min-height: 40px;
  }
  .pl-shop__item-buy:disabled,
  .pl-shop__item-buy[aria-disabled='true'] { filter: grayscale(0.6) brightness(0.75); cursor: default; }
`;

function installStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}

export function createShopPanel(options: ShopPanelOptions): ShopPanel {
  installStyles();

  const scrim = document.createElement('div');
  scrim.className = 'pl-shop-scrim';
  scrim.addEventListener('pointerdown', (event) => {
    if (event.target === scrim) options.onClose();
  });

  const panel = document.createElement('div');
  panel.className = 'pl-shop';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', options.config.title);
  scrim.appendChild(panel);

  const head = document.createElement('div');
  head.className = 'pl-shop__head';
  const heading = document.createElement('h2');
  heading.className = 'pl-shop__title';
  heading.textContent = options.config.title;
  head.appendChild(heading);

  if (options.config.currencyName && typeof options.balance === 'number') {
    const balance = document.createElement('div');
    balance.className = 'pl-shop__balance';
    balance.textContent = `${options.balance} ${options.config.currencyName}`;
    head.appendChild(balance);
  }

  const close = document.createElement('button');
  close.className = 'pl-shop__close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '\u00d7';
  close.addEventListener('click', () => options.onClose());
  head.appendChild(close);
  panel.appendChild(head);

  const body = document.createElement('div');
  body.className = 'pl-shop__grid';
  panel.appendChild(body);

  const renderSection = (section: ShopSectionView | null): void => {
    body.replaceChildren();
    if (!section || section.items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'pl-shop__empty';
      empty.textContent = 'Nothing for sale yet.';
      body.appendChild(empty);
      return;
    }
    for (const item of section.items) {
      const card = document.createElement('div');
      card.className = 'pl-shop__item';
      card.innerHTML = `
        <div class="pl-shop__item-mark">${escapeHtml(item.icon ?? '\u25c8')}</div>
        <div class="pl-shop__item-name">${escapeHtml(item.name)}</div>
        ${item.description ? `<div class="pl-shop__item-desc">${escapeHtml(item.description)}</div>` : ''}
      `;
      const buy = document.createElement('button');
      buy.className = 'pl-shop__item-buy';
      buy.type = 'button';
      const priceLabel = options.config.currencyName
        ? `${item.price} ${options.config.currencyName}`
        : String(item.price);
      buy.textContent = `Buy \u00b7 ${priceLabel}`;
      if (options.onBuy) {
        buy.addEventListener('click', () => options.onBuy?.(item.id));
      } else {
        // Focusable and announced, not silently dead: a `disabled` button is
        // skipped by the keyboard and by screen readers, so the reason would
        // never reach anyone who did not hover it with a mouse.
        buy.setAttribute('aria-disabled', 'true');
        buy.title = 'Purchases are not open yet';
      }
      card.appendChild(buy);
      body.appendChild(card);
    }
  };

  if (options.config.sections.length > 1) {
    const tabs = document.createElement('div');
    tabs.className = 'pl-shop__tabs';
    const buttons: HTMLButtonElement[] = [];
    options.config.sections.forEach((section, index) => {
      const tab = document.createElement('button');
      tab.className = 'pl-shop__tab';
      tab.type = 'button';
      tab.textContent = section.label;
      tab.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
      tab.addEventListener('click', () => {
        for (const other of buttons) other.setAttribute('aria-selected', 'false');
        tab.setAttribute('aria-selected', 'true');
        renderSection(section);
      });
      buttons.push(tab);
      tabs.appendChild(tab);
    });
    panel.insertBefore(tabs, body);
  }

  renderSection(options.config.sections[0] ?? null);
  options.mount.appendChild(scrim);

  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    options.onClose();
  };
  window.addEventListener('keydown', onKey, true);

  return {
    element: scrim,
    destroy(): void {
      window.removeEventListener('keydown', onKey, true);
      scrim.remove();
    },
  };
}
