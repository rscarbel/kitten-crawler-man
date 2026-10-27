import {
  walkFrameIndex,
  progressFrameIndex,
  timeFrameIndex,
} from '../core/spriteAssets/SpriteRenderer';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import {
  IDLE_FRAMES,
  TALL_CLOWN_FIGURE,
  TALL_LUNGE_FRAMES,
  TALL_WINDUP_FRAMES,
  WALK_FRAMES,
} from './art/clownFigure';

/**
 * Tall Clown sprite — the towering stalker of the clown troupe, painted
 * facing right and mirrored for the other heading.
 *
 * Review the art with `npm run render:clowns`.
 */

/** Every state the figure paints, so a name can never be built and missed. */
export type TallClownState = 'walk' | 'idle' | 'windup' | 'lunge';

/**
 * Exhaustive by construction: a row added to the figure but not to this map is
 * a compile error, which is safer than reading the count off the figure — the
 * draw call *clamps* the frame index, so a row that got shorter would silently
 * freeze on its last frame instead of failing.
 */
export const TALL_CLOWN_FRAME_COUNT: Readonly<Record<TallClownState, number>> = {
  walk: WALK_FRAMES,
  idle: IDLE_FRAMES,
  windup: TALL_WINDUP_FRAMES,
  lunge: TALL_LUNGE_FRAMES,
};

/** Slow enough to read as a swaying stalk rather than a shiver. */
const IDLE_FPS = 5;
const MS_PER_SECOND = 1000;

/**
 * Length of one idle loop. A clown offsets the shared clock by up to this much
 * so a pack of them does not sway in lockstep.
 */
export const IDLE_LOOP_SECONDS = TALL_CLOWN_FRAME_COUNT.idle / IDLE_FPS;

/** The rows a clown plays from the moment it exists, warmed at its spawn. */
export const TALL_CLOWN_LOCOMOTION_STATES: ReadonlyArray<TallClownState> = ['walk', 'idle'];

/**
 * The strike, warmed as one pair the moment the coil starts: the lunge follows
 * the wind-up with no gap for a cold row to be baked in.
 */
export const TALL_CLOWN_ATTACK_STATES: ReadonlyArray<TallClownState> = ['windup', 'lunge'];

export function prewarmTallClownStates(states: ReadonlyArray<TallClownState>): void {
  for (const state of states) prewarmFigureState(TALL_CLOWN_FIGURE, state);
}

/**
 * What the clown is doing this frame. `cycle` is the walk angle in radians (a
 * full stride loop is 2π); `progress` runs 0→1 across a one-shot attack beat.
 */
export type TallClownAnimation =
  | { readonly kind: 'idle'; readonly phaseOffsetSeconds: number }
  | { readonly kind: 'walk'; readonly cycle: number }
  | { readonly kind: 'windup'; readonly progress: number }
  | { readonly kind: 'lunge'; readonly progress: number };

function frameFor(animation: TallClownAnimation): number {
  switch (animation.kind) {
    case 'idle':
      return timeFrameIndex(
        performance.now() / MS_PER_SECOND + animation.phaseOffsetSeconds,
        IDLE_FPS,
        TALL_CLOWN_FRAME_COUNT.idle,
      );
    case 'walk':
      return walkFrameIndex(animation.cycle, TALL_CLOWN_FRAME_COUNT.walk);
    case 'windup':
      return progressFrameIndex(animation.progress, TALL_CLOWN_FRAME_COUNT.windup);
    case 'lunge':
      return progressFrameIndex(animation.progress, TALL_CLOWN_FRAME_COUNT.lunge);
  }
}

export function drawTallClownSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  facingX: number,
  animation: TallClownAnimation,
): void {
  drawFigureCached(ctx, TALL_CLOWN_FIGURE, animation.kind, frameFor(animation), sx, sy, tileSize, {
    flipX: facingX < 0,
  });
}
