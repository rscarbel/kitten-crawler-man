import type { SpriteDef, SpriteStateDef } from './SpriteLoader';
import { allocCanvas, surfaceContext } from './canvasSurface';

/**
 * Resolve the sheet-pixel origin (srcX, srcY) of a frame, wrapping onto
 * subsequent rows once `colsPerRow` is exceeded (see SpriteStateDef.colsPerRow).
 */
export function frameOrigin(
  stateDef: SpriteStateDef,
  frameWidth: number,
  frameHeight: number,
  clampedFrame: number,
): { srcX: number; srcY: number } {
  const colOffset = stateDef.colOffset ?? 0;
  const totalCol = colOffset + clampedFrame;
  if (stateDef.colsPerRow === undefined) {
    return { srcX: totalCol * frameWidth, srcY: stateDef.row * frameHeight };
  }
  const row = stateDef.row + Math.floor(totalCol / stateDef.colsPerRow);
  const col = totalCol % stateDef.colsPerRow;
  return { srcX: col * frameWidth, srcY: row * frameHeight };
}

/** Where a frame's actual drawn pixels sit inside its cell, in source pixels. */
export interface FrameInkBounds {
  /** Centre of the frame's opaque pixels, measured from the cell's top-left. */
  readonly centerX: number;
  readonly centerY: number;
  /** Distance from that centre to the furthest opaque pixel. */
  readonly radius: number;
}

/** Alpha at or below which a pixel is treated as empty rather than as ink. */
const EMPTY_ALPHA_CUTOFF = 8;
const RGBA_STRIDE = 4;
const ALPHA_CHANNEL_OFFSET = 3;
/** Half of a pixel, so a bounding box spans whole pixels rather than their corners. */
const HALF_PIXEL = 0.5;

const inkBoundsBySheet = new WeakMap<
  HTMLImageElement | HTMLCanvasElement,
  Map<number, FrameInkBounds>
>();

function measureInkBounds(
  img: HTMLImageElement | HTMLCanvasElement,
  srcX: number,
  srcY: number,
  frameWidth: number,
  frameHeight: number,
): FrameInkBounds {
  const wholeCell: FrameInkBounds = {
    centerX: frameWidth / 2,
    centerY: frameHeight / 2,
    radius: Math.hypot(frameWidth, frameHeight) / 2,
  };

  const surface = allocCanvas(frameWidth, frameHeight);
  const ctx = surfaceContext(surface);
  // `surface.width`/`.height` are what the canvas actually allocated — a canvas
  // dimension is a whole number, so a fractional `frameWidth` (Phase 8's
  // low-end downscale can halve an odd source width, e.g. 65 → 32.5) gets
  // truncated here. The pixel buffer below is laid out on THAT integer stride,
  // not on `frameWidth` — indexing with the fractional value would misalign
  // every row after the first, so every stride/loop-bound uses `w`/`h` instead.
  const w = surface.width;
  const h = surface.height;
  ctx.drawImage(img, srcX, srcY, frameWidth, frameHeight, 0, 0, w, h);

  let pixels: Uint8ClampedArray;
  try {
    pixels = ctx.getImageData(0, 0, w, h).data;
  } catch {
    // A sheet served from a foreign origin taints the surface; the cell centre
    // is the only honest answer left, and it is what the old code assumed.
    return wholeCell;
  }

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const alpha = pixels[(y * w + x) * RGBA_STRIDE + ALPHA_CHANNEL_OFFSET];
      if (alpha <= EMPTY_ALPHA_CUTOFF) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return wholeCell;

  const centerX = (minX + maxX + 1) / 2;
  const centerY = (minY + maxY + 1) / 2;

  let radiusSq = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const alpha = pixels[(y * w + x) * RGBA_STRIDE + ALPHA_CHANNEL_OFFSET];
      if (alpha <= EMPTY_ALPHA_CUTOFF) continue;
      const dx = x + HALF_PIXEL - centerX;
      const dy = y + HALF_PIXEL - centerY;
      const distSq = dx * dx + dy * dy;
      if (distSq > radiusSq) radiusSq = distSq;
    }
  }

  return { centerX, centerY, radius: Math.sqrt(radiusSq) };
}

/**
 * Where a frame's ink actually sits inside its cell.
 *
 * A sheet's cell is sized for its widest pose and its `tileX`/`tileY` anchor
 * describes a standing creature, so neither says anything useful about a lone
 * severed arm parked in a corner of that cell. Anything that has to place a
 * frame by its visible pixels — spinning it in place, keeping it clear of a
 * wall — needs the measured ink instead, so it is measured off the sheet once
 * and cached per frame.
 */
export function getFrameInkBounds(
  def: SpriteDef,
  stateDef: SpriteStateDef,
  frame: number,
): FrameInkBounds {
  const { img, frameWidth, frameHeight } = def;
  const { srcX, srcY } = frameOrigin(stateDef, frameWidth, frameHeight, frame);

  let bySheetFrame = inkBoundsBySheet.get(img);
  if (bySheetFrame === undefined) {
    bySheetFrame = new Map<number, FrameInkBounds>();
    inkBoundsBySheet.set(img, bySheetFrame);
  }
  // A settled gore field re-reads this every frame, so the key is arithmetic on
  // the frame's sheet position rather than a string built per lookup.
  const cacheKey = srcY * img.width + srcX;
  const cached = bySheetFrame.get(cacheKey);
  if (cached !== undefined) return cached;

  const measured = measureInkBounds(img, srcX, srcY, frameWidth, frameHeight);
  bySheetFrame.set(cacheKey, measured);
  return measured;
}
