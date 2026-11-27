/**
 * Plant-themed cursors, and the switch that turns them off.
 *
 * The pointer is the one piece of the interface that is on screen the whole time,
 * so it is also the piece that can carry the most character for the least picture.
 * These are leaf-shaped cursors in the game's own palette: a leaf arrow for the
 * world, a leaf with a pointing tip for anything clickable, and a closed leaf for a
 * drag.
 *
 * A native cursor cannot be tinted by the page, so the shapes are drawn in the
 * scene's greens and rely on a dark outline to stay visible on both soil and sky.
 * Anyone who would rather keep their own system pointer turns them off in Settings;
 * the choice is remembered like the sound switch.
 *
 * Each cursor is offered twice: a PNG rasterised from the same paths, then the
 * SVG. PNG is the one format every engine accepts for `cursor`, and Chromium has
 * historically refused or dropped SVG cursor images without an error, which
 * silently left the Windows arrow on the canvas. The SVG stays in the stack for
 * the sharpness a resolution-independent image gives at high DPI.
 */

export type CursorTheme = 'default' | 'plant';

interface LeafShape {
  body: string;
  stem: string;
  vein: string;
  glint: string;
}

type CursorTip = 'arrow' | 'pointer' | 'grab';

interface CursorArt {
  arrow: string;
  pointer: string;
  grab: string;
}

const STORAGE_KEY = 'pl-cursor-theme';
const STYLE_ID = 'pl-cursor-style';

/** Percent-encode an SVG for a `cursor: url(...)`. */
function cursorUrl(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

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
function leafShape(tip: CursorTip): LeafShape {
  if (tip === 'grab') {
    return {
      body: 'M9 12 C14 5 24 7 26.5 14.5 C29 22 21.5 28.5 14.5 27 C8 25.5 5 18.5 9 12 Z',
      stem: 'M14.5 27 C15.5 29 17 30 19 30.5',
      vein: 'M11 14 C14.5 16 18 19.5 20.5 23',
      glint: 'M11 10 C13 11 15 13 16 15',
    };
  }
  if (tip === 'pointer') {
    return {
      // Upright, with the corner at the top (7,2).
      body: 'M7 2 C14 4 20 9 21.5 15 C23 21 18 27 11.5 27 C5.5 26.5 3 20 5 14 C5.8 10.5 6.5 5.5 7 2 Z',
      stem: 'M11.5 27 C10.5 29 10 30 9.5 31',
      vein: 'M8 6 C11 11 14 17 15.5 23',
      glint: 'M8.5 5 C10.5 7 12.5 10 13.5 12.5',
    };
  }
  // The default pointer. A leaf outline has no arrow in it - three attempts at a
  // leaf-shaped pointer read as a seed or a pod, because a blade's widest part is
  // in the middle and a cursor's is at its base. This is a pointer: a straight
  // left edge, a notch, a tail, in leaf green with a midrib. The plant theme is
  // in the colour and the vein, where a 32 px arrow can carry it.
  return {
    body: 'M3 2 L3 22 L9.5 16.5 L13.5 26.5 L18 24.6 L14 15 L22.5 14 Z',
    stem: '',
    vein: 'M5.5 6 L6.5 20',
    glint: 'M3.6 3.2 L3.6 20',
  };
}

function leafSvg(fill: string, lit: string, tip: CursorTip): string {
  const shape = leafShape(tip);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    ${shape.stem ? `<path d="${shape.stem}" fill="none" stroke="#16200f" stroke-width="2.6" stroke-linecap="round"/>` : ''}
    <path d="${shape.body}" fill="${fill}" stroke="#16200f" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="${shape.vein}" fill="none" stroke="#1b2a12" stroke-width="1.2"
          stroke-linecap="round" opacity="0.6"/>
    <path d="${shape.glint}" fill="none" stroke="${lit}" stroke-width="1.4"
          stroke-linecap="round" opacity="0.95"/>
  </svg>`;
}

/**
 * The same leaf as a 32px PNG, drawn with the canvas path API.
 *
 * `cursor: url(svg)` is required by the spec and works in current browsers, but
 * a refused image falls through to the keyword without a console error, which is
 * exactly how the leaf theme ended up showing the Windows arrow. A raster in
 * front of the SVG makes the first candidate one no engine can refuse.
 */
function leafPng(fill: string, lit: string, tip: CursorTip): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    const shape = leafShape(tip);
    ctx.lineCap = 'round';
    if (shape.stem) {
      ctx.strokeStyle = '#16200f';
      ctx.lineWidth = 2.6;
      ctx.stroke(new Path2D(shape.stem));
    }
    const body = new Path2D(shape.body);
    ctx.fillStyle = fill;
    ctx.fill(body);
    ctx.strokeStyle = '#16200f';
    ctx.lineWidth = 2.2;
    ctx.lineJoin = 'round';
    ctx.stroke(body);
    ctx.strokeStyle = '#1b2a12';
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.6;
    ctx.stroke(new Path2D(shape.vein));
    ctx.strokeStyle = lit;
    ctx.lineWidth = 1.4;
    ctx.globalAlpha = 0.95;
    ctx.stroke(new Path2D(shape.glint));
    return `url("${canvas.toDataURL('image/png')}")`;
  } catch {
    return '';
  }
}

/**
 * The image list for one cursor, with the hot spot on every candidate.
 *
 * The hot spot is part of each URL in the CSS grammar, so it cannot be written
 * once after a comma-separated stack; this builds the whole list instead.
 */
function cursorStack(fill: string, lit: string, tip: CursorTip, x: number, y: number): string {
  const png = leafPng(fill, lit, tip);
  const svg = cursorUrl(leafSvg(fill, lit, tip));
  const hot = `${x} ${y}`;
  return png ? `${png} ${hot}, ${svg} ${hot}` : `${svg} ${hot}`;
}

let art: CursorArt | null = null;

/** Rasterise the three leaves once, on first use (never at module import). */
function cursorArt(): CursorArt {
  if (!art) {
    art = {
      arrow: cursorStack('#7db83d', '#d6e88a', 'arrow', 3, 2),
      pointer: cursorStack('#9ed95c', '#f0f7c8', 'pointer', 7, 2),
      grab: cursorStack('#5a902e', '#9ed95c', 'grab', 15, 12),
    };
  }
  return art;
}

function stylesheet(): string {
  const { arrow, pointer, grab } = cursorArt();
  return `
  html[data-pl-cursor='plant'],
  html[data-pl-cursor='plant'] body,
  html[data-pl-cursor='plant'] canvas {
    cursor: ${arrow}, auto;
  }
  html[data-pl-cursor='plant'] a,
  html[data-pl-cursor='plant'] button,
  html[data-pl-cursor='plant'] [role='button'],
  html[data-pl-cursor='plant'] select,
  html[data-pl-cursor='plant'] summary,
  html[data-pl-cursor='plant'] .pl-treasure,
  html[data-pl-cursor='plant'] .pl-care,
  html[data-pl-cursor='plant'] .pl-settings__chip {
    cursor: ${pointer}, pointer;
  }
  /* Grab is for the moment of dragging, never for resting over the scene: a
     closed leaf under the pointer everywhere read as the default cursor. */
  html[data-pl-cursor='plant'] .pl-scene.is-dragging,
  html[data-pl-cursor='plant'] .pl-title-plant.is-bending {
    cursor: ${grab}, grabbing;
  }
  /* The plant and its parts can be dragged and tapped, so they take the pointing
     leaf, like every other thing on the screen that answers. */
  html[data-pl-cursor='plant'] .pl-title-plant [data-part],
  html[data-pl-cursor='plant'] .pl-title-plant__grab,
  html[data-pl-cursor='plant'] .pl-title-plant__roots {
    cursor: ${pointer}, pointer;
  }
  /* Grow mode is not a different pointer. The aim it needs is drawn in the scene
     (the arrow gizmo on the plant), so the crosshair that used to replace the leaf
     here said nothing the arrow did not already say, and the pointer changed
     shape under the player between two clicks of the same drag. */
  html[data-pl-cursor='plant'] input,
  html[data-pl-cursor='plant'] textarea {
    cursor: text;
  }
  html[data-pl-cursor='plant'] input[type='checkbox'],
  html[data-pl-cursor='plant'] input[type='range'] {
    cursor: ${pointer}, pointer;
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
  // OrbitControls stamps an inline `cursor: auto` on the canvas at construction.
  // Clearing it here as well covers a canvas built after boot (a renderer swap).
  for (const canvas of document.querySelectorAll('canvas')) canvas.style.removeProperty('cursor');
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
