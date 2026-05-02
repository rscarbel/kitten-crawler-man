import { drawSpriteKey, walkFrameIndex, progressFrameIndex } from '../core/SpriteRenderer';

export type GoblinWeapon = 'club' | 'hammer';

/**
 * Draw the goblin enemy — base body layer plus weapon overlay.
 * skinColor and eyeColor are baked into the sprite art.
 */
export function drawGoblinSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  weapon: GoblinWeapon,
  walkFrame: number,
  isMoving: boolean,
  attackAnim: number,
  facingX = 1,
): void {
  const flipX = facingX < 0;

  type BaseState = 'walk' | 'idle' | 'attack';
  let state: BaseState;
  let frame: number;

  if (attackAnim > 0) {
    state = 'attack';
    frame = progressFrameIndex(attackAnim, 16);
  } else if (isMoving) {
    state = 'walk';
    frame = walkFrameIndex(walkFrame, 8);
  } else {
    state = 'idle';
    frame = 0;
  }

  drawSpriteKey(ctx, 'goblin_base', state, frame, sx, sy, s, { flipX });

  const weaponKey = weapon === 'club' ? 'goblin_weapon_club' : 'goblin_weapon_hammer';
  drawSpriteKey(ctx, weaponKey, state, frame, sx, sy, s, { flipX });
}
