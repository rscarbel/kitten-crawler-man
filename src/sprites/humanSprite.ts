import { drawSpriteKey, walkFrameIndex, progressFrameIndex } from '../core/SpriteRenderer';

/**
 * Draw the human player body.
 * Selects the appropriate sprite sheet state based on movement and facing.
 */
export function drawHumanSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  isKicking: boolean,
  walkFrame = 0,
  isMoving = false,
  facingY = 0,
  facingX = 0,
): void {
  const flipX = facingX < 0;

  if (isKicking) {
    drawSpriteKey(ctx, 'human', 'kick_body', 0, sx, sy, s, { flipX });
    return;
  }

  if (isMoving && facingY < -0.5) {
    drawSpriteKey(ctx, 'human', 'walk_away', walkFrameIndex(walkFrame, 8), sx, sy, s);
    return;
  }

  if (isMoving) {
    drawSpriteKey(ctx, 'human', 'walk', walkFrameIndex(walkFrame, 8), sx, sy, s, { flipX });
    return;
  }

  drawSpriteKey(ctx, 'human', 'idle', 0, sx, sy, s, { flipX });
}

/**
 * Draw the human attack overlay (punch arm or kick leg) on top of the body sprite.
 * The overlay sprites extend rightward by default; flipX mirrors them for left-facing.
 */
export function drawHumanAttack(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  attackPhase: 'punch' | 'kick',
  attackTimer: number,
  ATTACK_FRAMES: number,
  facingX: number,
  _facingY: number,
): void {
  const t = 1 - attackTimer / ATTACK_FRAMES;
  const frame = progressFrameIndex(t, 6);
  const flipX = facingX < 0;

  if (attackPhase === 'punch') {
    drawSpriteKey(ctx, 'human_punch_arm', 'punch', frame, sx, sy, s, { flipX });
  } else {
    drawSpriteKey(ctx, 'human_kick_leg', 'kick', frame, sx, sy, s, { flipX });
  }
}

/**
 * Punching arm only — extends rightward (+X).
 * t: 0→1 over the punch cycle; fist reaches full extension at t≈0.5.
 */
export function drawHumanPunchArm(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  t: number,
): void {
  const frame = progressFrameIndex(t, 6);
  drawSpriteKey(ctx, 'human_punch_arm', 'punch', frame, sx, sy, s);
}

/**
 * Kicking leg only — extends rightward (+X) with a slight upward arc.
 * t: 0→1 over the kick cycle; foot reaches full extension at t≈0.5.
 */
export function drawHumanKickLeg(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  t: number,
): void {
  const frame = progressFrameIndex(t, 6);
  drawSpriteKey(ctx, 'human_kick_leg', 'kick', frame, sx, sy, s);
}
