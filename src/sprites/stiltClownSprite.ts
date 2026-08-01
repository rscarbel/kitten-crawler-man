import {
  drawSpriteKey,
  walkFrameIndex,
  progressFrameIndex,
  timeFrameIndex,
} from '../core/SpriteRenderer';

/**
 * Stilt Clown sprite — the towering stalker of Grimaldi's troupe, drawn facing
 * right and mirrored for the other heading.
 *
 * Sheet is produced by `npx tsx scripts/generate-clown-sprites.ts`; review it
 * with `npx tsx scripts/render-clowns.ts --clown=stilt`.
 */

const WALK_FRAME_COUNT = 8;
const IDLE_FRAME_COUNT = 6;
const WINDUP_FRAME_COUNT = 6;
const LUNGE_FRAME_COUNT = 8;

/** Slow enough to read as a swaying stalk rather than a shiver. */
const IDLE_FPS = 5;
const MS_PER_SECOND = 1000;

/**
 * Length of one idle loop. A clown offsets the shared clock by up to this much
 * so a pack of them does not sway in lockstep.
 */
export const IDLE_LOOP_SECONDS = IDLE_FRAME_COUNT / IDLE_FPS;

/**
 * What the clown is doing this frame. `cycle` is the walk angle in radians (a
 * full stride loop is 2π); `progress` runs 0→1 across a one-shot attack beat.
 */
export type StiltClownAnimation =
  | { readonly kind: 'idle'; readonly phaseOffsetSeconds: number }
  | { readonly kind: 'walk'; readonly cycle: number }
  | { readonly kind: 'windup'; readonly progress: number }
  | { readonly kind: 'lunge'; readonly progress: number };

export function drawStiltClownSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  facingX: number,
  animation: StiltClownAnimation,
): void {
  const opts = { flipX: facingX < 0 };

  switch (animation.kind) {
    case 'idle':
      drawSpriteKey(
        ctx,
        'stilt_clown',
        'idle',
        timeFrameIndex(
          performance.now() / MS_PER_SECOND + animation.phaseOffsetSeconds,
          IDLE_FPS,
          IDLE_FRAME_COUNT,
        ),
        sx,
        sy,
        tileSize,
        opts,
      );
      return;
    case 'walk':
      drawSpriteKey(
        ctx,
        'stilt_clown',
        'walk',
        walkFrameIndex(animation.cycle, WALK_FRAME_COUNT),
        sx,
        sy,
        tileSize,
        opts,
      );
      return;
    case 'windup':
      drawSpriteKey(
        ctx,
        'stilt_clown',
        'windup',
        progressFrameIndex(animation.progress, WINDUP_FRAME_COUNT),
        sx,
        sy,
        tileSize,
        opts,
      );
      return;
    case 'lunge':
      drawSpriteKey(
        ctx,
        'stilt_clown',
        'lunge',
        progressFrameIndex(animation.progress, LUNGE_FRAME_COUNT),
        sx,
        sy,
        tileSize,
        opts,
      );
      return;
  }
}
