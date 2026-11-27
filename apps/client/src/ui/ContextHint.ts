/**
 * Contextual hints: one line, when it is relevant, then it gets out of the way.
 *
 * The old hint card was a permanent three-line key list that a player had to
 * dismiss with H, and it never said anything about what they were doing. This is
 * the other model: the game says the next useful thing once ("Click a node to
 * grow"), the player does it, and the hint stops. A hint that has been seen is
 * not shown again in the same session unless the caller asks for a repeat.
 */

export interface ContextHintRequest {
  /** Dedupe key. Two requests with the same id count as the same hint. */
  id: string;
  text: string;
  /**
   * The same hint for a pane driven by fingers. A key badge is a lie on a phone:
   * there is no G to press, and "click" names a device the player is not using.
   * When omitted the hint is shown as written, with its badge suppressed.
   */
  touchText?: string;
  /** Key that dismisses or triggers it, shown as a badge on a pointer device. */
  key?: string;
  /** Show it even if it was already seen this session. */
  repeat?: boolean;
  /** How long it stays up when the caller does not queue another one. */
  durationMs?: number;
}

export interface ContextHintOptions {
  mount: HTMLElement;
  durationMs?: number;
  /** Reduced motion: no slide, just a fade. */
  reducedMotion?: boolean;
}

export interface ContextHintAPI {
  readonly element: HTMLElement;
  show(hint: ContextHintRequest): void;
  hide(): void;
  /** True while a hint is on screen: H closes the one it can see. */
  isVisible(): boolean;
  /** H: hints off means nothing appears until turned back on. */
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  /** Hints already shown this session, for the on-demand list. */
  seen(): string[];
  destroy(): void;
}

const STYLE = `
  /* A line of help, not a panel. It was a bordered capsule with a gradient and a
     shadow, floating over the soil above the old button row: the same box, the
     same weight and the same place as the interface it was describing, so the
     screen read as one layer of chrome stacked on another (play-test
     2026-11-26). It is a sibling of the world now - small type, a soft scrim under
     the words so it stays readable over soil - and it never draws a container.
     The bar offset is the hotbar's own height plus its inset, so the line
     clears the slots however many of them are there. */
  .pl-context-hint {
    position: fixed;
    left: 50%;
    bottom: calc(var(--pl-bar-offset, 62px) + 20px + env(safe-area-inset-bottom, 0px));
    transform: translateX(-50%) translateY(6px);
    z-index: 212;
    display: flex;
    align-items: center;
    gap: 7px;
    max-width: min(460px, calc(var(--pl-hud-vw, 100vw) - 2 * var(--hud-corner)));
    padding: 2px 16px;
    box-sizing: border-box;
    background: radial-gradient(115% 150% at 50% 50%, rgba(6, 9, 5, 0.5), rgba(6, 9, 5, 0.18) 62%, rgba(6, 9, 5, 0));
    color: var(--bone-100, #f2ead6);
    font-size: var(--hud-font-sm);
    line-height: 1.45;
    letter-spacing: 0.01em;
    text-align: center;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.72);
    opacity: 0;
    pointer-events: none;
    transition: opacity 180ms ease, transform 220ms cubic-bezier(0.22, 0.9, 0.3, 1);
  }
  .pl-context-hint.is-visible { opacity: 1; transform: translateX(-50%) translateY(0); }
  .pl-context-hint__key {
    flex: none;
    min-width: 18px;
    padding: 0 5px;
    border-radius: 4px;
    border: 1px solid rgba(239, 233, 216, 0.2);
    background: rgba(8, 11, 6, 0.5);
    color: var(--bone-200);
    font-size: var(--hud-font-xs);
    line-height: 15px;
    text-align: center;
    text-shadow: none;
  }
  /* A finger has no keyboard, so the key badge is not drawn at all - not hidden
     per hint, so a hint that forgets to pass touchText still cannot promise a key
     that is not there. */
  @media (hover: none) and (pointer: coarse) {
    .pl-context-hint__key { display: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .pl-context-hint { transform: none; transition: opacity 140ms ease; }
    .pl-context-hint.is-visible { transform: none; }
  }
`;

export function createContextHint(options: ContextHintOptions): ContextHintAPI {
  if (!document.getElementById('pl-context-hint-style')) {
    const style = document.createElement('style');
    style.id = 'pl-context-hint-style';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  const el = document.createElement('div');
  el.className = 'pl-context-hint';
  el.id = 'context-hint';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');

  const keyEl = document.createElement('kbd');
  keyEl.className = 'pl-context-hint__key';
  const textEl = document.createElement('span');
  el.append(keyEl, textEl);
  options.mount.appendChild(el);

  // Same query the stylesheet uses for its finger layout. Read here as well so the
  // copy can change with the device instead of naming keys a phone does not have.
  const fingerQuery =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(hover: none) and (pointer: coarse)')
      : null;
  const fingerLayout = (): boolean => fingerQuery?.matches ?? false;

  const seen = new Set<string>();
  const defaultDuration = Math.max(1200, options.durationMs ?? 5200);
  let enabled = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let currentId: string | null = null;

  const hide = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    currentId = null;
    el.classList.remove('is-visible');
  };

  return {
    element: el,
    show: (hint) => {
      if (!enabled) return;
      if (!hint.repeat && seen.has(hint.id)) return;
      seen.add(hint.id);
      // Re-showing the hint that is already up must not restart its fade.
      if (currentId === hint.id && el.classList.contains('is-visible')) return;
      currentId = hint.id;
      const fingers = fingerLayout();
      textEl.textContent = fingers && hint.touchText ? hint.touchText : hint.text;
      if (hint.key && !fingers) {
        keyEl.textContent = hint.key;
        keyEl.style.display = '';
      } else {
        keyEl.style.display = 'none';
      }
      el.classList.add('is-visible');
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(hide, Math.max(1200, hint.durationMs ?? defaultDuration));
    },
    hide,
    isVisible: () => el.classList.contains('is-visible'),
    setEnabled: (next) => {
      enabled = next;
      if (!next) hide();
    },
    isEnabled: () => enabled,
    seen: () => [...seen],
    destroy: () => {
      if (timer !== null) clearTimeout(timer);
      el.remove();
    },
  };
}
