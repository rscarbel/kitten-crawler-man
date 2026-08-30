import { walkFrameIndex, progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import {
  ATTACK_FRAMES,
  GROUND_OFFSET_IN_TILE,
  HUMAN_FIGURE,
  HUMAN_SCALE,
  IDLE_FRAMES,
  SMUSH_FRAMES,
  SMUSH_IMPACT_FRAME as FIGURE_SMUSH_IMPACT_FRAME,
  SMUSH_STANCE,
  WALK_FRAMES,
} from './art/humanFigure';

export type HumanAttackPhase = 'punch_side' | 'kick_side' | 'punch_up' | 'kick_down' | null;

/**
 * Every row `drawHumanSprite` can ask the figure for. Written out rather than
 * derived from the figure, because the draw call *clamps* a frame index and
 * skips a state it cannot find: read off the figure, a row that lost its frames
 * or its name would freeze or vanish instead of failing. `scripts/gates-human.ts`
 * holds this union and the figure's own states equal.
 */
type HumanState =
  | 'idle'
  | 'idle_side'
  | 'idle_away'
  | 'walk'
  | 'walk_side'
  | 'walk_away'
  | 'punch_side'
  | 'kick_side'
  | 'punch_up'
  | 'kick_down'
  | 'smush';

/**
 * Frames per row, taken from the choreography that paints them, so the two
 * cannot drift. Exhaustive by construction: a state added to `HumanState`
 * without a count here is a compile error.
 */
const FRAME_COUNT: Record<HumanState, number> = {
  idle: IDLE_FRAMES,
  idle_side: IDLE_FRAMES,
  idle_away: IDLE_FRAMES,
  walk: WALK_FRAMES,
  walk_side: WALK_FRAMES,
  walk_away: WALK_FRAMES,
  punch_side: ATTACK_FRAMES,
  kick_side: ATTACK_FRAMES,
  punch_up: ATTACK_FRAMES,
  kick_down: ATTACK_FRAMES,
  smush: SMUSH_FRAMES,
};

export const SMUSH_FRAME_COUNT = FRAME_COUNT.smush;

/**
 * The frame of the smush row on which the sole meets the floor. `HumanPlayer`
 * derives the frame its blast is spawned on from this, so the stamp and the
 * explosion cannot drift apart.
 */
export const SMUSH_IMPACT_FRAME = FIGURE_SMUSH_IMPACT_FRAME;

/**
 * Where the stamping heel lands, in tile fractions from the sprite's own tile
 * origin — the blast belongs under his foot, not at his waist.
 *
 * Derived from the choreography rather than copied out of it: the stamping foot
 * stands `SMUSH_STANCE` out to his right in the anatomy's own units, which the
 * cell paints at `HUMAN_SCALE` of a tile, and the ground line sits
 * `GROUND_OFFSET_IN_TILE` down the tile. `scripts/gates-human.ts` re-measures
 * both against the painted pose on the impact frame.
 */
const TILE_CENTRE_FRACTION = 0.5;
export const SMUSH_STAMP_X = TILE_CENTRE_FRACTION + SMUSH_STANCE * HUMAN_SCALE;
export const SMUSH_STAMP_Y = GROUND_OFFSET_IN_TILE;

/**
 * The rows he is drawn in for almost every frame of the game.
 *
 * Warmed at scene start rather than left to the first miss: he is on screen
 * continuously, so a cold idle or walk row is a direct paint on the very first
 * frame of a scene, which is the frame least able to afford one.
 */
const ALWAYS_DRAWN_ROWS: ReadonlyArray<HumanState> = [
  'idle',
  'idle_side',
  'idle_away',
  'walk',
  'walk_side',
  'walk_away',
];

/** Queues Carl's standing and walking rows for baking. Call once per scene. */
export function prewarmHumanSprite(): void {
  for (const state of ALWAYS_DRAWN_ROWS) prewarmFigureState(HUMAN_FIGURE, state);
}

/** Below this the facing is treated as head-on rather than sideways. */
const SIDEWAYS_THRESHOLD = 0.5;
/** North of this the figure is drawn from behind. */
const AWAY_THRESHOLD = -0.5;

/** Standing still, the breathing loop runs off wall-clock time as the cat's does. */
const IDLE_FPS = 8;

export interface HumanSpriteState {
  attackPhase?: HumanAttackPhase;
  attackTimer?: number;
  /** Total length of the attack, used to turn the timer into progress. */
  attackFrames?: number;
  smushTimer?: number;
  smushFrames?: number;
  walkFrame?: number;
  isMoving?: boolean;
  facingX?: number;
  facingY?: number;
}

/**
 * Draw the human player: idle, walk, melee and the Smush stamp, all full-body
 * rows of the one sheet. Only the profile rows are mirrored, so his jacket
 * never swaps sides.
 *
 * The blast Smush throws off is not part of this sheet — `SmushEffectSystem`
 * draws it, because its size follows the ability's level.
 *
 * Priority (highest first): smush > attack > walk > idle.
 */
export function drawHumanSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  state: HumanSpriteState = {},
): void {
  const {
    attackPhase = null,
    attackTimer = 0,
    attackFrames = 1,
    smushTimer = 0,
    smushFrames = 1,
    walkFrame = 0,
    isMoving = false,
    facingX = 0,
    facingY = 1,
  } = state;

  const flipX = facingX < 0;
  const facingSideways = Math.abs(facingX) > SIDEWAYS_THRESHOLD;
  const facingAway = facingY < AWAY_THRESHOLD;

  if (smushTimer > 0) {
    const progress = 1 - smushTimer / smushFrames;
    drawFigureCached(
      ctx,
      HUMAN_FIGURE,
      'smush',
      progressFrameIndex(progress, FRAME_COUNT.smush),
      sx,
      sy,
      s,
      {},
    );
    return;
  }

  if (attackPhase !== null && attackTimer > 0) {
    const progress = 1 - attackTimer / attackFrames;
    const frame = progressFrameIndex(progress, FRAME_COUNT[attackPhase]);
    // Only the two sideways strikes are drawn in profile, so only they mirror.
    const mirrored = attackPhase === 'punch_side' || attackPhase === 'kick_side';
    drawFigureCached(ctx, HUMAN_FIGURE, attackPhase, frame, sx, sy, s, mirrored ? { flipX } : {});
    return;
  }

  if (isMoving) {
    // `walkFrame` is used as given. Scaling it here would be a bug: the caller
    // wraps it at 2π, and a non-integer multiple of a wrapped phase does not
    // wrap with it — at 1.3 the cycle jumped from frame 4 back to frame 0 once
    // per lap. Pace the walk with `walkFrameSpeed` on the player instead.
    const frame = walkFrameIndex(walkFrame, FRAME_COUNT.walk);
    if (facingAway) {
      drawFigureCached(ctx, HUMAN_FIGURE, 'walk_away', frame, sx, sy, s, {});
    } else if (facingSideways) {
      drawFigureCached(ctx, HUMAN_FIGURE, 'walk_side', frame, sx, sy, s, { flipX });
    } else {
      drawFigureCached(ctx, HUMAN_FIGURE, 'walk', frame, sx, sy, s, {});
    }
    return;
  }

  // `walkFrame` is pinned to 0 while standing, so idle cannot ride on it.
  const idleFrame = timeFrameIndex(performance.now() / 1000, IDLE_FPS, FRAME_COUNT.idle);
  if (facingAway) {
    drawFigureCached(ctx, HUMAN_FIGURE, 'idle_away', idleFrame, sx, sy, s, {});
  } else if (facingSideways) {
    drawFigureCached(ctx, HUMAN_FIGURE, 'idle_side', idleFrame, sx, sy, s, { flipX });
  } else {
    drawFigureCached(ctx, HUMAN_FIGURE, 'idle', idleFrame, sx, sy, s, {});
  }
}
