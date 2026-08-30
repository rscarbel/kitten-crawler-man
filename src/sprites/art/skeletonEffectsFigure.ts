/**
 * The Skeleton Lord's four attack effects, as painted figures.
 *
 * Four figures rather than one: a soul bolt in flight, the burst where it
 * lands, a bone arrow, and one patch of hands clawing out of the ground. Their
 * cells differ by more than fourfold in area and nothing plays two of them at
 * the same rate, so sharing a cell would make every arrow cost a burst.
 *
 * There is no choreography layer here in the sense a creature figure has one —
 * an effect's "pose" is its place in its own row, and `skeletonEffectsArt.ts`
 * already takes that as a phase. All this module does is size each cell the way
 * the bake it replaces sized it, place the painter on the cell's own anchor, and
 * hand it the phase.
 *
 * The art invariants live in `scripts/gates-skeleton-effects.ts`, which the
 * review harness runs: `npm run render:skeleton-effects`.
 */

import {
  ARROW_HALF_HEIGHT,
  ARROW_HALF_LENGTH,
  BOLT_REACH,
  BURST_REACH,
  HANDS_PATCH_HALF_WIDTH,
  drawBoneArrow,
  drawGraspingHands,
  drawSoulBolt,
  drawSoulBurst,
} from './skeletonEffectsArt';
import { type FigureDef, figureStates } from '../figure/figureDef';

/** Cell pixels per tile; the runtime scales by `tileSize / TILE_SCALE`. */
export const TILE_SCALE = 64;

export const BOLT_FRAMES = 8;
export const BURST_FRAMES = 10;
export const HANDS_FRAMES = 8;
export const ARROW_FRAMES = 1;

/**
 * Slack between the art's own declared reach and the cell wall.
 *
 * Cells are sized from the reach the painter declares rather than picked by
 * eye, so retuning an effect cannot silently start clipping it — the same rule
 * the deleted bake used, and the reason these numbers are derived here instead
 * of frozen as literals.
 */
const CELL_MARGIN_TILES = 0.16;

/** The bake's own rounding: an even span, so the centre anchor is an integer. */
function cellSpan(halfExtentTiles: number): number {
  return Math.ceil(((halfExtentTiles + CELL_MARGIN_TILES) * 2 * TILE_SCALE) / 2) * 2;
}

/** Wisps are flung past the ring at up to this multiple of the burst's reach. */
const BURST_WISP_OVERREACH = 1.4;
/** A hand reaches further above the soil than the patch is wide. */
const HANDS_HALF_EXTENT = 0.76;

export const BOLT_CELL = cellSpan(BOLT_REACH);
export const BURST_CELL = cellSpan(BURST_REACH * BURST_WISP_OVERREACH);
export const ARROW_CELL_WIDTH = cellSpan(ARROW_HALF_LENGTH);
export const ARROW_CELL_HEIGHT = cellSpan(ARROW_HALF_HEIGHT);
export const HANDS_CELL = cellSpan(Math.max(HANDS_HALF_EXTENT, HANDS_PATCH_HALF_WIDTH));

/**
 * Where in its own cycle a looping row's frame sits.
 *
 * Evenly spaced and dividing by the frame count rather than by one less: the
 * row's last frame is followed by its first, so the frame after the last has to
 * land on phase 1 — which is phase 0 — and not on it one frame early.
 * `scripts/gates-skeleton-effects.ts` asserts exactly that, because the pixel
 * evidence for a bolt whose cycle overruns is indistinguishable from an
 * ordinary frame: its wisps are individually seeded and decorrelate completely
 * within one frame of any phase offset.
 */
export function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

/**
 * Builds one effect figure. Every one of these is anchored at its cell centre —
 * an effect is placed by where it *is*, and two of the four are drawn spinning
 * or tiled about that point.
 */
function effectFigure(
  id: string,
  state: string,
  frames: number,
  frameWidth: number,
  frameHeight: number,
  paint: (ctx: CanvasRenderingContext2D, frame: number) => void,
): FigureDef {
  const anchorX = frameWidth / 2;
  const anchorY = frameHeight / 2;
  return {
    id,
    frameWidth,
    frameHeight,
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

export const SKELETON_SOUL_BOLT_FIGURE: FigureDef = effectFigure(
  'skeleton_soul_bolt',
  'fly',
  BOLT_FRAMES,
  BOLT_CELL,
  BOLT_CELL,
  (ctx, frame) => {
    drawSoulBolt(ctx, cyclePhase(frame, BOLT_FRAMES));
  },
);

export const SKELETON_SOUL_BURST_FIGURE: FigureDef = effectFigure(
  'skeleton_soul_burst',
  'burst',
  BURST_FRAMES,
  BURST_CELL,
  BURST_CELL,
  (ctx, frame) => {
    drawSoulBurst(ctx, shotProgress(frame, BURST_FRAMES));
  },
);

export const SKELETON_BONE_ARROW_FIGURE: FigureDef = effectFigure(
  'skeleton_bone_arrow',
  'fly',
  ARROW_FRAMES,
  ARROW_CELL_WIDTH,
  ARROW_CELL_HEIGHT,
  (ctx) => {
    drawBoneArrow(ctx);
  },
);

export const SKELETON_GRASPING_HANDS_FIGURE: FigureDef = effectFigure(
  'skeleton_grasping_hands',
  'erupt',
  HANDS_FRAMES,
  HANDS_CELL,
  HANDS_CELL,
  (ctx, frame) => {
    drawGraspingHands(ctx, cyclePhase(frame, HANDS_FRAMES));
  },
);

export const SKELETON_EFFECT_FIGURES: readonly FigureDef[] = [
  SKELETON_SOUL_BOLT_FIGURE,
  SKELETON_SOUL_BURST_FIGURE,
  SKELETON_BONE_ARROW_FIGURE,
  SKELETON_GRASPING_HANDS_FIGURE,
];
