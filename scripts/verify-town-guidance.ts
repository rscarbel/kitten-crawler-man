#!/usr/bin/env tsx
/**
 * Headless checks on the town's wayfinding: that every building entrance can be
 * walked into across the whole of its own opening, and that the north gate is a
 * gate rather than a hole in a wall.
 *
 * Both guard failures that are invisible without walking the map. A doorway the
 * entry menu keys off one column of is a building the player stands squarely in
 * front of and is never offered — nothing logs, nothing looks wrong, and the
 * only symptom is a playtester saying the door "sometimes" works. A gate whose
 * corridor is sealed by a prop, or whose opening is not walkable, reads as a
 * gate from either side and is a dead end.
 *
 * Generation is unseeded (`Math.random()` throughout), so the map-shaped checks
 * run over a batch rather than over one lucky draw.
 *
 * Run: npm run verify:town
 */

import { GameMap } from '../src/map/GameMap';
import type { BuildingEntry } from '../src/map/OverworldGenerator';
import { getSpriteDoorwayByKey, type SpriteManifestEntry } from '../src/core/SpriteLoader';
import { createTownPlan, type TileRect, type TownPlan } from '../src/map/town/townPlan';
import { PLANNED_SIGNPOSTS } from '../src/systems/townDecorPlan';
import { TILE_SIZE } from '../src/core/constants';
import buildingManifest from '../src/images/environment/buildings/manifest.json';

/** Read straight rather than through `SpriteLoader`, so the gate measures the source. */
const BUILDING_MANIFEST: Readonly<Record<string, SpriteManifestEntry | undefined>> =
  buildingManifest;

/** The size every overworld is generated at, matching floor 3's level def. */
const MAP_SIZE = 220;
/**
 * How many unseeded maps the layout checks are run over.
 *
 * Generation is `Math.random()` throughout and the wilderness passes — rivers,
 * cliffs, forests — are what vary, so a layout accident is rare per draw. A few
 * hundred draws is the honest sample size; this is what the run takes in about a
 * minute, which is the most a gate can cost and still be run.
 */
const MAPS_TO_GENERATE = 200;
/** The gate this plan added, by the `TownPlan`'s own name. */
const NORTH_GATE_NAME = 'north gate';
/** An entry stating no doorway span opens on its door tile and nothing else. */
const SINGLE_TILE_DOORWAY_WIDTH = 1;

let failures = 0;
function check(ok: boolean, message: string): void {
  if (!ok) {
    console.log(` FAIL  ${message}`);
    failures++;
    return;
  }
  console.log(`  ok   ${message}`);
}

/** Reports each distinct failure once — a batch would otherwise print N copies. */
const reportedOnce = new Set<string>();
function checkOnce(ok: boolean, message: string): void {
  if (ok) return;
  failures++;
  if (reportedOnce.has(message)) return;
  reportedOnce.add(message);
  console.log(` FAIL  ${message}`);
}

function doorwaySpanOf(entry: BuildingEntry): { x0: number; width: number } {
  if (entry.doorwayX0 === undefined || entry.doorwayWidth === undefined) {
    return { x0: entry.doorTile.x, width: SINGLE_TILE_DOORWAY_WIDTH };
  }
  return { x0: entry.doorwayX0, width: entry.doorwayWidth };
}

/**
 * The anchor-relative column the sprite's art actually paints its door on,
 * measured straight off the manifest.
 *
 * Deliberately a second, independent implementation of what
 * `SpriteLoader.doorCentreColumnFromRegions` does rather than a call to it: a
 * gate that asks the code under test for the expected answer tests nothing. The
 * arithmetic is small enough that restating it is cheaper than the indirection,
 * and a divergence between the two is exactly the regression worth catching.
 */
function paintedDoorColumn(spriteKey: string): number | undefined {
  const entry = BUILDING_MANIFEST[spriteKey];
  if (entry === undefined) return undefined;
  const regions = entry.blockedRegions;
  if (regions === undefined) return undefined;

  let deepest = -Infinity;
  for (const region of regions) deepest = Math.max(deepest, region.y2);
  // Everything reaching into the bottom tile row, not only what ends level with
  // the deepest pixel: a facade's two flanks are hand-authored and need not
  // finish at the same depth.
  const baseCourse = regions
    .filter((region) => region.y2 >= deepest - entry.tileScale)
    .sort((a, b) => a.x1 - b.x1);
  if (baseCourse.length < 2) return undefined;

  let widestGap = 0;
  let centrePx = 0;
  let reached = baseCourse[0].x2;
  for (let at = 1; at < baseCourse.length; at++) {
    const gap = baseCourse[at].x1 - reached;
    if (gap > widestGap) {
      widestGap = gap;
      centrePx = (reached + baseCourse[at].x1) / 2;
    }
    reached = Math.max(reached, baseCourse[at].x2);
  }
  if (widestGap <= 0) return undefined;
  return Math.floor((centrePx - entry.tileX) / entry.tileScale);
}

const CARDINAL_STEPS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

/**
 * Four-connected flood from `from`, answering only whether `to` was reached.
 *
 * `passable` decides what counts as a step, so a caller can hold the walk inside
 * the walls. Without that, "can the plaza reach the north gate's exit tile" is
 * answered yes by walking out of the *south* gate and round the outside of the
 * town, which is true of a north gate that is bricked up solid.
 */
function reaches(
  size: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  passable: (x: number, y: number) => boolean,
): boolean {
  const seen = new Uint8Array(size * size);
  const start = from.y * size + from.x;
  const target = to.y * size + to.x;
  const queue: number[] = [start];
  seen[start] = 1;
  while (queue.length > 0) {
    const key = queue.pop();
    if (key === undefined) break;
    if (key === target) return true;
    const x = key % size;
    const y = Math.floor(key / size);
    for (const [dx, dy] of CARDINAL_STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const nextKey = ny * size + nx;
      if (seen[nextKey] === 1) continue;
      if (!passable(nx, ny)) continue;
      seen[nextKey] = 1;
      queue.push(nextKey);
    }
  }
  return false;
}

function contains(rect: TileRect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

/**
 * Every tile the `TownPlan`'s standing props occupy.
 *
 * The generator does not block these — `TownPropSystem` and `TownDecorSystem`
 * block them after the map is built, which is *after* everything the generator's
 * own reachability assertions can see. A torch in the mouth of a gate corridor
 * is therefore exactly the failure a headless check has to reproduce by hand,
 * and the north gate's corridor runs past two of them.
 */
function propTiles(plan: TownPlan): Set<number> {
  const blocked = new Set<number>();
  for (const prop of plan.props) {
    if (prop.kind === 'fountain') {
      for (let y = prop.bounds.y; y < prop.bounds.y + prop.bounds.h; y++) {
        for (let x = prop.bounds.x; x < prop.bounds.x + prop.bounds.w; x++) {
          blocked.add(y * MAP_SIZE + x);
        }
      }
      continue;
    }
    blocked.add(prop.tile.y * MAP_SIZE + prop.tile.x);
  }
  return blocked;
}

console.log('\nDoorway derivation (manifest, no map needed)');
{
  const plan = createTownPlan(MAP_SIZE);
  for (const building of plan.buildings) {
    const doorway = getSpriteDoorwayByKey(building.spriteKey);
    if (doorway === undefined) {
      check(false, `${building.name}: '${building.spriteKey}' derives a doorway`);
      continue;
    }
    // Measured here from the manifest independently of `SpriteLoader`, and
    // compared against what it derived. Checking the derived door tile against
    // the derived opening instead would be checking a clamp against the range it
    // was just clamped into — always true, and blind to the whole point of the
    // fix, which is that the tile is anchored on the *painted* door rather than
    // on the middle of a tile run biased left of it.
    const painted = paintedDoorColumn(building.spriteKey);
    check(
      painted !== undefined && doorway.dx === painted,
      `${building.name}: door tile dx=${doorway.dx} sits on the painted opening ` +
        `(pixel gap centre column ${painted ?? 'not found'})`,
    );
  }
}

console.log('\nTown plan');
{
  const plan = createTownPlan(MAP_SIZE);
  const northGate = plan.gates.find((gate) => gate.name === NORTH_GATE_NAME);
  check(northGate !== undefined, `the plan has a '${NORTH_GATE_NAME}'`);
  if (northGate !== undefined) {
    check(northGate.bounds.y === plan.wall.y, "the north gate is cut into the wall's north run");
    check(northGate.outward.dy === -1, "the north gate's highway runs north");
  }
  for (const gate of plan.gates) {
    check(
      PLANNED_SIGNPOSTS.some((post) => post.gateName === gate.name),
      `'${gate.name}' has a fingerpost inside it`,
    );
  }
}

console.log(`\nGenerating ${MAPS_TO_GENERATE} overworlds…`);
for (let mapIndex = 0; mapIndex < MAPS_TO_GENERATE; mapIndex++) {
  const map = new GameMap({ mapSize: MAP_SIZE, mapType: 'overworld', tileHeight: TILE_SIZE });
  const plaza = map.townSquareCentre;
  const plan = map.townPlan;
  if (plaza === undefined || plan === undefined) {
    checkOnce(false, 'a generated overworld reports its town square centre and plan');
    continue;
  }
  const props = propTiles(plan);
  const walkable = (x: number, y: number): boolean =>
    map.isWalkable(x, y) && !props.has(y * MAP_SIZE + x);

  // Every tile of every opening, not just the one the entry menu is keyed on —
  // the whole point of the fix is that the other columns are enterable too.
  for (const entry of map.buildingEntries) {
    const { x0, width } = doorwaySpanOf(entry);
    for (let x = x0; x < x0 + width; x++) {
      checkOnce(
        map.isWalkable(x, entry.doorTile.y),
        `'${entry.name}': column ${x - x0} of its ${width}-tile doorway is not walkable`,
      );
    }
    // Where `DungeonScene` puts the party when they walk back out of a
    // building. It is one row south of the door rather than on it, so that
    // leaving does not immediately re-open the "Enter this building?" prompt —
    // which makes it a tile nothing else in the generator ever checks, and a
    // solid one there is a player stuck inside a shop.
    checkOnce(
      walkable(entry.doorTile.x, entry.doorTile.y + 1),
      `'${entry.name}': the tile the party is put back on when they leave is not walkable`,
    );
    checkOnce(
      entry.doorTile.x >= x0 && entry.doorTile.x < x0 + width,
      `'${entry.name}': its door tile lies outside its own doorway`,
    );
    checkOnce(
      reaches(MAP_SIZE, plaza, entry.doorTile, walkable),
      `'${entry.name}': its door is walkable from the plaza`,
    );
  }

  const northGate = plan.gates.find((gate) => gate.name === NORTH_GATE_NAME);
  if (northGate === undefined) {
    checkOnce(false, `a generated map carries a '${NORTH_GATE_NAME}'`);
    continue;
  }
  for (let x = northGate.bounds.x; x < northGate.bounds.x + northGate.bounds.w; x++) {
    checkOnce(
      walkable(x, northGate.bounds.y),
      "a column of the north gate's opening is not walkable",
    );
  }
  // Held inside the wall, plus the gate's own opening and the tile beyond it, so
  // the only route this can find is the corridor the gate was cut to serve.
  const insideTownOrThroughTheGate = (x: number, y: number): boolean => {
    if (!walkable(x, y)) return false;
    if (contains(plan.interior, x, y)) return true;
    if (contains(northGate.bounds, x, y)) return true;
    return x === northGate.exit.x && y === northGate.exit.y;
  };
  checkOnce(
    reaches(MAP_SIZE, plaza, northGate.exit, insideTownOrThroughTheGate),
    "the north gate's exit tile is reachable from the plaza without leaving the town",
  );
}
check(reportedOnce.size === 0, `all ${MAPS_TO_GENERATE} generated maps passed`);

console.log(
  failures === 0 ? '\nAll town guidance checks passed.\n' : `\n${failures} failure(s).\n`,
);
process.exit(failures === 0 ? 0 : 1);
