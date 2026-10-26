/**
 * Small offscreen caches for creatures painted live rather than through the
 * figure cache, so a costly painter — `shadowBlur` above all, among the most
 * expensive Canvas2D operations on a phone — runs once per distinct pose
 * instead of once per body per frame.
 *
 * A cell is painted at the destination's own device pixels per world pixel,
 * so it blits 1:1 and a `shadowBlur`, which is measured in device pixels
 * whatever the transform, comes out the same size it would painted live. The
 * scale is part of each cell's key, so a change of render scale paints fresh
 * cells and the old ones age out. Cells are blitted mirrored for a body
 * facing west, the way the painters themselves flip. Every cell is
 * dropped when the canvases are rebuilt (`canvasGeneration`), since its pixels
 * may be gone.
 */

import {
  allocCanvas,
  CanvasContextUnavailableError,
  surfaceContext,
  type CanvasSurface,
  releaseSurface,
} from '../core/rendering/canvasSurface';
import { canvasGeneration, reportCanvasAllocationFailure } from '../core/rendering/canvasRecovery';

/**
 * Steps per unit the bake scale is rounded to, so a canvas whose backing store
 * rounds to a hair off a whole scale does not paint a new set of cells.
 */
const BAKE_SCALE_STEPS_PER_UNIT = 4;
/** The least a cell is baked at, so a shrunken view still gets a usable cell. */
const MIN_BAKE_SCALE = 1;

/** Device pixels per world pixel on `ctx`, rounded to a step. */
function bakeScaleOf(ctx: CanvasRenderingContext2D): number {
  const transform = ctx.getTransform();
  const deviceScale = Math.hypot(transform.a, transform.b);
  const stepped = Math.round(deviceScale * BAKE_SCALE_STEPS_PER_UNIT) / BAKE_SCALE_STEPS_PER_UNIT;
  return Math.max(MIN_BAKE_SCALE, stepped);
}

/** The rectangle a cell covers, in world pixels from the point it is anchored at. */
export interface CellBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export class PaintedCellCache {
  private readonly cells = new Map<string, CanvasSurface>();
  private generation = canvasGeneration();

  /** @param limit The most cells kept; the least recently drawn go first past it. */
  constructor(private readonly limit: number) {}

  /**
   * Blits cell `key` with its anchor at (`anchorX`, `anchorY`), painting it
   * first if it is not held: `paint` draws into a context whose origin is the
   * anchor, in world pixels, facing east. Returns false when no cell could be
   * made (the browser's canvas memory is spent), so the caller paints live.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    key: string,
    anchorX: number,
    anchorY: number,
    box: CellBox,
    mirrored: boolean,
    paint: (cellCtx: CanvasRenderingContext2D) => void,
  ): boolean {
    const bakeScale = bakeScaleOf(ctx);
    const cell = this.cellFor(`${bakeScale}|${key}`, bakeScale, box, paint);
    if (cell === null) return false;
    ctx.save();
    ctx.translate(anchorX, anchorY);
    if (mirrored) ctx.scale(-1, 1);
    ctx.drawImage(cell, box.left, box.top, box.width, box.height);
    ctx.restore();
    return true;
  }

  private cellFor(
    key: string,
    bakeScale: number,
    box: CellBox,
    paint: (cellCtx: CanvasRenderingContext2D) => void,
  ): CanvasSurface | null {
    this.syncCanvasGeneration();
    const held = this.cells.get(key);
    if (held !== undefined) {
      // Re-inserted so the map's order is least recently drawn first.
      this.cells.delete(key);
      this.cells.set(key, held);
      return held;
    }
    const surface = allocCanvas(
      'paintedCells',
      Math.max(1, Math.ceil(box.width * bakeScale)),
      Math.max(1, Math.ceil(box.height * bakeScale)),
    );
    try {
      const cellCtx = surfaceContext(surface);
      cellCtx.scale(bakeScale, bakeScale);
      cellCtx.translate(-box.left, -box.top);
      paint(cellCtx);
    } catch (error) {
      releaseSurface(surface);
      if (!(error instanceof CanvasContextUnavailableError)) throw error;
      reportCanvasAllocationFailure();
      return null;
    }
    this.cells.set(key, surface);
    this.evictPastLimit();
    return surface;
  }

  private evictPastLimit(): void {
    while (this.cells.size > this.limit) {
      const oldest = this.cells.entries().next();
      if (oldest.done === true) return;
      const [key, surface] = oldest.value;
      releaseSurface(surface);
      this.cells.delete(key);
    }
  }

  private syncCanvasGeneration(): void {
    const current = canvasGeneration();
    if (this.generation === current) return;
    this.generation = current;
    for (const surface of this.cells.values()) releaseSurface(surface);
    this.cells.clear();
  }
}
