/**
 * The Lava Llama's spit, as three painted figures: the ball in flight, the
 * impact it detonates into, and the fire patch it leaves burning.
 *
 * Three figures rather than one because none of the three cells is like
 * another. The bolt's is long and anchored well to the right of centre — the
 * ball is at the anchor and the whole trail streams out behind it, so a centred
 * anchor would put half the cell in front of a projectile with nothing to draw
 * there. The burst's is square and centred. The flame's is anchored at its
 * *base* rather than its centre: the patch sits on a floor tile and the tongues
 * rise off it, so a centred anchor would sink the fire half a tile into the
 * ground as it grew.
 *
 * There is no choreography layer here in the sense a creature figure has one —
 * an effect's "pose" is its place in its own row, and `lavaBallArt.ts` already
 * takes that as a phase.
 *
 * The art invariants live in `scripts/gates-lava-ball.ts`, which the review
 * harness runs: `npm run render:lava-ball`.
 */

import { drawLavaBolt, drawLavaBurst, drawLavaFlame } from './lavaBallArt';
import { type FigureDef, figureStates } from '../figure/figureDef';

/** Cell pixels per tile; the runtime scales by `tileSize / TILE_SCALE`. */
export const TILE_SCALE = 64;

export const BOLT_FRAMES = 8;
export const BURST_FRAMES = 10;
export const FLAME_FRAMES = 8;

const BOLT_FRAME_WIDTH = 112;
const BOLT_FRAME_HEIGHT = 80;
const BOLT_ANCHOR_X = 72;

const BURST_FRAME_SIZE = 128;

const FLAME_FRAME_WIDTH = 96;
const FLAME_FRAME_HEIGHT = 104;
const FLAME_ANCHOR_Y = 62;

/** The fire patch is drawn at full strength; the caller fades it with alpha. */
const FLAME_FULL_INTENSITY = 1;

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
export function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

export function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

function effectFigure(
  id: string,
  state: string,
  frames: number,
  frameWidth: number,
  frameHeight: number,
  anchorX: number,
  anchorY: number,
  paint: (ctx: CanvasRenderingContext2D, frame: number) => void,
): FigureDef {
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

export const LLAMA_LAVA_BOLT_FIGURE: FigureDef = effectFigure(
  'llama_lava_bolt',
  'fly',
  BOLT_FRAMES,
  BOLT_FRAME_WIDTH,
  BOLT_FRAME_HEIGHT,
  BOLT_ANCHOR_X,
  BOLT_FRAME_HEIGHT / 2,
  (ctx, frame) => {
    drawLavaBolt(ctx, cyclePhase(frame, BOLT_FRAMES));
  },
);

export const LLAMA_LAVA_BURST_FIGURE: FigureDef = effectFigure(
  'llama_lava_burst',
  'burst',
  BURST_FRAMES,
  BURST_FRAME_SIZE,
  BURST_FRAME_SIZE,
  BURST_FRAME_SIZE / 2,
  BURST_FRAME_SIZE / 2,
  (ctx, frame) => {
    drawLavaBurst(ctx, shotProgress(frame, BURST_FRAMES));
  },
);

export const LLAMA_LAVA_FLAME_FIGURE: FigureDef = effectFigure(
  'llama_lava_flame',
  'burn',
  FLAME_FRAMES,
  FLAME_FRAME_WIDTH,
  FLAME_FRAME_HEIGHT,
  FLAME_FRAME_WIDTH / 2,
  FLAME_ANCHOR_Y,
  (ctx, frame) => {
    drawLavaFlame(ctx, cyclePhase(frame, FLAME_FRAMES), FLAME_FULL_INTENSITY);
  },
);

export const LAVA_BALL_FIGURES: readonly FigureDef[] = [
  LLAMA_LAVA_BOLT_FIGURE,
  LLAMA_LAVA_BURST_FIGURE,
  LLAMA_LAVA_FLAME_FIGURE,
];
