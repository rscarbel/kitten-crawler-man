#!/usr/bin/env tsx
/**
 * A room can pass every reachability/anchor/breakable check and still be a
 * bare dirt floor with furniture pushed against the walls — nothing above
 * checks *how much* of the floor is actually dressed. This computes, for
 * every named town interior, the largest square of contiguous "empty" floor
 * (walkable tiles that carry no placed prop's footprint and no legacy
 * furniture tile) and fails if any room has one bigger than
 * `MAX_EMPTY_SQUARE_TILES`.
 *
 * "Not within one tile of the doorway" is approximated as a ring around the
 * room's own entrance (`map.startTile`): a player's first few steps into a
 * room are always open ground by construction (nothing is placed flush
 * against the door), and penalising that unavoidable clearing would make the
 * gate impossible to satisfy near any entrance. A long, narrow walking lane
 * elsewhere in a room is unaffected by this exemption and is never flagged
 * by the square check anyway — a lane one or two tiles wide cannot contain a
 * square bigger than the gate's own floor.
 *
 *   npm run verify:interior-density
 */

import { GameMap } from '../src/map/GameMap.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { createTownPlan, type BuildingKind } from '../src/map/town/townPlan.js';
import { TOWN_INTERIOR_PROPS } from '../src/sprites/art/townInterior/townInteriorProps.js';
import { NAMED_INTERIOR_LAYOUTS } from '../src/map/town/interiors/index.js';

let failures = 0;
function check(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  console.log(` FAIL  ${label}`);
  failures++;
}

/** The largest legal empty square, in tiles per side — anything bigger reads as bare floor, not a walking lane. */
const MAX_EMPTY_SQUARE_TILES = 4;
/** Chebyshev radius around the entrance exempted from the check (see file doc comment). */
const DOORWAY_EXEMPTION_RADIUS_TILES = 1;

const PLAN_SIZE = 5;
const plan = createTownPlan(PLAN_SIZE);
const buildingKindByName = new Map(plan.buildings.map((b) => [b.name, b.kind]));

function buildInterior(name: string, kind: BuildingKind): GameMap {
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  map.generateInterior(kind, 0, name, false);
  return map;
}

/** Every tile a placed prop's own footprint covers, whether or not that prop blocks movement — a walkable rug still dresses the tile it sits on. */
function furnishedTiles(map: GameMap): Set<string> {
  const furnished = new Set<string>();
  for (const placed of map.placedInteriorProps) {
    const footprint = TOWN_INTERIOR_PROPS[placed.propId].footprint;
    for (let dy = 0; dy < footprint.h; dy++)
      for (let dx = 0; dx < footprint.w; dx++)
        furnished.add(`${placed.tile.x + dx},${placed.tile.y + dy}`);
  }
  return furnished;
}

/** The side length of the largest all-empty square with its top-left corner at `(x, y)`, via the standard maximal-square DP. */
function largestEmptySquare(
  isEmpty: (x: number, y: number) => boolean,
  width: number,
  height: number,
): number {
  const dp: number[][] = Array.from({ length: height }, () => new Array<number>(width).fill(0));
  let best = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isEmpty(x, y)) continue;
      if (x === 0 || y === 0) {
        dp[y][x] = 1;
      } else {
        dp[y][x] = Math.min(dp[y - 1][x], dp[y][x - 1], dp[y - 1][x - 1]) + 1;
      }
      best = Math.max(best, dp[y][x]);
    }
  }
  return best;
}

function checkRoomDensity(name: string, kind: BuildingKind): void {
  const map = buildInterior(name, kind);
  const furnished = furnishedTiles(map);
  const start = map.startTile;
  const height = map.structure.length;
  const width = map.structure[0].length;

  const isEmpty = (x: number, y: number): boolean => {
    if (!map.isWalkable(x, y)) return false;
    if (furnished.has(`${x},${y}`)) return false;
    const dx = Math.abs(x - start.x);
    const dy = Math.abs(y - start.y);
    if (Math.max(dx, dy) <= DOORWAY_EXEMPTION_RADIUS_TILES) return false;
    return true;
  };

  const largest = largestEmptySquare(isEmpty, width, height);
  check(
    largest <= MAX_EMPTY_SQUARE_TILES,
    `"${name}" has no empty floor square bigger than ${MAX_EMPTY_SQUARE_TILES}x${MAX_EMPTY_SQUARE_TILES} (found ${largest}x${largest})`,
  );
}

// Only the interiors with an authored layout — a generic, un-named house
// uses the framework's own placeholder furniture pass, and this gate is
// about density this codebase actually chose, not about every auto-generated
// house in a 200-house overworld.
console.log('Largest empty floor square per named interior\n');
const namedRoomNames = new Set<string>([...NAMED_INTERIOR_LAYOUTS.keys(), 'General Store']);
for (const name of namedRoomNames) {
  const kind = buildingKindByName.get(name);
  check(kind !== undefined, `"${name}" is a building the town plan places`);
  if (kind !== undefined) checkRoomDensity(name, kind);
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failing check(s)`);
process.exit(failures === 0 ? 0 : 1);
