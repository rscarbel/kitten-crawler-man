import { drawRatKinSprite } from './ratKinSprite';
import { drawIncubusSprite } from './incubusSprite';
import { drawBugabooSprite } from './bugabooSprite';

/**
 * Dispatcher: picks the correct Mordecai variant sprite for the given level ID.
 * Level 3 (overworld) gets the demon tuxedo variant; level 2 gets the Bugaboo; others use rat-NPC.
 */
export function drawMordecaiForLevel(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkTime: number,
  isWalking: boolean,
  facingX: number,
  levelId: string,
) {
  if (levelId === 'level3') {
    drawIncubusSprite(ctx, sx, sy, s, walkTime, isWalking, facingX);
  } else if (levelId === 'level2') {
    drawBugabooSprite(ctx, sx, sy, s, walkTime, isWalking, facingX);
  } else {
    drawRatKinSprite(ctx, sx, sy, s, walkTime, isWalking, facingX);
  }
}
