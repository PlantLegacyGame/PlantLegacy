/**
 * The title screen's own day.
 *
 * Not the game clock: the menu runs before a connection exists, so it cannot
 * borrow the server's time and does not pretend to. One full cycle lasts
 * `title_day_night_seconds` (an hour by default) and repeats forever.
 *
 * Everything here is interpolation over four keyframes - night, dawn, day, dusk -
 * so the sky is a continuous colour rather than four stages that snap. Pure
 * functions, so the cycle can be tested without a browser.
 */

export interface TitlePalette {
  skyHigh: string;
  skyMid: string;
  skyLow: string;
  cloud: string;
  hillFar: string;
  hillNear: string;
  groundTop: string;
  groundBody: string;
  soilEdge: string;
  star: number;
  sun: string;
  sunGlow: number;
  /** Brightness multiplier for the plant, so it dims with the world at night. */
  plantDim: number;
}

const NIGHT: TitlePalette = {
  // Night is a deep blue room, not a grey evening: the sky drops almost to black at
  // the top and keeps its colour low down, so the stars read and the dark is warm
  // rather than merely unlit.
  skyHigh: '#05070f',
  skyMid: '#090f1d',
  skyLow: '#131d33',
  cloud: '#2a3752',
  hillFar: '#101a24',
  hillNear: '#0d1720',
  groundTop: '#2a2018',
  groundBody: '#1b1510',
  soilEdge: '#3a2c20',
  star: 1,
  sun: '#dfe7ff',
  sunGlow: 0.16,
  plantDim: 0.5,
};

const DAWN: TitlePalette = {
  skyHigh: '#2b3550',
  skyMid: '#6b5f7a',
  skyLow: '#c98f76',
  cloud: '#f0c3a4',
  hillFar: '#2e3446',
  hillNear: '#26303c',
  groundTop: '#5c4530',
  groundBody: '#3d2e20',
  soilEdge: '#6b5238',
  star: 0.12,
  sun: '#ffd9a8',
  sunGlow: 0.5,
  plantDim: 0.85,
};

const DAY: TitlePalette = {
  skyHigh: '#4d7fa8',
  skyMid: '#7fa8c4',
  skyLow: '#c6d8d8',
  cloud: '#f4f7f6',
  hillFar: '#33503f',
  hillNear: '#2a4536',
  groundTop: '#7a5334',
  groundBody: '#553a26',
  soilEdge: '#8b6544',
  star: 0,
  sun: '#fff2c4',
  sunGlow: 0.34,
  plantDim: 1,
};

const DUSK: TitlePalette = {
  skyHigh: '#2c3350',
  skyMid: '#7a5b6d',
  skyLow: '#d08a63',
  cloud: '#eab79a',
  hillFar: '#2b3038',
  hillNear: '#232c31',
  groundTop: '#5a422c',
  groundBody: '#3b2a1c',
  soilEdge: '#6b5238',
  star: 0.16,
  sun: '#ffc088',
  sunGlow: 0.55,
  plantDim: 0.82,
};

const KEYFRAMES: Array<{ at: number; palette: TitlePalette }> = [
  { at: 0, palette: NIGHT },
  { at: 0.25, palette: DAWN },
  { at: 0.5, palette: DAY },
  { at: 0.75, palette: DUSK },
  { at: 1, palette: NIGHT },
];

/** Where we are in the cycle, 0 to 1. */
export function cyclePhase(elapsedMs: number, cycleMs: number): number {
  if (cycleMs <= 0) return 0;
  const raw = (elapsedMs % cycleMs) / cycleMs;
  return raw < 0 ? raw + 1 : raw;
}

function parseHex(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : value;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

export function lerpHex(from: string, to: string, t: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  const k = Math.max(0, Math.min(1, t));
  return toHex([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * Math.max(0, Math.min(1, t));
}

/** The palette at any point in the cycle, blended between the keyframes. */
export function paletteAt(phase: number): TitlePalette {
  const p = phase < 0 ? 0 : phase > 1 ? 1 : phase;
  let index = 0;
  for (let i = 0; i < KEYFRAMES.length - 1; i += 1) {
    const next = KEYFRAMES[i + 1];
    if (next && p <= next.at) {
      index = i;
      break;
    }
  }
  const from = KEYFRAMES[index] ?? KEYFRAMES[0];
  const to = KEYFRAMES[index + 1] ?? KEYFRAMES[KEYFRAMES.length - 1];
  if (!from || !to) return DAY;
  const span = to.at - from.at;
  const t = span <= 0 ? 0 : (p - from.at) / span;
  return {
    skyHigh: lerpHex(from.palette.skyHigh, to.palette.skyHigh, t),
    skyMid: lerpHex(from.palette.skyMid, to.palette.skyMid, t),
    skyLow: lerpHex(from.palette.skyLow, to.palette.skyLow, t),
    cloud: lerpHex(from.palette.cloud, to.palette.cloud, t),
    hillFar: lerpHex(from.palette.hillFar, to.palette.hillFar, t),
    hillNear: lerpHex(from.palette.hillNear, to.palette.hillNear, t),
    groundTop: lerpHex(from.palette.groundTop, to.palette.groundTop, t),
    groundBody: lerpHex(from.palette.groundBody, to.palette.groundBody, t),
    soilEdge: lerpHex(from.palette.soilEdge, to.palette.soilEdge, t),
    star: lerp(from.palette.star, to.palette.star, t),
    sun: lerpHex(from.palette.sun, to.palette.sun, t),
    sunGlow: lerp(from.palette.sunGlow, to.palette.sunGlow, t),
    plantDim: lerp(from.palette.plantDim, to.palette.plantDim, t),
  };
}

export interface CelestialBody {
  /** Horizontal position as a share of the sky's width, 0 to 1. */
  x: number;
  /** Height above the horizon as a share of the sky's height, 0 (on it) to 1. */
  y: number;
  visible: boolean;
  /**
   * How strongly to draw it, 0..1. A moon that is still up but in a sky that has
   * already gone bright is a moon nobody should see whole: it fades out with the
   * light instead of switching off at an hour boundary.
   */
  opacity?: number;
}

const DAY_START = 0.25;
const DAY_END = 0.75;

/**
 * The sun rises at the left edge on `DAY_START`, peaks at `0.5`, sets on the
 * right. It is only drawn while it is above the horizon, so there is no sun at
 * midnight and no moon at noon.
 */
export function sunPosition(phase: number): CelestialBody {
  const p = phase < 0 ? phase + 1 : phase > 1 ? phase - 1 : phase;
  if (p < DAY_START || p > DAY_END) return { x: 0, y: 0, visible: false };
  const t = (p - DAY_START) / (DAY_END - DAY_START);
  return { x: t, y: Math.sin(t * Math.PI), visible: true };
}

/** The moon takes the same arc through the night half of the cycle. */
export function moonPosition(phase: number): CelestialBody {
  const p = phase < 0 ? phase + 1 : phase > 1 ? phase - 1 : phase;
  // Night runs from dusk (0.75) through midnight to dawn (0.25).
  const t =
    p >= DAY_START && p <= DAY_END ? null : p < DAY_START ? (p + 0.25) / 0.5 : (p - DAY_END) / 0.5;
  if (t === null) return { x: 0, y: 0, visible: false };
  return { x: t, y: Math.sin(t * Math.PI), visible: true };
}

/**
 * How much of the sun's wash the sky is showing, from how high the disc is.
 *
 * The palette's glow fades slower than the light does, and the wash is a screen
 * blend over the whole pane: below the horizon it kept painting a bright yellow
 * wash with no sun to cast it. The gate is the disc's own height, so the wash goes
 * out as the sun sets.
 */
export function sunWashGate(sun: CelestialBody): number {
  if (!sun.visible) return 0;
  return Math.max(0, Math.min(1, sun.y / 0.22));
}

/**
 * How much of the moon to draw, from the palette's own darkness.
 *
 * Deliberately not a function of the hour: the sky is a continuous blend of four
 * palettes, so there is a band of bright sky that the clock still counts as night,
 * and a full moon in it was the bug. Zero in daylight, rising through dusk, whole
 * only in a real night sky.
 */
export function moonBrightness(star: number): number {
  if (!Number.isFinite(star)) return 0;
  return Math.max(0, Math.min(1, (star - 0.26) / 0.34));
}

export function isNight(phase: number): boolean {
  const p = phase < 0 ? phase + 1 : phase > 1 ? phase - 1 : phase;
  return p < DAY_START || p > DAY_END;
}

export interface LightMood {
  /** 0 neutral, 1 fully golden: how orange the horizon is right now. */
  warmth: number;
  /** 0 day, 1 full night. */
  night: number;
}

function channel(hex: string, index: number): number {
  const value = hex.replace('#', '');
  return Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
}

/**
 * How the light should feel, derived from the palette rather than from the clock.
 *
 * Warmth is the horizon's own colour - if the sky near the ground is orange, the
 * light is golden, whatever hour the config says - so a holiday palette gets the
 * right grade without new numbers. Night comes from the star field, which is the
 * clearest "it is dark now" the palette already carries.
 */
export function lightMood(palette: TitlePalette): LightMood {
  const r = channel(palette.skyLow, 0);
  const b = channel(palette.skyLow, 2);
  const warmth = Math.max(0, Math.min(1, (r - b) / 110));
  // The star field already encodes how dark the sky is, and unlike a luminance
  // test it does not read a pale dawn horizon as "day".
  const night = Math.max(0, Math.min(1, palette.star));
  return { warmth, night };
}

/** Light arriving through the leaves from a disc behind them. */
export interface LeafThroughLight {
  /** 0..1: how much of the light shows through the canopy. */
  amount: number;
  /** The colour that light carries into the leaf. */
  colour: string;
  /** Which disc the light came from: weather scatters one of them, not both. */
  source: 'sun' | 'moon';
  /**
   * 0..1: how much that disc stands *behind the crown* - near the trunk's own x,
   * so the tree is between the eye and the light. This is the top light: it lights
   * the upper reaches of the canopy and the gaps between the highest leaves,
   * where `amount` is the sideways transmission through a leaf. A moon overhead is
   * behind the crown; a moon at the edge of the arc is beside it.
   */
  top: number;
}

/**
 * How much light comes through the canopy, and in what colour.
 *
 * Two versions, one per source, rather than one tint with two strengths: the moon
 * behind the tree is a thin, cold silver that barely lifts the leaves, and a sun
 * on the horizon behind it is a warm honey that fills them. Both are deliberately
 * small numbers - a leaf that turns into a lamp is not a leaf - and both follow the
 * light that actually reaches the canopy: a disc near the horizon grazes it
 * sideways, and a disc overhead only lands on the tops of the leaves.
 *
 * The gate used to ask for a disc near the middle of the arc *and* near the
 * horizon, which sounded like "behind the tree" and never happens: the bodies
 * travel a semicircle, so x = 0.5 only at y = 1 (and at 0.5 either side when the
 * sun is at 0.09). Every hour therefore returned the base trace alone - measured
 * across the day, the strongest transmission was 0.16 at midnight with the moon
 * overhead. The real grazing hours are moonrise and sunset, when a body is low and
 * at the edge of the arc, so that is what is measured now.
 *
 * This is transmission, not a ray: the glow behind the crown and the light in the
 * leaf are the whole effect, and there is no beam drawn between them.
 */
export function leafThroughLight(
  palette: TitlePalette,
  sun: CelestialBody,
  moon: CelestialBody,
): LeafThroughLight {
  // Grazing light: how low the disc is (a body at the horizon sends light along the
  // leaves rather than onto them) and how near the trunk's side of the sky it sits.
  const graze = (body: CelestialBody): number => {
    if (!body.visible) return 0;
    const low = Math.max(0, 1 - body.y / 0.5);
    const near = Math.max(0, 1 - Math.abs(body.x - 0.5) * 1.25);
    return low * near;
  };
  // Even with nothing behind it, a canopy is thin: night leaves hold a little of
  // the sky and day leaves a trace of the sun. The base is what makes the foliage
  // look translucent at all hours; a low disc is what makes it glow.
  const sunDown = !sun.visible;
  const moonThrough = (sunDown ? 0.22 : 0.03) + graze(moon) * 0.45;
  const sunThrough = 0.05 + graze(sun) * 0.45;
  // Behind the crown: the disc is over the trunk's own column, which is the only
  // place a tree can stand in front of it. Height decides where the light lands -
  // a high disc lights the tops of the leaves, one near the horizon comes in
  // under them - so the top light fades as the disc drops.
  const behind = (body: CelestialBody): number => {
    if (!body.visible) return 0;
    const overTheTrunk = Math.max(0, 1 - Math.abs(body.x - 0.5) * 2.4);
    const high = 0.3 + 0.7 * Math.min(1, Math.max(0, body.y) / 0.85);
    return overTheTrunk * high;
  };
  const moonTop = behind(moon);
  const sunTop = behind(sun);
  if (moonThrough >= sunThrough) {
    return {
      top: moonTop,
      amount: Math.min(0.5, moonThrough),
      // A cold moon on a blue night. Lerped towards the night cloud colour so a
      // bright white cannot punch a hole in the canopy, but only a fifth of the way:
      // at a third the sheen was the same grey as the sky behind it and stopped
      // reading as light at all.
      colour: lerpHex('#dfe9ff', palette.cloud, 0.2),
      source: 'moon',
    };
  }
  return {
    top: sunTop,
    amount: Math.min(0.62, sunThrough),
    // Honey, warmed from the palette's own sun so a holiday palette gets its own
    // golden hour instead of mine.
    colour: lerpHex(palette.sun, '#ffe2a8', 0.35),
    source: 'sun',
  };
}

export interface TitleLighting {
  /** Warm glow on the horizon under the sun. */
  bloom: number;
  /** Pale air lying on the hills where sky meets ground. */
  haze: number;
  /** How visible the Milky Way is. */
  milkyWay: number;
  /** Strength of the drifting cloud shadows on the soil. */
  cloudShadow: number;
  /** Colour of the lit edge of a leaf. */
  leafRim: string;
  /** How much of that edge shows. */
  leafRimOpacity: number;
  /** Opacity of the warm glow around the sun. */
  sunWash: number;
  /** Opacity of the cold halo around the moon. */
  moonWash: number;
  /** Opacity of the blue night pass over the whole world. */
  nightWash: number;
  /** Leaf saturation for this light. */
  plantSaturation: number;
  /** Golden-hour warmth on the leaves. */
  plantSepia: number;
  /** Hue turn: positive warms the green, negative cools it toward teal. */
  plantHue: number;
}

/**
 * The light grade the title world renders with, from the palette alone.
 *
 * Kept here rather than inline in the menu so the numbers are covered by tests:
 * the sun glow has to vanish as the sun sets, the moon halo has to appear as it
 * does, and the leaves have to warm at dusk and cool at night.
 */
export function titleLighting(palette: TitlePalette): TitleLighting {
  const mood = lightMood(palette);
  return {
    // The horizon bloom is the sun's own light, so it peaks at golden hour and
    // disappears once the disc is down.
    bloom: palette.sunGlow * (1 - mood.night) * 0.85,
    haze: 0.34 + mood.night * 0.1,
    milkyWay: mood.night * 0.3,
    cloudShadow: (1 - mood.night) * 0.5,
    // Warm rim by day, cold rim under the moon: the leaf edge is lit by the same
    // source as everything else.
    // The lit edge of a leaf is lit by the disc that owns the hour. At night the
    // blend used to be 80 % cloud, so the rim took the colour of the sky it was
    // meant to stand against and the canopy had no lit side at all; the moon's own
    // cold silver is what a leaf edge shows under it.
    leafRim: lerpHex(palette.sun, palette.cloud, 0.45 - mood.night * 0.22),
    leafRimOpacity: 0.34 + mood.warmth * 0.22 + mood.night * 0.1,
    sunWash: palette.sunGlow * (1 - mood.night) * 0.9,
    // Brighter than it was: the moon is the only light the night has, and at 0.62 it
    // was a halo you had to look for.
    moonWash: mood.night * 0.88,
    // Light: the palette has already darkened the scene by then, and the pass is
    // a multiply, so a heavy value crushes the plant's silhouette.
    nightWash: mood.night * 0.42,
    plantSaturation: 0.72 + 0.28 * palette.plantDim,
    plantSepia: 0.16 * mood.warmth,
    plantHue: mood.warmth * 6 - mood.night * 13,
  };
}
