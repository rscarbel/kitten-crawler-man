import { InputManager } from '../core/InputManager';
import { TILE_SIZE, PLAYER_SPEED } from '../core/constants';
import type { GameMap } from '../map/GameMap';

export type CollisionMode = 'leading_edge' | 'center';

export interface MoveInput {
  dx: number;
  dy: number;
  isMobileVector: boolean;
}

interface Moveable {
  x: number;
  y: number;
  isMoving: boolean;
  facingX: number;
  facingY: number;
}

/**
 * Reads keyboard + mobile touch input and returns a raw direction vector.
 */
export function readMoveInput(
  input: InputManager,
  mobileTarget: { x: number; y: number } | null,
  touchHoldMs: number,
  playerCenterX: number,
  playerCenterY: number,
  camX: number,
  camY: number,
): MoveInput {
  let dx = 0;
  let dy = 0;
  if (input.has('ArrowUp') || input.has('w')) dy -= 1;
  if (input.has('ArrowDown') || input.has('s')) dy += 1;
  if (input.has('ArrowLeft') || input.has('a')) dx -= 1;
  if (input.has('ArrowRight') || input.has('d')) dx += 1;

  let isMobileVector = false;

  if (mobileTarget && touchHoldMs >= 150 && dx === 0 && dy === 0) {
    const wx = mobileTarget.x + camX;
    const wy = mobileTarget.y + camY;
    const ddx = wx - playerCenterX;
    const ddy = wy - playerCenterY;
    const dist = Math.hypot(ddx, ddy);
    if (dist > 8) {
      dx = ddx / dist;
      dy = ddy / dist;
      isMobileVector = true;
    }
  }

  return { dx, dy, isMobileVector };
}

/**
 * Apply movement to an entity with per-axis wall collision.
 *
 * @param collision - 'leading_edge' uses 0.72/0.28 for tighter wall proximity
 *   (better for open dungeons). 'center' uses 0.5 (better for small interiors).
 */
export function applyMovement(
  entity: Moveable,
  move: MoveInput,
  speed: number,
  map: GameMap,
  mapPxW: number,
  mapPxH: number,
  collision: CollisionMode = 'leading_edge',
): void {
  let { dx, dy } = move;

  entity.isMoving = dx !== 0 || dy !== 0;

  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy);
    entity.facingX = dx / len;
    entity.facingY = dy / len;
  }

  // Mobile touch already gives a unit vector — skip diagonal penalty
  if (!move.isMobileVector && dx !== 0 && dy !== 0) {
    dx *= 0.7071;
    dy *= 0.7071;
  }
  dx *= speed;
  dy *= speed;

  const nextX = Math.max(0, Math.min(mapPxW - TILE_SIZE, entity.x + dx));
  let tileXnext: number;
  if (collision === 'leading_edge') {
    tileXnext =
      dx >= 0
        ? Math.floor((nextX + TILE_SIZE * 0.72) / TILE_SIZE)
        : Math.floor((nextX + TILE_SIZE * 0.28) / TILE_SIZE);
  } else {
    tileXnext = Math.floor((nextX + TILE_SIZE * 0.5) / TILE_SIZE);
  }
  const tileYcur = Math.floor((entity.y + TILE_SIZE * 0.5) / TILE_SIZE);
  if (map.isWalkable(tileXnext, tileYcur)) entity.x = nextX;

  const nextY = Math.max(0, Math.min(mapPxH - TILE_SIZE, entity.y + dy));
  const tileXcur = Math.floor((entity.x + TILE_SIZE * 0.5) / TILE_SIZE);
  const tileYnext = Math.floor((nextY + TILE_SIZE * 0.5) / TILE_SIZE);
  if (map.isWalkable(tileXcur, tileYnext)) entity.y = nextY;
}
