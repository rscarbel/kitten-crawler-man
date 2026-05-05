import {
  drawSpriteKey,
  walkFrameIndex,
  progressFrameIndex,
  timeFrameIndex,
} from '../core/SpriteRenderer';

export interface Missile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  distTraveled: number;
  maxDist: number;
  state: 'flying' | 'exploding';
  explodeTimer: number;
  hit: boolean;
  /** The Magic Missile ability level when this missile was created. */
  abilityLevel: number;
  /** Sub-missiles spawned by level-10 never chain-react further. */
  isSubMissile: boolean;
}

/**
 * Draw the cat player body.
 * Selects the appropriate sprite sheet state based on movement and facing.
 */
export function drawCatSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  facingY = 0,
  facingX = 0,
): void {
  const flipX = facingX < 0;

  if (isMoving && facingY < -0.5) {
    drawSpriteKey(ctx, 'cat', 'walk_away', walkFrameIndex(walkFrame, 8), sx, sy, s);
    return;
  }

  if (isMoving) {
    drawSpriteKey(ctx, 'cat', 'walk', walkFrameIndex(walkFrame, 8), sx, sy, s, { flipX });
    return;
  }

  drawSpriteKey(ctx, 'cat', 'idle', 0, sx, sy, s, { flipX });
}

/**
 * Draw the cat claw swipe overlay. Extends rightward by default;
 * flipX is applied for left-facing cats.
 */
export function drawCatClawSwipe(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  attackTimer: number,
  ATTACK_FRAMES: number,
  facingX: number,
): void {
  const t = 1 - attackTimer / ATTACK_FRAMES;
  const frame = progressFrameIndex(t, 8);
  const flipX = facingX < 0;
  drawSpriteKey(ctx, 'cat_claw', 'swipe', frame, sx, sy, s, { flipX });
}

export function drawMissiles(
  ctx: CanvasRenderingContext2D,
  missiles: Missile[],
  camX: number,
  camY: number,
  s: number,
  EXPLODE_FRAMES: number,
): void {
  const now = performance.now() / 1000;

  for (const m of missiles) {
    const mx = m.x - camX;
    const my = m.y - camY;
    const isFullPower = m.abilityLevel >= 15;

    if (m.state === 'flying') {
      const rotation = Math.atan2(m.vy, m.vx);
      const state = m.isSubMissile ? 'sub_missile' : isFullPower ? 'full_power' : 'standard';
      const frame = timeFrameIndex(now, 12, 3);
      drawSpriteKey(ctx, 'magic_missile_projectile', state, frame, mx, my, s, { rotation });
    } else {
      // Explosion — centered on the missile position.
      const progress = 1 - m.explodeTimer / EXPLODE_FRAMES;
      const frame = progressFrameIndex(progress, 8);
      const state = isFullPower ? 'full_power' : 'standard';
      drawSpriteKey(ctx, 'magic_missile_explosion', state, frame, mx, my, s);
    }
  }
}
