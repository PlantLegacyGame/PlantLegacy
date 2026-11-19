/**
 * The plant on the title screen.
 *
 * It is a mascot, not the player's plant: everyone sees the same one, so a
 * holiday variant is a single art swap. It breathes on its own and responds to a
 * touch, and it reports touches rather than acting on them - the drop behaviour
 * that will hang off it (resources, holiday gifts) belongs to whoever mounts it.
 *
 * The shoot is drawn here and the underground half in `roots.ts`, because the
 * title ground is a cut slice: the plant has to cross the soil line as one object,
 * not sit on top of a brown rectangle. The shoot's lowest point is the base of the
 * stem, which is what the stage line lines up with; the roots hang below that line
 * and never move the layout. Only the leaves move - the stem and the roots stay
 * put, because the plant is rooted.
 */

import {
  advanceSway,
  createPlantMotion,
  type PlantMotionState,
  reactionScale,
  reactToTouch,
  swayOffset,
} from './plantMotion.ts';
import {
  BEND_LOWER_SHARE,
  BEND_TIP_SHARE,
  bendDegrees,
  gustAngle,
  leafSwingSign,
  leanTowardPointer,
  nextGustAt,
  type PlantPart,
  partFromDataset,
  releaseAngle,
  swingAngle,
  type TapResponse,
  tapResponse,
} from './plantReaction.ts';
import { rootsMarkup } from './roots.ts';

export interface TitlePlantOptions {
  /** One full sway cycle, in milliseconds (`title_plant_sway_ms`). */
  swayMs: number;
  /** How long a reaction plays (`title_plant_react_ms`). */
  reactMs: number;
  /** Shortest gap between reactions (`title_plant_react_cooldown_ms`). */
  cooldownMs: number;
  reducedMotion: boolean;
  /** Called for every accepted touch, with the running count. */
  onTouch?: (count: number) => void;
}

export interface TitlePlant {
  element: HTMLElement;
  /** Start or stop the sway loop (it is pointless while the plant is hidden). */
  setActive(active: boolean): void;
  /** React as if the given part was tapped, from an outside trigger. */
  react(part?: PlantPart, index?: number): void;
  destroy(): void;
}

const STYLE_ID = 'pl-title-plant-style';

const STYLE = `
  /* Each part is a thing you can touch. The drawing is decorative to a screen
     reader, but a pointer gets a cursor that says which parts answer. */
  .pl-title-plant__leaf,
  .pl-title-plant__stem,
  .pl-title-plant__lower,
  .pl-title-plant__bud,
  .pl-title-plant__roots {
    cursor: pointer;
  }
  .pl-title-plant[data-part] { cursor: grab; }
  .pl-title-plant.is-bending,
  .pl-title-plant.is-bending .pl-title-plant__leaf { cursor: grabbing; }
  /* The plant is one gesture surface: without this a touch drag scrolls the page
     instead of bending the stem. */
  .pl-title-plant { touch-action: none; }
  /* Leaves lean toward a fine pointer. Only where a hover exists: on a finger
     layout there is nothing to lean toward. */
  @media (hover: hover) and (pointer: fine) {
    .pl-title-plant__leaf {
      transition: transform 220ms cubic-bezier(0.2, 0.8, 0.3, 1);
    }
    .pl-title-plant__leaf:hover { transform: rotate(3deg); }
    .pl-title-plant__leaf:nth-child(even):hover { transform: rotate(-3deg); }
  }
  .pl-title-plant.is-budding .pl-title-plant__bud { filter: brightness(1.12) saturate(1.1); }
  .pl-title-plant {
    /* Anchors the roots: they hang off this box, wherever it is placed. */
    position: relative;
    /* The mascot's palette. Declared here, not only as SVG fallbacks, so a
       holiday or seasonal variant is one variable swap. */
    --pl-stem: #5a902e;
    --pl-stem-dark: #46741f;
    --pl-leaf-front: #7db83d;
    --pl-leaf-light: #9ed95c;
    --pl-leaf-back: #426520;
    --pl-leaf-deep: #4c7a22;
    --pl-leaf-shadow: #33501a;
    --pl-leaf-tender: #a8c95c;
    --pl-leaf-tender-lit: #d6e88a;
    /* Vein and edge ink, kept as variables so a variant can recolour the
       drawing without touching the markup. */
    --pl-leaf-vein: #2c4512;
    --pl-leaf-edge: #2c4512;
    /* The ink under a root: what keeps pale roots from floating on dark earth.
       Set from the palette by TitleScene; this is the fallback. */
    --pl-root-ink: #1c1208;
    display: block;
    /* Fluid to a phone, capped so it never outgrows the hero column: 232px was
       a phone's plant, and it stayed that size on a 2560px monitor. */
    /* Height is part of the budget, not only width: the plant stands on the ground
       line and grows upward, so in a short pane a width-only size put it above the
       top of it. 34vh handles the shape, and --pl-mascot-max is the ceiling the
       menu computes for the pane it is actually in (title/menuFit.ts). */
    width: min(clamp(96px, min(17vw, 34vh), 300px), var(--pl-mascot-max, 300px));
    height: auto;
    /* A drawing on a title screen, not a button: no pointer cursor, no focus
       ring, no hover tint. It answers a click with its own sway and that is the
       whole reply, so the browser has nothing to highlight. */
    cursor: default;
    /* A drag across the scene must slide the parallax, never paint a selection
       box over the mascot. Clicking it used to leave one behind. */
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
  }
  /* The shoot's box is what the layout aligns to the soil line, so it has to end
     where the drawing ends. An inline SVG sits on a text baseline and leaves a few
     pixels of descender space beneath itself: this wrapper measured 3px taller than
     its own drawing, and the roots - hung at 100% of the wrapper - therefore began
     2px below the stem's foot. That gap is what read as a plant with no roots. */
  /* The light grade lives on the two drawings, never on their wrapper. A CSS
     filter clips its element to the filter region (the border box plus 10%), and
     the roots hang about 30% of the plant's height below that box, so filtering
     the wrapper cut the roots off just under the soil line - the plant looked
     unrooted. Lit by the scene: dimmed at night, warmed at dusk, cooled under
     moonlight; no drop shadow. */
  .pl-title-plant > svg {
    display: block;
    user-select: none;
    -webkit-user-select: none;
    filter: brightness(var(--pl-plant-dim, 1)) saturate(var(--pl-plant-sat, 1))
      sepia(var(--pl-plant-sepia, 0)) hue-rotate(var(--pl-plant-hue, 0deg));
    transition: filter 160ms ease;
  }
  .pl-title-plant__rim {
    transform: translateX(var(--pl-plant-rim-x, 0px));
    transition: transform 240ms ease;
  }
  /* No outline, no hover highlight, no reaction glow: the mascot is a drawing, not
     a control. It answers a touch with its own sway, and that is the whole reply.
     The scene's light filter stays on focus; clearing it made the plant flash back
     to full daylight whenever it was clicked. */
  .pl-title-plant:hover,
  .pl-title-plant:focus,
  .pl-title-plant:focus-visible,
  .pl-title-plant.is-reacting { outline: none; }
  /* The underground half hangs below the shoot, so the shoot's box - which is what
     the layout aligns to the soil line - does not move. The roots take the same
     light filter as the leaves because they are inside the plant, not the ground. */
  .pl-title-plant__roots {
    position: absolute;
    left: 0;
    /* Two pixels up: two SVG boxes meeting on a fractional pixel can leave a
       hairline the colour of the sky between the stem and its foot. The crown is
       the same bark on both sides of the joint, so the overlap is invisible. */
    top: calc(100% - 2px);
    width: 100%;
    height: auto;
    display: block;
    /* A root answers a tap now, so the soil layer takes pointers. */
    pointer-events: auto;
    transform-box: view-box;
    transform-origin: 50% 0%;
  }
  /* Sway pivots on the base of the stem, which is the bottom of the drawing. */
  .pl-title-plant__leaves { transform-box: fill-box; transform-origin: 50% 100%; }
  /* The bend hinges: the lower band turns about the soil line, the tip about the
     middle of the stem. Given in viewBox units so they follow the drawing. */
  .pl-title-plant__lower,
  .pl-title-plant__tip { transform-box: view-box; }
  @media (prefers-reduced-motion: reduce) {
    .pl-title-plant,
    .pl-title-plant__rim { transition: none; }
  }
`;

function installStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}

/**
 * One leaf, drawn from its stem attachment.
 *
 * Leaf art is generated rather than hand-placed so the parts share one set of
 * proportions: a leaf is an almond from its base to its tip, a midrib up the
 * middle and side veins that lean toward the tip. Hand-typed paths for every leaf
 * drifted into different curvatures, which read as clip art.
 */
interface LeafSpec {
  /** Attachment point on the stem. */
  x: number;
  y: number;
  /** Degrees from straight up; negative leans left. */
  angle: number;
  len: number;
  w: number;
  fill: string;
  /** Behind the stem, so the plant has depth instead of a flat fan. */
  back?: boolean;
  /** Tenderness: vein detail is dropped on the smallest leaf. */
  veins?: boolean;
  /** Draw the sun-facing edge for the rim pass. */
  rim?: boolean;
}

function leafPath(len: number, w: number): string {
  return (
    `M0 0 C${(-w).toFixed(1)} ${(-len * 0.22).toFixed(1)} ` +
    `${(-w * 0.92).toFixed(1)} ${(-len * 0.66).toFixed(1)} 0 ${(-len).toFixed(1)} ` +
    `C${(w * 0.92).toFixed(1)} ${(-len * 0.66).toFixed(1)} ` +
    `${w.toFixed(1)} ${(-len * 0.22).toFixed(1)} 0 0 Z`
  );
}

function leafVeins(len: number, w: number): string {
  const parts = [
    `M0 -2 Q${(-w * 0.05).toFixed(1)} ${(-len * 0.5).toFixed(1)} 0 ${(-len * 0.92).toFixed(1)}`,
  ];
  for (let i = 1; i <= 4; i += 1) {
    const t = i / 5;
    const y = -len * t;
    // Side veins shorten toward the tip, so the leaf narrows the way it should.
    const reach = w * 0.64 * (1 - t * 0.6);
    parts.push(`M0 ${y.toFixed(1)} L${(-reach).toFixed(1)} ${(y - len * 0.13).toFixed(1)}`);
    parts.push(`M0 ${y.toFixed(1)} L${reach.toFixed(1)} ${(y - len * 0.13).toFixed(1)}`);
  }
  return parts.join(' ');
}

function leaf(spec: LeafSpec, index: number): string {
  // The rim goes on the edge that faces the sky. Taken as the local left side for
  // every leaf it lit the *underside* of everything leaning left, so half the
  // plant was highlighted from below.
  const side = spec.angle >= 0 ? -1 : 1;
  const rim = spec.rim
    ? `<g class="pl-title-plant__rim" transform="translate(${spec.x} ${spec.y}) rotate(${spec.angle})">` +
      `<path d="M0 -3 C${(side * spec.w * 0.86).toFixed(1)} ${(-spec.len * 0.24).toFixed(1)} ` +
      `${(side * spec.w * 0.78).toFixed(1)} ${(-spec.len * 0.62).toFixed(1)} 0 ${(-spec.len * 0.95).toFixed(1)}" ` +
      'fill="none" stroke="var(--pl-leaf-rim, #d8f0a8)" stroke-width="2.4" ' +
      'stroke-linecap="round" opacity="var(--pl-leaf-rim-opacity, 0.4)"/></g>'
    : '';
  const veins = spec.veins
    ? `<path d="${leafVeins(spec.len, spec.w)}" fill="none" stroke="var(--pl-leaf-vein, #2c4512)" ` +
      `stroke-opacity="${spec.back ? 0.16 : 0.2}" stroke-width="0.85" stroke-linecap="round"/>`
    : '';
  // The wrapper carries no transform attribute, so it is free for the animation:
  // an SVG transform attribute and the CSS transform property are the same
  // property, and writing CSS on the placed group would throw away its placement.
  // `transform-origin` is given in viewBox units at the leaf's attachment, so a
  // flick rotates the leaf about where it meets the stem.
  return (
    `<g class="pl-title-plant__leaf" data-part="leaf" data-leaf="${index}" ` +
    `style="transform-origin:${spec.x}px ${spec.y}px">` +
    `<g transform="translate(${spec.x} ${spec.y}) rotate(${spec.angle})"${spec.back ? ' opacity="0.92"' : ''}>` +
    `<path d="${leafPath(spec.len, spec.w)}" fill="url(#${spec.fill})" ` +
    'stroke="var(--pl-leaf-edge, #2c4512)" stroke-opacity="0.16" stroke-width="1"/>' +
    veins +
    '</g>' +
    rim +
    '</g>'
  );
}

/**
 * The mascot: one stem, seven leaves in three depths and a bud.
 *
 * Order matters and is the whole drawing: back leaves, stem, front leaves low to
 * high, then the bud. Leaf pairs alternate sides and get shorter as they climb,
 * which is the difference between a plant and a bundle of stems - the first
 * version had nine same-sized shapes and read as the latter.
 *
 * The stem's base at (100, 224) is the lowest point of the art; it is what the
 * stage line in the scene lines up with.
 */
function plantMarkup(): string {
  const leaves: LeafSpec[] = [
    // Behind the stem: the darker plane that gives the plant a back.
    { x: 100, y: 184, angle: -30, len: 68, w: 21, fill: 'pl-leaf-back', back: true, veins: true },
    { x: 97, y: 152, angle: 36, len: 58, w: 18, fill: 'pl-leaf-back', back: true, veins: true },
    // Front, climbing: longest at the bottom, tender at the top.
    { x: 99, y: 198, angle: 46, len: 92, w: 28, fill: 'pl-leaf-a', veins: true, rim: true },
    { x: 99, y: 166, angle: -48, len: 96, w: 30, fill: 'pl-leaf-a', veins: true, rim: true },
    { x: 96, y: 140, angle: 52, len: 74, w: 22, fill: 'pl-leaf-b', veins: true, rim: true },
    { x: 94, y: 118, angle: -50, len: 60, w: 18, fill: 'pl-leaf-b', veins: true, rim: true },
    { x: 92, y: 96, angle: 6, len: 40, w: 12, fill: 'pl-leaf-d', rim: true },
  ];
  // Index is the leaf's own identity in the drawing, so a tap can name the exact
  // leaf it hit; the bands then decide what a bend does to it.
  const numbered = leaves.map((spec, index) => ({ spec, index }));
  const back = numbered
    .filter(({ spec }) => spec.back)
    .map(({ spec, index }) => leaf(spec, index))
    .join('');
  // The plant bends at two hinges: everything below the middle stem, and the top
  // of the stem with the tender leaves and the bud. Splitting here keeps each
  // band's paint order exactly as it was - back leaves, stem, lower front leaves,
  // upper front leaves, bud - so the art is unchanged.
  const front = numbered.filter(({ spec }) => !spec.back);
  const lowerFront = front
    .slice(0, 2)
    .map(({ spec, index }) => leaf(spec, index))
    .join('');
  const tipFront = front
    .slice(2)
    .map(({ spec, index }) => leaf(spec, index))
    .join('');
  // Node nubs where a leaf leaves the stem: a stem is not a smooth pipe.
  const nubs = [
    [99, 198, 0],
    [99, 166, 0],
    [96, 140, 0],
    [94, 118, 0],
    [92, 96, 0],
  ]
    .map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="6.4" ry="3.1" fill="url(#pl-stem)"/>`)
    .join('');

  return `
    <svg viewBox="0 0 200 224" role="img" aria-label="Plant" focusable="false">
      <defs>
        <linearGradient id="pl-leaf-a" x1="0" y1="1" x2="0.35" y2="0">
          <stop offset="0" style="stop-color: var(--pl-leaf-deep, #4c7a22)"/>
          <stop offset="1" style="stop-color: var(--pl-leaf-front, #7db83d)"/>
        </linearGradient>
        <linearGradient id="pl-leaf-b" x1="0" y1="1" x2="0.5" y2="0">
          <stop offset="0" style="stop-color: var(--pl-leaf-front, #7db83d)"/>
          <stop offset="1" style="stop-color: var(--pl-leaf-light, #9ed95c)"/>
        </linearGradient>
        <linearGradient id="pl-leaf-c" x1="0.2" y1="1" x2="0.8" y2="0">
          <stop offset="0" style="stop-color: var(--pl-leaf-back, #426520)"/>
          <stop offset="1" style="stop-color: var(--pl-leaf-deep, #4c7a22)"/>
        </linearGradient>
        <linearGradient id="pl-leaf-d" x1="0" y1="1" x2="0.4" y2="0">
          <stop offset="0" style="stop-color: var(--pl-leaf-tender, #a8c95c)"/>
          <stop offset="1" style="stop-color: var(--pl-leaf-tender-lit, #d6e88a)"/>
        </linearGradient>
        <linearGradient id="pl-leaf-back" x1="0" y1="1" x2="0.3" y2="0">
          <stop offset="0" style="stop-color: var(--pl-leaf-shadow, #33501a)"/>
          <stop offset="1" style="stop-color: var(--pl-leaf-back, #426520)"/>
        </linearGradient>
        <linearGradient id="pl-stem" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" style="stop-color: var(--pl-stem-dark, #46741f)"/>
          <stop offset="1" style="stop-color: var(--pl-stem, #5a902e)"/>
        </linearGradient>
      </defs>
      <g class="pl-title-plant__leaves">
        <g class="pl-title-plant__lower" data-part="stem" style="transform-origin:100px 224px">
          ${back}
          <path d="M100 224 C100 170 96 120 90 84" stroke="url(#pl-stem)" stroke-width="11"
                fill="none" stroke-linecap="round"/>
          <!-- The stem's foot, flat in bark. The underground half continues from
               exactly here, and matching a gradient's end colour at a joint is a
               guess - a flat colour is not. -->
          <path d="M94.5 212 H105.5 V224 H94.5 Z" fill="var(--pl-stem-dark, #46741f)"/>
          <path d="M98.5 218 C98.5 168 95 122 91 88" stroke="var(--pl-leaf-light, #9ed95c)"
                stroke-opacity="0.3" stroke-width="2.6" fill="none" stroke-linecap="round"/>
          ${nubs}
          ${lowerFront}
        </g>
        <g class="pl-title-plant__tip" style="transform-origin:96px 150px">
        ${tipFront}
        <g class="pl-title-plant__bud" data-part="bud" transform="translate(90 86) rotate(-7)">
          <path d="M0 4 C-10 -3 -12 -20 -4 -31 C-1 -35 1 -35 4 -31 C11 -20 9 -3 0 4 Z"
                fill="url(#pl-leaf-d)" stroke="var(--pl-leaf-edge, #2c4512)"
                stroke-opacity="0.18" stroke-width="1"/>
          <path d="M0 -2 C-5 -12 -5 -23 -1 -30" fill="none" stroke="var(--pl-leaf-vein, #2c4512)"
                stroke-opacity="0.26" stroke-width="1" stroke-linecap="round"/>
          <path d="M-1 3 C-9 6 -16 3 -20 -3 C-12 -8 -4 -6 -1 3 Z" fill="url(#pl-leaf-b)"/>
          <path d="M1 3 C9 7 16 4 20 -2 C12 -7 4 -6 1 3 Z" fill="url(#pl-leaf-a)"/>
        </g>
        </g>
      </g>
    </svg>`;
}

export function createTitlePlant(options: TitlePlantOptions): TitlePlant {
  installStyles();

  const element = document.createElement('div');
  element.className = 'pl-title-plant';
  // Decorative, not a control: focusing it was what let the browser paint a
  // highlight around the mascot the moment it was clicked.
  element.setAttribute('role', 'presentation');
  element.setAttribute('aria-hidden', 'true');
  element.innerHTML = plantMarkup() + rootsMarkup();

  const leaves = element.querySelector<SVGGElement>('.pl-title-plant__leaves');
  const lower = element.querySelector<SVGGElement>('.pl-title-plant__lower');
  const tip = element.querySelector<SVGGElement>('.pl-title-plant__tip');
  const bud = element.querySelector<SVGGElement>('.pl-title-plant__bud');
  const leafGroups = [...element.querySelectorAll<SVGGElement>('.pl-title-plant__leaf')];
  const roots = element.querySelector<SVGSVGElement>('.pl-title-plant__roots');
  // The soil is underground, and it is a part of the drawing like any other.
  roots?.setAttribute('data-part', 'root');

  let motion: PlantMotionState = createPlantMotion();
  let raf = 0;
  let lastMs = 0;
  let destroyed = false;
  /** The part being answered right now, if any. */
  let tap: { response: TapResponse; startMs: number; index: number } | null = null;
  /** A bend held by the pointer, in degrees. */
  let bendDeg = 0;
  /** Where the plant was let go from, and when, so it can spring back. */
  let release: { fromDeg: number; startMs: number } | null = null;
  let dragStartX: number | null = null;
  let lastTapAt = 0;
  let shudderStartMs = 0;
  /** Where the canopy would like to lean, and where it is leaning. */
  let leanWanted = 0;
  let lean = 0;
  let gustAtMs = 0;
  let nextGustMs = 0;

  const tick = (nowMs: number): void => {
    if (destroyed || !active) return;
    const dt = lastMs === 0 ? 16 : Math.min(64, nowMs - lastMs);
    lastMs = nowMs;
    advanceSway(motion, dt, options.swayMs);

    const sway = options.reducedMotion ? 0 : swayOffset(motion) * 1.7;
    const scale = reactionScale(motion, nowMs, options.reactMs);

    // One reaction at a time: whatever part was touched answers, then is cleared.
    let canopyKick = 0;
    if (tap) {
      const elapsed = nowMs - tap.startMs;
      const angle = swingAngle(elapsed, tap.response);
      if (elapsed >= tap.response.durationMs) {
        if (tap.response.part === 'leaf') leafGroups[tap.index]?.removeAttribute('style');
        if (tap.response.part === 'bud') bud?.removeAttribute('style');
        if (tap.response.part === 'root') roots?.removeAttribute('style');
        tap = null;
      } else if (tap.response.part === 'leaf') {
        const group = leafGroups[tap.index];
        if (group) {
          const sign = leafSwingSign(tap.index);
          // The origin is already the leaf's attachment (set in the drawing), so a
          // flick rotates it about the stem instead of sideways through the air.
          group.style.transformBox = 'view-box';
          group.style.transform = `rotate(${(angle * sign).toFixed(2)}deg)`;
        }
      } else if (tap.response.part === 'stem') {
        canopyKick += angle;
      } else if (tap.response.part === 'bud') {
        if (bud) {
          bud.style.transformBox = 'view-box';
          bud.style.transformOrigin = '90px 90px';
          bud.style.transform = `rotate(${angle.toFixed(2)}deg)`;
        }
      } else if (roots) {
        roots.style.transform = `rotate(${(angle * 0.6).toFixed(2)}deg)`;
      }
    }

    if (options.reducedMotion) {
      lean = 0;
      leanWanted = 0;
    } else {
      // The plant notices a pointer that is over it, and eases back when it goes.
      lean += (leanWanted - lean) * Math.min(1, dt / 180);
      // A breeze passes every so often. It is ambient, not an answer to anything.
      if (nextGustMs === 0) nextGustMs = nextGustAt(nowMs);
      if (nowMs >= nextGustMs) {
        gustAtMs = nowMs;
        nextGustMs = nextGustAt(nowMs);
      }
      canopyKick += gustAngle(nowMs, gustAtMs);
    }

    // A double tap rattles the whole plant once.
    if (nowMs < shudderStartMs + 900) {
      const t = (nowMs - shudderStartMs) / 900;
      canopyKick += Math.sin(t * Math.PI * 9) * 3.4 * (1 - t) ** 2;
    }

    // The bend: held by the pointer, or springing back from where it was let go.
    if (release) {
      const elapsed = nowMs - release.startMs;
      if (elapsed >= 1600) release = null;
      bendDeg = release ? releaseAngle(elapsed, release.fromDeg) : 0;
    }
    const lowerAngle = bendDeg * BEND_LOWER_SHARE;
    const tipAngle = bendDeg * BEND_TIP_SHARE;

    if (leaves) {
      leaves.style.transform = `rotate(${(sway + canopyKick + lean).toFixed(2)}deg) scale(${scale.toFixed(3)})`;
    }
    if (lower) {
      lower.style.transformBox = 'view-box';
      lower.style.transform = `rotate(${lowerAngle.toFixed(2)}deg)`;
    }
    if (tip) {
      tip.style.transformBox = 'view-box';
      tip.style.transform = `rotate(${tipAngle.toFixed(2)}deg)`;
    }

    raf = requestAnimationFrame(tick);
  };

  /** One part answers for itself. Rate-limited so holding a finger cannot stack. */
  const tapPart = (part: PlantPart, index: number): void => {
    const now = performance.now();
    if (now - lastTapAt < 70) return;
    lastTapAt = now;
    tap = { response: tapResponse(part), startMs: now, index };
    if (part === 'bud') {
      element.classList.add('is-budding');
      window.setTimeout(() => element.classList.remove('is-budding'), 700);
    }
    const result = reactToTouch(motion, now, options.reactMs, options.cooldownMs);
    if (!result.reacted) return;
    motion = result.state;
    options.onTouch?.(motion.reactCount);
  };

  // Pointers are handled here, not by a click listener: the top of the plant is a
  // drag surface and the rest of it is a set of things to tap, and a click cannot
  // tell those apart.
  //
  // A press is a tap until it moves. The bud and the tender leaves live at the top
  // of the drawing, exactly where a bend has to start, so a fixed "grab zone" made
  // them untappable - the first version began a bend on any press above 42% of the
  // plant, and tapping the bud only bent it. The gesture is decided by what the
  // pointer does next: travel means a bend, letting go where it started means the
  // part under it answers.
  const DRAG_SLOP_PX = 6;
  let pressed: { part: PlantPart; index: number; x: number; y: number } | null = null;

  const beginBend = (event: PointerEvent, fromX: number): void => {
    dragStartX = fromX;
    bendDeg = 0;
    release = null;
    element.classList.add('is-bending');
    // A capture can fail (an unknown pointer id, a synthetic event in a test); the
    // drag still works while the pointer stays over the plant, so this must never
    // be the thing that breaks it.
    try {
      element.setPointerCapture?.(event.pointerId);
    } catch {}
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    const target = (event.target as Element | null)?.closest?.('[data-part]') as Element | null;
    if (!target) return;
    const { part, index } = partFromDataset((target as HTMLElement).dataset);
    pressed = { part, index, x: event.clientX, y: event.clientY };
    // The plant owns this gesture; the scene behind it must not also pan.
    event.stopPropagation();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (dragStartX === null) {
      // Over the drawing rather than dragging it: lean toward the pointer.
      const box = element.getBoundingClientRect();
      leanWanted = leanTowardPointer(event.clientX, box.left + box.width / 2, box.width / 2);
    }
    if (dragStartX !== null) {
      const box = element.getBoundingClientRect();
      bendDeg = bendDegrees(event.clientX - dragStartX, Math.max(24, box.width * 0.5));
      event.stopPropagation();
      return;
    }
    if (!pressed) return;
    if (Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < DRAG_SLOP_PX) return;
    beginBend(event, pressed.x);
    pressed = null;
    event.stopPropagation();
  };

  const endDrag = (event: PointerEvent): void => {
    if (dragStartX !== null) {
      dragStartX = null;
      element.classList.remove('is-bending');
      try {
        element.releasePointerCapture?.(event.pointerId);
      } catch {}
      // Let go: the plant springs back past straight and settles.
      release = { fromDeg: bendDeg, startMs: performance.now() };
      pressed = null;
      event.stopPropagation();
      return;
    }
    // A press that never travelled: the part under it answers.
    if (pressed) {
      tapPart(pressed.part, pressed.index);
      pressed = null;
      event.stopPropagation();
    }
  };

  const onDoubleTap = (): void => {
    shudderStartMs = performance.now();
  };

  const onPointerLeave = (): void => {
    leanWanted = 0;
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', endDrag);
  element.addEventListener('pointercancel', endDrag);
  element.addEventListener('pointerleave', onPointerLeave);
  element.addEventListener('dblclick', onDoubleTap);
  raf = requestAnimationFrame(tick);

  let active = true;

  return {
    element,
    setActive(next: boolean): void {
      if (active === next) return;
      active = next;
      if (next) {
        lastMs = 0;
        raf = requestAnimationFrame(tick);
      } else {
        cancelAnimationFrame(raf);
      }
    },
    react(part: PlantPart = 'stem', index = 0): void {
      tapPart(part, index);
    },
    destroy(): void {
      destroyed = true;
      cancelAnimationFrame(raf);
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', endDrag);
      element.removeEventListener('pointercancel', endDrag);
      element.removeEventListener('dblclick', onDoubleTap);
      element.remove();
    },
  };
}
