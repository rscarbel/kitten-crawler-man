import { walkFrameIndex, progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import {
  EVIL_CLOWN_FIGURE,
  EVIL_JUGGLE_FRAMES,
  EVIL_LAUGH_FRAMES,
  EVIL_SWIPE_FRAMES,
  IDLE_FRAMES,
  WALK_FRAMES,
} from './art/clownFigure';

/**
 * The Evil Clown — the bounty troupe's giant, three tiles of stretched clown.
 *
 * Three viewpoints rather than the one the rest of Grimaldi's clowns use: he is
 * tall enough that a mirrored profile walking straight down the screen reads as
 * a man sliding sideways. Only the profile rows are mirrored; flipping a head-on
 * row would swap his hands every time he changed heading.
 *
 * Review the art with `npm run render:clowns`, or `?evilclown` in a dev build
 * to see it move.
 */

/** Which of the figure's three viewpoints a facing vector selects. */
type EvilClownView = 'toward' | 'side' | 'away';

/** The animation families the figure paints; each has a row per view. */
type EvilClownBase = 'walk' | 'idle' | 'swipe' | 'juggle_walk';

/**
 * Every pose name the figure paints. Written out rather than derived, because
 * `stateFor` builds its names by template literal and both draw paths answer a
 * name the figure does not declare by returning without drawing anything.
 */
export type EvilClownState =
  | 'walk'
  | 'walk_side'
  | 'walk_away'
  | 'idle'
  | 'idle_side'
  | 'idle_away'
  | 'swipe'
  | 'swipe_side'
  | 'swipe_away'
  | 'juggle_walk'
  | 'juggle_walk_side'
  | 'juggle_walk_away'
  | 'laugh';

/**
 * Exhaustive by construction: a row added to the figure but not to this map is
 * a compile error, which is safer than reading the count off the figure — the
 * draw call *clamps* the frame index, so a row that got shorter would silently
 * freeze on its last frame instead of failing.
 */
export const EVIL_CLOWN_FRAME_COUNT: Readonly<Record<EvilClownState, number>> = {
  walk: WALK_FRAMES,
  walk_side: WALK_FRAMES,
  walk_away: WALK_FRAMES,
  idle: IDLE_FRAMES,
  idle_side: IDLE_FRAMES,
  idle_away: IDLE_FRAMES,
  swipe: EVIL_SWIPE_FRAMES,
  swipe_side: EVIL_SWIPE_FRAMES,
  swipe_away: EVIL_SWIPE_FRAMES,
  juggle_walk: EVIL_JUGGLE_FRAMES,
  juggle_walk_side: EVIL_JUGGLE_FRAMES,
  juggle_walk_away: EVIL_JUGGLE_FRAMES,
  laugh: EVIL_LAUGH_FRAMES,
};

/** Idle and laugh are clock-driven rather than timer-driven. */
const IDLE_FPS = 5;
const MS_PER_SECOND = 1000;

/** Length of one idle loop, so a staged encounter can stagger its members. */
export const EVIL_CLOWN_IDLE_LOOP_SECONDS = EVIL_CLOWN_FRAME_COUNT.idle / IDLE_FPS;

/**
 * The six pieces the Evil Clown comes apart into, in the order they spawn.
 *
 * The single source of truth for the runtime side: `clownGore.ts` paints them
 * in this order and `BodyPartGoreSystem` spawns them in it, so a rename in one
 * place is a missing body part rather than a silent no-op.
 */
export const EVIL_CLOWN_GORE_PARTS: ReadonlyArray<string> = [
  'gore_head',
  'gore_ruff',
  'gore_torso',
  'gore_arm',
  'gore_shoe',
  'gore_vials',
];

/** The `BodyPartGoreSystem` registry key a dead Evil Clown's pieces come from. */
export const EVIL_CLOWN_BODY_PART_KEY = 'evil_clown';

/**
 * The three views of a row, warmed together rather than the one he currently
 * faces: he wanders while the player circles him, and the frames the cache has
 * to have ready are whichever view he is in when the row plays.
 */
function viewsOf(base: EvilClownBase): ReadonlyArray<EvilClownState> {
  return [base, `${base}_side`, `${base}_away`];
}

/** The rows he plays from the moment he exists, warmed at his spawn. */
export const EVIL_CLOWN_LOCOMOTION_STATES: ReadonlyArray<EvilClownState> = [
  ...viewsOf('walk'),
  ...viewsOf('idle'),
];

/**
 * The vial phase, warmed on the laugh that opens it.
 *
 * The laugh is the telegraph and it is long, so the juggling rows behind it are
 * baked while the player is still reading it — and the laugh itself is head-on
 * only, because a telegraph seen from behind is not one.
 */
export const EVIL_CLOWN_JUGGLE_STATES: ReadonlyArray<EvilClownState> = [
  'laugh',
  ...viewsOf('juggle_walk'),
];

/** The backhand, warmed when he first commits to one. */
export const EVIL_CLOWN_SWIPE_STATES: ReadonlyArray<EvilClownState> = viewsOf('swipe');

export function prewarmEvilClownStates(states: ReadonlyArray<EvilClownState>): void {
  for (const state of states) prewarmFigureState(EVIL_CLOWN_FIGURE, state);
}

/**
 * What the clown is doing this frame. `cycle` is the walk angle in radians (a
 * full stride loop is 2π); `progress` runs 0→1 across a one-shot beat.
 */
export type EvilClownAnimation =
  | { readonly kind: 'idle'; readonly phaseOffsetSeconds: number }
  | { readonly kind: 'walk'; readonly cycle: number }
  | { readonly kind: 'juggle_walk'; readonly cycle: number }
  | { readonly kind: 'swipe'; readonly progress: number }
  | { readonly kind: 'laugh'; readonly progress: number };

/** Views split on whichever axis the clown is facing hardest along. */
function viewFor(facingX: number, facingY: number): EvilClownView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'toward';
}

function stateFor(animation: EvilClownAnimation, view: EvilClownView): EvilClownState {
  // The laugh is drawn head-on only: it is a telegraph the player has to read,
  // and a telegraph seen from behind is not one.
  if (animation.kind === 'laugh') return 'laugh';
  const base = animation.kind;
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

function frameFor(animation: EvilClownAnimation, state: EvilClownState): number {
  const count = EVIL_CLOWN_FRAME_COUNT[state];
  switch (animation.kind) {
    case 'idle':
      return timeFrameIndex(
        performance.now() / MS_PER_SECOND + animation.phaseOffsetSeconds,
        IDLE_FPS,
        count,
      );
    case 'walk':
    case 'juggle_walk':
      return walkFrameIndex(animation.cycle, count);
    case 'swipe':
    case 'laugh':
      return progressFrameIndex(animation.progress, count);
  }
}

export function drawEvilClownSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  facingX: number,
  facingY: number,
  animation: EvilClownAnimation,
): void {
  const view = viewFor(facingX, facingY);
  const state = stateFor(animation, view);
  // Only the profile art is mirrored, and never the head-on laugh, whatever the
  // clown happens to be facing while he plays it.
  const flipX = view === 'side' && facingX < 0 && animation.kind !== 'laugh';
  drawFigureCached(ctx, EVIL_CLOWN_FIGURE, state, frameFor(animation, state), sx, sy, tileSize, {
    flipX,
  });
}
