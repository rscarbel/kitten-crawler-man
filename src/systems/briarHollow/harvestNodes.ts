/**
 * Which tiles can be harvested, how much each holds, and what is left when one
 * runs out.
 *
 * A node is a tile, not an entity: standing trees, boulders and rock deposits
 * anywhere on the overworld. Its capacity is rolled the first time anyone works
 * it and kept in `BriarHollowState.nodes`, which is threaded by reference
 * across door visits, so leaving a half-chopped tree for a shop and coming back
 * never refills it.
 */

import type { GameMap } from '../../map/GameMap';
import {
  BOULDER_LARGE,
  BOULDER_SMALL,
  PEBBLE_SCATTER,
  PROP_DAMAGE_STAGE_CRACKED,
  ROCK_DEPOSIT,
  RUBBLE,
  TREE,
  TREE_STAGE_DAMAGED,
  TREE_STAGE_HEALTHY,
  type TileContent,
} from '../../map/tileTypes';
import { inferFloorType } from '../../map/tiles/helpers';
import type { HarvestKind } from '../../core/craftPerks';
import type { HarvestNodeState } from '../../core/briarHollowState';

/** Harvests a tree holds, fewest and most. */
export const TREE_HARVESTS_MIN = 5;
export const TREE_HARVESTS_MAX = 15;
/** Harvests a rock holds, fewest and most. */
export const ROCK_HARVESTS_MIN = 20;
export const ROCK_HARVESTS_MAX = 50;

/**
 * Rock tiles a pickaxe works. River rocks, ruined walls and cliffs are world
 * structure — breaking them would open walls and ford rivers — so only loose
 * boulders and exposed deposits qualify.
 */
const STONE_NODE_TYPES: ReadonlySet<number> = new Set([BOULDER_SMALL, BOULDER_LARGE, ROCK_DEPOSIT]);

/**
 * A tree can be chopped while it stands whole or cracked. A burning tree is a
 * hazard rather than timber, a charred one has nothing left worth taking, and
 * one already coming down is an animation.
 */
function isStandingTree(tile: TileContent): boolean {
  const stage = tile.treeStage ?? TREE_STAGE_HEALTHY;
  return stage === TREE_STAGE_HEALTHY || stage === TREE_STAGE_DAMAGED;
}

/** What a tile yields when worked, or null for a tile that is not a node. */
export function harvestKindOfTile(tile: TileContent): HarvestKind | null {
  if (tile.type === TREE) return isStandingTree(tile) ? 'wood' : null;
  if (STONE_NODE_TYPES.has(tile.type)) return 'stone';
  return null;
}

/** {@link harvestKindOfTile} at a map position; null off the map. */
export function harvestKindAt(gameMap: GameMap, tileX: number, tileY: number): HarvestKind | null {
  const tile = tileAt(gameMap, tileX, tileY);
  return tile === null ? null : harvestKindOfTile(tile);
}

/** The tile at a map position, or null off the map. */
export function tileAt(gameMap: GameMap, tileX: number, tileY: number): TileContent | null {
  const structure = gameMap.structure;
  if (tileY < 0 || tileY >= structure.length) return null;
  const row = structure[tileY];
  if (tileX < 0 || tileX >= row.length) return null;
  return row[tileX];
}

/** Uniform integer in [min, max] from a [0, 1) source. */
function rollInclusive(min: number, max: number, rng: () => number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/**
 * A fresh node's state: its capacity rolled, nothing yet taken.
 * `capacityBonus` is the first worker's Resourcing perk, added on top of the roll.
 */
export function createNodeState(
  kind: HarvestKind,
  tileX: number,
  tileY: number,
  tileType: number,
  rng: () => number,
  capacityBonus: number,
): HarvestNodeState {
  const rolled =
    kind === 'wood'
      ? rollInclusive(TREE_HARVESTS_MIN, TREE_HARVESTS_MAX, rng)
      : rollInclusive(ROCK_HARVESTS_MIN, ROCK_HARVESTS_MAX, rng);
  const capacity = rolled + capacityBonus;
  return {
    kind,
    tileX,
    tileY,
    capacity,
    remaining: capacity,
    tileType,
    regrowTicksLeft: null,
    sapling: false,
  };
}

/** Below this share of its capacity a deposit shows its worked-over look. */
export const WORKED_CAPACITY_FRACTION = 0.5;

/**
 * Brings a deposit's look in line with how much it has left: worked over once
 * it is below half, intact otherwise. Only deposits have a worked look; the
 * stage rides on the tile because the tile renderer reads nothing else.
 */
export function syncWornLook(gameMap: GameMap, state: HarvestNodeState): void {
  const tile = tileAt(gameMap, state.tileX, state.tileY);
  if (tile?.type !== ROCK_DEPOSIT) return;
  const worn = state.remaining > 0 && state.remaining < state.capacity * WORKED_CAPACITY_FRACTION;
  if (worn) tile.damageStage = PROP_DAMAGE_STAGE_CRACKED;
  else delete tile.damageStage;
}

/** The ground a rock leaves behind: a deposit breaks into rubble, a boulder into loose stones. */
function remainsOf(rockType: number): number {
  return rockType === ROCK_DEPOSIT ? RUBBLE : PEBBLE_SCATTER;
}

/** The eight neighbours and the tile itself, for invalidating art that blends with its neighbours. */
const NEIGHBOURHOOD_OFFSETS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [0, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/**
 * Re-bakes a tile and its whole neighbourhood: ground tiles blend their edges
 * with their neighbours, so a rock turning into scree changes the art of the
 * eight tiles round it too.
 */
function markNeighbourhoodDirty(gameMap: GameMap, tileX: number, tileY: number): void {
  for (const [dx, dy] of NEIGHBOURHOOD_OFFSETS) gameMap.markTileDirty(tileX + dx, tileY + dy);
}

/**
 * Crumbles a worked-out rock. The remains stand on the surface the rock was
 * set on — recorded as `groundType` when the rock was placed, inferred from
 * the neighbours when it was not — so the ground under it reads as the ground
 * around it.
 */
export function crumbleRock(
  gameMap: GameMap,
  tileX: number,
  tileY: number,
  onTileChanged: (tileX: number, tileY: number) => void,
): void {
  const tile = tileAt(gameMap, tileX, tileY);
  if (tile === null || !STONE_NODE_TYPES.has(tile.type)) return;
  tile.groundType ??= inferFloorType(gameMap.structure, tileX, tileY);
  tile.type = remainsOf(tile.type);
  markNeighbourhoodDirty(gameMap, tileX, tileY);
  onTileChanged(tileX, tileY);
}

/** Stands a crumbled rock back up, for a checkpoint rewound to before it broke. */
export function restoreRock(
  gameMap: GameMap,
  tileX: number,
  tileY: number,
  rockType: number,
  onTileChanged: (tileX: number, tileY: number) => void,
): void {
  const tile = tileAt(gameMap, tileX, tileY);
  if (tile === null || tile.type === rockType) return;
  tile.type = rockType;
  markNeighbourhoodDirty(gameMap, tileX, tileY);
  onTileChanged(tileX, tileY);
}

/**
 * Stands a tree back up on a felled tile, recording the ground it grew from
 * the way a planted tree does. A planted `spriteKey` survives felling, so a
 * grove tree comes back as the species that stood there.
 */
export function regrowTree(
  gameMap: GameMap,
  tileX: number,
  tileY: number,
  onTileChanged: (tileX: number, tileY: number) => void,
): void {
  const tile = tileAt(gameMap, tileX, tileY);
  if (tile === null || tile.type === TREE) return;
  tile.groundType = tile.type;
  tile.type = TREE;
  delete tile.treeStage;
  delete tile.treeAnimFrame;
  markNeighbourhoodDirty(gameMap, tileX, tileY);
  onTileChanged(tileX, tileY);
}

/**
 * Takes a regrown tree away again, with no fall and no stump, for a
 * checkpoint rewound to before it grew back.
 */
export function unplantTree(
  gameMap: GameMap,
  tileX: number,
  tileY: number,
  onTileChanged: (tileX: number, tileY: number) => void,
): void {
  const tile = tileAt(gameMap, tileX, tileY);
  if (tile?.type !== TREE) return;
  tile.type = tile.groundType ?? inferFloorType(gameMap.structure, tileX, tileY);
  delete tile.groundType;
  delete tile.treeStage;
  delete tile.treeAnimFrame;
  markNeighbourhoodDirty(gameMap, tileX, tileY);
  onTileChanged(tileX, tileY);
}
