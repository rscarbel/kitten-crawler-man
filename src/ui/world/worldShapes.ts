/**
 * Bars, plates and tints painted into the game world: a health or build bar
 * over a creature or structure, the box behind a caption or speech bubble, a
 * full-canvas wash over the scene. Bare-context painters in the caller's own
 * space, styled from `theme/worldInk.ts`. Screen UI uses the `meter` and
 * `panel` widgets instead.
 */

import type { Rect } from '../core/geom';
import {
  WORLD_BAR,
  WORLD_PLATE,
  worldPalette,
  type WorldBarStyle,
  type WorldBarStyleId,
  type WorldPlateStyle,
  type WorldPlateStyleId,
} from '../theme/worldInk';

export interface WorldBarOptions extends Partial<WorldBarStyle> {
  /** A named look, applied under any field given directly. */
  readonly style?: WorldBarStyleId;
  /** How full, 0 to 1; clamped. */
  readonly value: number;
  readonly alpha?: number;
  /** A lighter band over the top half of the fill. */
  readonly sheen?: string;
  /** A soft glow round the fill. */
  readonly glow?: string;
  readonly glowBlur?: number;
}

export interface WorldPlateOptions extends WorldPlateStyle {
  /** A named look, applied under any field given directly. */
  readonly style?: WorldPlateStyleId;
  readonly alpha?: number;
  /** A soft glow in the border colour, or in this one. */
  readonly glow?: boolean | string;
  readonly glowBlur?: number;
  /** The glow haloes the border stroke as well as the fill, so the edge reads as lit. */
  readonly glowEdge?: boolean;
  /** A drop shadow in the default shadow colour, or in this one. Wins over `glow`. */
  readonly shadow?: boolean | string;
  readonly shadowBlur?: number;
  readonly shadowOffset?: { readonly x: number; readonly y: number };
}

const DEFAULT_BAR_BORDER_WIDTH = 1;
const DEFAULT_BAR_GLOW_BLUR = 12;
const DEFAULT_PLATE_BORDER_WIDTH = 1.5;
const DEFAULT_PLATE_GLOW_BLUR = 20;
const DEFAULT_PLATE_SHADOW_BLUR = 16;
const DEFAULT_PLATE_SHADOW_OFFSET = { x: 4, y: 4 } as const;
const SHEEN_HEIGHT_FRACTION = 0.5;
const HALF = 0.5;

/**
 * Traces a rectangle with quadratic corners, the radius clamped to half the
 * shorter side. Quadratic rather than circular corners: at the two-to-five
 * pixel radii world bars use, this is the softer corner the world art has
 * always been drawn with.
 */
function tracePlate(ctx: CanvasRenderingContext2D, rect: Rect, radius: number): void {
  const { x, y, w, h } = rect;
  const r = Math.min(radius, w * HALF, h * HALF);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function fillShape(ctx: CanvasRenderingContext2D, rect: Rect, radius: number, fill: string): void {
  ctx.fillStyle = fill;
  if (radius <= 0) {
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    return;
  }
  tracePlate(ctx, rect, radius);
  ctx.fill();
}

/** Strokes centred on the edge, matching how world bars and plates have always been outlined. */
function strokeShape(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  radius: number,
  color: string,
  width: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (radius <= 0) {
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    return;
  }
  tracePlate(ctx, rect, radius);
  ctx.stroke();
}

/** A filled bar: track, fill clipped to the track's rounded shape, optional edge. */
export function worldBar(ctx: CanvasRenderingContext2D, rect: Rect, opts: WorldBarOptions): void {
  const base: Partial<WorldBarStyle> = opts.style === undefined ? {} : WORLD_BAR[opts.style];
  const fill = opts.fill ?? base.fill ?? worldPalette.bar.stamina;
  const track = opts.track ?? base.track ?? worldPalette.bar.track;
  const border = opts.border ?? base.border;
  const borderWidth = opts.borderWidth ?? base.borderWidth ?? DEFAULT_BAR_BORDER_WIDTH;
  const radius = opts.radius ?? base.radius ?? 0;
  const fraction = Math.max(0, Math.min(1, opts.value));
  const filled: Rect = { ...rect, w: rect.w * fraction };

  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  fillShape(ctx, rect, radius, track);

  if (fraction > 0) {
    if (opts.glow !== undefined) {
      ctx.save();
      ctx.shadowColor = opts.glow;
      ctx.shadowBlur = opts.glowBlur ?? DEFAULT_BAR_GLOW_BLUR;
      fillShape(ctx, filled, Math.min(radius, filled.w * HALF), fill);
      ctx.restore();
    }
    ctx.save();
    if (radius > 0) {
      tracePlate(ctx, rect, radius);
      ctx.clip();
    }
    ctx.fillStyle = fill;
    ctx.fillRect(filled.x, filled.y, filled.w, filled.h);
    if (opts.sheen !== undefined) {
      ctx.fillStyle = opts.sheen;
      ctx.fillRect(filled.x, filled.y, filled.w, filled.h * SHEEN_HEIGHT_FRACTION);
    }
    ctx.restore();
  }

  if (border !== undefined) strokeShape(ctx, rect, radius, border, borderWidth);
  ctx.restore();
}

/** A backing plate: fill, optional glow or drop shadow under it, optional edge. */
export function worldPlate(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  opts: WorldPlateOptions = {},
): void {
  const base: WorldPlateStyle = opts.style === undefined ? {} : WORLD_PLATE[opts.style];
  const fill = opts.fill ?? base.fill;
  const border = opts.border ?? base.border;
  const borderWidth = opts.borderWidth ?? base.borderWidth ?? DEFAULT_PLATE_BORDER_WIDTH;
  const radius = opts.radius ?? base.radius ?? 0;
  const glow = opts.glow ?? false;
  const shadow = opts.shadow ?? false;

  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  if (fill !== undefined) {
    ctx.save();
    if (shadow !== false) {
      ctx.shadowColor = typeof shadow === 'string' ? shadow : worldPalette.shadow;
      ctx.shadowBlur = opts.shadowBlur ?? DEFAULT_PLATE_SHADOW_BLUR;
      const offset = opts.shadowOffset ?? DEFAULT_PLATE_SHADOW_OFFSET;
      ctx.shadowOffsetX = offset.x;
      ctx.shadowOffsetY = offset.y;
    } else if (glow !== false) {
      ctx.shadowColor = typeof glow === 'string' ? glow : (border ?? worldPalette.ink.bright);
      ctx.shadowBlur = opts.glowBlur ?? DEFAULT_PLATE_GLOW_BLUR;
    }
    fillShape(ctx, rect, radius, fill);
    ctx.restore();
  }
  if (border !== undefined) {
    ctx.save();
    if (opts.glowEdge === true && shadow === false && glow !== false) {
      ctx.shadowColor = typeof glow === 'string' ? glow : border;
      ctx.shadowBlur = opts.glowBlur ?? DEFAULT_PLATE_GLOW_BLUR;
    }
    strokeShape(ctx, rect, radius, border, borderWidth);
    ctx.restore();
  }
  ctx.restore();
}

/** Washes the whole of `ctx`'s canvas in `color` at `alpha`: a fade, a flash, a darkening. */
export function worldTint(ctx: CanvasRenderingContext2D, color: string, alpha: number): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}
