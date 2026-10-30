/**
 * playerDisplacement — shared per-axis wall-collision push for the player.
 *
 * Used both by mob/player separation (MobUpdateLoop) and by hit-driven
 * knockback (GameLoopPhases), so the two displacement sources share one
 * collision rule instead of drifting apart.
 */

import { TILE_SIZE } from '../core/constants';
import type { GameMap } from '../map/GameMap';
import type { MobilityClass } from '../map/mobility';
import { CENTER_COLLISION_OFFSET, verticalCollisionOffset } from '../map/collisionAnchors';

const LEADING_EDGE_FRONT = 0.72;
const LEADING_EDGE_BACK = 0.28;

/**
 * Pushes a player by (dx, dy) with per-axis wall collision, mirroring
 * Mob.moveWithCollision so mobs act as solid obstacles for the player.
 *
 * A shove never carries a crawler onto another footing (floor to ledge, ledge
 * to gap): it stops at the footing's edge as it would at a wall, since only a
 * climber's own hop or squeeze moves her between footings. A body mid-hop is
 * not shoved at all: the hop carries her, and she is shoved once it lands on
 * the footing it was going to.
 */
export function pushPlayerWithCollision(
  player: { x: number; y: number; readonly isCrossingFooting: boolean },
  dx: number,
  dy: number,
  map: GameMap,
  mobility: MobilityClass,
): void {
  if (player.isCrossingFooting) return;
  const ts = TILE_SIZE;
  if (dx !== 0) {
    const nextX = player.x + dx;
    const probeX = nextX + ts * (dx >= 0 ? LEADING_EDGE_FRONT : LEADING_EDGE_BACK);
    const rowY = player.y + ts * CENTER_COLLISION_OFFSET;
    if (mayDisplaceOnto(player, probeX, rowY, map, mobility)) player.x = nextX;
  }
  if (dy !== 0) {
    const nextY = player.y + dy;
    const columnX = player.x + ts * CENTER_COLLISION_OFFSET;
    const probeY = nextY + ts * verticalCollisionOffset(dy);
    if (mayDisplaceOnto(player, columnX, probeY, map, mobility)) player.y = nextY;
  }
}

function mayDisplaceOnto(
  player: { x: number; y: number },
  probeX: number,
  probeY: number,
  map: GameMap,
  mobility: MobilityClass,
): boolean {
  if (!map.isCrawlerWalkableAt(probeX, probeY, mobility)) return false;
  const centreTileX = Math.floor((player.x + TILE_SIZE * CENTER_COLLISION_OFFSET) / TILE_SIZE);
  const centreTileY = Math.floor((player.y + TILE_SIZE * CENTER_COLLISION_OFFSET) / TILE_SIZE);
  const footingHere = map.footingAt(centreTileX, centreTileY);
  const footingThere = map.footingAt(
    Math.floor(probeX / TILE_SIZE),
    Math.floor(probeY / TILE_SIZE),
  );
  return footingHere === footingThere;
}
