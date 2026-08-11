/**
 * The game's one visual language for "this ground is about to hurt": a translucent
 * red fill, diagonal hazard stripes crawling across it, and an animated dashed
 * outline. Established by the Grotesque Spider's screech ring and slam cone;
 * lifted here so every telegraphed boss draws the same warning rather than each
 * re-deriving ninety lines of canvas work.
 *
 * All geometry is in **screen pixels** — callers pass an already camera-offset
 * centre. `fade` is the 0–1 opacity ramp of the windup.
 */

/** Opacity of the flat red ground fill at full fade. */
const DANGER_FILL_ALPHA = 0.28;
/** Opacity of the crawling hazard stripes at full fade. */
const DANGER_STRIPE_ALPHA = 0.14;
/** Opacity of the dashed perimeter at full fade. */
const DANGER_OUTLINE_ALPHA = 0.7;
/** Milliseconds per pixel of stripe travel — how fast the hazard stripes crawl. */
const STRIPE_ANIM_DIVISOR = 120;
/** Gap between successive hazard stripes, in pixels. */
const STRIPE_SPACING = 28;
const STRIPE_WIDTH = 10;
const OUTLINE_WIDTH = 3;

/** Colours and dash rhythm for one telegraph. */
export interface DangerPalette {
  fill: string;
  stripe: string;
  outline: string;
  /** Length of a dash and of the gap after it, in pixels. */
  dashSegment: number;
  /** Milliseconds per pixel of dash travel. */
  dashSpeed: number;
  /** Dash offset wraps at this many pixels, keeping the animation seamless. */
  dashMod: number;
}

/** The spider's screech ring — the reference look for a circular telegraph. */
export const DANGER_CIRCLE_PALETTE: DangerPalette = {
  fill: '#ff1020',
  stripe: '#ff0000',
  outline: '#ff1020',
  dashSegment: 10,
  dashSpeed: 25,
  dashMod: 20,
};

/** The spider's slam cone — warmer, with a faster dash. */
export const DANGER_CONE_PALETTE: DangerPalette = {
  fill: '#ff4010',
  stripe: '#ff5010',
  outline: '#ff6020',
  dashSegment: 8,
  dashSpeed: 20,
  dashMod: 16,
};

/**
 * Fills the already-clipped region with the red wash and the crawling stripes.
 * The stripes run past the region on both sides because the clip, not their
 * extent, is what shapes them.
 */
function paintHazardFill(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  fade: number,
  palette: DangerPalette,
  now: number,
): void {
  ctx.globalAlpha = fade * DANGER_FILL_ALPHA;
  ctx.fillStyle = palette.fill;
  ctx.fillRect(cx - radiusPx, cy - radiusPx, radiusPx * 2, radiusPx * 2);
  ctx.globalAlpha = fade * DANGER_STRIPE_ALPHA;
  ctx.strokeStyle = palette.stripe;
  ctx.lineWidth = STRIPE_WIDTH;
  ctx.setLineDash([]);
  const stripeOffset = (now / STRIPE_ANIM_DIVISOR) % STRIPE_SPACING;
  for (let d = -radiusPx * 2 + stripeOffset; d < radiusPx * 2; d += STRIPE_SPACING) {
    ctx.beginPath();
    ctx.moveTo(cx + d - radiusPx, cy - radiusPx);
    ctx.lineTo(cx + d + radiusPx, cy + radiusPx);
    ctx.stroke();
  }
}

/** Configures the dashed-outline stroke style. Caller supplies the path. */
function beginDangerOutline(
  ctx: CanvasRenderingContext2D,
  fade: number,
  palette: DangerPalette,
  now: number,
): void {
  ctx.globalAlpha = fade * DANGER_OUTLINE_ALPHA;
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.setLineDash([palette.dashSegment, palette.dashSegment]);
  ctx.lineDashOffset = -(now / palette.dashSpeed) % palette.dashMod;
}

/** A circular ground warning centred on (cx, cy). */
export function drawDangerCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  fade: number,
  palette: DangerPalette = DANGER_CIRCLE_PALETTE,
): void {
  const now = performance.now();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
  ctx.clip();
  paintHazardFill(ctx, cx, cy, radiusPx, fade, palette, now);
  ctx.restore();

  ctx.save();
  beginDangerOutline(ctx, fade, palette, now);
  ctx.beginPath();
  ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * A square ground warning covering one map tile, given its top-left corner.
 *
 * The third shape in the language, for hazards that live on the grid rather than
 * in a radius around a caster — the Big Top's floor vents. The inner radius the
 * fill and stripes are drawn against is the tile's half-diagonal, so the stripes
 * reach the corners rather than stopping short of them.
 */
export function drawDangerTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  fade: number,
  palette: DangerPalette = DANGER_CONE_PALETTE,
): void {
  const now = performance.now();
  const cx = x + size / 2;
  const cy = y + size / 2;
  const coverRadius = size * Math.SQRT1_2 * 2;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();
  paintHazardFill(ctx, cx, cy, coverRadius, fade, palette, now);
  ctx.restore();

  ctx.save();
  beginDangerOutline(ctx, fade, palette, now);
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.stroke();
  ctx.restore();
}

/**
 * A pie-slice ground warning: a cone of half-angle `halfAngleRad` either side of
 * `facingAngle`, radiating from (cx, cy).
 */
export function drawDangerCone(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  facingAngle: number,
  halfAngleRad: number,
  fade: number,
  palette: DangerPalette = DANGER_CONE_PALETTE,
): void {
  const now = performance.now();
  const arcStart = facingAngle - halfAngleRad;
  const arcEnd = facingAngle + halfAngleRad;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, radiusPx, arcStart, arcEnd);
  ctx.closePath();
  ctx.clip();
  paintHazardFill(ctx, cx, cy, radiusPx, fade, palette, now);
  ctx.restore();

  ctx.save();
  beginDangerOutline(ctx, fade, palette, now);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, radiusPx, arcStart, arcEnd);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}
