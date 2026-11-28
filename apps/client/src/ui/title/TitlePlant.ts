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
  GROWTH_POINTS,
  GROWTH_STAGES,
  growthProfile,
  growthStageAlong,
  growthTransitionMs,
  limbGrowAlong,
  resumeGrowth,
} from './growth.ts';
import {
  bendArcPath,
  bendArcSegment,
  bendPlacement,
  bendPoint,
  bendTension,
  limbBaseWidth,
} from './plantBend.ts';
import { createPlantMotion, type PlantMotionState, reactToTouch } from './plantMotion.ts';
import {
  bendDegrees,
  leafSwingSign,
  MAX_BEND_DEG,
  type PlantPart,
  partFromDataset,
  releaseAngle,
  swingAngle,
  type TapResponse,
  tapResponse,
} from './plantReaction.ts';
import { createPlantSound } from './plantSound.ts';
import { rootDepth, rootsMarkup } from './roots.ts';

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
  /** Called after each step of a growth run, so the pane can follow the height. */
  onGrowthChange?: () => void;
  /** Called once a growth run has reached the stage the care earned. */
  onGrowthEnd?: () => void;
}

export interface TitlePlant {
  element: HTMLElement;
  /**
   * How well looked after the plant is, 0..99. With `animate`, the stage is walked
   * over a growth run so leaves open one at a time as the light climbs; without
   * it (a load, a reset) the drawing is simply put at that stage.
   */
  setGrowthStage(stage: number, animate?: boolean): void;
  /** Start or stop the sway loop (it is pointless while the plant is hidden). */
  setActive(active: boolean): void;
  /** React as if the given part was tapped, from an outside trigger. */
  react(part?: PlantPart, index?: number): void;
  /**
   * A gust from outside the plant: a pointer crossing the canopy quickly, or the
   * weather. Pushes the plant like a released drag and lets it spring back, so a
   * fast mouse pass moves the tree the way wind does without grabbing it.
   */
  gust(deg: number): void;
  /**
   * A wind-like rustle through the canopy: a few leaves turn and settle in a wave,
   * with the trunk and the stem left alone. What a fast pointer pass asks for - the
   * plant should answer a passing hand the way it answers a gust of weather, not the
   * way it answers a grab.
   */
  rustle(deg: number, at?: { x: number; y: number }): void;
  /**
   * Which side of the sky the moon is on, or null by day.
   *
   * The crown's shade ladder swings with it: the half under the moon takes its lit
   * rungs and the other half its shaded ones, so a night tree is lit from somewhere
   * instead of being one flat dark shape.
   */
  setMoonLit(side: 'left' | 'right' | null): void;
  /**
   * The happy dance: a shake through the plant with every leaf fluttering. Used
   * when it is watered or fed, so care has an answer that is not a number going up.
   */
  celebrate(): void;
  /**
   * Too much of a good thing. A groggy plant sways at half speed, wanders slowly
   * off upright and goes a little slack in colour - it is drunk, comically so, not
   * injured.
   */
  setGroggy(on: boolean): void;
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
     instead of bending the stem. The box itself takes no pointers, though: it is
     40 units wider than the drawing on each side (see the width below), and a
     press in that empty gutter must go through to the scene behind, not start a
     bend from thin air. The grab layer is the drawing's own footprint. */
  .pl-title-plant { touch-action: none; pointer-events: none; }
  .pl-title-plant__grab {
    position: absolute;
    /* The drawing's own footprint: the 140-unit gutters are 29.1667% of the box. */
    inset: 0 29.1667%;
    pointer-events: auto;
  }
  /* The drawing's root is not a surface: only its shapes are, and the grab layer
     fills the gaps between them. Otherwise the padded viewport swallowed pointer
     presses in the gutter. */
    .pl-title-plant svg {
    pointer-events: none;
  }
  .pl-title-plant svg * { pointer-events: visiblePainted; }
  .pl-title-plant__roots { pointer-events: auto; }
  /* Leaves lean toward a fine pointer. Only where a hover exists: on a finger
     layout there is nothing to lean toward. */
  /* A leaf used to tilt on hover with a CSS transform. With transform-box set to
     view-box that rotation pivots on the drawing's corner, not on the leaf's stem
     attachment, so hovering a leaf could pull it off the plant. The highlight is a
     light change now; the leaf never moves for a pointer that is only passing. */
  @media (hover: hover) and (pointer: fine) {
    .pl-title-plant__leaf { transition: filter 220ms ease; }
    .pl-title-plant__leaf:hover { filter: brightness(1.08); }
  }
  /* Growth energy: a stream of light, not a bead. It gathers at the root crown
     where care lands, climbs the stem as a bright front with a fading tail, and
     runs out along each arm while that arm extends. Screen-blended and thin: it is
     light on the wood, not a second drawing. */
  .pl-title-plant__stream {
    pointer-events: none;
    opacity: 0;
    mix-blend-mode: screen;
    transition: opacity 180ms ease;
  }
  .pl-title-plant.is-streaming .pl-title-plant__stream { opacity: 1; }
  .pl-title-plant__stream-glow {
    fill: none;
    stroke: var(--pl-energy-glow, #d7e98d);
    stroke-width: 13;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.24;
  }
  .pl-title-plant__stream-core {
    fill: none;
    stroke: var(--pl-energy-core, #fff6c9);
    stroke-width: 2.3;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.68;
  }
  .pl-title-plant__stream-head {
    fill: none;
    stroke: var(--pl-energy-core, #fff6c9);
    stroke-width: 5.4;
    stroke-linecap: round;
    opacity: 0.98;
  }
  .pl-title-plant__stream-spark { fill: var(--pl-energy-core, #fff6c9); }
  /* A seed cannot be climbed yet: the energy it has taken in sits inside the seed
     as a small circle that grows with the stage and breathes while it waits. */
  .pl-title-plant__seed-kernel {
    opacity: 0;
    mix-blend-mode: screen;
    transform-box: fill-box;
    transform-origin: 50% 50%;
    animation: pl-seed-kernel 2.8s ease-in-out infinite;
  }
  .pl-title-plant[data-growth-tier='seed'] .pl-title-plant__seed-kernel { opacity: 1; }
  @keyframes pl-seed-kernel {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.1); }
  }
  /* A second care while the first stream is still climbing adds its own short
     stream from the root crown. It runs up to the live front and merges there;
     it never restarts the main stream. */
  .pl-title-plant__stream-echo {
    pointer-events: none;
    opacity: 0;
    mix-blend-mode: screen;
    transition: opacity 160ms ease;
  }
  .pl-title-plant.is-streaming .pl-title-plant__stream-echo.is-on { opacity: 0.78; }
  /* The second comet runs beside the first rather than exactly on top of it, so a
     second care reads as another stream instead of only brightening the trunk. */
  .pl-title-plant__stream-echo[data-stream-echo='0'] { translate: 2.4px 0; }
  .pl-title-plant__stream-echo[data-stream-echo='1'] { translate: -2.4px 0; }
  .pl-title-plant__stream-echo .pl-title-plant__stream-glow {
    stroke-width: 9;
    opacity: 0.2;
  }
  .pl-title-plant__stream-echo .pl-title-plant__stream-core {
    stroke-width: 2;
    opacity: 0.8;
  }
  .pl-title-plant__stream-echo .pl-title-plant__stream-head {
    stroke-width: 4;
    opacity: 0.95;
  }
  .pl-title-plant__limb-stream {
    pointer-events: none;
    opacity: 0;
    mix-blend-mode: screen;
    transition: opacity 120ms ease;
  }
  .pl-title-plant.is-streaming .pl-title-plant__limb-stream.is-lit { opacity: 1; }
  .pl-title-plant__limb-stream .pl-title-plant__stream-glow {
    stroke-width: 11;
    opacity: 0.3;
  }
  .pl-title-plant__limb-stream .pl-title-plant__stream-core {
    stroke-width: 2.6;
    opacity: 0.9;
  }
  .pl-title-plant__limb-stream .pl-title-plant__stream-head {
    stroke-width: 4.6;
    opacity: 1;
  }
  .pl-title-plant.is-budding .pl-title-plant__bud { filter: brightness(1.12) saturate(1.1); }
  .pl-title-plant {
    /* Anchors the roots: they hang off this box, wherever it is placed. */
    position: relative;
    /* The mascot's palette. Declared here, not only as SVG fallbacks, so a
       holiday or seasonal variant is one variable swap. */
    --pl-stem: #5a902e;
    --pl-stem-dark: #46741f;
    --pl-leaf-front: #74a337;
    --pl-leaf-light: #9ac75a;
    --pl-leaf-back: #3c5a22;
    /* The colour of the energy that climbs the stem and runs into the arms during
       a growth run. */
    --pl-energy-core: #fff6c9;
    --pl-energy-glow: #d7e98d;
    --pl-leaf-deep: #3f6420;
    --pl-leaf-shadow: #2d451a;
    /* The crown's depth ladder (see depthFill): a tone between the brightest front
       leaf and the darkest back one, a lit version of it, and the cooled green of
       the farthest plane. Distance is not only darker - it is bluer and flatter. */
    --pl-leaf-mid: #577f2b;
    --pl-leaf-mid-lit: #7fae40;
    --pl-leaf-far: #405a45;
    --pl-leaf-tender: #a4c562;
    --pl-leaf-tender-lit: #c8dc8b;
    /* Vein and edge ink, kept as variables so a variant can recolour the
       drawing without touching the markup. */
    --pl-leaf-vein: #2c4512;
    --pl-leaf-edge: #2c4512;
    /* The roots' warm bone and their contact ink. MainMenu's ground pass writes
       these onto this element so the plate moves with the soil; these are the
       pre-paint defaults. */
    --pl-root: #d9c3a1;
    --pl-root-tip: #b59a76;
    --pl-root-ink: #1c1208;
    display: block;
    /* Fluid to a phone, capped so it never outgrows the hero column: 232px was
       a phone's plant, and it stayed that size on a 2560px monitor. */
    /* Height is part of the budget, not only width: the plant stands on the ground
       line and grows upward, so in a short pane a width-only size put it above the
       top of it. 34vh handles the shape, and --pl-mascot-max is the ceiling the
       menu computes for the pane it is actually in (title/menuFit.ts). */
    /* The drawing carries 140 units of empty gutter on each side (its viewBox is
       480 wide around 200 units of art), because a bent canopy swings past the
       art's own width. The gutter is not decoration: a CSS filter clips its
       element to the border box plus 10%, and the light grade is a filter, so any
       art outside this box was cut off at a rectangle the moment the tree bent.
       The 2.4 keeps the plant itself exactly the size it was: the art is 200/480
       of the box, so 2.4 x 200/480 = 1.0. */
    width: calc(2.4 * min(clamp(110px, min(23vw, 46vh), 420px), var(--pl-mascot-max, 380px)));
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
  .pl-title-plant__shoot {
    display: block;
    /* Care growth scales the drawing from its own foot, so a cared-for plant is a
       bigger plant rather than a stretched picture. Eased, because a hundred stages
       of ladder should read as a plant growing rather than as a jump cut. */
    transform: scale(var(--pl-care-scale, 1));
    transform-origin: 50% 100%;
    transition: transform 700ms cubic-bezier(0.22, 0.61, 0.36, 1);
    user-select: none;
    /* The viewBox is the art's box, not a frame around it. The bud reaches nine
       units above the box and a bend takes the crown out into the gutters, and an
       SVG clips to its own viewport by default - which is what cut the canopy off
       whenever the tree was bent. The roots already paint this way, for the roots;
       the shoot needs it for the crown. */
    overflow: visible;
    -webkit-user-select: none;
    /* No CSS filter. A filter chain on this element re-rasterises the whole
       drawing - fourteen gradient-filled leaves, a curved trunk, the root plate -
       every single frame, because the leaves are always moving. It was the largest
       per-frame cost on the title screen by a wide margin. The night grade comes
       from the scene's own light passes instead, which the plant sits under. */
    /* One transition list. This used to be two declarations - the scale over
       520ms, then the filter over 160ms - and the second one replaced the first,
       so every care step snapped the shoot to its new size while the root plate
       beside it (its own rule) eased. The two halves of one drawing grew at
       different rates. */
    /* Growth is a season, not a switch: half a second read as the plant being
       resized rather than growing. A long, soft ease lets a care step settle. */
    transition: transform 1100ms cubic-bezier(0.22, 1, 0.36, 1), filter 160ms ease;
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
  /* The plate is the same drawing at every care count: growth scales it about the
     soil line, which is the only way a root gets *thicker* as a plant matures.
     Redrawing it longer was tried and it reads as a fringe of strands instead.

     Two things to note about the selector. The shoot and roots rule above already
     scales every child of the plant by the care scale, roots included, and it wins
     on specificity, so the plate gets the same growth as the shoot plus a little of
     its own. It is also why the old root-depth custom property looked inert: a
     second scale on the same element is not additive, it is overwritten. */
  .pl-title-plant > svg.pl-title-plant__roots {
    /* The plate is the same drawing at every care count. A reach-wide 1.8x/1.9x
       plate was tried, but at the ancient stage it magnified the old central
       taproot into a triangular monolith and made the static roots compete with
       the menu's growable reaches. 1.3x/1.34x keeps the root crown under the
       trunk and leaves the reaches as the roots that cross the cut.

       The care scale is capped: a hundred stages of shoot growth multiplied the
       plate by more than three, so the same fan became a hand across the whole
       cut. A root crown grows with the trunk, not without limit; past this cap the
       reaches are what carry the root spread. */
    transform: scale(
      calc(min(var(--pl-care-scale, 1), 1.4) * var(--pl-root-depth, 1) * 1.3),
      calc(min(var(--pl-care-scale, 1), 1.4) * var(--pl-root-depth, 1) * 1.34)
    );
    transition: transform 1250ms cubic-bezier(0.22, 1, 0.36, 1);
    /* Scaled up it is wider than the shoot's box, and an SVG clips to its own
       viewport: the outer roots were cut off at the sides. */
    overflow: visible;
    position: absolute;
    /* The plate's own grid is 200 units wide and so is the art, so the plate is
       laid at the art's own width: 200/480 of the box, starting at the art's left
       edge. It used to be 51.25% wide - 23% bigger than the shoot - so the same
       drawing units measured bigger underground than above it. The taproot then
       came out wider than the trunk it hangs from *and* was centred on a different
       scale, and the two halves read as two drawings stacked. Same width, same
       units, one plant. */
    left: 29.1667%;
    /* The crown starts on the soil line and goes down: no part of the plate is
       above the ground. The trunk's flare is clipped at the same line, so the two
       meet without a strip of soil between them and without the plate's flat top
       showing as a shelf. */
    top: 100%;
    /* Keep the top edge; only the sides and bottom are free for a scaled plate. */
    clip-path: inset(0 -45% -45% -45%);
    width: 41.6667%;
    height: auto;
    display: block;
    /* A root answers a tap now, so the soil layer takes pointers. */
    pointer-events: auto;
    transform-box: view-box;
    transform-origin: 50% 0%;
  }
  /* Sway pivots on the base of the stem, which is the bottom of the drawing. */
  .pl-title-plant__leaves { transform-box: fill-box; transform-origin: 50% 100%; }
  /* The idle sway is a transform animation on one plain <div> around the drawing,
     never on anything inside the SVG.

     Why this matters more than it looks: a transform animation on an SVG element or
     group is not composited. The browser re-rasterises that whole SVG subtree every
     frame - ten limbs, sixty-odd leaves, each a gradient-filled path with a stroke -
     and the cost grows with the square of the pixels it covers, so it is the one
     thing on this screen that gets worse the bigger the window is. The div moves a
     picture that was drawn once. The leaves' own motion is scripted a few blades at
     a time, which is a style write, not a repaint. */
  .pl-title-plant__sway {
    display: block;
    /* The drawing has no margins of its own, and an inline wrapper would add the
       text baseline's descender space - the 3px that once put the roots below the
       stem's foot. */
    line-height: 0;
    /* The stem's foot is the bottom edge of the drawing (see the viewBox). */
    transform-origin: 50% 100%;
    will-change: transform;
    animation: pl-plant-sway var(--pl-sway-ms, 5200ms) ease-in-out infinite;
  }
  @keyframes pl-plant-sway {
    0%, 100% { transform: rotate(-0.55deg); }
    50% { transform: rotate(0.55deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .pl-title-plant__sway { animation: none; }
    .pl-title-plant__leaf-shape,
    .pl-title-plant__crown-leaf-shape { transition: none; }
  }
  /* The happy dance: a quick shake through the leaves, used when the plant is
     watered or fed. It lives on translate for the same reason the flutter does. */
  /* A hand passing through the leaves.

     One push as the hand arrives, then a long spring back. Both are transitions of
     the leaf's own rotate and translate rather than a keyframe animation, for two
     reasons a finger needs: a transition re-aims from wherever the blade currently
     is, so a second pass over the canopy is answered at once instead of waiting out
     the settle, and the return can carry a hair of overshoot - the wobble of a leaf
     on a twig - without a reset when it ends. The spring length is one variable, so
     the script writes it once for the whole canopy and only the leaf's own angle
     per blade.

     The transforms live on the leaf's shape, inside its placement group. Both the
     size and the rustle turn about the blade's base, which is a point on the shape's
     own un-transformed box: put them on the placed group and the rotate and scale
     are resolved against a box the placement has already turned, which is how a
     leaf lets go of its stem while it grows or moves. */
  .pl-title-plant__leaf-shape,
  .pl-title-plant__crown-leaf-shape {
    transform-box: fill-box;
    transform-origin: 50% 100%;
    transition:
      scale 700ms ease,
      rotate var(--pl-leaf-spring, 900ms) cubic-bezier(0.22, 1.16, 0.32, 1),
      translate var(--pl-leaf-spring, 900ms) cubic-bezier(0.22, 1.16, 0.32, 1);
  }
  /* A crown leaf's shade lives in CSS, not only in its fill attribute, so the crown
     can be graded by where the moon is without redrawing one path: each blade names
     the rung it was drawn on, and the side facing the moon swaps to that rung's lit
     tone while the far side drops to its shaded one. */
  .pl-title-plant__blade { fill: var(--pl-blade, url(#pl-leaf-e)); }
  .pl-title-plant__blade[data-shade='a'] {
    --pl-blade: url(#pl-leaf-a); --pl-blade-lit: url(#pl-leaf-b); --pl-blade-shade: url(#pl-leaf-g);
  }
  .pl-title-plant__blade[data-shade='b'] {
    --pl-blade: url(#pl-leaf-b); --pl-blade-lit: url(#pl-leaf-b); --pl-blade-shade: url(#pl-leaf-a);
  }
  .pl-title-plant__blade[data-shade='g'] {
    --pl-blade: url(#pl-leaf-g); --pl-blade-lit: url(#pl-leaf-b); --pl-blade-shade: url(#pl-leaf-e);
  }
  .pl-title-plant__blade[data-shade='e'] {
    --pl-blade: url(#pl-leaf-e); --pl-blade-lit: url(#pl-leaf-g); --pl-blade-shade: url(#pl-leaf-c);
  }
  .pl-title-plant__blade[data-shade='c'] {
    --pl-blade: url(#pl-leaf-c); --pl-blade-lit: url(#pl-leaf-e); --pl-blade-shade: url(#pl-leaf-back);
  }
  .pl-title-plant__blade[data-shade='back'] {
    --pl-blade: url(#pl-leaf-back); --pl-blade-lit: url(#pl-leaf-c); --pl-blade-shade: url(#pl-leaf-f);
  }
  .pl-title-plant__blade[data-shade='f'] {
    --pl-blade: url(#pl-leaf-f); --pl-blade-lit: url(#pl-leaf-c); --pl-blade-shade: url(#pl-leaf-f);
  }
  .pl-title-plant__blade[data-shade='d'] {
    --pl-blade: url(#pl-leaf-d); --pl-blade-lit: url(#pl-leaf-d); --pl-blade-shade: url(#pl-leaf-d);
  }
  .pl-title-plant[data-moon-lit='left'] .pl-title-plant__limb[data-side='left'] .pl-title-plant__blade,
  .pl-title-plant[data-moon-lit='right'] .pl-title-plant__limb[data-side='right'] .pl-title-plant__blade {
    --pl-blade: var(--pl-blade-lit);
  }
  .pl-title-plant[data-moon-lit='left'] .pl-title-plant__limb[data-side='right'] .pl-title-plant__blade,
  .pl-title-plant[data-moon-lit='right'] .pl-title-plant__limb[data-side='left'] .pl-title-plant__blade {
    --pl-blade: var(--pl-blade-shade);
  }
  @keyframes pl-leaf-happy {
    0%, 100% { translate: 0 0; }
    20% { translate: 1.6px -2.2px; }
    40% { translate: -1.4px -1px; }
    60% { translate: 1.1px 0.8px; }
    80% { translate: -0.8px -1.4px; }
  }
  .pl-title-plant.is-happy .pl-title-plant__leaf-place {
    animation: pl-leaf-happy 620ms ease-in-out 2 both;
  }
  /* The crown waves too. It only ever danced on the small leaves on the stem, so a
     watered tree shook its bottom two blades while the canopy above sat still - the
     cheer looked like it came from the wrong plant. Crown blades turn about their
     own base instead of travelling: a leaf on a branch is pinned at the branch, and
     a blade that slides sideways reads as detached from its twig. */
  .pl-title-plant.is-happy .pl-title-plant__leaf-rest {
    animation: pl-leaf-happy-crown 640ms ease-in-out 2 both;
  }
  @keyframes pl-leaf-happy-crown {
    0%, 100% { rotate: 0deg; }
    24% { rotate: 2.4deg; }
    52% { rotate: -2deg; }
    78% { rotate: 1.1deg; }
  }
  /* Too much of a good thing: the whole plant goes slack and heavy. */
  .pl-title-plant.is-groggy .pl-title-plant__shoot { filter: saturate(0.86) brightness(0.94); }
  /* The bend is drawn, not hinged: the stem is an arc (title/plantBend.ts) and
     every leaf carries its own placement along it, written as an SVG attribute in
     viewBox units. Nothing here may use a CSS transform with an origin: with
     transform-box set to view-box the origin counts from the drawing's corner (x
     minus 40), so an origin written in the art's own numbers lands forty units to
     the left of where it was meant and the leaves come away from the tree. */
  .pl-title-plant__leaf,
  .pl-title-plant__bud-anchor { transform-box: view-box; }
  .pl-title-plant__bud {
    scale: var(--pl-bud-scale, 1);
    transition: scale 700ms ease;
  }
  /* A leaf opens rather than appears, and a limb grows rather than pops. Neither
     gets an opacity fade: a branch that fades up from transparent reads as a
     ghost, and a leaf that does it appears through the wood instead of opening
     from its bud. The geometry carries the reveal. */
  /* Blade size against the plant's age, scaled about the point where the leaf meets
     its wood so nothing drifts off its own stem. */
  .pl-title-plant__leaf-shape { scale: var(--pl-leaf-scale, 1); }
  .pl-title-plant__crown-leaf-shape { scale: 1; }
  /* During a growth run a closed leaf is a bud-sized copy of itself at the point
     where it meets its stem or twig, and opening it grows the blade out from
     there. The rule is scoped to the run so a loaded save is drawn at its stage at
     once instead of opening every leaf again on the first frame. */
  .pl-title-plant.is-growing .pl-title-plant__leaf-shape {
    scale: calc(var(--pl-leaf-scale, 1) * var(--pl-leaf-open, 1));
    transition:
      scale 620ms cubic-bezier(0.22, 0.9, 0.3, 1.05),
      rotate var(--pl-leaf-spring, 900ms) cubic-bezier(0.22, 1.16, 0.32, 1),
      translate var(--pl-leaf-spring, 900ms) cubic-bezier(0.22, 1.16, 0.32, 1);
  }
  .pl-title-plant.is-growing .pl-title-plant__crown-leaf-shape {
    scale: var(--pl-leaf-open, 1);
    transition:
      scale 620ms cubic-bezier(0.22, 0.9, 0.3, 1.05),
      rotate var(--pl-leaf-spring, 900ms) cubic-bezier(0.22, 1.16, 0.32, 1),
      translate var(--pl-leaf-spring, 900ms) cubic-bezier(0.22, 1.16, 0.32, 1);
  }
  /* Light through the canopy. The pool sits behind every leaf and the leaf
     overlays sit on them; both are screened and both are off until a disc is
     behind the tree (title/leafThroughLight). Deliberately low: a leaf that turns
     into a lamp is no longer a leaf. */
  .pl-title-plant__backlight {
    opacity: var(--pl-crown-glow, 0);
    mix-blend-mode: screen;
    pointer-events: none;
    transition: opacity 1200ms ease;
  }
  /* The top light: the same disc, seen over the crown rather than through a leaf.
     A second, higher pool that only shows when the moon (or a low sun) stands
     behind the trunk, so the upper reaches of the tree are the part that lights
     up - the light arrives from above the canopy, not from behind the trunk. */
  .pl-title-plant__crown-top {
    opacity: calc(var(--pl-crown-top, 0) * 0.75);
    mix-blend-mode: screen;
    pointer-events: none;
    transition: opacity 1400ms ease;
  }
  .pl-title-plant__leaf-through {
    /* 0.95, not 0.6: at the real grazing hours the transfer is a fifth to a
       quarter, and six tenths of that was below what the eye reads on a leaf. */
    opacity: calc(var(--pl-leaf-through, 0) * 0.72);
    /* No screen blend here. There is one of these overlays per leaf, and an
       ancient crown carries more than a hundred and seventy of them inside a
       filtered, swaying SVG. Measured at 1600x1000, the title held 60fps with a
       16.8ms p95 once the blend mode was removed, against a 50ms p95 and visible
       hitches with it. The pale fill at this opacity preserves the transmission
       read without asking the compositor to blend every leaf separately. */
    pointer-events: none;
    transition: opacity 1200ms ease;
  }
  /* The day's grade, on the two drawings and never on their wrapper: cool and
     dark under the moon, warm at golden hour, pale and flat under snow, grey in a
     downpour. A blend-mode rect was tried first and it painted the whole viewport:
     the drawing does not clip its overflow, so the rect was a visible blue box over
     the sky. A filter clips to the drawing's own box, which is what we want here -
     the canopy stays inside it even at a full bend, and the roots have their own. */
  .pl-title-plant__shoot { --pl-plant-bright: var(--pl-shoot-bright, 1); }
  /* The bark is a third drawing and it was outside the night grade. It kept
     #6a4a2b under a moon that had dimmed the canopy to 0.44, so the trunk stood in
     the middle of the title as a lit column with a bright foot - what read as a
     glow around the static root was the trunk painted at daytime brightness. */
  .pl-title-plant__trunk,
  .pl-title-plant__tree {
    /* Wood is not a leaf. The canopy loses its colour at night and turns cool;
       bark that took the same curve went grey, and at the shoot's brightness it
       went black. The wood keeps its own two numbers: a moonlight floor on the
       brightness and no hue turn at all, so trunk, limbs and twigs stay one brown
       family from the crown to the flare. */
    --pl-plant-bright: var(--pl-trunk-bright, var(--pl-shoot-bright, 1));
    --pl-plant-sat: 1;
    --pl-plant-sepia: 0;
    --pl-plant-hue: 0deg;
  }
  /* The roots are the lightest thing in the drawing, so at night they need more
     dimming than the canopy to stop reading as cream roots under a full moon. */
  .pl-title-plant__roots {
    --pl-plant-bright: var(--pl-roots-bright, var(--pl-shoot-bright, 1));
  }
  /* The shoot is the drawing that sways. Its filter is also the one that covers
     the whole canopy, so anything in it that needs a colour-space conversion makes
     the browser re-rasterise every leaf on every breeze frame. Measured at
     1600x1287 on the ancient tree, the old brightness+saturate+sepia+hue-rotate
     chain held p95 34 ms and a 30 fps average; dropping hue-rotate alone put the
     same scene back to 60 fps and p95 17 ms. The leaves already carry their cool
     far tones and their lit/shaded rungs, so the hue turn is the one part of the
     grade this drawing can afford to lose. Bark and roots keep it: they do not
     sway, and their filters measured free above. */
  .pl-title-plant__shoot {
    filter: brightness(var(--pl-plant-bright, 1))
      saturate(var(--pl-plant-sat, var(--pl-shoot-sat, 1)))
      sepia(var(--pl-plant-sepia, var(--pl-shoot-sepia, 0)));
  }
  .pl-title-plant__trunk,
  .pl-title-plant__tree,
  .pl-title-plant__roots {
    filter: brightness(var(--pl-plant-bright, 1))
      saturate(var(--pl-plant-sat, var(--pl-shoot-sat, 1)))
      sepia(var(--pl-plant-sepia, var(--pl-shoot-sepia, 0)))
      hue-rotate(var(--pl-plant-hue, var(--pl-shoot-hue, 0deg)));
    /* No transition on the filter. A filter on this drawing re-rasterises all 900
       of its nodes, and transitioning it re-rasterised them every frame for the
       700 ms of the fade: measured p95 frame time in the rain fell from 100 ms to
       50 ms with this one line removed, at the same 60 fps median. The palette is
       rewritten once a sky tick, so the change lands in one raster either way. */
  }
  /* Bark: the woody base that makes the mascot a tree rather than a stalk. */
  .pl-title-plant {
    --pl-bark: #6a4a2b;
    --pl-bark-dark: #432c15;
    --pl-bark-lit: #9a7244;
    /* The root collar is wood, not stem: it keeps this brown even while the
       young shoot's --pl-bark is still green. The flare fades into it at the
       soil line, so a sapling's green trunk does not stop on brown roots. */
    --pl-root-bark: #432c15;
  }
  /* Older foliage. A mature tree's leaves are deeper and less yellow than a
     seedling's, and the tender gradient was still a sprout's lime on a woody tree.
     Only the two tender stops move, so the plant keeps the palette it grew up with
     and the crown does not turn into a different drawing. */
  .pl-title-plant.is-tree {
    --pl-leaf-tender: #97bd4f;
    --pl-leaf-tender-lit: #bfd97a;
  }
  .pl-title-plant__trunk {
    opacity: var(--pl-trunk-opacity, 0);
    transition: opacity 420ms ease;
  }
  /* Nodes only exist on a green stem. Once there is bark the leaves come off wood,
     and a row of green beads down the middle of the trunk is what read as a green
     skeleton whenever the tree was bent. */
  .pl-title-plant__nub { opacity: calc(1 - var(--pl-trunk-opacity, 0)); transition: opacity 420ms ease; }
  /* A mature tree stands on a thicker trunk. Without this the last third of the
     care range was the same sapling drawn larger, and a tree is mostly trunk. */
  /* Wood, not a stem drawn bigger: the trunk widens with the plant's age. */
  .pl-title-plant__trunk-body {
    stroke-width: calc(13 + 12 * var(--pl-trunk-w, 0));
    transition: stroke-width 520ms ease;
  }
  .pl-title-plant__trunk-flare {
    /* A filled bell, not a constant-width stroke: it leaves the trunk just above
       the soil and widens into the root plate, so the foot reads as a flare rather
       than a bulb. Its width stays close to the root crown's at every age, so a
       young crown cannot show as a wider shelf under a narrow flare. */
    transform-box: view-box;
    transform-origin: 100px 224px;
    transform: scale(
      calc(0.9 + 0.1 * var(--pl-trunk-w, 0)),
      calc(0.72 + 0.28 * var(--pl-trunk-w, 0))
    );
    transition: transform 520ms ease;
  }
  /* No fixed widths at the last stage any more: the trunk's thickness is one
     continuous number from the growth ladder, so a hundred stages all differ. */
  /* Once the wood has arrived, the trunk is the spine. The green stem under it used
     to keep going to the tip, and above the topmost limb it showed as a thin green
     pole standing out of the crown. */
  .pl-title-plant.is-tree .pl-title-plant__stem-body,
  .pl-title-plant.is-tree .pl-title-plant__stem-lit,
  .pl-title-plant.is-tree .pl-title-plant__stem-compression { opacity: 0; }
  /* A limb is the trunk seen from outside: the same wood, the same age, drawn
     thinner because it grew later. The width is authored per limb as --pl-limb-w
     and scaled by the trunk's own age, so the upper arms stay slender while the
     lower ones thicken with the tree. */
  /* A limb is a tapered shape now, so its age is read by squeezing the width rather
     than by a stroke width: a young tree's arms are thin, and they thicken with the
     trunk. The scale is in the limb's own frame, where the branch runs along x and
     its width is across y. */
  .pl-title-plant__limb-wood {
    transform-box: fill-box;
    transform-origin: 0% 50%;
    transform: scale(1, calc(0.55 + 0.45 * var(--pl-trunk-w, 0)));
    transition: transform 520ms ease;
  }
  .pl-title-plant__tree {
    pointer-events: none;
  }
  .pl-title-plant.is-tree .pl-title-plant__tree { pointer-events: auto; }
  /* Strain appears late: the creases fade in as the stem approaches its limit,
     and the compression shadow on the inside of the curve with them. */
  .pl-title-plant__crease,
  .pl-title-plant__stem-compression { transition: stroke-opacity 140ms ease; }
  /* Strain ink follows the thing it is drawn on. On a green stem it is stem green;
     on a woody tree it is bark, because a green line down the inside of a brown
     trunk - the compression shadow, and the creases across it - is exactly what
     read as the plant's green skeleton showing through when it was bent. */
  .pl-title-plant.is-tree .pl-title-plant__crease,
  .pl-title-plant.is-tree .pl-title-plant__stem-compression {
    stroke: var(--pl-bark-dark, #432c15);
  }
  .pl-title-plant__stem-body { transition: stroke-width 140ms ease; }
  /* -------------------------------------------------------------- growth states
     The plant starts as a seed in the soil, comes up as a two-leaf sprout, and
     only then is the drawing that bends. The three states are separate art in the
     same viewBox, so they all stand on the same soil line, and only one is visible
     at a time. */
  .pl-title-plant__seed,
  .pl-title-plant__sprout {
    opacity: 0;
    transition: opacity 380ms ease;
  }
  /* Keyed by tier, not by stage: the ladder has a hundred stages now, and only the
     two youngest tiers are different pictures rather than a smaller or larger
     version of the same drawing. */
  .pl-title-plant[data-growth-tier='seed'] .pl-title-plant__seed,
  .pl-title-plant[data-growth-tier='sprout'] .pl-title-plant__sprout {
    opacity: 1;
  }
  .pl-title-plant[data-growth-tier='seed'] .pl-title-plant__leaves,
  .pl-title-plant[data-growth-tier='sprout'] .pl-title-plant__leaves {
    opacity: 0;
  }
  .pl-title-plant[data-growth-tier='seed'] .pl-title-plant__roots {
    opacity: 0;
  }

  /* Reduced motion: the sway is stopped in script (the plant's own options carry
     it), and the drawing's transitions go quiet here. The old rule mixed a selector
     with a declaration, so a browser dropped the whole at-rule and the mascot had
     no reduced-motion handling at all. */
  @media (prefers-reduced-motion: reduce) {
    .pl-title-plant__shoot,
    .pl-title-plant > svg.pl-title-plant__roots,
    .pl-title-plant__trunk,
    .pl-title-plant__limb-wood,
    .pl-title-plant__tree,
    .pl-title-plant__seed,
    .pl-title-plant__sprout,
    .pl-title-plant__seed-kernel {
      transition: none;
      animation: none;
    }
    /* The flutter and the dance are motion for their own sake: a reader who asked
       for less gets a still plant, and the sway is stopped in script as well. */
    .pl-title-plant__leaf-place,
    .pl-title-plant.is-happy .pl-title-plant__leaf-place,
    .pl-title-plant.is-happy .pl-title-plant__leaf-rest,
    .pl-title-plant__tree {
      animation: none;
    }
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
  /**
   * The care level this leaf arrives at. Growth reveals the drawing leaf by leaf,
   * which is what makes a seedling becoming a plant read as growing rather than as
   * one picture being scaled up.
   */
  stage: number;
  /** Tenderness: vein detail is dropped on the smallest leaf. */
  veins?: boolean;
}

function leafPath(len: number, w: number): string {
  // One scale for every leaf in the drawing, shoot and crown alike. The old value
  // was tuned for a small mascot; at the ancient tree's size it left the crown a
  // scattering of green dots on bare arms. A larger blade keeps every placement and
  // vein while letting the foliage carry as much of the silhouette as the wood.
  const l = len * LEAF_SIZE;
  const hw = w * LEAF_SIZE;
  return (
    `M0 0 C${(-hw).toFixed(1)} ${(-l * 0.22).toFixed(1)} ` +
    `${(-hw * 0.92).toFixed(1)} ${(-l * 0.66).toFixed(1)} 0 ${(-l).toFixed(1)} ` +
    `C${(hw * 0.92).toFixed(1)} ${(-l * 0.66).toFixed(1)} ` +
    `${hw.toFixed(1)} ${(-l * 0.22).toFixed(1)} 0 0 Z`
  );
}

/**
 * How big a leaf is against the wood it hangs from. See leafPath.
 *
 * The growth ladder ends in a tree whose crown is most of the picture. At the old
 * 0.62 the blades were specks on the branches - a leafy tree read as a bare one
 * with green dots - so the crown gets proportionally more leaf without changing any
 * of its authored placement.
 */
const LEAF_SIZE = 0.74;
/**
 * How much of their drawn angle the arms keep. 1 is the authored crown, which sat
 * out almost flat from the trunk; the arms climb a little more than that.
 */
const ARM_RISE = 0.86;

function leafVeins(len: number, w: number): string {
  const parts = [
    `M0 -2 Q${(-w * 0.05).toFixed(1)} ${(-len * 0.5).toFixed(1)} 0 ${(-len * 0.9).toFixed(1)}`,
  ];
  // A leaf's half-width at a point along it, from the same control points
  // `leafPath` uses: 3t(1-t)(1 - 0.08t) of the maximum, which is widest just past
  // the middle and closes to a point at the tip.
  const halfWidth = (t: number): number => 3 * t * (1 - t) * (1 - 0.08 * t) * w;
  for (let i = 1; i <= 4; i += 1) {
    const t = i / 5;
    const y = -len * t;
    // Veins live *inside* the blade. They used to be a fixed fraction of the leaf's
    // maximum width, which the blade narrows away from as it nears the tip: the
    // outer half of every side vein was drawn in empty space beside the leaf, and at
    // title size those stray strokes read as scratches across the foliage. Each
    // vein now stops short of the edge at both ends of its own run.
    const tipT = Math.min(1, t + 0.12);
    const reach = Math.min(halfWidth(t), halfWidth(tipT)) * 0.66;
    const rise = len * 0.1;
    parts.push(`M0 ${y.toFixed(1)} L${(-reach).toFixed(1)} ${(y - rise).toFixed(1)}`);
    parts.push(`M0 ${y.toFixed(1)} L${reach.toFixed(1)} ${(y - rise).toFixed(1)}`);
  }
  return parts.join(' ');
}

/**
 * The light that passes through a leaf.
 *
 * A thin blade in front of the moon is not a wall: some of the light behind it
 * comes out the other side. The same outline is laid over the leaf in the
 * through-light colour at partial opacity, so what a player sees is the leaf's own
 * drawing carrying a little of the light behind it rather than a second, painted
 * leaf. It is deliberately not screen-blended: one blend layer per leaf was the
 * title's frame hitch (see the stylesheet). Its opacity is one variable
 * (`--pl-leaf-through`), written by the menu's light pass, so day, dusk, night,
 * rain and snow all move it without touching the art.
 */
function leafThrough(len: number, w: number): string {
  return (
    `<path class="pl-title-plant__leaf-through" d="${leafPath(len, w)}" ` +
    'fill="var(--pl-leaf-through-colour, #dfe9ff)"/>'
  );
}

function leaf(spec: LeafSpec, index: number): string {
  // The leaf's own gradient carries the light; the edge is ink and nothing else.
  // A rim pass was tried and read as pale outlines drawn over the foliage.
  // Light through the blade. A thin leaf in front of a moon is not opaque, so the
  // same shape is laid over it in the through-light colour and screened: the leaf
  // keeps its own drawing and gains a little of whatever is behind it.
  const through = leafThrough(spec.len, spec.w);
  // The blade is drawn at LEAF_SIZE, so its veins have to be measured in the same
  // units. They were passed the un-shrunk length and width, which made the rib and
  // every side vein half again as long as the leaf holding them: the extra length
  // hung outside the blade as loose strokes that read as scratches, and the shorter
  // the leaf the further outside they reached.
  const veins = spec.veins
    ? `<path d="${leafVeins(spec.len * LEAF_SIZE, spec.w * LEAF_SIZE)}" fill="none" stroke="var(--pl-leaf-vein, #2c4512)" ` +
      `stroke-opacity="${spec.back ? 0.16 : 0.2}" stroke-width="0.85" stroke-linecap="round"/>`
    : '';
  // The placement is an SVG transform *attribute*, and the only thing that moves
  // the leaf is the CSS `translate` property, which is origin-independent. The
  // old version rotated the leaf with a CSS transform and a `transform-origin` in
  // viewBox units - but with `transform-box: view-box` the origin counts from the
  // viewBox corner (x = -40), so every leaf in the plant pivoted forty units to
  // the left of its own stem attachment and let go of the tree whenever it bent.
  return (
    `<g class="pl-title-plant__leaf" data-part="leaf" data-leaf="${index}">` +
    `<g class="pl-title-plant__leaf-place" transform="translate(${spec.x} ${spec.y}) rotate(${spec.angle})"${spec.back ? ' opacity="0.92"' : ''}>` +
    '<g class="pl-title-plant__leaf-shape">' +
    `<path d="${leafPath(spec.len, spec.w)}" fill="url(#${spec.fill})" ` +
    'stroke="var(--pl-leaf-edge, #2c4512)" stroke-opacity="0.16" stroke-width="1"/>' +
    through +
    veins +
    '</g>' +
    '</g>' +
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
/**
 * The leaves, in drawing order, with the point on the stem each one leaves from.
 *
 * Module scope because the bend needs the same table: a leaf's placement along the
 * arc is derived from where it is attached, and two copies of this list would drift.
 */
const LEAF_SPECS: LeafSpec[] = [
  // Behind the stem: the darker plane that gives the plant a back.
  {
    x: 100,
    y: 184,
    angle: -30,
    len: 54,
    w: 17,
    fill: 'pl-leaf-back',
    back: true,
    veins: true,
    stage: 2,
  },
  {
    x: 97,
    y: 152,
    angle: 36,
    len: 46,
    w: 14,
    fill: 'pl-leaf-back',
    back: true,
    veins: true,
    stage: 3.5,
  },
  // Front, climbing: longest at the bottom, tender at the top. These are the
  // plant's own leaves, on the stem; a tree's crown is not made of them (see
  // LIMBS) - a mature tree keeps the lower pair and grows wood above it.
  {
    x: 100,
    y: 198,
    angle: 46,
    len: 58,
    w: 18,
    fill: 'pl-leaf-a',
    veins: true,
    stage: 0,
  },
  {
    x: 99,
    y: 166,
    angle: -48,
    len: 62,
    w: 19,
    fill: 'pl-leaf-a',
    veins: true,
    stage: 0,
  },
  {
    x: 96,
    y: 112,
    angle: 52,
    len: 56,
    w: 17,
    fill: 'pl-leaf-b',
    veins: true,
    stage: 1.5,
  },
  {
    x: 94.5,
    y: 84,
    angle: -50,
    len: 46,
    w: 14,
    fill: 'pl-leaf-b',
    veins: true,
    stage: 3,
  },
  { x: 93, y: 58, angle: 6, len: 32, w: 10, fill: 'pl-leaf-d', stage: 4.5 },
];

/** The stem in the art, as a straight spine from the soil to the bud. */
const STEM_BASE_X = 100;
const STEM_BASE_Y = 224;
const STEM_TIP_X = 94;
/**
 * The stem's tip, and therefore how tall the plant is.
 *
 * The art stands on the soil line at y=224 and grows upward, so this number is
 * the plant's height in drawing units: 254 of them, against 140 when the mascot
 * was a sapling and 190 after the first tree pass. It can go on doing this because
 * the box around the drawing now carries 60 units of headroom above y=0 - height
 * here is free space that was spent on gutters for the bend, not a new layout.
 */
const STEM_TIP_Y = -8;
/** Where the bud sits: on the tip, not on the old sapling's shoulder. */
const BUD_Y = STEM_TIP_Y + 2;
const STEM_LENGTH = Math.hypot(STEM_TIP_X - STEM_BASE_X, STEM_TIP_Y - STEM_BASE_Y);
/** The two-leaf sprout's own short stem; it is a separate drawing above the soil. */
const SPROUT_TIP_X = 98;
const SPROUT_TIP_Y = 186;
const SPROUT_LENGTH = Math.hypot(SPROUT_TIP_X - STEM_BASE_X, SPROUT_TIP_Y - STEM_BASE_Y);
/** Where the stem points before it is touched: the art's own slight lean. */
const STEM_REST_DEG =
  (Math.atan2(STEM_TIP_Y - STEM_BASE_Y, STEM_TIP_X - STEM_BASE_X) * 180) / Math.PI;
/** The green a sapling's stem keeps until its wood hardens into bark. */
const WOOD_GREEN: Rgb = [90, 144, 46];
const WOOD_GREEN_DARK: Rgb = [70, 116, 31];
const WOOD_GREEN_LIT: Rgb = [158, 217, 92];
/** The bark of an adult tree, and the values the drawing already uses. */
const WOOD_BARK: Rgb = [106, 74, 43];
const WOOD_BARK_DARK: Rgb = [67, 44, 21];
const WOOD_BARK_LIT: Rgb = [154, 114, 68];

type Rgb = readonly [number, number, number];

/** A colour between two fixed palette entries, for the green-to-bark age change. */
const mixRgb = (from: Rgb, to: Rgb, tone: number): string => {
  const t = Math.max(0, Math.min(1, tone));
  const r = Math.round(from[0] + (to[0] - from[0]) * t);
  const g = Math.round(from[1] + (to[1] - from[1]) * t);
  const b = Math.round(from[2] + (to[2] - from[2]) * t);
  return `rgb(${r}, ${g}, ${b})`;
};

/** Node nubs, at the points on the upright stem where a leaf leaves it. */
const NUB_POINTS: ReadonlyArray<readonly [number, number]> = [
  [100, 198],
  [99, 166],
  [96, 112],
  [94.5, 84],
  [93, 58],
];
/**
 * The crown: limbs off the trunk, each with a cluster of leaves at its end.
 *
 * The tree used to be one long stem with big leaves sprouting from points along
 * it, which is a stalk, not a tree - there was no wood above the soil except the
 * trunk itself. A crown is wood that forks and foliage at the ends of the forks:
 * `t` is where the limb leaves the trunk (a fraction of the stem from its base),
 * `angle` is how far it reaches from straight up (negative goes left), and its
 * leaves are placed along the limb's own arc, so they travel with it.
 *
 * Seven limbs, half behind the trunk and half in front, because a crown is a mass
 * with a near side and a far side rather than a fan of leaves on a pole.
 */
interface LimbLeafSpec {
  /** Fraction of the limb's length from its attachment to its tip. */
  at: number;
  /** Degrees from the limb's own direction: 90 points straight out along it. */
  angle: number;
  len: number;
  w: number;
  fill: string;
  veins?: boolean;
}

interface LimbSpec {
  t: number;
  angle: number;
  len: number;
  /** Drawn in front of the trunk rather than behind it. */
  front?: boolean;
  leaves: LimbLeafSpec[];
}

/**
 * The crown's arms, mirrored to both sides.
 *
 * Written once per height and reflected in code. The authored version listed ten
 * arms by hand, and the lists were not symmetric: the left side was longer, the
 * right side's leaves were sparser, and an arm could end in bare wood because the
 * leaf cluster that was supposed to cover it sat on a different arm. A crown that
 * leans is the first thing anyone sees, so the shape is no longer something a
 * person has to keep balanced - it cannot be unbalanced.
 *
 * `t` is where the arm leaves the trunk (a fraction of the stem from its base),
 * `angle` is how far it reaches from straight up (applied to both sides), `len` is
 * its drawn length. Front arms are drawn over the trunk, back arms behind it: a
 * crown is a mass with a near side and a far side, not a fan on a pole.
 */
const CROWN_ARMS: ReadonlyArray<{ t: number; angle: number; len: number; front: boolean }> = [
  { t: 0.42, angle: 64, len: 96, front: false },
  { t: 0.5, angle: 60, len: 88, front: true },
  { t: 0.58, angle: 56, len: 80, front: false },
  { t: 0.66, angle: 52, len: 70, front: true },
  { t: 0.74, angle: 46, len: 60, front: false },
  { t: 0.82, angle: 40, len: 50, front: true },
  { t: 0.9, angle: 34, len: 40, front: false },
];

/**
 * The leaves a single arm carries, sized to its length.
 *
 * Four along the shaft and one at the tip, sized as fractions of the arm so a long
 * arm is dressed as fully as a short one. This is what stops bare wood showing: the
 * authored clusters were written per arm, and the arm that had no tip leaf ended in
 * a blunt stick past the foliage.
 */
function armLeaves(len: number, front: boolean, seed: number): LimbLeafSpec[] {
  // Depth, not two greens. A whole arm used to be one shade family - bright on the
  // front of the trunk, dark behind it - so the crown read as two colour schemes laid
  // side by side and an arm changed tone in one step. Each blade now takes its own
  // rung of the ladder (see depthFill), so an arm has near and far leaves in it and
  // the canopy is one mass with layers instead of two planes of paint.
  const shade = (at: number): string => depthFill(front, seed, at);
  // Small, deterministic variation per arm. A single template for every arm stamped
  // the same five blades in the same five places and the crown read as wallpaper;
  // these amounts are small enough that the silhouette stays balanced, and the two
  // sides get different seeds so the crown is not a mirrored decal either.
  const swing = seed % 2 === 0 ? 1 : -1;
  const lift = 1 + ((seed % 3) - 1) * 0.07;
  const reach = 1 + ((seed % 4) - 1.5) * 0.05;
  return [
    {
      at: 0.93 + 0.02 * (seed % 2),
      angle: -52 + swing * 9,
      len: len * 0.22 * reach,
      w: len * 0.085,
      fill: shade(0.93),
      veins: true,
    },
    // The terminal blade points out along the wood, not down across it. At 118 it
    // hung under the tip and left the rounded cap bare, which is the "stem with a
    // leaf stuck on the side" the crown kept showing at full growth.
    { at: 0.99, angle: 88 + swing * 6, len: len * 0.17 * lift, w: len * 0.06, fill: shade(0.99) },
    {
      at: 0.84,
      angle: 34 - swing * 8,
      len: len * 0.18 * reach,
      w: len * 0.07,
      fill: shade(0.84),
    },
    {
      at: 0.72,
      angle: -36 + swing * 7,
      len: len * 0.2 * lift,
      w: len * 0.078,
      fill: shade(0.72),
      veins: seed % 2 === 0,
    },
    {
      at: 0.56,
      angle: 46 + swing * 11,
      len: len * 0.17 * reach,
      w: len * 0.067,
      fill: shade(0.56),
    },
    { at: 0.4, angle: -22 - swing * 9, len: len * 0.14 * lift, w: len * 0.055, fill: shade(0.4) },
  ];
}

/**
 * The shade of one leaf, by depth.
 *
 * The crown has more planes than two. Leaves in front of the trunk are lit, leaves
 * behind it are in its shade, and the air between the layers cools what is farther
 * away - so the far rungs are not just darker, they lean blue and flat, which is
 * what tells the eye it is looking through foliage at more foliage. The two ladders
 * meet at the mid tone, so no leaf is a different colour scheme from its neighbour.
 *
 * The ladders are ordered from the inside of the crown to its edge, and a blade
 * takes the rung under its own attachment point rather than a hash of its seed.
 * That is the whole colour set: inner foliage in shadow, mid foliage in the deep
 * green, outer foliage in the front green, and only the outer edge in the light.
 * The old hash could put a highlight leaf at the trunk and a shadow leaf on the
 * tip of the same arm, which is what made the crown look randomly painted.
 */
const FRONT_SHADES = ['pl-leaf-e', 'pl-leaf-a', 'pl-leaf-g', 'pl-leaf-b'];
const BACK_SHADES = ['pl-leaf-f', 'pl-leaf-c', 'pl-leaf-e', 'pl-leaf-back'];
function depthFill(front: boolean, seed: number, at: number): string {
  const shades = front ? FRONT_SHADES : BACK_SHADES;
  const u = Math.max(0, Math.min(1, at));
  const rung = Math.min(shades.length - 1, Math.floor(u * shades.length));
  // One rung of variation, never a jump across the ladder: two neighbouring arms
  // should not be stamped with the same four tones in the same places.
  const jitter = (seed * 5 + Math.round(u * 17)) % 5 === 0 ? 1 : 0;
  return (
    shades[Math.min(shades.length - 1, rung + jitter)] ?? (front ? 'pl-leaf-a' : 'pl-leaf-back')
  );
}

const LIMBS: LimbSpec[] = CROWN_ARMS.flatMap((arm, index) =>
  [-1, 1].map((side) => {
    // The authored crown is mirrored: an arm of exactly equal length and angle on
    // each side of every tier. That is what turned the wood into a run of perfect
    // V-shaped forks. A couple of degrees and a few per cent of reach, deterministic
    // per arm, break the symmetry without changing the shape of the crown.
    const bias = ((index * 13 + (side > 0 ? 5 : 0)) % 7) - 3;
    const len = arm.len * (1 + bias * 0.012);
    return {
      t: arm.t + ((index + (side > 0 ? 2 : 0)) % 3) * 0.004 - 0.004,
      angle: arm.angle * side + bias * 0.9,
      len,
      front: arm.front,
      leaves: armLeaves(len, arm.front, index + (side === 1 ? 1 : 0)),
    };
  }),
);

/**
 * A limb's own arc, from its attachment at (0 0) to its tip at (len 0).
 *
 * The control point sits halfway along and a tenth of the length up, so the arm
 * bends upward as it grows. A straight stick for a limb is a prop, not a tree.
 */
/**
 * One limb as a filled, tapered shape rather than a stroke.
 *
 * A stroke has the same weight where an arm leaves the trunk as at its tip, which
 * is why the crown read as a set of pipes: the roots were already tapered shapes
 * and the branches were not. This traces the same arc twice - out along one edge,
 * back along the other - with the width closing to 45% at the tip, so a branch
 * looks like wood that got thinner as it grew.
 */
function limbOutline(len: number, w: number): string {
  const steps = 10;
  const near: string[] = [];
  const far: string[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const u = i / steps;
    const x = len * u;
    const y = limbRise(len, u);
    // The arc's own tangent, so the width is measured across the branch and not
    // up the page.
    const dx = len;
    const dy = -0.56 * len * (1 - 2 * u);
    const d = Math.hypot(dx, dy) || 1;
    const nx = -dy / d;
    const ny = dx / d;
    const half = (w / 2) * (1 - 0.55 * u);
    near.push(`${(x + nx * half).toFixed(1)} ${(y + ny * half).toFixed(1)}`);
    far.push(`${(x - nx * half).toFixed(1)} ${(y - ny * half).toFixed(1)}`);
  }
  // Round the tip instead of joining the two edges with a straight cut. The cap
  // is a quadratic through the tip's own end width, so every arm ends in wood that
  // closes like a stem rather than in a sawn-off rectangle.
  const farSide = [...far].reverse();
  return `M${near.join(' L')} Q${(len + w * 0.22).toFixed(1)} 0 ${farSide.join(' L')} Z`;
}

/** The height of that arc, in limb-local units, at a fraction of its length. */
function limbRise(len: number, at: number): number {
  const u = Math.max(0, Math.min(1, at));
  return -0.56 * len * u * (1 - u);
}

/** One limb and its leaf cluster, drawn in the limb's own frame. */
function limbMarkup(limb: LimbSpec, index: number): string {
  // Every arm is dressed along its whole length. The authored leaves are the shape
  // of a cluster at the tips, which left the inner half of each limb a bare stick
  // with foliage floating beside it - the exact thing the crown was accused of.
  // These fillers are derived from the limb, so all ten arms carry leaves from
  // where they leave the trunk out to their tips.
  // One width for the whole limb, from the height it leaves the trunk at (see
  // limbBaseWidth): the authored `w` could not keep both sides at the same height
  // the same thickness, and the crown read as sticks of random diameter.
  //
  // The group is scaled by `crownLength` (1.58 at ancient), so using the table's
  // width directly made every scaffold limb as thick as the trunk it left. The
  // crown then read as a run of heavy V-shaped forks even after the chevron scars
  // were removed. Dividing by a fixed reach factor keeps the wood a branch: it
  // still thickens as the plant ages, because the group scale and care scale both
  // grow, but it no longer matches the trunk's diameter.
  const baseW = limbBaseWidth(limb.t, limb.len) / 1.4;
  // Nine along the arm, not six. At the old crown length six left a visible gap
  // between clusters on the lower arms; the shorter blades in the gaps keep the
  // arm covered without turning it into a solid green tube.
  const dressing: LimbLeafSpec[] = [0.12, 0.2, 0.28, 0.44, 0.52, 0.6, 0.74, 0.8, 0.88].map(
    (at, i) => {
      const small = i % 3 === 1;
      return {
        at,
        angle: i % 2 === 0 ? 44 : -36,
        len: small ? 9 + baseW * 0.35 : 12 + baseW * 0.55,
        w: small ? 4 + baseW * 0.12 : 5 + baseW * 0.2,
        fill: depthFill(limb.front === true, index, at),
        veins: i === 1,
      };
    },
  );
  const leaves = [...dressing, ...limb.leaves]
    .sort((a, b) => a.at - b.at)
    .map((spec, leafIndex) => {
      const x = (limb.len * spec.at).toFixed(1);
      const y = limbRise(limb.len, spec.at).toFixed(1);
      // Every blade leaves the wood on a stalk. A leaf used to be rotated on the
      // limb's centreline, so half of its base was buried in the branch and the rest
      // hung off the side of it: the crown read as leaves stuck onto sticks. The
      // blade now starts a short petiole clear of the centreline, on the side it
      // grows towards, and the petiole is drawn from the wood to the base - a leaf
      // on a twig, which is the one thing that makes a drawn tree read as grown.
      // A few degrees of its own, deterministic and different per blade. Every
      // cluster used the same handful of authored angles, so an arm's leaves came
      // out in rows on a grid and the canopy read as wallpaper. Three degrees either
      // way is enough to break the rows and too little to unbalance the silhouette.
      const angle = spec.angle + (((index * 31 + leafIndex * 17) % 7) - 3);
      const rad = (angle * Math.PI) / 180;
      // The blade's own length runs along -y in its frame, so once rotated it grows
      // towards (sin a, -cos a): the stalk follows the leaf, never its opposite.
      // Short: long enough that the blade's base sits on the branch's edge rather
      // than in the middle of its width, short enough that no leaf looks held out on a
      // wire. On the drawn crown (measured at 1.4x and 2.6x) a stalk of half the
      // branch width plus a unit and a quarter put the base about a unit past the wood,
      // which is the joint a leaf actually has.
      // Short enough that the blade's base sits against the wood. It used to be
      // half the branch width plus nine tenths of a unit, which left a visible gap
      // at title size: the blade hung off the end of a hairline and the crown read
      // as leaves floating beside the branches.
      const stalk = baseW * 0.38 + 0.35;
      const bx = Number(x) + Math.sin(rad) * stalk;
      const by = Number(y) - Math.cos(rad) * stalk;
      const petiole =
        `<path class="pl-title-plant__petiole" d="M${x} ${y} L${bx.toFixed(1)} ${by.toFixed(1)}" ` +
        `fill="none" stroke="var(--pl-bark, #6a4a2b)" stroke-width="${(1.6 + baseW * 0.07).toFixed(2)}" ` +
        'stroke-linecap="round"/>';
      // A dark collar across the base of the blade, square to the stalk. Without it
      // the blade's rounded base floats over the end of its stalk and the join is a
      // guess; with it the leaf is welded to the twig.
      const collarHalf = 1.9;
      const collar =
        `<path d="M${(bx - Math.cos(rad) * collarHalf).toFixed(1)} ${(by - Math.sin(rad) * collarHalf).toFixed(1)} ` +
        `L${(bx + Math.cos(rad) * collarHalf).toFixed(1)} ${(by + Math.sin(rad) * collarHalf).toFixed(1)}" ` +
        'fill="none" stroke="var(--pl-leaf-edge, #2c4512)" stroke-opacity="0.4" ' +
        'stroke-width="1.1" stroke-linecap="round"/>';
      // Same units as the blade above (see `leaf`): crown leaves were the ones whose
      // veins hung outside them, because this call passed the un-shrunk size.
      const veins = spec.veins
        ? `<path d="${leafVeins(spec.len * LEAF_SIZE, spec.w * LEAF_SIZE)}" fill="none" ` +
          'stroke="var(--pl-leaf-vein, #2c4512)" stroke-opacity="0.18" stroke-width="0.85" ' +
          'stroke-linecap="round"/>'
        : '';
      return (
        `<g class="pl-title-plant__leaf pl-title-plant__leaf--crown" data-part="leaf" data-leaf="99" data-at="${spec.at}">` +
        // A crown leaf is placed once and never animated on its own: sixteen
        // SVG groups each running their own keyframes is sixteen style
        // recalculations a frame, and the whole crown breathes as one instead
        // (see pl-crown-breeze below).
        `<g class="pl-title-plant__leaf-rest" transform="translate(${bx.toFixed(1)} ${by.toFixed(1)}) rotate(${angle.toFixed(1)})">` +
        '<g class="pl-title-plant__crown-leaf-shape">' +
        `<path class="pl-title-plant__blade" data-shade="${spec.fill.replace('pl-leaf-', '')}" d="${leafPath(spec.len, spec.w)}" fill="url(#${spec.fill})" ` +
        'stroke="var(--pl-leaf-edge, #2c4512)" stroke-opacity="0.16" stroke-width="1"/>' +
        leafThrough(spec.len, spec.w) +
        veins +
        '</g>' +
        '</g>' +
        petiole +
        collar +
        '</g>'
      );
    })
    .join('');
  // The arm's own light. It is drawn in the limb's local frame, so the group's
  // rotation, reach and growth clip all apply without a second set of geometry.
  const stream =
    `<g class="pl-title-plant__limb-stream" data-limb-stream="${index}" aria-hidden="true">` +
    '<path class="pl-title-plant__stream-glow" d=""/>' +
    '<path class="pl-title-plant__stream-core" d=""/>' +
    '<path class="pl-title-plant__stream-head" d=""/>' +
    Array.from({ length: 7 }, () => '<circle class="pl-title-plant__stream-spark" r="0"/>').join(
      '',
    ) +
    '</g>';
  // A socket at the trunk end: without it a limb meets the trunk as two flat
  // shapes crossing, and every branch reads as a stick pushed through a hole. The
  // small dark flare grows out of the limb's own base and is painted under the
  // wood, so it welds the branch into the trunk at every growth stage.
  const socket =
    `<circle class="pl-title-plant__limb-socket" cx="0" cy="0" r="${(baseW * 0.52).toFixed(2)}" ` +
    // Same bark as the limb, no rim. The old flare was a wide chevron with a dark
    // edge, and at title size every arm carried a V-shaped scar where it met the
    // trunk. A round weld joins the wood without drawing a second silhouette.
    'fill="var(--pl-bark, #6a4a2b)" stroke="none"/>';
  return (
    `<g class="pl-title-plant__limb" data-limb="${index}" data-side="${limb.angle < 0 ? 'left' : 'right'}">` +
    // The wood runs to the last leaf's stalk. It used to stop at 95%, which left
    // the tip leaf's petiole rooted in empty air; now the rounded cap is the end of
    // the wood and the terminal blade sits on it.
    socket +
    `<path class="pl-title-plant__limb-wood" d="${limbOutline(limb.len * 0.99, baseW)}" ` +
    'fill="var(--pl-bark, #6a4a2b)" stroke="none" ' +
    `style="--pl-limb-w:${baseW.toFixed(2)}"/>` +
    leaves +
    stream +
    '</g>'
  );
}
/**
 * How far care can take the scale past the last art stage.
 *
 * Exported because the pane fit has to know how big the mascot *ends up*, not how
 * big it starts: it reserves the sky for the fully grown tree and divides the
 * available height by this, so the tallest possible plant is one that fits.
 */
// The ladder's own tallest stage, read rather than copied: the pane fit must reserve
// the exact size care can draw. It used to be a hand-typed 2.2 while the ladder ended
// at 1.7, so the tree was drawn small in a sky with room for a much larger one.
export const PLANT_MAX_SCALE = growthProfile(GROWTH_STAGES - 1).scale;
/** Where the strain creases cross the stem, as fractions of its length. */
const CREASE_TS: ReadonlyArray<number> = [0.26, 0.4, 0.54];
/**
 * How much of the stem's own turn a leaf takes with it.
 *
 * One is rigid: the leaf is welded to the tangent. A leaf hangs off a petiole and
 * only partly follows the stem, and at a deep bend the difference is the whole
 * problem - the crown flew out ahead of the plant instead of folding with it.
 */
const LEAF_TURN_FOLLOW = 0.55;
/** Largest rotation a leaf will take, in degrees, either way. */
const LEAF_MAX_TURN = 132;

function clampLeafRotation(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  return Math.max(-LEAF_MAX_TURN, Math.min(LEAF_MAX_TURN, deg));
}

function plantMarkup(): string {
  // Index is the leaf's own identity in the drawing, so a tap can name the exact
  // leaf it hit; the bands then decide what a bend does to it.
  const numbered = LEAF_SPECS.map((spec, index) => ({ spec, index }));
  const back = numbered
    .filter(({ spec }) => spec.back)
    .map(({ spec, index }) => leaf(spec, index))
    .join('');
  // The stem is one arc (title/plantBend.ts), drawn behind the front leaves and in
  // front of the back ones. The split is only about paint order - back leaves,
  // stem, lower front leaves, upper front leaves, bud - so the art is unchanged
  // by the bend being continuous.
  const front = numbered.filter(({ spec }) => !spec.back);
  // The crown: limbs off the trunk, each carrying its own cluster of leaves. Half
  // are drawn behind the trunk and half in front of it, which is what gives a flat
  // drawing a near side and a far side.
  const backLimbs = LIMBS.map((limb, index) => (limb.front ? '' : limbMarkup(limb, index))).join(
    '',
  );
  const frontLimbs = LIMBS.map((limb, index) => (limb.front ? limbMarkup(limb, index) : '')).join(
    '',
  );
  const lowerFront = front
    .slice(0, 2)
    .map(({ spec, index }) => leaf(spec, index))
    .join('');
  const tipFront = front
    .slice(2)
    .map(({ spec, index }) => leaf(spec, index))
    .join('');
  // Node nubs where a leaf leaves the stem: a stem is not a smooth pipe. Placed
  // at the origin and moved by the bend, so they ride the arc with the leaves.
  const nubs = NUB_POINTS.map(
    ([x, y]) =>
      `<ellipse class="pl-title-plant__nub" cx="0" cy="0" rx="6.4" ry="3.1" ` +
      `fill="url(#pl-stem)" transform="translate(${x} ${y})"/>`,
  ).join('');
  const creases = CREASE_TS.map(
    () =>
      '<line class="pl-title-plant__crease" x1="0" y1="0" x2="0" y2="0" ' +
      'stroke="var(--pl-stem-dark, #46741f)" stroke-width="1.7" stroke-linecap="round" ' +
      'stroke-opacity="0"/>',
  ).join('');

  return `
    <svg class="pl-title-plant__shoot" viewBox="-140 -60 480 284" role="img" aria-label="Plant" focusable="false">
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
        <!-- The depth ladder (see depthFill): a mid tone that both halves of the
             crown use, a lit mid for a blade catching sky, and the far plane, which is
             cooled toward the air instead of being a darker green. -->
        <linearGradient id="pl-leaf-e" x1="0" y1="1" x2="0.4" y2="0">
          <stop offset="0" style="stop-color: var(--pl-leaf-shadow, #33501a)"/>
          <stop offset="1" style="stop-color: var(--pl-leaf-mid, #5c8c2c)"/>
        </linearGradient>
        <linearGradient id="pl-leaf-f" x1="0" y1="1" x2="0.3" y2="0">
          <stop offset="0" style="stop-color: var(--pl-leaf-far, #39543a)"/>
          <stop offset="1" style="stop-color: var(--pl-leaf-shadow, #33501a)"/>
        </linearGradient>
        <linearGradient id="pl-leaf-g" x1="0" y1="1" x2="0.45" y2="0">
          <stop offset="0" style="stop-color: var(--pl-leaf-mid, #5c8c2c)"/>
          <stop offset="1" style="stop-color: var(--pl-leaf-mid-lit, #86bd44)"/>
        </linearGradient>
        <linearGradient id="pl-stem" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" style="stop-color: var(--pl-stem-dark, #46741f)"/>
          <stop offset="1" style="stop-color: var(--pl-stem, #5a902e)"/>
        </linearGradient>
        <radialGradient id="pl-energy-pool" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="var(--pl-energy-core, #fff6c9)" stop-opacity="0.9"/>
          <stop offset="0.4" stop-color="var(--pl-energy-glow, #d7e98d)" stop-opacity="0.42"/>
          <stop offset="1" stop-color="var(--pl-energy-glow, #d7e98d)" stop-opacity="0"/>
        </radialGradient>
        <!-- The light behind the crown. A moon or a low sun sits behind the tree
             and the gaps between the leaves hold a little of it; this is that
             light, not a beam drawn from the disc to the tree. -->
        <radialGradient id="pl-crown-through" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" style="stop-color: var(--pl-leaf-through-colour, #dfe9ff); stop-opacity: 0.62"/>
          <stop offset="0.55" style="stop-color: var(--pl-leaf-through-colour, #dfe9ff); stop-opacity: 0.24"/>
          <stop offset="1" style="stop-color: var(--pl-leaf-through-colour, #dfe9ff); stop-opacity: 0"/>
        </radialGradient>
        {/* The trunk fades into the plate's bark at the soil line. The flare used to
            stop in the trunk's lighter wood, which drew a horizontal seam exactly
            where it met the darker root crown. */}
        <linearGradient id="pl-trunk-flare-fill" gradientUnits="userSpaceOnUse"
                        x1="100" y1="201" x2="100" y2="224">
          <stop offset="0" style="stop-color: var(--pl-bark, #6a4a2b)"/>
          <stop offset="0.62" style="stop-color: var(--pl-bark, #6a4a2b)"/>
          <stop offset="0.86" style="stop-color: var(--pl-root-bark, #432c15)"/>
          <stop offset="1" style="stop-color: var(--pl-root-bark, #432c15)"/>
        </linearGradient>
        {/* A full bend can carry a low leaf under the soil line. The clip is the
            floor at y=224 (the foot); the sides and headroom stay open so the bend
            still uses the drawing's gutters. */}
        <clipPath id="pl-shoot-floor" clipPathUnits="userSpaceOnUse">
          <rect x="-1000" y="-1000" width="2000" height="1224"/>
        </clipPath>
      </defs>
      <g clip-path="url(#pl-shoot-floor)">
      <!-- Behind every leaf: the through-light pool, faded in only when a disc is
           actually behind the canopy (title/leafThroughLight). -->
      <g class="pl-title-plant__backlight" aria-hidden="true">
        <!-- Kept inside the canopy: at cy 58 / ry 92 the pool spilled down the
             trunk and lit the soil at its base, a glow in the ground brighter than
             the disc that was supposed to be casting it. -->
        <ellipse cx="100" cy="40" rx="120" ry="62" fill="url(#pl-crown-through)"/>
        <!-- The top light, on the upper crown only (title/leafThroughLight's top field). -->
        <g class="pl-title-plant__crown-top">
          <ellipse cx="100" cy="16" rx="104" ry="58" fill="url(#pl-crown-through)"/>
        </g>
      </g>
      <!-- Stage 0: a seed half out of the soil, with a split in its coat. -->
      <g class="pl-title-plant__seed">
        <path d="M76 221 C74 205 88 192 100 197 C113 202 114 216 102 221 C93 225 82 225 76 221 Z"
              fill="#a3814c" stroke="#3b2a12" stroke-opacity="0.45" stroke-width="1.8"/>
        <path d="M86 213 C92 205 101 201 108 203" fill="none" stroke="#f0dcae" stroke-width="2.4"
              stroke-linecap="round" opacity="0.5"/>
        <!-- The light the seed has taken in. Its radius is written from the stage,
             so care fills the seed rather than sending a beam out of it. -->
        <circle class="pl-title-plant__seed-kernel" cx="100" cy="211" r="2.4"
                fill="url(#pl-energy-pool)" stroke="var(--pl-energy-core, #fff6c9)"
                stroke-width="0.9" stroke-opacity="0.7"/>
      </g>
      <!-- Stage 1: two leaves on a short stem. -->
      <g class="pl-title-plant__sprout">
        <path d="M100 224 L98 186" stroke="url(#pl-stem)" stroke-width="7" fill="none" stroke-linecap="round"/>
        <g transform="translate(99 210) rotate(-56)">
          <path d="${leafPath(48, 16)}" fill="url(#pl-leaf-b)" stroke="var(--pl-leaf-edge, #2c4512)" stroke-opacity="0.16" stroke-width="1"/>
          ${leafThrough(48, 16)}
        </g>
        <g transform="translate(99 196) rotate(52)">
          <path d="${leafPath(40, 13)}" fill="url(#pl-leaf-d)" stroke="var(--pl-leaf-edge, #2c4512)" stroke-opacity="0.16" stroke-width="1"/>
          ${leafThrough(40, 13)}
        </g>
      </g>
      <g class="pl-title-plant__leaves">
        <g class="pl-title-plant__lower">
          ${back}
          <g class="pl-title-plant__tree" aria-hidden="true">${backLimbs}</g>
          <g class="pl-title-plant__stem" data-part="stem">
            <path class="pl-title-plant__stem-body" d="M100 224 L94 -8" stroke="url(#pl-stem)" stroke-width="11"
                  fill="none" stroke-linecap="round"/>
            <!-- The bottom of the same spine is bark, not stem green, and it
                 flares where it meets the root plate. The flare stays rooted
                 while the trunk above bends, so the joint is always covered. -->
            <g class="pl-title-plant__trunk">
              <!-- A filled bell from y=201 to the soil line, not a constant-width
                   stroke: a stroke cannot taper, and its round cap made the bulb.
                   The bell widens into the root crown and covers the trunk's
                   rounded bottom cap, so the two are one silhouette. -->
              <path class="pl-title-plant__trunk-flare"
                    d="M78 224 C80 216 84 207 89 201 C95 199 104 200 110 202 C115 208 120 216 122 224 Z"
                    fill="url(#pl-trunk-flare-fill)"/>
              <!-- Rounded head, and it stops under the crown: a butt cap at the top
                   of the box put a square-cut brown bar in the leaves. -->
              <path class="pl-title-plant__trunk-body" d="M100 224 L94 -6" stroke="var(--pl-bark, #6a4a2b)"
                    stroke-width="17" fill="none" stroke-linecap="round"/>
              <!-- One soft lit edge, and no dark lines.
                   The trunk used to carry two dark bark strokes down its length, a
                   wide one and a thin groove. At the title's scale they read as
                   scratches drawn on the wood - dark lines that are not part of
                   any real trunk - and a bend slid them until they crossed the
                   silhouette. The taper above already gives the trunk its form, so
                   what is left is a single warm highlight on the lit side: a
                   light, not an ink line. -->
              <!-- Taper, as two narrower lengths of the same wood laid over the
                   cylinder: a constant-width stroke is a pole, and a tree thins as it
                   climbs. Same colour, so the union reads as one tapering trunk. -->
              <path class="pl-title-plant__trunk-leader" data-from="0.4" data-to="0.8" d=""
                    stroke="var(--pl-bark, #6a4a2b)" stroke-width="12.5" fill="none"
                    stroke-linecap="round"/>
              <path class="pl-title-plant__trunk-leader" data-from="0.76" data-to="1" d=""
                    stroke="var(--pl-bark, #6a4a2b)" stroke-width="8.5" fill="none"
                    stroke-linecap="round"/>
              <path class="pl-title-plant__trunk-lit" data-offset="-4.4" d=""
                    stroke="var(--pl-bark-lit, #9a7244)" stroke-width="3.4" stroke-opacity="0.3"
                    fill="none" stroke-linecap="round"/>
            </g>
            <!-- The stem's foot, flat in bark. The underground half continues from
                 exactly here, and matching a gradient's end colour at a joint is a
                 guess - a flat colour is not. -->
            <!-- Compression on the inside of the bend: the side the fibres are
                 being crushed on. Invisible until the bend is deep. -->
            <path class="pl-title-plant__stem-compression" d="M100 214 L94 -10" stroke="var(--pl-stem-dark, #46741f)"
                  stroke-opacity="0" stroke-width="4.2" fill="none" stroke-linecap="round"/>
            ${nubs}
            ${creases}
          </g>
          ${lowerFront}
        </g>
        <g class="pl-title-plant__tip">
        ${tipFront}
        <g class="pl-title-plant__tree" aria-hidden="true">${frontLimbs}</g>
        <g class="pl-title-plant__bud-anchor">
          <g class="pl-title-plant__bud" data-part="bud" style="transform-origin:94px -6px">
            <g transform="translate(94 -6) rotate(-7)">
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
        </g>
      </g>
      <!-- The growth light is outside the leaves so it can be seen while the plant
           is still a seed or a sprout, when the main drawing is hidden. It paints
           over the whole plant: this is energy moving through it, not a second
           branch. -->
      <g class="pl-title-plant__stream" aria-hidden="true">
        <path class="pl-title-plant__stream-glow" d=""/>
        <path class="pl-title-plant__stream-core" d=""/>
        <path class="pl-title-plant__stream-head" d=""/>
        ${Array.from(
          { length: 16 },
          () => '<circle class="pl-title-plant__stream-spark" r="0"/>',
        ).join('')}
      </g>
      ${[0, 1]
        .map(
          (slot) =>
            `<g class="pl-title-plant__stream-echo" data-stream-echo="${slot}" aria-hidden="true">` +
            '<path class="pl-title-plant__stream-glow" d=""/>' +
            '<path class="pl-title-plant__stream-core" d=""/>' +
            '<path class="pl-title-plant__stream-head" d=""/>' +
            Array.from(
              { length: 7 },
              () => '<circle class="pl-title-plant__stream-spark" r="0"/>',
            ).join('') +
            '</g>',
        )
        .join('')}
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
  // The roots are painted before the shoot, not after it. Both SVGs overlap at the
  // soil line, and roots drawn last covered the trunk's foot with their own bark
  // crown, which read as a brown block standing between the tree and the ground.
  // Underground they are still in front of the soil; above it the wood is.
  // The drawing sits inside one plain wrapper, so the only thing moving every frame
  // is a box around a picture, not the hundred-odd SVG nodes inside it.
  element.innerHTML =
    '<div class="pl-title-plant__grab"></div>' +
    rootsMarkup() +
    '<div class="pl-title-plant__sway">' +
    plantMarkup() +
    '</div>';

  const leaves = element.querySelector<SVGGElement>('.pl-title-plant__leaves');
  const stemBody = element.querySelector<SVGPathElement>('.pl-title-plant__stem-body');
  const stemLit = element.querySelector<SVGPathElement>('.pl-title-plant__stem-lit');
  const compression = element.querySelector<SVGPathElement>('.pl-title-plant__stem-compression');
  const nubEls = [...element.querySelectorAll<SVGEllipseElement>('.pl-title-plant__nub')];
  const creaseLines = [...element.querySelectorAll<SVGLineElement>('.pl-title-plant__crease')];
  const budAnchor = element.querySelector<SVGGElement>('.pl-title-plant__bud-anchor');
  // One list for the leaves, not two parallel ones: the group that takes the move,
  // the group that carries the placement and the spec are the same leaf, and keeping
  // them in three arrays by index is how a leaf ends up rotating about another
  // leaf's stem.
  const leafParts = [...element.querySelectorAll<SVGGElement>('.pl-title-plant__leaf')].map(
    (group) => {
      const index = Number(group.dataset.leaf);
      return {
        group,
        index,
        place: group.querySelector<SVGGElement>('.pl-title-plant__leaf-place'),
        spec: LEAF_SPECS[index],
      };
    },
  );
  // Every blade's placement group, read once: the drawing is built here and growth
  // only reveals leaves, so this list is the whole canopy for the life of the plant.
  const leafPlaces = [
    ...element.querySelectorAll<SVGGElement>(
      '.pl-title-plant__leaf-shape, .pl-title-plant__crown-leaf-shape',
    ),
  ];
  // The flare is a filled shape authored in the drawing, not a stroked arc: the
  // bend loop rewrites only the spine paths, or it would flatten the bell back to
  // a line every frame.
  const trunkPaths = [
    ...element.querySelectorAll<SVGPathElement>('.pl-title-plant__trunk > path'),
  ].filter((path) => !path.classList.contains('pl-title-plant__trunk-flare'));
  const litPaths = [...element.querySelectorAll<SVGPathElement>('.pl-title-plant__trunk-lit')];
  const limbEls = [...element.querySelectorAll<SVGGElement>('.pl-title-plant__limb')];
  // The crown, in growth order rather than paint order: a tree grows its lowest,
  // oldest limb first, and the reveal has to follow that or the crown fills in from
  // the wrong end.
  const limbOrder = [...limbEls].sort(
    (a, b) => Number(a.dataset.limb ?? 0) - Number(b.dataset.limb ?? 0),
  );
  // Stem leaves in the order a shoot makes them: oldest (lowest) first.
  const leafOrder = [...element.querySelectorAll<SVGGElement>('.pl-title-plant__leaf')]
    .map((group) => ({
      group,
      spec: LEAF_SPECS[Number(group.dataset.leaf)],
    }))
    .filter((part): part is { group: SVGGElement; spec: LeafSpec } => Boolean(part.spec))
    .sort((a, b) => a.spec.stage - b.spec.stage);
  const roots = element.querySelector<SVGSVGElement>('.pl-title-plant__roots');
  // The soil is underground, and it is a part of the drawing like any other.
  roots?.setAttribute('data-part', 'root');
  // The shoot's own wood colour. It is set on the shoot, not the mascot, so the
  // roots keep their older bark while a sapling's stem is still green.
  const shoot = element.querySelector<SVGSVGElement>('.pl-title-plant__shoot');
  const woodVarState = new Map<string, string>();
  const setWoodVar = (name: string, value: string): void => {
    if (woodVarState.get(name) === value) return;
    woodVarState.set(name, value);
    shoot?.style.setProperty(name, value);
  };
  const stream = element.querySelector<SVGGElement>('.pl-title-plant__stream');
  const seedKernel = element.querySelector<SVGCircleElement>('.pl-title-plant__seed-kernel');
  const streamGlow = stream?.querySelector<SVGPathElement>('.pl-title-plant__stream-glow');
  const streamCore = stream?.querySelector<SVGPathElement>('.pl-title-plant__stream-core');
  const streamHead = stream?.querySelector<SVGPathElement>('.pl-title-plant__stream-head');
  const streamSparks = [
    ...(stream?.querySelectorAll<SVGCircleElement>('.pl-title-plant__stream-spark') ?? []),
  ];
  // Two spare comets, so two quick care actions can each add a stream before the
  // first has merged into the climbing front.
  const streamEchoes = [
    ...element.querySelectorAll<SVGGElement>('.pl-title-plant__stream-echo'),
  ].map((group) => ({
    group,
    glow: group.querySelector<SVGPathElement>('.pl-title-plant__stream-glow'),
    core: group.querySelector<SVGPathElement>('.pl-title-plant__stream-core'),
    head: group.querySelector<SVGPathElement>('.pl-title-plant__stream-head'),
    sparks: [...group.querySelectorAll<SVGCircleElement>('.pl-title-plant__stream-spark')],
    active: false,
    startMs: 0,
    target: 0,
    last: '',
  }));
  // Each arm carries its own light in its own frame. The growth clip on the limb
  // group then keeps the light on the wood that has actually grown, so the stream
  // and the branch tip cannot disagree about where the arm ends.
  const limbStreams = [
    ...element.querySelectorAll<SVGGElement>('.pl-title-plant__limb-stream'),
  ].flatMap((group) => {
    const index = Number(group.dataset.limbStream);
    const limb = LIMBS[index];
    if (!limb) return [];
    return [
      {
        group,
        index,
        limb,
        glow: group.querySelector<SVGPathElement>('.pl-title-plant__stream-glow'),
        core: group.querySelector<SVGPathElement>('.pl-title-plant__stream-core'),
        head: group.querySelector<SVGPathElement>('.pl-title-plant__stream-head'),
        sparks: [...group.querySelectorAll<SVGCircleElement>('.pl-title-plant__stream-spark')],
        last: '',
      },
    ];
  });

  let motion: PlantMotionState = createPlantMotion();
  let raf = 0;
  let destroyed = false;
  /** The part being answered right now, if any. */
  let tap: { response: TapResponse; startMs: number; index: number } | null = null;
  /** A bend held by the pointer, in degrees. */
  let bendDeg = 0;
  /** How far the stream of light has climbed the stem in the current run, 0..1. */
  let streamT = 0;
  /** Whether a growth run owns the light. */
  let streamActive = false;
  /**
   * How much of the stem the current drawing has actually built. The light stops
   * at the highest open leaf or living branch, never at the artwork's full tip.
   */
  let streamLimit = 1;
  /** The stem geometry last written, so a still stream does not rebuild its paths. */
  let streamLast = '';
  /**
   * How much of each arm is actually drawn. During a run this follows the light
   * rather than the stage directly: an arm starts when the stream reaches its
   * socket and reaches its stage shape before the light leaves it. The array is
   * always the current drawing, not just the target.
   */
  const limbGrowth: number[] = LIMBS.map(() => 0);
  /** Where each arm was when the run started, so a retarget never shrinks wood. */
  let runLimbFrom: number[] = LIMBS.map(() => 0);
  /** How far each arm reaches, and how far it swings from the trunk, at this stage. */
  let crownLength = 1;
  let crownSpread = 0;
  /** Where the plant was let go from, and when, so it can spring back. */
  let release: { fromDeg: number; startMs: number } | null = null;
  let dragStartX: number | null = null;
  /** The plant's width when the current drag began, so a bend never reads layout. */
  let dragBoxWidth: number | null = null;
  let lastTapAt = 0;
  let shudderStartMs = 0;
  /** Over-fed or over-watered: slower, heavier, and a little off its head. */
  let groggy = false;
  /** The leaf shivering from a tap, if any, and the bud nodding from one. */
  let leafFlick: { index: number; angle: number } | null = null;
  let budFlick = 0;
  /** The last drawing written, so a still plant never rebuilds its path. */
  let paintedKey = '';
  // Synthesised, not loaded: nothing starts until the first gesture, which is
  // also the rule a browser gives us for any sound at all.
  const sound = createPlantSound();

  /**
   * Draw the bent plant: the stem as an arc, every leaf placed along it, and the
   * strain that shows up as the bend approaches its limit.
   *
   * This replaced rigid rotations of two halves. A hinge cannot show a stem being
   * pulled: the spine has to curve, and the leaves have to ride the curve, which is
   * what makes the bend read as a plant giving way rather than a stick folding.
   */
  const paintBend = (): void => {
    const tension = bendTension(bendDeg, MAX_BEND_DEG);
    const bent = Math.abs(bendDeg) > 0.01;
    const arc = (shift: number): string =>
      bendArcPath(bendDeg, STEM_LENGTH, STEM_BASE_X, STEM_BASE_Y, 14, shift, STEM_REST_DEG);

    if (stemBody) {
      // While the tree is bent, only the green tip above the wood is drawn. The trunk
      // covers the rest, and the two arcs are sampled differently, so at a deep bend
      // the stem showed past the bark on the inside of the curve - a green skeleton
      // inside a brown trunk.
      const woodTop = 0.88;
      stemBody.setAttribute(
        'd',
        bent
          ? bendArcSegment(
              bendDeg,
              STEM_LENGTH,
              STEM_BASE_X,
              STEM_BASE_Y,
              woodTop,
              1,
              10,
              0,
              STEM_REST_DEG,
            )
          : arc(0),
      );
      // A pulled stem thins: the fibres are carrying the load, not just the shape.
      stemBody.setAttribute('stroke-width', (11 - 2.6 * tension).toFixed(2));
    }
    if (stemLit) {
      stemLit.setAttribute('d', arc(3.2));
      stemLit.setAttribute('stroke-width', (2.6 - 0.4 * tension).toFixed(2));
      // The tension side brightens as the fibres are stretched on the outside of
      // the curve, which is the counterpart to the compression shadow inside it.
      stemLit.setAttribute('stroke-opacity', (0.3 + 0.24 * tension).toFixed(3));
    }
    if (compression) {
      compression.setAttribute('d', arc(-3.4));
      compression.setAttribute('stroke-opacity', (0.45 * tension).toFixed(3));
    }

    // Creases across the stem, on the side being compressed. They fade in with the
    // square of the bend, so the first third of a pull is clean and the last third
    // is visibly working.
    //
    // Never on a tree. A crease is a short line drawn *across* the stem to show a
    // green shoot being crushed; on brown bark at this size the same line is a
    // brown horizontal mark smeared over the trunk every time it is pulled, which
    // is what it looked like. A woody trunk strains by thickening its compression
    // shadow, not by being scored.
    const woody = element.classList.contains('is-tree');
    for (const [index, line] of creaseLines.entries()) {
      if (woody) {
        line.setAttribute('stroke-opacity', '0');
        continue;
      }
      const t = CREASE_TS[index] ?? 0.5;
      const point = bendPoint(bendDeg, t, STEM_LENGTH, STEM_REST_DEG);
      const theta = ((STEM_REST_DEG + point.turnDeg) * Math.PI) / 180;
      const nx = -Math.sin(theta);
      const ny = Math.cos(theta);
      const half = 4.2 + tension * 1.8;
      const cx = STEM_BASE_X + point.x;
      const cy = STEM_BASE_Y + point.y;
      line.setAttribute('stroke-width', (1.7 + tension * 0.6).toFixed(2));
      line.setAttribute('x1', (cx - nx * half).toFixed(2));
      line.setAttribute('y1', (cy - ny * half).toFixed(2));
      line.setAttribute('x2', (cx + nx * half).toFixed(2));
      line.setAttribute('y2', (cy + ny * half).toFixed(2));
      line.setAttribute('stroke-opacity', (0.62 * tension).toFixed(3));
    }

    for (const [index, nub] of nubEls.entries()) {
      const [x, y] = NUB_POINTS[index] ?? [STEM_BASE_X, STEM_BASE_Y - STEM_LENGTH / 2];
      const place = bendPlacement(bendDeg, y, STEM_BASE_Y, STEM_LENGTH, STEM_REST_DEG);
      nub.setAttribute(
        'transform',
        `translate(${(x + place.dx).toFixed(2)} ${(y + place.dy).toFixed(2)}) rotate(${place.turnDeg.toFixed(2)})`,
      );
    }

    for (const { group, index, place: placeEl, spec } of leafParts) {
      if (!spec || !placeEl) continue;
      const place = bendPlacement(bendDeg, spec.y, STEM_BASE_Y, STEM_LENGTH, STEM_REST_DEG);
      const flick = leafFlick && leafFlick.index === index ? leafFlick.angle : 0;
      // Leaves hang from a petiole; they do not stay welded to the stem's tangent.
      // Following it exactly swung the topmost leaves through the whole bend, so a
      // deep pull whipped the canopy about and the crown looked detached from the
      // plant (and left the drawing). Each leaf now takes a little over half of the
      // stem's turn and adds its own droop, with the total held inside a range a
      // leaf can actually reach, which keeps the crown on the spine as it folds.
      const heightFraction = Math.max(0, (STEM_BASE_Y - spec.y) / STEM_LENGTH);
      const leafTurn = place.turnDeg * LEAF_TURN_FOLLOW;
      const droop = Math.sign(bendDeg) * tension * 7 * heightFraction;
      const rotation = clampLeafRotation(leafTurn + droop + flick);
      // The move is the CSS `translate` property, which no origin can skew, and the
      // turn is folded into the leaf's placement attribute so it pivots on the point
      // where the leaf meets the stem. The two together are the leaf's base landing
      // on the bent spine: it cannot come off the tree.
      group.style.translate = bent ? `${place.dx.toFixed(2)}px ${place.dy.toFixed(2)}px` : '';
      placeEl.setAttribute(
        'transform',
        `translate(${spec.x} ${spec.y}) rotate(${(spec.angle + rotation).toFixed(2)})`,
      );
    }

    // The trunk is the bottom of the same arc as the stem, in bark and one width
    // wider, so the woody base and the green top can never drift apart. The filled
    // flare below it is static: a root crown is anchored in the soil and does not
    // bend with the trunk, while the trunk's bottom cap stays inside its bell.
    for (const path of trunkPaths) {
      const cls = path.getAttribute('class') ?? '';
      const isLit = cls.includes('trunk-lit');
      const isLeader = cls.includes('trunk-leader');
      // The trunk body starts just above the soil line so its round bottom cap is
      // covered by the flare; stopping it at y=224 left a bulb under the bell.
      const from = isLit ? 0.02 : isLeader ? Number(path.dataset.from ?? 0.4) : 0.06;
      // The wood reaches most of the way up: a tree is a trunk with a crown on it,
      // and a trunk that stops halfway leaves a green stalk holding the canopy.
      // The trunk runs the whole stem, soil to tip: a leader above the topmost
      // limb is what a tree looks like, and stopping it below left the green stem
      // poking out of the crown.
      const to = isLeader ? Number(path.dataset.to ?? 1) : 1;
      path.setAttribute(
        'd',
        bendArcSegment(
          bendDeg,
          STEM_LENGTH,
          STEM_BASE_X,
          STEM_BASE_Y,
          from,
          isLit ? 0.58 : to,
          10,
          isLit ? 3.4 : 0,
          STEM_REST_DEG,
        ),
      );
    }

    for (const path of litPaths) {
      const offset = Number(path.dataset.offset ?? 0);
      path.setAttribute(
        'd',
        bendArcSegment(
          bendDeg,
          STEM_LENGTH,
          STEM_BASE_X,
          STEM_BASE_Y,
          0.12,
          0.88,
          10,
          offset,
          STEM_REST_DEG,
        ),
      );
    }

    for (const [index, limbEl] of limbEls.entries()) {
      const limb = LIMBS[index] ?? LIMBS[LIMBS.length - 1];
      const point = bendPoint(bendDeg, limb.t, STEM_LENGTH, STEM_REST_DEG);
      // Off the stem's own tangent, so the limbs fold with the trunk. The leaves at
      // a limb's end ride in its group, so they cannot be left behind by the bend:
      // they are placed once, in the limb's own frame.
      // Spread and reach are the crown's age made visible: the same ten arms are
      // held in close and short on a young tree and laid out long and wide on an
      // old one, so the tiers differ in silhouette, not only in leaf size.
      const outward = Math.sign(limb.angle);
      // Every arm rises a little more than authored. At their drawn angles the crown
      // was a flat half-circle of spokes - a fish skeleton with leaves on it - and a
      // real crown's arms climb as they leave the trunk. Uniform, so the authored
      // shape is kept and only its steepness changes.
      const heading = STEM_REST_DEG + point.turnDeg + limb.angle * ARM_RISE + outward * crownSpread;
      limbEl.setAttribute(
        'transform',
        `translate(${(STEM_BASE_X + point.x).toFixed(2)} ${(STEM_BASE_Y + point.y).toFixed(2)}) ` +
          `rotate(${heading.toFixed(2)})` +
          (crownLength === 1 ? '' : ` scale(${crownLength.toFixed(3)})`),
      );
    }

    if (streamActive) paintStream(performance.now());

    if (budAnchor) {
      const place = bendPlacement(bendDeg, BUD_Y, STEM_BASE_Y, STEM_LENGTH, STEM_REST_DEG);
      // As a transform attribute rather than a CSS transform: Chrome paints a
      // group's gradient-filled children as a block under a CSS matrix at this
      // kind of rotation, which showed up as a pale rectangle where the bud was.
      // The origin is the bud's attachment, baked into the rotation.
      budAnchor.setAttribute(
        'transform',
        bent || budFlick !== 0
          ? `translate(${place.dx.toFixed(2)} ${place.dy.toFixed(2)}) ` +
              `rotate(${(place.turnDeg + budFlick).toFixed(2)} 90 ${BUD_Y})`
          : '',
      );
    }
  };

  /** A path along one arm, in the limb's own frame, from `from` to `to` of its length. */
  const limbStreamPath = (limb: LimbSpec, from: number, to: number): string => {
    const a = Math.max(0, Math.min(1, from));
    const b = Math.max(a, Math.min(1, to));
    const steps = 7;
    let path = '';
    for (let i = 0; i <= steps; i += 1) {
      const u = a + (b - a) * (i / steps);
      const x = (limb.len * u).toFixed(2);
      const y = limbRise(limb.len, u).toFixed(2);
      path += `${i === 0 ? 'M' : 'L'}${x} ${y}`;
    }
    return path;
  };

  /**
   * Where an arm's light leaves the trunk: the outside of its socket, not the
   * stem's centreline. The socket is the nub the branch grows out of, so starting
   * the stream at 0 drew a glow across the trunk before it entered the wood.
   */
  const limbNubStart = (limb: LimbSpec): number => {
    const socketRadius = (limbBaseWidth(limb.t, limb.len) / 1.4) * 0.52;
    return Math.min(0.22, socketRadius / Math.max(0.001, limb.len));
  };

  /** A short path up the sprout's own stem, not the tree's full trunk. */
  const sproutStreamPath = (from: number, to: number): string => {
    const a = Math.max(0, Math.min(1, from));
    const b = Math.max(a, Math.min(1, to));
    const steps = 6;
    let path = '';
    for (let i = 0; i <= steps; i += 1) {
      const u = a + (b - a) * (i / steps);
      const x = (STEM_BASE_X + (SPROUT_TIP_X - STEM_BASE_X) * u).toFixed(2);
      const y = (STEM_BASE_Y - SPROUT_LENGTH * u).toFixed(2);
      path += `${i === 0 ? 'M' : 'L'}${x} ${y}`;
    }
    return path;
  };

  const hideStreamEchoes = (): void => {
    for (const echo of streamEchoes) {
      echo.active = false;
      echo.group.classList.remove('is-on');
    }
  };

  /**
   * Add a second stream from the root crown when care arrives mid-run.
   *
   * The main stream keeps its place; this comet runs from the base to the live
   * front and merges into it. Two spare groups let a rapid double watering show
   * two additions instead of replacing the first.
   */
  const spawnStreamEcho = (target: number): void => {
    if (!streamActive || streamEchoes.length === 0) return;
    const free = streamEchoes.find((echo) => !echo.active);
    const oldest = streamEchoes.reduce((a, b) => (a.startMs <= b.startMs ? a : b));
    const echo = free ?? oldest;
    echo.active = true;
    echo.startMs = performance.now();
    echo.target = Math.max(0.04, Math.min(1, target));
    echo.last = '';
    echo.group.classList.add('is-on');
  };

  const paintStreamEchoes = (nowMs: number): void => {
    for (const echo of streamEchoes) {
      if (!echo.active) continue;
      const t = Math.min(1, (nowMs - echo.startMs) / 720);
      if (t >= 1) {
        echo.active = false;
        echo.group.classList.remove('is-on');
        continue;
      }
      // A quick climb that slows into the front; the head does not outrun the wood.
      const head = echo.target * (1 - (1 - t) ** 3);
      const key = `${head.toFixed(4)}|${bendDeg.toFixed(2)}`;
      if (key !== echo.last) {
        echo.last = key;
        const path = bendArcSegment(
          bendDeg,
          STEM_LENGTH,
          STEM_BASE_X,
          STEM_BASE_Y,
          0,
          head,
          12,
          0,
          STEM_REST_DEG,
        );
        echo.glow?.setAttribute('d', path);
        echo.core?.setAttribute('d', path);
        echo.head?.setAttribute(
          'd',
          bendArcSegment(
            bendDeg,
            STEM_LENGTH,
            STEM_BASE_X,
            STEM_BASE_Y,
            Math.max(0, head - 0.08),
            head,
            5,
            0,
            STEM_REST_DEG,
          ),
        );
      }
      const tailStart = Math.max(0, head - 0.36);
      const phase = (nowMs / 360) % 1;
      for (const [index, spark] of echo.sparks.entries()) {
        const u = tailStart + (head - tailStart) * ((index + phase) / echo.sparks.length);
        const point = bendPoint(bendDeg, u, STEM_LENGTH, STEM_REST_DEG);
        const ahead = head > tailStart + 0.0001 ? (u - tailStart) / (head - tailStart) : 1;
        spark.setAttribute('cx', (STEM_BASE_X + point.x).toFixed(2));
        spark.setAttribute('cy', (STEM_BASE_Y + point.y).toFixed(2));
        spark.setAttribute('r', (0.7 + 1.7 * ahead).toFixed(2));
        spark.setAttribute('opacity', (0.18 + 0.74 * ahead).toFixed(2));
      }
    }
  };

  /**
   * Draw the growth light at its current progress.
   *
   * The light is a routed stream, not a beam to the sky: it stops at the highest
   * foliage or living branch the drawing has actually grown (`streamLimit`), follows
   * the bent stem, and runs out along every arm whose socket it has passed. A seed
   * has no stem, so it keeps a growing kernel instead. A sprout's stream is the
   * length of its own short stem. The pool at the root crown is where the care
   * particles land; a second care flashes it again and sends a fresh comet up to
   * the live front instead of rebuilding the first stream from the ground.
   */
  const paintStream = (nowMs: number): void => {
    if (!stream || !streamActive) return;
    const tier = element.dataset.growthTier;
    const isSeed = tier === 'seed';
    const isSprout = tier === 'sprout';
    const mode: 'seed' | 'sprout' | 'main' = isSeed ? 'seed' : isSprout ? 'sprout' : 'main';
    const front = isSeed
      ? 0
      : isSprout
        ? Math.max(0, Math.min(1, streamT))
        : Math.max(0, Math.min(1, streamT * streamLimit));
    const stemKey = `${mode}|${front.toFixed(4)}|${bendDeg.toFixed(2)}`;
    if (stemKey !== streamLast) {
      streamLast = stemKey;
      if (isSeed || front <= 0.002) {
        streamGlow?.setAttribute('d', '');
        streamCore?.setAttribute('d', '');
        streamHead?.setAttribute('d', '');
      } else if (isSprout) {
        const path = sproutStreamPath(0, front);
        streamGlow?.setAttribute('d', path);
        streamCore?.setAttribute('d', path);
        streamHead?.setAttribute('d', sproutStreamPath(Math.max(0, front - 0.12), front));
      } else {
        const path = bendArcSegment(
          bendDeg,
          STEM_LENGTH,
          STEM_BASE_X,
          STEM_BASE_Y,
          0,
          front,
          18,
          0,
          STEM_REST_DEG,
        );
        streamGlow?.setAttribute('d', path);
        streamCore?.setAttribute('d', path);
        streamHead?.setAttribute(
          'd',
          bendArcSegment(
            bendDeg,
            STEM_LENGTH,
            STEM_BASE_X,
            STEM_BASE_Y,
            Math.max(0, front - 0.08),
            front,
            6,
            0,
            STEM_REST_DEG,
          ),
        );
      }
    }

    if (isSeed) {
      for (const spark of streamSparks) spark.setAttribute('opacity', '0');
      for (const item of limbStreams) item.group.classList.remove('is-lit');
      hideStreamEchoes();
      return;
    }

    const tailStart = Math.max(0, front - (isSprout ? 0.62 : 0.42));
    const tail = front - tailStart;
    const phase = (nowMs / 480) % 1;
    for (const [index, spark] of streamSparks.entries()) {
      const u = tailStart + tail * ((index + phase) / streamSparks.length);
      const point = isSprout
        ? {
            x: (SPROUT_TIP_X - STEM_BASE_X) * u,
            y: -SPROUT_LENGTH * u,
          }
        : bendPoint(bendDeg, u, STEM_LENGTH, STEM_REST_DEG);
      const ahead = tail > 0.0001 ? (u - tailStart) / tail : 1;
      spark.setAttribute('cx', (STEM_BASE_X + point.x).toFixed(2));
      spark.setAttribute('cy', (STEM_BASE_Y + point.y).toFixed(2));
      spark.setAttribute('r', ((isSprout ? 0.7 : 1) + (isSprout ? 1.7 : 2.6) * ahead).toFixed(2));
      spark.setAttribute('opacity', front > 0.01 ? (0.22 + 0.78 * ahead).toFixed(2) : '0');
    }

    if (isSprout) {
      for (const item of limbStreams) item.group.classList.remove('is-lit');
      hideStreamEchoes();
      return;
    }

    // Every arm the front has reached glows along its own curved wood, not just the
    // one that happens to be growing this frame. That is what makes the light read
    // as a route through the crown instead of one vertical line up the trunk.
    for (const item of limbStreams) {
      const grow = Math.max(0, Math.min(1, limbGrowth[item.index] ?? 0));
      const from = Math.min(limbNubStart(item.limb), grow);
      const active = front >= item.limb.t - 0.02 && grow > from + 0.005;
      item.group.classList.toggle('is-lit', active);
      if (!active) continue;
      // The whole arm is the route, not only its newest tip: a short glint at the
      // end of each branch still read as a line up the trunk with dots beside it.
      // From the socket's outer nub the stream runs along the wood the branch has
      // reached, so the light visibly forks through the crown and stays on it.
      const key = `${from.toFixed(3)}|${grow.toFixed(3)}`;
      if (key !== item.last) {
        item.last = key;
        const path = limbStreamPath(item.limb, from, grow);
        item.glow?.setAttribute('d', path);
        item.core?.setAttribute('d', path);
        item.head?.setAttribute('d', limbStreamPath(item.limb, Math.max(from, grow - 0.08), grow));
      }
      const sparkPhase = (nowMs / 380) % 1;
      for (const [index, spark] of item.sparks.entries()) {
        const u = from + (grow - from) * ((index + sparkPhase) / item.sparks.length);
        const ahead = grow > from + 0.0001 ? (u - from) / (grow - from) : 1;
        spark.setAttribute('cx', (item.limb.len * u).toFixed(2));
        spark.setAttribute('cy', limbRise(item.limb.len, u).toFixed(2));
        spark.setAttribute('r', (0.7 + 1.8 * ahead).toFixed(2));
        spark.setAttribute('opacity', (0.18 + 0.82 * ahead).toFixed(2));
      }
    }

    paintStreamEchoes(nowMs);
  };

  let lastPaintMs = 0;
  let lastLeafTf = '';
  /**
   * Whether the plant has anything of its own to draw. The idle sway is CSS now, so
   * a plant nobody is touching has nothing to say and the loop stops.
   */
  const ticking = (nowMs: number): boolean =>
    bendDeg !== 0 ||
    dragStartX !== null ||
    release !== null ||
    tap !== null ||
    leafFlick !== null ||
    budFlick !== 0 ||
    nowMs < shudderStartMs + 900;

  /** Start the loop again after it parked, or after it was paused. */
  const wake = (): void => {
    if (destroyed || !active || raf !== 0) return;
    lastPaintMs = 0;
    raf = requestAnimationFrame(tick);
  };

  const tick = (nowMs: number): void => {
    if (destroyed || !active) return;
    // Thirty frames is a plant breathing. Sixty was twice the paint for a movement
    // nobody can see, and this drawing is a canopy of gradient-filled paths: the
    // title scene's largest per-frame cost was the mascot moving at full rate.
    // A breathing plant at sixty, or even thirty, frames a second is a canopy of
    // gradient-filled paths repainted for a movement of a fraction of a pixel: it
    // was the heaviest thing on the title screen and it ran whether or not anything
    // was happening. A held bend, a spring-back, a tap or a shudder is answered at
    // 30 Hz, where the motion is; the idle sway is a five-second breath and is drawn
    // at 15 Hz, where nothing can be seen to step.
    if (!ticking(nowMs)) {
      // Nothing is being answered. The canopy's idle motion is CSS now, so there is
      // nothing here to draw: hand the canopy back to the stylesheet and stop. A
      // resting plant asks for no frames at all.
      if (leaves && lastLeafTf !== '') {
        leaves.style.transform = '';
        lastLeafTf = '';
      }
      raf = 0;
      return;
    }
    const busy =
      dragStartX !== null || release !== null || tap !== null || nowMs < shudderStartMs + 900;
    // A held bend and its spring-back are the one place the plant's motion is fast
    // enough for 30 Hz to read as stepping; the drag gets 60, taps and shudders keep
    // the cheaper rate, and the idle canopy is pure CSS.
    if (nowMs - lastPaintMs < (busy ? 16 : 66)) {
      raf = requestAnimationFrame(tick);
      return;
    }
    lastPaintMs = nowMs;

    // One reaction at a time: whatever part was touched answers, then is cleared.
    let canopyKick = 0;
    if (tap) {
      const elapsed = nowMs - tap.startMs;
      const angle = swingAngle(elapsed, tap.response);
      if (elapsed >= tap.response.durationMs) {
        if (tap.response.part === 'leaf') leafFlick = null;
        if (tap.response.part === 'bud') budFlick = 0;
        if (tap.response.part === 'root') roots?.removeAttribute('style');
        tap = null;
      } else if (tap.response.part === 'leaf') {
        // The flick is not written here: the leaf's transform already carries its
        // placement along the bent stem, and the flick is added to that rotation
        // by the painter, so a tap during a bend composes instead of fighting.
        leafFlick = { index: tap.index, angle: angle * leafSwingSign(tap.index) };
      } else if (tap.response.part === 'stem') {
        canopyKick += angle;
      } else if (tap.response.part === 'bud') {
        budFlick = angle;
      }
      // The roots do not answer a tap. They are the plant's anchor in the ground, and a
      // root plate that swings when it is poked reads as a decoration hanging off the
      // trunk rather than as something buried: the wobble used to rotate the whole
      // plate by six tenths of the tap's angle.
    }

    // A double tap rattles the whole plant once.
    if (nowMs < shudderStartMs + 900) {
      const t = (nowMs - shudderStartMs) / 900;
      canopyKick += Math.sin(t * Math.PI * 9) * 1.6 * (1 - t) ** 2;
    }

    // The bend: held by the pointer, or springing back from where it was let go.
    if (release) {
      const elapsed = nowMs - release.startMs;
      if (elapsed >= 1900) release = null;
      bendDeg = release ? releaseAngle(elapsed, release.fromDeg) : 0;
    }

    if (leaves) {
      // Only a tap or a shake turns the canopy now. The idle sway is CSS, and a bend
      // is carried by the stem's own arc.
      const nextTf = canopyKick === 0 ? '' : `rotate(${canopyKick.toFixed(2)}deg)`;
      if (nextTf !== lastLeafTf) {
        leaves.style.transform = nextTf;
        lastLeafTf = nextTf;
      }
    }

    // The stem is redrawn as an arc, and the leaves ride it. Only when something
    // has actually changed: a swaying, unbent plant must not rebuild its path 60
    // times a second.
    // Quantised for painting, not for the model: two tenths of a degree is under a
    // pixel of crown travel, so a slow drag repaints a fifth as often as it asks
    // for frames, and the spring-back stops rewriting forty SVG attributes to move
    // a leaf by a rounding error.
    const paintDeg = Math.round(bendDeg * 5) / 5;
    const flickKey = `${leafFlick ? `${leafFlick.index}:${leafFlick.angle.toFixed(1)}` : ''}|${budFlick.toFixed(1)}`;
    const key = `${paintDeg.toFixed(1)}|${flickKey}`;
    if (key !== paintedKey) {
      paintBend();
      paintedKey = key;
    }

    raf = requestAnimationFrame(tick);
  };

  /** One part answers for itself. Rate-limited so holding a finger cannot stack. */
  const tapPart = (part: PlantPart, index: number): void => {
    wake();
    const now = performance.now();
    if (now - lastTapAt < 70) return;
    lastTapAt = now;
    tap = { response: tapResponse(part), startMs: now, index };
    sound.tap(part);
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
    dragBoxWidth = element.getBoundingClientRect().width;
    bendDeg = 0;
    release = null;
    sound.begin();
    element.classList.add('is-bending');
    wake();
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
    // The loop parks when nothing is being drawn, so a press has to start it again.
    wake();
    pressed = { part, index, x: event.clientX, y: event.clientY };
    // The plant owns this gesture; the scene behind it must not also pan.
    event.stopPropagation();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (dragStartX !== null) {
      wake();
      // One measurement per drag, taken when it began. Reading the box on every
      // pointermove forced the browser to run layout again right after the previous
      // frame had written sixty SVG attributes - a read-after-write thrash, and the
      // reason bending was the slowest thing in the scene.
      bendDeg = bendDegrees(event.clientX - dragStartX, Math.max(24, (dragBoxWidth ?? 0) * 0.5));
      // The bend is where the creak comes from: the sound tracks the angle, so the
      // plant goes quiet when the pointer stops moving it.
      sound.bend(bendDeg);
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
      sound.release(bendDeg);
      release = { fromDeg: bendDeg, startMs: performance.now() };
      wake();
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
    wake();
  };

  /**
   * End a bend whose capture was taken away.
   *
   * A capture is lost without a pointerup when the window loses focus or another
   * element takes the pointer. The element then kept `is-bending` - the grabbing
   * cursor over every leaf - and the stem stayed at its pulled angle until the
   * next press. A lost capture is a release: put the stem back the same way.
   */
  const onLostCapture = (): void => {
    if (dragStartX !== null) {
      dragStartX = null;
      element.classList.remove('is-bending');
      sound.release(bendDeg);
      release = { fromDeg: bendDeg, startMs: performance.now() };
      wake();
    }
    pressed = null;
  };

  /** A drag released outside the plant ends even if the capture never took. */
  const onWindowPointerEnd = (event: PointerEvent): void => {
    if (dragStartX === null) return;
    endDrag(event);
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', endDrag);
  element.addEventListener('pointercancel', endDrag);
  element.addEventListener('lostpointercapture', onLostCapture);
  window.addEventListener('pointerup', onWindowPointerEnd);
  window.addEventListener('pointercancel', onWindowPointerEnd);
  element.addEventListener('dblclick', onDoubleTap);
  // Paint the rest pose once, by hand. Limbs have no placement until the first
  // paint, and the loop now parks itself when nothing is moving - so without this
  // the whole crown sat at the drawing's origin until the plant was touched.
  paintBend();
  raf = requestAnimationFrame(tick);

  let active = true;

  /**
   * A gust the plant did not ask for.
   *
   * The drag path is reused exactly: set the bend, then let go. That way a gust
   * cannot leave the plant in a state a release could not, and the spring-back, the
   * leaf ride and the strain marks all come from the gesture's own drawing.
   */
  const gust = (deg: number): void => {
    if (destroyed || options.reducedMotion) return;
    if (!Number.isFinite(deg) || Math.abs(deg) < 0.2) return;
    const pushed = Math.max(-MAX_BEND_DEG, Math.min(MAX_BEND_DEG, deg));
    bendDeg = pushed;
    release = { fromDeg: pushed, startMs: performance.now() };
    lastPaintMs = 0;
    wake();
  };

  /**
   * A hand passing through the leaves.
   *
   * Every blade is pushed along the hand's direction and then released, in waves
   * down the canopy, so the touch travels and each leaf settles on its own. It
   * touches no joint of the plant: nothing here changes the bend, so the trunk, the
   * stem and the roots do not move.
   *
   * The push and the spring are transitions, not keyframes, which is what lets a
   * second pass be answered immediately: a new touch re-aims the leaves that are
   * still moving instead of restarting them from rest (the snap) or being dropped
   * for the length of the settle.
   */
  // Tuned to a hand, not a gust. Measured against a fast mouse pass at title size: a
  // leaf about 40px across, a finger's contact patch about 55px, so the reach is a
  // little wider than a fingertip and the blade moves in ~90ms - if the push outlasts
  // the hand, the leaf looks pushed by the air behind it. The return is 720ms, which
  // is long enough to read as a leaf settling and short enough that the next pass can
  // touch the same blade again.
  const RUSTLE_PUSH_MS = 90;
  const RUSTLE_SETTLE_MS = 720;
  /** How far a wave travels out from the hand, per unit of distance. */
  const RUSTLE_WAVE_MS = 40;
  /** The blades one pass may touch: a hand brushes a cluster, not the crown. */
  const RUSTLE_MAX = 14;
  /** How far from the pointer a passing hand is felt, in screen pixels. */
  // 54 px reached two blades on a grown tree and the hand passed through a crown
  // that never moved. 90 covers the cluster the pointer is actually in without
  // turning the whole canopy into the touch - at 120 the far side answered a hand
  // that had not reached it, which reads as a breeze rather than a touch.
  const RUSTLE_REACH = 90;
  const rustleTimers = new Set<number>();
  /** Throw one blade by an angle, and let it settle back on its own spring. */
  const throwBlade = (
    place: SVGGElement,
    rotate: string,
    translate: string,
    settleMs: number,
    delayMs: number,
    holdMs: number,
  ): void => {
    place.style.setProperty('--pl-leaf-spring', `${settleMs}ms`);
    const push = window.setTimeout(() => {
      rustleTimers.delete(push);
      place.style.rotate = rotate;
      place.style.translate = translate;
    }, delayMs);
    const release = window.setTimeout(() => {
      rustleTimers.delete(release);
      place.style.rotate = '0deg';
      place.style.translate = '0 0';
    }, delayMs + holdMs);
    rustleTimers.add(push);
    rustleTimers.add(release);
  };
  const rustle = (deg: number, at?: { x: number; y: number }): void => {
    if (destroyed || options.reducedMotion) return;
    if (!Number.isFinite(deg)) return;
    // Only what the hand actually crosses. Every blade in the crown used to move
    // wherever the pointer was, which reads as weather; a touch is local, so the
    // blades are measured once per pass and everything outside the reach keeps still.
    const hits: { place: SVGGElement; near: number }[] = [];
    for (const place of leafPlaces) {
      if (!at) {
        hits.push({ place, near: 1 });
        continue;
      }
      const box = place.getBoundingClientRect();
      const distance = Math.hypot(box.left + box.width / 2 - at.x, box.top + box.height / 2 - at.y);
      if (distance >= RUSTLE_REACH) continue;
      const near = 1 - distance / RUSTLE_REACH;
      // A blade at the very edge of the reach would move by a third of a degree: not
      // a touch, just a flicker. It stays still.
      if (near < 0.2) continue;
      hits.push({ place, near });
    }
    if (hits.length === 0) return;
    // Nearest blades first, and at most a handful of them: a hand crossing a crown
    // brushes a cluster, and the cap takes the blades the hand is actually in.
    hits.sort((a, b) => b.near - a.near);
    hits.length = Math.min(hits.length, RUSTLE_MAX);
    const force = Math.min(1, Math.max(0.3, Math.abs(deg) / 18));
    // The hand's own direction, so a left-to-right pass leans the leaves that way.
    const dir = deg < 0 ? -1 : 1;
    // Each blade gets its own moment.
    //
    // One shared delay and one shared spring made every blade in reach move as one
    // object - the canopy buzzed instead of rustling, and that is what "they all
    // perform at the same time" was. A push delayed by distance (the wave travelling
    // out from the hand) plus a jitter, an angle with a little scatter, and a settle
    // length of its own make the same few degrees read as leaves. The push is a
    // style write on a transition, so the throw is still one class of work.
    for (const { place, near } of hits) {
      const amp = (0.18 + 1.15 * near ** 1.5) * force * (0.78 + Math.random() * 0.44);
      throwBlade(
        place,
        `${(dir * 1.3 * amp).toFixed(2)}deg`,
        `${(dir * (0.7 + 0.9 * near)).toFixed(2)}px ${(-0.3 - 0.5 * near).toFixed(2)}px`,
        RUSTLE_SETTLE_MS + Math.round((Math.random() - 0.5) * 320),
        Math.round((1 - near) * RUSTLE_WAVE_MS * 2.2 + Math.random() * 70),
        RUSTLE_PUSH_MS + Math.round(Math.random() * 90),
      );
    }
  };

  // The idle breeze, blade by blade.
  //
  // The crown used to breathe as one object - a second wrapper animation on the
  // whole drawing - which is the one thing a canopy does not do, and it ran whether
  // or not anyone was near the tree. Now a blade or three take a small angle, each
  // with its own settle and start, at intervals that are never the same.
  let breezeTimer = 0;
  const armBreeze = (): void => {
    if (destroyed || options.reducedMotion) return;
    window.clearTimeout(breezeTimer);
    breezeTimer = window.setTimeout(breeze, 2400 + Math.random() * 4200);
  };
  const breeze = (): void => {
    if (destroyed) return;
    const count = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i += 1) {
      const place = leafPlaces[Math.floor(Math.random() * leafPlaces.length)];
      if (!place) continue;
      const deg = (0.3 + Math.random() * 0.7) * (Math.random() < 0.5 ? -1 : 1);
      // Each blade starts on its own beat, so even three of them read as air moving
      // through the crown rather than three leaves on a switch.
      throwBlade(
        place,
        `${deg.toFixed(2)}deg`,
        `${(deg * 0.6).toFixed(2)}px 0`,
        900 + Math.round(Math.random() * 700),
        Math.round(Math.random() * 460),
        240 + Math.round(Math.random() * 520),
      );
    }
    armBreeze();
  };
  armBreeze();

  let moonLit: 'left' | 'right' | null = null;
  const setMoonLit = (side: 'left' | 'right' | null): void => {
    if (side === moonLit) return;
    moonLit = side;
    if (side === null) element.removeAttribute('data-moon-lit');
    else element.setAttribute('data-moon-lit', side);
  };

  /** The last value written to each growth property, so unchanged steps are free. */
  const growthVarState = new Map<string, string>();
  const setGrowthVar = (name: string, value: string): void => {
    if (growthVarState.get(name) === value) return;
    growthVarState.set(name, value);
    element.style.setProperty(name, value);
  };

  /**
   * The growth run's state.
   *
   * `shownStage` is what is drawn *now*, not what was last asked for: a care
   * action asks for a stage several steps above it, and the run walks the drawing
   * from one to the other instead of switching profiles in one frame. The walk is
   * linear in the run's progress, which is the light front's constant climb, so the
   * leaves open as the light reaches their thresholds. The stream moves every
   * frame; the profile is applied at most every 90 ms, because a hundred leaves and
   * a dozen arms rewritten sixty times a second would be more paint than growth.
   */
  let shownStage: number | null = null;
  /** The crown geometry the arms were last placed for, so an unchanged step skips it. */
  let paintedCrownKey = '';
  let growthRaf = 0;
  let growthFrom = 0;
  let growthTo = 0;
  let growthStartMs = 0;
  let growthDurationMs = 0;
  let growthAppliedMs = -Infinity;
  let growthSettleTimer = 0;
  /** Apply a new profile at most this often during a run. */
  const GROWTH_APPLY_MS = 90;

  /** What each leaf was last told, so a step that changes nothing writes nothing. */
  const leafOpenState = new WeakMap<Element, boolean>();
  /** Open or close a leaf, including the growth it comes with. */
  const setLeafOpen = (leaf: Element, open: boolean): void => {
    if (leafOpenState.get(leaf) === open) return;
    leafOpenState.set(leaf, open);
    const style = (leaf as SVGElement).style;
    // The reveal is the scale, not a fade: a leaf flips visible at its full
    // opacity only when the wood reaches it, then opens from bud size. An opacity
    // transition here made a new leaf a ghost of itself over the branch.
    style.setProperty('opacity', open ? '' : '0');
    style.setProperty('--pl-leaf-open', open ? '1' : '0.12');
  };

  // The stem leaves above the crown line, oldest first. They are retired one at a
  // time as the crown takes over, not all in the stage where the crown appears.
  const upperStemRank = new Map<SVGGElement, number>();
  for (const part of leafOrder) {
    if (part.spec.y < STEM_BASE_Y - STEM_LENGTH * 0.55) {
      upperStemRank.set(part.group, upperStemRank.size);
    }
  }

  const api: TitlePlant = {
    element,
    gust,
    rustle,
    setMoonLit,
    setGrowthStage(stage: number): void {
      // One number, one profile (title/growth.ts): height, wood, foliage, limbs. A
      // hundred stages, so a plant that is looked after has something new to be at
      // every step instead of ten art states and a scale.
      shownStage = stage;
      const profile = growthProfile(stage);
      const stageLabel = String(Math.round(profile.stage));
      if (element.dataset.growth !== stageLabel) element.dataset.growth = stageLabel;
      if (element.dataset.growthTier !== profile.tier.id)
        element.dataset.growthTier = profile.tier.id;
      setGrowthVar('--pl-care-scale', profile.scale.toFixed(3));
      setGrowthVar('--pl-trunk-w', profile.trunkWidth.toFixed(3));
      setGrowthVar('--pl-trunk-opacity', profile.trunkOpacity.toFixed(2));
      // Stage-appropriate wood: a sapling keeps a green stem, a young tree starts
      // to brown, and the adult is bark. The roots are not in this shoot, so they
      // keep the older wood colour at every stage.
      setWoodVar('--pl-bark', mixRgb(WOOD_GREEN, WOOD_BARK, profile.woodTone));
      setWoodVar('--pl-bark-dark', mixRgb(WOOD_GREEN_DARK, WOOD_BARK_DARK, profile.woodTone));
      setWoodVar('--pl-bark-lit', mixRgb(WOOD_GREEN_LIT, WOOD_BARK_LIT, profile.woodTone));
      setGrowthVar('--pl-leaf-scale', profile.leafScale.toFixed(3));
      setGrowthVar('--pl-bud-scale', profile.budScale.toFixed(2));
      // The seed's energy is a circle inside the coat. It fills with the seed's
      // three stages, then the sprout drawing takes over.
      if (seedKernel) {
        const fill = profile.tier.id === 'seed' ? Math.min(1, profile.stage / 3) : 0;
        seedKernel.setAttribute('r', (2.4 + 7.4 * fill).toFixed(2));
      }
      element.classList.toggle('is-tree', profile.limbReveal > 0.001);
      element.classList.toggle('is-mature', profile.trunkOpacity > 0.5 && profile.trunkWidth > 0.4);
      // The roots hang deeper as the ladder climbs. One formula, and the CSS
      // transition eases it, so the plate is never redrawn mid-growth.
      setGrowthVar(
        '--pl-root-depth',
        rootDepth((profile.stage * GROWTH_POINTS) / GROWTH_STAGES).toFixed(3),
      );
      // Crown geometry for this stage: how long the arms are, how wide they spread.
      crownLength = profile.limbLength;
      crownSpread = profile.limbSpreadDeg;
      // How much of each arm is drawn. During a run an arm waits for the light to
      // reach the height it leaves the trunk, then reaches its stage shape before
      // the light moves on. The stage still decides that shape; the stream only
      // decides when each arm gets it. Outside a run the stage is applied at once.
      const arms = LIMBS.length;
      let crownProgress = 0;
      for (let index = 0; index < arms; index += 1) {
        const target = Math.max(0, Math.min(1, profile.limbReveal * arms - index));
        const grow = streamActive
          ? limbGrowAlong(LIMBS[index]?.t ?? 0, runLimbFrom[index] ?? target, target, streamT)
          : target;
        limbGrowth[index] = grow;
        crownProgress += grow;
      }
      crownProgress /= arms || 1;

      // Foliage opens one leaf at a time, oldest first. Once there is a crown, the
      // stem's upper leaves go: a young plant is a stalk with leaves up it, a tree
      // is a trunk with a crown on it, and a big leaf halfway up a trunk is what
      // made the last version read as a pole with foliage stuck to it. A leaf is
      // retired by the crown that has actually arrived, not by the stage number.
      let streamTop = 0;
      for (let i = 0; i < leafOrder.length; i += 1) {
        const threshold = (i + 1) / leafOrder.length;
        let open = profile.leafReveal + 1e-6 >= threshold;
        const rank = upperStemRank.get(leafOrder[i].group);
        if (open && rank !== undefined) {
          // One upper leaf goes at each sliver of limb growth once the crown is
          // taking over, so a young tree does not lose five leaves in one stage.
          open = crownProgress <= 0.45 + rank * 0.04;
        }
        setLeafOpen(leafOrder[i].group, open);
        if (open) {
          streamTop = Math.max(streamTop, (STEM_BASE_Y - leafOrder[i].spec.y) / STEM_LENGTH + 0.03);
        }
      }
      // And the crown grows limb by limb, each with its own leaves riding it. A
      // limb is never shown bare, which is what kept the young trees looking like
      // sticks with foliage floating beside them.
      //
      // An arm is not switched on, it *extends*: the oldest arms (lowest on the
      // trunk, the thick ones) are the first to leave it, and each one is clipped
      // back to the part of itself that has grown, so the wood creeps outward from
      // the trunk over several stages. Before this every arm appeared whole, at its
      // final length, with every leaf already on it - a branch from thin air. The
      // wood is clipped at its outer end so it extends from the trunk on both sides;
      // `data-side` is only for which side the moonlight reaches.
      for (const arm of limbOrder) {
        const index = Number(arm.dataset.limb ?? 0);
        const grow = limbGrowth[index] ?? 0;
        arm.style.opacity = grow > 0.001 ? '' : '0';
        // Clip the wood, not the whole arm. The old group clip cut through petioles
        // and blades as they reached the growing edge, which is exactly the sliced
        // leaf-and-stem look the crown had at mid-growth. The leaves have their own
        // attachment thresholds below, and a whole leaf at the edge of the wood is
        // what a growing branch looks like.
        const wood = arm.querySelector<SVGElement>('.pl-title-plant__limb-wood');
        arm.style.clipPath = '';
        if (wood) {
          if (grow >= 0.999) {
            wood.style.clipPath = '';
          } else {
            // A limb's local x always runs from the trunk outward, whichever side
            // it leaves on. The old rule mirrored the inset for left-side arms and
            // therefore kept the far tip while hiding the base: a brown stick
            // floating away from the trunk. Clip the outer end on both sides.
            const cut = ((1 - grow) * 100).toFixed(1);
            wood.style.clipPath = `inset(-20% ${cut}% -20% -20%)`;
          }
        }
        // Leaves open out along the arm as it reaches them: a new limb carries the
        // leaves of the length it has, never the whole cluster at once.
        const leaves = arm.querySelectorAll<SVGElement>('.pl-title-plant__leaf--crown');
        for (let k = 0; k < leaves.length; k += 1) {
          // Open a leaf when the clip has actually passed its attachment point, not
          // at a fixed fraction of the leaf list. The old thresholds opened outer
          // leaves before the wood reached them, and the limb's clip then cut both
          // the stalk and half the blade: the crown grew leaves that were visibly
          // sliced off their branches.
          const leafAt = Number(leaves[k].dataset.at);
          // The terminal blade sits at 0.99, so opening on `leafAt + 0.015` means
          // asking for growth beyond 1 and never opening it. A leaf a hair later
          // than the wood reaches it is fine; a leaf that can never open is not.
          const opensAt = Number.isFinite(leafAt)
            ? Math.min(0.995, leafAt + 0.005)
            : (k + 1) / (leaves.length + 1);
          setLeafOpen(leaves[k], grow > opensAt);
        }
        if (grow > 0.02) streamTop = Math.max(streamTop, (LIMBS[index]?.t ?? 0) + 0.04);
      }
      // The light cannot outrun the drawing. It climbs only as far as the highest
      // open leaf or living limb, so a young tree is not lit to a tip it has not
      // built yet; a seed and a sprout have their own small stages instead.
      streamLimit =
        profile.tier.id === 'seed' || profile.tier.id === 'sprout'
          ? 1
          : Math.max(0.18, Math.min(1, streamTop));
      // The arms were placed at the previous stage's reach: re-place them now, or a
      // plant that grew a tier would keep the old crown until it was touched. A
      // growth run applies a profile every 90 ms, and at that resolution most steps
      // move the reach by less than the drawn precision, so an unchanged crown is
      // not redrawn.
      const crownKey = `${crownLength.toFixed(3)}|${crownSpread.toFixed(2)}`;
      if (crownKey !== paintedCrownKey) {
        paintedCrownKey = crownKey;
        paintBend();
      }
    },
    setActive(next: boolean): void {
      if (active === next) return;
      active = next;
      if (next) {
        lastPaintMs = 0;
        raf = requestAnimationFrame(tick);
        armBreeze();
      } else {
        cancelAnimationFrame(raf);
        window.clearTimeout(breezeTimer);
        // A growth run is a few hundred milliseconds of the title's own motion;
        // it has no business continuing behind the world. The plant is put where
        // the care left it, so it is never caught mid-leaf on the way back, and
        // the pane is refitted for the height it ended at.
        if (growthRaf !== 0) {
          api.setGrowthStage(growthTo, false);
          options.onGrowthEnd?.();
        }
      }
    },
    react(part: PlantPart = 'stem', index = 0): void {
      tapPart(part, index);
    },
    celebrate(): void {
      if (options.reducedMotion) return;
      element.classList.remove('is-happy');
      // The reflow is what lets a second watering dance again.
      void element.offsetWidth;
      element.classList.add('is-happy');
      window.setTimeout(() => element.classList.remove('is-happy'), 1400);
      // And a shake through the stem under the leaves' own fluttering.
      shudderStartMs = performance.now();
      wake();
    },
    setGroggy(on: boolean): void {
      if (groggy === on) return;
      groggy = on;
      element.classList.toggle('is-groggy', on);
    },
    destroy(): void {
      destroyed = true;
      // A rustle still in flight would keep writing to leaves that are no longer in
      // the document, so its timers go with the plant.
      for (const timer of rustleTimers) window.clearTimeout(timer);
      rustleTimers.clear();
      window.clearTimeout(breezeTimer);
      cancelAnimationFrame(raf);
      sound.dispose();
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', endDrag);
      element.removeEventListener('pointercancel', endDrag);
      element.removeEventListener('lostpointercapture', onLostCapture);
      window.removeEventListener('pointerup', onWindowPointerEnd);
      window.removeEventListener('pointercancel', onWindowPointerEnd);
      element.removeEventListener('dblclick', onDoubleTap);
      stopGrowthRun();
      element.remove();
    },
  };

  /** The immediate, un-animated profile writer behind `setGrowthStage`. */
  const applyGrowth = api.setGrowthStage;

  const stopGrowthRun = (): void => {
    if (growthRaf !== 0) cancelAnimationFrame(growthRaf);
    growthRaf = 0;
    window.clearTimeout(growthSettleTimer);
    growthSettleTimer = 0;
    element.classList.remove('is-growing', 'is-streaming');
    streamActive = false;
    streamLast = '';
    hideStreamEchoes();
    for (const item of limbStreams) item.group.classList.remove('is-lit');
  };

  const stepGrowth = (now: number): void => {
    const raw =
      growthDurationMs <= 0
        ? 1
        : Math.min(1, Math.max(0, (now - growthStartMs) / growthDurationMs));
    // The light is cheap - a few paths and sparks - so it moves every frame. The
    // drawing itself is re-applied in small steps: a hundred leaves and a dozen
    // arms rewritten sixty times a second would be more paint than growth.
    streamT = raw;
    paintStream(now);
    if (raw >= 1 || now - growthAppliedMs >= GROWTH_APPLY_MS) {
      applyGrowth(raw >= 1 ? growthTo : growthStageAlong(growthFrom, growthTo, raw));
      growthAppliedMs = now;
      options.onGrowthChange?.();
    }
    if (raw < 1) {
      growthRaf = requestAnimationFrame(stepGrowth);
      return;
    }
    growthRaf = 0;
    // The stream has reached the highest grown structure; its work is done, even
    // though the class that carries the last leaves' transitions stays for another
    // moment.
    streamActive = false;
    hideStreamEchoes();
    element.classList.remove('is-streaming');
    options.onGrowthEnd?.();
    // Keep the transition class for the last leaves to finish opening, then drop
    // it; the class only gates the transitions, it is not the growth itself.
    window.clearTimeout(growthSettleTimer);
    growthSettleTimer = window.setTimeout(() => {
      element.classList.remove('is-growing');
    }, 700);
  };

  const startGrowthRun = (target: number): void => {
    const from = shownStage ?? target;
    if (target <= from + 0.01) {
      stopGrowthRun();
      applyGrowth(target);
      return;
    }
    const now = performance.now();
    window.clearTimeout(growthSettleTimer);
    growthSettleTimer = 0;
    if (growthRaf !== 0) cancelAnimationFrame(growthRaf);

    // A second care can arrive while the first stream is still in the stem. The
    // light keeps its place; only its destination changes. Solving the stage
    // timeline backwards (see resumeGrowth) leaves the drawing exactly where it
    // is at that front, then sends the extra light up from the root as a comet.
    const midRun = streamActive && streamT > 0.001 && streamT < 0.999;
    if (midRun) {
      const resumed = resumeGrowth(from, target, streamT);
      const remainingMs = growthTransitionMs(target - from);
      const fullMs =
        resumed.remainingShare > 0.001 ? remainingMs / resumed.remainingShare : remainingMs;
      growthFrom = resumed.fromStage;
      growthTo = target;
      growthDurationMs = Math.max(1, fullMs);
      growthStartMs = now - streamT * growthDurationMs;
      growthAppliedMs = -Infinity;
      runLimbFrom = limbGrowth.slice();
      element.classList.add('is-growing', 'is-streaming');
      spawnStreamEcho(streamT * streamLimit);
      paintStream(now);
      growthRaf = requestAnimationFrame(stepGrowth);
      return;
    }

    growthFrom = from;
    growthTo = target;
    growthStartMs = now;
    growthDurationMs = growthTransitionMs(target - from);
    growthAppliedMs = -Infinity;
    // The arms start from what is actually drawn, not from the stage number: a
    // previous run may have been retargeted mid-flight, and no arm may shrink.
    runLimbFrom = limbGrowth.slice();
    streamT = 0;
    streamActive = true;
    streamLast = '';
    for (const item of limbStreams) item.last = '';
    element.classList.add('is-growing', 'is-streaming');
    paintStream(now);
    growthRaf = requestAnimationFrame(stepGrowth);
  };

  api.setGrowthStage = (stage: number, animate = false): void => {
    const target = Number.isFinite(stage) ? Math.max(0, Math.min(GROWTH_STAGES - 1, stage)) : 0;
    // A load, a reset, a reduced-motion preference or a care that earned no new
    // stage is drawn at once. Only real growth is walked.
    if (!animate || options.reducedMotion || shownStage === null) {
      stopGrowthRun();
      applyGrowth(target);
      return;
    }
    startGrowthRun(target);
  };

  return api;
}
