/**
 * Clearing a tile for a body that is about to appear on it: whoever friendly
 * is standing there is set down on the nearest ground they can operate on, so
 * a respawn never lands inside anybody.
 */

import { TILE_SIZE } from '../../core/constants';
import type { Mob } from '../../creatures/Mob';
import type { Player } from '../../Player';
import type { GameMap } from '../../map/GameMap';
import { findNearbyWalkableTile } from '../../map/findWalkableTile';
import type { TilePoint } from '../../map/town/townPlan';
import type { MobRoster } from '../kits/SceneWorld';

/** How far from the respawn tile, in tiles, a displaced body may be set down. */
const CLEARANCE_SEARCH_TILES = 6;

export interface RespawnClearanceDeps {
  readonly gameMap: GameMap;
  readonly roster: MobRoster;
  /** The party's crawlers, active or not: a downed one still has a place to be. */
  readonly crawlers: readonly Player[];
}

function overlapsTile(body: { x: number; y: number }, tile: TilePoint): boolean {
  return (
    Math.abs(body.x - tile.x * TILE_SIZE) < TILE_SIZE &&
    Math.abs(body.y - tile.y * TILE_SIZE) < TILE_SIZE
  );
}

/**
 * Sets every crawler and every non-hostile living mob (Mongo, hired
 * mercenaries, other allies) that overlaps `tile` down on the nearest walkable
 * tile with room to move. A body that finds no such tile within
 * {@link CLEARANCE_SEARCH_TILES} is left where it is.
 *
 * A mob goes through `shoveTo`, so one that must stay on its own ground (a
 * penned cow) is only ever set down on ground it accepts, and its place in
 * the mob grid moves with it.
 */
export function clearRespawnTile(
  deps: RespawnClearanceDeps,
  tile: TilePoint,
  respawning: Mob,
): void {
  const notTheRespawnTile = (x: number, y: number): boolean => x !== tile.x || y !== tile.y;

  for (const crawler of deps.crawlers) {
    if (!overlapsTile(crawler, tile)) continue;
    const landing = findNearbyWalkableTile(
      deps.gameMap,
      tile.x,
      tile.y,
      CLEARANCE_SEARCH_TILES,
      notTheRespawnTile,
    );
    if (landing === null) continue;
    crawler.x = landing.x * TILE_SIZE;
    crawler.y = landing.y * TILE_SIZE;
  }

  for (const mob of deps.roster.mobs) {
    if (mob === respawning || !mob.isAlive || mob.isHostile) continue;
    if (!overlapsTile(mob, tile)) continue;
    const landing = findNearbyWalkableTile(
      deps.gameMap,
      tile.x,
      tile.y,
      CLEARANCE_SEARCH_TILES,
      (x, y) => notTheRespawnTile(x, y) && mob.canBeShovedTo(x * TILE_SIZE, y * TILE_SIZE),
    );
    if (landing === null) continue;
    const previousX = mob.x;
    const previousY = mob.y;
    mob.shoveTo(landing.x * TILE_SIZE, landing.y * TILE_SIZE);
    deps.roster.grid.move(mob, previousX, previousY);
  }
}
