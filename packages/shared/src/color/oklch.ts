/**
 * OKLCH -> sRGB, with the gamut reported instead of silently clipped.
 *
 * The palette (`config/palette.json`) is authored in OKLCH because lightness and
 * hue are the axes an artist thinks in, and because a ramp can keep one lightness
 * ladder while the hue drifts (warm in light, cool in shadow). Two things need a
 * hex from it: the swatch generator behind the art bible, and the client, which
 * publishes the UI's role tokens as CSS custom properties. They share this file
 * so a swatch and a HUD surface cannot disagree about what a step is.
 *
 * An out-of-gamut step is a bug in the palette, not something to clamp away: a
 * step that clips is a step whose hue and chroma the display cannot show, so the
 * caller gets `outOfGamut` and the palette build refuses it.
 */

export interface OklchStep {
  /** Lightness, 0..1. */
  l: number;
  /** Chroma, 0 at neutral. */
  c: number;
  /** Hue in degrees, 0..360. */
  h: number;
}

export interface LinearRgbChannels {
  r: number;
  g: number;
  b: number;
}

export interface HexColor {
  /** `#rrggbb`, clamped for display. */
  hex: string;
  /** True when the step asks for a colour sRGB cannot show. */
  outOfGamut: boolean;
  /** The clamped 8-bit channels, for callers that want to layer over them. */
  rgb: [number, number, number];
}

/** sRGB transfer function, linear light to display. */
const encode = (value: number) =>
  value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;

/**
 * A step's linear-light sRGB channels before clamping.
 *
 * OKLab -> LMS' -> LMS -> linear sRGB, the standard Björn Ottosson matrices.
 */
export function oklchToLinearRgb(step: OklchStep): LinearRgbChannels {
  const { l, c, h } = step;
  for (const value of [l, c, h]) {
    if (!Number.isFinite(value)) {
      throw new TypeError(`OKLCH step needs finite numbers: ${JSON.stringify(step)}`);
    }
  }
  if (l < 0 || l > 1) throw new RangeError(`OKLCH lightness must be 0..1: ${l}`);
  if (c < 0) throw new RangeError(`OKLCH chroma must be >= 0: ${c}`);
  const hue = (h * Math.PI) / 180;
  const a = c * Math.cos(hue);
  const b = c * Math.sin(hue);

  const lPrime = l + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = l - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = l - 0.0894841775 * a - 1.291485548 * b;
  const l3 = lPrime ** 3;
  const m3 = mPrime ** 3;
  const s3 = sPrime ** 3;

  return {
    r: 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    g: -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    b: -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  };
}

/** A channel is in gamut if it survives the round trip without moving. */
const GAMUT_EPSILON = 0.0005;

/**
 * One step as `#rrggbb`.
 *
 * `outOfGamut` is true when the step asks for a colour the display cannot show;
 * the palette build stops on it rather than documenting a clipped hex as if it
 * were the authored value.
 */
export function oklchToHex(step: OklchStep): HexColor {
  const linear = oklchToLinearRgb(step);
  const channels = [linear.r, linear.g, linear.b];
  const outOfGamut = channels.some((value) => value < -GAMUT_EPSILON || value > 1 + GAMUT_EPSILON);
  const bytes = channels.map((value) =>
    Math.round(Math.min(1, Math.max(0, encode(Math.min(1, Math.max(0, value))))) * 255),
  );
  const hex = `#${bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  return { hex, outOfGamut, rgb: [bytes[0], bytes[1], bytes[2]] };
}

/** Perceived lightness of a step, for choosing label ink on a swatch. */
export function isLightStep(step: OklchStep): boolean {
  return step.l >= 0.62;
}
