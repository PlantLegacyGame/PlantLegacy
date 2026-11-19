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
  canopyBack: string;
  canopyFront: string;
  grass: string;
  frond: string;
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
  skyHigh: '#0b1120',
  skyMid: '#111a2c',
  skyLow: '#1b2740',
  cloud: '#2a3752',
  hillFar: '#101a24',
  hillNear: '#0d1720',
  canopyBack: '#0d1a16',
  canopyFront: '#14261d',
  grass: '#16261c',
  frond: '#0c1710',
  groundTop: '#2a2018',
  groundBody: '#1b1510',
  soilEdge: '#3a2c20',
  star: 1,
  sun: '#dfe7ff',
  sunGlow: 0.12,
  plantDim: 0.6,
};

const DAWN: TitlePalette = {
  skyHigh: '#2b3550',
  skyMid: '#6b5f7a',
  skyLow: '#c98f76',
  cloud: '#f0c3a4',
  hillFar: '#2e3446',
  hillNear: '#26303c',
  canopyBack: '#1d2b26',
  canopyFront: '#2a3f2c',
  grass: '#2c4530',
  frond: '#1a2a1d',
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
  canopyBack: '#22402a',
  canopyFront: '#2f5a34',
  grass: '#3d6b3c',
  frond: '#26452a',
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
  canopyBack: '#1b2a22',
  canopyFront: '#273c28',
  grass: '#2a422c',
  frond: '#18281b',
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
    canopyBack: lerpHex(from.palette.canopyBack, to.palette.canopyBack, t),
    canopyFront: lerpHex(from.palette.canopyFront, to.palette.canopyFront, t),
    grass: lerpHex(from.palette.grass, to.palette.grass, t),
    frond: lerpHex(from.palette.frond, to.palette.frond, t),
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
    milkyWay: mood.night * 0.22,
    cloudShadow: (1 - mood.night) * 0.5,
    // Warm rim by day, cold rim under the moon: the leaf edge is lit by the same
    // source as everything else.
    leafRim: lerpHex(palette.sun, palette.cloud, 0.45 + mood.night * 0.35),
    leafRimOpacity: 0.34 + mood.warmth * 0.22,
    sunWash: palette.sunGlow * (1 - mood.night) * 0.9,
    moonWash: mood.night * 0.62,
    // Light: the palette has already darkened the scene by then, and the pass is
    // a multiply, so a heavy value crushes the plant's silhouette.
    nightWash: mood.night * 0.34,
    plantSaturation: 0.72 + 0.28 * palette.plantDim,
    plantSepia: 0.16 * mood.warmth,
    plantHue: mood.warmth * 6 - mood.night * 13,
  };
}
