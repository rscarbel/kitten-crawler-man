/**
 * Where the resource HUD stays up on its own: places whose whole point is
 * gathering or spending materials.
 *
 * A zone is a predicate on the active crawler, and the HUD's test is the OR of
 * every zone, so each owner adds its own without touching the others': the
 * village's work yards live here, and the palisade's building ring is another
 * test composed in beside them with {@link anyResourceZone}.
 */

import { TILE_SIZE } from '../../core/constants';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { GameMap } from '../../map/GameMap';
import type { VillageDistrictId } from '../../map/overworld/briarHollowSite';
import { HARVEST_REACH_TILES } from './HarvestSystem';

type Crawler = HumanPlayer | CatPlayer;

/** Whether the active crawler is somewhere the HUD should stay up. */
export type ResourceZoneTest = (active: Crawler) => boolean;

/** The districts where materials are gathered. */
const GATHERING_DISTRICTS: ReadonlySet<VillageDistrictId> = new Set(['lumber_yard', 'quarry']);

const HALF_TILE = 0.5;

/** The centre of the crawler's tile-sized body, which decides the tile it is on. */
function centreOf(crawler: Crawler, tileSize: number): { x: number; y: number } {
  return { x: crawler.x + tileSize * HALF_TILE, y: crawler.y + tileSize * HALF_TILE };
}

/**
 * The lumber yard district, widened to every spot a crawler can fell a grove
 * tree from. The grove's first row is the district's first row, so the
 * district alone misses anyone chopping from the north or from beside the end
 * trees.
 */
export function isAtLumberYard(gameMap: GameMap, worldX: number, worldY: number): boolean {
  if (gameMap.briarHollowDistrictAt(worldX, worldY) === 'lumber_yard') return true;
  const groveTiles = gameMap.briarHollow?.lumberYard.groveTiles ?? [];
  const reachPx = HARVEST_REACH_TILES * TILE_SIZE;
  return groveTiles.some((tree) => {
    const treeCentreX = (tree.x + HALF_TILE) * TILE_SIZE;
    const treeCentreY = (tree.y + HALF_TILE) * TILE_SIZE;
    return Math.hypot(treeCentreX - worldX, treeCentreY - worldY) <= reachPx;
  });
}

/** True while the active crawler is at the lumber yard (chop reach included) or in the quarry. */
export function inGatheringDistrict(gameMap: GameMap): ResourceZoneTest {
  return (active) => {
    const centre = centreOf(active, gameMap.tileHeight);
    if (isAtLumberYard(gameMap, centre.x, centre.y)) return true;
    const district = gameMap.briarHollowDistrictAt(centre.x, centre.y);
    return district !== null && GATHERING_DISTRICTS.has(district);
  };
}

/** True when any of the given zones holds. */
export function anyResourceZone(...zones: readonly ResourceZoneTest[]): ResourceZoneTest {
  return (active) => zones.some((zone) => zone(active));
}

/** How close to the palisade the HUD stays up: near enough to be working on the walls. */
export const PALISADE_ZONE_TILES = 4;

/** True while the active crawler is within a few tiles of any palisade segment, gate excluded. */
export function nearPalisade(gameMap: GameMap): ResourceZoneTest {
  return (active) => {
    const centre = centreOf(active, gameMap.tileHeight);
    return gameMap.isNearPalisade(centre.x, centre.y, PALISADE_ZONE_TILES);
  };
}
