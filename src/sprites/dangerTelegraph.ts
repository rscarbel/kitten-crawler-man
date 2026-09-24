/**
 * The game's one visual language for "this ground is about to hurt": a translucent
 * red fill, diagonal hazard stripes crawling across it, and an animated dashed
 * outline. Established by the Grotesque Spider's screech ring and slam cone;
 * lifted here so every telegraphed boss draws the same warning rather than each
 * re-deriving ninety lines of canvas work.
 *
 * All geometry is in **screen pixels** — callers pass an already camera-offset
 * centre. `fade` is the 0–1 opacity ramp of the windup.
 *
 * A telegraph can also say *when* it lands, through {@link DangerTelegraphOptions}:
 * the fill grows from the centre toward an outline drawn at the full hit reach,
 * the outline freezes solid once the aim can no longer change, and the whole
 * shape flashes on the tick the damage is computed. Omitting the options draws
 * the plain crawling warning.
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

/** Opacity of a locked outline at full fade: brighter than the crawling one so the change of state reads. */
const LOCKED_OUTLINE_ALPHA = 1;
const LOCKED_OUTLINE_WIDTH = 4;
/** A thin pale core inside a locked outline, so it reads as lit rather than just thicker. */
const LOCKED_OUTLINE_CORE_COLOR = '#ffe0d0';
const LOCKED_OUTLINE_CORE_WIDTH = 1.5;
const LOCKED_OUTLINE_CORE_ALPHA = 0.85;
/** Opacity of the solid edge at the front of a growing fill, marking how far it has come. */
const FILL_FRONT_ALPHA = 0.55;
const FILL_FRONT_WIDTH = 2;
/** The strike flash: a red wash under a white one, together reading as white-hot red. */
const STRIKE_FLASH_RED = '#ff3020';
const STRIKE_FLASH_RED_ALPHA = 0.55;
const STRIKE_FLASH_WHITE = '#fff4ee';
const STRIKE_FLASH_WHITE_ALPHA = 0.5;

/**
 * How a telegraph shows timing on top of where it hits. Every field is
 * optional; omitted, the telegraph is the plain crawling warning with a full
 * fill.
 */
export interface DangerTelegraphOptions {
  /**
   * 0–1: how far the fill has grown from the centre toward the outline, which is
   * always drawn at the full reach. The rule a player learns is that the hit
   * lands when the fill meets the outline, so a caller drives this to exactly 1
   * on the damage tick. Omitted, the whole shape is filled.
   */
  readonly fillProgress?: number;
  /** The aim and shape are frozen: the outline goes solid and brighter and its dashes stop crawling. */
  readonly locked?: boolean;
  /** 0–1 strength of a white-red flash over the whole shape, for the ticks after the damage lands. */
  readonly strikeFlash?: number;
  /**
   * Draws only the strokes: the outline and the front of a growing fill, with
   * no wash, stripes or flash. For an overlay drawn above the entities, where
   * the edge must stay readable over the caster's own body without tinting
   * whoever stands inside the shape.
   */
  readonly outlineOnly?: boolean;
}

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

/**
 * Strokes the outline along `tracePath`: dashed and crawling, or solid with a
 * pale core once locked.
 */
function strokeDangerOutline(
  ctx: CanvasRenderingContext2D,
  fade: number,
  palette: DangerPalette,
  now: number,
  locked: boolean,
  tracePath: () => void,
): void {
  ctx.save();
  if (!locked) {
    beginDangerOutline(ctx, fade, palette, now);
    tracePath();
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = fade * LOCKED_OUTLINE_ALPHA;
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = LOCKED_OUTLINE_WIDTH;
  tracePath();
  ctx.stroke();
  ctx.globalAlpha = fade * LOCKED_OUTLINE_CORE_ALPHA;
  ctx.strokeStyle = LOCKED_OUTLINE_CORE_COLOR;
  ctx.lineWidth = LOCKED_OUTLINE_CORE_WIDTH;
  ctx.stroke();
  ctx.restore();
}

/** Washes the already-clipped region white-red. */
function paintStrikeFlash(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  strength: number,
): void {
  const left = cx - radiusPx;
  const top = cy - radiusPx;
  const size = radiusPx * 2;
  ctx.globalAlpha = strength * STRIKE_FLASH_RED_ALPHA;
  ctx.fillStyle = STRIKE_FLASH_RED;
  ctx.fillRect(left, top, size, size);
  ctx.globalAlpha = strength * STRIKE_FLASH_WHITE_ALPHA;
  ctx.fillStyle = STRIKE_FLASH_WHITE;
  ctx.fillRect(left, top, size, size);
}

/** The fill's reach for a 0–1 progress, or the full reach when no progress is given. */
function fillRadiusFor(radiusPx: number, fillProgress: number | undefined): number {
  if (fillProgress === undefined) return radiusPx;
  return radiusPx * Math.min(1, Math.max(0, fillProgress));
}

/** Strokes the solid front of a fill still growing toward its outline. */
function strokeFillFront(
  ctx: CanvasRenderingContext2D,
  fade: number,
  palette: DangerPalette,
  tracePath: () => void,
): void {
  ctx.save();
  ctx.setLineDash([]);
  ctx.globalAlpha = fade * FILL_FRONT_ALPHA;
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = FILL_FRONT_WIDTH;
  tracePath();
  ctx.stroke();
  ctx.restore();
}

/** A circular ground warning centred on (cx, cy). */
export function drawDangerCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  fade: number,
  palette: DangerPalette = DANGER_CIRCLE_PALETTE,
  options: DangerTelegraphOptions = {},
): void {
  const now = performance.now();
  const fillRadius = fillRadiusFor(radiusPx, options.fillProgress);
  const outlineOnly = options.outlineOnly ?? false;
  const flash = outlineOnly ? 0 : (options.strikeFlash ?? 0);
  const traceFull = (): void => {
    ctx.beginPath();
    ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
  };

  if (fillRadius > 0) {
    if (!outlineOnly) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, fillRadius, 0, Math.PI * 2);
      ctx.clip();
      paintHazardFill(ctx, cx, cy, radiusPx, fade, palette, now);
      ctx.restore();
    }
    if (fillRadius < radiusPx) {
      strokeFillFront(ctx, fade, palette, () => {
        ctx.beginPath();
        ctx.arc(cx, cy, fillRadius, 0, Math.PI * 2);
      });
    }
  }

  if (flash > 0) {
    ctx.save();
    traceFull();
    ctx.clip();
    paintStrikeFlash(ctx, cx, cy, radiusPx, flash);
    ctx.restore();
  }

  strokeDangerOutline(ctx, fade, palette, now, options.locked ?? false, traceFull);
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
 * `facingAngle`, radiating from (cx, cy). A growing fill spreads outward from
 * the apex.
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
  options: DangerTelegraphOptions = {},
): void {
  const now = performance.now();
  const arcStart = facingAngle - halfAngleRad;
  const arcEnd = facingAngle + halfAngleRad;
  const fillRadius = fillRadiusFor(radiusPx, options.fillProgress);
  const outlineOnly = options.outlineOnly ?? false;
  const flash = outlineOnly ? 0 : (options.strikeFlash ?? 0);
  const tracePie = (reach: number): void => {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, reach, arcStart, arcEnd);
    ctx.closePath();
  };

  if (fillRadius > 0) {
    if (!outlineOnly) {
      ctx.save();
      tracePie(fillRadius);
      ctx.clip();
      paintHazardFill(ctx, cx, cy, radiusPx, fade, palette, now);
      ctx.restore();
    }
    if (fillRadius < radiusPx) {
      strokeFillFront(ctx, fade, palette, () => {
        ctx.beginPath();
        ctx.arc(cx, cy, fillRadius, arcStart, arcEnd);
      });
    }
  }

  if (flash > 0) {
    ctx.save();
    tracePie(radiusPx);
    ctx.clip();
    paintStrikeFlash(ctx, cx, cy, radiusPx, flash);
    ctx.restore();
  }

  strokeDangerOutline(ctx, fade, palette, now, options.locked ?? false, () => tracePie(radiusPx));
}
