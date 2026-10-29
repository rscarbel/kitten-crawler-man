/**
 * The fireball, as three painted figures: the ball in flight, the impact it
 * detonates into, and the fire patch it leaves burning.
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
 * The art invariants live in `scripts/gates-globs.ts`, which the review
 * harness runs: `npm run render:globs`.
 */

import { drawFireballBolt, drawFireballBurst, drawFireballFlame } from './fireballArt';
import type { FigureDef } from '../figure/figureDef';
import {
  GLOB_BOLT_FRAMES,
  GLOB_BURST_FRAMES,
  GLOB_PUDDLE_FRAMES,
  type GlobCell,
  cyclePhase,
  effectFigure,
  shotProgress,
} from './globEffectKit';

const BOLT_FRAME_WIDTH = 112;
const BOLT_FRAME_HEIGHT = 80;
const BOLT_ANCHOR_X = 72;

const BURST_FRAME_SIZE = 128;

const FLAME_FRAME_WIDTH = 96;
const FLAME_FRAME_HEIGHT = 104;
const FLAME_ANCHOR_Y = 62;

/** The fire patch is drawn at full strength; the caller fades it with alpha. */
const FLAME_FULL_INTENSITY = 1;

const BOLT_CELL: GlobCell = {
  width: BOLT_FRAME_WIDTH,
  height: BOLT_FRAME_HEIGHT,
  anchorX: BOLT_ANCHOR_X,
  anchorY: BOLT_FRAME_HEIGHT / 2,
};

const BURST_CELL: GlobCell = {
  width: BURST_FRAME_SIZE,
  height: BURST_FRAME_SIZE,
  anchorX: BURST_FRAME_SIZE / 2,
  anchorY: BURST_FRAME_SIZE / 2,
};

const FLAME_CELL: GlobCell = {
  width: FLAME_FRAME_WIDTH,
  height: FLAME_FRAME_HEIGHT,
  anchorX: FLAME_FRAME_WIDTH / 2,
  anchorY: FLAME_ANCHOR_Y,
};

export const FIREBALL_BOLT_STATE = 'fly';
export const FIREBALL_BURST_STATE = 'burst';
export const FIREBALL_FLAME_STATE = 'burn';

export const FIREBALL_BOLT_FIGURE: FigureDef = effectFigure(
  'fireball_bolt',
  FIREBALL_BOLT_STATE,
  GLOB_BOLT_FRAMES,
  BOLT_CELL,
  (ctx, frame) => {
    drawFireballBolt(ctx, cyclePhase(frame, GLOB_BOLT_FRAMES));
  },
);

export const FIREBALL_BURST_FIGURE: FigureDef = effectFigure(
  'fireball_burst',
  FIREBALL_BURST_STATE,
  GLOB_BURST_FRAMES,
  BURST_CELL,
  (ctx, frame) => {
    drawFireballBurst(ctx, shotProgress(frame, GLOB_BURST_FRAMES));
  },
);

export const FIREBALL_FLAME_FIGURE: FigureDef = effectFigure(
  'fireball_flame',
  FIREBALL_FLAME_STATE,
  GLOB_PUDDLE_FRAMES,
  FLAME_CELL,
  (ctx, frame) => {
    drawFireballFlame(ctx, cyclePhase(frame, GLOB_PUDDLE_FRAMES), FLAME_FULL_INTENSITY);
  },
);
