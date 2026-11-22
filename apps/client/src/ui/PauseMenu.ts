/**
 * The pause menu, on Escape.
 *
 * Escape in the world only did things when something was already open (cancel a
 * growth aim, close a panel), so the standard "Esc opens a menu" reflex had
 * nowhere to land and there was no way back to the title from inside the game.
 * This is that menu: resume, settings, controls, and leaving the world.
 */

export interface PauseMenuOptions {
  mount: HTMLElement;
  onResume: () => void;
  onSettings: () => void;
  onControls: () => void;
  onLeaveToTitle: () => void;
}

export interface PauseMenuAPI {
  readonly element: HTMLElement;
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  destroy(): void;
}

const STYLE = `
  .pl-pause-backdrop {
    position: fixed;
    inset: 0;
    z-index: 390;
    display: none;
    place-items: center;
    padding: 18px;
    background: radial-gradient(circle at 50% 42%, rgba(8, 11, 6, 0.66), rgba(4, 6, 3, 0.88));
    pointer-events: auto;
  }
  .pl-pause-backdrop.is-open { display: grid; }
  .pl-pause {
    position: relative;
    width: min(360px, 100%);
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px;
    box-sizing: border-box;
    border: 1px solid rgba(126, 154, 74, 0.44);
    border-radius: 16px;
    background: linear-gradient(168deg, rgba(30, 36, 21, 0.98), rgba(14, 17, 10, 1));
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.64);
    color: var(--bone-200);
    animation: pl-pause-in 180ms cubic-bezier(0.22, 0.9, 0.3, 1);
  }
  @keyframes pl-pause-in {
    from { opacity: 0; transform: translateY(8px) scale(0.985); }
    to { opacity: 1; transform: none; }
  }
  .pl-pause__title {
    margin: 0 0 4px;
    font-size: 0.82rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--leaf-300);
  }
  .pl-pause__btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    /* A menu is the one place the target floor matters on every device: four rows
       in the middle of the screen, and a miss hits nothing. 44px, same as a touch
       target, because a mouse pointer is not an excuse for a 39px row. */
    min-height: 44px;
    padding: 11px 13px;
    border: 1px solid rgba(126, 154, 74, 0.3);
    border-radius: 10px;
    background: rgba(48, 58, 34, 0.6);
    color: var(--bone-100);
    font: inherit;
    font-size: var(--hud-font-sm);
    text-align: left;
    cursor: pointer;
    transition: background 140ms ease, border-color 140ms ease;
  }
  .pl-pause__btn:hover { background: rgba(90, 144, 46, 0.28); border-color: var(--leaf-500); }
  .pl-pause__btn:focus-visible { outline: 2px solid var(--leaf-300); outline-offset: 2px; }
  .pl-pause__btn--quiet { background: transparent; color: var(--ink-muted); }
  .pl-pause__key {
    min-width: 18px;
    padding: 0 5px;
    border-radius: 5px;
    border: 1px solid rgba(239, 233, 216, 0.22);
    background: rgba(8, 11, 6, 0.55);
    color: var(--bone-300);
    font-size: var(--hud-font-xs);
    line-height: 16px;
    text-align: center;
  }
  /* The same rule as the action bar: a key badge is a promise of a keyboard, and
     a phone has none. The rows keep their 44px targets, they just stop naming Esc. */
  @media (hover: none) and (pointer: coarse) {
    .pl-pause__key { display: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .pl-pause { animation: none; }
  }
`;

export function createPauseMenu(options: PauseMenuOptions): PauseMenuAPI {
  if (!document.getElementById('pl-pause-style')) {
    const style = document.createElement('style');
    style.id = 'pl-pause-style';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  const backdrop = document.createElement('div');
  backdrop.className = 'pl-pause-backdrop';
  backdrop.id = 'pause-menu';

  const card = document.createElement('div');
  card.className = 'pl-pause';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'pl-pause-title');
  card.tabIndex = -1;

  const title = document.createElement('h2');
  title.className = 'pl-pause__title';
  title.id = 'pl-pause-title';
  title.textContent = 'Paused';

  const button = (
    label: string,
    key: string | null,
    onClick: () => void,
    extraClass = '',
  ): HTMLButtonElement => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `pl-pause__btn${extraClass ? ` ${extraClass}` : ''}`;
    const text = document.createElement('span');
    text.textContent = label;
    el.appendChild(text);
    if (key) {
      const badge = document.createElement('kbd');
      badge.className = 'pl-pause__key';
      badge.textContent = key;
      el.appendChild(badge);
    }
    el.addEventListener('click', onClick);
    return el;
  };

  const resume = button('Resume', 'Esc', () => close());
  const settings = button('Settings', null, () => {
    close();
    options.onSettings();
  });
  const controls = button('Controls', null, () => {
    close();
    options.onControls();
  });
  const leave = button(
    'Leave to title',
    null,
    () => {
      close();
      options.onLeaveToTitle();
    },
    'pl-pause__btn--quiet',
  );

  card.append(title, resume, settings, controls, leave);
  backdrop.appendChild(card);
  options.mount.appendChild(backdrop);

  let open = false;
  let restoreFocus: HTMLElement | null = null;

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    // Keep Tab inside the card: the world behind it is not reachable while the
    // menu is open, and walking out of a modal dialog is a trap for keyboard and
    // screen-reader players.
    if (event.key === 'Tab') {
      const focusable = [resume, settings, controls, leave];
      const index = focusable.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.shiftKey ? -1 : 1;
      const next = focusable[(index + step + focusable.length) % focusable.length];
      event.preventDefault();
      next.focus();
    }
  };

  function close(): void {
    if (!open) return;
    open = false;
    backdrop.classList.remove('is-open');
    restoreFocus?.focus?.();
    restoreFocus = null;
    // If the focus was on one of our own buttons (Resume), the hidden card must
    // not keep it: a focused button is what Space and Enter activate, so the next
    // in-game key press would press Resume again and reopen the menu.
    const active = document.activeElement;
    if (active instanceof HTMLElement && backdrop.contains(active)) active.blur();
  }

  document.addEventListener('keydown', onKeyDown, true);

  return {
    element: backdrop,
    open: () => {
      if (open) return;
      open = true;
      restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      backdrop.classList.add('is-open');
      resume.focus();
    },
    close,
    get isOpen() {
      return open;
    },
    destroy: () => {
      document.removeEventListener('keydown', onKeyDown, true);
      backdrop.remove();
    },
  };
}
