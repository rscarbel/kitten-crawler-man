/**
 * The acid glob, as three painted figures: the glob in flight, the splat it
 * lands as, and the toxic puddle it leaves.
 *
 * The bolt's cell is long and anchored right of centre, as the fireball's is,
 * because the glob sits at the anchor and its dripping trail streams out
 * behind it. The burst's is square and centred. The puddle's anchor is the
 * puddle's own centre on the floor, with headroom above it for the bubbles and
 * the fumes that lift off the surface.
 *
 * The art invariants live in `scripts/gates-globs.ts`, which the review
 * harness runs: `npm run render:globs`.
 */

import { drawAcidBolt, drawAcidBurst, drawAcidPuddle } from './acidGlobArt';
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
const BOLT_FRAME_HEIGHT = 72;
const BOLT_ANCHOR_X = 72;

const BURST_FRAME_SIZE = 128;

const PUDDLE_FRAME_WIDTH = 96;
const PUDDLE_FRAME_HEIGHT = 80;
const PUDDLE_ANCHOR_Y = 50;

/** The puddle is drawn at full strength; the caller fades it with alpha. */
const PUDDLE_FULL_INTENSITY = 1;

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

const PUDDLE_CELL: GlobCell = {
  width: PUDDLE_FRAME_WIDTH,
  height: PUDDLE_FRAME_HEIGHT,
  anchorX: PUDDLE_FRAME_WIDTH / 2,
  anchorY: PUDDLE_ANCHOR_Y,
};

export const ACID_BOLT_STATE = 'fly';
export const ACID_BURST_STATE = 'burst';
export const ACID_PUDDLE_STATE = 'puddle';

export const ACID_GLOB_BOLT_FIGURE: FigureDef = effectFigure(
  'acid_glob_bolt',
  ACID_BOLT_STATE,
  GLOB_BOLT_FRAMES,
  BOLT_CELL,
  (ctx, frame) => {
    drawAcidBolt(ctx, cyclePhase(frame, GLOB_BOLT_FRAMES));
  },
);

export const ACID_GLOB_BURST_FIGURE: FigureDef = effectFigure(
  'acid_glob_burst',
  ACID_BURST_STATE,
  GLOB_BURST_FRAMES,
  BURST_CELL,
  (ctx, frame) => {
    drawAcidBurst(ctx, shotProgress(frame, GLOB_BURST_FRAMES));
  },
);

export const ACID_GLOB_PUDDLE_FIGURE: FigureDef = effectFigure(
  'acid_glob_puddle',
  ACID_PUDDLE_STATE,
  GLOB_PUDDLE_FRAMES,
  PUDDLE_CELL,
  (ctx, frame) => {
    drawAcidPuddle(ctx, cyclePhase(frame, GLOB_PUDDLE_FRAMES), PUDDLE_FULL_INTENSITY);
  },
);
