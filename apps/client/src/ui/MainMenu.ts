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
import {
  leafThroughLight,
  lerpHex,
  moonBrightness,
  moonPosition,
  paletteAt,
  sunPosition,
  sunWashGate,
  titleLighting,
} from './title/dayCycle.ts';
import { growthStageFromPoints } from './title/growth.ts';
import {
  horizonForPane,
  MENU_FOOT_RESERVE_PX,
  mascotMaxWidthPx,
  menuFit,
  PLANT_ART_ASPECT,
  skyGroundPx,
} from './title/menuFit.ts';
import { autoDisplayName, resolveDisplayName } from './title/plantName.ts';
import { rootRuns } from './title/rootGrowth.ts';
import { cloudShadows } from './title/skyLayout.ts';
import { createStyleVarWriter } from './title/styleVars.ts';
import { createTitlePlant, PLANT_MAX_SCALE, type TitlePlant } from './title/TitlePlant.ts';
import { createTitleScene, type TitleScene } from './title/TitleScene.ts';
import {
  applyCare,
  type CareAction,
  careStage,
  emptyCare,
  reachedTreasures,
  TREASURES,
  type Treasure,
  treasureArt,
} from './title/treasures.ts';
import type { TitleWeather } from './title/weather.ts';
import { weatherBetween, weatherFromState } from './title/weather.ts';
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
  /**
   * The world's season number, for the title's verge. Read on every sky tick rather
   * than passed once: a season rolls over while the title is open, and the flowers
   * should change with the world instead of with the page load.
   */
  season?: () => number;
  /** Called when the player commits a name or a new avatar. */
  onProfileChange?: (profile: { displayName?: string; avatar?: string | null }) => void;
  /**
   * One line of session diagnostics. The avatar picker reports each step, so a
   * session that stops without unloading can be read back afterwards and the
   * upload blamed or cleared.
   */
  onDiagnostic?: (kind: string, detail?: Record<string, unknown>) => void;
}

const STYLE_ID = 'pl-menu-style';

/** The size an avatar slot draws, in pixels. */
const AVATAR_DRAW_PX = 128;
/** Widest the picker will decode, before the cover crop: a bounded allocation. */
const AVATAR_DECODE_PX = 512;

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
  /* The title is still in the document while the world runs. Any animation left
     running under it is a frame the game does not get. */
  .pl-menu.is-title-parked .pl-menu__world,
  .pl-menu.is-title-parked .pl-menu__world *,
  .pl-menu.is-title-parked .pl-menu__ui * {
    animation-play-state: paused !important;
  }
  /* And skip its rendering altogether: paused animations still leave every painted
     layer of the title in the compositor while the game draws over it. Visibility,
     not content-visibility - the latter left the whole title unpainted when it was
     switched back on (nothing but the backdrop on screen; measured, styles correct,
     content never drawn), which is far worse than the work it saves. */
  .pl-menu.is-title-parked .pl-menu__world { visibility: hidden; }
  /* Wind: the plant leans further and faster than its own idle sway. The speed, not
     the angle, is what reads as weather. */
  .pl-menu.is-windy .pl-title-plant__sway {
    animation-duration: calc(var(--pl-sway-ms, 5200ms) * 0.55);
  }
  /* Dev-only frame meter. Small, monospaced, out of the way: it exists to be read
     aloud in a bug report, not to decorate the title. It sits top-left, because
     the H hint is written along the bottom edge and the two ran into each other
     ("...worst 117msE MENU"). */
  .pl-frame-meter {
    position: fixed;
    left: 10px;
    top: 8px;
    bottom: auto;
    z-index: 900;
    padding: 2px 6px;
    border-radius: 5px;
    background: rgba(6, 10, 8, 0.62);
    color: #cdf0b8;
    font: 500 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: 0.02em;
    pointer-events: none;
    white-space: nowrap;
  }
  .pl-menu {
    isolation: isolate;
  }
  /* What is behind the world. The camera can pull back past the composed frame,
     and without a backdrop the painting shrank into a rectangle of black - a
     border made of nothing. Sky above the line, ground below it, so pulling back
     reads as seeing more of the same place.

     It is a layer of its own rather than the menu's own background, because the
     palette variables it paints with are now written per layer: written on the
     menu they reached two thousand descendants, and the browser repainted the whole
     title on every step of the day. */
  .pl-menu__backdrop {
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background: linear-gradient(
      180deg,
      var(--pl-sky-high, #0b1120) 0,
      var(--pl-sky-mid, #111a2c) calc(var(--pl-horizon, 54%) - 6%),
      var(--pl-ground-body, #553a26) var(--pl-horizon, 54%),
      var(--pl-soil-deep, #2a1d15) 100%
    );
  }
  /* The static recipes the ground paints with. They are custom properties, so the
     stage and the bleed below inherit them; the palette colours they name are
     written on those layers themselves, not here. */
  .pl-menu {
    /* The cut face, in one place. The stage paints it with pebbles, bedding bands and
       a lit lip on top; the parallax bleed is a wider copy of the same ground, so it
       takes the same ramp and the two cannot mismatch where they meet. */
    --pl-soil-face: linear-gradient(
      180deg,
      var(--pl-ground-top) 0,
      color-mix(in srgb, var(--pl-ground-top) 72%, var(--pl-ground-body)) 9%,
      var(--pl-ground-body) 34%,
      var(--pl-soil-deep, #2a1d15) 100%
    );
    /* The cut's own detail: scattered pebbles, two soft clumps and the bedding
       planes. It lives here because two elements paint this ground - the stage and
       the parallax bleed behind it - and the bleed used to be the plain ramp alone,
       so a drag slid a flat brown strip out from under a layered cut. One recipe,
       painted twice, cannot mismatch. */
    /* Five scales, not one. The cut used to be eight dots hand-placed at fixed
       percentages plus bands every 46px: the dots were spread evenly at any width and
       the bands were a ruler across the whole soil, so the ground read as a pattern
       rather than as dirt. The dots are still the largest scale (one each, so they
       never tile), but the grit and the aggregate below them are *tiles with sizes
       that share no factor* - 137, 211 and 397 - so the eye never finds the repeat,
       and the bedding is two rhythms at slightly different angles instead of one. */
    --pl-soil-detail:
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
      /* Aggregate: small stones and hollows, tiled at two prime-ish sizes. */
      radial-gradient(ellipse 5px 3px at 22% 30%, rgba(255, 255, 255, 0.05) 0 92%, transparent 96%)
        0 0 / 137px 103px repeat,
      radial-gradient(circle at 63% 71%, rgba(0, 0, 0, 0.16) 0 2px, transparent 3px)
        37px 19px / 137px 103px repeat,
      radial-gradient(ellipse 4px 3px at 41% 64%, rgba(0, 0, 0, 0.15) 0 92%, transparent 96%)
        11px 7px / 211px 157px repeat,
      radial-gradient(circle at 84% 22%, rgba(255, 255, 255, 0.045) 0 1.6px, transparent 2.4px)
        63px 41px / 211px 157px repeat,
      radial-gradient(circle at 12% 88%, rgba(0, 0, 0, 0.13) 0 2.4px, transparent 3.2px)
        29px 13px / 397px 269px repeat,
      /* Bedding. Four rhythms at 180, 176, 171 and 168 degrees with periods of 63,
         137, 191 and 397px - no two share a factor - so the layers beat against each
         other instead of landing together. With one 46px rhythm at nine per cent the
         cut read as floorboards: level, evenly spaced, all the way across. Each is a
         third as strong, and at these spacings the eye sees bedding rather than a
         ruler. */
      repeating-linear-gradient(
        180deg,
        rgba(0, 0, 0, 0) 0 62px,
        rgba(0, 0, 0, 0.045) 62px 63px,
        rgba(255, 255, 255, 0.02) 63px 64px
      ),
      repeating-linear-gradient(
        176deg,
        rgba(0, 0, 0, 0) 0 136px,
        rgba(0, 0, 0, 0.035) 136px 137px,
        rgba(255, 255, 255, 0.016) 137px 138px
      ),
      repeating-linear-gradient(
        171deg,
        rgba(0, 0, 0, 0) 0 190px,
        rgba(0, 0, 0, 0.03) 190px 191px,
        rgba(255, 255, 255, 0.014) 191px 192px
      ),
      repeating-linear-gradient(
        168deg,
        rgba(0, 0, 0, 0) 0 396px,
        rgba(0, 0, 0, 0.026) 396px 397px,
        rgba(255, 255, 255, 0.012) 397px 398px
      );
  }
  /* The world: landscape, ground and the plant. One layer, below the menu, so
     the plant reads as part of the place rather than a widget on top of it. */

  /* The world.

     This is not a picture the size of the window. It is a place: 260vw wide and
     260vh tall, with its horizon 130vh down from its own top, so there is as much
     ground below the line as sky above it. The camera moves over it - it is never
     resized to the frame - which is why pulling back shows more sky, more ground
     and more of the tree rather than shrinking a rectangle into a box in the void.

     Every layer inside inherits the horizon variable from here, so nothing had to
     be re-taught: they were already positioned from the horizon down, and the
     horizon is now the world's line instead of the window's. */
  /* The world's painting is enclosed: a style change on the camera must not
     invalidate the whole place. Paint containment only - strict containment was
     tried, and on the camera's own gesture (as opposed to a script driving the
     transform) it measured the same as this: 41 frames with 7 over 33ms against 40
     with 7. It is in the bug inventory as a thing that looked like a fix and was not. */
  .pl-menu__world { contain: paint; }
  .pl-menu__world {
    --pl-world-w: 200vw;
    /* The smallest box that still covers the pulled-back limit.

       At ZOOM_MIN 0.55 the pane is 1 / 0.55 = 181.8vh of the world in each
       direction, and it hangs from the horizon: (horizon share of the pane) / 0.55
       above the line, the rest below. So the sky above the line is exactly
       horizon-base / 0.55 tall, and the whole world is 100vh / 0.55 - plus two
       pixels, because the camera's scale lands on fractional pixels at the limit
       and an exact fit can open a hairline seam at the bottom. This used to be
       230vh with a 140vh horizon: 46,000 square vh of layer to rasterise where
       36,000 covers every pixel the wheel can reach.

       The width stays 200vw. The pane needs 181.8vw at the limit, and the 9vw
       either side of it is the camera's drag room - a 140px pull would otherwise
       slide the world's edge into view - and narrowing it would also move every
       cloud, star and find that is authored as a share of the world's width,
       which is a different picture at zoom 1. */
    --pl-world-h: calc(100vh / 0.55 + 6px);
    --pl-world-horizon: calc(var(--pl-horizon-base, 54vh) / 0.55 + 2px);
    /* Screen units inside the world. The world is scaled about the horizon, so a
       world-local length divided by the zoom lands as that many CSS pixels however
       the camera is set - which is what the parts that must stay pane-sized (the
       soil band the finds are placed in, the sky, the sun's arc) are authored in. */
    --pl-screen-w: calc(100vw / var(--pl-scene-zoom, 1));
    --pl-screen-h: calc((100vh - var(--pl-horizon-base, 54vh)) / var(--pl-scene-zoom, 1));
    --pl-screen-sky: calc(var(--pl-horizon-base, 54vh) / var(--pl-scene-zoom, 1));
    position: absolute;
    width: var(--pl-world-w);
    height: var(--pl-world-h);
    /* Placed so that at zoom 1 the world's horizon sits on the designed line. */
    left: 50%;
    margin-left: calc(var(--pl-world-w) / -2);
    top: calc(var(--pl-horizon-base, 54vh) - var(--pl-world-horizon));
    z-index: 1;
    pointer-events: none;
    /* Inside the world the horizon is the world's own. */
    --pl-horizon: var(--pl-world-horizon);
    /* Nothing paints outside the place: the foreground blur and the weather used to
       leak past the scene as dark smudges in the void. */
    overflow: hidden;
    /* The camera: pan and zoom about the horizon, so the ground line holds still and
       everything else moves around it. The pan is clamped to the world's own
       margins: pulled back to the 0.55 limit the world is only 10vw wider than the
       pane, and a 140px drag used to slide a strip of backdrop - a straight cut
       across the hills and soil - into view at the sides. */
    /* The camera is the zoom, and nothing else. The drag used to be folded in
       here as a clamped translate, which meant every pointer frame rewrote a
       variable that the whole world inherited and the browser recalculated every
       layer under it - a quarter of a second per frame at the pulled-back zoom.
       Each parallax layer now carries its own offset (see TitleScene.apply), so
       the world's box never changes during a drag and only the layers that move
       are recalculated. */
    transform: scale(var(--pl-scene-zoom, 1));
    transform-origin: 50% var(--pl-world-horizon);
  }
  /* While the camera moves, the world is one promoted layer the compositor can scale
     without repainting it: at 200vw by 182vh, re-rasterising the world on every step of
     a zoom was the whole cost of the wheel. The class comes off when the camera lands,
     so what is left behind is a crisp repaint at the final scale rather than a blurry
     one kept forever. */
  .pl-menu__world.is-zooming { will-change: transform; }
  .pl-menu__scene { position: absolute; inset: 0; }
  /* Until the world's hour is known the world stays out of sight, so the first
     frame the player sees is the correct time of day, never a jump into it. */
  .pl-menu__world.is-sky-pending { opacity: 0; }
  /* Screen effects.

     Light, weather, pollen, fireflies and the vignette belong to the camera, not to
     the place: they do not pan with the ground and they do not grow when the world
     does. Keeping them inside the world made nine full-size layers over a 200vw by
     200vh surface - a few dozen megabytes of composited texture and ten full-frame
     blends per frame, which is where the title screen's lag was coming from. */
  .pl-menu__screen {
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
    overflow: hidden;
  }
  /* The weather, in the camera's space.

     Rain, snow, fog and the splash band used to be moved into .pl-menu__fx, a
     child of the zoomed world, so the curtain painted over the cut soil and every
     measurement taken in screen pixels was applied in world pixels - wrong by the
     zoom factor, and wrong again at every wheel step. Weather belongs to the
     camera: this layer is the size of the pane, never scales, and its sky box is
     exactly the horizon the world scales about. */
  .pl-menu__weather {
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
    overflow: hidden;
  }
  /* Falling weather stops at the soil line. A curtain that spans the whole pane
     paints streaks across the dirt face, which reads as rain falling through the
     ground. The sky box is the pane's own horizon, so it is right at every zoom. */
  .pl-menu__weather > .pl-scene__fog,
  .pl-menu__weather > .pl-scene__rain,
  .pl-menu__weather > .pl-scene__snow {
    inset: 0 0 auto 0;
    height: var(--pl-horizon-base, 54vh);
  }
  /* The roots that reach the finds. One path per treasure, in the finds' own
     percentage space (title/rootGrowth.ts), revealed along its length. */
  .pl-menu__root-runs {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    /* The reaches are underground: a route that bows up past the band's top edge was
       painted over the soil line and across the hills, which is a root growing in the
       air. The layer is clipped to the band, and a reach now starts above the soil
       line so it leaves from behind the trunk's foot: the plant paints over this
       layer, so the stub is hidden and the root looks joined to the plate's crown
       rather than beginning a few pixels down in open dirt. */
    overflow: hidden;
    pointer-events: none;
  }
  /* The reach is a filled, tapered shape now, like the static plate, so it cannot
     be revealed by dashing a stroke. It opens from the crown instead: a circle
     clip centred where the root leaves the plant, which is also the direction the
     root actually grew. */
  .pl-menu__root-runs g {
    clip-path: circle(0% at 50% 0%);
  }
  /* The reach colour grade is a filter pass over the whole layer, and during a zoom
     that pass is repeated at every new scale. Dropped for the length of the gesture:
     the grade is a few per cent of warmth, invisible in motion, and back the moment
     the camera lands. Measured at a fixed zoom, mask+filter off took the worst frame
     of a zoom from 30 ms to 23 ms against 20 ms with the layer hidden. */
  .pl-menu__world.is-zooming .pl-menu__root-runs {
    filter: none;
  }
  .pl-menu__root-runs g.is-grown {
    clip-path: circle(140% at 50% 0%);
    transition: clip-path 1100ms cubic-bezier(0.35, 0.02, 0.3, 1);
  }
  @media (prefers-reduced-motion: reduce) {
    .pl-menu__root-runs g.is-grown { transition-duration: 1ms; }
  }
  /* The reaches are the plant's roots, so they take the plate's night grade - the same
     brightness, saturate, sepia and hue - and not a brightness of their own. Without it
     they were the only cream thing left on a dark title, glowing out of the soil at
     21:00; without the rest of it they miss the hour's warmth and read as a root of a
     different colour from the one under the trunk. */
  .pl-menu__root-runs {
    filter: brightness(var(--pl-roots-bright, 1))
      saturate(var(--pl-plant-sat, var(--pl-shoot-sat, 1)))
      sepia(var(--pl-plant-sepia, var(--pl-shoot-sepia, 0)))
      hue-rotate(var(--pl-plant-hue, var(--pl-shoot-hue, 0deg)));
  }
  /* Every colour below is the value the plate's own roots resolve, measured off the
     plate's own stops: the palette vars are written to the palette hosts, not to the
     plant element, so inside the plate the cream stop has always fallen back - the
     plate's roots are one cream, one tan and one ink all day, dimmed only
     by the filter. The reaches used the palette's live values and drifted from them:
     at 13:12 they were rgb(220, 200, 169) against the plate's rgb(239, 227, 205), and
     browner still after dark. Same three constants, same filter, same colour.

     The plate draws its ink at 0.3: any darker and a root reads as an outline with a
     fill in it rather than a thing lying in damp soil. */
  .pl-menu__root-runs .pl-root-run__ink { fill: #1c1208; opacity: 0.3; }
  /* The plate's roots darken with depth (the pl-root-depth mask in roots.ts): the same
     cheat here, a vertical ramp over the band, so a reach that dives is as deep a
     tan at the bottom as the plate's laterals and as pale as them at the top. Filled
     flat with the surface cream, the reaches read as pale wires laid over the dirt. */
  .pl-menu__root-runs .pl-root-run__body { fill: url(#pl-reach-fade-body); }
  /* Branches and their feeders, in the plate's own tip colour: the plate draws its
     forks (generation 2) in the root-tip colour, and a reach's smaller roots are
     the same thing. They used to be 0.14-wide stroke lines, which no fork on the
     plate looks like. */
  .pl-menu__root-runs .pl-root-run__lateral { fill: url(#pl-reach-fade-lateral); }
  /* Third order, at the plate's own weight: it draws its hairs as a 50%-opacity
     stroke, so a reach's feeders are paler than its forks too. At full strength they
     read as one bright brush of wires at the end of every root. */
  .pl-menu__root-runs .pl-root-run__hair { fill: url(#pl-reach-fade-hair); }
  /* The centreline as a stroke under the body, because a fill tapers to nothing in
     whatever width the pane happens to be: on a phone the tip came out at 0.7 px.
     Non-scaling, so 1.4 px however wide the pane is, and divided by the camera's
     zoom because that is an ancestor transform the SVG cannot see. Thinner than the
     body everywhere the body is wide, so it only shows where the root would fade. */
  .pl-menu__root-runs .pl-root-run__tip {
    fill: none;
    stroke: #efe3cd;
    stroke-width: calc(2px / var(--pl-scene-zoom, 1));
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }
  /* The branches get the same floor, as an outline in their own colour: 0.8 px on a
     filled shape is enough to keep a tip from disappearing and not enough to fatten
     it where it already has a body. */
  .pl-menu__root-runs .pl-root-run__lateral {
    stroke: #cbb99b;
    stroke-width: calc(1.2px / var(--pl-scene-zoom, 1));
    vector-effect: non-scaling-stroke;
  }
  .pl-menu__root-runs .pl-root-run__hair {
    stroke: #cbb99b;
    stroke-width: calc(1px / var(--pl-scene-zoom, 1));
    vector-effect: non-scaling-stroke;
  }
  /* Light over the world. Screen-blended sun glow, multiply-blended night, both
     driven by the palette so the lighting is the sky's, not a fixed overlay. */
  /* Air at the horizon: a pale band where the hills meet the sky. Without it the
     three ranges are cut-outs stacked on a line; with it the distance is air. */
  .pl-menu__haze {
    position: absolute;
    left: -12%;
    right: -12%;
    top: calc(var(--pl-horizon, 54%) - 14vh);
    height: 16vh;
    pointer-events: none;
    background: linear-gradient(
      180deg,
      transparent 0%,
      color-mix(in srgb, var(--pl-sky-low, #cda084) 55%, transparent) 58%,
      transparent 100%
    );
    opacity: 0.3;
  }
  /* Fireflies. They only come out when the scene is dark, and they wander: the one
     thing on the title screen that is pure atmosphere. */
  .pl-menu__fireflies {
    position: absolute;
    inset: 0;
    pointer-events: none;
    /* The only thing that used to share the hearth's variable. It was driven by the
       day's cloud-shadow strength, so the fireflies came out at noon and went in at
       midnight - backwards. They get their own, driven by the dark. */
    opacity: var(--pl-fireflies, 0);
    transition: opacity 1.6s ease;
  }
  .pl-menu__fireflies i {
    position: absolute;
    left: var(--x);
    top: var(--y);
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #ffe9a8;
    box-shadow: 0 0 9px 3px rgba(255, 214, 130, 0.42);
    animation: pl-firefly var(--dur, 7s) ease-in-out var(--d, 0s) infinite;
  }
  @keyframes pl-firefly {
    0%, 100% { transform: translate3d(0, 0, 0); opacity: 0.15; }
    30% { transform: translate3d(14px, -18px, 0); opacity: 0.85; }
    62% { transform: translate3d(-10px, -30px, 0); opacity: 0.5; }
    84% { transform: translate3d(6px, -12px, 0); opacity: 0.75; }
  }
  /* Cloud shadows: soft dark shapes drifting over the soil at cloud speed. */
  .pl-menu__cloudshadow {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    /* No blend mode. A full-screen multiply is a full-screen blend on every frame
       of a drag, and the shade is a soft black gradient already: over the soil it
       looks the same painted normally, for a fraction of the compositing. */
    opacity: var(--pl-cloud-shadow, 0);
  }
  .pl-menu__cloudshadow i {
    position: absolute;
    display: block;
    border-radius: 50%;
    background: radial-gradient(ellipse at 50% 50%, rgba(0, 0, 0, 0.5), transparent 70%);
    /* No filter. A gaussian over a full-screen shade is the most expensive thing a
       browser can be asked to do per frame, and the gradient is already soft: the
       blur was polishing an edge that is a 70% falloff. */
    height: 9vh;
    /* The crossing the clouds fly, not a drift of its own: same table, same times
       and same offsets, so the weather above and the shade below are one event.
       These used to ease 6% either way over three minutes while the clouds over
       them moved at a different pace, which is exactly what makes weather look
       painted on. */
    animation: pl-cloud-cross var(--pl-shadow-cross, 120s) linear infinite;
    animation-delay: var(--pl-shadow-delay, 0s);
  }
  /* Every layer the drag moves is promoted, or the drag costs the world: an
     unpromoted band that changes its transform dirties its parent's raster, and the
     parent here is the whole 200vw cut - sky, hills, soil, plate - which is re-drawn
     at the device pixel ratio on every frame of the drag. One left out (the haze)
     was enough to make dragging take seconds a frame. */
  .pl-menu__haze { will-change: transform; }


  /* -------------------------------------------------------------- stone layer
     Soil rests on rock. The band's top edge is irregular, because a level line
     between two materials reads as a painted stripe rather than a cut. */
  /* Parallax: the ground and everything standing on it move with a held drag, a
     little faster than the hills. Before this, the hills slid and the entire cut -
     soil, plant, props, finds - stood still, which made the scene two pictures
     stacked. Horizontal only: moving the soil line vertically would open a gap
     under the hill skirts instead of reading as depth. */
  /* A held drag slides the plant and the care bar; the scene writes their
     transforms inline. The ground planes stay put - see the registration. */

  /* Ground bleed: the cut is a band the width of the pane, and the parallax slides
     it. Holding a drag took the soil off the edge and the sky showed through the cut
     - the ground's sides were literally cut off. This is a flat copy of the same
     soil, wider than the stage and behind it, moving at the stage's own speed, so
     the cut has ground either side of it however far it is dragged. */
  .pl-menu__ground-bleed {
    position: absolute;
    /* Overscan for the drag clamp: the ground travels 0.9 x the pointer's travel,
       so the bleed has to be wider than the pane by more than that at the ends of
       a pull. It was 10% when the clamp was 90 px; both moved together. */
    left: -26%;
    right: -26%;
    top: var(--pl-horizon, 54%);
    bottom: 0;
    pointer-events: none;
    border-top: 7px solid var(--pl-soil-lip, var(--pl-soil-edge));
    /* The same ground as the stage, detail and all: a drag used to uncover a flat
       brown strip on either side of the layered cut. */
    background:
      linear-gradient(
        180deg,
        color-mix(in srgb, var(--pl-soil-lip, var(--pl-soil-edge)) 55%, transparent) 0,
        transparent 26px
      ),
      var(--pl-soil-detail),
      var(--pl-soil-face);
    box-shadow: inset 0 12px 26px rgba(0, 0, 0, 0.3);
  }

  /* A child of the stage, so it paints over the soil without any z-index: the
     stage is opaque, and a child is above its parent's background by definition.
     It used to be a world sibling that raised itself over the stage, which meant
     the reaches, the finds and the plant all had to be raised again above the
     rock. It also takes the stage's own parallax now instead of repeating it. */
  .pl-menu__bedrock {
    position: absolute;
    left: 0;
    right: 0;
    /* Just past the middle of the soil the player can see, measured from the
       stage's top (which is the soil line). In the world's units, not the screen's:
       the rock belongs to the cut, so pulling the camera back has to bring it up with
       the dirt instead of holding it at a fixed distance below the horizon. */
    top: calc((100vh - var(--pl-horizon-base, 54vh)) * 0.55);
    bottom: 0;
    /* The rock's own art, tiled. The pebbles used to sit at 12%, 88% and 20% of the
       element's width - and the element is wider than the world - so at every pane
       the stones fell outside the frame and the band read as more soil. Three
       pebble layers over a 240x130 tile repeat across the cut instead. */
    /* Stones at four scales, because one tile of three stones is a wallpaper:
       every 240px the cut showed the same pebble at the same angle, and on a wide
       pane the repeat was the first thing the eye found. The tile sizes are 240, 397
       and 631 - none divides another - and one layer is a pair of boulders large
       enough that a single one reads as the extent of the band. */
    background-image:
      /* A lit rind on the top of the rock, which is where it meets the soil. */
      linear-gradient(180deg, rgba(255, 255, 255, 0.12) 0 3px, transparent 3px),
      /* Boulders, one per 631x337 tile: a mass the eye can rest on between repeats. */
      radial-gradient(ellipse 46px 24px at 34% 58%, #6a5b45 0 96%, transparent 97%),
      radial-gradient(ellipse 30px 17px at 82% 30%, #635540 0 95%, transparent 96%),
      /* Pebbles, larger scale. */
      radial-gradient(ellipse 19px 11px at 18% 30%, #7b6c54 0 96%, transparent 97%),
      radial-gradient(ellipse 14px 9px at 61% 66%, #6d5e49 0 96%, transparent 97%),
      radial-gradient(ellipse 22px 12px at 86% 44%, #726349 0 96%, transparent 97%),
      radial-gradient(ellipse 12px 8px at 39% 82%, #665844 0 96%, transparent 97%),
      /* Pebbles, small scale: the gravel between the stones. */
      radial-gradient(ellipse 8px 5px at 27% 20%, #75664e 0 95%, transparent 96%),
      radial-gradient(ellipse 6px 4px at 72% 52%, #5f5140 0 95%, transparent 96%),
      radial-gradient(ellipse 7px 4px at 47% 74%, #6b5c46 0 95%, transparent 96%),
      radial-gradient(ellipse 5px 4px at 91% 78%, #594c3b 0 95%, transparent 96%),
      /* Bedding planes, tilted and at two spacings: rock splits in lines, and a
         single 24px rhythm is a ruled page. */
      repeating-linear-gradient(
        174deg,
        rgba(0, 0, 0, 0) 0 24px,
        rgba(0, 0, 0, 0.14) 24px 25px,
        rgba(255, 255, 255, 0.03) 25px 26px
      ),
      repeating-linear-gradient(
        169deg,
        rgba(0, 0, 0, 0) 0 57px,
        rgba(0, 0, 0, 0.1) 57px 58px,
        rgba(255, 255, 255, 0.022) 58px 59px
      ),
      linear-gradient(180deg, #6f6049 0%, #5c4f3c 42%, #473d2f 100%);
    background-size:
      100% 100%,
      631px 337px, 631px 337px,
      397px 211px, 397px 211px, 397px 211px, 397px 211px,
      240px 130px, 240px 130px, 240px 130px, 240px 130px,
      auto, auto, auto;
    background-repeat: no-repeat, repeat, repeat, repeat, repeat, repeat, repeat,
      repeat, repeat, repeat, repeat, repeat, repeat, no-repeat;
    /* A coarse torn edge, not a fine one: fourteen jittering points at this height
       read as a sawtooth. Seven reads as broken rock. */
    clip-path: polygon(
      0% 4%,
      14% 1.2%,
      30% 4%,
      46% 1.4%,
      62% 4%,
      78% 1.2%,
      100% 3%,
      100% 100%,
      0% 100%
    );
  }

  /* ---------------------------------------------------------------- soil life
     What is buried in the cut. The pieces belong to the ground, so they slide
     with it, and each one is a button: clicking a fossil should do something. */
  /* Moonlight on the ground: one wide, soft pool in front of the plant, at its own
     intensity from the moon's wash. Screen, not multiply: it is light added to the
     soil, and the soil under it should read as catching the sky. */
  .pl-menu__moon-pool {
    position: absolute;
    left: 50%;
    top: var(--pl-horizon, 140vh);
    width: 108vmin;
    height: 40vh;
    translate: -50% -35%;
    pointer-events: none;
    background: radial-gradient(
      50% 50% at 50% 50%,
      rgba(206, 224, 255, 0.34) 0%,
      rgba(176, 202, 255, 0.16) 42%,
      rgba(150, 180, 240, 0.06) 62%,
      transparent 80%
    );
    opacity: calc(var(--pl-moon-wash, 0) * 0.55);
    mix-blend-mode: screen;
  }
  /* The ground as one plane: moving it is a compositor blit, not four rasters.
     Pointer-transparent, because it covers the scene the drag listens on. */
  .pl-menu__ground-plane {
    position: absolute;
    inset: 0;
    pointer-events: none;
    will-change: transform;
  }

  .pl-menu__soil-life {
    position: absolute;
    /* The band is a piece of the world, so the finds sit at world positions: pull
       the camera back and they move in towards the tree and shrink with the soil they
       are buried in, push in and they spread out again. Pinning their places to the
       pane (so they kept a constant screen position) is what made them appear to
       drift away from the tree as the camera pulled back. */
    left: 50%;
    width: 100vw;
    margin-left: -50vw;
    top: var(--pl-world-horizon, 140vh);
    height: calc(100vh - var(--pl-horizon-base, 54vh));
    pointer-events: none;
    /* The finds bob and glow on their own timers, so they get their own layer too:
       otherwise every nudge repaints the world they sit in. */
    will-change: transform;
    /* No parallax of its own: the layer is in screen units, so a drag offset moved
       the finds against the soil they are buried in and slid the outer columns off
       the frame at the pulled-back limit. They hold their place with the pane. */
  }
  .pl-treasure {
    position: absolute;
    /* Three caps: its share of the band's width, the old vh ceiling, and a share
       of the band's own height. A piece is 104/120 as tall as it is wide and the
       rows are 24% of the band apart, so on a short pane the vh cap alone let a
       piece grow taller than its row and land on the piece below it. */
    /* World units, like the band and the reaches: the piece is the same size in the
       scene at every zoom, so the camera scales it. Nothing here has to know the
       zoom. */
    width: min(
      calc(var(--tw, 7.5) * 1%),
      10.8vh,
      calc((100vh - var(--pl-horizon-base, 54vh)) * 0.22)
    );
    padding: 0;
    border: 0;
    background: none;
    pointer-events: auto;
    cursor: pointer;
    transform: translateX(-50%) rotate(var(--tilt, 0deg));
    transform-origin: 50% 100%;
    /* One shadow, no colour filters. saturate/brightness are full filter passes
       over each piece, re-run whenever the hour's palette reaches them, and the
       same dimming is a flat opacity for nothing per frame. */
    filter: drop-shadow(0 3px 4px rgba(0, 0, 0, 0.45));
    opacity: 0.88;
    transition: transform 180ms ease, filter 180ms ease;
    opacity: 0.94;
  }
  .pl-treasure svg { display: block; width: 100%; height: auto; overflow: visible; }
  .pl-treasure:hover,
  .pl-treasure:focus-visible {
    transform: translateX(-50%) rotate(var(--tilt, 0deg)) scale(1.09);
    filter: drop-shadow(0 4px 7px rgba(0, 0, 0, 0.5));
    opacity: 1;
    outline: none;
  }
  /* Reached by the roots: the piece carries a little of the plant's own light. */
  .pl-treasure.is-reached {
    opacity: 1;
    filter: drop-shadow(0 3px 5px rgba(0, 0, 0, 0.45))
      drop-shadow(0 0 7px color-mix(in srgb, var(--pl-sun-core, #fff2c4) 45%, transparent));
  }
  @keyframes pl-treasure-bump {
    0% { transform: translateX(-50%) rotate(var(--tilt, 0deg)); }
    22% { transform: translateX(-50%) rotate(calc(var(--tilt, 0deg) - 6deg)) translateY(-4px) scale(1.06); }
    52% { transform: translateX(-50%) rotate(calc(var(--tilt, 0deg) + 5deg)) translateY(-1px) scale(1.03); }
    100% { transform: translateX(-50%) rotate(var(--tilt, 0deg)); }
  }
  .pl-treasure.is-bumped { animation: pl-treasure-bump 620ms ease; }
  .pl-treasure.is-wiggle .pl-treasure__worm { animation: pl-worm-wiggle 900ms ease; }
  @keyframes pl-worm-wiggle {
    0%, 100% { transform: translateY(0) rotate(0deg); }
    25% { transform: translateY(-5px) rotate(-4deg); }
    60% { transform: translateY(1px) rotate(4deg); }
  }
  /* The chest is the one find with something inside it, so it is drawn larger than
     its row-mates: at the shared width the heap behind the lid had nowhere to be. */
  .pl-treasure[data-treasure='chest'] {
    /* The chest is drawn larger than its row-mates because it has contents; its
       caps are the same world ones as every other piece. */
    width: min(
      calc(var(--tw, 9.2) * 1%),
      12.4vh,
      calc((100vh - var(--pl-horizon-base, 54vh)) * 0.25)
    );
  }
  /* The lid lifts off the rim and tips back, and stays there. The old one tipped
     38 degrees and dropped back in one move, which read as a clapperboard
     snapping shut rather than a chest being opened. */
  .pl-treasure.is-open .pl-treasure__lid {
    transform-box: fill-box;
    transform-origin: 50% 100%;
    /* The end state is also the resting state: the open chest must not depend on
       the animation having run (see the reduced-motion rule below). */
    transform: translateY(-27px) rotate(-13deg);
    animation: pl-chest-open 620ms cubic-bezier(0.3, 0.9, 0.3, 1) forwards;
  }
  @keyframes pl-chest-open {
    0% { transform: translateY(0) rotate(0deg); }
    55% { transform: translateY(-31px) rotate(-17deg); }
    100% { transform: translateY(-27px) rotate(-13deg); }
  }
  /* What was inside rises out of the box once the lid has cleared it: the opening
     has a payoff, not just a lid that moved over an empty chest. */
  .pl-treasure__riches {
    opacity: 0;
    transform-box: fill-box;
    transform-origin: 50% 100%;
  }
  .pl-treasure.is-open .pl-treasure__riches {
    opacity: 1;
    animation: pl-riches-rise 640ms 200ms ease-out forwards;
  }
  /* The mouth of the chest belongs to the open state, like the riches. It is drawn
     before the lid, so with the lid shut it showed through the gap between the
     lid's rim and the body and read as a strip of soil inside the chest. */
  .pl-treasure__throat { opacity: 0; transition: opacity 240ms ease; }
  .pl-treasure.is-open .pl-treasure__throat { opacity: 1; }
  /* The lid comes back down after its beat. The shut position is a plain
     transform on the element, so removing .is-open eases it home instead of
     snapping - the old rule only existed while the class was there, which is why
     the chest opened once and stayed open. */
  .pl-treasure__lid {
    transform-box: fill-box;
    transform-origin: 50% 100%;
    transition: transform 620ms cubic-bezier(0.4, 0, 0.5, 1);
  }
  .pl-treasure__riches { transition: opacity 280ms ease; }
  @keyframes pl-riches-rise {
    0% { opacity: 0; transform: translateY(8px) scaleY(0.86); }
    55% { opacity: 1; }
    100% { opacity: 1; transform: translateY(0) scaleY(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    /* A chest still opens, it just does not swing: the state cannot live in the
       animation, or a reader who asked for less motion gets an empty box. */
    .pl-treasure.is-open .pl-treasure__lid {
      animation: none;
      transform: translateY(-27px) rotate(-13deg);
    }
    .pl-treasure.is-open .pl-treasure__riches {
      animation: none;
      opacity: 1;
      transform: none;
    }
  }
  .pl-treasure.is-open .pl-treasure__gold circle { animation: pl-gold-shine 900ms 420ms ease; }
  @keyframes pl-gold-shine {
    0%, 100% { filter: brightness(1); }
    40% { filter: brightness(1.7) drop-shadow(0 0 6px #ffd870); }
  }
  .pl-treasure.is-sparkle .pl-treasure__ore,
  .pl-treasure.is-sparkle .pl-treasure__fossil,
  .pl-treasure.is-sparkle .pl-treasure__crystal,
  .pl-treasure.is-sparkle .pl-treasure__skeleton {
    animation: pl-treasure-sparkle 900ms ease;
  }
  @keyframes pl-treasure-sparkle {
    0%, 100% { filter: brightness(1); }
    35% { filter: brightness(1.6) drop-shadow(0 0 8px rgba(255, 236, 170, 0.85)); }
  }
  .pl-menu__soil-caption {
    position: absolute;
    left: 50%;
    bottom: 4%;
    /* Above the light passes and the vignette it now shares a layer with, so the
       one line that explains what just happened is never dimmed by the hour. */
    z-index: 6;
    transform: translate(-50%, 8px);
    padding: 5px 12px;
    border: 1px solid var(--hud-border-muted, rgba(50, 58, 40, 0.5));
    border-radius: 999px;
    background: rgba(10, 14, 8, 0.86);
    color: var(--warm-ink, #f0ead6);
    font-size: var(--hud-font-xs, 0.66rem);
    letter-spacing: 0.02em;
    opacity: 0;
    pointer-events: none;
    transition: opacity 200ms ease, transform 200ms ease;
    white-space: nowrap;
  }
  .pl-menu__soil-caption.is-visible { opacity: 1; transform: translate(-50%, 0); }

  /* ------------------------------------------------------------------- care
     A watering can and a bag of feed, standing in the scene next to the plant.
     Both are once-a-day props: a plant that can be fed forever is a button. */
  .pl-menu__care {
    position: absolute;
    left: calc(50% - 26vmin);
    /* Standing on the soil, not half-sunk into it: the bar's bottom edge is the soil
       line (measured from the world's own horizon, whatever the box is now sized
       to), so the props rest on the ground and their caps show against the sky. */
    bottom: calc(100% - var(--pl-horizon, 140vh));
    z-index: 3;
    display: flex;
    align-items: flex-end;
    gap: 0.6vmin;
    pointer-events: none;
  }
  .pl-care {
    /* No caption: the can and the sack are drawings in the meadow, the way the
       barrel and the chest are. The label said what the picture already did, and
       two uppercase words floating over the soil art read as a toolbar. */
    display: block;
    width: 9.5vmin;
    padding: 0;
    border: 0;
    background: none;
    pointer-events: auto;
    cursor: pointer;
    color: color-mix(in srgb, var(--warm-ink, #f0ead6) 74%, transparent);
    transition: transform 160ms ease, color 160ms ease, opacity 200ms ease;
  }
  .pl-care svg {
    width: 100%;
    height: auto;
    display: block;
    filter: drop-shadow(0 3px 4px rgba(0, 0, 0, 0.5));
  }
  .pl-care:hover { transform: translateY(-3px) scale(1.05); color: var(--warm-ink, #f0ead6); }
  /* Dragging a prop: the button stays home and a carried copy follows the pointer,
     so putting it back is literally putting it down where it came from. */
  .pl-care.is-carried { opacity: 0.32; }
  /* The carried prop bobs and tilts, which is what makes it read as held rather
     than as a picture of a prop that happens to be under the pointer. */
  @keyframes pl-carry-bob {
    0%, 100% { transform: translate(-50%, -78%) rotate(-3deg); }
    50% { transform: translate(-50%, -84%) rotate(3deg); }
  }
  .pl-care-ghost {
    animation: pl-carry-bob 1.2s ease-in-out infinite;
    position: fixed;
    left: 0;
    top: 0;
    z-index: 900;
    width: 72px;
    pointer-events: none;
    transform: translate(-50%, -78%);
    filter: drop-shadow(0 8px 12px rgba(0, 0, 0, 0.5));
    opacity: 0.95;
    /* The clone keeps its pl-care class, so these only have to undo the
       button's own box: without them the carried prop was a white rectangle
       with a can in it. */
    background: none;
    border: 0;
    padding: 0;
    /* A focus ring or a glow on the button would be carried along with the clone,
       and a ring around a 72 px transparent box reads as a white box. */
    box-shadow: none;
    outline: none;
    border-radius: 0;
  }
  .pl-care-ghost svg { width: 100%; height: auto; display: block; }
  .pl-care-ghost span { display: none; }
  .pl-menu__world.is-carrying { cursor: grabbing; }

  /* Carried over the plant: the plant is where the prop goes, and it says so by
     coming up a little. */
  .pl-title-plant.is-carry-target .pl-title-plant__shoot {
    filter: brightness(calc(var(--pl-plant-dim, 1) * 1.22)) saturate(1.12);
  }
  .pl-title-plant.is-carry-target .pl-title-plant__roots { opacity: 1; }

  /* What a prop leaves behind. Water falls as droplets and rings off the soil;
     feed scatters as specks of meal. The two actions also pulse the plant
     differently, so watering and feeding are not the same event twice. */
  .pl-menu__fx {
    position: absolute;
    inset: 0;
    /* Screen space: the prop effects are measured with getBoundingClientRect and
       written back as left/top, so the layer must not be scaled. */
    z-index: 2;
    pointer-events: none;
    overflow: hidden;
  }
  /* A pour is a stream, not a burst. Every droplet leaves the spout on its own
     beat and follows its own arc - sideways at a constant speed, downward on an
     eased curve - and the two transforms together are a parabola, which is what
     water leaving a can actually does. Each droplet is a wrapper (the sideways
     half) around a drop (the fall), because one element cannot animate two
     different easings on one axis pair. */
  .pl-fx__arc {
    position: absolute;
    left: 0;
    top: 0;
    width: 0;
    height: 0;
    animation: pl-fx-arc-x var(--pl-arc-dur, 520ms) linear var(--pl-arc-delay, 0ms) forwards;
  }
  @keyframes pl-fx-arc-x {
    0% { translate: 0 0; }
    100% { translate: var(--pl-arc-dx, 0px) 0; }
  }
  .pl-fx__drop {
    position: absolute;
    left: 0;
    top: 0;
    display: block;
    animation: pl-fx-arc-y var(--pl-arc-dur, 520ms) cubic-bezier(0.42, 0.02, 0.86, 0.52)
      var(--pl-arc-delay, 0ms) forwards;
  }
  @keyframes pl-fx-arc-y {
    0% { translate: 0 0; rotate: 0deg; opacity: 0; }
    8% { opacity: 1; }
    /* Stay lit all the way down. The old 88% was the whole of the "drops vanish
       before they land" bug: on a fall from a normal height the last eighth is a
       fifth of a second in mid-air, so the water was gone before the soil was. */
    97% { opacity: 1; }
    100% { translate: 0 var(--pl-arc-dy, 60px); rotate: var(--pl-arc-spin, 0deg); opacity: 0; }
  }
  .pl-fx__drop--water {
    width: 2px;
    height: 4px;
    border-radius: 50% 50% 50% 50% / 62% 62% 38% 38%;
    background: #e4f6ff;
    box-shadow: 0 0 3px rgba(150, 214, 255, 0.45);
  }
  /* The tail: water in the air is a head with a streak behind it, not a bead. The
     tail points back up the path, so a pour reads as falling water in the same
     language as the rain outside. */
  .pl-fx__drop--water::after {
    content: '';
    position: absolute;
    left: 0.5px;
    bottom: 2px;
    width: 1px;
    height: 7px;
    border-radius: 1px;
    background: linear-gradient(
      0deg,
      color-mix(in srgb, var(--pl-rain-colour, #d6e6ef) 85%, transparent),
      transparent
    );
  }
  .pl-fx__drop--feed {
    width: 4px;
    height: 4px;
    border-radius: 1px;
    background: #c9a25a;
    box-shadow: 0 0 3px rgba(0, 0, 0, 0.22);
  }
  /* The splash. An ellipse, because this is a flat side-view world and a circle
     on the ground line is a hoop standing on edge: it read as a ring drawn on the
     soil face, and - being round - it reached below the surface into the dirt
     cross-section, which is a cut through the earth, not a floor. The ellipse is
     pinned to the surface line at its foot and grows upward from there, so no
     part of a splash is ever drawn under the ground. */
  .pl-fx__ripple {
    position: absolute;
    width: var(--pl-ripple-w, 22px);
    height: calc(var(--pl-ripple-w, 22px) * 0.26);
    margin-left: calc(var(--pl-ripple-w, 22px) / -2);
    border: 1.6px solid color-mix(in srgb, var(--pl-rain-colour, #d6e6ef) 86%, transparent);
    /* The near edge is solid and the far edge catches the light: a tight ring and
       a thrown one in one stroke, like the rain's own landings. */
    border-top-color: transparent;
    border-radius: 50%;
    box-shadow: 0 0 5px 1px color-mix(in srgb, var(--pl-rain-colour, #d6e6ef) 20%, transparent);
    transform-origin: 50% 100%;
    opacity: 0;
    animation: pl-fx-ripple 640ms ease-out var(--pl-ripple-delay, 0ms) forwards;
  }
  @keyframes pl-fx-ripple {
    0% { transform: scale(0.25, 0.4); opacity: 0; }
    16% { opacity: 0.95; }
    100% { transform: scale(1.4, 1); opacity: 0; }
  }
  /* The splash itself: water thrown out of the landing and falling back. A single
     vertical column read as a pin standing on the soil - a splash is a handful of
     drops leaving the point at an angle, hopping, and dropping out of sight. */
  .pl-fx__spit {
    position: absolute;
    width: 2px;
    height: 3px;
    margin-left: -1px;
    border-radius: 50%;
    background: #bfe6fb;
    box-shadow: 0 0 4px rgba(150, 214, 255, 0.55);
    opacity: 0;
    animation: pl-fx-spit 470ms cubic-bezier(0.25, 0.6, 0.5, 1) var(--pl-spit-delay, 0ms) forwards;
  }
  .pl-fx__spit--meal {
    background: #c9a25a;
    box-shadow: 0 1px 0 rgba(58, 42, 21, 0.5);
    width: 3px;
    height: 3px;
    border-radius: 1px;
  }
  @keyframes pl-fx-spit {
    0% { transform: translate(0, 0) scale(0.5); opacity: 0; }
    14% { opacity: 0.95; }
    46% {
      transform: translate(calc(var(--pl-spit-dx, 0px) * 0.55), calc(var(--pl-spit-rise, 11px) * -1)) scale(1);
      opacity: 0.95;
    }
    100% { transform: translate(var(--pl-spit-dx, 0px), -1px) scale(0.8); opacity: 0; }
  }
  /* Wet soil: water that has just landed darkens the ground and dries off. It is
     the only mark that stays after the splash, and it is what makes the pour feel
     like it went into the soil rather than onto a screen. */
  .pl-fx__wet {
    position: absolute;
    width: var(--pl-wet-w, 34px);
    /* Taller than a puddle, because this is a cross-section: water that lands on
       the surface soaks down into the soil, and an 8 px cap at the surface line
       was a stain on the grass that never entered the earth. */
    height: 22px;
    margin-left: calc(var(--pl-wet-w, 34px) / -2);
    border-radius: 50% 50% 46% 46% / 34% 34% 66% 66%;
    /* Damp soil, with a cool sheen along its top edge: water reflects the sky
       even at night, and a stain alone is invisible on soil this dark. The dark
       is strongest just under the surface and fades with depth. */
    background:
      linear-gradient(180deg, rgba(206, 232, 255, 0.24) 0%, rgba(206, 232, 255, 0) 42%),
      radial-gradient(
        ellipse at 50% 16%,
        rgba(20, 12, 6, 0.5) 0%,
        rgba(20, 12, 6, 0.36) 46%,
        transparent 80%
      );
    /* Grows downward from the surface line: the wet front moving into the soil
       rather than a puddle spreading on top of it. */
    transform-origin: 50% 0;
    opacity: 0;
    animation: pl-fx-wet 3800ms ease-out var(--pl-wet-delay, 0ms) forwards;
  }
  @keyframes pl-fx-wet {
    0% { transform: scale(0.55, 0.14); opacity: 0; }
    9% { opacity: 0.95; }
    30% { transform: scale(1, 1); opacity: 1; }
    62% { opacity: 0.82; }
    100% { transform: scale(1.04, 1); opacity: 0; }
  }
  /* Meal: a speck that lands and lies there for a moment before the soil takes it.
     Feeding leaves crumbs, not water - no ring, no spray. */
  .pl-fx__meal {
    position: absolute;
    width: 3px;
    height: 3px;
    border-radius: 1px;
    background: #c9a25a;
    box-shadow: 0 1px 0 rgba(58, 42, 21, 0.45);
    transform-origin: 50% 100%;
    opacity: 0;
    /* Meal lies on the soil until the ground takes it. 1.5 s was one beat too
       few to see it land: a handful of crumbs that is gone before the eye has
       followed the pour reads as the feed vanishing, not as being eaten. */
    animation: pl-fx-meal 3200ms ease-out var(--pl-meal-delay, 0ms) forwards;
  }
  @keyframes pl-fx-meal {
    0% { opacity: 0; transform: scale(0.4); }
    5% { opacity: 1; transform: scale(1); }
    78% { opacity: 1; }
    100% { opacity: 0; }
  }
  /* Water: the leaves lift and brighten. Feed: the whole plant swells for a beat.
     Different curves, so the two props read as different actions. */
  .pl-title-plant.is-watered .pl-title-plant__shoot { animation: pl-water-lift 900ms ease-out; }
  @keyframes pl-water-lift {
    0% { filter: brightness(var(--pl-plant-dim, 1)) saturate(var(--pl-plant-sat, 1)); }
    30% {
      filter: brightness(calc(var(--pl-plant-dim, 1) * 1.18)) saturate(1.2)
        hue-rotate(-3deg);
    }
    100% { filter: brightness(var(--pl-plant-dim, 1)) saturate(var(--pl-plant-sat, 1)); }
  }
  .pl-title-plant.is-fed .pl-title-plant__shoot { animation: pl-feed-swell 720ms ease-out; }
  @keyframes pl-feed-swell {
    0% { transform: scale(var(--pl-care-scale, 1)); }
    35% { transform: scale(calc(var(--pl-care-scale, 1) * 1.07)); }
    100% { transform: scale(var(--pl-care-scale, 1)); }
  }
  .pl-care.is-pouring svg { animation: pl-care-tip 900ms ease; }
  /* The pour is drawn only while the can is tipped; the prop itself keeps no water. */
  .pl-care__pour { opacity: 0; }
  .pl-care.is-pouring .pl-care__pour { animation: pl-care-pour 900ms linear; }
  @keyframes pl-care-pour {
    0%, 18% { opacity: 0; }
    34%, 72% { opacity: 1; }
    100% { opacity: 0; }
  }
  @keyframes pl-care-tip {
    0%, 100% { transform: rotate(0deg); }
    30% { transform: rotate(-22deg); }
    60% { transform: rotate(6deg); }
  }
  /* Vignette: pulls the eye to the middle and makes the frame feel photographed.
     Warm rather than black at the corners: a cold vignette on a meadow read as
     dusk even at noon. */
  .pl-menu__vignette {
    position: absolute;
    inset: 0;
    z-index: 4;
    pointer-events: none;
    background: radial-gradient(
      ellipse 78% 72% at 50% 46%,
      transparent 42%,
      rgba(38, 24, 12, 0.3) 78%,
      rgba(22, 14, 8, 0.5) 100%
    );
    opacity: var(--pl-vignette, 0.7);
  }
  @media (prefers-reduced-motion: reduce) {
    .pl-menu__cloudshadow i { animation: none; }
  }
  /* Warmth where the plant stands: a low, wide glow lying on the soil around the
     stem. Not light from the sky - the sun's wash does that - but the near, warm
     pool that makes a place feel sat in, and the reason the ground no longer
     reads as a flat brown band under a nice sky. */
  .pl-menu__cozy {
    position: absolute;
    inset: 0;
    z-index: 1;
    pointer-events: none;
    background: radial-gradient(
      ellipse 46% 26% at 50% calc(var(--pl-horizon, 54%) + 4%),
      color-mix(in srgb, var(--pl-sun-core, #fff2c4) 26%, transparent) 0%,
      color-mix(in srgb, var(--pl-sun-core, #fff2c4) 9%, transparent) 46%,
      transparent 76%
    );
    mix-blend-mode: normal;
    opacity: var(--pl-cozy, 0.85);
  }
  /* Pollen: a few motes of warm light lifting off the meadow. Small, slow and
     dim enough to be noticed only after a moment. */
  .pl-menu__motes {
    position: absolute;
    inset: 0;
    z-index: 3;
    pointer-events: none;
    overflow: hidden;
  }
  .pl-menu__motes i {
    position: absolute;
    display: block;
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--pl-sun-core, #fff2c4) 78%, white);
    box-shadow: 0 0 6px 1px color-mix(in srgb, var(--pl-sun-core, #fff2c4) 40%, transparent);
    opacity: 0;
    animation: pl-mote-rise linear infinite;
  }
  @keyframes pl-mote-rise {
    0% { opacity: 0; transform: translate3d(0, 0, 0); }
    12% { opacity: var(--pl-mote-alpha, 0.7); }
    70% { opacity: var(--pl-mote-alpha, 0.7); }
    100% { opacity: 0; transform: translate3d(var(--pl-mote-drift, 18px), -46vh, 0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .pl-menu__motes i { animation: none; opacity: 0; }
  }
  .pl-menu__wash {
    position: absolute;
    inset: 0;
    z-index: 3;
    pointer-events: none;
  }
  /* A halo around the disc, not a wash of colour over the pane: the gradient used
     to reach two thirds of the way across the screen at 0.85 alpha, which is what
     read as the title flashing yellow. */
  /* The halo is moved by a translate, not by sliding the centre of its own
     gradient. A gradient whose centre follows the sun is re-rasterised over the
     whole pane every time the sun steps, which is the freeze that arrived about
     once a second; a translated layer is moved by the compositor and nothing is
     repainted. Hence the overscan: the layer is twice the pane, so the halo can
     stand anywhere over it without its edges entering the frame. */
  .pl-menu__wash--sun {
    /* The halo is its own small layer, centred on the pane and moved by a
       translate. Sized to the gradient (88vmax, twice the 44vmax radius) rather
       than to the pane, so what the compositor keeps pre-drawn is half a megapixel
       instead of the whole frame. Anything hanging outside the viewport is clipped
       by it, so no overscan is needed. */
    inset: auto;
    left: 50%;
    top: 50%;
    /* 30vmax, not 88: the gradient reaches transparent at 72% of its 20vmax
       radius, so 62vmax is exactly the halo's visible extent. The box used to be
       twice that, and two of these are translucent layers the compositor blends
       every frame - on a large window that is millions of pixels a frame for glow
       that is not there. */
    /* A halo that hugs the disc, not a veil over the pane. At 62vmax it reached
       past the canopy and screened a white fuzz over the tree at every hour, rain
       or no rain: the glow in front of the leaves was the sun, and the only place a
       glow belongs is behind them. What is left is close enough to the disc to sit
       in the sky around it, and weaker, so the crown in front stays its own colour. */
    width: 30vmax;
    height: 30vmax;
    will-change: transform;
    /* Carried between the disc's four samples a second by the compositor, so the
       halo glides with the body it belongs to instead of stepping. */
    transition: transform 300ms linear;
    transform: translate(-50%, -50%) translate3d(var(--pl-sun-dx, 0px), var(--pl-sun-dy, 0px), 0);
    background: radial-gradient(
      circle 20vmax at 50% 50%,
      rgba(255, 232, 176, 0.5) 0%,
      rgba(255, 198, 128, 0.2) 30%,
      rgba(255, 186, 120, 0.06) 52%,
      transparent 72%
    );
    opacity: calc(var(--pl-sun-wash, 0.5) * 0.6);
    mix-blend-mode: screen;
  }
  /* No second moon. This layer was a 34vmax screen-blended circle of moonlight
     around the body, and it was the halo the eye found around the trunk: a disc of
     light with a visible edge, drawn over the canopy, at 0.79 opacity under a full
     moon. The moon's air is the disc's own halo (.pl-scene__moon::before), which
     is tight to the limb and now spreads with fog; a second, larger circle is the
     same light sampled twice with a ring for an edge. */
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
    /* Overscan, like the ground bleed behind it: the stage pans 0.9x the pointer,
       and at the pulled-back zoom that was enough to drag its right edge - the end
       of the grass lip and the soil detail - into the middle of the frame. */
    left: -26%;
    right: -26%;
    top: var(--pl-horizon, 54%);
    bottom: 0;
    pointer-events: none;
    /* Dirt: the soil ramp and the cut's own detail (pebbles, clumps, bedding
       planes), which the refresh bleed paints as well. The lip is the lit turf on
       top: a solid edge with a soft band of the same light under it, so the ground
       reads as a surface catching the sky rather than a one-pixel seam. */
    background:
      linear-gradient(
        180deg,
        color-mix(in srgb, var(--pl-soil-lip, var(--pl-soil-edge)) 55%, transparent) 0,
        transparent 26px
      ),
      var(--pl-soil-detail),
      var(--pl-soil-face);
    border-top: 7px solid var(--pl-soil-lip, var(--pl-soil-edge));
    box-shadow: inset 0 12px 26px rgba(0, 0, 0, 0.3);
  }
  /* The wet grade sits in the stage now, so it spans the whole cut instead of
     starting again at the horizon inside a layer the stage covers. */
  .pl-menu__stage > .pl-scene__wet {
    top: 0;
    bottom: 0;
  }
  /* Soil settling around the stem: the cut face darkens where the plant enters it,
     which is what makes the stem look buried rather than stuck on. */
  /* No shadow falls on the soil. The stage is a cut slice of earth seen from the
     side, not a ground plane, so there is no surface for a shadow to land on: an
     ellipse at the stem only ever read as a smudge floating in the dirt. Depth is
     carried by the soil's own layers and by the roots fading as they go down. */

  /* The plant is a thing in the world: centred, feet on the horizon line, and it
     pans with the world. It used to carry a bare translate3d of the drag, and this
     rule - which places it - came later and replaced it, so the ground slid under a
     tree that stayed exactly where it was. One transform, both jobs. */
  /* The plant is the one thing in the world that moves every frame (it sways at
     thirty hertz). Promoted, its sway repaints its own small layer; unpromoted it
     repaints the whole world with it - sky, hills, soil and plate - thirty times a
     second, which is what the frame slips were. */
  .pl-menu__world > .pl-title-plant {
    will-change: transform;
    position: absolute;
    left: 50%;
    top: var(--pl-horizon, 54%);
    /* The drag offset is appended to this by the scene, inline. */
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
  /* Hidden has to mean gone. The controls set pointer-events: auto for the
     drag-through rule below, and a child that opts back in ignores the layer's own
     none - so with only opacity changed, the Play button was invisible and still
     took a click and started the game. Visibility is the second half: it takes the
     controls out of the tab order as well, after the fade. */
  .pl-menu.is-ui-hidden .pl-menu__btn,
  .pl-menu.is-ui-hidden .pl-menu__input,
  .pl-menu.is-ui-hidden .pl-menu__profile,
  .pl-menu.is-ui-hidden .pl-menu__actions,
  .pl-menu.is-ui-hidden .pl-menu__identity,
  .pl-menu.is-ui-hidden .pl-menu__topbar {
    pointer-events: none;
    visibility: hidden;
    transition: opacity 240ms ease, visibility 0s linear 240ms;
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
    /* The gradient is the glow. An 18px blur on top of it re-filtered a
       560x96 box every time the hour changed, for no visible gain. */
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
    background: rgba(6, 9, 6, 0.68);
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
    /* A heavily zoomed browser reports a short pane, and the popover then has to
       scroll inside itself rather than run off the bottom of the window. */
    max-height: calc(100vh - 92px);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .pl-menu__popover[hidden] { display: none; }
  /* The one line of small print in the popover used the menu's foot-note class,
     which is absolutely positioned at the bottom of the screen. Inside a
     positioned popover that pinned it to the popover's own bottom edge, where it
     sat behind the Create account button. It is a caption now: in flow, under the
     avatar, and it keeps its own class so the foot line and this cannot drift. */
  .pl-menu__popover-note {
    margin: 0;
    font-size: 0.72rem;
    line-height: 1.4;
    text-align: center;
    color: var(--ink-dim, #9a937a);
  }
  .pl-menu__popover-name { font-size: 0.95rem; font-weight: 600; text-align: center; }
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
  private readonly vignette: HTMLElement;
  /**
   * The camera's own layer: everything that belongs to the view rather than to the
   * place. Created on first use, after the world, so it stacks above it.
   */
  private screenEl: HTMLDivElement | null = null;
  private screenLayerEl(): HTMLDivElement {
    if (!this.screenEl) {
      const el = document.createElement('div');
      el.className = 'pl-menu__screen';
      this.root.appendChild(el);
      this.screenEl = el;
    }
    return this.screenEl;
  }
  private readonly sunWash: HTMLElement;
  /** Which half of the crown the moon last lit. Kept across ticks for hysteresis. */
  private moonSideShown: 'left' | 'right' = 'left';
  private readonly nightWash: HTMLElement;
  /** The backdrop behind the world: its own layer, so the palette paints it alone. */
  private readonly backdrop: HTMLDivElement;
  private readonly world: HTMLDivElement;
  private readonly stage: HTMLDivElement;
  /**
   * The layers that paint with the palette, one element each.
   *
   * A palette step used to write its ~30 properties on `.pl-menu`, and because a
   * custom property reaches every descendant the browser invalidated - and
   * repainted - the whole title: 150-250 ms of paint per step, measured. Written on
   * the layers themselves, a sky step invalidates the layers whose own values moved
   * (the sky band, the hills, the backdrop) and the cut face only when the ground's
   * coarser clock says the soil actually changed.
   *
   * The rule for this list: an element that *paints* a palette colour goes in it; a
   * wrapper that only passes one on does not, or its whole subtree comes back into
   * the invalidation. Resolved per write, because several layers are created after
   * the first tick and the screen layer is created on first use.
   */
  private paletteHosts(): HTMLElement[] {
    const hosts: HTMLElement[] = [this.backdrop];
    for (const child of Array.from(this.world.children)) {
      // The plant is graded by its own writer (`plantVars`) on the ground's clock;
      // handed the palette vars too, every sky step recalculated its nine hundred
      // nodes for values it does not read.
      if (child instanceof HTMLElement && child !== this.plant?.element) hosts.push(child);
    }
    for (const selector of ['.pl-menu__weather', '.pl-menu__screen', '.pl-menu__ui']) {
      const el = this.root.querySelector<HTMLElement>(`:scope > ${selector}`);
      if (el) hosts.push(el);
    }
    return hosts;
  }
  private skyTimer = 0;
  private skySyncTimer = 0;
  /** The clock tick and the world-time poll, kept so the timers can be paused. */
  private skyTick: (() => void) | null = null;
  private skySync: (() => Promise<void>) | null = null;
  /** The bodies' own timer, separate from the palette's slow tick. */
  private paintOrbs: (() => void) | null = null;
  private stopOrbs: (() => void) | null = null;
  private orbTimer = 0;
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

    // Behind everything. The palette colours it, so it is a layer of its own: on
    // the menu itself those properties reached every descendant and a sky step
    // repainted the whole title.
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'pl-menu__backdrop';
    this.backdrop.setAttribute('aria-hidden', 'true');
    this.root.appendChild(this.backdrop);

    // The world layer holds the painting. The palette variables are no longer
    // written here either - see `paletteHosts`.
    this.world = document.createElement('div');
    this.world.className = 'pl-menu__world';
    this.root.appendChild(this.world);

    // Weather belongs to the camera, not to the place. This layer is the size of
    // the pane and never scales, so rain keeps its width at every zoom and stops
    // on the horizon line the world scales about.
    const weather = document.createElement('div');
    weather.className = 'pl-menu__weather';
    weather.setAttribute('aria-hidden', 'true');
    this.root.appendChild(weather);

    // The interface layer is created before the scene so the scene's hint can
    // mount above the world instead of underneath the foreground.
    const ui = document.createElement('div');
    ui.className = 'pl-menu__ui';

    // The ground exists before the scene does, because the scene mounts its wet
    // grade into it: the grade has to paint over the soil, and the soil is a layer
    // above the scene. It is appended below, in world order, once the sky is in.
    this.stage = document.createElement('div');
    this.stage.className = 'pl-menu__stage';

    this.scene = createTitleScene({
      varsTarget: this.root,
      varsTargets: () => this.paletteHosts(),
      hintHost: ui,
      weatherHost: weather,
      wetHost: this.stage,
      zoomHost: this.world,
      parallax: {
        enabled: options.ui.titleParallaxEnabled,
        dragPx: options.ui.titleParallaxDragPx,
        hover: options.ui.titleParallaxHover,
      },
      homeZoom: options.ui.titleHomeZoom,
      depth: options.ui.titleParallaxDepth,
      settleMs: options.ui.titleParallaxSettleMs,
      reducedMotion: options.ui.reducedMotion,
      hintFadeMs: options.ui.titleHintFadeMs,
      onToggleUi: () => this.toggleUi(),
    });
    this.scene.element.classList.add('pl-menu__scene');
    this.world.appendChild(this.scene.element);

    // The scene is a place, not a backdrop: air where the hills meet the sky, a
    // hedge of blades closing the bottom of the frame, and fireflies that only
    // come out when it is dark.
    const haze = document.createElement('div');
    haze.className = 'pl-menu__haze';
    haze.setAttribute('aria-hidden', 'true');
    this.world.appendChild(haze);

    // No verge. There was a hedge of sixty-five blades standing along the soil
    // line, which is exactly the grass that was asked to go: a strip of spikes in
    // front of a landscape that is meant to be soil and sky.

    const fireflies = document.createElement('div');
    fireflies.className = 'pl-menu__fireflies';
    fireflies.setAttribute('aria-hidden', 'true');
    fireflies.innerHTML = Array.from(
      { length: 9 },
      (_, i) =>
        `<i style="--x:${6 + i * 11}%;--y:${28 + (i % 5) * 13}%;--d:${(i % 4) * 0.9}s;--dur:${6 + (i % 3) * 2}s"></i>`,
    ).join('');
    this.screenLayerEl().appendChild(fireflies);

    // The ground, as one plane.
    //
    // The cut, its bleed, the moonlight on it, the finds buried in it and the
    // reaches drawn to them all move together with a held drag, so they are moved
    // by one transform on one element rather than one each. Measured: writing the
    // stage's own transform every frame ran at 4-12 fps (the bleed at 13, the
    // finds at 43); moving this wrapper - one promoted layer holding all four -
    // ran at 41 fps in the same run. A full-pane gradient stack is re-rastered on
    // every move of its own; a whole ground layer is blitted.
    const groundPlane = document.createElement('div');
    groundPlane.className = 'pl-menu__ground-plane';
    // Not aria-hidden: the finds in this plane are buttons.
    this.world.appendChild(groundPlane);

    // Wider than the stage, behind it, moving with it: the ground's sides never
    // come off the edge of the scene when the parallax is dragged.
    const groundBleed = document.createElement('div');
    groundBleed.className = 'pl-menu__ground-bleed';
    groundBleed.setAttribute('aria-hidden', 'true');
    groundPlane.appendChild(groundBleed);

    // The cut soil itself: it covers everything above the soil line in the scene, so
    // it is appended here rather than where it was built.
    groundPlane.appendChild(this.stage);

    // The moon's light lying on the ground in front of the plant. The scene needs a
    // source near the tree at night, and a cold pool of moonlight is the one that
    // belongs there - it is the opposite of the warm hearth that was removed.
    const moonPool = document.createElement('div');
    moonPool.className = 'pl-menu__moon-pool';
    moonPool.setAttribute('aria-hidden', 'true');
    groundPlane.appendChild(moonPool);

    // What is buried in the cut soil. Each piece is a small button rather than a
    // decoration: clicking a chest should open it, and clicking a worm should
    // annoy it. The tilt is per piece so nothing sits on the grid.
    // The stone layer: soil sits on rock, and the cut shows it. Without this the
    // whole underground was one brown face and the ore and fossil had nothing to
    // be embedded in.
    const bedrock = document.createElement('div');
    bedrock.className = 'pl-menu__bedrock';
    bedrock.setAttribute('aria-hidden', 'true');
    // A child of the stage: it paints over the soil because a child is above its
    // parent's background, and it inherits the stage's parallax. As a world sibling
    // it needed a z-index above the stage, which forced the reaches, the finds and
    // the plant to be raised above the rock in turn.
    this.stage.appendChild(bedrock);

    const soilLife = document.createElement('div');
    soilLife.className = 'pl-menu__soil-life';
    soilLife.innerHTML = TREASURES.map(
      (treasure) =>
        `<button type="button" class="pl-treasure" data-treasure="${treasure.id}" ` +
        `style="left:${treasure.x}%;top:${treasure.y}%;--tw:${treasure.width};--tilt:${treasure.tilt}deg" ` +
        `aria-label="${treasure.find}">` +
        `<svg viewBox="0 0 120 104" aria-hidden="true" focusable="false">${treasureArt(treasure.kind)}</svg>` +
        '</button>',
    ).join('');
    // A world child, like the bedrock: it anchors itself to the soil line and
    // spans the pane, not the 200vw world. The reaches live inside it, in the
    // same percentage space as the pieces.
    groundPlane.appendChild(soilLife);

    // One root run per find, under the pieces. The plate under the mascot only
    // scales, so without this nothing ever travelled from the plant to a find:
    // the pieces were marked reached by a stage number and the roots never moved.
    soilLife.insertAdjacentHTML(
      'afterbegin',
      '<svg class="pl-menu__root-runs" viewBox="0 0 100 100" ' +
        'preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
        // The reaches are the same root system as the plate under the trunk, so
        // they fade the same way: the plate's 1 -> 0.92 -> 0.5 depth ramp, as alpha
        // in the fill rather than a mask over the group. A mask costs a separate
        // buffer and a composite for the whole layer at every new camera scale; a
        // gradient is a cheap fill. The plate's ramp ends at 0.5 because its roots
        // stop half way down the band - a reach crosses the whole band, so the same
        // 0.5 left its deep end a ghost. The fade is the plate's, its end is not.
        [
          { name: 'body', colour: '#efe3cd', opacities: [1, 0.95, 0.72] },
          { name: 'lateral', colour: '#cbb99b', opacities: [1, 0.95, 0.72] },
          // Third order is paler than second, as the plate draws its hairs at 50%.
          { name: 'hair', colour: '#cbb99b', opacities: [0.55, 0.52, 0.4] },
        ]
          .map(
            (fade) =>
              `<linearGradient id="pl-reach-fade-${fade.name}" gradientUnits="userSpaceOnUse" ` +
              `x1="0" y1="0" x2="0" y2="100">` +
              `<stop offset="0" stop-color="${fade.colour}" stop-opacity="${fade.opacities[0]}"/>` +
              `<stop offset="0.62" stop-color="${fade.colour}" stop-opacity="${fade.opacities[1]}"/>` +
              `<stop offset="1" stop-color="${fade.colour}" stop-opacity="${fade.opacities[2]}"/>` +
              '</linearGradient>',
          )
          .join('') +
        '</defs></svg>',
    );
    const runsSvg = soilLife.querySelector<SVGSVGElement>('.pl-menu__root-runs');
    const runGroups = new Map<string, SVGGElement>();
    if (runsSvg) {
      // No redraw on zoom and none on a timer: the reaches are drawn in the band's
      // own percentage space, and the band is a piece of the world, so the camera's
      // scale moves and thickens them with the soil around them. The eight paths are
      // built once and never touched again.
      for (const run of rootRuns()) {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.dataset.rootRun = run.id;
        // The run's letter and its branches' names, so a rule written about `a_2` can
        // be found in DevTools without counting paths.
        group.dataset.root = run.name;
        group.dataset.branches = run.branches.map((branch) => branch.name).join(' ');
        // The same three passes the static plate draws: a padded ink edge, the
        // pale tapered body, and a few hairs off the spine.
        const add = (d: string, className: string): void => {
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', d);
          path.setAttribute('class', `pl-root-run__${className}`);
          group.appendChild(path);
        };
        add(run.ink, 'ink');
        // The px floor goes under the body: it is a floor, not a highlight.
        add(run.tip, 'tip');
        add(run.outline, 'body');
        add(run.laterals, 'lateral');
        add(run.hairs, 'hair');
        runsSvg.appendChild(group);
        runGroups.set(run.id, group);
      }
    }

    const soilCaption = document.createElement('div');
    soilCaption.className = 'pl-menu__soil-caption';
    soilCaption.setAttribute('role', 'status');
    // The screen layer is the size of the pane and does not pan with the ground,
    // which is what a caption should do; inside the stage its `bottom: 4%` was
    // four percent of a 720px-tall soil band below the fold.
    this.screenLayerEl().appendChild(soilCaption);
    let captionTimer = 0;
    const say = (message: string): void => {
      soilCaption.textContent = message;
      soilCaption.classList.add('is-visible');
      window.clearTimeout(captionTimer);
      captionTimer = window.setTimeout(() => soilCaption.classList.remove('is-visible'), 2600);
    };

    /** Replay one piece's own reaction. The reflow is what allows a second click. */
    const nudgeTreasure = (id: string, reaction?: string): void => {
      const button = soilLife.querySelector<HTMLElement>(`[data-treasure="${id}"]`);
      if (!button) return;
      button.classList.remove('is-bumped', 'is-wiggle', 'is-open', 'is-sparkle');
      void button.offsetWidth;
      button.classList.add('is-bumped');
      if (reaction) button.classList.add(`is-${reaction}`);
      window.setTimeout(() => button.classList.remove('is-bumped'), 700);
      if (reaction === 'open') {
        // Open is an event, not a state: the lid lifts, the gold is seen, and the
        // chest closes again. It used to stay open for the rest of the session
        // because nothing ever took the class off.
        window.setTimeout(() => button.classList.remove('is-open'), 3200);
      }
    };

    soilLife.addEventListener('click', (event) => {
      const button = (event.target as Element | null)?.closest?.(
        '.pl-treasure',
      ) as HTMLElement | null;
      if (!button) return;
      const treasure = TREASURES.find((entry) => entry.id === button.dataset.treasure);
      if (!treasure) return;
      nudgeTreasure(treasure.id, treasure.reaction);
      say(treasure.find);
    });

    this.plant = createTitlePlant({
      swayMs: options.ui.titlePlantSwayMs,
      reactMs: options.ui.titlePlantReactMs,
      cooldownMs: options.ui.titlePlantReactCooldownMs,
      reducedMotion: options.ui.reducedMotion,
    });
    // The plant stands in the world, not in the menu: it never fades with the UI
    // and it is the only part of the world the pointer can grab.
    this.world.appendChild(this.plant.element);
    // Wind, from the scene: a fast pointer across the canopy pushes the plant and
    // it springs back - the same path a released drag takes (`plant.gust`). The
    // scene owns the gesture because the plant is only one part of the picture the
    // pointer crosses.
    this.scene.element.addEventListener('pl-title-gust', (event) => {
      const detail = (event as CustomEvent<{ deg?: number; x?: number; y?: number }>).detail;
      const deg = detail?.deg ?? 0;
      // A fast pass rustles the canopy, and only where the pointer was. It used to
      // call `plant.gust`, which is the drag gesture - so moving the mouse over the
      // tree leaned the whole plant, trunk and all, like someone pulling it.
      const at =
        Number.isFinite(detail?.x) && Number.isFinite(detail?.y)
          ? { x: detail?.x ?? 0, y: detail?.y ?? 0 }
          : undefined;
      this.plant?.rustle(deg, at);
    });
    // The sway's speed is configuration (`title_plant_sway_ms`) and the sway is a CSS
    // animation now, so the number has to reach the stylesheet as a variable. It was
    // read by the old script loop, and when the sway moved to CSS nothing carried it
    // across: the setting was silently ignored and every plant swayed at 5.2 s.
    if (Number.isFinite(options.ui.titlePlantSwayMs) && options.ui.titlePlantSwayMs > 0) {
      this.plant.element.style.setProperty(
        '--pl-sway-ms',
        `${Math.round(options.ui.titlePlantSwayMs)}ms`,
      );
    }

    // --------------------------------------------------------------------- care
    // A watering can and a bag of feed beside the plant. Nothing is rationed: any
    // watering or feeding is one growth step, so the loop is looking after the
    // plant and watching it climb, not coming back tomorrow.
    const careKey = 'pl-title-care';
    // Dev: every reload starts the mascot as a seed. The ladder is a hundred
    // stages, and judging a stage's art or the growth between two waterings is
    // impossible when the saved state of an earlier session is what opens. Built
    // out of production builds, where the garden on screen is the player's.
    if (import.meta.env.DEV) {
      try {
        window.localStorage.removeItem(careKey);
      } catch {}
    }
    let care = emptyCare();
    try {
      const stored = JSON.parse(window.localStorage.getItem(careKey) ?? 'null') as {
        points?: number;
      } | null;
      if (stored && typeof stored.points === 'number') {
        care = { points: Math.max(0, Math.round(stored.points)) };
      }
    } catch {}
    const writeCare = (): void => {
      try {
        window.localStorage.setItem(careKey, JSON.stringify({ points: care.points }));
      } catch {}
    };
    /** When the last few care actions happened, for the too-much-of-a-good-thing rule. */
    let recentCare: number[] = [];
    let groggyTimer = 0;

    const careBar = document.createElement('div');
    careBar.className = 'pl-menu__care';
    careBar.innerHTML = `
      <button type="button" class="pl-care" data-care="water" aria-label="Water the plant">
        <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
          <!-- A watering can that fills its box the way the sack does. The first two
               passes drew a small can inside a 64-unit square: the body was fourteen
               units shorter than the sack beside it, the rose sat on the edge of the
               frame, and the whole icon read as the smaller of the pair. -->
          <!-- The hoop leaves the back of the can at both ends and comes round in a
               hand's width: the first version reached fifteen units out and read as a
               mug ear with the can hung off it. -->
          <path d="M18.8 40.2 C12.4 40.6 10.6 44 10.6 47 C10.6 50.2 13.2 53.2 18.8 53.4" fill="none"
                stroke="#4f7280" stroke-width="4" stroke-linecap="round"/>
          <path d="M17.6 32.4 H47 L45.6 50.8 Q45.2 56.6 39.4 56.6 H24.6 Q18.8 56.6 18.4 50.8 Z"
                fill="#7ea7b8" stroke="#20323a" stroke-width="2" stroke-linejoin="round"/>
          <path d="M16.4 30 Q16.4 27.4 19.4 27.4 H45.6 Q48.6 27.4 48.6 30 V32.4 Q48.6 34.2 46.8 34.2 H18.2 Q16.4 34.2 16.4 32.4 Z"
                fill="#a6c8d4" stroke="#20323a" stroke-width="1.9" stroke-linejoin="round"/>
          <!-- The spout leaves the rim as a cone and the rose closes it: a band of even
               width from rim to rose reads as a hose taped to a bucket. -->
          <path d="M43.6 27.6 L52.4 18.4 L55 20.8 L46.8 33.8 Z" fill="#8fb5c4" stroke="#20323a"
                stroke-width="1.8" stroke-linejoin="round"/>
          <!-- The rose is an ellipse seen at an angle, the way a rose on the end of a
               raised spout actually looks, with a rim and an inner plate of holes. The
               rounded square before it read as a flag on a pole. -->
          <g transform="translate(55.6 16.4) rotate(38)">
            <ellipse rx="6.2" ry="4.4" fill="#a6c8d4" stroke="#20323a" stroke-width="1.8"/>
            <ellipse rx="4.5" ry="2.9" fill="#8fb5c4" stroke="#20323a" stroke-width="1.1"/>
            <g fill="#20323a" opacity="0.55">
              <circle cx="-2.6" cy="-0.9" r="0.7"/><circle cx="0" cy="-1.7" r="0.7"/>
              <circle cx="2.6" cy="-0.9" r="0.7"/><circle cx="-1.4" cy="1.5" r="0.7"/>
              <circle cx="1.4" cy="1.5" r="0.7"/>
            </g>
          </g>
          <!-- Water only while the can is tipped: the droplets are a pour, not part of
               the prop, and a can that is always dripping looks broken. -->
          <g class="pl-care__pour" stroke="#9ad7ff" stroke-width="2.2" stroke-linecap="round">
            <path d="M50.6 25.4 L51.6 31.4"/><path d="M55.4 26.6 L56.8 32.6"/>
          </g>
        </svg>
      </button>
      <button type="button" class="pl-care" data-care="feed" aria-label="Feed the plant">
        <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
          <!-- A sack of feed: symmetrical, open at the top with the mouth folded down and
               the meal heaped over the rim, a centred label, and the leaf on it. -->
          <path d="M21 25 H43 Q46 28 47 33 L49 52 Q49 58 43 58 H21 Q15 58 15 52 L17 33 Q18 28 21 25 Z"
                fill="#a8804a" stroke="#3a2a15" stroke-width="2" stroke-linejoin="round"/>
          <path d="M19 33 Q22 45 20 55" fill="none" stroke="#8a663a" stroke-width="1.6"
                stroke-linecap="round" opacity="0.75"/>
          <path d="M45 33 Q42 45 44 55" fill="none" stroke="#8a663a" stroke-width="1.6"
                stroke-linecap="round" opacity="0.75"/>
          <!-- The meal first, heaped in a shallow mound just over the mouth line, then
               the folded cuff drawn in front of it. Last pass had the heap and the cuff
               in the wrong order and no outline on the fold, so the mouth read as a thin
               pale band with two dark horns on it. -->
          <path d="M20.6 30.8 Q26 24.4 32 24 Q38 24.4 43.4 30.8 Q38 28.4 32 28.4 Q26 28.4 20.6 30.8 Z"
                fill="#d9b878" stroke="#3a2a15" stroke-width="1.5" stroke-linejoin="round"/>
          <g fill="#b9924f">
            <circle cx="27" cy="28" r="0.8"/><circle cx="29.8" cy="26.4" r="0.75"/>
            <circle cx="32.4" cy="27.4" r="0.85"/><circle cx="35.2" cy="26.2" r="0.75"/>
            <circle cx="37.6" cy="28.2" r="0.8"/><circle cx="31" cy="28.9" r="0.55"/>
            <circle cx="34.4" cy="28.8" r="0.5"/>
          </g>
          <path d="M24 27.8 Q28.8 25.4 33 25.8" fill="none" stroke="#efd9ab" stroke-width="1.2"
                stroke-linecap="round" opacity="0.8"/>
          <!-- The cuff: the mouth cut open and folded once down over the rim. It sits
               in front of the heap, low and narrow, so six units of meal show above it. -->
          <path d="M18.4 30.6 Q25 33.2 32 33.2 Q39 33.2 45.6 30.6 L46 32.8 Q39 35.6 32 35.6 Q25 35.6 18 32.8 Z"
                fill="#8a663a" stroke="#3a2a15" stroke-width="1.6" stroke-linejoin="round"/>
          <!-- A shadow below the fold: without it the cuff reads as a bowl rim and
               the mouth loses all depth. -->
          <path d="M20 33.6 Q26 36 32 36 Q38 36 44 33.6 L44.4 35.4 Q38 37.8 32 37.8 Q26 37.8 19.6 35.4 Z"
                fill="#6d5330" stroke="none" opacity="0.45"/>
          <rect x="23" y="31" width="18" height="17" rx="2.5" fill="#efdca8"
                stroke="#3a2a15" stroke-width="1.4"/>
          <path d="M32 46.4 V44.6" stroke="#3f6322" stroke-width="1.2" stroke-linecap="round"/>
          <path d="M32 45.4 C26.6 42.8 26.6 35.4 32 32.4 C37.4 35.4 37.4 42.8 32 45.4 Z" fill="#6d9c3c"/>
          <path d="M32 44.4 V33.6" stroke="#3f6322" stroke-width="1" stroke-linecap="round"/>
        </svg>
      </button>`;
    this.world.appendChild(careBar);

    // The foreground: the ground as one layer (so a find cannot slide out of its
    // own hole), the plant and the care buttons that hang off it. Horizontal for
    // the ground only - lifting the soil line opens the hill skirts under it.
    // One factor for the whole ground, plant included.
    //
    // The plant stands on this plane: it is rooted in it and its plate is the root
    // crown every reach leaves from. It was registered at 1.1 while the ground - the
    // soil, the bedrock, the finds and the reaches - moved at 0.9, so every pointer
    // drag slid the plant a fifth of the drag away from its own roots and its own
    // finds: the trunk hung over nothing, treasure by treasure, and the top of the
    // reach stubs came out from behind the plate. Same factor now, so a drag moves
    // the whole ground and the thing growing out of it as one piece.
    // No vertical share on either: a drag that lifts the soil has to lift the trunk
    // by the same amount, or the trunk sinks into the ground on the way up.
    this.scene.addParallaxHost(groundPlane, 0.9, 0);
    this.scene.addParallaxHost(this.plant.element, 0.9, 0, 'translate(-50%, -100%)');
    // The props stand on the same soil, so they keep the same factor as the soil.
    this.scene.addParallaxHost(careBar, 0.9, 0);

    // Everything a prop leaves behind lands here: droplets, specks, the ring of
    // water on the soil. Above the plant, so the effect is in front of it.
    const fx = document.createElement('div');
    fx.className = 'pl-menu__fx';
    fx.setAttribute('aria-hidden', 'true');
    // Screen space, like the weather: the droplets are placed from the pointer's
    // client coordinates and the plant's rect, which are screen pixels. Inside the
    // scaled world those numbers were off by 1/zoom, and at the pulled-back limit
    // the water fell past the soil into the cut.
    this.root.appendChild(fx);

    const rootedIds = new Set<string>();

    /**
     * One root run, from the stem's foot to a find.
     *
     * This is how a find is collected: not a class flipping on a button, but a root
     * leaving the plant and arriving at the thing it reached. Drawn in the ground's
     * own percentage space, so it lands on the piece at any pane size.
     */
    /**
     * One reach in the ground's space: a filled tapered root with an ink edge.
     *
     * Filled, not stroked, because that is what the roots under the plant are
     * (`spineOutline` in `roots.ts`). The reaches used to be two constant-width
     * strokes, which read as wires laid across the dirt - a second root system
     * lying over the first one.
     */
    /**
     * A find the plant has reached.
     *
     * There is no drawn run from the trunk to the piece, and there never will be
     * again: the only roots in the cut are the plate the plant grows, and a second
     * system drawn to the loot was an imitation of them laid over the real thing.
     * Reaching a find is the plant's own growth - the plate deepens and widens with
     * every stage - so the piece answers where it lies.
     */
    const growRootTo = (treasure: Treasure, animate: boolean): void => {
      if (rootedIds.has(treasure.id)) return;
      rootedIds.add(treasure.id);
      const piece = soilLife.querySelector<HTMLElement>(`[data-treasure="${treasure.id}"]`);
      if (!piece) return;
      const run = runGroups.get(treasure.id);
      const reveal = (): void => {
        run?.classList.add('is-grown');
      };
      if (!animate) {
        // Already grown when the saved care count loads: no reveal to watch, the
        // root is simply there. No transition on the way in, or a returning player
        // watches eight roots grow all at once.
        if (run) run.style.transition = 'none';
        reveal();
      }
      const claim = (): void => {
        piece.classList.add('is-reached');
        if (!animate) return;
        piece.style.animation = 'pl-treasure-bump 420ms ease-out 1';
        window.setTimeout(() => {
          piece.style.animation = '';
        }, 460);
      };
      if (animate) {
        // The find belongs to the roots when the root has arrived, not when it set
        // out: 1.1 s for the reveal, then the piece answers.
        window.setTimeout(reveal, 40);
        window.setTimeout(claim, 1150);
      } else {
        claim();
      }
    };

    /**
     * What a prop leaves where it was used: a stream of water that arcs out of the
     * spout, splashes on the soil and wets the ground; or a scatter of meal that
     * tumbles down and lies there. This is the difference between the two actions
     * made visible - the growth step is the same, the gesture is not.
     *
     * Both halves of this were wrong. The droplets started at the top of the
     * plant's bounding box - a hand above the leaves, in the sky - and fell
     * straight down, so the pour never touched the can it supposedly came from.
     * The splashes were round rings at the soil line, which is the top edge of the
     * dirt cross-section: their lower halves were painted on the cut face, and
     * they read as hoops sunk into the earth. The pour is an arc from the spout
     * now, and every landing is an ellipse sitting *on* the surface line.
     *
     * @param from  Where the prop is: the can's spout, the sack's mouth, or the
     *              point a carried prop was let go.
     * @param landX Screen x of the landing. Water lands across the canopy when it
     *              is over the plant, and in a splash the width of a hand when it
     *              is poured on the meadow.
     */
    const spawnResourceEffect = (
      action: CareAction,
      from: { x: number; y: number },
      landX: number,
      onPlant: boolean,
    ): void => {
      const box = fx.getBoundingClientRect();
      const plantBox = this.plant.element.getBoundingClientRect();
      // The stage the plant stands on is wider than the plant: its own drawing is
      // the grab plate around the trunk, and that is the width water can land
      // across. Watering a sprout with the fan of a full tree put half the drops on
      // the meadow beside it.
      const artBox =
        this.plant.element.querySelector('.pl-title-plant__grab')?.getBoundingClientRect() ??
        plantBox;
      // The surface is one horizontal line in this scene: the plant's own feet sit
      // on it, and so does every puddle. Measured from the plant so a drag or a
      // zoom that lifts the soil lifts the water with it - and nothing is ever
      // drawn below it, because under it is the cut face of the soil.
      const groundY = plantBox.bottom - box.top;
      const originX = from.x - box.left;
      const originY = from.y - box.top;
      const targetX = landX - box.left;
      const water = action === 'water';
      // Over the plant the water lands across its own width; anywhere else it lands
      // where it was poured, in a splash no wider than a hand.
      const spread = onPlant ? artBox.width * (water ? 0.32 : 0.15) : 5;
      const landings = water ? 6 : 4;
      const drops = water ? 18 : 14;
      const landingX: number[] = [];
      for (let i = 0; i < landings; i += 1) {
        landingX.push(targetX + (i / (landings - 1)) * 2 * spread - spread);
      }
      const firstArrival = new Array<number>(landings).fill(Number.POSITIVE_INFINITY);
      // What this pour put on screen. The cleanup below is scoped to it: it used
      // to remove every effect in the layer, so pouring again within the first
      // pour's three seconds erased the new drops while they were still falling.
      const pieces: HTMLElement[] = [];
      const mount = (piece: HTMLElement): void => {
        fx.appendChild(piece);
        pieces.push(piece);
      };
      for (let i = 0; i < drops; i += 1) {
        const landing = i % landings;
        const drop = document.createElement('span');
        drop.className = 'pl-fx__arc';
        // A mouth has width: the drops do not leave one mathematical point, and a
        // prop held straight above the plant is a hand, not a spout.
        const mouth = Math.abs(from.x - landX) < 24 ? 4 : 1.6;
        const startX = originX + ((i % 5) - 2) * mouth;
        const startY = originY + ((i % 3) - 1) * 2;
        const dx = (landingX[landing] ?? targetX) - startX + (((i * 37) % 7) - 3);
        // Land a hair above the line: the drop's own height would otherwise put
        // its foot in the cut face.
        const dy = groundY - 3 - startY;
        const dur = Math.round(340 + Math.min(320, Math.hypot(dx, dy) * 1.1));
        // Staggered per landing and per drop, so it is a pour rather than a burst:
        // the near landings are hit first and each one takes a few drops.
        const delay = Math.round(landing * 70 + (i / drops) * 150);
        drop.style.left = `${startX.toFixed(1)}px`;
        drop.style.top = `${startY.toFixed(1)}px`;
        drop.style.setProperty('--pl-arc-dx', `${dx.toFixed(1)}px`);
        drop.style.setProperty('--pl-arc-dy', `${dy.toFixed(1)}px`);
        drop.style.setProperty('--pl-arc-dur', `${dur}ms`);
        drop.style.setProperty('--pl-arc-delay', `${delay}ms`);
        if (!water) drop.style.setProperty('--pl-arc-spin', `${((i * 53) % 180) - 90}deg`);
        const dot = document.createElement('i');
        dot.className = `pl-fx__drop pl-fx__drop--${water ? 'water' : 'feed'}`;
        drop.appendChild(dot);
        mount(drop);
        firstArrival[landing] = Math.min(
          firstArrival[landing] ?? Number.POSITIVE_INFINITY,
          delay + dur,
        );
      }
      // What each landing leaves: water opens a ripple, throws a spray and darkens
      // the soil; meal drops a few specks that lie there and fade.
      let lastAt = 0;
      for (let i = 0; i < landings; i += 1) {
        const arrive = firstArrival[i] ?? 0;
        if (!Number.isFinite(arrive)) continue;
        const x = landingX[i] ?? targetX;
        lastAt = Math.max(lastAt, arrive);
        if (water) {
          const width = 16 + ((i * 7) % 6);
          const height = width * 0.26;
          const wet = document.createElement('i');
          wet.className = 'pl-fx__wet';
          wet.style.left = `${x.toFixed(1)}px`;
          // Most of the stain is below the surface line: that is the soil the
          // water is soaking into, and it is why the ground reads darker.
          wet.style.top = `${(groundY - 6).toFixed(1)}px`;
          wet.style.setProperty('--pl-wet-w', `${Math.round(width * 2.3)}px`);
          wet.style.setProperty('--pl-wet-delay', `${Math.max(0, Math.round(arrive) - 80)}ms`);
          mount(wet);
          // Two rings, the second a beat later and a quarter wider: one ring reads
          // as a line drawn on the soil, two read as a landing.
          for (let k = 0; k < 2; k += 1) {
            const ripple = document.createElement('i');
            ripple.className = 'pl-fx__ripple';
            ripple.style.left = `${x.toFixed(1)}px`;
            ripple.style.top = `${(groundY - height * (1 + k * 0.25)).toFixed(1)}px`;
            ripple.style.setProperty('--pl-ripple-w', `${width * (1 + k * 0.25)}px`);
            ripple.style.setProperty('--pl-ripple-delay', `${Math.round(arrive + k * 80)}ms`);
            mount(ripple);
          }
          // Three drops thrown out of the landing, one out each way and one up.
          for (let k = 0; k < 3; k += 1) {
            const spit = document.createElement('i');
            spit.className = 'pl-fx__spit';
            spit.style.left = `${(x + (k - 1) * 1.5).toFixed(1)}px`;
            spit.style.top = `${(groundY - 2).toFixed(1)}px`;
            spit.style.setProperty(
              '--pl-spit-dx',
              `${((k - 1) * 9 + ((i * 13) % 5) - 2).toFixed(0)}px`,
            );
            spit.style.setProperty('--pl-spit-rise', `${9 + ((i + k) % 4) * 2}px`);
            spit.style.setProperty('--pl-spit-delay', `${Math.round(arrive + k * 30)}ms`);
            mount(spit);
          }
        } else {
          for (let k = 0; k < 3; k += 1) {
            const meal = document.createElement('i');
            meal.className = 'pl-fx__meal';
            meal.style.left = `${(x + (k - 1) * 3.5).toFixed(1)}px`;
            meal.style.top = `${(groundY - 3).toFixed(1)}px`;
            meal.style.setProperty('--pl-meal-delay', `${Math.round(arrive + k * 45)}ms`);
            mount(meal);
            // A crumb that bounces off the soil before it lies down.
            const bounce = document.createElement('i');
            bounce.className = 'pl-fx__spit pl-fx__spit--meal';
            bounce.style.left = `${x.toFixed(1)}px`;
            bounce.style.top = `${(groundY - 2).toFixed(1)}px`;
            bounce.style.setProperty('--pl-spit-dx', `${((k - 1) * 7).toFixed(0)}px`);
            bounce.style.setProperty('--pl-spit-rise', `${6 + k * 2}px`);
            bounce.style.setProperty('--pl-spit-delay', `${Math.round(arrive + k * 30)}ms`);
            mount(bounce);
          }
        }
      }
      // A pour is a gesture with an end: everything it left is gone a beat after
      // the last splash has dried.
      window.setTimeout(() => {
        for (const piece of pieces) piece.remove();
      }, Math.round(lastAt) + 4200);
    };

    const paintCare = (animateNew: boolean): void => {
      // The running count, not the stage: the plant grows a little with every
      // watering instead of only when it crosses a stage boundary.
      // Care counts are not stages: the ladder is a hundred steps long, so a
      // watering is five of them and the drawing changes at every one.
      this.plant?.setGrowthStage(growthStageFromPoints(care.points));
      // The drawing just changed size, so the ground line has to answer to the new
      // height: a tree that grew while the horizon stayed put is a tree that grew
      // through the top of the pane.
      this.fitToPane();
      // The claim (and the piece's own reaction) belongs to growRootTo: it lands
      // when the root has wrapped the piece, not the moment the root sets out.
      for (const treasure of reachedTreasures(care.points)) growRootTo(treasure, animateNew);
    };

    /**
     * One watering or feeding. The props are not rationed, so this never refuses:
     * every action is a growth step, and every growth step may send a root out.
     */
    const applyProp = (
      action: CareAction,
      button: HTMLElement | null,
      at?: { x: number; y: number },
    ): void => {
      const before = careStage(care.points);
      care = applyCare(care, action);
      writeCare();
      if (button) {
        button.classList.remove('is-pouring');
        void button.offsetWidth;
        button.classList.add('is-pouring');
        window.setTimeout(() => button.classList.remove('is-pouring'), 950);
      }
      const after = careStage(care.points);
      paintCare(true);
      // Care has an answer that is not a number going up: the plant dances. Do it
      // too often in a short window and it goes comically groggy for a while - the
      // props are not rationed, so pouring the whole can in has to have a
      // consequence.
      this.plant.celebrate();
      const nowMs = performance.now();
      recentCare = recentCare.filter((stamp) => nowMs - stamp < 6000);
      recentCare.push(nowMs);
      const overdone = recentCare.length >= 4;
      this.plant.setGroggy(overdone);
      window.clearTimeout(groggyTimer);
      if (overdone) {
        groggyTimer = window.setTimeout(() => this.plant.setGroggy(false), 9000);
      }
      const plantBox = this.plant.element.getBoundingClientRect();
      // The pour leaves the prop, not the sky. The can's spout is at four fifths
      // of its width and a little above the middle; the sack's mouth is at the
      // top, where the meal is heaped. A carried prop pours from where it was
      // let go, which is the point the player is looking at.
      const home = button?.getBoundingClientRect();
      const spout = home
        ? {
            x: home.left + home.width * (action === 'water' ? 0.8 : 0.5),
            y: home.top + home.height * (action === 'water' ? 0.42 : 0.34),
          }
        : { x: plantBox.left + plantBox.width / 2, y: plantBox.top + 12 };
      spawnResourceEffect(action, at ?? spout, at?.x ?? plantBox.left + plantBox.width / 2, true);
      // The plant answers in its own way: leaves lift for water, the whole body
      // swells for feed.
      const glow = action === 'water' ? 'is-watered' : 'is-fed';
      this.plant.element.classList.remove('is-watered', 'is-fed');
      void this.plant.element.offsetWidth;
      this.plant.element.classList.add(glow);
      window.setTimeout(() => this.plant.element.classList.remove(glow), 980);
      this.plant?.react(action === 'water' ? 'leaf' : 'stem', action === 'water' ? 2 : 3);
      const found = reachedTreasures(care.points);
      const latest = found[found.length - 1];
      if (after > before && latest && rootedIds.has(latest.id)) {
        nudgeTreasure(latest.id, latest.reaction);
        say(`The roots reached ${latest.find.toLowerCase()}`);
        return;
      }
      say(action === 'water' ? 'Watered. The leaves lift.' : 'Fed. New growth is coming.');
    };

    // Drag and drop. A prop can be carried to the plant (it is given), put down
    // anywhere else above ground (it is wasted), or brought back to where it stood
    // (nothing happens). A press that never travels is a tap, which gives it.
    let carrying: {
      action: CareAction;
      button: HTMLElement;
      ghost: HTMLElement;
      startX: number;
      startY: number;
      moved: boolean;
    } | null = null;

    const propButton = (target: EventTarget | null): HTMLElement | null =>
      (target as Element | null)?.closest?.('.pl-care') as HTMLElement | null;

    /**
     * The plant's drawn width, which is not its element's width.
     *
     * The element is a stage wide enough for the widest tree the title can grow,
     * so for a sprout most of it is empty air. Every test that asked
     * elementFromPoint for "is this over the plant" therefore answered yes for
     * points a long way beside the drawing - the invisible box around the tree -
     * and a prop let go there was swallowed by the box instead of falling where
     * the player put it. The grab plate and the shoot are the drawing; their
     * union is what a pour can land on.
     */
    const plantArtBox = (): DOMRect => {
      const el = this.plant.element;
      const parts = ['.pl-title-plant__shoot', '.pl-title-plant__grab']
        .map((selector) => el.querySelector(selector)?.getBoundingClientRect())
        .filter((rect): rect is DOMRect => Boolean(rect) && (rect as DOMRect).width > 0);
      if (parts.length === 0) return el.getBoundingClientRect();
      const left = Math.min(...parts.map((rect) => rect.left));
      const right = Math.max(...parts.map((rect) => rect.right));
      const top = Math.min(...parts.map((rect) => rect.top));
      const bottom = Math.max(...parts.map((rect) => rect.bottom));
      // One plain object behind a DOMRect cast: only the four edges are read.
      return { left, right, top, bottom, width: right - left, height: bottom - top } as DOMRect;
    };

    /**
     * The plant as a drop target: its drawn width, from the top of the world down
     * to the soil.
     *
     * Two bugs met here. A prop held above the plant had a column only a hand and
     * a half tall, measured from the grab plate - the plate around a seed's trunk
     * is a few pixels tall, so a pour from any real height above a seed landed on
     * the meadow and nothing happened. And the width came from the stage, so a
     * prop put down beside the drawing was treated as a pour on it. The column now
     * reaches the top of the world (a can tipped over a plant is still over the
     * plant however high it is held) and is as wide as the drawing plus a hand.
     */
    const overPlantColumn = (x: number, y: number): boolean => {
      const art = plantArtBox();
      // A hand's width of slack, not a fraction of the drawing: the stream from a
      // can is a few centimetres wide, so a release a dozen pixels off the leaf
      // edge is still a pour. Anything wider started swallowing the meadow.
      const grow = Math.max(8, art.width * 0.06);
      const ceiling = this.world.getBoundingClientRect().top;
      return (
        x >= art.left - grow && x <= art.right + grow && y >= ceiling - 24 && y <= art.bottom + 8
      );
    };

    /** Is this screen point a pour onto the plant (on it, or held above it)? */
    const isOverPlant = (x: number, y: number): boolean => overPlantColumn(x, y);

    const onCarryMove = (event: PointerEvent): void => {
      if (!carrying) return;
      if (
        !carrying.moved &&
        Math.hypot(event.clientX - carrying.startX, event.clientY - carrying.startY) < 6
      ) {
        return;
      }
      carrying.moved = true;
      carrying.button.classList.add('is-carried');
      this.world.classList.add('is-carrying');
      carrying.ghost.style.left = `${event.clientX}px`;
      carrying.ghost.style.top = `${event.clientY}px`;
      // The plant lights up while a prop is held over it: that is the drop target.
      this.plant.element.classList.toggle(
        'is-carry-target',
        isOverPlant(event.clientX, event.clientY),
      );
    };

    /** Put a carried prop down without acting on it (a lost capture, a cancel). */
    const dropGhost = (event?: PointerEvent): void => {
      if (!carrying) return;
      carrying.ghost.remove();
      carrying.button.classList.remove('is-carried');
      this.plant.element.classList.remove('is-carry-target');
      this.world.classList.remove('is-carrying');
      try {
        if (event) careBar.releasePointerCapture(event.pointerId);
      } catch {}
    };

    const onCarryEnd = (event: PointerEvent): void => {
      const current = carrying;
      if (!current) return;
      carrying = null;
      // Where the carried prop actually is on screen, read before it is removed:
      // what was put down has to be the drawing the player is looking at, not the
      // pointer that holds it.
      const carried = current.ghost.getBoundingClientRect();
      current.ghost.remove();
      this.world.classList.remove('is-carrying');
      current.button.classList.remove('is-carried');
      this.plant.element.classList.remove('is-carry-target');
      try {
        careBar.releasePointerCapture(event.pointerId);
      } catch {}
      if (!current.moved) {
        applyProp(current.action, current.button);
        return;
      }
      const home = current.button.getBoundingClientRect();
      // Putting a prop back means putting the *prop* back: the carried drawing
      // touching the icon it came from. The old test was a 48 px radius around the
      // icon's centre, and the icon is smaller than that - a prop put down in the
      // meadow a hand away from the can went quietly home instead of pouring, which
      // read as the drag being taken back before it was let go.
      const slop = 6;
      const touchesHome =
        carried.right >= home.left - slop &&
        carried.left <= home.right + slop &&
        carried.bottom >= home.top - slop &&
        carried.top <= home.bottom + slop;
      if (touchesHome) {
        say('Put it back');
        return;
      }
      if (isOverPlant(event.clientX, event.clientY)) {
        applyProp(current.action, current.button, { x: event.clientX, y: event.clientY });
        return;
      }
      // Poured on the meadow: it grows nothing, but the pour is still a pour. It
      // has to leave the prop and land where it was let go, or the gesture reads
      // as a button that did nothing at all.
      spawnResourceEffect(
        current.action,
        { x: event.clientX, y: event.clientY },
        event.clientX,
        false,
      );
      say(current.action === 'water' ? 'Poured out on the meadow' : 'Scattered on the meadow');
    };

    careBar.addEventListener('pointerdown', (event) => {
      const button = propButton(event.target);
      if (!button || (event.button !== 0 && event.pointerType === 'mouse')) return;
      const action = button.dataset.care as CareAction | undefined;
      if (!action) return;
      // The gesture belongs to the prop: no text selection, no scene drag.
      event.preventDefault();
      event.stopPropagation();
      try {
        careBar.setPointerCapture(event.pointerId);
      } catch {}
      const ghost = button.cloneNode(true) as HTMLElement;
      // `pl-care` as well as `pl-care-ghost`: the clone needs the art's own sizing
      // rules, and the ghost class only adds the carried position.
      ghost.className = 'pl-care pl-care-ghost';
      ghost.setAttribute('aria-hidden', 'true');
      ghost.removeAttribute('data-care');
      ghost.style.left = `${event.clientX}px`;
      ghost.style.top = `${event.clientY}px`;
      // The carried prop is the prop's size on screen, which is the button's size
      // under the current zoom. The ghost used a fixed 72 px, so at zoom 0.55 it
      // was twice the can that stayed behind and at zoom 1.4 it was too small -
      // the one part of the title that ignored the camera while being dragged.
      const homeRect = button.getBoundingClientRect();
      if (homeRect.width > 0) ghost.style.width = `${homeRect.width.toFixed(1)}px`;
      document.body.appendChild(ghost);
      carrying = {
        action,
        button,
        ghost,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
    });
    careBar.addEventListener('pointermove', onCarryMove);
    careBar.addEventListener('pointerup', onCarryEnd);
    careBar.addEventListener('pointercancel', onCarryEnd);
    // A capture can be taken away (a window losing focus, another capture on the
    // same pointer). Without this the carried prop stayed on screen forever.
    careBar.addEventListener('lostpointercapture', dropGhost);
    // Keyboard: Enter on a prop is a click with no pointer count, and a pointer tap
    // never reaches here because the pointerdown above takes the gesture.
    careBar.addEventListener('click', (event) => {
      if (event.detail !== 0) return;
      const button = propButton(event.target);
      const action = button?.dataset.care as CareAction | undefined;
      if (button && action) applyProp(action, button);
    });

    paintCare(false);

    // Cloud shadows pass over the soil, so the ground has weather on it.

    this.cloudShadow = document.createElement('div');
    this.cloudShadow.className = 'pl-menu__cloudshadow';
    this.cloudShadow.innerHTML = cloudShadows()
      .map(
        (shadow) =>
          '<i style="left:' +
          shadow.left.toFixed(1) +
          '%;top:calc(var(--pl-horizon) + ' +
          shadow.top +
          '%);width:' +
          shadow.width.toFixed(1) +
          'vw;opacity:' +
          shadow.opacity.toFixed(2) +
          ';--pl-shadow-cross:' +
          shadow.crossS +
          's;--pl-shadow-delay:' +
          shadow.delayS +
          's"></i>',
      )
      .join('');
    this.screenLayerEl().appendChild(this.cloudShadow);

    // Two light passes over everything in the world: a warm glow around the sun,
    // and a cool night wash. They sit above the plant so its leaves are lit by the
    // same light as the hills, and they never take the pointer.
    this.sunWash = document.createElement('div');
    this.sunWash.className = 'pl-menu__wash pl-menu__wash--sun';
    this.screenLayerEl().appendChild(this.sunWash);

    this.nightWash = document.createElement('div');
    this.nightWash.className = 'pl-menu__wash pl-menu__wash--night';
    this.screenLayerEl().appendChild(this.nightWash);

    // Warmth on the ground where the plant stands, under the light passes so the
    // hour still decides how warm it reads.
    const cozy = document.createElement('div');
    cozy.className = 'pl-menu__cozy';
    this.screenLayerEl().appendChild(cozy);

    // Pollen. Placed once from a fixed table rather than at random, so the same
    // meadow is the same meadow on every visit and nothing pops in on reload.
    const motes = document.createElement('div');
    motes.className = 'pl-menu__motes';
    const moteLayout = [
      { left: 12, top: 62, size: 3, duration: 17, delay: -3, drift: 22, alpha: 0.5 },
      { left: 21, top: 71, size: 2, duration: 22, delay: -11, drift: -16, alpha: 0.38 },
      { left: 33, top: 58, size: 4, duration: 15, delay: -7, drift: 28, alpha: 0.44 },
      { left: 41, top: 76, size: 2, duration: 24, delay: -19, drift: -24, alpha: 0.3 },
      { left: 48, top: 64, size: 3, duration: 19, delay: -2, drift: 14, alpha: 0.55 },
      { left: 57, top: 72, size: 2, duration: 21, delay: -14, drift: -20, alpha: 0.36 },
      { left: 64, top: 60, size: 3, duration: 16, delay: -9, drift: 26, alpha: 0.48 },
      { left: 72, top: 69, size: 4, duration: 23, delay: -5, drift: -18, alpha: 0.4 },
      { left: 81, top: 57, size: 2, duration: 18, delay: -16, drift: 20, alpha: 0.33 },
      { left: 89, top: 74, size: 3, duration: 20, delay: -12, drift: -26, alpha: 0.52 },
    ];
    for (const mote of moteLayout) {
      const dot = document.createElement('i');
      dot.style.left = `${mote.left}%`;
      dot.style.top = `${mote.top}%`;
      dot.style.width = `${mote.size}px`;
      dot.style.height = `${mote.size}px`;
      dot.style.animationDuration = `${mote.duration}s`;
      dot.style.animationDelay = `${mote.delay}s`;
      dot.style.setProperty('--pl-mote-drift', `${mote.drift}px`);
      dot.style.setProperty('--pl-mote-alpha', String(mote.alpha));
      motes.appendChild(dot);
    }
    this.screenLayerEl().appendChild(motes);

    // Foreground: out-of-focus blades at the bottom edge and a vignette. They put
    // the camera inside the scene instead of in front of a flat backdrop.
    // The blades are an SVG that the drag moves every frame, and an SVG inside a
    // transformed layer is re-rasterised rather than moved - gradient fills and
    // all. Baked into a bitmap it is one picture the compositor can slide. It is
    // re-baked whenever the palette moves the wood's colour, which is the only
    // thing in this art that changes.

    this.vignette = document.createElement('div');
    this.vignette.className = 'pl-menu__vignette';
    this.screenLayerEl().appendChild(this.vignette);

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
    this.mountFrameMeter();
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
      note.className = 'pl-menu__popover-note';
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
      this.options.onDiagnostic?.('avatar.picked', { bytes: file.size, type: file.type });
      // A ceiling on what gets decoded at all. The picture is shrunk to the size
      // an avatar is drawn at before it is stored (see `storeAvatar`), so this is
      // only a guard against handing the decoder something pathological.
      if (file.size > 8 * 1024 * 1024) {
        this.options.onDiagnostic?.('avatar.rejected', { bytes: file.size });
        this.showError('That image is larger than 8 MB.');
        return;
      }
      this.storeAvatar(file);
    });
    input.click();
  }

  /**
   * Shrink a picked picture to the size an avatar is drawn at, then store that.
   *
   * The file's own data URL used to be stored and drawn as-is, which put a
   * multi-megabyte base64 string in a localStorage bucket shared with the
   * session. The pixels matter more than the bytes, though: a phone photo is
   * 4000x3000, so decoding it allocates a 48 MB bitmap in the renderer before
   * anything shrinks it, and the file itself can be well under 200 KB. Asking
   * for the decode at 512 px wide bounds that allocation at about a megabyte,
   * while still leaving four times the pixels a 128 px crop can use.
   */
  private storeAvatar(file: File): void {
    if (typeof createImageBitmap === 'function') {
      createImageBitmap(file, { resizeWidth: AVATAR_DECODE_PX, resizeQuality: 'high' })
        .then((bitmap) => {
          this.commitAvatar(bitmap, bitmap.width, bitmap.height);
          bitmap.close();
        })
        // SVG has no bitmap size to decode to, and an older browser has no
        // createImageBitmap at all: those take the ordinary image path.
        .catch(() => this.decodeAvatarUrl(file));
      return;
    }
    this.decodeAvatarUrl(file);
  }

  /** The unbounded decode, for a format or browser that has no bounded one. */
  private decodeAvatarUrl(file: File): void {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.addEventListener('error', () => {
      URL.revokeObjectURL(url);
      this.options.onDiagnostic?.('avatar.error', { bytes: file.size, type: file.type });
      this.showError('That file is not an image we can use.');
    });
    image.addEventListener('load', () => {
      URL.revokeObjectURL(url);
      this.commitAvatar(image, image.width, image.height);
    });
    image.src = url;
  }

  /** Cover-crop the decoded picture, encode it small, and store that. */
  private commitAvatar(source: CanvasImageSource, sourceWidth: number, sourceHeight: number): void {
    const size = AVATAR_DRAW_PX;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Cover crop: fill the square from the middle instead of squashing it.
    const width = Math.max(1, sourceWidth);
    const height = Math.max(1, sourceHeight);
    const scale = Math.max(size / width, size / height);
    ctx.drawImage(
      source,
      (size - width * scale) / 2,
      (size - height * scale) / 2,
      width * scale,
      height * scale,
    );
    // WebP keeps a 128 px photo near a kilobyte; a browser without it encodes
    // PNG instead, which is still small at this size.
    const small = canvas.toDataURL('image/webp', 0.9);
    this.options.onDiagnostic?.('avatar.stored', {
      sourcePx: `${width}x${height}`,
      chars: small.length,
    });
    this.avatar = small;
    this.renderProfileButton();
    this.renderPopover();
    this.options.onProfileChange?.({ avatar: small });
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
    // The title is mounted before the 3D world finishes booting, and Play waits
    // for it: pressing Enter in the name field is not a way around that.
    if (this.root.dataset.step === 'booting') return;
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
  /** Dev-only frame meter: its loop and its callback, if one was mounted. */
  private frameMeterRaf = 0;
  private frameMeterTick: ((now: number) => void) | null = null;

  /**
   * Dev only: what this screen is actually costing per frame.
   *
   * The title parks every script loop when it is still, so it has no frame budget of
   * its own to report. This meter asks for its own frames and reports the interval
   * between them - the number to bring back is the *worst* one, because it is hitches
   * that read as lag, not the average. Built out of the app in a production build.
   */
  private mountFrameMeter(): void {
    if (!import.meta.env.DEV) return;
    const el = document.createElement('div');
    el.className = 'pl-frame-meter';
    el.setAttribute('role', 'status');
    this.root.appendChild(el);
    const stack: number[] = [];
    let last = performance.now();
    let text = '';
    this.frameMeterTick = (now: number): void => {
      const dt = now - last;
      last = now;
      // A hidden tab stops animation frames; the first frame after it returns
      // carries the whole background gap and was reported as a "worst frame" of
      // several minutes. That is a pause, not a frame: drop the window and start
      // measuring again instead of poisoning the meter.
      if (document.visibilityState !== 'visible' || dt > 1000) {
        stack.length = 0;
        this.frameMeterRaf = requestAnimationFrame(this.frameMeterTick as FrameRequestCallback);
        return;
      }
      stack.push(dt);
      if (stack.length > 300) stack.shift();
      if (stack.length % 10 === 0) {
        const sorted = [...stack].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
        const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
        const worst = sorted[sorted.length - 1] ?? 0;
        const next =
          `${median.toFixed(1)}ms · ${Math.round(1000 / Math.max(1, median))}fps` +
          ` · p95 ${p95.toFixed(0)}ms · worst ${worst.toFixed(0)}ms`;
        if (next !== text) {
          text = next;
          el.textContent = text;
        }
      }
      this.frameMeterRaf = requestAnimationFrame(this.frameMeterTick as FrameRequestCallback);
    };
    this.frameMeterRaf = requestAnimationFrame(this.frameMeterTick as FrameRequestCallback);
  }

  private setFrameMeter(on: boolean): void {
    if (!this.frameMeterTick) return;
    cancelAnimationFrame(this.frameMeterRaf);
    this.frameMeterRaf = 0;
    if (on) this.frameMeterRaf = requestAnimationFrame(this.frameMeterTick as FrameRequestCallback);
  }

  private setTitleActive(active: boolean): void {
    if (this.titleActive === active) return;
    this.titleActive = active;
    this.setFrameMeter(active);
    // Park every animation on the title while the world owns the screen. The 2D
    // title stays mounted behind the 3D scene, and its sway, cloud drift, star
    // shimmer and motes kept animating and compositing underneath the running
    // game - free work for the browser to do at the exact moment it has a world to
    // draw. Paused, they cost nothing and resume where they were.
    this.root.classList.toggle('is-title-parked', !active);
    this.scene.setActive(active);
    this.plant.setActive(active);
    if (active) {
      // Its rendering was skipped while the world had the screen, so a resize during
      // that time could not be measured (fitToPane refuses a zero-sized pane) and
      // the title would come back at the old window's scale. Unhide, then re-fit.
      this.root.hidden = false;
      this.fitToPane();
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
    // The sky may take at most its share of the pane (see `skyGroundPx`): the menu
    // has to stand somewhere, so the ground band grows with the pane instead of
    // being a flat 96 px that let the line slide to the bottom of a tall window.
    const ground = skyGroundPx(paneH);
    // The cap has to know how big the plant *ends up*. Care takes the drawing to
    // PLANT_MAX_SCALE, and a cap derived from the seed-sized art is one the grown
    // tree walks straight through - which is how the crown ended up above the top
    // of the pane while the cap insisted there was room.
    // A real tree, not a sapling that fits a window: the budget is the sky you can
    // reach by pulling the camera back (1.2 panes), so at the default zoom the tree
    // fills the sky above the soil and its crown is a little above the frame, and a
    // step back frames the whole thing.
    // A taller tree: the reserved sky was 90% of the pane minus the ground, which
    // left the grown plant noticeably shorter than the space it stood in. The
    // horizon rule below still owns the line, and this only fills the sky that is
    // already there - at 96% the crown clears the top edge and the whole tree is
    // framed without pulling the camera back.
    // 0.84 rather than 0.96: a tree that fills every pixel of the sky above the
    // ground reads as a close-up of one. The smaller share leaves air over the
    // crown, which is what makes it a tree standing in a field.
    const maxWidth = mascotMaxWidthPx(paneH * 0.84, ground, 84, PLANT_MAX_SCALE);
    this.root.style.setProperty('--pl-mascot-max', `${Math.round(maxWidth)}px`);
    // offsetHeight ignores transforms, so the care scale has to be applied by hand:
    // otherwise the ground line answers to the plant's seed size while the tree is
    // drawn at up to 1.6x above it.
    const careScale = Number(this.plant.element.style.getPropertyValue('--pl-care-scale')) || 1;
    const plantPx =
      (this.plant.element.offsetHeight || Math.round(maxWidth * PLANT_ART_ASPECT)) * careScale;
    const horizon = horizonForPane({
      viewportPx: paneH,
      fraction: this.options.ui.titleHorizonFraction,
      plantPx,
      minGroundPx: ground,
    });
    this.root.style.setProperty('--pl-horizon', `${Math.round(horizon)}px`);
    // The world is placed so that its own horizon lands on this line at zoom 1: one
    // number for the camera's home position and for the interface that stands under
    // the plant in screen space.
    this.root.style.setProperty('--pl-horizon-base', `${Math.round(horizon)}px`);

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
    // The world's own weather token, from the same /world/time poll that already
    // carries the clock. The title used to invent its sky from (day, hour), which
    // meant standing in a storm in the game and watching a clear title behind it.
    let worldWeather: string | null = null;
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
    /** When `clock.timeOfDay` was last set, so the hour can be read off between ticks. */
    let clockAtMs = lastMs;
    // No invented sky: an unknown hour keeps the world out of sight until the
    // server answers (or the request fails, when the fallback hour is honest).
    if (!known) this.world.classList.add('is-sky-pending');
    const revealSky = (): void => this.world.classList.remove('is-sky-pending');

    // Writes to the menu root, deduped: the sky is a few dozen custom properties
    // on an element with two thousand descendants, and rewriting them for values
    // that have not moved invalidates the style of the whole title (measured: 12 ms
    // of recalculation per tick, ten times a second). Only a value that changed is
    // written, and only the arbiter of the sky ever writes.
    const vars = createStyleVarWriter(() => this.paletteHosts());
    // The plant's own light, written on the plant.
    //
    // These properties are read inside the drawing and by the root runs on the
    // soil. Sent to the palette hosts they also land on the UI layer and the sky
    // band, which inherit a new value for a property none of them uses - and a
    // custom property on an ancestor invalidates its descendants all the same. One
    // writer per reader keeps the crown's grade off the sky.
    const plantVars = createStyleVarWriter(() => [
      this.plant?.element ?? null,
      this.root.querySelector<HTMLElement>('.pl-menu__root-runs'),
    ]);
    // The sky moves in steps. Its clock is continuous, but the eye cannot see a
    // palette move by one byte: quantising the hour to 1/1024 of a day means the
    // derived colours, sun position and light washes only change when the sky
    // visibly does - a few times a minute rather than ten times a second - and the
    // dedupe writer below skips every tick in between.
    // The palette's quantum. Every step that changes a colour rewrites about
    // twenty custom properties on the menu root, and everything that reads one
    // repaints: at 512 steps over a day that was a visible freeze every three
    // quarters of a second. At 128 the recolour is still a smooth drift to the eye
    // and lands four times less often.
    // Measured, not guessed: at 128 steps the largest colour move between two
    // adjacent steps is 6 levels of 255 - and it lands at dawn and at dusk, where
    // the sky changes fastest, which reads as a step in the gradient rather than a
    // drift. At 256 that is 3 levels, which is not perceptible on a gradient, and a
    // step costs one style recalculation of the menu (measured 8.8 ms) every 14 s
    // at the default cycle. 512 would be 2 levels for twice the writes.
    // Palette steps per day. Every step that changes a value restyles the whole
    // menu subtree (about 1.8k elements) and that pass measured as a 150-250 ms
    // frame at dpr 1.425 - the title's periodic hitch. 256 steps on a 3600 s day
    // walked into a new step every fourteen seconds; 128 walks one every
    // twenty-eight, half the hitches for a step far finer than the eye reads at
    // dusk. See `title/styleVars.ts` for why the writes cannot be spread out
    // instead: the cost is per pass, not per property.
    const SKY_STEPS = 128;
    // The ground's own clock. A sky step that changes a soil colour re-rasterises the
    // stage's seventeen gradient layers (measured: 200 of the 250 ms a step cost);
    // the sky's colours live in one gradient over the same pane, which is cheap. So
    // the cut face moves on a sixteenth of the day's steps - a dark, slowly changing
    // plane the eye cannot track anyway - and the sky keeps its fine step.
    const GROUND_STEPS = 16;
    // The discs are no longer quantised at all. There used to be a step count here
    // (4096) so that a step landed under a pixel; it did not matter, because the
    // discs now move on their own frame loop with a translate that only reaches the
    // two halo layers (see paintOrbs), and a translate is free to update sixty times
    // a second. What the discs must NOT do is drag the palette's twenty custom
    // properties on the menu root along with them once a second.
    // Dev-only pins. `?dev=1` gets `window.__plTitle.setHour(phase)` and
    // `setWeather(state)`, so one state - dusk, a moonlit night, a snowfall - can be
    // looked at without walking the world clock there. Null means follow the world.
    let pinnedHour: number | null = null;
    let pinnedWeather: TitleWeather | null = null;
    const hourNow = (): number => pinnedHour ?? clock.timeOfDay;
    // The hour as it is *now*, not as it was at the last tick.
    //
    // The clock advances once a second, and the discs were reading it directly: a
    // body that crosses the sky in about a minute therefore moved in one-second
    // hops of eight or ten pixels and stood still in between - the twitch. Read
    // between ticks, it glides. The library's own elapsed time is extrapolated at
    // the clock's scale, which is exactly what `skyTick` does with its own dt.
    // How far a body may be held still rather than whipped backwards. A real jump
    // (a pinned hour, a paused world, a dev time change) is accepted; anything
    // under this is the tick landing behind the extrapolation below.
    // The backstep hold is the window in which a tick that landed behind the
    // extrapolation is absorbed. It used to be 0.02 day - twenty-nine minutes of
    // a twenty-four hour clock - so any shortfall froze both discs for that long.
    // A tick can only be behind by its own clamped dt (a couple of seconds of
    // world time), which is a thousandth of a day, so this holds for at most a
    // few frames and never reads as a stopped sky.
    const ORB_BACKSTEP_SNAP = 0.0015;
    let lastOrbPhase = -1;
    const hourAt = (nowMs: number): number => {
      if (pinnedHour !== null) {
        lastOrbPhase = pinnedHour;
        return pinnedHour;
      }
      let phase = clock.timeOfDay;
      if (!clock.paused && clock.scale !== 0) {
        const seconds = (nowMs - clockAtMs) / 1000;
        phase = wrapDayFraction(phase + (seconds * clock.scale) / cycleS);
      }
      // The discs only ever move forwards.
      //
      // The sky tick advances the clock by a *clamped* dt (a hidden tab, a stalled
      // frame) while this extrapolates the full elapsed time since the last tick, so
      // at each tick the extrapolation could be ahead of the clock it lands on. The
      // bodies read that phase sixty times a second: a tick landing behind them
      // whipped the sun and moon back across the sky, then forward again - the
      // flicker that looked random because it ran at the tick's own rhythm. When the
      // clock lands behind, the sky holds still and lets the world catch up; only a
      // jump past ORB_BACKSTEP_SNAP (a pinned hour, a paused world) is taken.
      if (lastOrbPhase >= 0) {
        const forward = shortestDayDelta(phase, lastOrbPhase);
        if (forward > 0 && forward < ORB_BACKSTEP_SNAP) return lastOrbPhase;
      }
      lastOrbPhase = phase;
      return phase;
    };
    const render = (): void => {
      const skyTime = Math.round(hourNow() * SKY_STEPS) / SKY_STEPS;
      const palette = paletteAt(skyTime);
      const groundTime = Math.round(hourNow() * GROUND_STEPS) / GROUND_STEPS;
      // How dark the sky is, for the things that must not outlive the light. The moon
      // is one: see `paintOrbs`.
      lastStar = palette.star;
      // The world's weather when the server has answered, so the title and the game
      // stand under one sky; the title's own clock-driven table only fills in before
      // the first answer, or when there is no server at all.
      const weather =
        pinnedWeather ??
        weatherFromState(worldWeather) ??
        weatherBetween(
          clock.timeOfDay,
          Math.floor(performance.now() / 1000 / Math.max(60, cycleS)),
        );
      this.scene.setWeather(weather);
      this.root.classList.toggle('is-windy', weather.wind > 0.6);
      // Storm strength for the light pass: rain, or enough cloud to mean it. The
      // title used to keep a bright sun, a warm horizon bloom and a golden wash
      // while a downpour fell out of the sky.
      const storm = Math.min(
        1,
        Math.max(weather.rain, Math.max(0, weather.cloudiness - 0.35) * 1.15),
      );
      const daylight = 1 - Math.min(1, palette.star);
      const sunBody = sunPosition(hourNow());
      const moonBody = moonPosition(hourNow());
      const sunX = sunBody.x;
      const groundPalette = paletteAt(groundTime);
      // The verge follows the world's season, not the hour: the flowers change when
      // the calendar does.
      this.scene.setSeason(this.options.season?.() ?? 0);
      this.scene.setPalette(palette, groundPalette);
      // The world's light grade, one pass: the sun glow fades, the moon halo
      // grows, the night pass comes up, and the leaves take the same cast as the
      // hills. All of it is derived from the palette in `titleLighting`.
      const light = titleLighting(palette);
      // The plant is graded on the ground's clock, not the sky's.
      //
      // Its grade is an SVG filter over nine hundred nodes: writing one of these
      // numbers restyles and repaints the whole drawing (measured 40 ms of style
      // recalculation here, 70-170 ms for a full plant write). Every sky step used
      // to move them by a hundredth, so the once-a-step hitch was mostly the plant.
      // Read from the same 1/16-of-a-day palette as the soil it stands in, they move
      // once every ground step instead, and the writer's dedupe skips the rest.
      const groundLight = titleLighting(groundPalette);
      plantVars.set('--pl-plant-dim', groundPalette.plantDim.toFixed(2));
      plantVars.set('--pl-plant-sat', groundLight.plantSaturation.toFixed(2));
      // The sun's wash is the sun's own light, so it cannot outlive the disc. The
      // palette's glow fades more slowly than the dusk does, and the wash is a
      // full-pane screen blend: for a few minutes every evening the whole title
      // turned bright yellow with no sun in the sky. The lift is the disc's height
      // above the horizon, so the wash goes out as the sun sets.
      const sunLift = sunWashGate(sunBody);
      vars.set('--pl-sun-wash', (light.sunWash * sunLift * (1 - storm * 0.72)).toFixed(2));
      vars.set('--pl-moon-wash', light.moonWash.toFixed(2));
      vars.set('--pl-night-wash', light.nightWash.toFixed(2));
      plantVars.set('--pl-plant-sepia', groundLight.plantSepia.toFixed(2));
      plantVars.set('--pl-plant-hue', `${groundLight.plantHue.toFixed(0)}deg`);
      // Depth and air: the horizon glow, the haze on the hills, the band of stars,
      // the cloud shadows crossing the soil and the lit edge of the leaves.
      vars.set('--pl-bloom', (light.bloom * (0.3 + 0.7 * sunLift) * (1 - storm * 0.65)).toFixed(2));
      // The veil over the picture: on in rain and heavy cloud, off when the sky
      // clears, and heavier by day where there is more sun to take away.
      vars.set('--pl-mood', (storm * (0.26 + 0.3 * daylight)).toFixed(2));
      // Lightning is strongest at night, where a flash is the only light there
      // is, and merely a pale sky by day.
      vars.set('--pl-flash', (storm * (0.14 + 0.22 * (1 - daylight))).toFixed(2));
      vars.set('--pl-haze', light.haze.toFixed(2));
      vars.set('--pl-milkyway', light.milkyWay.toFixed(2));
      vars.set('--pl-cloud-shadow', light.cloudShadow.toFixed(2));
      // Fireflies are the one thing left that wants the hearth's old switch - and
      // they want it the right way round: up with the stars, gone by day.
      vars.set('--pl-fireflies', Math.min(1, palette.star * 0.9).toFixed(2));
      // Everything written to the plant comes from the ground clock: it is one
      // drawing and one grade, and a sky-clock value here would restyle all 923 of
      // its nodes on every sky step again.
      plantVars.set('--pl-leaf-rim', groundLight.leafRim);
      plantVars.set('--pl-leaf-rim-opacity', groundLight.leafRimOpacity.toFixed(2));

      // Light through the leaves. Two versions (title/leafThroughLight): the moon
      // behind a thin blade is a cold silver, a low sun is warm honey, and neither
      // is a beam - a glow behind the crown and a little light inside each leaf.
      // Rain and cloud scatter it before it arrives, so a storm keeps the leaves
      // as opaque as they look.
      const through = leafThroughLight(groundPalette, sunBody, moonBody);
      // Rain scatters sunlight; it does not switch the moon off. The gate used to
      // apply to whichever disc won, so a shower that was not even over the moon dimmed
      // its light - the "why did the moonlight go" case.
      const throughGate = through.source === 'moon' ? 1 - storm * 0.08 : 1 - storm * 0.7;
      // Paper and torchlight, in the title's own drawing: the per-leaf overlay is
      // screened over every blade and its opacity is this number, so a moon behind
      // the crown lights the canopy from within. `top` is that moon (over the
      // trunk's column); `amount` is the sideways transmission at rise and set.
      plantVars.set(
        '--pl-leaf-through',
        // 0.42, not 0.7: screened over a blade this overlay is nearly white, and
        // at 0.48 the midnight canopy read as grey card rather than as a green
        // leaf with light in it.
        Math.min(
          0.34,
          through.amount * throughGate * 0.55 + through.top * throughGate * 0.28,
          // Two decimals, not three: the sun and moon crawl, so a third decimal
          // moved on most sky steps and repainted the canopy's overlay for it.
        ).toFixed(2),
      );
      // A leaf lit from behind is still a leaf. Screened blue-white over green
      // goes grey - the midnight canopy read as card - so after dark the
      // transmission is pulled towards pale leaf green, most of the way under a
      // full moon.
      plantVars.set(
        '--pl-leaf-through-colour',
        lerpHex(through.colour, '#d8e8b0', groundPalette.star * 0.7),
      );
      // The disc behind the crown, which is where the top light comes from: the
      // pool behind the canopy swells and rises towards the crown's top, so a moon
      // coming over the tree lights its upper reaches instead of appearing in the
      // gaps at trunk height.
      const crownTop = through.top * throughGate;
      // Capped: this is the pool behind the canopy, and at 0.53 it read as a lamp
      // switched on behind the tree rather than as light in the leaves.
      plantVars.set(
        '--pl-crown-glow',
        Math.min(0.34, through.amount * throughGate * 0.7 + crownTop * 0.22).toFixed(2),
      );
      plantVars.set('--pl-crown-top', crownTop.toFixed(2));

      // The plant's own grade, on the two drawings (see the filter rules in
      // TitlePlant): cool and dark under the moon, warm at golden hour, pale and
      // flat under snow, grey in a downpour, and always a touch dimmer in the rain
      // than out of it.
      const night = groundPalette.star;
      const snowing = weather.kind === 'snow' ? weather.rain : 0;
      // Night: the canopy is lit by the moon alone, so it loses brightness with a
      // knee - the first third of the dark is dusk, which still has the sky's light
      // in it, and past that it falls fast. The old numbers (0.32 dim, 0.22
      // desaturate) left a midday-green tree standing in a night sky: bright and
      // flat, which is exactly what the night screenshot showed. Measured against
      // that screenshot, a canopy at 0.45-0.55 brightness and about a quarter less
      // green is what reads as moonlight.
      // Night: the canopy is lit by the moon alone. At 0.88 through the night the
      // canopy is 0.42 of the daylight value and 0.62 of its green, and at midnight
      // 0.30 and 0.55 - a green kept at 0.53 and three quarters saturation still read
      // as a daylight tree with the lamp off, which is what the before/after shot at
      // 21:00 showed.
      //
      // Both floors are above zero on purpose. The plant is the one thing in the
      // title that is graded by a filter rather than drawn from the palette, and a
      // filter multiplies: at 0.22 (canopy) and 0.12 (roots) the green and the bone
      // came out as #040806 and #1c1a17 - black shapes in a scene where the hills
      // and the soil still had colour, which is what "the root is pitch black at
      // night" was. Moonlight is dim, not absent: the canopy keeps 0.44 of its
      // value and the roots 0.5, so they read as dark and moonlit rather than as
      // holes.
      //
      // The roots are the palest thing in the drawing, so the same floor that
      // rescues the canopy turns them cream: at 0.5 they read brighter than the
      // hills under a moon that is meant to be the light. They keep 0.34 - clearly
      // moonlit bone, well under the canopy's lit side.
      const nightDim = Math.max(0.44, 1 - night * 0.42 - Math.max(0, night - 0.3) * 0.2);
      // 0.55, not 0.34: the static roots and the runs that reach to the treasures
      // share this number, and below half the bone pigment stops being grey-stone
      // and becomes a black line. They are the same root system; they read the same.
      const rootsDim = Math.max(0.55, 1 - night * 0.45);
      const weatherDim = (1 - storm * 0.12) * (1 + snowing * 0.08);
      // Two decimals, not three: the plant's grade is an SVG filter over nine
      // hundred nodes, and it re-rasterises the drawing every time any of these
      // numbers changes. At three decimals the palette moved them a thousandth
      // every sky tick, so the title froze for ~180 ms once a second for a change
      // no eye can see. A hundredth is below the threshold of the drawing.
      plantVars.set('--pl-shoot-bright', (nightDim * weatherDim).toFixed(2));
      // Wood is older than leaf and keeps more of its colour: 0.62 is the floor at
      // which bark still reads brown, and the branches take the same number so the
      // tree cannot be a black trunk with grey twigs.
      plantVars.set('--pl-trunk-bright', Math.max(0.62, nightDim * weatherDim).toFixed(2));
      // The roots are the lightest thing in the drawing, so at night they need more
      // dimming than the canopy to stop reading as cream roots under a full moon.
      plantVars.set('--pl-roots-bright', (rootsDim * weatherDim).toFixed(2));
      // Moonlight has a side. The crown takes its lit rungs on the half of the tree the
      // moon is over and its shaded ones on the other, so the night tree is lit from
      // somewhere instead of being one flat dark shape - and the lit side swings as
      // the moon crosses the sky.
      // Hysteresis, not a bare threshold: the moon crosses x = 0.5 on its way over the
      // tree, and a threshold that flips on the exact value flickers whenever the arc
      // wobbles by a thousandth either side of it. The side only changes once the moon
      // is 3% of the arc past the middle, and it swaps once per night.
      const wanted = moonBody.x < 0.5 - 0.03 ? 'left' : moonBody.x > 0.5 + 0.03 ? 'right' : null;
      if (wanted) this.moonSideShown = wanted;
      const moonLit = night > 0.32 && moonBody.visible ? this.moonSideShown : null;
      this.plant?.setMoonLit(moonLit);
      plantVars.set(
        '--pl-shoot-sat',
        Math.max(0.5, (1 - night * 0.68) * (1 - storm * 0.22) * (1 - snowing * 0.3)).toFixed(2),
      );
      plantVars.set('--pl-shoot-sepia', (groundLight.plantSepia * 0.85).toFixed(2));
      // `|| 0` folds -0: `(-0.02).toFixed(0)` prints "-0deg", which is a valid but
      // silly hue and made every comparison read it as a typo. The cool turn is
      // pushed further at night: a green left at hue 0 under a blue sky is the
      // daylight mascot with the lamp off.
      // Hue: the palette's own turn, then a further cool push that only exists
      // after dark. Green is the one hue that survives a dim-and-desaturate, so the
      // only way a moonlit canopy stops being green is to rotate it towards teal.
      const nightHue = groundLight.plantHue * (1 + night * 0.55) - night * 16;
      plantVars.set('--pl-shoot-hue', `${Math.round(nightHue) || 0}deg`);
      // The rim of the leaves and the near silhouettes follow the light too.
      // Written on the plant's own element. On the menu root it was one more
      // property whose every step recalculated two thousand descendants.
      // Whole pixels, not quarter pixels. This is written on the plant element, which
      // is 921 SVG nodes with filters: a write restyles and repaints all of them and
      // measured 70-170 ms. The sun moves enough for a quarter-pixel step on most of
      // the two-second ticks, so the title stuttered every two seconds whether or not
      // the sky had visibly changed - the source of the "every few seconds" hitch.
      // The rim offset spans five pixels across a day; a whole pixel is one step every
      // twelve minutes and no one can see the difference.
      this.plant.element.style.setProperty('--pl-plant-rim-x', `${Math.round((sunX - 0.5) * 5)}px`);
      // The soft bar behind the wordmark. It is a *fill* light, not a source: at
      // night it sat behind the trunk with the moon behind it, a bright warm blob
      // in the middle of the ground brighter than either disc. It now exists only
      // while there is sun to justify it.
      vars.set('--pl-title-glow', ((0.22 + light.sunWash * 0.5) * (1 - palette.star)).toFixed(2));
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

    // The bodies move every frame, on their own loop, and touch nothing but the
    // two halos and their own two transforms. The palette still moves on the slow
    // tick above: colour is a twenty-property rewrite of the title's root and
    // belongs at a palette step, not on a frame. This split is what removed the
    // once-a-second pause: the sky used to advance its discs on the same tick that
    // recoloured the whole title, so it held still, then stepped.
    let lastSunKey = '';
    let lastMoonKey = '';
    /** The palette's star field value: 0 in daylight, 1 at night. */
    let lastStar = 1;
    // Four samples a second, on a timer, with a CSS transition carrying the body
    // from one sample to the next. The transition runs on the compositor, so the
    // discs glide continuously while the script writes four positions a second - and
    // while the scene is still, the tab asks for no animation frame at all. A frame
    // loop here was the wrong shape twice over: it kept a nearly static title
    // requesting sixty frames a second (which starves the compositor this browser
    // runs on, and with it the app around it) and it did the smoothing with script,
    // which is the most expensive way to move two dots.
    const ORB_INTERVAL_MS = 250;
    const paintOrbs = (phaseOverride?: number): void => {
      const phase = phaseOverride ?? hourAt(performance.now());
      const sunBody = sunPosition(phase);
      const moonBody = moonPosition(phase);
      // The moon answers to the light, not to the clock. Both are driven by the same
      // hour, but the palette interpolates across dawn and dusk, so there is a band
      // of sky that is plainly bright while the clock still counts it as night - and
      // a full moon hung in it. It now fades with the dark: nothing below a quarter
      // dark, half strength at dusk, whole only in a real night sky. Above that it is
      // not drawn at all, which is what "there is a moon and it is day" was.
      const moonDark = moonBrightness(lastStar);
      const sunKey = `${sunBody.x.toFixed(4)}:${sunBody.y.toFixed(4)}:${sunBody.visible}`;
      // `moonDark` is part of the key: two positions can be identical while the sky
      // has moved from dusk to dark under them, and the old key kept the moon at its
      // dusk opacity forever after a clock jump.
      const moonKey = `${moonBody.x.toFixed(4)}:${moonBody.y.toFixed(4)}:${moonBody.visible}:${moonDark.toFixed(2)}`;
      if (sunKey === lastSunKey && moonKey === lastMoonKey) return;
      lastSunKey = sunKey;
      lastMoonKey = moonKey;
      this.scene.setCelestial(
        sunBody,
        moonBody.visible && moonDark > 0.02
          ? { ...moonBody, opacity: moonDark }
          : { ...moonBody, visible: false },
      );
    };
    // The discs move every frame, and their layout only on the slow clock.
    //
    // `setCelestial` places them with percentages, which is what keeps them on the
    // arc through a zoom or a drag but is a layout - so it can only run on
    // `ORB_INTERVAL_MS`. At ten seconds a body that moves a tenth of a percent a
    // minute was still hopping a couple of pixels every hop, and the clouds beside
    // it crossed smoothly. The difference between where the body is and where the
    // disc is drawn goes out as a translate on two promoted elements, sixty times a
    // second: the arcs are identical, only the cost differs.
    this.paintOrbs = (): void => {
      if (this.orbTimer !== 0) return;
      // One loop carries both clocks: the motion every frame, the layout every
      // `ORB_INTERVAL_MS`. Two timers for one job was one piece of state too many.
      let lastLayout = 0;
      const loop = (now: number): void => {
        if (this.orbTimer === 0) return;
        const phase = hourAt(now);
        // The layout first, then the translate that carries the disc off it.
        //
        // The smooth pass reads the step the disc is *drawn* at from its own
        // custom properties, so the layout has to have run for this frame before
        // the offset is written against it. The old order wrote the offset
        // against the previous step and then moved the step: one step of travel
        // applied twice, then corrected on the next frame - the disc jumped and
        // was pulled back every quarter second. `orbPlacement.ts` pins the order
        // with a test.
        if (now - lastLayout >= ORB_INTERVAL_MS) {
          lastLayout = now;
          paintOrbs(phase);
        }
        this.scene.setCelestialSmooth(sunPosition(phase), moonPosition(phase));
        this.orbTimer = requestAnimationFrame(loop);
      };
      this.orbTimer = requestAnimationFrame(loop);
    };
    this.stopOrbs = (): void => {
      cancelAnimationFrame(this.orbTimer);
      this.orbTimer = 0;
      lastSunKey = '';
      lastMoonKey = '';
    };

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
        if (gap > SNAP_DAYS) {
          // A real jump - a paused world, a dev time change - and it is forwards.
          next = { ...next, timeOfDay: projected };
        } else if (gap > 0) {
          // A correction this small is a slight change of pace, never a jump.
          const share = Math.min(1, dtSeconds / DRIFT_SECONDS);
          next = { ...next, timeOfDay: wrapDayFraction(next.timeOfDay + gap * share) };
        }
        // A negative gap means the world's clock is *behind* this sky's. It used to
        // be snapped back - which is the moon travelling backwards - or eased
        // backwards, which is the same thing slower. The sky waits instead: the
        // world catches up on its next tick, and time only ever moves forwards.
      }
      clock = next;
      clockAtMs = now;
      render();
    };

    this.skySync = async (): Promise<void> => {
      const time = await this.options.fetchWorldTime?.();
      if (!time) {
        // Nothing to sync with: show the fallback hour rather than a hidden world.
        revealSky();
        return;
      }
      worldWeather = time.weather ?? worldWeather;
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
      clockAtMs = lastMs;
      render();
      revealSky();
    };

    void this.skySync();
    this.startSkyTimers();
    render();
    if (known) revealSky();
    // The dev handles live on the sky, not on a test build: they only write the two
    // pins above and call the same `render` the clock calls.
    if (new URLSearchParams(window.location.search).get('dev') === '1') {
      (window as unknown as { __plTitle?: unknown }).__plTitle = {
        hour: hourNow,
        setHour(phase: number): number {
          pinnedHour = ((phase % 1) + 1) % 1;
          // The palette first: the discs fade with the dark, and the dark is the
          // palette's. The layout runs before the smooth pass for the same reason
          // the frame loop does (see `paintOrbs`).
          render();
          paintOrbs(pinnedHour);
          return pinnedHour;
        },
        setWeather(state: string | null): string | null {
          const next = weatherFromState(state);
          pinnedWeather = next;
          render();
          return next?.kind ?? null;
        },
        release(): void {
          pinnedHour = null;
          pinnedWeather = null;
          render();
        },
      };
    }
  }

  private startSkyTimers(): void {
    if (this.destroyed) return;
    this.stopSkyTimers();
    // One poll the moment the title is shown. The interval below is the steady
    // state; without this the sky a player sees when they leave the game is the
    // weather from up to thirty seconds earlier - clear in the cup and raining on
    // the title, or the other way round.
    void this.skySync?.();
    // Every 30 s: often enough that the gap a loaded server opens is small, rare
    // enough to be a poll rather than chatter.
    if (this.skySync) this.skySyncTimer = window.setInterval(() => void this.skySync?.(), 30_000);
    // A fifth of a second is already finer than the eye reads a sky that takes
    // minutes to cross, and every tick that changes a value invalidates the whole
    // menu's style: this is the cheapest frame time in the title screen.
    // One second, not five. Every tick that changes a value rewrites custom
    // properties on an element with a couple of thousand descendants, and the
    // style recalculation that follows is what showed up as a hitch in the
    // parallax: at 200 ms it landed five times a second. The sky takes minutes to
    // cross, so a second between samples moves it under a pixel.
    // Two seconds, not one. Every tick that changes a value rewrites a handful of custom
    // properties on the menu root, and a property the whole tree inherits makes the
    // browser recalculate every node under it: measured at 46-63ms for one style and
    // layout pass. The sky crosses its arc in minutes, so a second and two seconds are
    // the same picture - but half the hitches.
    if (this.skyTick) this.skyTimer = window.setInterval(this.skyTick, 2000);
    // The bodies run on frames, not on that tick: a translate on a promoted layer
    // costs nothing, and at one sample a second the moon stood still and then
    // hopped, which is exactly what it looked like.
    this.paintOrbs?.();
  }

  private stopSkyTimers(): void {
    this.stopOrbs?.();
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
    // The 3D canvas and the film-grain overlay behind this opaque 2D world have
    // nothing to show while the title is up; the stylesheet parks them, so the
    // app is not compositing a full-window WebGL surface behind a picture that
    // covers it.
    document.documentElement.dataset.plEntryStep = state.step;
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
      // Play is disabled until the world has finished booting: the menu is
      // mounted as soon as its own config is ready, and entering a half-built
      // scene is worse than waiting a beat for the button.
      button.disabled =
        (state.busy || state.step === 'booting') && button.dataset.action === 'play';
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
    // Both of these outlive the element they watch: a removed menu that keeps
    // its resize listener and observer is a whole title scene held in memory.
    window.removeEventListener('resize', this.onPaneResize);
    this.paneObserver?.disconnect();
    this.paneObserver = null;
    this.stopSkyTimers();
    this.skyTick = null;
    this.skySync = null;
    cancelAnimationFrame(this.frameMeterRaf);
    this.frameMeterRaf = 0;
    this.frameMeterTick = null;
    this.plant.destroy();
    this.scene.destroy();
    this.root.remove();
  }

  /** Exposed for main.ts: `H` is advertised on the screen, so tests pin it. */
  static isUiHiddenKey(key: string): boolean {
    return key === 'h' || key === 'H';
  }
}
