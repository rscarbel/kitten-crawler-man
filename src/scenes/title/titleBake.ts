/**
 * A full-stage picture painted once and blitted every frame, for the title's
 * static art (the hall, the vault, the vignette).
 *
 * Baked lazily on the first frame drawn rather than in `layout()`, because only
 * a live context knows the ratio the scene is rendering at, and a hall baked at
 * one CSS pixel per pixel would be upscaled on every high-density screen. A new
 * size or ratio repaints once it has held for a moment; a canvas recovery bumps
 * the generation, and art lost to a purge is painted again on the next frame.
 */

import {
  allocCanvas,
  surfaceContext,
  type CanvasSurface,
  releaseSurface,
  resizeSurface,
} from '../../core/canvasSurface';
import { canvasGeneration } from '../../core/canvasRecovery';
import type { TitleStage } from './titleStage';

/** Above this, a bake costs more memory than the sharpness is worth on a full-screen layer. */
const MAX_BAKE_PIXEL_RATIO = 2;
const MIN_BAKE_PIXEL_RATIO = 1;

/** A ratio is rounded to this many steps per pixel, so float noise in a transform never reads as a new ratio. */
const RATIO_STEPS = 100;

/**
 * Bakes wait for a new size to hold this many frames before repainting — about
 * 200 ms at 60 fps — and blit the old bake stretched meanwhile, so dragging a
 * window edge repaints once rather than every frame. Counted in frames rather
 * than read from the clock, so a frozen moment still settles.
 */
const RESIZE_SETTLE_FRAMES = 12;

/**
 * The device pixels per CSS pixel `ctx` is drawing the stage at. `zoom` is the
 * camera zoom already applied to `ctx`, which is divided back out: the dive's
 * push-in magnifies the picture, it does not change the screen it is drawn on.
 */
export function pixelRatioOf(ctx: CanvasRenderingContext2D, zoom = 1): number {
  const { a, b } = ctx.getTransform();
  const ratio = Math.hypot(a, b) / Math.max(Number.EPSILON, zoom);
  const rounded = Math.round(ratio * RATIO_STEPS) / RATIO_STEPS;
  return Math.min(MAX_BAKE_PIXEL_RATIO, Math.max(MIN_BAKE_PIXEL_RATIO, rounded));
}

/**
 * Paints the plane in stage CSS pixels. The context is already scaled to the
 * bake's pixel ratio and shifted by the margin, so the stage's own top-left is
 * (0, 0) and the margin lies at negative coordinates and past the far edges.
 */
export type TitlePlanePainter = (
  ctx: CanvasRenderingContext2D,
  stage: TitleStage,
  pixelRatio: number,
) => void;

export class TitleBakedPlane {
  private canvas: CanvasSurface | null = null;
  private bakedKey = '';
  private bakedGeneration = -1;
  private pendingKey = '';
  private pendingFrames = 0;

  /**
   * @param marginPx How far past each edge of the stage the bake reaches, so a
   *   plane shifted by the camera's drift and shake never shows its edge.
   * @param resolution A share of the pixel ratio to bake at; below 1 for soft
   *   art (a blur, a vignette) that upscales without loss.
   */
  constructor(
    private readonly paint: TitlePlanePainter,
    private readonly marginPx: number,
    private readonly resolution = 1,
  ) {}

  /** Forgets the bake, so the next draw paints it again. */
  invalidate(): void {
    this.bakedKey = '';
  }

  /**
   * Draws the plane over the stage, baking it first if anything it depends on
   * has changed. `zoom` is the camera zoom already applied to `ctx`.
   */
  draw(ctx: CanvasRenderingContext2D, stage: TitleStage, zoom = 1): void {
    const canvas = this.bakedFor(ctx, stage, zoom);
    const margin = this.marginPx;
    ctx.drawImage(canvas, -margin, -margin, stage.width + margin * 2, stage.height + margin * 2);
  }

  dispose(): void {
    if (this.canvas !== null) {
      releaseSurface(this.canvas);
    }
    this.canvas = null;
    this.bakedKey = '';
  }

  private bakedFor(ctx: CanvasRenderingContext2D, stage: TitleStage, zoom: number): CanvasSurface {
    const ratio = pixelRatioOf(ctx, zoom) * this.resolution;
    const key = `${stage.width}x${stage.height}@${ratio}`;
    const generation = canvasGeneration();
    const existing = this.canvas;
    // Lost pixels are repainted at once; only a bake that is merely the wrong size waits.
    if (existing !== null && generation === this.bakedGeneration) {
      if (key === this.bakedKey) {
        this.pendingKey = '';
        return existing;
      }
      if (key !== this.pendingKey) {
        this.pendingKey = key;
        this.pendingFrames = 0;
      }
      this.pendingFrames += 1;
      if (this.pendingFrames < RESIZE_SETTLE_FRAMES) return existing;
    }

    const margin = this.marginPx;
    const pixelWidth = Math.ceil((stage.width + margin * 2) * ratio);
    const pixelHeight = Math.ceil((stage.height + margin * 2) * ratio);
    const canvas = existing ?? allocCanvas('title', pixelWidth, pixelHeight);
    resizeSurface(canvas, pixelWidth, pixelHeight);
    const bakeCtx = surfaceContext(canvas);
    bakeCtx.setTransform(ratio, 0, 0, ratio, margin * ratio, margin * ratio);
    this.paint(bakeCtx, stage, ratio);
    this.canvas = canvas;
    this.bakedKey = key;
    this.bakedGeneration = generation;
    this.pendingKey = '';
    return canvas;
  }
}
