import { timeFrameIndex, walkFrameIndex } from '../core/SpriteRenderer';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { figureFrameCount } from './figure/figureDef';
import { RAT_KIN_FIGURE } from './art/ratKinFigure';

/** The six rows he paints: a walk and an idle in each of three views. */
export type RatKinState = 'walk' | 'walk_side' | 'walk_away' | 'idle' | 'idle_side' | 'idle_away';

/** Which of the figure's three viewpoints a facing vector selects. */
type RatKinView = 'front' | 'side' | 'away';

/**
 * Every state this wrapper can ask the figure for. An art gate holds it against
 * what the figure actually paints: the draw call returns silently on a state it
 * cannot find, so a name that drifts is an invisible NPC and no log line.
 */
export const RAT_KIN_DRAWN_STATES: ReadonlyArray<RatKinState> = [
  'walk',
  'walk_side',
  'walk_away',
  'idle',
  'idle_side',
  'idle_away',
];

/**
 * Frame counts read off the figure that paints them, rather than retyped here.
 *
 * A hand-kept copy is invisible when it drifts: the draw call clamps the index,
 * so too many frames stalls the animation on its last one and too few leaves
 * frames that never play — neither raises anything.
 */
const FRAME_COUNT: Record<RatKinState, number> = {
  walk: figureFrameCount(RAT_KIN_FIGURE, 'walk'),
  walk_side: figureFrameCount(RAT_KIN_FIGURE, 'walk_side'),
  walk_away: figureFrameCount(RAT_KIN_FIGURE, 'walk_away'),
  idle: figureFrameCount(RAT_KIN_FIGURE, 'idle'),
  idle_side: figureFrameCount(RAT_KIN_FIGURE, 'idle_side'),
  idle_away: figureFrameCount(RAT_KIN_FIGURE, 'idle_away'),
};

/**
 * The rows worth warming the moment a safe room stands him up.
 *
 * All three idle views: he is standing the frame the room exists and the player
 * can walk in from any side, so which view he is first drawn in is not knowable
 * here. The walk rows follow within a wander beat and are cheap enough to paint
 * directly while they bake.
 */
export const RAT_KIN_PREWARMED_STATES: ReadonlyArray<RatKinState> = [
  'idle',
  'idle_side',
  'idle_away',
];

/** Warms the rows he starts playing immediately. Called when a safe room is built. */
export function prewarmRatKinSprite(): void {
  for (const state of RAT_KIN_PREWARMED_STATES) prewarmFigureState(RAT_KIN_FIGURE, state);
}

/** Loop speed for the idle, which is driven by the clock rather than by a timer. */
const IDLE_FPS = 8;
const MS_PER_SECOND = 1000;

/**
 * Ground the baked walk covers in one full cycle, in tiles.
 *
 * The sheet's stance foot is planted: it holds still on the floor while the body
 * travels over it. That only reads as walking if the caller advances the cycle
 * at the rate he is actually moving — pace a walk with a phase speed derived
 * from distance, never by scaling the frame index against a frame counter, or
 * the feet skate.
 *
 * The stride-sync gate in `scripts/gates-rat-kin.ts` re-measures the planted
 * frames of the walk and fails if this constant drifts from what they actually
 * cover.
 */
export const RAT_KIN_TILES_PER_WALK_CYCLE = 0.4303;

/** Everything the Rat Kin sprite needs to pick a pose. */
export interface RatKinSpriteState {
  /** Walk-cycle angle in radians, advanced by the ground he has covered. */
  readonly walkPhase: number;
  readonly isWalking: boolean;
  /** +1 faces right, −1 faces left, 0 while walking along the vertical axis. */
  readonly facingX: number;
  /** +1 faces toward the camera, −1 away, 0 neither. */
  readonly facingY: number;
  /**
   * Phase offset for the idle loop, so two Mordecais on one floor do not breathe
   * in lockstep. The idle runs off the wall clock, which is identical for both.
   */
  readonly idleOffsetSeconds?: number;
}

/** Views split on whichever axis he is facing hardest along. */
function viewFor(facingX: number, facingY: number): RatKinView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function stateFor(base: 'walk' | 'idle', view: RatKinView): RatKinState {
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

/**
 * Draw the Rat Kin.
 *
 * Only the profile art is mirrored: flipping a head-on view would swap the side
 * his satchel hangs on every time he turned around.
 */
export function drawRatKinSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  state: RatKinSpriteState,
): void {
  const view = viewFor(state.facingX, state.facingY);
  const flipX = view === 'side' && state.facingX < 0;

  if (state.isWalking) {
    const key = stateFor('walk', view);
    const frame = walkFrameIndex(state.walkPhase, FRAME_COUNT[key]);
    drawFigureCached(ctx, RAT_KIN_FIGURE, key, frame, sx, sy, s, { flipX });
    return;
  }

  const key = stateFor('idle', view);
  const nowSeconds = performance.now() / MS_PER_SECOND + (state.idleOffsetSeconds ?? 0);
  const frame = timeFrameIndex(nowSeconds, IDLE_FPS, FRAME_COUNT[key]);
  drawFigureCached(ctx, RAT_KIN_FIGURE, key, frame, sx, sy, s, { flipX });
}
