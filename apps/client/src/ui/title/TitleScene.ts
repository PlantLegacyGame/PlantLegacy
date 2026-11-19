/**
 * The 2D cutout world behind the title.
 *
 * Flat ground, like Terraria and Growtopia: a level horizon, silhouettes stacked
 * on it, and nothing curved. The horizon is a single CSS variable
 * (`--pl-horizon`) so the hills stand on exactly the same line as the plant.
 *
 * The sky runs a full day-night cycle: `setPalette` recolours every layer and
 * moves the sun and moon across the sky box above the horizon.
 */

import { TOUCH_TITLE_HINT } from '../touchCopy.ts';
import { cloudArt } from './cloudArt.ts';
import { type CelestialBody, lerpHex, type TitlePalette } from './dayCycle.ts';
import {
  clampParallax,
  layerOffset,
  PARALLAX_ORIGIN,
  type ParallaxConfig,
  type ParallaxPoint,
  parallaxTarget,
  stepParallax,
} from './parallax.ts';

export type SceneLayerId = 'far';

const LAYER_ORDER: SceneLayerId[] = ['far'];

export interface TitleSceneOptions {
  /** Where the "H hides the menu" hint is mounted. Defaults to the scene. */
  hintHost?: HTMLElement;
  /** Where palette/sun variables are written. Defaults to the scene element. */
  varsTarget?: HTMLElement;
  parallax: ParallaxConfig;
  depth: Record<string, number>;
  settleMs: number;
  reducedMotion: boolean;
  hintFadeMs: number;
  onToggleUi: () => void;
}

export interface TitleScene {
  element: HTMLElement;
  setPalette(palette: TitlePalette): void;
  setCelestial(sun: CelestialBody, moon: CelestialBody): void;
  /** Enable or disable the H shortcut (off while a panel or modal owns the input). */
  setToggleEnabled(enabled: boolean): void;
  /**
   * Run or stop the scene's animation. The title stays mounted while the world is
   * being played; leaving its rAF loop running spends frame time on a hidden page.
   */
  setActive(active: boolean): void;
  destroy(): void;
}

const STYLE_ID = 'pl-scene-style';

const STYLE = `
  .pl-scene {
    position: absolute;
    inset: 0;
    isolation: isolate;
    overflow: hidden;
    /* The scene is the drag surface. It inherited pointer-events none from the
       world layer above it, and that property inherits: the drag handlers on this
       element could never fire, so the background could not be dragged at all -
       only the plant, which opts back in for itself. The interface layer is
       stacked above this and its own controls still take their clicks. */
    pointer-events: auto;
    /* A drag surface, not a scrollable page: pan-y let a horizontal touch drag
       scroll instead of moving the scene. */
    touch-action: none;
    cursor: grab;
    background: linear-gradient(
      180deg,
      var(--pl-sky-high, #4d7fa8) 0%,
      var(--pl-sky-mid, #7fa8c4) 46%,
      var(--pl-sky-low, #c6d8d8) 100%
    );
  }
  .pl-scene.is-dragging { cursor: grabbing; }

  /* Sky box: everything above the horizon, in one coordinate space. */
  .pl-scene__sky {
    position: absolute;
    inset: 0 0 auto 0;
    height: var(--pl-horizon, 54%);
    overflow: hidden;
    pointer-events: none;
  }
  .pl-scene__stars {
    position: absolute;
    inset: 0;
    opacity: var(--pl-star, 0);
    transition: opacity 1200ms linear;
  }
  /* A faint band of unresolved stars, rotated across the sky. */
  .pl-scene__milkyway {
    position: absolute;
    left: -20%;
    top: -10%;
    width: 140%;
    height: 62%;
    transform: rotate(-18deg);
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(196, 214, 255, 0.5) 34%,
      rgba(214, 226, 255, 0.7) 50%,
      rgba(196, 214, 255, 0.45) 68%,
      transparent 100%
    );
    filter: blur(14px);
    opacity: var(--pl-milkyway, 0);
    pointer-events: none;
  }
  /* A wide warm lobe sitting on the horizon under the sun. */
  .pl-scene__bloom {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(var(--pl-horizon, 54%) - 20%);
    height: 26%;
    z-index: 5;
    background: radial-gradient(
      ellipse 46% 100% at var(--pl-sun-x, 60%) 100%,
      color-mix(in srgb, var(--pl-sun-core, #fff2c4) 78%, transparent) 0%,
      color-mix(in srgb, var(--pl-sun-core, #fff2c4) 34%, transparent) 42%,
      transparent 78%
    );
    /* Two grades, one lobe: the hour's bloom and the sun's own glow. With the
       halo gone from the disc, this is where the sky shows the sun - a wide band
       of light on the horizon, which is what a low sun actually does to the sky. */
    opacity: calc(var(--pl-bloom, 0) * 0.78 + var(--pl-sun-glow, 0.3) * 0.22);
    mix-blend-mode: screen;
    pointer-events: none;
  }
  /* Air, not fog: a band of pale sky lying on the hills. */
  .pl-scene__haze {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(var(--pl-horizon, 54%) - 9%);
    height: 13%;
    z-index: 6;
    background: linear-gradient(
      180deg,
      transparent 0%,
      color-mix(in srgb, var(--pl-sky-low, #c6d8d8) 70%, transparent) 62%,
      transparent 100%
    );
    opacity: var(--pl-haze, 0.4);
    pointer-events: none;
  }
  .pl-scene__star {
    position: absolute;
    background: #eaf0ff;
    border-radius: 50%;
    animation: pl-star-twinkle var(--twinkle-duration, 4s) ease-in-out infinite;
    animation-delay: var(--twinkle-delay, 0s);
  }
  /* First-magnitude star: a cross of diffraction spikes around a bright core. */
  .pl-scene__star--bright::before,
  .pl-scene__star--bright::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    background: linear-gradient(90deg, transparent, #f2f6ff, transparent);
    transform: translate(-50%, -50%);
  }
  .pl-scene__star--bright::before { width: 13px; height: 1px; }
  .pl-scene__star--bright::after {
    width: 1px;
    height: 13px;
    background: linear-gradient(180deg, transparent, #f2f6ff, transparent);
  }
  @keyframes pl-star-twinkle {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.45; }
  }
  @keyframes pl-star-twinkle-bright {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.8; transform: scale(0.82); }
  }
  .pl-scene__star--bright { animation-name: pl-star-twinkle-bright; }
  @media (prefers-reduced-motion: reduce) {
    .pl-scene__star { animation: none; }
  }
  .pl-scene__celestial {
    position: absolute;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    transition: opacity 600ms linear;
    pointer-events: none;
  }
  /* A disc with an edge, and nothing around it.
     Three things made this look like a lamp with a halo: the body faded out over
     its own outer 40%, the box-shadow added a ring the size of the blur, and a
     400%-wide ::before painted a second, wider ring on top of the sky. A body in
     the sky has one edge. The light in this scene comes from the sky's own wash
     (the sun-wash variable), which is graded by hour, not from a halo stuck to a
     disc. */
  .pl-scene__sun {
    width: clamp(54px, 6.6vw, 96px);
    aspect-ratio: 1;
    background: radial-gradient(
      circle,
      #fffefa 0 62%,
      color-mix(in srgb, var(--pl-sun-core, #fff2c4) 92%, #ffffff) 84%,
      color-mix(in srgb, var(--pl-sun-core, #fff2c4) 74%, transparent) 97%,
      transparent 100%
    );
    box-shadow: none;
  }
  /* No ::before bloom, no ::after flare. Both were rings wider than the body. */
  /* The moon is a body, not a lamp: a small halo of real air and nothing else. */
  .pl-scene__moon {
    width: clamp(38px, 4.8vw, 68px);
    aspect-ratio: 1;
    background: none;
    box-shadow: none;
  }
  /* The moon had the same 320%-wide halo as the sun. Removed with it: a ring of
     light around the body is the one thing the sky does not need twice. */
  .pl-scene__moon svg { display: block; width: 100%; height: 100%; }
  /* Maria have to survive being 40 px across: too low and the disc reads as a
     blank circle, too high and it reads as a golf ball. */
  .pl-scene__moon__mare { opacity: calc(0.34 + var(--pl-moon-wash, 0) * 0.46); }

  .pl-scene__clouds { position: absolute; inset: 0; pointer-events: none; }
  /* Cirrus: higher, thinner and slower to pass, which reads as altitude. */
  .pl-scene__cloud--high { filter: blur(0.6px); }
  .pl-scene__cloud--high svg { transform: scaleY(0.62); transform-origin: 50% 100%; }
  .pl-scene__cloud {
    position: absolute;
    animation: pl-cloud-drift 120s ease-in-out infinite alternate;
    will-change: transform;
  }
  .pl-scene__cloud svg { display: block; width: 100%; height: auto; }
  @keyframes pl-cloud-drift {
    from { transform: translate3d(-2.2%, 0, 0); }
    to { transform: translate3d(2.2%, 0, 0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .pl-scene__cloud { animation: none; }
  }

  /* Ground layers stand on the horizon, so they never need to know the viewport. */
  .pl-scene__layer {
    position: absolute;
    left: -6%;
    right: -6%;
    bottom: calc(100% - var(--pl-horizon, 54%));
    will-change: transform;
  }
  .pl-scene__layer--far { height: 26vh; }
  .pl-scene__art { width: 100%; height: 100%; display: block; }

  .pl-scene__hint {
    position: absolute;
    left: 50%;
    bottom: calc(10px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    font-size: var(--hud-font-sm, 0.68rem);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-dim, #9a937a);
    opacity: 0.75;
    transition: opacity 900ms ease;
    z-index: 4;
    pointer-events: none;
    user-select: none;
    white-space: nowrap;
  }
  .pl-scene__hint.is-faded { opacity: 0.32; }
  @media (prefers-reduced-motion: reduce) {
    .pl-scene__layer { transition: none; }
    .pl-scene__stars, .pl-scene__celestial { transition: none; }
  }
`;

function installStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}

/** Far hills: two flat-bottomed ridges, no curves at the base. */
function farArt(): string {
  // Ridges, not a sawtooth. Evenly spaced triangles of equal height read as a
  // pattern; hills have a long shoulder, a peak that is not in the middle and a
  // dip beside it. Each crest is a quadratic pair, so the ridge curves the way
  // land does, and the rim is the same path stroked once: a lit edge is what
  // separates one ridge from the next when the colours are this close.
  const farRidge =
    'M0 158 Q110 108 210 128 Q300 148 378 104 Q456 60 540 96 Q622 132 702 112 ' +
    'Q790 90 860 130 Q932 168 1010 132 Q1088 94 1168 120 Q1248 144 1328 106 ' +
    'Q1408 66 1490 108 Q1546 130 1600 150';
  const nearRidge =
    'M0 208 Q140 168 262 188 Q382 206 470 172 Q560 138 652 170 Q732 198 820 182 ' +
    'Q920 164 1010 190 Q1100 216 1190 186 Q1280 156 1370 184 Q1458 212 1530 196 ' +
    'Q1570 188 1600 194';
  return `
    <svg class="pl-scene__art" viewBox="0 0 1600 260" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <path d="${farRidge} L1600 260 L0 260 Z" fill="var(--pl-hill-far)"/>
      <path d="${farRidge}" fill="none" stroke="var(--pl-hill-rim, #9fb8a0)" stroke-width="2"
            stroke-opacity="var(--pl-hill-rim-opacity, 0.35)" stroke-linecap="round"/>
      <path d="${nearRidge} L1600 260 L0 260 Z" fill="var(--pl-hill-near)"/>
      <path d="${nearRidge}" fill="none" stroke="var(--pl-hill-rim, #9fb8a0)" stroke-width="2"
            stroke-opacity="var(--pl-hill-rim-opacity, 0.35)" stroke-linecap="round"/>
    </svg>`;
}

const ART: Record<SceneLayerId, () => string> = { far: farArt };

/**
 * The moon's surface.
 *
 * Its light comes from the same place as everything else's: the lifted limb faces
 * the sum of the scene's light, the far side falls away, and a handful of maria
 * break up the disc so it is a body rather than a hole in the sky. The maria are
 * soft and low contrast - a high-contrast moon at 40 px reads as a golf ball.
 */
function moonArt(): string {
  return `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <defs>
      <radialGradient id="pl-moon-body" cx="36%" cy="31%" r="76%">
        <stop offset="0" stop-color="var(--pl-moon-core, #fbfcff)"/>
        <stop offset="0.55" stop-color="var(--pl-moon-mid, #dfe6f8)"/>
        <stop offset="1" stop-color="var(--pl-moon-shade, #a9b4cb)"/>
      </radialGradient>
      <radialGradient id="pl-moon-limb" cx="50%" cy="50%" r="50%">
        <stop offset="0.74" stop-color="rgba(14,20,34,0)"/>
        <stop offset="1" stop-color="rgba(14,20,34,0.5)"/>
      </radialGradient>
      <filter id="pl-moon-soft" x="-25%" y="-25%" width="150%" height="150%">
        <feGaussianBlur stdDeviation="1.1"/>
      </filter>
    </defs>
    <circle cx="50" cy="50" r="50" fill="url(#pl-moon-body)"/>
    <g class="pl-scene__moon__mare" fill="var(--pl-moon-mare, #8e9ab4)" filter="url(#pl-moon-soft)">
      <ellipse cx="37" cy="35" rx="15" ry="11"/>
      <ellipse cx="63" cy="29" rx="9" ry="7"/>
      <ellipse cx="45" cy="62" rx="12" ry="9"/>
      <ellipse cx="69" cy="57" rx="7" ry="5"/>
      <ellipse cx="29" cy="54" rx="5" ry="4"/>
      <ellipse cx="56" cy="44" rx="6" ry="4"/>
    </g>
    <circle cx="50" cy="50" r="49.2" fill="url(#pl-moon-limb)"/>
  </svg>`;
}

function starField(): string {
  const stars: string[] = [];
  // Deterministic placement: random-looking, identical on every load.
  let seed = 1337;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < 90; i += 1) {
    const x = next() * 100;
    const y = next() * 88;
    const opacity = 0.35 + next() * 0.65;
    const twinkle = 3 + next() * 5;
    const delay = -next() * 8;
    // A handful of first-magnitude stars: a bigger point with a thin cross so
    // the field has somewhere for the eye to rest instead of an even sprinkle.
    const bright = i % 11 === 3;
    const cls = bright ? 'pl-scene__star pl-scene__star--bright' : 'pl-scene__star';
    const size = bright ? 3 : 1 + Math.round(next() * 2);
    stars.push(
      `<i class="${cls}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;width:${size}px;height:${size}px;opacity:${opacity.toFixed(2)};--twinkle-duration:${twinkle.toFixed(1)}s;--twinkle-delay:${delay.toFixed(1)}s"></i>`,
    );
  }
  return stars.join('');
}

export function createTitleScene(options: TitleSceneOptions): TitleScene {
  installStyles();

  const root = document.createElement('div');
  root.className = 'pl-scene';
  root.setAttribute('aria-hidden', 'true');
  // Palette and sun variables go on the host, so layers that are siblings of the
  // scene (the light washes over the world) inherit the same values.
  const varsTarget = options.varsTarget ?? root;

  const sky = document.createElement('div');
  sky.className = 'pl-scene__sky';

  const milkyway = document.createElement('div');
  milkyway.className = 'pl-scene__milkyway';
  sky.appendChild(milkyway);

  const stars = document.createElement('div');
  stars.className = 'pl-scene__stars';
  stars.innerHTML = starField();
  sky.appendChild(stars);

  const sun = document.createElement('div');
  sun.className = 'pl-scene__celestial pl-scene__sun';
  sky.appendChild(sun);

  const moon = document.createElement('div');
  moon.className = 'pl-scene__celestial pl-scene__moon';
  // The moon is a body, not a white circle: a lit limb, a darker far side, and
  // maria. Gradients inside the disc are what stop it reading as a sticker.
  moon.innerHTML = moonArt();
  sky.appendChild(moon);

  const clouds = document.createElement('div');
  clouds.className = 'pl-scene__clouds';
  // Two heights of cloud: cumulus near the horizon and a thin cirrus sheet above
  // it. One layer of similar shapes reads as wallpaper; the height difference is
  // what makes the sky feel deep.
  const cloudLayout: Array<{
    left: number;
    top: number;
    width: number;
    seed: number;
    duration: number;
    delay: number;
    opacity: number;
    layer: 'bank' | 'high';
  }> = [
    {
      left: -4,
      top: 30,
      width: 34,
      seed: 3,
      duration: 138,
      delay: 0,
      opacity: 0.94,
      layer: 'bank',
    },
    {
      left: 56,
      top: 46,
      width: 20,
      seed: 4,
      duration: 116,
      delay: -22,
      opacity: 0.86,
      layer: 'bank',
    },
    {
      left: 26,
      top: 58,
      width: 15,
      seed: 6,
      duration: 164,
      delay: -48,
      opacity: 0.72,
      layer: 'bank',
    },
    {
      left: 74,
      top: 62,
      width: 28,
      seed: 8,
      duration: 126,
      delay: -12,
      opacity: 0.9,
      layer: 'bank',
    },
    {
      left: 2,
      top: 68,
      width: 22,
      seed: 9,
      duration: 152,
      delay: -66,
      opacity: 0.7,
      layer: 'bank',
    },
    {
      left: 12,
      top: 10,
      width: 30,
      seed: 5,
      duration: 208,
      delay: -70,
      opacity: 0.42,
      layer: 'high',
    },
    {
      left: 48,
      top: 20,
      width: 26,
      seed: 7,
      duration: 236,
      delay: -140,
      opacity: 0.34,
      layer: 'high',
    },
    {
      left: 70,
      top: 6,
      width: 22,
      seed: 11,
      duration: 262,
      delay: -30,
      opacity: 0.3,
      layer: 'high',
    },
  ];
  for (const cloud of cloudLayout) {
    const el = document.createElement('div');
    el.className = `pl-scene__cloud pl-scene__cloud--${cloud.layer}`;
    el.style.left = `${cloud.left}%`;
    el.style.top = `${cloud.top}%`;
    el.style.width = `${cloud.width}%`;
    el.style.opacity = String(cloud.opacity);
    el.style.animationDuration = `${cloud.duration}s`;
    el.style.animationDelay = `${cloud.delay}s`;
    el.innerHTML = cloudArt(cloud.seed, cloud.layer);
    clouds.appendChild(el);
  }
  sky.appendChild(clouds);
  root.appendChild(sky);

  // Light in the air at the horizon: a warm bloom under the sun and a thin pale
  // haze band where the sky meets the hills. Without these the hills meet the sky
  // on a hard line and the whole scene reads as flat cutouts.
  const bloom = document.createElement('div');
  bloom.className = 'pl-scene__bloom';
  root.appendChild(bloom);

  const haze = document.createElement('div');
  haze.className = 'pl-scene__haze';
  root.appendChild(haze);

  const layers = new Map<SceneLayerId, HTMLElement>();
  for (const id of LAYER_ORDER) {
    const layer = document.createElement('div');
    layer.className = `pl-scene__layer pl-scene__layer--${id}`;
    layer.style.zIndex = String(LAYER_ORDER.indexOf(id) + 1);
    layer.innerHTML = ART[id]();
    root.appendChild(layer);
    layers.set(id, layer);
  }

  const hint = document.createElement('div');
  hint.className = 'pl-scene__hint';
  // A phone has no H. The same line stays in the same place, but it names the two
  // things a finger can actually do here instead of a key that does not exist.
  // The words are not written here: they belong to the phone copy, one module
  // that the Hints card and the Controls tab read as well.
  const fingerLayout =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  hint.textContent = fingerLayout ? TOUCH_TITLE_HINT : 'H — hide menu';
  // The hint belongs to the interface, not to the painting: inside the scene it
  // painted underneath the foreground blades and its contrast depended on where
  // they happened to be.
  (options.hintHost ?? root).appendChild(hint);

  const depthOf = (id: SceneLayerId): number => {
    const configured = options.depth[id];
    return typeof configured === 'number' ? configured : 0.3;
  };

  let state: ParallaxPoint = { ...PARALLAX_ORIGIN };
  let draft: ParallaxPoint | null = null;
  let pointer: ParallaxPoint | null = null;
  let dragStart: { x: number; y: number; base: ParallaxPoint } | null = null;
  let frame = 0;
  let lastFrameMs = 0;
  let destroyed = false;

  const apply = (): void => {
    for (const id of LAYER_ORDER) {
      const layer = layers.get(id);
      if (!layer) continue;
      const offset = layerOffset(state, depthOf(id));
      layer.style.transform = `translate3d(${offset.x.toFixed(2)}px, ${offset.y.toFixed(2)}px, 0)`;
    }
  };

  const tick = (nowMs: number): void => {
    if (destroyed || !active) return;
    const dt = lastFrameMs === 0 ? 16 : Math.min(64, nowMs - lastFrameMs);
    lastFrameMs = nowMs;
    state = stepParallax(
      state,
      parallaxTarget(draft, pointer, options.parallax),
      dt,
      options.settleMs,
    );
    apply();
    frame = requestAnimationFrame(tick);
  };

  const pointerOffset = (event: PointerEvent): ParallaxPoint => {
    const rect = root.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { ...PARALLAX_ORIGIN };
    return {
      x: ((event.clientX - rect.left) / rect.width - 0.5) * 2 * options.parallax.dragPx,
      y: ((event.clientY - rect.top) / rect.height - 0.5) * 2 * options.parallax.dragPx,
    };
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    dragStart = { x: event.clientX, y: event.clientY, base: { ...state } };
    draft = { ...state };
    root.classList.add('is-dragging');
    // Capture is an optimisation, not the mechanism: if it fails the drag still
    // continues while the pointer is over the scene.
    try {
      root.setPointerCapture?.(event.pointerId);
    } catch {}
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (dragStart) {
      draft = clampParallax(
        {
          x: dragStart.base.x + (event.clientX - dragStart.x),
          y: dragStart.base.y + (event.clientY - dragStart.y),
        },
        options.parallax.dragPx,
      );
      return;
    }
    pointer = pointerOffset(event);
  };

  const endDrag = (event: PointerEvent): void => {
    if (!dragStart) return;
    dragStart = null;
    draft = null;
    root.classList.remove('is-dragging');
    try {
      root.releasePointerCapture?.(event.pointerId);
    } catch {}
  };

  let toggleEnabled = true;
  let active = true;
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!toggleEnabled) return;
    if (event.key !== 'h' && event.key !== 'H') return;
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return;
    }
    event.preventDefault();
    options.onToggleUi();
  };

  const parallaxOn = options.parallax.enabled && !options.reducedMotion;
  if (parallaxOn) {
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerup', endDrag);
    root.addEventListener('pointercancel', endDrag);
    root.addEventListener('pointerleave', (event) => {
      if (!dragStart) pointer = null;
      endDrag(event);
    });
    window.addEventListener('keydown', onKeyDown);
    frame = requestAnimationFrame(tick);
  } else {
    window.addEventListener('keydown', onKeyDown);
    apply();
  }

  if (options.reducedMotion) hint.classList.add('is-faded');
  const fadeTimer = options.reducedMotion
    ? 0
    : window.setTimeout(() => hint.classList.add('is-faded'), Math.max(0, options.hintFadeMs));

  const paletteVars: Array<[keyof TitlePalette, string]> = [
    ['skyHigh', '--pl-sky-high'],
    ['skyMid', '--pl-sky-mid'],
    ['skyLow', '--pl-sky-low'],
    ['cloud', '--pl-cloud'],
    ['hillFar', '--pl-hill-far'],
    ['hillNear', '--pl-hill-near'],
    ['canopyBack', '--pl-canopy-back'],
    ['canopyFront', '--pl-canopy-front'],
    ['grass', '--pl-grass'],
    ['frond', '--pl-frond'],
    ['groundTop', '--pl-ground-top'],
    ['groundBody', '--pl-ground-body'],
    ['soilEdge', '--pl-soil-edge'],
    ['sun', '--pl-sun-core'],
  ];

  return {
    element: root,

    setPalette(palette: TitlePalette): void {
      for (const [key, cssVar] of paletteVars) {
        const value = palette[key];
        if (typeof value === 'string') varsTarget.style.setProperty(cssVar, value);
      }
      // Lit cloud tops: the cloud colour pulled toward the sun, so dusk tops warm
      // up with the light instead of staying white.
      varsTarget.style.setProperty('--pl-cloud-light', lerpHex(palette.cloud, palette.sun, 0.45));
      // Underside of a cloud: the body pushed toward shadow, so it has volume.
      varsTarget.style.setProperty(
        '--pl-cloud-shade',
        lerpHex(palette.cloud, palette.hillFar, 0.35),
      );
      // The moon is lit by the same sun the rest of the palette is: a pale core, a
      // cooler far side, and maria that stay readable at 40 px.
      varsTarget.style.setProperty('--pl-moon-core', lerpHex(palette.sun, '#ffffff', 0.4));
      varsTarget.style.setProperty('--pl-moon-mid', lerpHex(palette.sun, palette.skyHigh, 0.35));
      varsTarget.style.setProperty('--pl-moon-shade', lerpHex(palette.sun, palette.skyHigh, 0.62));
      varsTarget.style.setProperty('--pl-moon-mare', lerpHex(palette.skyHigh, palette.sun, 0.42));
      // The cut soil: a lit lip on the surface, the body darkening with depth, and
      // roots that are bone by the surface and take the soil's colour as they go.
      varsTarget.style.setProperty('--pl-soil-lip', lerpHex(palette.soilEdge, palette.sun, 0.34));
      varsTarget.style.setProperty('--pl-soil-deep', lerpHex(palette.groundBody, '#000000', 0.38));
      varsTarget.style.setProperty(
        '--pl-root',
        lerpHex(lerpHex('#e8dac0', palette.groundTop, 0.16), palette.sun, 0.18),
      );
      varsTarget.style.setProperty('--pl-root-tip', lerpHex('#cbb99b', palette.groundTop, 0.42));
      // The ink a root is drawn against: the darkest soil, so a pale root reads as
      // lying in the dirt rather than printed on it.
      varsTarget.style.setProperty('--pl-root-ink', lerpHex(palette.groundBody, '#000000', 0.55));
      // Hill crests catch the light: the ridge colour pulled toward the sun, so
      // the two ridges separate at dusk and close up again at night.
      varsTarget.style.setProperty('--pl-hill-rim', lerpHex(palette.hillFar, palette.sun, 0.5));
      varsTarget.style.setProperty(
        '--pl-hill-rim-opacity',
        (0.22 + (palette.star > 0.5 ? 0.06 : 0.24)).toFixed(3),
      );
      varsTarget.style.setProperty('--pl-star', String(palette.star));
      varsTarget.style.setProperty('--pl-sun-glow', String(palette.sunGlow));
      varsTarget.style.setProperty('--pl-plant-dim', String(palette.plantDim));
    },

    setToggleEnabled(enabled: boolean): void {
      toggleEnabled = enabled;
    },

    setActive(next: boolean): void {
      if (active === next) return;
      active = next;
      if (next && parallaxOn) {
        lastFrameMs = 0;
        frame = requestAnimationFrame(tick);
      } else {
        cancelAnimationFrame(frame);
      }
    },

    setCelestial(sunBody: CelestialBody, moonBody: CelestialBody): void {
      // The arc runs edge to edge, so a disc centred on x = 0 is half outside the
      // sky and the frame cuts it. Inset the ends by half a disc so it rises and
      // sets whole, and move the wash with it: light belongs in the sky, not off
      // the edge.
      const inset = (x: number): number => 5 + Math.min(1, Math.max(0, x)) * 90;
      // The sky box is exactly the area above the horizon, so a percentage of it
      // is a percentage of the visible sky.
      varsTarget.style.setProperty('--pl-sun-x', `${inset(sunBody.x).toFixed(2)}%`);
      varsTarget.style.setProperty('--pl-sun-y', `${((1 - sunBody.y) * 88).toFixed(2)}%`);
      // The moon lights the world at night, so its position matters as much as
      // the sun's: the cool wash follows it across the sky.
      varsTarget.style.setProperty('--pl-moon-x', `${inset(moonBody.x).toFixed(2)}%`);
      varsTarget.style.setProperty('--pl-moon-y', `${((1 - moonBody.y) * 88).toFixed(2)}%`);
      // Cloud highlights sit on the sun's side of each puff.
      varsTarget.style.setProperty('--pl-cloud-lit-x', `${((sunBody.x - 0.5) * 14).toFixed(1)}px`);
      sun.style.left = `clamp(26px, ${inset(sunBody.x).toFixed(2)}%, calc(100% - 26px))`;
      sun.style.top = `calc(${((1 - sunBody.y) * 100).toFixed(2)}% + 24px)`;
      sun.style.opacity = sunBody.visible ? '1' : '0';
      moon.style.left = `clamp(26px, ${inset(moonBody.x).toFixed(2)}%, calc(100% - 26px))`;
      moon.style.top = `calc(${((1 - moonBody.y) * 100).toFixed(2)}% + 18px)`;
      moon.style.opacity = moonBody.visible ? '1' : '0';
    },

    destroy(): void {
      destroyed = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(fadeTimer);
      window.removeEventListener('keydown', onKeyDown);
      root.remove();
    },
  };
}
