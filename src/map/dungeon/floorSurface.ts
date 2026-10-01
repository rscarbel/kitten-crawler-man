/**
 * What the floor of a generated dungeon level is laid in, tile by tile, and how
 * worn each part of it is.
 *
 * Two things the tile painters need and the tile grid cannot tell them:
 *
 * - **The material.** A dressed room is floored in its character's material,
 *   and a dressed hallway in its hallway character's, rather than in whatever
 *   the generator's generic floor type for the zone maps to. The generic type
 *   stays on the grid untouched — walkability, spawning, the minimap and every
 *   gate read it — and the painters ask this record first. Anything with no
 *   character (start, safe, boss and quest rooms, the arena, the spider lab,
 *   undressed regions) answers null and falls back to the tile type, which is
 *   what keeps those rooms' own art.
 * - **The wear.** Where people walk, a floor is polished; where nobody does, and
 *   along the foot of every wall, dust settles. Each dressed room is worn along
 *   the shortest paths between its doorways and each dressed hallway down its
 *   centre line, blurred so the result is a broad tonal field, then turned into
 *   a signed wash: positive lifts and softens the floor, negative darkens it.
 *
 * Derived data: built once from the finished grid when the map is generated,
 * never updated and never checkpointed. A prop that is later smashed does not
 * re-route the wear, which is right — the floor was walked on for years before
 * the crawl, not in the last minute.
 */

import type { TileContent } from '../tileTypes';
import { FloorTypeValue } from '../tileTypes';
import { isWalkableTileType } from '../walkability';
import { NO_REGION, type RegionMap, type RoomRegion } from '../regionMap';
import type { Point, Rect } from '../roomDoorways';
import type { DungeonFloorThemeId } from './floorTheme';
import type { RegionCharacters } from './regionCharacters';
import type { CharacterFloorMaterial } from './roomCharacters';
import {
  featurePaintsTile,
  layGutter,
  layWalkLine,
  LIQUID_EDGE_FIELD,
  liquidField,
  placeRoomFeature,
  smoothstep,
  WALK_LINE_MIN_TILES,
  WATER_FEATURES,
  type PlacedFloorFeature,
} from './floorFeatures';

/** Cardinal sides of a tile a painted edge line runs along. */
export const EDGE_LINE_NORTH = 1;
export const EDGE_LINE_EAST = 2;
export const EDGE_LINE_SOUTH = 4;
export const EDGE_LINE_WEST = 8;
/**
 * Corners where the wall turns away from the tile: the wall is diagonal to it
 * and both cardinal neighbours either side are open, so the line has to bend
 * round the corner through this tile.
 */
export const EDGE_LINE_TURN_NE = 16;
export const EDGE_LINE_TURN_SE = 32;
export const EDGE_LINE_TURN_SW = 64;
export const EDGE_LINE_TURN_NW = 128;

/** Share of a region's peak wear that already counts as fully worn. */
const WEAR_PEAK_SHARE = 0.85;
/** Wear below which a tile has a polished lift at all. */
const LIFT_FROM_WEAR = 0.3;
/** Wear at which a tile counts as on the beaten path, for measuring how far off it others lie. */
const TRODDEN_WEAR = 0.5;
/**
 * Tiles from the beaten path at which dust starts to gather, and at which it is
 * as thick as it gets. Measured in steps rather than read off the wear, so a
 * room's dust deepens steadily toward its corners instead of switching on
 * wherever the blurred wear happens to run out.
 */
const DUST_FROM_TILES = 2;
const DUST_FULL_TILES = 7;
/** How dusty the band along a wall's foot is, against an untrodden floor's full dust. */
const FACE_BAND_DUST = 0.7;
/** Wear of a hallway tile beside its centre line, against the centre line's 1. */
const HALLWAY_SHOULDER_WEAR = 0.45;
/** Separable blur passes over the rooms' path counts; each widens the field by a tile. */
const WEAR_BLUR_PASSES = 3;

const CARDINALS: ReadonlyArray<Point> = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

/** A neighbour of a tile and the line bit a wall standing there sets. */
interface EdgeProbe {
  readonly dx: number;
  readonly dy: number;
  readonly bit: number;
}

const EDGE_SIDES: ReadonlyArray<EdgeProbe> = [
  { dx: 0, dy: -1, bit: EDGE_LINE_NORTH },
  { dx: 1, dy: 0, bit: EDGE_LINE_EAST },
  { dx: 0, dy: 1, bit: EDGE_LINE_SOUTH },
  { dx: -1, dy: 0, bit: EDGE_LINE_WEST },
];

const EDGE_TURNS: ReadonlyArray<EdgeProbe> = [
  { dx: 1, dy: -1, bit: EDGE_LINE_TURN_NE },
  { dx: 1, dy: 1, bit: EDGE_LINE_TURN_SE },
  { dx: -1, dy: 1, bit: EDGE_LINE_TURN_SW },
  { dx: -1, dy: -1, bit: EDGE_LINE_TURN_NW },
];

function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

/** The per-tile and per-feature records a {@link FloorSurface} answers from. */
interface FloorSurfaceParts {
  readonly width: number;
  readonly height: number;
  readonly materials: ReadonlyArray<CharacterFloorMaterial | null>;
  /** Per tile, 0..1. */
  readonly wear: Float32Array;
  /** Per tile, -1..1: positive is a polished lift, negative a dusty wash. */
  readonly wash: Float32Array;
  /** Per grid vertex, `(width + 1) × (height + 1)`: the wash the painter interpolates. */
  readonly cornerWash: Float32Array;
  readonly edgeLines: Uint8Array;
  /** `GUTTER_*` and `WALK_LINE_*` bits per tile. */
  readonly hallwayMarks: Uint8Array;
  readonly features: ReadonlyArray<PlacedFloorFeature>;
  /** Per tile, the index into {@link features} of the feature painted there, or -1. */
  readonly featureIndex: Int16Array;
  /** Per tile, 1 where standing water covers the tile's centre. */
  readonly puddles: Uint8Array;
}

const NO_FEATURE = -1;

export class FloorSurface {
  readonly width: number;
  readonly height: number;

  constructor(private readonly parts: FloorSurfaceParts) {
    this.width = parts.width;
    this.height = parts.height;
  }

  /** A surface with no materials, wear, lines or features, for maps that are not dungeon levels. */
  static empty(): FloorSurface {
    return new FloorSurface({
      width: 0,
      height: 0,
      materials: [],
      wear: new Float32Array(0),
      wash: new Float32Array(0),
      cornerWash: new Float32Array(0),
      edgeLines: new Uint8Array(0),
      hallwayMarks: new Uint8Array(0),
      features: [],
      featureIndex: new Int16Array(0),
      puddles: new Uint8Array(0),
    });
  }

  private inside(tileX: number, tileY: number): boolean {
    return tileX >= 0 && tileY >= 0 && tileX < this.width && tileY < this.height;
  }

  /** The material a dressed room or hallway is laid in, or null where the tile type decides. */
  materialAt(tileX: number, tileY: number): CharacterFloorMaterial | null {
    if (!this.inside(tileX, tileY)) return null;
    return this.parts.materials[tileY * this.width + tileX] ?? null;
  }

  /** How worn a tile is, 0 (untrodden) to 1 (the beaten path). */
  wearAt(tileX: number, tileY: number): number {
    if (!this.inside(tileX, tileY)) return 0;
    return this.parts.wear[tileY * this.width + tileX];
  }

  /** A tile's own wash, -1..1. */
  washAt(tileX: number, tileY: number): number {
    if (!this.inside(tileX, tileY)) return 0;
    return this.parts.wash[tileY * this.width + tileX];
  }

  /**
   * The wash at the grid vertex at a tile's north-west corner. Two tiles sharing
   * an edge read the same two vertices, which is what keeps the wash continuous
   * across tile edges instead of stepping tile by tile.
   */
  washAtVertex(vertexX: number, vertexY: number): number {
    if (vertexX < 0 || vertexY < 0 || vertexX > this.width || vertexY > this.height) return 0;
    return this.parts.cornerWash[vertexY * (this.width + 1) + vertexX];
  }

  /** `EDGE_LINE_*` bits for the painted line along a hallway's walls. */
  edgeLinesAt(tileX: number, tileY: number): number {
    if (!this.inside(tileX, tileY)) return 0;
    return this.parts.edgeLines[tileY * this.width + tileX];
  }

  /** `GUTTER_*` and `WALK_LINE_*` bits for the decals laid along a hallway. */
  hallwayMarksAt(tileX: number, tileY: number): number {
    if (!this.inside(tileX, tileY)) return 0;
    return this.parts.hallwayMarks[tileY * this.width + tileX];
  }

  /** Every room feature placed on the level. */
  get features(): ReadonlyArray<PlacedFloorFeature> {
    return this.parts.features;
  }

  /** The room feature painted on a tile, if any. */
  featureAt(tileX: number, tileY: number): PlacedFloorFeature | null {
    if (!this.inside(tileX, tileY)) return null;
    const index = this.parts.featureIndex[tileY * this.width + tileX];
    return index === NO_FEATURE ? null : (this.parts.features[index] ?? null);
  }

  /**
   * Whether standing water covers a tile's centre — a puddle, or the water
   * round a floor drain. For the live layers that play on water: a light's
   * glint, a ripple underfoot or under a drip. Walkable like any floor.
   */
  isPuddleAt(tileX: number, tileY: number): boolean {
    if (!this.inside(tileX, tileY)) return false;
    return this.parts.puddles[tileY * this.width + tileX] === 1;
  }
}

/**
 * Materials laid as an inset within a room rather than wall to wall, and the
 * floor around them. A boiler room's grating is a run of panels set into the
 * slab: a whole room of it is the busiest floor on the level, and a border of
 * concrete lets every doorway meet the hallway's own surface.
 */
const INSET_SURROUNDS: Partial<Record<CharacterFloorMaterial, CharacterFloorMaterial>> = {
  f2_grating: 'f2_concrete',
};
/** Width of the border an inset material leaves inside its room's walls, in tiles. */
const INSET_BORDER_TILES = 1;

/**
 * The material a character's floor is laid in at one tile: its own, or the
 * surround where an inset material leaves a border inside the room's bounds.
 * Hallways (no bounds) are always laid in their own material.
 */
export function laidMaterial(
  material: CharacterFloorMaterial,
  roomBounds: Readonly<Rect> | null,
  x: number,
  y: number,
): CharacterFloorMaterial {
  const surround = INSET_SURROUNDS[material];
  if (surround === undefined || roomBounds === null) return material;
  const inset =
    x >= roomBounds.x + INSET_BORDER_TILES &&
    y >= roomBounds.y + INSET_BORDER_TILES &&
    x < roomBounds.x + roomBounds.w - INSET_BORDER_TILES &&
    y < roomBounds.y + roomBounds.h - INSET_BORDER_TILES;
  return inset ? material : surround;
}

/** Everything {@link buildFloorSurface} reads. */
export interface FloorSurfaceInput {
  readonly grid: TileContent[][];
  readonly regionMap: RegionMap;
  readonly characters: RegionCharacters;
}

interface PathCounts {
  /** Steps from the source, -1 where unreachable. */
  readonly distance: Int32Array;
  /** Number of distinct shortest paths from the source. */
  readonly paths: Float64Array;
}

/** Breadth-first shortest paths, and how many there are, inside one room. */
function countShortestPaths(
  room: RoomRegion,
  walkable: Uint8Array,
  gridWidth: number,
  source: Point,
): PathCounts {
  const { x: left, y: top, w, h } = room.bounds;
  const distance = new Int32Array(w * h).fill(-1);
  const paths = new Float64Array(w * h);
  const local = (x: number, y: number): number => (y - top) * w + (x - left);
  const queue: Point[] = [source];
  distance[local(source.x, source.y)] = 0;
  paths[local(source.x, source.y)] = 1;
  // A for-of over an array visits what is pushed onto it mid-loop, which is the queue.
  for (const at of queue) {
    const atIndex = local(at.x, at.y);
    for (const step of CARDINALS) {
      const x = at.x + step.x;
      const y = at.y + step.y;
      if (x < left || y < top || x >= left + w || y >= top + h) continue;
      if (walkable[y * gridWidth + x] === 0) continue;
      const next = local(x, y);
      if (distance[next] === -1) {
        distance[next] = distance[atIndex] + 1;
        queue.push({ x, y });
      }
      if (distance[next] === distance[atIndex] + 1) paths[next] += paths[atIndex];
    }
  }
  return { distance, paths };
}

/** The walkable tile of a room nearest its centre, for a room with only one way in. */
function roomHeart(room: RoomRegion, walkable: Uint8Array, gridWidth: number): Point | null {
  const { x: left, y: top, w, h } = room.bounds;
  const centreX = left + (w - 1) / 2;
  const centreY = top + (h - 1) / 2;
  let best: Point | null = null;
  let bestDistance = Infinity;
  for (let y = top; y < top + h; y++) {
    for (let x = left; x < left + w; x++) {
      if (walkable[y * gridWidth + x] === 0) continue;
      const distance = Math.hypot(x - centreX, y - centreY);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { x, y };
      }
    }
  }
  return best;
}

/**
 * Adds, to every tile of a room, the share of shortest paths between each pair
 * of its doorways that pass through it — the betweenness of the tile on the
 * room's own routes. A room with one doorway is worn from it to its middle.
 */
function accumulateRoomWear(
  room: RoomRegion,
  walkable: Uint8Array,
  gridWidth: number,
  raw: Float32Array,
): void {
  const ends = room.doorways
    .map((doorway) => doorway.tile)
    .filter((tile) => walkable[tile.y * gridWidth + tile.x] === 1);
  if (ends.length === 1) {
    const heart = roomHeart(room, walkable, gridWidth);
    if (heart !== null) ends.push(heart);
  }
  if (ends.length < 2) return;

  const { x: left, y: top, w, h } = room.bounds;
  const counts = ends.map((end) => countShortestPaths(room, walkable, gridWidth, end));
  for (let a = 0; a < ends.length; a++) {
    for (let b = a + 1; b < ends.length; b++) {
      const from = counts[a];
      const to = counts[b];
      const endIndex = (ends[b].y - top) * w + (ends[b].x - left);
      const length = from.distance[endIndex];
      const total = from.paths[endIndex];
      if (length < 0 || total <= 0) continue;
      for (let index = 0; index < w * h; index++) {
        const there = from.distance[index];
        const back = to.distance[index];
        if (there < 0 || back < 0 || there + back !== length) continue;
        const tileX = left + (index % w);
        const tileY = top + Math.floor(index / w);
        raw[tileY * gridWidth + tileX] += (from.paths[index] * to.paths[index]) / total;
      }
    }
  }
}

/**
 * Scales a room's path counts to a peak of one, the value a hallway's centre
 * line is given, so the blur that carries each into the other at a doorway
 * mixes like with like.
 */
function normaliseRect(values: Float32Array, width: number, rect: Rect): void {
  let peak = 0;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) peak = Math.max(peak, values[y * width + x]);
  }
  if (peak <= 0) return;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) values[y * width + x] /= peak;
  }
}

/**
 * Steps from each tile to the nearest source tile, 4-connected, moving only
 * through `passable` tiles; -1 where no source can be reached.
 */
function stepsFrom(
  sources: Uint8Array,
  passable: Uint8Array,
  width: number,
  height: number,
): Int32Array {
  const distance = new Int32Array(width * height).fill(-1);
  const queue: number[] = [];
  for (let index = 0; index < sources.length; index++) {
    if (sources[index] === 1) {
      distance[index] = 0;
      queue.push(index);
    }
  }
  for (const index of queue) {
    const x = index % width;
    const y = Math.floor(index / width);
    for (const step of CARDINALS) {
      const nx = x + step.x;
      const ny = y + step.y;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (distance[next] !== -1 || passable[next] === 0) continue;
      distance[next] = distance[index] + 1;
      queue.push(next);
    }
  }
  return distance;
}

/** One pass of a [1, 2, 1] blur along one axis, weighted so closed tiles neither give nor take. */
function blurAxis(
  values: Float32Array,
  open: Uint8Array,
  width: number,
  height: number,
  horizontal: boolean,
): Float32Array {
  const out = new Float32Array(values.length);
  const kernel: ReadonlyArray<{ offset: number; weight: number }> = [
    { offset: -1, weight: 1 },
    { offset: 0, weight: 2 },
    { offset: 1, weight: 1 },
  ];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (open[index] === 0) continue;
      let sum = 0;
      let weights = 0;
      for (const tap of kernel) {
        const sx = horizontal ? x + tap.offset : x;
        const sy = horizontal ? y : y + tap.offset;
        if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
        const sample = sy * width + sx;
        if (open[sample] === 0) continue;
        sum += values[sample] * tap.weight;
        weights += tap.weight;
      }
      out[index] = weights > 0 ? sum / weights : 0;
    }
  }
  return out;
}

/** The record for a map with no dressed regions: every tile falls back to its type. */
const EMPTY_SURFACE = FloorSurface.empty();

/**
 * Lays out the floor of a generated dungeon level: each dressed region's
 * material, the wear field, its wash, and the painted edge line along the
 * walls of the service level's hallways.
 *
 * Pure and deterministic: the same grid and regions always give the same
 * surface, with no randomness drawn, so it cannot disturb any seeded stream.
 */
export function buildFloorSurface(input: FloorSurfaceInput): FloorSurface {
  const { grid, regionMap, characters } = input;
  if (regionMap.rooms.length === 0 && regionMap.hallways.length === 0) return EMPTY_SURFACE;
  const height = grid.length;
  const width = height === 0 ? 0 : grid[0].length;
  const count = width * height;

  const walkable = new Uint8Array(count);
  const open = new Uint8Array(count);
  const regionIds = new Int32Array(count);
  const materials: Array<CharacterFloorMaterial | null> = new Array<CharacterFloorMaterial | null>(
    count,
  ).fill(null);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const region = regionMap.regionAt(x, y);
      regionIds[index] = region;
      walkable[index] = isWalkableTileType(grid[y][x]) ? 1 : 0;
      // A prop standing in a room or hallway still has floor under it.
      open[index] = walkable[index] === 1 || region !== NO_REGION ? 1 : 0;
      const room = regionMap.room(region);
      const character = characters.characterAt(x, y);
      materials[index] =
        character === null
          ? null
          : laidMaterial(character.floorMaterial, room === null ? null : room.bounds, x, y);
    }
  }

  const raw = new Float32Array(count);
  for (const room of regionMap.rooms) {
    if (characters.forRegion(room.id)?.type !== 'room') continue;
    accumulateRoomWear(room, walkable, width, raw);
    normaliseRect(raw, width, room.bounds);
  }

  // A hallway is worn down its middle: the tiles farthest from its edges.
  // Measured against hallway tiles only, so a corridor running along a room's
  // open side finds its own middle rather than one pushed out into the room.
  const outsideHallways = new Uint8Array(count).fill(1);
  for (const hallway of regionMap.hallways) {
    for (const tile of hallway.tiles) outsideHallways[tile.y * width + tile.x] = 0;
  }
  const everywhere = new Uint8Array(count).fill(1);
  const clearance = stepsFrom(outsideHallways, everywhere, width, height);
  const dressedHallways = regionMap.hallways.filter(
    (hallway) => characters.forRegion(hallway.id)?.type === 'hallway',
  );
  let blurred: Float32Array = raw;
  for (let pass = 0; pass < WEAR_BLUR_PASSES; pass++) {
    blurred = blurAxis(blurred, open, width, height, true);
    blurred = blurAxis(blurred, open, width, height, false);
  }

  // Laid over the rooms' blurred field rather than blurred with it: a blur wide
  // enough to soften a room's routes would flatten a three-wide corridor's
  // centre line into its edges. The vertex interpolation softens it instead.
  const ridges = new Uint8Array(count);
  for (const hallway of dressedHallways) {
    for (const tile of hallway.tiles) {
      const here = clearance[tile.y * width + tile.x];
      const onRidge = CARDINALS.every((step) => {
        const nx = tile.x + step.x;
        const ny = tile.y + step.y;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return true;
        return clearance[ny * width + nx] <= here;
      });
      if (onRidge) ridges[tile.y * width + tile.x] = 1;
    }
  }
  for (const hallway of dressedHallways) {
    for (const tile of hallway.tiles) {
      const index = tile.y * width + tile.x;
      const besideRidge = CARDINALS.some((step) => {
        const nx = tile.x + step.x;
        const ny = tile.y + step.y;
        return nx >= 0 && ny >= 0 && nx < width && ny < height && ridges[ny * width + nx] === 1;
      });
      const hallwayWear = ridges[index] === 1 ? 1 : besideRidge ? HALLWAY_SHOULDER_WEAR : 0;
      blurred[index] = Math.max(blurred[index], hallwayWear);
    }
  }

  // Normalised per region, so a busy four-door hall and a dead-end closet are
  // each worn relative to their own traffic rather than the level's.
  const dressed = new Uint8Array(count);
  const peaks = new Map<number, number>();
  for (let index = 0; index < count; index++) {
    const region = regionIds[index];
    if (region === NO_REGION || open[index] === 0) continue;
    const assignment = characters.forRegion(region);
    if (assignment === null || assignment.type === 'special') continue;
    dressed[index] = 1;
    peaks.set(region, Math.max(peaks.get(region) ?? 0, blurred[index]));
  }

  const wear = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    if (dressed[index] === 0) continue;
    const peak = peaks.get(regionIds[index]) ?? 0;
    wear[index] = peak > 0 ? Math.min(1, blurred[index] / (peak * WEAR_PEAK_SHARE)) : 0;
  }

  const trodden = wear.map((tileWear) => (tileWear >= TRODDEN_WEAR ? 1 : 0));
  const stepsFromPath = stepsFrom(Uint8Array.from(trodden), open, width, height);

  const wash = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    if (dressed[index] === 0) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    const lift = smoothstep(LIFT_FROM_WEAR, 1, wear[index]);
    const steps = stepsFromPath[index];
    const untrodden = steps < 0 ? 1 : smoothstep(DUST_FROM_TILES, DUST_FULL_TILES, steps);
    const faceBand = besideWall(grid, x, y) ? FACE_BAND_DUST : 0;
    wash[index] = clampUnit(lift - Math.max(untrodden, faceBand));
  }

  const cornerWash = new Float32Array((width + 1) * (height + 1));
  for (let vy = 0; vy <= height; vy++) {
    for (let vx = 0; vx <= width; vx++) {
      let sum = 0;
      let samples = 0;
      for (let ty = vy - 1; ty <= vy; ty++) {
        for (let tx = vx - 1; tx <= vx; tx++) {
          if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
          const index = ty * width + tx;
          if (open[index] === 0) continue;
          sum += wash[index];
          samples++;
        }
      }
      cornerWash[vy * (width + 1) + vx] = samples > 0 ? sum / samples : 0;
    }
  }

  // A walk line down the middle replaces the lines along the walls: three
  // parallel stripes down one corridor would read as a road.
  const edgeLines = new Uint8Array(count);
  const hallwayMarks = new Uint8Array(count);
  for (const hallway of dressedHallways) {
    const assignment = characters.forRegion(hallway.id);
    if (assignment?.type !== 'hallway') continue;
    const feature = assignment.character.floorFeature;
    if (feature === 'gutter') layGutter(grid, hallway.tiles, width, hallwayMarks);
    const walkLine = feature === 'walk_line' && hallway.tiles.length >= WALK_LINE_MIN_TILES;
    if (walkLine) layWalkLine(hallway.tiles, ridges, width, height, hallwayMarks);
    if (walkLine || !hasPaintedEdgeLine(assignment.character.floor)) continue;
    for (const tile of hallway.tiles) {
      edgeLines[tile.y * width + tile.x] = edgeLineBits(grid, regionIds, width, height, tile);
    }
  }

  const features: PlacedFloorFeature[] = [];
  const featureIndex = new Int16Array(count).fill(NO_FEATURE);
  const puddles = new Uint8Array(count);
  for (const room of regionMap.rooms) {
    const assignment = characters.forRegion(room.id);
    if (assignment?.type !== 'room') continue;
    const kind = assignment.character.floorFeature;
    if (kind === null) continue;
    const feature = placeRoomFeature({ grid, walkable, room, kind });
    if (feature === null) continue;
    const { footprint } = feature;
    for (let y = footprint.y; y < footprint.y + footprint.h; y++) {
      for (let x = footprint.x; x < footprint.x + footprint.w; x++) {
        if (!featurePaintsTile(feature, grid, x, y)) continue;
        featureIndex[y * width + x] = features.length;
        const centreField = liquidField(feature, x + TILE_CENTRE, y + TILE_CENTRE);
        if (WATER_FEATURES.has(kind) && centreField >= LIQUID_EDGE_FIELD) {
          puddles[y * width + x] = 1;
        }
      }
    }
    features.push(feature);
  }

  return new FloorSurface({
    width,
    height,
    materials,
    wear,
    wash,
    cornerWash,
    edgeLines,
    hallwayMarks,
    features,
    featureIndex,
    puddles,
  });
}

/** A tile's centre, from its north-west corner, in tiles. */
const TILE_CENTRE = 0.5;

/**
 * Whether a level's hallways carry a painted line along their walls. The
 * service level's do — it is a sealed slab marked out to a specification — and
 * the cellars' worn flagstone runs do not.
 */
function hasPaintedEdgeLine(floor: DungeonFloorThemeId): boolean {
  return floor === 'service_level';
}

function isWallAt(grid: TileContent[][], x: number, y: number): boolean {
  if (y < 0 || y >= grid.length) return false;
  const row = grid[y];
  if (x < 0 || x >= row.length) return false;
  return row[x].type === FloorTypeValue.wall;
}

/** Whether any of a tile's eight neighbours is a wall: the band along a face's foot. */
function besideWall(grid: TileContent[][], x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if ((dx !== 0 || dy !== 0) && isWallAt(grid, x + dx, y + dy)) return true;
    }
  }
  return false;
}

function edgeLineBits(
  grid: TileContent[][],
  regionIds: Int32Array,
  width: number,
  height: number,
  tile: Point,
): number {
  const region = regionIds[tile.y * width + tile.x];
  const sameRegion = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && regionIds[y * width + x] === region;
  let bits = 0;
  for (const side of EDGE_SIDES) {
    if (isWallAt(grid, tile.x + side.dx, tile.y + side.dy)) bits |= side.bit;
  }
  for (const turn of EDGE_TURNS) {
    if (!isWallAt(grid, tile.x + turn.dx, tile.y + turn.dy)) continue;
    // Only where the line can carry on through both neighbours either side; a
    // turn next to a doorway would leave a stub pointing into the room.
    if (sameRegion(tile.x + turn.dx, tile.y) && sameRegion(tile.x, tile.y + turn.dy)) {
      bits |= turn.bit;
    }
  }
  return bits;
}

/**
 * The floor surface of each live map, keyed by its tile grid — the one handle
 * every tile painter is already given.
 */
const surfaces = new WeakMap<TileContent[][], FloorSurface>();

/** Makes a map's floor surface visible to the tile painters. */
export function registerFloorSurface(grid: TileContent[][], surface: FloorSurface): void {
  surfaces.set(grid, surface);
}

/** The floor surface registered for a tile grid, if any. */
export function floorSurfaceOf(grid: TileContent[][]): FloorSurface | undefined {
  return surfaces.get(grid);
}
