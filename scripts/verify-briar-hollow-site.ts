#!/usr/bin/env tsx
/**
 * Gate: Briar Hollow is sited, built and kept clear on every generated floor-3
 * world.
 *
 * Builds real `GameMap`s from a run of world seeds and asserts, per map:
 *
 *  - the generator found a site (a map that could not would have thrown);
 *  - the village is intact and reachable — the generator already asserts both
 *    before and after its repair passes, so a map that constructs has passed
 *    both; they are re-run here over the finished map;
 *  - the ring is closed except at its four gates (three tiles each, one
 *    centred in each wall), and is cut into at least `MIN_SEGMENTS` runs of
 *    `SEGMENT_MIN_TILES` to `SEGMENT_MAX_TILES` tiles that cover it exactly;
 *  - no village tile is in the town's safe zone or inside its wall;
 *  - no hostile spawn point, bounty site, camp or fairy-allowed tile lies in
 *    the palisade bounds plus the spawn margin;
 *  - the quarry has 8–12 deposits and the grove 14–18 trees, each reachable;
 *  - the road from the gate to the town is a walk — road tiles end to end, and
 *    the game's own A* from the gate to the town's nearest gate;
 *  - the same seed generates the same site, and the same grid tile for tile, twice;
 *  - the ground is level where the built places stand: over the town's wall
 *    ring, the village's footprint, the circus lot and every camp, the macro
 *    field's landform layers add nothing and each tile takes the floor's
 *    periodic tone exactly — while the open wilderness does carry relief, so
 *    the check cannot pass on a field that shades nothing.
 *
 * Negative tests: `--fault=palisade-hole` knocks one palisade tile out and
 * `--fault=doorway-prop` stands a prop on a doorway's inner tile after
 * generation; both must turn this red. (Dropping a keep-out consumer from the
 * generator is the third, and is a source edit.)
 *
 *   npm run verify:briar-hollow-site [-- --seeds=200] [-- --fault=palisade-hole]
 */

import { GameMap } from '../src/map/GameMap';
import { TILE_SIZE } from '../src/core/constants';
import {
  BRIDGE,
  DIRT_PATCH,
  HOLLOW_GATE,
  HOLLOW_PALISADE,
  HOLLOW_PROP_LOW,
  ROCK_DEPOSIT,
  TREE,
  FloorTypeValue,
  VERGE_GRASS,
  YARD_GRAVEL,
  type TileContent,
} from '../src/map/tileTypes';
import { isOverworldFairyTileAllowed } from '../src/levels/fairySpawner';
import {
  checkBriarHollowIsIntact,
  checkBriarHollowIsReachable,
} from '../src/map/overworld/briarHollowChecks';
import {
  SEGMENT_MAX_TILES,
  SEGMENT_MIN_TILES,
  type BriarHollowSite,
} from '../src/map/overworld/briarHollowSite';
import { OUTSIDE_BUILDINGS } from '../src/map/overworld/briarHollowLayout';
import type { GridView } from '../src/map/overworld/reachability';
import type { TilePoint, TileRect } from '../src/map/town/townPlan';
import { groundMacroFieldFor, periodicToneAt } from '../src/map/tiles/groundTiles';
import { overworldTerrainFor } from '../src/map/tiles/overworldTerrainRegistry';
import { MACRO_MARGIN_SAMPLES } from '../src/map/overworld/macroField';

const MAP_SIZE = 280;
const DEFAULT_SEEDS = 200;
/** Spread between consecutive seeds, so the run samples the seed space rather than one corner of it. */
const SEED_STRIDE = 7919;
const MIN_SEGMENTS = 10;
/** Offset from a tile's corner to its centre, in tiles. */
const TILE_CENTRE = 0.5;
/** Problems printed per failing map before the rest are summarised. */
const MAX_PROBLEMS_SHOWN = 6;
const GATE_TILES = 3;
const GATE_COUNT = 4;
const DEPOSITS_MIN = 8;
const DEPOSITS_MAX = 12;
const GROVE_MIN = 14;
const GROVE_MAX = 18;
/** Long enough for any village-to-town road on a 280-tile map. */
const ROAD_WALK_MAX_TILES = 400;

/**
 * What the road is made of end to end: packed earth, the worn patches the
 * ground-cover pass scatters over it, a gate apron's gravel, bridge decks, and
 * the village gate itself.
 */
const ROAD_SURFACES: ReadonlySet<number> = new Set([
  FloorTypeValue.road,
  DIRT_PATCH,
  YARD_GRAVEL,
  BRIDGE,
  HOLLOW_GATE,
]);

/** The macro field's samples are 8-bit RGBA. */
const RGBA_CHANNELS = 4;
const ALPHA_CHANNEL = 3;
const BYTE_MAX = 255;
/** A tile's four corners, as offsets from its top-left corner. */
const TILE_CORNERS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];

type Fault = 'palisade-hole' | 'doorway-prop' | null;

/** The `--` before an argument's name and the `=` after it. */
const ARG_PUNCTUATION_LENGTH = '--='.length;
const DECIMAL_RADIX = 10;
const MS_PER_SECOND = 1000;

function intArg(name: string, fallback: number): number {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw.slice(name.length + ARG_PUNCTUATION_LENGTH), DECIMAL_RADIX);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be an integer`);
  return value;
}

function faultArg(): Fault {
  const raw = process.argv.find((arg) => arg.startsWith('--fault='));
  if (raw === undefined) return null;
  const value = raw.slice('--fault='.length);
  if (value === 'palisade-hole' || value === 'doorway-prop') return value;
  throw new Error(`unknown --fault=${value}`);
}

function viewOf(map: GameMap): GridView {
  const cells = map.structure;
  const size = cells.length;
  return {
    size,
    cells,
    typeAt: (x: number, y: number) =>
      x < 0 || y < 0 || x >= size || y >= size ? undefined : cells[y][x].type,
  };
}

function rectContains(rect: TileRect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;
}

function tilesOf(rect: TileRect): TilePoint[] {
  const tiles: TilePoint[] = [];
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) tiles.push({ x, y });
  }
  return tiles;
}

/** Every tile the village occupies: the palisade bounds, the quarry, and the ruins disc. */
function villageTiles(site: BriarHollowSite): TilePoint[] {
  const { centre, radiusTiles } = site.ruins;
  const ruins = tilesOf({
    x: centre.x - radiusTiles,
    y: centre.y - radiusTiles,
    w: radiusTiles * 2 + 1,
    h: radiusTiles * 2 + 1,
  }).filter((tile) => Math.hypot(tile.x - centre.x, tile.y - centre.y) <= radiusTiles);
  return [...tilesOf(site.palisadeBounds), ...tilesOf(site.quarry.rect), ...ruins];
}

/** Applies a deliberate fault to a finished map, for the negative tests. */
function applyFault(map: GameMap, site: BriarHollowSite, fault: Fault): void {
  if (fault === 'palisade-hole') {
    const tile = site.palisadePath[Math.floor(site.palisadePath.length / 2)];
    map.structure[tile.y][tile.x] = { tileId: `${tile.x}#${tile.y}`, type: VERGE_GRASS };
  } else if (fault === 'doorway-prop') {
    const building = site.buildings.find((candidate) => !OUTSIDE_BUILDINGS.has(candidate.id));
    const door = building?.doorways[0];
    if (building === undefined || door === undefined) return;
    const inner = [
      { x: door.x + 1, y: door.y },
      { x: door.x - 1, y: door.y },
      { x: door.x, y: door.y + 1 },
      { x: door.x, y: door.y - 1 },
    ].find((tile) => rectContains(building.interior, tile.x, tile.y));
    if (inner === undefined) return;
    map.structure[inner.y][inner.x] = {
      tileId: `${inner.x}#${inner.y}`,
      type: HOLLOW_PROP_LOW,
      spriteKey: 'hollow:crate',
    };
  }
}

/** Road-only walk from the gate to any town gate exit: paving, bridges and the gate itself. */
function roadReachesTown(map: GameMap, site: BriarHollowSite): boolean {
  const plan = map.townPlan;
  if (plan === undefined) return false;
  const size = map.structure.length;
  const targets = new Set(plan.gates.map((gate) => gate.exit.y * size + gate.exit.x));
  const isRoad = (tile: TileContent) => ROAD_SURFACES.has(tile.type);
  const start = site.gate.outside;
  const seen = new Uint8Array(size * size);
  const queue: number[] = [start.y * size + start.x];
  seen[queue[0]] = 1;
  while (queue.length > 0) {
    const key = queue.pop();
    if (key === undefined) break;
    if (targets.has(key)) return true;
    const x = key % size;
    const y = Math.floor(key / size);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const next = ny * size + nx;
      if (seen[next] === 1 || !isRoad(map.structure[ny][nx])) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  return false;
}

/** The game's own A* from the gate's outside tile to the nearest town gate exit. */
function moverReachesTown(map: GameMap, site: BriarHollowSite): boolean {
  const plan = map.townPlan;
  if (plan === undefined) return false;
  const start = site.gate.outside;
  const nearest = [...plan.gates].sort(
    (a, b) =>
      Math.hypot(a.exit.x - start.x, a.exit.y - start.y) -
      Math.hypot(b.exit.x - start.x, b.exit.y - start.y),
  )[0];
  const path = map.findPath(start.x, start.y, nearest.exit.x, nearest.exit.y, ROAD_WALK_MAX_TILES);
  return path.length > 0;
}

function siteFingerprint(site: BriarHollowSite): string {
  return JSON.stringify({
    ...site,
    keepOut: site.keepOut.shapes,
    dressing: {
      ...site.dressing,
      householdColours: [...site.dressing.householdColours.entries()],
    },
  });
}

/** FNV-1a, 32-bit: offset basis and prime. */
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function mixIntoHash(hash: number, value: number): number {
  return Math.imul(hash ^ value, FNV_PRIME) >>> 0;
}

/**
 * A hash of the whole finished grid — every tile's type and art key. The site
 * record alone would not notice a paint pass that drew from an unseeded
 * source: the record comes out the same while the tiles differ.
 */
function gridFingerprint(map: GameMap): number {
  let hash = FNV_OFFSET_BASIS;
  for (const row of map.structure) {
    for (const tile of row) {
      hash = mixIntoHash(hash, tile.type);
      for (const char of tile.spriteKey ?? '') hash = mixIntoHash(hash, char.charCodeAt(0));
    }
  }
  return hash;
}

/**
 * Every tile a built place stands on: what must read as level ground.
 */
function levelPlaceTiles(map: GameMap): { place: string; tiles: TilePoint[] }[] {
  const terrain = overworldTerrainFor(map.structure);
  if (terrain === undefined) return [];
  const size = map.structure.length;
  const all: TilePoint[] = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) all.push({ x, y });
  const inDisc = (disc: { centre: TilePoint; radiusTiles: number }) => (tile: TilePoint) =>
    Math.hypot(tile.x - disc.centre.x, tile.y - disc.centre.y) <= disc.radiusTiles;
  return [
    { place: 'the town wall ring', tiles: tilesOf(terrain.town.wall) },
    {
      place: "Briar Hollow's footprint",
      tiles: all.filter((tile) => terrain.briarHollowKeepOut.contains(tile.x, tile.y)),
    },
    { place: 'the circus lot', tiles: all.filter(inDisc(terrain.circus)) },
    ...terrain.camps.map((camp) => ({
      place: `the ${camp.kind} camp at (${camp.centre.x}, ${camp.centre.y})`,
      tiles: all.filter(inDisc(camp)),
    })),
  ];
}

/**
 * The town and every landmark sit on level ground: over them the macro field
 * is the periodic tone alone, so they draw exactly as they would with no
 * landform at all.
 */
function checkLevelGround(map: GameMap): string[] {
  const field = groundMacroFieldFor(map.structure);
  if (field === undefined) return ['no macro field for an overworld map'];
  const problems: string[] = [];
  const sampleIndex = (cornerX: number, cornerY: number) =>
    (cornerY + MACRO_MARGIN_SAMPLES) * field.spanX + cornerX + MACRO_MARGIN_SAMPLES;
  for (const { place, tiles } of levelPlaceTiles(map)) {
    const uneven = tiles.find((tile) => {
      if (!field.levelTiles.isLevel(tile.x, tile.y)) return true;
      return TILE_CORNERS.some(([dx, dy]) => {
        const cornerX = tile.x + dx;
        const cornerY = tile.y + dy;
        const index = sampleIndex(cornerX, cornerY);
        const toneAlpha = Math.round(periodicToneAt(cornerX, cornerY) * BYTE_MAX);
        const sampleAlpha = field.rgba[index * RGBA_CHANNELS + ALPHA_CHANNEL];
        return field.landformAlpha[index] !== 0 || sampleAlpha !== toneAlpha;
      });
    });
    if (uneven !== undefined) {
      problems.push(`the ground over ${place} is not level at (${uneven.x}, ${uneven.y})`);
    }
  }
  if (!field.landformAlpha.some((alpha) => alpha > 0)) {
    problems.push('the macro field carries no relief anywhere');
  }
  return problems;
}

function checkMap(seed: number, fault: Fault): string[] {
  const problems: string[] = [];
  let map: GameMap;
  try {
    map = new GameMap({
      mapSize: MAP_SIZE,
      mapType: 'overworld',
      worldSeed: seed,
      tileHeight: TILE_SIZE,
    });
  } catch (error) {
    return [`generation threw: ${String(error)}`];
  }
  const site = map.briarHollow;
  if (site === null) return ['no Briar Hollow site on a floor-3 map'];
  applyFault(map, site, fault);
  const grid = viewOf(map);
  const town = map.townSquareCentre;
  if (town === undefined) return ['no town square'];

  problems.push(...checkBriarHollowIsIntact(grid, site));
  problems.push(...checkBriarHollowIsReachable(grid, site, town));

  // The ring: path + gates are every ring tile, and the path is cut exactly.
  if (site.gates.length !== GATE_COUNT) {
    problems.push(`village has ${site.gates.length} gates, not ${GATE_COUNT}`);
  }
  for (const gate of site.gates) {
    if (gate.tiles.length !== GATE_TILES) {
      problems.push(`the ${gate.facing} gate is ${gate.tiles.length} tiles, not ${GATE_TILES}`);
    }
  }
  if (site.segments.length < MIN_SEGMENTS) {
    problems.push(`only ${site.segments.length} palisade segments`);
  }
  let covered = 0;
  for (const segment of site.segments) {
    if (segment.tiles.length < SEGMENT_MIN_TILES || segment.tiles.length > SEGMENT_MAX_TILES) {
      problems.push(`segment ${segment.id} is ${segment.tiles.length} tiles`);
    }
    covered += segment.tiles.length;
  }
  if (covered !== site.palisadePath.length) {
    problems.push(`segments cover ${covered} of ${site.palisadePath.length} palisade tiles`);
  }
  for (const tile of tilesOf(site.palisadeBounds)) {
    const type = map.structure[tile.y][tile.x].type;
    const onRing = type === HOLLOW_PALISADE || type === HOLLOW_GATE;
    if (!onRing) continue;
    const listed =
      site.palisadePath.some((p) => p.x === tile.x && p.y === tile.y) ||
      site.gates.some((gate) => gate.tiles.some((g) => g.x === tile.x && g.y === tile.y));
    if (!listed)
      problems.push(`ring tile (${tile.x}, ${tile.y}) is in neither the path nor the gate`);
  }

  // Not a safe zone, and not the town.
  for (const tile of villageTiles(site)) {
    const px = (tile.x + TILE_CENTRE) * TILE_SIZE;
    const py = (tile.y + TILE_CENTRE) * TILE_SIZE;
    if (map.isInTownSafeZone(px, py)) {
      problems.push(`village tile (${tile.x}, ${tile.y}) is in the town safe zone`);
      break;
    }
    if (map.isInsideTownWall(px, py)) {
      problems.push(`village tile (${tile.x}, ${tile.y}) is inside the town wall`);
      break;
    }
  }

  // Nothing hostile is spawned on the village's doorstep.
  const exclusion = site.spawnExclusion;
  for (const point of [...map.hallwaySpawnPoints, ...map.mobSpawnPoints]) {
    if (rectContains(exclusion, point.x, point.y)) {
      problems.push(`hostile spawn point (${point.x}, ${point.y}) is inside the village exclusion`);
    }
  }
  for (const point of map.bountySites) {
    if (rectContains(exclusion, point.x, point.y)) {
      problems.push(`bounty site (${point.x}, ${point.y}) is inside the village exclusion`);
    }
  }
  for (const camp of map.camps) {
    const nearestX = Math.max(exclusion.x, Math.min(camp.centre.x, exclusion.x + exclusion.w - 1));
    const nearestY = Math.max(exclusion.y, Math.min(camp.centre.y, exclusion.y + exclusion.h - 1));
    if (Math.hypot(camp.centre.x - nearestX, camp.centre.y - nearestY) <= camp.radiusTiles) {
      problems.push(
        `the ${camp.kind} camp at (${camp.centre.x}, ${camp.centre.y}) overlaps the village`,
      );
    }
  }
  for (const tile of tilesOf(exclusion)) {
    if (isOverworldFairyTileAllowed(map, tile.x, tile.y)) {
      problems.push(
        `fairies may be placed at (${tile.x}, ${tile.y}), inside the village exclusion`,
      );
      break;
    }
  }

  // Nodes.
  const deposits = site.quarry.depositTiles;
  if (deposits.length < DEPOSITS_MIN || deposits.length > DEPOSITS_MAX) {
    problems.push(`quarry has ${deposits.length} deposits`);
  }
  for (const deposit of deposits) {
    if (map.structure[deposit.y][deposit.x].type !== ROCK_DEPOSIT) {
      problems.push(`deposit (${deposit.x}, ${deposit.y}) is not a ROCK_DEPOSIT`);
    }
  }
  const grove = site.lumberYard.groveTiles;
  if (grove.length < GROVE_MIN || grove.length > GROVE_MAX) {
    problems.push(`grove has ${grove.length} trees`);
  }
  for (const tree of grove) {
    if (map.structure[tree.y][tree.x].type !== TREE) {
      problems.push(`grove tile (${tree.x}, ${tree.y}) is not a TREE`);
    }
  }

  problems.push(...checkLevelGround(map));

  // The road.
  if (!roadReachesTown(map, site))
    problems.push('the road from the gate does not reach a town gate');
  if (!moverReachesTown(map, site)) problems.push('no A* walk from the gate to the town');

  // Determinism.
  if (fault === null) {
    const again = new GameMap({
      mapSize: MAP_SIZE,
      mapType: 'overworld',
      worldSeed: seed,
      tileHeight: TILE_SIZE,
    });
    if (
      again.briarHollow === null ||
      siteFingerprint(again.briarHollow) !== siteFingerprint(site)
    ) {
      problems.push('the same seed generated a different site');
    }
    if (gridFingerprint(again) !== gridFingerprint(map)) {
      problems.push('the same seed generated a different grid');
    }
  }
  return problems;
}

const seeds = intArg('seeds', DEFAULT_SEEDS);
const fault = faultArg();
let failedMaps = 0;
const startedAt = Date.now();
for (let index = 1; index <= seeds; index++) {
  const seed = index * SEED_STRIDE;
  const problems = checkMap(seed, fault);
  if (problems.length === 0) continue;
  failedMaps++;
  console.error(`seed ${seed}:`);
  for (const problem of problems.slice(0, MAX_PROBLEMS_SHOWN)) console.error(`  - ${problem}`);
  if (problems.length > MAX_PROBLEMS_SHOWN) {
    console.error(`  … and ${problems.length - MAX_PROBLEMS_SHOWN} more`);
  }
}
const seconds = ((Date.now() - startedAt) / MS_PER_SECOND).toFixed(1);
if (failedMaps > 0) {
  console.error(
    `\nFAIL: ${failedMaps} of ${seeds} maps (${seconds}s)${fault === null ? '' : ` [fault ${fault}]`}`,
  );
  process.exit(1);
}
console.log(`PASS: Briar Hollow sited and intact on ${seeds} of ${seeds} maps (${seconds}s)`);
