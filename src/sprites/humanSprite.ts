import {
  drawSpriteKey,
  walkFrameIndex,
  progressFrameIndex,
  timeFrameIndex,
} from '../core/SpriteRenderer';
import type { SpriteStates } from '../core/SpriteLoader';

export type HumanAttackPhase = 'punch_side' | 'kick_side' | 'punch_up' | 'kick_down' | null;

type HumanState = SpriteStates['human'];

/**
 * Frames per row of the `human` sheet, which `scripts/generate-human-sprite.ts`
 * bakes. Keyed on the manifest-derived state union, so a row renamed or added
 * there is a compile error here rather than a silently wrong frame index.
 */
const FRAME_COUNT: Record<HumanState, number> = {
  idle: 8,
  idle_side: 8,
  idle_away: 8,
  walk: 16,
  walk_side: 16,
  walk_away: 16,
  punch_side: 8,
  kick_side: 8,
  punch_up: 8,
  kick_down: 8,
  smush: 12,
};

export const SMUSH_FRAME_COUNT = FRAME_COUNT.smush;

/**
 * The frame of the smush row on which the sole meets the floor. `HumanPlayer`
 * derives the frame its blast is spawned on from this, so the stamp and the
 * explosion cannot drift apart. `scripts/generate-human-sprite.ts` declares the
 * same value; the runtime cannot import from `scripts/`.
 */
export const SMUSH_IMPACT_FRAME = 4;

/**
 * Where the stamping heel lands, in tile fractions from the sprite's own tile
 * origin — the blast belongs under his foot, not at his waist.
 *
 * The generator puts the sheet's ground line at 0.9 of the tile and stands the
 * stamping foot `SMUSH_STANCE` (0.19) out to his right, scaled by `HUMAN_SCALE`
 * (0.72). The runtime cannot import from `scripts/`, so those are duplicated
 * here; the generator prints its geometry on every bake so a drift is visible.
 */
export const SMUSH_STAMP_X = 0.5 + 0.19 * 0.72;
export const SMUSH_STAMP_Y = 0.9;

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
    drawSpriteKey(
      ctx,
      'human',
      'smush',
      progressFrameIndex(progress, FRAME_COUNT.smush),
      sx,
      sy,
      s,
    );
    return;
  }

  if (attackPhase !== null && attackTimer > 0) {
    const progress = 1 - attackTimer / attackFrames;
    const frame = progressFrameIndex(progress, FRAME_COUNT[attackPhase]);
    // Only the two sideways strikes are drawn in profile, so only they mirror.
    const mirrored = attackPhase === 'punch_side' || attackPhase === 'kick_side';
    drawSpriteKey(ctx, 'human', attackPhase, frame, sx, sy, s, mirrored ? { flipX } : {});
    return;
  }

  if (isMoving) {
    // `walkFrame` is used as given. Scaling it here would be a bug: the caller
    // wraps it at 2π, and a non-integer multiple of a wrapped phase does not
    // wrap with it — at 1.3 the cycle jumped from frame 4 back to frame 0 once
    // per lap. Pace the walk with `walkFrameSpeed` on the player instead.
    const frame = walkFrameIndex(walkFrame, FRAME_COUNT.walk);
    if (facingAway) {
      drawSpriteKey(ctx, 'human', 'walk_away', frame, sx, sy, s);
    } else if (facingSideways) {
      drawSpriteKey(ctx, 'human', 'walk_side', frame, sx, sy, s, { flipX });
    } else {
      drawSpriteKey(ctx, 'human', 'walk', frame, sx, sy, s);
    }
    return;
  }

  // `walkFrame` is pinned to 0 while standing, so idle cannot ride on it.
  const idleFrame = timeFrameIndex(performance.now() / 1000, IDLE_FPS, FRAME_COUNT.idle);
  if (facingAway) {
    drawSpriteKey(ctx, 'human', 'idle_away', idleFrame, sx, sy, s);
  } else if (facingSideways) {
    drawSpriteKey(ctx, 'human', 'idle_side', idleFrame, sx, sy, s, { flipX });
  } else {
    drawSpriteKey(ctx, 'human', 'idle', idleFrame, sx, sy, s);
  }
}
