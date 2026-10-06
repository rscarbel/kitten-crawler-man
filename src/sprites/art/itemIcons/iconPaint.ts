/**
 * Shared brushwork for the hand-painted item icons.
 *
 * Every icon here is painted in a unit square: {@link paintIconArt} clips to
 * the icon's cell, then translates and scales so (0,0) is its top-left corner
 * and (1,1) its bottom-right, and hands the painter the size of one screen
 * pixel in those units so outlines and hairlines stay crisp at any slot size.
 *
 * Light always comes from the top-left. A form is shaded with hard-stopped
 * bands laid along a straight axis, so the terminator is a line that crosses
 * the form, never a ring around a centre — concentric soft fills read as
 * airbrushed onto a flat board.
 */

import type { Rect } from '../../../ui/core/geom';
import { iconSquare } from '../../../ui/icons/iconSquare';

/** A polygon vertex in unit space, with an optional corner radius rounding it. */
export type IconPoint = readonly [x: number, y: number, cornerRadius?: number];

/** One hard-edged band of a {@link bandedFill}: its colour, held up to `until` along the axis (0..1). */
export type ShadeBand = readonly [color: string, until: number];

/** Paints in the icon's unit square; `px` is one screen pixel in unit-square units. */
export type IconArtPainter = (ctx: CanvasRenderingContext2D, px: number) => void;

/** The icon square's centre line, in unit space. */
export const ICON_CENTER = 0.5;
/** Width multiples of a hairline for a detail that must still read as a line at slot size (a seam, a fly, a toe cap). */
export const MEDIUM_DETAIL = 1.5;
export const BOLD_DETAIL = 2;

/** The warm near-black every silhouette is outlined in. */
export const ICON_OUTLINE = '#120d0a';
export const GLINT_WHITE = '#ffffff';
export const FULL_TURN = Math.PI * 2;

/** Outline thickness as a fraction of the icon, so it keeps its weight from slot to tooltip. */
const OUTLINE_UNIT = 0.034;
/** Never thinner than one screen pixel, or a 24 px icon loses its silhouette. */
const OUTLINE_MIN_PX = 1;
/** A hairline (seam, grain, stitch) as a fraction of the icon. */
const HAIRLINE_UNIT = 0.018;
const HAIRLINE_MIN_PX = 0.75;
/** A band boundary is this far from a hard step, enough to anti-alias the terminator without blurring it. */
const BAND_FEATHER = 0.012;

const HEX_RADIX = 16;
const CHANNEL_MAX = 255;
const HEX_RED_START = 1;
const HEX_GREEN_START = 3;
const HEX_BLUE_START = 5;
const HEX_CHANNEL_LENGTH = 2;
const HEX_PAD = 2;

/** Default lit/mid/shade split for {@link litFill}: the first third catches the light, the last third turns away. */
const LIT_HIGHLIGHT_UNTIL = 0.34;
const LIT_MID_UNTIL = 0.68;
const LIT_HIGHLIGHT_AMOUNT = 0.28;
const LIT_SHADE_AMOUNT = -0.38;

/** A rivet's lit face inside its dark ring. */
const RIVET_FACE_FRACTION = 0.72;

/** A glint's arms are this much thinner than they are long. */
const GLINT_WAIST = 0.22;
const GLINT_ARMS = 4;

/** Clips to `rect`'s icon square and paints `paint` in that square's unit space. */
export function paintIconArt(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  paint: IconArtPainter,
): void {
  const { x, y, size } = iconSquare(rect);
  const drawable = size > 0 && Number.isFinite(size) && Number.isFinite(x) && Number.isFinite(y);
  if (!drawable) return;
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(x, y, size, size);
    ctx.clip();
    ctx.translate(x, y);
    ctx.scale(size, size);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    paint(ctx, 1 / size);
  } finally {
    ctx.restore();
  }
}

export function outlineWidth(px: number): number {
  return Math.max(OUTLINE_UNIT, px * OUTLINE_MIN_PX);
}

export function hairlineWidth(px: number): number {
  return Math.max(HAIRLINE_UNIT, px * HAIRLINE_MIN_PX);
}

function channel(hex: string, start: number): number {
  return Number.parseInt(hex.slice(start, start + HEX_CHANNEL_LENGTH), HEX_RADIX);
}

function toHex(value: number): string {
  return Math.round(value).toString(HEX_RADIX).padStart(HEX_PAD, '0');
}

/**
 * `hex` (#rrggbb) moved toward white by a positive `amount` or toward black by
 * a negative one, `amount` in -1..1.
 */
export function tone(hex: string, amount: number): string {
  const target = amount >= 0 ? CHANNEL_MAX : 0;
  const t = Math.min(1, Math.abs(amount));
  const mixed = [HEX_RED_START, HEX_GREEN_START, HEX_BLUE_START].map((start) => {
    const value = channel(hex, start);
    return toHex(value + (target - value) * t);
  });
  return `#${mixed.join('')}`;
}

/** Traces a closed polygon, rounding any vertex that carries a corner radius. */
export function tracePoints(ctx: CanvasRenderingContext2D, points: readonly IconPoint[]): void {
  ctx.beginPath();
  appendPoints(ctx, points);
}

/** Adds a closed polygon to the current path as its own sub-path, for shapes built from several parts. */
export function appendPoints(ctx: CanvasRenderingContext2D, points: readonly IconPoint[]): void {
  const count = points.length;
  if (count === 0) return;
  const last = points[count - 1];
  const first = points[0];
  ctx.moveTo((last[0] + first[0]) / 2, (last[1] + first[1]) / 2);
  for (let i = 0; i < count; i++) {
    const corner = points[i];
    const next = points[(i + 1) % count];
    const radius = corner[2] ?? 0;
    if (radius > 0) ctx.arcTo(corner[0], corner[1], next[0], next[1], radius);
    else ctx.lineTo(corner[0], corner[1]);
  }
  ctx.closePath();
}

/** An open polyline through `points`, rounding any vertex that carries a corner radius. */
export function tracePolyline(ctx: CanvasRenderingContext2D, points: readonly IconPoint[]): void {
  ctx.beginPath();
  points.forEach((point, i) => {
    const radius = point[2] ?? 0;
    const hasNext = i + 1 < points.length;
    if (i === 0) ctx.moveTo(point[0], point[1]);
    else if (hasNext && radius > 0) {
      const next = points[i + 1];
      ctx.arcTo(point[0], point[1], next[0], next[1], radius);
    } else ctx.lineTo(point[0], point[1]);
  });
}

/** A gradient of flat bands with a crisp boundary between each, laid from `from` to `to`. */
export function bandedFill(
  ctx: CanvasRenderingContext2D,
  from: readonly [number, number],
  to: readonly [number, number],
  bands: readonly ShadeBand[],
): CanvasGradient {
  const gradient = ctx.createLinearGradient(from[0], from[1], to[0], to[1]);
  let start = 0;
  for (const [color, until] of bands) {
    gradient.addColorStop(Math.min(1, start), color);
    gradient.addColorStop(Math.max(start, Math.min(1, until - BAND_FEATHER)), color);
    start = Math.min(1, until + BAND_FEATHER);
  }
  return gradient;
}

/**
 * The standard three-band treatment for `base`: highlight, mid and shade laid
 * from `from` (the lit side) to `to` (the side turned away from the light).
 */
export function litFill(
  ctx: CanvasRenderingContext2D,
  base: string,
  from: readonly [number, number],
  to: readonly [number, number],
): CanvasGradient {
  return bandedFill(ctx, from, to, [
    [tone(base, LIT_HIGHLIGHT_AMOUNT), LIT_HIGHLIGHT_UNTIL],
    [base, LIT_MID_UNTIL],
    [tone(base, LIT_SHADE_AMOUNT), 1],
  ]);
}

/**
 * Fills the path `trace` builds with `fill`, outlined outside it: the outline
 * is stroked at twice its width before the fill, so the fill covers the inner
 * half and the silhouette keeps its full area.
 */
export function paintForm(
  ctx: CanvasRenderingContext2D,
  px: number,
  trace: () => void,
  fill: string | CanvasGradient,
  outline: string = ICON_OUTLINE,
): void {
  trace();
  ctx.strokeStyle = outline;
  ctx.lineWidth = outlineWidth(px) * 2;
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Runs `paint` clipped to the path `trace` builds, for shading that must stay inside a form. */
export function withShapeClip(
  ctx: CanvasRenderingContext2D,
  trace: () => void,
  paint: () => void,
): void {
  ctx.save();
  try {
    trace();
    ctx.clip();
    paint();
  } finally {
    ctx.restore();
  }
}

/** Strokes an open polyline as a hairline-weight detail line (seam, grain, stitch). */
export function strokeDetail(
  ctx: CanvasRenderingContext2D,
  px: number,
  points: readonly IconPoint[],
  color: string,
  widthScale = 1,
): void {
  tracePolyline(ctx, points);
  ctx.strokeStyle = color;
  ctx.lineWidth = hairlineWidth(px) * widthScale;
  ctx.stroke();
}

/** A filled disc, outlined or not. */
export function disc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  fill: string | CanvasGradient,
): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, FULL_TURN);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** A rivet or stud: a dark-ringed dome lit top-left with a pinpoint highlight. */
export function rivet(
  ctx: CanvasRenderingContext2D,
  px: number,
  cx: number,
  cy: number,
  r: number,
  base: string,
): void {
  const ring = Math.max(r, px * OUTLINE_MIN_PX * 2);
  disc(ctx, cx, cy, ring, ICON_OUTLINE);
  disc(
    ctx,
    cx,
    cy,
    ring * RIVET_FACE_FRACTION,
    litFill(ctx, base, [cx - r, cy - r], [cx + r, cy + r]),
  );
}

/** A four-armed specular glint: the one mark that says "polished metal" or "wet gem" at slot size. */
export function glint(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string = GLINT_WHITE,
): void {
  ctx.beginPath();
  for (let arm = 0; arm < GLINT_ARMS * 2; arm++) {
    const angle = (arm / (GLINT_ARMS * 2)) * FULL_TURN;
    const reach = arm % 2 === 0 ? r : r * GLINT_WAIST;
    const px = cx + Math.cos(angle) * reach;
    const py = cy + Math.sin(angle) * reach;
    if (arm === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/** One layer of {@link offsetShade}: its colour, painted through the form's own silhouette shifted by (dx, dy). */
export type OffsetLayer = readonly [color: string, dx: number, dy: number];

/**
 * Shades a rounded form by repainting its own silhouette, shifted, inside
 * itself: a copy pushed down and right leaves a lit crescent on the upper-left
 * rim, a second pushed further turns the far side into shade. The boundaries
 * follow the form's contour, the way a terminator wraps a real dome, instead
 * of sitting on a ring around its centre.
 *
 * `trace(dx, dy)` must build the form's path shifted by (dx, dy).
 */
export function offsetShade(
  ctx: CanvasRenderingContext2D,
  trace: (dx: number, dy: number) => void,
  layers: readonly OffsetLayer[],
): void {
  withShapeClip(
    ctx,
    () => trace(0, 0),
    () => {
      for (const [color, dx, dy] of layers) {
        trace(dx, dy);
        ctx.fillStyle = color;
        ctx.fill();
      }
    },
  );
}

/** Traces an ellipse as its own closed sub-path. */
export function traceEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, FULL_TURN);
}
