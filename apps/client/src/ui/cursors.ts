/**
 * Plant-themed cursors, and the switch that turns them off.
 *
 * The pointer is the one piece of the interface that is on screen the whole time,
 * so it is also the piece that can carry the most character for the least picture.
 * These are leaf-shaped SVG cursors in the game's own palette: a leaf arrow for the
 * world, a leaf with a pointing tip for anything clickable, and a closed leaf for a
 * drag.
 *
 * A native cursor cannot be tinted by the page, so the shapes are drawn in the
 * scene's greens and rely on a dark outline to stay visible on both soil and sky.
 * Anyone who would rather keep their own system pointer turns them off in Settings;
 * the choice is remembered like the sound switch.
 */

export type CursorTheme = 'default' | 'plant';

const STORAGE_KEY = 'pl-cursor-theme';
const STYLE_ID = 'pl-cursor-style';

/** Percent-encode an SVG for a `cursor: url(...)`. */
function cursorUrl(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * A leaf, drawn with its tip at the hot spot.
 *
 * `tip` picks the variant, and each has its hot spot written where its cursor is
 * applied: the arrow's leaf leans up-left, the pointer's stands upright, and the
 * grab form is a closed leaf in the hand.
 */
/**
 * A leaf, drawn to point at its hot spot.
 *
 * The default pointer had no point at all: its outline started at the hot spot on
 * a rounded corner, so the leaf looked like a seed with a 1.4px offset between
 * what the drawing pointed at and what the browser clicked. A pointer has to have
 * a corner where it aims, so each shape below *converges* at its hot spot - the
 * first control leaves the tip to one side and the closing edge arrives at it
 * from another, which is the only way an outline gets a point rather than a
 * tangent. The hot spot written in the CSS is the same coordinate as that corner.
 *
 * Three paths each: stem, body, vein. A second copy of the body as a highlight
 * stroke was invisible at 32px and only made the data URI bigger.
 */
function leafCursor(fill: string, lit: string, tip: 'arrow' | 'pointer' | 'grab'): string {
  const shape =
    tip === 'grab'
      ? {
          body: 'M9 12 C14 5 24 7 26.5 14.5 C29 22 21.5 28.5 14.5 27 C8 25.5 5 18.5 9 12 Z',
          stem: 'M14.5 27 C15.5 29 17 30 19 30.5',
          vein: 'M11 14 C14.5 16 18 19.5 20.5 23',
          glint: 'M11 10 C13 11 15 13 16 15',
        }
      : tip === 'pointer'
        ? {
            // Upright, with the corner at the top (7,2).
            body: 'M7 2 C14 4 20 9 21.5 15 C23 21 18 27 11.5 27 C5.5 26.5 3 20 5 14 C5.8 10.5 6.5 5.5 7 2 Z',
            stem: 'M11.5 27 C10.5 29 10 30 9.5 31',
            vein: 'M8 6 C11 11 14 17 15.5 23',
            glint: 'M8.5 5 C10.5 7 12.5 10 13.5 12.5',
          }
        : {
            // The default pointer. A leaf outline has no arrow in it - three
            // attempts at a leaf-shaped pointer read as a seed or a pod, because a
            // blade's widest part is in the middle and a cursor's is at its base.
            // This is a pointer: a straight left edge, a notch, a tail, in leaf
            // green with a midrib. The plant theme is in the colour and the vein,
            // where a 32 px arrow can carry it.
            body: 'M3 2 L3 22 L9.5 16.5 L13.5 26.5 L18 24.6 L14 15 L22.5 14 Z',
            stem: '',
            vein: 'M5.5 6 L6.5 20',
            glint: 'M3.6 3.2 L3.6 20',
          };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    ${shape.stem ? `<path d="${shape.stem}" fill="none" stroke="#16200f" stroke-width="2.6" stroke-linecap="round"/>` : ''}
    <path d="${shape.body}" fill="${fill}" stroke="#16200f" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="${shape.vein}" fill="none" stroke="#1b2a12" stroke-width="1.2"
          stroke-linecap="round" opacity="0.6"/>
    <path d="${shape.glint}" fill="none" stroke="${lit}" stroke-width="1.4"
          stroke-linecap="round" opacity="0.95"/>
  </svg>`;
}

const ARROW = cursorUrl(leafCursor('#7db83d', '#d6e88a', 'arrow'));
const POINTER = cursorUrl(leafCursor('#9ed95c', '#f0f7c8', 'pointer'));
const GRAB = cursorUrl(leafCursor('#5a902e', '#9ed95c', 'grab'));

function stylesheet(): string {
  return `
  html[data-pl-cursor='plant'],
  html[data-pl-cursor='plant'] body,
  html[data-pl-cursor='plant'] canvas {
    cursor: ${ARROW} 3 2, auto;
  }
  html[data-pl-cursor='plant'] a,
  html[data-pl-cursor='plant'] button,
  html[data-pl-cursor='plant'] [role='button'],
  html[data-pl-cursor='plant'] select,
  html[data-pl-cursor='plant'] summary,
  html[data-pl-cursor='plant'] .pl-treasure,
  html[data-pl-cursor='plant'] .pl-care,
  html[data-pl-cursor='plant'] .pl-settings__chip {
    cursor: ${POINTER} 7 2, pointer;
  }
  /* Grab is for the moment of dragging, never for resting over the scene: a
     closed leaf under the pointer everywhere read as the default cursor. */
  html[data-pl-cursor='plant'] .pl-scene.is-dragging,
  html[data-pl-cursor='plant'] .pl-title-plant.is-bending {
    cursor: ${GRAB} 15 12, grabbing;
  }
  /* The plant and its parts can be dragged and tapped, so they take the pointing
     leaf, like every other thing on the screen that answers. */
  html[data-pl-cursor='plant'] .pl-title-plant [data-part],
  html[data-pl-cursor='plant'] .pl-title-plant__grab,
  html[data-pl-cursor='plant'] .pl-title-plant__roots {
    cursor: ${POINTER} 7 2, pointer;
  }
  html[data-pl-cursor='plant'] input,
  html[data-pl-cursor='plant'] textarea {
    cursor: text;
  }
  html[data-pl-cursor='plant'] input[type='checkbox'],
  html[data-pl-cursor='plant'] input[type='range'] {
    cursor: ${POINTER} 7 2, pointer;
  }
  /* Forced colours replaces the pointer's colours with the system's, and a pale
     leaf with a dark rim turns into two flat system colours; the system pointer
     is simpler to see there. */
  @media (forced-colors: active) {
    html[data-pl-cursor='plant'],
    html[data-pl-cursor='plant'] body,
    html[data-pl-cursor='plant'] canvas,
    html[data-pl-cursor='plant'] a,
    html[data-pl-cursor='plant'] button,
    html[data-pl-cursor='plant'] [role='button'] {
      cursor: auto;
    }
  }
`;
}

/** The stored choice, defaulting to the plant cursors on. */
export function readCursorTheme(): CursorTheme {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'off' ? 'default' : 'plant';
  } catch {
    return 'plant';
  }
}

/** Apply a theme without touching storage (used at boot). */
export function applyCursorTheme(theme: CursorTheme): void {
  const doc = document.documentElement;
  if (theme === 'plant') doc.dataset.plCursor = 'plant';
  else doc.removeAttribute('data-pl-cursor');
  if (theme === 'plant' && !document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = stylesheet();
    document.head.appendChild(style);
  }
}

/** Apply and remember a theme. */
export function setCursorTheme(theme: CursorTheme): void {
  applyCursorTheme(theme);
  try {
    window.localStorage.setItem(STORAGE_KEY, theme === 'plant' ? 'on' : 'off');
  } catch {}
}

/** Is the plant cursor theme on? */
export function plantCursorsEnabled(): boolean {
  return readCursorTheme() === 'plant';
}
