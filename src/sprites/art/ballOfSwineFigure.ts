/**
 * The Ball of Swine, as a painted figure: the choreography, the cell geometry,
 * and the `FigureDef` the runtime cache and the review harness both draw
 * through.
 *
 * This module is choreography and nothing else: which phase of which painter
 * each frame of each state samples, and where the ball sits inside its cell.
 * Every stroke of paint lives in `ballOfSwineArt.ts`, and every frame count in
 * `../ballOfSwineSheet.ts`, which the fight's own phase lengths are priced
 * against.
 *
 * Two things here are unlike the other creatures, and both come from the same
 * fact — the ball is drawn *rotated to its travel heading*:
 *
 *  - Every state is painted **concentric on the cell centre**, and the anchor is
 *    that centre rather than a ground line. A rotation pivots on the anchor, so
 *    an anchor anywhere else would swing the ball around a point off its own
 *    axis and make it wobble as it rolled.
 *  - The lighting is a separate one-frame `shade` state, and the ground shadow a
 *    separate `shadow` state, both drawn unrotated by the sprite wrapper. Baked
 *    into the roll frames they would carry the sun and the shadow around the
 *    arena with the ball.
 *
 * The art invariants live in `scripts/gates-ball-of-swine.ts`, which the review
 * harness runs: `npm run render:ball-of-swine`.
 */

import {
  drawBallBurst,
  drawBallRoll,
  drawBallShade,
  drawBallShadow,
  drawBallSlam,
  drawBallSpinup,
  drawBallWallow,
} from './ballOfSwineArt';
import { type FigureDef, figureStates } from '../figure/figureDef';
import {
  BOS_BURST_FRAMES,
  BOS_ROLL_FRAMES,
  BOS_SLAM_FRAMES,
  BOS_SPINUP_FRAMES,
  BOS_WALLOW_FRAMES,
} from '../ballOfSwineSheet';

// ── Cell geometry ────────────────────────────────────────────────────────────

/** Art tile size; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;

/**
 * The cell every state is painted into, and where the ball's centre sits inside
 * it.
 *
 * Square, and anchored dead centre, because a rotated draw pivots on the anchor.
 * The size was measured by the bake this figure replaces — the widest thing any
 * painter threw off the ball, plus padding, quantised — and
 * `scripts/parity-figure-sheet.ts` is what proved the painter still fills
 * exactly that cell. The gates re-check that nothing paints against the edge and
 * that the ball is still the diameter the art module declares, which is what
 * would say a pose has outgrown it.
 */
const FRAME_SIZE = 288;
const ANCHOR = FRAME_SIZE / 2;

const TAU = Math.PI * 2;

// ── Rows ─────────────────────────────────────────────────────────────────────

export type RowKind = 'loop' | 'oneShot' | 'overlay';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly kind: RowKind;
  /**
   * Whether the runtime draws this state rotated about the anchor.
   *
   * Declared on the row rather than inferred, because it is what the
   * concentricity gate measures: a rotated state's ink has to sit on the pivot,
   * and an unrotated one is free to sag onto the floor or spread sideways.
   * Getting this wrong in either direction is a defect the gate can then catch —
   * a rotated state that wobbles, or an unrotated one held to a constraint it
   * has no reason to meet.
   */
  readonly rotated: boolean;
  /** Paints one frame into a context already centred on the ball and in tile units. */
  readonly paint: (ctx: CanvasRenderingContext2D, frame: number) => void;
}

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

export const BALL_OF_SWINE_ROWS: readonly RowSpec[] = [
  {
    name: 'roll',
    frameCount: BOS_ROLL_FRAMES,
    kind: 'loop',
    rotated: true,
    paint: (ctx, frame) => {
      drawBallRoll(ctx, cyclePhase(frame, BOS_ROLL_FRAMES) * TAU);
    },
  },
  {
    name: 'wallow',
    frameCount: BOS_WALLOW_FRAMES,
    kind: 'loop',
    rotated: false,
    paint: (ctx, frame) => {
      drawBallWallow(ctx, cyclePhase(frame, BOS_WALLOW_FRAMES));
    },
  },
  {
    name: 'shade',
    frameCount: 1,
    kind: 'overlay',
    rotated: false,
    paint: (ctx) => {
      drawBallShade(ctx);
    },
  },
  {
    name: 'shadow',
    frameCount: 1,
    kind: 'overlay',
    rotated: false,
    paint: (ctx) => {
      drawBallShadow(ctx);
    },
  },
  {
    name: 'burst',
    frameCount: BOS_BURST_FRAMES,
    kind: 'oneShot',
    rotated: false,
    paint: (ctx, frame) => {
      drawBallBurst(ctx, shotProgress(frame, BOS_BURST_FRAMES));
    },
  },
  {
    name: 'slam',
    frameCount: BOS_SLAM_FRAMES,
    kind: 'oneShot',
    rotated: true,
    paint: (ctx, frame) => {
      drawBallSlam(ctx, shotProgress(frame, BOS_SLAM_FRAMES));
    },
  },
  {
    name: 'spinup',
    frameCount: BOS_SPINUP_FRAMES,
    kind: 'oneShot',
    rotated: false,
    paint: (ctx, frame) => {
      drawBallSpinup(ctx, shotProgress(frame, BOS_SPINUP_FRAMES));
    },
  },
];

// ── Painting ─────────────────────────────────────────────────────────────────

function rowNamed(state: string): RowSpec | undefined {
  return BALL_OF_SWINE_ROWS.find((row) => row.name === state);
}

/**
 * Paints one cell, in the cell's own pixels.
 *
 * Anchored on the cell's centre rather than on a ground line, because that
 * centre is the pivot the runtime spins the rolling and slamming pictures
 * about.
 */
function paintBallOfSwineFrame(ctx: CanvasRenderingContext2D, state: string, frame: number): void {
  const row = rowNamed(state);
  if (row === undefined) return;
  ctx.save();
  ctx.translate(ANCHOR, ANCHOR);
  ctx.scale(TILE_SCALE, TILE_SCALE);
  row.paint(ctx, frame);
  ctx.restore();
}

function ballOfSwineStateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of BALL_OF_SWINE_ROWS) frames[row.name] = row.frameCount;
  return frames;
}

export const BALL_OF_SWINE_FIGURE: FigureDef = {
  id: 'ball_of_swine',
  frameWidth: FRAME_SIZE,
  frameHeight: FRAME_SIZE,
  tileX: ANCHOR,
  tileY: ANCHOR,
  tileScale: TILE_SCALE,
  states: figureStates(ballOfSwineStateFrames()),
  paintFrame: paintBallOfSwineFrame,
};
