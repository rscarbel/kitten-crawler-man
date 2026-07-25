/**
 * The canonical string key for a tile coordinate. Shared so systems that trade
 * "already taken" tile sets with each other (`TownPropSystem` and
 * `MarketSystem`) can't drift into two incompatible key formats.
 */
export function tileKey(tileX: number, tileY: number): string {
  return `${tileX},${tileY}`;
}
