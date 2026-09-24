import { ARENA_MUD, KRAKAREN_WADE, LAB_WEB } from './tileTypes';

/** Share of walking pace a crawler keeps in the Krakaren lab's shallow flood. */
export const KRAKAREN_WADE_SPEED_FACTOR = 0.8;
/** Share of walking pace a crawler keeps on the spider lab's webbing. */
export const LAB_WEB_SPEED_FACTOR = 0.7;
/** Share of walking pace a crawler keeps in the colosseum's mud wallows. */
export const ARENA_MUD_SPEED_FACTOR = 0.75;

/**
 * Ground that slows a crawler walking across it, by tile type. Any tile type
 * not listed is walked at full pace.
 *
 * The river is not here: it is decided by `GameMap.isWadeable`, which also
 * honours block flags, and it drives the submerged rendering and splashes as
 * well as the pace.
 *
 * Every entry is a hazard in its own right. A room that lays one down must keep
 * it off the doorway approach, and every attack in that room must still be
 * escapable from it at this pace.
 */
const TILE_SPEED_FACTORS: ReadonlyMap<number, number> = new Map([
  [KRAKAREN_WADE, KRAKAREN_WADE_SPEED_FACTOR],
  [LAB_WEB, LAB_WEB_SPEED_FACTOR],
  [ARENA_MUD, ARENA_MUD_SPEED_FACTOR],
]);

/** The share of walking pace a crawler keeps on this tile type; 1 for ordinary ground. */
export function tileSpeedFactor(tileType: number): number {
  return TILE_SPEED_FACTORS.get(tileType) ?? 1;
}

/** The slowest pace any ground leaves a crawler, for gates that must pass at the worst case. */
export function slowestTileSpeedFactor(): number {
  return Math.min(1, ...TILE_SPEED_FACTORS.values());
}
