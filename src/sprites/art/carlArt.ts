/**
 * Small maths and colour helpers shared by every painted figure in the game:
 * points, easing curves and hex-colour blending.
 *
 * Carl's own painter — palette, rig, parts and draw order — lives in `carl/`,
 * and his choreography in `human/`.
 */

const DEGREES_PER_RADIAN = 180 / Math.PI;

export interface Pt {
  x: number;
  y: number;
}

export function deg(degrees: number): number {
  return degrees / DEGREES_PER_RADIAN;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Smooth 0→1 ease used for weight shifts and one-shot swings. */
export function easeInOut(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/** Fast start, slow finish — for a limb that is thrown and then settles. */
export function easeOut(t: number): number {
  const c = clamp01(t);
  return 1 - (1 - c) * (1 - c);
}

/** 0 → 1 → 0 over the unit interval. */
export function hump(t: number): number {
  return Math.sin(clamp01(t) * Math.PI);
}

/** 0 before `start`, 1 after `end`, eased in between. */
export function ramp(value: number, start: number, end: number): number {
  if (end === start) return value < start ? 0 : 1;
  return easeInOut((value - start) / (end - start));
}

const HEX_RADIX = 16;
const HEX_PAIR = 2;
const RGB_MAX = 255;
/** Below this, node-canvas's colour parser sees exponent notation (`5e-17`) and drops the whole `rgba()` string, silently baking in whatever fill was set before. */
const MIN_VISIBLE_ALPHA = 1e-6;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const SHORT_HEX_PATTERN = /^#([0-9a-f]{3})$/i;
const LONG_HEX_PATTERN = /^#([0-9a-f]{6})$/i;
/**
 * Comma-separated `rgb()`/`rgba()` only. The alpha is matched loosely because
 * it is discarded, and a computed alpha may arrive in exponent notation.
 */
const RGB_FUNCTION_PATTERN =
  /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*[\d.eE+-]+\s*)?\)$/i;

function expandShortHex(digits: string): string {
  return digits
    .split('')
    .map((digit) => digit + digit)
    .join('');
}

function rgbOfHexDigits(body: string): Rgb {
  return {
    r: parseInt(body.slice(0, HEX_PAIR), HEX_RADIX),
    g: parseInt(body.slice(HEX_PAIR, HEX_PAIR * 2), HEX_RADIX),
    b: parseInt(body.slice(HEX_PAIR * 2, HEX_PAIR * 3), HEX_RADIX),
  };
}

/**
 * Parses `#rgb`, `#rrggbb`, and comma-separated `rgb(...)` / `rgba(...)` into
 * components.
 *
 * Anything else — a named colour, `hsl()`, the space-separated `rgb()` syntax,
 * a malformed hex — throws rather than yielding NaN channels: NaN would become
 * an `rgba(NaN, …)` string that the canvas ignores (silently keeping the
 * previous fill) or that `addColorStop` rejects with an error far from the
 * cause. Every painter in the game passes six-digit hex palette constants.
 */
function parseColor(color: string): Rgb {
  const trimmed = color.trim();
  const shortHex = SHORT_HEX_PATTERN.exec(trimmed);
  if (shortHex !== null) return rgbOfHexDigits(expandShortHex(shortHex[1]));
  const longHex = LONG_HEX_PATTERN.exec(trimmed);
  if (longHex !== null) return rgbOfHexDigits(longHex[1]);
  const rgbFunction = RGB_FUNCTION_PATTERN.exec(trimmed);
  if (rgbFunction !== null) {
    const [, r, g, b] = rgbFunction;
    return { r: Number(r), g: Number(g), b: Number(b) };
  }
  throw new Error(
    `unsupported colour format "${color}": expected #rgb, #rrggbb, or comma-separated rgb()/rgba()`,
  );
}

function channel(value: number): string {
  const clamped = Math.max(0, Math.min(RGB_MAX, Math.round(value)));
  return clamped.toString(HEX_RADIX).padStart(HEX_PAIR, '0');
}

/**
 * Blends two colours in any form {@link rgba} accepts, returning `#rrggbb`;
 * `t` of 0 is `a`, 1 is `b`. Any alpha on either input is dropped.
 */
export function mix(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  return `#${channel(lerp(ca.r, cb.r, t))}${channel(lerp(ca.g, cb.g, t))}${channel(lerp(ca.b, cb.b, t))}`;
}

/**
 * An opacity safe to write into a colour string or `globalAlpha`: anything
 * below {@link MIN_VISIBLE_ALPHA}, NaN included, becomes exactly 0.
 */
export function clampAlpha(alpha: number): number {
  return alpha >= MIN_VISIBLE_ALPHA ? alpha : 0;
}

/** A colour (`#rgb`, `#rrggbb`, `rgb()` or `rgba()`) re-expressed with an alpha. */
export function rgba(color: string, alpha: number): string {
  const c = parseColor(color);
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${clampAlpha(alpha)})`;
}
