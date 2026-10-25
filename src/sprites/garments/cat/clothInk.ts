/**
 * What the cat crawler's cloth and leather share: a fabric as a ramp from
 * shadow to light, the clip that keeps it inside the piece of fur it is
 * painted on, and the lit fill that turns it with her body. At her in-game
 * size a garment is a patch of a few pixels, so its read is a clean colour
 * against her coat and a darker edge where it ends.
 */

type Ctx = CanvasRenderingContext2D;
type Pt = { readonly x: number; readonly y: number };

const SHADE_INK = '#0d0a08';

export interface FabricRamp {
  readonly shadow: string;
  readonly base: string;
  readonly light: string;
  /** The edge where it ends on her fur: a hem, a cuff, a sole. */
  readonly edge: string;
}

/** Clips to a piece's own silhouette, so whatever is painted next stays on her. */
export function clipToOutline(ctx: Ctx, outline: readonly Pt[]): void {
  ctx.beginPath();
  outline.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
  ctx.clip();
}

/** Where the light band gives way to the base, and the base to the shadow, down a fill. */
const LIT_UNTIL = 0.25;
const BASE_UNTIL = 0.7;

/** A fill lit from its `from` end and shadowed toward its `to` end. */
export function fabricFill(ctx: Ctx, fabric: FabricRamp, from: Pt, to: Pt): CanvasGradient {
  const gradient = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
  gradient.addColorStop(0, fabric.light);
  gradient.addColorStop(LIT_UNTIL, fabric.base);
  gradient.addColorStop(BASE_UNTIL, fabric.base);
  gradient.addColorStop(1, fabric.shadow);
  return gradient;
}

/** Strokes a line from `from` through `control` to `to`. */
export function strokeCurve(
  ctx: Ctx,
  from: Pt,
  control: Pt,
  to: Pt,
  colour: string,
  width: number,
): void {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.quadraticCurveTo(control.x, control.y, to.x, to.y);
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.stroke();
}

/** Darkens a piece in the body's shade, as her own fur is darkened there. */
export function shadeOver(
  ctx: Ctx,
  shade: number,
  left: number,
  top: number,
  w: number,
  h: number,
): void {
  if (shade <= 0) return;
  ctx.save();
  ctx.globalAlpha = shade;
  ctx.fillStyle = SHADE_INK;
  ctx.fillRect(left, top, w, h);
  ctx.restore();
}
