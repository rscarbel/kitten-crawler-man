import {
  drawSpriteKey,
  walkFrameIndex,
  progressFrameIndex,
  timeFrameIndex,
} from '../core/SpriteRenderer';

/**
 * Fat Clown sprite — the tanky bruiser of Grimaldi's troupe, drawn facing right
 * and mirrored for the other heading.
 *
 * Sheet is produced by `npx tsx scripts/generate-clown-sprites.ts`; review it
 * with `npx tsx scripts/render-clowns.ts --clown=fat`.
 */

const WALK_FRAME_COUNT = 8;
const IDLE_FRAME_COUNT = 6;
const SLAM_FRAME_COUNT = 10;

const IDLE_FPS = 6;
const MS_PER_SECOND = 1000;

/**
 * Length of one idle loop. A clown offsets the shared clock by up to this much
 * so a pack of them does not breathe in lockstep.
 */
export const IDLE_LOOP_SECONDS = IDLE_FRAME_COUNT / IDLE_FPS;

/**
 * What the clown is doing this frame. `cycle` is the walk angle in radians (a
 * full stride loop is 2π); `progress` runs 0→1 across the one-shot slam.
 */
export type FatClownAnimation =
  | { readonly kind: 'idle'; readonly phaseOffsetSeconds: number }
  | { readonly kind: 'walk'; readonly cycle: number }
  | { readonly kind: 'slam'; readonly progress: number };

export function drawFatClownSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  facingX: number,
  animation: FatClownAnimation,
): void {
  const opts = { flipX: facingX < 0 };

  switch (animation.kind) {
    case 'idle':
      drawSpriteKey(
        ctx,
        'fat_clown',
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
        'fat_clown',
        'walk',
        walkFrameIndex(animation.cycle, WALK_FRAME_COUNT),
        sx,
        sy,
        tileSize,
        opts,
      );
      return;
    case 'slam':
      drawSpriteKey(
        ctx,
        'fat_clown',
        'slam',
        progressFrameIndex(animation.progress, SLAM_FRAME_COUNT),
        sx,
        sy,
        tileSize,
        opts,
      );
      return;
  }
}
