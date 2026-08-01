import { drawSpriteKey, walkFrameIndex, progressFrameIndex } from '../core/SpriteRenderer';

/**
 * Small spider sprite — a top-down sheet drawn facing north and rotated to the
 * spider's heading, so one orientation covers every direction.
 *
 * The `spider` manifest entry's tileX/tileY are the rotation pivot (the frame
 * centre), not a tile top-left, so this sprite must always be drawn through
 * `drawSpiderSprite`, which passes the anchor and rotation the pivot expects.
 *
 * Sheet is produced by `npx tsx scripts/generate-spider-sprite.ts`; review it
 * with `npx tsx scripts/render-spider.ts`.
 */

const WALK_FRAME_COUNT = 8;
const IDLE_FRAME_COUNT = 6;
const CROUCH_FRAME_COUNT = 6;
const POUNCE_FRAME_COUNT = 10;
const DEATH_FRAME_COUNT = 12;

const TILE_CENTER_FRACTION = 0.5;
/** The art faces -Y, so a heading of (1,0) needs a quarter turn to face east. */
const SPRITE_FACING_OFFSET = Math.PI / 2;

export type SpiderDeathStyle = 'death_curl' | 'death_spasm' | 'death_flip';

/**
 * What the spider is doing this frame. Cycles are in radians (a full gait or
 * idle loop is 2π); progresses run 0→1 across a one-shot animation.
 */
export type SpiderAnimation =
  | { readonly kind: 'idle'; readonly cycle: number }
  | { readonly kind: 'walk'; readonly cycle: number }
  | { readonly kind: 'crouch'; readonly progress: number }
  | { readonly kind: 'pounce'; readonly progress: number }
  | { readonly kind: 'dying'; readonly style: SpiderDeathStyle; readonly progress: number };

export function drawSpiderSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  facingX: number,
  facingY: number,
  animation: SpiderAnimation,
  alpha = 1,
): void {
  const anchorX = sx + tileSize * TILE_CENTER_FRACTION;
  const anchorY = sy + tileSize * TILE_CENTER_FRACTION;
  const rotation = Math.atan2(facingY, facingX) + SPRITE_FACING_OFFSET;
  const opts = { rotation, alpha };

  switch (animation.kind) {
    case 'idle':
      drawSpriteKey(
        ctx,
        'spider',
        'idle',
        walkFrameIndex(animation.cycle, IDLE_FRAME_COUNT),
        anchorX,
        anchorY,
        tileSize,
        opts,
      );
      return;
    case 'walk':
      drawSpriteKey(
        ctx,
        'spider',
        'walk',
        walkFrameIndex(animation.cycle, WALK_FRAME_COUNT),
        anchorX,
        anchorY,
        tileSize,
        opts,
      );
      return;
    case 'crouch':
      drawSpriteKey(
        ctx,
        'spider',
        'crouch',
        progressFrameIndex(animation.progress, CROUCH_FRAME_COUNT),
        anchorX,
        anchorY,
        tileSize,
        opts,
      );
      return;
    case 'pounce':
      drawSpriteKey(
        ctx,
        'spider',
        'pounce',
        progressFrameIndex(animation.progress, POUNCE_FRAME_COUNT),
        anchorX,
        anchorY,
        tileSize,
        opts,
      );
      return;
    case 'dying':
      drawSpriteKey(
        ctx,
        'spider',
        animation.style,
        progressFrameIndex(animation.progress, DEATH_FRAME_COUNT),
        anchorX,
        anchorY,
        tileSize,
        opts,
      );
      return;
  }
}
