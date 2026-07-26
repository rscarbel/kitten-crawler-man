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
  /** Draw size the cells were baked at; a change rebuilds them. */
  size: number;
  /** Where the draw box's top-left sits inside a cell. */
  originX: number;
  originY: number;
  cellWidth: number;
  cellHeight: number;
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

function framesFor(appearance: PersonAppearance, size: number): PersonFrames {
  const existing = framesByAppearance.get(appearance);
  if (existing?.size === size) {
    framesByAppearance.delete(appearance);
    framesByAppearance.set(appearance, existing);
    return existing;
  }

  const originX = Math.ceil(size * CELL_LEFT_FRACTION);
  const originY = Math.ceil(size * CELL_TOP_FRACTION);
  const frames: PersonFrames = {
    size,
    originX,
    originY,
    cellWidth: originX + Math.ceil(size * (1 + CELL_RIGHT_FRACTION)),
    cellHeight: originY + Math.ceil(size * (1 + CELL_BOTTOM_FRACTION)),
    cells: new Map(),
  };
  framesByAppearance.delete(appearance);
  framesByAppearance.set(appearance, frames);

  while (framesByAppearance.size > MAX_CACHED_PEOPLE) {
    const oldest = framesByAppearance.keys().next();
    if (oldest.done === true) break;
    framesByAppearance.delete(oldest.value);
  }
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

  const cell = allocCanvas(frames.cellWidth, frames.cellHeight);
  drawPerson(
    surfaceContext(cell),
    frames.originX,
    frames.originY,
    frames.size,
    appearance,
    bucketPhase,
    facing,
    moving,
  );
  frames.cells.set(key, cell);
  return cell;
}

/**
 * Draws a person through the frame cache. Same arguments and same result as
 * `drawPerson`, except that the walk cycle is sampled at `WALK_PHASE_BUCKETS`
 * points and the figure lands on a whole pixel — blitting at a fractional
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
  const frames = framesFor(appearance, size);
  const quantized = quantizePhase(appearance, phase, moving, WALK_PHASE_BUCKETS);
  const cell = cellFor(frames, appearance, facing, moving, quantized.bucket, quantized.phase);
  ctx.drawImage(cell, Math.round(sx - frames.originX), Math.round(sy - frames.originY));
}
