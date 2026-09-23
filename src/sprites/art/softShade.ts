/**
 * Shared soft-shading primitives for procedurally painted sprites.
 *
 * Canvas has no cheap Gaussian blur, so every soft shadow, highlight and
 * crease on a hand-painted figure (Tsarina Signet, and any painter built the
 * same way) is faked with layered radial/linear gradients instead. Left as
 * flat-alpha shapes, those fades leave a hard rim wherever they are not
 * clipped away — on a body that rim reads as a crease or a seam where there
 * is no anatomy at all. The three drawing primitives here exist to avoid
 * that: a soft-edged fill, a soft-edged stroke, and a taper for the gradients
 * that feed both.
 *
 * A single form drawn with two *concentric* soft shapes (a shade ellipse and
 * a highlight ellipse sharing a centre) puts the boundary between them on a
 * circle — the signature of "airbrushed onto a flat board", because a real
 * terminator is a line that follows the form underneath it, not a ring
 * radiating from its centre. Every caller here is expected to offset its
 * light and shade along the form's own axis and rotate both to that axis, so
 * the boundary comes out as a diagonal that tracks the anatomy: a breast lit
 * upper-inner and shaded lower-outer, a buttock lit upper-outer and shaded
 * lower-inner.
 */

import { clamp01, clampAlpha, rgba } from './carlArt';

/** A gradient can't be built on a zero-length axis; this keeps the radius/length always constructible without changing how anything visible looks. */
const DEGENERATE_EXTENT_EPSILON = 1e-4;

/**
 * A gradient stop offset `addColorStop` will accept: it throws on anything
 * outside [0, 1] and on NaN, and a computed hold or core fraction can drift
 * past either end.
 */
function safeStopOffset(offset: number): number {
  return Number.isNaN(offset) ? 0 : clamp01(offset);
}

/** Fraction of the radius held at full strength before the fade to transparent starts. */
const SOFT_SHADE_CORE_FRACTION = 0.4;

/**
 * Fill a soft-edged ellipse: a radial gradient from `color` at the centre out
 * to a fully transparent twin of `color` at the rim, rotated to `rotation` so
 * the fade can be aimed along whatever axis the form actually runs on.
 *
 * The transparent twin defaults to `color` itself via {@link rgba}, so a
 * caller doesn't have to hand-keep a matching `_FADE` constant in sync with
 * its solid colour for the common case. A form washed in one tone can still
 * ask to fade toward a *different* tone's transparent twin (`fadeColor`) —
 * every alpha channel on the way to fully transparent still carries that
 * tone's RGB, so it changes how the edge blends even though the endpoint
 * itself is invisible either way.
 *
 * `alpha` multiplies into whatever `globalAlpha` the caller has set, so a
 * figure faded as a whole fades its soft shading with it.
 */
export function fillSoftEllipse(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  color: string,
  alpha: number,
  rotation = 0,
  coreFraction: number = SOFT_SHADE_CORE_FRACTION,
  fadeColor: string = rgba(color, 0),
): void {
  const safeRadiusX = Math.max(DEGENERATE_EXTENT_EPSILON, Math.abs(radiusX));
  const safeRadiusY = Math.max(DEGENERATE_EXTENT_EPSILON, Math.abs(radiusY));
  const safeAlpha = clampAlpha(ctx.globalAlpha * alpha);
  if (safeAlpha === 0) return;

  ctx.save();
  try {
    ctx.globalAlpha = safeAlpha;
    ctx.translate(centerX, centerY);
    ctx.rotate(rotation);
    ctx.scale(safeRadiusX, safeRadiusY);
    const shade = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    shade.addColorStop(0, color);
    shade.addColorStop(safeStopOffset(coreFraction), color);
    shade.addColorStop(1, fadeColor);
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
  } finally {
    ctx.restore();
  }
}

/**
 * Widths and opacities for the layered strokes {@link strokeSoftCrease} lays
 * down. A single stroke of even width reads as ink drawn on the skin however
 * dark it is, because a real crease (a fold, a seam, a groove) has no hard
 * edge — the layering fakes canvas's missing blur by stacking a wide, faint
 * halo of shadow under a narrow, dark core.
 *
 * The step count and spacing both matter: too few layers, or too wide a jump
 * between them, and a deep crease on a broad curve stops reading as one soft
 * shadow and starts reading as concentric rings.
 */
const CREASE_LAYERS = [
  { widthScale: 4, alpha: 0.045 },
  { widthScale: 3.5, alpha: 0.05 },
  { widthScale: 3, alpha: 0.06 },
  { widthScale: 2.6, alpha: 0.07 },
  { widthScale: 2.2, alpha: 0.085 },
  { widthScale: 1.8, alpha: 0.1 },
  { widthScale: 1.5, alpha: 0.13 },
  { widthScale: 1.2, alpha: 0.18 },
  { widthScale: 1, alpha: 0.42 },
] as const;

/** One stroke of a layered crease: its width as a multiple of the base width, and its opacity. */
export interface CreaseLayer {
  readonly widthScale: number;
  readonly alpha: number;
}

/**
 * Stroke a path once per entry in `layers` ({@link CREASE_LAYERS} by default), widest and faintest
 * first, to build one soft crease out of strokes canvas can actually draw.
 * `stroke` may be a flat colour or a gradient (see
 * {@link taperedCreaseGradient}) so a crease can fade out along its own
 * length as well as across its width.
 *
 * A figure painted small can pass a shorter `layers` table: at a 32 px tile
 * the nine-step halo averages into the same pixels as three steps would, and
 * each step is a full stroke of the path.
 *
 * Every layer's opacity multiplies into the caller's `globalAlpha`, as
 * {@link fillSoftEllipse} does.
 */
export function strokeSoftCrease(
  ctx: CanvasRenderingContext2D,
  baseWidth: number,
  stroke: string | CanvasGradient,
  tracePath: () => void,
  opacity = 1,
  layers: ReadonlyArray<CreaseLayer> = CREASE_LAYERS,
): void {
  const callerAlpha = ctx.globalAlpha;
  ctx.save();
  try {
    ctx.strokeStyle = stroke;
    ctx.lineCap = 'round';
    for (const layer of layers) {
      ctx.globalAlpha = clampAlpha(callerAlpha * layer.alpha * opacity);
      ctx.lineWidth = baseWidth * layer.widthScale;
      ctx.beginPath();
      tracePath();
      ctx.stroke();
    }
  } finally {
    ctx.restore();
  }
}

/**
 * A linear gradient that fades in from transparent, holds `color` between
 * `holdStartStop` and `holdEndStop`, then fades back to transparent — for a
 * crease that has to die out at one or both ends instead of terminating in a
 * hard cap (the underbust curve, the collarbone ridge). Passing a single stop
 * (the default) collapses the hold to a point, which gives a crease that
 * peaks in the middle and fades at both ends rather than one with a flat
 * plateau.
 *
 * The transparent ends are derived from `color` via {@link rgba}, for the
 * same reason {@link fillSoftEllipse} derives its own fade.
 */
export function taperedCreaseGradient(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  holdStartStop: number,
  holdEndStop: number = holdStartStop,
): CanvasGradient {
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  const fade = rgba(color, 0);
  gradient.addColorStop(0, fade);
  gradient.addColorStop(safeStopOffset(holdStartStop), color);
  gradient.addColorStop(safeStopOffset(holdEndStop), color);
  gradient.addColorStop(1, fade);
  return gradient;
}

/**
 * Clip to a traced path for the duration of `paint`, restoring the context
 * whether or not `paint` throws.
 *
 * Interior shading is always clipped to its own form's silhouette: a soft
 * fade sized to look right sits far outside the shape it is modelling (see
 * `SEAT_SHADE_*` in `signetSprite.ts`, deliberately oversized so the clip is
 * what ends it, not the gradient's own falloff), so nothing else keeps a
 * shadow or highlight from bleeding past the outline it is meant to shade.
 * A painter that throws mid-clip would otherwise leave the clip and alpha of
 * that half-drawn frame on the context's save stack, and every frame drawn
 * after it inherits that state until something else happens to restore it —
 * `withClip`'s `try/finally` is what guarantees that never happens here.
 */
export function withClip(
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
