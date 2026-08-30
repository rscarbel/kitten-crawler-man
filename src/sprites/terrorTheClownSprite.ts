import { walkFrameIndex, progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import {
  IDLE_FRAMES,
  TERROR_CLOWN_FIGURE,
  TERROR_SWING_FRAMES,
  TERROR_WINDUP_FRAMES,
  WALK_FRAMES,
} from './art/clownFigure';

/**
 * Terror the Clown sprite — Grimaldi's mallet-swinging mini-boss, painted
 * facing right and mirrored for the other heading.
 *
 * Enrage is a second set of rows rather than a runtime tint: it repaints the
 * suit, the mane and the eye glow together, which no single filter would do.
 *
 * Review the art with `npm run render:clowns`.
 */

/** The four things Terror does, before enrage doubles the row table. */
type TerrorBase = 'walk' | 'idle' | 'windup' | 'swing';

/**
 * Every state the figure paints. Written out rather than derived, because
 * `stateFor` builds its names by template literal and both draw paths answer a
 * name the figure does not declare by returning without drawing anything.
 */
export type TerrorClownState =
  | 'walk'
  | 'idle'
  | 'windup'
  | 'swing'
  | 'walk_enraged'
  | 'idle_enraged'
  | 'windup_enraged'
  | 'swing_enraged';

/**
 * Exhaustive by construction: a row added to the figure but not to this map is
 * a compile error, which is safer than reading the count off the figure — the
 * draw call *clamps* the frame index, so a row that got shorter would silently
 * freeze on its last frame instead of failing.
 */
export const TERROR_CLOWN_FRAME_COUNT: Readonly<Record<TerrorClownState, number>> = {
  walk: WALK_FRAMES,
  idle: IDLE_FRAMES,
  windup: TERROR_WINDUP_FRAMES,
  swing: TERROR_SWING_FRAMES,
  walk_enraged: WALK_FRAMES,
  idle_enraged: IDLE_FRAMES,
  windup_enraged: TERROR_WINDUP_FRAMES,
  swing_enraged: TERROR_SWING_FRAMES,
};

/** Terror's idle heave is heavier and slower than the rank-and-file clowns'. */
const IDLE_FPS = 5;
const MS_PER_SECOND = 1000;

/**
 * Length of one idle loop. Terror offsets the shared clock by up to this much,
 * which matters where he shares a tent with other clowns.
 */
export const IDLE_LOOP_SECONDS = TERROR_CLOWN_FRAME_COUNT.idle / IDLE_FPS;

function stateFor(base: TerrorBase, enraged: boolean): TerrorClownState {
  if (!enraged) return base;
  switch (base) {
    case 'walk':
      return 'walk_enraged';
    case 'idle':
      return 'idle_enraged';
    case 'windup':
      return 'windup_enraged';
    case 'swing':
      return 'swing_enraged';
  }
}

/**
 * The rows Terror plays from the moment he exists, warmed at his spawn.
 *
 * Both palettes, because enrage is a repaint rather than a tint: the frames the
 * cache has to have ready when he crosses the threshold are a different set of
 * cells entirely, and he crosses it mid-fight.
 */
export const TERROR_CLOWN_LOCOMOTION_STATES: ReadonlyArray<TerrorClownState> = [
  'walk',
  'idle',
  'walk_enraged',
  'idle_enraged',
];

/** The mallet, warmed as one pair: the swing follows the wind-up with no gap. */
export function terrorClownAttackStates(enraged: boolean): ReadonlyArray<TerrorClownState> {
  return [stateFor('windup', enraged), stateFor('swing', enraged)];
}

export function prewarmTerrorClownStates(states: ReadonlyArray<TerrorClownState>): void {
  for (const state of states) prewarmFigureState(TERROR_CLOWN_FIGURE, state);
}

/**
 * What Terror is doing this frame. `cycle` is the walk angle in radians (a full
 * stride loop is 2π); `progress` runs 0→1 across a one-shot attack beat.
 */
export type TerrorTheClownAnimation =
  | { readonly kind: 'idle'; readonly phaseOffsetSeconds: number }
  | { readonly kind: 'walk'; readonly cycle: number }
  | { readonly kind: 'windup'; readonly progress: number }
  | { readonly kind: 'swing'; readonly progress: number };

function frameFor(animation: TerrorTheClownAnimation, state: TerrorClownState): number {
  switch (animation.kind) {
    case 'idle':
      return timeFrameIndex(
        performance.now() / MS_PER_SECOND + animation.phaseOffsetSeconds,
        IDLE_FPS,
        TERROR_CLOWN_FRAME_COUNT[state],
      );
    case 'walk':
      return walkFrameIndex(animation.cycle, TERROR_CLOWN_FRAME_COUNT[state]);
    case 'windup':
    case 'swing':
      return progressFrameIndex(animation.progress, TERROR_CLOWN_FRAME_COUNT[state]);
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
  const state = stateFor(animation.kind, enraged);
  drawFigureCached(ctx, TERROR_CLOWN_FIGURE, state, frameFor(animation, state), sx, sy, tileSize, {
    flipX: facingX < 0,
  });
}
