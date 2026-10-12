/**
 * A small least-recently-used cache of painted bitmaps, for the parts of Deuce
 * that do not change from one frame to the next.
 *
 * A part is painted once into a detached canvas at the *device* resolution it
 * is about to be shown at, then blitted. Painting at device resolution matters:
 * every line weight in Deuce's painters is set in device pixels by reading the
 * context's transform, so the cached bitmap is pixel-for-pixel what painting
 * straight into the frame would have produced. The size in device pixels is
 * part of every key, so a resized panel paints fresh entries and the old ones
 * age out.
 */

import { allocCanvas, type CanvasSurface, surfaceContext } from '../../../core/canvasSurface';
import { type Ctx } from './paint';

export interface CacheBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A context's scale from current units to device pixels. */
function deviceScale(ctx: Ctx): number {
  const m = ctx.getTransform();
  return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
}

export class BitmapCache {
  private readonly entries = new Map<string, CanvasSurface>();

  constructor(private readonly capacity: number) {}

  /**
   * Draws the bitmap for `key` into `box` (current units), painting it with
   * `paint` first if it is not cached. `paint` draws in the same units as the
   * caller, as if straight into `ctx`.
   */
  draw(ctx: Ctx, key: string, box: CacheBox, paint: (target: Ctx) => void): void {
    const scale = deviceScale(ctx);
    const width = Math.max(1, Math.ceil(box.w * scale));
    const height = Math.max(1, Math.ceil(box.h * scale));
    const fullKey = `${key}|${width}x${height}`;
    let surface = this.entries.get(fullKey);
    if (surface === undefined) {
      surface = allocCanvas(width, height);
      const target = surfaceContext(surface);
      target.scale(width / box.w, height / box.h);
      target.translate(-box.x, -box.y);
      paint(target);
      this.remember(fullKey, surface);
    } else {
      // Re-inserting moves the entry to the young end of the map's order.
      this.entries.delete(fullKey);
      this.entries.set(fullKey, surface);
    }
    ctx.drawImage(surface, box.x, box.y, box.w, box.h);
  }

  private remember(key: string, surface: CanvasSurface): void {
    this.entries.set(key, surface);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) return;
      const evicted = this.entries.get(oldest.value);
      this.entries.delete(oldest.value);
      if (evicted !== undefined) {
        // Shrinking the surface hands its pixels back straight away.
        evicted.width = 0;
        evicted.height = 0;
      }
    }
  }
}

/** Rounds `value` to a step so a slowly changing number reuses a handful of cache entries. */
export function quantize(value: number, step: number): number {
  return Math.round(value / step) * step;
}
