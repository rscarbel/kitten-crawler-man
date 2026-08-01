/**
 * Pre-rendered walk-cycle frames for procedural people.
 *
 * `drawPerson` composes a citizen from roughly two hundred canvas path
 * operations. That is fine for one figure and ruinous for the fifty visible in
 * a market crowd, so each person's frames are baked once into small offscreen
 * cells — keyed by facing, motion, and a quantized point in the walk cycle —
 * and blitted thereafter. `drawPerson` itself is untouched and remains the
 * builder; only the number of times it runs changes.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../../core/canvasSurface';
import { getRenderScale } from '../../core/Viewport';
import type { PersonAppearance } from './PersonAppearance';
import { drawPerson } from './drawPerson';
import { quantizePhase } from './gait';
import type { Facing } from './skeleton';

/**
 * Points in the walk cycle a person is rendered at. Eight is below the
 * threshold where the stepping reads as choppy at walking speed.
 */
const WALK_PHASE_BUCKETS = 8;

/**
 * People whose frames are kept. Far more than are ever on screen at once, so a
 * citizen who walks out of view and back does not pay to be rebuilt.
 */
const MAX_CACHED_PEOPLE = 40;

/**
 * Ceiling on the pixel data the cache holds.
 *
 * A head count alone is the wrong bound once cells are baked at the render
 * scale, because their cost grows with its square: forty people with every
 * cell baked is about 17 MB at 1× and about 67 MB at 2×, and the larger figure
 * is the size of problem that gets a mobile tab killed. Simply holding fewer
 * people at 2× would be worse than the disease — a market crowd of thirty-five
 * would evict itself every frame — so the bound counts the bytes that were
 * actually allocated instead. Cells are baked lazily, and a citizen who only
 * ever walks one way occupies a fraction of the sixty-four they could, so this
 * caps the worst case without punishing the common one.
 */
const BYTES_PER_MEGABYTE = 1024 * 1024;
const CACHE_BUDGET_MEGABYTES = 24;
const CACHE_BYTE_BUDGET = CACHE_BUDGET_MEGABYTES * BYTES_PER_MEGABYTE;

/** RGBA. */
const BYTES_PER_PIXEL = 4;

/** Total bytes of baked cells currently held, tracked as they are allocated. */
let cachedBytes = 0;

/**
 * Evicts whole people, least recently drawn first, until both bounds hold. The
 * person just drawn was re-inserted and so is evicted last; one is always kept,
 * since evicting the figure being drawn would rebuild it on the next frame.
 */
function evictToBudget(): void {
  while (
    framesByAppearance.size > 1 &&
    (framesByAppearance.size > MAX_CACHED_PEOPLE || cachedBytes > CACHE_BYTE_BUDGET)
  ) {
    const oldest = framesByAppearance.entries().next();
    if (oldest.done === true) break;
    const [appearance, frames] = oldest.value;
    cachedBytes -= frames.bytes;
    framesByAppearance.delete(appearance);
  }
}

/**
 * The cell's bounds relative to the draw box, as fractions of draw size.
 *
 * Per-edge rather than a uniform pad, because a figure is not centred in its
 * box: a mohawk on a tall genome reaches a quarter of the box above its top
 * edge, while nothing goes below the feet and the widest silhouette occupies
 * only the middle four-fifths. A uniform pad big enough for the hair would
 * more than double every cell's area for no ink.
 */
const CELL_TOP_FRACTION = 0.28;
const CELL_BOTTOM_FRACTION = 0.06;
const CELL_LEFT_FRACTION = 0.12;
const CELL_RIGHT_FRACTION = 0.12;

const FACINGS: ReadonlyArray<Facing> = ['down', 'up', 'left', 'right'];

interface PersonFrames {
  /** Draw size in CSS pixels the cells were baked at; a change rebuilds them. */
  size: number;
  /** Device pixels per CSS pixel the cells were baked at; a change rebuilds them. */
  scale: number;
  /** Where the draw box's top-left sits inside a cell, in CSS pixels. */
  originX: number;
  originY: number;
  /** Cell extent in CSS pixels — what the cell is blitted back at. */
  cellWidth: number;
  cellHeight: number;
  /** Cell extent in device pixels — what the cell is actually allocated at. */
  cellPixelWidth: number;
  cellPixelHeight: number;
  /** Bytes this person's baked cells occupy, so eviction can bound the total. */
  bytes: number;
  cells: Map<number, CanvasSurface>;
}

/**
 * Insertion-ordered, so the least recently drawn person is the first entry —
 * re-inserting on every use makes this an LRU without a second structure.
 */
const framesByAppearance = new Map<PersonAppearance, PersonFrames>();

/** A figure is either walking or idle. */
const MOTION_STATES = 2;

function cellKey(facing: Facing, moving: boolean, bucket: number): number {
  const facingIndex = FACINGS.indexOf(facing);
  const motionIndex = moving ? 1 : 0;
  return (facingIndex * MOTION_STATES + motionIndex) * WALK_PHASE_BUCKETS + bucket;
}

function framesFor(appearance: PersonAppearance, size: number, scale: number): PersonFrames {
  const existing = framesByAppearance.get(appearance);
  if (existing?.size === size && existing.scale === scale) {
    framesByAppearance.delete(appearance);
    framesByAppearance.set(appearance, existing);
    return existing;
  }

  const originX = Math.ceil(size * CELL_LEFT_FRACTION);
  const originY = Math.ceil(size * CELL_TOP_FRACTION);
  const cellWidth = originX + Math.ceil(size * (1 + CELL_RIGHT_FRACTION));
  const cellHeight = originY + Math.ceil(size * (1 + CELL_BOTTOM_FRACTION));
  const frames: PersonFrames = {
    size,
    scale,
    originX,
    originY,
    cellWidth,
    cellHeight,
    cellPixelWidth: Math.ceil(cellWidth * scale),
    cellPixelHeight: Math.ceil(cellHeight * scale),
    bytes: 0,
    cells: new Map(),
  };
  const stale = framesByAppearance.get(appearance);
  if (stale !== undefined) cachedBytes -= stale.bytes;
  framesByAppearance.delete(appearance);
  framesByAppearance.set(appearance, frames);
  evictToBudget();
  return frames;
}

function cellFor(
  frames: PersonFrames,
  appearance: PersonAppearance,
  facing: Facing,
  moving: boolean,
  bucket: number,
  bucketPhase: number,
): CanvasSurface {
  const key = cellKey(facing, moving, bucket);
  const cached = frames.cells.get(key);
  if (cached !== undefined) return cached;

  const cell = allocCanvas(frames.cellPixelWidth, frames.cellPixelHeight);
  const cellCtx = surfaceContext(cell);
  // Bake through the scale transform rather than by passing a larger draw size,
  // so the figure's proportions are bit-for-bit the ones drawPerson produces at
  // the CSS size — only the sampling density changes.
  cellCtx.setTransform(frames.scale, 0, 0, frames.scale, 0, 0);
  drawPerson(
    cellCtx,
    frames.originX,
    frames.originY,
    frames.size,
    appearance,
    bucketPhase,
    facing,
    moving,
  );
  frames.cells.set(key, cell);
  frames.bytes += frames.cellPixelWidth * frames.cellPixelHeight * BYTES_PER_PIXEL;
  cachedBytes += frames.cellPixelWidth * frames.cellPixelHeight * BYTES_PER_PIXEL;
  evictToBudget();
  return cell;
}

/**
 * Draws a person through the frame cache. Same arguments and same result as
 * `drawPerson`, except that the walk cycle is sampled at `WALK_PHASE_BUCKETS`
 * points and the figure lands on a whole device pixel — blitting at a fractional
 * offset would resample the cell and soften it.
 */
export function drawPersonCached(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  size: number,
  appearance: PersonAppearance,
  phase: number,
  facing: Facing,
  moving: boolean,
): void {
  const scale = getRenderScale();
  const frames = framesFor(appearance, size, scale);
  const quantized = quantizePhase(appearance, phase, moving, WALK_PHASE_BUCKETS);
  const cell = cellFor(frames, appearance, facing, moving, quantized.bucket, quantized.phase);
  const destX = Math.round((sx - frames.originX) * scale) / scale;
  const destY = Math.round((sy - frames.originY) * scale) / scale;
  ctx.drawImage(cell, destX, destY, frames.cellWidth, frames.cellHeight);
}

/**
 * Drops every baked cell. Called when the render scale changes, since the cells
 * are density-specific and would otherwise be upscaled or downscaled forever.
 */
export function flushPersonFrameCache(): void {
  framesByAppearance.clear();
  cachedBytes = 0;
}
