/**
 * A full-screen layer the intro is painted into while it fades to the floor.
 *
 * The intro stacks its strokes, halos and glows on one another, so fading
 * each part on its own would show the parts through each other (a title's
 * halo through its own letters). Painting the whole intro opaque into this
 * layer and laying the layer over the floor at the fade's opacity fades it as
 * one picture.
 */

import {
  allocCanvas,
  releaseSurface,
  resizeSurface,
  surfaceContext,
  type CanvasSurface,
} from '../../../core/rendering/canvasSurface';
import { onCanvasRecovery } from '../../../core/rendering/canvasRecovery';

/** Every layer holding pixels, so a lost canvas drops them all to be allocated again. */
const holdingPixels = new Set<IntroFadeLayer>();
onCanvasRecovery(() => {
  for (const layer of holdingPixels) layer.release();
});

export class IntroFadeLayer {
  private surface: CanvasSurface | null = null;

  /**
   * Runs `paint` into the layer, under the same transform `ctx` has now, then
   * lays the layer over `ctx` at `opacity`.
   */
  paintFaded(
    ctx: CanvasRenderingContext2D,
    opacity: number,
    paint: (layer: CanvasRenderingContext2D) => void,
  ): void {
    const { width, height } = ctx.canvas;
    const surface = this.surfaceSized(width, height);
    let layer: CanvasRenderingContext2D;
    try {
      layer = surfaceContext(surface);
    } catch {
      // No layer to fade as one picture: the intro is still shown, its parts fading on their own.
      this.release();
      ctx.save();
      ctx.globalAlpha *= opacity;
      paint(ctx);
      ctx.restore();
      return;
    }
    layer.setTransform(1, 0, 0, 1, 0, 0);
    layer.clearRect(0, 0, width, height);
    layer.setTransform(ctx.getTransform());
    paint(layer);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha *= opacity;
    ctx.drawImage(surface, 0, 0);
    ctx.restore();
  }

  /** Gives the layer's pixels back; the next fade allocates again. */
  release(): void {
    if (this.surface === null) return;
    releaseSurface(this.surface);
    this.surface = null;
    holdingPixels.delete(this);
  }

  private surfaceSized(width: number, height: number): CanvasSurface {
    const surface = this.surface ?? allocCanvas('ui', width, height);
    if (surface.width !== width || surface.height !== height) {
      resizeSurface(surface, width, height);
    }
    this.surface = surface;
    holdingPixels.add(this);
    return surface;
  }
}
