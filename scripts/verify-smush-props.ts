#!/usr/bin/env tsx
/**
 * Headless gate: a Smush stomp flattens every breakable prop in its radius,
 * even a crate standing directly behind another one — and, separately, a real
 * wall still shadows a sapling on the far side of it.
 *
 * Regression target: `damagePropsInRange`'s line-of-sight test used to run
 * unchanged for a smush's instant-destroy pass, so a prop shielded by another
 * breakable prop survived the stomp that took out the one in front of it.
 * `TreeSystem.destroyInRadius` (dynamite) skips line of sight entirely, which
 * is correct for a blast but wrong for a smush: `TreeSystem.smashAllInRadius`
 * must see through a tree or a breakable prop but not through a wall.
 *
 * Every map here is a hand-built flat floor (`prebuiltStructure`), never the
 * procedural dungeon generator: `new GameMap({ mapSize, tileHeight })` with no
 * `worldSeed` draws a fresh random one on every run, so a test built against
 * whatever room shape that seed happens to produce would pass or fail by luck
 * rather than by the code under test.
 *
 * Run: npm run verify:smush-props
 */

import { TILE_SIZE } from '../src/core/constants';
import { GameMap } from '../src/map/GameMap';
import {
  CRATE,
  BARREL,
  TREE,
  BUILDING_WALL,
  TREE_STAGE_FELLING,
  TREE_STAGE_FELLING_CHARRED,
  FloorTypeValue,
  type TileContent,
} from '../src/map/tileTypes';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { LootSystem } from '../src/systems/LootSystem';
import { DestructiblePropSystem } from '../src/systems/DestructiblePropSystem';
import { TreeSystem } from '../src/systems/TreeSystem';

const GRID_SIZE = 40;
const FLOOR_NUMBER = 1;

/** A flat, fully walkable floor with nothing on it — the neutral ground every check below builds on. */
function makeFlatFloor(): TileContent[][] {
  return Array.from({ length: GRID_SIZE }, (_, y) =>
    Array.from({ length: GRID_SIZE }, (_, x) => ({
      tileId: `${x}#${y}`,
      type: FloorTypeValue.tile_floor,
    })),
  );
}

function buildFlatMap(): GameMap {
  return new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: makeFlatFloor() });
}

/** Centre tile of the 3x3 cluster, well clear of the map edge. */
const CLUSTER_CENTER_TILE = 20;
/**
 * The crawler stands this many tiles south of the cluster's centre — props are
 * unwalkable, so nothing can stand inside the cluster itself, and a swing at
 * the game's own smush distances always comes from outside the props it hits.
 */
const CRAWLER_TILES_SOUTH_OF_CLUSTER = 2;
/** Wide enough to reach every corner of the 3x3 cluster from the crawler's stance. */
const SMASH_RADIUS_TILES = 4;
const SMASH_RADIUS = TILE_SIZE * SMASH_RADIUS_TILES;

function verifyPropCluster(): boolean {
  const gameMap = buildFlatMap();
  const loot = new LootSystem(gameMap);
  const destructibles = new DestructiblePropSystem(gameMap, loot, FLOOR_NUMBER);

  let placed = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tx = CLUSTER_CENTER_TILE + dx;
      const ty = CLUSTER_CENTER_TILE + dy;
      // Alternate kinds so the fix isn't only proven against one prop type.
      gameMap.structure[ty][tx].type = (dx + dy) % 2 === 0 ? CRATE : BARREL;
      placed++;
    }
  }

  const human = new HumanPlayer(
    CLUSTER_CENTER_TILE,
    CLUSTER_CENTER_TILE + CRAWLER_TILES_SOUTH_OF_CLUSTER,
    TILE_SIZE,
  );

  const hitAnything = destructibles.smashAllInRadius(human, SMASH_RADIUS);
  if (!hitAnything) {
    console.error('FAIL: smashAllInRadius reported no hit, expected the whole cluster to break');
    return false;
  }

  let remaining = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tx = CLUSTER_CENTER_TILE + dx;
      const ty = CLUSTER_CENTER_TILE + dy;
      const type = gameMap.structure[ty][tx].type;
      if (type === CRATE || type === BARREL) remaining++;
    }
  }

  if (remaining > 0) {
    console.error(
      `FAIL: ${remaining} of ${placed} props in the 3x3 cluster survived a single smush`,
    );
    return false;
  }

  console.log(`PASS: one smush cleared all ${placed} crates and barrels in the 3x3 cluster`);
  return true;
}

/** Tile the crawler stands on for the tree/wall check, well clear of the map edge and the prop cluster. */
const TREE_TEST_CRAWLER_TILE_X = 20;
const TREE_TEST_CRAWLER_TILE_Y = 10;
/** Tiles north of the crawler to the open sapling, directly in reach with nothing between them. */
const OPEN_SAPLING_TILES_NORTH = 2;
/** Tiles north of the crawler to the wall, and to the sapling standing right behind it. */
const WALL_TILES_NORTH = 1;
const WALLED_SAPLING_TILES_NORTH = 2;
/** Wide enough to reach both saplings, matched to the prop cluster's own radius. */
const TREE_SMASH_RADIUS = TILE_SIZE * SMASH_RADIUS_TILES;

/**
 * A sapling behind a real wall must survive a smash that reaches an identical
 * sapling standing in the open at the same distance — `smashAllInRadius` sees
 * through trees and breakable props, never through masonry.
 */
function verifyTreeWallBlocking(): boolean {
  const gameMap = buildFlatMap();
  const loot = new LootSystem(gameMap);
  const trees = new TreeSystem(gameMap, loot, FLOOR_NUMBER);

  const openTileX = TREE_TEST_CRAWLER_TILE_X;
  const openTileY = TREE_TEST_CRAWLER_TILE_Y - OPEN_SAPLING_TILES_NORTH;
  const wallTileX = TREE_TEST_CRAWLER_TILE_X + 1;
  const wallTileY = TREE_TEST_CRAWLER_TILE_Y - WALL_TILES_NORTH;
  const walledTileX = TREE_TEST_CRAWLER_TILE_X + 1;
  const walledTileY = TREE_TEST_CRAWLER_TILE_Y - WALLED_SAPLING_TILES_NORTH;

  gameMap.structure[openTileY][openTileX].type = TREE;
  gameMap.structure[wallTileY][wallTileX].type = BUILDING_WALL;
  gameMap.structure[walledTileY][walledTileX].type = TREE;

  const human = new HumanPlayer(TREE_TEST_CRAWLER_TILE_X, TREE_TEST_CRAWLER_TILE_Y, TILE_SIZE);

  trees.smashAllInRadius(human, TREE_SMASH_RADIUS);

  // Instant-destroy damage starts a tree falling on the same frame
  // (`beginFelling`) rather than removing its tile outright — `treeStage`
  // flips to a felling stage immediately, well before the multi-frame
  // collapse animation `TreeSystem.update` would need to run finishes it.
  const isFelling = (stage: number | undefined): boolean =>
    stage === TREE_STAGE_FELLING || stage === TREE_STAGE_FELLING_CHARRED;
  const openIsFelling = isFelling(gameMap.structure[openTileY][openTileX].treeStage);
  const walledIsFelling = isFelling(gameMap.structure[walledTileY][walledTileX].treeStage);

  if (!openIsFelling) {
    console.error(
      'FAIL: the open sapling survived a smash that reached it with nothing in the way',
    );
    return false;
  }
  if (walledIsFelling) {
    console.error(
      'FAIL: the sapling behind a wall was destroyed; the wall should have shadowed it',
    );
    return false;
  }

  console.log('PASS: a smash destroys an open sapling but a real wall still shadows one behind it');
  return true;
}

function main(): void {
  const propsOk = verifyPropCluster();
  const treesOk = verifyTreeWallBlocking();
  if (!propsOk || !treesOk) process.exit(1);
}

main();
