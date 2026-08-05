import { TILE_SIZE } from '../core/constants';
import { normalize, clamp } from '../utils';
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

// Diagonal movement penalty
const DIAGONAL_PENALTY = 0.7071; // 1/sqrt(2)

// Wall collision offsets for leading_edge mode
const LEADING_EDGE_FRONT = 0.72;
const LEADING_EDGE_BACK = 0.28;

// Wall collision offset for center mode
const CENTER_COLLISION_OFFSET = 0.5;

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
    const n = normalize(dx, dy);
    entity.facingX = n.x;
    entity.facingY = n.y;
  }

  // Mobile touch already gives a unit vector — skip diagonal penalty
  if (!move.isMobileVector && dx !== 0 && dy !== 0) {
    dx *= DIAGONAL_PENALTY;
    dy *= DIAGONAL_PENALTY;
  }
  dx *= speed;
  dy *= speed;

  const nextX = clamp(entity.x + dx, 0, mapPxW - TILE_SIZE);
  let tileXnext: number;
  if (collision === 'leading_edge') {
    tileXnext =
      dx >= 0
        ? Math.floor((nextX + TILE_SIZE * LEADING_EDGE_FRONT) / TILE_SIZE)
        : Math.floor((nextX + TILE_SIZE * LEADING_EDGE_BACK) / TILE_SIZE);
  } else {
    tileXnext = Math.floor((nextX + TILE_SIZE * CENTER_COLLISION_OFFSET) / TILE_SIZE);
  }
  const tileYcur = Math.floor((entity.y + TILE_SIZE * CENTER_COLLISION_OFFSET) / TILE_SIZE);
  if (map.isWalkable(tileXnext, tileYcur)) entity.x = nextX;

  const nextY = clamp(entity.y + dy, 0, mapPxH - TILE_SIZE);
  const tileXcur = Math.floor((entity.x + TILE_SIZE * CENTER_COLLISION_OFFSET) / TILE_SIZE);
  const tileYnext = Math.floor((nextY + TILE_SIZE * CENTER_COLLISION_OFFSET) / TILE_SIZE);
  if (map.isWalkable(tileXcur, tileYnext)) entity.y = nextY;
}
