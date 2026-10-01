/**
 * The palette and small primitives the service level's versions of the
 * long-standing props share: steel, drum paint, plastic, cardboard, safety
 * yellow, and the dents, washes and strokes they are all marked with.
 *
 * Floor 2 is cold and institutional, so everything sits under a blue-grey key;
 * only the props' own emitters (a bulb, a fire) are warm.
 */

import { PROP_VARIANT_COUNT, TWO_PI, type Ctx } from '../propPaint';

export const STEEL_EDGE = '#151a1f';
export const STEEL_DARK = '#2b333b';
export const STEEL_MID = '#46505a';
export const STEEL_LIGHT = '#69747e';
export const STEEL_SPEC = '#aab4bc';

/** Drum paint: a dull institutional blue-grey. */
export const DRUM_DARK = '#25313b';
export const DRUM_MID = '#3a4b59';
export const DRUM_LIGHT = '#566a7a';
export const DRUM_SPEC = '#93a6b4';
export const DRUM_SHADES = [DRUM_DARK, DRUM_MID, DRUM_LIGHT] as const;

/** Oil drum: black paint gone dull, with a yellow hazard band. */
export const OIL_DARK = '#141618';
export const OIL_MID = '#25292c';
export const OIL_LIGHT = '#3f4448';
export const OIL_SPEC = '#7c8388';
export const OIL_BAND = '#9a7f2a';
export const OIL_BAND_LIGHT = '#bfa244';
export const OIL_GLOSS = 'rgba(10,9,8,0.75)';
/** The spilled pool: opaque enough to read as a slick, not a shadow. */
export const OIL_POOL = 'rgba(6,6,6,0.9)';
export const OIL_SHEEN = 'rgba(120,130,150,0.45)';

export const RUST = 'rgba(112,58,28,0.55)';
export const RUST_DARK = 'rgba(70,34,16,0.6)';
export const STENCIL = 'rgba(206,210,200,0.7)';
export const LABEL_WHITE = '#b9bcb4';
export const LABEL_RED = '#8c2f28';

/** Stacking crate: tough grey-blue plastic. */
export const PLASTIC_EDGE = '#141f29';
export const PLASTIC_DARK = '#22374a';
export const PLASTIC_MID = '#34516a';
export const PLASTIC_LIGHT = '#4b6f8a';
export const PLASTIC_SPEC = '#86a5ba';
export const PLASTIC_SHADES = [PLASTIC_DARK, PLASTIC_MID, PLASTIC_LIGHT] as const;
export const CAVITY = '#0c1116';

/** Cardboard supply boxes. */
export const CARD_DARK = '#5a4630';
export const CARD_MID = '#86694a';
export const CARD_LIGHT = '#a48660';
export const CARD_TAPE = '#bca97e';
export const CARD_SHADES = [CARD_DARK, CARD_MID, CARD_LIGHT] as const;

/** Work lamp: safety yellow over black steel. */
export const LAMP_YELLOW_DARK = '#6e5a1c';
export const LAMP_YELLOW = '#a48a2c';
export const LAMP_YELLOW_LIGHT = '#c9ad48';
export const BULB_CORE = '#fffbe8';
export const BULB_HOT = '#ffe7a6';
export const BULB_DIM = '#6d6656';
export const GLASS_GLINT = '#d6e2ea';

export const FIRE_HOT = '#ffd24a';
export const FIRE_OUTER = '#e2450f';
export const DEAD_COAL = '#2e2724';
export const DEAD_COAL_GREY = '#4d4540';
export const SOOT = '#241a14';

/** Every shade a ramp falls off to, at the far edges of a lit cylinder: shadow, not colour. */
export const TRANSPARENT = 'rgba(0,0,0,0)';

/** Seed offsets for each of a static prop's looks. Literal per look, never derived. */
const VARIANT_SEEDS = [0x0, 0x2e93, 0x6b41] as const;

export function variantSeed(variant: number): number {
  return VARIANT_SEEDS[variant % PROP_VARIANT_COUNT] ?? VARIANT_SEEDS[0];
}

/** The four values a painted steel body is shaded through. */
export interface DrumPaint {
  readonly dark: string;
  readonly mid: string;
  readonly light: string;
  readonly spec: string;
}

export const BLUE_DRUM: DrumPaint = {
  dark: DRUM_DARK,
  mid: DRUM_MID,
  light: DRUM_LIGHT,
  spec: DRUM_SPEC,
};
export const BLACK_DRUM: DrumPaint = {
  dark: OIL_DARK,
  mid: OIL_MID,
  light: OIL_LIGHT,
  spec: OIL_SPEC,
};

/** A soft-edged tonal wash in an ellipse: how stains and rust sit in paint without speckle. */
export function wash(
  ctx: Ctx,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  colour: string,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, colour);
  g.addColorStop(1, TRANSPARENT);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

export function line(
  ctx: Ctx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  colour: string,
  width = 1,
): void {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

const DENT_SHADE = 'rgba(0,0,0,0.45)';
/** The pushed-in floor of a dent sits this far up its own height, and this much narrower. */
const DENT_FLOOR_RISE = 0.3;
const DENT_FLOOR_WIDTH = 0.8;
const DENT_FLOOR_HEIGHT = 0.5;
/** The lit lip stops short of the dent's ends, where the bend flattens out. */
const DENT_LIP_TRIM = 0.15;

/**
 * A dent in sheet metal: a dark crescent where the face is pushed in, with a
 * lit lip on its lower edge where the bent steel catches the key light.
 */
export function dent(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, lit: string): void {
  ctx.save();
  ctx.fillStyle = DENT_SHADE;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, Math.PI, TWO_PI);
  ctx.ellipse(
    cx,
    cy - ry * DENT_FLOOR_RISE,
    rx * DENT_FLOOR_WIDTH,
    ry * DENT_FLOOR_HEIGHT,
    0,
    TWO_PI,
    Math.PI,
    true,
  );
  ctx.fill();
  ctx.strokeStyle = lit;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, DENT_LIP_TRIM, Math.PI - DENT_LIP_TRIM);
  ctx.stroke();
  ctx.restore();
}

/** A dent placed by offset from a reference point, in authored pixels. */
export interface DentMark {
  readonly dx: number;
  readonly dy: number;
  readonly rx: number;
  readonly ry: number;
}
