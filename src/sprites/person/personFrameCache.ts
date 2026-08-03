/**
 * Pre-rendered walk-cycle frames for procedural people.
 *
 * `drawPerson` composes a citizen from roughly two hundred canvas path
 * operations. That is fine for one figure and ruinous for the fifty visible in
 * a market crowd, so each person's frames are baked once into small offscreen
 * cells — keyed by facing, motion, and a quantized point in the walk cycle —
 * and blitted thereafter. `drawPerson` itself is untouched and remains the
 * builder; only the number of times it runs changes.
 *
 * The cost that matters is memory, not bake time: cells scale with the square
 * of the device pixel ratio, and a retina crowd's working set once ran several
 * times the byte budget. Four things keep it inside:
 *
 *  - only three facings are baked, since `left` is a mirror of `right`;
 *  - idle needs a couple of buckets where walking needs sixteen;
 *  - each person's cell is sized from their own genome (`personCellBounds`);
 *  - the bake density is capped, because these are background figures.
 *
 * And when the budget is reached anyway, the cache **stops admitting** rather
 * than evicting. Plain LRU is the worst possible policy for an over-budget
 * working set — the person evicted to make room is the one drawn earliest this
 * frame, who is drawn again next frame and rebuilds everything, so the hit rate
 * collapses and *every* citizen pays the full price. Refusing new cells instead
 * keeps a stable subset blitting and makes only the overflow expensive: a cliff
 * becomes a slope.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../../core/canvasSurface';
import { getRenderScale } from '../../core/Viewport';
import type { PersonAppearance } from './PersonAppearance';
import { drawPerson } from './drawPerson';
import { quantizePhase } from './gait';
import { BAKED_FACINGS, personCellGeometry } from './personCellBounds';
import {
  BYTES_PER_MEGABYTE,
  beginPersonCacheStatsFrame,
  recordPersonCacheBake,
  recordPersonCacheDirectDraw,
  recordPersonCacheEviction,
  recordPersonCacheHit,
  recordPersonCacheMiss,
  recordPersonCacheOccupancy,
  recordPersonCacheRelease,
} from './personCacheStats';
import type { Facing } from './skeleton';

/**
 * Points in the walk cycle a person is rendered at, matching the player
 * character's own walk row.
 *
 * Sixteen is not arbitrary and it is not merely inherited: cadence is now tied
 * to speed, so the bucket count is the frame rate of the leg animation only if
 * a citizen takes at least this many frames to complete a stride. `gateCadence`
 * in `scripts/render-townsfolk.ts` enforces exactly that, failing the build if
 * any genome drops below it — so no baked pose is ever skipped. The crowd runs
 * 3.5–6.1 steps/s, or 19.7–34 frames per stride at full cohort speed.
 */
export const WALK_PHASE_BUCKETS = 16;

/**
 * Idle needs almost none, because there is almost nothing to sample: the whole
 * idle animation settles the pelvis by a hundredth of the draw size, at most
 * about 0.56 px at the size a citizen is drawn. Eight cells of that were eight
 * nearly identical images.
 *
 * Two is not a breath — two samples of a sinusoid are a square wave, so a
 * standing citizen alternates between two poses under a pixel apart every
 * second or so, and for the genomes whose phase offset lands near zero or a
 * half the two cells are identical. That is the trade the cell budget bought;
 * if the idle twitch reads badly, one bucket (a still figure) is the cheaper
 * fix and four is the better-looking one.
 */
export const IDLE_PHASE_BUCKETS = 2;

const MAX_PHASE_BUCKETS = Math.max(WALK_PHASE_BUCKETS, IDLE_PHASE_BUCKETS);

/**
 * People whose frames are kept. Far more than are ever on screen at once, so a
 * citizen who walks out of view and back does not pay to be rebuilt.
 */
const MAX_CACHED_PEOPLE = 48;

/**
 * Ceiling on the pixel data the cache holds. Well under what a mobile tab will
 * tolerate.
 *
 * It is not generous: a forty-person plaza with *every* cell baked measures
 * 23.2 MB, which is 97 % of this. It fits because a citizen rarely needs all
 * fifty-four — a warm forty-person crowd measured 11.2 MB in Chrome after a
 * minute of wandering. So this is the cap that binds, at around forty
 * fully-baked people; `MAX_CACHED_PEOPLE` is the looser of the two bounds.
 */
const CACHE_BUDGET_MEGABYTES = 24;
const CACHE_BYTE_BUDGET = CACHE_BUDGET_MEGABYTES * BYTES_PER_MEGABYTE;

/** RGBA. */
const BYTES_PER_PIXEL = 4;

/**
 * Bake density ceiling. A citizen is drawn about 45 CSS pixels tall, so 1.5×
 * samples them at 67 pixels of detail — past the point where more density is
 * visible on a background figure, and it costs the square of itself in memory.
 */
export const MAX_BAKE_SCALE = 1.5;

/**
 * New people baked per frame. Sweeping the camera into a crowded plaza would
 * otherwise bake thirty figures on one frame and spike; spreading them costs a
 * few frames of direct drawing instead, which is what the uncached path is for.
 */
const MAX_NEW_PEOPLE_PER_FRAME = 3;

/**
 * How long a citizen may go undrawn before the cache lets go of them. Ten
 * seconds at target frame rate: long enough that walking round a corner and
 * back is still free, short enough that leaving the town gives the memory back.
 */
const IDLE_FRAMES_BEFORE_RELEASE = 600;

/** Total bytes of baked cells currently held, tracked as they are allocated. */
let cachedBytes = 0;
let peopleBakedThisFrame = 0;

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
  /** The frame this person was last drawn on, so stale entries can be reclaimed. */
  lastFrame: number;
  cells: Map<number, CanvasSurface>;
}

/**
 * Insertion-ordered, so the least recently drawn person is the first entry —
 * re-inserting on every use makes this an LRU without a second structure.
 */
const framesByAppearance = new Map<PersonAppearance, PersonFrames>();

/** Bumped once per rendered frame; `lastFrame` is compared against it. */
let frameCounter = 0;

/** A figure is either walking or idle. */
const MOTION_STATES = 2;

/**
 * Starts a new render frame: refreshes the per-frame bake budget, releases
 * citizens nobody has drawn in a while, and lets stale cache entries be told
 * apart from the ones in use. Called once per frame by the render pipeline.
 */
export function beginPersonFrame(): void {
  frameCounter++;
  peopleBakedThisFrame = 0;
  beginPersonCacheStatsFrame();
  releaseIdleEntries();
}

/**
 * Drops citizens who have not been drawn in a long time, whether or not the
 * cache is under pressure.
 *
 * The cache keys on the appearance object, and holding one keeps the whole
 * genome and its baked canvases alive. Without this, walking out of the Over
 * City would leave a full crowd's worth of pixels pinned for the rest of the
 * session — and, worse, the head-count cap would then refuse to admit anybody
 * new, because the seats are all taken by people who no longer exist.
 *
 * Insertion order is least-recently-drawn first, so the sweep can stop at the
 * first entry that is still fresh.
 */
function releaseIdleEntries(): void {
  for (const [appearance, frames] of framesByAppearance) {
    if (frameCounter - frames.lastFrame <= IDLE_FRAMES_BEFORE_RELEASE) break;
    cachedBytes -= frames.bytes;
    framesByAppearance.delete(appearance);
    recordPersonCacheRelease();
  }
  publishOccupancy();
}

function bucketsFor(moving: boolean): number {
  return moving ? WALK_PHASE_BUCKETS : IDLE_PHASE_BUCKETS;
}

/** The facing a cell is baked in. `left` reuses `right`'s cells, flipped. */
function bakedFacing(facing: Facing): Facing {
  return facing === 'left' ? 'right' : facing;
}

function cellKey(facing: Facing, moving: boolean, bucket: number): number {
  const facingIndex = BAKED_FACINGS.indexOf(facing);
  const motionIndex = moving ? 1 : 0;
  return (facingIndex * MOTION_STATES + motionIndex) * MAX_PHASE_BUCKETS + bucket;
}

function publishOccupancy(): void {
  recordPersonCacheOccupancy(framesByAppearance.size, cachedBytes);
}

/** True when there is room to allocate another cell of `bytes`. */
function admits(bytes: number): boolean {
  return cachedBytes + bytes <= CACHE_BYTE_BUDGET;
}

/** True when another person can be admitted at all. */
function hasSeat(): boolean {
  return framesByAppearance.size < MAX_CACHED_PEOPLE;
}

/**
 * Reclaims people who were not drawn this frame, least recently drawn first,
 * until `hasRoom` is satisfied. Anyone drawn this frame is left alone: they are
 * the working set, and dropping one of them is what turns an over-budget cache
 * into a treadmill.
 *
 * The test has to be "is there room for what I want", not "am I over budget".
 * The cache can never *be* over budget — nothing is ever admitted that would put
 * it there — so an over-budget test is a condition that never fires, and a cache
 * pinning six megabytes of citizens who walked off camera would go on refusing
 * every new cell to the ones still on screen.
 */
function evictStaleUntil(hasRoom: () => boolean): void {
  if (hasRoom()) return;
  for (const [appearance, frames] of framesByAppearance) {
    if (hasRoom()) break;
    if (frames.lastFrame === frameCounter) continue;
    cachedBytes -= frames.bytes;
    framesByAppearance.delete(appearance);
    recordPersonCacheEviction();
  }
  publishOccupancy();
}

/**
 * The two pressures are freed separately on purpose. A caller who needs bytes
 * has no use for a seat, and evicting for one while testing the other frees
 * people nobody asked to lose — which then shows up as pressure in the stats
 * that a later session is told to read as pressure.
 */
function evictStaleForSeat(): void {
  evictStaleUntil(hasSeat);
}

function evictStaleForBytes(bytes: number): void {
  evictStaleUntil(() => admits(bytes));
}

function framesFor(appearance: PersonAppearance, size: number, scale: number): PersonFrames | null {
  const existing = framesByAppearance.get(appearance);
  if (existing?.size === size && existing.scale === scale) {
    framesByAppearance.delete(appearance);
    framesByAppearance.set(appearance, existing);
    existing.lastFrame = frameCounter;
    return existing;
  }

  if (existing !== undefined) {
    cachedBytes -= existing.bytes;
    framesByAppearance.delete(appearance);
  }
  // The bake cap is checked *before* anything is evicted. Freeing a seat and
  // then declining to sit in it destroys a fully baked citizen for nothing, and
  // reports the loss as cache pressure — which is the number a later session is
  // told to read as pressure. The cap covers rebuilds as well as first
  // sightings: a resize invalidates every citizen at once, and that is exactly
  // the spike it exists to spread.
  if (peopleBakedThisFrame >= MAX_NEW_PEOPLE_PER_FRAME) return null;
  evictStaleForSeat();
  if (!hasSeat()) return null;

  const geometry = personCellGeometry(appearance, size);
  const { cellWidth, cellHeight } = geometry;
  const frames: PersonFrames = {
    size,
    scale,
    originX: geometry.originX,
    originY: geometry.originY,
    cellWidth,
    cellHeight,
    cellPixelWidth: Math.ceil(cellWidth * scale),
    cellPixelHeight: Math.ceil(cellHeight * scale),
    bytes: 0,
    lastFrame: frameCounter,
    cells: new Map(),
  };
  peopleBakedThisFrame++;
  framesByAppearance.set(appearance, frames);
  publishOccupancy();
  return frames;
}

/** The baked cell for this pose, or `null` when the cache has no room for it. */
function cellFor(
  frames: PersonFrames,
  appearance: PersonAppearance,
  facing: Facing,
  moving: boolean,
  bucket: number,
  bucketPhase: number,
): CanvasSurface | null {
  const key = cellKey(facing, moving, bucket);
  const cached = frames.cells.get(key);
  if (cached !== undefined) {
    recordPersonCacheHit();
    return cached;
  }
  recordPersonCacheMiss();

  const bytes = frames.cellPixelWidth * frames.cellPixelHeight * BYTES_PER_PIXEL;
  if (!admits(bytes)) {
    evictStaleForBytes(bytes);
    if (!admits(bytes)) return null;
  }

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
  frames.bytes += bytes;
  cachedBytes += bytes;
  recordPersonCacheBake();
  publishOccupancy();
  return cell;
}

/** Rounds a CSS-pixel position onto a whole device pixel, so a blit is not resampled. */
function snapToDevicePixel(value: number, scale: number): number {
  return Math.round(value * scale) / scale;
}

/**
 * Draws a person through the frame cache. Same arguments and same result as
 * `drawPerson`, except that the walk cycle is sampled at a fixed number of
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
  const scale = Math.min(getRenderScale(), MAX_BAKE_SCALE);
  const quantized = quantizePhase(phase, bucketsFor(moving));
  const frames = framesFor(appearance, size, scale);
  const cell =
    frames === null
      ? null
      : cellFor(frames, appearance, bakedFacing(facing), moving, quantized.bucket, quantized.phase);

  if (frames === null || cell === null) {
    // A refusal before `cellFor` ran is still a lookup that the cache could not
    // serve. Counting it only as a direct draw lets the hit rate read 100 %
    // through exactly the camera sweep the readout exists to diagnose.
    if (frames === null) recordPersonCacheMiss();
    recordPersonCacheDirectDraw();
    drawPerson(ctx, sx, sy, size, appearance, quantized.phase, facing, moving);
    return;
  }

  // The cell was rounded *up* to whole device pixels, so blitting it back at the
  // unrounded CSS extent asks the canvas to squeeze it by a fraction of a pixel
  // — a resample of every cell on every frame, which is precisely the softening
  // the device-pixel snapping above exists to avoid. The surplus is transparent
  // padding on the right and bottom, so the figure lands in the same place.
  const destWidth = frames.cellPixelWidth / scale;
  const destHeight = frames.cellPixelHeight / scale;
  const destY = snapToDevicePixel(sy - frames.originY, scale);
  if (facing !== 'left') {
    const destX = snapToDevicePixel(sx - frames.originX, scale);
    ctx.drawImage(cell, destX, destY, destWidth, destHeight);
    return;
  }

  // `drawPerson` mirrors `left` about the draw box's centre, so reflecting the
  // right-facing cell about that same axis reproduces it exactly.
  const mirroredLeft = snapToDevicePixel(sx + size + frames.originX - destWidth, scale);
  ctx.save();
  ctx.translate(mirroredLeft + destWidth, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(cell, 0, destY, destWidth, destHeight);
  ctx.restore();
}

/**
 * Drops every baked cell. Called when the render scale changes, since the cells
 * are density-specific and would otherwise be upscaled or downscaled forever.
 */
export function flushPersonFrameCache(): void {
  framesByAppearance.clear();
  cachedBytes = 0;
  publishOccupancy();
}
