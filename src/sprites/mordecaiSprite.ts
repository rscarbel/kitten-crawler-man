import { drawRatKinSprite } from './ratKinSprite';
import { drawIncubusSprite } from './incubusSprite';
import { drawBugabooSprite } from './bugabooSprite';

/** Everything the Mordecai variants need to animate, whichever one is drawn. */
export interface MordecaiSpriteState {
  /**
   * Free-running frame counter. The Incubus and the Bugaboo are procedural and
   * animate straight off it.
   */
  readonly walkTime: number;
  /**
   * Walk-cycle angle in radians, advanced by the ground he has actually covered
   * rather than by elapsed frames. The Rat Kin is a baked sheet whose stance
   * foot is planted, so anything else skates.
   */
  readonly walkPhase: number;
  readonly isWalking: boolean;
  /** +1 faces right, −1 faces left, 0 while walking along the vertical axis. */
  readonly facingX: number;
  /** +1 faces toward the camera, −1 away, 0 neither. */
  readonly facingY: number;
  /**
   * The last left/right he committed to, never 0. Only the Rat Kin has art for
   * the vertical axis; the Incubus and the Bugaboo mirror on `facingX < 0` and
   * nothing else, so a zero would snap them round every vertical step.
   */
  readonly lastHorizontalFacing: number;
  /** Offset into the Rat Kin's idle loop, so safe rooms do not idle in unison. */
  readonly idleOffsetSeconds: number;
}

/**
 * Dispatcher: picks the correct Mordecai variant sprite for the given level ID.
 * Level 3 (overworld) gets the demon tuxedo variant; level 2 gets the Bugaboo;
 * others use the Rat Kin.
 */
export function drawMordecaiForLevel(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  state: MordecaiSpriteState,
  levelId: string,
) {
  const { walkTime, isWalking, lastHorizontalFacing } = state;
  if (levelId === 'level3') {
    drawIncubusSprite(ctx, sx, sy, s, walkTime, isWalking, lastHorizontalFacing);
  } else if (levelId === 'level2') {
    drawBugabooSprite(ctx, sx, sy, s, walkTime, isWalking, lastHorizontalFacing);
  } else {
    drawRatKinSprite(ctx, sx, sy, s, state);
  }
}
