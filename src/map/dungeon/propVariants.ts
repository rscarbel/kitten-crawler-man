/**
 * Which look the dungeon's long-standing breakable props wear on a given tile
 * and floor.
 *
 * A barrel, crate, bookshelf, torch and brazier are one tile type each on every
 * floor, so collision, placement and destruction never need to know which
 * floor they are on. What differs is the picture — oak in the cellars, steel
 * and plastic on the service level — and that is chosen here, at draw time,
 * from the active floor theme. The look within a floor (one of
 * `PROP_VARIANT_COUNT` seeded variants) and whether a service-level drum holds
 * oil are both pure functions of the tile, so the standing prop, its wreckage
 * and the destruction code that reads its contents all agree without storing
 * anything on the tile.
 */

import { PROP_VARIANT_COUNT } from '../../sprites/art/propPaint';
import { BONE_SCATTER_VARIANTS } from '../../sprites/art/remainsArt';
import { tileHash, tileHash01 } from '../tiles/hollowTileHash';
import { dungeonFloorTheme } from './floorTheme';

const VARIANT_SALT = 0x5b17;
const OIL_SALT = 0x0e11;
const SCATTER_SALT = 0x8b03;

/**
 * The share of the service level's drums that are oil drums. Enough that a
 * player who has seen one burn learns to look for the yellow band, few enough
 * that most rooms carry none.
 */
export const OIL_DRUM_SHARE = 0.3;

/** Which of a static prop's seeded looks stands on this tile, intact or broken. */
export function propVariantIndex(tileX: number, tileY: number): number {
  return tileHash(tileX, tileY, VARIANT_SALT) % PROP_VARIANT_COUNT;
}

/** Which look of the walkable bone scatter lies on this tile. */
export function boneScatterVariant(tileX: number, tileY: number): number {
  return tileHash(tileX, tileY, SCATTER_SALT) % BONE_SCATTER_VARIANTS;
}

/** Whether the props on this floor are the service level's steel and plastic versions. */
export function onServiceLevel(): boolean {
  return dungeonFloorTheme().id === 'service_level';
}

/**
 * Whether the upright barrel on this tile is an oil drum. Only ever true on
 * the service level; the cellars' barrels hold wine and water. Breaking one
 * leaves an oil spill that a flame can set alight.
 */
export function isOilDrum(tileX: number, tileY: number): boolean {
  return onServiceLevel() && tileHash01(tileX, tileY, OIL_SALT) < OIL_DRUM_SHARE;
}
