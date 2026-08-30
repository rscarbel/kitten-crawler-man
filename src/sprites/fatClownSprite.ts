import { walkFrameIndex, progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { FAT_CLOWN_FIGURE, FAT_SLAM_FRAMES, IDLE_FRAMES, WALK_FRAMES } from './art/clownFigure';

/**
 * Fat Clown sprite — the tanky bruiser of Grimaldi's troupe, painted facing
 * right and mirrored for the other heading.
 *
 * Review the art with `npm run render:clowns`.
 */

/** Every state the figure paints, so a name can never be built and missed. */
export type FatClownState = 'walk' | 'idle' | 'slam';

/**
 * Exhaustive by construction: a row added to the figure but not to this map is
 * a compile error, which is safer than reading the count off the figure — the
 * draw call *clamps* the frame index, so a row that got shorter would silently
 * freeze on its last frame instead of failing.
 */
export const FAT_CLOWN_FRAME_COUNT: Readonly<Record<FatClownState, number>> = {
  walk: WALK_FRAMES,
  idle: IDLE_FRAMES,
  slam: FAT_SLAM_FRAMES,
};

const IDLE_FPS = 6;
const MS_PER_SECOND = 1000;

/**
 * Length of one idle loop. A clown offsets the shared clock by up to this much
 * so a pack of them does not breathe in lockstep.
 */
export const IDLE_LOOP_SECONDS = FAT_CLOWN_FRAME_COUNT.idle / IDLE_FPS;

/** The rows a clown plays from the moment it exists, warmed at its spawn. */
export const FAT_CLOWN_LOCOMOTION_STATES: ReadonlyArray<FatClownState> = ['walk', 'idle'];

/** The one attack row, warmed when the slam is committed to. */
export const FAT_CLOWN_ATTACK_STATES: ReadonlyArray<FatClownState> = ['slam'];

export function prewarmFatClownStates(states: ReadonlyArray<FatClownState>): void {
  for (const state of states) prewarmFigureState(FAT_CLOWN_FIGURE, state);
}

/**
 * What the clown is doing this frame. `cycle` is the walk angle in radians (a
 * full stride loop is 2π); `progress` runs 0→1 across the one-shot slam.
 */
export type FatClownAnimation =
  | { readonly kind: 'idle'; readonly phaseOffsetSeconds: number }
  | { readonly kind: 'walk'; readonly cycle: number }
  | { readonly kind: 'slam'; readonly progress: number };

function frameFor(animation: FatClownAnimation): number {
  switch (animation.kind) {
    case 'idle':
      return timeFrameIndex(
        performance.now() / MS_PER_SECOND + animation.phaseOffsetSeconds,
        IDLE_FPS,
        FAT_CLOWN_FRAME_COUNT.idle,
      );
    case 'walk':
      return walkFrameIndex(animation.cycle, FAT_CLOWN_FRAME_COUNT.walk);
    case 'slam':
      return progressFrameIndex(animation.progress, FAT_CLOWN_FRAME_COUNT.slam);
  }
}

export function drawFatClownSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  facingX: number,
  animation: FatClownAnimation,
): void {
  drawFigureCached(ctx, FAT_CLOWN_FIGURE, animation.kind, frameFor(animation), sx, sy, tileSize, {
    flipX: facingX < 0,
  });
}
