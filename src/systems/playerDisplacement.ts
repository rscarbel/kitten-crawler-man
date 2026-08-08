/**
 * playerDisplacement — shared per-axis wall-collision push for the player.
 *
 * Used both by mob/player separation (MobUpdateLoop) and by hit-driven
 * knockback (GameLoopPhases), so the two displacement sources share one
 * collision rule instead of drifting apart.
 */

import { TILE_SIZE } from '../core/constants';
import type { GameMap } from '../map/GameMap';
import { CENTER_COLLISION_OFFSET, verticalCollisionOffset } from '../map/collisionAnchors';

const LEADING_EDGE_FRONT = 0.72;
const LEADING_EDGE_BACK = 0.28;

/**
 * Pushes a player by (dx, dy) with per-axis wall collision, mirroring
 * Mob.moveWithCollision so mobs act as solid obstacles for the player.
 */
export function pushPlayerWithCollision(
  player: { x: number; y: number },
  dx: number,
  dy: number,
  map: GameMap,
): void {
  const ts = TILE_SIZE;
  if (dx !== 0) {
    const nextX = player.x + dx;
    const tileXnext =
      dx >= 0
        ? Math.floor((nextX + ts * LEADING_EDGE_FRONT) / ts)
        : Math.floor((nextX + ts * LEADING_EDGE_BACK) / ts);
    const tileYcur = Math.floor((player.y + ts * CENTER_COLLISION_OFFSET) / ts);
    if (map.isWalkable(tileXnext, tileYcur)) player.x = nextX;
  }
  if (dy !== 0) {
    const nextY = player.y + dy;
    const tileXcur = Math.floor((player.x + ts * CENTER_COLLISION_OFFSET) / ts);
    const tileYnext = Math.floor((nextY + ts * verticalCollisionOffset(dy)) / ts);
    if (map.isWalkable(tileXcur, tileYnext)) player.y = nextY;
  }
}
