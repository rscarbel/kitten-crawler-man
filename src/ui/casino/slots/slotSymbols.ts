/**
 * The slot machine's reel symbols, baked once per size.
 *
 * Reels scroll every frame, so a symbol is never painted where it is shown:
 * each one is baked to an offscreen canvas at the cell's device-pixel size,
 * with a second, vertically smeared copy the reels show while they spin. The
 * reels only ever blit. The caches are dropped through `onCanvasRecovery`,
 * since a canvas the browser purged would otherwise stay blank for good.
 */

import {
  allocCanvas,
  releaseSurface,
  surfaceContext,
  type CanvasSurface,
} from '../../../core/rendering/canvasSurface';
import { onCanvasRecovery } from '../../../core/rendering/canvasRecovery';
import { paintSlotSymbol } from '../../../sprites/art/slotSymbolArt';
import type { SlotSymbol } from '../../../systems/casino/slots/slotSymbols';

export { paintSlotSymbol };

export type SymbolVariant = 'sharp' | 'blur';

const HALF = 0.5;

/** Copies stacked for the motion smear, and how far they spread as a fraction of the cell's height. */
const BLUR_COPIES = 15;
const BLUR_SPREAD = 0.7;
/** The smear is a little washed out, as a spinning reel is. */
const BLUR_ALPHA = 0.9;

/** Distinct sizes kept; a resize past this many drops the oldest bakes. */
const MAX_BAKED_SIZES = 6;

const cache = new Map<string, CanvasSurface>();
/**
 * When each bake last failed. A refused canvas (the browser's canvas memory
 * running out) is usually temporary, so a failure is retried after a short
 * rest rather than remembered for good, which would leave that symbol
 * repainted as vectors every frame.
 */
const failedAt = new Map<string, number>();
/** How long a failed bake rests before it is tried again. */
const BAKE_RETRY_MS = 1000;
const bakedSizes: string[] = [];
onCanvasRecovery(() => {
  for (const surface of cache.values()) releaseSurface(surface);
  cache.clear();
  failedAt.clear();
  bakedSizes.length = 0;
});

function bake(symbol: SlotSymbol, pxW: number, pxH: number): CanvasSurface | null {
  let surface: CanvasSurface | null = null;
  try {
    surface = allocCanvas('casino', pxW, pxH);
    paintSlotSymbol(surfaceContext(surface), symbol, 0, 0, pxW, pxH);
    return surface;
  } catch {
    if (surface !== null) releaseSurface(surface);
    return null;
  }
}

function smear(sharp: CanvasSurface, pxW: number, pxH: number): CanvasSurface | null {
  let surface: CanvasSurface | null = null;
  try {
    surface = allocCanvas('casino', pxW, pxH);
    const ctx = surfaceContext(surface);
    const spread = pxH * BLUR_SPREAD;
    const step = spread / (BLUR_COPIES - 1);
    ctx.globalAlpha = BLUR_ALPHA / ((BLUR_COPIES + 1) * HALF);
    for (let i = 0; i < BLUR_COPIES; i++) {
      ctx.drawImage(sharp, 0, -spread * HALF + i * step);
    }
    return surface;
  } catch {
    if (surface !== null) releaseSurface(surface);
    return null;
  }
}

/**
 * The baked art for `symbol` at a cell of `pxW` × `pxH` device pixels, or
 * null when the browser refused a canvas (the reel then paints the symbol
 * directly for that frame).
 */
export function bakedSymbol(
  symbol: SlotSymbol,
  variant: SymbolVariant,
  pxW: number,
  pxH: number,
): CanvasSurface | null {
  const w = Math.max(1, Math.round(pxW));
  const h = Math.max(1, Math.round(pxH));
  const sizeKey = `${w}x${h}`;
  const key = `${symbol}|${variant}|${sizeKey}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const now = performance.now();
  const lastFailure = failedAt.get(key);
  if (lastFailure !== undefined && now - lastFailure < BAKE_RETRY_MS) return null;
  if (!bakedSizes.includes(sizeKey)) {
    bakedSizes.push(sizeKey);
    if (bakedSizes.length > MAX_BAKED_SIZES) {
      const oldest = bakedSizes.shift();
      for (const [cachedKey, surface] of [...cache.entries()]) {
        if (oldest === undefined || !cachedKey.endsWith(`|${oldest}`)) continue;
        releaseSurface(surface);
        cache.delete(cachedKey);
      }
    }
  }
  let baked: CanvasSurface | null;
  if (variant === 'sharp') {
    baked = bake(symbol, w, h);
  } else {
    const sharp = bakedSymbol(symbol, 'sharp', w, h);
    baked = sharp === null ? null : smear(sharp, w, h);
  }
  if (baked === null) {
    failedAt.set(key, now);
    return null;
  }
  failedAt.delete(key);
  cache.set(key, baked);
  return baked;
}

/** How many symbol bakes are held, for the preview's cache readout. */
export function bakedSymbolCount(): number {
  return cache.size;
}
