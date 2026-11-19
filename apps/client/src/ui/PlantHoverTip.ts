/**
 * The hover tip that names a plant part and what a click on it does.
 *
 * The core verb used to have one door and no sign: growth is armed with G and
 * then started by clicking a *part* of the plant, and nothing on screen said so.
 * A mouse player who rests the pointer on the plant now reads the part's name and
 * the action that applies to it, so the verb is taught where it is used.
 *
 * The wording is a pure function of the state, so it can be tested without a
 * renderer: `plantHoverText` decides, this module draws.
 */

export interface HoverTargetInput {
  /** Server node type, e.g. `stem`, `leaf`, `root`. Empty when unknown. */
  nodeType: string;
  /** True when the part belongs to the player's own plant. */
  isOwnPlant: boolean;
  /** True when grow mode is armed, so a click opens the growth options. */
  growMode: boolean;
  /** True when the part can actually grow something (root outside root sight cannot). */
  canGrow: boolean;
}

export interface HoverText {
  /** The part, in the game's own words. */
  title: string;
  /** What a click does here, or the key that changes it. */
  action: string;
}

/** `lateral_root` -> `lateral root`, `stem` -> `Stem`. */
export function partLabel(nodeType: string): string {
  const words = nodeType.replace(/_/g, ' ').trim();
  if (words === '') return 'Part';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function plantHoverText(input: HoverTargetInput): HoverText {
  const title = partLabel(input.nodeType);
  if (!input.isOwnPlant) return { title: 'Another plant', action: 'Click to look' };
  if (input.growMode) {
    return input.canGrow
      ? { title, action: 'Click to see what it can grow' }
      : { title, action: 'Nothing can grow from here yet' };
  }
  return { title, action: 'G \u2014 grow mode' };
}

/**
 * Where the tip sits for a pointer at (x, y): below and right of the pointer,
 * flipped to the other side when it would leave the viewport.
 */
export function hoverTipPosition(
  x: number,
  y: number,
  tipWidth: number,
  tipHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  margin = 12,
): { left: number; top: number } {
  const left = x + margin + tipWidth > viewportWidth ? x - margin - tipWidth : x + margin;
  const top = y + margin + tipHeight > viewportHeight ? y - margin - tipHeight : y + margin;
  return {
    left: Math.max(margin, Math.min(left, viewportWidth - tipWidth - margin)),
    top: Math.max(margin, Math.min(top, viewportHeight - tipHeight - margin)),
  };
}

export interface PlantHoverTip {
  readonly element: HTMLElement;
  /** Show the tip for a part at a viewport point. `null` hides it. */
  show(text: HoverText | null, x?: number, y?: number): void;
  hide(): void;
  destroy(): void;
}

const STYLE_ID = 'pl-hover-tip-style';
const STYLE = `
  .pl-hover-tip {
    position: fixed;
    z-index: 214;
    display: none;
    flex-direction: column;
    gap: 2px;
    padding: 6px 10px;
    max-width: 240px;
    border: 1px solid var(--hud-border, rgba(239, 233, 216, 0.18));
    border-radius: 9px;
    background: linear-gradient(180deg, rgba(22, 28, 17, 0.95), rgba(11, 15, 9, 0.97));
    box-shadow: var(--hud-shadow-sm, 0 6px 18px rgba(0, 0, 0, 0.4));
    color: var(--warm-ink, #f0ead6);
    pointer-events: none;
    user-select: none;
  }
  .pl-hover-tip.is-visible { display: flex; }
  .pl-hover-tip__title { font-size: var(--hud-font-sm, 0.72rem); font-weight: 700; }
  .pl-hover-tip__action {
    font-size: var(--hud-font-xs, 0.66rem);
    color: var(--ink-dim, #9a937a);
  }
`;

function installStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}

export function createPlantHoverTip(mount: HTMLElement): PlantHoverTip {
  installStyles();
  const el = document.createElement('div');
  el.className = 'pl-hover-tip';
  el.setAttribute('role', 'presentation');
  const title = document.createElement('div');
  title.className = 'pl-hover-tip__title';
  const action = document.createElement('div');
  action.className = 'pl-hover-tip__action';
  el.appendChild(title);
  el.appendChild(action);
  mount.appendChild(el);

  let lastX = 0;
  let lastY = 0;

  return {
    element: el,
    show: (text, x = lastX, y = lastY) => {
      lastX = x;
      lastY = y;
      if (!text) {
        el.classList.remove('is-visible');
        return;
      }
      if (title.textContent !== text.title) title.textContent = text.title;
      if (action.textContent !== text.action) action.textContent = text.action;
      el.classList.add('is-visible');
      // Measure after the content is in: a tip that flips sides needs its own size.
      const rect = el.getBoundingClientRect();
      const spot = hoverTipPosition(
        x,
        y,
        rect.width,
        rect.height,
        window.innerWidth,
        window.innerHeight,
      );
      el.style.left = `${Math.round(spot.left)}px`;
      el.style.top = `${Math.round(spot.top)}px`;
    },
    hide: () => el.classList.remove('is-visible'),
    destroy: () => el.remove(),
  };
}
