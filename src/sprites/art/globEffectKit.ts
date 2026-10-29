/**
 * What every thrown glob's art shares, whatever it is made of: the frame
 * counts its three rows run for, the tile scale they are painted at, the
 * effect-figure builder, the phase samplers, and the small painting helpers
 * (`rgba`, `blobPath`, a seeded hash) the fireball and the acid glob both lay
 * their shapes with.
 *
 * The frame counts are shared rather than per kind because the runtime's
 * timing (`GlobProjectileSystem`'s burst length, the puddle's fade) is written
 * once for every kind; a glob whose burst ran on a different number of frames
 * would play its row too fast or hold its last frame.
 */

import { type FigureDef, figureStates } from '../figure/figureDef';

type Ctx = CanvasRenderingContext2D;

/** Cell pixels per tile; the runtime scales by `tileSize / TILE_SCALE`. */
export const TILE_SCALE = 64;

export const GLOB_BOLT_FRAMES = 8;
export const GLOB_BURST_FRAMES = 10;
export const GLOB_PUDDLE_FRAMES = 8;

export const TWO_PI = Math.PI * 2;
/** Radii below this are degenerate; canvas rejects a negative arc or gradient. */
export const MIN_RADIUS = 1e-4;

export function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

/** Smooth 0→1 ease. */
export function easeOut(t: number): number {
  const c = clamp01(t);
  return 1 - (1 - c) * (1 - c);
}

/** Deterministic pseudo-random in [0,1) so re-runs produce identical art. */
export function hash1(seed: number): number {
  const HASH_MULTIPLIER = 12.9898;
  const HASH_SCALE = 43758.5453;
  const x = Math.sin(seed * HASH_MULTIPLIER) * HASH_SCALE;
  return x - Math.floor(x);
}

const ALPHA_PRECISION = 4;

/**
 * `rgba()` with the alpha rounded.
 *
 * A computed alpha can come out vanishingly small, and `String(5e-17)` is
 * exponent notation that node-canvas cannot parse — it drops the whole colour
 * and the shape bakes as an opaque smear.
 */
export function rgba(r: number, g: number, b: number, alpha: number): string {
  const safe = Math.max(0, Math.min(1, alpha)).toFixed(ALPHA_PRECISION);
  return `rgba(${r},${g},${b},${safe})`;
}

const DEFAULT_BLOB_STEPS = 18;
/** The two wobble frequencies a blob's outline is built from, and their mix. */
const BLOB_LOW_LOBES = 3;
const BLOB_HIGH_LOBES = 7;
const BLOB_LOW_WEIGHT = 0.6;
const BLOB_HIGH_WEIGHT = 0.4;
const BLOB_HIGH_SEED_SPREAD = 1.9;

/**
 * A closed, irregular blob: a crust plate, a puff of smoke, a gob of slime.
 *
 * Laid through quadratic curves rather than straight segments: at the sample
 * counts these effects can afford, a polyline blob bakes as a visibly faceted
 * shard, which reads as a chunk of debris no matter what colour it is painted.
 */
export function blobPath(
  ctx: Ctx,
  cx: number,
  cy: number,
  radius: number,
  seed: number,
  roughness: number,
  steps = DEFAULT_BLOB_STEPS,
): void {
  const pointAt = (i: number): readonly [number, number] => {
    const angle = ((i % steps) / steps) * TWO_PI;
    const wobble =
      1 +
      roughness *
        (Math.sin(angle * BLOB_LOW_LOBES + seed) * BLOB_LOW_WEIGHT +
          Math.sin(angle * BLOB_HIGH_LOBES - seed * BLOB_HIGH_SEED_SPREAD) * BLOB_HIGH_WEIGHT);
    return [cx + Math.cos(angle) * radius * wobble, cy + Math.sin(angle) * radius * wobble];
  };
  const [firstX, firstY] = pointAt(0);
  const [lastX, lastY] = pointAt(steps - 1);
  ctx.beginPath();
  ctx.moveTo((lastX + firstX) / 2, (lastY + firstY) / 2);
  for (let i = 0; i < steps; i++) {
    const [cxp, cyp] = pointAt(i);
    const [nx, ny] = pointAt(i + 1);
    ctx.quadraticCurveTo(cxp, cyp, (cxp + nx) / 2, (cyp + ny) / 2);
  }
  ctx.closePath();
}

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
export function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

const FRAME_MIDPOINT = 0.5;

export function shotProgress(frame: number, frameCount: number): number {
  return (frame + FRAME_MIDPOINT) / frameCount;
}

/** The cell one glob row is painted into, and where its anchor sits in it. */
export interface GlobCell {
  readonly width: number;
  readonly height: number;
  readonly anchorX: number;
  readonly anchorY: number;
}

/**
 * A one-row effect figure: the painter runs in tile units with the origin at
 * the anchor, so every glob painter is written once against the tile and the
 * cell geometry is only ever stated here.
 *
 * There is no choreography layer in the sense a creature figure has one — an
 * effect's "pose" is its place in its own row, and the painters already take
 * that as a phase.
 */
export function effectFigure(
  id: string,
  state: string,
  frames: number,
  cell: GlobCell,
  paint: (ctx: Ctx, frame: number) => void,
): FigureDef {
  const { width, height, anchorX, anchorY } = cell;
  return {
    id,
    frameWidth: width,
    frameHeight: height,
    tileX: anchorX,
    tileY: anchorY,
    tileScale: TILE_SCALE,
    states: figureStates({ [state]: frames }),
    paintFrame: (ctx, painted, frame) => {
      if (painted !== state) return;
      ctx.save();
      ctx.translate(anchorX, anchorY);
      ctx.scale(TILE_SCALE, TILE_SCALE);
      paint(ctx, frame);
      ctx.restore();
    },
  };
}
