/**
 * The dungeon floor surface — each dressed room's and hallway's material, the
 * wear field, the room features and the hallway decals — checked over a sweep
 * of floor 1 and floor 2 seeds.
 *
 * - Every walkable tile of a dressed room or hallway resolves, through the same
 *   lookup the ground painter uses, to its character's floor material; every
 *   other walkable tile resolves to the material its tile type maps to.
 * - Building the surface leaves the tile grid untouched, so no tile's
 *   walkability, spawn eligibility or minimap colour can move.
 * - The wear field is deterministic and in bounds, sits on the routes between a
 *   room's doorways rather than off them, and is zero outside dressed regions.
 * - The painted edge line appears on the service level's hallways and nowhere on
 *   the cellars; the walk line never runs as two lines side by side.
 * - Room features: at most one per room, each painting at least one tile and
 *   none of them a wall, a tile beside a doorway or a tile outside its room;
 *   nearly every room of a character carries its feature; every feature a
 *   character names is drawn somewhere.
 * - The floor-surface art meets itself seamlessly across tile edges at
 *   fractional canvas scales.
 * - The character-only materials are actually reached by the sweep, so a
 *   character table that stopped rolling one would be noticed.
 *
 * Self-tests unregister a map's surface, sabotage its features and open a gap
 * in the seam fixture, and require each check to go red, so the gate is proved
 * able to fail.
 *
 *   npx tsx scripts/verify-floor-surface.ts
 *   npx tsx scripts/verify-floor-surface.ts --seeds=20
 */
import { createCanvas } from 'canvas';

import { TILE_SIZE } from '../src/core/constants.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { drawFloorSurface } from '../src/map/tiles/floorWearArt.js';
import type { TileContent } from '../src/map/tileTypes.js';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions.js';
import { level1 } from '../src/levels/level1.js';
import { level2 } from '../src/levels/level2.js';
import type { LevelDef } from '../src/levels/types.js';
import { GameMap } from '../src/map/GameMap.js';
import {
  buildFloorSurface,
  laidMaterial,
  FloorSurface,
  registerFloorSurface,
} from '../src/map/dungeon/floorSurface.js';
import {
  DEFAULT_DUNGEON_FLOOR_THEME,
  dungeonFloorTheme,
  setDungeonFloorTheme,
} from '../src/map/dungeon/floorTheme.js';
import { groundMaterialUnder } from '../src/map/tiles/groundTiles.js';
import {
  GUTTER_EAST,
  GUTTER_SOUTH,
  WALK_LINE_EAST,
  WALK_LINE_NORTH,
  WALK_LINE_SOUTH,
  WALK_LINE_WEST,
  WATER_FEATURES,
} from '../src/map/dungeon/floorFeatures.js';
import { ALL_REGION_CHARACTERS, type FloorFeatureId } from '../src/map/dungeon/roomCharacters.js';
import type { PlacedFloorFeature } from '../src/map/dungeon/floorFeatures.js';
import { BOILER, FloorTypeValue } from '../src/map/tileTypes.js';
import type { Rect } from '../src/map/roomDoorways.js';
import { isWalkableTileType } from '../src/map/walkability.js';

const DEFAULT_SEEDS_PER_FLOOR = 8;
/**
 * Materials no generic floor type maps to, which a tile can only be laid in by
 * a room character. If the tables stop rolling one, nothing else would notice.
 */
const CHARACTER_ONLY_MATERIALS: ReadonlyArray<string> = [
  'f1_earth',
  'f1_herringbone',
  'f2_grating',
  'f2_rubber',
];
/** Keeps the two floors' seeds apart so a failure line names one map. */
const SEED_STRIDE_PER_FLOOR = 100_000;
const MAX_PRINTED_FAILURES = 40;
/** Tiles a feature keeps clear of every doorway tile, Chebyshev. */
const DOORWAY_CLEARANCE_TILES = 1;
/**
 * Share of a character's rooms that must carry its floor feature. Not all: a
 * room crowded with props or doorways can have no spot for even the smallest
 * version, and the rare one that goes without is better than a feature forced
 * onto a doorway.
 */
const MIN_PLACEMENT_RATE = 0.95;
const EXAMPLE_MISMATCHES = 3;
/** Decimal places a wear value is printed to. */
const WEAR_DIGITS = 3;

function seedsPerFloor(): number {
  const arg = process.argv.find((value) => value.startsWith('--seeds='));
  const parsed = arg === undefined ? Number.NaN : Number(arg.slice('--seeds='.length));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_SEEDS_PER_FLOOR;
}

let failures = 0;
let checks = 0;
let currentLabel = '';

function check(condition: boolean, message: string): void {
  checks++;
  if (condition) return;
  failures++;
  if (failures <= MAX_PRINTED_FAILURES) console.log(`  FAIL [${currentLabel}]: ${message}`);
}

/**
 * Walkable tiles whose resolved ground disagrees with what the surface says it
 * should be: the character's material in a dressed region, the tile type's
 * material everywhere else.
 */
function materialMismatches(map: GameMap): string[] {
  const palette = dungeonFloorTheme().ground;
  const problems: string[] = [];
  map.structure.forEach((row, y) => {
    row.forEach((tile, x) => {
      if (!isWalkableTileType(tile)) return;
      const resolved = groundMaterialUnder(palette, map.structure, x, y);
      const character = map.characterAt(x, y);
      const wanted =
        character === null
          ? palette.materialForTileType(tile.type)
          : laidMaterial(
              character.floorMaterial,
              map.regionMap.room(map.regionAt(x, y))?.bounds ?? null,
              x,
              y,
            );
      // A walkable tile whose type this palette does not map (a safe room's
      // floor, a stairwell) is drawn by its own painter, not as this ground.
      if (character === null && wanted === undefined) return;
      if (resolved !== wanted) {
        problems.push(`(${x},${y}) resolves to ${resolved ?? 'nothing'}, expected ${wanted}`);
      }
    });
  });
  return problems;
}

function gridSnapshot(map: GameMap): string {
  return map.structure.map((row) => row.map((tile) => tile.type).join(',')).join(';');
}

function sameSurface(a: FloorSurface, b: FloorSurface): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  if (JSON.stringify(a.features) !== JSON.stringify(b.features)) return false;
  for (let y = 0; y <= a.height; y++) {
    for (let x = 0; x <= a.width; x++) {
      if (a.washAtVertex(x, y) !== b.washAtVertex(x, y)) return false;
      if (x === a.width || y === a.height) continue;
      if (a.materialAt(x, y) !== b.materialAt(x, y)) return false;
      if (a.wearAt(x, y) !== b.wearAt(x, y)) return false;
      if (a.washAt(x, y) !== b.washAt(x, y)) return false;
      if (a.edgeLinesAt(x, y) !== b.edgeLinesAt(x, y)) return false;
      if (a.hallwayMarksAt(x, y) !== b.hallwayMarksAt(x, y)) return false;
      if (a.isPuddleAt(x, y) !== b.isPuddleAt(x, y)) return false;
      if (a.featureAt(x, y)?.kind !== b.featureAt(x, y)?.kind) return false;
    }
  }
  return true;
}

function inRange(value: number, low: number, high: number): boolean {
  return Number.isFinite(value) && value >= low && value <= high;
}

interface Totals {
  maps: number;
  edgeLineTiles: number;
  roomsWithRoutes: number;
  characterOnlyTiles: Map<string, number>;
  /** Room features placed, by kind. */
  features: Map<FloorFeatureId, number>;
  gutterTiles: number;
  walkLineTiles: number;
  puddleTiles: number;
  /** Per `character/feature`, its dressed rooms and how many got the feature. */
  placements: Map<string, { rooms: number; placed: number }>;
}

/** What the feature checks read: the placed features, and which one each tile paints. */
interface FeatureView {
  readonly features: ReadonlyArray<PlacedFloorFeature>;
  featureAt(x: number, y: number): PlacedFloorFeature | null;
}

/**
 * Every problem with a map's room features: more than one in a room, one that
 * paints nothing, or one that paints a wall, a tile beside a doorway, or a tile
 * outside its own room. A prop may stand on a feature — it is painted under the
 * prop — but a wall may not.
 */
function featureProblems(map: GameMap, view: FeatureView): string[] {
  const problems: string[] = [];
  const perRoom = new Map<number, number>();
  for (const feature of view.features) {
    perRoom.set(feature.region, (perRoom.get(feature.region) ?? 0) + 1);
    const room = map.regionMap.room(feature.region);
    if (room === null) {
      problems.push(`a ${feature.kind} lies in region ${feature.region}, which is not a room`);
      continue;
    }
    const doorTiles = room.doorways.flatMap((doorway) => doorway.tiles);
    const { footprint } = feature;
    let painted = 0;
    for (let y = footprint.y; y < footprint.y + footprint.h; y++) {
      for (let x = footprint.x; x < footprint.x + footprint.w; x++) {
        if (view.featureAt(x, y) !== feature) continue;
        painted++;
        const where = `${feature.kind} in room ${room.id} paints (${x},${y})`;
        if (map.structure[y][x].type === FloorTypeValue.wall) problems.push(`${where}, a wall`);
        const besideDoor = doorTiles.some(
          (door) => Math.max(Math.abs(door.x - x), Math.abs(door.y - y)) <= DOORWAY_CLEARANCE_TILES,
        );
        if (besideDoor) problems.push(`${where}, beside a doorway`);
        if (map.regionAt(x, y) !== room.id) problems.push(`${where}, outside its room`);
      }
    }
    if (painted === 0) problems.push(`${feature.kind} in room ${room.id} paints no tile at all`);
  }
  for (const [region, count] of perRoom) {
    if (count > 1) problems.push(`room ${region} has ${count} floor features`);
  }
  return problems;
}

const WALK_BITS = WALK_LINE_NORTH | WALK_LINE_EAST | WALK_LINE_SOUTH | WALK_LINE_WEST;
const RUNS_NORTH_SOUTH = WALK_LINE_NORTH | WALK_LINE_SOUTH;

/**
 * Places where the walk line runs as two lines side by side: a two-by-two
 * block of line tiles, or a rung — two neighbouring line tiles joined
 * east–west that each also run on north or south.
 */
function walkLineLadders(surface: FloorSurface): string[] {
  const problems: string[] = [];
  const onLine = (x: number, y: number): boolean =>
    (surface.hallwayMarksAt(x, y) & WALK_BITS) !== 0;
  for (let y = 0; y < surface.height; y++) {
    for (let x = 0; x < surface.width; x++) {
      if (!onLine(x, y)) continue;
      if (onLine(x + 1, y) && onLine(x, y + 1) && onLine(x + 1, y + 1)) {
        problems.push(`walk line doubles up in the block at (${x},${y})`);
      }
      const here = surface.hallwayMarksAt(x, y);
      const east = surface.hallwayMarksAt(x + 1, y);
      const rung =
        (here & WALK_LINE_EAST) !== 0 &&
        (here & RUNS_NORTH_SOUTH) !== 0 &&
        (east & RUNS_NORTH_SOUTH) !== 0;
      if (rung) problems.push(`walk line has a rung at (${x},${y})`);
    }
  }
  return problems;
}

/** Counts each character's dressed rooms and how many got their feature. */
function countPlacements(map: GameMap, totals: Totals): void {
  for (const room of map.regionMap.rooms) {
    const assignment = map.regionCharacters.forRegion(room.id);
    if (assignment?.type !== 'room' || assignment.character.floorFeature === null) continue;
    // Hazard stripes are laid round a boiler; a room the generator could not
    // fit one into has nothing for them to warn of.
    if (
      assignment.character.floorFeature === 'hazard_stripes' &&
      !roomHasType(map, room.bounds, BOILER)
    ) {
      continue;
    }
    const key = `${assignment.character.id}/${assignment.character.floorFeature}`;
    const tally = totals.placements.get(key) ?? { rooms: 0, placed: 0 };
    tally.rooms++;
    if (map.floorSurface.features.some((feature) => feature.region === room.id)) tally.placed++;
    totals.placements.set(key, tally);
  }
}

function roomHasType(map: GameMap, bounds: Rect, type: number): boolean {
  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      if (map.structure[y][x].type === type) return true;
    }
  }
  return false;
}

function checkFeatures(map: GameMap, totals: Totals): void {
  const surface = map.floorSurface;
  for (const feature of surface.features) {
    totals.features.set(feature.kind, (totals.features.get(feature.kind) ?? 0) + 1);
  }
  const problems = featureProblems(map, surface);
  check(
    problems.length === 0,
    `${problems.length} feature problems, e.g. ${problems.slice(0, EXAMPLE_MISMATCHES).join('; ')}`,
  );
  const ladders = walkLineLadders(surface);
  check(
    ladders.length === 0,
    `${ladders.length} walk-line ladders, e.g. ${ladders.slice(0, EXAMPLE_MISMATCHES).join('; ')}`,
  );
  countPlacements(map, totals);

  for (let y = 0; y < surface.height; y++) {
    for (let x = 0; x < surface.width; x++) {
      const marks = surface.hallwayMarksAt(x, y);
      if ((marks & (GUTTER_SOUTH | GUTTER_EAST)) !== 0) totals.gutterTiles++;
      if ((marks & WALK_BITS) !== 0) {
        totals.walkLineTiles++;
        check(
          surface.edgeLinesAt(x, y) === 0,
          `(${x},${y}) carries both a walk line and an edge line`,
        );
      }
      if (surface.isPuddleAt(x, y)) {
        totals.puddleTiles++;
        check(
          isWalkableTileType(map.structure[y][x]),
          `puddle on (${x},${y}), which is not walkable`,
        );
        const kind = surface.featureAt(x, y)?.kind;
        check(
          kind !== undefined && WATER_FEATURES.has(kind),
          `puddle on (${x},${y}) belongs to no water feature`,
        );
      }
    }
  }
}

/**
 * The feature checks must be able to fail: a feature moved onto a doorway, and
 * one the tile index never points at, must each be reported.
 */
function featureSelfTest(map: GameMap): void {
  currentLabel = 'feature self-test';
  const { features } = map.floorSurface;
  const original = features.length > 0 ? features[0] : null;
  const room = original === null ? null : map.regionMap.room(original.region);
  const door = room !== null && room.doorways.length > 0 ? room.doorways[0].tile : null;
  check(original !== null && door !== null, 'no feature with a doorway to sabotage');
  if (original === null || door === null) return;
  const onDoorway: PlacedFloorFeature = {
    ...original,
    footprint: { x: door.x, y: door.y, w: 1, h: 1 },
  };
  const doorwayView: FeatureView = {
    features: [onDoorway],
    featureAt: (x, y) => (x === door.x && y === door.y ? onDoorway : null),
  };
  check(
    featureProblems(map, doorwayView).some((problem) => problem.includes('beside a doorway')),
    'a feature painted on a doorway was not reported',
  );
  const unindexed: FeatureView = { features: [original], featureAt: () => null };
  check(
    featureProblems(map, unindexed).some((problem) => problem.includes('paints no tile')),
    'a feature the tile index never points at was not reported',
  );
}

function checkWearBounds(map: GameMap, surface: FloorSurface): void {
  let outOfRange = 0;
  let strayWear = 0;
  for (let y = 0; y <= surface.height; y++) {
    for (let x = 0; x <= surface.width; x++) {
      if (!inRange(surface.washAtVertex(x, y), -1, 1)) outOfRange++;
      if (x === surface.width || y === surface.height) continue;
      if (!inRange(surface.wearAt(x, y), 0, 1) || !inRange(surface.washAt(x, y), -1, 1)) {
        outOfRange++;
      }
      const dressed = map.characterAt(x, y) !== null;
      if (!dressed && (surface.wearAt(x, y) !== 0 || surface.washAt(x, y) !== 0)) strayWear++;
    }
  }
  check(outOfRange === 0, `${outOfRange} wear, wash or vertex values outside their range`);
  check(strayWear === 0, `${strayWear} tiles outside every dressed region carry wear or wash`);
}

/**
 * In each dressed room with two or more doorways, the doorways — where every
 * route through the room starts and ends — must be worn more than the room on
 * average, and the room's most-worn tiles must include one on a shortest route between
 * two of them.
 *
 * Not "on-route tiles beat off-route tiles": on a 4-connected grid the shortest
 * routes between two doorways that are not in line fill the whole rectangle
 * between them, most of which almost no route actually crosses.
 */
function checkWearFollowsRoutes(map: GameMap, surface: FloorSurface, totals: Totals): void {
  for (const room of map.regionMap.rooms) {
    if (map.regionCharacters.forRegion(room.id)?.type !== 'room') continue;
    const { x: left, y: top, w, h } = room.bounds;
    const walkable = (x: number, y: number): boolean =>
      x >= left &&
      y >= top &&
      x < left + w &&
      y < top + h &&
      isWalkableTileType(map.structure[y][x]);
    const ends = room.doorways.map((doorway) => doorway.tile).filter((t) => walkable(t.x, t.y));
    if (ends.length < 2) continue;

    const distancesFrom = (start: { x: number; y: number }): Int32Array => {
      const distance = new Int32Array(w * h).fill(-1);
      distance[(start.y - top) * w + (start.x - left)] = 0;
      const queue = [start];
      // A for-of over an array visits what is pushed onto it mid-loop, which is the queue.
      for (const at of queue) {
        for (const [dx, dy] of [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ]) {
          const nx = at.x + dx;
          const ny = at.y + dy;
          if (!walkable(nx, ny)) continue;
          const index = (ny - top) * w + (nx - left);
          if (distance[index] !== -1) continue;
          distance[index] = distance[(at.y - top) * w + (at.x - left)] + 1;
          queue.push({ x: nx, y: ny });
        }
      }
      return distance;
    };
    const fields = ends.map(distancesFrom);
    const onRoute = new Uint8Array(w * h);
    for (let a = 0; a < ends.length; a++) {
      for (let b = a + 1; b < ends.length; b++) {
        const length = fields[a][(ends[b].y - top) * w + (ends[b].x - left)];
        if (length < 0) continue;
        for (let index = 0; index < w * h; index++) {
          if (fields[a][index] >= 0 && fields[a][index] + fields[b][index] === length) {
            onRoute[index] = 1;
          }
        }
      }
    }
    let roomSum = 0;
    let roomCount = 0;
    let peakWear = -1;
    let peakOnRoute = false;
    for (let index = 0; index < w * h; index++) {
      const x = left + (index % w);
      const y = top + Math.floor(index / w);
      if (!walkable(x, y)) continue;
      const wear = surface.wearAt(x, y);
      roomSum += wear;
      roomCount++;
      // Wear saturates at 1, so several tiles can share the peak; any of them
      // lying on a route is enough.
      if (wear > peakWear) {
        peakWear = wear;
        peakOnRoute = onRoute[index] === 1;
      } else if (wear === peakWear && onRoute[index] === 1) {
        peakOnRoute = true;
      }
    }
    const doorwayMean =
      ends.reduce((sum, end) => sum + surface.wearAt(end.x, end.y), 0) / ends.length;
    const roomMean = roomSum / roomCount;
    totals.roomsWithRoutes++;
    check(
      doorwayMean > roomMean,
      `room ${room.id}'s doorways are worn ${doorwayMean.toFixed(WEAR_DIGITS)}, ` +
        `no more than the room's mean of ${roomMean.toFixed(WEAR_DIGITS)}`,
    );
    check(
      peakOnRoute,
      `room ${room.id}'s most-worn tiles are on no shortest route between doorways`,
    );
  }
}

function checkFloorMap(map: GameMap, floorName: string, totals: Totals): void {
  totals.maps++;
  const mismatches = materialMismatches(map);
  check(
    mismatches.length === 0,
    `${mismatches.length} tiles resolve to the wrong material, e.g. ${mismatches.slice(0, EXAMPLE_MISMATCHES).join('; ')}`,
  );

  const before = gridSnapshot(map);
  const rebuilt = buildFloorSurface({
    grid: map.structure,
    regionMap: map.regionMap,
    characters: map.regionCharacters,
  });
  check(gridSnapshot(map) === before, 'building the floor surface changed the tile grid');
  check(
    sameSurface(rebuilt, map.floorSurface),
    'rebuilding the floor surface gave a different one',
  );

  checkWearBounds(map, map.floorSurface);
  checkFeatures(map, totals);
  checkWearFollowsRoutes(map, map.floorSurface, totals);

  let lineTiles = 0;
  for (let y = 0; y < map.floorSurface.height; y++) {
    for (let x = 0; x < map.floorSurface.width; x++) {
      if (map.floorSurface.edgeLinesAt(x, y) !== 0) {
        lineTiles++;
        check(
          map.regionKind(map.regionAt(x, y)) === 'hallway',
          `edge line on (${x},${y}), which is not a hallway`,
        );
      }
      const material = map.floorSurface.materialAt(x, y);
      if (material !== null && CHARACTER_ONLY_MATERIALS.includes(material)) {
        totals.characterOnlyTiles.set(material, (totals.characterOnlyTiles.get(material) ?? 0) + 1);
      }
    }
  }
  if (floorName === 'floor 1')
    check(lineTiles === 0, `${lineTiles} edge-line tiles on the cellars`);
  totals.edgeLineTiles += lineTiles;
}

/** Unregistering the surface must make the material check fail, or it proves nothing. */
function selfTest(map: GameMap): void {
  currentLabel = 'self-test';
  registerFloorSurface(map.structure, FloorSurface.empty());
  const sabotaged = materialMismatches(map).length;
  registerFloorSurface(map.structure, map.floorSurface);
  check(sabotaged > 0, 'the material check passed with no floor surface registered');
  check(materialMismatches(map).length === 0, 're-registering the surface did not restore it');
}

// ── Seams at fractional scales ──────────────────────────────────────────────

/** Canvas scales the seam fixture is drawn at: whole, and the fractional ones that tear. */
const UNSCALED = 1;
const SHRUNK_SCALE = 0.9;
const SLIGHTLY_ENLARGED_SCALE = 1.1;
const QUARTER_ENLARGED_SCALE = 1.25;
const HALF_ENLARGED_SCALE = 1.5;
const SEAM_SCALES: ReadonlyArray<number> = [
  UNSCALED,
  SHRUNK_SCALE,
  SLIGHTLY_ENLARGED_SCALE,
  QUARTER_ENLARGED_SCALE,
  HALF_ENLARGED_SCALE,
];
const SEAM_FIXTURE_TILES_W = 5;
const SEAM_FIXTURE_TILES_H = 3;
/** A flat wash, so every pixel of the fixture's wash layer should carry the same alpha. */
const SEAM_FIXTURE_WASH = 0.5;
/**
 * How far a pixel's alpha may differ from the rest of its row, in levels.
 * Anti-aliasing at a fractional tile edge leaves a dip of a quarter of the
 * alpha or more; snapping leaves only rounding noise.
 */
const SEAM_STEP_TOLERANCE = 2;
const ALPHA_OFFSET = 3;
const RGBA_STRIDE = 4;
/** The gap the seam self-test opens between tiles. */
const SELF_TEST_GAP_PX = 1;

/**
 * A fixture floor surface: a flat wash over a five-by-three block whose middle
 * row carries a walk line from end to end. Every tile edge in it should be
 * invisible.
 */
function seamFixture(): FloorSurface {
  const count = SEAM_FIXTURE_TILES_W * SEAM_FIXTURE_TILES_H;
  const vertices = (SEAM_FIXTURE_TILES_W + 1) * (SEAM_FIXTURE_TILES_H + 1);
  const hallwayMarks = new Uint8Array(count);
  const middleRow = Math.floor(SEAM_FIXTURE_TILES_H / 2);
  for (let x = 0; x < SEAM_FIXTURE_TILES_W; x++) {
    hallwayMarks[middleRow * SEAM_FIXTURE_TILES_W + x] = WALK_LINE_EAST | WALK_LINE_WEST;
  }
  return new FloorSurface({
    width: SEAM_FIXTURE_TILES_W,
    height: SEAM_FIXTURE_TILES_H,
    materials: new Array<null>(count).fill(null),
    wear: new Float32Array(count),
    wash: new Float32Array(count).fill(SEAM_FIXTURE_WASH),
    cornerWash: new Float32Array(vertices).fill(SEAM_FIXTURE_WASH),
    edgeLines: new Uint8Array(count),
    hallwayMarks,
    features: [],
    featureIndex: new Int16Array(count).fill(-1),
    puddles: new Uint8Array(count),
  });
}

/**
 * Draws the fixture tile by tile at a canvas scale and counts the pixels whose
 * alpha differs from the rest of their row. `gapPx` pushes every tile apart,
 * for the self-test.
 */
function seamSteps(scale: number, gapPx: number): number {
  const grid: TileContent[][] = Array.from({ length: SEAM_FIXTURE_TILES_H }, (_row, y) =>
    Array.from({ length: SEAM_FIXTURE_TILES_W }, (_tile, x) => ({
      tileId: `${x}#${y}`,
      type: FloorTypeValue.concrete,
    })),
  );
  registerFloorSurface(grid, seamFixture());
  const ts = TILE_SIZE;
  const width = Math.ceil(SEAM_FIXTURE_TILES_W * (ts + gapPx) * scale);
  const height = Math.ceil(SEAM_FIXTURE_TILES_H * ts * scale);
  const canvas = createCanvas(width, height);
  const nodeCtx = canvas.getContext('2d');
  const ctx = asGameContext(nodeCtx);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  for (let y = 0; y < SEAM_FIXTURE_TILES_H; y++) {
    for (let x = 0; x < SEAM_FIXTURE_TILES_W; x++) {
      drawFloorSurface(ctx, grid, x * (ts + gapPx), y * ts, ts, x, y);
    }
  }
  // Every row of the fixture is the same all the way across — a flat wash,
  // and a walk line running end to end — so any pixel that differs from its
  // row's first is a seam.
  const data = nodeCtx.getImageData(0, 0, width, height).data;
  const alpha = (px: number, py: number): number =>
    data[(py * width + px) * RGBA_STRIDE + ALPHA_OFFSET];
  const drawnWidth = Math.floor(SEAM_FIXTURE_TILES_W * (ts + gapPx) * scale) - 1;
  let steps = 0;
  for (let py = 0; py < height; py++) {
    const first = alpha(0, py);
    for (let px = 1; px < drawnWidth; px++) {
      if (Math.abs(alpha(px, py) - first) > SEAM_STEP_TOLERANCE) steps++;
    }
  }
  return steps;
}

/** Two parallel walk lines joined by rungs must be reported as a ladder. */
function ladderSelfTest(): void {
  currentLabel = 'walk-line self-test';
  const width = 3;
  const height = 2;
  const count = width * height;
  const hallwayMarks = new Uint8Array(count);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let bits = 0;
      if (x > 0) bits |= WALK_LINE_WEST;
      if (x < width - 1) bits |= WALK_LINE_EAST;
      bits |= y === 0 ? WALK_LINE_SOUTH : WALK_LINE_NORTH;
      hallwayMarks[y * width + x] = bits;
    }
  }
  const ladder = new FloorSurface({
    width,
    height,
    materials: new Array<null>(count).fill(null),
    wear: new Float32Array(count),
    wash: new Float32Array(count),
    cornerWash: new Float32Array((width + 1) * (height + 1)),
    edgeLines: new Uint8Array(count),
    hallwayMarks,
    features: [],
    featureIndex: new Int16Array(count).fill(-1),
    puddles: new Uint8Array(count),
  });
  check(walkLineLadders(ladder).length > 0, 'two walk lines side by side were not reported');
}

function checkSeams(): void {
  currentLabel = 'seams';
  installCanvasGlobals();
  for (const scale of SEAM_SCALES) {
    const steps = seamSteps(scale, 0);
    check(steps === 0, `${steps} seam pixels at tile edges at scale ${scale}`);
  }
  currentLabel = 'seam self-test';
  const gapped = seamSteps(UNSCALED, SELF_TEST_GAP_PX);
  check(gapped > 0, 'a one-pixel gap between tiles was not seen as a seam');
}

const FLOORS: ReadonlyArray<{ name: string; def: LevelDef }> = [
  { name: 'floor 1', def: level1 },
  { name: 'floor 2', def: level2 },
];

const seeds = seedsPerFloor();
let selfTested = false;
FLOORS.forEach(({ name, def }, floorIndex) => {
  setDungeonFloorTheme(def.groundTheme ?? DEFAULT_DUNGEON_FLOOR_THEME);
  const totals: Totals = {
    maps: 0,
    edgeLineTiles: 0,
    roomsWithRoutes: 0,
    characterOnlyTiles: new Map(),
    features: new Map(),
    gutterTiles: 0,
    walkLineTiles: 0,
    puddleTiles: 0,
    placements: new Map(),
  };
  for (let run = 0; run < seeds; run++) {
    const worldSeed = floorIndex * SEED_STRIDE_PER_FLOOR + run + 1;
    currentLabel = `${name} seed ${worldSeed}`;
    const map = new GameMap({
      mapSize: def.mapSize,
      tileHeight: TILE_SIZE,
      mapType: 'dungeon',
      dungeon: dungeonOptionsForLevel(def),
      worldSeed,
    });
    checkFloorMap(map, name, totals);
    if (!selfTested) {
      selfTest(map);
      featureSelfTest(map);
      selfTested = true;
    }
  }
  currentLabel = name;
  const floorPrefix = floorIndex === 0 ? 'f1_' : 'f2_';
  for (const material of CHARACTER_ONLY_MATERIALS.filter((m) => m.startsWith(floorPrefix))) {
    check(
      (totals.characterOnlyTiles.get(material) ?? 0) > 0,
      `no room on ${seeds} maps was laid in ${material}`,
    );
  }
  if (floorIndex === 1) check(totals.edgeLineTiles > 0, 'no hallway carries a painted edge line');
  const theme = def.groundTheme ?? DEFAULT_DUNGEON_FLOOR_THEME;
  const usedFeatures = new Set(
    ALL_REGION_CHARACTERS.filter((character) => character.floor === theme).flatMap((character) =>
      character.floorFeature === null ? [] : [character.floorFeature],
    ),
  );
  for (const feature of usedFeatures) {
    const seen =
      feature === 'gutter'
        ? totals.gutterTiles
        : feature === 'walk_line'
          ? totals.walkLineTiles
          : (totals.features.get(feature) ?? 0);
    check(seen > 0, `no map in ${seeds} drew the ${feature} a character on ${name} names`);
  }
  check(totals.puddleTiles > 0, `no standing water on ${seeds} maps`);
  for (const [key, tally] of totals.placements) {
    const rate = tally.placed / tally.rooms;
    check(
      rate >= MIN_PLACEMENT_RATE,
      `${key} placed in only ${tally.placed} of ${tally.rooms} rooms`,
    );
  }
  check(totals.roomsWithRoutes > 0, 'no dressed room had two doorways to route between');
  const laid = [...totals.characterOnlyTiles]
    .map(([material, tiles]) => `${material}×${tiles}`)
    .join(', ');
  console.log(
    `${name}: ${totals.maps} maps, ${totals.roomsWithRoutes} rooms with routes checked, ` +
      `${totals.edgeLineTiles} edge-line tiles, character-only materials: ${laid || 'none'}\n` +
      `  features: ${[...totals.features].map(([kind, count]) => `${kind}×${count}`).join(', ')}; ` +
      `gutter tiles ${totals.gutterTiles}, walk-line tiles ${totals.walkLineTiles}, ` +
      `puddle tiles ${totals.puddleTiles}\n  placed: ` +
      [...totals.placements]
        .map(([key, tally]) => `${key} ${tally.placed}/${tally.rooms}`)
        .join(', '),
  );
});

checkSeams();
ladderSelfTest();

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures === 0 ? 0 : 1);
