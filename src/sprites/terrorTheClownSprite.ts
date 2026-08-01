import {
  drawSpriteKey,
  walkFrameIndex,
  progressFrameIndex,
  timeFrameIndex,
} from '../core/SpriteRenderer';
import type { SpriteStates } from '../core/SpriteLoader';

/**
 * Terror the Clown sprite — Grimaldi's mallet-swinging mini-boss, drawn facing
 * right and mirrored for the other heading.
 *
 * Enrage is a second set of rows rather than a runtime tint: it repaints the
 * suit, the mane and the eye glow together, which no single filter would do.
 *
 * Sheet is produced by `npx tsx scripts/generate-clown-sprites.ts`; review it
 * with `npx tsx scripts/render-clowns.ts --clown=terror`.
 */

const WALK_FRAME_COUNT = 8;
const IDLE_FRAME_COUNT = 6;
const WINDUP_FRAME_COUNT = 8;
const SWING_FRAME_COUNT = 8;

/** Terror's idle heave is heavier and slower than the rank-and-file clowns'. */
const IDLE_FPS = 5;
const MS_PER_SECOND = 1000;

/**
 * Length of one idle loop. Terror offsets the shared clock by up to this much,
 * which matters where he shares a tent with other clowns.
 */
export const IDLE_LOOP_SECONDS = IDLE_FRAME_COUNT / IDLE_FPS;

/**
 * What Terror is doing this frame. `cycle` is the walk angle in radians (a full
 * stride loop is 2π); `progress` runs 0→1 across a one-shot attack beat.
 */
export type TerrorTheClownAnimation =
  | { readonly kind: 'idle'; readonly phaseOffsetSeconds: number }
  | { readonly kind: 'walk'; readonly cycle: number }
  | { readonly kind: 'windup'; readonly progress: number }
  | { readonly kind: 'swing'; readonly progress: number };

type TerrorState = SpriteStates['terror_clown'];

function stateFor(kind: TerrorTheClownAnimation['kind'], enraged: boolean): TerrorState {
  switch (kind) {
    case 'idle':
      return enraged ? 'idle_enraged' : 'idle';
    case 'walk':
      return enraged ? 'walk_enraged' : 'walk';
    case 'windup':
      return enraged ? 'windup_enraged' : 'windup';
    case 'swing':
      return enraged ? 'swing_enraged' : 'swing';
  }
}

function frameFor(animation: TerrorTheClownAnimation): number {
  switch (animation.kind) {
    case 'idle':
      return timeFrameIndex(
        performance.now() / MS_PER_SECOND + animation.phaseOffsetSeconds,
        IDLE_FPS,
        IDLE_FRAME_COUNT,
      );
    case 'walk':
      return walkFrameIndex(animation.cycle, WALK_FRAME_COUNT);
    case 'windup':
      return progressFrameIndex(animation.progress, WINDUP_FRAME_COUNT);
    case 'swing':
      return progressFrameIndex(animation.progress, SWING_FRAME_COUNT);
  }
}

export function drawTerrorTheClownSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  facingX: number,
  animation: TerrorTheClownAnimation,
  enraged: boolean,
): void {
  drawSpriteKey(
    ctx,
    'terror_clown',
    stateFor(animation.kind, enraged),
    frameFor(animation),
    sx,
    sy,
    tileSize,
    { flipX: facingX < 0 },
  );
}
