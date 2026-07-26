/**
 * Bakes town-prop art into offscreen canvases.
 *
 * The street props are painted from dozens of canvas path operations each, and
 * a lit street stands one lamp per nine tiles — so the same handful of pictures
 * were being replayed from scratch every frame. Their painters are pure
 * functions of a few parameters, so a caller that can name those parameters can
 * bake the result once and blit it thereafter.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../core/canvasSurface';

/** How far a prop's art reaches past its anchor tile's top-left corner, in px. */
export interface PropBakeBounds {
  left: number;
  up: number;
  right: number;
  down: number;
}

interface BakedProp {
  canvas: CanvasSurface;
  originX: number;
  originY: number;
}

const bakedProps = new Map<string, BakedProp>();

/**
 * Draws a prop through the bake cache, blitting its anchor tile's top-left
 * corner to (sx, sy).
 *
 * `key` must name everything `paint` varies on — kind, tile size, and any
 * quantized animation step — because a key collision silently shows the wrong
 * picture. `paint` receives the context and the position its anchor tile's
 * top-left sits at inside the bake canvas.
 */
export function drawBakedProp(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  key: string,
  bounds: PropBakeBounds,
  paint: (bakeCtx: CanvasRenderingContext2D, originX: number, originY: number) => void,
): void {
  let baked = bakedProps.get(key);
  if (baked === undefined) {
    const originX = Math.ceil(bounds.left);
    const originY = Math.ceil(bounds.up);
    const canvas = allocCanvas(
      Math.max(1, originX + Math.ceil(bounds.right)),
      Math.max(1, originY + Math.ceil(bounds.down)),
    );
    paint(surfaceContext(canvas), originX, originY);
    baked = { canvas, originX, originY };
    bakedProps.set(key, baked);
  }
  ctx.drawImage(baked.canvas, Math.round(sx - baked.originX), Math.round(sy - baked.originY));
}
