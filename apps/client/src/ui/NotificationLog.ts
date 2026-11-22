/**
 * C04 notification log: the last few things the game told you.
 *
 * A toast is the live half of a notification and it disappears. Damage, an
 * uproot, a rooting, a refused command: a player who was reading the panel or
 * looking at the HUD had no way back to what the game said. This keeps a bounded
 * history of every toast the shell actually shows, newest first, and lists it
 * with its wall-clock time.
 *
 * It owns no game state. The entry is captured after `UIShell` has decided to
 * show the toast, so suppressing toasts on the death screen also keeps the log
 * quiet, and the log cannot claim a notice the player never got.
 */

export type NotificationKind = 'info' | 'state' | 'error';

export interface LoggedNotification {
  at: number;
  message: string;
  kind: NotificationKind;
}

/** Enough history to cover a long fight without becoming a session dump. */
export const NOTIFICATION_LOG_LIMIT = 80;

/** Newest first, capped. Pure, so the order and the bound are testable. */
export function pushNotification(
  entries: readonly LoggedNotification[],
  entry: LoggedNotification,
  limit = NOTIFICATION_LOG_LIMIT,
): LoggedNotification[] {
  return [entry, ...entries].slice(0, Math.max(0, limit));
}

export interface NotificationLogOptions {
  mount: HTMLElement;
  /** Injectable clock, so a caller can freeze time. */
  now?: () => number;
  limit?: number;
}

export interface NotificationLogAPI {
  readonly element: HTMLElement;
  readonly isOpen: boolean;
  readonly entries: readonly LoggedNotification[];
  open(): void;
  close(): void;
  toggle(): void;
  record(entry: { message: string; kind?: NotificationKind }): void;
  dispose(): void;
}

const STYLE_ID = 'pl-notifications-style';

const STYLE = `
  .pl-notifications-backdrop {
    position: fixed; inset: 0; z-index: 385; display: none;
    place-items: center; padding: 18px;
    background: radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--palette-foliage-900) 66%, transparent), color-mix(in srgb, var(--palette-ink-900) 88%, transparent));
    pointer-events: auto;
  }
  .pl-notifications-backdrop.is-open { display: grid; }
  .pl-notifications {
    width: min(460px, 94vw); max-height: min(70vh, 560px); display: flex; flex-direction: column;
    border-radius: 16px; overflow: hidden; color: var(--bone-200);
    border: 1px solid color-mix(in srgb, var(--palette-foliage-700) 44%, transparent);
    border-top-color: color-mix(in srgb, var(--palette-foliage-300) 40%, transparent);
    background: linear-gradient(168deg, color-mix(in srgb, var(--palette-foliage-900) 98%, transparent), color-mix(in srgb, var(--palette-ink-900) 100%, transparent));
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.64);
    font-family: "Inter", system-ui, sans-serif; font-size: 0.78rem;
  }
  .pl-notifications__head {
    display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
    padding: 14px 48px 12px 16px;
    border-bottom: 1px solid color-mix(in srgb, var(--palette-foliage-700) 28%, transparent);
  }
  .pl-notifications__title {
    margin: 0; color: var(--leaf-300); font-size: 0.82rem;
    letter-spacing: 0.16em; text-transform: uppercase;
  }
  .pl-notifications__sub { color: var(--ink-dim); font-size: 0.7rem; }
  .pl-notifications__close {
    position: absolute; top: 10px; right: 10px;
    width: 30px; height: 30px; display: grid; place-items: center;
    border-radius: 9px; cursor: pointer; font-size: 1.05rem; line-height: 1;
    border: 1px solid color-mix(in srgb, var(--palette-foliage-700) 35%, transparent);
    background: color-mix(in srgb, var(--palette-foliage-900) 80%, transparent);
    color: var(--bone-200); font: inherit;
  }
  .pl-notifications__close:hover { border-color: var(--leaf-400); }
  .pl-notifications__close:focus-visible { outline: 2px solid var(--leaf-300); outline-offset: 2px; }
  .pl-notifications__list { margin: 0; padding: 6px 0; list-style: none; overflow-y: auto; }
  .pl-notifications__row {
    display: grid; grid-template-columns: 3.4rem 1fr; gap: 10px; align-items: baseline;
    padding: 8px 16px;
    border-left: 2px solid transparent;
  }
  .pl-notifications__row + .pl-notifications__row {
    border-top: 1px solid color-mix(in srgb, var(--palette-foliage-700) 16%, transparent);
  }
  .pl-notifications__row.is-state { border-left-color: var(--leaf-400); }
  .pl-notifications__row.is-error { border-left-color: var(--ember-400, #d08a52); }
  .pl-notifications__time { color: var(--ink-dim); font-variant-numeric: tabular-nums; }
  .pl-notifications__message { color: var(--bone-100); overflow-wrap: anywhere; }
  .pl-notifications__empty { padding: 22px 16px; color: var(--ink-muted); }
`;

export function createNotificationLog(options: NotificationLogOptions): NotificationLogAPI {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  const now = options.now ?? (() => Date.now());
  const limit = options.limit ?? NOTIFICATION_LOG_LIMIT;

  const backdrop = document.createElement('div');
  backdrop.className = 'pl-notifications-backdrop';
  backdrop.id = 'notification-log';

  const panel = document.createElement('div');
  panel.className = 'pl-notifications';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'pl-notifications-title');

  const head = document.createElement('div');
  head.className = 'pl-notifications__head';
  const title = document.createElement('h2');
  title.className = 'pl-notifications__title';
  title.id = 'pl-notifications-title';
  title.textContent = 'Recent activity';
  const sub = document.createElement('span');
  sub.className = 'pl-notifications__sub';
  sub.textContent = 'Newest first.';
  head.append(title, sub);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'pl-notifications__close';
  closeButton.setAttribute('aria-label', 'Close recent activity');
  closeButton.textContent = '\u00d7';
  closeButton.addEventListener('click', () => close());

  const list = document.createElement('ol');
  list.className = 'pl-notifications__list';

  panel.append(head, closeButton, list);
  backdrop.appendChild(panel);
  options.mount.appendChild(backdrop);

  let entries: LoggedNotification[] = [];
  let open = false;

  const timeOf = (at: number): string =>
    new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  function render(): void {
    list.innerHTML = '';
    if (entries.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'pl-notifications__empty';
      empty.textContent = 'Nothing yet.';
      list.appendChild(empty);
      return;
    }
    for (const entry of entries) {
      const row = document.createElement('li');
      row.className = `pl-notifications__row is-${entry.kind}`;
      const time = document.createElement('time');
      time.className = 'pl-notifications__time';
      time.dateTime = new Date(entry.at).toISOString();
      time.textContent = timeOf(entry.at);
      const message = document.createElement('span');
      message.className = 'pl-notifications__message';
      message.textContent = entry.message;
      row.append(time, message);
      list.appendChild(row);
    }
  }

  function close(): void {
    if (!open) return;
    open = false;
    backdrop.classList.remove('is-open');
  }

  function show(): void {
    if (open) return;
    open = true;
    render();
    backdrop.classList.add('is-open');
    closeButton.focus();
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!open || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  document.addEventListener('keydown', onKeyDown, true);

  render();

  return {
    element: backdrop,
    get isOpen() {
      return open;
    },
    get entries() {
      return entries;
    },
    open: show,
    close,
    toggle: () => (open ? close() : show()),
    record: (entry) => {
      entries = pushNotification(
        entries,
        { at: now(), message: entry.message, kind: entry.kind ?? 'info' },
        limit,
      );
      if (open) render();
    },
    dispose: () => {
      document.removeEventListener('keydown', onKeyDown, true);
      backdrop.remove();
    },
  };
}
