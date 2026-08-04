import { drawRatKinSprite } from './ratKinSprite';
import { drawIncubusSprite } from './incubusSprite';
import { drawBugabooSprite } from './bugabooSprite';

/** Everything the Mordecai variants need to animate, whichever one is drawn. */
export interface MordecaiSpriteState {
  /** Free-running frame counter. The Incubus is procedural and animates off it. */
  readonly walkTime: number;
  /**
   * Walk-cycle angle in radians, advanced by the ground he has actually covered
   * rather than by elapsed frames. The Rat Kin and the Bugaboo are baked sheets
   * whose stance foot is planted, so anything else skates.
   */
  readonly walkPhase: number;
  readonly isWalking: boolean;
  /** +1 faces right, −1 faces left, 0 while walking along the vertical axis. */
  readonly facingX: number;
  /** +1 faces toward the camera, −1 away, 0 neither. */
  readonly facingY: number;
  /**
   * The last left/right he committed to, never 0. The Incubus has no art for the
   * vertical axis — it mirrors on `facingX < 0` and nothing else, so a zero
   * would snap it round every vertical step. The Rat Kin and the Bugaboo have
   * their own head-on and away rows and take `facingX`/`facingY` directly; this
   * is only what decides which way their profile rows are mirrored.
   */
  readonly lastHorizontalFacing: number;
  /** Offset into the idle loops, so safe rooms do not idle in unison. */
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
  const { walkTime, walkPhase, isWalking, facingY, lastHorizontalFacing, idleOffsetSeconds } =
    state;
  if (levelId === 'level3') {
    drawIncubusSprite(ctx, sx, sy, s, walkTime, isWalking, lastHorizontalFacing);
  } else if (levelId === 'level2') {
    // Never a swipe, a breach or an emergence: this one is a shopkeeper wearing
    // the shape, and the only rows he has any business in are stance and walk.
    drawBugabooSprite(ctx, sx, sy, s, {
      walkFrame: walkPhase,
      isMoving: isWalking,
      // The raw axis, not the substituted one: his wander commits to a single
      // axis at a time, so folding `lastHorizontalFacing` in here makes
      // `|facingX|` 1 on every frame and the sprite never leaves its profile
      // row — he walks up and down the safe room side-on. The last committed
      // facing is only a fallback for standing still having never moved.
      facingX: state.facingX === 0 && facingY === 0 ? lastHorizontalFacing : state.facingX,
      facingY,
      loopOffsetSeconds: idleOffsetSeconds,
    });
  } else {
    drawRatKinSprite(ctx, sx, sy, s, state);
  }
}
