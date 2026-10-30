/**
 * The per-tile rule for overworld spawns placed beside a spawn point, shared by
 * the ambient spawner and the fairy spawner.
 */

import type { GameMap } from '../map/GameMap';
import { TILE_SIZE } from '../core/constants';
import { hasRoomToMove } from '../map/findWalkableTile';
import { RUINS_CIRCUS_BUFFER } from '../map/OverworldGenerator';

/**
 * Whether a mob placed beside an overworld spawn point (a scattered fairy, a
 * swarm's escort) may stand on this tile: open ground with room to move,
 * outside the town wall and its safe radius, clear of Briar Hollow and of the
 * circus grounds. Re-asserted per tile because a spawn point already clear of
 * all of them can have a neighbour that is not.
 */
export function isOverworldSpawnTileAllowed(map: GameMap, tileX: number, tileY: number): boolean {
  if (!map.isWalkable(tileX, tileY, 'walker') || !hasRoomToMove(map, tileX, tileY)) return false;
  if (map.isTileInsideTownWall(tileX, tileY)) return false;
  if (map.isInTownSafeZone(tileX * TILE_SIZE, tileY * TILE_SIZE)) return false;
  if (map.isTileInBriarHollowSpawnExclusion(tileX, tileY)) return false;
  const circus = map.circusCentre;
  const circusRadius = map.circusRadiusTiles;
  if (circus !== undefined && circusRadius !== undefined) {
    const reach = circusRadius + RUINS_CIRCUS_BUFFER;
    if (Math.hypot(tileX - circus.x, tileY - circus.y) <= reach) return false;
  }
  return true;
}
