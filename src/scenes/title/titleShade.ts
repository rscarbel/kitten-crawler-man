/**
 * Draws figures as if a share of the light had not reached them. The hall's
 * darkness lies behind the cast, so a figure standing in shadow has to darken
 * itself: painted into a scratch surface, tinted on its own pixels only, then
 * blitted back. Lowering alpha instead would let the wall show through.
 *
 * The scratch is laid on the target's own device-pixel grid and blitted back
 * one pixel to one, so a shaded figure is exactly as sharp as an unshaded one:
 * a blit at the camera's fractional offset would resample it once more.
 */

import {
  allocCanvas,
  releaseSurface,
  surfaceContext,
  type CanvasSurface,
} from '../../core/canvasSurface';
import type { Rect } from '../../ui/core/geom';

/** Below this much shade the tint is invisible, so the figure is drawn straight. */
const SHADE_EPSILON = 0.01;

export class TitleShadeBuffer {
  private surface: CanvasSurface | null = null;

  /**
   * Runs `paint` (which draws in the same coordinates as `ctx`) clipped to
   * `box`, with `shade` (0 none, 1 solid) of `ink` laid over what it drew.
   * `ctx` may be scaled and translated but not rotated.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    box: Rect,
    shade: number,
    ink: string,
    paint: (target: CanvasRenderingContext2D) => void,
  ): void {
    if (shade < SHADE_EPSILON) {
      paint(ctx);
      return;
    }
    const transform = ctx.getTransform();
    const left = Math.floor(transform.a * box.x + transform.e);
    const top = Math.floor(transform.d * box.y + transform.f);
    const right = Math.ceil(transform.a * (box.x + box.w) + transform.e);
    const bottom = Math.ceil(transform.d * (box.y + box.h) + transform.f);
    const width = Math.max(1, right - left);
    const height = Math.max(1, bottom - top);
    const surface = this.surfaceAtLeast(width, height);
    const scratch = surfaceContext(surface);
    scratch.setTransform(1, 0, 0, 1, 0, 0);
    scratch.globalCompositeOperation = 'source-over';
    scratch.globalAlpha = 1;
    scratch.clearRect(0, 0, width, height);
    scratch.setTransform(
      transform.a,
      transform.b,
      transform.c,
      transform.d,
      transform.e - left,
      transform.f - top,
    );
    paint(scratch);
    scratch.setTransform(1, 0, 0, 1, 0, 0);
    scratch.globalCompositeOperation = 'source-atop';
    scratch.globalAlpha = Math.min(1, shade);
    scratch.fillStyle = ink;
    scratch.fillRect(0, 0, width, height);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(surface, 0, 0, width, height, left, top, width, height);
    ctx.restore();
  }

  dispose(): void {
    if (this.surface !== null) releaseSurface(this.surface);
    this.surface = null;
  }

  private surfaceAtLeast(width: number, height: number): CanvasSurface {
    const current = this.surface;
    if (current !== null && current.width >= width && current.height >= height) return current;
    const grown = allocCanvas(
      'title',
      Math.max(width, current?.width ?? 0),
      Math.max(height, current?.height ?? 0),
    );
    // No paint callback draws through the buffer it is painting for, so the
    // smaller surface is never still in use when it is outgrown.
    if (current !== null) releaseSurface(current);
    this.surface = grown;
    return grown;
  }
}
