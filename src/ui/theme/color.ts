/**
 * Colour arithmetic for deriving skins from palette tokens. Accepts
 * `#RRGGBB` only; the palette's translucent `rgba(...)` tokens are used as
 * they are, never mixed.
 */

const HEX_COLOR = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const HEX_RADIX = 16;
const CHANNEL_MAX = 255;
const HEX_CHANNEL_DIGITS = 2;

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function parseHex(hex: string): Rgb {
  const match = HEX_COLOR.exec(hex);
  if (match === null) throw new Error(`expected a #RRGGBB colour, got "${hex}"`);
  const [, r = '0', g = '0', b = '0'] = match;
  return {
    r: parseInt(r, HEX_RADIX),
    g: parseInt(g, HEX_RADIX),
    b: parseInt(b, HEX_RADIX),
  };
}

function channelHex(value: number): string {
  const clamped = Math.max(0, Math.min(CHANNEL_MAX, Math.round(value)));
  return clamped.toString(HEX_RADIX).padStart(HEX_CHANNEL_DIGITS, '0');
}

/** `a` blended toward `b` by `t` (0 = all `a`, 1 = all `b`). */
export function mix(a: string, b: string, t: number): string {
  const from = parseHex(a);
  const to = parseHex(b);
  const lerp = (x: number, y: number): number => x + (y - x) * t;
  return `#${channelHex(lerp(from.r, to.r))}${channelHex(lerp(from.g, to.g))}${channelHex(lerp(from.b, to.b))}`;
}

/** node-canvas and Chrome both drop an `rgba()` whose alpha is in exponent form. */
const MIN_RENDERABLE_ALPHA = 0.001;

/** `hex` at the given opacity, as an `rgba(...)` string; an alpha too small to render is clamped to zero. */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = parseHex(hex);
  const renderable = alpha < MIN_RENDERABLE_ALPHA ? 0 : alpha;
  return `rgba(${r}, ${g}, ${b}, ${renderable})`;
}

const WHITE = '#FFFFFF';
const BLACK = '#000000';

/** `hex` blended toward white by `amount`. */
export function lighten(hex: string, amount: number): string {
  return mix(hex, WHITE, amount);
}

/** `hex` blended toward black by `amount`. */
export function darken(hex: string, amount: number): string {
  return mix(hex, BLACK, amount);
}
