/**
 * The radial emote wheel.
 *
 * E opens it, E (or Escape, or the centre X) closes it. Moving the mouse
 * anywhere outside the centre picks the wedge under the pointer's direction;
 * a left click plays that emote and closes the wheel. Selection follows the
 * direction even when the pointer is beyond the drawn ring, which is the
 * Fortnite/GTA behaviour players expect from a radial menu.
 *
 * The wheel is a full-screen overlay rather than a small panel for two reasons:
 * it has to catch the click that would otherwise reach the world, and the
 * pointer must be allowed to leave the ring without losing the selection. It
 * deliberately does not use the `.hud-panel` class: that class clips its
 * contents (`overflow: hidden`), which is what made the old button ring
 * invisible and unclickable.
 */

import {
  annularSectorPath,
  sectorAngles,
  sectorAtOffset,
  sectorLabelPoint,
} from './emoteWheelGeometry.js';

export interface EmoteDefinition {
  id: string;
  label: string;
}

export interface EmoteWheelOptions {
  emotes: readonly EmoteDefinition[];
  /** Called once for the chosen emote, before the wheel closes. */
  onSelect: (emoteId: string) => void;
  /** Lets the host mirror the open state for Escape and input routing. */
  onOpenChange?: (open: boolean) => void;
}

export interface EmoteWheelAPI {
  readonly element: HTMLDivElement;
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  dispose(): void;
}

const STYLE_ID = 'pl-emote-wheel-style';
const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEWBOX = 420;
const CENTRE = VIEWBOX / 2;
const OUTER_RADIUS = 200;
const INNER_RADIUS = 74;
const LABEL_RADIUS = 140;
const WEDGE_GAP_RADIANS = 0.035;
const CLOSE_MS = 170;

function svgElement<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

function installStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #pl-emote-wheel {
      position: fixed;
      inset: 0;
      z-index: 650;
      display: grid;
      place-items: center;
      color: var(--bone-100, #f3f0e4);
      font-family: inherit;
      pointer-events: auto;
      touch-action: none;
      user-select: none;
    }
    #pl-emote-wheel[hidden] { display: none !important; }
    .pl-emote-wheel__scrim {
      position: absolute;
      inset: 0;
      background: radial-gradient(circle at center, rgba(6, 10, 7, 0.18), rgba(6, 10, 7, 0.62) 72%);
      opacity: 0;
      transition: opacity 0.16s ease;
    }
    .pl-emote-wheel.is-open .pl-emote-wheel__scrim { opacity: 1; }
    .pl-emote-wheel__dial {
      position: relative;
      width: min(420px, 86vmin);
      aspect-ratio: 1;
      opacity: 0;
      transform: scale(0.82);
      transition:
        opacity 0.16s ease,
        transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
      outline: none;
    }
    .pl-emote-wheel.is-open .pl-emote-wheel__dial {
      opacity: 1;
      transform: scale(1);
    }
    .pl-emote-wheel__dial svg {
      display: block;
      width: 100%;
      height: 100%;
      overflow: visible;
      filter: drop-shadow(0 18px 30px rgba(0, 0, 0, 0.45));
    }
    .pl-emote-wheel__ring {
      fill: color-mix(in srgb, var(--bark-900, #17170f) 88%, transparent);
      stroke: var(--hud-border, rgba(120, 150, 90, 0.35));
      stroke-width: 2;
    }
    .pl-emote-wheel__sector path {
      fill: color-mix(in srgb, var(--bark-800, #23231a) 84%, transparent);
      stroke: color-mix(in srgb, var(--bone-100, #f3f0e4) 14%, transparent);
      stroke-width: 1.5;
      cursor: pointer;
      transition:
        fill 0.12s ease,
        stroke 0.12s ease;
    }
    .pl-emote-wheel__sector:hover path,
    .pl-emote-wheel__sector:focus-visible path,
    .pl-emote-wheel__sector.is-selected path {
      fill: color-mix(in srgb, var(--leaf-700, #3f6b2e) 78%, var(--bark-800, #23231a));
      stroke: var(--leaf-300, #cfe8a8);
      stroke-width: 2;
    }
    .pl-emote-wheel__sector:focus { outline: none; }
    .pl-emote-wheel__sector text {
      fill: var(--bone-100, #f3f0e4);
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.02em;
      pointer-events: none;
      user-select: none;
    }
    .pl-emote-wheel__sector.is-selected text { fill: var(--leaf-200, #e6f4cf); }
    .pl-emote-wheel__center {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 21%;
      aspect-ratio: 1;
      border-radius: 50%;
      border: 1px solid var(--hud-border, rgba(120, 150, 90, 0.35));
      background: var(--bark-800, #23231a);
      color: var(--bone-100, #f3f0e4);
      box-shadow: var(--hud-shadow, 0 8px 24px rgba(0, 0, 0, 0.45));
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1px;
      padding: 0;
      cursor: pointer;
      transition:
        background 0.12s ease,
        border-color 0.12s ease;
    }
    .pl-emote-wheel__center:hover,
    .pl-emote-wheel__center:focus-visible {
      background: var(--bark-700, #2f2f22);
      border-color: var(--leaf-400, #9bc46b);
      outline: none;
    }
    .pl-emote-wheel__close-glyph {
      font-size: 22px;
      line-height: 1;
      font-weight: 400;
      opacity: 0.9;
    }
    .pl-emote-wheel__caption {
      max-width: 82%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 9px;
      line-height: 1.1;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      opacity: 0.72;
    }
    .pl-emote-wheel.is-selected .pl-emote-wheel__caption { opacity: 1; }
    @media (prefers-reduced-motion: reduce) {
      .pl-emote-wheel__scrim,
      .pl-emote-wheel__dial,
      .pl-emote-wheel__sector path,
      .pl-emote-wheel__center { transition: none; }
    }
  `;
  document.head.appendChild(style);
}

export function createEmoteWheel(options: EmoteWheelOptions): EmoteWheelAPI {
  installStyles();

  const overlay = document.createElement('div');
  overlay.id = 'pl-emote-wheel';
  overlay.className = 'pl-emote-wheel';
  overlay.hidden = true;
  overlay.setAttribute('aria-hidden', 'true');

  const scrim = document.createElement('div');
  scrim.className = 'pl-emote-wheel__scrim';
  overlay.appendChild(scrim);

  const dial = document.createElement('div');
  dial.className = 'pl-emote-wheel__dial';
  dial.setAttribute('role', 'dialog');
  dial.setAttribute('aria-modal', 'true');
  dial.setAttribute('aria-label', 'Emote wheel');
  dial.tabIndex = -1;
  overlay.appendChild(dial);

  const svg = svgElement('svg');
  svg.setAttribute('viewBox', `0 0 ${VIEWBOX} ${VIEWBOX}`);
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', 'Choose an emote');
  dial.appendChild(svg);

  const ring = svgElement('circle');
  ring.setAttribute('class', 'pl-emote-wheel__ring');
  ring.setAttribute('cx', String(CENTRE));
  ring.setAttribute('cy', String(CENTRE));
  ring.setAttribute('r', String(OUTER_RADIUS + 3));
  svg.appendChild(ring);

  const sectorLayer = svgElement('g');
  svg.appendChild(sectorLayer);

  const sectorEls: SVGGElement[] = [];
  for (const [index, emote] of options.emotes.entries()) {
    const angles = sectorAngles(index, options.emotes.length);
    const group = svgElement('g');
    group.setAttribute('class', 'pl-emote-wheel__sector');
    group.setAttribute('data-emote-index', String(index));
    group.setAttribute('data-emote-id', emote.id);
    group.setAttribute('role', 'button');
    group.setAttribute('tabindex', '0');
    group.setAttribute('aria-label', emote.label);

    const path = svgElement('path');
    path.setAttribute(
      'd',
      annularSectorPath(
        CENTRE,
        CENTRE,
        INNER_RADIUS,
        OUTER_RADIUS,
        angles.start,
        angles.end,
        WEDGE_GAP_RADIANS,
      ),
    );
    group.appendChild(path);

    const labelPoint = sectorLabelPoint(CENTRE, CENTRE, LABEL_RADIUS, index, options.emotes.length);
    const text = svgElement('text');
    text.setAttribute('x', labelPoint.x.toFixed(2));
    text.setAttribute('y', labelPoint.y.toFixed(2));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    const words = emote.label.trim().split(/\s+/u);
    words.forEach((word, wordIndex) => {
      const tspan = svgElement('tspan');
      tspan.setAttribute('x', labelPoint.x.toFixed(2));
      if (wordIndex === 0) {
        tspan.setAttribute('y', labelPoint.y.toFixed(2));
      } else {
        tspan.setAttribute('dy', '1.12em');
      }
      tspan.textContent = word;
      text.appendChild(tspan);
    });
    group.appendChild(text);
    sectorLayer.appendChild(group);
    sectorEls.push(group);
  }

  const center = document.createElement('button');
  center.type = 'button';
  center.className = 'pl-emote-wheel__center';
  center.setAttribute('aria-label', 'Close emote wheel');
  center.title = 'Close (Esc)';
  const closeGlyph = document.createElement('span');
  closeGlyph.className = 'pl-emote-wheel__close-glyph';
  closeGlyph.textContent = '\u00D7';
  const caption = document.createElement('span');
  caption.className = 'pl-emote-wheel__caption';
  caption.textContent = 'Emotes';
  center.append(closeGlyph, caption);
  dial.appendChild(center);

  document.body.appendChild(overlay);

  const abort = new AbortController();
  const signal = abort.signal;
  let openState = false;
  let selected = -1;
  let closeTimer = 0;

  const setSelected = (index: number): void => {
    const next = index >= 0 && index < options.emotes.length ? index : -1;
    if (selected === next) return;
    selected = next;
    for (const el of sectorEls) {
      el.classList.toggle('is-selected', Number(el.dataset.emoteIndex) === next);
    }
    const label = next >= 0 ? options.emotes[next]?.label : undefined;
    caption.textContent = label ?? 'Emotes';
    overlay.classList.toggle('is-selected', next >= 0);
  };

  const select = (index: number): void => {
    const emote = options.emotes[index];
    if (!emote) return;
    setSelected(index);
    options.onSelect(emote.id);
    close();
  };

  const updateFromPointer = (event: PointerEvent): void => {
    const rect = dial.getBoundingClientRect();
    const scale = rect.width / VIEWBOX;
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    setSelected(sectorAtOffset(dx, dy, options.emotes.length, INNER_RADIUS * scale));
  };

  const open = (): void => {
    if (openState) return;
    window.clearTimeout(closeTimer);
    openState = true;
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    // Force a layout pass so the opening transition runs from the closed state.
    void overlay.offsetWidth;
    overlay.classList.add('is-open');
    setSelected(-1);
    dial.focus({ preventScroll: true });
    options.onOpenChange?.(true);
  };

  const close = (): void => {
    if (!openState) return;
    openState = false;
    setSelected(-1);
    overlay.classList.remove('is-open');
    // Move focus out before making the dialog inert. aria-hidden on a subtree
    // that still owns focus is ignored by browsers (and warned about), while the
    // wheel is already visually closing.
    if (overlay.contains(document.activeElement)) {
      (document.activeElement as HTMLElement | null)?.blur();
    }
    overlay.setAttribute('aria-hidden', 'true');
    options.onOpenChange?.(false);
    window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => {
      if (!openState) overlay.hidden = true;
    }, CLOSE_MS);
  };

  overlay.addEventListener('pointermove', updateFromPointer, { signal });
  overlay.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0) return;
      const target = event.target instanceof Element ? event.target : null;
      // The centre button owns its own click, so a tap on it closes instead of
      // selecting whatever wedge lies behind it.
      if (target?.closest('.pl-emote-wheel__center')) return;
      event.preventDefault();
      const sector = target?.closest<SVGGElement>('[data-emote-index]');
      if (sector) {
        select(Number(sector.dataset.emoteIndex));
        return;
      }
      updateFromPointer(event);
      if (selected >= 0) select(selected);
      else close();
    },
    { signal },
  );
  center.addEventListener('click', close, { signal });

  for (const [index, sector] of sectorEls.entries()) {
    sector.addEventListener('mouseenter', () => setSelected(index), { signal });
    sector.addEventListener(
      'focus',
      () => {
        setSelected(index);
      },
      { signal },
    );
    sector.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        select(index);
      },
      { signal },
    );
  }

  return {
    element: overlay,
    open,
    close,
    toggle: () => (openState ? close() : open()),
    isOpen: () => openState,
    dispose: () => {
      abort.abort();
      window.clearTimeout(closeTimer);
      overlay.remove();
    },
  };
}
