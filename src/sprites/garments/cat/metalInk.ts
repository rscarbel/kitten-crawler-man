/**
 * The metals Donut's jewellery and armour are painted in, each as a ramp from
 * its shadow to its highlight, and the hard-banded fill they share: at her
 * in-game size a piece of metal is a handful of pixels, and only a fill that
 * steps from a lit band to a shadowed one reads as metal rather than paint.
 */

export interface MetalRamp {
  readonly shadow: string;
  readonly base: string;
  readonly light: string;
  readonly glint: string;
}

/**
 * A pale, lemony gold with a near-black shadow: her coat is ginger, and a
 * warmer gold sank into it at the tile.
 */
export const GOLD: MetalRamp = {
  shadow: '#3a2404',
  base: '#f0c93c',
  light: '#fff4a8',
  glint: '#fffdf0',
};

export const IRON: MetalRamp = {
  shadow: '#2c3036',
  base: '#6b727c',
  light: '#b9c1cc',
  glint: '#eef3f8',
};

export const SILVER: MetalRamp = {
  shadow: '#5c6670',
  base: '#b8c4cf',
  light: '#eef4fa',
  glint: '#ffffff',
};

/** Where the lit band gives way to the base, and the base to the shadow, across a fill. */
const LIT_UNTIL = 0.3;
const BASE_UNTIL = 0.68;
const BAND_FEATHER = 0.04;

/**
 * A fill stepping from lit to shadowed between two points: the key light
 * falls on the `from` end.
 */
export function metalFill(
  ctx: CanvasRenderingContext2D,
  metal: MetalRamp,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): CanvasGradient {
  const gradient = ctx.createLinearGradient(fromX, fromY, toX, toY);
  gradient.addColorStop(0, metal.light);
  gradient.addColorStop(LIT_UNTIL - BAND_FEATHER, metal.light);
  gradient.addColorStop(LIT_UNTIL + BAND_FEATHER, metal.base);
  gradient.addColorStop(BASE_UNTIL - BAND_FEATHER, metal.base);
  gradient.addColorStop(BASE_UNTIL + BAND_FEATHER, metal.shadow);
  gradient.addColorStop(1, metal.shadow);
  return gradient;
}

const FULL_TURN = Math.PI * 2;
const GLINT_ARMS = 4;
const GLINT_WAIST = 0.22;

/** A four-point sparkle: the one mark that says polished metal or glass at a few pixels. */
export function paintGlint(
  ctx: CanvasRenderingContext2D,
  metal: MetalRamp,
  x: number,
  y: number,
  reach: number,
): void {
  ctx.beginPath();
  for (let arm = 0; arm < GLINT_ARMS * 2; arm++) {
    const angle = (arm / (GLINT_ARMS * 2)) * FULL_TURN;
    const r = arm % 2 === 0 ? reach : reach * GLINT_WAIST;
    const px = x + Math.cos(angle) * r;
    const py = y + Math.sin(angle) * r;
    if (arm === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = metal.glint;
  ctx.fill();
}
