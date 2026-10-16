/**
 * Carl and Donut painted at the density the title actually shows them at.
 *
 * The shared figure cache bakes every figure at one density (64 cell pixels a
 * tile, half that on a one-to-one screen), which suits a floor full of
 * creatures drawn a tile or two across and is soft for two figures standing
 * several times that size. The title shows a handful of rows, so it keeps its
 * own cells, painted by the figures' own painters at the screen's density and
 * cropped to the box their art reaches.
 *
 * A cell costs a large share of a frame to paint (Donut's painter most of
 * all, whatever the density), so rows asked for ahead of their showing are
 * baked in the browser's idle time between frames, one cell per idle period
 * that has room for it. Where there is no idle callback (a review render) the
 * queue is paced instead: one cell a frame, resting after a slow one. A draw
 * bakes on the spot only the first cell of a row nothing has baked yet; any
 * other cell not baked yet is not drawn here, and the caller falls back to the
 * shared cache, so a figure is soft for a moment, never missing.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../../core/canvasSurface';
import { canvasGeneration } from '../../core/canvasRecovery';
import type { FigureDef } from '../../sprites/figure/figureDef';
import { figureFrameCount } from '../../sprites/figure/figureDef';
import { BYTES_PER_MEGABYTE } from '../../sprites/figure/figureCacheStats';

/** Where a figure's art can reach inside its cell, in its own cell pixels. */
export interface HeroCellCrop {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Densities are rounded up to a step of this, so a resize of a few pixels
 * reuses the cells it has rather than painting them all again.
 */
const DENSITY_STEP = 0.5;
/**
 * The densest a cell is painted, in device pixels per cell pixel. Past it a
 * cell is upscaled a little on a huge display, which keeps memory bounded
 * whatever the screen: a full set of rows at this density is about 50 MB.
 */
const MAX_DENSITY = 4;
/**
 * What the cells may hold. The idle rows of both heroes and one gesture row
 * each fit with room to spare; an older gesture row is let go to make room.
 */
const HERO_CELL_BUDGET_MEGABYTES = 32;
const HERO_CELL_BUDGET_BYTES = HERO_CELL_BUDGET_MEGABYTES * BYTES_PER_MEGABYTE;
const BYTES_PER_PIXEL = 4;
/** The paced queue's share of a frame, averaged over the frames it rests after a slow bake. */
const HERO_BAKE_BUDGET_MS = 4;
/** What a cell is expected to cost before one of that figure has been timed. */
const UNMEASURED_BAKE_MS = 12;
/** An idle period this long overdue bakes anyway, so a busy device still warms its rows. */
const IDLE_BAKE_TIMEOUT_MS = 400;

interface HeroRow {
  readonly def: FigureDef;
  readonly state: string;
  readonly density: number;
  readonly cells: Map<number, CanvasSurface>;
  lastUsed: number;
}

function rowKey(def: FigureDef, state: string): string {
  return `${def.id}|${state}`;
}

function cellBytes(surface: CanvasSurface): number {
  return surface.width * surface.height * BYTES_PER_PIXEL;
}

const clockMs = (): number => performance.now();

export class TitleHeroCells {
  private readonly rows = new Map<string, HeroRow>();
  private readonly queue: { def: FigureDef; state: string }[] = [];
  private bytes = 0;
  private frame = 0;
  private bakedThisFrame = false;
  private restFrames = 0;
  private lastBakeMs = 0;
  private bakedInGeneration = canvasGeneration();
  private readonly bakeMsByFigure = new Map<string, number>();
  private idleHandle: number | null = null;
  private density: (def: FigureDef) => number = () => 1;

  constructor(private readonly cropOf: (def: FigureDef) => HeroCellCrop) {}

  /** The density cells are painted at for a figure drawn `tileSize` CSS pixels a tile on `pixelRatio` device pixels each. */
  static densityFor(def: FigureDef, tileSize: number, pixelRatio: number): number {
    const exact = (tileSize / def.tileScale) * pixelRatio;
    return Math.min(MAX_DENSITY, Math.ceil(exact / DENSITY_STEP) * DENSITY_STEP);
  }

  /**
   * Call once at the top of each render, before any draw. Returns true when a
   * canvas recovery dropped every cell and every queued row since the last
   * frame.
   */
  beginFrame(): boolean {
    this.frame++;
    this.bakedThisFrame = false;
    return this.dropIfRecovered();
  }

  /**
   * After a canvas recovery (a purged background tab, a lost GPU context, memory
   * pressure) every cell may be blank yet still blit as if it were whole, which
   * would hide the heroes rather than fall back. Lets everything go; returns
   * whether it did, so the caller can ask for its rows again.
   */
  private dropIfRecovered(): boolean {
    const generation = canvasGeneration();
    if (generation === this.bakedInGeneration) return false;
    this.clear();
    this.bakedInGeneration = generation;
    return true;
  }

  private clear(): void {
    if (this.idleHandle !== null) globalThis.cancelIdleCallback(this.idleHandle);
    this.idleHandle = null;
    this.rows.clear();
    this.queue.length = 0;
    this.bytes = 0;
  }

  /** Asks for a whole row ahead of its showing, baked a cell at a time by {@link bakeQueued}. */
  request(def: FigureDef, state: string): void {
    if (this.queue.some((queued) => queued.def === def && queued.state === state)) return;
    this.queue.push({ def, state });
  }

  /**
   * Bakes what was asked for ahead: in the next idle period with room for a
   * cell where the browser offers one, or as this frame's paced bake where it
   * does not. `density` says what each figure's cells are painted at.
   */
  bakeQueued(density: (def: FigureDef) => number): void {
    this.density = density;
    if (typeof globalThis.requestIdleCallback === 'function') {
      this.scheduleIdleBake();
      return;
    }
    if (this.bakedThisFrame) return;
    if (this.restFrames > 0) {
      this.restFrames--;
      return;
    }
    const next = this.nextQueuedCell();
    if (next === null) return;
    this.bake(next.row, next.frame);
    this.restFrames = Math.max(0, Math.ceil(this.lastBakeMs / HERO_BAKE_BUDGET_MS) - 1);
  }

  private scheduleIdleBake(): void {
    if (this.idleHandle !== null || this.queue.length === 0) return;
    this.idleHandle = globalThis.requestIdleCallback(
      (deadline) => {
        this.idleHandle = null;
        // The next frame's `beginFrame` clears and asks for the rows again.
        if (canvasGeneration() !== this.bakedInGeneration) return;
        const next = this.nextQueuedCell();
        if (next === null) return;
        const expectedMs = this.bakeMsByFigure.get(next.row.def.id) ?? UNMEASURED_BAKE_MS;
        if (deadline.didTimeout || deadline.timeRemaining() >= expectedMs) {
          this.bake(next.row, next.frame);
        }
        this.scheduleIdleBake();
      },
      { timeout: IDLE_BAKE_TIMEOUT_MS },
    );
  }

  /** The first cell the queue still owes, dropping rows it has finished. */
  private nextQueuedCell(): { row: HeroRow; frame: number } | null {
    while (this.queue.length > 0) {
      const next = this.queue[0];
      const row = this.rowFor(next.def, next.state, this.density(next.def));
      const frames = figureFrameCount(next.def, next.state);
      for (let frame = 0; frame < frames; frame++) {
        if (!row.cells.has(frame)) return { row, frame };
      }
      this.queue.shift();
    }
    return null;
  }

  /**
   * Blits one frame with its tile's top-left at (x, y), as the shared cache
   * places a cell, baking it first when it would be the row's first and
   * nothing else has baked this frame. Returns false when the frame is not
   * ready, for the caller to draw it another way.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    def: FigureDef,
    state: string,
    frame: number,
    x: number,
    y: number,
    tileSize: number,
    density: number,
  ): boolean {
    const row = this.rowFor(def, state, density);
    row.lastUsed = this.frame;
    let cell = row.cells.get(frame);
    if (cell === undefined) {
      if (this.bakedThisFrame || row.cells.size > 0) {
        this.request(def, state);
        return false;
      }
      cell = this.bake(row, frame);
      if (cell === undefined) return false;
    }
    const scale = tileSize / def.tileScale;
    const crop = this.cropOf(def);
    ctx.drawImage(
      cell,
      x + (crop.left - def.tileX) * scale,
      y + (crop.top - def.tileY) * scale,
      crop.width * scale,
      crop.height * scale,
    );
    return true;
  }

  dispose(): void {
    this.clear();
  }

  private rowFor(def: FigureDef, state: string, density: number): HeroRow {
    const key = rowKey(def, state);
    const existing = this.rows.get(key);
    if (existing?.density === density) return existing;
    if (existing !== undefined) this.release(key, existing);
    const row: HeroRow = { def, state, density, cells: new Map(), lastUsed: this.frame };
    this.rows.set(key, row);
    return row;
  }

  private release(key: string, row: HeroRow): void {
    for (const cell of row.cells.values()) this.bytes -= cellBytes(cell);
    this.rows.delete(key);
  }

  private bake(row: HeroRow, frame: number): CanvasSurface | undefined {
    const frames = figureFrameCount(row.def, row.state);
    if (frame < 0 || frame >= frames) return undefined;
    const crop = this.cropOf(row.def);
    const width = Math.max(1, Math.ceil(crop.width * row.density));
    const height = Math.max(1, Math.ceil(crop.height * row.density));
    this.makeRoom(width * height * BYTES_PER_PIXEL, row);
    const startedMs = clockMs();
    const cell = allocCanvas(width, height);
    const ctx = surfaceContext(cell);
    ctx.setTransform(
      row.density,
      0,
      0,
      row.density,
      -crop.left * row.density,
      -crop.top * row.density,
    );
    row.def.paintFrame(ctx, row.state, frame);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    row.cells.set(frame, cell);
    this.bytes += cellBytes(cell);
    this.bakedThisFrame = true;
    this.lastBakeMs = clockMs() - startedMs;
    this.bakeMsByFigure.set(row.def.id, this.lastBakeMs);
    return cell;
  }

  /** Lets go of the least recently drawn rows, never `keep`, until `incoming` more bytes fit. */
  private makeRoom(incoming: number, keep: HeroRow): void {
    while (this.bytes + incoming > HERO_CELL_BUDGET_BYTES) {
      let oldest: [string, HeroRow] | null = null;
      for (const entry of this.rows) {
        if (entry[1] === keep || entry[1].cells.size === 0) continue;
        if (oldest === null || entry[1].lastUsed < oldest[1].lastUsed) oldest = entry;
      }
      if (oldest === null) return;
      this.release(oldest[0], oldest[1]);
    }
  }
}
