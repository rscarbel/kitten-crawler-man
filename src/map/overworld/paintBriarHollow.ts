/**
 * Stamps Briar Hollow onto the overworld grid: ground, buildings, palisade,
 * gate, props, the grove, the quarry, the ruins, and the roads that tie the
 * village to the town.
 *
 * Runs late — after the camps — so that within the village's own footprint the
 * village wins over anything that slipped through the keep-out. Everything is
 * written through the `TileGrid` API, and everything that could later be
 * removed (a tree, a deposit, a prop) with `setStanding`, so it remembers the
 * ground it stands on.
 */

import {
  BONES,
  CROP_FIELD,
  DIRT_PATCH,
  FloorTypeValue,
  GARDEN_PLANTING,
  HOLLOW_DECAL,
  HOLLOW_GATE,
  HOLLOW_PALISADE,
  HOLLOW_PLANK_FLOOR,
  HOLLOW_PROP_LOW,
  HOLLOW_PROP_TALL,
  HOLLOW_THRESHOLD,
  HOLLOW_WALL,
  PASTURE_GRASS,
  PEBBLE_SCATTER,
  ROCK_DEPOSIT,
  RUBBLE,
  RUINED_WALL,
  SCREE,
  TREE,
  treeSpriteKeysFor,
  VERGE_GRASS,
  YARD_GRAVEL,
  type TreeSpecies,
} from '../tileTypes';
import { isWalkableTileType } from '../walkability';
import type { TileGrid } from '../town/tileGrid';
import type { TilePoint, TileRect, TownPlan } from '../town/townPlan';
import { grownRect } from './keepOut';
import {
  CROSS_LANE,
  KITCHEN_GARDEN,
  KITCHEN_GARDEN_PATH_X,
  MAIN_STREET,
  QUARRY_SPUR,
  RUINS_CLEAR_HALF_TILES,
  RUINS_WALL_GAP_PERIOD,
  RUINS_WALL_RING_TILES,
  SOUTH_ROAD,
  TOWN_ROAD_START,
  WORN_PATHS,
  propFootprint,
  villagePropPartSpriteKey,
  villagePropSpriteKey,
  type PropPlacement,
  type VillagePropKind,
} from './briarHollowLayout';
import { isInsideRing, rectContains, type BriarHollowSite } from './briarHollowSite';
import { worldRandom } from '../../core/WorldRandom';
import { DRESSED_STONE_SPRITE_KEYS } from '../tiles/rockDepositTiles';

/** Tiles of wild ground cleared round the palisade, so the stockade stands in its own clearing. */
const CLEARING_MARGIN_TILES = 2;
/** Chance a quarry tile is strewn with loose stone. */
const QUARRY_PEBBLE_CHANCE = 0.35;
/** Chance a ruins tile, outside the walls and the clear patch, carries rubble or bones. */
const RUINS_RUBBLE_CHANCE = 0.22;
const RUINS_BONES_SHARE = 0.25;
/** Half-width of every road the village paves: three tiles across, like the town's highways. */
const ROAD_HALF_WIDTH_TILES = 1;
/**
 * Open ground the road to town keeps between its shoulder and the palisade or
 * the ruins, so it runs past the village rather than scraping along its wall,
 * and a crawler walking beside it is never pinned against the stockade.
 */
const ROAD_VILLAGE_VERGE_TILES = 1;

const PROP_TILE_TYPE: Readonly<Record<VillagePropKind, number>> = {
  low: HOLLOW_PROP_LOW,
  tall: HOLLOW_PROP_TALL,
  decal: HOLLOW_DECAL,
};

/** The two grove species, planted in alternating rows so the yard reads as managed. */
const GROVE_SPECIES: readonly TreeSpecies[] = ['oak', 'birch'];

/** The site's origin, recovered from its bounds. */
function originOf(site: BriarHollowSite): TilePoint {
  return { x: site.palisadeBounds.x, y: site.palisadeBounds.y };
}

function shiftRect(origin: TilePoint, rect: TileRect): TileRect {
  return { x: origin.x + rect.x, y: origin.y + rect.y, w: rect.w, h: rect.h };
}

function forEachTileOf(rect: TileRect, visit: (x: number, y: number) => void): void {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) visit(x, y);
  }
}

function isInRuinsDisc(site: BriarHollowSite, x: number, y: number): boolean {
  return Math.hypot(x - site.ruins.centre.x, y - site.ruins.centre.y) <= site.ruins.radiusTiles;
}

/**
 * Clears the village's footprint to its base surfaces.
 *
 * Inside the palisade bounds the village wins outright — anything that slipped
 * through the keep-out is overwritten. In the clearing round the bounds, the
 * quarry and the ruins, a tile something solid already owns (a river, the
 * town's wall, a camp's tent) is left alone.
 */
function clearFootprint(grid: TileGrid, site: BriarHollowSite): void {
  const origin = originOf(site);
  const bounds = site.palisadeBounds;
  forEachTileOf(grownRect(bounds, CLEARING_MARGIN_TILES), (x, y) => {
    if (rectContains(bounds, x, y)) {
      const insideRing = isInsideRing(x - origin.x, y - origin.y);
      grid.set(x, y, insideRing ? VERGE_GRASS : FloorTypeValue.grass);
      return;
    }
    if (!grid.isSolid(x, y)) grid.set(x, y, FloorTypeValue.grass);
  });
  forEachTileOf(site.quarry.rect, (x, y) => {
    if (!grid.isSolid(x, y)) grid.set(x, y, SCREE);
  });
  const { centre, radiusTiles } = site.ruins;
  forEachTileOf(
    {
      x: centre.x - radiusTiles,
      y: centre.y - radiusTiles,
      w: radiusTiles * 2 + 1,
      h: radiusTiles * 2 + 1,
    },
    (x, y) => {
      if (!isInRuinsDisc(site, x, y) || grid.isSolid(x, y)) return;
      grid.set(x, y, FloorTypeValue.grass);
    },
  );
}

/** Lays one ground material over a site-relative rect. */
function fillGround(grid: TileGrid, origin: TilePoint, rect: TileRect, type: number): void {
  grid.fill(shiftRect(origin, rect), type);
}

function paintStreets(grid: TileGrid, site: BriarHollowSite): void {
  const origin = originOf(site);
  fillGround(grid, origin, MAIN_STREET, FloorTypeValue.road);
  fillGround(grid, origin, CROSS_LANE, FloorTypeValue.road);
  for (const path of WORN_PATHS) fillGround(grid, origin, path, DIRT_PATCH);
  grid.fill(site.square.rect, YARD_GRAVEL);
  grid.fill(site.pasture.rect, PASTURE_GRASS);
  for (const field of site.cropFields) grid.fill(field, CROP_FIELD);
  const garden = shiftRect(origin, KITCHEN_GARDEN);
  const pathX = origin.x + KITCHEN_GARDEN_PATH_X;
  forEachTileOf(garden, (x, y) => {
    if (x !== pathX) grid.set(x, y, GARDEN_PLANTING);
  });
}

/** Walls, thresholds and floors of every building. */
function paintBuildings(grid: TileGrid, site: BriarHollowSite): void {
  for (const building of site.buildings) {
    const floor =
      building.floor === 'planks'
        ? HOLLOW_PLANK_FLOOR
        : building.id === 'forge'
          ? YARD_GRAVEL
          : DIRT_PATCH;
    grid.fill(building.interior, floor);
    const { rect } = building;
    forEachTileOf(rect, (x, y) => {
      if (rectContains(building.interior, x, y)) return;
      grid.setStanding(x, y, HOLLOW_WALL);
    });
    // A threshold replaces the wall outright rather than standing on it: it is
    // floor, and the wall's recorded ground would otherwise leak into it.
    for (const door of building.doorways) grid.set(door.x, door.y, HOLLOW_THRESHOLD);
  }
}

function paintPalisade(grid: TileGrid, site: BriarHollowSite): void {
  for (const tile of site.palisadePath) {
    grid.setPalisade(tile.x, tile.y, HOLLOW_PALISADE, 'fence');
  }
  for (const tile of site.gate.tiles) {
    grid.set(tile.x, tile.y, FloorTypeValue.road);
    grid.setStanding(tile.x, tile.y, HOLLOW_GATE);
  }
}

/** Stamps one prop: its anchor with the prop's key, the rest of its footprint with a key back to the anchor. */
function stampProp(grid: TileGrid, placement: PropPlacement): void {
  const type = PROP_TILE_TYPE[placement.kind];
  for (const tile of propFootprint(placement)) {
    const dx = tile.x - placement.x;
    const dy = tile.y - placement.y;
    const key =
      dx === 0 && dy === 0
        ? villagePropSpriteKey(placement.prop)
        : villagePropPartSpriteKey(-dx, -dy);
    grid.setStandingSprite(tile.x, tile.y, type, key);
  }
}

function paintProps(grid: TileGrid, site: BriarHollowSite): void {
  for (const building of site.buildings) {
    for (const placement of building.furniture) stampProp(grid, placement);
  }
  for (const placement of site.props) stampProp(grid, placement);
}

/** The pasture's post-and-rail fence, with its gate left open toward the barn. */
function paintPastureFence(grid: TileGrid, site: BriarHollowSite): void {
  const { rect, fenceGates } = site.pasture;
  const isGate = (x: number, y: number) => fenceGates.some((gate) => gate.x === x && gate.y === y);
  forEachTileOf(rect, (x, y) => {
    const onPerimeter =
      x === rect.x || y === rect.y || x === rect.x + rect.w - 1 || y === rect.y + rect.h - 1;
    if (!onPerimeter || isGate(x, y)) return;
    grid.setFence(x, y, 'post_and_rail');
  });
}

function plantGrove(grid: TileGrid, site: BriarHollowSite): void {
  const rows = [...new Set(site.lumberYard.groveTiles.map((tile) => tile.y))].sort((a, b) => a - b);
  for (const tile of site.lumberYard.groveTiles) {
    const species = GROVE_SPECIES[rows.indexOf(tile.y) % GROVE_SPECIES.length];
    const variants = treeSpriteKeysFor(species);
    const variant = variants[Math.floor(worldRandom() * variants.length) % variants.length];
    grid.setStandingSprite(tile.x, tile.y, TREE, variant);
  }
}

function paintQuarry(grid: TileGrid, site: BriarHollowSite): void {
  forEachTileOf(site.quarry.rect, (x, y) => {
    if (grid.typeAt(x, y) !== SCREE) return;
    if (worldRandom() < QUARRY_PEBBLE_CHANCE) grid.setStanding(x, y, PEBBLE_SCATTER);
  });
  for (const tile of site.quarry.depositTiles) {
    grid.set(tile.x, tile.y, SCREE);
    grid.setStanding(tile.x, tile.y, ROCK_DEPOSIT);
  }
  site.quarry.stubTiles.forEach((stub, index) => {
    const dressed = DRESSED_STONE_SPRITE_KEYS[index % DRESSED_STONE_SPRITE_KEYS.length];
    grid.set(stub.x, stub.y, SCREE);
    grid.setStandingSprite(stub.x, stub.y, ROCK_DEPOSIT, dressed);
  });
}

/**
 * The necromancer's ruins: a broken square of wall round a clear patch where
 * he arrives, and rubble and bones strewn over the rest of the disc.
 *
 * The wall and the patch are fixed; only the strewn litter is seeded.
 */
function paintVillageRuins(grid: TileGrid, site: BriarHollowSite): void {
  const { centre, radiusTiles } = site.ruins;
  for (let dy = -radiusTiles; dy <= radiusTiles; dy++) {
    for (let dx = -radiusTiles; dx <= radiusTiles; dx++) {
      const x = centre.x + dx;
      const y = centre.y + dy;
      if (!isInRuinsDisc(site, x, y) || grid.isSolid(x, y)) continue;
      const ring = Math.max(Math.abs(dx), Math.abs(dy));
      if (ring <= RUINS_CLEAR_HALF_TILES) continue;
      if (ring === RUINS_WALL_RING_TILES) {
        const along = dx + dy + RUINS_WALL_RING_TILES * 2;
        if (along % RUINS_WALL_GAP_PERIOD !== 0) grid.setStanding(x, y, RUINED_WALL);
        continue;
      }
      if (worldRandom() >= RUINS_RUBBLE_CHANCE) continue;
      grid.setStanding(x, y, worldRandom() < RUINS_BONES_SHARE ? BONES : RUBBLE);
    }
  }
}

/** Paves a site-relative rect as a packed-earth road, leaving anything solid standing. */
function paveRect(grid: TileGrid, origin: TilePoint, rect: TileRect): void {
  forEachTileOf(shiftRect(origin, rect), (x, y) => {
    if (!grid.isPaved(x, y)) grid.setPaved(x, y, FloorTypeValue.road);
  });
}

/**
 * Paints the whole village and its roads, except the road to town, which is
 * laid separately by `paveRoadToTown` once the village is on the grid.
 */
export function paintBriarHollow(grid: TileGrid, site: BriarHollowSite): void {
  const origin = originOf(site);
  clearFootprint(grid, site);
  paintStreets(grid, site);
  paveRect(grid, origin, SOUTH_ROAD);
  paveRect(grid, origin, QUARRY_SPUR);
  paintBuildings(grid, site);
  paintPastureFence(grid, site);
  paintPalisade(grid, site);
  paintProps(grid, site);
  plantGrove(grid, site);
  paintQuarry(grid, site);
  paintVillageRuins(grid, site);
}

// ── The road to town ──────────────────────────────────────────────────────────

/** Step costs for the road router: it prefers existing road, then open ground, then clearing scenery. */
const COST_PAVED = 1;
const COST_OPEN = 3;
const COST_CLEARABLE = 6;
/** Fording costs a lot, so the road crosses a river where it is narrow; the crossing pass bridges it. */
const COST_WATER = 30;

/** What stands in the road's way but may be cleared for it: trees, and the ruins' tumbled walls. */
const CLEARABLE_TYPES: ReadonlySet<number> = new Set([TREE, RUINED_WALL, RUBBLE, BONES]);

const ROUTE_STEPS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** A binary min-heap of (cost, key) pairs for the road router. */
class CostHeap {
  private readonly costs: number[] = [];
  private readonly keys: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(cost: number, key: number): void {
    this.costs.push(cost);
    this.keys.push(key);
    let index = this.keys.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.costs[parent] <= this.costs[index]) break;
      this.swap(parent, index);
      index = parent;
    }
  }

  pop(): { cost: number; key: number } | null {
    const count = this.keys.length;
    if (count === 0) return null;
    const top = { cost: this.costs[0], key: this.keys[0] };
    const lastCost = this.costs.pop();
    const lastKey = this.keys.pop();
    if (count > 1 && lastCost !== undefined && lastKey !== undefined) {
      this.costs[0] = lastCost;
      this.keys[0] = lastKey;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < this.keys.length && this.costs[left] < this.costs[smallest]) smallest = left;
        if (right < this.keys.length && this.costs[right] < this.costs[smallest]) smallest = right;
        if (smallest === index) break;
        this.swap(smallest, index);
        index = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.costs[a], this.costs[b]] = [this.costs[b], this.costs[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}

/**
 * Lays the road from the village's south road to the nearest town gate.
 *
 * Routed rather than drawn as an L — `connectSiteToNearestGate`'s shape — because
 * an L from a gate on the village's south side to a town gate west of it runs
 * its long leg straight through the palisade for about half the sites the
 * village can have. The router keeps out of the village, the quarry and the
 * ruins, never crosses the town wall, rides existing roads where it meets
 * them, and fords a river only where it must (the crossing pass bridges it).
 *
 * Returns the route's centre line, which is empty if no gate can be reached.
 */
export function paveRoadToTown(
  grid: TileGrid,
  plan: TownPlan,
  site: BriarHollowSite,
  border: number,
): TilePoint[] {
  const size = grid.size;
  const origin = originOf(site);
  const start: TilePoint = { x: origin.x + TOWN_ROAD_START.x, y: origin.y + TOWN_ROAD_START.y };
  const blockedCore = [
    grownRect(site.palisadeBounds, ROAD_HALF_WIDTH_TILES + ROAD_VILLAGE_VERGE_TILES),
    grownRect(site.quarry.rect, ROAD_HALF_WIDTH_TILES),
  ];
  const ruinsReach = site.ruins.radiusTiles + ROAD_HALF_WIDTH_TILES + ROAD_VILLAGE_VERGE_TILES;
  const targets = new Set(plan.gates.map((gate) => gate.exit.y * size + gate.exit.x));

  const stepCost = (x: number, y: number): number | null => {
    if (x <= border || y <= border || x >= size - border - 1 || y >= size - border - 1) return null;
    if (targets.has(y * size + x)) return COST_PAVED;
    if (rectContains(plan.wall, x, y)) return null;
    if (blockedCore.some((rect) => rectContains(rect, x, y))) return null;
    if (Math.hypot(x - site.ruins.centre.x, y - site.ruins.centre.y) <= ruinsReach) return null;
    const type = grid.typeAt(x, y);
    if (type === undefined) return null;
    if (type === FloorTypeValue.water) return COST_WATER;
    if (grid.isSolid(x, y)) return null;
    if (grid.isPaved(x, y)) return COST_PAVED;
    if (CLEARABLE_TYPES.has(type)) return COST_CLEARABLE;
    if (!isWalkableTileType(grid.cells[y][x])) return null;
    return COST_OPEN;
  };

  const best = new Float64Array(size * size).fill(Infinity);
  const cameFrom = new Int32Array(size * size).fill(-1);
  const heap = new CostHeap();
  const startKey = start.y * size + start.x;
  best[startKey] = 0;
  heap.push(0, startKey);
  let reachedKey = -1;
  while (heap.size > 0) {
    const next = heap.pop();
    if (next === null) break;
    if (next.cost > best[next.key]) continue;
    if (targets.has(next.key)) {
      reachedKey = next.key;
      break;
    }
    const x = next.key % size;
    const y = Math.floor(next.key / size);
    for (const [dx, dy] of ROUTE_STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      const cost = stepCost(nx, ny);
      if (cost === null) continue;
      const nextKey = ny * size + nx;
      const total = next.cost + cost;
      if (total >= best[nextKey]) continue;
      best[nextKey] = total;
      cameFrom[nextKey] = next.key;
      heap.push(total, nextKey);
    }
  }
  if (reachedKey < 0) return [];

  const route: TilePoint[] = [];
  for (let key = reachedKey; key >= 0; key = cameFrom[key]) {
    route.push({ x: key % size, y: Math.floor(key / size) });
  }
  route.reverse();
  for (const tile of route) {
    for (let dy = -ROAD_HALF_WIDTH_TILES; dy <= ROAD_HALF_WIDTH_TILES; dy++) {
      for (let dx = -ROAD_HALF_WIDTH_TILES; dx <= ROAD_HALF_WIDTH_TILES; dx++) {
        const x = tile.x + dx;
        const y = tile.y + dy;
        if (rectContains(plan.wall, x, y)) continue;
        if (grid.isPaved(x, y)) continue;
        // The shoulders are widened only over ground the router itself would
        // cross: a torch or a camp's crate beside the centre line stays put.
        const type = grid.typeAt(x, y);
        const clearable = type !== undefined && CLEARABLE_TYPES.has(type);
        if (!clearable && !isWalkableTileType(grid.cells[y][x])) continue;
        grid.setPaved(x, y, FloorTypeValue.road);
      }
    }
  }
  return route;
}
