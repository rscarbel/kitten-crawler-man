/**
 * The two crawlers painted at the density the title actually shows them at.
 *
 * The shared figure cache bakes every figure at one density (64 cell pixels a
 * tile, half that on a one-to-one screen), which suits a floor full of
 * creatures drawn a tile or two across and is soft for two figures standing
 * several times that size. The title shows a handful of rows, so it keeps its
 * own cells, painted by the figures' own painters at the screen's density and
 * cropped to the box their art reaches.
 *
 * Every frame a hero shows comes from one of these cells, never from the
 * shared cache: mixing the two flickers between sharp and soft from one frame
 * of a row to the next. A draw of a cell not baked yet bakes it on the spot,
 * so the rows a hero always shows (the resident rows) are held whole, and a
 * gesture is asked for ahead and played only once its row {@link isReady}.
 *
 * A cell costs a large share of a frame to paint (the cat's painter most of
 * all, whatever the density), so rows asked for ahead of their showing are
 * baked in the browser's idle time between frames, one cell per idle period
 * that has room for it, or in the next idle period whatever its room once the
 * queue has waited too long. Where there is no idle callback (Safari, a review
 * render) the queue is paced instead: one cell a frame, resting after a slow one.
 */

import {
  allocCanvas,
  releaseSurface,
  surfaceContext,
  type CanvasSurface,
} from '../../core/rendering/canvasSurface';
import { canvasGeneration } from '../../core/rendering/canvasRecovery';
import type { FigureDef } from '../../sprites/figure/figureDef';
import { figureFrameCount } from '../../sprites/figure/figureDef';
import { BYTES_PER_MEGABYTE } from '../../core/rendering/canvasSurface';

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
 * whatever the screen: a full set of rows at this density is about 55 MB.
 */
const MAX_DENSITY = 5;
/**
 * What the cells may hold. The resident rows of both heroes and one gesture
 * row each fit with room to spare; an older gesture row is let go to make room.
 */
const HERO_CELL_BUDGET_MEGABYTES = 32;
const HERO_CELL_BUDGET_BYTES = HERO_CELL_BUDGET_MEGABYTES * BYTES_PER_MEGABYTE;
const BYTES_PER_PIXEL = 4;
/** The paced queue's share of a frame, averaged over the frames it rests after a slow bake. */
const HERO_BAKE_BUDGET_MS = 4;
/** What a cell is expected to cost before one of that figure has been timed. */
const UNMEASURED_BAKE_MS = 12;
/**
 * A queue that has gone this long without a bake bakes in the next idle period
 * whatever room it offers. A browser offers an idle period between nearly
 * every pair of frames, each shorter than a cell costs on a busy or
 * high-refresh screen, so waiting for one with room would never bake at all.
 */
export const IDLE_BAKE_TIMEOUT_MS = 400;

interface HeroRow {
  readonly def: FigureDef;
  readonly state: string;
  readonly density: number;
  readonly cells: Map<number, CanvasSurface>;
  lastUsed: number;
}

function figureKeyPrefix(def: FigureDef): string {
  return `${def.id}|`;
}

function rowKey(def: FigureDef, state: string): string {
  return `${figureKeyPrefix(def)}${state}`;
}

function cellBytes(surface: CanvasSurface): number {
  return surface.width * surface.height * BYTES_PER_PIXEL;
}

const clockMs = (): number => performance.now();

export class TitleHeroCells {
  private readonly rows = new Map<string, HeroRow>();
  private readonly residentKeys = new Set<string>();
  private readonly queue: { def: FigureDef; state: string }[] = [];
  private bytes = 0;
  private frame = 0;
  private bakedThisFrame = false;
  private restFrames = 0;
  private lastBakeMs = 0;
  private queueServedAtMs = clockMs();
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
   * would hide the heroes. Lets everything go; returns whether it did, so the
   * caller can ask for its rows again.
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
    for (const row of this.rows.values()) {
      for (const cell of row.cells.values()) releaseSurface(cell);
    }
    this.rows.clear();
    this.residentKeys.clear();
    this.queue.length = 0;
    this.bytes = 0;
  }

  /**
   * Lets go of every row of `def`, resident or queued: a figure the title no
   * longer shows, such as the look a player has just chosen away from.
   */
  releaseFigure(def: FigureDef): void {
    for (const [key, row] of [...this.rows]) {
      if (row.def === def) this.release(key, row);
    }
    for (const key of [...this.residentKeys]) {
      if (key.startsWith(figureKeyPrefix(def))) this.residentKeys.delete(key);
    }
    const kept = this.queue.filter((queued) => queued.def !== def);
    this.queue.length = 0;
    this.queue.push(...kept);
  }

  /** Asks for a whole row ahead of its showing, baked a cell at a time by {@link bakeQueued}. */
  request(def: FigureDef, state: string): void {
    if (this.queue.some((queued) => queued.def === def && queued.state === state)) return;
    if (this.queue.length === 0) this.queueServedAtMs = clockMs();
    this.queue.push({ def, state });
  }

  /**
   * Asks for a row a hero shows whenever it is not gesturing, and keeps it:
   * it is never let go to make room for another.
   */
  holdResident(def: FigureDef, state: string): void {
    this.residentKeys.add(rowKey(def, state));
    this.request(def, state);
  }

  /**
   * Bakes every frame of a row at `density` now, in this call. For a moment
   * that can afford one stall but must not stall again while it plays out.
   */
  bakeRowNow(def: FigureDef, state: string, density: number): void {
    const row = this.rowFor(def, state, density);
    row.lastUsed = this.frame;
    const frameCount = figureFrameCount(def, state);
    for (let frame = 0; frame < frameCount; frame++) {
      if (row.cells.has(frame)) continue;
      this.makeRoom(this.bakedBytes(row), row);
      this.bake(row, frame);
    }
  }

  /** Whether every frame of a row is baked at `density`, so it can play from start to end sharp and without a stall. */
  isReady(def: FigureDef, state: string, density: number): boolean {
    const row = this.rows.get(rowKey(def, state));
    if (row?.density !== density) return false;
    return row.cells.size >= figureFrameCount(def, state);
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
    if (next === null || !this.bakeQueuedCell(next.row, next.frame)) return;
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
        const overdue =
          deadline.didTimeout || clockMs() - this.queueServedAtMs >= IDLE_BAKE_TIMEOUT_MS;
        if (overdue || deadline.timeRemaining() >= expectedMs) {
          this.bakeQueuedCell(next.row, next.frame);
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

  /** Bakes a cell asked for ahead, unless making room for it would let go of a row on screen; then it waits. */
  private bakeQueuedCell(row: HeroRow, frame: number): boolean {
    if (!this.makeRoom(this.bakedBytes(row), row)) return false;
    return this.bake(row, frame) !== undefined;
  }

  /**
   * Blits one frame with its tile's top-left at (x, y), as the shared cache
   * places a cell, baking it on the spot if it is not baked yet.
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
  ): void {
    const row = this.rowFor(def, state, density);
    row.lastUsed = this.frame;
    let cell = row.cells.get(frame);
    if (cell === undefined) {
      this.makeRoom(this.bakedBytes(row), row);
      cell = this.bake(row, frame);
      if (cell === undefined) return;
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
    for (const cell of row.cells.values()) {
      this.bytes -= cellBytes(cell);
      releaseSurface(cell);
    }
    this.rows.delete(key);
  }

  private cellSize(row: HeroRow): { width: number; height: number } {
    const crop = this.cropOf(row.def);
    return {
      width: Math.max(1, Math.ceil(crop.width * row.density)),
      height: Math.max(1, Math.ceil(crop.height * row.density)),
    };
  }

  private bakedBytes(row: HeroRow): number {
    const { width, height } = this.cellSize(row);
    return width * height * BYTES_PER_PIXEL;
  }

  private bake(row: HeroRow, frame: number): CanvasSurface | undefined {
    const frames = figureFrameCount(row.def, row.state);
    if (frame < 0 || frame >= frames) return undefined;
    const crop = this.cropOf(row.def);
    const { width, height } = this.cellSize(row);
    const startedMs = clockMs();
    const cell = allocCanvas('title', width, height);
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
    const finishedMs = clockMs();
    this.queueServedAtMs = finishedMs;
    this.lastBakeMs = finishedMs - startedMs;
    this.bakeMsByFigure.set(row.def.id, this.lastBakeMs);
    return cell;
  }

  /**
   * Lets go of the least recently drawn rows until `incoming` more bytes fit,
   * never `keep`, a resident row or a row drawn in the latest frame. Returns
   * whether they fit.
   */
  private makeRoom(incoming: number, keep: HeroRow): boolean {
    while (this.bytes + incoming > HERO_CELL_BUDGET_BYTES) {
      let oldest: [string, HeroRow] | null = null;
      for (const entry of this.rows) {
        const [key, row] = entry;
        const spared =
          row === keep ||
          row.cells.size === 0 ||
          row.lastUsed >= this.frame ||
          this.residentKeys.has(key);
        if (spared) continue;
        if (oldest === null || row.lastUsed < oldest[1].lastUsed) oldest = entry;
      }
      if (oldest === null) return false;
      this.release(oldest[0], oldest[1]);
    }
    return true;
  }
}
