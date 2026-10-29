/**
 * Drawing tiled art — floor surfaces, ground chunks, water — on whole device
 * pixels.
 *
 * A tile's rect lands on fractional device pixels whenever the tile size times
 * the canvas scale (render scale times the camera's zoom) is not a whole number. Anything drawn there — a per-pixel
 * surface or a translucent fill — is anti-aliased along that edge, and the
 * neighbouring tile's art is anti-aliased along the same edge from the other
 * side, so the two half-covered pixels never add back up to one: every tile
 * boundary shows as a faint line. Rounding both ends of every rect through the
 * same mapping makes two tiles that share an edge share its device pixel
 * exactly, with no overlap and no gap, at any scale.
 *
 * Every helper assumes a transform of scale and translation only, which is
 * all the world pass ever sets.
 */

import type { CanvasSurface } from '../../core/rendering/canvasSurface';

/** A rect in device pixels, with whole-number corners. */
export interface DeviceRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * The device-pixel rect a rect in `ctx`'s user space covers, corners rounded.
 * `m` is `ctx`'s current transform, read once by a caller snapping many rects.
 */
export function snappedDeviceRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  m: DOMMatrix = ctx.getTransform(),
): DeviceRect {
  const left = Math.round(m.a * x + m.e);
  const top = Math.round(m.d * y + m.f);
  const right = Math.round(m.a * (x + w) + m.e);
  const bottom = Math.round(m.d * (y + h) + m.f);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Fills a user-space rect, snapped to whole device pixels, in the current fill style. */
export function fillSnapped(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const rect = snappedDeviceRect(ctx, x, y, w, h);
  if (rect.w <= 0 || rect.h <= 0) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

/** Draws a surface painted at exactly `rect`'s size onto `rect`, with no resampling. */
export function blitAtDevice(
  ctx: CanvasRenderingContext2D,
  surface: CanvasSurface,
  rect: DeviceRect,
): void {
  if (rect.w <= 0 || rect.h <= 0) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(surface, 0, 0, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

/**
 * Draws all of `image` scaled onto a user-space rect snapped to whole device
 * pixels, so images laid edge to edge — ground chunks, per-tile water — meet
 * with no hairline at any canvas scale or camera zoom. `m` is `ctx`'s current
 * transform; the context is left with it.
 */
export function drawImageSnapped(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  x: number,
  y: number,
  w: number,
  h: number,
  m: DOMMatrix = ctx.getTransform(),
): void {
  const rect = snappedDeviceRect(ctx, x, y, w, h, m);
  if (rect.w <= 0 || rect.h <= 0) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h);
  ctx.setTransform(m);
}

/** `x` in `m`'s user space moved to the nearest whole device-pixel column. */
export function snapUserX(m: DOMMatrix, x: number): number {
  return (Math.round(m.a * x + m.e) - m.e) / m.a;
}

/** `y` in `m`'s user space moved to the nearest whole device-pixel row. */
export function snapUserY(m: DOMMatrix, y: number): number {
  return (Math.round(m.d * y + m.f) - m.f) / m.d;
}
