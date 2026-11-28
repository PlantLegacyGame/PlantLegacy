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

import {
  coverStrength,
  DRIFT_FLOOR,
  PUDDLE_FLOOR,
  stepSurfaceCover,
} from '@plant-legacy/shared/weather';
import { TOUCH_TITLE_HINT } from '../touchCopy.ts';
import { cloudArt } from './cloudArt.ts';
import { type CelestialBody, lerpHex, type TitlePalette } from './dayCycle.ts';
import {
  arcHeight,
  arcInset,
  quantArcHeight,
  quantArcInset,
  smoothOrbOffset,
} from './orbPlacement.ts';
import {
  clampParallax,
  PARALLAX_ORIGIN,
  type ParallaxConfig,
  type ParallaxPoint,
  parallaxTarget,
  stepParallax,
} from './parallax.ts';
import {
  BLOOM_COLOUR,
  barrelArt,
  batFlockArt,
  birdFlockArt,
  FLOWER_CLUMPS,
  flowerArt,
  lanternArt,
  MUSHROOM_CLUSTERS,
  millArt,
  mushroomArt,
  rabbitArt,
  sceneryLevels,
  seasonOf,
  type TitleSeason,
  wormArt,
} from './scenery.ts';
import { CELESTIAL_SIZE_VMIN, CLOUD_TRAVEL_VW, CLOUD_WIND, CLOUDS } from './skyLayout.ts';
import { createStyleVarWriter, type VarTargets } from './styleVars.ts';
import type { TitleWeather } from './weather.ts';
import { landingBucket } from './weather.ts';

export type SceneLayerId = 'far' | 'mid' | 'near';

/** The foreground's share of the near plane's drag: 0.9 across, half as far up. */
export const FOREGROUND_PARALLAX = { x: 0.9, y: 0.45 } as const;

/**
 * The depth stack, far to near. Three ranges instead of one: a single silhouetted
 * ridge in front of a flat sky is a backdrop, and the drag had nothing to slide
 * against. Each layer moves at its own configured depth, so the title has a
 * parallax with a near, a middle and a far plane in it.
 */
const LAYER_ORDER: SceneLayerId[] = ['far', 'mid', 'near'];

export interface TitleSceneOptions {
  /** Where the "H hides the menu" hint is mounted. Defaults to the scene. */
  hintHost?: HTMLElement;
  /** Where the horizon variable is read from. Defaults to the scene element. */
  varsTarget?: HTMLElement;
  /**
   * The layer elements that paint with the palette. Defaults to the scene element.
   * Each element is written on its own, so a sky step invalidates the sky band and
   * not the whole menu - the paint of the world, not the style recalc, is what a
   * palette step used to cost (see `styleVars.ts`).
   */
  varsTargets?: VarTargets;
  /**
   * Where the weather layers are mounted, when they must fall *in front of the
   * plant*. The scene is a stacking context under the stage and the plant, so rain
   * built inside it rained behind the tree and behind the ground: streaks slid down
   * the inside of a window. Given a host, the fog, rain and splashes are mounted
   * there instead, which is a layer above the world.
   */
  weatherHost?: HTMLElement;
  /**
   * Where the wet ground grade is mounted. It has to be a layer the dirt shows
   * through: the scene is a stacking context under the stage, so a wet grade built
   * inside it sat behind the ground it was meant to darken. Given a host, it covers
   * the cut instead - the stage's own top edge is the soil line, which is the space
   * the band is written in.
   */
  wetHost?: HTMLElement;
  /**
   * The element that carries the camera's scale, and the only one the zoom variable is
   * written to. It must be the world (the element whose CSS reads `--pl-scene-zoom`),
   * so a zoom step touches one element instead of every node under the menu.
   */
  zoomHost?: HTMLElement;
  parallax: ParallaxConfig;
  /**
   * The camera's resting zoom: the composed title, not the pulled-back limit.
   * The title opened at `ZOOM_MIN` because that is where the pane first fits
   * inside the painted world - a camera at its mechanical limit, with the whole
   * composition small in the middle. The home is its own number now.
   */
  homeZoom?: number;
  depth: Record<string, number>;
  settleMs: number;
  reducedMotion: boolean;
  hintFadeMs: number;
  onToggleUi: () => void;
}

export interface TitleScene {
  element: HTMLElement;
  /** `ground` is the same palette on a coarser clock; the cut face paints with it. */
  setPalette(palette: TitlePalette, ground?: TitlePalette): void;
  setCelestial(sun: CelestialBody, moon: CelestialBody): void;
  /**
   * Which season the verge is drawn in (`scenery.ts`). The world's own season
   * number: the title's wheel wraps it, so the flowers follow the year without
   * the title knowing how long a season lasts.
   */
  setSeason(seasonNumber: number): void;
  /**
   * The between-steps motion of the two bodies, on its own frame loop.
   *
   * `setCelestial` places the discs on the arc in percentages, which is what keeps
   * them with the sky through a zoom or a drag - but a percentage is a layout, so
   * it can only be written a few times a minute. This writes the difference as a
   * translate on the same two elements, which is a compositor move: sixty a second
   * for the price of two, and the body crosses the sky instead of hopping.
   */
  setCelestialSmooth(sun: CelestialBody, moon: CelestialBody): void;
  /** Rain, fog, wind and cloud cover for this hour of the title's day. */
  setWeather(weather: TitleWeather): void;
  /**
   * Slide an element beside the scene (the ground plane, the plant, the care bar)
   * with the drag, at its own share of the near plane's travel. `anchor` is the
   * positioning part of the element's own transform, which an inline transform
   * replaces (`translate(-50%, -100%)` for the plant).
   */
  addParallaxHost(el: HTMLElement, factorX: number, factorY: number, anchor?: string): void;
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

/**
 * How far a palette colour may move before the sky is repainted, in 8-bit
 * channels.
 *
 * A sky step moves most colours by well under two levels; each write repaints
 * the gradient stack, the clouds and the horizon bands, which is the once-a-step
 * hitch. Skipping the sub-level steps turns one repaint per step into one every
 * two or three, and leaves the drawn colour within two levels of the clock.
 */
const PALETTE_COLOUR_TOLERANCE = 2;

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
    /* None of this picture is a document. Without these a press that travels can
       select a nearby label or start the browser's own image/link drag, which is
       what leaves the no-drop cursor behind after a release; the nickname field
       opts back into selection in the menu's own stylesheet. */
    user-select: none;
    -webkit-user-select: none;
    -webkit-user-drag: none;
    /* No cursor of its own until it is being dragged: the scene covers most of the
       title, and a grab cursor over all of it made the grab leaf read as the
       default pointer. It inherits the plain leaf and only changes while held. */
    /* The sky is painted for the whole world above the line, not for one screen of
       it: the ramp is as tall as the horizon below it and gets deeper towards the
       top, so pulling the camera back reveals more sky instead of ending the
       picture at an edge. */
    /* The stops are shares of the world's sky, and the world's sky is now exactly
       the pane's sky divided by ZOOM_MIN (see .pl-menu__world). At zoom 1 the
       player sees the bottom 55% of this ramp and no more, so the three stops that
       were at 70%, 88% and 100% of a 140vh ramp sit at 57.2%, 82.9% and 100% of
       this one: the colour at every height above the horizon is unchanged, which
       is the whole point of the retune. The top stop is the colour the old ramp
       had at the top of the frame at the 0.55 limit - 42.7% of the way from the
       deep mix up to the sky's own high tone - so pulling the camera back still
       ends on the sky it used to end on, not on a black band. */
    background-image: linear-gradient(
      180deg,
      color-mix(in srgb, var(--pl-sky-high, #4d7fa8) 43%, #05070f) 0%,
      var(--pl-sky-high, #4d7fa8) 57.2%,
      var(--pl-sky-mid, #7fa8c4) 82.9%,
      var(--pl-sky-low, #c6d8d8) 100%
    );
    background-repeat: no-repeat;
    background-size: 100% var(--pl-horizon, 54%);
  }
  .pl-scene.is-dragging { cursor: grabbing; }

  /* Sky box: everything above the horizon, in one coordinate space. */
  .pl-scene__sky {
    position: absolute;
    /* The weather band: the part of the sky above the line that the sun, the moon,
       the stars and the clouds are placed in. It is the sky the player can see at
       whatever zoom the camera is at: the pane's sky is --pl-horizon-base tall on
       screen, and a box of (that / zoom) world units is exactly that tall on
       screen. As a flat 58vh of the world it shrank with the camera, and pulling
       back left a straight cut across the top of the frame with no stars, weather
       or light above it - only the scene's flat gradient. */
    left: 0;
    right: 0;
    /* A few pixels past the top edge: the camera's scale lands on fractional
       pixels at the pulled-back limit, and an exact fit left a hairline of bare
       scene above the sky. Six pixels move the gradient's stops by under a
       percent. */
    /* A fixed, pane-tall band on the horizon. It used to be sized in world units
       divided by the zoom, so its box had to be re-laid out on every step of a
       zoom - which is why the sky "fitted itself" late: the box moved when the
       variable landed, a quarter of a second after the camera stopped. The box is
       constant now and the camera's own scale is cancelled on it (see
       publishZoom), so the sky is the right size on every frame instead of on the
       frame after. */
    top: calc(var(--pl-world-horizon, 140vh) - var(--pl-horizon-base, 54vh) - 6px);
    height: calc(var(--pl-horizon-base, 54vh) + 6px);
    --pl-screen-w: 100vw;
    transform-origin: 50% 100%;
    /* Promoted so the counter-scale is the compositor's job. Without it every step
       of a zoom re-rasterised the whole band - stars, twenty clouds, the storm
       bank - which is the expensive half of the zoom on a large window. */
    will-change: scale;
    overflow: hidden;
    pointer-events: none;
  }
  /* The sun and the moon live on a pane-wide arc.
     The sky box is the whole 200vw world so stars and clouds fill it at any
     zoom, but the heavenly bodies' arc is authored against the frame the player
     can see: at 5..95% of the world the sun rose and set 40vw off screen and
     popped in and out of the middle of the air. A pane-wide layer inside the
     sky keeps them whole, and keeps their percentages meaning the pane. */
  .pl-scene__arc {
    position: absolute;
    /* Inset by the body's own radius plus a little air. The sky box starts above
       the pane's top edge, so a sun at the top of its 0..100% path put half its
       disc over the frame - the midday sun was cut by a straight line. The arc
       still ends on the horizon, where the sky's own clip sets it. */
    top: calc(var(--pl-celestial-size, 11.6vmin) / 2 + 14px);
    bottom: 0;
    left: 50%;
    /* Pane-wide on screen at any zoom, like the finds layer: the day cycle writes
       the bodies' x as shares of the frame, so a box that shrinks with the world
       put the afternoon sun a third of the way into the sky. */
    width: var(--pl-screen-w);
    margin-left: calc(var(--pl-screen-w) / -2);
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
    /* Soft in both axes from the gradient itself. A 14px blur over a band this
       size is a full-screen re-filter every time the sky recolours, and the
       milky way is faint enough that the gradient is all it ever needed. */
    background: radial-gradient(
      ellipse 62% 54% at 50% 50%,
      rgba(214, 226, 255, 0.55) 0%,
      rgba(196, 214, 255, 0.34) 46%,
      transparent 74%
    );
    opacity: var(--pl-milkyway, 0);
    pointer-events: none;
  }
  /* A wide warm lobe sitting on the horizon under the sun. */
  .pl-scene__bloom {
    position: absolute;
    /* World-wide, not pane-wide: the glow's box is what its gradient is clipped
       to, so a pane-wide box pulled back with the camera left two hard vertical
       edges in the middle of the frame. The sun's x is a share of the pane, and
       the pane is centred in the world, so the same physical point is
       50% + (x - 50%) / 2 of a world twice as wide. The 46% ellipse is then the
       same lobe size it always had. */
    left: 0;
    right: 0;
    /* In vh, not shares of the world: the world's height answers to the zoom floor
       now, and an authored share of it would have shrunk the lobe with the box. */
    top: calc(var(--pl-horizon, 54%) - 46vh);
    height: 60vh;
    z-index: 5;
    background: radial-gradient(
      ellipse 46% 100% at 50% 100%,
      color-mix(in srgb, var(--pl-sun-core, #fff2c4) 78%, transparent) 0%,
      color-mix(in srgb, var(--pl-sun-core, #fff2c4) 34%, transparent) 42%,
      transparent 78%
    );
    /* Two grades, one lobe: the hour's bloom and the sun's own glow. With the
       halo gone from the disc, this is where the sky shows the sun - a wide band
       of light on the horizon, which is what a low sun actually does to the sky. */
    /* The lobe stays put. Following the sun meant a transform on a world-wide band
       that has to be redrawn whole whenever the sun steps; the sun's own halo
       moves with it, and a horizon glow centred on the sky reads as the light
       anyway. */
    opacity: calc(
      (var(--pl-bloom, 0) * 0.78 + var(--pl-sun-glow, 0.3) * 0.22) *
        (1 - var(--pl-storm, 0) * 0.8)
    );
    /* Normal, not screen. A blend mode on a world-wide band forces the sky, the
       hills and the clouds behind it into one blended group that is recomposited
       whole whenever any of them repaints; the gradient already carries the light. */
    mix-blend-mode: normal;
    pointer-events: none;
  }
  /* Air, not fog: a band of pale sky lying on the hills. */
  /* Weather.

     Both layers are transform-only animations over textures painted once: even in a
     storm the compositor is moving strips of rain it already drew, not repainting a
     tree. That is the rule this screen is built on - nothing that runs on a frame may
     paint. */
  /* Weather crosses over. The sky ticks once a second and a change of weather used
     to arrive in one tick: the fog band, the rain and the wet ground all jumped.
     These transitions are that crossfade, and they are cheap because they animate
     opacity and filter, never layout. */
  .pl-scene__fog,
  .pl-scene__rain,
  .pl-scene__wet,
  .pl-scene__splash {
    transition: opacity 9s ease, filter 9s ease;
  }
  /* One front, in order. A change of weather used to cross over in a single length
     of time for every part of it: the clouds, the rain and the wet ground all began
     and ended together, so the sky turned grey at the same moment the ground turned
     wet and it read as a filter being dragged, not as weather arriving. The sky now
     gathers first (six seconds), the rain starts a beat later, and the ground wets
     after the rain has had time to land. Clearing is the same sequence in reverse
     because the delays are symmetric - the rain stops and the ground dries behind it
     while the sky is still clouded. */
  .pl-scene__clouds { transition: opacity 6000ms ease, filter 6000ms ease; }
  .pl-scene__fog {
    position: absolute;
    inset: 0;
    z-index: 11;
    pointer-events: none;
    background: linear-gradient(
      0deg,
      color-mix(in srgb, var(--pl-fog-colour, #c9d3d6) 86%, transparent) 0%,
      color-mix(in srgb, var(--pl-fog-colour, #c9d3d6) 44%, transparent) 30%,
      transparent 62%
    );
    opacity: var(--pl-fog, 0);
    transition: opacity 3400ms linear 400ms;
  }
  /* Precipitation is a field of drops, one element each.

     It used to be a tiled alpha mask: one paint, one compositor translate, very
     cheap - and blind. A mask has no drop positions to know, because every copy of
     the tile puts drops in the same places modulo the tile's own width, so the
     layers underneath (rings, pools, drifts) could only guess where the rain was
     hitting and ended up scattered over ground the shower never reached. These
     drops are placed once across the pane and their columns are read by every
     layer they feed, so a landing, the ring it throws and the pool it leaves are
     the same event. */
  .pl-scene__rain,
  .pl-scene__snow {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    /* The column ends at the ground line: a drop stops falling where the surface
       is, which is what makes its arrival a landing rather than a fade. */
    height: calc(var(--pl-horizon, 54%) + 6vh);
    /* How far a drop travels to reach the surface, from its own column. */
    --pl-fall-travel: calc(var(--pl-horizon, 54%) + 6vh);
    z-index: 12;
    pointer-events: none;
    overflow: hidden;
    /* Nine tenths of a second after the sky starts to gather: rain does not begin
       in a clear sky, and a shower that starts on the same frame as the cloud
       cover reads as a layer being switched on. */
    transition: opacity 3400ms linear 900ms;
  }
  .pl-scene__rain { opacity: var(--pl-rain, 0); }
  .pl-scene__snow { opacity: var(--pl-snow, 0); }
  /* A layer at zero is not on screen, so it must not animate: 100 drops, 70
     flakes and 68 splash rings were compositing every frame under a clear sky,
     which cost the title a third of its frames (measured 22 -> 37 fps on a
     1161x934 pane). Paused by class rather than removed, so the first shower
     resumes the field it froze instead of rebuilding it. */
  /* The weather layers hang off the weather host, not the scene element, so the
     idle classes are written there by the weather step. */
  .is-rain-idle .pl-scene__rain i,
  .is-rain-idle .pl-scene__splash b,
  .is-rain-idle .pl-scene__splash b::after,
  .is-snow-idle .pl-scene__snow i {
    animation-play-state: paused;
  }
  .pl-scene__rain i {
    position: absolute;
    /* Each drop ends where it lands, and lands where it is drawn - on the surface
       its own column carries, which is the settled lid or the drift over it, or
       the top of a pool (--pl-land-lift, written from the layer's own shapes). */
    top: calc(var(--pl-horizon, 54%) - var(--pl-land-lift, 0px));
    width: var(--pl-drop-w, 2px);
    height: var(--pl-drop-h, 14px);
    margin-left: calc(var(--pl-drop-w, 2px) * -0.5);
    border-radius: 50% 50% 40% 40%;
    background: linear-gradient(
      180deg,
      transparent 0%,
      color-mix(in srgb, var(--pl-rain-colour, #d6e6ef) 55%, transparent) 45%,
      var(--pl-rain-colour, #d6e6ef) 100%
    );
    opacity: var(--pl-drop-alpha, 0.8);
    /* A storm falls faster than a drizzle: one variable on the layer, so changing
       the weather never rebuilds the field. */
    /* Rain falls faster in wind, as it does outside. */
    animation: pl-drop-fall
      calc(var(--pl-drop-dur, 0.8s) * var(--pl-fall-scale, 1) * var(--pl-wind-speed, 1)) linear
      infinite;
    animation-delay: var(--pl-drop-delay, 0s);
    will-change: transform;
  }
  .pl-scene__snow i {
    position: absolute;
    /* On the drift's crown, not the ground under it. */
    top: calc(var(--pl-horizon, 54%) - var(--pl-land-lift, 0px));
    width: var(--pl-flake-size, 4px);
    height: var(--pl-flake-size, 4px);
    margin-left: calc(var(--pl-flake-size, 4px) * -0.5);
    border-radius: 50%;
    background: var(--pl-snow-colour, #eef4f8);
    opacity: var(--pl-drop-alpha, 0.8);
    /* The fall is a transform; the drift is a separate translate, so the two
       compose on the compositor instead of fighting over one property. */
    animation:
      pl-drop-fall var(--pl-drop-dur, 9s) linear infinite,
      pl-snow-sway calc(var(--pl-drop-dur, 9s) * 0.55) ease-in-out infinite alternate;
    animation-delay: var(--pl-drop-delay, 0s);
    will-change: transform;
  }
  /* Where the rain lands: on the surface line itself, not somewhere down the
     soil face. Rings open on the ground and each one throws a short column of
     spray; a ring with no spray reads as a ripple on water, and rain on earth
     kicks. The band starts at the horizon, so top: 0 is the ground. */
  .pl-scene__splash {
    position: absolute;
    left: 0;
    right: 0;
    top: var(--pl-horizon, 54%);
    /* A landing happens on the surface, which is this line: the band is a hand's
       width of it, not sixteen per cent of the pane down the cut face. */
    height: 3.2vh;
    z-index: 13;
    pointer-events: none;
    /* The rings are pushed by the pointer (see pushNear): a translate on its
       own property, so it composes with the scale the keyframes animate. */
    opacity: calc(var(--pl-rain, 0) * var(--pl-rain-heat, 1) * 0.96);
    transition: opacity 2600ms linear;
    overflow: hidden;
  }
  /* Snow that has landed: drifts along the whole ground line, not a flurry that
     vanishes at the soil. The band sits on the horizon like the splash band, so
     flakes settle where the eye sees them land. */
  .pl-scene__settle {
    position: absolute;
    left: 0;
    right: 0;
    /* Snow settles on the surface, and the surface is the horizon line. The band
       hangs *above* it: anything below that line is the cut face of the soil, and
       a drift painted there was snow lying in a cross-section - the thing the eye
       reads as a pile on the ground cutout rather than on the ground. */
    top: calc(var(--pl-horizon, 54%) - 2.6vh);
    height: 2.6vh;
    z-index: 13;
    pointer-events: none;
    overflow: hidden;
    opacity: var(--pl-snow, 0);
    transition: opacity 2600ms linear;
  }
  /* The bank itself. The drifts alone were a scatter of soft blobs on the cut,
     which read as flakes lying about rather than as snow that had fallen: a heavy
     settled drift is a solid lid on the ground line with a soft belly, and it
     deepens as the fall does. */
  .pl-scene__settle::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    /* The settled lid sits on the ground line at the bottom of the band: a few
       pixels of standing snow, thickening with the fall, with its soft belly
       above it and nothing spilling onto the cut. */
    bottom: 0;
    height: calc(2px + var(--pl-snow, 0) * 7px);
    /* Only where snow actually lands: the mask is written from the flake field's
       own columns, so the lid thickens where the fall is heavy and disappears on
       ground no flake reached. */
    -webkit-mask-image: var(--pl-settle-mask, none);
    mask-image: var(--pl-settle-mask, none);
    -webkit-mask-size: 100% 100%;
    mask-size: 100% 100%;
    background: linear-gradient(
      0deg,
      var(--pl-snow-colour, #eef4f8) 0%,
      color-mix(in srgb, var(--pl-snow-colour, #eef4f8) 78%, transparent) 52%,
      transparent 100%
    );
  }
  .pl-scene__settle i {
    position: absolute;
    border-radius: 50%;
    background: radial-gradient(
      ellipse at 50% 30%,
      var(--pl-snow-colour, #eef4f8) 0%,
      color-mix(in srgb, var(--pl-snow-colour, #eef4f8) 55%, transparent) 62%,
      transparent 100%
    );
    }
  .pl-scene__splash b {
    position: absolute;
    width: 24px;
    height: 6px;
    margin-top: -3px;
    border-radius: 50%;
    /* Each ring is its own size and rhythm (set inline when the layer is built),
       because thirty-four identical rings in step read as one animation printed
       across the ground. */
    width: calc(20px * var(--pl-ring-scale, 1));
    height: calc(5px * var(--pl-ring-scale, 1));
    margin-left: calc(-10px * var(--pl-ring-scale, 1));
    translate: var(--pl-push-x, 0px) var(--pl-push-y, 0px);
    /* A tight ring and a thrown one in a single stroke: the near edge is solid
       and the far edge is a shadow, which is what a landing looks like from
       above the ground rather than a printed circle. */
    border: 1.5px solid color-mix(in srgb, var(--pl-rain-colour, #d6e6ef) 82%, transparent);
    border-top-color: transparent;
    box-shadow: 0 0 6px 1px color-mix(in srgb, var(--pl-rain-colour, #d6e6ef) 22%, transparent);
    animation: pl-splash 620ms linear infinite;
    will-change: transform, opacity;
  }
  /* The spray: two pixels of water thrown up out of the ring and falling back. */
  .pl-scene__splash b::after {
    content: '';
    position: absolute;
    left: 50%;
    bottom: 2px;
    width: 2px;
    height: 10px;
    margin-left: -1px;
    border-radius: 1px;
    background: linear-gradient(
      0deg,
      color-mix(in srgb, var(--pl-rain-colour, #d6e6ef) 72%, transparent),
      transparent
    );
    animation: pl-splash-spray 620ms linear infinite;
  }
  /* Positions are generated across the layer's whole width when it is built, so
     the rain lands wherever it falls instead of on six fixed spots around the
     tree. The percentages here are only the default for a ring with no inline
     position (a test fixture, or a layer built before the generator ran). */
  .pl-scene__splash b { left: 25%; top: 2%; }
  @keyframes pl-splash {
    0% { transform: scale(0.2, 0.6); opacity: 0; }
    18% { opacity: 0.95; }
    100% { transform: scale(1.35, 1); opacity: 0; }
  }
  @keyframes pl-splash-spray {
    0%, 100% { opacity: 0; transform: translateY(0) scaleY(0.3); }
    22% { opacity: 0.85; }
    70% { opacity: 0; transform: translateY(-9px) scaleY(1); }
  }
  /* Wet ground: the near soil takes a cool, darker cast while it is raining. One
     translucent gradient, no blend mode - it is a grade, not a second render. */
  .pl-scene__wet {
    position: absolute;
    left: 0;
    right: 0;
    top: var(--pl-horizon, 54%);
    bottom: -10%;
    z-index: 10;
    pointer-events: none;
    overflow: hidden;
    background: linear-gradient(
      180deg,
      rgba(28, 44, 58, 0.24) 0%,
      rgba(16, 30, 42, 0.44) 40%,
      rgba(10, 20, 30, 0.34) 100%
    );
    opacity: calc(var(--pl-rain, 0) * var(--pl-rain-heat, 1) * 0.95);
    /* Last, and slowest to leave: the ground is still wet after a shower passes,
       so it holds the grade for longer than the rain holds the sky. */
    transition: opacity 3400ms linear 1500ms;
  }
  /* The pools themselves. Small, flat and soft, so they read as water lying in the
     cut rather than as bright spots printed on it. */
  .pl-scene__puddles {
    position: absolute;
    left: 0;
    right: 0;
    /* Pools lie where the rain reached the ground, which is the surface line; the
       pools are thin lenses on that line, not spots scattered across the cut. */
    top: var(--pl-horizon, 54%);
    height: 2.4vh;
    pointer-events: none;
    /* Both: water needs rain, and enough of it to pool. Snow is not a puddle. */
    opacity: calc(var(--pl-rain, 0) * max(0, var(--pl-rain-heat, 1) - 0.45) * 1.7);
    transition: opacity 3400ms linear 2100ms;
  }
  .pl-scene__puddles i {
    position: absolute;
    border-radius: 50%;
    background: radial-gradient(
      ellipse at 50% 32%,
      color-mix(in srgb, var(--pl-sky-low, #cda084) 46%, transparent) 0%,
      color-mix(in srgb, var(--pl-sky-low, #cda084) 22%, transparent) 58%,
      transparent 100%
    );
  }
  @keyframes pl-drop-fall {
    from { transform: translate3d(0, calc(-1 * var(--pl-fall-travel, 120vh)), 0); }
    to { transform: translate3d(0, 0, 0); }
  }
  @keyframes pl-snow-sway {
    from { translate: -14px 0; }
    to { translate: 14px 0; }
  }
  /* Lightning. A storm is not only darker: now and then the sky lights the
     ground from above. One layer, one opacity animation on the compositor, no
     blend mode (a full-screen screen blend is a full-screen blend every frame).
     Off at zero storm, so a clear sky pays for nothing but a zero-opacity layer. */
  .pl-scene__flash {
    position: absolute;
    inset: 0;
    z-index: 9;
    pointer-events: none;
    background: radial-gradient(
      ellipse 130% 90% at 50% 0%,
      rgba(226, 236, 246, 0.92) 0%,
      rgba(190, 206, 220, 0.34) 46%,
      transparent 82%
    );
    opacity: 0;
    animation: pl-flash 11s linear infinite;
    will-change: opacity;
  }
  @keyframes pl-flash {
    0%, 86%, 100% { opacity: 0; }
    87% { opacity: var(--pl-flash, 0); }
    88.2% { opacity: calc(var(--pl-flash, 0) * 0.22); }
    89.6% { opacity: calc(var(--pl-flash, 0) * 0.78); }
    91% { opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .pl-scene__flash { animation: none; opacity: 0; }
  }
  /* Overcast: the same clouds, heavier and greyer, and the fair-weather highlights
     pulled down. The authored sky stays as it is; the weather is a grade over it. */
  /* Overcast: the same clouds, heavier and greyer. Dimmed, never filtered: a CSS
     filter on an element that is being translated re-rasterises the whole cloud
     outside the compositor on every frame of its crossing (see the note on the
     cloud art below), which is a stutter in exactly the weather that lasts. */
  .pl-scene.is-overcast .pl-scene__cloud {
    --pl-cloud-dim: 0.68;
  }
  .pl-scene.is-overcast .pl-scene__cloud--high {
    --pl-cloud-dim: 0.85;
  }
  .pl-scene__haze {
    position: absolute;
    left: 0;
    right: 0;
    /* vh for the same reason as the bloom: a share of the world's height is now a
       share of a box that answers to the zoom floor. */
    top: calc(var(--pl-horizon, 54%) - 21vh);
    height: 30vh;
    z-index: 6;
    background: linear-gradient(
      180deg,
      transparent 0%,
      color-mix(in srgb, var(--pl-sky-low, #c6d8d8) 70%, transparent) 62%,
      transparent 100%
    );
    /* Fog is air the light has to cross. Thicker fog is both more haze and a
       brighter haze - the same light spread through more of it - so the band's
       opacity is the palette's haze times the weather's fog. */
    opacity: calc(var(--pl-haze, 0.4) * (1 + var(--pl-fog, 0) * 1.2));
    pointer-events: none;
  }
  /* Storm cover: the cloud the rain is falling out of.

     A shower needs something to come from. This layer is a bank of low, heavy
     lobes over the hills - gradients only, so no blur filter is re-rastered, and
     the whole layer fades on the same nine-second crossfade as the rest of the
     weather. It is off at zero storm, which is every clear sky. */
  .pl-scene__nimbus {
    /* Written from the ground clock in the palette pass, so a rainstorm's bank
       does not repaint on every sky step for a hue nobody can see move. */
    --pl-storm-core: var(--pl-storm-colour, #3b444b);
    position: absolute;
    left: -8%;
    right: -8%;
    /* The sky box, not the world: the world is twice the pane and its top is off
       screen, so a percentage of it put the storm above the visible sky. */
    top: 0;
    height: 64%;
    z-index: 7;
    pointer-events: none;
    opacity: var(--pl-storm, 0);
    transition: opacity 6000ms ease 600ms;
  }
  .pl-scene__nimbus i {
    position: absolute;
    display: block;
    border-radius: 50%;
    background:
      radial-gradient(
        ellipse at 50% 56%,
        color-mix(in srgb, var(--pl-storm-core, #3b444b) 94%, transparent) 0 42%,
        transparent 76%
      ),
      radial-gradient(
        ellipse at 46% 32%,
        color-mix(in srgb, var(--pl-storm-core, #3b444b) 60%, transparent) 0 48%,
        transparent 84%
      );
  }
  .pl-scene__nimbus i:nth-child(even) { opacity: 0.8; }
  /* The air under a storm: one veil over the whole picture, so the hills, the
     soil, the plant and its roots lose the same light together. Switched by the
     weather - it is on in rain and in heavy cloud, and off the moment the sky
     clears - and stronger by day, where a storm has the most sun to take away. */
  .pl-scene__mood {
    position: absolute;
    inset: 0;
    z-index: 4;
    pointer-events: none;
    /* Also from the ground clock: a veil this flat has no visible hue change at
       the sky's 28-second step, and it covers the whole world when it paints. */
    background: var(--pl-mood-colour, #26313a);
    opacity: var(--pl-mood, 0);
    transition: opacity 6000ms ease;
  }
  /* Ninety separate twinkle animations meant ninety composited layers for a
     field of dots: the browser spent its frame budget blending them and slipped a
     handful of frames on a steady beat. The field is now eight groups, each with
     its own slow pulse, and the stars inside one are inert - the same shimmer, at
     a ninth of the layers. */
  .pl-scene__twinkle {
    position: absolute;
    inset: 0;
    animation: pl-star-twinkle var(--twinkle-duration, 4s) ease-in-out infinite;
    animation-delay: var(--twinkle-delay, 0s);
  }
  .pl-scene__star {
    position: absolute;
    background: #eaf0ff;
    border-radius: 50%;
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
  .pl-scene__star--bright { animation: none; }
  .pl-scene__star--bright::after {
    width: 1px;
    height: 13px;
    background: linear-gradient(180deg, transparent, #f2f6ff, transparent);
  }
  /* Shallower than a single star's pulse: a whole group dipping to 0.45 reads as
     a patch of sky switching off rather than as stars glittering. */
  @keyframes pl-star-twinkle {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }
  /* Twinkle only while there is a night to see it in. Ninety animated elements
     ticking through a daylight sky is ninety style recalculations a frame for
     stars that are fully transparent - and it was a measurable share of the
     title screen's frame time. */
  .pl-scene__stars:not(.is-lit) .pl-scene__twinkle { animation-play-state: paused; }
  @media (prefers-reduced-motion: reduce) {
    .pl-scene__twinkle { animation: none; }
  }
  .pl-scene__celestial {
    position: absolute;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    /* Opacity only. The position is a percentage of the arc, so a zoom or a drag
       carries the body with the sky with no script and nothing to carry between
       sky ticks; a translate transition would only lag behind the day cycle. */
    transition: opacity 600ms linear;
    pointer-events: none;
    /* Laid out from the day cycle's two numbers, resolved by CSS against the arc:
       left is the centre of the body, clamped so a rising sun is not cut in half
       by the frame, and top is (1 - height) down the arc, which ends on the
       horizon. Pixels here were right only at zoom 1. */
    left: clamp(
      calc(var(--pl-celestial-size, 11.6vmin) / 2 + 6px),
      calc(var(--pl-body-inset, 50) * 1%),
      calc(100% - var(--pl-celestial-size, 11.6vmin) / 2 - 6px)
    );
    top: calc((1 - var(--pl-body-height, 1)) * 100%);
  }
  /* A disc with an edge, and nothing around it.
     Three things made this look like a lamp with a halo: the body faded out over
     its own outer 40%, the box-shadow added a ring the size of the blur, and a
     400%-wide ::before painted a second, wider ring on top of the sky. A body in
     the sky has one edge. The light in this scene comes from the sky's own wash
     (the sun-wash variable), which is graded by hour, not from a halo stuck to a
     disc. */
  /* Sized in vmin, never in px.
     A px ceiling is what made the moon shrink when the browser was zoomed out:
     zoom-out grows the CSS viewport, so a vw-based disc hit its 68px cap while the
     hills around it kept growing with the frame. A viewport-unit size has no cap
     to hit, so the sun and moon keep their share of the scene at any zoom level. */
  /* One size for both bodies, from the sky layout module, so a change cannot land
     on the sun and leave the moon behind. */
  /* The discs are moved by the translate property, never by left and top. Moving
     one by its offsets relayouts the arc and repaints the disc, its halo and its
     blend layer on every step; a translate is a compositor move of a layer that is
     already drawn. The offsets are written in pixels by setCelestial. */
  .pl-scene__celestial {
    /* Two small discs: promoted, so a step repaints them rather than the sky. */
    will-change: opacity;
  }
  .pl-scene__sun {
    width: var(--pl-celestial-size, 11.6vmin);
    aspect-ratio: 1;
    /* A disc with a limb: white-hot in the middle, warming towards its own edge
       and darkening a little right at it, which is what a body in the air does. */
    background: radial-gradient(
      circle,
      #fffdf4 0 20%,
      color-mix(in srgb, var(--pl-sun-core, #ffe6a0) 56%, #fffdf4) 46%,
      color-mix(in srgb, var(--pl-sun-core, #ffe6a0) 86%, #ffc255) 78%,
      color-mix(in srgb, var(--pl-sun-core, #ffe6a0) 72%, #f08a2c) 94%,
      transparent 100%
    );
    box-shadow: none;
  }
  /* Corona, not halo: a soft wash of scattered light around the disc, sized and
     graded by the hour, sitting behind the body so the edge stays crisp. */
  .pl-scene__sun::after {
    content: '';
    position: absolute;
    inset: -150%;
    border-radius: 50%;
    background: radial-gradient(
      circle,
      color-mix(in srgb, var(--pl-sun-core, #fff2c4) 62%, transparent) 0 18%,
      color-mix(in srgb, var(--pl-sun-core, #fff2c4) 30%, transparent) 34%,
      transparent 70%
    );
    opacity: calc((0.42 + var(--pl-sun-glow, 0.3) * 0.7) * (1 - var(--pl-storm, 0) * 0.85));
    mix-blend-mode: screen;
    pointer-events: none;
    z-index: -1;
  }
  /* A tight white bloom on the rim itself: without it the disc and the bright sky
     around it were the same value, and the sky read as the light source. */
  .pl-scene__sun::before {
    content: '';
    position: absolute;
    inset: -34%;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(255, 255, 246, 0.72) 0 40%, transparent 72%);
    mix-blend-mode: screen;
    opacity: calc((0.5 + var(--pl-sun-glow, 0.3) * 0.6) * (1 - var(--pl-storm, 0) * 0.85));
    pointer-events: none;
    z-index: -1;
  }
  /* The moon is a body, not a lamp: a small halo of real air and nothing else.
     The same diameter as the sun: a moon a third smaller than the sun is a graphics
     error once the two share a sky, and the eye reads the pair before it reads
     either body. */
  .pl-scene__moon {
    width: var(--pl-celestial-size, 11.6vmin);
    aspect-ratio: 1;
    background: none;
    /* No filter on the disc. A drop-shadow on an element that is being translated
       cannot ride the compositor: the disc moves every frame, so it was rasterised
       blur and all every frame - the trap the clouds had. The light around it is the
       ::before wash, a gradient on its own layer that costs nothing to move. */
    box-shadow: none;
  }
  /* The light the moon throws into the air: one gradient, behind the disc and
     behind the clouds (the sky paints the bodies before the weather).

     Brightest at the rim and falling away into the air - the two stops do the work
     a rim bloom and a wide wash did as two layers, so there is one blend, one
     opacity and one layer to move. The disc's edge sits at about 21% of this box
     (the box is 3.4 discs wide), so the bright stop is just inside where the disc
     covers it and the falloff starts at the limb: a lit edge, then air. At -165%
     the halo's lower half reached the trunk's foot and read as a lamp behind the
     tree, so the box stays at -120%, where the falloff ends above the canopy. */
  .pl-scene__moon::before {
    content: '';
    position: absolute;
    inset: -120%;
    border-radius: 50%;
    background: radial-gradient(
      circle,
      rgba(240, 248, 255, 0.8) 0 17%,
      rgba(222, 238, 255, 0.62) 24%,
      rgba(186, 210, 255, 0.3) 36%,
      rgba(150, 180, 240, 0.12) 52%,
      transparent 68%
    );
    mix-blend-mode: screen;
    /* Fog widens it. Mist scatters a disc's light into the air around it, and the
       same light spreads with the weather's own fog number. */
    opacity: calc(var(--pl-moon-wash, 0) * (1 + var(--pl-fog, 0) * 0.5));
    pointer-events: none;
    z-index: -1;
  }
  /* The moon had the same 320%-wide halo as the sun. Removed with it: a ring of
     light around the body is the one thing the sky does not need twice. */
  .pl-scene__moon svg { display: block; width: 100%; height: 100%; }
  /* Maria have to survive being 40 px across: too low and the disc reads as a
     blank circle, too high and it reads as a golf ball. */
  .pl-scene__moon__mare { opacity: calc(0.26 + var(--pl-moon-wash, 0) * 0.42); }
  .pl-scene__moon__highlands { opacity: calc(0.14 + var(--pl-moon-wash, 0) * 0.08); }

  .pl-scene__clouds { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  /* The thin families are the high ones: a sheet of cirrus is air, and a veil of it
     low over the hills would just be fog. */
  /* No blur on the moving clouds. A CSS filter on an element that is being
     translated cannot ride the compositor: Chrome re-rasterises the whole cloud,
     filter and all, every frame of its crossing, which is exactly the halting
     drift the thin families showed. Their edges are already soft in the art. */
  .pl-scene__cloud--veil { opacity: 0.72; }
  .pl-scene__cloud--wisp { opacity: 0.62; }
  .pl-scene__cloud {
    position: absolute;
    /* Weather moves. This is a *crossing*, not a drift: a cloud enters off one edge
       and leaves past the other, in its own time, from its own starting offset.
       The old motion was two keyframes 2.2% of the cloud's own width apart over two
       minutes - about seven pixels an hour, which is a still sky with an animation
       in the file. The distance is in viewport widths (--pl-cloud-travel), so it is
       the same size as the sky it crosses. */
    /* The crossing itself is a Web Animation (see the cloud loop): its playback
       rate is the wind, so a gust changes the sky's speed without restarting a
       crossing. Driving it from a CSS animation-duration meant every weather tick
       re-created the animation, and a cloud that had been halfway across jumped
       back to its start - the regular pause in the sky. */
  }
  /* Each cloud is its own layer, so a crossing moves a picture that is already
     drawn instead of re-rasterising an SVG full of gradients into new tiles as it
     scrolls. Seventeen small layers is cheap; seventeen re-rasters a frame is not. */
  .pl-scene__cloud svg { display: block; width: 100%; height: auto; }
  .pl-scene__cloud {
    /* The table's own opacity, times the weather's dim. Two numbers on one
       property: the overcast grade must not need a filter, and the inline value
       the loop writes must not beat it. */
    opacity: calc(var(--pl-cloud-op, 1) * var(--pl-cloud-dim, 1));
    will-change: transform;
  }


  /* Ground layers stand on the horizon, so they never need to know the viewport. */
  .pl-scene__layer {
    position: absolute;
    /* Overscan in both axes. The layers slide against each other with the drag, and
       a range as narrow as the frame left the sky showing at the ends of a hard
       drag - the picture has to be bigger than the window it moves inside. */
    left: -18%;
    right: -18%;
    bottom: calc(100% - var(--pl-horizon, 54%));
  }
  /* The hills' own skirt.
     The layer sits exactly on the horizon line, so any vertical parallax lifted its
     base off the line and the sky showed through the gap between the hills and the
     soil - a bright seam under a range that is supposed to be the ground's far
     edge. This block is the same hills continued downward, wide enough to cover
     the clamp in both axes, and the stage paints over it. */
  .pl-scene__layer::after {
    content: '';
    position: absolute;
    /* Wide and deep enough that no drag can pull an edge of it into view, and tall
       enough to reach under the soil band and the grass that sits on it. A short
       skirt was the bright seam between the ridge and the ground it stands on. */
    left: -45%;
    right: -45%;
    top: calc(100% - 2px);
    height: 150vh;
    background: var(--pl-hill-near, #4f6b3f);
    pointer-events: none;
  }
  .pl-scene__layer--far { height: 26vh; }
  .pl-scene__layer--mid { height: 17vh; }
  .pl-scene__layer--near { height: 9vh; }
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

  /* -------------------------------------------------------------- the outskirts
     The props that make the horizon a place: flowers in season, mushrooms after
     rain, a barrel that holds what fell and a lamp from dusk. Each is painted once
     and switched by an opacity the scene writes from the scenery gates, and every
     animation here is a transform or an opacity on the compositor - nothing in this
     block paints per frame.

     The band is pane-wide in world units (100vw, like the finds band), so the props
     keep their size against the plant at any camera zoom. */
  .pl-scene__outskirts {
    position: absolute;
    left: 50%;
    width: 100vw;
    margin-left: -50vw;
    bottom: calc(100% - var(--pl-horizon, 54%));
    height: 9vh;
    z-index: 4;
    pointer-events: none;
  }
  .pl-scene__outskirts > * { position: absolute; bottom: 0; display: block; }
  .pl-scene__outskirts svg { display: block; width: 100%; height: 100%; overflow: visible; }

  /* A clump leans the way it was placed and sways on top of that, on the wind's own
     clock: the same four clumps stand still in a calm and work in a gale. Sized for
     a verge seen whole: at the old width a clump of three stems was twelve pixels
     of white dots and read as grit on the horizon. */
  .pl-scene__flower {
    width: calc(4.2vh * var(--s, 1));
    height: calc(9.6vh * var(--s, 1));
    transform: rotate(var(--lean, 0deg));
    transform-origin: 50% 100%;
    opacity: var(--pl-blooms, 1);
    transition: opacity 1600ms linear;
    z-index: 1;
  }
  .pl-scene__flower svg {
    transform-origin: 50% 100%;
    animation: pl-flower-sway var(--pl-sway-dur, 6s) ease-in-out infinite alternate;
  }
  @keyframes pl-flower-sway {
    from { transform: rotate(-2.4deg); }
    to { transform: rotate(2.4deg); }
  }

  /* Mushrooms: one band for the lot, so a shower that soaks the ground costs one
     opacity rather than a write per cluster. The puff is a click and a burst of
     spores; the class comes off when the animation ends. */
  .pl-scene__mushrooms {
    inset: 0;
    z-index: 2;
    opacity: var(--pl-mushrooms, 0);
    transition: opacity 1800ms linear;
  }
  .pl-scene__mushrooms i {
    position: absolute;
    bottom: 0;
    width: calc(4.4vh * var(--s, 1));
    height: calc(3.7vh * var(--s, 1));
    margin-left: calc(-2.2vh * var(--s, 1));
    transform: rotate(var(--tilt, 0deg));
    transform-origin: 50% 100%;
  }
  .pl-scene__mushrooms.is-out i { pointer-events: auto; cursor: pointer; }
  .pl-scene__mushrooms i.is-puffed svg { animation: pl-mushroom-puff 680ms ease; }
  .pl-scene__mushrooms i::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 26%;
    width: 90%;
    aspect-ratio: 1;
    translate: -50% -50%;
    border-radius: 50%;
    background: radial-gradient(
      circle,
      color-mix(in srgb, var(--pl-mushroom-spot, #f3e7cf) 70%, transparent) 0 26%,
      transparent 68%
    );
    opacity: 0;
    pointer-events: none;
  }
  .pl-scene__mushrooms i.is-puffed::after { animation: pl-spore-puff 720ms ease-out; }
  @keyframes pl-mushroom-puff {
    0%, 100% { transform: scale(1); }
    32% { transform: scale(1.14) translateY(-3%); }
  }
  @keyframes pl-spore-puff {
    0% { opacity: 0; scale: 0.35; }
    28% { opacity: 0.85; }
    100% { opacity: 0; scale: 2.3; }
  }

  /* The barrel's water is a div, not part of the drawing: its level is the ground's
     own soak, so the barrel is full when the soil is and empty when it has drained. */
  .pl-scene__barrel {
    left: 79%;
    width: 4.4vh;
    height: 5.6vh;
    z-index: 3;
  }
  .pl-scene__barrel svg { position: absolute; inset: 0; }
  .pl-scene__barrel-water {
    position: absolute;
    left: 18%;
    right: 18%;
    bottom: 8%;
    height: calc(var(--pl-soak, 0) * 58%);
    border-radius: 34% 34% 5px 5px / 18% 18% 5px 5px;
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--pl-sky-low, #c6d8d8) 82%, transparent),
      color-mix(in srgb, var(--pl-sky-high, #4d7fa8) 62%, transparent)
    );
    transition: height 1800ms linear;
  }

  /* The lamp answers the dark rather than an hour, and its glow is its own opacity:
     a gradient around a lamp, no blend mode and no filter. The post itself is a
     thing in the field at every hour - it used to carry the lamp's opacity on the
     whole element, so a lamp post appeared out of the air at dusk and disappeared
     at dawn. Only the glass and the glow answer the light now. */
  .pl-scene__lantern {
    left: 97%;
    width: 3.6vh;
    height: 9.2vh;
    z-index: 3;
  }
  .pl-scene__lamp-glass {
    /* Cold panes in daylight, warm ones after dusk. */
    opacity: calc(0.12 + 0.88 * var(--pl-lamp, 0));
    transition: opacity 2600ms linear;
  }
  .pl-scene__lantern::before {
    content: '';
    position: absolute;
    left: 50%;
    top: 44%;
    width: 9vh;
    aspect-ratio: 1;
    translate: -50% -50%;
    border-radius: 50%;
    background: radial-gradient(
      circle,
      color-mix(in srgb, var(--pl-lamp-warm, #ffd28a) 55%, transparent) 0 16%,
      color-mix(in srgb, var(--pl-lamp-warm, #ffd28a) 20%, transparent) 38%,
      transparent 66%
    );
    opacity: var(--pl-lamp, 0);
    pointer-events: none;
  }

  /* The sky's own traffic: two flocks of birds at different distances and a flight
     of bats after dark. The pane-wide arc carries them at the frame's coordinates,
     like the sun and the moon. */
  .pl-scene__skylife { position: absolute; inset: 0; pointer-events: none; }
  .pl-scene__flock {
    position: absolute;
    top: 22%;
    left: -14%;
    width: 11vw;
    animation: pl-flock-cross 58s linear infinite;
  }
  .pl-scene__flock svg { display: block; width: 100%; height: auto; overflow: visible; }
  .pl-scene__flock--day {
    opacity: var(--pl-birds, 0);
    transition: opacity 2400ms linear;
  }
  .pl-scene__flock--far {
    top: 11%;
    width: 7vw;
    animation-duration: 76s;
    animation-delay: -30s;
  }
  .pl-scene__flock--night {
    top: 15%;
    width: 7vw;
    opacity: var(--pl-bats, 0);
    animation-duration: 44s;
    animation-delay: -12s;
    transition: opacity 2400ms linear;
  }
  @keyframes pl-flock-cross {
    from { transform: translate3d(0, 0, 0); }
    to { transform: translate3d(128vw, 1.5vh, 0); }
  }

  /* The mill on the middle ridge: a landmark, and the only thing up there that shows
     the wind without a leaf moving. Its sails turn at the wind's own pace. */
  .pl-scene__mill {
    position: absolute;
    left: 62%;
    bottom: 44%;
    width: 4.6vh;
    height: 6.4vh;
    pointer-events: none;
  }
  .pl-scene__mill svg { display: block; width: 100%; height: 100%; overflow: visible; }
  .pl-scene__sails {
    transform-box: view-box;
    transform-origin: 32px 34px;
    animation: pl-mill-turn var(--pl-sail-dur, 30s) linear infinite;
  }
  @keyframes pl-mill-turn {
    from { rotate: 0deg; }
    to { rotate: 360deg; }
  }

  /* The rabbit in the near field. It is a silhouette in the land's own colour, and
     it hops when it is touched - the field's one bit of wildlife that answers back.
     It sits in the open ground left of the verge: at 40% it stood exactly behind the
     WATER and FEED chips, where nobody could see it. */
  .pl-scene__rabbit {
    position: absolute;
    left: 30%;
    bottom: 26%;
    width: 2.6vh;
    pointer-events: none;
    opacity: var(--pl-rabbit-level, 0);
    transition: opacity 1800ms linear;
  }
  .pl-scene__rabbit svg { display: block; width: 100%; height: auto; overflow: visible; }
  .pl-scene__rabbit.is-out { pointer-events: auto; cursor: pointer; }
  .pl-scene__rabbit.is-hopped svg { animation: pl-rabbit-hop 760ms ease; }
  @keyframes pl-rabbit-hop {
    0%, 100% { transform: translateY(0) rotate(0deg); }
    28% { transform: translateY(-3px) rotate(-5deg); }
    58% { transform: translateY(-6px) rotate(3deg); }
    82% { transform: translateY(-1px) rotate(-1deg); }
  }

  /* Underground life, only where the menu gives the cut its face. Both are placed
     from the pane's centre in world units, so they stay clear of the title column
     at every zoom. */
  .pl-scene__soil {
    position: absolute;
    inset: 0;
    z-index: 1;
    pointer-events: none;
    overflow: hidden;
  }
  .pl-scene__worm {
    position: absolute;
    left: 50%;
    margin-left: 27vw;
    top: 11vh;
    width: 5.2vh;
    height: 1.9vh;
    opacity: var(--pl-worms, 0);
    transition: opacity 2200ms linear;
  }
  .pl-scene__worm svg {
    animation: pl-worm-inch 12s ease-in-out infinite;
  }
  .pl-scene__soil svg { display: block; width: 100%; height: 100%; }
  @keyframes pl-worm-inch {
    0%, 100% { transform: translateX(-6px) rotate(-3deg); }
    50% { transform: translateX(12px) rotate(4deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .pl-scene__flower svg,
    .pl-scene__sails,
    .pl-scene__flock,
    .pl-scene__rabbit svg,
    .pl-scene__worm svg { animation: none; }
  }

  @media (prefers-reduced-motion: reduce) {
    .pl-scene__layer { transition: none; }
    .pl-scene__stars, .pl-scene__celestial, .pl-menu__wash { transition: none; }
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
  // A range behind the range. Two ridges at the same distance stack into one band
  // however different their colours are; what says "further" is a crest line
  // *above* the ones in front, lighter than they are because there is more air in
  // front of it. It is the deepest thing in the picture, which is what the far
  // layer was missing.
  const deepRidge =
    'M0 90 Q92 44 176 62 Q262 82 324 30 Q372 18 424 58 Q492 108 562 76 ' +
    'Q634 44 700 84 Q764 118 838 70 Q908 26 978 66 Q1048 106 1122 74 ' +
    'Q1196 42 1268 80 Q1338 120 1408 74 Q1476 34 1540 66 Q1576 84 1600 78';
  const farRidge =
    'M0 158 Q110 108 210 128 Q300 148 378 104 Q456 60 540 96 Q622 132 702 112 ' +
    'Q790 90 860 130 Q932 168 1010 132 Q1088 94 1168 120 Q1248 144 1328 106 ' +
    'Q1408 66 1490 108 Q1546 130 1600 150';
  const nearRidge =
    'M0 208 Q140 168 262 188 Q382 206 470 172 Q560 138 652 170 Q732 198 820 182 ' +
    'Q920 164 1010 190 Q1100 216 1190 186 Q1280 156 1370 184 Q1458 212 1530 196 ' +
    'Q1570 188 1600 194';
  return `
    <svg class="pl-scene__art" viewBox="0 0 1600 260" preserveAspectRatio="none" aria-hidden="true">
      <path d="${deepRidge} L1600 260 L0 260 Z" fill="var(--pl-hill-distant, #7d94a2)"/>
      <path d="${farRidge} L1600 260 L0 260 Z" fill="var(--pl-hill-far)"/>
      <path d="${farRidge}" fill="none" stroke="var(--pl-hill-rim, #9fb8a0)" stroke-width="2"
            stroke-opacity="var(--pl-hill-rim-opacity, 0.35)" stroke-linecap="round"/>
      <path d="${nearRidge} L1600 260 L0 260 Z" fill="var(--pl-hill-near)"/>
      <path d="${nearRidge}" fill="none" stroke="var(--pl-hill-rim, #9fb8a0)" stroke-width="2"
            stroke-opacity="var(--pl-hill-rim-opacity, 0.35)" stroke-linecap="round"/>
    </svg>`;
}

/**
 * The middle range, and a treeline standing on it.
 *
 * The trees are a band of triangles with their bases below the ridge's crest, so
 * they read as a wood in front of the hill rather than as decoration hung on its
 * outline: two heights, two widths, never evenly spaced, because a real treeline
 * is the least regular thing in a landscape.
 */
function midArt(): string {
  const ridge =
    'M0 176 Q120 132 238 152 Q356 172 452 138 Q548 104 654 136 Q760 168 868 150 ' +
    'Q968 134 1074 158 Q1180 182 1288 154 Q1388 128 1490 152 Q1552 166 1600 158';
  const at = [
    54, 128, 196, 262, 338, 404, 478, 546, 618, 692, 764, 838, 908, 978, 1052, 1122, 1196, 1268,
    1334, 1404, 1478, 1544, 1590,
  ];
  const trees = at
    .map((x, index) => {
      const y = 190 + (index % 3) * 4;
      const h = 24 + (index % 4) * 8;
      const w = 10 + (index % 2) * 5;
      return `<path d="M${x} ${y - h} L${x + w} ${y + 6} L${x - w} ${y + 6} Z"/>`;
    })
    .join('');
  return `
    <svg class="pl-scene__art" viewBox="0 0 1600 260" preserveAspectRatio="none" aria-hidden="true">
      <path d="${ridge} L1600 260 L0 260 Z" fill="var(--pl-hill-mid, #2b3d32)"/>
      <g fill="var(--pl-hill-mid, #2b3d32)" opacity="0.9">${trees}</g>
      <path d="${ridge}" fill="none" stroke="var(--pl-hill-rim, #9fb8a0)" stroke-width="1.6"
            stroke-opacity="calc(var(--pl-hill-rim-opacity, 0.35) * 0.8)" stroke-linecap="round"/>
    </svg>`;
}

/**
 * The nearest range: low soft hills with a rock or two, dark enough to sit under
 * the soil without competing with it. This is the plane the eye crosses last, so it
 * moves most under the drag.
 */
function nearArt(): string {
  const ridge =
    'M0 226 Q140 196 292 214 Q430 230 556 208 Q690 186 812 210 Q940 234 1064 212 ' +
    'Q1194 190 1320 210 Q1444 228 1540 212 Q1572 208 1600 214';
  const rocks = [
    'M212 226 Q222 210 236 214 Q248 218 246 228 Z',
    'M742 220 Q756 202 772 208 Q786 214 782 226 Z',
    'M1188 226 Q1198 212 1210 216 Q1220 220 1216 228 Z',
  ].join('');
  return `
    <svg class="pl-scene__art" viewBox="0 0 1600 260" preserveAspectRatio="none" aria-hidden="true">
      <path d="${ridge} L1600 260 L0 260 Z" fill="var(--pl-hill-deep, #16231d)"/>
      <g fill="var(--pl-hill-deep, #16231d)" opacity="0.92">${rocks}</g>
      <path d="${ridge}" fill="none" stroke="var(--pl-hill-rim, #9fb8a0)" stroke-width="1.2"
            stroke-opacity="calc(var(--pl-hill-rim-opacity, 0.35) * 0.55)" stroke-linecap="round"/>
    </svg>`;
}

const ART: Record<SceneLayerId, () => string> = { far: farArt, mid: midArt, near: nearArt };

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
      <filter id="pl-moon-soft" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="1.1"/>
      </filter>
      <filter id="pl-moon-haze" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="3.4"/>
      </filter>
    </defs>
    <circle cx="50" cy="50" r="50" fill="url(#pl-moon-body)"/>
    <!-- Highlands: the pale rock between the maria. A wide, faint lift, so the disc
         has a face with more than one tone in it before the dark patches land. -->
    <g class="pl-scene__moon__highlands" fill="var(--pl-moon-core, #fbfcff)" filter="url(#pl-moon-haze)">
      <ellipse cx="67" cy="45" rx="16" ry="11" transform="rotate(-24 67 45)"/>
      <ellipse cx="41" cy="25" rx="12" ry="7" transform="rotate(18 41 25)"/>
      <ellipse cx="52" cy="72" rx="15" ry="9" transform="rotate(-10 52 72)"/>
      <ellipse cx="31" cy="60" rx="9" ry="5" transform="rotate(34 31 60)"/>
    </g>
    <!-- Maria: nine patches, not six, at three sizes and three strengths. The blur
         is 1.1, not 2: at 76 px the old edges were softer than the disc itself.
         Nothing else on the surface: a grain of 1-2 px patches was below what the
         disc can show, and crater rings read as bubbles. -->
    <g class="pl-scene__moon__mare" fill="var(--pl-moon-mare, #8e9ab4)" filter="url(#pl-moon-soft)">
      <ellipse cx="35" cy="33" rx="21" ry="14" opacity="0.95" transform="rotate(-16 35 33)"/>
      <ellipse cx="64" cy="27" rx="11" ry="8" opacity="0.8" transform="rotate(24 64 27)"/>
      <ellipse cx="45" cy="62" rx="18" ry="11" opacity="0.9" transform="rotate(9 45 62)"/>
      <ellipse cx="70" cy="57" rx="10" ry="6" opacity="0.7" transform="rotate(-32 70 57)"/>
      <ellipse cx="27" cy="54" rx="8" ry="5" opacity="0.75" transform="rotate(40 27 54)"/>
      <ellipse cx="57" cy="44" rx="9" ry="5" opacity="0.6" transform="rotate(-8 57 44)"/>
      <ellipse cx="49" cy="19" rx="7" ry="4" opacity="0.5" transform="rotate(14 49 19)"/>
      <ellipse cx="77" cy="40" rx="6" ry="3.4" opacity="0.45" transform="rotate(-22 77 40)"/>
      <ellipse cx="38" cy="78" rx="8" ry="4.5" opacity="0.5" transform="rotate(28 38 78)"/>
    </g>
  </svg>`;
}

function starField(): string {
  // Eight shimmer groups, not ninety independent twinkles (see .pl-scene__twinkle).
  const GROUPS = 8;
  const stars: string[][] = Array.from({ length: GROUPS }, () => []);
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
    // A handful of first-magnitude stars: a bigger point with a thin cross so
    // the field has somewhere for the eye to rest instead of an even sprinkle.
    const bright = i % 11 === 3;
    const cls = bright ? 'pl-scene__star pl-scene__star--bright' : 'pl-scene__star';
    const size = bright ? 3 : 1 + Math.round(next() * 2);
    stars[i % GROUPS].push(
      `<i class="${cls}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;width:${size}px;height:${size}px;opacity:${opacity.toFixed(2)}"></i>`,
    );
  }
  return stars
    .map((items, group) => {
      // Different periods and phases per group, so the sky shimmers unevenly
      // instead of pulsing in one rhythm.
      const duration = (3.4 + group * 0.7).toFixed(1);
      const delay = (-group * 1.3).toFixed(1);
      return `<span class="pl-scene__twinkle" style="--twinkle-duration:${duration}s;--twinkle-delay:${delay}s">${items.join('')}</span>`;
    })
    .join('');
}

export function createTitleScene(options: TitleSceneOptions): TitleScene {
  installStyles();

  const root = document.createElement('div');
  root.className = 'pl-scene';
  root.setAttribute('aria-hidden', 'true');
  // Palette and sun variables go on the host, so layers that are siblings of the
  // scene (the light washes over the world) inherit the same values.
  const varsTarget = options.varsTarget ?? root;
  // The horizon in screen pixels, as the menu's own fit writes it. Reading the
  // style value is a string read, not a layout pass: the old placement called
  // clientWidth/clientHeight four times a second, which forced a reflow and is
  // what made zooming the title stutter.
  const readHorizonPx = (paneH: number): number => {
    const parsed = Number.parseFloat(varsTarget.style.getPropertyValue('--pl-horizon'));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : paneH * 0.54;
  };
  // Every variable below goes through this: the day cycle rewrites the whole sky
  // on every tick, and a value that has not changed must not invalidate two
  // thousand elements' style for nothing (see title/styleVars.ts).
  const vars = createStyleVarWriter(options.varsTargets ?? varsTarget, {
    colourTolerance: PALETTE_COLOUR_TOLERANCE,
  });
  // The sky's own paint, on the sky's own root.
  //
  // `vars` writes to every palette host - the world's layers, the weather, the
  // screen layer, the UI - which is right for a colour the soil, the root runs or
  // the panels read, and wrong for the hills: one hill colour was being written to
  // eleven elements, ten of which do not paint with it, and the whole menu was
  // invalidated with the sky. These properties are only used inside the scene, so
  // they are written on the scene and nowhere else.
  const skyVars = createStyleVarWriter(root, { colourTolerance: PALETTE_COLOUR_TOLERANCE });
  const skyKeys = new Set<keyof TitlePalette>(['skyHigh', 'skyMid', 'skyLow', 'cloud', 'hillNear']);
  // The world the moving layers live in, resolved when asked: the scene is built
  // detached and mounted a moment later, so reading `root.parentElement` at
  // construction time found nothing.
  const parallaxWorld = (): HTMLElement =>
    root.closest<HTMLElement>('.pl-menu__world') ?? root.parentElement ?? root;
  // Everything the drag moves, in one list: the scene's own layers (which follow a
  // drag or a hover) and the planes beside it (which answer only a held drag, so
  // the ground does not slide under a passing hand). `fx`/`fy` are shares of the
  // near plane's travel, `anchor` the positioning part of the element's own
  // transform, and `last` the transform already written, so a still scene writes
  // nothing.
  interface ParallaxHost {
    el: HTMLElement;
    fx: number;
    fy: number;
    anchor: string;
    hover: boolean;
    last: string;
  }
  const parallaxHosts: ParallaxHost[] = [];
  const addHost = (
    el: HTMLElement,
    fx: number,
    fy: number,
    anchor: string,
    hover: boolean,
  ): void => {
    parallaxHosts.push({ el, fx, fy, anchor, hover, last: '' });
  };
  // One body size for the sun and the moon, from the layout module: it is the same
  // disc at either end of the day, so a change cannot land on one and miss the other.
  vars.set('--pl-celestial-size', `${CELESTIAL_SIZE_VMIN}vmin`);

  const sky = document.createElement('div');
  sky.className = 'pl-scene__sky';

  const milkyway = document.createElement('div');
  milkyway.className = 'pl-scene__milkyway';
  sky.appendChild(milkyway);

  const stars = document.createElement('div');
  stars.className = 'pl-scene__stars';
  stars.innerHTML = starField();
  sky.appendChild(stars);

  // A pane-wide arc inside the world-wide sky: the percentages the day cycle
  // writes for the bodies are shares of the frame, not of the 200vw world.
  const arc = document.createElement('div');
  arc.className = 'pl-scene__arc';
  sky.appendChild(arc);

  const sun = document.createElement('div');
  sun.className = 'pl-scene__celestial pl-scene__sun';
  arc.appendChild(sun);

  const moon = document.createElement('div');
  moon.className = 'pl-scene__celestial pl-scene__moon';
  // The moon is a body, not a white circle: a lit limb, a darker far side, and
  // maria. Gradients inside the disc are what stop it reading as a sticker.
  moon.innerHTML = moonArt();
  arc.appendChild(moon);

  // The sky is not empty when the light is: birds cross it in the day and bats
  // after dark, at their own heights and their own pace. One layer with three
  // crossings - two flocks of birds at different distances and one of bats - so
  // there is traffic in the air without three sets of keyframes.
  const skyLife = document.createElement('div');
  skyLife.className = 'pl-scene__skylife';
  skyLife.setAttribute('aria-hidden', 'true');
  skyLife.innerHTML =
    `<span class="pl-scene__flock pl-scene__flock--day">${birdFlockArt()}</span>` +
    `<span class="pl-scene__flock pl-scene__flock--day pl-scene__flock--far">${birdFlockArt()}</span>` +
    `<span class="pl-scene__flock pl-scene__flock--night">${batFlockArt()}</span>`;
  arc.appendChild(skyLife);

  const clouds = document.createElement('div');
  clouds.className = 'pl-scene__clouds';
  // The weather, from one table (`skyLayout.ts`). The soil's cloud shadows are
  // built from the same table, so a shadow cannot cross the ground at a different
  // speed from the cloud that cast it. Each cloud crosses the sky in its own time:
  // a fast one and a slow one in the same blue reads as wind at two altitudes,
  // which is what a still sky was missing.
  const seedOf = (id: string): number => {
    // A fixed hash of the id: the shape is chosen but not random per boot, and
    // renaming a cloud in the table gives it a different drawing.
    let seed = 7;
    for (let i = 0; i < id.length; i += 1) seed = (seed * 31 + id.charCodeAt(i)) % 997;
    return seed;
  };
  const cloudAnims: Animation[] = [];
  for (const cloud of CLOUDS) {
    const el = document.createElement('div');
    el.className = `pl-scene__cloud pl-scene__cloud--${cloud.family}`;
    // Every cloud begins just off the upwind edge and crosses the frame. It used
    // to be placed at its own left offset and drift from there, which meant the
    // sky filled itself with shapes that had appeared out of thin air: a cloud is
    // never seen arriving. The negative delays spread the crossings out, so the
    // sky is already weather at boot and every later cloud still enters from the
    // edge.
    // The sky box is the 200vw world, so a cloud's width is authored in
    // viewport widths: as a percentage of the world every cloud came out twice
    // the size the table describes. The start is the upwind edge of the world,
    // not of the frame, so the weather fills the sides when the camera pulls
    // back; the negative delays still put clouds mid-crossing at boot.
    el.style.left = CLOUD_WIND > 0 ? `-${cloud.width}vw` : '200vw';
    el.style.top = `${cloud.top}%`;
    el.style.width = `${cloud.width}vw`;
    // The table's opacity, times the weather's dim (the overcast grade). One
    // variable, so the clouds can be greyed without a filter on a layer that moves.
    el.style.setProperty('--pl-cloud-op', String(cloud.opacity));
    el.innerHTML = cloudArt(seedOf(cloud.id), cloud.family);
    clouds.appendChild(el);
    // A crossing takes its own time, and it now takes longer: at the table's own
    // pace a cloud read as a fast step across a still sky. Half again as slow is
    // weather drifting over a place rather than clouds on a conveyor. A linear
    // translate on a compositor layer, so slowing it costs nothing.
    //
    // A Web Animation, not a CSS one: its `playbackRate` is the wind, and the wind
    // can change without the crossing restarting. `currentTime` carries the table's
    // negative delay, which is what puts a cloud part-way across at boot.
    if (!options.reducedMotion) {
      const crossing = el.animate(
        [
          { transform: 'translate3d(0, 0, 0)' },
          { transform: `translate3d(${CLOUD_TRAVEL_VW * CLOUD_WIND}vw, 0, 0)` },
        ],
        { duration: cloud.crossS * 1.7 * 1000, iterations: Infinity, easing: 'linear' },
      );
      crossing.currentTime = Math.max(0, -cloud.delayS) * 1000;
      cloudAnims.push(crossing);
    }
  }
  sky.appendChild(clouds);
  root.appendChild(sky);

  // --------------------------------------------------------------- the outskirts
  // What stands on the ground line: flowers in season, mushrooms after rain, a
  // barrel that holds what fell and a lamp that comes on at dusk. One band,
  // pane-wide in world units, so the props keep their size against the plant at any
  // camera zoom.
  //
  // Whether a prop is out is `sceneryLevels`' answer, written as an opacity: each one
  // is painted once and a change of weather costs a number, never a node.
  const outskirts = document.createElement('div');
  outskirts.className = 'pl-scene__outskirts';
  outskirts.setAttribute('aria-hidden', 'true');
  const prop = (className: string, html: string, style = ''): HTMLElement => {
    const el = document.createElement('i');
    el.className = className;
    if (style) el.setAttribute('style', style);
    el.innerHTML = html;
    return el;
  };
  for (const clump of FLOWER_CLUMPS) {
    outskirts.appendChild(
      prop(
        'pl-scene__flower',
        flowerArt(),
        `left:${clump.x}%;--s:${clump.scale};--lean:${clump.lean}deg`,
      ),
    );
  }
  // The mushrooms are one band inside the strip: one opacity for the lot, and one
  // listener for a puff instead of one per cluster.
  const mushroomBed = document.createElement('div');
  mushroomBed.className = 'pl-scene__mushrooms';
  mushroomBed.innerHTML = MUSHROOM_CLUSTERS.map(
    (cluster) =>
      `<i style="left:${cluster.x}%;--s:${cluster.scale};--tilt:${cluster.tilt}deg">` +
      `${mushroomArt()}</i>`,
  ).join('');
  outskirts.appendChild(mushroomBed);
  // A cluster you can touch: pressing it throws a puff of spores. The class is put on
  // and taken off on `animationend`, so there is no timer to leak and nothing runs
  // while nothing is touched.
  mushroomBed.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    (event.target as Element | null)?.closest<HTMLElement>('i')?.classList.add('is-puffed');
  });
  mushroomBed.addEventListener('animationend', (event) => {
    (event.target as HTMLElement | null)?.classList.remove('is-puffed');
  });
  // The barrel and the lamp are single props, so their place and their size are both
  // in the stylesheet; only the clumps that come from a table carry an inline
  // position, so there is one writer per number.
  outskirts.appendChild(
    prop('pl-scene__barrel', `${barrelArt()}<span class="pl-scene__barrel-water"></span>`),
  );
  outskirts.appendChild(prop('pl-scene__lantern', lanternArt()));
  // The season is on the root, not in a class per prop: the CSS that reads it is one
  // attribute selector, and the palette pass writes the flower colour from the same
  // value.
  root.dataset.season = 'spring';
  root.appendChild(outskirts);
  // The props stand on the ground, so they ride the ground: the 0.9 share of the
  // near plane's travel that the soil, the plant and the finds move at. Without a
  // host the band was a sibling of every moving layer and stood still while the soil
  // slid out from under it - measured, a 120 px drag moved the near ridge 99 px and
  // the ground 49 px, and the props stayed on exactly the same pixel. The vertical
  // share is half the horizontal one, the near plane's ratio, so a lift does not
  // leave the props hanging above their own ground.
  addHost(outskirts, FOREGROUND_PARALLAX.x, FOREGROUND_PARALLAX.y, '', false);

  // The cloud the rain comes out of. Built from the same soft-lobe gradients as
  // the fair-weather art, lower and heavier, and only visible while it storms.
  const NIMBUS_LOBES = [
    { x: -10, y: 0, w: 46, h: 54 },
    { x: 22, y: -6, w: 54, h: 64 },
    { x: 56, y: 2, w: 48, h: 56 },
    { x: -6, y: 24, w: 38, h: 46 },
    { x: 32, y: 28, w: 42, h: 42 },
    { x: 64, y: 22, w: 44, h: 48 },
    { x: 12, y: 42, w: 32, h: 32 },
    { x: 52, y: 42, w: 36, h: 32 },
  ];
  const nimbus = document.createElement('div');
  nimbus.className = 'pl-scene__nimbus';
  nimbus.innerHTML = NIMBUS_LOBES.map(
    (lobe) => `<i style="left:${lobe.x}%;top:${lobe.y}%;width:${lobe.w}%;height:${lobe.h}%"></i>`,
  ).join('');
  sky.appendChild(nimbus);

  // Light in the air at the horizon: a warm bloom under the sun and a thin pale
  // haze band where the sky meets the hills. Without these the hills meet the sky
  // on a hard line and the whole scene reads as flat cutouts.
  const bloom = document.createElement('div');
  bloom.className = 'pl-scene__bloom';
  root.appendChild(bloom);

  const haze = document.createElement('div');
  haze.className = 'pl-scene__haze';
  root.appendChild(haze);

  // The weather's grade over the world, not a second sky: on in rain or heavy
  // cloud, off when it clears (see `--pl-mood`, written by the menu's light
  // pass). A layer rather than a tint on each piece, so one value moves the
  // whole picture's mood and nothing can forget to follow it.
  const mood = document.createElement('div');
  mood.className = 'pl-scene__mood';
  root.appendChild(mood);

  // The weather sits over the painting and under the interface: fog in the middle
  // distance, then rain in front of everything in the scene. Both go to the host
  // when one is given, because "in front of everything" includes the tree and the
  // soil, which are painted by a sibling layer rather than by this one.
  const weatherRoot = options.weatherHost ?? root;
  const fog = document.createElement('div');
  fog.className = 'pl-scene__fog';
  weatherRoot.appendChild(fog);

  const rain = document.createElement('div');
  rain.className = 'pl-scene__rain';
  rain.innerHTML = '<i></i><i></i><i></i>';
  // Three fields of drops, each baked once as a mask: fine and fast far away,
  // the main fall, and big slow drops near the eye. Three densities read as
  // depth; one repeated texture reads as wallpaper.
  // Every drop is an element with a column. That is the whole point of the
  // rewrite: the ring a drop throws and the pool or drift it leaves have to sit
  // under the drop that made them, and a tiled mask cannot say where its drops
  // are. Each drop carries its own fall time (so landings are spread out in
  // time), its own girth and length, and its own start delay - the field is
  // already mid-fall on the first frame instead of every drop starting together.
  interface FallingDrop {
    /** Column across the pane, in per cent. */
    left: number;
    /** Seconds from the top of the column to the ground line. */
    duration: number;
    /** Negative: how far into its own fall this drop starts. */
    delay: number;
    /** Length of a streak, or the diameter of a flake, in px. */
    size: number;
    /** Girth of a streak, in px. */
    girth: number;
    alpha: number;
  }
  const seeded = (seed: number): (() => number) => {
    let state = seed >>> 0 || 1;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0xffffffff;
    };
  };
  const buildDropField = (spec: {
    seed: number;
    count: number;
    duration: readonly [number, number];
    alpha: readonly [number, number];
    size: readonly [number, number];
    girth: readonly [number, number];
  }): FallingDrop[] => {
    const next = seeded(spec.seed);
    return Array.from({ length: spec.count }, () => {
      const duration = spec.duration[0] + next() * (spec.duration[1] - spec.duration[0]);
      return {
        left: next() * 100,
        duration,
        delay: -next() * duration,
        size: spec.size[0] + next() * (spec.size[1] - spec.size[0]),
        girth: spec.girth[0] + next() * (spec.girth[1] - spec.girth[0]),
        alpha: spec.alpha[0] + next() * (spec.alpha[1] - spec.alpha[0]),
      };
    });
  };

  // Three depths of rain: fine and fast far away, the main fall, big and slow near
  // the eye. Depth comes from the size of the drops, not from scaling one picture.
  const rainLayers = [
    {
      seed: 4021,
      count: 46,
      duration: [0.5, 0.66],
      alpha: [0.3, 0.55],
      size: [4, 8],
      girth: [0.9, 1.3],
    },
    {
      seed: 991,
      count: 32,
      duration: [0.66, 0.9],
      alpha: [0.45, 0.7],
      size: [9, 16],
      girth: [1.2, 1.9],
    },
    {
      seed: 7717,
      count: 22,
      duration: [0.85, 1.15],
      alpha: [0.6, 0.9],
      size: [16, 26],
      girth: [1.8, 2.8],
    },
  ] as const;
  const rainDrops = rainLayers.flatMap((layer) => buildDropField(layer));
  rain.innerHTML = rainDrops
    .map(
      (drop) =>
        `<i style="left:${drop.left.toFixed(2)}%;` +
        `--pl-drop-w:${drop.girth.toFixed(2)}px;--pl-drop-h:${drop.size.toFixed(1)}px;` +
        `--pl-drop-dur:${drop.duration.toFixed(2)}s;--pl-drop-delay:${drop.delay.toFixed(2)}s;` +
        `--pl-drop-alpha:${drop.alpha.toFixed(2)}"></i>`,
    )
    .join('');
  // A storm falls faster than a drizzle. The speed is one variable on the layer,
  // so a weight change never rebuilds the field.
  let rainWeightTier = -1;
  const applyRainWeight = (weight: number): void => {
    const tier = Math.round(Math.min(1, Math.max(0, weight)) * 5) / 5;
    if (tier === rainWeightTier) return;
    rainWeightTier = tier;
    rain.style.setProperty('--pl-fall-scale', (1.3 - 0.6 * tier).toFixed(2));
  };
  applyRainWeight(0.7);
  weatherRoot.appendChild(rain);

  // Snow, sharing the weather host with the rain so one is drawn and the other
  // hidden by the same storm number. Flakes are round, fall at a tenth of a drop's
  // speed and sway sideways.
  const snow = document.createElement('div');
  snow.className = 'pl-scene__snow';
  const snowLayers = [
    { seed: 6101, count: 44, duration: [9, 13], alpha: [0.5, 0.85], size: [3, 6], girth: [0, 0] },
    { seed: 3391, count: 26, duration: [13, 19], alpha: [0.6, 0.95], size: [5, 9], girth: [0, 0] },
  ] as const;
  const snowDrops = snowLayers.flatMap((layer) => buildDropField(layer));
  snow.innerHTML = snowDrops
    .map(
      (drop) =>
        `<i style="left:${drop.left.toFixed(2)}%;` +
        `--pl-flake-size:${drop.size.toFixed(1)}px;` +
        `--pl-drop-dur:${drop.duration.toFixed(2)}s;--pl-drop-delay:${drop.delay.toFixed(2)}s;` +
        `--pl-drop-alpha:${drop.alpha.toFixed(2)}"></i>`,
    )
    .join('');
  weatherRoot.appendChild(snow);

  // Where those drops land, as landings per second per column.
  //
  // This is the field the ground reads. A column's weight is the rate of drops
  // arriving in it, so a place with three drops is three times as wet as a place
  // with one, and a column no drop falls in stays dry. That is the difference
  // between weather and decoration: the rings, the pools and the drifts below are
  // all placed from these numbers.
  const LANDING_BINS = 48;
  // How far a full wind carries a drop sideways before it arrives, in per cent of
  // the pane per second of fall. It is what makes the field follow the wind: the
  // drops are the same drops, but where they *land* moves downwind.
  const WIND_DRIFT_PCT_PER_S = 13;
  const landingHistogram = (drops: readonly FallingDrop[], wind = 0): number[] => {
    const bins = new Array<number>(LANDING_BINS).fill(0);
    for (const drop of drops) {
      const drift = wind * WIND_DRIFT_PCT_PER_S * drop.duration;
      const arrival = (((drop.left + drift) % 100) + 100) % 100;
      const bin = Math.min(
        LANDING_BINS - 1,
        Math.max(0, Math.floor((arrival / 100) * LANDING_BINS)),
      );
      bins[bin] = (bins[bin] ?? 0) + 1 / drop.duration;
    }
    return bins;
  };
  const rainLanding: number[] = landingHistogram(rainDrops);
  const snowLanding: number[] = landingHistogram(snowDrops);
  const landingPercent = (bucket: number): number => ((bucket + 0.5) / LANDING_BINS) * 100;
  const landingShare = (weights: readonly number[], bucket: number): number => {
    const peak = weights.reduce((max, value) => Math.max(max, value), 0) || 1;
    return Math.min(1, (weights[bucket] ?? 0) / peak);
  };

  // Lightning shares the weather, not the clock: it is part of a storm.
  const flash = document.createElement('div');
  flash.className = 'pl-scene__flash';
  weatherRoot.appendChild(flash);

  const wet = document.createElement('div');
  wet.className = 'pl-scene__wet';
  // The grade has to go where the dirt shows through, so it is mounted on the
  // stage when the menu offers one (see `wetHost`).
  (options.wetHost ?? weatherRoot).appendChild(wet);

  // Underground life, when the menu gives the cut's face (it always does on the
  // title). The worm comes up when the ground is soaked and goes down when it
  // drains, and it sits under the wet grade so it takes the same darkness the dirt
  // does.
  if (options.wetHost) {
    const soil = document.createElement('div');
    soil.className = 'pl-scene__soil';
    soil.setAttribute('aria-hidden', 'true');
    soil.innerHTML = `<span class="pl-scene__worm">${wormArt()}</span>`;
    options.wetHost.insertBefore(soil, wet);
    // The worm is in the wet host, which the menu already moves as part of the
    // ground plane. Registering it too applied the ground's transform twice: it
    // slid at 1.8x the dirt it was buried in.
  }
  // Puddles: wet ground does not only darken, it holds water - and it holds what
  // actually fell on it. Every column of the landing field carries its own water
  // (see `stepSurface`, below, which runs the shared cover rules), and a pool is
  // drawn where that water stands above the puddle floor, sized by how much of it
  // there is. A drop landing on a column with a pool on it joins that pool, so the
  // body of water grows while it rains; when the rain stops the same water drains
  // and the pool shrinks, then leaves.
  const puddles = document.createElement('div');
  puddles.className = 'pl-scene__puddles';
  puddles.setAttribute('aria-hidden', 'true');
  weatherRoot.appendChild(puddles);
  interface PoolSpec {
    left: number;
    top: number;
    width: number;
    height: number;
    opacity: number;
  }
  interface DriftSpec {
    left: number;
    width: number;
    height: number;
    bottom: number;
    opacity: number;
  }
  interface RingSpec {
    /** Where this ring lands on the scale of the field, 0..1. */
    pick: number;
    /** A hand's width of scatter, so 34 rings are not 34 columns. */
    jitter: number;
    top: number;
    scale: number;
    delay: number;
    speed: number;
  }
  let poolSpecs: PoolSpec[] = [];
  let driftSpecs: DriftSpec[] = [];
  /**
   * The drift elements the pointer pushes, kept in step with `settle`'s children.
   *
   * `paintCover` rebuilds the settle layer whenever the ground's cover changes, so
   * a list captured once at build time pointed at detached nodes from the first
   * shower on: the push silently stopped working after the first repaint.
   */
  let settleDrifts: HTMLElement[] = [];

  // Where the rain actually lands: rings across the whole ground line, not six spots
  // around the tree. A ring opens where a drop lands, so its column is read from the
  // rain's own landing field - which the wind moves (see `landingHistogram`) - and
  // the ring is re-placed whenever that field changes.
  //
  // Seeded, so the picture is the same on every load.
  let splashSeed = 0x9e3779b9;
  const splashRandom = (): number => {
    splashSeed = (Math.imul(splashSeed, 1664525) + 1013904223) >>> 0;
    return splashSeed / 0xffffffff;
  };
  const SPLASH_RINGS = 34;
  const splash = document.createElement('div');
  splash.className = 'pl-scene__splash';
  const splashSpecs: RingSpec[] = Array.from({ length: SPLASH_RINGS }, (_, index) => ({
    pick: (index + splashRandom() * 0.9) / SPLASH_RINGS,
    jitter: (splashRandom() - 0.5) * 1.4,
    top: splashRandom() * 22,
    scale: 0.85 + splashRandom() * 0.3,
    delay: Math.round(splashRandom() * 620),
    speed: 520 + Math.round(splashRandom() * 260),
  }));
  splash.innerHTML = splashSpecs
    .map(
      (spec) =>
        `<b style="top:${spec.top.toFixed(2)}%;animation-delay:${spec.delay}ms;` +
        `animation-duration:${spec.speed}ms"></b>`,
    )
    .join('');
  // Into the weather host with the rain, not into the scene: the splashes have to
  // paint over the soil they land on, and the scene is under the stage.
  weatherRoot.appendChild(splash);

  // Snow settles along the same line, across the same width: the flakes were
  // falling over the whole pane while only the tree's patch ever showed a
  // resting drift.
  const settle = document.createElement('div');
  settle.className = 'pl-scene__settle';
  weatherRoot.appendChild(settle);

  // A drop meets whatever has already piled up under it.
  //
  // The field falls to the ground line, and the ground line is where the soil
  // starts - so a flake in a column holding a twelve-pixel drift fell *into* the
  // pile and vanished at the ground beneath it, and a drop over a pool ended a
  // couple of pixels above the water instead of on it. Each drop now lands on the
  // surface its own column carries: the settled lid (2-9 px deep, so that half of
  // the lift is left as CSS on the fall's own variable) plus the crown of the
  // deepest drift over it, or the top of a pool.
  //
  // The shapes are in pixels and their places in percentages, so the lookup needs
  // the band's measured width - and it is done when the layer is first *drawn*
  // (a weather change), not when it is built: the settle layer is appended before
  // it has a layout, and a width of zero put every mound at the left edge, which
  // lifted all seventy flakes and none of them correctly.
  let liftedWidth = 0;
  const applyLandingLifts = (): void => {
    const bandWidth = settle.clientWidth;
    if (bandWidth < 1 || bandWidth === liftedWidth) return;
    liftedWidth = bandWidth;
    const bandHeight = settle.clientHeight;
    const driftMounds = driftSpecs.map((drift) => ({
      centrePx: (drift.left / 100) * bandWidth,
      halfPx: drift.width / 2,
      risePx: drift.height + (drift.bottom / 100) * bandHeight,
    }));
    const poolLenses = poolSpecs.map((pool) => ({
      centrePx: (pool.left / 100) * bandWidth,
      halfPx: ((pool.width / 100) * bandWidth) / 2,
      topPx: pool.top,
    }));
    // A mound is highest at its centre and falls to nothing at its rim, which is
    // what the radial gradient on the drift draws; a pool is a flat lens, so its
    // whole width is the same depth.
    const moundLift = (xPx: number): number => {
      let lift = 0;
      for (const mound of driftMounds) {
        const across = Math.abs(xPx - mound.centrePx);
        if (across >= mound.halfPx) continue;
        const shoulder = 1 - (across / mound.halfPx) ** 2;
        lift = Math.max(lift, mound.risePx * shoulder);
      }
      return lift;
    };
    const poolDepth = (xPx: number): number => {
      let depth = 0;
      for (const pool of poolLenses) {
        if (Math.abs(xPx - pool.centrePx) <= pool.halfPx) depth = Math.max(depth, pool.topPx);
      }
      return depth;
    };
    const write = (
      layer: HTMLElement,
      drops: readonly FallingDrop[],
      liftOf: (xPx: number) => string,
    ): void => {
      const els = layer.querySelectorAll<HTMLElement>('i');
      drops.forEach((drop, index) => {
        const el = els[index];
        if (el) el.style.setProperty('--pl-land-lift', liftOf((drop.left / 100) * bandWidth));
      });
    };
    write(
      snow,
      snowDrops,
      (xPx) => `calc(2px + var(--pl-snow, 0) * 7px + ${moundLift(xPx).toFixed(1)}px)`,
    );
    // A pool hangs just below the line, so its water is a few pixels under where the
    // field ends: the drop travels the rest of the way instead of stopping short.
    write(rain, rainDrops, (xPx) => {
      const depth = poolDepth(xPx);
      return depth > 0 ? `${(-depth).toFixed(1)}px` : '0px';
    });
  };
  applyLandingLifts();
  // --------------------------------------------------------------- ground cover
  // What the ground holds is decided by the shared ruleset
  // (`@plant-legacy/shared/weather`), the same rules the 3D rain system runs, so a
  // shower leaves the same kind of ground in the world and on the title. The code
  // here only paints their answer.
  const coverWater = new Float64Array(LANDING_BINS);
  const coverSnow = new Float64Array(LANDING_BINS);
  let liveRain = rainLanding;
  let liveSnow = snowLanding;
  let rainPeak = 0;
  let snowPeak = 0;
  let fieldKey = '';
  let lastCoverAt = 0;
  let lastPaintAt = 0;
  let surfaceKey = '';

  /** Rings follow the live field: a change of wind moves where the drops arrive. */
  const placeRings = (): void => {
    const rings = splash.querySelectorAll<HTMLElement>('b');
    splashSpecs.forEach((spec, index) => {
      const ring = rings[index];
      if (!ring) return;
      const bucket = landingBucket(liveRain, spec.pick);
      ring.style.left = `${(landingPercent(bucket) + spec.jitter).toFixed(2)}%`;
      ring.style.setProperty(
        '--pl-ring-scale',
        (0.45 + landingShare(liveRain, bucket) * 1.15 * spec.scale).toFixed(2),
      );
    });
  };

  /** Pools, drifts and the settled lid, from what the ground holds right now. */
  const paintCover = (): void => {
    // Pools: one per column of standing water, capped and non-overlapping, so two
    // translucent lenses are never composited into a darker one.
    const pools: PoolSpec[] = [];
    for (let bucket = 0; bucket < LANDING_BINS && pools.length < 12; bucket += 1) {
      const strength = coverStrength(coverWater[bucket] ?? 0, PUDDLE_FLOOR);
      if (strength <= 0) continue;
      const left = ((bucket + 0.5) / LANDING_BINS) * 100;
      const width = 3 + strength * 9;
      const half = width / 2 + 0.5;
      if (pools.some((pool) => Math.abs(pool.left - left) < pool.width / 2 + half)) continue;
      pools.push({
        left,
        top: 1 + strength * 2.4,
        width,
        height: 1.6 + strength * 4.6,
        opacity: 0.24 + strength * 0.6,
      });
    }
    // Drifts: the same idea with snow, and taller than a pool is deep.
    const drifts: DriftSpec[] = [];
    for (let bucket = 0; bucket < LANDING_BINS && drifts.length < 16; bucket += 1) {
      const strength = coverStrength(coverSnow[bucket] ?? 0, DRIFT_FLOOR);
      if (strength <= 0) continue;
      const left = ((bucket + 0.5) / LANDING_BINS) * 100;
      const width = 16 + strength * 62;
      if (
        drifts.some((drift) => Math.abs(drift.left - left) < (drift.width / 2 + width / 2) * 0.8)
      ) {
        continue;
      }
      drifts.push({
        left,
        width,
        height: 2 + strength * 9,
        bottom: -strength * 4,
        opacity: 0.3 + strength * 0.65,
      });
    }
    const key =
      pools
        .map((p) => `${p.left.toFixed(1)}:${p.width.toFixed(1)}:${p.height.toFixed(1)}`)
        .join('|') +
      '#' +
      drifts
        .map((d) => `${d.left.toFixed(1)}:${d.width.toFixed(1)}:${d.height.toFixed(1)}`)
        .join('|');
    if (key === surfaceKey) return;
    surfaceKey = key;
    poolSpecs = pools;
    driftSpecs = drifts;
    puddles.innerHTML = pools
      .map(
        (pool) =>
          `<i style="left:${pool.left.toFixed(2)}%;top:${pool.top.toFixed(2)}px;` +
          `width:${pool.width.toFixed(2)}%;height:${pool.height.toFixed(1)}px;` +
          `opacity:${pool.opacity.toFixed(2)}"></i>`,
      )
      .join('');
    settle.innerHTML = drifts
      .map(
        (drift) =>
          `<i style="left:${drift.left.toFixed(2)}%;bottom:${drift.bottom.toFixed(1)}px;` +
          `width:${drift.width.toFixed(0)}px;height:${drift.height.toFixed(1)}px;` +
          `opacity:${drift.opacity.toFixed(2)}"></i>`,
      )
      .join('');
    // The push list follows the layer that was just rebuilt (see `settleDrifts`).
    settleDrifts = [...settle.querySelectorAll<HTMLElement>('i')];
    // The settled lid is masked by the same field: a dry column has no snow lying on
    // it, a heavy one has a thick rim. Stops sit at bucket centres, so the lid ramps
    // between columns instead of stepping like a barcode.
    const mask = liveSnow
      .map((_weight, bucket) => {
        const share = landingShare(liveSnow, bucket);
        const centre = (((bucket + 0.5) / LANDING_BINS) * 100).toFixed(2);
        return `rgba(255, 255, 255, ${share.toFixed(3)}) ${centre}%`;
      })
      .join(', ');
    settle.style.setProperty('--pl-settle-mask', `linear-gradient(90deg, ${mask})`);
    // The pools and drifts moved: the drops land on them, so their falls have to be
    // lifted again (see `applyLandingLifts`).
    liftedWidth = 0;
    applyLandingLifts();
  };

  // -------------------------------------------------------------------- scenery
  // What is out, from what the sky is doing and what the ground holds. The props are
  // built above; this is the one place that decides visibility, and it writes
  // numbers, never nodes.
  let sceneryStar = 0;
  let sceneryRain = 0;
  let scenerySoak = 0;
  let scenerySeason: TitleSeason = 'spring';
  /** The rabbit lives in the near layer, which is built further down. */
  let rabbitEl: HTMLElement | null = null;
  const applyScenery = (): void => {
    const levels = sceneryLevels({
      star: sceneryStar,
      rain: sceneryRain,
      soak: scenerySoak,
      season: scenerySeason,
    });
    // No change key: `skyVars` already drops a value that is the same as the one it
    // last wrote, so nine numbers cost nine map lookups and no style work. The key
    // that used to guard them was a second memory of the same numbers, and it went
    // stale - it left the barrel dry while the ground was wet.
    // On the scene's own root: these numbers are read by the props inside this
    // element and by nothing else, and the menu's other layers should not restyle
    // for a value they never use.
    skyVars.set('--pl-birds', levels.birds.toFixed(2));
    skyVars.set('--pl-bats', levels.bats.toFixed(2));
    skyVars.set('--pl-rabbit-level', levels.rabbit.toFixed(2));
    skyVars.set('--pl-mushrooms', levels.mushrooms.toFixed(2));
    skyVars.set('--pl-worms', levels.worms.toFixed(2));
    skyVars.set('--pl-lamp', levels.warmLight.toFixed(2));
    skyVars.set('--pl-blooms', levels.blooms.toFixed(2));
    skyVars.set('--pl-soak', scenerySoak.toFixed(2));
    // A rabbit you can see is a rabbit you can press; one that is away is not a
    // hidden button in the field.
    rabbitEl?.classList.toggle('is-out', levels.rabbit > 0.2);
    mushroomBed.classList.toggle('is-out', levels.mushrooms > 0.05);
  };

  /** One frame of the cover rules, then the ground is repainted if it has moved. */
  const stepSurface = (weather: TitleWeather): void => {
    const now = performance.now();
    // A hidden tab comes back to wet ground, not to a lake: the ruleset clamps dt.
    const dt = lastCoverAt === 0 ? 0 : (now - lastCoverAt) / 1000;
    lastCoverAt = now;
    // The field moves only when the sky does: the wind decides where drops arrive,
    // the intensity how many. Rebuilding the histograms every frame would be work
    // for a sky that has not changed since the last one.
    const key = `${weather.kind}:${weather.rain}:${weather.wind}`;
    if (key !== fieldKey) {
      fieldKey = key;
      liveRain = landingHistogram(rainDrops, weather.wind);
      liveSnow = landingHistogram(snowDrops, weather.wind);
      rainPeak = 0;
      snowPeak = 0;
      for (let bucket = 0; bucket < LANDING_BINS; bucket += 1) {
        rainPeak = Math.max(rainPeak, liveRain[bucket] ?? 0);
        snowPeak = Math.max(snowPeak, liveSnow[bucket] ?? 0);
      }
      placeRings();
    }
    const snowing = weather.kind === 'snow' && weather.rain > 0.02;
    for (let bucket = 0; bucket < LANDING_BINS; bucket += 1) {
      const shareRain = rainPeak > 0 ? (liveRain[bucket] ?? 0) / rainPeak : 0;
      const shareSnow = snowPeak > 0 ? (liveSnow[bucket] ?? 0) / snowPeak : 0;
      const next = stepSurfaceCover(
        { water: coverWater[bucket] ?? 0, snow: coverSnow[bucket] ?? 0 },
        {
          rain: snowing ? 0 : weather.rain * shareRain,
          snow: snowing ? weather.rain * shareSnow : 0,
        },
        dt,
      );
      coverWater[bucket] = next.water;
      coverSnow[bucket] = next.snow;
    }
    // How wet the ground is, as the water standing in the columns that hold any:
    // that is the number the mushrooms, the worms and the barrel answer - the
    // ground's own state, not the sky's, taken straight out of the rules that are
    // already running, so nothing here can disagree with the puddles.
    //
    // A mean over all forty-eight columns would understate the ground badly. The rain
    // field is uneven by construction (a column with one drop in it is a dry column
    // beside a wet one), so even in a downpour most of the width is nearly dry and the
    // whole-field average never leaves the dust: measured at 0.04 while pools stood
    // 12% wide. What is being asked here is how wet the wet ground is.
    let waterSum = 0;
    let wetColumns = 0;
    for (let bucket = 0; bucket < LANDING_BINS; bucket += 1) {
      const water = coverWater[bucket] ?? 0;
      if (water < 0.02) continue;
      waterSum += water;
      wetColumns += 1;
    }
    scenerySoak = wetColumns > 0 ? waterSum / wetColumns : 0;
    applyScenery();
    // The rules run at frame rate; the ground is repainted a few times a second. A
    // few hundredths of a pixel of growth is not worth building nodes for.
    if (now - lastPaintAt < 220) return;
    lastPaintAt = now;
    paintCover();
  };
  placeRings();
  paintCover();

  // ------------------------------------------------------------------ presence
  // The pointer is in the weather and in the plant, not just over them. A pointer
  // close to a landing ring shoves it aside, as if something solid had come down
  // through the rain; a fast pass across the canopy is wind, which the menu passes
  // to the plant. Both are client-coordinate arithmetic, so nothing here reads
  // layout during the movement itself.
  /**
   * Whether the title is the screen the player is on. Declared before the
   * window-level presence listener below, which is registered once and has to
   * know from the first event whether the title is parked behind the world.
   */
  let active = true;
  const splashRings = [...splash.querySelectorAll<HTMLElement>('b')];
  // The rings keep their own rhythm (each one has its own duration, so the ground
  // never pulses in step), but a storm makes them land faster and a drizzle slower.
  // Written only when the heat changes by a tenth, not every tick.
  let splashHeat = -1;
  const applySplashHeat = (heat: number): void => {
    const tier = Math.round(Math.min(1, Math.max(0, heat)) * 10) / 10;
    if (tier === splashHeat) return;
    splashHeat = tier;
    const rate = 1.35 - 0.62 * tier;
    for (const ring of splashRings) {
      const base = Number(ring.dataset.speed ?? 620) || 620;
      ring.style.animationDuration = `${Math.round(base * rate)}ms`;
    }
  };
  let pushFrame = 0;
  let lastMove: { x: number; y: number; at: number } | null = null;
  let lastGustAtMs = 0;

  const pushNear = (
    nodes: HTMLElement[],
    box: DOMRect,
    clientX: number,
    clientY: number,
    radius: number,
    strength: number,
  ): void => {
    for (const node of nodes) {
      const cx = box.left + node.offsetLeft + node.offsetWidth / 2;
      const cy = box.top + node.offsetTop + node.offsetHeight / 2;
      const dx = cx - clientX;
      const dy = cy - clientY;
      const distance = Math.hypot(dx, dy);
      if (distance > radius || distance < 0.5) {
        node.style.removeProperty('--pl-push-x');
        node.style.removeProperty('--pl-push-y');
        continue;
      }
      // Nearest moves most, and it moves away: a drop is displaced by the thing in
      // it, not attracted to it.
      const push = (1 - distance / radius) * strength;
      node.style.setProperty('--pl-push-x', `${((dx / distance) * push).toFixed(1)}px`);
      node.style.setProperty('--pl-push-y', `${((dy / distance) * push).toFixed(1)}px`);
    }
  };

  const clearPush = (): void => {
    for (const node of [...splashRings, ...settleDrifts]) {
      node.style.removeProperty('--pl-push-x');
      node.style.removeProperty('--pl-push-y');
    }
    lastMove = null;
  };

  const onPresenceMove = (event: PointerEvent): void => {
    // The listener is on the window, and the title stays mounted while the world
    // is played: without this, every pointer move in the game measured the title's
    // layers, wrote transforms on its rings and rustled its hidden plant.
    if (destroyed || !active || event.pointerType === 'touch') return;
    const x = event.clientX;
    const y = event.clientY;
    const now = performance.now();
    const previous = lastMove;
    lastMove = { x, y, at: now };

    if (pushFrame === 0) {
      pushFrame = requestAnimationFrame(() => {
        pushFrame = 0;
        if (destroyed) return;
        pushNear(splashRings, splash.getBoundingClientRect(), x, y, 110, 18);
        pushNear(settleDrifts, settle.getBoundingClientRect(), x, y, 90, 9);
      });
    }

    if (!previous || options.reducedMotion) return;
    const dt = Math.max(1, now - previous.at);
    const dx = x - previous.x;
    const dy = y - previous.y;
    const speed = Math.hypot(dx, dy) / dt;
    if (speed < 0.9) return;
    // The canopy: above the ground line, below the sky, in the middle of the pane.
    const ground = splash.getBoundingClientRect();
    const pane = root.getBoundingClientRect();
    if (pane.width === 0) return;
    const inCanopy =
      y < ground.top + 24 &&
      y > ground.top - pane.height * 0.62 &&
      x > pane.left + pane.width * 0.3 &&
      x < pane.left + pane.width * 0.7;
    // 90ms, not 140: a fast pass across the crown is several touches in a row, and
    // at the old gate it was one touch near the end of the sweep - the rustle stayed
    // at the pointer's last position instead of travelling with the hand.
    if (!inCanopy || now - lastGustAtMs < 90) return;
    lastGustAtMs = now;
    const deg = Math.max(-22, Math.min(22, dx * speed * 2.4));
    // The pointer travels with the gust: a hand only moves the leaves it passes, so
    // the plant needs to know where the pass happened, not only how fast.
    root.dispatchEvent(new CustomEvent('pl-title-gust', { detail: { deg, x, y } }));
  };

  window.addEventListener('pointermove', onPresenceMove, { passive: true });
  root.addEventListener('pointerleave', clearPush);
  // The rings stand on the horizon because the stylesheet puts the band at
  // `--pl-horizon`, the same line the world scales about. Measuring the stage in
  // screen pixels and writing that as a local offset was wrong by the zoom factor
  // (1/zoom too far down, so the rings landed inside the dirt) and was only
  // re-measured on resize, never on a wheel step or a drag.

  for (const id of LAYER_ORDER) {
    const layer = document.createElement('div');
    layer.className = `pl-scene__layer pl-scene__layer--${id}`;
    layer.style.zIndex = String(LAYER_ORDER.indexOf(id) + 1);
    layer.innerHTML = ART[id]();
    if (id === 'mid') {
      // The mill on the middle ridge: a landmark in the distance, and the one thing
      // in the picture that shows the wind without a leaf moving.
      const mill = document.createElement('span');
      mill.className = 'pl-scene__mill';
      mill.innerHTML = millArt();
      layer.appendChild(mill);
    }
    if (id === 'near') {
      // The rabbit sits on the near ridge in the land's own silhouette colour.
      // Touching it makes it hop: wildlife that can be provoked is wildlife.
      rabbitEl = document.createElement('span');
      rabbitEl.className = 'pl-scene__rabbit';
      rabbitEl.innerHTML = rabbitArt();
      rabbitEl.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        rabbitEl?.classList.add('is-hopped');
      });
      rabbitEl.addEventListener('animationend', () => rabbitEl?.classList.remove('is-hopped'));
      layer.appendChild(rabbitEl);
    }
    // Each range registers the depth it is drawn at (`title_parallax_depth`): the
    // far hills move a third of the near ones, and the up-and-down is half the
    // sideways.
    const depth = options.depth?.[id];
    if (typeof depth === 'number' && depth > 0) addHost(layer, depth, depth * 0.5, '', true);
    root.appendChild(layer);
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

  let state: ParallaxPoint = { ...PARALLAX_ORIGIN };
  /**
   * Where a released drag left the picture. The scene is persistent: a drag is a
   * new resting place, not a temporary pull that springs back. Space clears it.
   */
  let rest: ParallaxPoint = { ...PARALLAX_ORIGIN };
  let draft: ParallaxPoint | null = null;
  let pointer: ParallaxPoint | null = null;
  let dragStart: { x: number; y: number; base: ParallaxPoint } | null = null;
  /** The pointer the scene captured for this drag, so it can always be released. */
  let dragPointerId: number | null = null;
  let frame = 0;
  let lastFrameMs = 0;
  let destroyed = false;
  /** Last offsets written to each halo, so an unmoved body writes nothing. */
  let lastSunHalo = '';
  let lastWeatherKey = '';
  /** Rain level from the last weather tick: what dims the sun's own disc. */
  let rainLevel = 0;

  // A background that slides is a flourish, never a reason to crawl. Frames are
  // measured while a drag is live; if three of them come back slower than 40 ms, the
  // parallax is switched off for the session and the drag leaves the scene still.
  // That is a decision from the machine's own numbers, not a guess: a browser that
  // can move these layers keeps them, and one that cannot stops paying for them.
  let parallaxAllowed = true;
  let slowDragFrames = 0;
  root.dataset.parallaxGate = 'on';

  const apply = (): void => {
    // One transform per host, written only when it changed. A transform, not a
    // custom property: a registered custom-property write is a document-wide style
    // pass, and the drag crawled under it.
    for (const host of parallaxHosts) {
      const from = host.hover ? state : nearState;
      const x = (-from.x * host.fx).toFixed(2);
      const y = (-from.y * host.fy).toFixed(2);
      const next = `${host.anchor} translate3d(${x}px, ${y}px, 0)`;
      if (next === host.last) continue;
      host.last = next;
      host.el.style.transform = next;
    }
  };

  // The camera. A wheel notch and a held key both move a *target*; the frame eases
  // towards it, so a trackpad flick and a repeated key land smoothly and the scene
  // never jumps between two sizes.
  //
  // The home is the *fit*, not a crop: at ZOOM_HOME the world is exactly the pane's
  // height, so the whole painting - the sky above the crown, the soil band, the menu
  // standing under it - is on screen the moment the title opens. The title used to
  // open at 1, which is a 55% crop of the world: the top of the sky and the bottom
  // of the soil (and the art standing on the world's foot) were cut off at load,
  // every load, and the only way to see the composition was to pull back by hand.
  // That read exactly like a game permanently zoomed in.
  // Below the home is still allowed, and above it is the close camera a player uses
  // to look at the plant. The world is painted edge to edge behind the scene, so the
  // range is a camera, not a scale of one picture.
  // The world is 100vh / ZOOM_MIN tall (181.8vh) with its horizon horizonBase / ZOOM_MIN
  // down, so 0.55 is the point where the pane is still entirely inside it by
  // construction: further out and the camera would leave the place it is filming and
  // the top or bottom edge would show.
  const ZOOM_MIN = 0.55;
  const ZOOM_MAX = 3.2;
  /**
   * Where the camera rests: the composed framing, from config (`title_home_zoom`).
   * Clamped to the camera's own range, so a bad config cannot open the title past
   * the world's edge or inside the plant.
   */
  const configuredHome = options.homeZoom;
  const ZOOM_HOME =
    typeof configuredHome === 'number' && Number.isFinite(configuredHome)
      ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, configuredHome))
      : ZOOM_MIN;
  let zoom = ZOOM_HOME;
  let zoomTarget = ZOOM_HOME;
  // The camera, without a style recalculation per frame.
  //
  // The zoom used to be written as a custom property on the menu root, every frame of
  // the ease. A custom property that a few hundred elements inherit makes the browser
  // recalculate every one of them: measured while zooming, a frame took 266ms at the
  // median and 1084ms at the worst - three or four frames a second for one wheel
  // notch, against 17ms a frame idle. The scale is now a transform on the element that
  // carries the world, and the variable that the sky band and the sun's arc are sized
  // from is written once, when the camera stops.
  const zoomHost = options.zoomHost ?? varsTarget;
  let zoomSettled = 1;
  const publishZoom = (): void => {
    zoomHost.classList.add('is-zooming');
    zoomHost.style.transform = `scale(${zoom.toFixed(4)})`;
    // The sky is the camera's, not the place's. Counter-scaled by the camera's own
    // factor (about its foot, on the horizon) it keeps the same size and the same
    // place on screen at every zoom: the clouds, the sun, the moon and the storm's
    // bank no longer swim outwards when the wheel moves, and the sun that was half
    // over the frame at 1 stays the same distance from the horizon at any stop.
    //
    // This is written as the element's own `scale`, not as an inherited property:
    // one element, one compositor-only style, no recalculation of the tree under it
    // - which is what made the old per-frame custom-property write cost 40ms.
    sky.style.scale = String(1 / zoom);
  };
  // The end of a zoom is deferred by a quarter of a second. Landing the variable on the
  // frame the camera stops meant a full style pass between every wheel notch of a short
  // scroll: measured, seven frames over 50ms and a 134ms worst frame in one 3.3s
  // gesture, against 17ms at the median. Now a quick series of notches is one landing.
  let zoomVarTimer = 0;
  const settleZoom = (): void => {
    window.clearTimeout(zoomVarTimer);
    zoomVarTimer = window.setTimeout(() => {
      zoomVarTimer = 0;
      if (destroyed) return;
      // The layer stays promoted until the variable is written, so demoting it and
      // re-rasterising the world at the final scale is one hitch per gesture, not per
      // notch. It has to happen: a promoted layer re-paints its whole raster whenever
      // anything inside it changes colour, and the sky rewrites the palette every two
      // seconds - so leaving it promoted to save one hitch buys a hitch every tick.
      zoomHost.classList.remove('is-zooming');
      zoomHost.style.transform = '';
      if (Math.abs(zoom - zoomSettled) < 0.001) return;
      zoomSettled = zoom;
      zoomHost.style.setProperty('--pl-scene-zoom', zoom.toFixed(3));
      // The camera has landed: the sky keeps the counter-scale the transform had
      // during the gesture, so nothing on it shifts as the variable takes over.
      sky.style.scale = String(1 / zoom);
    }, 260);
  };
  // The first frame is already at home. The stylesheet's default is scale(1), so
  // without this the title would open on the old crop and jump back a frame later.
  zoomHost.style.setProperty('--pl-scene-zoom', zoom.toFixed(3));
  sky.style.scale = String(1 / zoom);
  zoomSettled = zoom;
  // The arc, raw and quantised, lives in `orbPlacement.ts`: the raw forms give
  // where a body is now, the quantised ones where the disc is *drawn*, and the
  // difference is what the smooth pass carries as a translate. The geometry is
  // shared with the test so the ordering can be checked without a browser.
  // The arc's own box, cached per zoom and per pane: a percentage of the arc is
  // only a pixel count against the arc's layout size, and that box is not the pane
  // (the world scales, the sky counter-scales). Reading it per frame would be a
  // layout read per frame; reading it per zoom step is one per gesture.
  let arcBox = { key: '', w: 0, h: 0, clamp: 0 };
  const arcSize = (): { w: number; h: number; clamp: number } => {
    const key = `${zoom}:${window.innerWidth}x${window.innerHeight}`;
    if (arcBox.key !== key) {
      // The CSS `left` clamp on a disc is half its width plus a hair, in the box
      // space the arc's percentages resolve in - which is this box, not the pane.
      const vmin = Math.min(window.innerWidth || 1, window.innerHeight || 1);
      arcBox = {
        key,
        w: arc.clientWidth,
        h: arc.clientHeight,
        clamp: (CELESTIAL_SIZE_VMIN / 100) * vmin * 0.5 + 6,
      };
    }
    return arcBox;
  };
  /** Move a disc from where it is drawn to where its body is. */
  const placeSmooth = (
    el: HTMLElement,
    body: CelestialBody,
    size: { w: number; h: number; clamp: number },
  ): void => {
    const baseInset =
      Number.parseFloat(el.style.getPropertyValue('--pl-body-inset')) || arcInset(body.x);
    const baseHeight =
      Number.parseFloat(el.style.getPropertyValue('--pl-body-height')) || arcHeight(body.y);
    const { dx, dy } = smoothOrbOffset(baseInset, baseHeight, body, size);
    el.style.transform = `translate(-50%, -50%) translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0)`;
  };

  // A body that is not drawn holds the place where it set.
  //
  // `sunPosition`/`moonPosition` answer {0, 0} for the body that is down, and the
  // disc's opacity fades over 600ms - so every dusk the sun slid to the *top left
  // corner* of the arc while it dimmed, and every dawn the moon did: a disc that
  // teleports across the sky to fade out. The last drawn place is kept here and
  // reused while the body is down, so a fade happens where the body went down.
  // Both the slow layout and the per-frame smooth pass ask this, so the two can
  // never disagree about where an unlit body is.
  const heldOrb = new Map<'sun' | 'moon', { x: number; y: number }>();
  const whereOrb = (key: 'sun' | 'moon', body: CelestialBody): CelestialBody => {
    if (body.visible) {
      heldOrb.set(key, { x: body.x, y: body.y });
      return body;
    }
    const held = heldOrb.get(key);
    return held ? { ...body, x: held.x, y: held.y } : body;
  };

  const setZoom = (value: number): void => {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
    if (Math.abs(next - zoomTarget) < 0.0001) return;
    zoomTarget = next;
    // No frame loop is running - reduced motion, a title the app has paused, or a
    // document the browser has hidden (frames do not run in a hidden tab) - so there
    // is nothing to ease: the camera lands where it was asked to instead of waiting
    // for a tick that will not come.
    if (!parallaxOn || !active || document.hidden) {
      zoom = zoomTarget;
      publishZoom();
      settleZoom();
    }
  };

  const tick = (nowMs: number): void => {
    if (destroyed || !active) return;
    frame = 0;
    const dt = lastFrameMs === 0 ? 16 : Math.min(64, nowMs - lastFrameMs);
    lastFrameMs = nowMs;
    if (draft !== null && parallaxAllowed) {
      if (dt > 40) slowDragFrames += 1;
      if (slowDragFrames >= 3) {
        parallaxAllowed = false;
        root.dataset.parallaxGate = 'off';
      }
    }
    const wanted = parallaxTarget(draft, pointer, options.parallax, rest);
    state = stepParallax(state, wanted, dt, options.settleMs);
    if (parallaxAllowed) {
      // The near plane follows the same target as the hills: released, the two
      // pictures settle together on the drag's new resting place instead of the
      // foreground snapping home while the background stays where it was put.
      nearState = stepParallax(nearState, wanted, dt, options.settleMs);
    }
    apply();
    if (zoom !== zoomTarget) {
      zoom += (zoomTarget - zoom) * Math.min(1, dt / 90);
      if (Math.abs(zoomTarget - zoom) < 0.0005) zoom = zoomTarget;
      publishZoom();
      // The variable goes out on the frame the camera lands, not before: until then
      // the transform alone carries the zoom.
      if (zoom === zoomTarget) settleZoom();
    }
    // A still picture does not need frames. The loop used to run at full rate for
    // as long as the title was mounted, repainting a 2D world that had not moved
    // (and, behind it, a 3D scene nobody could see). When the camera and the
    // parallax have both arrived, the loop stops, and the next pointer or wheel
    // event starts it again.
    const moving =
      zoom !== zoomTarget ||
      Math.abs(state.x - wanted.x) > 0.02 ||
      Math.abs(state.y - wanted.y) > 0.02 ||
      Math.abs(nearState.x - wanted.x) > 0.02 ||
      Math.abs(nearState.y - wanted.y) > 0.02;
    if (!moving) return;
    frame = requestAnimationFrame(tick);
  };

  /** Start the frame loop again after the scene settled or was paused. */
  const wake = (): void => {
    if (!parallaxOn || !active || destroyed || frame !== 0) return;
    lastFrameMs = 0;
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
    if (!active) return;
    // One drag at a time: a second press mid-drag would take the capture and the
    // resting place from the hand that is still moving the picture.
    if (dragStart) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    // The plant owns its own presses. Its grab surface is a child of this scene,
    // so without this a bend of the mascot also started a drag of the whole
    // background: the plant moved and the world slid under it at the same time.
    const target = event.target as Element | null;
    if (target?.closest?.('.pl-title-plant')) return;
    // The parallax gate is per gesture.
    //
    // It exists so a drag that is already running at three frames a second stops
    // writing transforms on every frame, and it used to latch: after three slow
    // frames the scene never dragged again for the rest of the visit, which is why
    // the background felt un-draggable. A new press lifts the gate; if the drag is
    // still slow it closes again on its own.
    parallaxAllowed = true;
    slowDragFrames = 0;
    root.dataset.parallaxGate = 'on';
    wake();
    dragStart = { x: event.clientX, y: event.clientY, base: { ...state } };
    dragPointerId = event.pointerId;
    draft = { ...state };
    root.classList.add('is-dragging');
    // Capture is an optimisation, not the mechanism: if it fails the drag still
    // continues while the pointer is over the scene.
    try {
      root.setPointerCapture?.(event.pointerId);
    } catch {}
  };

  const onPointerMove = (event: PointerEvent): void => {
    // A pointer still captured when the title is parked must not move its camera
    // or leave a hover offset waiting for the next visit.
    if (!active) return;
    wake();
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
    // Only the pointer that started the drag can end it; a second finger's
    // release is not the hand letting go of the picture.
    if (dragPointerId !== null && event.pointerId !== dragPointerId) return;
    dragStart = null;
    // A release is a new resting place, not a spring-back: the drag is the
    // player's framing decision, so the scene stays where the hand left it.
    if (draft) rest = { ...draft };
    draft = null;
    root.classList.remove('is-dragging');
    dragPointerId = null;
    wake();
    try {
      root.releasePointerCapture?.(event.pointerId);
    } catch {}
  };

  let toggleEnabled = true;
  /** The last drag offsets written, so a still scene writes nothing. */
  /** The foreground's own eased offset: it settles with the hills, not before them. */
  let nearState: ParallaxPoint = { ...PARALLAX_ORIGIN };
  const inTextEntry = (target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null;
    return Boolean(
      el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable),
    );
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    // Window-level, like the wheel: the title is still mounted and hidden behind
    // the world, and its camera keys must not answer presses meant for the game.
    if (!active || !toggleEnabled) return;
    if (inTextEntry(event.target)) return;
    if (event.key === 'h' || event.key === 'H') {
      event.preventDefault();
      options.onToggleUi();
      return;
    }
    // The two keys a keyboard has for a camera, and 0 to put it back where it was.
    // Holding + or - repeats the key, and the easing above turns the repeats into
    // one smooth push rather than a series of steps.
    if (event.key === '0') {
      event.preventDefault();
      setZoom(ZOOM_HOME);
      wake();
      return;
    }
    // Space: the camera home. The same key the game uses to put the view back on
    // the plant, in the title's own terms - the composed zoom, no drag offset, the
    // hover parallax released - so a player who has pulled the frame apart gets it
    // back in one press. Not on a focused control: Space activates a button and
    // must keep doing that.
    if (event.key === ' ') {
      const el = event.target as HTMLElement | null;
      if (el?.closest?.('button, a, input, select, textarea, [contenteditable]')) return;
      event.preventDefault();
      setZoom(ZOOM_HOME);
      draft = null;
      pointer = null;
      // The camera home is the whole framing: zoom, drag offset and hover all
      // come back, or Space would leave the picture dragged off-centre.
      rest = { ...PARALLAX_ORIGIN };
      wake();
      return;
    }
    let step = 0;
    if (event.key === '+' || event.key === '=') step = 0.2;
    else if (event.key === '-' || event.key === '_') step = -0.2;
    else return;
    event.preventDefault();
    setZoom(zoomTarget + step);
    wake();
  };

  const onWheel = (event: WheelEvent): void => {
    // The title answers the wheel only while it is the screen; a hidden title that
    // still called preventDefault would eat the world's own camera wheel.
    if (!active || !toggleEnabled || inTextEntry(event.target)) return;
    // A wheel over a panel that can scroll is that panel's; the title has nothing
    // to scroll, so anywhere else the wheel is the camera.
    const target = event.target as Element | null;
    if (target?.closest?.('.pl-menu__popover, .pl-menu__card, .pl-menu__care')) return;
    event.preventDefault();
    // deltaMode: 0 is pixels, 1 lines and 2 pages. A mouse notch is 100px and a
    // trackpad pinch reports small continuous deltas, so the scale is per pixel and
    // the step is capped: a fast flick cannot throw the camera across its range.
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    const step = Math.max(-0.3, Math.min(0.3, -event.deltaY * unit * 0.0015));
    if (step === 0) return;
    setZoom(zoomTarget + step);
    wake();
  };

  const parallaxOn = options.parallax.enabled && !options.reducedMotion;
  if (parallaxOn) {
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerup', endDrag);
    root.addEventListener('pointercancel', endDrag);
    // A capture can be taken away (the window loses focus, another element
    // captures the pointer) without a pointerup. Without these the scene kept
    // `is-dragging` - and its grabbing cursor - until the next press.
    root.addEventListener('lostpointercapture', endDrag);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    root.addEventListener('pointerleave', (event) => {
      if (!dragStart) {
        // The hover spring is gone, so the scene returns to its resting offset -
        // which is where a released drag left it, not the origin. `endDrag`
        // returns early when nothing is held, and the frame loop stops itself at
        // rest: without this wake the hills stayed leaning after the pointer left
        // the window until the next pointer event started a frame again.
        pointer = null;
        wake();
      }
      endDrag(event);
    });
    window.addEventListener('keydown', onKeyDown);
    frame = requestAnimationFrame(tick);
  } else {
    window.addEventListener('keydown', onKeyDown);
    apply();
  }
  window.addEventListener('wheel', onWheel, { passive: false });

  if (options.reducedMotion) hint.classList.add('is-faded');
  const fadeTimer = options.reducedMotion
    ? 0
    : window.setTimeout(() => hint.classList.add('is-faded'), Math.max(0, options.hintFadeMs));

  // `hillFar`, `canopyBack`, `canopyFront` and `frond` are written by name below
  // (the hill colours are interpolated, and the other three painted the hedge that
  // no longer exists - nothing reads them), so they are not in this table.
  const paletteVars: Array<[keyof TitlePalette, string]> = [
    ['skyHigh', '--pl-sky-high'],
    ['skyMid', '--pl-sky-mid'],
    ['skyLow', '--pl-sky-low'],
    ['cloud', '--pl-cloud'],
    ['hillNear', '--pl-hill-near'],
    ['groundTop', '--pl-ground-top'],
    ['groundBody', '--pl-ground-body'],
    ['soilEdge', '--pl-soil-edge'],
    ['sun', '--pl-sun-core'],
  ];

  /**
   * The keys that take the ground clock instead of the sky's (see `setPalette`'s
   * `ground` argument). The hills are here because they are the expensive paint:
   * a sky step cost 50-383 ms with the three hill bands shown and 83-149 ms with
   * them hidden, and a dark silhouette losing a few per cent of its colour is the
   * least readable change in the picture.
   */
  const groundKeys = new Set<keyof TitlePalette>([
    'groundTop',
    'groundBody',
    'soilEdge',
    'hillNear',
  ]);

  return {
    element: root,

    /**
     * Paint the hour.
     *
     * `ground` is the same palette on a much coarser clock (see `GROUND_STEPS` in
     * the menu). Every sky step repaints the world's gradients, and the soil is the
     * expensive one: the stage and its bleed carry seventeen gradient layers over a
     * 2479x430 px cut, and a step that rewrites any colour they use re-rasterises the
     * lot - measured at 200 ms of the 250 ms a step cost. The soil is also the part
     * of the picture the eye reads least (a dark cut face moving by a few per cent),
     * so it gets its own, much slower clock and ninety per cent of the sky's steps
     * never touch it.
     */
    setPalette(palette: TitlePalette, ground: TitlePalette = palette): void {
      for (const [key, cssVar] of paletteVars) {
        const value = (groundKeys.has(key) ? ground : palette)[key];
        if (typeof value !== 'string') continue;
        (skyKeys.has(key) ? skyVars : vars).set(cssVar, value);
      }
      // Lit cloud tops: the cloud colour pulled toward the sun, so dusk tops warm
      // up with the light instead of staying white.
      skyVars.set('--pl-cloud-light', lerpHex(palette.cloud, palette.sun, 0.45));
      // Underside of a cloud: the body pushed toward shadow, so it has volume.
      skyVars.set('--pl-cloud-shade', lerpHex(palette.cloud, palette.hillFar, 0.35));
      // Rain is the colour of the sky it falls through: pale at noon, steel at
      // dusk, moonlit grey at night. A fixed blue was the one colour in the
      // scene that never changed with the hour.
      skyVars.set(
        '--pl-rain-colour',
        lerpHex(palette.skyLow, '#e9f1f6', 0.55 + 0.25 * palette.star),
      );
      // Snow is lit like the clouds it falls out of: white pulled toward the hour's
      // light, so it is pink at dusk and grey-blue at night rather than a fixed
      // white that ignores the sky.
      skyVars.set('--pl-snow-colour', lerpHex(palette.cloud, '#ffffff', 0.6));
      // The moon is lit by the same sun the rest of the palette is: a pale core, a
      // cooler far side, and maria that stay readable at 40 px.
      // A moon is the brightest thing in the scene: its lit face is nearly white at
      // night, and only the limb takes the sky's colour.
      skyVars.set('--pl-moon-core', lerpHex(palette.sun, '#ffffff', 0.78));
      skyVars.set('--pl-moon-mid', lerpHex(palette.sun, palette.skyHigh, 0.22));
      skyVars.set('--pl-moon-shade', lerpHex(palette.sun, palette.skyHigh, 0.62));
      skyVars.set('--pl-moon-mare', lerpHex(palette.skyHigh, palette.sun, 0.42));
      // The cut soil: a lit lip on the surface, the body darkening with depth, and
      // roots that are bone by the surface and take the soil's colour as they go.
      // The cut's own colours, on the ground clock with the ramp they come from.
      vars.set('--pl-soil-lip', lerpHex(ground.soilEdge, ground.sun, 0.34));
      vars.set('--pl-soil-deep', lerpHex(ground.groundBody, '#000000', 0.38));
      // The root plate is drawn inside the plant, and MainMenu's ground pass writes
      // its root palette onto the plant element itself. Nothing in this scene layer
      // inherits those words, so they are deliberately not written here: a second
      // set on the scene hosts was the reason the plate stayed on its fallback bone
      // colour at every hour while the soil around it changed.
      // Hill crests catch the light: the ridge colour pulled toward the sun, so
      // the two ridges separate at dusk and close up again at night.
      // Every one of these paints a hill band, so they take the ground's clock for
      // the measured reason in `groundKeys`.
      skyVars.set('--pl-hill-rim', lerpHex(ground.hillFar, ground.sun, 0.5));
      // The two nearer ranges are the far hills walked towards the viewer: each
      // one a shade darker than the one behind it, so the depth stack reads as
      // distance and the whole landscape crosses the day together.
      // Aerial perspective. Three ranges of nearly the same dark green stack into one
      // flat band at night; the farthest one is the one with the most air in front of
      // it, so it takes the colour of that air.
      skyVars.set('--pl-hill-far', lerpHex(ground.hillFar, ground.skyLow, 0.3));
      skyVars.set('--pl-hill-mid', lerpHex(ground.hillNear, '#000000', 0.16));
      skyVars.set('--pl-hill-deep', lerpHex(ground.hillNear, '#000000', 0.34));
      skyVars.set('--pl-hill-rim-opacity', (0.22 + (ground.star > 0.5 ? 0.06 : 0.24)).toFixed(3));
      // The props stand in the same hour as the ground they are on, so their colours
      // come from the ground's own palette; only the flowers and the mill's sails take
      // the sky's light, because those are the two that should warm as the sun sets.
      skyVars.set('--pl-hill-distant', lerpHex(ground.hillFar, ground.skyLow, 0.55));
      skyVars.set('--pl-stem-colour', lerpHex(ground.hillNear, ground.groundBody, 0.5));
      skyVars.set('--pl-bloom-colour', lerpHex(BLOOM_COLOUR[scenerySeason], palette.sun, 0.2));
      skyVars.set('--pl-bloom-heart', lerpHex(palette.sun, '#8a6b2f', 0.5));
      skyVars.set('--pl-mushroom-cap', lerpHex('#b7583f', palette.sun, 0.18));
      skyVars.set('--pl-mushroom-stem', lerpHex('#e6dcc4', ground.groundTop, 0.24));
      skyVars.set('--pl-mushroom-spot', lerpHex('#f3e7cf', palette.sun, 0.24));
      skyVars.set('--pl-wood', lerpHex('#6b4a2a', ground.groundBody, 0.28));
      skyVars.set('--pl-wood-light', lerpHex('#8a6438', ground.sun, 0.3));
      skyVars.set('--pl-wood-dark', lerpHex('#4a3018', ground.groundBody, 0.34));
      skyVars.set('--pl-metal', lerpHex('#3f3a33', ground.hillNear, 0.3));
      skyVars.set('--pl-lamp-warm', lerpHex('#ffd28a', palette.sun, 0.28));
      skyVars.set('--pl-mill-body', lerpHex(ground.hillNear, '#000000', 0.28));
      skyVars.set('--pl-mill-roof', lerpHex(ground.hillNear, '#000000', 0.44));
      skyVars.set('--pl-mill-sail', lerpHex(palette.cloud, palette.sun, 0.24));
      // The two weather bands that cover the world. Their tints are written from
      // the ground's slow palette rather than the sky's: a full-world veil and the
      // storm bank were two of the largest repaints a sky step caused, for a hue
      // change too small to see at a 28-second step. The mood's opacity still
      // follows the weather every render; only its tint is coarse.
      skyVars.set('--pl-mood-colour', lerpHex('#26313a', ground.skyLow, 0.18));
      skyVars.set('--pl-storm-colour', lerpHex('#232b31', ground.skyMid, 0.18));
      skyVars.set('--pl-bird', lerpHex(ground.hillFar, '#000000', 0.4));
      skyVars.set('--pl-bat', lerpHex(ground.hillFar, '#000000', 0.55));
      skyVars.set('--pl-rabbit', lerpHex(ground.hillNear, '#000000', 0.26));
      skyVars.set('--pl-rabbit-ear', lerpHex(ground.hillNear, ground.sun, 0.16));
      skyVars.set('--pl-worm', lerpHex('#c08a83', ground.groundBody, 0.3));
      skyVars.set('--pl-worm-tip', lerpHex('#e2b3aa', ground.groundBody, 0.16));
      skyVars.set('--pl-prop-ink', lerpHex(ground.groundBody, '#000000', 0.6));
      sceneryStar = palette.star;
      applyScenery();
      skyVars.set('--pl-star', String(palette.star));
      stars.classList.toggle('is-lit', palette.star > 0.05);
      skyVars.set('--pl-sun-glow', String(palette.sunGlow));
      // `--pl-plant-dim` is written by the menu's own light pass, next to the rest
      // of the plant's grade; two writers for one value is one write too many.
    },

    addParallaxHost(el: HTMLElement, factorX: number, factorY: number, anchor = ''): void {
      addHost(el, factorX, factorY, anchor, false);
    },

    setWeather(weather: TitleWeather): void {
      // Before the compare: where the drops land is measured in pixels, so it is
      // (re)written here, when the layer exists and has a width. Guarded by the
      // width it last used, so a tick that changes nothing writes nothing.
      applyLandingLifts();
      // The ground holds what falls on it, on every tick - not only when the weather
      // changes, or a long rain would leave the same puddle it started with. The
      // rules are the shared ones (and clamp dt, so a hidden tab is not a flood).
      stepSurface(weather);
      // One string compare: the sky ticks once a second and the weather changes a
      // handful of times a day, so most ticks must cost nothing at all.
      const key =
        `${weather.kind}:${weather.cloudiness.toFixed(2)}:${weather.rain.toFixed(2)}` +
        `:${weather.fog.toFixed(2)}:${weather.wind.toFixed(2)}`;
      if (key === lastWeatherKey) return;
      lastWeatherKey = key;
      root.classList.toggle('is-overcast', weather.cloudiness > 0.45);
      root.classList.toggle('is-raining', weather.rain > 0.05);
      // Any rain at all runs the drops; none at all pauses them (see the idle
      // rules in the stylesheet). Hysteresis would only leave an invisible field
      // animating at a hundredth of a millimetre per hour. The layers live on the
      // weather host, so that is where the idle classes go.
      vars.set('--pl-rain', weather.rain.toFixed(2));
      vars.set('--pl-fog', weather.fog.toFixed(2));
      // How much weather is in the light, not only in the air. Rain, or enough
      // cloud to mean it: the storm bank, the sun's glow, the horizon bloom and
      // the mood veil are all graded by this one number, so a bright disc and a
      // golden horizon cannot survive a shower.
      const storm = Math.min(
        1,
        Math.max(weather.rain, Math.max(0, weather.cloudiness - 0.35) * 1.15),
      );
      vars.set('--pl-storm', storm.toFixed(2));
      rainLevel = weather.rain;
      sceneryRain = weather.rain;
      // A shower and a squall used to be the same curtain with a different drop
      // count. The heat is the rain amount pushed by the storm, and it drives the
      // drops, the splash rings and the wet grade together, so a thunderstorm is a
      // different weather and not a denser drizzle.
      const rainHeat = Math.min(1, weather.rain ** 1.2 * 0.8 + storm * 0.45);
      vars.set('--pl-rain-heat', rainHeat.toFixed(2));
      applySplashHeat(rainHeat);
      // Snow is a different picture, not a repaint of the rain: the flakes fall
      // slowly and round, so the streak layer goes off and the flake layer comes
      // on, both driven by the same amount.
      const snowing = weather.kind === 'snow' && weather.rain > 0.02;
      root.classList.toggle('is-snowing', snowing);
      vars.set('--pl-snow', snowing ? weather.rain.toFixed(2) : '0');
      if (snowing) vars.set('--pl-rain', '0');
      else applyRainWeight(rainHeat);
      // A layer the weather has switched off is invisible, so it must stop
      // animating: 170 drops and 68 splash rings kept compositing under a clear
      // sky. See the idle rules in the stylesheet.
      weatherRoot.classList.toggle('is-rain-idle', snowing || weather.rain <= 0);
      weatherRoot.classList.toggle('is-snow-idle', !snowing);
      // Rain-lit air is cooler and greyer than fair-weather haze, so the fog band
      // takes its colour from the weather as well as its amount.
      // Warm haze by day, cool grey under rain: the air near the ground is lit by
      // the same sun as the hills, and a blue-white band under a golden sky was the
      // one cold thing left in a warm picture.
      vars.set('--pl-fog-colour', weather.rain > 0.05 ? '#a8b2ad' : '#e6dcc8');
      // Wind is the canopy's, and the canopy is not in this element: the menu reads
      // this number from the scene's own root. Written here so there is one writer.
      //
      // One decimal, not two: the scene is a stack of gradients over a pane and a
      // half and a new value repaints all of it (measured 150-250 ms), while a
      // hundredth is not a change anyone can see - the weather drifts by that every
      // tick, which re-rastered the whole picture once a second for nothing.
      vars.set('--pl-wind', weather.wind.toFixed(1));
      // What the wind does to the weather that is already in the air: clouds cross
      // faster, rain falls faster. Writable on every weather step (a handful of
      // times a day), never per frame.
      // Rain falls faster in wind; the clouds take the same number as a playback
      // rate, so a crossing keeps its progress and only its pace changes.
      const speed = 1 - 0.45 * weather.wind;
      vars.set('--pl-wind-speed', speed.toFixed(2));
      for (const anim of cloudAnims) anim.playbackRate = speed;
      // The wind's pace on the things standing in it: the flowers sway faster and the
      // mill turns quicker, both from the one number that already moves the clouds.
      skyVars.set('--pl-sway-dur', `${(7.4 - weather.wind * 4.8).toFixed(2)}s`);
      skyVars.set('--pl-sail-dur', `${Math.round(34 - weather.wind * 27)}s`);
      applyScenery();
    },

    setSeason(seasonNumber: number): void {
      const next = seasonOf(seasonNumber);
      if (next === scenerySeason) return;
      scenerySeason = next;
      root.dataset.season = next;
      // The flower colour is written by the palette pass, which the menu runs after
      // this on the same tick (see `render` there), so there is no second writer here.
      applyScenery();
    },

    setToggleEnabled(enabled: boolean): void {
      toggleEnabled = enabled;
    },

    setActive(next: boolean): void {
      if (active === next) return;
      active = next;
      if (next && parallaxOn) {
        lastFrameMs = 0;
        wake();
      } else {
        cancelAnimationFrame(frame);
        frame = 0;
        // Park the pointer work too: a drag or a pending push belongs to the
        // screen that was showing, not to the one the player is now on.
        cancelAnimationFrame(pushFrame);
        pushFrame = 0;
        clearPush();
        pointer = null;
        dragStart = null;
        draft = null;
        if (dragPointerId !== null) {
          try {
            root.releasePointerCapture(dragPointerId);
          } catch {}
          dragPointerId = null;
        }
        root.classList.remove('is-dragging');
      }
    },

    setCelestial(sunBody: CelestialBody, moonBody: CelestialBody): void {
      // Percentages of the arc, never pixels.
      //
      // The arc is pane-wide on screen, but in world units it is 100vw / zoom, so
      // every wheel step changed the box under the old pixel translate while the
      // disc kept the offset from the last sky tick: it stayed where it was
      // against the resized sky and jumped to the new offset a tick later. A
      // percentage is resolved by CSS against whatever the arc currently is, so
      // zoom and drag carry the body with the sky with no code running at all.
      // Quantised to a quarter of a percent of the arc, about two pixels.
      //
      // These two numbers are the disc's `left` and `top`, and the disc's band is a
      // percentage of the arc: a step relayouts and repaints that layer, which was
      // the title's once-a-second hitch - the sky tick rewrote them every second for
      // a body that moves a tenth of a percent a minute. At a quarter of a percent
      // the body steps a pixel or two every couple of minutes, which is below what
      // an eye can follow in a sky.
      const inset = quantArcInset;
      const heightShare = quantArcHeight;
      const place = (body: HTMLElement, x: number, y: number): void => {
        body.style.setProperty('--pl-body-inset', inset(x).toFixed(2));
        body.style.setProperty('--pl-body-height', heightShare(y).toFixed(4));
      };
      const sunSpot = whereOrb('sun', sunBody);
      const moonSpot = whereOrb('moon', moonBody);
      place(sun, sunSpot.x, sunSpot.y);
      place(moon, moonSpot.x, moonSpot.y);
      // Screen geometry for the halos, which live in the pane-sized screen layer.
      // innerWidth/innerHeight are cached by the browser, so nothing here reads
      // layout; the old clientWidth/clientHeight pair forced one four times a
      // second, which is what the zoom stutter was.
      const paneW = window.innerWidth || 1;
      const paneH = window.innerHeight || 1;
      const discSize = (CELESTIAL_SIZE_VMIN / 100) * Math.min(paneW, paneH);
      const horizonPx = readHorizonPx(paneH);
      const skyH = Math.max(1, horizonPx - discSize / 2 - 14);
      const sunX = (inset(sunBody.x) / 100) * paneW;
      const sunY = horizonPx - heightShare(sunBody.y) * skyH;
      // A body rises out of the horizon instead of switching on at it: its own
      // height is the fade, and both are on it at the one moment they swap. That is
      // what makes the 600 ms crossfade below harmless - without it the moon was
      // still fading out while the sun was up, so for half a second at every dawn
      // and dusk there were two bodies in one sky.
      const lift = (body: CelestialBody): number => Math.min(1, body.y * 12);
      // The disc itself dims in rain (no filter: a filter on a layer that moves
      // has to be re-rastered, an opacity does not). A visible sun through a
      // downpour is what made a wet scene read as sunny.
      sun.style.opacity = sunBody.visible
        ? (lift(sunBody) * Math.max(0, 1 - rainLevel * 0.55)).toFixed(2)
        : '0';
      moon.style.opacity = moonBody.visible
        ? (lift(moonBody) * (moonBody.opacity ?? 1)).toFixed(2)
        : '0';
      // The halos ride the same offsets, written on the halo elements themselves.
      // On the menu root these four properties were rewritten once a second and
      // every one of the title's two thousand descendants recalculated its style
      // for a value only two elements read - the pause before each step of the sun
      // and moon. A property on the element that reads it invalidates that element
      // and nothing else.
      const writeHalo = (
        selector: string,
        dxVar: string,
        dyVar: string,
        dx: number,
        dy: number,
        previous: string,
      ): string => {
        const next = `${dx.toFixed(1)}:${dy.toFixed(1)}`;
        if (next === previous) return previous;
        const halo = parallaxWorld().querySelector<HTMLElement>(selector);
        if (halo) {
          halo.style.setProperty(dxVar, `${dx.toFixed(1)}px`);
          halo.style.setProperty(dyVar, `${dy.toFixed(1)}px`);
        }
        return next;
      };
      lastSunHalo = writeHalo(
        '.pl-menu__wash--sun',
        '--pl-sun-dx',
        '--pl-sun-dy',
        sunX - paneW / 2,
        sunY - paneH / 2,
        lastSunHalo,
      );
    },

    setCelestialSmooth(sunBody: CelestialBody, moonBody: CelestialBody): void {
      // Where the disc is drawn is read back from the disc.
      //
      // The offset is a difference of two percentages of the same box, so the box
      // itself is the only geometry it needs - no pane, no horizon, no cached
      // baseline to go stale when a wheel rescales the arc. The drawn position is
      // read back from the disc's own custom properties, which `setCelestial`
      // wrote: whatever step the layout is on, the body is moved from *there*.
      const size = arcSize();
      placeSmooth(sun, whereOrb('sun', sunBody), size);
      placeSmooth(moon, whereOrb('moon', moonBody), size);
    },

    destroy(): void {
      destroyed = true;
      for (const anim of cloudAnims) anim.cancel();
      window.clearTimeout(zoomVarTimer);
      cancelAnimationFrame(frame);
      frame = 0;
      window.clearTimeout(fadeTimer);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('pointermove', onPresenceMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      if (dragPointerId !== null) {
        try {
          root.releasePointerCapture(dragPointerId);
        } catch {}
        dragPointerId = null;
      }
      cancelAnimationFrame(pushFrame);
      pushFrame = 0;
      root.remove();
    },
  };
}
