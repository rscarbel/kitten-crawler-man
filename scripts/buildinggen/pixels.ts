/**
 * Per-pixel access shared by the texture, lighting and gate passes.
 *
 * Canvas primitives cover flat fills and gradients; everything that has to read
 * what is already there — grain that modulates the material under it, an outline
 * that follows a silhouette, a gate that measures local contrast — needs the
 * buffer. Centralising the read/write pair keeps the alpha convention in one
 * place: a pass may darken or tint an opaque pixel, but only the silhouette
 * passes may turn a transparent pixel opaque.
 */

import type { Canvas, CanvasRenderingContext2D as NodeCtx } from 'canvas';

export const CHANNELS = 4;
export const RED = 0;
export const GREEN = 1;
export const BLUE = 2;
export const ALPHA = 3;

export interface PixelBuffer {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

export function readPixels(ctx: NodeCtx, width: number, height: number): PixelBuffer {
  const image = ctx.getImageData(0, 0, width, height);
  return { data: image.data, width, height };
}

export function writePixels(ctx: NodeCtx, buffer: PixelBuffer): void {
  const image = ctx.createImageData(buffer.width, buffer.height);
  image.data.set(buffer.data);
  ctx.putImageData(image, 0, 0);
}

export function readCanvas(canvas: Canvas): PixelBuffer {
  return readPixels(canvas.getContext('2d'), canvas.width, canvas.height);
}

export function pixelIndex(buffer: PixelBuffer, x: number, y: number): number {
  return (y * buffer.width + x) * CHANNELS;
}

const LUMA_RED = 0.299;
const LUMA_GREEN = 0.587;
const LUMA_BLUE = 0.114;

export function pixelLuminance(buffer: PixelBuffer, index: number): number {
  return (
    buffer.data[index + RED] * LUMA_RED +
    buffer.data[index + GREEN] * LUMA_GREEN +
    buffer.data[index + BLUE] * LUMA_BLUE
  );
}

/** Alpha above which a pixel counts as part of the building rather than its fringe. */
export const OPAQUE_THRESHOLD = 128;

export function isOpaque(buffer: PixelBuffer, index: number): boolean {
  return buffer.data[index + ALPHA] >= OPAQUE_THRESHOLD;
}

/**
 * Multiplies a pixel's colour, leaving its alpha alone.
 *
 * Shading is a multiply rather than a translucent black overlay because the
 * overlay approach is what makes the circus tents read as flat: a black
 * rectangle at 20% alpha over a flat fill is still a flat fill, whereas a
 * multiply preserves whatever variation the material put there.
 */
export function multiplyPixel(buffer: PixelBuffer, index: number, factor: number): void {
  buffer.data[index + RED] *= factor;
  buffer.data[index + GREEN] *= factor;
  buffer.data[index + BLUE] *= factor;
}

/**
 * Adds a signed value to every channel, leaving alpha alone.
 *
 * The counterpart to `multiplyPixel`, and the only way a dark material gets
 * texture: a multiply scales its variation down with its own value, so the
 * darker a surface is the flatter a multiplicative pass leaves it.
 */
export function offsetPixel(buffer: PixelBuffer, index: number, delta: number): void {
  buffer.data[index + RED] += delta;
  buffer.data[index + GREEN] += delta;
  buffer.data[index + BLUE] += delta;
}

/** Mixes a pixel toward a colour by `t`, leaving its alpha alone. */
export function tintPixel(
  buffer: PixelBuffer,
  index: number,
  color: readonly [number, number, number],
  t: number,
): void {
  buffer.data[index + RED] += (color[0] - buffer.data[index + RED]) * t;
  buffer.data[index + GREEN] += (color[1] - buffer.data[index + GREEN]) * t;
  buffer.data[index + BLUE] += (color[2] - buffer.data[index + BLUE]) * t;
}
