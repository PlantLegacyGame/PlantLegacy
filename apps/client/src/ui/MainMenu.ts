/**
 * The title screen.
 *
 * Not a modal card: a scene. The plant sits on top of the name, the name sits on
 * top of a 2D cutout landscape, and the only things floating over it are the
 * nickname row, Play, Settings and Shop. The account lives in the top right
 * corner as an avatar, because signing in is not the first thing a player should
 * have to do.
 *
 * `render(state)` still drives which surface is visible, so the entry flow
 * machine keeps owning the transitions. This file owns the DOM.
 */

import type { WorldTime } from '../net/worldTime.ts';
import {
  advanceWorldClock,
  applyServerClock,
  shortestDayDelta,
  type WorldClock,
  wrapDayFraction,
} from '../renderers/environment/worldClock.ts';

import type { EntryFlowStateMachine, EntryStep } from './EntryFlowStateMachine.ts';
import { escapeHtml } from './escape.ts';
import { type PlantStatsSummary, plantStatRows } from './plantStats.ts';
import { lerpHex, moonPosition, paletteAt, sunPosition, titleLighting } from './title/dayCycle.ts';
import {
  GROUND_BAND_PX,
  horizonForPane,
  MENU_FOOT_RESERVE_PX,
  mascotMaxWidthPx,
  menuFit,
  PLANT_ART_ASPECT,
} from './title/menuFit.ts';
import { autoDisplayName, resolveDisplayName } from './title/plantName.ts';
import { createTitlePlant, type TitlePlant } from './title/TitlePlant.ts';
import { createTitleScene, type TitleScene } from './title/TitleScene.ts';
import type { UIConfig } from './UIShell.ts';

export interface MainMenuAccount {
  displayName: string;
  username?: string;
}

export interface MainMenuCallbacks {
  /** Play, with the name the player will be known by. */
  onPlay(displayName: string): void;
  onSignIn(username: string, password: string): void;
  onSignUp(username: string, displayName: string, password: string): void;
  onSignInForm(): void;
  onSignUpForm(): void;
  onBack(): void;
  onReseed(): void;
  onSignOut(): void;
  /** Give up on a connection that has not answered. */
  onCancelConnect(): void;
  onSettings(): void;
  onShop(): void;
}

export interface MainMenuOptions {
  callbacks: MainMenuCallbacks;
  /** UI config: title tunables, text scale and the theme tokens. */
  ui: UIConfig;
  mount?: HTMLElement;
  account?: MainMenuAccount | null;
  /** Name to prefill; empty means "suggest one". */
  displayName?: string;
  /** Avatar as a data URL, or null for the default mark. */
  avatar?: string | null;
  /** Day length from the world's own config; wins over the menu fallback. */
  /**
   * The world's hour at boot, read before the menu was built. When it is missing
   * the menu keeps the world hidden until it can ask, so the first frame the
   * player sees is already the right time of day.
   */
  initialTimeOfDay?: number | null;
  cycleLengthS?: number;
  /** Reads the world clock; absent or failing leaves the fallback cycle in charge. */
  fetchWorldTime?: () => Promise<WorldTime | null>;
  /** Called when the player commits a name or a new avatar. */
  onProfileChange?: (profile: { displayName?: string; avatar?: string | null }) => void;
}

/** A few blades and a stone, well out of focus, at the bottom edge. */
const NEAR_ART = `
  <svg viewBox="0 0 1200 160" preserveAspectRatio="none" aria-hidden="true">
    <g fill="var(--pl-near, #14180f)">
      <path d="M-20 160 C40 120 70 80 96 24 C104 70 92 120 70 160 Z"/>
      <path d="M48 160 C96 132 128 96 150 56 C156 100 132 138 108 160 Z"/>
      <path d="M1090 160 C1120 118 1146 96 1186 62 C1178 108 1152 140 1128 160 Z"/>
      <path d="M1150 160 C1178 134 1204 118 1230 96 C1224 128 1204 148 1186 160 Z"/>
      <ellipse cx="980" cy="152" rx="70" ry="26"/>
    </g>
  </svg>`;

const STYLE_ID = 'pl-menu-style';

const STYLE = `
  .pl-menu {
    position: absolute;
    inset: 0;
    overflow: hidden;
    font-family: inherit;
    color: var(--warm-ink, #f0ead6);
    --pl-sky-high: #24303a;
    --pl-sky-mid: #2b3942;
    --pl-sky-low: #1a242b;
    --pl-sun: #e8d9a8;
    --pl-cloud: #cfe0e6;
    --pl-hill-far: #22302a;
    --pl-hill-near: #1b2723;
    --pl-ground: #16201a;
    --pl-trunk: #241d16;
    --pl-canopy-back: #1d3524;
    --pl-canopy-front: #2a4a2d;
    --pl-grass: #2f5130;
    --pl-frond: #1b2f1d;
    --pl-leaf-front: #7db83d;
    --pl-leaf-light: #9ed95c;
    --pl-leaf-back: #426520;
    --pl-stem: #5a902e;
    /* Painted over by the sky cycle every frame; these are the day defaults. */
    --pl-ground-top: #7a5334;
    --pl-ground-body: #553a26;
    --pl-soil-edge: #8b6544;
    --pl-star: 0;
    --pl-sun-glow: 0.34;
    --pl-plant-dim: 1;
    /* Set from ui.title_horizon_fraction; media queries below can still lower it
       on short screens because they set --pl-horizon itself. */
    --pl-horizon: var(--pl-horizon-config, 54%);
    /* How much cut soil shows under the plant before the menu starts. The roots
       hang in it, so the controls must not sit on top of them. */
    --pl-root-band: clamp(52px, 7vw, 84px);
  }
  .pl-menu[hidden] { display: none; }
  /* Contain the scene's layer z-indexes here. Without isolation they compete
     with the menu in the root stacking context, and layers 1-3 (hills, trees,
     grass) painted over the title and buttons - the scene looked like the whole
     screen and the UI was simply behind it. */
  .pl-menu { isolation: isolate; }
  /* The world: landscape, ground and the plant. One layer, below the menu, so
     the plant reads as part of the place rather than a widget on top of it. */
  .pl-menu__world {
    position: absolute;
    inset: 0;
    z-index: 1;
    pointer-events: none;
  }
  .pl-menu__scene { position: absolute; inset: 0; }
  /* Until the world's hour is known the world stays out of sight, so the first
     frame the player sees is the correct time of day, never a jump into it. */
  .pl-menu__world.is-sky-pending { opacity: 0; }
  /* Light over the world. Screen-blended sun glow, multiply-blended night, both
     driven by the palette so the lighting is the sky's, not a fixed overlay. */
  /* Cloud shadows: soft dark shapes drifting over the soil at cloud speed. */
  .pl-menu__cloudshadow {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    mix-blend-mode: multiply;
    opacity: var(--pl-cloud-shadow, 0);
  }
  .pl-menu__cloudshadow i {
    position: absolute;
    display: block;
    border-radius: 50%;
    background: radial-gradient(ellipse at 50% 50%, rgba(0, 0, 0, 0.5), transparent 70%);
    filter: blur(22px);
    animation: pl-shadow-drift 180s ease-in-out infinite alternate;
  }
  .pl-menu__cloudshadow i:nth-child(1) { left: 4%; top: calc(var(--pl-horizon) + 4%); width: 34vw; height: 9vh; }
  .pl-menu__cloudshadow i:nth-child(2) { left: 52%; top: calc(var(--pl-horizon) + 12%); width: 28vw; height: 7vh; animation-duration: 146s; animation-delay: -40s; }
  .pl-menu__cloudshadow i:nth-child(3) { left: 30%; top: calc(var(--pl-horizon) + 20%); width: 40vw; height: 10vh; animation-duration: 212s; animation-delay: -90s; }
  @keyframes pl-shadow-drift {
    from { transform: translate3d(-6%, 0, 0); }
    to { transform: translate3d(6%, 0, 0); }
  }
  /* Near foreground: heavy blur so it reads as depth of field, not detail. */
  .pl-menu__near {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 18%;
    z-index: 2;
    pointer-events: none;
    filter: blur(7px);
    opacity: var(--pl-near-opacity, 0.9);
  }
  .pl-menu__near svg { width: 100%; height: 100%; display: block; }
  /* Vignette: pulls the eye to the middle and makes the frame feel photographed. */
  .pl-menu__vignette {
    position: absolute;
    inset: 0;
    z-index: 4;
    pointer-events: none;
    background: radial-gradient(
      ellipse 78% 72% at 50% 46%,
      transparent 42%,
      rgba(0, 0, 0, 0.32) 78%,
      rgba(0, 0, 0, 0.55) 100%
    );
    opacity: var(--pl-vignette, 0.7);
  }
  @media (prefers-reduced-motion: reduce) {
    .pl-menu__cloudshadow i { animation: none; }
  }
  .pl-menu__wash {
    position: absolute;
    inset: 0;
    z-index: 3;
    pointer-events: none;
  }
  .pl-menu__wash--sun {
    background: radial-gradient(
      circle at var(--pl-sun-x, 72%) var(--pl-sun-y, 22%),
      rgba(255, 232, 176, 0.85) 0%,
      rgba(255, 198, 128, 0.4) 22%,
      rgba(255, 186, 120, 0.14) 42%,
      transparent 66%
    );
    opacity: var(--pl-sun-wash, 0.5);
    mix-blend-mode: screen;
  }
  /* Moonlight: a cold halo around the moon, so the night has a source. */
  .pl-menu__wash--moon {
    background: radial-gradient(
      circle at var(--pl-moon-x, 30%) var(--pl-moon-y, 40%),
      rgba(198, 216, 255, 0.5) 0%,
      rgba(150, 178, 240, 0.24) 26%,
      rgba(120, 150, 220, 0.1) 46%,
      transparent 68%
    );
    opacity: var(--pl-moon-wash, 0);
    mix-blend-mode: screen;
  }
  .pl-menu__wash--night {
    background: linear-gradient(
      180deg,
      rgba(58, 84, 150, 0.55) 0%,
      rgba(38, 54, 104, 0.5) 55%,
      rgba(24, 34, 66, 0.62) 100%
    );
    opacity: var(--pl-night-wash, 0);
    mix-blend-mode: multiply;
  }

  /* Flat ground: a level soil line under the horizon, no dome, no curve and no
     tile grid - the seams read as lawn blocks, not earth. */
  .pl-menu__stage {
    position: absolute;
    left: 0;
    right: 0;
    top: var(--pl-horizon, 54%);
    bottom: 0;
    pointer-events: none;
    /* Dirt: a soil surface, darker with depth, and pebbles scattered by hand.
       No tile seams - an even grid read as lawn blocks rather than earth. */
    background:
      radial-gradient(circle at 8% 38%, rgba(0, 0, 0, 0.22) 0 2px, transparent 3px),
      radial-gradient(circle at 19% 72%, rgba(0, 0, 0, 0.18) 0 3px, transparent 4px),
      radial-gradient(circle at 31% 26%, rgba(255, 255, 255, 0.07) 0 2px, transparent 3px),
      radial-gradient(circle at 44% 61%, rgba(0, 0, 0, 0.2) 0 2px, transparent 3px),
      radial-gradient(circle at 57% 33%, rgba(0, 0, 0, 0.16) 0 3px, transparent 4px),
      radial-gradient(circle at 68% 78%, rgba(255, 255, 255, 0.06) 0 2px, transparent 3px),
      radial-gradient(circle at 79% 44%, rgba(0, 0, 0, 0.2) 0 2px, transparent 4px),
      radial-gradient(circle at 91% 66%, rgba(0, 0, 0, 0.17) 0 3px, transparent 4px),
      radial-gradient(ellipse 70% 30% at 30% 12%, rgba(0, 0, 0, 0.14), transparent 70%),
      radial-gradient(ellipse 60% 26% at 74% 22%, rgba(0, 0, 0, 0.12), transparent 70%),
      /* Depth: the cut face is lit at its lip and loses the light with every
         layer, so a cross-section reads as thick ground instead of a brown box. */
      linear-gradient(
        180deg,
        var(--pl-ground-top) 0,
        color-mix(in srgb, var(--pl-ground-top) 72%, var(--pl-ground-body)) 9%,
        var(--pl-ground-body) 34%,
        var(--pl-soil-deep, #2a1d15) 100%
      );
    border-top: 3px solid var(--pl-soil-lip, var(--pl-soil-edge));
    box-shadow: inset 0 12px 26px rgba(0, 0, 0, 0.3);
  }
  /* Soil settling around the stem: the cut face darkens where the plant enters it,
     which is what makes the stem look buried rather than stuck on. */
  /* No shadow falls on the soil. The stage is a cut slice of earth seen from the
     side, not a ground plane, so there is no surface for a shadow to land on: an
     ellipse at the stem only ever read as a smudge floating in the dirt. Depth is
     carried by the soil's own layers and by the roots fading as they go down. */

  /* The plant is a thing in the world: centred, feet on the horizon line. */
  .pl-menu__world > .pl-title-plant {
    position: absolute;
    left: 50%;
    top: var(--pl-horizon, 54%);
    transform: translate(-50%, -100%);
    z-index: 2;
  }

  .pl-menu__ui {
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
  }

  /* Everything the player reads sits just below the ground line, on the ground
     itself, with the plant standing above it the way a sign stands in a field. */
  /* The hero's width. It was a flat 380px, which is a phone's width: on a
     2560px screen the title, the name box and the buttons were one narrow
     column in the middle of an empty field, and the menu read as a mobile
     layout on a desktop. It now follows the viewport between a phone's width
     and a desktop column's. */
  .pl-menu { --pl-hero: clamp(380px, 30vw, 560px); }

  .pl-menu__stack {
    position: absolute;
    left: 50%;
    top: calc(var(--pl-horizon, 54%) + var(--pl-root-band, 0px) + 10px);
    transform: translateX(-50%);
    width: min(var(--pl-hero, 380px), 92vw);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: clamp(8px, 1.4vh, 16px);
    pointer-events: none;
    /* Scaled from its top by fitToPane: the column keeps its ground line and
       shrinks toward it, so a short pane loses nothing off the bottom. */
    transform-origin: top center;
    will-change: transform;
  }
  /* H hides the menu, not the world. The plant is the scene's subject, so it
     stays - and stays clickable - while the chrome fades out. */
  .pl-menu.is-ui-hidden .pl-menu__title,
  .pl-menu.is-ui-hidden .pl-menu__tagline,
  .pl-menu.is-ui-hidden .pl-menu__identity,
  .pl-menu.is-ui-hidden .pl-menu__note,
  .pl-menu.is-ui-hidden .pl-menu__topbar {
    opacity: 0;
    pointer-events: none;
  }
  .pl-menu__title,
  .pl-menu__tagline,
  .pl-menu__note,
  .pl-menu__identity { transition: opacity 240ms ease; }
  /* A card is up: the scene recedes but stays visible behind it. */
  .pl-menu.is-modal-step .pl-menu__title,
  .pl-menu.is-modal-step .pl-menu__tagline,
  .pl-menu.is-modal-step .pl-menu__topbar { opacity: 0.25; }
  .pl-menu.is-modal-step .pl-menu__identity { opacity: 0; pointer-events: none; }
  .pl-menu.is-modal-step .pl-menu__note { opacity: 0.35; }
  /* Only the controls catch the pointer. The rest of the layer stays transparent
     to it, so a drag anywhere on empty menu space still moves the scene. */
  .pl-menu__ui > * { pointer-events: none; }
  .pl-menu__input,
  .pl-menu__btn,
  .pl-menu__profile { pointer-events: auto; }
  /* The layer is transparent to the pointer so drags reach the scene; the plant
     is the exception, because it is meant to be touched. */
  .pl-title-plant { pointer-events: auto; }


  .pl-menu__topbar {
    position: absolute;
    top: calc(14px + env(safe-area-inset-top));
    right: clamp(12px, 3vw, 28px);
    pointer-events: none;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 10px;
  }

  .pl-menu__profile {
    width: 52px;
    height: 52px;
    border-radius: 16px;
    border: 2px solid var(--hud-border, rgba(94, 122, 53, 0.35));
    background: var(--hud-bg, rgba(10, 12, 8, 0.95));
    color: var(--leaf-300, #c8ff80);
    display: grid;
    place-items: center;
    cursor: pointer;
    overflow: hidden;
    padding: 0;
    transition: border-color 160ms ease, transform 160ms ease;
  }
  .pl-menu__profile:hover { border-color: var(--leaf-400, #9ed95c); transform: translateY(-1px); }
  .pl-menu__profile:focus-visible { outline: 2px solid var(--leaf-300, #c8ff80); outline-offset: 3px; }
  .pl-menu__profile img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .pl-menu__profile-initials {
    font-size: 1.05rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  .pl-menu__brand { text-align: center; }

  .pl-menu__brand {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
    text-align: center;
  }
  /* A soft bar of light behind the wordmark, so the title sits in the scene's
     light instead of floating above it. */
  .pl-menu__brand::before {
    content: '';
    position: absolute;
    left: 50%;
    top: 46%;
    width: min(560px, 88vw);
    height: 96px;
    transform: translate(-50%, -50%);
    background: radial-gradient(
      ellipse at 50% 50%,
      color-mix(in srgb, var(--pl-sun-core, #fff2c4) 42%, transparent) 0%,
      transparent 72%
    );
    opacity: var(--pl-title-glow, 0.3);
    filter: blur(18px);
    pointer-events: none;
    z-index: -1;
  }
  .pl-menu__title {
    margin: 0;
    margin-top: 0;
    font-size: clamp(2.1rem, 6.4vw, 4.4rem);
    line-height: 1.02;
    letter-spacing: 0.02em;
    font-weight: 700;
    color: var(--bone-200, #efe9d8);
    text-shadow: 0 3px 0 rgba(0, 0, 0, 0.45), 0 12px 34px rgba(0, 0, 0, 0.55);
    white-space: nowrap;
  }
  .pl-menu__title span { color: var(--leaf-400, #9ed95c); }
  .pl-menu__tagline {
    margin: 0;
    font-size: var(--hud-font-sm, 0.7rem);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--ink-muted, #c9c2ad);
    opacity: 0.8;
  }

  /* The name box lines up with the buttons under it instead of being 20px
     narrower for no reason. */
  .pl-menu__identity { display: flex; flex-direction: column; align-items: center; gap: 8px; width: min(var(--pl-hero, 380px), 92vw); }
  /* The name field and its counter are one box: the count sits inside the field
     so the button under it never shifts as the numbers change width. */
  .pl-menu__field { position: relative; display: block; width: 100%; }
  .pl-menu__field .pl-menu__input { padding-right: 58px; }
  .pl-menu__counter {
    position: absolute;
    top: 50%;
    right: 12px;
    transform: translateY(-50%);
    font-size: var(--hud-font-xs, 0.66rem);
    font-variant-numeric: tabular-nums;
    color: var(--ink-dim, #9a937a);
    pointer-events: none;
  }
  /* One line about who you are playing as, above the H hint: the two read as a
     column of small facts at the foot of the screen, never as a banner. */
  .pl-menu__note {
    position: absolute;
    left: 50%;
    bottom: calc(32px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    max-width: min(560px, calc(100vw - 2 * var(--hud-corner, 14px)));
    font-size: var(--hud-font-sm, 0.68rem);
    letter-spacing: 0.04em;
    color: var(--ink-dim, #9a937a);
    opacity: 0.85;
    text-align: center;
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
  }
  .pl-menu__note[hidden] { display: none; }
  .pl-menu__input {
    width: 100%;
    box-sizing: border-box;
    padding: 12px 14px;
    border-radius: var(--hud-radius, 14px);
    border: 2px solid var(--hud-border, rgba(94, 122, 53, 0.35));
    background: rgba(10, 14, 10, 0.82);
    color: var(--bone-100, #f7f4ed);
    font: inherit;
    font-size: 0.95rem;
    text-align: center;
    outline: none;
    transition: border-color 160ms ease, background 160ms ease;
  }
  .pl-menu__input::placeholder { color: var(--ink-dim, #9a937a); opacity: 0.85; }
  .pl-menu__input:focus { border-color: var(--leaf-400, #9ed95c); background: rgba(12, 18, 12, 0.92); }
  .pl-menu__input[readonly] { opacity: 0.85; cursor: default; }

  .pl-menu__actions { display: flex; gap: 10px; align-items: stretch; width: 100%; }
  /* Two buttons in one row share it evenly, so "Settings" and "Shop" are the
     same size instead of matching their own label widths. */
  .pl-menu__actions--pair > .pl-menu__btn { flex: 1 1 0; }
  .pl-menu__btn {
    font: inherit;
    font-size: 0.9rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    border-radius: var(--hud-radius, 14px);
    border: 2px solid transparent;
    padding: 11px 18px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: transform 140ms ease, filter 140ms ease, border-color 140ms ease, background 140ms ease;
    min-height: 44px;
  }
  .pl-menu__btn:hover { transform: translateY(-1px); }
  .pl-menu__btn:active { transform: translateY(0); }
  .pl-menu__btn:focus-visible { outline: 2px solid var(--leaf-300, #c8ff80); outline-offset: 3px; }
  .pl-menu__btn--play {
    background: linear-gradient(180deg, var(--leaf-500, #7db83d) 0%, var(--leaf-700, #426520) 100%);
    color: #0d1408;
    border-color: rgba(0, 0, 0, 0.25);
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.28);
    padding: 13px 46px;
    font-size: 1rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    width: 100%;
  }
  .pl-menu__btn--play:disabled { filter: grayscale(0.5) brightness(0.8); cursor: default; transform: none; }
  .pl-menu__btn--soft {
    background: rgba(10, 14, 10, 0.72);
    border-color: var(--hud-border, rgba(94, 122, 53, 0.35));
    color: var(--bone-200, #efe9d8);
  }
  .pl-menu__btn--soft:hover { border-color: var(--leaf-500, #7db83d); }
  .pl-menu__error {
    margin: 0;
    font-size: 0.78rem;
    color: var(--ember-400, #ff8c5f);
    max-width: 34ch;
  }
  .pl-menu__note {
    margin: 0;
    font-size: 0.72rem;
    color: var(--ink-dim, #9a937a);
    max-width: 40ch;
  }

  /* Modal for auth, connecting and the lost-plant notice. The scene stays. */
  .pl-menu__scrim {
    position: absolute;
    inset: 0;
    background: rgba(6, 9, 6, 0.55);
    backdrop-filter: blur(2px);
    display: grid;
    place-items: center;
    padding: 16px;
    pointer-events: auto;
    z-index: 3;
  }
  .pl-menu__card {
    width: min(420px, 100%);
    box-sizing: border-box;
    background: linear-gradient(180deg, rgba(20, 26, 18, 0.98) 0%, rgba(14, 19, 13, 0.98) 100%);
    border: 2px solid var(--hud-border, rgba(94, 122, 53, 0.35));
    border-radius: 18px;
    box-shadow: var(--hud-shadow);
    padding: 20px 20px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-height: min(86vh, 640px);
    overflow: auto;
  }
  .pl-menu__card h2 { margin: 0; font-size: 1.25rem; letter-spacing: 0.01em; }
  .pl-menu__card p { margin: 0; font-size: 0.8rem; color: var(--ink-muted, #c9c2ad); line-height: 1.5; }
  .pl-menu__field { display: flex; flex-direction: column; gap: 5px; text-align: left; }
  .pl-menu__label {
    font-size: 0.68rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-dim, #9a937a);
  }
  .pl-menu__field input {
    padding: 11px 12px;
    border-radius: 10px;
    border: 2px solid var(--hud-border-muted, rgba(50, 58, 40, 0.5));
    background: rgba(8, 11, 8, 0.9);
    color: var(--bone-100, #f7f4ed);
    font: inherit;
    font-size: 0.9rem;
    outline: none;
    min-height: 44px;
    box-sizing: border-box;
  }
  .pl-menu__field input:focus { border-color: var(--leaf-400, #9ed95c); }
  .pl-menu__row { display: flex; gap: 8px; flex-wrap: wrap; }
  .pl-menu__row > .pl-menu__btn { flex: 1 1 auto; }
  .pl-menu__rule { height: 1px; background: var(--hud-border-muted, rgba(50, 58, 40, 0.5)); }
  .pl-menu__pulse { display: flex; gap: 6px; justify-content: center; padding: 6px 0; }
  .pl-menu__pulse i {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--leaf-400, #9ed95c);
    animation: pl-menu-pulse 1.1s ease-in-out infinite;
  }
  .pl-menu__pulse i:nth-child(2) { animation-delay: 0.15s; }
  .pl-menu__pulse i:nth-child(3) { animation-delay: 0.3s; }
  @keyframes pl-menu-pulse { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }
  .pl-menu__stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
  .pl-menu__stat {
    display: flex; justify-content: space-between; gap: 8px;
    font-size: 0.74rem; padding: 6px 9px;
    background: rgba(8, 11, 8, 0.55);
    border-radius: 8px;
  }
  .pl-menu__stat b { font-weight: 600; }

  /* Signed-in account popover, pinned under the avatar. */
  .pl-menu__popover {
    position: absolute;
    top: calc(74px + env(safe-area-inset-top));
    right: clamp(12px, 3vw, 28px);
    width: min(280px, calc(100vw - 24px));
    background: linear-gradient(180deg, rgba(20, 26, 18, 0.99) 0%, rgba(12, 17, 11, 0.99) 100%);
    border: 2px solid var(--hud-border, rgba(94, 122, 53, 0.35));
    border-radius: 16px;
    box-shadow: var(--hud-shadow);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    z-index: 4;
  }
  .pl-menu__popover[hidden] { display: none; }
  .pl-menu__popover-name { font-size: 0.95rem; font-weight: 600; }
  .pl-menu__popover-handle { font-size: 0.76rem; color: var(--ink-dim, #9a937a); }
  .pl-menu__popover-avatar {
    width: 64px; height: 64px; border-radius: 18px; overflow: hidden;
    border: 2px solid var(--hud-border, rgba(94, 122, 53, 0.35));
    background: rgba(8, 11, 8, 0.9);
    display: grid; place-items: center; margin: 0 auto;
    color: var(--leaf-300, #c8ff80); font-weight: 700;
  }
  .pl-menu__popover-avatar img { width: 100%; height: 100%; object-fit: cover; }

  /* A desktop gets a desktop-sized control: a 46px-tall button inside a 560px
     column is a phone button. It lives here, after the base rules, because the
     Play button's own rule below would otherwise win on order. */
  @media (min-width: 1200px) {
    .pl-menu__btn { font-size: 0.98rem; padding: 13px 22px; }
    .pl-menu__btn--play { font-size: 1.1rem; padding: 16px 62px; letter-spacing: 0.12em; }
    .pl-menu__input { padding: 14px 16px; font-size: 1rem; }
  }

  @media (max-width: 560px) {
    .pl-menu__stack { width: min(360px, 94vw); }
    .pl-menu__btn--play { width: 100%; padding: 14px 20px; }
    .pl-menu__actions { width: 100%; }
    .pl-menu__title { letter-spacing: 0.01em; }
    .pl-menu__profile { width: 46px; height: 46px; border-radius: 14px; }
  }
  /* Short windows: drop the tagline and tighten the column. The ground line is
     not set here any more - it is computed per pane in fitToPane, because a fixed
     share of the height is exactly what put the plant above the top of a short
     pane. Two owners for one number is how that happened. */
  @media (max-height: 720px) {
    .pl-menu__tagline { display: none; }
    .pl-menu__stack { gap: 6px; }
  }
  /* A small pane keeps the essentials: the title, the name, and the three buttons.
     The guest line and the H hint are the first things to go - they explain, the
     buttons do things - and the ground band tightens to give the column its room. */
  .pl-menu.is-compact .pl-menu__note,
  .pl-menu.is-compact .pl-scene__hint { display: none; }
  .pl-menu.is-compact { --pl-root-band: clamp(34px, 5vw, 56px); }
  .pl-menu.is-compact .pl-menu__tagline { display: none; }
`;

function installStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}

const MODAL_STEPS: EntryStep[] = ['sign_in', 'sign_up', 'connecting', 'plant_lost'];

export class MainMenu {
  private readonly root: HTMLDivElement;
  private readonly options: MainMenuOptions;
  private readonly scene: TitleScene;
  private readonly plant: TitlePlant;
  private readonly cloudShadow: HTMLElement;
  private readonly near: HTMLElement;
  private readonly vignette: HTMLElement;
  private readonly sunWash: HTMLElement;
  private readonly moonWash: HTMLElement;
  private readonly nightWash: HTMLElement;
  private readonly world: HTMLDivElement;
  private readonly stage: HTMLDivElement;
  private skyTimer = 0;
  private skySyncTimer = 0;
  /** The clock tick and the world-time poll, kept so the timers can be paused. */
  private skyTick: (() => void) | null = null;
  private skySync: (() => Promise<void>) | null = null;
  private readonly titleGroup: HTMLElement;
  /** The hero column: plant timestamp, logotype, name, buttons. Scaled to fit. */
  private readonly stack: HTMLElement;
  private paneObserver: ResizeObserver | null = null;
  private readonly identity: HTMLElement;
  private onPaneResize = (): void => this.fitToPane();
  private readonly nickname: HTMLInputElement;
  private readonly note: HTMLElement;
  private readonly profileButton: HTMLButtonElement;
  private readonly popover: HTMLElement;
  private modal: HTMLElement | null = null;
  private account: MainMenuAccount | null;
  private avatar: string | null;
  private uiHidden = false;
  /** True while a panel opened through the callbacks (settings, shop) is up. */
  private overlayOpen = false;
  private destroyed = false;

  constructor(options: MainMenuOptions) {
    installStyles();
    this.options = options;
    this.account = options.account ?? null;
    this.avatar = options.avatar ?? null;

    this.root = document.createElement('div');
    this.root.className = 'pl-menu';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Plant Legacy');
    this.root.style.setProperty(
      '--pl-horizon-config',
      `${(Math.min(0.8, Math.max(0.2, options.ui.titleHorizonFraction)) * 100).toFixed(2)}%`,
    );

    // The world layer is built first: the scene writes its palette variables here,
    // where both the scene's own layers and the light washes over the world see them.
    this.world = document.createElement('div');
    this.world.className = 'pl-menu__world';
    this.root.appendChild(this.world);

    // The interface layer is created before the scene so the scene's hint can
    // mount above the world instead of underneath the foreground.
    const ui = document.createElement('div');
    ui.className = 'pl-menu__ui';

    this.scene = createTitleScene({
      varsTarget: this.world,
      hintHost: ui,
      parallax: {
        enabled: options.ui.titleParallaxEnabled,
        dragPx: options.ui.titleParallaxDragPx,
        hover: options.ui.titleParallaxHover,
      },
      depth: options.ui.titleParallaxDepth,
      settleMs: options.ui.titleParallaxSettleMs,
      reducedMotion: options.ui.reducedMotion,
      hintFadeMs: options.ui.titleHintFadeMs,
      onToggleUi: () => this.toggleUi(),
    });
    this.scene.element.classList.add('pl-menu__scene');
    this.world.appendChild(this.scene.element);

    this.stage = document.createElement('div');
    this.stage.className = 'pl-menu__stage';
    this.world.appendChild(this.stage);

    this.plant = createTitlePlant({
      swayMs: options.ui.titlePlantSwayMs,
      reactMs: options.ui.titlePlantReactMs,
      cooldownMs: options.ui.titlePlantReactCooldownMs,
      reducedMotion: options.ui.reducedMotion,
    });
    // The plant stands in the world, not in the menu: it never fades with the UI
    // and it is the only part of the world the pointer can grab.
    this.world.appendChild(this.plant.element);

    // Cloud shadows pass over the soil, so the ground has weather on it.
    this.cloudShadow = document.createElement('div');
    this.cloudShadow.className = 'pl-menu__cloudshadow';
    this.cloudShadow.innerHTML = '<i></i><i></i><i></i>';
    this.world.appendChild(this.cloudShadow);

    // Two light passes over everything in the world: a warm glow around the sun,
    // and a cool night wash. They sit above the plant so its leaves are lit by the
    // same light as the hills, and they never take the pointer.
    this.sunWash = document.createElement('div');
    this.sunWash.className = 'pl-menu__wash pl-menu__wash--sun';
    this.world.appendChild(this.sunWash);

    this.moonWash = document.createElement('div');
    this.moonWash.className = 'pl-menu__wash pl-menu__wash--moon';
    this.world.appendChild(this.moonWash);

    this.nightWash = document.createElement('div');
    this.nightWash.className = 'pl-menu__wash pl-menu__wash--night';
    this.world.appendChild(this.nightWash);

    // Foreground: out-of-focus blades at the bottom edge and a vignette. They put
    // the camera inside the scene instead of in front of a flat backdrop.
    this.near = document.createElement('div');
    this.near.className = 'pl-menu__near';
    this.near.innerHTML = NEAR_ART;
    this.world.appendChild(this.near);

    this.vignette = document.createElement('div');
    this.vignette.className = 'pl-menu__vignette';
    this.world.appendChild(this.vignette);

    this.root.appendChild(ui);

    const topbar = document.createElement('div');
    topbar.className = 'pl-menu__topbar';
    this.profileButton = this.buildProfileButton();
    topbar.appendChild(this.profileButton);
    ui.appendChild(topbar);

    const stack = document.createElement('div');
    stack.className = 'pl-menu__stack';
    this.stack = stack;
    this.titleGroup = document.createElement('div');
    this.titleGroup.className = 'pl-menu__brand';
    const title = document.createElement('h1');
    title.className = 'pl-menu__title';
    title.innerHTML = 'Plant <span>Legacy</span>';
    this.titleGroup.appendChild(title);
    const tagline = document.createElement('p');
    tagline.className = 'pl-menu__tagline';
    tagline.textContent = 'Grow a plant that outlives you';
    this.titleGroup.appendChild(tagline);
    stack.appendChild(this.titleGroup);

    this.identity = document.createElement('div');
    this.identity.className = 'pl-menu__identity';

    const suggestion = autoDisplayName({
      prefixes: options.ui.titlePlantNamePrefixes,
      nouns: options.ui.titlePlantNameNouns,
    });
    this.nickname = document.createElement('input');
    this.nickname.className = 'pl-menu__input';
    this.nickname.type = 'text';
    this.nickname.maxLength = options.ui.displayNameMaxLength;
    this.nickname.setAttribute('autocomplete', 'nickname');
    this.nickname.spellcheck = false;
    this.nickname.setAttribute('aria-label', 'Your name');
    this.nickname.placeholder = suggestion || 'Your name';
    this.nickname.value = options.displayName ?? '';
    this.nickname.readOnly = this.account !== null;
    this.nickname.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      this.play();
    });
    const field = document.createElement('div');
    field.className = 'pl-menu__field';
    const counter = document.createElement('span');
    counter.className = 'pl-menu__counter';
    counter.id = 'pl-name-counter';
    counter.setAttribute('aria-live', 'polite');
    // The cap is visible before it is hit, and announced by the field rather than
    // by an error after the fact: a name that stops at 32 characters with no
    // counter reads as a broken keyboard.
    this.nickname.setAttribute('aria-describedby', counter.id);
    const syncCounter = (): void => {
      const max = Math.max(this.nickname.maxLength, 0);
      counter.textContent = `${this.nickname.value.length}/${max}`;
      counter.classList.toggle('is-full', max > 0 && this.nickname.value.length >= max);
    };
    this.nickname.addEventListener('input', syncCounter);
    this.nickname.addEventListener('change', syncCounter);
    syncCounter();
    field.appendChild(this.nickname);
    field.appendChild(counter);
    this.identity.appendChild(field);

    const actions = document.createElement('div');
    actions.className = 'pl-menu__actions';
    const play = document.createElement('button');
    play.className = 'pl-menu__btn pl-menu__btn--play';
    play.type = 'button';
    play.dataset.action = 'play';
    play.textContent = 'Play';
    play.addEventListener('click', () => this.play());
    actions.appendChild(play);
    this.identity.appendChild(actions);

    const secondary = document.createElement('div');
    secondary.className = 'pl-menu__actions pl-menu__actions--pair';
    secondary.appendChild(this.softButton('Settings', 'settings'));
    secondary.appendChild(this.softButton('Shop', 'shop'));
    this.identity.appendChild(secondary);

    const error = document.createElement('p');
    error.className = 'pl-menu__error';
    error.dataset.role = 'error';
    error.hidden = true;
    this.identity.appendChild(error);

    stack.appendChild(this.identity);
    ui.appendChild(stack);

    // Who this plant belongs to, said once. A guest is not told "sign in" in a
    // card after pressing Play; the fact sits on the title before the button.
    this.note = document.createElement('p');
    this.note.className = 'pl-menu__note';
    this.note.hidden = true;
    ui.appendChild(this.note);

    this.root.appendChild(ui);

    this.popover = document.createElement('div');
    this.popover.className = 'pl-menu__popover';
    this.popover.id = 'pl-account-popover';
    this.popover.setAttribute('role', 'group');
    this.popover.setAttribute('aria-label', 'Account');
    this.popover.hidden = true;
    this.root.appendChild(this.popover);

    (options.mount ?? document.body).appendChild(this.root);
    this.renderProfileButton();

    // Clicking the scene closes the account popover, like any other menu.
    this.scene.element.addEventListener('pointerdown', () => this.closePopover());

    window.addEventListener('keydown', this.onEscape);
    // The menu is laid out for the pane it is actually in, not for a window:
    // an embedded preview panel is narrower and shorter than the window around
    // it, and the hero column used to run off the bottom of it.
    this.fitToPane();
    window.addEventListener('resize', this.onPaneResize);
    if (typeof ResizeObserver !== 'undefined') {
      let lastPane = `${this.root.clientWidth}x${this.root.clientHeight}`;
      this.paneObserver = new ResizeObserver(() => {
        const next = `${this.root.clientWidth}x${this.root.clientHeight}`;
        if (next === lastPane) return;
        lastPane = next;
        this.fitToPane();
      });
      this.paneObserver.observe(this.root);
    }
    this.startSky();
  }

  private softButton(label: string, action: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'pl-menu__btn pl-menu__btn--soft';
    button.type = 'button';
    button.dataset.action = action;
    button.textContent = label;
    button.addEventListener('click', () => this.handleAction(action));
    return button;
  }

  private buildProfileButton(): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'pl-menu__profile';
    button.type = 'button';
    button.setAttribute('aria-label', 'Account');
    // A trigger that opens a panel has to say so, or a screen reader has no way
    // to know one is open.
    button.setAttribute('aria-haspopup', 'true');
    button.setAttribute('aria-controls', 'pl-account-popover');
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      this.togglePopover();
    });
    return button;
  }

  private initials(name: string): string {
    const parts = name.trim().split(/\s+/).slice(0, 2);
    return parts.map((part) => part.slice(0, 1)).join('') || '?';
  }

  private renderProfileButton(): void {
    this.profileButton.replaceChildren();
    if (this.avatar) {
      const img = document.createElement('img');
      img.src = this.avatar;
      img.alt = '';
      this.profileButton.appendChild(img);
      return;
    }
    const mark = document.createElement('span');
    if (this.account) {
      mark.className = 'pl-menu__profile-initials';
      mark.textContent = this.initials(this.account.displayName);
    } else {
      mark.innerHTML = `
        <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="none"
             stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <circle cx="12" cy="9" r="3.6"/>
          <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/>
        </svg>`;
    }
    this.profileButton.appendChild(mark);
  }

  private renderPopover(): void {
    this.popover.replaceChildren();
    const avatar = document.createElement('div');
    avatar.className = 'pl-menu__popover-avatar';
    if (this.avatar) {
      const img = document.createElement('img');
      img.src = this.avatar;
      img.alt = '';
      avatar.appendChild(img);
    } else {
      avatar.textContent = this.account ? this.initials(this.account.displayName) : '';
      if (!this.account) {
        avatar.innerHTML = `
          <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true" fill="none"
               stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <circle cx="12" cy="9" r="3.6"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/>
          </svg>`;
      }
    }
    this.popover.appendChild(avatar);

    if (this.account) {
      const name = document.createElement('div');
      name.className = 'pl-menu__popover-name';
      name.textContent = this.account.displayName;
      this.popover.appendChild(name);
      if (this.account.username) {
        const handle = document.createElement('div');
        handle.className = 'pl-menu__popover-handle';
        handle.textContent = `@${this.account.username}`;
        this.popover.appendChild(handle);
      }
      const rule = document.createElement('div');
      rule.className = 'pl-menu__rule';
      this.popover.appendChild(rule);
      this.popover.appendChild(this.popoverButton('Change picture', () => this.pickAvatar()));
      this.popover.appendChild(
        this.popoverButton('Sign out', () => this.options.callbacks.onSignOut()),
      );
    } else {
      const note = document.createElement('p');
      note.className = 'pl-menu__note';
      note.textContent = 'Sign in to keep this plant on any device.';
      this.popover.appendChild(note);
      // The picture is stored on this device either way, so a guest can have one.
      this.popover.appendChild(this.popoverButton('Change picture', () => this.pickAvatar()));
      this.popover.appendChild(
        this.popoverButton('Sign in', () => this.options.callbacks.onSignInForm()),
      );
      this.popover.appendChild(
        this.popoverButton('Create account', () => this.options.callbacks.onSignUpForm()),
      );
    }
  }

  private popoverButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'pl-menu__btn pl-menu__btn--soft';
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => {
      this.closePopover();
      onClick();
    });
    return button;
  }

  private pickAvatar(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/svg+xml';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      // 512 KB keeps the data URL inside a localStorage quota that is shared with
      // the session, and is still more pixels than a 64 px avatar needs.
      if (file.size > 512 * 1024) {
        this.showError('That image is larger than 512 KB.');
        return;
      }
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        const url = typeof reader.result === 'string' ? reader.result : null;
        if (!url) return;
        this.avatar = url;
        this.renderProfileButton();
        this.renderPopover();
        this.options.onProfileChange?.({ avatar: url });
      });
      reader.readAsDataURL(file);
    });
    input.click();
  }

  private togglePopover(): void {
    const open = this.popover.hidden;
    this.renderPopover();
    this.popover.hidden = !open;
    this.profileButton.setAttribute('aria-expanded', String(open));
    if (!open) this.profileButton.focus();
    this.syncUiToggle();
  }

  private closePopover(): void {
    if (this.popover.hidden) return;
    this.popover.hidden = true;
    this.profileButton.setAttribute('aria-expanded', 'false');
    this.syncUiToggle();
  }

  /**
   * The foot line: who this plant belongs to.
   *
   * A guest is told what a guest is before Play, not in a card afterwards. The
   * wording is a fact and a consequence, with no invitation to fix it: the sign
   * in route is in the profile box and on the sign-in card.
   */
  private renderNote(): void {
    if (!this.note) return;
    const signedIn = this.account !== null;
    this.note.textContent = signedIn
      ? `Signed in as ${this.account?.username ? `@${this.account.username}` : (this.account?.displayName ?? 'your account')}`
      : 'Not signed in. Your plant belongs to this browser.';
    this.note.hidden = this.root.dataset.step === 'world';
  }

  private showError(message: string): void {
    const error = this.identity.querySelector<HTMLElement>('[data-role="error"]');
    if (!error) return;
    error.textContent = message;
    error.hidden = false;
  }

  private clearError(): void {
    const error = this.identity.querySelector<HTMLElement>('[data-role="error"]');
    if (!error) return;
    error.hidden = true;
    error.textContent = '';
  }

  private play(): void {
    this.clearError();
    const resolved = resolveDisplayName(
      this.nickname.value,
      {
        prefixes: this.options.ui.titlePlantNamePrefixes,
        nouns: this.options.ui.titlePlantNameNouns,
      },
      this.options.ui.displayNameMaxLength,
    );
    if (!resolved.ok) {
      this.showError(
        `That name is too long. ${this.options.ui.displayNameMaxLength} characters at most.`,
      );
      return;
    }
    this.nickname.value = resolved.value;
    this.options.callbacks.onPlay(resolved.value);
  }

  private handleAction(action: string): void {
    switch (action) {
      case 'settings':
        this.options.callbacks.onSettings();
        break;
      case 'shop':
        this.options.callbacks.onShop();
        break;
      case 'play':
        this.play();
        break;
      case 'sign_in':
        this.options.callbacks.onSignInForm();
        break;
      case 'sign_up':
        this.options.callbacks.onSignUpForm();
        break;
      case 'back':
        this.options.callbacks.onBack();
        break;
      case 'cancel_connect':
        this.options.callbacks.onCancelConnect();
        break;
      case 'reseed':
        this.options.callbacks.onReseed();
        break;
    }
  }

  /**
   * Whether an overlay above the title owns the input right now: an auth card, a
   * settings or shop panel opened through the callbacks, or the account popover.
   *
   * The H shortcut is a title-screen shortcut. With a panel open it used to hide
   * the menu behind the panel, so the player closed the panel and found the title
   * screen stripped. Every path that opens or closes an overlay runs through here.
   */
  setOverlayOpen(open: boolean): void {
    this.overlayOpen = open;
    this.syncUiToggle();
  }

  private titleActive = true;

  private setTitleActive(active: boolean): void {
    if (this.titleActive === active) return;
    this.titleActive = active;
    this.scene.setActive(active);
    this.plant.setActive(active);
    if (active) {
      this.startSkyTimers();
    } else {
      this.stopSkyTimers();
    }
    this.syncUiToggle();
  }

  private syncUiToggle(): void {
    const modalStep = MODAL_STEPS.includes((this.root.dataset.step ?? 'title') as EntryStep);
    const allowed = !this.overlayOpen && !modalStep && this.popover.hidden && this.modal === null;
    this.scene.setToggleEnabled(allowed);
  }

  private toggleUi(): void {
    this.uiHidden = !this.uiHidden;
    this.root.classList.toggle('is-ui-hidden', this.uiHidden);
    if (this.uiHidden) this.closePopover();
  }

  /** The title scene's own key handler must not fire while a field has focus. */
  /**
   * Run the sky on the world's clock.
   *
   * The menu has no socket yet, so it asks `/world/time` what time it is in the
   * world and then advances locally between answers. If that call fails - no
   * server, or a slow one - the fallback is the menu's own cycle rather than a
   * frozen or black sky.
   */
  /**
   * Scale the hero column so its foot lands inside the pane.
   *
   * `offsetTop` and `offsetHeight` are layout values: they ignore the transform
   * this writes, so the measurement cannot feed back into itself and shrink the
   * menu a little more on every resize.
   */
  private fitToPane(): void {
    if (this.destroyed) return;
    const paneW = this.root.clientWidth;
    const paneH = this.root.clientHeight;
    if (paneW <= 0 || paneH <= 0) return;

    // 1. How big the plant may be, and where its feet go. The ground line answers
    //    to the plant's height, not only to the pane's: a share is right while the
    //    pane is tall and puts the art above the top the moment it is not.
    const ground = GROUND_BAND_PX;
    const maxWidth = mascotMaxWidthPx(paneH, ground);
    this.root.style.setProperty('--pl-mascot-max', `${Math.round(maxWidth)}px`);
    const plantPx = this.plant.element.offsetHeight || Math.round(maxWidth * PLANT_ART_ASPECT);
    const horizon = horizonForPane({
      viewportPx: paneH,
      fraction: this.options.ui.titleHorizonFraction,
      plantPx,
      minGroundPx: ground,
    });
    this.root.style.setProperty('--pl-horizon', `${Math.round(horizon)}px`);

    // 2. Whether this pane is small enough that the two lines of small print at the
    //    foot are in the way. They are the first thing to go: they explain, the
    //    buttons do things.
    const topPx = this.stack.offsetTop;
    const naturalPx = this.stack.offsetHeight;
    const roomy = menuFit({
      viewportPx: paneH,
      topPx,
      naturalPx,
      reservePx: MENU_FOOT_RESERVE_PX,
    });
    // Compact is a decision about the pane, not about whether the fit had to
    // shrink: at 1280x800 the column scales to 0.91 for its own reasons and the
    // guest line belongs there. It is compact when the pane is short, or when the
    // column cannot be placed at all without lifting it.
    const compact = paneH < 560 || roomy.liftPx < 0;
    this.root.classList.toggle('is-compact', compact);

    // 3. Fit the column, with the foot lines' space reclaimed when they are gone.
    const fit = compact ? menuFit({ viewportPx: paneH, topPx, naturalPx, reservePx: 8 }) : roomy;
    this.stack.style.setProperty('--pl-menu-fit', String(fit.scale));
    // The lift is in the parent's pixels, so it is written before the scale in the
    // transform list: transforms read left to right, and the scale must apply to
    // the column's own box, not to the distance it was moved.
    this.stack.style.transform = `translate(-50%, ${fit.liftPx}px) scale(${fit.scale})`;
  }

  private startSky(): void {
    const cycleS = Math.max(60, this.options.cycleLengthS ?? this.options.ui.titleDayNightSeconds);
    const fallbackStart = Math.min(0.99, Math.max(0, this.options.ui.titleDayNightStartFraction));
    const boot = this.options.initialTimeOfDay;
    const known = typeof boot === 'number' && Number.isFinite(boot);
    let clock: WorldClock = {
      timeOfDay: known ? (((boot as number) % 1) + 1) % 1 : fallbackStart,
      paused: false,
      scale: 1,
    };
    let lastMs = performance.now();
    // No invented sky: an unknown hour keeps the world out of sight until the
    // server answers (or the request fails, when the fallback hour is honest).
    if (!known) this.world.classList.add('is-sky-pending');
    const revealSky = (): void => this.world.classList.remove('is-sky-pending');

    const render = (): void => {
      const palette = paletteAt(clock.timeOfDay);
      const sunBody = sunPosition(clock.timeOfDay);
      const sunX = sunBody.x;
      this.scene.setPalette(palette);
      this.scene.setCelestial(sunBody, moonPosition(clock.timeOfDay));
      // The world's light grade, one pass: the sun glow fades, the moon halo
      // grows, the night pass comes up, and the leaves take the same cast as the
      // hills. All of it is derived from the palette in `titleLighting`.
      const light = titleLighting(palette);
      this.root.style.setProperty('--pl-plant-dim', palette.plantDim.toFixed(3));
      this.root.style.setProperty('--pl-plant-sat', light.plantSaturation.toFixed(3));
      this.root.style.setProperty('--pl-sun-wash', light.sunWash.toFixed(3));
      this.root.style.setProperty('--pl-moon-wash', light.moonWash.toFixed(3));
      this.root.style.setProperty('--pl-night-wash', light.nightWash.toFixed(3));
      this.root.style.setProperty('--pl-plant-sepia', light.plantSepia.toFixed(3));
      this.root.style.setProperty('--pl-plant-hue', `${light.plantHue.toFixed(1)}deg`);
      // Depth and air: the horizon glow, the haze on the hills, the band of stars,
      // the cloud shadows crossing the soil and the lit edge of the leaves.
      this.root.style.setProperty('--pl-bloom', light.bloom.toFixed(3));
      this.root.style.setProperty('--pl-haze', light.haze.toFixed(3));
      this.root.style.setProperty('--pl-milkyway', light.milkyWay.toFixed(3));
      this.root.style.setProperty('--pl-cloud-shadow', light.cloudShadow.toFixed(3));
      this.root.style.setProperty('--pl-leaf-rim', light.leafRim);
      this.root.style.setProperty('--pl-leaf-rim-opacity', light.leafRimOpacity.toFixed(3));
      // The rim of the leaves and the near silhouettes follow the light too.
      this.root.style.setProperty('--pl-plant-rim-x', `${((sunX - 0.5) * 5).toFixed(1)}px`);
      this.root.style.setProperty('--pl-title-glow', (0.22 + light.sunWash * 0.5).toFixed(3));
      this.root.style.setProperty('--pl-near', lerpHex(palette.groundBody, '#050a04', 0.55));
      this.root.style.setProperty('--pl-near-opacity', (0.7 - light.nightWash * 0.4).toFixed(3));
    };

    // How the local sky follows the server's clock.
    //
    // The title has only its own copy of the clock to run on between polls, and
    // its extrapolation and the world's do not agree exactly: the server advances
    // the day by scheduled tick time, so a loaded server's day runs slower than
    // the wall clock this screen measures. Stamping the polled hour onto the local
    // clock was what made the moon jump backwards every 30 s. The polled hour is a
    // target now: the tick eases toward it, so the sky changes pace instead of
    // teleporting.
    let syncTarget: { timeOfDay: number; atMs: number } | null = null;
    /** A gap this large is a jump (a paused world, a dev time change), not drift. */
    const SNAP_DAYS = 0.02;
    /** Roughly how long a small gap takes to close. */
    const DRIFT_SECONDS = 2;

    this.skyTick = (): void => {
      const now = performance.now();
      const dtSeconds = (now - lastMs) / 1000;
      lastMs = now;
      let next = advanceWorldClock(clock, dtSeconds, cycleS);
      if (syncTarget && !next.paused) {
        // Where the server's clock should be now, advanced at the sky's own pace
        // since the poll answered.
        const projected = wrapDayFraction(
          syncTarget.timeOfDay + (((now - syncTarget.atMs) / 1000) * clock.scale) / cycleS,
        );
        const gap = shortestDayDelta(next.timeOfDay, projected);
        if (Math.abs(gap) > SNAP_DAYS) {
          next = { ...next, timeOfDay: projected };
        } else {
          // A correction this small per frame is a slight change of pace, never a
          // moon that jumps backwards.
          const share = Math.min(1, dtSeconds / DRIFT_SECONDS);
          next = { ...next, timeOfDay: wrapDayFraction(next.timeOfDay + gap * share) };
        }
      }
      clock = next;
      render();
    };

    this.skySync = async (): Promise<void> => {
      const time = await this.options.fetchWorldTime?.();
      if (!time) {
        // Nothing to sync with: show the fallback hour rather than a hidden world.
        revealSky();
        return;
      }
      if (time.paused) {
        // A stopped world is a still sky at the hour it stopped: take that hour.
        clock = applyServerClock(clock, {
          timeOfDay: time.timeOfDay,
          timePaused: true,
          timeScale: time.scale,
        });
        syncTarget = null;
      } else {
        clock = { ...clock, paused: false, scale: time.scale };
        // Hold the hour as a target; the tick closes the gap without a jump.
        syncTarget = { timeOfDay: time.timeOfDay, atMs: performance.now() };
      }
      lastMs = performance.now();
      render();
      revealSky();
    };

    void this.skySync();
    this.startSkyTimers();
    render();
    if (known) revealSky();
  }

  private startSkyTimers(): void {
    if (this.destroyed) return;
    this.stopSkyTimers();
    // Every 30 s: often enough that the gap a loaded server opens is small, rare
    // enough to be a poll rather than chatter.
    if (this.skySync) this.skySyncTimer = window.setInterval(() => void this.skySync?.(), 30_000);
    if (this.skyTick) this.skyTimer = window.setInterval(this.skyTick, 100);
  }

  private stopSkyTimers(): void {
    window.clearInterval(this.skyTimer);
    window.clearInterval(this.skySyncTimer);
    this.skyTimer = 0;
    this.skySyncTimer = 0;
  }

  private readonly onEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    const step = this.root.dataset.step;
    if (step === 'sign_in' || step === 'sign_up') {
      event.preventDefault();
      event.stopPropagation();
      this.options.callbacks.onBack();
      return;
    }
    if (!this.popover.hidden) {
      event.stopPropagation();
      this.closePopover();
    }
  };

  setAccount(account: MainMenuAccount | null): void {
    this.account = account;
    this.nickname.readOnly = account !== null;
    if (account) this.nickname.value = account.displayName;
    this.nickname.dispatchEvent(new Event('input'));
    this.renderNote();
    this.renderProfileButton();
    if (!this.popover.hidden) this.renderPopover();
  }

  setAvatar(avatar: string | null): void {
    this.avatar = avatar;
    this.renderProfileButton();
  }

  setDisplayName(name: string): void {
    if (this.account) return;
    this.nickname.value = name;
  }

  render(state: EntryFlowStateMachine): void {
    this.root.dataset.step = state.step;
    this.root.hidden = state.step === 'world';
    this.renderNote();
    // Playing the world hides the title but keeps it mounted. Its sky timers, the
    // parallax loop and the plant's sway were all still running, spending frame
    // time on a page nobody can see.
    this.setTitleActive(state.step !== 'world');
    if (state.step === 'world') {
      this.closePopover();
      this.syncUiToggle();
      return;
    }

    const modalStep = MODAL_STEPS.includes(state.step);
    this.root.classList.toggle('is-modal-step', modalStep);

    for (const button of this.identity.querySelectorAll<HTMLButtonElement>('button')) {
      button.disabled = state.busy && button.dataset.action === 'play';
    }
    // Invisible is not the same as unreachable: without this, Tab walked from the
    // sign-in card into the nickname field and the buttons behind the scrim.
    for (const el of [
      this.world,
      this.identity,
      this.root.querySelector<HTMLElement>('.pl-menu__topbar'),
    ]) {
      if (el) el.toggleAttribute('inert', modalStep);
    }

    this.modal?.remove();
    this.modal = null;
    this.syncUiToggle();
    if (!modalStep) {
      this.clearError();
      return;
    }

    this.modal = this.buildModal(state);
    this.root.appendChild(this.modal);
    this.syncUiToggle();
    if (state.step === 'sign_in' || state.step === 'sign_up') {
      this.modal.querySelector<HTMLInputElement>('input')?.focus();
    }
  }

  private errorBlock(state: EntryFlowStateMachine): string {
    if (!state.error) return '';
    return `<p class="pl-menu__error" role="alert">${escapeHtml(state.error)}</p>`;
  }

  private statsTable(cause: string, stats: PlantStatsSummary): string {
    const rows = plantStatRows(stats)
      .map(
        ([label, value]) =>
          `<div class="pl-menu__stat"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`,
      )
      .join('');
    return `
      <div class="pl-menu__stats">
        <div class="pl-menu__stat"><span>Cause</span><b>${escapeHtml(cause.replace(/_/g, ' '))}</b></div>
        ${rows}
      </div>`;
  }

  private buildModal(state: EntryFlowStateMachine): HTMLElement {
    const scrim = document.createElement('div');
    scrim.className = 'pl-menu__scrim';
    scrim.innerHTML = this.modalMarkup(state);

    const form = scrim.querySelector('form');
    if (form) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (state.busy) return;
        const data = new FormData(form);
        const username = String(data.get('username') ?? '').trim();
        const password = String(data.get('password') ?? '');
        if (state.step === 'sign_up') {
          const displayName = String(data.get('displayName') ?? '').trim();
          this.options.callbacks.onSignUp(username, displayName, password);
        } else {
          this.options.callbacks.onSignIn(username, password);
        }
      });
    }

    for (const button of scrim.querySelectorAll<HTMLButtonElement>('[data-action]')) {
      button.addEventListener('click', () => this.handleAction(button.dataset.action ?? ''));
    }
    return scrim;
  }

  private modalMarkup(state: EntryFlowStateMachine): string {
    const busy = state.busy ? ' disabled' : '';

    if (state.step === 'sign_in') {
      return `
        <form class="pl-menu__card" role="dialog" aria-modal="true" aria-labelledby="pl-modal-title"
              aria-busy="${state.busy}">
          <h2 id="pl-modal-title">Sign in</h2>
          <p>Your plant waits where you left it.</p>
          ${this.errorBlock(state)}
          <label class="pl-menu__field">
            <span class="pl-menu__label">Username</span>
            <input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required>
          </label>
          <label class="pl-menu__field">
            <span class="pl-menu__label">Password</span>
            <input name="password" type="password" autocomplete="current-password" required>
          </label>
          <div class="pl-menu__row">
            <button class="pl-menu__btn pl-menu__btn--play" type="submit"${busy}>${state.busy ? 'Signing in…' : 'Sign in'}</button>
            <button class="pl-menu__btn pl-menu__btn--soft" type="button" data-action="back">Back</button>
          </div>
          <p class="pl-menu__note">There is no password reset yet. Keep the password somewhere safe.</p>
        </form>`;
    }

    if (state.step === 'sign_up') {
      return `
        <form class="pl-menu__card" role="dialog" aria-modal="true" aria-labelledby="pl-modal-title"
              aria-busy="${state.busy}">
          <h2 id="pl-modal-title">Create an account</h2>
          <p>An account keeps this plant, on any device.</p>
          ${this.errorBlock(state)}
          <label class="pl-menu__field">
            <span class="pl-menu__label">Username</span>
            <input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required minlength="3">
          </label>
          <label class="pl-menu__field">
            <span class="pl-menu__label">Display name</span>
            <input name="displayName" autocomplete="nickname" maxlength="${this.options.ui.displayNameMaxLength}" required value="${escapeHtml(this.nickname.value)}">
          </label>
          <label class="pl-menu__field">
            <span class="pl-menu__label">Password</span>
            <input name="password" type="password" autocomplete="new-password" required minlength="8">
          </label>
          <div class="pl-menu__row">
            <button class="pl-menu__btn pl-menu__btn--play" type="submit"${busy}>${state.busy ? 'Creating…' : 'Create account'}</button>
            <button class="pl-menu__btn pl-menu__btn--soft" type="button" data-action="back">Back</button>
          </div>
          <p class="pl-menu__note">Eight characters or more, with upper and lower case and a number.</p>
        </form>`;
    }

    if (state.step === 'connecting') {
      return `
        <div class="pl-menu__card" role="dialog" aria-modal="true" aria-labelledby="pl-modal-title"
             aria-busy="true">
          <h2 id="pl-modal-title">${state.isGuest ? 'Entering as a guest' : 'Opening your garden'}</h2>
          <p>${state.isGuest ? 'A guest plant lives in this browser only.' : 'Restoring your plant from its last save.'}</p>
          ${this.errorBlock(state)}
          <div class="pl-menu__pulse" aria-hidden="true"><i></i><i></i><i></i></div>
          <div class="pl-menu__row">
            <button class="pl-menu__btn pl-menu__btn--soft" type="button" data-action="cancel_connect">Cancel</button>
          </div>
        </div>`;
    }

    return `
      <div class="pl-menu__card">
        <h2>Your plant is gone</h2>
        <p>${state.lostReason ? escapeHtml(state.lostReason) : 'It dried out, starved, or the seed never sprouted.'} The soil is still there.</p>
        ${this.errorBlock(state)}
        ${state.lostStats ? this.statsTable(state.lostStats.cause, state.lostStats.stats) : ''}
        <div class="pl-menu__row">
          <button class="pl-menu__btn pl-menu__btn--play" type="button" data-action="reseed">Plant a new seed</button>
        </div>
      </div>`;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    window.removeEventListener('keydown', this.onEscape);
    this.stopSkyTimers();
    this.skyTick = null;
    this.skySync = null;
    this.plant.destroy();
    this.scene.destroy();
    this.root.remove();
  }

  /** Exposed for main.ts: `H` is advertised on the screen, so tests pin it. */
  static isUiHiddenKey(key: string): boolean {
    return key === 'h' || key === 'H';
  }
}
