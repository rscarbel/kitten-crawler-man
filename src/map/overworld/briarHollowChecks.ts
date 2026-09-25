/**
 * Standing checks on a generated Briar Hollow: that the stockade is closed but
 * for its gate, that every door opens inside it, and that every place a
 * villager or a crawler must get to can be walked to.
 *
 * Each check returns its failures as sentences rather than throwing, so the
 * site gate can report every one of them; the generator's `assert*` wrappers
 * throw on the first.
 */

import { HOLLOW_GATE, HOLLOW_PALISADE, HOLLOW_THRESHOLD, type TileContent } from '../tileTypes';
import { isWalkableTileType } from '../walkability';
import type { TilePoint } from '../town/townPlan';
import { OUTSIDE_BUILDINGS, propFootprint } from './briarHollowLayout';
import { isInsideRing, rectCentre, rectContains, type BriarHollowSite } from './briarHollowSite';
import { Reachability, type GridView } from './reachability';

const CARDINAL_STEPS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Open ground a deposit must have beside it, so it can be mined from more than one side. */
const DEPOSIT_MIN_OPEN_SIDES = 2;

function tileAt(grid: GridView, x: number, y: number): TileContent | undefined {
  if (x < 0 || y < 0 || x >= grid.size || y >= grid.size) return undefined;
  return grid.cells[y][x];
}

function isWalkable(grid: GridView, x: number, y: number): boolean {
  const tile = tileAt(grid, x, y);
  return tile !== undefined && isWalkableTileType(tile);
}

function neighbours(point: TilePoint): TilePoint[] {
  return CARDINAL_STEPS.map(([dx, dy]) => ({ x: point.x + dx, y: point.y + dy }));
}

function describe(point: TilePoint): string {
  return `(${point.x}, ${point.y})`;
}

/**
 * The village's structure: the ring is intact and closed except at the gate,
 * every inside building's doorways are thresholds within the ring with a clear
 * tile either side, and every inside district lies within the palisade.
 */
export function checkBriarHollowIsIntact(grid: GridView, site: BriarHollowSite): string[] {
  const problems: string[] = [];
  const origin = { x: site.palisadeBounds.x, y: site.palisadeBounds.y };

  for (const tile of site.palisadePath) {
    if (grid.typeAt(tile.x, tile.y) !== HOLLOW_PALISADE) {
      problems.push(`palisade tile ${describe(tile)} is type ${grid.typeAt(tile.x, tile.y)}`);
    }
  }
  for (const tile of site.gate.tiles) {
    if (grid.typeAt(tile.x, tile.y) !== HOLLOW_GATE) {
      problems.push(`gate tile ${describe(tile)} is type ${grid.typeAt(tile.x, tile.y)}`);
    }
  }

  // Closed: a walker starting inside, with the gate shut, never steps on a
  // tile outside the ring. Confined to the bounds so a leak is caught at the
  // first ring tile it crosses rather than wherever the wilderness takes it.
  const gateKeys = new Set(site.gate.tiles.map((tile) => `${tile.x},${tile.y}`));
  const seen = new Set<string>([`${site.gate.inside.x},${site.gate.inside.y}`]);
  const queue: TilePoint[] = [site.gate.inside];
  let leak: TilePoint | null = null;
  while (queue.length > 0 && leak === null) {
    const current = queue.pop();
    if (current === undefined) break;
    for (const next of neighbours(current)) {
      const key = `${next.x},${next.y}`;
      if (seen.has(key) || gateKeys.has(key)) continue;
      if (!rectContains(site.palisadeBounds, next.x, next.y)) continue;
      if (!isWalkable(grid, next.x, next.y)) continue;
      seen.add(key);
      if (!isInsideRing(next.x - origin.x, next.y - origin.y)) {
        leak = next;
        break;
      }
      queue.push(next);
    }
  }
  if (leak !== null) problems.push(`the palisade is open at ${describe(leak)}`);

  for (const building of site.buildings) {
    const inside = !OUTSIDE_BUILDINGS.has(building.id);
    for (const door of building.doorways) {
      if (grid.typeAt(door.x, door.y) !== HOLLOW_THRESHOLD) {
        problems.push(`${building.id} doorway ${describe(door)} is not a threshold`);
      }
      if (inside && !isInsideRing(door.x - origin.x, door.y - origin.y)) {
        problems.push(`${building.id} doorway ${describe(door)} is outside the palisade`);
      }
      const inner = neighbours(door).find((tile) =>
        rectContains(building.interior, tile.x, tile.y),
      );
      const outer = neighbours(door).find((tile) => !rectContains(building.rect, tile.x, tile.y));
      if (inner === undefined || !isWalkable(grid, inner.x, inner.y)) {
        problems.push(`${building.id} doorway ${describe(door)} is blocked on the inside`);
      }
      if (outer === undefined || !isWalkable(grid, outer.x, outer.y)) {
        problems.push(`${building.id} doorway ${describe(door)} is blocked on the outside`);
      }
    }
  }

  // Tile by tile against the ring itself, not against `site.interior`: that
  // rectangle takes in the chamfered corners' ring tiles, so a district cut
  // square into a corner would pass a rectangle test with a palisade tile in it.
  for (const district of site.districts) {
    if (district.id === 'quarry' || district.id === 'ruins') continue;
    const { rect } = district;
    let outside: TilePoint | null = null;
    for (let y = rect.y; y < rect.y + rect.h && outside === null; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        if (isInsideRing(x - origin.x, y - origin.y)) continue;
        outside = { x, y };
        break;
      }
    }
    if (outside !== null) {
      problems.push(
        `district ${district.id} reaches the palisade or beyond at ${describe(outside)}`,
      );
    }
  }

  for (const deposit of site.quarry.depositTiles) {
    const open = neighbours(deposit).filter((tile) => isWalkable(grid, tile.x, tile.y)).length;
    if (open < DEPOSIT_MIN_OPEN_SIDES) {
      problems.push(`quarry deposit ${describe(deposit)} has ${open} open side(s)`);
    }
  }
  return problems;
}

/** Whether any walkable neighbour of a solid tile has been reached. */
function reachedBeside(reach: Reachability, tiles: readonly TilePoint[]): boolean {
  return tiles.some((tile) => neighbours(tile).some((next) => reach.reached(next.x, next.y)));
}

/**
 * The village's reachability: from the town a walker reaches the gate, and
 * through it every threshold, anchor, the square, the pasture gate, the grove
 * and the sawmill; and outside, every quarry deposit, the hut and the ruins
 * centre.
 *
 * `from` is a tile in the town. The walker is the same four-connected one the
 * generator's own connectivity checks use.
 */
export function checkBriarHollowIsReachable(
  grid: GridView,
  site: BriarHollowSite,
  from: TilePoint,
): string[] {
  const problems: string[] = [];
  const fromTown = new Reachability(grid, from);
  if (!fromTown.reached(site.gate.outside.x, site.gate.outside.y)) {
    problems.push(
      `the gate's outside tile ${describe(site.gate.outside)} cannot be reached from town`,
    );
  }

  // One flood serves inside and outside alike. The gate is walkable, so a
  // walker that reaches its outside tile walks straight in, and
  // `checkBriarHollowIsIntact` is what proves the ring has no other way in —
  // a second flood from the inside tile would reach exactly the same tiles.
  const expectInside = (what: string, tile: TilePoint) => {
    if (!fromTown.reached(tile.x, tile.y)) {
      problems.push(`${what} ${describe(tile)} cannot be reached through the gate`);
    }
  };
  for (const building of site.buildings) {
    for (const door of building.doorways) {
      if (!fromTown.reached(door.x, door.y)) {
        problems.push(`${building.id} threshold ${describe(door)} cannot be reached`);
      }
    }
    for (const anchor of building.occupantAnchors) {
      if (!fromTown.reached(anchor.x, anchor.y)) {
        problems.push(`${building.id} occupant anchor ${describe(anchor)} cannot be reached`);
      }
    }
  }
  for (const [kind, anchors] of Object.entries(site.villagerAnchors)) {
    for (const anchor of anchors) {
      if (!fromTown.reached(anchor.x, anchor.y)) {
        problems.push(`villager anchor ${kind} ${describe(anchor)} cannot be reached`);
      }
    }
  }
  expectInside("the gate's inside tile", site.gate.inside);
  for (const gate of site.pasture.fenceGates) expectInside('the pasture gate', gate);
  expectInside('the square', rectCentre(site.square.rect));
  for (const tree of site.lumberYard.groveTiles) {
    if (!reachedBeside(fromTown, [tree])) {
      problems.push(`grove tree ${describe(tree)} has no reachable side`);
    }
  }
  const sawmill = site.buildings.find((building) => building.id === 'sawmill');
  const machine = sawmill?.furniture.find((prop) => prop.prop === 'sawmill_machine');
  if (machine === undefined || !reachedBeside(fromTown, propFootprint(machine))) {
    problems.push('the sawmill machine cannot be reached');
  }

  for (const deposit of site.quarry.depositTiles) {
    if (!reachedBeside(fromTown, [deposit])) {
      problems.push(`quarry deposit ${describe(deposit)} has no reachable side`);
    }
  }
  if (!fromTown.reached(site.ruins.centre.x, site.ruins.centre.y)) {
    problems.push(`the ruins centre ${describe(site.ruins.centre)} cannot be reached`);
  }
  for (const lane of site.assaultLanes) {
    for (const tile of [lane.spawn, lane.approach]) {
      if (!fromTown.reached(tile.x, tile.y)) {
        problems.push(`assault lane ${lane.id} tile ${describe(tile)} cannot be reached`);
      }
    }
  }
  return problems;
}

function throwIfAny(problems: readonly string[], what: string): void {
  if (problems.length === 0) return;
  throw new Error(`Briar Hollow ${what}: ${problems.join('; ')}`);
}

/** Throws when `checkBriarHollowIsIntact` finds anything. */
export function assertBriarHollowIsIntact(grid: GridView, site: BriarHollowSite): void {
  throwIfAny(checkBriarHollowIsIntact(grid, site), 'is not intact');
}

/** Throws when `checkBriarHollowIsReachable` finds anything. */
export function assertBriarHollowIsReachable(
  grid: GridView,
  site: BriarHollowSite,
  from: TilePoint,
): void {
  throwIfAny(checkBriarHollowIsReachable(grid, site, from), 'is not reachable');
}
